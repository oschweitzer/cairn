import { useState } from 'react'
import { View } from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '@/auth/AuthProvider'
import { Button, Card, Field, Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Demande de récupération.
 *
 * ── La réponse est la même dans tous les cas ─────────────────────────────────
 * Adresse connue ou non, l'écran répond « c'est parti ». Distinguer les deux
 * ferait de ce formulaire un outil de découverte : n'importe qui pourrait y
 * essayer des adresses et apprendre lesquelles ont un compte ici. Supabase ne le
 * dit pas non plus, et c'est délibéré de sa part comme de la nôtre.
 *
 * Le courriel part par le service intégré de Supabase, plafonné par heure et à
 * l'échelle du projet. Pour une application personnelle, c'est sans conséquence.
 * Le jour où elle s'ouvre, un SMTP personnalisé se règle dans le tableau de bord
 * sans toucher à ce code.
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
