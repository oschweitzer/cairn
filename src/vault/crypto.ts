import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Cœur cryptographique du coffre. Aucun accès à la plateforme, aucun état :
 * tout entre par les arguments, y compris l'aléa. C'est ce qui permet de le
 * tester sous Node par `npm run test:logic`, et c'est exactement là qu'il faut
 * l'être — une erreur ici ne se voit pas à l'écran, elle se voit le jour où des
 * notes sont illisibles.
 *
 * ── La hiérarchie de clés, et pourquoi le code n'y est pas ───────────────────
 * Le code du coffre fait quatre chiffres. Tout son espace se parcourt en une
 * fraction de seconde face à quelqu'un qui tient le chiffré : en dériver la clé
 * de chiffrement donnerait l'apparence d'une protection et pas la chose. Le code
 * ne chiffre donc rien. Il garde l'accès local, comme aujourd'hui.
 *
 * Ce qui chiffre, c'est une clé de données tirée au sort, 256 bits, que
 * l'utilisateur ne voit jamais. Elle vit sur l'appareil dans le stockage
 * sécurisé, et elle est enveloppée par une clé de secours de 160 bits — le seul
 * secret que l'utilisateur détient vraiment, affiché une fois et à recopier.
 *
 *   clé de secours ──HKDF──▶ clé d'enveloppe ──chiffre──▶ clé de données
 *                                                             │
 *                                                             ▼
 *                                                    titre, corps, éléments
 *
 * Conséquence à assumer, et à dire à l'utilisateur avant qu'il ne s'engage :
 * qui perd l'appareil ET la clé de secours perd les notes. Personne ne peut les
 * rendre, ni nous, ni Supabase. C'est le prix de la seule promesse qui vaille.
 *
 * ── XChaCha20-Poly1305 ───────────────────────────────────────────────────────
 * Chiffrement authentifié : un chiffré modifié d'un bit est refusé, il n'est pas
 * déchiffré de travers. Nonce de 24 octets, assez large pour être tiré au sort à
 * chaque écriture sans jamais craindre la collision — ce qui évite d'avoir à
 * tenir un compteur, et un compteur mal tenu casse ChaCha20.
 *
 * Implémentation en JavaScript pur, auditée, sans module natif : c'est la seule
 * famille qui tourne à la fois sous Hermes et dans un navigateur, donc la seule
 * qui laisse l'application rester une PWA sans build natif.
 */

/** 256 bits. La clé qui chiffre réellement le contenu. */
export const DATA_KEY_BYTES = 32
/**
 * 160 bits pour la clé de secours. Hors de portée de toute recherche
 * exhaustive, et cela tombe juste sur 32 caractères en base 32, donc huit
 * groupes de quatre : recopiable à la main sans compter les caractères.
 */
export const RECOVERY_KEY_BYTES = 20
const NONCE_BYTES = 24

/** Source d'aléa, fournie par l'appelant. Voir l'en-tête. */
export type RandomBytes = (length: number) => Uint8Array

/**
 * Base 32 de Crockford : ni I, ni L, ni O, ni U. Les trois premières parce
 * qu'elles se confondent avec 1 et 0 sur une feuille de papier, la dernière pour
 * qu'aucun mot malheureux ne se forme dans une clé tirée au sort.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Séparateur des groupes de quatre. Purement visuel, ignoré à la relecture. */
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
    // Tolérance à la recopie : la casse, les séparateurs, et les trois
    // confusions classiques de l'écriture manuscrite.
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

/** Met la clé de secours en forme pour être lue et recopiée. */
export function formatRecoveryKey(key: Uint8Array): string {
  const raw = toBase32(key)
  const groups: string[] = []
  for (let i = 0; i < raw.length; i += GROUP) groups.push(raw.slice(i, i + GROUP))
  return groups.join('-')
}

/**
 * Relit une clé de secours saisie à la main. Rend `null` si ce n'est pas une
 * clé de la bonne longueur — donc avant même d'essayer de déchiffrer, ce qui
 * permet de distinguer « mal recopiée » de « pas la bonne clé ».
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
 * Clé d'enveloppe dérivée de la clé de secours.
 *
 * HKDF sans sel aléatoire, et c'est correct ici : le sel sert à disperser une
 * entrée à faible entropie, or celle-ci en a 160 bits. L'étiquette, elle, est
 * indispensable — elle interdit qu'une clé dérivée pour un usage serve à un
 * autre le jour où il y en aura un second.
 */
const WRAP_LABEL = utf8ToBytes('cairn:coffre:enveloppe:v1')

function wrappingKey(recoveryKey: Uint8Array): Uint8Array {
  return hkdf(sha256, recoveryKey, undefined, WRAP_LABEL, DATA_KEY_BYTES)
}

/** Nonce en tête, chiffré ensuite : une seule chaîne à stocker en base. */
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
    // Mauvaise clé, chiffré altéré, chaîne tronquée : trois échecs qui se
    // traitent pareil. Rendre `null` plutôt que propager, parce qu'aucun
    // appelant ne peut faire quoi que ce soit de la différence, et qu'une
    // exception ici ferait tomber un écran entier pour une note illisible.
    return null
  }
}

/** Enveloppe la clé de données. Le résultat va dans `notes.wrapped_key`. */
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

/** Chiffre un texte. Le résultat va dans `notes.ciphertext`. */
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
