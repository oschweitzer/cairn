import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getSupabase, isSupabaseConfigured } from './supabase'
import type { ChecklistItem, Note, NoteKind, NoteTag, Tag } from './types'
import type { TagColorKey } from '../ui/theme'

/**
 * Requêtes et mutations. Un jeu de clés unique, des accès par table plutôt que
 * par jointure imbriquée, et des mises à jour optimistes sur les interactions
 * qui doivent paraître instantanées.
 *
 * Pourquoi pas de select imbriqué à la PostgREST, du type
 * `notes.select('*, checklist_items(*)')` : les tables filles pointent vers
 * `notes` par une clé étrangère composite `(note_id, user_id)`, et le
 * comportement de PostgREST sur les relations composites n'est pas vérifiable
 * hors d'un vrai projet. Quatre requêtes à plat sont un peu plus bavardes mais
 * garanties de fonctionner, se mettent en cache indépendamment les unes des
 * autres, et rendent les mises à jour optimistes beaucoup plus simples à écrire.
 */

/** Racine de toutes les clés, pour pouvoir tout invalider d'un coup. */
const ROOT = 'cairn'

/**
 * Portée persistable sur le disque. Tout ce qui n'est pas sous ce préfixe reste
 * en mémoire seulement, ce qui vaut pour le coffre et la corbeille.
 */
export const PERSISTABLE_PREFIX = 'shared'

export const keys = {
  root: ROOT,
  /** Notes visibles : ni supprimées, ni masquées. */
  notes: [ROOT, PERSISTABLE_PREFIX, 'notes'] as const,
  /** Éléments de liste des notes visibles. */
  checklistItems: [ROOT, PERSISTABLE_PREFIX, 'checklist-items'] as const,
  noteTags: [ROOT, PERSISTABLE_PREFIX, 'note-tags'] as const,
  tags: [ROOT, PERSISTABLE_PREFIX, 'tags'] as const,
  /** Hors persistance, volontairement. */
  trashed: [ROOT, 'volatile', 'trashed-notes'] as const,
  privateNotes: [ROOT, 'volatile', 'private-notes'] as const,
  /**
   * Éléments de liste des notes du coffre, dans une clé volatile distincte.
   *
   * Ce n'est pas une redite de `checklistItems` : cette clé-là est persistable,
   * et y verser les identifiants des notes masquées enverrait leur contenu dans
   * localStorage sur le web. La séparation des notes ne vaut rien si leurs
   * cases à cocher, elles, descendent sur le disque.
   */
  privateChecklistItems: [ROOT, 'volatile', 'private-checklist-items'] as const,
}

// -------------------------------------------------------------- lectures

async function fetchNotes(): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .is('deleted_at', null)
    .eq('is_private', false)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Notes du coffre. Jamais appelée tant que le coffre est fermé : le hook est
 * conditionné à l'état de déverrouillage, donc refermer le coffre ne masque pas
 * seulement une vue, cela laisse expirer les données du cache.
 */
async function fetchPrivateNotes(): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .is('deleted_at', null)
    .eq('is_private', true)
    .order('is_pinned', { ascending: false })
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
 * Les éléments de liste sont filtrés sur les notes visibles, pas récupérés en
 * masse. C'est ce qui empêche le contenu d'une note du coffre de se retrouver
 * dans le cache persisté. Le filtre `in` limite en pratique à quelques centaines
 * d'identifiants, ce qui reste très au-dessus de l'usage d'une app personnelle.
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

/** Table de liaison, deux identifiants par ligne. Aucun contenu, donc pas de filtre. */
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

// `isSupabaseConfigured` conditionne chaque lecture : en mode démonstration on
// affiche ce que contient le cache, sans empiler des requêtes qui échoueront.
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
  // La clé inclut les identifiants triés : deux jeux de notes différents ne
  // doivent pas partager la même entrée de cache, et l'ordre ne doit pas créer
  // de faux écarts.
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

/** `enabled` porte l'état du coffre : fermé, aucune requête n'est émise. */
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

/** Invalide tout ce qui dépend des notes, y compris les vues non persistées. */
function invalidateNotes(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.notes })
  void qc.invalidateQueries({ queryKey: keys.checklistItems })
  void qc.invalidateQueries({ queryKey: keys.trashed })
  void qc.invalidateQueries({ queryKey: keys.privateNotes })
  void qc.invalidateQueries({ queryKey: keys.privateChecklistItems })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      kind: NoteKind
      title?: string
      colorKey?: TagColorKey | null
      /**
       * Naître dans le coffre plutôt qu'y être déplacée ensuite.
       *
       * Ce n'est pas un raccourci de confort. Créer la note en clair puis la
       * masquer la ferait exister, ne serait-ce qu'un instant, dans la liste
       * visible et dans le cache persisté de tous les appareils connectés. Une
       * note écrite depuis le coffre ne doit jamais avoir été ailleurs.
       */
      isPrivate?: boolean
    }) => {
      const { data, error } = await getSupabase()
        .from('notes')
        .insert({
          kind: input.kind,
          title: input.title ?? null,
          color_key: input.colorKey ?? null,
          is_private: input.isPrivate ?? false,
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
  >
>

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: NotePatch }) => {
      const { error } = await getSupabase().from('notes').update(patch).eq('id', id)
      if (error) throw error
    },
    // Épingler, archiver ou changer la couleur doit paraître instantané : on
    // écrit dans le cache avant la réponse du serveur, et on revient en arrière
    // si l'écriture échoue.
    /**
     * Épingler, archiver ou changer la couleur doit paraître instantané.
     *
     * Les deux caches sont touchés parce qu'une note vit dans l'un ou dans
     * l'autre, jamais dans les deux, et que l'éditeur ne sait pas d'où vient
     * celle qu'il modifie. Ne mettre à jour que la liste visible ferait
     * clignoter chaque retouche faite depuis le coffre.
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
 * Entrée et sortie du coffre.
 *
 * Mutation dédiée plutôt qu'un champ de plus dans `NotePatch`, parce que
 * `is_private` et `code_name` ne sont pas indépendants : la contrainte
 * `code_name_requires_private` refuse un nom de code sur une note visible. Les
 * deux colonnes partent donc dans le même ordre SQL, et sortir du coffre efface
 * le nom de code par construction plutôt que par discipline de l'appelant.
 *
 * Aucune mise à jour optimiste ici, volontairement. La note change de liste, ce
 * qui la fait disparaître d'un écran pour apparaître dans un autre : la jouer
 * d'avance et devoir la remettre en cas d'échec donnerait un aller-retour
 * visible bien plus perturbant que l'attente d'une réponse.
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
      const patch = isPrivate
        ? { is_private: true, code_name: codeName?.trim() || null }
        : { is_private: false, code_name: null }
      const { error } = await getSupabase().from('notes').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateNotes(qc),
  })
}

/** Suppression douce : la note part à la corbeille, rien n'est perdu. */
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

/** Suppression définitive. Les tables filles suivent par cascade. */
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

// ------------------------------------------------------- actions en masse

/**
 * Actions sur une sélection. Chacune tient dans une seule requête grâce au filtre
 * `in`, plutôt qu'une boucle d'appels : sur vingt notes cela fait la différence
 * entre une action instantanée et vingt allers-retours réseau.
 *
 * Les mises à jour optimistes sont indispensables ici, pas décoratives : après
 * une suppression multiple la grille doit se réorganiser tout de suite, sinon on
 * voit les cartes disparaître une par une au rythme de la revalidation.
 */

/** Retire les notes de toute liste locale, avant confirmation du serveur. */
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

/** Suppression définitive d'un lot. Sert au vidage de la corbeille. */
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

// ------------------------------------------------- éléments de liste

export function useAddChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { noteId: string; content: string; position: number }) => {
      const { data, error } = await getSupabase()
        .from('checklist_items')
        .insert({ note_id: input.noteId, content: input.content, position: input.position })
        .select()
        .single()
      if (error) throw error
      return data as ChecklistItem
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.checklistItems })
    },
  })
}

export function useUpdateChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<ChecklistItem, 'content' | 'is_done' | 'position' | 'due_at'>>
    }) => {
      const { error } = await getSupabase().from('checklist_items').update(patch).eq('id', id)
      if (error) throw error
    },
    // Cocher une case est l'interaction la plus fréquente de l'application, elle
    // ne doit jamais attendre le réseau.
    onMutate: async ({ id, patch }) => {
      const entries = qc.getQueriesData<ChecklistItem[]>({ queryKey: keys.checklistItems })
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.checklistItems })
    },
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
      const entries = qc.getQueriesData<ChecklistItem[]>({ queryKey: keys.checklistItems })
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.checklistItems })
    },
  })
}

/**
 * Réordonnancement en un seul appel atomique, via la fonction SQL dédiée.
 * Voir supabase/migrations/20260805130000_reorder_checklist_items.sql pour la
 * raison de ne pas passer par un upsert.
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
    // Le glissement doit suivre le doigt : on écrit l'ordre localement tout de
    // suite, la requête ne fait que confirmer.
    onMutate: async ({ noteId, orderedIds }) => {
      const entries = qc.getQueriesData<ChecklistItem[]>({ queryKey: keys.checklistItems })
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.checklistItems })
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

/** Supprimer un tag retire aussi ses associations, par cascade. */
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
 * Remplace l'ensemble des tags d'une note. Plus simple à raisonner qu'un ajout
 * et un retrait séparés, et le volume par note est de quelques lignes.
 */
export function useSetNoteTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ noteId, tagIds }: { noteId: string; tagIds: string[] }) => {
      const supabase = getSupabase()
      const { error: delError } = await supabase.from('note_tags').delete().eq('note_id', noteId)
      if (delError) throw delError
      if (tagIds.length === 0) return
      const { error } = await supabase
        .from('note_tags')
        .insert(tagIds.map((tag_id) => ({ note_id: noteId, tag_id })))
      if (error) throw error
    },
    onMutate: async ({ noteId, tagIds }) => {
      const previous = qc.getQueryData<NoteTag[]>(keys.noteTags)
      if (previous) {
        const others = previous.filter((nt) => nt.note_id !== noteId)
        // user_id est rempli par le défaut auth.uid() côté base ; la valeur
        // optimiste locale n'est jamais relue, seule la paire compte.
        const next = tagIds.map((tag_id) => ({ note_id: noteId, tag_id, user_id: '' }))
        qc.setQueryData<NoteTag[]>(keys.noteTags, [...others, ...next])
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.noteTags, context.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.noteTags })
    },
  })
}
