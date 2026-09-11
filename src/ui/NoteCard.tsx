import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { displayTitle, isEmptyNote } from '@/db/noteLogic'
import type { NoteWithRelations } from '@/db/select'
import { plainText } from '@/text/markup'
import { useTheme } from './ThemeProvider'
import { RichText } from './RichText'
import { Txt } from './components'
import { Tooltip } from './Tooltip'
import { radius, space } from './theme'

/**
 * A note or list card in the grid.
 *
 * On note colour, a deliberate departure from Google Keep. Keep paints the whole
 * card background. Impossible here: the tag palette is made of mid-value hues,
 * calibrated for chips and borders at 3:1, not for carrying text on top. Using
 * them as a background would drop text contrast below the thresholds the rest
 * of the theme meets.
 *
 * So the colour goes through the border and a vertical vein on the left edge.
 * It is also truer to the language of stone, a seam in the rock rather than a
 * tinted block, and the text stays on the neutral stratum.
 */

const PREVIEW_ITEMS = 5

export function NoteCard({
  note,
  onPress,
  onTogglePin,
  onLongPress,
  selectionMode = false,
  selected = false,
  reserveHandle = false,
}: {
  note: NoteWithRelations
  /** Opens the note, or toggles its selection if selection mode is on. */
  onPress: () => void
  onTogglePin: () => void
  /** Entering selection mode. */
  onLongPress?: () => void
  selectionMode?: boolean
  selected?: boolean
  /**
   * Leaves room for a drag handle at the top left.
   *
   * The handle is placed by the grid, which does not know the cards' content:
   * without this reserve, it would sit on the title. So the card is what makes
   * the margin, as it already does on the right for the pin button.
   */
  reserveHandle?: boolean
}) {
  const { theme, tagColor } = useTheme()
  const vein = note.color_key ? tagColor(note.color_key) : null

  // A vault note shows its code name, never its title. A vault note without a
  // code name shows nothing: it is the only fallback that does not leak what
  // the vault is meant to hide.
  const heading = displayTitle(note)
  const empty = isEmptyNote(note)

  /**
   * A vault note that has asked to keep its content off its card.
   *
   * Nothing of what the note says is drawn below the heading: no preview, no
   * items, not even how many are ticked, since a count is one more thing read
   * over a shoulder. Tags stay — they are how the grid is filtered and coloured,
   * they are chosen to be seen, and dropping them would leave a card with
   * nothing to hold on to.
   *
   * Only the display is held back. The text is loaded, searched and edited as
   * ever; this is the code name's kind of secrecy, not the ciphertext's.
   */
  const hidden = note.hide_content

  /**
   * What stands in for the title when there is none.
   *
   * A note whose content is masked and which carries no code name would have
   * nothing at all to draw: a sliver the height of its padding, exactly like an
   * empty note, while being full. The marker says which of the two it is.
   */
  const placeholder = empty
    ? note.kind === 'checklist'
      ? 'Liste vide'
      : 'Note vide'
    : hidden
      ? 'Contenu masqué'
      : null
  const shown = note.items.slice(0, PREVIEW_ITEMS)
  const remaining = note.items.length - shown.length
  const doneCount = note.items.filter((i) => i.is_done).length

  /**
   * The container is a View, not a Pressable, and the pin button is a sibling
   * of the clickable body rather than its child.
   *
   * It is not a styling detail: react-native-web renders every Pressable as a
   * `<button>`, and a button nested inside a button is invalid HTML that breaks
   * the PWA's hydration. Two overlapping siblings give the same gesture without
   * the defect.
   */
  return (
    <View
      style={{
        borderRadius: radius.lg,
        // A selected card takes the accent, even when it already carries a
        // coloured vein: the selection state must win over decoration.
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.accent.default : (vein ?? theme.line.hairline),
        // Overflow hidden so the vein is clipped by the corner radius.
        overflow: 'hidden',
      }}
    >
      {vein ? (
        <View
          // Decorative: the colour is already carried by the border, and a
          // screen reader has nothing to announce here.
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: vein, zIndex: 1 }}
        />
      ) : null}

      <Pressable
        accessibilityRole={selectionMode ? 'checkbox' : 'button'}
        accessibilityLabel={heading ?? placeholder ?? 'Note sans titre'}
        accessibilityState={selectionMode ? { checked: selected } : undefined}
        onPress={onPress}
        onLongPress={onLongPress}
        // Long enough not to fire on a scroll, short enough not to feel like
        // nothing is happening.
        delayLongPress={350}
        style={({ pressed }) => ({
          backgroundColor: selected
            ? theme.accent.subtle
            : pressed
              ? theme.surface.raised
              : theme.surface.card,
          padding: space.md,
          // Reserves room for the two controls floating over the card: the drag
          // handle on the left, the pin on the right.
          paddingLeft: (vein ? space.md + 4 : space.md) + (reserveHandle ? 26 : 0),
          paddingRight: space.md + 28,
          gap: space.sm,
        })}
      >
        <View style={{ gap: space.xxs }}>
          {heading ? (
            <Txt variant="title" numberOfLines={2}>
              {heading}
            </Txt>
          ) : placeholder ? (
            /**
             * Without this marker, a note with no content at all shrinks to a
             * sliver the height of its padding, where the pin icon even sticks
             * out past the edge. The editor normally discards notes left empty
             * on the way out, but an empty note can arrive from another device
             * or an interrupted session: it must stay readable and clickable.
             */
            <Txt variant="title" tone="muted">
              {placeholder}
            </Txt>
          ) : null}
          {!hidden && note.kind === 'checklist' && note.items.length > 0 ? (
            <Txt variant="caption" tone="muted">
              {doneCount} sur {note.items.length}
            </Txt>
          ) : null}
        </View>

        {/**
         * The preview is rendered formatted, but its links do not open.
         *
         * It is not an oversight: the card is itself a `Pressable`, which
         * react-native-web renders as a `<button>`. A clickable link inside
         * would be an anchor in a button, invalid HTML that breaks the PWA's
         * hydration — exactly the pitfall documented above on the pin button.
         * Touching the card opens the note, where the link opens.
         */}
        {!hidden && note.kind === 'note' && note.body ? (
          <RichText source={note.body} numberOfLines={8} tone="secondary" />
        ) : null}

        {!hidden && note.kind === 'checklist' ? (
          <View style={{ gap: space.xs }}>
            {shown.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {/* Not interactive in the grid, on purpose: ticking here would
                    be confused with opening the note. */}
                <View
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    borderWidth: 1,
                    borderColor: item.is_done ? theme.accent.default : theme.line.strong,
                    backgroundColor: item.is_done ? theme.accent.default : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.is_done ? (
                    <Feather name="check" size={9} color={theme.text.onAccent} />
                  ) : null}
                </View>
                <RichText
                  source={item.content}
                  numberOfLines={1}
                  tone={item.is_done ? 'muted' : 'secondary'}
                  style={[{ flex: 1 }, item.is_done ? { textDecorationLine: 'line-through' } : null]}
                />
              </View>
            ))}
            {remaining > 0 ? (
              <Txt variant="caption" tone="muted">
                et {remaining} de plus
              </Txt>
            ) : null}
          </View>
        ) : null}

        {note.tags.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xxs }}>
            {note.tags.map((tag) => (
              <View key={tag.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 3.5,
                    backgroundColor: tagColor(tag.color_key),
                  }}
                />
                <Txt variant="caption" tone="muted">
                  {tag.name}
                </Txt>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>

      {/**
       * In selection mode, the selection dot replaces the pin button. Two
       * reasons: pinning is then done from the action bar on the whole
       * selection, and an active button in the middle of cards turned into
       * checkboxes would be ambiguous. It is a mere marker, not a Pressable, the
       * whole card already being the target.
       */}
      {selectionMode ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            top: space.sm,
            right: space.sm,
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: selected ? 0 : 1,
            borderColor: theme.line.strong,
            backgroundColor: selected ? theme.accent.default : theme.surface.recessed,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
          }}
        >
          {selected ? <Feather name="check" size={14} color={theme.text.onAccent} /> : null}
        </View>
      ) : (
        /* A sibling of the body, not a child: see the comment on the container.
           The tooltip wrapper is what carries the placement, the button merely
           filling the cell it is given. */
        <Tooltip
          label={note.is_pinned ? 'Désépingler' : 'Épingler'}
          style={{ position: 'absolute', top: space.sm, right: space.sm, zIndex: 2 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={note.is_pinned ? 'Désépingler' : 'Épingler'}
            accessibilityState={{ selected: note.is_pinned }}
            onPress={onTogglePin}
            // A discreet glyph, a touch area widened by hitSlop: the gesture
            // stays comfortable without weighing the card down visually.
            hitSlop={space.md}
            style={{
              width: 32,
              height: 32,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather
              name="bookmark"
              size={16}
              color={note.is_pinned ? theme.accent.default : theme.text.muted}
            />
          </Pressable>
        </Tooltip>
      )}
    </View>
  )
}

/**
 * Approximate height of a card, in arbitrary units. Only used to distribute the
 * cards across the grid's columns.
 *
 * A real measurement would take a two-pass render and make the grid flicker on
 * load. An estimate is enough: the error shows up as slightly uneven columns,
 * which is of no consequence.
 */
export function estimateCardHeight(note: NoteWithRelations): number {
  const heading = displayTitle(note)
  let height = 40
  // The « Note vide » — or « Contenu masqué » — marker takes the room of a
  // one-line title.
  if (!heading && (isEmptyNote(note) || note.hide_content)) height += 24
  if (heading) height += Math.min(2, Math.ceil(heading.length / 24)) * 24
  // Masked content is not drawn: counting it would give the grid a column of
  // holes, the card taking the room of text it does not show.
  if (!note.hide_content) {
    if (note.kind === 'note' && note.body) {
      // On the text without its markup: `**bold**` counts four characters too
      // many, and a heavily marked-up note thought itself twice as tall as it
      // is, which unbalanced the grid's columns.
      height += Math.min(8, Math.ceil(plainText(note.body).length / 32)) * 24
    }
    if (note.kind === 'checklist') {
      height += Math.min(PREVIEW_ITEMS, note.items.length) * 24
      if (note.items.length > PREVIEW_ITEMS) height += 16
      if (note.items.length > 0) height += 16
    }
  }
  if (note.tags.length > 0) height += 20
  return height
}
