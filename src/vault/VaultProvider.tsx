import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import {
  clearSecret,
  createSecret,
  readSecret,
  verifyPin,
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
  lock: () => void
  /** Supprime le code. Les notes masquées le restent, elles redeviennent simplement inaccessibles jusqu'à un nouveau code. */
  disable: () => Promise<void>
  setBiometricsEnabled: (next: boolean) => Promise<void>
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

  const lock = useCallback(() => setUnlocked(false), [])

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

  const disable = useCallback(async () => {
    await clearSecret()
    setSecret(null)
    setUnlocked(false)
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
      lock,
      disable,
      setBiometricsEnabled,
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
      lock,
      disable,
      setBiometricsEnabled,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault doit être appelé dans un VaultProvider')
  return ctx
}

/**
 * Referme le coffre quand l'écran qui appelle ce hook est démonté.
 *
 * Utilisé par l'écran du coffre lui-même : quitter la vue referme, ce qui évite
 * qu'un coffre resté ouvert dans une pile de navigation soit retrouvé ouvert
 * plusieurs minutes plus tard par un simple retour en arrière.
 */
export function useLockOnLeave(active: boolean) {
  const { lock } = useVault()
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    return () => {
      if (activeRef.current) lock()
    }
  }, [lock])
}
