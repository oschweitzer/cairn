import * as Crypto from 'expo-crypto'
import { openText, sealText, type RandomBytes } from './crypto'

/**
 * La clé de données pendant qu'elle sert.
 *
 * ── Pourquoi un module et pas un état React ─────────────────────────────────
 * Les mutations de src/db/queries.ts doivent sceller ce qu'elles écrivent, et
 * ce sont des fonctions, pas des composants : elles ne peuvent pas lire un
 * contexte. Faire descendre la clé en argument depuis chaque écran signifierait
 * la promener à travers toute l'application, et il suffirait d'un appelant
 * distrait pour écrire une note du coffre en clair. Un point d'accès unique
 * rend cet oubli impossible : `sealNote` échoue s'il n'y a pas de clé.
 *
 * La clé ne vit ici que le temps de l'ouverture. `VaultProvider` la pose au
 * déverrouillage et la retire à la fermeture — au bout de cinq minutes, au
 * passage en arrière-plan, en quittant l'écran du coffre.
 */

/** L'aléa de la plateforme. expo-crypto fonctionne sous Hermes comme sur le web. */
export const platformRandom: RandomBytes = (length) => Crypto.getRandomBytes(length)

let dataKey: Uint8Array | null = null

export function loadDataKey(key: Uint8Array): void {
  dataKey = key
}

export function unloadDataKey(): void {
  // Le tableau est effacé avant d'être lâché : la référence disparaît, mais
  // l'octet, lui, resterait en mémoire jusqu'au passage du ramasse-miettes.
  dataKey?.fill(0)
  dataKey = null
}

export function hasDataKey(): boolean {
  return dataKey !== null
}

/**
 * Charge utile d'une note chiffrée : titre et corps dans un même scellé.
 *
 * Un seul chiffré pour les deux, et non un par champ. La taille du chiffré
 * révèle celle du texte ; les réunir noie le titre dans le corps, et surtout
 * ils changent toujours ensemble — deux scellés séparés seraient deux
 * occasions de n'en réécrire qu'un.
 */
type NotePayload = { title: string | null; body: string | null }

/**
 * Scelle le contenu d'une note. Rend `null` si le coffre est fermé, et c'est
 * à l'appelant de refuser d'écrire : il vaut mieux une écriture qui n'a pas
 * lieu qu'une note du coffre posée en clair dans la base.
 */
export function sealNote(payload: NotePayload): string | null {
  if (!dataKey) return null
  return sealText(JSON.stringify(payload), dataKey, platformRandom)
}

/**
 * Ouvre le contenu d'une note. Rend un contenu vide plutôt que `null` en cas
 * d'échec : une note illisible doit rester listée, sans quoi elle disparaîtrait
 * sans laisser de trace et donnerait à croire qu'elle a été perdue.
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
