import type { NoteWithRelations } from '../db/noteLogic'
import { byPinThenOrder, displayTitle } from '../db/noteLogic'
import { plainText } from '../text/markup'
import type { Tag } from '../db/types'
import type { TagColorKey } from '../ui/theme'

/**
 * Snapshot of the notes, for the Android widget.
 *
 * ── Why a snapshot, and not a query ──────────────────────────────────────────
 * The widget lives outside the app: it is a system process, woken by the
 * launcher, with no Supabase session and often no network. It cannot go and
 * fetch the notes itself, and handing it a token so it could try would be both
 * complicated and unwise.
 *
 * So the app writes down what it knows, every time the list changes. The widget
 * reads a local file and has nothing left to ask anyone: it shows up instantly,
 * offline as well as online.
 *
 * ── What does not go in ──────────────────────────────────────────────────────
 * Nothing from the vault, unless explicitly enabled — and even then, only the
 * code name. The body of a hidden note never leaves, whatever the setting: the
 * snapshot is a plaintext file in the app's preferences, and the vault exists
 * precisely so that its contents do not sit somewhere like that.
 *
 * Archived notes and the trash stay out too: the widget shows what you are
 * working on, not what you have filed away.
 */

export type WidgetNote = {
  id: string
  /** Code name for a vault note, title otherwise. May be empty. */
  title: string
  /** Preview, already stripped of its markup. Empty for a vault note. */
  preview: string
  /** Palette key, or an empty string. The widget resolves it to a colour. */
  color: TagColorKey | ''
  /** True for a checklist, so the widget can show the right glyph. */
  checklist: boolean
  pinned: boolean
  tagIds: string[]
}

export type WidgetTag = { id: string; name: string; color: TagColorKey }

export type WidgetSnapshot = {
  /** Bumped whenever the shape changes, so the native side knows how to read. */
  version: 1
  notes: WidgetNote[]
  tags: WidgetTag[]
  /** Write timestamp, displayed nowhere: it is there for diagnosis. */
  writtenAt: string
}

/** Beyond this, the widget's list becomes a heavy file for no gain. */
const MAX_NOTES = 60

/**
 * Body preview length, in characters.
 *
 * Generous rather than tuned: how many lines the widget can actually give a row
 * depends on its height and on how many notes survive the filter, and only the
 * widget knows that. This cap is here so a long note does not carry its whole
 * body into the preferences file — it is not what decides what you see.
 */
const PREVIEW = 600

/**
 * Checklist items carried, at most.
 *
 * Counted in items and not in characters, so the widget always receives whole
 * lines: cutting at 120 characters used to hand it half an item, which it then
 * had no way to tidy up. Matches the ceiling the row layout allows.
 */
const PREVIEW_ITEMS = 12

export function buildSnapshot(
  notes: NoteWithRelations[],
  tags: Tag[],
  options: { showPrivate: boolean; now?: Date },
): WidgetSnapshot {
  const visible = notes
    .filter((note) => {
      if (note.deleted_at !== null || note.is_archived) return false
      if (note.is_private) return options.showPrivate
      return true
    })
    .sort(byPinThenOrder)
    .slice(0, MAX_NOTES)

  return {
    version: 1,
    writtenAt: (options.now ?? new Date()).toISOString(),
    notes: visible.map((note) => ({
      id: note.id,
      title: displayTitle(note) ?? '',
      /**
       * A vault note has no preview, even when you have chosen to show it. The
       * setting says "I want to know it is there", not "I want its contents on
       * my phone's home screen".
       */
      preview: note.is_private ? '' : previewOf(note),
      color: note.color_key ?? '',
      checklist: note.kind === 'checklist',
      pinned: note.is_pinned,
      tagIds: note.tags.map((t) => t.id),
    })),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color_key })),
  }
}

/**
 * A note's preview: its body, or its first items when it is a checklist. Without
 * markup — `**bold**` would show literally in a `RemoteViews`, which has no idea
 * what an asterisk is.
 */
function previewOf(note: NoteWithRelations): string {
  if (note.kind === 'checklist') {
    // Item by item rather than on the joined block: the bullets are ours, and
    // running them through the markup stripper alongside the text invited it to
    // read them as list syntax of its own.
    return note.items
      .slice(0, PREVIEW_ITEMS)
      .map((item) => `• ${plainText(item.content).trim()}`)
      .join('\n')
  }

  const text = plainText(note.body ?? '').trim()
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW).trimEnd()}…` : text
}
