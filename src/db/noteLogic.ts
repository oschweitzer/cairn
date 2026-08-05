import type { ChecklistItem, Note, Tag } from './types'

/**
 * Logique pure de composition, de tri, de filtrage et de recherche.
 *
 * Séparée des hooks volontairement : ces fonctions n'ont besoin ni de React ni du
 * réseau, donc elles se testent directement sous Node. C'est là que vivent les
 * bugs qui comptent, ceux qui font disparaître une note d'une liste ou qui font
 * échouer une recherche accentuée.
 */

export type NoteWithRelations = Note & {
  items: ChecklistItem[]
  tags: Tag[]
}

export type NoteView = 'active' | 'archived'

export type TagLink = { note_id: string; tag_id: string }

export function composeNotes(
  notes: Note[],
  items: ChecklistItem[],
  links: TagLink[],
  tags: Tag[],
): NoteWithRelations[] {
  const itemsByNote = new Map<string, ChecklistItem[]>()
  for (const item of items) {
    const list = itemsByNote.get(item.note_id)
    if (list) list.push(item)
    else itemsByNote.set(item.note_id, [item])
  }
  for (const list of itemsByNote.values()) list.sort((a, b) => a.position - b.position)

  const tagsById = new Map(tags.map((t) => [t.id, t]))
  const tagsByNote = new Map<string, Tag[]>()
  for (const link of links) {
    const tag = tagsById.get(link.tag_id)
    // Un lien peut désigner un tag supprimé si le cache est en retard sur la
    // base : on l'ignore plutôt que de propager un undefined dans l'interface.
    if (!tag) continue
    const list = tagsByNote.get(link.note_id)
    if (list) list.push(tag)
    else tagsByNote.set(link.note_id, [tag])
  }
  for (const list of tagsByNote.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  return notes.map((note) => ({
    ...note,
    items: itemsByNote.get(note.id) ?? [],
    tags: tagsByNote.get(note.id) ?? [],
  }))
}

/**
 * Tri d'affichage. Les épinglées d'abord, puis par date de modification.
 * Postgres renvoie déjà cet ordre, mais une mise à jour optimiste peut le
 * bousculer localement, d'où ce tri de sûreté.
 */
export function byPinThenRecent(a: Note, b: Note): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
  return b.updated_at.localeCompare(a.updated_at)
}

/**
 * Normalisation pour la recherche. Le repli d'accents n'est pas un détail en
 * français : chercher « cafe » doit trouver « café », et « ecole » doit trouver
 * « école ».
 */
export function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Recherche côté client, et c'est un choix, pas un repli.
 *
 * Le plan prévoyait d'interroger `search_vector` côté Postgres. Mais toutes les
 * notes visibles sont déjà dans le cache, donc une requête serveur ajouterait un
 * aller-retour réseau pour un résultat identique, en moins bon : elle échouerait
 * hors ligne et ajouterait une latence à chaque frappe.
 *
 * L'index GIN de la migration n'est pas inutile pour autant. Il devient
 * nécessaire le jour où le corpus dépasse ce qu'on peut garder en cache et où la
 * liste sera paginée. Ce jour-là cette fonction devient le repli hors ligne, et
 * la requête serveur passe devant.
 *
 * La recherche porte sur le titre, le corps, les éléments de liste et les noms de
 * tags : chercher « courses » doit trouver la liste même si le mot n'est que dans
 * son titre, et chercher « maison » doit trouver les notes portant ce tag.
 */
export function matchesSearch(note: NoteWithRelations, foldedNeedle: string): boolean {
  if (foldedNeedle.length === 0) return true
  const haystack = [
    note.title ?? '',
    note.body ?? '',
    note.code_name ?? '',
    ...note.items.map((i) => i.content),
    ...note.tags.map((t) => t.name),
  ].join(' ')
  return fold(haystack).includes(foldedNeedle)
}

/**
 * Une note est vide quand elle ne porte aucune trace d'intention : ni titre, ni
 * corps, ni élément de liste, ni tag, ni couleur.
 *
 * La couleur, les tags et le nom de code comptent délibérément. Une note sans
 * texte mais teintée en fjord a été touchée volontairement, l'écarter serait une
 * perte de travail. Il en va de même d'une note rangée dans le coffre sous un
 * nom : la ranger est une intention, et l'effacer en sortant de l'éditeur
 * détruirait un geste explicite.
 */
export function isEmptyNote(note: {
  title: string | null
  body: string | null
  color_key: string | null
  code_name?: string | null
  items: { id: string }[]
  tags: { id: string }[]
}): boolean {
  return (
    !note.title?.trim() &&
    !note.body?.trim() &&
    !note.code_name?.trim() &&
    note.items.length === 0 &&
    note.tags.length === 0 &&
    note.color_key === null
  )
}

/**
 * Ce qui s'affiche à la place du titre partout où la note est listée : grille,
 * coffre, notifications, widget.
 *
 * Une note du coffre montre son nom de code, et rien d'autre. Sans nom de code
 * elle ne montre pas son titre pour autant : ce serait exactement la fuite que
 * le coffre est censé empêcher, et elle passerait inaperçue puisque le titre
 * s'afficherait normalement. Le repli est donc muet.
 *
 * Le titre reste en clair en base et dans l'éditeur, une fois le coffre ouvert.
 * C'est un masquage d'écran, pas du chiffrement.
 */
export function displayTitle(note: {
  title: string | null
  is_private: boolean
  code_name: string | null
}): string | null {
  if (!note.is_private) return note.title
  return note.code_name
}

/** Filtre conjonctif : la note doit porter tous les tags sélectionnés. */
export function hasAllTags(note: NoteWithRelations, tagIds: string[]): boolean {
  if (tagIds.length === 0) return true
  const own = new Set(note.tags.map((t) => t.id))
  return tagIds.every((id) => own.has(id))
}

export function filterNotes(
  all: NoteWithRelations[],
  options: { view: NoteView; tagIds: string[]; search: string },
): NoteWithRelations[] {
  const wantArchived = options.view === 'archived'
  const needle = fold(options.search.trim())
  return all
    .filter(
      (note) =>
        note.is_archived === wantArchived &&
        hasAllTags(note, options.tagIds) &&
        matchesSearch(note, needle),
    )
    .sort(byPinThenRecent)
}

/**
 * Répartition des cartes en colonnes de hauteurs libres, façon Google Keep.
 *
 * Chaque carte va dans la colonne la plus courte à cet instant. En cas d'égalité
 * la plus à gauche gagne, pour que l'ordre de lecture reste prévisible.
 */
export function distributeIntoColumns<T>(
  items: T[],
  columnCount: number,
  estimateHeight: (item: T) => number,
  gap = 0,
): T[][] {
  const count = Math.max(1, columnCount)
  const buckets: T[][] = Array.from({ length: count }, () => [])
  const heights = new Array<number>(count).fill(0)

  for (const item of items) {
    let target = 0
    for (let i = 1; i < count; i++) {
      if (heights[i] < heights[target]) target = i
    }
    buckets[target].push(item)
    heights[target] += estimateHeight(item) + gap
  }
  return buckets
}

export function columnsForWidth(width: number): number {
  if (width < 380) return 1
  if (width < 700) return 2
  if (width < 1100) return 3
  return 4
}
