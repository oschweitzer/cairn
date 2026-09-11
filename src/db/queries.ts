import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getSupabase, isSupabaseConfigured } from './supabase'
// The root and the persistable scope live in `persistLogic.ts`, next to the rule
// that decides what goes down to the disk: one source of truth for both.
import { PERSISTABLE_PREFIX, QUERY_ROOT as ROOT } from './persistLogic'
import { hasDataKey, openNote, sealItem, sealNote } from '../vault/keyring'
import type { ChecklistItem, Note, NoteKind, NoteTag, Profile, Tag } from './types'
import type { TagColorKey } from '../ui/theme'

/**
 * Queries and mutations. One set of keys, per-table access rather than nested
 * joins, and optimistic updates on the interactions that have to feel instant.
 *
 * Why no PostgREST-style nested select, like
 * `notes.select('*, checklist_items(*)')`: the child tables point to `notes`
 * through a composite foreign key `(note_id, user_id)`, and PostgREST's
 * behaviour on composite relations cannot be checked outside a real project.
 * Four flat queries are a little more verbose but guaranteed to work, are
 * cached independently of each other, and make optimistic updates much simpler
 * to write.
 */

export const keys = {
  root: ROOT,
  /** Visible notes: neither deleted nor hidden. */
  notes: [ROOT, PERSISTABLE_PREFIX, 'notes'] as const,
  /** List items of the visible notes. */
  checklistItems: [ROOT, PERSISTABLE_PREFIX, 'checklist-items'] as const,
  noteTags: [ROOT, PERSISTABLE_PREFIX, 'note-tags'] as const,
  tags: [ROOT, PERSISTABLE_PREFIX, 'tags'] as const,
  /** Kept out of persistence, on purpose. */
  trashed: [ROOT, 'volatile', 'trashed-notes'] as const,
  privateNotes: [ROOT, 'volatile', 'private-notes'] as const,
  /**
   * List items of the vault notes, under a separate volatile key.
   *
   * This is not a repeat of `checklistItems`: that key is persistable, and
   * feeding it the ids of hidden notes would send their content to localStorage
   * on the web. Keeping the notes apart is worth nothing if their checkboxes go
   * down to the disk.
   */
  privateChecklistItems: [ROOT, 'volatile', 'private-checklist-items'] as const,
  /**
   * State of the Google Calendar connection. Volatile, like the vault: the row
   * carries the Google account's address, and writing it to localStorage to
   * spare one request at startup would be a bad trade.
   */
  googleAccount: [ROOT, 'volatile', 'google-account'] as const,
  /**
   * Account preferences. Volatile: they are settings, not content, and there is
   * nothing to show offline that is worth putting on the disk.
   */
  profile: [ROOT, 'volatile', 'profile'] as const,
}

// ----------------------------------------------------------------- reads

async function fetchNotes(): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .is('deleted_at', null)
    .eq('is_private', false)
    .order('is_pinned', { ascending: false })
    // Rank before date: the chosen order comes first, and the date only breaks
    // ties between notes left level. See `byPinThenOrder`.
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Vault notes. Never called while the vault is closed: the hook depends on the
 * unlock state, so closing the vault does not merely hide a view, it lets the
 * data expire from the cache.
 */
async function fetchPrivateNotes(): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .is('deleted_at', null)
    .eq('is_private', true)
    .order('is_pinned', { ascending: false })
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

async function fetchTrashedNotes(): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * List items are filtered on the visible notes, not fetched wholesale. That is
 * what keeps a vault note's content out of the persisted cache. The `in` filter
 * is limited in practice to a few hundred ids, which stays well above what a
 * personal app uses.
 */
async function fetchChecklistItems(noteIds: string[]): Promise<ChecklistItem[]> {
  if (noteIds.length === 0) return []
  const { data, error } = await getSupabase()
    .from('checklist_items')
    .select('*')
    .in('note_id', noteIds)
    .order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Join table, two ids per row. No content, so no filter. */
async function fetchNoteTags(): Promise<NoteTag[]> {
  const { data, error } = await getSupabase().from('note_tags').select('*')
  if (error) throw error
  return data ?? []
}

async function fetchTags(): Promise<Tag[]> {
  const { data, error } = await getSupabase()
    .from('tags')
    .select('*')
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ----------------------------------------------------------------- hooks

// `isSupabaseConfigured` gates every read: in demo mode we show what the cache
// holds, without piling up requests that will fail.
export function useNotes(enabled = true) {
  return useQuery({ queryKey: keys.notes, queryFn: fetchNotes, enabled: enabled && isSupabaseConfigured })
}

export function useTags(enabled = true) {
  return useQuery({ queryKey: keys.tags, queryFn: fetchTags, enabled: enabled && isSupabaseConfigured })
}

export function useNoteTags(enabled = true) {
  return useQuery({ queryKey: keys.noteTags, queryFn: fetchNoteTags, enabled: enabled && isSupabaseConfigured })
}

export function useChecklistItems(noteIds: string[], enabled = true) {
  // The key includes the sorted ids: two different sets of notes must not share
  // the same cache entry, and order must not create false differences.
  const sorted = [...noteIds].sort()
  return useQuery({
    queryKey: [...keys.checklistItems, sorted.join(',')],
    queryFn: () => fetchChecklistItems(sorted),
    enabled: enabled && isSupabaseConfigured && sorted.length > 0,
  })
}

export function useTrashedNotes(enabled = true) {
  return useQuery({ queryKey: keys.trashed, queryFn: fetchTrashedNotes, enabled: enabled && isSupabaseConfigured })
}

/** `enabled` carries the vault state: closed, no request is sent. */
export function usePrivateNotes(enabled = true) {
  return useQuery({
    queryKey: keys.privateNotes,
    queryFn: fetchPrivateNotes,
    enabled: enabled && isSupabaseConfigured,
  })
}

export function usePrivateChecklistItems(noteIds: string[], enabled = true) {
  const sorted = [...noteIds].sort()
  return useQuery({
    queryKey: [...keys.privateChecklistItems, sorted.join(',')],
    queryFn: () => fetchChecklistItems(sorted),
    enabled: enabled && isSupabaseConfigured && sorted.length > 0,
  })
}

// ------------------------------------------------------------- mutations

/** Invalidates everything that depends on notes, non-persisted views included. */
function invalidateNotes(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.notes })
  void qc.invalidateQueries({ queryKey: keys.checklistItems })
  void qc.invalidateQueries({ queryKey: keys.trashed })
  void qc.invalidateQueries({ queryKey: keys.privateNotes })
  void qc.invalidateQueries({ queryKey: keys.privateChecklistItems })
}

/**
 * Both list-item caches, never just one.
 *
 * A list lives in the grid OR in the vault, and the mutation does not know
 * which of the two it has just touched: the item is identified only by its own
 * id, not by the state of the note that holds it. Invalidating only the visible
 * cache therefore left vault lists frozen on screen — the insert did reach the
 * database, but nothing appeared, which reads as a dead button.
 */
function invalidateChecklistItems(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.checklistItems })
  void qc.invalidateQueries({ queryKey: keys.privateChecklistItems })
}

/**
 * The cache entries of both item lists, visible and vault.
 *
 * The optimistic updates below write to the cache before the server answers.
 * Read from the visible cache alone, they left vault lists inert: ticking a box
 * there ticked nothing.
 */
function checklistItemEntries(qc: QueryClient) {
  return [
    ...qc.getQueriesData<ChecklistItem[]>({ queryKey: keys.checklistItems }),
    ...qc.getQueriesData<ChecklistItem[]>({ queryKey: keys.privateChecklistItems }),
  ]
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      kind: NoteKind
      title?: string
      colorKey?: TagColorKey | null
      /**
       * Born in the vault rather than moved there afterwards.
       *
       * This is not a convenience shortcut. Creating the note in the clear and
       * then hiding it would make it exist, if only for an instant, in the
       * visible list and in the persisted cache of every connected device. A note
       * written from the vault must never have been anywhere else.
       */
      isPrivate?: boolean
    }) => {
      // A vault note is born encrypted, even empty: otherwise its title would
      // go out in the clear from the first keystroke, and nothing would come
      // back to fix it.
      const encrypt = Boolean(input.isPrivate) && hasDataKey()
      const sealed = encrypt ? sealNote({ title: input.title ?? null, body: null }) : null

      const { data, error } = await getSupabase()
        .from('notes')
        .insert({
          kind: input.kind,
          title: sealed ? null : (input.title ?? null),
          color_key: input.colorKey ?? null,
          is_private: input.isPrivate ?? false,
          is_encrypted: sealed !== null,
          ciphertext: sealed,
        })
        .select()
        .single()
      if (error) throw error
      return data as Note
    },
    onSuccess: () => invalidateNotes(qc),
  })
}

type NotePatch = Partial<
  Pick<
    Note,
    | 'title'
    | 'body'
    | 'kind'
    | 'color_key'
    | 'is_pinned'
    | 'is_archived'
    | 'deleted_at'
    | 'code_name'
    | 'hide_content'
  >
>

/**
 * Prepares a patch for an encrypted note.
 *
 * The title and the body cannot be written separately: they share a single
 * sealed blob. A patch touching only one of them must therefore carry the other
 * as it is on screen, hence `current` — without it, writing the title would
 * erase the body.
 *
 * The other fields — pin, archive, colour, code name — go through untouched:
 * they are not encrypted, and that is deliberate. The code name is precisely
 * the innocuous label that stands in for the title in the grid.
 */
function sealPatch(patch: NotePatch, current: { title: string | null; body: string | null }) {
  const touchesText = patch.title !== undefined || patch.body !== undefined
  if (!touchesText) return patch

  const sealed = sealNote({
    title: patch.title !== undefined ? patch.title : current.title,
    body: patch.body !== undefined ? patch.body : current.body,
  })
  if (!sealed) return patch

  const { title: _t, body: _b, ...rest } = patch
  return { ...rest, is_encrypted: true, title: null, body: null, ciphertext: sealed }
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
      encrypted,
      current,
    }: {
      id: string
      patch: NotePatch
      /** True when the note lives in the encrypted vault. The caller knows, the mutation does not. */
      encrypted?: boolean
      /** Text on screen at the time of the write, to rebuild the complete sealed blob. */
      current?: { title: string | null; body: string | null }
    }) => {
      const body =
        encrypted && hasDataKey() ? sealPatch(patch, current ?? { title: null, body: null }) : patch
      const { error } = await getSupabase().from('notes').update(body).eq('id', id)
      if (error) throw error
    },
    // Pinning, archiving or changing the colour has to feel instant: we write
    // to the cache before the server answers, and roll back if the write fails.
    /**
     * Pinning, archiving or changing the colour has to feel instant.
     *
     * Both caches are touched because a note lives in one or the other, never in
     * both, and the editor does not know where the one it is changing comes
     * from. Updating only the visible list would make every edit made from the
     * vault flicker.
     */
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.notes })
      await qc.cancelQueries({ queryKey: keys.privateNotes })
      const previous = qc.getQueryData<Note[]>(keys.notes)
      const previousPrivate = qc.getQueryData<Note[]>(keys.privateNotes)
      const apply = (list: Note[]) => list.map((n) => (n.id === id ? { ...n, ...patch } : n))
      if (previous) qc.setQueryData<Note[]>(keys.notes, apply(previous))
      if (previousPrivate) qc.setQueryData<Note[]>(keys.privateNotes, apply(previousPrivate))
      return { previous, previousPrivate }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.notes, context.previous)
      if (context?.previousPrivate) qc.setQueryData(keys.privateNotes, context.previousPrivate)
    },
    onSettled: () => invalidateNotes(qc),
  })
}

/**
 * Moving into and out of the vault.
 *
 * A dedicated mutation rather than one more field in `NotePatch`, because
 * `is_private` does not travel alone: the `code_name_requires_private` and
 * `hide_content_requires_private` constraints each reject their column on a
 * visible note. So the three columns go out in the same SQL statement, and
 * leaving the vault clears the code name and content masking by construction
 * rather than by the caller's discipline.
 *
 * No optimistic update here, on purpose. The note changes lists, which makes it
 * vanish from one screen to appear on another: playing that ahead of time and
 * having to put it back on failure would give a visible round trip far more
 * disturbing than waiting for an answer.
 */
export function useSetNotePrivate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      isPrivate,
      codeName,
    }: {
      id: string
      isPrivate: boolean
      codeName?: string | null
    }) => {
      /**
       * Crossing the vault's door changes the state of the content, not just a
       * flag: we encrypt going in, we decrypt coming out.
       *
       * Hence the read first. The mutation only receives an id, and it needs
       * the text to seal it — asking the caller for it would work for the
       * editor, but not for the vault filing a note it has never displayed.
       */
      const supabase = getSupabase()
      const { data: row, error: readError } = await supabase
        .from('notes')
        .select('title, body, is_encrypted, ciphertext')
        .eq('id', id)
        .single()
      if (readError) throw readError

      let patch: NotePatch & { is_private: boolean; code_name: string | null }

      if (isPrivate) {
        const sealed = hasDataKey() && !row.is_encrypted
          ? sealNote({ title: row.title, body: row.body })
          : null
        patch = {
          is_private: true,
          code_name: codeName?.trim() || null,
          ...(sealed ? { is_encrypted: true, title: null, body: null, ciphertext: sealed } : {}),
        }
      } else {
        // On the way out, the content becomes readable in the database again: a
        // note outside the vault that stayed encrypted would be undecryptable the
        // day the key changes, and it has nothing left to hide.
        const opened = row.is_encrypted ? openNote(row.ciphertext) : null
        patch = {
          is_private: false,
          code_name: null,
          hide_content: false,
          ...(opened
            ? { is_encrypted: false, ciphertext: null, title: opened.title, body: opened.body }
            : {}),
        }
      }

      const { error } = await supabase.from('notes').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateNotes(qc),
  })
}

/** Soft delete: the note goes to the trash, nothing is lost. */
export function useTrashNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase()
        .from('notes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.notes })
      const previous = qc.getQueryData<Note[]>(keys.notes)
      if (previous) {
        qc.setQueryData<Note[]>(
          keys.notes,
          previous.filter((n) => n.id !== id),
        )
      }
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(keys.notes, context.previous)
    },
    onSettled: () => invalidateNotes(qc),
  })
}

export function useRestoreNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase()
        .from('notes')
        .update({ deleted_at: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateNotes(qc),
  })
}

/** Permanent deletion. Child tables follow by cascade. */
export function usePurgeNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().from('notes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateNotes(qc),
  })
}

// ----------------------------------------------------------- bulk actions

/**
 * Actions on a selection. Each fits in a single request thanks to the `in`
 * filter, rather than a loop of calls: on twenty notes that is the difference
 * between an instant action and twenty network round trips.
 *
 * The optimistic updates are essential here, not decorative: after a multiple
 * deletion the grid has to rearrange at once, otherwise you watch the cards
 * disappear one by one at the pace of revalidation.
 */

/** Removes the notes from any local list, before the server confirms. */
function optimisticallyRemove(qc: QueryClient, ids: string[]) {
  const set = new Set(ids)
  const previous = qc.getQueryData<Note[]>(keys.notes)
  if (previous) {
    qc.setQueryData<Note[]>(
      keys.notes,
      previous.filter((n) => !set.has(n.id)),
    )
  }
  return previous
}

function optimisticallyPatch(qc: QueryClient, ids: string[], patch: NotePatch) {
  const set = new Set(ids)
  const previous = qc.getQueryData<Note[]>(keys.notes)
  if (previous) {
    qc.setQueryData<Note[]>(
      keys.notes,
      previous.map((n) => (set.has(n.id) ? { ...n, ...patch } : n)),
    )
  }
  return previous
}

export function useTrashNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return
      const { error } = await getSupabase()
        .from('notes')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids)
      if (error) throw error
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: keys.notes })
      return { previous: optimisticallyRemove(qc, ids) }
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) qc.setQueryData(keys.notes, context.previous)
    },
    onSettled: () => invalidateNotes(qc),
  })
}

export function useSetNotesArchived() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, archived }: { ids: string[]; archived: boolean }) => {
      if (ids.length === 0) return
      const { error } = await getSupabase()
        .from('notes')
        .update({ is_archived: archived })
        .in('id', ids)
      if (error) throw error
    },
    onMutate: async ({ ids, archived }) => {
      await qc.cancelQueries({ queryKey: keys.notes })
      return { previous: optimisticallyPatch(qc, ids, { is_archived: archived }) }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.notes, context.previous)
    },
    onSettled: () => invalidateNotes(qc),
  })
}

export function useSetNotesPinned() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, pinned }: { ids: string[]; pinned: boolean }) => {
      if (ids.length === 0) return
      const { error } = await getSupabase().from('notes').update({ is_pinned: pinned }).in('id', ids)
      if (error) throw error
    },
    onMutate: async ({ ids, pinned }) => {
      await qc.cancelQueries({ queryKey: keys.notes })
      return { previous: optimisticallyPatch(qc, ids, { is_pinned: pinned }) }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.notes, context.previous)
    },
    onSettled: () => invalidateNotes(qc),
  })
}

/**
 * Sets the grid order, in a single atomic call.
 *
 * See supabase/migrations/20260809100000_ordre_des_notes.sql for why this goes
 * through an SQL function rather than an upsert.
 *
 * The optimistic update is not decorative: dragging has to follow the finger,
 * and waiting for the server's answer would send the card back to its original
 * place for the length of a round trip. So the rank is written locally right
 * away, and the request only confirms it.
 */
export function useReorderNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderedIds }: { orderedIds: string[] }) => {
      if (orderedIds.length === 0) return
      const { error } = await getSupabase().rpc('reorder_notes', { p_ids: orderedIds })
      if (error) throw error
    },
    onMutate: async ({ orderedIds }) => {
      await qc.cancelQueries({ queryKey: keys.notes })
      const previous = qc.getQueryData<Note[]>(keys.notes)
      if (previous) {
        const rank = new Map(orderedIds.map((id, index) => [id, index]))
        qc.setQueryData<Note[]>(
          keys.notes,
          previous.map((n) => (rank.has(n.id) ? { ...n, position: rank.get(n.id)! } : n)),
        )
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.notes, context.previous)
    },
    onSettled: () => invalidateNotes(qc),
  })
}

/** Permanent deletion of a batch. Used to empty the trash. */
export function usePurgeNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return
      const { error } = await getSupabase().from('notes').delete().in('id', ids)
      if (error) throw error
    },
    onMutate: async (ids) => {
      const set = new Set(ids)
      const previous = qc.getQueryData<Note[]>(keys.trashed)
      if (previous) {
        qc.setQueryData<Note[]>(
          keys.trashed,
          previous.filter((n) => !set.has(n.id)),
        )
      }
      return { previous }
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) qc.setQueryData(keys.trashed, context.previous)
    },
    onSettled: () => invalidateNotes(qc),
  })
}

// ------------------------------------------------------------ list items

export function useAddChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      noteId: string
      content: string
      position: number
      /** True when the note holding the item lives in the encrypted vault. */
      encrypted?: boolean
    }) => {
      const sealed = input.encrypted && hasDataKey() ? sealItem(input.content) : null
      const { data, error } = await getSupabase()
        .from('checklist_items')
        .insert({
          note_id: input.noteId,
          content: sealed ? null : input.content,
          is_encrypted: sealed !== null,
          ciphertext: sealed,
          position: input.position,
        })
        .select()
        .single()
      if (error) throw error
      return data as ChecklistItem
    },
    onSuccess: () => invalidateChecklistItems(qc),
  })
}

export function useUpdateChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
      encrypted,
    }: {
      id: string
      patch: Partial<Pick<ChecklistItem, 'content' | 'is_done' | 'position' | 'due_at'>>
      encrypted?: boolean
    }) => {
      // Ticking a box does not touch the text: only rewritten content has to go
      // through sealing again.
      const sealed =
        encrypted && hasDataKey() && typeof patch.content === 'string'
          ? sealItem(patch.content)
          : null
      const body = sealed
        ? { ...patch, content: null, is_encrypted: true, ciphertext: sealed }
        : patch
      const { error } = await getSupabase().from('checklist_items').update(body).eq('id', id)
      if (error) throw error
    },
    // Ticking a box is the most frequent interaction in the app, it must never
    // wait on the network.
    onMutate: async ({ id, patch }) => {
      const entries = checklistItemEntries(qc)
      for (const [key, items] of entries) {
        if (!items) continue
        qc.setQueryData<ChecklistItem[]>(
          key,
          items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        )
      }
      return { entries }
    },
    onError: (_err, _vars, context) => {
      for (const [key, items] of context?.entries ?? []) qc.setQueryData(key, items)
    },
    onSettled: () => invalidateChecklistItems(qc),
  })
}

export function useDeleteChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().from('checklist_items').delete().eq('id', id)
      if (error) throw error
    },
    onMutate: async (id) => {
      const entries = checklistItemEntries(qc)
      for (const [key, items] of entries) {
        if (!items) continue
        qc.setQueryData<ChecklistItem[]>(
          key,
          items.filter((i) => i.id !== id),
        )
      }
      return { entries }
    },
    onError: (_err, _id, context) => {
      for (const [key, items] of context?.entries ?? []) qc.setQueryData(key, items)
    },
    onSettled: () => invalidateChecklistItems(qc),
  })
}

/**
 * Reordering in a single atomic call, through the dedicated SQL function.
 * See supabase/migrations/20260805130000_reorder_checklist_items.sql for why
 * this does not go through an upsert.
 */
export function useReorderChecklistItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ noteId, orderedIds }: { noteId: string; orderedIds: string[] }) => {
      const { error } = await getSupabase().rpc('reorder_checklist_items', {
        p_note_id: noteId,
        p_ids: orderedIds,
      })
      if (error) throw error
    },
    // Dragging has to follow the finger: the order is written locally right
    // away, and the request only confirms it.
    onMutate: async ({ noteId, orderedIds }) => {
      const entries = checklistItemEntries(qc)
      const rank = new Map(orderedIds.map((id, index) => [id, index]))
      for (const [key, items] of entries) {
        if (!items) continue
        qc.setQueryData<ChecklistItem[]>(
          key,
          items.map((i) =>
            i.note_id === noteId && rank.has(i.id) ? { ...i, position: rank.get(i.id)! } : i,
          ),
        )
      }
      return { entries }
    },
    onError: (_err, _vars, context) => {
      for (const [key, items] of context?.entries ?? []) qc.setQueryData(key, items)
    },
    onSettled: () => invalidateChecklistItems(qc),
  })
}

// ----------------------------------------------------------------- profile

/**
 * Settings that live in the database rather than on the device.
 *
 * The theme, for its part, is read from local storage before the first render
 * — a network round trip there would give a flash of the inverted theme. The
 * widget settings do not have that constraint: the widget reads them from the
 * snapshot, never during a render.
 *
 * The key is volatile: the profile holds preferences, not content, and there is
 * nothing to show offline that is worth putting it on the disk.
 */
async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await getSupabase().from('profiles').select('*').maybeSingle()
  if (error) throw error
  return data ?? null
}

export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: fetchProfile,
    enabled: isSupabaseConfigured,
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Profile> }) => {
      const { error } = await getSupabase().from('profiles').update(patch).eq('id', id)
      if (error) throw error
    },
    // A checkbox has to flip under the finger: waiting on the network to see it
    // change state makes it feel broken.
    onMutate: async ({ patch }) => {
      await qc.cancelQueries({ queryKey: keys.profile })
      const previous = qc.getQueryData<Profile | null>(keys.profile)
      if (previous) qc.setQueryData<Profile>(keys.profile, { ...previous, ...patch })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(keys.profile, context.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.profile })
    },
  })
}

// -------------------------------------------------------------------- tags

export function useCreateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; colorKey: TagColorKey }) => {
      const { data, error } = await getSupabase()
        .from('tags')
        .insert({ name: input.name.trim(), color_key: input.colorKey })
        .select()
        .single()
      if (error) throw error
      return data as Tag
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.tags })
    },
  })
}

export function useUpdateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<Tag, 'name' | 'color_key' | 'position'>>
    }) => {
      const { error } = await getSupabase().from('tags').update(patch).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, patch }) => {
      const previous = qc.getQueryData<Tag[]>(keys.tags)
      if (previous) {
        qc.setQueryData<Tag[]>(
          keys.tags,
          previous.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        )
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.tags, context.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.tags })
    },
  })
}

/** Deleting a tag also removes its links, by cascade. */
export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().from('tags').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.tags })
      void qc.invalidateQueries({ queryKey: keys.noteTags })
    },
  })
}

/**
 * Adds or removes **one** tag on a note.
 *
 * ── Why a delta, and not replacing the whole set ─────────────────────────────
 * The previous version received the complete list of wanted tags and applied
 * it with a `delete` of all the note's links followed by an `insert`. That is
 * simple to read, and wrong as soon as two gestures come close together — which
 * is precisely the case of the most common gesture: switching tags, which
 * removes one and adds another.
 *
 * Nothing serialises two calls to the same mutation in React Query. So the two
 * `delete`s and the two `insert`s interleaved, and the order of arrival decided
 * the outcome:
 *
 *   remove A → delete(all)  ─────────────────▶ insert(none)
 *   add    B →      delete(all) ─▶ insert(A, B)
 *                                  ▲ the first gesture's list, read before
 *                                    it had gone out
 *
 * A came back, and switching tags "did not work". Serialising the mutations
 * (`scope`) would close the window, but at the cost of visual feedback: the
 * second gesture's optimistic update would only happen once the first had
 * finished, and the second chip would stay dark for a network round trip.
 *
 * A delta does not have that problem: two gestures on two different tags touch
 * two different rows, so they commute. Order of arrival no longer matters, and
 * there is nothing to serialise.
 *
 * `upsert` rather than `insert`: adding a tag that is already on — two taps, a
 * late revalidation — must not surface a primary key violation.
 */
export function useSetNoteTag() {
  const qc = useQueryClient()

  /** Applies the delta to a list of links, with no possible duplicate. */
  const apply = (links: NoteTag[], noteId: string, tagId: string, on: boolean) => {
    const without = links.filter((nt) => !(nt.note_id === noteId && nt.tag_id === tagId))
    // user_id is filled by the auth.uid() default on the database side; the
    // local optimistic value is never read back, only the pair matters.
    return on ? [...without, { note_id: noteId, tag_id: tagId, user_id: '' }] : without
  }

  return useMutation({
    mutationFn: async ({
      noteId,
      tagId,
      on,
    }: {
      noteId: string
      tagId: string
      /** True to add the tag, false to remove it. */
      on: boolean
    }) => {
      const supabase = getSupabase()
      if (on) {
        const { error } = await supabase
          .from('note_tags')
          .upsert({ note_id: noteId, tag_id: tagId }, { onConflict: 'note_id,tag_id' })
        if (error) throw error
        return
      }
      const { error } = await supabase
        .from('note_tags')
        .delete()
        .eq('note_id', noteId)
        .eq('tag_id', tagId)
      if (error) throw error
    },
    onMutate: async ({ noteId, tagId, on }) => {
      // Without this cancellation, a read sent before the gesture can come back
      // after it and rewrite the list as it was: the chip lit up again by
      // itself a fraction of a second later.
      await qc.cancelQueries({ queryKey: keys.noteTags })
      const previous = qc.getQueryData<NoteTag[]>(keys.noteTags)
      if (previous) qc.setQueryData<NoteTag[]>(keys.noteTags, apply(previous, noteId, tagId, on))
    },
    /**
     * We undo this gesture, and nothing else.
     *
     * Restoring the snapshot taken before the mutation would also cancel the
     * neighbouring gestures still in flight — which would bring back, through
     * another door, the bug this delta fixes.
     */
    onError: (_err, { noteId, tagId, on }) => {
      const current = qc.getQueryData<NoteTag[]>(keys.noteTags)
      if (current) qc.setQueryData<NoteTag[]>(keys.noteTags, apply(current, noteId, tagId, !on))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.noteTags })
    },
  })
}
