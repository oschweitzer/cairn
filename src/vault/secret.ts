import { Platform } from 'react-native'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { judgePin, type PinVerdict, type VaultSecret } from './policy'

/**
 * Le secret du coffre : stockage sur l'appareil et dérivation de l'empreinte.
 *
 * Les règles qui décident d'un refus et d'une temporisation vivent dans
 * policy.ts, sans dépendance à la plateforme, pour rester testables sous Node.
 * Ici il n'y a que ce qui touche réellement au matériel.
 *
 * ── Ce que ce code protège, et ce qu'il ne protège pas ───────────────────────
 * Le coffre est un masquage face à quelqu'un qui regarde ton écran par-dessus
 * ton épaule ou qui prend ton téléphone déverrouillé. Ce n'est pas une
 * protection face à quelqu'un qui accède à la base : les notes du coffre restent
 * en clair dans Postgres, gardées par RLS comme toutes les autres. La protection
 * contre ce niveau-là, c'est le chiffrement bout en bout, et il arrive en
 * phase 6.
 *
 * Dire cela n'est pas une excuse, c'est le périmètre décidé au départ. Le pire
 * serait de laisser croire à davantage.
 *
 * ── Pourquoi un simple SHA-256 salé, et pas une vraie dérivation ─────────────
 * Le code est numérique et court. Face à quelqu'un qui tient l'empreinte, tout
 * l'espace se parcourt en une fraction de seconde, qu'on itère cent fois ou cent
 * mille fois : PBKDF2 ne rachète pas un secret de quatre chiffres. Et comme
 * `digestStringAsync` traverse le pont natif à chaque appel, cent mille
 * itérations coûteraient plusieurs secondes d'attente à chaque saisie, pour un
 * gain nul dans ce modèle de menace.
 *
 * Ce qui protège réellement un code court, c'est le nombre d'essais possibles.
 * D'où la temporisation progressive de policy.ts, qui elle a un effet mesurable
 * contre la seule attaque que ce coffre prétend arrêter : quelqu'un qui essaie
 * des codes à la main sur l'appareil.
 *
 * ── Où vit le secret ─────────────────────────────────────────────────────────
 * Sur Android, dans expo-secure-store, adossé au Keystore. Sur le web,
 * expo-secure-store n'existe pas : le secret retombe dans localStorage, lisible
 * par n'importe quel script de l'origine. C'est cohérent avec le reste du
 * projet, où le cache du coffre et de la corbeille ne descend déjà pas sur le
 * disque, et c'est dit à l'utilisateur dans l'écran de configuration plutôt que
 * caché ici.
 */

const KEY = 'cairn.vault.secret'
const isWeb = Platform.OS === 'web'

export { PIN_MAX_LENGTH, PIN_MIN_LENGTH, FREE_ATTEMPTS, delayForFailures } from './policy'
export type { PinVerdict, VaultSecret } from './policy'

// ------------------------------------------------------------------ stockage

async function readRaw(): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null
    } catch {
      return null
    }
  }
  return SecureStore.getItemAsync(KEY)
}

async function writeRaw(value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(KEY, value)
    } catch {
      /* stockage indisponible : le coffre ne survivra pas au rechargement */
    }
    return
  }
  await SecureStore.setItemAsync(KEY, value)
}

export async function readSecret(): Promise<VaultSecret | null> {
  const raw = await readRaw()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<VaultSecret>
    // Un enregistrement tronqué ou d'une version antérieure ne doit pas bloquer
    // l'application : on le traite comme une absence de coffre, ce qui ramène à
    // l'écran de configuration au lieu d'un écran de saisie impossible à passer.
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
  await writeRaw(JSON.stringify(secret))
}

export async function clearSecret(): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(KEY)
    } catch {
      /* rien à faire */
    }
    return
  }
  await SecureStore.deleteItemAsync(KEY)
}

// ----------------------------------------------------------------- dérivation

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

/** Dérive puis délègue la décision à policy.ts. L'appelant écrit le secret rendu. */
export async function verifyPin(
  pin: string,
  secret: VaultSecret,
  now = Date.now(),
): Promise<PinVerdict> {
  return judgePin(await derive(pin, secret.salt), secret, now)
}
