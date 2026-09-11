import { useEffect } from 'react'
import { View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Return from the Google Calendar consent, on the web.
 *
 * This page only exists to be loaded and then close itself, and it is not
 * optional. On the web, `promptAsync` opens a popup and waits: the landing page
 * is what has to hand control back, by calling `maybeCompleteAuthSession`,
 * which posts the complete URL — authorisation code included — to the window
 * that opened it, then closes it. Without that call, the popup stays open on a
 * dead page and the connection never goes through.
 *
 * On Android, none of this is used: `openAuthSessionAsync` intercepts the
 * `cairn://google` redirect itself and returns the result to the caller, with
 * no route reached. The page costs nothing all the same, and having it on both
 * sides avoids having to remember which of the two platforms needs it.
 *
 * In the (auth) group for the same reason as `callback.tsx`: the root layout's
 * routing sends to sign-in every user without a session found outside this
 * group. The popup is a fresh context, where the session may not have been read
 * yet; anywhere else, this page would bounce to /sign-in before handing control
 * back, taking the code with it.
 */
export default function GoogleCallback() {
  useEffect(() => {
    // Failure does not need handling here: it means no authorisation is in
    // progress, that is, someone opened this address directly. The text below
    // is then enough.
    void WebBrowser.maybeCompleteAuthSession()
  }, [])

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.md }}>
        <Logotype />
        <Txt variant="body" tone="muted">
          Autorisation en cours, cette fenêtre va se refermer.
        </Txt>
      </View>
    </Screen>
  )
}
