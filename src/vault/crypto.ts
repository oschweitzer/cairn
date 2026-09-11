import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * The vault's cryptographic core. No platform access, no state: everything
 * comes in through the arguments, randomness included. That is what makes it
 * testable under Node with `npm run test:logic`, and this is exactly where it
 * has to be tested — a mistake here does not show on screen, it shows the day
 * notes are unreadable.
 *
 * ── The key hierarchy, and why the code is not in it ─────────────────────────
 * The vault code is four digits. Its whole space can be run through in a
 * fraction of a second by someone holding the ciphertext: deriving the
 * encryption key from it would give the appearance of protection and not the
 * thing. So the code encrypts nothing. It guards local access, as it does today.
 *
 * What encrypts is a randomly drawn 256-bit data key, which the user never sees.
 * It lives on the device in secure storage, and it is wrapped by a 160-bit
 * recovery key — the only secret the user truly holds, shown once and to be
 * copied down.
 *
 *   recovery key ──HKDF──▶ wrapping key ──encrypts──▶ data key
 *                                                        │
 *                                                        ▼
 *                                                title, body, items
 *
 * A consequence to own, and to tell the user before they commit: whoever loses
 * the device AND the recovery key loses the notes. Nobody can give them back,
 * not us, not Supabase. It is the price of the only promise worth making.
 *
 * ── XChaCha20-Poly1305 ───────────────────────────────────────────────────────
 * Authenticated encryption: a ciphertext changed by one bit is rejected, not
 * decrypted wrongly. A 24-byte nonce, wide enough to be drawn at random on every
 * write without ever fearing a collision — which avoids having to keep a
 * counter, and a badly kept counter breaks ChaCha20.
 *
 * A pure JavaScript implementation, audited, with no native module: it is the
 * only family that runs both under Hermes and in a browser, so the only one that
 * lets the app stay a PWA without a native build.
 */

/** 256 bits. The key that actually encrypts the content. */
export const DATA_KEY_BYTES = 32
/**
 * 160 bits for the recovery key. Out of reach of any exhaustive search, and it
 * lands exactly on 32 characters in base 32, so eight groups of four: copyable
 * by hand without counting characters.
 */
export const RECOVERY_KEY_BYTES = 20
const NONCE_BYTES = 24

/** Source of randomness, provided by the caller. See the header. */
export type RandomBytes = (length: number) => Uint8Array

/**
 * Crockford's base 32: no I, L, O or U. The first three because they get
 * confused with 1 and 0 on a sheet of paper, the last so that no unfortunate
 * word forms in a randomly drawn key.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Separator between groups of four. Purely visual, ignored when read back. */
const GROUP = 4

function toBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function fromBase32(input: string): Uint8Array | null {
  let bits = 0
  let value = 0
  const out: number[] = []

  for (const raw of input) {
    // Tolerance for copying: case, separators, and the three classic confusions
    // of handwriting.
    const char = raw.toUpperCase()
    if (char === '-' || char === ' ') continue
    const normalized = char === 'O' ? '0' : char === 'I' || char === 'L' ? '1' : char
    const index = ALPHABET.indexOf(normalized)
    if (index < 0) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** Formats the recovery key to be read and copied down. */
export function formatRecoveryKey(key: Uint8Array): string {
  const raw = toBase32(key)
  const groups: string[] = []
  for (let i = 0; i < raw.length; i += GROUP) groups.push(raw.slice(i, i + GROUP))
  return groups.join('-')
}

/**
 * Reads back a recovery key typed in by hand. Returns `null` if it is not a key
 * of the right length — so before even trying to decrypt, which makes it
 * possible to tell "mistyped" from "not the right key".
 */
export function parseRecoveryKey(input: string): Uint8Array | null {
  const bytes = fromBase32(input.trim())
  if (!bytes || bytes.length !== RECOVERY_KEY_BYTES) return null
  return bytes
}

export function createDataKey(random: RandomBytes): Uint8Array {
  return random(DATA_KEY_BYTES)
}

export function createRecoveryKey(random: RandomBytes): Uint8Array {
  return random(RECOVERY_KEY_BYTES)
}

/**
 * Wrapping key derived from the recovery key.
 *
 * HKDF with no random salt, and that is correct here: the salt serves to spread
 * a low-entropy input, and this one has 160 bits. The label, though, is
 * essential — it prevents a key derived for one use from serving another the
 * day there is a second one.
 */
const WRAP_LABEL = utf8ToBytes('cairn:coffre:enveloppe:v1')

function wrappingKey(recoveryKey: Uint8Array): Uint8Array {
  return hkdf(sha256, recoveryKey, undefined, WRAP_LABEL, DATA_KEY_BYTES)
}

/** Nonce first, ciphertext after: a single string to store in the database. */
function seal(plain: Uint8Array, key: Uint8Array, random: RandomBytes): string {
  const nonce = random(NONCE_BYTES)
  return bytesToHex(nonce) + bytesToHex(xchacha20poly1305(key, nonce).encrypt(plain))
}

function open(sealed: string, key: Uint8Array): Uint8Array | null {
  try {
    const bytes = hexToBytes(sealed)
    if (bytes.length <= NONCE_BYTES) return null
    const nonce = bytes.slice(0, NONCE_BYTES)
    return xchacha20poly1305(key, nonce).decrypt(bytes.slice(NONCE_BYTES))
  } catch {
    // Wrong key, tampered ciphertext, truncated string: three failures handled
    // the same way. Return `null` rather than propagate, because no caller can
    // do anything with the difference, and an exception here would bring down
    // a whole screen for one unreadable note.
    return null
  }
}

/** Wraps the data key. The result goes into `notes.wrapped_key`. */
export function wrapDataKey(
  dataKey: Uint8Array,
  recoveryKey: Uint8Array,
  random: RandomBytes,
): string {
  return seal(dataKey, wrappingKey(recoveryKey), random)
}

export function unwrapDataKey(wrapped: string, recoveryKey: Uint8Array): Uint8Array | null {
  const key = open(wrapped, wrappingKey(recoveryKey))
  return key && key.length === DATA_KEY_BYTES ? key : null
}

/** Encrypts a text. The result goes into `notes.ciphertext`. */
export function sealText(plain: string, dataKey: Uint8Array, random: RandomBytes): string {
  return seal(utf8ToBytes(plain), dataKey, random)
}

export function openText(sealed: string, dataKey: Uint8Array): string | null {
  const bytes = open(sealed, dataKey)
  if (!bytes) return null
  try {
    return bytesToUtf8(bytes)
  } catch {
    return null
  }
}
