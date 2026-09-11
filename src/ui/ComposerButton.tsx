import { Pressable } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { glow, useHover } from './components'
import { useTheme } from './ThemeProvider'
import { Tooltip } from './Tooltip'
import { radius, withAlpha } from './theme'

/**
 * Floating create button, at the bottom right.
 *
 * It used to exist as two identical copies, one per screen that creates notes —
 * the grid and the vault. The two drifted at the first touch-up: the grid's had
 * gained a tooltip, the vault's had not. A single component, and the hover glow
 * does not have to be set twice either.
 */
export function ComposerButton({
  icon,
  label,
  primary = false,
  busy = false,
  onPress,
}: {
  icon: 'plus' | 'check-square'
  label: string
  /** The screen's main action: filled with accent, only one per pair. */
  primary?: boolean
  busy?: boolean
  onPress: () => void
}) {
  const { theme } = useTheme()
  const { hovered, hoverProps } = useHover()
  const lit = hovered && !busy

  return (
    // Tooltip upwards: these buttons sit right at the bottom edge.
    <Tooltip label={label} placement="top">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={onPress}
        {...hoverProps}
        style={({ pressed }) => [
          {
            // 56 points: a comfortable target for a floating button reached with the thumb.
            width: 56,
            height: 56,
            borderRadius: radius.xl,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: primary
              ? pressed
                ? theme.accent.pressed
                : theme.accent.default
              : lit
                ? theme.accent.default
                : theme.line.strong,
            backgroundColor: primary
              ? pressed
                ? theme.accent.pressed
                : theme.accent.default
              : pressed || lit
                ? theme.surface.raised
                : theme.surface.card,
            opacity: busy ? 0.6 : 1,
          },
          /**
           * A wider glow than on bar buttons, and it is a matter of substance:
           * these two float above the grid, with nothing around to frame them.
           * A glow too tight would pass for a rendering glitch rather than a
           * response to the pointer.
           */
          lit ? glow(withAlpha(theme.accent.default, 0.4), 22) : null,
        ]}
      >
        <Feather name={icon} size={22} color={primary ? theme.text.onAccent : theme.text.primary} />
      </Pressable>
    </Tooltip>
  )
}
