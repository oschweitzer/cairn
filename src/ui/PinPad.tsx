import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/vault/secret'
import { useTheme } from './ThemeProvider'
import { Txt } from './components'
import { radius, space } from './theme'

/**
 * Saisie du code du coffre.
 *
 * ── Pourquoi un pavé dessiné plutôt qu'un champ de texte ─────────────────────
 * Un `TextInput` en `secureTextEntry` avec clavier numérique ferait le même
 * travail avec dix fois moins de code. Il ferait aussi remonter le clavier
 * système par-dessus la moitié de l'écran, laisserait le gestionnaire de mots de
 * passe proposer de retenir le code, et sur Android afficherait brièvement
 * chaque chiffre tapé. Pour un secret à quatre chiffres saisi devant témoin,
 * c'est le mauvais compromis.
 *
 * ── Le retour visuel ne dit jamais combien il manque ─────────────────────────
 * Les points remplis suivent la frappe, mais le gabarit ne montre pas la
 * longueur attendue : afficher quatre emplacements vides annoncerait la longueur
 * du code à qui regarde. Les points s'ajoutent donc au fur et à mesure.
 */

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  /** Confirmation d'un nouveau code : le libellé de validation change de sens. */
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

/** Un point par chiffre saisi. Aucun emplacement vide, voir l'en-tête. */
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
        // 72 points : une touche de pavé numérique se vise au pouce sans regarder.
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
 * Compte à rebours de la temporisation, en texte lisible.
 *
 * Extrait ici parce que l'écran du coffre et l'écran des réglages l'affichent
 * tous les deux, et qu'une durée en millisecondes n'est lisible par personne.
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
