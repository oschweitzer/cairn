/**
 * Vault rules that depend neither on the platform, nor on storage, nor on
 * cryptography.
 *
 * Kept apart from secret.ts for the same reason noteLogic.ts is kept apart from
 * the hooks: these functions decide whether an entry goes through, how long to
 * wait after a failure, and from when a cool-down runs. Those are exactly the
 * places where a mistake would lock someone out of their notes, or on the
 * contrary leave the vault wide open. So they are tested directly under Node,
 * without mocking expo-secure-store.
 *
 * This file must import no react-native or expo module.
 */

/** Minimum length. Four digits, like a card PIN. */
export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 12

export type VaultSecret = {
  /** Random, in hexadecimal. Keeps two identical codes from having the same hash. */
  salt: string
  hash: string
  /** Consecutive failures. Reset to zero by a correct entry. */
  failures: number
  /** Timestamp in milliseconds until which every entry is refused. */
  lockedUntil: number | null
  /** The user accepts biometric unlocking. No effect on the web. */
  biometrics: boolean
}

/**
 * Wait imposed after consecutive failures, in milliseconds.
 *
 * The first three attempts are free: hitting the wrong digit happens, and
 * punishing the first mistake would only annoy the phone's owner. Beyond that,
 * the wait doubles with every failure and caps at five minutes, which makes a
 * manual sweep of the keypad tedious long before it pays off.
 *
 * The cap is not a conceded weakness, it is the counterpart of the fact that
 * the only person really hindered by a wait that grows without end is the one
 * who is allowed in and got it wrong.
 *
 * This cool-down lives next to the secret, so someone who knows how to wipe the
 * storage gets around it. They would also lose the vault by doing so, which is
 * enough for the threat in view. It was never meant to stop an analyst.
 */
export const FREE_ATTEMPTS = 3
const BASE_DELAY_MS = 15_000
const MAX_DELAY_MS = 5 * 60_000

export function delayForFailures(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0
  const step = failures - FREE_ATTEMPTS - 1
  return Math.min(BASE_DELAY_MS * 2 ** step, MAX_DELAY_MS)
}

/**
 * Automatic closing: five minutes without a gesture.
 *
 * The threshold lives here, with the rest of what decides when the vault
 * closes, and the rule that goes with it fits in the function below.
 */
export const AUTO_LOCK_MS = 5 * 60_000

/**
 * Time left before automatic closing, in milliseconds. Zero means "close now".
 *
 * A subtraction, and that is the whole point: the count is kept on the clock and
 * not on a timer. A sleeping timer — a hidden tab the browser slows down, an app
 * suspended by the system — wakes up late, and its lateness would pass a long
 * absence off as a short one. Starting again from the time of the last gesture,
 * an hour's absence returns zero as soon as it wakes, however the timer slept in
 * the meantime.
 *
 * The floor at zero is not cosmetic: the value is used to set the timer again,
 * and a negative delay would make it loop forever.
 */
export function msBeforeAutoLock(lastActivity: number, now: number): number {
  return Math.max(0, lastActivity + AUTO_LOCK_MS - now)
}

export type PinVerdict =
  | { ok: true; secret: VaultSecret }
  | { ok: false; reason: 'wrong'; secret: VaultSecret; waitMs: number }
  | { ok: false; reason: 'cooling'; secret: VaultSecret; waitMs: number }

/**
 * Decides the fate of an entry, from the hash already computed.
 *
 * Taking the hash as input rather than the code itself is what makes this
 * function pure: derivation crosses the native bridge, the decision does not.
 *
 * Nothing is persisted here. The updated secret is returned, and the caller is
 * the one who writes it, which leaves the choice of timing and makes the
 * function replayable in a test with no storage.
 */
export function judgePin(
  candidateHash: string,
  secret: VaultSecret,
  now: number,
): PinVerdict {
  if (secret.lockedUntil !== null && now < secret.lockedUntil) {
    return { ok: false, reason: 'cooling', secret, waitMs: secret.lockedUntil - now }
  }

  if (candidateHash === secret.hash) {
    return { ok: true, secret: { ...secret, failures: 0, lockedUntil: null } }
  }

  const failures = secret.failures + 1
  const waitMs = delayForFailures(failures)
  return {
    ok: false,
    reason: 'wrong',
    secret: { ...secret, failures, lockedUntil: waitMs > 0 ? now + waitMs : null },
    waitMs,
  }
}
