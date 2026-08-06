import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTheme } from './ThemeProvider'
import { Txt } from './components'
import { radius, space } from './theme'
import { fadeTiming } from './transitions'

/**
 * Infobulles. Un bouton réduit à son glyphe se devine, il ne se lit pas : la
 * bulle donne le nom de l'action sans allonger la barre d'outils.
 *
 * Elle double le libellé d'accessibilité, elle ne le remplace pas. Un
 * `accessibilityLabel` reste obligatoire sur chaque bouton : la bulle est
 * masquée aux lecteurs d'écran, qui annoncent déjà le libellé de la cible.
 *
 * ── Pourquoi une couche unique à la racine ───────────────────────────────────
 * La bulle est plus large que le bouton qui la déclenche, et déborde donc de son
 * parent. Rendue sur place, elle serait rognée partout où une strate coupe ce
 * qui dépasse : la carte de note, la liste de tags et la corbeille posent toutes
 * un `overflow: 'hidden'`. Elle est donc peinte dans une couche unique posée
 * au-dessus de toute l'application, à des coordonnées écran mesurées sur la
 * cible au moment de l'affichage.
 */

type Placement = 'top' | 'bottom'

type Anchor = { x: number; y: number; width: number; height: number }

type ActiveTip = {
  /** Numéro d'ouverture. Deux bulles successives ne sont jamais la même, même à texte égal. */
  id: number
  /** Identité du déclencheur, pour qu'un bouton ne referme pas la bulle d'un autre. */
  token: object
  label: string
  anchor: Anchor
  placement: Placement
}

type TooltipApi = {
  show: (token: object, label: string, anchor: Anchor, placement: Placement) => void
  hide: (token: object) => void
}

const TooltipContext = createContext<TooltipApi | null>(null)

/** Survol : assez long pour ne pas clignoter en traversant une barre d'outils. */
const HOVER_DELAY = 320
/** Appui maintenu, seul geste disponible au doigt. Calé sur le long press système. */
const TOUCH_DELAY = 480
/** La bulle survit au relâchement, sinon elle n'aurait pas le temps d'être lue. */
const TOUCH_LINGER = 1400

/** Écart entre la bulle et sa cible, et marge minimale aux bords de l'écran. */
const GAP = space.sm
const EDGE = space.sm

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<ActiveTip | null>(null)
  const counter = useRef(0)

  const show = useCallback<TooltipApi['show']>((token, label, anchor, placement) => {
    counter.current += 1
    setTip({ id: counter.current, token, label, anchor, placement })
  }, [])

  // Ne referme que sa propre bulle : entre deux boutons voisins, le survol du
  // second arrive avant la sortie du premier, et une fermeture aveugle
  // effacerait la bulle qui vient de s'ouvrir.
  const hide = useCallback<TooltipApi['hide']>((token) => {
    setTip((current) => (current && current.token !== token ? current : null))
  }, [])

  const api = useMemo(() => ({ show, hide }), [show, hide])

  return (
    <TooltipContext.Provider value={api}>
      <View style={{ flex: 1 }}>
        {children}
        <TooltipLayer tip={tip} />
      </View>
    </TooltipContext.Provider>
  )
}

/**
 * Enveloppe un déclencheur. Le composant enveloppé n'a rien à savoir de
 * l'infobulle : les gestes sont captés par la vue parente, qui ne prend pas la
 * main sur le toucher et laisse donc le bouton se comporter normalement.
 */
export function Tooltip({
  label,
  placement = 'bottom',
  style,
  children,
}: {
  label: string
  placement?: Placement
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const api = useContext(TooltipContext)
  const ref = useRef<View>(null)
  const token = useRef({}).current
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visible = useRef(false)

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clear()
    visible.current = false
    api?.hide(token)
  }, [api, clear, token])

  const reveal = useCallback(
    (delay: number) => {
      if (!api) return
      clear()
      timer.current = setTimeout(() => {
        ref.current?.measureInWindow((x, y, width, height) => {
          // Une cible démontée entre-temps mesure zéro : la bulle n'aurait plus
          // rien à désigner et se poserait dans le coin de l'écran.
          if (width === 0 && height === 0) return
          visible.current = true
          api.show(token, label, { x, y, width, height }, placement)
        })
      }, delay)
    },
    [api, clear, label, placement, token],
  )

  // Un écran quitté pendant que la bulle est ouverte l'emporterait avec lui.
  useEffect(() => hide, [hide])

  return (
    <View
      ref={ref}
      // Sans cela Android peut fondre cette vue dans son parent, et la mesure
      // renvoie alors les dimensions du parent au lieu de celles du bouton.
      collapsable={false}
      onPointerEnter={() => reveal(HOVER_DELAY)}
      onPointerLeave={hide}
      // Un clic vaut réponse : garder la bulle après l'action tiendrait de
      // l'insistance, et masquerait souvent le résultat du geste.
      onPointerDown={hide}
      onTouchStart={() => reveal(TOUCH_DELAY)}
      onTouchEnd={() => {
        if (!visible.current) {
          hide()
          return
        }
        clear()
        timer.current = setTimeout(hide, TOUCH_LINGER)
      }}
      onTouchCancel={hide}
      style={style}
    >
      {children}
    </View>
  )
}

function TooltipLayer({ tip }: { tip: ActiveTip | null }) {
  const { theme } = useTheme()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const opacity = useSharedValue(0)

  // Chaque ouverture repart d'une mesure vierge et d'un fondu à zéro. Garder la
  // mesure de la bulle précédente poserait celle-ci de travers le temps d'une
  // image, et garder son opacité la ferait apparaître sans transition, ou pire,
  // à mi-course si la précédente a été refermée pendant son fondu.
  useEffect(() => {
    setSize(null)
    opacity.value = 0
  }, [tip?.id, opacity])

  // La bulle n'apparaît qu'une fois mesurée, donc une fois bien placée. C'est ce
  // décalage qui interdit ici une animation d'entrée déclarative : le montage et
  // l'apparition ne sont pas le même instant.
  useEffect(() => {
    if (!tip || !size) return
    opacity.value = withTiming(1, fadeTiming)
  }, [tip, size, opacity])

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))

  if (!tip) return null

  const width = size?.width ?? 0
  const height = size?.height ?? 0

  // Une bulle qui sortirait de l'écran bascule de l'autre côté de sa cible,
  // plutôt que d'être tronquée par le bord.
  let top =
    tip.placement === 'top' ? tip.anchor.y - height - GAP : tip.anchor.y + tip.anchor.height + GAP
  if (top < EDGE) top = tip.anchor.y + tip.anchor.height + GAP
  else if (top + height > screenHeight - EDGE) top = tip.anchor.y - height - GAP

  const centered = tip.anchor.x + tip.anchor.width / 2 - width / 2
  const left = Math.min(Math.max(centered, EDGE), Math.max(EDGE, screenWidth - width - EDGE))

  return (
    <View
      pointerEvents="none"
      // Rien à annoncer : le lecteur d'écran lit déjà le libellé du bouton, dont
      // la bulle n'est que la transcription à l'écran.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Animated.View
        onLayout={(e: LayoutChangeEvent) => {
          const next = e.nativeEvent.layout
          setSize((current) =>
            current && current.width === next.width && current.height === next.height
              ? current
              : { width: next.width, height: next.height },
          )
        }}
        style={[
          fade,
          {
            position: 'absolute',
            top,
            left,
            maxWidth: Math.max(120, screenWidth - EDGE * 2),
            paddingHorizontal: space.sm,
            paddingVertical: space.xs,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.line.hairline,
            // La strate la plus haute de la palette : la bulle flotte au-dessus
            // de tout le reste, elle doit s'en détacher sans ombre portée.
            backgroundColor: theme.surface.raised,
          },
        ]}
      >
        <Txt variant="caption">{tip.label}</Txt>
      </Animated.View>
    </View>
  )
}
