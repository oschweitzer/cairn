/**
 * Pure logic of the compromised-password check.
 *
 * Kept apart from the network call for the same reason src/db/noteLogic.ts is
 * kept apart from the queries: it needs neither React nor the network, so it is
 * tested directly under Node — and that is where the mistakes that matter hide,
 * a botched case comparison letting every leaked password through.
 *
 * ── The password never leaves the device ─────────────────────────────────────
 * The service only receives the first five characters of the SHA-1 hash. That
 * prefix is shared by hundreds of thousands of passwords: it points to a bucket,
 * never to a password. The response holds every suffix in the bucket, and it is
 * here, off the network, that we look for ours.
 *
 * This is the so-called k-anonymity mechanism, and it is exactly the one
 * Supabase uses behind its paid switch.
 */

/** Prefix length the API expects. Five characters, not one more. */
const PREFIX_LENGTH = 5

export type HashParts = { prefix: string; suffix: string }

/**
 * Cuts the hash into a prefix to send and a suffix to keep. Returns `null` if
 * the hash does not have the shape of a SHA-1.
 */
export function splitHash(hex: string): HashParts | null {
  const value = hex.trim().toUpperCase()
  if (!/^[0-9A-F]{40}$/.test(value)) return null
  return { prefix: value.slice(0, PREFIX_LENGTH), suffix: value.slice(PREFIX_LENGTH) }
}

/**
 * Looks for the suffix in the service's response and returns the number of
 * known leaks. Zero means "never seen", which is the only good news.
 *
 * Each line reads `SUFFIX:COUNT`. Lines with a zero count are padding: the
 * service adds some, on request, so that every response weighs the same and a
 * traffic observer cannot infer from the size how many passwords share the
 * prefix. Counting them as hits would reject every password.
 */
export function countInRange(body: string, suffix: string): number {
  const needle = suffix.trim().toUpperCase()
  if (needle.length === 0) return 0

  for (const line of body.split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    if (line.slice(0, separator).trim().toUpperCase() !== needle) continue

    const count = Number.parseInt(line.slice(separator + 1).trim(), 10)
    return Number.isFinite(count) && count > 0 ? count : 0
  }
  return 0
}
