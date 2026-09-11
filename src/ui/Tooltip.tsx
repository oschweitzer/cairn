import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTheme } from './ThemeProvider'
import { Txt } from './components'
import { radius, space } from './theme'
import { fadeTiming } from './transitions'

/**
 * Tooltips. A button reduced to its glyph is guessed at, not read: the tooltip
 * gives the action's name without lengthening the toolbar.
 *
 * It doubles the accessibility label, it does not replace it. An
 * `accessibilityLabel` stays mandatory on every button: the tooltip is hidden
 * from screen readers, which already announce the target's label.
 *
 * ── Why a single layer at the root ───────────────────────────────────────────
 * The tooltip is wider than the button that triggers it, so it overflows its
 * parent. Rendered in place, it would be clipped wherever a stratum cuts off
 * overflow: the note card, the tag list and the trash all set
 * `overflow: 'hidden'`. So it is painted in a single layer set above the whole
 * app, at screen coordinates measured on the target at display time.
 */

type Placement = 'top' | 'bottom'

type Anchor = { x: number; y: number; width: number; height: number }

type ActiveTip = {
  /** Opening number. Two successive tooltips are never the same, even with equal text. */
  id: number
  /** The trigger's identity, so one button does not close another's tooltip. */
  token: object
  label: string
  anchor: Anchor
  placement: Placement
}

type TooltipApi = {
  show: (token: object, label: string, anchor: Anchor, placement: Placement) => void
  hide: (token: object) => void
}

const TooltipContext = createContext<TooltipApi | null>(null)

/** Hover: long enough not to flicker when crossing a toolbar. */
const HOVER_DELAY = 320
/** Press and hold, the only gesture available to a finger. Matched to the system long press. */
const TOUCH_DELAY = 480
/** The tooltip outlives the release, otherwise it would not have time to be read. */
const TOUCH_LINGER = 1400

/** Gap between the tooltip and its target, and minimum margin to the screen edges. */
const GAP = space.sm
const EDGE = space.sm

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<ActiveTip | null>(null)
  const counter = useRef(0)

  const show = useCallback<TooltipApi['show']>((token, label, anchor, placement) => {
    counter.current += 1
    setTip({ id: counter.current, token, label, anchor, placement })
  }, [])

  // Only closes its own tooltip: between two neighbouring buttons, hovering the
  // second arrives before leaving the first, and a blind close would erase the
  // tooltip that has just opened.
  const hide = useCallback<TooltipApi['hide']>((token) => {
    setTip((current) => (current && current.token !== token ? current : null))
  }, [])

  const api = useMemo(() => ({ show, hide }), [show, hide])

  return (
    <TooltipContext.Provider value={api}>
      <View style={{ flex: 1 }}>
        {children}
        <TooltipLayer tip={tip} />
      </View>
    </TooltipContext.Provider>
  )
}

/**
 * Wraps a trigger. The wrapped component needs to know nothing about the
 * tooltip: gestures are picked up by the parent view, which does not take over
 * the touch and so lets the button behave normally.
 */
export function Tooltip({
  label,
  placement = 'bottom',
  style,
  children,
}: {
  label: string
  placement?: Placement
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const api = useContext(TooltipContext)
  const ref = useRef<View>(null)
  const token = useRef({}).current
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visible = useRef(false)

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clear()
    visible.current = false
    api?.hide(token)
  }, [api, clear, token])

  const reveal = useCallback(
    (delay: number) => {
      if (!api) return
      clear()
      timer.current = setTimeout(() => {
        ref.current?.measureInWindow((x, y, width, height) => {
          // A target unmounted in the meantime measures zero: the tooltip would
          // have nothing left to point at and would land in the screen's corner.
          if (width === 0 && height === 0) return
          visible.current = true
          api.show(token, label, { x, y, width, height }, placement)
        })
      }, delay)
    },
    [api, clear, label, placement, token],
  )

  // A screen left while the tooltip is open would otherwise take it along.
  useEffect(() => hide, [hide])

  return (
    <View
      ref={ref}
      // Otherwise Android may merge this view into its parent, and the
      // measurement then returns the parent's size instead of the button's.
      collapsable={false}
      onPointerEnter={() => reveal(HOVER_DELAY)}
      onPointerLeave={hide}
      // A click counts as an answer: keeping the tooltip after the action would
      // be insistent, and would often hide the gesture's result.
      onPointerDown={hide}
      onTouchStart={() => reveal(TOUCH_DELAY)}
      onTouchEnd={() => {
        if (!visible.current) {
          hide()
          return
        }
        clear()
        timer.current = setTimeout(hide, TOUCH_LINGER)
      }}
      onTouchCancel={hide}
      style={style}
    >
      {children}
    </View>
  )
}

function TooltipLayer({ tip }: { tip: ActiveTip | null }) {
  const { theme } = useTheme()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const opacity = useSharedValue(0)

  // Every opening starts from a blank measurement and a fade at zero. Keeping
  // the previous tooltip's measurement would place this one askew for a frame,
  // and keeping its opacity would make it appear with no transition, or worse,
  // halfway through if the previous one was closed during its fade.
  useEffect(() => {
    setSize(null)
    opacity.value = 0
  }, [tip?.id, opacity])

  // The tooltip only appears once measured, so once properly placed. That gap is
  // what rules out a declarative entering animation here: mounting and
  // appearing are not the same instant.
  useEffect(() => {
    if (!tip || !size) return
    opacity.value = withTiming(1, fadeTiming)
  }, [tip, size, opacity])

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))

  if (!tip) return null

  const width = size?.width ?? 0
  const height = size?.height ?? 0

  // A tooltip that would leave the screen flips to the other side of its
  // target, rather than being cut off by the edge.
  let top =
    tip.placement === 'top' ? tip.anchor.y - height - GAP : tip.anchor.y + tip.anchor.height + GAP
  if (top < EDGE) top = tip.anchor.y + tip.anchor.height + GAP
  else if (top + height > screenHeight - EDGE) top = tip.anchor.y - height - GAP

  const centered = tip.anchor.x + tip.anchor.width / 2 - width / 2
  const left = Math.min(Math.max(centered, EDGE), Math.max(EDGE, screenWidth - width - EDGE))

  return (
    <View
      pointerEvents="none"
      // Nothing to announce: the screen reader already reads the button's label,
      // of which the tooltip is only the on-screen transcription.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Animated.View
        onLayout={(e: LayoutChangeEvent) => {
          const next = e.nativeEvent.layout
          setSize((current) =>
            current && current.width === next.width && current.height === next.height
              ? current
              : { width: next.width, height: next.height },
          )
        }}
        style={[
          fade,
          {
            position: 'absolute',
            top,
            left,
            maxWidth: Math.max(120, screenWidth - EDGE * 2),
            paddingHorizontal: space.sm,
            paddingVertical: space.xs,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.line.hairline,
            // The palette's highest stratum: the tooltip floats above everything
            // else, and must stand out from it without a drop shadow.
            backgroundColor: theme.surface.raised,
          },
        ]}
      >
        <Txt variant="caption">{tip.label}</Txt>
      </Animated.View>
    </View>
  )
}
