import { useMemo } from 'react'
import {
  useChecklistItems,
  useNoteTags,
  useNotes,
  usePrivateChecklistItems,
  usePrivateNotes,
  useTags,
} from './queries'
import { useVault } from '../vault/VaultProvider'
import {
  byPinThenRecent,
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

export function useNoteList(options?: { view?: NoteView; tagIds?: string[]; search?: string }) {
  const view = options?.view ?? 'active'
  const tagIds = options?.tagIds ?? []
  const search = options?.search ?? ''

  const notesQuery = useNotes()
  const notes = notesQuery.data ?? []

  const noteIds = useMemo(() => notes.map((n) => n.id), [notes])
  const itemsQuery = useChecklistItems(noteIds)
  const linksQuery = useNoteTags()
  const tagsQuery = useTags()

  const all = useMemo(
    () => composeNotes(notes, itemsQuery.data ?? [], linksQuery.data ?? [], tagsQuery.data ?? []),
    [notes, itemsQuery.data, linksQuery.data, tagsQuery.data],
  )

  // tagIds arrive souvent comme un littéral recréé à chaque rendu : on le
  // sérialise pour que le mémo ne se recalcule que sur un vrai changement.
  const tagKey = tagIds.join(',')
  const visible = useMemo(
    () => filterNotes(all, { view, tagIds: tagKey ? tagKey.split(',') : [], search }),
    [all, view, tagKey, search],
  )

  return {
    notes: visible,
    /** Toutes les notes composées, tous états confondus. Utile aux compteurs. */
    all,
    // La grille n'est vraiment en chargement que si l'on n'a encore rien à
    // afficher. Une revalidation en arrière-plan ne doit pas vider l'écran.
    isLoading: notesQuery.isLoading && notes.length === 0,
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
  const { unlocked } = useVault()
  const search = options?.search ?? ''

  const notesQuery = usePrivateNotes(unlocked)
  const notes = unlocked ? (notesQuery.data ?? []) : []

  const noteIds = useMemo(() => notes.map((n) => n.id), [notes])
  const itemsQuery = usePrivateChecklistItems(noteIds, unlocked)
  const linksQuery = useNoteTags()
  const tagsQuery = useTags()

  const all = useMemo(
    () => composeNotes(notes, itemsQuery.data ?? [], linksQuery.data ?? [], tagsQuery.data ?? []),
    [notes, itemsQuery.data, linksQuery.data, tagsQuery.data],
  )

  const visible = useMemo(() => {
    const needle = fold(search.trim())
    return all.filter((note) => matchesSearch(note, needle)).sort(byPinThenRecent)
  }, [all, search])

  return {
    notes: visible,
    all,
    isLoading: unlocked && notesQuery.isLoading && notes.length === 0,
    isError: notesQuery.isError,
    error: notesQuery.error,
    refetch: notesQuery.refetch,
    isRefetching: notesQuery.isRefetching,
  }
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
  const { all } = useNoteList()
  const { all: hidden } = usePrivateNoteList()
  return useMemo(
    () => (id ? (all.find((n) => n.id === id) ?? hidden.find((n) => n.id === id)) : undefined),
    [all, hidden, id],
  )
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
