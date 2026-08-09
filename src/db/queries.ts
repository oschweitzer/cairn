import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getSupabase, isSupabaseConfigured } from './supabase'
import { hasDataKey, openNote, sealItem, sealNote } from '../vault/keyring'
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
  /**
   * État de la connexion à Google Agenda. Volatile, comme le coffre : la ligne
   * porte l'adresse du compte Google, et l'écrire dans localStorage pour
   * épargner une requête au démarrage serait un mauvais échange.
   */
  googleAccount: [ROOT, 'volatile', 'google-account'] as const,
}

// -------------------------------------------------------------- lectures

async function fetchNotes(): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .is('deleted_at', null)
    .eq('is_private', false)
    .order('is_pinned', { ascending: false })
    // Le rang avant la date : c'est l'ordre choisi qui prime, et la date ne fait
    // que départager les notes restées à égalité. Voir `byPinThenOrder`.
    .order('position', { ascending: true })
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

/**
 * Les deux caches d'éléments de liste, jamais un seul.
 *
 * Une liste vit dans la grille OU dans le coffre, et la mutation ne sait pas
 * laquelle des deux elle vient de toucher : l'élément n'est identifié que par
 * son propre identifiant, pas par l'état de la note qui le porte. N'invalider
 * que le cache visible laissait donc les listes du coffre figées à l'écran —
 * l'ajout partait bien en base, mais rien n'apparaissait, ce qui se lit comme
 * un bouton mort.
 */
function invalidateChecklistItems(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.checklistItems })
  void qc.invalidateQueries({ queryKey: keys.privateChecklistItems })
}

/**
 * Les entrées de cache des deux listes d'éléments, visible et coffre.
 *
 * Les mises à jour optimistes ci-dessous écrivent dans le cache avant la
 * réponse du serveur. Lues sur le seul cache visible, elles laissaient les
 * listes du coffre inertes : cocher une case n'y cochait rien.
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
       * Naître dans le coffre plutôt qu'y être déplacée ensuite.
       *
       * Ce n'est pas un raccourci de confort. Créer la note en clair puis la
       * masquer la ferait exister, ne serait-ce qu'un instant, dans la liste
       * visible et dans le cache persisté de tous les appareils connectés. Une
       * note écrite depuis le coffre ne doit jamais avoir été ailleurs.
       */
      isPrivate?: boolean
    }) => {
      // Une note du coffre naît chiffrée, y compris vide : son titre partirait
      // sinon en clair dès la première frappe, et rien ne repasserait derrière.
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
  >
>

/**
 * Prépare un correctif pour une note chiffrée.
 *
 * Le titre et le corps ne peuvent pas être écrits séparément : ils partagent un
 * seul scellé. Un correctif qui ne porte que sur l'un des deux doit donc
 * emporter l'autre tel qu'il est à l'écran, d'où `current` — sans lui, écrire
 * le titre effacerait le corps.
 *
 * Les autres champs — épingle, archive, couleur, nom de code — traversent sans
 * être touchés : ils ne sont pas chiffrés, et c'est assumé. Le nom de code est
 * précisément l'étiquette anodine qui remplace le titre dans la grille.
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
      /** Vrai quand la note vit dans le coffre chiffré. L'appelant le sait, la mutation non. */
      encrypted?: boolean
      /** Texte affiché à l'instant de l'écriture, pour reconstituer le scellé complet. */
      current?: { title: string | null; body: string | null }
    }) => {
      const body =
        encrypted && hasDataKey() ? sealPatch(patch, current ?? { title: null, body: null }) : patch
      const { error } = await getSupabase().from('notes').update(body).eq('id', id)
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
      /**
       * Franchir la porte du coffre change l'état du contenu, pas seulement un
       * drapeau : on chiffre en entrant, on déchiffre en sortant.
       *
       * D'où la lecture préalable. La mutation ne reçoit qu'un identifiant, et
       * elle a besoin du texte pour le sceller — le demander à l'appelant
       * marcherait pour l'éditeur, mais pas pour le coffre qui range une note
       * qu'il n'a jamais affichée.
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
        // En sortant, le contenu redevient lisible en base : une note hors du
        // coffre qui resterait chiffrée serait indéchiffrable le jour où la clé
        // change, et elle n'a plus rien à cacher.
        const opened = row.is_encrypted ? openNote(row.ciphertext) : null
        patch = {
          is_private: false,
          code_name: null,
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

/**
 * Fixe l'ordre de la grille, en un seul appel atomique.
 *
 * Voir supabase/migrations/20260809100000_ordre_des_notes.sql pour la raison de
 * passer par une fonction SQL plutôt que par un upsert.
 *
 * La mise à jour optimiste n'est pas décorative : le glissement doit suivre le
 * doigt, et attendre la réponse du serveur ferait revenir la carte à sa place
 * d'origine le temps d'un aller-retour. On écrit donc le rang localement tout de
 * suite, la requête ne fait que confirmer.
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
    mutationFn: async (input: {
      noteId: string
      content: string
      position: number
      /** Vrai quand la note porteuse vit dans le coffre chiffré. */
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
      // Cocher une case ne touche pas au texte : seul un contenu réécrit doit
      // repasser par le scellé.
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
    // Cocher une case est l'interaction la plus fréquente de l'application, elle
    // ne doit jamais attendre le réseau.
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
 * Pose ou retire **un** tag sur une note.
 *
 * ── Pourquoi un delta, et non le remplacement de l'ensemble ──────────────────
 * La version précédente recevait la liste complète des tags voulus et
 * l'appliquait par un `delete` de tous les liens de la note suivi d'un `insert`.
 * C'est simple à lire, et faux dès qu'il y a deux gestes rapprochés — ce qui est
 * précisément le cas du geste le plus courant : changer de tag, qui en retire un
 * et en pose un autre.
 *
 * Rien ne sérialise deux appels à une même mutation dans React Query. Les deux
 * `delete` et les deux `insert` s'entrelaçaient donc, et l'ordre d'arrivée
 * décidait du résultat :
 *
 *   retirer A → delete(tous)  ────────────────▶ insert(rien)
 *   poser   B →      delete(tous) ─▶ insert(A, B)
 *                                    ▲ la liste du premier geste, lue avant
 *                                      qu'il ne soit parti
 *
 * A revenait, et changer de tag « ne marchait pas ». Sérialiser les mutations
 * (`scope`) refermerait la fenêtre, mais au prix du retour visuel : la mise à
 * jour optimiste du second geste n'aurait lieu qu'à la fin du premier, et la
 * seconde pastille resterait éteinte le temps d'un aller-retour réseau.
 *
 * Un delta n'a pas ce problème : deux gestes sur deux tags différents touchent
 * deux lignes différentes, donc ils commutent. L'ordre d'arrivée n'a plus
 * d'importance, et il n'y a rien à sérialiser.
 *
 * `upsert` plutôt qu'`insert` : reposer un tag déjà posé — deux appuis, une
 * revalidation en retard — ne doit pas remonter une violation de clé primaire.
 */
export function useSetNoteTag() {
  const qc = useQueryClient()

  /** Applique le delta à une liste de liens, sans doublon possible. */
  const apply = (links: NoteTag[], noteId: string, tagId: string, on: boolean) => {
    const without = links.filter((nt) => !(nt.note_id === noteId && nt.tag_id === tagId))
    // user_id est rempli par le défaut auth.uid() côté base ; la valeur
    // optimiste locale n'est jamais relue, seule la paire compte.
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
      /** Vrai pour poser le tag, faux pour le retirer. */
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
      // Sans cette annulation, une lecture partie avant le geste peut revenir
      // après et réécrire la liste telle qu'elle était : la pastille se
      // rallumait toute seule une fraction de seconde plus tard.
      await qc.cancelQueries({ queryKey: keys.noteTags })
      const previous = qc.getQueryData<NoteTag[]>(keys.noteTags)
      if (previous) qc.setQueryData<NoteTag[]>(keys.noteTags, apply(previous, noteId, tagId, on))
    },
    /**
     * On défait ce geste-ci, et rien d'autre.
     *
     * Restaurer l'instantané pris avant la mutation annulerait au passage les
     * gestes voisins encore en vol — ce qui reproduirait, par une autre porte,
     * le bug que ce delta corrige.
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
