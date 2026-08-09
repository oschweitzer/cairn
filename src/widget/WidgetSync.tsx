import { useEffect, useRef } from 'react'
import { useNoteList, usePrivateNoteList } from '@/db/select'
import { useProfile, useTags } from '@/db/queries'
import {
  placedWidgetCount,
  setWidgetSnapshot,
  widgetAvailable,
} from '../../modules/cairn-widget'
import { buildSnapshot } from './snapshot'

/**
 * Keeps the widget's snapshot up to date.
 *
 * Nothing on screen: this component exists for its effect. It is mounted high in
 * the tree, above the tabs, so the snapshot follows the notes whatever screen is
 * open — ticking a box from the editor has to show on the phone's home screen,
 * not only after going back through the grid.
 *
 * ── What triggers a write ────────────────────────────────────────────────────
 * The content, and nothing else. The composed lists get a new identity on every
 * render — they are rebuilt arrays — so comparing them by reference would write
 * on every keystroke. We compare the JSON instead, which has the advantage of
 * being exactly what goes into the preference store: two identical snapshots
 * cause no write, and no wake-up for the launcher.
 *
 * Nothing is written either when no widget is placed. Serialising notes into a
 * file nobody will read has no upside, and copying their content out of the
 * database for nothing has a downside.
 */
export function WidgetSync() {
  const { all: notes } = useNoteList()
  const { all: hidden } = usePrivateNoteList()
  const tagsQuery = useTags()
  const profileQuery = useProfile()

  /**
   * The vault is excluded by default, including while the profile has yet to
   * answer. The default of a privacy setting is the closed one: a fraction of a
   * second spent writing code names into a preferences file would be enough to
   * leave them there.
   */
  const showPrivate = profileQuery.data?.widget_show_private ?? false

  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    if (!widgetAvailable || placedWidgetCount() === 0) return

    const snapshot = buildSnapshot(
      showPrivate ? [...notes, ...hidden] : notes,
      tagsQuery.data ?? [],
      { showPrivate },
    )

    /**
     * The timestamp is taken out of the comparison, otherwise there would be no
     * comparison at all: it changes on every build, and two snapshots with
     * identical content would look different. It stays in what gets written,
     * where it tells you when the app last spoke to the widget.
     */
    const signature = JSON.stringify({ ...snapshot, writtenAt: null })
    if (signature === lastWritten.current) return

    lastWritten.current = signature
    setWidgetSnapshot(snapshot)
  }, [notes, hidden, tagsQuery.data, showPrivate])

  return null
}
