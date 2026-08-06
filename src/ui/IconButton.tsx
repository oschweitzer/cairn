import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { Glyph, isGlyphName, type GlyphName } from './glyphs'
import { glow, useHover } from './components'
import { useTheme } from './ThemeProvider'
import { Tooltip } from './Tooltip'
import { radius, withAlpha } from './theme'

/**
 * Bouton réduit à son glyphe, avec son nom en infobulle.
 *
 * Un pictogramme seul se devine : `archive` et `inbox` ont le même carton, et
 * `bookmark` ne dit pas s'il épingle ou s'il met de côté. Le libellé n'est donc
 * pas une option, il est porté à la fois par l'accessibilité et par la bulle qui
 * s'ouvre au survol ou à l'appui maintenu. Les deux viennent de la même chaîne :
 * impossible qu'un bouton soit annoncé d'une façon et étiqueté d'une autre.
 *
 * Toutes les barres d'actions de l'application passent par ici, pour que le
 * geste et la taille de cible ne dérivent pas d'un écran à l'autre.
 */

/**
 * Nom Feather, ou l'un des rares glyphes maison de src/ui/glyphs.tsx. Les deux
 * jeux ne se recoupent pas, l'appelant n'a donc pas à savoir d'où vient l'icône
 * qu'il demande.
 */
export type IconName = React.ComponentProps<typeof Feather>['name'] | GlyphName

/**
 * Trois gabarits, tous au-dessus du plancher tactile de 48 points une fois le
 * `hitSlop` compté. Seul le glyphe rétrécit, jamais la zone atteignable.
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
  /** Annoncé par le lecteur d'écran et affiché dans la bulle. Un verbe, pas un nom d'icône. */
  label: string
  /** Texte de bulle, si l'annonce d'accessibilité gagne à être plus longue que l'étiquette. */
  tooltip?: string
  onPress: () => void
  active?: boolean
  disabled?: boolean
  tone?: 'default' | 'danger'
  size?: keyof typeof SIZES
  /** Côté d'ouverture de la bulle. À poser sur `top` pour une barre basse. */
  placement?: 'top' | 'bottom'
  style?: StyleProp<ViewStyle>
}) {
  const { theme } = useTheme()
  const { hovered, hoverProps } = useHover()
  const { box, glyph, slop } = SIZES[size]

  const lit = hovered && !disabled

  /**
   * Le glyphe au repos est passé du gris secondaire au gris de texte principal.
   * Une barre d'actions entièrement composée d'icônes n'a aucun libellé pour
   * rattraper un trait trop pâle : c'est le seul repère, il doit se lire du
   * premier coup d'œil.
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
          // Le halo n'apparaît qu'au survol : au repos, une barre d'outils
          // entière qui rayonne ne met plus rien en avant.
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
