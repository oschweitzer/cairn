import type { Note, PlainChecklistItem, Tag } from './types'
// Type seul, effacé à la compilation : aucune dépendance d'exécution vers l'UI,
// et src/ui/theme.ts n'importe de toute façon aucun module react-native.
import type { TagColorKey } from '../ui/theme'
// Module pur lui aussi, sans React ni react-native : le retirer du balisage est
// une opération sur du texte, elle a sa place du côté de la logique.
import { plainText } from '../text/markup'

/**
 * Logique pure de composition, de tri, de filtrage et de recherche.
 *
 * Séparée des hooks volontairement : ces fonctions n'ont besoin ni de React ni du
 * réseau, donc elles se testent directement sous Node. C'est là que vivent les
 * bugs qui comptent, ceux qui font disparaître une note d'une liste ou qui font
 * échouer une recherche accentuée.
 */

export type NoteWithRelations = Note & {
  items: PlainChecklistItem[]
  tags: Tag[]
}

export type NoteView = 'active' | 'archived'

export type TagLink = { note_id: string; tag_id: string }

export function composeNotes(
  notes: Note[],
  items: PlainChecklistItem[],
  links: TagLink[],
  tags: Tag[],
): NoteWithRelations[] {
  const itemsByNote = new Map<string, PlainChecklistItem[]>()
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
    // Sur le texte sans son balisage : chercher « liste de courses » ne trouvait
    // plus la note où seul « courses » avait été mis en gras, le haystack
    // contenant « liste de **courses** ». La mise en forme ne doit rien cacher.
    plainText(note.body),
    note.code_name ?? '',
    ...note.items.map((i) => plainText(i.content)),
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

/**
 * Couleur qu'une note prend en recevant un tag, ou `null` s'il ne faut rien
 * changer.
 *
 * Un tag a une couleur, une note aussi, et jusqu'ici les deux ne se parlaient
 * pas : on posait un tag « courses » en fjord et la carte restait grise, il
 * fallait aller repeindre la note à la main avec la teinte qu'on venait de
 * choisir juste à côté. La couleur du tag est déjà une décision, elle sert.
 *
 * ── Ce que la règle ne fait pas, et c'est le plus important ──────────────────
 * Elle ne repeint jamais une note déjà colorée. Une couleur posée à la main est
 * un choix explicite, et un tag ajouté ensuite n'a pas à l'écraser : ce serait
 * perdre une intention pour en deviner une autre. D'où le nom : c'est un
 * héritage, pas une synchronisation.
 *
 * Le retrait d'un tag ne défait rien non plus. La couleur est devenue celle de
 * la note, et la reprendre en enlevant le tag ferait disparaître un état visible
 * de la grille sans que personne ne l'ait demandé.
 */
export function inheritedColor(
  note: Pick<Note, 'color_key'>,
  addedTag: Pick<Tag, 'color_key'> | undefined,
): TagColorKey | null {
  if (!addedTag) return null
  if (note.color_key !== null) return null
  return addedTag.color_key
}

type TagRef = Pick<Tag, 'id' | 'color_key'>

/**
 * Ce qu'il faut écrire dans `color_key` après un changement de tags.
 *
 * Trois réponses possibles, et la distinction compte : `undefined` veut dire
 * « ne rien écrire », `null` veut dire « effacer la couleur ». Les confondre
 * repeindrait ou déteindrait des notes à chaque geste.
 *
 * ── Ce que cette fonction ajoute à `inheritedColor` ──────────────────────────
 * L'héritage ne repeint jamais une note déjà colorée, ce qui est juste tant
 * qu'on ne fait qu'ajouter des tags. Mais changer de tag, c'est en retirer un et
 * en poser un autre : la note gardait alors la teinte de l'ancien, indéfiniment.
 * On changeait de catégorie et la carte continuait d'afficher la couleur de la
 * précédente, ce qui se lit comme un changement qui n'a pas pris.
 *
 * D'où la notion de couleur orpheline : celle que portait un tag qu'on vient de
 * retirer, et que plus aucun tag restant ne porte. Elle est reprise par le tag
 * qui remplace, ou effacée s'il n'y en a pas.
 *
 * Le commentaire précédent affirmait qu'un retrait ne devait rien défaire. Cet
 * argument tenait pour une couleur choisie à la main — il ne tient pas pour une
 * couleur que le tag avait posée lui-même, et que personne n'a demandé à garder.
 * La coïncidence reste possible : une teinte choisie à la main qui se trouve
 * être exactement celle du tag retiré sera relâchée. C'est le seul cas ambigu,
 * il est rare, et il se répare d'un appui — là où l'ancien comportement laissait
 * une note bloquée sur la couleur d'une catégorie qu'elle n'a plus.
 */
export function colorAfterTagChange(
  note: Pick<Note, 'color_key'>,
  before: TagRef[],
  after: TagRef[],
): TagColorKey | null | undefined {
  const added = after.find((tag) => !before.some((b) => b.id === tag.id))

  // Une note sans teinte prend celle du tag qu'on lui pose. Rien d'autre à
  // décider : il n'y a aucune couleur à préserver ni à relâcher.
  if (note.color_key === null) return inheritedColor(note, added) ?? undefined

  const orpheline =
    before.some((tag) => tag.color_key === note.color_key && !after.some((a) => a.id === tag.id)) &&
    !after.some((tag) => tag.color_key === note.color_key)

  if (!orpheline) return undefined
  return added ? added.color_key : null
}

/**
 * Tag déjà nommé ainsi, ou `undefined`.
 *
 * La comparaison replie les accents et la casse, alors que la contrainte
 * `unique (user_id, name)` de la base, elle, distingue « École » de « ecole ».
 * L'écart est délibéré : la base empêche deux lignes identiques, cette fonction
 * empêche deux tags qu'on ne saurait pas distinguer à l'œil dans une liste de
 * pastilles. Le second problème est le vrai, et il arrive bien plus tôt.
 */
export function findTagNamed<T extends Pick<Tag, 'name'>>(
  tags: T[],
  name: string,
): T | undefined {
  const needle = fold(name.trim())
  return tags.find((tag) => fold(tag.name) === needle)
}

/**
 * Teinte à proposer pour un tag de plus : la moins servie de la palette, la
 * première déclarée en cas d'égalité.
 *
 * Créer des tags à la volée depuis une note, sans passer par l'onglet Tags où
 * la couleur se choisit, donnerait sinon dix pastilles de la même teinte — et
 * une pastille de couleur qui ne distingue rien ne sert à rien.
 *
 * Les clés de la palette sont passées en argument plutôt qu'importées : ce
 * module ne dépend de l'interface qu'au niveau des types, effacés à la
 * compilation, et une importation de valeur créerait un lien d'exécution de la
 * base vers l'UI dans le mauvais sens.
 */
export function nextTagColor(
  tags: Pick<Tag, 'color_key'>[],
  palette: readonly TagColorKey[],
): TagColorKey {
  const used = new Map<TagColorKey, number>(palette.map((key) => [key, 0]))
  for (const tag of tags) {
    const count = used.get(tag.color_key)
    if (count !== undefined) used.set(tag.color_key, count + 1)
  }
  let best = palette[0]
  for (const key of palette) {
    if (used.get(key)! < used.get(best)!) best = key
  }
  return best
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
