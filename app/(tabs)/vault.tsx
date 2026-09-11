import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import { useCreateNote, useSetNotePrivate, useUpdateNote } from '@/db/queries'
import { usePrivateNoteList } from '@/db/select'
import type { NoteKind } from '@/db/types'
import { useVault, type BiometricUnlock } from '@/vault/VaultProvider'
import { PIN_MIN_LENGTH } from '@/vault/secret'
import { useTheme } from '@/ui/ThemeProvider'
import { Button, Card, Inscription, Txt } from '@/ui/components'
import { ComposerButton } from '@/ui/ComposerButton'
import { IconButton } from '@/ui/IconButton'
import { MasonryGrid } from '@/ui/MasonryGrid'
import { NoteCard, estimateCardHeight } from '@/ui/NoteCard'
import { PinPad, useCooldownLabel } from '@/ui/PinPad'
import { RuneLoader } from '@/ui/RuneLoader'
import { StandingStone } from '@/ui/runes'
import { useToast } from '@/ui/Toast'
import {
  EncryptionRestore,
  EncryptionSetup,
  RecoveryKeyRenewal,
  RecoveryKeyReveal,
} from '@/ui/VaultEncryption'
import { useRise } from '@/ui/transitions'
import { motion, radius, space } from '@/ui/theme'

/**
 * The vault.
 *
 * Three states, one screen: to set up, locked, open. Splitting them into three
 * routes would force deciding which one to show before knowing which state we
 * are in, and would make a redirect flicker on load.
 *
 * ── The background is the recessed surface ───────────────────────────────────
 * The whole screen switches to `surface.recessed`, the theme's darkest stratum.
 * It is the only view in the app that does. You enter the rock, and the change
 * of background says you have changed places better than a title would. The
 * cave-dwelling reference earns its keep there.
 */
export default function Vault() {
  const { ready, configured, unlocked } = useVault()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  /**
   * Leaving the tab no longer closes the vault, and that is a deliberate
   * concession.
   *
   * As long as the vault was a stacked screen, leaving it destroyed it, and
   * closing on unmount cost nothing. As a tab, it stays mounted: the only
   * equivalent hook would be losing focus — and opening a vault note is
   * precisely what makes this screen lose focus. Closing on that would slam the
   * door at the very moment you walk in.
   *
   * What remains is the trigger that actually carries the protection: five
   * minutes without a gesture, wherever you are in the app and even once you
   * have gone elsewhere, time away counting as idle time. The « Refermer »
   * button covers the deliberate gesture.
   */

  /**
   * The note the editor handed to the vault when sending us here.
   *
   * It is copied into local state, rather than read straight from the route
   * param, because it gets consumed: once filed, the notice has to leave the
   * screen, while the param stays in the URL. The flag stops the effect from
   * bringing it straight back.
   */
  const params = useLocalSearchParams<{ claim?: string }>()
  const [claim, setClaim] = useState<string | null>(null)
  const claimSettled = useRef(false)

  useEffect(() => {
    if (claimSettled.current || !params.claim) return
    setClaim(params.claim)
  }, [params.claim])

  const releaseClaim = useCallback(() => {
    claimSettled.current = true
    setClaim(null)
  }, [])

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surface.recessed,
        paddingTop: insets.top,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        {/* The vault is now reached through its tab, with nothing behind it:
            the arrow only appears if you came from somewhere else, the editor
            handing over a note for instance. */}
        {router.canGoBack() ? (
          <IconButton icon="arrow-left" label="Retour" onPress={() => router.back()} />
        ) : (
          <View style={{ width: space.md }} />
        )}
        <Inscription style={{ flex: 1 }}>Coffre</Inscription>
      </View>

      {!ready ? null : !configured ? (
        <Setup pendingNote={claim !== null} />
      ) : !unlocked ? (
        <Locked pendingNote={claim !== null} />
      ) : (
        <Contents claim={claim} onClaimSettled={releaseClaim} />
      )}
    </View>
  )
}

/**
 * Reminder of the intent in progress, as long as the vault is not open.
 *
 * Without this line, the code screen appears for no readable reason: you asked
 * to file a note, you find yourself in front of a keypad. Saying why costs one
 * sentence and keeps people from giving up halfway.
 */
function PendingNoteNotice() {
  return (
    <Card recessed style={{ gap: space.xxs }}>
      <Txt variant="label" tone="accent">
        Une note attend d’être rangée ici
      </Txt>
      <Txt variant="caption" tone="muted">
        Elle sera masquée dès le coffre ouvert. Revenir en arrière la laisse où elle est.
      </Txt>
    </Card>
  )
}

// -------------------------------------------------------------------- setup

/**
 * First setup of the code.
 *
 * Two entries, the second to confirm. A code set by mistake and never retyped
 * would lock the notes behind an unknown combination, and since nothing is
 * encrypted at this stage there would not even be a recovery to offer: the
 * vault would have to be erased.
 */
function Setup({ pendingNote }: { pendingNote: boolean }) {
  const { configure, biometrics } = useVault()
  const { theme } = useTheme()

  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [error, setError] = useState<string | null>(null)
  const [useBiometrics, setUseBiometrics] = useState(biometrics === 'ready')

  // The biometric probe arrives after the first render: the checkbox follows
  // it, as long as the user has not touched it themselves.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) setUseBiometrics(biometrics === 'ready')
  }, [biometrics, touched])

  const submit = useCallback(async () => {
    if (step === 'choose') {
      setError(null)
      setStep('confirm')
      return
    }
    if (second !== first) {
      setError('Les deux saisies diffèrent. On recommence.')
      setFirst('')
      setSecond('')
      setStep('choose')
      return
    }
    await configure(first, useBiometrics)
  }, [step, first, second, configure, useBiometrics])

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      {pendingNote ? <PendingNoteNotice /> : null}

      <Card recessed style={{ gap: space.sm }}>
        <Txt variant="title">Choisir un code</Txt>
        <Txt variant="body" tone="secondary">
          Les notes rangées ici disparaissent de la grille et ne reviennent que
          derrière ce code. Au moins {PIN_MIN_LENGTH} chiffres.
        </Txt>
        {/**
         * The scope is told to the user, not only to the developer. Letting
         * people believe in encryption would be the worst way to save words:
         * someone would file things here that deserve better.
         */}
        <Txt variant="caption" tone="muted">
          Ce code garde l’accès sur cet appareil{Platform.OS === 'web' ? ', et il est stocké dans le navigateur' : ''}.
          Il ne chiffre rien par lui-même : le chiffrement se met en place une fois le coffre
          ouvert, avec sa propre clé de secours.
        </Txt>
      </Card>

      <View style={{ gap: space.md, alignItems: 'center' }}>
        <Txt variant="label" tone={step === 'confirm' ? 'accent' : 'secondary'}>
          {step === 'choose' ? 'Nouveau code' : 'Retaper le code'}
        </Txt>
        <PinPad
          value={step === 'choose' ? first : second}
          onChange={step === 'choose' ? setFirst : setSecond}
          onSubmit={() => void submit()}
          submitLabel={step === 'choose' ? 'Continuer' : 'Créer le coffre'}
        />
        {error ? (
          <Txt variant="caption" tone="danger">
            {error}
          </Txt>
        ) : null}
      </View>

      {biometrics === 'ready' ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: useBiometrics }}
          accessibilityLabel="Ouvrir aussi par empreinte ou reconnaissance faciale"
          onPress={() => {
            setTouched(true)
            setUseBiometrics((v) => !v)
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: useBiometrics ? theme.accent.default : theme.line.strong,
              backgroundColor: useBiometrics ? theme.accent.default : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {useBiometrics ? <Feather name="check" size={14} color={theme.text.onAccent} /> : null}
          </View>
          <Txt variant="body" tone="secondary" style={{ flex: 1 }}>
            Ouvrir aussi par empreinte. Le code reste le recours si le capteur refuse.
          </Txt>
        </Pressable>
      ) : biometrics === 'not-enrolled' ? (
        <Txt variant="caption" tone="muted">
          Aucune empreinte n’est enregistrée sur cet appareil. Le coffre s’ouvrira au code.
        </Txt>
      ) : null}
    </ScrollView>
  )
}

// ------------------------------------------------------------------ locked

/**
 * What there is to say about a fingerprint request, or nothing.
 *
 * A refusal says nothing: the user has just cancelled, or the system has
 * already told them the finger was not recognised. Repeating it on top only
 * adds a reproach.
 *
 * A busy sensor does: there, no prompt appeared, and without a word the screen
 * is a button that does nothing. The request has just been released, so the
 * next one stands a chance — hence the invitation to retry rather than sending
 * people back to the keypad.
 */
function messagePourEmpreinte(issue: BiometricUnlock): string | null {
  return issue === 'busy' ? 'Le capteur était occupé. Réessayer, ou saisir le code.' : null
}

function Locked({ pendingNote }: { pendingNote: boolean }) {
  const {
    unlockWithPin,
    unlockWithBiometrics,
    cancelBiometrics,
    biometricsEnabled,
    biometrics,
    coolingMs,
    failures,
  } = useVault()
  const { theme } = useTheme()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cooldown = useCooldownLabel(coolingMs)
  const cooling = coolingMs > 0

  // The sensor is offered straight away: if the user turned biometrics on,
  // they want to open in one gesture, not type a code and then find out there
  // was a faster way. Failure or cancelling simply leaves the keypad.
  //
  // A single automatic attempt per mount, hence the flag: without it,
  // cancelling the system request would make it reappear at once, and the
  // keypad would become impossible to reach.
  const demanderEmpreinte = useCallback(async () => {
    setError(messagePourEmpreinte(await unlockWithBiometrics()))
  }, [unlockWithBiometrics])

  const promptedRef = useRef(false)
  useEffect(() => {
    if (promptedRef.current || !biometricsEnabled || biometrics !== 'ready' || cooling) return
    promptedRef.current = true
    void demanderEmpreinte()
  }, [biometricsEnabled, biometrics, cooling, demanderEmpreinte])

  // A prompt left without an answer holds the sensor for the whole app.
  // Releasing it on the way out is what keeps the next one from going nowhere.
  useEffect(() => () => void cancelBiometrics(), [cancelBiometrics])

  const submit = useCallback(async () => {
    const result = await unlockWithPin(pin)
    setPin('')
    if (!result.ok) {
      setError(result.waitMs > 0 ? 'Code refusé. Saisie suspendue.' : 'Code refusé.')
    }
  }, [pin, unlockWithPin])

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, alignItems: 'center' }}>
      {pendingNote ? (
        <View style={{ alignSelf: 'stretch' }}>
          <PendingNoteNotice />
        </View>
      ) : null}

      <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.lg }}>
        <StandingStone
          size={96}
          color={theme.line.strong}
          carveColor={theme.accent.default}
          runes={['algiz']}
        />
        <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
          {cooling ? 'Trop d’essais.' : 'Le coffre est fermé.'}
        </Txt>
      </View>

      <PinPad value={pin} onChange={setPin} onSubmit={() => void submit()} disabled={cooling} />

      {cooling ? (
        <Txt variant="caption" tone="danger">
          {cooldown}
        </Txt>
      ) : error ? (
        <Txt variant="caption" tone="danger">
          {error}
          {failures > 1 ? ` ${failures} essais manqués.` : ''}
        </Txt>
      ) : null}

      {biometricsEnabled && biometrics === 'ready' && !cooling ? (
        <Button
          label="Utiliser l’empreinte"
          variant="ghost"
          onPress={() => void demanderEmpreinte()}
        />
      ) : null}
    </ScrollView>
  )
}

// -------------------------------------------------------------------- open

function Contents({
  claim,
  onClaimSettled,
}: {
  /** Note handed over by the editor, to be filed as soon as the vault opens. */
  claim: string | null
  onClaimSettled: () => void
}) {
  const { theme } = useTheme()
  const router = useRouter()
  const { lock, keyStatus } = useVault()
  const { notes, isLoading } = usePrivateNoteList()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const setNotePrivate = useSetNotePrivate()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const rising = useRise({ distance: 16 })
  const composerRising = useRise({ distance: 16, delay: motion.fast })

  /**
   * The filing promised to the editor, honoured here.
   *
   * Only once, hence the flag: the vault can close and reopen without leaving
   * the screen, and replaying the write on every opening would announce a
   * filing already done.
   *
   * Without a code name, on purpose. Giving one is an editorial choice, and
   * inventing it in the author's place would be worse than silence: it is the
   * only text of a vault note that stays visible from outside.
   */
  const claiming = useRef(false)
  useEffect(() => {
    if (!claim || claiming.current) return
    claiming.current = true
    setNotePrivate.mutate(
      { id: claim, isPrivate: true, codeName: null },
      {
        onSuccess: () => toast('Note rangée dans le coffre.', { tone: 'success' }),
        onError: () => toast('Impossible de ranger la note ici.', { tone: 'danger' }),
        onSettled: onClaimSettled,
      },
    )
  }, [claim, setNotePrivate, toast, onClaimSettled])

  const create = useCallback(
    async (kind: NoteKind) => {
      setCreating(true)
      try {
        // `isPrivate` from the insert on: the note must never have existed in
        // the visible list, not even for the length of a round trip.
        const note = await createNote.mutateAsync({ kind, isPrivate: true })
        router.push(`/note/${note.id}`)
      } finally {
        setCreating(false)
      }
    },
    [createNote, router],
  )

  return (
    <View style={{ flex: 1 }}>
      {/**
       * The vault's content rises as it opens.
       *
       * It is the only place in the app where the animation actually carries
       * information: between the keypad and the grid of hidden notes, nothing
       * changes place on screen, and without movement the switch reads as a
       * jump. The travel is a little longer than elsewhere, the gesture being
       * that of a lid being lifted.
       */}
      <Animated.View style={[{ flex: 1 }, rising]}>
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.lg + 72, gap: space.md }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
              {notes.length === 0
                ? 'Rien de rangé ici.'
                : notes.length === 1
                  ? '1 note rangée'
                  : `${notes.length} notes rangées`}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refermer le coffre"
              onPress={lock}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44 }}
            >
              <Feather name="lock" size={14} color={theme.accent.default} />
              <Txt variant="label" tone="accent">
                Refermer
              </Txt>
            </Pressable>
          </View>

          {/**
           * The key's state comes before the content.
           *
           * Without a key on this device, the notes would display empty: showing
           * a grid of silent cards would suggest an erased vault, when it is only
           * shut by a second lock.
           */}
          {/**
           * The recovery key comes before everything else, and depends on no
           * other state: that is what made it disappear the first time.
           */}
          <RecoveryKeyReveal />
          {keyStatus === 'elsewhere' ? <EncryptionRestore /> : null}
          {keyStatus === 'none' ? <EncryptionSetup /> : null}
          {keyStatus === 'ready' ? <RecoveryKeyRenewal /> : null}

          {keyStatus === 'elsewhere' ? null : isLoading || keyStatus === 'checking' ? (
            <RuneLoader message="On descend dans le coffre…" rune="algiz" />
          ) : notes.length === 0 ? (
            <Card recessed style={{ alignItems: 'center', paddingVertical: space.xxxl, gap: space.md }}>
              <StandingStone size={72} color={theme.line.strong} carveColor={theme.accent.default} />
              <Txt variant="title" tone="secondary">
                Coffre vide
              </Txt>
              <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
                Écris ici, ou range une note existante depuis son éditeur.
              </Txt>
            </Card>
          ) : (
            <MasonryGrid
              items={notes}
              keyExtractor={(n) => n.id}
              estimateHeight={estimateCardHeight}
              renderItem={(note) => (
                <NoteCard
                  note={note}
                  onPress={() => router.push(`/note/${note.id}`)}
                  onTogglePin={() =>
                    updateNote.mutate({ id: note.id, patch: { is_pinned: !note.is_pinned } })
                  }
                />
              )}
            />
          )}
        </ScrollView>
      </Animated.View>

      {/* The buttons follow the content a beat later, rather than appearing in
          the middle of its movement. */}
      <Animated.View
        style={[
          composerRising,
          {
            position: 'absolute',
            right: space.lg,
            bottom: space.lg,
            flexDirection: 'row',
            gap: space.sm,
          },
        ]}
      >
        <ComposerButton
          icon="check-square"
          label="Nouvelle liste dans le coffre"
          busy={creating}
          onPress={() => void create('checklist')}
        />
        <ComposerButton
          icon="plus"
          label="Nouvelle note dans le coffre"
          primary
          busy={creating}
          onPress={() => void create('note')}
        />
      </Animated.View>
    </View>
  )
}
