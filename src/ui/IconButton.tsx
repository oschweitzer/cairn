import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { Glyph, isGlyphName, type GlyphName } from './glyphs'
import { glow, useHover } from './components'
import { useTheme } from './ThemeProvider'
import { Tooltip } from './Tooltip'
import { radius, withAlpha } from './theme'

/**
 * A button reduced to its glyph, with its name in a tooltip.
 *
 * A pictogram alone is guessed at: `archive` and `inbox` share the same box, and
 * `bookmark` does not say whether it pins or sets aside. So the label is not
 * optional, it is carried both by accessibility and by the tooltip that opens
 * on hover or on press-and-hold. Both come from the same string: a button
 * cannot be announced one way and labelled another.
 *
 * Every action bar in the app goes through here, so the gesture and the target
 * size do not drift from one screen to another.
 */

/**
 * A Feather name, or one of the few home-made glyphs of src/ui/glyphs.tsx. The
 * two sets do not overlap, so the caller does not have to know where the icon
 * it asks for comes from.
 */
export type IconName = React.ComponentProps<typeof Feather>['name'] | GlyphName

/**
 * Three sizes, all above the 48-point touch floor once the `hitSlop` is
 * counted. Only the glyph shrinks, never the reachable area.
 */
const SIZES = {
  sm: { box: 36, glyph: 16, slop: 6 },
  md: { box: 44, glyph: 18, slop: 2 },
  lg: { box: 48, glyph: 20, slop: 0 },
} as const

export function IconButton({
  icon,
  label,
  tooltip,
  onPress,
  active = false,
  disabled = false,
  tone = 'default',
  size = 'lg',
  placement = 'bottom',
  style,
}: {
  icon: IconName
  /** Announced by the screen reader and shown in the tooltip. A verb, not an icon name. */
  label: string
  /** Tooltip text, when the accessibility announcement benefits from being longer than the label. */
  tooltip?: string
  onPress: () => void
  active?: boolean
  disabled?: boolean
  tone?: 'default' | 'danger'
  size?: keyof typeof SIZES
  /** The side the tooltip opens on. Set to `top` for a bottom bar. */
  placement?: 'top' | 'bottom'
  style?: StyleProp<ViewStyle>
}) {
  const { theme } = useTheme()
  const { hovered, hoverProps } = useHover()
  const { box, glyph, slop } = SIZES[size]

  const lit = hovered && !disabled

  /**
   * The resting glyph moved from secondary grey to primary text grey. An action
   * bar made entirely of icons has no label to make up for a stroke that is too
   * pale: it is the only cue, and it has to read at first glance.
   */
  const color = disabled
    ? theme.text.muted
    : tone === 'danger'
      ? theme.state.danger
      : active || lit
        ? theme.accent.default
        : theme.text.primary

  return (
    <Tooltip label={tooltip ?? label} placement={placement} style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, selected: active }}
        disabled={disabled}
        onPress={onPress}
        hitSlop={slop}
        {...hoverProps}
        style={({ pressed }) => [
          {
            width: box,
            height: box,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            opacity: disabled ? 0.4 : 1,
            backgroundColor:
              active || lit
                ? theme.accent.subtle
                : pressed && !disabled
                  ? theme.surface.raised
                  : 'transparent',
          },
          // The glow only appears on hover: at rest, a whole toolbar glowing
          // no longer highlights anything.
          lit ? glow(withAlpha(theme.accent.default, 0.3), box / 3) : null,
        ]}
      >
        {isGlyphName(icon) ? (
          <Glyph name={icon} size={glyph} color={color} />
        ) : (
          <Feather name={icon} size={glyph} color={color} />
        )}
      </Pressable>
    </Tooltip>
  )
}
