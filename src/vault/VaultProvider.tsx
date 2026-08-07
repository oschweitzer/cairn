import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AppState, Platform } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js'
import { getSupabase, isSupabaseConfigured } from '../db/supabase'
import {
  createDataKey,
  createRecoveryKey,
  formatRecoveryKey,
  parseRecoveryKey,
  unwrapDataKey,
  wrapDataKey,
} from './crypto'
import { loadDataKey, platformRandom, unloadDataKey } from './keyring'
import { encryptExistingVaultNotes } from './migrate'
import {
  clearDataKey,
  clearSecret,
  createSecret,
  readDataKey,
  readSecret,
  verifyPin,
  writeDataKey,
  writeSecret,
  type VaultSecret,
} from './secret'

/**
 * État du coffre : configuré ou non, verrouillé ou non, et par quels moyens on
 * en sort.
 *
 * ── Le verrouillage automatique est le cœur du sujet ─────────────────────────
 * Un coffre qui ne se referme jamais ne protège rien. Deux déclencheurs, qui
 * couvrent des situations différentes.
 *
 * Le passage en arrière-plan ferme immédiatement. C'est la situation réelle :
 * on pose le téléphone, quelqu'un le reprend. Attendre ne serait qu'une
 * fenêtre offerte.
 *
 * Un délai absolu de cinq minutes depuis l'ouverture ferme aussi, même si
 * l'application est restée au premier plan. Absolu et non « depuis la dernière
 * interaction », parce qu'un délai d'inactivité se prolonge indéfiniment tant
 * qu'on fait défiler la liste, ce qui est exactement le moment où le coffre est
 * visible à l'écran.
 *
 * ── Ce que le déverrouillage donne accès ─────────────────────────────────────
 * Uniquement à la lecture de la liste masquée. Les notes du coffre ne sont pas
 * chargées tant que le coffre est fermé, et leur clé de cache ne descend jamais
 * sur le disque : refermer ne se contente pas de masquer une vue, cela retire
 * les données de la mémoire du cache.
 */

const AUTO_LOCK_MS = 5 * 60_000

export type BiometricSupport =
  /** Matériel présent et au moins une empreinte ou un visage enregistré. */
  | 'ready'
  /** Matériel présent mais rien d'enregistré : proposer d'aller le configurer. */
  | 'not-enrolled'
  /** Pas de matériel, ou plateforme sans prise en charge (le web). */
  | 'unavailable'

/**
 * Où en est la clé de données, qui est ce qui chiffre réellement les notes.
 *
 * Quatre états et non deux, parce que « pas de clé ici » ne veut pas dire la
 * même chose selon qu'il en existe une ailleurs. Sur un appareil neuf, en créer
 * une seconde rendrait les notes déjà chiffrées définitivement illisibles : il
 * faut au contraire réclamer la clé de secours. C'est la distinction que porte
 * `elsewhere`, et c'est la plus importante des quatre.
 */
export type KeyStatus =
  /** On interroge encore le serveur. */
  | 'checking'
  /** Aucune clé, ni ici ni là-bas : le chiffrement n'a jamais été activé. */
  | 'none'
  /** La clé est sur cet appareil et chargée. */
  | 'ready'
  /** Une clé scellée existe côté serveur, mais pas sur cet appareil. */
  | 'elsewhere'

type VaultContextValue = {
  /** Faux jusqu'à la lecture du secret stocké. */
  ready: boolean
  /** Un code a déjà été défini. */
  configured: boolean
  unlocked: boolean
  biometrics: BiometricSupport
  /** L'utilisateur a activé le déverrouillage biométrique. */
  biometricsEnabled: boolean
  /** Millisecondes restantes avant qu'une saisie soit à nouveau acceptée. */
  coolingMs: number
  failures: number
  configure: (pin: string, useBiometrics: boolean) => Promise<void>
  unlockWithPin: (pin: string) => Promise<{ ok: boolean; waitMs: number }>
  unlockWithBiometrics: () => Promise<boolean>
  /**
   * Confirme que c'est bien le propriétaire de l'appareil, sans ouvrir le
   * coffre. Sert à garder les gestes qui désarment le coffre lui-même.
   *
   * Trois issues et non deux : « pas de capteur » n'est pas « refusé ». Les
   * confondre condamnerait tout appareil sans lecteur d'empreinte, le web en
   * tête, à ne plus jamais pouvoir remplacer un code oublié.
   */
  confirmWithBiometrics: (reason: string) => Promise<'confirmed' | 'refused' | 'unavailable'>
  lock: () => void
  /** Supprime le code. Les notes masquées le restent, elles redeviennent simplement inaccessibles jusqu'à un nouveau code. */
  disable: () => Promise<void>
  /**
   * Efface du stockage tout ce que le coffre y garde : le code ET la clé de
   * données. Réservé à la suppression du compte — partout ailleurs c'est
   * `disable` qu'il faut, qui préserve la clé pour qu'un code oublié ne coûte
   * pas les notes chiffrées.
   */
  forgetEverything: () => Promise<void>
  setBiometricsEnabled: (next: boolean) => Promise<void>

  // ------------------------------------------------------------ chiffrement

  keyStatus: KeyStatus
  /**
   * Clé de secours à montrer, mise en forme. Elle vit ici et non dans l'écran
   * qui l'a demandée, et c'est une correction, pas un raffinement : la première
   * version la gardait dans l'état du composant de mise en place, lequel
   * disparaissait au moment précis où le chiffrement s'activait — la condition
   * qui l'affichait cessait d'être vraie. La clé était donc créée, utilisée,
   * puis jetée avec le composant, sans que personne ne l'ait lue.
   */
  pendingRecoveryKey: string | null
  /** L'utilisateur déclare l'avoir notée. Rien ne la réaffichera. */
  acknowledgeRecoveryKey: () => void
  /** Met le chiffrement en place, notes déjà rangées comprises. */
  enableEncryption: () => Promise<{ encryptedNotes: number }>
  /**
   * Réenveloppe la clé de données sous une clé de secours neuve.
   *
   * L'ancienne cesse aussitôt de fonctionner. Sert quand on l'a perdue, ou
   * qu'on la soupçonne vue par quelqu'un d'autre — et rattrape le cas où elle
   * n'a jamais été affichée. Exige la clé de données en mémoire, donc un coffre
   * ouvert : sans elle, il n'y aurait rien à envelopper.
   */
  regenerateRecoveryKey: () => Promise<void>
  /**
   * Retrouve la clé de données sur un appareil neuf, à partir de la clé de
   * secours saisie à la main.
   */
  restoreWithRecoveryKey: (input: string) => Promise<'restored' | 'malformed' | 'wrong-key'>
}

const VaultContext = createContext<VaultContextValue | null>(null)

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [secret, setSecret] = useState<VaultSecret | null>(null)
  const [ready, setReady] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [biometrics, setBiometrics] = useState<BiometricSupport>('unavailable')
  const [coolingMs, setCoolingMs] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const stored = await readSecret()
      if (cancelled) return
      setSecret(stored)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Capacités biométriques de l'appareil. Sondées une fois : elles ne changent
  // pas pendant l'exécution, sauf à aller inscrire une empreinte dans les
  // réglages système, ce qui repasse par un arrêt de l'application.
  useEffect(() => {
    if (Platform.OS === 'web') return
    let cancelled = false
    void (async () => {
      const [hardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ])
      if (cancelled) return
      setBiometrics(!hardware ? 'unavailable' : enrolled ? 'ready' : 'not-enrolled')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const [keyStatus, setKeyStatus] = useState<KeyStatus>('checking')
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null)

  const acknowledgeRecoveryKey = useCallback(() => setPendingRecoveryKey(null), [])

  /**
   * Fermer le coffre retire la clé de la mémoire, pas du stockage.
   *
   * C'est la moitié qui compte : tant que la clé est chargée, tout ce que le
   * cache contient est déchiffrable. La rendre au stockage sécurisé à chaque
   * fermeture — cinq minutes, passage en arrière-plan, sortie de l'écran —
   * donne au verrouillage automatique un effet réel et pas seulement visuel.
   */
  const lock = useCallback(() => {
    unloadDataKey()
    setUnlocked(false)
    setKeyStatus((current) => (current === 'ready' ? 'checking' : current))
  }, [])

  /**
   * Établit où se trouve la clé de données, et la charge si elle est ici.
   *
   * L'ordre n'est pas indifférent : on regarde l'appareil d'abord. Trouver la
   * clé localement dispense d'un aller-retour réseau à chaque ouverture, et
   * surtout laisse le coffre s'ouvrir hors ligne, ce qui est la moitié de
   * l'intérêt d'une application de notes.
   */
  const resolveKey = useCallback(async () => {
    const local = await readDataKey()
    if (local) {
      loadDataKey(hexToBytes(local))
      setKeyStatus('ready')
      return
    }
    if (!isSupabaseConfigured) {
      setKeyStatus('none')
      return
    }
    const { data } = await getSupabase().from('vault_keys').select('wrapped_key').maybeSingle()
    setKeyStatus(data?.wrapped_key ? 'elsewhere' : 'none')
  }, [])

  // La clé n'est cherchée qu'une fois le coffre ouvert : avant, il n'y a rien à
  // déchiffrer, et interroger le serveur signalerait l'existence d'un coffre à
  // qui regarde le réseau.
  useEffect(() => {
    if (!unlocked) return
    let cancelled = false
    void (async () => {
      await resolveKey()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [unlocked, resolveKey])

  // Refermeture au passage en arrière-plan. `inactive` compte aussi : sur iOS
  // c'est l'état du sélecteur d'applications, où le contenu est visible en
  // vignette.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') lock()
    })
    return () => sub.remove()
  }, [lock])

  // Délai absolu depuis l'ouverture.
  useEffect(() => {
    if (!unlocked) return
    const timer = setTimeout(lock, AUTO_LOCK_MS)
    return () => clearTimeout(timer)
  }, [unlocked, lock])

  // Décompte de la temporisation après échecs, pour que l'écran de saisie
  // affiche un délai qui descend au lieu d'un refus opaque.
  const lockedUntil = secret?.lockedUntil ?? null
  useEffect(() => {
    if (lockedUntil === null) {
      setCoolingMs(0)
      return
    }
    const tick = () => setCoolingMs(Math.max(0, lockedUntil - Date.now()))
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [lockedUntil])

  const persist = useCallback(async (next: VaultSecret) => {
    setSecret(next)
    await writeSecret(next)
  }, [])

  const configure = useCallback(
    async (pin: string, useBiometrics: boolean) => {
      const next = await createSecret(pin, useBiometrics)
      await persist(next)
      // Définir le code ouvre le coffre : redemander la saisie dans la seconde
      // qui suit serait de la cérémonie sans bénéfice.
      setUnlocked(true)
    },
    [persist],
  )

  const unlockWithPin = useCallback(
    async (pin: string) => {
      if (!secret) return { ok: false, waitMs: 0 }
      const verdict = await verifyPin(pin, secret)
      await persist(verdict.secret)
      if (verdict.ok) {
        setUnlocked(true)
        return { ok: true, waitMs: 0 }
      }
      return { ok: false, waitMs: verdict.waitMs }
    },
    [secret, persist],
  )

  /**
   * Le déverrouillage biométrique n'est proposé qu'en complément du code, jamais
   * à sa place : le code reste le moyen de secours quand le capteur refuse, et
   * c'est lui qui a servi à créer le secret.
   */
  const unlockWithBiometrics = useCallback(async () => {
    if (Platform.OS === 'web' || !secret?.biometrics || biometrics !== 'ready') return false
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Ouvrir le coffre',
      cancelLabel: 'Utiliser le code',
      // Le repli système proposerait le code de déverrouillage de l'appareil,
      // qui n'est pas celui du coffre. Deux codes différents dans le même geste
      // est une confusion garantie.
      disableDeviceFallback: true,
    })
    if (!result.success) return false
    setUnlocked(true)
    return true
  }, [secret, biometrics])

  /**
   * Garde d'identité pour les gestes qui désarment le coffre.
   *
   * Le repli sur le code de l'appareil est ici autorisé, alors que le
   * déverrouillage ordinaire le refuse. Ce n'est pas une incohérence : là-bas,
   * proposer le code de l'appareil à la place du code du coffre est une
   * confusion garantie, puisque les deux ouvrent la même chose. Ici, c'est le
   * seul recours quand le doigt est mouillé — et sans lui, un capteur récalcitrant
   * enfermerait définitivement quelqu'un qui a déjà oublié son code.
   */
  const confirmWithBiometrics = useCallback<VaultContextValue['confirmWithBiometrics']>(
    async (reason) => {
      if (Platform.OS === 'web' || biometrics !== 'ready') return 'unavailable'
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        cancelLabel: 'Annuler',
        disableDeviceFallback: false,
      })
      return result.success ? 'confirmed' : 'refused'
    },
    [biometrics],
  )

  /**
   * Met le chiffrement en place.
   *
   * L'ordre des écritures est le point délicat : la clé scellée part au serveur
   * AVANT que la clé de données ne soit posée sur l'appareil. Dans l'autre sens,
   * une coupure réseau laisserait une clé locale qui chiffre des notes sans que
   * rien, nulle part, ne permette de les retrouver ailleurs — un coffre à sens
   * unique, dont on ne s'apercevrait qu'en changeant de téléphone.
   */
  const publishWrappedKey = useCallback(async (dataKey: Uint8Array) => {
    const recoveryKey = createRecoveryKey(platformRandom)
    const wrapped = wrapDataKey(dataKey, recoveryKey, platformRandom)
    const { error } = await getSupabase()
      .from('vault_keys')
      .upsert({ wrapped_key: wrapped }, { onConflict: 'user_id' })
    if (error) throw error
    return formatRecoveryKey(recoveryKey)
  }, [])

  const enableEncryption = useCallback<VaultContextValue['enableEncryption']>(async () => {
    const dataKey = createDataKey(platformRandom)
    const shown = await publishWrappedKey(dataKey)

    await writeDataKey(bytesToHex(dataKey))
    loadDataKey(dataKey)

    // Les notes déjà rangées sont chiffrées avant que le chiffrement ne soit
    // déclaré actif : à l'arrivée, le coffre est cohérent ou il n'a pas bougé.
    const { notes } = await encryptExistingVaultNotes()

    // La clé est posée avant `keyStatus`, et l'ordre est tout : c'est le
    // passage à `ready` qui démonte l'écran de mise en place. Poser la clé
    // après, c'est la poser dans le vide.
    setPendingRecoveryKey(shown)
    setKeyStatus('ready')
    return { encryptedNotes: notes }
  }, [publishWrappedKey])

  const regenerateRecoveryKey = useCallback(async () => {
    // Relue du stockage plutôt que sortie du trousseau : celui-ci ne rend
    // jamais la clé, il ne fait que s'en servir. C'est ce qui garantit qu'elle
    // ne se promène pas dans l'application.
    const stored = await readDataKey()
    if (!stored) throw new Error('Clé de données absente sur cet appareil.')
    setPendingRecoveryKey(await publishWrappedKey(hexToBytes(stored)))
  }, [publishWrappedKey])

  const restoreWithRecoveryKey = useCallback<VaultContextValue['restoreWithRecoveryKey']>(
    async (input) => {
      // Trois issues distinctes, parce que la conduite à tenir diffère : une clé
      // mal recopiée se corrige, une clé qui ne correspond pas veut dire qu'on
      // tient celle d'un autre coffre.
      const recoveryKey = parseRecoveryKey(input)
      if (!recoveryKey) return 'malformed'

      const { data } = await getSupabase().from('vault_keys').select('wrapped_key').maybeSingle()
      if (!data?.wrapped_key) return 'wrong-key'

      const dataKey = unwrapDataKey(data.wrapped_key, recoveryKey)
      if (!dataKey) return 'wrong-key'

      await writeDataKey(bytesToHex(dataKey))
      loadDataKey(dataKey)
      setKeyStatus('ready')
      return 'restored'
    },
    [],
  )

  const disable = useCallback(async () => {
    await clearSecret()
    setSecret(null)
    setUnlocked(false)
  }, [])

  /**
   * Efface du stockage tout ce que le coffre y a déposé : le code et la clé de
   * données. Accompagne la suppression du compte, et rien d'autre.
   *
   * `disable` ne convient pas ici, et la différence est le cœur du sujet : il
   * retire le code en gardant la clé, précisément pour qu'un code oublié ne
   * coûte pas les notes chiffrées. Ce qui est la bonne réponse là-bas est la
   * mauvaise ici — laisser la clé derrière soi reviendrait à garder de quoi
   * déchiffrer des notes dont on vient de promettre qu'elles n'existent plus.
   *
   * Appelé même sans coffre configuré : une clé peut avoir survécu à un
   * `disable`, ce qui est justement sa raison d'être. Effacer une entrée absente
   * ne coûte rien.
   */
  const forgetEverything = useCallback(async () => {
    unloadDataKey()
    await Promise.all([clearSecret(), clearDataKey()])
    setSecret(null)
    setUnlocked(false)
    setKeyStatus('none')
    setPendingRecoveryKey(null)
  }, [])

  const setBiometricsEnabled = useCallback(
    async (next: boolean) => {
      if (!secret) return
      await persist({ ...secret, biometrics: next })
    },
    [secret, persist],
  )

  const value = useMemo<VaultContextValue>(
    () => ({
      ready,
      configured: secret !== null,
      unlocked,
      biometrics,
      biometricsEnabled: secret?.biometrics === true,
      coolingMs,
      failures: secret?.failures ?? 0,
      configure,
      unlockWithPin,
      unlockWithBiometrics,
      confirmWithBiometrics,
      lock,
      disable,
      forgetEverything,
      setBiometricsEnabled,
      keyStatus,
      pendingRecoveryKey,
      acknowledgeRecoveryKey,
      enableEncryption,
      regenerateRecoveryKey,
      restoreWithRecoveryKey,
    }),
    [
      ready,
      secret,
      unlocked,
      biometrics,
      coolingMs,
      configure,
      unlockWithPin,
      unlockWithBiometrics,
      confirmWithBiometrics,
      lock,
      disable,
      forgetEverything,
      setBiometricsEnabled,
      keyStatus,
      pendingRecoveryKey,
      acknowledgeRecoveryKey,
      enableEncryption,
      regenerateRecoveryKey,
      restoreWithRecoveryKey,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault doit être appelé dans un VaultProvider')
  return ctx
}

