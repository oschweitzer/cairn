import { useMemo } from 'react'
import { useIsRestoring } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { openItem, openNote } from '../vault/keyring'
import type { ChecklistItem, Note, PlainChecklistItem } from './types'
import {
  useChecklistItems,
  useNoteTags,
  useNotes,
  usePrivateChecklistItems,
  usePrivateNotes,
  useTags,
  useTrashedNotes,
} from './queries'
import { useVault } from '../vault/VaultProvider'
import {
  byPinThenOrder,
  composeNotes,
  filterNotes,
  fold,
  matchesSearch,
  type NoteView,
  type NoteWithRelations,
} from './noteLogic'

/**
 * Read hooks. All they do is plug the four flat queries into the pure logic of
 * src/db/noteLogic.ts, which is tested under Node by `npm run test:logic`.
 *
 * Filtering lives on the client and not in the queries because an archived note
 * and an active note share the same cache entry: switching between views must
 * not cause any network round trip.
 */

export type { NoteView, NoteWithRelations }

/**
 * Opens what is encrypted, at the border between the database and the
 * interface.
 *
 * A single place for all decryption on read, and that is deliberate: spread
 * across screens, one oversight would be enough to display hexadecimal
 * ciphertext in place of a title. Upstream of `composeNotes`, everything living
 * above handles readable text and needs to know nothing more about the vault.
 *
 * A note whose ciphertext does not open — missing key, tampered content —
 * yields a null title and body rather than disappearing. It stays listed, which
 * is the only honest course: making it disappear would suggest it had been
 * lost.
 *
 * ── The key is an input, and it is an invisible one ──────────────────────────
 * This reads more than its argument: `openNote` also reads the data key, which
 * lives in the keyring — a module, not a value React can watch. Every memo
 * calling this therefore carries `keyStatus` in its dependencies, and without it
 * the memo was a trap on the second unlock.
 *
 * The order is what springs it. Unlocking flips `unlocked`, which enables the
 * private-notes query and *then* sends an effect off to fetch the key. On the
 * first unlock the rows come from the network and lose that race, so the key is
 * there before them. On the next one they are already in React Query's memory
 * cache and arrive in the same render, ahead of the key: the memo composed the
 * notes with a null title and a null body — the very fallback described above —
 * and its dependencies never changed again. The key landed a moment later and
 * nothing recomputed, so the cards stayed blank until some later refetch moved a
 * row. Which reads, on screen, as a vault that has lost what it holds.
 *
 * `keyStatus` turns `ready` in the same breath as the key being loaded, and
 * leaves `ready` when `lock()` unloads it: here it stands for the key itself.
 */
function decryptNotes(notes: Note[]): Note[] {
  return notes.map((note) => {
    if (!note.is_encrypted) return note
    const { title, body } = openNote(note.ciphertext)
    return { ...note, title, body }
  })
}

function decryptItems(items: ChecklistItem[]): PlainChecklistItem[] {
  return items.map((item) => ({
    ...item,
    content: item.is_encrypted ? (openItem(item.ciphertext) ?? '') : (item.content ?? ''),
  }))
}

/**
 * True as long as the screen has nothing to show and there is still a reason to
 * wait.
 *
 * React Query's `isLoading` is not enough, and the gap is a trap: it means
 * `isPending && isFetching`, and while the disk cache is being restored queries
 * are held back, so `isFetching` is false. The screen then believed it had
 * loaded while it had nothing yet, and showed its empty state — « rien
 * d'empilé pour l'instant » — a fraction of a second before the notes arrived.
 * On the web, a page reload fell into it every time, the app always opening on a
 * cache to restore.
 *
 * The condition on emptiness is what keeps a background revalidation silent: as
 * long as there is something to read, it is left on screen.
 *
 * A disabled query — demo mode without a Supabase project — stays `pending`
 * forever without ever being in flight: so it enters neither branch, and the
 * empty state shows as it should.
 */
function useAwaitingContent(isLoading: boolean, isEmpty: boolean): boolean {
  const isRestoring = useIsRestoring()
  const { loading: authLoading } = useAuth()
  // The session counts as much as the cache: a query sent before the token is
  // set comes back with zero rows — RLS doing its job — and its empty list is
  // not an answer, it is a badly asked question.
  return isEmpty && (isRestoring || authLoading || isLoading)
}

export function useNoteList(options?: { view?: NoteView; tagIds?: string[]; search?: string }) {
  const view = options?.view ?? 'active'
  const tagIds = options?.tagIds ?? []
  const search = options?.search ?? ''

  const { keyStatus } = useVault()
  const notesQuery = useNotes()
  const notes = notesQuery.data ?? []

  const noteIds = useMemo(() => notes.map((n) => n.id), [notes])
  const itemsQuery = useChecklistItems(noteIds)
  const linksQuery = useNoteTags()
  const tagsQuery = useTags()

  // `keyStatus`: see `decryptNotes`. The key is this memo's other input, the one
  // that never appears in its arguments.
  const all = useMemo(
    () =>
      composeNotes(
        decryptNotes(notes),
        decryptItems(itemsQuery.data ?? []),
        linksQuery.data ?? [],
        tagsQuery.data ?? [],
      ),
    [notes, itemsQuery.data, linksQuery.data, tagsQuery.data, keyStatus],
  )

  // tagIds often arrives as a literal recreated on every render: it is
  // serialised so the memo only recomputes on a real change.
  const tagKey = tagIds.join(',')
  const visible = useMemo(
    () => filterNotes(all, { view, tagIds: tagKey ? tagKey.split(',') : [], search }),
    [all, view, tagKey, search],
  )

  // The grid is only really loading if there is nothing to display yet. A
  // background revalidation must not empty the screen.
  const isLoading = useAwaitingContent(notesQuery.isLoading, notes.length === 0)

  return {
    notes: visible,
    /** All composed notes, whatever their state. Useful for counters. */
    all,
    isLoading,
    isError: notesQuery.isError,
    error: notesQuery.error,
    refetch: notesQuery.refetch,
    isRefetching: notesQuery.isRefetching,
  }
}

/**
 * Vault notes, recomposed.
 *
 * Everything depends on `unlocked`: with the vault closed, no request is sent
 * and the list is empty, not merely hidden. List items go through a separate
 * volatile key, otherwise the content of hidden notes would end up in the
 * persisted cache by the back door.
 *
 * Unlike the grid, archiving does not filter here. The vault is the answer to
 * "where are my hidden notes", and leaving some out based on a state set
 * elsewhere would leave that question without a reliable answer.
 */
export function usePrivateNoteList(options?: { search?: string }) {
  const { unlocked, keyStatus } = useVault()
  const search = options?.search ?? ''

  const notesQuery = usePrivateNotes(unlocked)
  const notes = unlocked ? (notesQuery.data ?? []) : []

  const noteIds = useMemo(() => notes.map((n) => n.id), [notes])
  const itemsQuery = usePrivateChecklistItems(noteIds, unlocked)
  const linksQuery = useNoteTags()
  const tagsQuery = useTags()

  // `keyStatus`: see `decryptNotes`. This is the memo the missing dependency
  // actually broke — the vault is where the key arrives after the rows.
  const all = useMemo(
    () =>
      composeNotes(
        decryptNotes(notes),
        decryptItems(itemsQuery.data ?? []),
        linksQuery.data ?? [],
        tagsQuery.data ?? [],
      ),
    [notes, itemsQuery.data, linksQuery.data, tagsQuery.data, keyStatus],
  )

  const visible = useMemo(() => {
    const needle = fold(search.trim())
    return all.filter((note) => matchesSearch(note, needle)).sort(byPinThenOrder)
  }, [all, search])

  // Called unconditionally: `unlocked &&` upstream would short-circuit the hook
  // call, and the number of hooks rendered must be the same on every render.
  const awaiting = useAwaitingContent(notesQuery.isLoading, notes.length === 0)

  return {
    notes: visible,
    all,
    isLoading: unlocked && awaiting,
    isError: notesQuery.isError,
    error: notesQuery.error,
    refetch: notesQuery.refetch,
    isRefetching: notesQuery.isRefetching,
  }
}

/**
 * Trash. No recomposition here: it shows neither checkboxes nor tags, only
 * enough to decide. This hook only exists so the screen inherits the same
 * definition of loading as the others, restoration included.
 */
export function useTrashedNoteList() {
  const query = useTrashedNotes()
  const notes = query.data ?? []
  const isLoading = useAwaitingContent(query.isLoading, notes.length === 0)
  return { notes, isLoading, isError: query.isError }
}

/**
 * A single record, recomposed. Used by the editor.
 *
 * Both lists are consulted, the visible one first. The editor does not need to
 * know where the note it is asked for comes from, and the hidden list is empty
 * anyway as long as the vault is closed: access control stays in one place
 * rather than being repeated in every screen.
 */
export function useNote(id: string | undefined) {
  const { all, isLoading } = useNoteList()
  const { all: hidden, isLoading: hiddenLoading } = usePrivateNoteList()

  const note = useMemo(
    () => (id ? (all.find((n) => n.id === id) ?? hidden.find((n) => n.id === id)) : undefined),
    [all, hidden, id],
  )

  return {
    note,
    /**
     * A missing note does not mean the same thing depending on whether the
     * search has finished. Without this distinction, the editor opened cold
     * announced « Note introuvable » while the query was still in flight,
     * accusing the app of losing what it was about to find.
     */
    isLoading: !note && (isLoading || hiddenLoading),
  }
}

/** Number of notes per tag, for tag management. */
export function useTagUsage(): Map<string, number> {
  const { all } = useNoteList()
  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of all) {
      for (const tag of note.tags) counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1)
    }
    return counts
  }, [all])
}
