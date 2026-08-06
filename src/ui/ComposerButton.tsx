import { Pressable } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { glow, useHover } from './components'
import { useTheme } from './ThemeProvider'
import { Tooltip } from './Tooltip'
import { radius, withAlpha } from './theme'

/**
 * Bouton de création flottant, en bas à droite.
 *
 * Il existait en deux exemplaires identiques, un par écran qui crée des notes —
 * la grille et le coffre. Les deux ont dérivé dès la première retouche : celui
 * de la grille avait gagné une infobulle, celui du coffre non. Un seul
 * composant, et le halo de survol n'a pas à être posé deux fois non plus.
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
  /** L'action principale de l'écran : pleine d'accent, une seule par paire. */
  primary?: boolean
  busy?: boolean
  onPress: () => void
}) {
  const { theme } = useTheme()
  const { hovered, hoverProps } = useHover()
  const lit = hovered && !busy

  return (
    // Bulle vers le haut : ces boutons sont posés au ras du bord bas.
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
            // 56 points : cible confortable pour un bouton flottant atteint au pouce.
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
           * Halo plus large que sur les boutons de barre, et c'est une question
           * de fond : ces deux-là flottent au-dessus de la grille, sans rien
           * autour pour les cadrer. Une lueur trop serrée y passerait pour un
           * défaut de rendu plutôt que pour une réponse au pointeur.
           */
          lit ? glow(withAlpha(theme.accent.default, 0.4), 22) : null,
        ]}
      >
        <Feather name={icon} size={22} color={primary ? theme.text.onAccent : theme.text.primary} />
      </Pressable>
    </Tooltip>
  )
}
