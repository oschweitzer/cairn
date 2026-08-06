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
 * Mise en place du chiffrement, et reprise sur un appareil neuf.
 *
 * Ces deux écrans sont le seul moment où l'utilisateur voit la cryptographie.
 * Le reste du temps elle doit être invisible — c'est ici, et seulement ici, que
 * se joue la seule chose qu'il ait à retenir.
 */

/**
 * La clé de secours, montrée une fois.
 *
 * Elle n'existe nulle part ailleurs en clair : ni sur l'appareil, ni sur le
 * serveur, qui n'en détient que l'effet. Fermer cet écran sans l'avoir notée,
 * c'est accepter de perdre ses notes le jour où l'on change de téléphone. D'où
 * la confirmation explicite, qui n'est pas une formalité : c'est le seul
 * endroit de l'application où un bouton engage vraiment.
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
 * Proposition d'activer le chiffrement, quand aucune clé n'existe encore.
 *
 * Le chiffrement n'est pas activé d'office : il change la nature de ce qu'on
 * peut promettre, et il engage l'utilisateur à garder une clé. Un tel
 * engagement se prend, il ne se subit pas.
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
 * Reprise sur un appareil qui n'a pas la clé.
 *
 * Écran bloquant, volontairement : sans la clé de données, les notes s'affichent
 * vides. Mieux vaut dire pourquoi que laisser croire à un coffre effacé.
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
      // Deux messages distincts : « mal recopiée » se corrige en relisant sa
      // feuille, « ne correspond pas » veut dire qu'on tient la clé d'un autre
      // coffre. Un message unique laisserait chercher au mauvais endroit.
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
 * Demander une clé de secours neuve, le coffre étant ouvert.
 *
 * Trois situations, une seule réponse : on l'a perdue, on ne l'a jamais vue, ou
 * on la soupçonne lue par quelqu'un d'autre. Réenvelopper la clé de données
 * sous une clé neuve règle les trois, sans toucher à une seule note — c'est
 * l'enveloppe qui change, pas ce qu'elle contient.
 *
 * Affichée en permanence, et discrètement : c'est la sortie de secours d'un
 * coffre chiffré, elle doit être là avant qu'on la cherche.
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
