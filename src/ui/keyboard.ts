import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * Is the software keyboard on screen?
 *
 * Not the height, and not an animated value: the one thing screens here need to
 * know is whether the bottom safe-area inset still means anything. It does not
 * when the keyboard is up — the gesture bar and the navigation bar are under the
 * keyboard, so reserving room for them pushes a docked bar up by their height
 * for nothing, leaving a strip of page floating above the keys.
 *
 * `Will` events on iOS, `Did` on Android, because that is where each platform
 * puts them: iOS announces the keyboard before it moves, Android once it has.
 * Using `Did` on iOS would make the layout land after the keyboard rather than
 * with it.
 *
 * The web has no software keyboard to speak of — the browser resizes its own
 * visual viewport and never fires these events — so the hook stays false there
 * rather than pretending.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (Platform.OS === 'web') return
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setOpen(true),
    )
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setOpen(false),
    )
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return open
}
