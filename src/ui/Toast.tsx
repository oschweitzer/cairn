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
 * Acknowledgement banner, at the bottom of the screen.
 *
 * It serves actions whose result does not show: a successful save changes
 * nothing on screen, and without a word the user has no way of knowing whether
 * their gesture took. Conversely, pinning or archiving shows by itself and has
 * nothing to announce, or every click would get a commentary.
 *
 * One banner at a time: the next replaces the previous one. Stacking messages
 * would turn an acknowledgement into an event log, and would cover the screen
 * at the very moment you want to see it.
 */

export type ToastTone = 'neutral' | 'success' | 'danger'

type Toast = {
  /** Changes on every call, even for an identical message: that is what restarts the animation. */
  id: number
  message: string
  tone: ToastTone
}

type ShowToast = (message: string, options?: { tone?: ToastTone }) => void

const ToastContext = createContext<ShowToast | null>(null)

/** Long enough to read one line without rushing. An error stays longer. */
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
 * Shows a banner. Only to be used for what does not show otherwise, see this
 * file's header.
 */
export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast doit être utilisé sous <ToastProvider>.')
  return show
}

/**
 * The positioning layer stays mounted permanently, and it has to: an exiting
 * animation can only play if the parent of what is disappearing is still there
 * to hold it. It costs nothing, `box-none` letting through every gesture not
 * aimed at the banner itself.
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
        // Remounting through the key resets the animation to its start: without
        // it, two saves in a row would only show movement the first time, and
        // the second would go unnoticed.
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

  // Removal is enough to trigger the exit: `exiting` holds the banner for the
  // length of its fade, so there is no "leaving" state to keep.
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
