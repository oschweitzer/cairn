import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { Txt } from './components'
import { runeBox, runePath, type RuneName } from './runes'
import { useTheme } from './ThemeProvider'
import { motion, space, type TagColorKey } from './theme'

/**
 * L'attente, gravée.
 *
 * ── Pourquoi une rune et pas une ébauche de contenu ──────────────────────────
 * L'ébauche grise avait sa logique — occuper la forme de ce qui vient — mais
 * elle ne ressemblait à rien : c'est le seul écran de l'application qui n'avait
 * aucun caractère. Une pierre gravée dont la couleur passe du gel à la braise
 * dit la même chose, et la dit dans la langue du reste.
 *
 * ── La couleur vient de la palette, pas de l'imagination ─────────────────────
 * Les cinq teintes traversées sont des clés de `tagPalette`, résolues par le
 * thème actif : le gel du fjord, la braise, le lichen, la bruyère, et l'aurore
 * pour refermer le cycle sur l'accent de l'application. Elles sont donc déjà
 * auditées sur les quatre strates, et elles suivent le passage en thème clair
 * sans qu'on ait un seul hexadécimal à écrire ici.
 *
 * ── Ornementale, donc muette ─────────────────────────────────────────────────
 * La rune ne porte aucun sens, conformément au principe posé dans runes.tsx :
 * c'est le texte sous elle qui annonce l'attente, et c'est lui que lit un
 * lecteur d'écran. Le dessin est masqué.
 */

const AnimatedPath = Animated.createAnimatedComponent(Path)

/**
 * Le cycle. Cinq teintes plutôt que deux : un aller-retour entre deux couleurs
 * se lit comme un clignotement, une traversée se lit comme une matière qui
 * change d'état.
 */
const CYCLE: readonly TagColorKey[] = ['fjord', 'braise', 'lichen', 'bruyere', 'aurore']

/** Temps passé sur chaque teinte. Le fondu est continu, rien ne s'arrête dessus. */
const STEP = motion.slow * 3

/**
 * Dagaz, ᛞ. Forme fermée et symétrique, la plus lisible du futhark à grande
 * taille, et déjà le trait de partage de l'éditeur : l'attente reste dans le
 * vocabulaire de l'application au lieu d'y introduire un signe de plus.
 */
const DEFAULT_RUNE: RuneName = 'dagaz'

export function RuneLoader({
  message = 'Chargement',
  rune = DEFAULT_RUNE,
  size = 72,
}: {
  /** Ce qu'on attend, en toutes lettres. C'est la seule chose qui soit annoncée. */
  message?: string
  rune?: RuneName
  size?: number
}) {
  const { tagColor } = useTheme()

  const progress = useSharedValue(0)
  const breath = useSharedValue(0)

  // La palette est résolue en JavaScript, puis capturée par les worklets : ce
  // sont de simples chaînes, et le thème ne change pas en cours d'animation.
  const colors = CYCLE.map((key) => tagColor(key))
  // La dernière teinte rejoint la première, sinon le cycle claque en revenant à
  // son début.
  const stops = [...colors, colors[0]]
  const steps = stops.map((_, index) => index)

  useEffect(() => {
    // Linéaire, et c'est voulu : une courbe d'accélération ferait accrocher le
    // regard sur chaque teinte, alors qu'on veut une dérive continue.
    progress.value = withRepeat(
      withTiming(CYCLE.length, { duration: STEP * CYCLE.length, easing: Easing.linear }),
      -1,
      false,
    )
    breath.value = withRepeat(
      withTiming(1, { duration: motion.slow * 4, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
  }, [progress, breath])

  const strokeProps = useAnimatedProps(() => ({
    stroke: interpolateColor(progress.value, steps, stops),
  }))

  const breathing = useAnimatedStyle(() => ({
    // Course très courte : la pierre respire, elle ne palpite pas.
    transform: [{ scale: 0.97 + breath.value * 0.03 }],
  }))

  const width = (size * runeBox.width) / runeBox.height

  return (
    <View
      accessible
      accessibilityLabel={message}
      accessibilityRole="progressbar"
      style={{ alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.xxxl }}
    >
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={breathing}
      >
        <Svg
          width={width}
          height={size}
          // La marge d'une unité empêche le trait d'être rogné sur les bords,
          // comme dans `<Rune>`.
          viewBox={`-1 -1 ${runeBox.width + 2} ${runeBox.height + 2}`}
        >
          <AnimatedPath
            d={runePath(rune)}
            // Valeur statique de repli : si la propriété animée ne passe pas
            // jusqu'à l'attribut SVG, la rune reste visible dans la première
            // teinte du cycle plutôt que de disparaître, un trait sans couleur
            // n'étant rien du tout.
            stroke={colors[0]}
            animatedProps={strokeProps}
            strokeWidth={size / 12}
            strokeLinecap="square"
            strokeLinejoin="miter"
            fill="none"
          />
        </Svg>
      </Animated.View>

      <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
        {message}
      </Txt>
    </View>
  )
}
