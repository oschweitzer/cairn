import { useCallback, useState } from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from './ThemeProvider'
import { CAIRN, Rune, RuneRow, runeBox, type RuneName } from './runes'
import { radius, space, type, withAlpha } from './theme'

/**
 * Interface primitives. They carry the identity of the standing stone, while
 * the affordances stay conventional: a button looks like a button, a checkbox
 * ticks. Character comes through surfaces, colour, typography, motion and
 * engraving, never through cues that have to be guessed.
 */

// ---------------------------------------------------------- focus on the web

/**
 * Neutralises the browser's default focus ring, which is blue and clashes
 * completely with a cold stone palette.
 *
 * Only to be used with a replacement focus indicator, otherwise it is a plain
 * accessibility regression: keyboard navigation would become invisible. The
 * `useFocusRing` hook below provides that indicator.
 *
 * `outlineStyle` is a react-native-web-specific property, missing from the
 * React Native types, hence the cast.
 */
export const noWebOutline = (
  Platform.OS === 'web' ? { outlineStyle: 'none' } : {}
) as Record<string, never>

/**
 * Tracks a field's focus state and returns the handlers to plug into it. The
 * visual rendering of focus stays up to the caller, who knows whether to tint a
 * border, a background, or both.
 */
export function useFocusRing(props?: Pick<TextInputProps, 'onFocus' | 'onBlur'>) {
  const [focused, setFocused] = useState(false)
  const onFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    (e) => {
      setFocused(true)
      props?.onFocus?.(e)
    },
    [props],
  )
  const onBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    (e) => {
      setFocused(false)
      props?.onBlur?.(e)
    },
    [props],
  )
  return { focused, onFocus, onBlur }
}

// ------------------------------------------------------------------- hover

/**
 * Hover state, and the glow that goes with it.
 *
 * ── Why the web only ─────────────────────────────────────────────────────────
 * Hover does not exist for a finger. On mobile, `onHoverIn` never fires, and the
 * flag is locked to false so nothing depends on a gesture that will not come: a
 * button whose lit state is reachable only with a mouse must not be the only way
 * to understand the interface. The glow is a pointer comfort, never
 * information.
 *
 * ── Why a glow, in this app ──────────────────────────────────────────────────
 * The register is that of engraved stone. An engraving does not light up with a
 * coloured background, it catches the light: the aurora spreads around the
 * glyph, like a rune catching a ray. Hence a glow and not a flat fill, and hence
 * the accent rather than a grey — it is the theme's only living colour.
 */
export function useHover() {
  const [hovered, setHovered] = useState(false)
  const onHoverIn = useCallback(() => setHovered(true), [])
  const onHoverOut = useCallback(() => setHovered(false), [])
  return {
    hovered: Platform.OS === 'web' && hovered,
    hoverProps: { onHoverIn, onHoverOut },
  }
}

/**
 * Accent glow. `spread` in points, the diffusion following the target's size: a
 * 36-point chip and a 56-point button do not radiate the same way.
 */
export function glow(color: string, spread = 14): { boxShadow: string } {
  return { boxShadow: `0 0 ${spread}px ${Math.round(spread / 6)}px ${color}` }
}

// ------------------------------------------------------------------ screen

/**
 * Maximum reading width of a content column.
 *
 * Settings, sign-in and sign-up are columns: stacked cards, running text,
 * fields. Spread across a desktop screen, they gave two-hundred-character lines
 * and cards as wide as the window — the eye loses the start of the next line,
 * and the buttons float alone in the middle of their band.
 *
 * No platform condition: on a phone the window is narrower than this bound
 * anyway, so it changes nothing there. It is a responsive measure, not a fix for
 * the web — and it holds for a tablet too, where the problem is the same on a
 * smaller scale.
 *
 * The notes grid is not concerned: it answers width by adding columns, which is
 * the right answer for content that is browsed rather than read.
 */
const MEASURE = 720

export function Screen({
  children,
  scroll = false,
  style,
  ...rest
}: ViewProps & { scroll?: boolean }) {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const base = {
    flex: 1,
    backgroundColor: theme.surface.page,
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
  }

  // The column takes all the width on offer up to the bound, then centres.
  // The gap between children follows it: it lives on the column, not on the
  // container, otherwise it would apply to the column itself, an only child.
  const column = { width: '100%' as const, maxWidth: MEASURE, gap: space.md }

  if (scroll) {
    return (
      <View style={[base, style]} {...rest}>
        <ScrollView
          contentContainerStyle={{ padding: space.lg, alignItems: 'center' }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={column}>{children}</View>
        </ScrollView>
      </View>
    )
  }
  return (
    <View style={[base, { padding: space.lg, alignItems: 'center' }, style]} {...rest}>
      <View style={[column, { flex: 1 }]}>{children}</View>
    </View>
  )
}

// ------------------------------------------------------------------ strata

/**
 * A stone set on the page. The outline comes from the seam, not from a drop
 * shadow: the tint difference between strata does not exceed 1.20:1, so it is
 * the hairline that makes the card perceptible.
 */
export function Card({
  children,
  raised = false,
  recessed = false,
  style,
  ...rest
}: ViewProps & { raised?: boolean; recessed?: boolean }) {
  const { theme } = useTheme()
  const background = recessed
    ? theme.surface.recessed
    : raised
      ? theme.surface.raised
      : theme.surface.card
  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.line.hairline,
          padding: space.md,
          gap: space.sm,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  )
}

/**
 * Geological seam. Separates two strata without shutting them in a box.
 *
 * With `mark`, the seam breaks on an engraved rune, like a dividing line on a
 * stone. Purely ornamental: the separation stays readable if the rune cannot be
 * seen.
 */
export function Seam({ mark, style, ...rest }: ViewProps & { mark?: RuneName }) {
  const { theme } = useTheme()

  if (!mark) {
    return <View style={[{ height: 1, backgroundColor: theme.line.hairline }, style]} {...rest} />
  }

  const rule = { flex: 1, height: 1, backgroundColor: theme.line.hairline }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}
      {...rest}
    >
      <View style={rule} />
      <Rune name={mark} size={12} color={theme.line.strong} />
      <View style={rule} />
    </View>
  )
}

// --------------------------------------------------------------- typography

type Variant = keyof typeof type
type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'onAccent'

export function Txt({
  variant = 'body',
  tone = 'primary',
  style,
  children,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone }) {
  const { theme } = useTheme()
  const color =
    tone === 'accent'
      ? theme.accent.default
      : tone === 'danger'
        ? theme.state.danger
        : tone === 'onAccent'
          ? theme.text.onAccent
          : theme.text[tone]

  const styles = type[variant]
  return (
    <Text
      style={[
        {
          color,
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          lineHeight: styles.lineHeight,
          ...('letterSpacing' in styles ? { letterSpacing: styles.letterSpacing } : {}),
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  )
}

/** Section headings, in engraved capitals. */
export function Inscription({ children, style, ...rest }: TextProps) {
  return (
    <Txt variant="display" style={[{ textTransform: 'uppercase' }, style]} {...rest}>
      {children}
    </Txt>
  )
}

/**
 * Logotype: the name in capitals, doubled by its runic transliteration ᚲᚨᛁᚱᚾ.
 *
 * The runes sit under the word and not in its place. An unreadable logotype is a
 * failed logotype, and the screen reader as much as the visitor who does not
 * know the futhark must land on the written name. So the runic line is a
 * signature, not a riddle: it is hidden from accessibility, the word above
 * already carrying the information.
 */
/** Height of the logotype's runes. Their width follows from it, see `runeBox`. */
const LOGO_RUNE_SIZE = 11

/**
 * Fallback gap, until the first measurement.
 *
 * Computed on Viking at the current display size, so right from the first frame
 * in the ordinary case. It only matters if the measurement is late, and corrects
 * itself as soon as it arrives.
 */
const LOGO_RUNE_GAP = 18.4

export function Logotype({ style, ...rest }: ViewProps) {
  const { theme } = useTheme()

  /**
   * The runic line aligns with the word's real, measured width.
   *
   * It used to depend on a number worked out by hand — "CAIRN" measured 69
   * points in Grenze 21, hence a gap of 8 — with the warning that changing the
   * font would undo the fit. That is exactly what happened: Viking sets the same
   * word at 107 points, and the gap had to become 18.4.
   *
   * Rather than replace one magic number with another, the word is measured.
   * The fit now survives any change of font, size or letter spacing, and there
   * is no trap left to document.
   */
  const [width, setWidth] = useState(0)

  const runesInk = CAIRN.length * LOGO_RUNE_SIZE * (runeBox.width / runeBox.height)
  const gap = width > 0 ? Math.max(0, (width - runesInk) / (CAIRN.length - 1)) : LOGO_RUNE_GAP

  return (
    <View style={[{ gap: space.xxs }, style]} {...rest}>
      <Inscription
        onLayout={(e) => {
          const next = e.nativeEvent.layout.width
          setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next))
        }}
        // Otherwise the text takes the parent's full width, and that is the
        // width we would measure instead of the word's.
        style={{ alignSelf: 'flex-start' }}
      >
        Cairn
      </Inscription>
      <RuneRow
        runes={CAIRN}
        size={LOGO_RUNE_SIZE}
        // The muted grey made the line look dirty rather than discreet; at this
        // size it nearly vanished. The secondary grey sets it down without it
        // competing with the word.
        color={theme.text.secondary}
        gap={gap}
        // Otherwise the line stretches across the parent's full width and the
        // block can no longer be centred as a whole.
        style={{ alignSelf: 'flex-start' }}
      />
    </View>
  )
}

// ------------------------------------------------------------------ buttons

export function Button({
  label,
  variant = 'primary',
  busy = false,
  style,
  disabled,
  ...rest
}: PressableProps & { label: string; variant?: 'primary' | 'ghost' | 'danger'; busy?: boolean }) {
  const { theme } = useTheme()
  const { hovered, hoverProps } = useHover()
  const inert = disabled || busy
  const lit = hovered && !inert

  /**
   * The ghost is no longer quite transparent.
   *
   * A one-pixel outline on the page background reads badly, especially next to
   * a filled button: you had to look for it to know it was clickable. The raised
   * stratum gives it a body without giving it the accent, which stays reserved
   * for the main action. Danger keeps its neutral background: its red border and
   * text are what mark it out, a flat fill would make it look inviting.
   */
  const background =
    variant === 'primary'
      ? theme.accent.default
      : variant === 'danger'
        ? 'transparent'
        : theme.surface.raised
  const border =
    variant === 'primary'
      ? theme.accent.default
      : variant === 'danger'
        ? theme.state.danger
        : theme.line.strong

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inert), busy }}
      disabled={inert}
      {...hoverProps}
      style={({ pressed }) => [
        {
          // 48-point touch target, the recommended floor on Android.
          minHeight: 48,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: pressed && variant === 'primary' ? theme.accent.pressed : border,
          backgroundColor:
            pressed && variant === 'primary'
              ? theme.accent.pressed
              : pressed
                ? theme.accent.subtle
                : background,
          opacity: inert ? 0.55 : 1,
        },
        // The glow takes the colour of what the button commits to: the accent
        // for an ordinary action, red for a destruction. A reassuring glow on a
        // button that destroys would send the wrong message.
        lit
          ? glow(
              withAlpha(variant === 'danger' ? theme.state.danger : theme.accent.default, 0.35),
              18,
            )
          : null,
        style as object,
      ]}
      {...rest}
    >
      <Txt
        variant="label"
        tone={variant === 'primary' ? 'onAccent' : variant === 'danger' ? 'danger' : 'primary'}
      >
        {busy ? 'Un instant…' : label}
      </Txt>
    </Pressable>
  )
}

// -------------------------------------------------------------------- fields

/**
 * Carved into the rock: the field is darker than its surroundings in the dark
 * theme, darker than the snow in the light theme. The focus ring uses the
 * accent, which holds 3:1 on all four strata.
 */
export function Field({
  label,
  hint,
  error,
  style,
  ...rest
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { theme } = useTheme()
  const { focused, onFocus, onBlur } = useFocusRing(rest)

  const borderColor = error
    ? theme.state.danger
    : focused
      ? theme.accent.default
      : theme.line.hairline

  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="label" tone="secondary">
        {label}
      </Txt>
      <TextInput
        /**
         * The label is attached to the field, not merely set above it.
         *
         * It used to live in a neighbouring block, with no link to the input:
         * on screen you read « Adresse électronique », but a screen reader
         * announced an anonymous field, and automation could not find it by
         * name — it was in fact Playwright that revealed it, by tripping over
         * it. The hint follows, or the error message if there is one, which
         * wins: knowing what is wrong comes before knowing what was expected.
         *
         * The caller stays in charge: its own `accessibilityLabel` wins.
         */
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        {...(rest.accessibilityLabel ? { accessibilityLabel: rest.accessibilityLabel } : {})}
        style={[
          {
            minHeight: 48,
            backgroundColor: theme.surface.recessed,
            borderRadius: radius.md,
            borderWidth: focused ? 2 : 1,
            borderColor,
            paddingHorizontal: space.md,
            // Makes up for the border thickening on focus, otherwise the text
            // shifts by a pixel every time the field is entered.
            paddingVertical: focused ? space.sm - 1 : space.sm,
            color: theme.text.primary,
            fontFamily: type.body.fontFamily,
            fontSize: type.body.fontSize,
          },
          noWebOutline,
          style,
        ]}
        placeholderTextColor={theme.text.muted}
        {...rest}
        // After the spread, so our handlers are not overwritten: useFocusRing
        // already calls the ones passed in props.
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" tone="muted">
          {hint}
        </Txt>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------- tags

/**
 * A tag's colour dot. Non-textual, so audited at 3:1 on all four strata. The
 * tag's name stays written in text colour: on a tinted background, a coloured
 * label would lose readability and add nothing.
 */
export function TagDot({ colorKey, size = 8 }: { colorKey: Parameters<ReturnType<typeof useTheme>['tagColor']>[0]; size?: number }) {
  const { tagColor } = useTheme()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tagColor(colorKey),
      }}
    />
  )
}
