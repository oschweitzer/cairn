import { useState } from 'react'
import { View } from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '@/auth/AuthProvider'
import { pwnedCount, pwnedMessage } from '@/auth/pwned'
import { Button, Card, Field, Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

export default function SignUp() {
  const { signUpWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  async function submit() {
    setError(null)
    if (!email.trim()) {
      setError('Renseigne une adresse électronique.')
      return
    }
    if (password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caractères.')
      return
    }
    setBusy(true)
    try {
      // Before opening the account: is this password already out there? The
      // check fails open, so an unreachable service blocks nothing.
      const leaks = await pwnedCount(password)
      if (leaks > 0) {
        setError(pwnedMessage(leaks))
        return
      }

      const { needsConfirmation } = await signUpWithPassword(email, password)
      if (needsConfirmation) setAwaitingConfirmation(true)
      // Otherwise the session is open and the root layout's routing redirects.
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (awaitingConfirmation) {
    return (
      <Screen scroll>
        <View style={{ marginTop: space.xxxl, marginBottom: space.lg }}>
          <Logotype />
        </View>
        <Card style={{ gap: space.sm }}>
          <Txt variant="title">Vérifie ta boîte mail</Txt>
          <Txt variant="body" tone="secondary">
            Un lien de confirmation vient d’être envoyé à {email.trim()}. Le compte sera actif dès
            que tu l’auras ouvert.
          </Txt>
        </Card>
        <Link href="/sign-in" style={{ marginTop: space.lg, alignSelf: 'center' }}>
          <Txt variant="caption" tone="accent">
            Revenir à la connexion
          </Txt>
        </Link>
      </Screen>
    )
  }

  return (
    <Screen scroll>
      <View style={{ gap: space.xs, marginTop: space.xxxl, marginBottom: space.lg }}>
        <Logotype />
        <Txt variant="body" tone="secondary">
          Créer un compte.
        </Txt>
      </View>

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
      />

      <Field
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint="Six caractères au minimum."
        onSubmitEditing={() => void submit()}
        returnKeyType="go"
      />

      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}

      <Button
        label="Créer le compte"
        busy={busy}
        disabled={busy}
        onPress={() => void submit()}
        style={{ marginTop: space.sm }}
      />

      <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.xl, justifyContent: 'center' }}>
        <Txt variant="caption" tone="muted">
          Déjà un compte ?
        </Txt>
        <Link href="/sign-in">
          <Txt variant="caption" tone="accent">
            Se connecter
          </Txt>
        </Link>
      </View>
    </Screen>
  )
}
