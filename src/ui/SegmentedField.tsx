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
 * Saisie d'une valeur ponctuée — une heure, une date — moitié par moitié, le
 * séparateur étant dessiné entre elles plutôt que tapé.
 *
 * ── Pourquoi pas un champ unique ─────────────────────────────────────────────
 * Un seul champ attendant « HH:MM » ou « JJ/MM/AAAA » se tient très bien sur un
 * clavier complet, et pas du tout sur un téléphone : le clavier numérique
 * n'offre ni « : » ni « / ». Effacer le séparateur une fois rendait la valeur
 * impossible à réécrire — le champ restait invalide, le bouton d'envoi grisé,
 * et la seule issue était de fermer le panneau pour repartir de la proposition.
 * Un séparateur qu'on ne peut pas taper ne doit pas être tapé : le clavier n'a
 * plus que des chiffres à fournir.
 *
 * ── Ce qui sort d'ici ────────────────────────────────────────────────────────
 * La chaîne complète, dans son format d'origine. Le découpage ne vit que dans
 * ce composant : `lireCreneau` continue de lire un seul format, et ses tests
 * avec lui.
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
   * La dernière valeur émise, que la sortie du champ relit au lieu de la prop.
   *
   * Le passage automatique d'une moitié à la suivante déplace le focus dans le
   * même événement que la frappe : le `onBlur` de la moitié quittée part avant
   * que le nouvel état soit redescendu, et une complétion calculée sur la prop
   * réécrirait la valeur avec celle d'avant la frappe — taper « 09 » rendait
   * « 00 ».
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
          // Compense l'épaississement de la bordure au focus, comme dans `Field`.
          paddingHorizontal: focused ? space.sm - 1 : space.sm,
        }}
      >
        {segments.map((segment, i) => {
          const style: TextStyle = {
            // La place va aux moitiés à proportion de ce qu'elles reçoivent :
            // une année tient quatre chiffres là où un mois en tient deux.
            flexGrow: segment.longueur,
            flexShrink: 1,
            flexBasis: 0,
            // Sur le web, un `input` réclame la largeur de son attribut `size`
            // — une vingtaine de caractères — et sortait du cadre dès que la
            // colonne se resserrait, sur un téléphone donc. Yoga n'en tient pas
            // compte.
            minWidth: 0,
            minHeight: 48,
            textAlign: 'center',
            color: theme.text.primary,
            fontFamily: type.body.fontFamily,
            fontSize: type.body.fontSize,
          }

          return (
            // Les moitiés et les séparateurs sont frères dans la rangée : un
            // séparateur enfermé avec sa moitié fausserait le partage de la
            // largeur, qui se fait au nombre de chiffres.
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
                  // La moitié est pleine : la frappe continue dans la suivante
                  // d'elle-même, sans avoir à viser un champ large de deux
                  // chiffres.
                  if (saisi.length === segment.longueur) refs.current[i + 1]?.focus()
                }}
                onKeyPress={(e) => {
                  // Retour arrière sur une moitié déjà vide : la touche ne
                  // ferait rien, elle ramène donc à la précédente — le geste
                  // attendu quand on efface pour tout retaper.
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
                // Toucher une moitié la sélectionne : on la remplace en tapant,
                // plutôt que d'effacer ses chiffres avant d'en écrire d'autres.
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
