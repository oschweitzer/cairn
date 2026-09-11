import * as Crypto from 'expo-crypto'
import { openText, sealText, type RandomBytes } from './crypto'

/**
 * The data key while it is in use.
 *
 * ── Why a module and not React state ─────────────────────────────────────────
 * The mutations of src/db/queries.ts have to seal what they write, and they are
 * functions, not components: they cannot read a context. Passing the key down
 * as an argument from every screen would mean carrying it around the whole app,
 * and one careless caller would be enough to write a vault note in plaintext. A
 * single access point makes that oversight impossible: `sealNote` fails if
 * there is no key.
 *
 * The key only lives here while the vault is open. `VaultProvider` sets it on
 * unlocking and removes it on closing — five minutes without a gesture, or the
 * « Refermer » button.
 */

/** The platform's randomness. expo-crypto works under Hermes as on the web. */
export const platformRandom: RandomBytes = (length) => Crypto.getRandomBytes(length)

let dataKey: Uint8Array | null = null

export function loadDataKey(key: Uint8Array): void {
  dataKey = key
}

export function unloadDataKey(): void {
  // The array is wiped before being let go: the reference disappears, but the
  // bytes themselves would stay in memory until the garbage collector passes.
  dataKey?.fill(0)
  dataKey = null
}

export function hasDataKey(): boolean {
  return dataKey !== null
}

/**
 * An encrypted note's payload: title and body in the same sealed blob.
 *
 * A single ciphertext for both, and not one per field. A ciphertext's size
 * reveals the text's; putting them together drowns the title in the body, and
 * above all they always change together — two separate blobs would be two
 * chances to rewrite only one of them.
 */
type NotePayload = { title: string | null; body: string | null }

/**
 * Seals a note's content. Returns `null` if the vault is closed, and it is up
 * to the caller to refuse to write: a write that does not happen is better than
 * a vault note put in plaintext into the database.
 */
export function sealNote(payload: NotePayload): string | null {
  if (!dataKey) return null
  return sealText(JSON.stringify(payload), dataKey, platformRandom)
}

/**
 * Opens a note's content. Returns empty content rather than `null` on failure:
 * an unreadable note must stay listed, otherwise it would vanish without a
 * trace and suggest it had been lost.
 */
export function openNote(ciphertext: string | null): NotePayload {
  if (!dataKey || !ciphertext) return { title: null, body: null }
  const plain = openText(ciphertext, dataKey)
  if (plain === null) return { title: null, body: null }
  try {
    const parsed = JSON.parse(plain) as Partial<NotePayload>
    return { title: parsed.title ?? null, body: parsed.body ?? null }
  } catch {
    return { title: null, body: null }
  }
}

export function sealItem(content: string): string | null {
  if (!dataKey) return null
  return sealText(content, dataKey, platformRandom)
}

export function openItem(ciphertext: string | null): string | null {
  if (!dataKey || !ciphertext) return null
  return openText(ciphertext, dataKey)
}
