/**
 * Text formatting for notes, and link detection.
 *
 * ── Why markup inside the text, and not columns ──────────────────────────────
 * A note's body and a checklist item's content are `text` columns, and they stay
 * that way. This is not a migration we are dodging: it is what keeps everything
 * else intact.
 *
 * The vault encrypts one string, exactly one, per note — a structured document
 * would mean reopening the sealed format. Postgres full-text search indexes
 * `title || body`. The Google Calendar export copies the body into an event
 * description. And the day something displays this text without rendering it —
 * an export, a notification, a backup — `**bold**` still reads, where a JSON
 * array of spans would not.
 *
 * Hence a syntax people already know rather than one we invent.
 *
 * ── The syntax ───────────────────────────────────────────────────────────────
 *
 *   **bold**        *italic*          ~~struck~~       __underlined__
 *   # heading       ## subheading     - bullet item
 *   [label](https://example.com)      and any URL written mid-sentence
 *
 * `__` is a deliberate departure from CommonMark, where it means bold. Markdown
 * has no underline, so a mark had to be taken from somewhere, and a double
 * underscore looks like what it produces. Bold keeps `**`, which is the form
 * people actually type.
 *
 * ── Why this module knows nothing of React or react-native ───────────────────
 * It returns a structure, not components. That is what lets it be tested under
 * Node by `npm run test:logic`, and that is where the mistakes that matter live:
 * a URL cut at the wrong character, a stray `*` swallowing the rest of a line, a
 * search that no longer finds a word once it has been made bold.
 */

export type Marks = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

/** A run of text with uniform styling. `href` turns it into a link. */
export type Span = Marks & {
  text: string
  href?: string
}

export type Block = {
  kind: 'paragraph' | 'bullet'
  /** 0 body, 1 heading, 2 subheading. Always 0 on a bullet. */
  level: 0 | 1 | 2
  spans: Span[]
}

/**
 * Emphasis marks, in the order they are tried.
 *
 * The order is not decorative: on `**bold**`, the italic rule also matches at
 * position zero — a `*`, some text, a `*` — and would capture `*bold`. On a tie,
 * the first one declared wins, so bold has to come before italic.
 */
const EMPHASES: { open: string; close: string; mark: keyof Marks }[] = [
  { open: '**', close: '**', mark: 'bold' },
  { open: '~~', close: '~~', mark: 'strike' },
  { open: '__', close: '__', mark: 'underline' },
  { open: '*', close: '*', mark: 'italic' },
]

/**
 * A named link. The label stops at the first closing bracket, the address at the
 * first closing parenthesis: nobody hand-writes a link containing either, and a
 * permissive expression would cost far more here than it earns.
 */
const NAMED_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|www\.[^\s)]+)\)/

/**
 * A URL written mid-sentence.
 *
 * `www.` without a protocol is recognised: that is what people paste, and
 * refusing it would leave half the links inert. The final character class
 * excludes ordinary punctuation so that "see https://example.com." does not make
 * the full stop part of the address — a classic mistake, and invisible until the
 * day the link fails to open.
 */
const BARE_LINK = /(?:https?:\/\/|www\.)[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/

/** Completes an address written without a protocol. */
export function normalizeHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

type Found = {
  index: number
  length: number
  /** Content to parse in turn, with the mark added. */
  inner: string
  marks: Marks
  href?: string
  /**
   * Text to display as-is, without being parsed again. Used by bare links: the
   * dots and slashes of an address are not markup, and `www.example.com` must
   * stay written that way even though the link points at
   * `https://www.example.com`.
   */
  literal?: string
}

/** The first mark found in the line, or `null` when there are none left. */
function findNext(line: string): Found | null {
  let best: Found | null = null

  const consider = (candidate: Found) => {
    // Strictly earlier: on a tie the mark already held wins, which is what makes
    // the declaration order above take effect.
    if (!best || candidate.index < best.index) best = candidate
  }

  const named = NAMED_LINK.exec(line)
  if (named) {
    consider({
      index: named.index,
      length: named[0].length,
      inner: named[1],
      marks: {},
      href: normalizeHref(named[2]),
    })
  }

  // A named link starts with `[`, a bare one with `h` or `w`: the two cannot
  // begin at the same place, so there is nothing to arbitrate between them.
  const bare = BARE_LINK.exec(line)
  if (bare) {
    consider({
      index: bare.index,
      length: bare[0].length,
      inner: '',
      literal: bare[0],
      marks: {},
      href: normalizeHref(bare[0]),
    })
  }

  for (const { open, close, mark } of EMPHASES) {
    const start = line.indexOf(open)
    if (start === -1) continue
    const from = start + open.length
    let end = line.indexOf(close, from)
    // At least one character is needed between the two marks: `****` is not
    // empty bold, it is text.
    if (end === -1 || end === from) continue

    /**
     * For a two-character mark, the closing one is taken at the end of the run
     * of marks, not at its start.
     *
     * `**bold and *italic***` ends on three asterisks: the first closes the
     * inner italic, the next two the bold. A naive search took the first two,
     * left the italic open, and rendered the third asterisk literally on screen.
     */
    if (close.length === 2) {
      while (line[end + 2] === close[0]) end++
    }

    consider({
      index: start,
      length: end + close.length - start,
      inner: line.slice(from, end),
      marks: { [mark]: true },
    })
  }

  return best
}

/** Splits a line into uniformly styled runs. */
export function parseInline(line: string, inherited: Marks = {}): Span[] {
  const spans: Span[] = []
  let rest = line

  while (rest.length > 0) {
    const found = findNext(rest)
    if (!found) break

    if (found.index > 0) {
      spans.push({ ...inherited, text: rest.slice(0, found.index) })
    }

    if (found.href) {
      // The label can be styled, the address cannot. Every run coming out of the
      // label carries the address: that is what keeps the whole link clickable
      // when only part of it is bold.
      const label = found.literal
        ? [{ text: found.literal }]
        : parseInline(found.inner, inherited)
      for (const span of label) {
        spans.push({ ...inherited, ...span, href: found.href })
      }
    } else {
      spans.push(...parseInline(found.inner, { ...inherited, ...found.marks }))
    }

    rest = rest.slice(found.index + found.length)
  }

  if (rest.length > 0) spans.push({ ...inherited, text: rest })
  return spans
}

/**
 * Splits text into blocks.
 *
 * Blank lines are kept as empty paragraphs: they carry the spacing whoever wrote
 * the note wanted, and swallowing them would tighten the text on screen with
 * nothing to explain why.
 */
export function parseMarkup(source: string | null | undefined): Block[] {
  if (!source) return []

  return source.split('\n').map((raw): Block => {
    if (raw.startsWith('## ')) {
      return { kind: 'paragraph', level: 2, spans: parseInline(raw.slice(3)) }
    }
    if (raw.startsWith('# ')) {
      return { kind: 'paragraph', level: 1, spans: parseInline(raw.slice(2)) }
    }
    // The bullet character is accepted on input because that is what the display
    // produces: copying a bullet out of a rendered note has to work.
    if (raw.startsWith('- ') || raw.startsWith('• ')) {
      return { kind: 'bullet', level: 0, spans: parseInline(raw.slice(2)) }
    }
    return { kind: 'paragraph', level: 0, spans: parseInline(raw) }
  })
}

/**
 * The text without its markup.
 *
 * Used by search, by height estimates, and by anything that counts characters.
 * Without it, searching for "courses" no longer found a note where the word had
 * been made bold: the haystack held `**courses**`, which happens to work, but
 * "liste de courses" written `liste de **courses**` was not found at all.
 */
export function plainText(source: string | null | undefined): string {
  return parseMarkup(source)
    .map((block) => {
      const text = block.spans.map((span) => span.text).join('')
      return block.kind === 'bullet' ? `• ${text}` : text
    })
    .join('\n')
}

// --------------------------------------------------------------- editing

export type Format = 'bold' | 'italic' | 'underline' | 'strike' | 'bullet' | 'title' | 'subtitle'

export type Selection = { start: number; end: number }

/** The result of a formatting command: the new text, and where the caret goes. */
export type Edit = { text: string; selection: Selection }

const WRAPPERS: Record<'bold' | 'italic' | 'underline' | 'strike', string> = {
  bold: '**',
  italic: '*',
  underline: '__',
  strike: '~~',
}

const PREFIXES: Record<'bullet' | 'title' | 'subtitle', string> = {
  bullet: '- ',
  title: '# ',
  subtitle: '## ',
}

/** Bounds of the line containing `position`. */
function lineBounds(text: string, position: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const end = text.indexOf('\n', position)
  return { start, end: end === -1 ? text.length : end }
}

/**
 * Widens an empty selection to the word under the caret.
 *
 * Without this, pressing "bold" with nothing selected put two pairs of asterisks
 * around nothing — the most natural gesture of all, type a word then make it
 * bold, did not work.
 */
function widenToWord(text: string, selection: Selection): Selection {
  if (selection.start !== selection.end) return selection
  const isWord = (c: string) => c !== undefined && /[^\s*_~[\]()]/.test(c)

  let start = selection.start
  let end = selection.end
  while (start > 0 && isWord(text[start - 1])) start--
  while (end < text.length && isWord(text[end])) end++
  return { start, end }
}

/**
 * Applies a formatting command.
 *
 * A pure function, deliberately: this is where off-by-one index mistakes hide,
 * the ones that shift the whole text by a character, and they are far easier to
 * test here than through a text field.
 *
 * Block commands — bullet, heading, subheading — toggle: pressing "heading"
 * again on a line that already is one brings it back to body text rather than
 * stacking hashes.
 */
export function applyFormat(text: string, selection: Selection, format: Format): Edit {
  if (format === 'bullet' || format === 'title' || format === 'subtitle') {
    const { start } = lineBounds(text, selection.start)
    const line = text.slice(start)
    const prefix = PREFIXES[format]

    // A line carries only one block mark: going from heading to bullet removes
    // the hash instead of prefixing an already-prefixed line.
    const existing = ['## ', '# ', '- ', '• '].find((p) => line.startsWith(p))
    const removed = existing ? existing.length : 0
    const toggling = existing === prefix

    const next =
      text.slice(0, start) + (toggling ? '' : prefix) + text.slice(start + removed)
    const shift = (toggling ? 0 : prefix.length) - removed
    return {
      text: next,
      selection: {
        start: Math.max(start, selection.start + shift),
        end: Math.max(start, selection.end + shift),
      },
    }
  }

  const wrapper = WRAPPERS[format]
  const target = widenToWord(text, selection)
  const before = text.slice(0, target.start)
  const inner = text.slice(target.start, target.end)
  const after = text.slice(target.end)

  // Remove the mark rather than doubling it when it is already there.
  if (before.endsWith(wrapper) && after.startsWith(wrapper)) {
    const next = before.slice(0, -wrapper.length) + inner + after.slice(wrapper.length)
    return {
      text: next,
      selection: {
        start: target.start - wrapper.length,
        end: target.end - wrapper.length,
      },
    }
  }

  const next = `${before}${wrapper}${inner}${wrapper}${after}`
  return {
    text: next,
    // The caret lands between the marks when there was nothing to wrap, so that
    // typing can carry straight on.
    selection: {
      start: target.start + wrapper.length,
      end: target.end + wrapper.length,
    },
  }
}

/**
 * Inserts a link, reusing the selection as its label.
 *
 * The address is left to fill in rather than asked for in a dialog: on a phone,
 * a modal prompt over the keyboard costs more than typing the address where it
 * is going to live.
 */
export function insertLink(text: string, selection: Selection): Edit {
  const target = widenToWord(text, selection)
  // French: this placeholder is written into the user's note.
  const label = text.slice(target.start, target.end) || 'libellé'
  const inserted = `[${label}]()`
  return {
    text: text.slice(0, target.start) + inserted + text.slice(target.end),
    // Caret between the parentheses, where the address has to be pasted.
    selection: {
      start: target.start + inserted.length - 1,
      end: target.start + inserted.length - 1,
    },
  }
}

/** A link found in the raw text, and the range it occupies there. */
export type FoundLink = {
  href: string
  /** Offsets into the raw text, marks included. */
  start: number
  end: number
}

/**
 * The link the caret sits in, or `null`.
 *
 * This is what lets an address be opened from the editing field, where a real
 * hyperlink cannot exist: `react-native-web` renders a multiline `TextInput` as
 * a `<textarea>`, which holds plain text and nothing else. So instead of making
 * the text clickable, we ask where the caret is and offer the address it stands
 * in.
 *
 * The scan walks the raw text rather than the parsed blocks, because the caret
 * is an offset into the raw text — marks and all. A named link is taken whole,
 * `[label](address)` from bracket to parenthesis: the caret inside the label is
 * inside the link, which is what someone clicking on the words expects.
 *
 * The end is inclusive. A caret just past the last character of an address is
 * still in it — that is where it lands when you click at the end of a word, and
 * refusing it there would read as the feature flickering.
 */
export function linkAt(text: string, caret: number): FoundLink | null {
  let at = 0

  while (at <= text.length) {
    const rest = text.slice(at)
    const named = NAMED_LINK.exec(rest)
    const bare = BARE_LINK.exec(rest)

    let found: { index: number; length: number; href: string } | null = null
    if (named) {
      found = { index: named.index, length: named[0].length, href: normalizeHref(named[2]) }
    }
    // A bare address also matches inside `[label](address)`, but always later
    // than the bracket, so the named link wins and the whole of it is skipped.
    if (bare && (!found || bare.index < found.index)) {
      found = { index: bare.index, length: bare[0].length, href: normalizeHref(bare[0]) }
    }
    if (!found) return null

    const start = at + found.index
    const end = start + found.length
    // Nothing between here and the next link, so the caret is in none of them.
    if (caret < start) return null
    if (caret <= end) return { href: found.href, start, end }
    at = end
  }

  return null
}
