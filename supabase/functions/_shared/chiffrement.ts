/**
 * Chiffrement du jeton de rafraîchissement Google, côté serveur.
 *
 * À ne pas confondre avec src/vault/crypto.ts, qui chiffre les notes. Les deux
 * n'ont ni la même clé, ni le même détenteur, ni le même but :
 *
 *   coffre    clé dérivée de la clé de secours, détenue par l'utilisateur seul.
 *             Le serveur ne peut pas lire, c'est tout l'intérêt.
 *
 *   ce module clé détenue par le serveur, dans les secrets des Edge Functions.
 *             Le serveur doit pouvoir lire — sans le jeton en clair il ne peut
 *             pas appeler Google. Ce chiffrement protège contre une fuite de la
 *             base seule, pas contre le serveur lui-même.
 *
 * Prétendre l'inverse serait mentir sur la garantie offerte. Un jeton Google
 * autorise à écrire dans l'agenda de quelqu'un ; le laisser en clair dans une
 * table rendrait une sauvegarde égarée immédiatement exploitable, et c'est
 * précisément ce que cette couche empêche.
 *
 * AES-GCM plutôt que XChaCha20 comme le coffre : il est natif dans WebCrypto,
 * donc sans dépendance à importer dans une fonction qui démarre à froid. Le
 * format retenu reste celui du reste du projet — nonce en tête du chiffré, le
 * tout en hexadécimal — parce qu'un nonce rangé à part est un nonce qu'on peut
 * désynchroniser de son chiffré.
 */

/** 96 bits, taille recommandée pour AES-GCM et la seule qu'accélère le matériel. */
const NONCE_BYTES = 12

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Charge la clé depuis les secrets.
 *
 * Elle est attendue en hexadécimal sur 64 caractères, soit 256 bits. La
 * longueur est vérifiée ici plutôt que laissée à WebCrypto : son message
 * d'erreur ne dit pas quel secret est en cause, et une clé mal copiée est
 * l'incident le plus probable de toute cette chaîne.
 */
async function chargerCle(): Promise<CryptoKey> {
  const brut = Deno.env.get('GOOGLE_TOKEN_KEY')
  if (!brut) {
    throw new Error('secret GOOGLE_TOKEN_KEY absent des Edge Functions')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(brut.trim())) {
    throw new Error('GOOGLE_TOKEN_KEY doit faire 64 caractères hexadécimaux (256 bits)')
  }
  return await crypto.subtle.importKey(
    'raw',
    fromHex(brut.trim()),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function chiffrer(clair: string): Promise<string> {
  const cle = await chargerCle()
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const chiffre = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cle,
    new TextEncoder().encode(clair),
  )
  return toHex(nonce) + toHex(new Uint8Array(chiffre))
}

/**
 * Rend null plutôt que de lever, pour un chiffré illisible.
 *
 * Le cas se produit pour de bon le jour où la clé est remplacée : les lignes
 * écrites avec l'ancienne deviennent indéchiffrables. L'appelant doit alors
 * demander une reconnexion, ce qui est une issue normale — pas une erreur 500
 * qui laisserait l'utilisateur devant un échec sans explication.
 */
export async function dechiffrer(chiffre: string): Promise<string | null> {
  try {
    if (!/^[0-9a-f]+$/i.test(chiffre) || chiffre.length <= NONCE_BYTES * 2) return null
    const cle = await chargerCle()
    const octets = fromHex(chiffre)
    const clair = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: octets.slice(0, NONCE_BYTES) },
      cle,
      octets.slice(NONCE_BYTES),
    )
    return new TextDecoder().decode(clair)
  } catch {
    return null
  }
}
