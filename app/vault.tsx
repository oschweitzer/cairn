import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import { useCreateNote, useUpdateNote } from '@/db/queries'
import { usePrivateNoteList } from '@/db/select'
import type { NoteKind } from '@/db/types'
import { useLockOnLeave, useVault } from '@/vault/VaultProvider'
import { PIN_MIN_LENGTH } from '@/vault/secret'
import { useTheme } from '@/ui/ThemeProvider'
import { Button, Card, Inscription, Txt } from '@/ui/components'
import { MasonryGrid } from '@/ui/MasonryGrid'
import { NoteCard, estimateCardHeight } from '@/ui/NoteCard'
import { PinPad, useCooldownLabel } from '@/ui/PinPad'
import { StandingStone } from '@/ui/runes'
import { radius, space } from '@/ui/theme'

/**
 * Le coffre.
 *
 * Trois états, un seul écran : à configurer, fermé, ouvert. Les séparer en trois
 * routes obligerait à décider laquelle afficher avant de savoir dans quel état
 * on est, et ferait clignoter une redirection au chargement.
 *
 * ── Le fond est la surface creusée ───────────────────────────────────────────
 * Tout l'écran bascule sur `surface.recessed`, la strate la plus sombre du
 * thème. C'est la seule vue de l'application qui le fait. On entre dans la
 * roche, et le changement de fond dit qu'on a changé d'endroit mieux qu'un
 * titre ne le ferait. La référence troglodyte sert alors à quelque chose.
 */
export default function Vault() {
  const { ready, configured, unlocked } = useVault()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  // Quitter l'écran referme. Sans cela, un coffre ouvert puis quitté serait
  // retrouvé ouvert par un simple retour en arrière, plusieurs minutes après.
  useLockOnLeave(true)

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surface.recessed,
        paddingTop: insets.top,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="arrow-left" size={22} color={theme.text.primary} />
        </Pressable>
        <Inscription style={{ flex: 1 }}>Coffre</Inscription>
      </View>

      {!ready ? null : !configured ? <Setup /> : !unlocked ? <Locked /> : <Contents />}
    </View>
  )
}

// ------------------------------------------------------------- configuration

/**
 * Première mise en place du code.
 *
 * Deux saisies, la seconde pour confirmer. Un code défini par erreur et jamais
 * retapé enfermerait les notes derrière une combinaison inconnue, et comme rien
 * n'est chiffré à ce stade, il n'y aurait même pas de récupération à proposer :
 * il faudrait effacer le coffre.
 */
function Setup() {
  const { configure, biometrics } = useVault()
  const { theme } = useTheme()

  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [error, setError] = useState<string | null>(null)
  const [useBiometrics, setUseBiometrics] = useState(biometrics === 'ready')

  // Le sondage biométrique arrive après le premier rendu : la case suit, tant
  // que l'utilisateur n'y a pas touché lui-même.
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
      <Card recessed style={{ gap: space.sm }}>
        <Txt variant="title">Choisir un code</Txt>
        <Txt variant="body" tone="secondary">
          Les notes rangées ici disparaissent de la grille et ne reviennent que
          derrière ce code. Au moins {PIN_MIN_LENGTH} chiffres.
        </Txt>
        {/**
         * Le périmètre est dit à l'utilisateur, pas seulement au développeur.
         * Laisser croire à un chiffrement serait la pire des économies de mots :
         * quelqu'un rangerait ici des choses qui méritent mieux.
         */}
        <Txt variant="caption" tone="muted">
          Ce code masque, il ne chiffre pas. Les notes restent lisibles par qui
          accède à la base{Platform.OS === 'web' ? ', et le code lui-même est stocké dans le navigateur' : ''}.
          Le chiffrement bout en bout viendra plus tard.
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

// ------------------------------------------------------------------- fermé

function Locked() {
  const { unlockWithPin, unlockWithBiometrics, biometricsEnabled, biometrics, coolingMs, failures } =
    useVault()
  const { theme } = useTheme()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cooldown = useCooldownLabel(coolingMs)
  const cooling = coolingMs > 0

  // Le capteur est proposé d'emblée : si l'utilisateur a activé la biométrie,
  // c'est qu'il veut ouvrir d'un geste, pas taper un code puis découvrir qu'il
  // y avait plus rapide. L'échec ou l'annulation laisse simplement le pavé.
  //
  // Une seule tentative automatique par montage, d'où le drapeau : sans lui,
  // annuler la demande système la ferait réapparaître aussitôt, et il
  // deviendrait impossible d'atteindre le pavé.
  const promptedRef = useRef(false)
  useEffect(() => {
    if (promptedRef.current || !biometricsEnabled || biometrics !== 'ready' || cooling) return
    promptedRef.current = true
    void unlockWithBiometrics()
  }, [biometricsEnabled, biometrics, cooling, unlockWithBiometrics])

  const submit = useCallback(async () => {
    const result = await unlockWithPin(pin)
    setPin('')
    if (!result.ok) {
      setError(result.waitMs > 0 ? 'Code refusé. Saisie suspendue.' : 'Code refusé.')
    }
  }, [pin, unlockWithPin])

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, alignItems: 'center' }}>
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
          onPress={() => void unlockWithBiometrics()}
        />
      ) : null}
    </ScrollView>
  )
}

// ------------------------------------------------------------------ ouvert

function Contents() {
  const { theme } = useTheme()
  const router = useRouter()
  const { lock } = useVault()
  const { notes, isLoading } = usePrivateNoteList()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const [creating, setCreating] = useState(false)

  const create = useCallback(
    async (kind: NoteKind) => {
      setCreating(true)
      try {
        // `isPrivate` dès l'insertion : la note ne doit jamais avoir existé
        // dans la liste visible, pas même le temps d'un aller-retour.
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

        {isLoading ? (
          <Card recessed style={{ paddingVertical: space.xxxl, alignItems: 'center' }}>
            <Txt variant="body" tone="muted">
              Chargement.
            </Txt>
          </Card>
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

      <View
        style={{
          position: 'absolute',
          right: space.lg,
          bottom: space.lg,
          flexDirection: 'row',
          gap: space.sm,
        }}
      >
        <VaultComposerButton
          icon="check-square"
          label="Nouvelle liste dans le coffre"
          primary={false}
          busy={creating}
          onPress={() => void create('checklist')}
        />
        <VaultComposerButton
          icon="plus"
          label="Nouvelle note dans le coffre"
          primary
          busy={creating}
          onPress={() => void create('note')}
        />
      </View>
    </View>
  )
}

function VaultComposerButton({
  icon,
  label,
  primary,
  busy,
  onPress,
}: {
  icon: 'plus' | 'check-square'
  label: string
  primary: boolean
  busy: boolean
  onPress: () => void
}) {
  const { theme } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: radius.xl,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: primary
          ? pressed
            ? theme.accent.pressed
            : theme.accent.default
          : theme.line.strong,
        backgroundColor: primary
          ? pressed
            ? theme.accent.pressed
            : theme.accent.default
          : pressed
            ? theme.surface.raised
            : theme.surface.card,
        opacity: busy ? 0.6 : 1,
      })}
    >
      <Feather name={icon} size={22} color={primary ? theme.text.onAccent : theme.text.primary} />
    </Pressable>
  )
}
