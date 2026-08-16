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

  /**
   * Quitter l'onglet ne referme plus le coffre, et c'est un renoncement assumé.
   *
   * Tant que le coffre était un écran empilé, le quitter le détruisait et
   * refermer au démontage ne coûtait rien. Devenu un onglet, il reste monté :
   * le seul crochet équivalent serait la perte de focus — or ouvrir une note du
   * coffre fait précisément perdre le focus à cet écran. Refermer là-dessus
   * claquerait la porte à l'instant où l'on entre.
   *
   * Reste le déclencheur qui porte réellement la protection : cinq minutes sans
   * un geste, où qu'on soit dans l'application et même une fois passé ailleurs,
   * le temps d'absence comptant comme du temps d'inactivité. Le bouton
   * « Refermer » couvre le geste volontaire.
   */

  /**
   * Note que l'éditeur a confiée au coffre en nous y envoyant.
   *
   * Elle est recopiée dans un état local, et non lue directement du paramètre de
   * route, parce qu'elle se consomme : une fois rangée, la mention doit
   * disparaître de l'écran, alors que le paramètre, lui, reste dans l'URL. Le
   * drapeau empêche l'effet de la faire revenir aussitôt.
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
        {/* Le coffre s'atteint désormais par son onglet, où il n'y a rien
            derrière : la flèche n'apparaît que si l'on y est venu depuis
            ailleurs, l'éditeur qui confie une note par exemple. */}
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
 * Rappel de l'intention en cours, tant que le coffre n'est pas ouvert.
 *
 * Sans cette ligne, l'écran de code apparaît sans raison lisible : on a demandé
 * à ranger une note, on se retrouve devant un pavé numérique. Dire pourquoi
 * coûte une phrase et évite d'abandonner en route.
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

// ------------------------------------------------------------- configuration

/**
 * Première mise en place du code.
 *
 * Deux saisies, la seconde pour confirmer. Un code défini par erreur et jamais
 * retapé enfermerait les notes derrière une combinaison inconnue, et comme rien
 * n'est chiffré à ce stade, il n'y aurait même pas de récupération à proposer :
 * il faudrait effacer le coffre.
 */
function Setup({ pendingNote }: { pendingNote: boolean }) {
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
      {pendingNote ? <PendingNoteNotice /> : null}

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

// ------------------------------------------------------------------- fermé

/**
 * Ce qu'il y a à dire d'une demande d'empreinte, ou rien.
 *
 * Un refus ne dit rien : l'utilisateur vient d'annuler, ou le système lui a
 * déjà signalé que le doigt n'était pas reconnu. Répéter par-dessus n'ajoute
 * qu'un reproche.
 *
 * Un capteur occupé, si : là, aucune invite n'est apparue, et sans un mot
 * l'écran est un bouton qui ne fait rien. La demande vient d'être rendue, donc
 * la suivante a des chances d'aboutir — d'où l'invitation à réessayer plutôt
 * qu'un renvoi au pavé.
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

  // Le capteur est proposé d'emblée : si l'utilisateur a activé la biométrie,
  // c'est qu'il veut ouvrir d'un geste, pas taper un code puis découvrir qu'il
  // y avait plus rapide. L'échec ou l'annulation laisse simplement le pavé.
  //
  // Une seule tentative automatique par montage, d'où le drapeau : sans lui,
  // annuler la demande système la ferait réapparaître aussitôt, et il
  // deviendrait impossible d'atteindre le pavé.
  const demanderEmpreinte = useCallback(async () => {
    setError(messagePourEmpreinte(await unlockWithBiometrics()))
  }, [unlockWithBiometrics])

  const promptedRef = useRef(false)
  useEffect(() => {
    if (promptedRef.current || !biometricsEnabled || biometrics !== 'ready' || cooling) return
    promptedRef.current = true
    void demanderEmpreinte()
  }, [biometricsEnabled, biometrics, cooling, demanderEmpreinte])

  // Une invite quittée sans réponse garde le capteur pour toute l'application.
  // La rendre en sortant est ce qui évite que la prochaine parte dans le vide.
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

// ------------------------------------------------------------------ ouvert

function Contents({
  claim,
  onClaimSettled,
}: {
  /** Note confiée par l'éditeur, à ranger dès l'ouverture. */
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
   * Le rangement promis à l'éditeur, honoré ici.
   *
   * Une seule fois, d'où le drapeau : le coffre peut se refermer et se rouvrir
   * sans quitter l'écran, et rejouer l'écriture à chaque ouverture annoncerait
   * un rangement déjà fait.
   *
   * Sans nom de code, délibérément. En donner un est un choix éditorial, et
   * l'inventer à la place de l'auteur serait pire que le silence : c'est le seul
   * texte d'une note du coffre qui reste visible de l'extérieur.
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
      {/**
       * Le contenu du coffre se lève à l'ouverture.
       *
       * C'est le seul endroit de l'application où l'animation porte réellement
       * une information : entre le pavé numérique et la grille des notes
       * masquées, rien ne change de place à l'écran, et sans mouvement le
       * basculement se lit comme un saut. La course est un peu plus longue
       * qu'ailleurs, le geste étant celui d'un couvercle qu'on soulève.
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
           * L'état de la clé passe avant le contenu.
           *
           * Sans clé sur cet appareil, les notes s'afficheraient vides : montrer
           * une grille de cartes muettes ferait croire à un coffre effacé, alors
           * qu'il n'est que fermé d'une seconde serrure.
           */}
          {/**
           * La clé de secours passe avant tout le reste, et ne dépend d'aucun
           * autre état : c'est ce qui l'a fait disparaître la première fois.
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

      {/* Les boutons suivent le contenu d'un temps, plutôt que d'apparaître au
          milieu de son mouvement. */}
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
