import { useState } from 'react'
import { View } from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '@/auth/AuthProvider'
import { Button, Field, Logotype, Screen, Seam, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

export default function SignIn() {
  const { signInWithPassword, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'password' | 'google' | null>(null)

  async function run(kind: 'password' | 'google') {
    setError(null)
    setBusy(kind)
    try {
      if (kind === 'password') {
        if (!email.trim() || !password) {
          setError('Renseigne une adresse et un mot de passe.')
          return
        }
        await signInWithPassword(email, password)
      } else {
        await signInWithGoogle()
      }
      // La redirection est faite par l'aiguillage du layout racine, dès que la
      // session change. Rien à faire ici.
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: space.xs, marginTop: space.xxxl, marginBottom: space.lg }}>
        <Logotype />
        <Txt variant="body" tone="secondary">
          Tes notes et tes listes, au même endroit.
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
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => void run('password')}
        returnKeyType="go"
      />

      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}

      <Button
        label="Se connecter"
        busy={busy === 'password'}
        disabled={busy !== null}
        onPress={() => void run('password')}
        style={{ marginTop: space.sm }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.md }}>
        <Seam style={{ flex: 1 }} />
        <Txt variant="caption" tone="muted">
          ou
        </Txt>
        <Seam style={{ flex: 1 }} />
      </View>

      <Button
        label="Continuer avec Google"
        variant="ghost"
        busy={busy === 'google'}
        disabled={busy !== null}
        onPress={() => void run('google')}
      />

      <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.xl, justifyContent: 'center' }}>
        <Txt variant="caption" tone="muted">
          Pas encore de compte ?
        </Txt>
        <Link href="/sign-up">
          <Txt variant="caption" tone="accent">
            Créer un compte
          </Txt>
        </Link>
      </View>
    </Screen>
  )
}
