import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Link, useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/auth/AuthProvider'
import { Card, Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Point d'atterrissage du retour OAuth.
 *
 * Cette route vit dans le groupe (auth) volontairement. L'aiguillage du layout
 * racine renvoie vers la connexion tout utilisateur sans session qui se trouve
 * hors de ce groupe : placer le callback ailleurs le ferait rebondir vers
 * /sign-in pendant l'échange du code, en perdant le code au passage.
 *
 * Sur le web, supabase-js lit le code dans l'URL à la création du client
 * (`detectSessionInUrl`). Sur mobile, l'échange est fait explicitement dans
 * AuthProvider avant même d'arriver ici. Dans les deux cas cet écran n'a rien à
 * faire d'autre qu'attendre, puis laisser l'aiguillage rediriger vers l'accueil
 * dès que la session apparaît.
 */
export default function Callback() {
  const { loading } = useAuth()
  // Supabase et Google renvoient leurs échecs dans l'URL plutôt que par exception.
  const params = useLocalSearchParams<{ error?: string; error_description?: string }>()
  const [tooLong, setTooLong] = useState(false)

  useEffect(() => {
    // Si rien ne se passe, mieux vaut une porte de sortie qu'un écran qui tourne
    // indéfiniment.
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
