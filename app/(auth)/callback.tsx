import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Link, useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/auth/AuthProvider'
import { Card, Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Landing point for the OAuth return.
 *
 * This route lives in the (auth) group on purpose. The root layout's routing
 * sends to sign-in every user without a session found outside this group:
 * putting the callback elsewhere would bounce it to /sign-in during the code
 * exchange, losing the code along the way.
 *
 * On the web, supabase-js reads the code from the URL when the client is
 * created (`detectSessionInUrl`). On mobile, the exchange is done explicitly in
 * AuthProvider before even arriving here. In both cases this screen has nothing
 * to do but wait, then let routing redirect to home as soon as the session
 * appears.
 */
export default function Callback() {
  const { loading } = useAuth()
  // Supabase and Google return their failures in the URL rather than by exception.
  const params = useLocalSearchParams<{ error?: string; error_description?: string }>()
  const [tooLong, setTooLong] = useState(false)

  useEffect(() => {
    // If nothing happens, a way out is better than a screen that spins forever.
    const timer = setTimeout(() => setTooLong(true), 8000)
    return () => clearTimeout(timer)
  }, [])

  const failure = params.error_description ?? params.error ?? null

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.md }}>
        <Logotype />

        {failure ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="title" tone="danger">
              Connexion refusée
            </Txt>
            <Txt variant="body" tone="secondary">
              {decodeURIComponent(failure)}
            </Txt>
          </Card>
        ) : (
          <Card style={{ gap: space.sm }}>
            <Txt variant="title">
              {tooLong ? 'Cela prend plus de temps que prévu' : 'Connexion en cours'}
            </Txt>
            <Txt variant="body" tone="secondary">
              {tooLong
                ? 'La réponse de Google n’est pas arrivée. Vérifie la configuration des URL de redirection, puis réessaie.'
                : 'Retour de Google, un instant.'}
            </Txt>
          </Card>
        )}

        {failure || (tooLong && !loading) ? (
          <Link href="/sign-in" style={{ alignSelf: 'center' }}>
            <Txt variant="label" tone="accent">
              Revenir à la connexion
            </Txt>
          </Link>
        ) : null}
      </View>
    </Screen>
  )
}
