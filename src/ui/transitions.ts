import { useEffect } from 'react'
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { motion } from './theme'

/**
 * Vocabulaire de mouvement de l'application.
 *
 * Toutes les animations passent par ici, pour la même raison que toutes les
 * couleurs passent par `theme` : une durée écrite à la main dans un écran est
 * une durée qui dérivera de celles des autres. Les valeurs viennent de `motion`,
 * qui reste la source unique.
 *
 * ── Le registre ──────────────────────────────────────────────────────────────
 * Départ franc, arrêt net, aucune élasticité : la pierre ne fait pas ressort, et
 * le ciseau ne traîne pas. La course verticale est courte, une dizaine de
 * points. Au-delà, l'animation cesse d'accompagner le contenu et se met à le
 * faire attendre.
 *
 * ── Mouvement réduit ─────────────────────────────────────────────────────────
 * Aucun réglage à écrire : les constructeurs de Reanimated sont par défaut en
 * `ReduceMotion.System`, donc le réglage système est déjà respecté partout. Ce
 * n'est pas une politesse : pour une partie des gens le mouvement à l'écran
 * provoque des vertiges, et une animation qu'on ne peut pas couper rend
 * l'application inutilisable.
 */

/** La courbe du thème, sous la forme attendue par Reanimated. */
const curve = Easing.bezier(...motion.easing)

/**
 * Ce qui vient de se poser à l'écran : la note ouverte, le coffre déverrouillé.
 * Le contenu monte vers sa place en apparaissant.
 *
 * `withInitialValues` plutôt que `FadeInDown` tel quel : la course par défaut de
 * Reanimated est bien plus longue que ce que ce registre autorise.
 */
export const rise = (distance = 10) =>
  FadeInDown.duration(motion.base)
    .easing(curve)
    .withInitialValues({ opacity: 0, transform: [{ translateY: distance }] })

/**
 * La même apparition, en style animé plutôt qu'en animation d'entrée.
 *
 * ── Quand prendre celle-ci, et pourquoi elle existe ──────────────────────────
 * `entering` fait passer la disposition de la vue sous le contrôle de
 * Reanimated. Sur un élément qui ne fait que se placer parmi ses frères — une
 * ligne de liste, un panneau, un bandeau — c'est exactement ce qu'il faut, et
 * c'est le seul moyen d'obtenir aussi une animation de sortie.
 *
 * Sur un élément dont la disposition porte celle de l'écran, c'est un piège :
 * la zone défilante de l'éditeur y a perdu sa hauteur, s'est écrasée à rien, et
 * la barre du bas est remontée se poser sur le titre — qu'elle masquait, étant
 * opaque. Un style animé, lui, ne touche qu'à l'opacité et à une translation :
 * la mise en page reste celle que Yoga calcule, et le `flex: 1` tient.
 *
 * Règle : `entering` pour ce qui se place, `useRise` pour ce qui porte.
 */
export function useRise({ distance = 10, delay = 0 }: { distance?: number; delay?: number } = {}) {
  const progress = useSharedValue(0)

  useEffect(() => {
    // `withTiming` est par défaut en `ReduceMotion.System` : le réglage système
    // est respecté sans rien écrire de plus.
    progress.value = withDelay(delay, withTiming(1, { duration: motion.base, easing: curve }))
  }, [progress, delay])

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }))
}

/** Apparition sans déplacement, pour ce qui n'a pas de « d'où ça vient ». */
export const appear = FadeIn.duration(motion.fast).easing(curve)

/**
 * Disparition. Plus rapide que l'apparition, délibérément : ce qui s'en va n'a
 * plus rien à faire lire, et le regard est déjà ailleurs.
 */
export const vanish = FadeOut.duration(motion.fast).easing(curve)

/**
 * Réglage de `withTiming` pour les fondus pilotés à la main, quand l'apparition
 * ne coïncide pas avec le montage : l'infobulle attend d'être mesurée avant de
 * se montrer, sans quoi elle se poserait de travers le temps d'une image.
 */
export const fadeTiming = { duration: motion.fast, easing: curve }

/**
 * Battement d'un contenu en attente.
 *
 * Seul mouvement continu de l'application, et le seul qui sorte du registre
 * franc et net : il ne raconte pas un geste, il dit qu'on patiente. D'où une
 * durée bien plus longue — dérivée des jetons malgré tout, pour qu'un
 * changement de rythme général l'emporte avec lui — et une courbe symétrique :
 * un battement n'a ni départ ni arrivée.
 */
export const breath = { duration: motion.slow * 4, easing: Easing.inOut(Easing.quad) }

/**
 * Réarrangement d'une liste : un élément qui change de place y glisse.
 *
 * C'est la seule animation de ce fichier que React Native ne sait pas produire
 * seul, et c'est elle qui justifie la dépendance : sans elle, monter un élément
 * de liste le fait sauter d'un rang, et rien ne dit lequel a bougé.
 */
export const reflow = LinearTransition.duration(motion.base).easing(curve)
