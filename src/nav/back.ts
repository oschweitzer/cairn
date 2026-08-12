import { useCallback } from 'react'
import { useRouter } from 'expo-router'

/**
 * Going back, including from a screen that nothing led to.
 *
 * A deep link starts the application *at* its target: the widget opens
 * `cairn://note/<id>`, and `https://<host>/note/<id>` — the address written into
 * calendar events — does the same. The history then holds one entry and nothing
 * underneath, so `router.back()` has nothing to pop and the arrow does nothing
 * at all. `nouvelle.tsx` lands in the same place by a different road: it
 * `replace`s itself with the note it has just created, which swaps that single
 * entry rather than stacking on top of it.
 *
 * Hence the fallback. It is `replace` and not `push`: pushing the grid would
 * leave the note underneath it, and the next back press would walk straight
 * into the screen the user was trying to leave.
 *
 * The arrow stays visible either way. Somewhere else to be is not a thing the
 * reader should have to deduce from whether a chevron is drawn.
 */
export function useGoBack(): () => void {
  const router = useRouter()

  return useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/')
  }, [router])
}
