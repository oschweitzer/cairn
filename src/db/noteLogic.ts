import type { Note, NoteKind, PlainChecklistItem, Tag } from './types'
// Type only, erased at compile time: no runtime dependency on the UI, and
// src/ui/theme.ts imports no react-native module anyway.
import type { TagColorKey } from '../ui/theme'
// A pure module too, without React or react-native: stripping markup is a text
// operation, and it belongs on the logic side.
import { flatLine, flatText, plainText } from '../text/markup'

/**
 * Pure composition, sorting, filtering and search logic.
 *
 * Kept away from the hooks on purpose: these functions need neither React nor
 * the network, so they can be tested directly under Node. This is where the bugs
 * that matter live — the ones that make a note vanish from a list, or make an
 * accented search come back empty.
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
    // A link can point at a deleted tag when the cache lags behind the
    // database: we skip it rather than let an undefined reach the interface.
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
 * Display order: pinned first, then the chosen rank, then the modification date.
 *
 * Postgres already returns this order, but an optimistic update can disturb it
 * locally, hence this safety sort.
 *
 * The tie-break on date is what makes the default rank work. Every note is worth
 * zero until someone moves something: they are all tied, and the order is the
 * one from before drag-and-drop existed. It is also what puts a freshly created
 * note on top — it is born at zero, tied with the first, and wins the tie-break
 * by being the most recent.
 */
export function byPinThenOrder(a: Note, b: Note): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
  if (a.position !== b.position) return a.position - b.position
  return b.updated_at.localeCompare(a.updated_at)
}

/**
 * Moves a note within the grid, pins respected.
 *
 * ── The rule that matters ────────────────────────────────────────────────────
 * Pinned notes stay on top, whatever happens. Rather than forbid the gesture — a
 * drop refused without a word reads as a bug — we let you drop wherever you
 * like, then put the pinned ones back in front. Dropping an ordinary note among
 * the pinned ones therefore lands it just after them, which is the closest place
 * to the one aimed at.
 *
 * The partition is stable: within each group the order is exactly the one just
 * chosen.
 */
export function moveNote<T extends Pick<Note, 'is_pinned'>>(
  notes: T[],
  from: number,
  to: number,
): T[] {
  if (from === to || from < 0 || from >= notes.length) return notes
  const bounded = Math.max(0, Math.min(notes.length - 1, to))

  const moved = [...notes]
  const [note] = moved.splice(from, 1)
  moved.splice(bounded, 0, note)

  return [...moved.filter((n) => n.is_pinned), ...moved.filter((n) => !n.is_pinned)]
}

/**
 * Normalisation for search. Folding accents is not a detail in French: searching
 * for "cafe" has to find "café", and "ecole" has to find "école".
 */
export function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Client-side search, and that is a choice, not a fallback.
 *
 * The plan was to query `search_vector` on the Postgres side. But every visible
 * note is already in the cache, so a server query would add a network round trip
 * for an identical result, only worse: it would fail offline and add latency to
 * every keystroke.
 *
 * The migration's GIN index is not useless for all that. It becomes necessary
 * the day the corpus outgrows what can be held in cache and the list is
 * paginated. On that day this function becomes the offline fallback, and the
 * server query moves in front.
 *
 * Search covers the title, the body, checklist items and tag names: searching
 * "courses" has to find the list even when the word is only in its title, and
 * searching "maison" has to find the notes carrying that tag.
 */
export function matchesSearch(note: NoteWithRelations, foldedNeedle: string): boolean {
  if (foldedNeedle.length === 0) return true
  const haystack = [
    note.title ?? '',
    // On the text without its markup: searching "liste de courses" no longer
    // found the note where only "courses" had been made bold, the haystack
    // holding "liste de **courses**". Formatting must hide nothing.
    plainText(note.body),
    note.code_name ?? '',
    ...note.items.map((i) => plainText(i.content)),
    ...note.tags.map((t) => t.name),
  ].join(' ')
  return fold(haystack).includes(foldedNeedle)
}

/**
 * A note is empty when it carries no trace of intent: no title, no body, no
 * checklist item, no tag, no colour.
 *
 * Colour, tags and the code name count deliberately. A note with no text but
 * tinted fjord has been touched on purpose; discarding it would be losing work.
 * The same goes for a note filed in the vault under a name: filing it is an
 * intent, and erasing it on the way out of the editor would destroy an explicit
 * gesture.
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
 * A note's content, as text to paste into a message.
 *
 * What is copied is what someone would want to send, not a faithful export:
 *
 * - the title stays out. Copying aims at a conversation where you have already
 *   said what this is about;
 * - a checklist loses its checkboxes — there is nothing sensible to paste — and
 *   its ticked items. A list is shared to say what is left to do, and the six
 *   things already bought are noise in the message;
 * - the line breaks stay, blank lines included. A shopping list that arrives as
 *   one long line is no longer a list.
 *
 * An empty string when there is nothing to copy, and the caller has to honour
 * it: silently replacing what the user had in their clipboard with nothing is
 * the one outcome worse than doing nothing.
 */
export function copyableText(note: {
  kind: NoteKind
  body: string | null
  items: { content: string; is_done: boolean }[]
}): string {
  if (note.kind === 'checklist') {
    return note.items
      .filter((item) => !item.is_done)
      // Item by item, and never on the joined text: the dashes are ours, and
      // running them through the flattener alongside the content invited it to
      // read them back as list syntax. The same reason as in the widget
      // snapshot, which joins its items the same way.
      //
      // Whitespace is collapsed because an item is one line: the editor turns a
      // pasted line break into a space, but rows written before it did keep
      // theirs, and one of them would split the list in two.
      .map((item) => flatLine(item.content).replace(/\s+/g, ' ').trim())
      // An item left blank produces a lone dash, which says nothing.
      .filter((text) => text.length > 0)
      .map((text) => `- ${text}`)
      .join('\n')
  }
  return flatText(note.body).trim()
}

/**
 * What shows in place of the title everywhere the note is listed: grid, vault,
 * notifications, widget.
 *
 * A vault note shows its code name, and nothing else. With no code name it does
 * not fall back to its title: that would be exactly the leak the vault is meant
 * to prevent, and it would go unnoticed since the title would display normally.
 * The fallback is therefore silent.
 *
 * The title stays in the clear in the database and in the editor, once the vault
 * is open. This is screen masking, not encryption.
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
 * The colour a note takes on receiving a tag, or `null` when nothing should
 * change.
 *
 * A tag has a colour, so does a note, and until now the two did not speak: you
 * put a "courses" tag in fjord on a note and the card stayed grey, so you had to
 * go and repaint the note by hand with the shade you had just picked right next
 * to it. The tag's colour is already a decision; it may as well be used.
 *
 * ── What the rule does not do, and that is the important part ────────────────
 * It never repaints a note that already has a colour. A colour set by hand is an
 * explicit choice, and a tag added afterwards has no business overwriting it:
 * that would lose one intent in order to guess another. Hence the name — this is
 * inheritance, not synchronisation.
 *
 * Removing a tag undoes nothing either. The colour has become the note's, and
 * taking it back when the tag goes would remove a visible state from the grid
 * with nobody having asked for it.
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
 * What has to be written into `color_key` after a change of tags.
 *
 * Three possible answers, and the distinction matters: `undefined` means "write
 * nothing", `null` means "clear the colour". Confusing the two would repaint or
 * drain notes on every gesture.
 *
 * ── What this adds to `inheritedColor` ───────────────────────────────────────
 * Inheritance never repaints a note that already has a colour, which is right as
 * long as you are only adding tags. But changing tag means removing one and
 * putting another: the note then kept the old one's shade, indefinitely. You
 * changed category and the card carried on showing the previous one's colour,
 * which reads as a change that did not take.
 *
 * Hence the notion of an orphaned colour: the one a tag you have just removed
 * was carrying, and that no remaining tag carries. It is taken over by the tag
 * that replaces it, or cleared when there is none.
 *
 * This reverses what the previous comment claimed — that a removal should undo
 * nothing. That argument held for a colour picked by hand; it does not hold for
 * a colour the tag had put there itself, and that nobody asked to keep. The
 * coincidence remains possible: a hand-picked shade that happens to be exactly
 * the removed tag's will be released. That is the only ambiguous case, it is
 * rare, and it is one tap to undo — where the old behaviour left a note stuck on
 * the colour of a category it no longer has.
 */
export function colorAfterTagChange(
  note: Pick<Note, 'color_key'>,
  before: TagRef[],
  after: TagRef[],
): TagColorKey | null | undefined {
  const added = after.find((tag) => !before.some((b) => b.id === tag.id))

  // A note with no shade takes the one of the tag being put on it. Nothing else
  // to decide: there is no colour to preserve, and none to release.
  if (note.color_key === null) return inheritedColor(note, added) ?? undefined

  const orpheline =
    before.some((tag) => tag.color_key === note.color_key && !after.some((a) => a.id === tag.id)) &&
    !after.some((tag) => tag.color_key === note.color_key)

  if (!orpheline) return undefined
  return added ? added.color_key : null
}

/**
 * The tag already named this, or `undefined`.
 *
 * The comparison folds accents and case, whereas the database's
 * `unique (user_id, name)` constraint tells "École" from "ecole". The gap is
 * deliberate: the database prevents two identical rows, this function prevents
 * two tags nobody could tell apart at a glance in a row of coloured dots. The
 * second problem is the real one, and it arrives far sooner.
 */
export function findTagNamed<T extends Pick<Tag, 'name'>>(
  tags: T[],
  name: string,
): T | undefined {
  const needle = fold(name.trim())
  return tags.find((tag) => fold(tag.name) === needle)
}

/**
 * The shade to offer for one more tag: the least-used one in the palette, the
 * first declared on a tie.
 *
 * Creating tags on the fly from a note, without going through the Tags screen
 * where the colour is chosen, would otherwise give ten dots in the same shade —
 * and a coloured dot that distinguishes nothing is of no use.
 *
 * The palette keys are passed in rather than imported: this module depends on
 * the interface only at the type level, erased at compile time, and a value
 * import would create a runtime link from the database side to the UI, in the
 * wrong direction.
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

/** Conjunctive filter: the note must carry every selected tag. */
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
    .sort(byPinThenOrder)
}

/**
 * Distributes cards into free-height columns, Google Keep style.
 *
 * Each card goes into whichever column is shortest at that moment. On a tie the
 * leftmost wins, so that reading order stays predictable.
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
