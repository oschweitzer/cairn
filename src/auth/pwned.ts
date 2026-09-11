import * as Crypto from 'expo-crypto'
import { countInRange, splitHash } from './pwnedLogic'

/**
 * Checking a password against known public leaks.
 *
 * Supabase offers the same thing behind a switch, but reserved for the paid
 * plan. The service it queries — HaveIBeenPwned's Pwned Passwords API — is free
 * and keyless: so we call it directly, with the same k-anonymity protocol. See
 * pwnedLogic.ts for what actually leaves the device, that is five characters of
 * a hash.
 *
 * ── Failure is open, deliberately ────────────────────────────────────────────
 * Service unreachable, offline, unreadable response: we return zero, so we
 * accept. Refusing a sign-up because a third party does not answer would do more
 * harm than the risk covered — it would stop someone from creating their account
 * over a password that may never have leaked.
 */

const ENDPOINT = 'https://api.pwnedpasswords.com/range/'

/** Beyond this, we assume the service will not answer and move on. */
const TIMEOUT_MS = 4000

/**
 * Number of known leaks for this password. Zero if the lists do not know it, or
 * if the check could not complete.
 */
export async function pwnedCount(password: string): Promise<number> {
  if (!password) return 0

  try {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, password)
    const parts = splitHash(digest)
    if (!parts) return 0

    // The timer is essential: `fetch` does not give up by itself, and a hanging
    // request would hold the sign-up form back.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${ENDPOINT}${parts.prefix}`, {
        signal: abort.signal,
        // Padding evens out the size of responses, so a traffic observer can
        // infer nothing from their weight. It adds zero-count lines, which
        // `countInRange` discards.
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
 * Words the refusal. The number is given because it makes the difference
 * between "it is theoretical" and "this password is out there": at millions of
 * occurrences, it is in the first dictionary that comes along.
 */
export function pwnedMessage(count: number): string {
  const fois = count.toLocaleString('fr-FR')
  return `Ce mot de passe figure ${fois} fois dans des fuites publiques. Il est essayé en premier par les attaques automatisées : choisis-en un autre.`
}
