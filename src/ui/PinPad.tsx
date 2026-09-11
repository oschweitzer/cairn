import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/vault/secret'
import { useTheme } from './ThemeProvider'
import { Txt } from './components'
import { radius, space } from './theme'

/**
 * Entering the vault code.
 *
 * ── Why a drawn keypad rather than a text field ──────────────────────────────
 * A `TextInput` with `secureTextEntry` and a numeric keyboard would do the same
 * job with ten times less code. It would also bring the system keyboard up over
 * half the screen, let the password manager offer to remember the code, and on
 * Android briefly show each digit typed. For a four-digit secret entered in
 * front of witnesses, that is the wrong trade-off.
 *
 * ── The visual feedback never says how many are missing ──────────────────────
 * The filled dots follow typing, but the layout does not show the expected
 * length: showing four empty slots would announce the code's length to anyone
 * watching. So the dots are added as you go.
 */

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  /** Confirming a new code: the submit label changes meaning. */
  submitLabel = 'Ouvrir',
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  disabled?: boolean
  submitLabel?: string
}) {
  const complete = value.length >= PIN_MIN_LENGTH

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_MAX_LENGTH) return
    onChange(value + digit)
  }

  return (
    <View style={{ gap: space.xl, alignItems: 'center' }}>
      <Dots count={value.length} />

      <View style={{ gap: space.md }}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ flexDirection: 'row', gap: space.md }}>
            {DIGITS.slice(row * 3, row * 3 + 3).map((digit) => (
              <Key key={digit} label={digit} disabled={disabled} onPress={() => press(digit)} />
            ))}
          </View>
        ))}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Key
            icon="delete"
            label="Effacer le dernier chiffre"
            disabled={disabled || value.length === 0}
            onPress={() => onChange(value.slice(0, -1))}
          />
          <Key label="0" disabled={disabled} onPress={() => press('0')} />
          <Key
            icon="arrow-right"
            label={submitLabel}
            tone="accent"
            disabled={disabled || !complete}
            onPress={onSubmit}
          />
        </View>
      </View>
    </View>
  )
}

/** One dot per digit entered. No empty slot, see the header. */
function Dots({ count }: { count: number }) {
  const { theme } = useTheme()
  return (
    <View
      accessibilityLabel={count === 0 ? 'Aucun chiffre saisi' : `${count} chiffres saisis`}
      style={{ flexDirection: 'row', gap: space.sm, height: 12, alignItems: 'center' }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: theme.accent.default,
          }}
        />
      ))}
    </View>
  )
}

function Key({
  label,
  icon,
  onPress,
  disabled = false,
  tone = 'default',
}: {
  label: string
  icon?: React.ComponentProps<typeof Feather>['name']
  onPress: () => void
  disabled?: boolean
  tone?: 'default' | 'accent'
}) {
  const { theme } = useTheme()
  const accent = tone === 'accent'

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        // 72 points: a keypad key is aimed at with the thumb without looking.
        width: 72,
        height: 60,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: accent && !disabled ? theme.accent.default : theme.line.hairline,
        backgroundColor: pressed
          ? accent
            ? theme.accent.pressed
            : theme.surface.raised
          : accent && !disabled
            ? theme.accent.default
            : theme.surface.card,
        opacity: disabled ? 0.35 : 1,
      })}
    >
      {icon ? (
        <Feather
          name={icon}
          size={20}
          color={accent && !disabled ? theme.text.onAccent : theme.text.primary}
        />
      ) : (
        <Txt variant="title" tone={accent ? 'onAccent' : 'primary'}>
          {label}
        </Txt>
      )}
    </Pressable>
  )
}

/**
 * Countdown of the cool-down, as readable text.
 *
 * Pulled out here because the vault screen and the settings screen both show
 * it, and a duration in milliseconds is readable by nobody.
 */
export function useCooldownLabel(coolingMs: number): string | null {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (coolingMs <= 0) {
      setLabel(null)
      return
    }
    const seconds = Math.ceil(coolingMs / 1000)
    if (seconds < 60) {
      setLabel(`Encore ${seconds} seconde${seconds > 1 ? 's' : ''}.`)
      return
    }
    const minutes = Math.ceil(seconds / 60)
    setLabel(`Encore ${minutes} minute${minutes > 1 ? 's' : ''}.`)
  }, [coolingMs])

  return label
}
