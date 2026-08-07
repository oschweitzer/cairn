import * as Crypto from 'expo-crypto'
import { countInRange, splitHash } from './pwnedLogic'

/**
 * Contrôle d'un mot de passe contre les fuites publiques connues.
 *
 * Supabase propose la même chose derrière un interrupteur, mais réservé au plan
 * payant. Le service qu'il interroge — l'API Pwned Passwords de
 * HaveIBeenPwned — est lui gratuit et sans clé : on l'appelle donc directement,
 * avec le même protocole de k-anonymat. Voir pwnedLogic.ts pour ce qui sort
 * réellement de l'appareil, c'est-à-dire cinq caractères d'empreinte.
 *
 * ── L'échec est ouvert, délibérément ────────────────────────────────────────
 * Service injoignable, hors ligne, réponse illisible : on rend zéro, donc on
 * accepte. Refuser une inscription parce qu'un tiers ne répond pas serait plus
 * nuisible que le risque couvert — on empêcherait quelqu'un de créer son compte
 * pour un mot de passe qui n'a peut-être jamais fuité.
 */

const ENDPOINT = 'https://api.pwnedpasswords.com/range/'

/** Au-delà, on considère que le service ne répondra pas et on passe outre. */
const TIMEOUT_MS = 4000

/**
 * Nombre de fuites connues pour ce mot de passe. Zéro s'il est inconnu des
 * listes, ou si le contrôle n'a pas pu aboutir.
 */
export async function pwnedCount(password: string): Promise<number> {
  if (!password) return 0

  try {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, password)
    const parts = splitHash(digest)
    if (!parts) return 0

    // Le minuteur est indispensable : `fetch` n'abandonne pas de lui-même, et
    // une requête suspendue retiendrait le formulaire d'inscription.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${ENDPOINT}${parts.prefix}`, {
        signal: abort.signal,
        // Le rembourrage uniformise la taille des réponses, pour qu'un
        // observateur du trafic ne puisse rien déduire de leur poids. Il ajoute
        // des lignes à compte nul, que `countInRange` écarte.
        headers: { 'Add-Padding': 'true' },
      })
      if (!response.ok) return 0
      return countInRange(await response.text(), parts.suffix)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return 0
  }
}

/**
 * Formule le refus. Le nombre est donné parce qu'il fait la différence entre
 * « c'est théorique » et « ce mot de passe circule » : à des millions
 * d'occurrences, il est dans le premier dictionnaire venu.
 */
export function pwnedMessage(count: number): string {
  const fois = count.toLocaleString('fr-FR')
  return `Ce mot de passe figure ${fois} fois dans des fuites publiques. Il est essayé en premier par les attaques automatisées : choisis-en un autre.`
}
