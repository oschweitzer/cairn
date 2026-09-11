import { Platform } from 'react-native'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { judgePin, type PinVerdict, type VaultSecret } from './policy'

/**
 * The vault secret: storage on the device and derivation of the hash.
 *
 * The rules that decide a refusal and a cool-down live in policy.ts, with no
 * platform dependency, so they stay testable under Node. Here there is only
 * what actually touches the hardware.
 *
 * ── What this code protects, and what it does not ────────────────────────────
 * The code guards access on this device: it stops someone looking at your
 * screen over your shoulder or picking up your unlocked phone. It encrypts
 * nothing, and that is not a gap — encryption is what protects against the
 * rest, and it has its own key, unrelated to these four digits. See
 * src/vault/crypto.ts for the reason, which is the same as the next
 * paragraph's: a four-digit secret cannot carry any cryptographic weight.
 *
 * ── Why a plain salted SHA-256, and not a real derivation ────────────────────
 * The code is numeric and short. Against someone holding the hash, the whole
 * space can be run through in a fraction of a second, whether it is iterated a
 * hundred times or a hundred thousand: PBKDF2 does not redeem a four-digit
 * secret. And since `digestStringAsync` crosses the native bridge on every
 * call, a hundred thousand iterations would cost several seconds of waiting on
 * every entry, for no gain in this threat model.
 *
 * What really protects a short code is the number of possible attempts. Hence
 * the progressive cool-down in policy.ts, which does have a measurable effect
 * against the only attack this vault claims to stop: someone trying codes by
 * hand on the device.
 *
 * ── Where the secret lives ───────────────────────────────────────────────────
 * On Android, in expo-secure-store, backed by the Keystore. On the web,
 * expo-secure-store does not exist: the secret falls back to localStorage,
 * readable by any script from the origin. That is consistent with the rest of
 * the project, where the vault and trash cache already never goes down to disk,
 * and it is told to the user on the setup screen rather than hidden here.
 */

const KEY = 'cairn.vault.secret'
const DATA_KEY = 'cairn.vault.data-key'
const isWeb = Platform.OS === 'web'

export { PIN_MAX_LENGTH, PIN_MIN_LENGTH, FREE_ATTEMPTS, delayForFailures } from './policy'
export type { PinVerdict, VaultSecret } from './policy'

// ------------------------------------------------------------------- storage

async function readRaw(name: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(name) ?? null
    } catch {
      return null
    }
  }
  return SecureStore.getItemAsync(name)
}

async function writeRaw(name: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(name, value)
    } catch {
      /* storage unavailable: the vault will not survive a reload */
    }
    return
  }
  await SecureStore.setItemAsync(name, value)
}

async function deleteRaw(name: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(name)
    } catch {
      /* nothing to do */
    }
    return
  }
  await SecureStore.deleteItemAsync(name)
}

export async function readSecret(): Promise<VaultSecret | null> {
  const raw = await readRaw(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<VaultSecret>
    // A truncated record, or one from an earlier version, must not block the
    // app: it is treated as no vault at all, which leads back to the setup
    // screen instead of an entry screen that cannot be passed.
    if (typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string') return null
    return {
      salt: parsed.salt,
      hash: parsed.hash,
      failures: typeof parsed.failures === 'number' ? parsed.failures : 0,
      lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : null,
      biometrics: parsed.biometrics === true,
    }
  } catch {
    return null
  }
}

export async function writeSecret(secret: VaultSecret): Promise<void> {
  await writeRaw(KEY, JSON.stringify(secret))
}

export async function clearSecret(): Promise<void> {
  await deleteRaw(KEY)
}

// ------------------------------------------------------------------ data key

/**
 * The data key lives next to the code's secret, in the same storage, but under
 * its own entry. The separation is what makes replacing a forgotten code
 * harmless: erasing the secret does not touch the key, so encrypted notes stay
 * readable behind the new code.
 *
 * On Android, the Keystore keeps the key out of other apps' reach. On the web,
 * `expo-secure-store` does not exist and it falls back to localStorage: there,
 * encryption protects against access to the database, not against a hostile
 * script served by the origin. That is told to the user, not hidden here.
 */
export async function readDataKey(): Promise<string | null> {
  return readRaw(DATA_KEY)
}

export async function writeDataKey(hex: string): Promise<void> {
  await writeRaw(DATA_KEY, hex)
}

export async function clearDataKey(): Promise<void> {
  await deleteRaw(DATA_KEY)
}

// ---------------------------------------------------------------- derivation

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function derive(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`)
}

export async function createSecret(pin: string, biometrics: boolean): Promise<VaultSecret> {
  const salt = toHex(Crypto.getRandomBytes(16))
  return { salt, hash: await derive(pin, salt), failures: 0, lockedUntil: null, biometrics }
}

/** Derives, then hands the decision to policy.ts. The caller writes the returned secret. */
export async function verifyPin(
  pin: string,
  secret: VaultSecret,
  now = Date.now(),
): Promise<PinVerdict> {
  return judgePin(await derive(pin, secret.salt), secret, now)
}
