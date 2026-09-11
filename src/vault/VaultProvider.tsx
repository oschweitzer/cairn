import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Platform, View } from 'react-native'
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
import { AUTO_LOCK_MS, msBeforeAutoLock } from './policy'
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
 * Vault state: configured or not, locked or not, and by what means you get out.
 *
 * ── Automatic locking is the heart of the matter ─────────────────────────────
 * A vault that never closes protects nothing. A single rule now, and it fits in
 * one sentence: five minutes without doing anything close the vault.
 *
 * Without doing anything, and not "without being in the foreground". The
 * previous version closed on going to the background, immediately — a tab
 * glanced at on the side, an address copied into another app, the screen going
 * dark for a second, and the code had to be typed again. The vault was opened
 * ten times per work session, which wears out the only protection there is and
 * pushes people to pick a short code.
 *
 * What is lost is real and said plainly: a phone picked up from the table while
 * Cairn is in the background now gets whatever remains of the five minutes,
 * where it used to get nothing. On iOS the app switcher also shows a thumbnail
 * of the screen that was left. The trade is made knowingly: a door left ajar
 * for five minutes, against a door people ended up no longer closing.
 *
 * Time spent elsewhere counts as idle time — it does not pause the counter.
 * Coming back after ten seconds finds the vault open, coming back after six
 * minutes finds it closed.
 *
 * ── What "doing something" means ─────────────────────────────────────────────
 * A gesture in the app: touching, scrolling, clicking, typing. Not a render, not
 * a request, not a return to the foreground — otherwise the counter would be
 * reset by the app itself and would no longer measure anything.
 *
 * ── What unlocking gives access to ───────────────────────────────────────────
 * Only to reading the hidden list. Vault notes are not loaded while the vault
 * is closed, and their cache key never goes down to the disk: closing does not
 * merely hide a view, it removes the data from the cache's memory.
 *
 * The threshold and the time-left computation live in policy.ts, with the rest
 * of the vault rules that are tested under Node.
 */

/** What a request for a fingerprint came to. */
export type BiometricUnlock =
  /** The vault is open. */
  | 'unlocked'
  /** Cancelled or not recognised. The pad is the way through. */
  | 'refused'
  /** The sensor is held by a request that never finished. */
  | 'busy'
  /** No sensor, nothing enrolled, or biometrics not turned on for this vault. */
  | 'unavailable'

export type BiometricSupport =
  /** Hardware present and at least one fingerprint or face enrolled. */
  | 'ready'
  /** Hardware present but nothing enrolled: offer to go and set it up. */
  | 'not-enrolled'
  /** No hardware, or a platform without support (the web). */
  | 'unavailable'

/**
 * Where the data key stands, the key that actually encrypts the notes.
 *
 * Four states and not two, because "no key here" does not mean the same thing
 * depending on whether one exists elsewhere. On a new device, creating a second
 * one would make the notes already encrypted permanently unreadable: the
 * recovery key must be asked for instead. That is the distinction `elsewhere`
 * carries, and it is the most important of the four.
 */
export type KeyStatus =
  /** Still asking the server. */
  | 'checking'
  /** No key, neither here nor there: encryption has never been turned on. */
  | 'none'
  /** The key is on this device, and loaded. */
  | 'ready'
  /** A sealed key exists on the server, but not on this device. */
  | 'elsewhere'

type VaultContextValue = {
  /** False until the stored secret has been read. */
  ready: boolean
  /** A code has already been set. */
  configured: boolean
  unlocked: boolean
  biometrics: BiometricSupport
  /** The user has turned on biometric unlocking. */
  biometricsEnabled: boolean
  /** Milliseconds left before an entry is accepted again. */
  coolingMs: number
  failures: number
  /**
   * Pushes automatic closing back by another five minutes.
   *
   * To be called for a gesture the provider cannot see by itself, and there is
   * only one: typing on the software keyboard. Touching, scrolling, clicking,
   * typing on a physical keyboard are already counted — but on a phone the keys
   * belong to the system keyboard, outside the app's tree. Without this call,
   * writing a vault note for six minutes straight would make it vanish under the
   * fingers of the person writing it, which is precisely what an idle delay is
   * meant to prevent.
   *
   * Never call it for a render, a request or a return to the foreground: the
   * counter would then measure the app's activity, and no longer its user's.
   */
  markActivity: () => void
  configure: (pin: string, useBiometrics: boolean) => Promise<void>
  unlockWithPin: (pin: string) => Promise<{ ok: boolean; waitMs: number }>
  unlockWithBiometrics: () => Promise<BiometricUnlock>
  /**
   * Drops a prompt left hanging, so it does not block the next one. To be
   * called when leaving the screen that asked for it.
   */
  cancelBiometrics: () => Promise<void>
  /**
   * Confirms it really is the device's owner, without opening the vault. Used
   * to guard the gestures that disarm the vault itself.
   *
   * Three outcomes and not two: "no sensor" is not "refused". Mixing them up
   * would condemn every device without a fingerprint reader, the web first, to
   * never again be able to replace a forgotten code.
   */
  confirmWithBiometrics: (reason: string) => Promise<'confirmed' | 'refused' | 'unavailable'>
  lock: () => void
  /** Removes the code. Hidden notes stay hidden, they simply become unreachable until a new code is set. */
  disable: () => Promise<void>
  /**
   * Erases from storage everything the vault keeps there: the code AND the data
   * key. Reserved for account deletion — everywhere else `disable` is what you
   * want, which keeps the key so that a forgotten code does not cost the
   * encrypted notes.
   */
  forgetEverything: () => Promise<void>
  setBiometricsEnabled: (next: boolean) => Promise<void>

  // ------------------------------------------------------------- encryption

  keyStatus: KeyStatus
  /**
   * Recovery key to show, formatted. It lives here and not in the screen that
   * asked for it, and that is a fix, not a refinement: the first version kept it
   * in the state of the setup component, which disappeared at the very moment
   * encryption turned on — the condition that displayed it stopped being true.
   * So the key was created, used, then thrown away with the component, without
   * anyone having read it.
   */
  pendingRecoveryKey: string | null
  /** The user says they have written it down. Nothing will show it again. */
  acknowledgeRecoveryKey: () => void
  /** Sets encryption up, notes already in the vault included. */
  enableEncryption: () => Promise<{ encryptedNotes: number }>
  /**
   * Rewraps the data key under a fresh recovery key.
   *
   * The old one stops working at once. Used when it has been lost, or is
   * suspected to have been seen by someone else — and catches the case where it
   * was never displayed. Requires the data key in memory, so an open vault:
   * without it, there would be nothing to wrap.
   */
  regenerateRecoveryKey: () => Promise<void>
  /**
   * Gets the data key back on a new device, from the recovery key typed in by
   * hand.
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

  /**
   * A fingerprint request is in progress.
   *
   * A ref and not state: the value is used to decide on the spot, and one more
   * render would change nothing on screen.
   */
  const demandeEnCours = useRef(false)

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

  // The device's biometric capabilities. Probed once: they do not change while
  // running, short of enrolling a fingerprint in the system settings, which goes
  // through the app being stopped.
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
   * Closing the vault removes the key from memory, not from storage.
   *
   * That is the half that matters: as long as the key is loaded, everything the
   * cache holds can be decrypted. Handing it back to secure storage on every
   * close — five minutes without a gesture, or the « Refermer » button — gives
   * automatic locking a real effect and not merely a visual one.
   */
  const lock = useCallback(() => {
    unloadDataKey()
    setUnlocked(false)
    setKeyStatus((current) => (current === 'ready' ? 'checking' : current))
  }, [])

  /**
   * Works out where the data key is, and loads it if it is here.
   *
   * The order matters: the device is checked first. Finding the key locally
   * saves a network round trip on every opening, and above all lets the vault
   * open offline, which is half the point of a notes app.
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

  // The key is only looked for once the vault is open: before that there is
  // nothing to decrypt, and asking the server would reveal that a vault exists
  // to anyone watching the network.
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

  /**
   * Time of the last gesture. A ref and not state: a touch must not redraw
   * anything, and one arrives with every finger movement.
   */
  const lastActivity = useRef(Date.now())
  const markActivity = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  /**
   * On the web, gestures are read from the document.
   *
   * The responder capture set further down is enough for native platforms, but
   * it sees neither the mouse wheel nor the physical keyboard: reading a long
   * note with the wheel, or writing it on the keyboard without touching the
   * mouse, would pass for inactivity.
   */
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const mark = () => markActivity()
    // In the capture phase, so nothing can stop the event before us; passive,
    // because all we do is note the time.
    const options = { capture: true, passive: true } as const
    document.addEventListener('pointerdown', mark, options)
    document.addEventListener('keydown', mark, options)
    document.addEventListener('wheel', mark, options)
    return () => {
      document.removeEventListener('pointerdown', mark, options)
      document.removeEventListener('keydown', mark, options)
      document.removeEventListener('wheel', mark, options)
    }
  }, [markActivity])

  /**
   * Closing after five minutes without a gesture.
   *
   * The timer decides nothing: every time it wakes it asks `msBeforeAutoLock`
   * what is left, and sleeps again for that remainder as long as it is not zero.
   * That is what makes it immune to its own lateness, and what makes the gesture
   * free — marking activity has nothing to reschedule, the timer notices by
   * itself when it arrives.
   */
  useEffect(() => {
    if (!unlocked) return
    let timer: ReturnType<typeof setTimeout>
    const check = () => {
      const left = msBeforeAutoLock(lastActivity.current, Date.now())
      if (left === 0) {
        lock()
        return
      }
      timer = setTimeout(check, left)
    }
    timer = setTimeout(check, AUTO_LOCK_MS)
    return () => clearTimeout(timer)
  }, [unlocked, lock])

  /**
   * Back to the foreground: we look at the clock, we reset nothing.
   *
   * A suspended app does not run its timers, and on the web a hidden tab slows
   * them down. Without this check, coming back after an hour would leave the
   * vault open for as long as the sleeping timer takes to notice it is late —
   * that is, long enough to read everything.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      if (msBeforeAutoLock(lastActivity.current, Date.now()) === 0) lock()
    })
    return () => sub.remove()
  }, [lock])

  // Countdown of the cool-down after failures, so the entry screen shows a delay
  // ticking down instead of an opaque refusal.
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
      // Setting the code opens the vault: asking for it again the next second
      // would be ceremony with no benefit.
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
   * Biometric unlocking is only offered alongside the code, never instead of
   * it: the code stays the fallback when the sensor refuses, and it is what was
   * used to create the secret.
   */
  const unlockWithBiometrics = useCallback(async (): Promise<BiometricUnlock> => {
    if (Platform.OS === 'web' || !secret?.biometrics || biometrics !== 'ready') return 'unavailable'
    // Two requests at once do not give two prompts: the second returns at once,
    // and leaves the module in a state it does not come back from. The guard is
    // here because the locked screen starts one on mount, while the button stays
    // under the finger.
    if (demandeEnCours.current) return 'busy'
    demandeEnCours.current = true
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Ouvrir le coffre',
        cancelLabel: 'Utiliser le code',
        // The system fallback would offer the device's unlock code, which is not
        // the vault's. Two different codes in the same gesture is guaranteed
        // confusion.
        disableDeviceFallback: true,
      })
      if (result.success) {
        setUnlocked(true)
        return 'unlocked'
      }
      /**
       * `app_cancel` without any prompt having appeared means the module still
       * believes it is busy with a previous request: it keeps a single flag,
       * and answers without showing anything as long as it believes it is set
       * (`LocalAuthenticationModule.kt`, `if (isAuthenticating)`). Nothing
       * clears it by itself — hence a button that does nothing any more,
       * silently and until a restart.
       *
       * An explicit cancel is what clears it. We do not retry right away: the
       * next request has to come from the user, otherwise a prompt would pop up
       * without their having asked for it.
       */
      if (result.error === 'app_cancel') {
        await LocalAuthentication.cancelAuthenticate()
        return 'busy'
      }
      return 'refused'
    } finally {
      demandeEnCours.current = false
    }
  }, [secret, biometrics])

  /**
   * Drops a prompt left hanging.
   *
   * The module keeps one flag for the whole app: a prompt left without an
   * answer leaves it set, and every following request returns at once without
   * showing anything. Cancelling on the way out is what avoids leaving that flag
   * behind.
   */
  const cancelBiometrics = useCallback(async () => {
    if (Platform.OS === 'web' || !demandeEnCours.current) return
    await LocalAuthentication.cancelAuthenticate()
  }, [])

  /**
   * Identity guard for the gestures that disarm the vault.
   *
   * Falling back on the device code is allowed here, whereas ordinary unlocking
   * refuses it. That is not an inconsistency: there, offering the device code
   * instead of the vault code is guaranteed confusion, since both open the same
   * thing. Here, it is the only way out when the finger is wet — and without it,
   * a stubborn sensor would lock out for good someone who has already forgotten
   * their code.
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
   * Sets encryption up.
   *
   * The order of the writes is the delicate part: the sealed key goes to the
   * server BEFORE the data key is written to the device. The other way round, a
   * network cut would leave a local key encrypting notes with nothing, anywhere,
   * to get them back elsewhere — a one-way vault, noticed only on changing
   * phones.
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

    // Notes already in the vault are encrypted before encryption is declared
    // active: at the end, the vault is consistent or it has not moved.
    const { notes } = await encryptExistingVaultNotes()

    // The key is set before `keyStatus`, and the order is everything: switching
    // to `ready` is what unmounts the setup screen. Setting the key afterwards
    // means setting it into the void.
    setPendingRecoveryKey(shown)
    setKeyStatus('ready')
    return { encryptedNotes: notes }
  }, [publishWrappedKey])

  const regenerateRecoveryKey = useCallback(async () => {
    // Read back from storage rather than taken out of the keyring: the keyring
    // never hands the key out, it only uses it. That is what guarantees it does
    // not wander around the app.
    const stored = await readDataKey()
    if (!stored) throw new Error('Clé de données absente sur cet appareil.')
    setPendingRecoveryKey(await publishWrappedKey(hexToBytes(stored)))
  }, [publishWrappedKey])

  const restoreWithRecoveryKey = useCallback<VaultContextValue['restoreWithRecoveryKey']>(
    async (input) => {
      // Three distinct outcomes, because what to do differs: a mistyped key can
      // be corrected, a key that does not match means you are holding another
      // vault's.
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
   * Erases from storage everything the vault has put there: the code and the
   * data key. Goes with account deletion, and nothing else.
   *
   * `disable` does not fit here, and the difference is the heart of the matter:
   * it removes the code while keeping the key, precisely so that a forgotten
   * code does not cost the encrypted notes. What is the right answer there is
   * the wrong one here — leaving the key behind would mean keeping the means to
   * decrypt notes we have just promised no longer exist.
   *
   * Called even with no vault configured: a key may have survived a `disable`,
   * which is exactly what it is for. Erasing a missing entry costs nothing.
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
      markActivity,
      configure,
      unlockWithPin,
      unlockWithBiometrics,
      cancelBiometrics,
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
      markActivity,
      configure,
      unlockWithPin,
      unlockWithBiometrics,
      cancelBiometrics,
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

  /**
   * Gestures are read at the top of the tree, without intercepting anything.
   *
   * `onStartShouldSetResponderCapture` is called on the way down, so before the
   * targeted card, button or list takes hold of the gesture. Returning `false`
   * lets the gesture go on its way untouched: this view notes the time and never
   * becomes the responder. An `onTouchStart` would have the opposite flaw — it
   * only receives touches nobody has taken.
   *
   * Movement counts as much as pressing: scrolling a long note is a continuous
   * gesture where the finger never lifts, and counting it only on first contact
   * would close the vault in the middle of reading.
   *
   * `flex: 1` because this view sits between the query provider and the whole
   * app: otherwise it would shrink to the height of its content and the screen
   * would stop with it.
   */
  return (
    <VaultContext.Provider value={value}>
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => {
          markActivity()
          return false
        }}
        onMoveShouldSetResponderCapture={() => {
          markActivity()
          return false
        }}
      >
        {children}
      </View>
    </VaultContext.Provider>
  )
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault doit être appelé dans un VaultProvider')
  return ctx
}

