// Types only, erased at compile time: this module pulls in neither React nor
// react-native, so the rule below can be tested directly under Node.
import type { QueryKey, QueryStatus } from '@tanstack/react-query'

/**
 * Which queries are allowed to reach the disk, and why.
 *
 * Kept apart from `queries.ts` because that module reaches for Supabase, which
 * reaches for react-native. The rule itself is a decision about privacy and
 * about serialisation, and both are worth testing on their own.
 */

/** Root of every query key, so that everything can be invalidated at once. */
export const QUERY_ROOT = 'cairn'

/**
 * Scope that may be written to disk. Anything outside it stays in memory only,
 * which is the case for the vault and for the trash.
 */
export const PERSISTABLE_PREFIX = 'shared'

/**
 * Two conditions, each guarding against a different failure.
 *
 * The **scope** decides what is safe to write. On the web AsyncStorage is
 * localStorage, readable by any script served from the origin, so vault notes
 * have nothing to do there, and neither have the trashed ones. Only keys under
 * `shared` go down; everything under `volatile` stays in memory. This is also
 * why hidden notes live in a query key of their own rather than in the main
 * list filtered client-side: the separation is structural, not cosmetic.
 *
 * The **status** decides what survives a round trip through JSON. A query
 * dehydrated while still pending carries its in-flight promise into the
 * payload, and `JSON.stringify` turns a Promise into `{}`. On the next start
 * `hydrate()` finds that `{}`, which is truthy, calls `.then` on it and throws
 * — and the persisted cache is discarded as a precaution. Requiring success is
 * what the library default did; replacing that default is what lost it, and
 * with it the whole point of persisting, which is to open on cached content.
 *
 * Cache writes are triggered by every cache event, `added` included, which
 * fires while a query is still pending. Slow, retrying or failing requests
 * therefore sit in exactly the state that must not be written.
 */
export function shouldPersistQuery(queryKey: QueryKey, status: QueryStatus): boolean {
  if (status !== 'success') return false
  const [root, scope] = queryKey
  return root === QUERY_ROOT && scope === PERSISTABLE_PREFIX
}
