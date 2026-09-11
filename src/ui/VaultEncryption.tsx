import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { keys } from '@/db/queries'
import { useVault } from '@/vault/VaultProvider'
import { useTheme } from './ThemeProvider'
import { Button, Card, Seam, Txt, noWebOutline, useFocusRing } from './components'
import { RuneLoader } from './RuneLoader'
import { useToast } from './Toast'
import { radius, space, type } from './theme'

/**
 * Setting up encryption, and recovering on a new device.
 *
 * These two screens are the only moment the user sees the cryptography. The
 * rest of the time it must be invisible — it is here, and only here, that the
 * one thing they have to remember is at stake.
 */

/**
 * The recovery key, shown once.
 *
 * It exists nowhere else in plaintext: not on the device, not on the server,
 * which only holds its effect. Closing this screen without having written it
 * down means accepting to lose one's notes the day one changes phones. Hence
 * the explicit confirmation, which is not a formality: it is the only place in
 * the app where a button truly commits.
 */
export function RecoveryKeyReveal() {
  const { theme } = useTheme()
  const { pendingRecoveryKey, acknowledgeRecoveryKey } = useVault()
  const [written, setWritten] = useState(false)

  if (!pendingRecoveryKey) return null

  return (
    <Card recessed style={{ gap: space.md }}>
      <Txt variant="title">Ta clé de secours</Txt>
      <Txt variant="body" tone="secondary">
        Note-la maintenant, sur papier de préférence. Elle n’est écrite nulle part ailleurs, et
        c’est la seule chose qui rouvrira ce coffre sur un autre appareil.
      </Txt>

      <View
        style={{
          padding: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.accent.default,
          backgroundColor: theme.surface.recessed,
        }}
      >
        <Txt
          variant="title"
          tone="accent"
          selectable
          style={{ fontFamily: type.label.fontFamily, letterSpacing: 1.5, textAlign: 'center' }}
        >
          {pendingRecoveryKey}
        </Txt>
      </View>

      <Txt variant="caption" tone="danger">
        Tant que ce coffre reste ouvert sur cet appareil, tu peux en demander une nouvelle. Perdue
        en même temps que l’appareil, les notes sont définitivement illisibles — par toi comme par
        n’importe qui d’autre.
      </Txt>

      <Seam />

      <Button
        label={written ? 'C’est noté, fermer' : 'Je l’ai notée'}
        variant={written ? 'primary' : 'ghost'}
        onPress={() => (written ? acknowledgeRecoveryKey() : setWritten(true))}
      />
    </Card>
  )
}

/**
 * Offer to turn on encryption, when no key exists yet.
 *
 * Encryption is not turned on by default: it changes the nature of what can be
 * promised, and it commits the user to keeping a key. Such a commitment is
 * taken, not imposed.
 */
export function EncryptionSetup() {
  const { enableEncryption } = useVault()
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const qc = useQueryClient()

  const enable = async () => {
    setBusy(true)
    try {
      const { encryptedNotes } = await enableEncryption()
      if (encryptedNotes > 0) {
        toast(
          encryptedNotes === 1 ? '1 note chiffrée.' : `${encryptedNotes} notes chiffrées.`,
          { tone: 'success' },
        )
      }
      void qc.invalidateQueries({ queryKey: keys.privateNotes })
      void qc.invalidateQueries({ queryKey: keys.privateChecklistItems })
    } catch {
      toast('Le chiffrement n’a pas pu être mis en place.', { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  if (busy) return <RuneLoader message="On scelle le coffre…" rune="algiz" />

  return (
    <Card recessed style={{ gap: space.sm }}>
      <Txt variant="title">Chiffrer ce coffre</Txt>
      <Txt variant="body" tone="secondary">
        Aujourd’hui le code masque les notes ; elles restent lisibles par qui accède à la base. Le
        chiffrement les rend illisibles pour tout le monde sauf toi.
      </Txt>
      <Txt variant="caption" tone="muted">
        Une clé de secours te sera montrée une seule fois. C’est elle, et non le code, qui rouvrira
        le coffre sur un autre appareil.
      </Txt>
      <Button label="Chiffrer le coffre" onPress={() => void enable()} />
    </Card>
  )
}

/**
 * Recovering on a device that does not have the key.
 *
 * A blocking screen, on purpose: without the data key, the notes display
 * empty. Better to say why than let people believe the vault was erased.
 */
export function EncryptionRestore() {
  const { restoreWithRecoveryKey } = useVault()
  const { theme } = useTheme()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const focus = useFocusRing()

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const verdict = await restoreWithRecoveryKey(input)
      // Two distinct messages: "mistyped" is fixed by rereading one's sheet,
      // "does not match" means one is holding another vault's key. A single
      // message would send people looking in the wrong place.
      if (verdict === 'malformed') setError('Cette clé n’a pas la bonne forme. Huit groupes de quatre.')
      else if (verdict === 'wrong-key') setError('Cette clé ne correspond pas à ce coffre.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card recessed style={{ gap: space.md }}>
      <Txt variant="title">Clé de secours attendue</Txt>
      <Txt variant="body" tone="secondary">
        Les notes de ce coffre sont chiffrées, et cet appareil n’a pas encore la clé. Saisis la clé
        de secours notée lors de la mise en place.
      </Txt>

      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        placeholderTextColor={theme.text.muted}
        accessibilityLabel="Clé de secours"
        autoCapitalize="characters"
        autoCorrect={false}
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
        onSubmitEditing={() => void submit()}
        style={[
          {
            minHeight: 48,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: focus.focused ? 2 : 1,
            borderColor: focus.focused ? theme.accent.default : theme.line.hairline,
            backgroundColor: theme.surface.recessed,
            color: theme.text.primary,
            fontFamily: type.label.fontFamily,
            fontSize: type.label.fontSize,
            letterSpacing: 1.2,
          },
          noWebOutline,
        ]}
      />

      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : (
        <Txt variant="caption" tone="muted">
          La casse, les espaces et les tirets sont sans importance.
        </Txt>
      )}

      <Button label="Ouvrir avec cette clé" busy={busy} onPress={() => void submit()} />
    </Card>
  )
}

/**
 * Asking for a fresh recovery key, with the vault open.
 *
 * Three situations, a single answer: it was lost, it was never seen, or it is
 * suspected to have been read by someone else. Rewrapping the data key under a
 * fresh key settles all three, without touching a single note — it is the
 * wrapping that changes, not what it holds.
 *
 * Shown permanently, and discreetly: it is an encrypted vault's emergency exit,
 * it has to be there before anyone looks for it.
 */
export function RecoveryKeyRenewal() {
  const { regenerateRecoveryKey } = useVault()
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const renew = async () => {
    setBusy(true)
    try {
      await regenerateRecoveryKey()
    } catch {
      toast('Impossible de générer une nouvelle clé.', { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card recessed style={{ gap: space.xs }}>
      <Txt variant="label">Clé de secours</Txt>
      <Txt variant="caption" tone="muted">
        Perdue, jamais notée, ou vue par quelqu’un d’autre ? En demander une neuve annule
        l’ancienne et ne touche à aucune note.
      </Txt>
      <Button
        label="Nouvelle clé de secours"
        variant="ghost"
        busy={busy}
        onPress={() => void renew()}
      />
    </Card>
  )
}
