import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { Txt } from './components'
import { runeBox, runePath, type RuneName } from './runes'
import { useTheme } from './ThemeProvider'
import { motion, space, type TagColorKey } from './theme'

/**
 * Waiting, engraved.
 *
 * ── Why a rune and not a content skeleton ────────────────────────────────────
 * The grey skeleton had its logic — taking the shape of what is coming — but it
 * looked like nothing: it was the only screen in the app with no character at
 * all. An engraved stone whose colour goes from frost to ember says the same
 * thing, and says it in the language of everything else.
 *
 * ── The colour comes from the palette, not from imagination ──────────────────
 * The five hues it passes through are `tagPalette` keys, resolved by the active
 * theme: the frost of the fjord, the ember, the lichen, the heather, and the
 * aurora to close the cycle on the app's accent. So they are already audited on
 * all four strata, and they follow the switch to the light theme without a
 * single hexadecimal to write here.
 *
 * ── Ornamental, so silent ────────────────────────────────────────────────────
 * The rune carries no meaning, in line with the principle set in runes.tsx: the
 * text under it is what announces the wait, and it is what a screen reader
 * reads. The drawing is hidden.
 */

const AnimatedPath = Animated.createAnimatedComponent(Path)

/**
 * The cycle. Five hues rather than two: a back and forth between two colours
 * reads as blinking, a crossing reads as matter changing state.
 */
const CYCLE: readonly TagColorKey[] = ['fjord', 'braise', 'lichen', 'bruyere', 'aurore']

/** Time spent on each hue. The fade is continuous, nothing stops on it. */
const STEP = motion.slow * 3

/**
 * Dagaz, ᛞ. A closed, symmetrical shape, the most legible of the futhark at a
 * large size, and already the editor's dividing line: the wait stays within the
 * app's vocabulary instead of bringing in one more sign.
 */
const DEFAULT_RUNE: RuneName = 'dagaz'

export function RuneLoader({
  message = 'Chargement',
  rune = DEFAULT_RUNE,
  size = 72,
}: {
  /** What is being waited for, spelled out. It is the only thing announced. */
  message?: string
  rune?: RuneName
  size?: number
}) {
  const { tagColor } = useTheme()

  const progress = useSharedValue(0)
  const breath = useSharedValue(0)

  // The palette is resolved in JavaScript, then captured by the worklets: they
  // are plain strings, and the theme does not change mid-animation.
  const colors = CYCLE.map((key) => tagColor(key))
  // The last hue joins the first, otherwise the cycle snaps as it returns to
  // its start.
  const stops = [...colors, colors[0]]
  const steps = stops.map((_, index) => index)

  useEffect(() => {
    // Linear, on purpose: an easing curve would catch the eye on each hue,
    // whereas we want a continuous drift.
    progress.value = withRepeat(
      withTiming(CYCLE.length, { duration: STEP * CYCLE.length, easing: Easing.linear }),
      -1,
      false,
    )
    breath.value = withRepeat(
      withTiming(1, { duration: motion.slow * 4, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
  }, [progress, breath])

  const strokeProps = useAnimatedProps(() => ({
    stroke: interpolateColor(progress.value, steps, stops),
  }))

  const breathing = useAnimatedStyle(() => ({
    // A very short travel: the stone breathes, it does not throb.
    transform: [{ scale: 0.97 + breath.value * 0.03 }],
  }))

  const width = (size * runeBox.width) / runeBox.height

  return (
    <View
      accessible
      accessibilityLabel={message}
      accessibilityRole="progressbar"
      style={{ alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.xxxl }}
    >
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={breathing}
      >
        <Svg
          width={width}
          height={size}
          // The one-unit margin keeps the stroke from being clipped at the
          // edges, as in `<Rune>`.
          viewBox={`-1 -1 ${runeBox.width + 2} ${runeBox.height + 2}`}
        >
          <AnimatedPath
            d={runePath(rune)}
            // A static fallback value: if the animated prop does not make it to
            // the SVG attribute, the rune stays visible in the cycle's first
            // hue rather than vanishing, a stroke with no colour being nothing
            // at all.
            stroke={colors[0]}
            animatedProps={strokeProps}
            strokeWidth={size / 12}
            strokeLinecap="square"
            strokeLinejoin="miter"
            fill="none"
          />
        </Svg>
      </Animated.View>

      <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
        {message}
      </Txt>
    </View>
  )
}
