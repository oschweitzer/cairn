import { useEffect } from 'react'
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { motion } from './theme'

/**
 * The app's vocabulary of motion.
 *
 * Every animation goes through here, for the same reason every colour goes
 * through `theme`: a duration written by hand in a screen is a duration that
 * will drift from the others. The values come from `motion`, which stays the
 * single source.
 *
 * ── The register ─────────────────────────────────────────────────────────────
 * A sharp start, a clean stop, no elasticity: stone does not spring, and the
 * chisel does not linger. The vertical travel is short, ten points or so.
 * Beyond that, the animation stops accompanying the content and starts making
 * it wait.
 *
 * ── Reduced motion ───────────────────────────────────────────────────────────
 * No setting to write: Reanimated's builders default to `ReduceMotion.System`,
 * so the system setting is already respected everywhere. It is not a courtesy:
 * for some people on-screen motion causes dizziness, and an animation that
 * cannot be turned off makes the app unusable.
 */

/** The theme's curve, in the form Reanimated expects. */
const curve = Easing.bezier(...motion.easing)

/**
 * What has just settled on screen: the opened note, the unlocked vault. The
 * content rises into place as it appears.
 *
 * `withInitialValues` rather than `FadeInDown` as is: Reanimated's default
 * travel is far longer than this register allows.
 */
export const rise = (distance = 10) =>
  FadeInDown.duration(motion.base)
    .easing(curve)
    .withInitialValues({ opacity: 0, transform: [{ translateY: distance }] })

/**
 * The same appearance, as an animated style rather than an entering animation.
 *
 * ── When to pick this one, and why it exists ─────────────────────────────────
 * `entering` puts the view's layout under Reanimated's control. On an element
 * that merely takes its place among its siblings — a list row, a panel, a banner
 * — that is exactly what is wanted, and it is the only way to also get an
 * exiting animation.
 *
 * On an element whose layout carries the screen's, it is a trap: the editor's
 * scrolling area lost its height there, collapsed to nothing, and the bottom bar
 * rose to sit on the title — which it hid, being opaque. An animated style only
 * touches opacity and a translation: the layout stays the one Yoga computes, and
 * `flex: 1` holds.
 *
 * Rule: `entering` for what takes a place, `useRise` for what carries one.
 */
export function useRise({ distance = 10, delay = 0 }: { distance?: number; delay?: number } = {}) {
  const progress = useSharedValue(0)

  useEffect(() => {
    // `withTiming` defaults to `ReduceMotion.System`: the system setting is
    // respected without writing anything more.
    progress.value = withDelay(delay, withTiming(1, { duration: motion.base, easing: curve }))
  }, [progress, delay])

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }))
}

/** An appearance without movement, for what has no "where it comes from". */
export const appear = FadeIn.duration(motion.fast).easing(curve)

/**
 * Disappearance. Faster than the appearance, on purpose: what is leaving has
 * nothing left to be read, and the eye is already elsewhere.
 */
export const vanish = FadeOut.duration(motion.fast).easing(curve)

/**
 * `withTiming` setting for fades driven by hand, when the appearance does not
 * coincide with mounting: the tooltip waits to be measured before showing,
 * otherwise it would sit askew for a frame.
 */
export const fadeTiming = { duration: motion.fast, easing: curve }

/**
 * The pulse of content being waited for.
 *
 * The app's only continuous motion, and the only one that leaves the sharp,
 * clean register: it does not tell a gesture, it says we are waiting. Hence a
 * much longer duration — derived from the tokens all the same, so a general
 * change of rhythm carries it along — and a symmetrical curve: a pulse has
 * neither start nor arrival.
 */
export const breath = { duration: motion.slow * 4, easing: Easing.inOut(Easing.quad) }

/**
 * Rearranging a list: an item that changes place slides there.
 *
 * It is the only animation in this file React Native cannot produce on its own,
 * and it is what justifies the dependency: without it, moving a list item up
 * makes it jump a row, and nothing says which one moved.
 */
export const reflow = LinearTransition.duration(motion.base).easing(curve)
