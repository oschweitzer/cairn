import { useRef, useState } from 'react'
import { TextInput, View, type TextStyle } from 'react-native'
import { composerHeure, completerHeure, separerHeure } from '@/google/creneau'
import { useTheme } from './ThemeProvider'
import { Txt, noWebOutline } from './components'
import { radius, space, type } from './theme'

/**
 * Saisie d'une heure, en deux moitiés séparées par un « : » dessiné.
 *
 * ── Pourquoi pas un champ unique ─────────────────────────────────────────────
 * Un seul champ attendant « HH:MM » se tient très bien sur un clavier complet,
 * et pas du tout sur un téléphone : le clavier numérique n'offre pas de « : ».
 * Effacer le séparateur une fois rendait l'heure impossible à réécrire — le
 * champ restait invalide, le bouton d'envoi grisé, et la seule issue était de
 * fermer le panneau pour repartir de la proposition. Un séparateur qu'on ne
 * peut pas taper ne doit pas être tapé : il est ici tracé entre les deux
 * moitiés, et le clavier n'a plus que des chiffres à fournir.
 *
 * ── Ce qui sort d'ici ────────────────────────────────────────────────────────
 * La chaîne « HH:MM », inchangée. Le découpage ne vit que dans ce composant :
 * `lireCreneau` continue de lire un seul format, et ses tests avec lui.
 */
export function TimeField({
  label,
  value,
  onChangeText,
}: {
  label: string
  value: string
  onChangeText: (heure: string) => void
}) {
  const { theme } = useTheme()
  const [focused, setFocused] = useState(false)
  const heuresRef = useRef<TextInput>(null)
  const minutesRef = useRef<TextInput>(null)

  const { heures, minutes } = separerHeure(value)

  /**
   * La dernière valeur émise, que la sortie du champ relit au lieu de la prop.
   *
   * Le passage automatique des heures aux minutes déplace le focus dans le même
   * événement que la frappe : le `onBlur` des heures part avant que le nouvel
   * état soit redescendu, et une complétion calculée sur la prop réécrirait
   * l'heure avec celle d'avant la frappe — taper « 09 » rendait « 00 ».
   */
  const emis = useRef(value)
  emis.current = value

  const emettre = (prochain: string) => {
    emis.current = prochain
    onChangeText(prochain)
  }

  const styleMoitie: TextStyle = {
    flex: 1,
    // Sur le web, un `input` réclame la largeur de son attribut `size` — une
    // vingtaine de caractères — et sortait du cadre dès que la colonne se
    // resserrait, sur un téléphone donc. Yoga n'en tient pas compte.
    minWidth: 0,
    minHeight: 48,
    textAlign: 'center',
    color: theme.text.primary,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
  }

  /** Commun aux deux moitiés : deux chiffres, et rien qu'un clavier numérique. */
  const communs = {
    inputMode: 'numeric' as const,
    keyboardType: 'number-pad' as const,
    maxLength: 2,
    // Toucher une moitié la sélectionne : on la remplace en tapant, plutôt que
    // d'effacer deux chiffres avant d'en écrire deux autres.
    selectTextOnFocus: true,
    placeholderTextColor: theme.text.muted,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      emettre(completerHeure(emis.current))
    },
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
          // Compense l'épaississement de la bordure au focus, comme dans `Field`.
          paddingHorizontal: focused ? space.sm - 1 : space.sm,
        }}
      >
        <TextInput
          ref={heuresRef}
          accessibilityLabel="Heures"
          value={heures}
          onChangeText={(v) => {
            const saisi = v.replace(/\D/g, '').slice(0, 2)
            emettre(composerHeure(saisi, minutes))
            // Les heures sont complètes : la frappe continue dans les minutes
            // d'elle-même, sans avoir à viser un champ large de deux chiffres.
            if (saisi.length === 2) minutesRef.current?.focus()
          }}
          placeholder="HH"
          style={[styleMoitie, noWebOutline]}
          {...communs}
        />
        <Txt tone="muted">:</Txt>
        <TextInput
          ref={minutesRef}
          accessibilityLabel="Minutes"
          value={minutes}
          onChangeText={(v) => emettre(composerHeure(heures, v))}
          onKeyPress={(e) => {
            // Retour arrière sur des minutes déjà vides : la touche ne ferait
            // rien, elle ramène donc aux heures — le geste attendu quand on
            // efface pour tout retaper.
            if (e.nativeEvent.key === 'Backspace' && minutes === '') {
              heuresRef.current?.focus()
            }
          }}
          placeholder="MM"
          style={[styleMoitie, noWebOutline]}
          {...communs}
        />
      </View>
    </View>
  )
}
