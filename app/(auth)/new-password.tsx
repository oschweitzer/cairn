import { useState } from 'react'
import { View } from 'react-native'
import { useAuth } from '@/auth/AuthProvider'
import { pwnedCount, pwnedMessage } from '@/auth/pwned'
import { Button, Card, Field, Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Choix du nouveau mot de passe, au retour du lien de récupération.
 *
 * ── Pourquoi cet écran est un passage obligé ─────────────────────────────────
 * Le lien reçu par courriel ouvre une vraie session : à cet instant, la personne
 * est techniquement connectée sans avoir tapé de mot de passe. Laisser
 * l'aiguillage faire son travail l'enverrait droit dans ses notes, et le mot de
 * passe oublié le resterait — jusqu'au prochain appareil, où elle serait de
 * nouveau bloquée. Le drapeau `recovering` du fournisseur retient donc la
 * navigation ici tant que le nouveau mot de passe n'est pas posé.
 *
 * Deux saisies, comme pour le code du coffre : une faute de frappe dans un champ
 * masqué ne se voit pas, et elle enfermerait dehors celui-là même qui vient de
 * se faire ouvrir la porte.
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
      // Le même contrôle qu'à l'inscription : c'est ici que se choisit le mot de
      // passe de quelqu'un qui vient d'en perdre un, moment où la tentation de
      // reprendre un classique est la plus forte.
      const leaks = await pwnedCount(password)
      if (leaks > 0) {
        setError(pwnedMessage(leaks))
        return
      }

      await updatePassword(password)
      // Rien à faire ensuite : `recovering` retombe, et l'aiguillage du layout
      // racine emmène vers les notes puisque la session est déjà ouverte.
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

      {/* Porte de sortie : sans elle, quelqu'un qui a ouvert le lien par erreur
          resterait retenu sur cet écran, la navigation y étant verrouillée. */}
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
