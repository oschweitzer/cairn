import { useState } from 'react'
import { View } from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '@/auth/AuthProvider'
import { Button, Card, Field, Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Recovery request.
 *
 * ── The answer is the same in every case ─────────────────────────────────────
 * Known address or not, the screen answers "it's on its way". Telling the two
 * apart would turn this form into a discovery tool: anyone could try addresses
 * there and learn which ones have an account here. Supabase does not say either,
 * and that is deliberate on its part as on ours.
 *
 * The email goes out through Supabase's built-in service, capped per hour and
 * project-wide. For a personal app, that is of no consequence. The day it opens
 * up, a custom SMTP is set in the dashboard without touching this code.
 */
export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit() {
    if (!email.trim()) {
      setError('Renseigne l’adresse du compte.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await sendPasswordReset(email)
      setSent(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: space.xs, marginTop: space.xxxl, marginBottom: space.lg }}>
        <Logotype />
        <Txt variant="body" tone="secondary">
          Mot de passe oublié.
        </Txt>
      </View>

      {sent ? (
        <Card style={{ gap: space.sm }}>
          <Txt variant="title">Courriel envoyé</Txt>
          <Txt variant="body" tone="secondary">
            Si un compte existe pour {email.trim()}, un lien de récupération vient d’y être
            envoyé. Il ouvre l’application sur le choix d’un nouveau mot de passe.
          </Txt>
          <Txt variant="caption" tone="muted">
            Rien reçu au bout de quelques minutes ? Regarde les indésirables, puis vérifie
            l’adresse saisie.
          </Txt>
        </Card>
      ) : (
        <>
          <Card style={{ gap: space.sm }}>
            <Txt variant="body" tone="secondary">
              Indique l’adresse du compte. Un lien te sera envoyé pour en choisir un nouveau.
            </Txt>
            <Txt variant="caption" tone="muted">
              Un compte créé avec Google n’a pas de mot de passe : passe par « Continuer avec
              Google » sur l’écran de connexion.
            </Txt>
          </Card>

          <Field
            label="Adresse électronique"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            textContentType="emailAddress"
            placeholder="prenom@exemple.fr"
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
          />

          {error ? (
            <Txt variant="caption" tone="danger">
              {error}
            </Txt>
          ) : null}

          <Button
            label="Envoyer le lien"
            busy={busy}
            disabled={busy}
            onPress={() => void submit()}
            style={{ marginTop: space.sm }}
          />
        </>
      )}

      <View style={{ marginTop: space.xl, alignItems: 'center' }}>
        <Link href="/sign-in">
          <Txt variant="caption" tone="accent">
            Revenir à la connexion
          </Txt>
        </Link>
      </View>
    </Screen>
  )
}
