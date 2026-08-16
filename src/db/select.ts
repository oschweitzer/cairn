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
 * Hooks de lecture. Ils ne font que brancher les quatre requêtes à plat sur la
 * logique pure de src/db/noteLogic.ts, laquelle est testée sous Node par
 * `npm run test:logic`.
 *
 * Le filtrage vit côté client et pas dans les requêtes parce qu'une note archivée
 * et une note active partagent la même entrée de cache : basculer entre les vues
 * ne doit provoquer aucun aller-retour réseau.
 */

export type { NoteView, NoteWithRelations }

/**
 * Ouvre ce qui est chiffré, à la frontière entre la base et l'interface.
 *
 * Un seul endroit pour tout le déchiffrement en lecture, et c'est délibéré :
 * dispersé dans les écrans, il suffirait d'un oubli pour afficher un chiffré
 * hexadécimal à la place d'un titre. En amont de `composeNotes`, tout ce qui
 * vit au-dessus manipule du texte lisible et n'a plus rien à savoir du coffre.
 *
 * Une note dont le chiffré ne s'ouvre pas — clé absente, contenu altéré — rend
 * un titre et un corps nuls plutôt que de disparaître. Elle reste listée, ce
 * qui est la seule conduite honnête : la faire disparaître laisserait croire
 * qu'elle a été perdue.
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
 * Vrai tant que l'écran n'a rien à montrer et qu'il reste une raison d'attendre.
 *
 * `isLoading` de React Query ne suffit pas, et l'écart est piégeux : il vaut
 * `isPending && isFetching`, or pendant la restauration du cache disque les
 * requêtes sont retenues, donc `isFetching` est faux. L'écran se croyait alors
 * chargé alors qu'il n'avait encore rien, et affichait son état vide — « rien
 * d'empilé pour l'instant » — une fraction de seconde avant que les notes
 * n'arrivent. Sur le web, un rechargement de page tombait systématiquement
 * dedans, l'application ouvrant toujours sur un cache à restaurer.
 *
 * La condition sur le vide est ce qui garde une revalidation en arrière-plan
 * silencieuse : tant qu'il y a quelque chose à lire, on le laisse à l'écran.
 *
 * Une requête désactivée — mode démonstration sans projet Supabase — reste
 * `pending` pour toujours sans jamais être en vol : elle n'entre donc dans
 * aucune des deux branches, et l'état vide s'affiche comme il se doit.
 */
function useAwaitingContent(isLoading: boolean, isEmpty: boolean): boolean {
  const isRestoring = useIsRestoring()
  const { loading: authLoading } = useAuth()
  // La session compte autant que le cache : une requête partie avant que le
  // jeton ne soit posé revient avec zéro ligne — RLS fait son travail — et sa
  // liste vide n'est pas une réponse, c'est une question mal posée.
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

  // tagIds arrive souvent comme un littéral recréé à chaque rendu : on le
  // sérialise pour que le mémo ne se recalcule que sur un vrai changement.
  const tagKey = tagIds.join(',')
  const visible = useMemo(
    () => filterNotes(all, { view, tagIds: tagKey ? tagKey.split(',') : [], search }),
    [all, view, tagKey, search],
  )

  // La grille n'est vraiment en chargement que si l'on n'a encore rien à
  // afficher. Une revalidation en arrière-plan ne doit pas vider l'écran.
  const isLoading = useAwaitingContent(notesQuery.isLoading, notes.length === 0)

  return {
    notes: visible,
    /** Toutes les notes composées, tous états confondus. Utile aux compteurs. */
    all,
    isLoading,
    isError: notesQuery.isError,
    error: notesQuery.error,
    refetch: notesQuery.refetch,
    isRefetching: notesQuery.isRefetching,
  }
}

/**
 * Notes du coffre, recomposées.
 *
 * Tout est conditionné à `unlocked` : coffre fermé, aucune requête n'est émise
 * et la liste est vide, pas seulement masquée. Les éléments de liste passent par
 * une clé volatile distincte, sans quoi le contenu des notes masquées finirait
 * dans le cache persisté par la bande.
 *
 * Contrairement à la grille, l'archivage ne filtre pas ici. Le coffre est la
 * réponse à « où sont mes notes cachées », et en écarter une partie selon un
 * état posé ailleurs rendrait la question sans réponse fiable.
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

  // Appelé sans condition : `unlocked &&` en amont court-circuiterait l'appel du
  // hook, et le nombre de hooks rendus doit être le même à chaque rendu.
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
 * Corbeille. Pas de recomposition ici : on n'y montre ni cases à cocher ni tags,
 * seulement de quoi décider. Ce hook n'existe que pour que l'écran hérite de la
 * même définition du chargement que les autres, restauration comprise.
 */
export function useTrashedNoteList() {
  const query = useTrashedNotes()
  const notes = query.data ?? []
  const isLoading = useAwaitingContent(query.isLoading, notes.length === 0)
  return { notes, isLoading, isError: query.isError }
}

/**
 * Un seul enregistrement, recomposé. Sert à l'éditeur.
 *
 * Les deux listes sont consultées, la visible d'abord. L'éditeur n'a pas à
 * savoir d'où vient la note qu'on lui demande, et la liste masquée est de toute
 * façon vide tant que le coffre est fermé : le contrôle d'accès reste au même
 * endroit plutôt que d'être répété dans chaque écran.
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
     * L'absence de note ne veut pas dire la même chose selon qu'on a fini de
     * chercher ou non. Sans cette distinction, l'éditeur ouvert à froid
     * annonçait « Note introuvable » pendant que la requête était encore en vol,
     * accusant l'application d'avoir perdu ce qu'elle allait trouver.
     */
    isLoading: !note && (isLoading || hiddenLoading),
  }
}

/** Nombre de notes par tag, pour la gestion des tags. */
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
