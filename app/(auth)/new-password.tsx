import { useState } from 'react'
import { View } from 'react-native'
import { useAuth } from '@/auth/AuthProvider'
import { pwnedCount, pwnedMessage } from '@/auth/pwned'
import { Button, Card, Field, Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Choosing the new password, on returning from the recovery link.
 *
 * ── Why this screen is mandatory ─────────────────────────────────────────────
 * The emailed link opens a real session: at that moment, the person is
 * technically signed in without having typed a password. Letting routing do its
 * job would send them straight into their notes, and the forgotten password
 * would stay forgotten — until the next device, where they would be locked out
 * again. So the provider's `recovering` flag holds navigation here until the
 * new password is set.
 *
 * Two entries, as for the vault code: a typo in a masked field does not show,
 * and it would lock out the very person who has just had the door opened for
 * them.
 */
export default function NewPassword() {
  const { updatePassword, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caractères.')
      return
    }
    if (password !== confirmation) {
      setError('Les deux saisies diffèrent.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      // The same check as on sign-up: this is where someone who has just lost a
      // password picks a new one, the moment the temptation to reuse a classic
      // is strongest.
      const leaks = await pwnedCount(password)
      if (leaks > 0) {
        setError(pwnedMessage(leaks))
        return
      }

      await updatePassword(password)
      // Nothing to do afterwards: `recovering` drops, and the root layout's
      // routing leads to the notes since the session is already open.
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
          Nouveau mot de passe.
        </Txt>
      </View>

      <Card style={{ gap: space.sm }}>
        <Txt variant="body" tone="secondary">
          Le lien a été accepté. Choisis un nouveau mot de passe pour terminer.
        </Txt>
        <Txt variant="caption" tone="muted">
          Il n’a rien à voir avec le code du coffre, qui reste inchangé.
        </Txt>
      </Card>

      <Field
        label="Nouveau mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint="Au moins 6 caractères."
      />

      <Field
        label="Retaper le mot de passe"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={() => void submit()}
        returnKeyType="go"
      />

      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}

      <Button
        label="Enregistrer le mot de passe"
        busy={busy}
        disabled={busy}
        onPress={() => void submit()}
        style={{ marginTop: space.sm }}
      />

      {/* A way out: without it, someone who opened the link by mistake would be
          held on this screen, navigation being locked there. */}
      <Button
        label="Annuler et se déconnecter"
        variant="ghost"
        disabled={busy}
        onPress={() => void signOut()}
        style={{ marginTop: space.sm }}
      />
    </Screen>
  )
}
