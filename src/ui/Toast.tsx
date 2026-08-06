import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import { useTheme } from './ThemeProvider'
import { Txt } from './components'
import { radius, space } from './theme'
import { rise, vanish } from './transitions'

/**
 * Bandeau d'accusé de réception, en bas de l'écran.
 *
 * Il sert aux actions dont le résultat ne se voit pas : un enregistrement réussi
 * ne change rien à l'écran, et sans un mot l'utilisateur n'a aucun moyen de
 * savoir si son geste a porté. À l'inverse, épingler ou archiver se voit tout
 * seul et n'a rien à annoncer, sous peine de commenter chaque clic.
 *
 * Un seul bandeau à la fois : le suivant remplace le précédent. Empiler des
 * messages transformerait un accusé de réception en journal d'événements, et
 * couvrirait l'écran au moment précis où l'on veut le voir.
 */

export type ToastTone = 'neutral' | 'success' | 'danger'

type Toast = {
  /** Change à chaque appel, y compris pour un message identique : c'est ce qui relance l'animation. */
  id: number
  message: string
  tone: ToastTone
}

type ShowToast = (message: string, options?: { tone?: ToastTone }) => void

const ToastContext = createContext<ShowToast | null>(null)

/** Assez pour lire une ligne sans presser. Une erreur reste plus longtemps. */
const DURATION = 2600
const DURATION_DANGER = 4200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const counter = useRef(0)

  const show = useCallback<ShowToast>((message, options) => {
    counter.current += 1
    setToast({ id: counter.current, message, tone: options?.tone ?? 'neutral' })
  }, [])

  const dismiss = useCallback((id: number) => {
    setToast((current) => (current?.id === id ? null : current))
  }, [])

  return (
    <ToastContext.Provider value={show}>
      <View style={{ flex: 1 }}>
        {children}
        <ToastLayer toast={toast} onDismiss={dismiss} />
      </View>
    </ToastContext.Provider>
  )
}

/**
 * Affiche un bandeau. À n'utiliser que pour ce qui ne se voit pas autrement,
 * voir l'en-tête de ce fichier.
 */
export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast doit être utilisé sous <ToastProvider>.')
  return show
}

/**
 * La couche de position reste montée en permanence, et c'est nécessaire : une
 * animation de sortie ne peut jouer que si le parent de ce qui disparaît est
 * toujours là pour l'accueillir. Elle ne coûte rien, `box-none` laissant passer
 * tous les gestes qui ne visent pas le bandeau lui-même.
 */
function ToastLayer({
  toast,
  onDismiss,
}: {
  toast: Toast | null
  onDismiss: (id: number) => void
}) {
  const insets = useSafeAreaInsets()

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: space.lg,
        right: space.lg,
        bottom: insets.bottom + space.lg,
        alignItems: 'center',
      }}
    >
      {toast ? (
        // Remonter la clé remet l'animation à son départ : sans cela, deux
        // enregistrements d'affilée n'afficheraient un mouvement que la
        // première fois, et le second passerait inaperçu.
        <ToastBanner key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ) : null}
    </View>
  )
}

function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { theme } = useTheme()

  const accent =
    toast.tone === 'danger'
      ? theme.state.danger
      : toast.tone === 'success'
        ? theme.accent.default
        : theme.text.secondary

  const icon =
    toast.tone === 'danger' ? 'alert-triangle' : toast.tone === 'success' ? 'check' : 'info'

  // Le retrait suffit à déclencher la sortie : `exiting` retient le bandeau le
  // temps de son fondu, il n'y a donc pas d'état « en train de partir » à tenir.
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.tone === 'danger' ? DURATION_DANGER : DURATION)
    return () => clearTimeout(timer)
  }, [onDismiss, toast.tone])

  return (
    <Animated.View entering={rise()} exiting={vanish} style={{ maxWidth: 420 }}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={toast.message}
        accessibilityHint="Toucher pour masquer"
        onPress={onDismiss}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 44,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: toast.tone === 'danger' ? theme.state.danger : theme.line.hairline,
          backgroundColor: theme.surface.raised,
        }}
      >
        <Feather name={icon} size={16} color={accent} />
        <Txt variant="label" tone={toast.tone === 'danger' ? 'danger' : 'primary'}>
          {toast.message}
        </Txt>
      </Pressable>
    </Animated.View>
  )
}
