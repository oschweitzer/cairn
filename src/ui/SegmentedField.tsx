import { Fragment, useRef, useState } from 'react'
import { TextInput, View, type TextStyle } from 'react-native'
import { Txt, noWebOutline } from './components'
import { useTheme } from './ThemeProvider'
import { radius, space, type } from './theme'
import {
  chiffres,
  completerSegments,
  composerSegments,
  separerSegments,
  type Segment,
} from './segments'

/**
 * Entering a punctuated value — a time, a date — part by part, the separator
 * being drawn between them rather than typed.
 *
 * ── Why not a single field ───────────────────────────────────────────────────
 * A single field expecting « HH:MM » or « JJ/MM/AAAA » holds up very well on a
 * full keyboard, and not at all on a phone: the numeric keypad offers neither
 * ":" nor "/". Deleting the separator once made the value impossible to rewrite
 * — the field stayed invalid, the send button greyed out, and the only way out
 * was to close the panel and start again from the suggestion. A separator that
 * cannot be typed must not have to be typed: the keyboard only has digits left
 * to provide.
 *
 * ── What comes out of here ───────────────────────────────────────────────────
 * The complete string, in its original format. The splitting only lives in
 * this component: `lireCreneau` keeps reading a single format, and its tests
 * with it.
 */
export function SegmentedField({
  label,
  value,
  onChangeText,
  segments,
  separateur,
}: {
  label: string
  value: string
  onChangeText: (valeur: string) => void
  segments: readonly Segment[]
  separateur: string
}) {
  const { theme } = useTheme()
  const [focused, setFocused] = useState(false)
  const refs = useRef<(TextInput | null)[]>([])

  const parts = separerSegments(value, separateur, segments)

  /**
   * The last value emitted, which leaving the field reads back instead of the
   * prop.
   *
   * Moving automatically from one part to the next shifts focus in the same
   * event as the keystroke: the `onBlur` of the part being left fires before the
   * new state has come back down, and a completion computed on the prop would
   * rewrite the value with the one from before the keystroke — typing "09" gave
   * "00".
   */
  const emis = useRef(value)
  emis.current = value

  const emettre = (prochain: string) => {
    emis.current = prochain
    onChangeText(prochain)
  }

  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="label" tone="secondary">
        {label}
      </Txt>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.surface.recessed,
          borderRadius: radius.md,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? theme.accent.default : theme.line.hairline,
          // Makes up for the border thickening on focus, as in `Field`.
          paddingHorizontal: focused ? space.sm - 1 : space.sm,
        }}
      >
        {segments.map((segment, i) => {
          const style: TextStyle = {
            // Room goes to the parts in proportion to what they hold: a year
            // takes four digits where a month takes two.
            flexGrow: segment.longueur,
            flexShrink: 1,
            flexBasis: 0,
            // On the web, an `input` claims the width of its `size` attribute
            // — twenty or so characters — and spilled out of the frame as soon
            // as the column narrowed, so on a phone. Yoga does not account for
            // it.
            minWidth: 0,
            minHeight: 48,
            textAlign: 'center',
            color: theme.text.primary,
            fontFamily: type.body.fontFamily,
            fontSize: type.body.fontSize,
          }

          return (
            // Parts and separators are siblings in the row: a separator shut in
            // with its part would skew the sharing of the width, which goes by
            // the number of digits.
            <Fragment key={segment.label}>
              {i > 0 ? <Txt tone="muted">{separateur}</Txt> : null}
              <TextInput
                ref={(node) => {
                  refs.current[i] = node
                }}
                accessibilityLabel={segment.label}
                value={parts[i]}
                onChangeText={(v) => {
                  const saisi = chiffres(v, segment.longueur)
                  emettre(
                    composerSegments(
                      parts.map((p, j) => (j === i ? saisi : p)),
                      separateur,
                      segments,
                    ),
                  )
                  // The part is full: typing carries on into the next one by
                  // itself, without having to aim at a field two digits wide.
                  if (saisi.length === segment.longueur) refs.current[i + 1]?.focus()
                }}
                onKeyPress={(e) => {
                  // Backspace on a part that is already empty: the key would do
                  // nothing, so it goes back to the previous one — the expected
                  // gesture when erasing to retype everything.
                  if (e.nativeEvent.key === 'Backspace' && parts[i] === '') {
                    refs.current[i - 1]?.focus()
                  }
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  setFocused(false)
                  emettre(completerSegments(emis.current, separateur, segments))
                }}
                placeholder={segment.placeholder}
                placeholderTextColor={theme.text.muted}
                inputMode="numeric"
                keyboardType="number-pad"
                maxLength={segment.longueur}
                // Touching a part selects it: you replace it by typing, rather
                // than erasing its digits before writing others.
                selectTextOnFocus
                style={[style, noWebOutline]}
              />
            </Fragment>
          )
        })}
      </View>
    </View>
  )
}
