/**
 * Naming a database failure, rather than quoting it.
 *
 * The screens used to print `error.message` straight from PostgREST. That is the
 * right thing to do when nothing better is known, and the wrong thing the rest of
 * the time: `column notes.position does not exist` says what broke without saying
 * why, and reads as "the app is broken" to the only person who will ever see it.
 *
 * The distinction worth drawing is not between error codes, it is between
 * failures that resolve themselves and failures that never will. A lost
 * connection comes back; a schema behind the app does not, and will fail
 * identically until somebody applies a migration. Those two deserve opposite
 * advice, and PostgREST hands us enough to tell them apart.
 *
 * Everything here is pure — an error in, a message out — which is what makes it
 * testable without a server.
 */

export type DbFailure = 'schema' | 'permission' | 'session' | 'network' | 'unknown'

export type DbErrorReport = {
  kind: DbFailure
  /** Heading, in French: it is read by the person using the app. */
  title: string
  /** What it means for them, and whether waiting will help. */
  message: string
  /** The raw technical text, or null when `message` already carries it. */
  detail: string | null
}

/**
 * The database is missing something the app is asking for.
 *
 * The Postgres codes and the PGRST ones say the same thing from either side of
 * PostgREST: the first come from the server rejecting the statement, the second
 * from PostgREST's own schema cache, which fails earlier and never reaches
 * Postgres. Both mean the same migration is missing.
 */
const SCHEMA_CODES = new Set([
  '42703', // undefined_column
  '42P01', // undefined_table
  '42883', // undefined_function — a missing RPC, such as reorder_notes
  'PGRST200', // relationship not found: a foreign key the embed relies on
  'PGRST202', // function absent from the schema cache
  'PGRST204', // column absent from the schema cache
])

const PERMISSION_CODES = new Set([
  '42501', // insufficient_privilege — RLS refusing, or a grant never given
  '2F003', // prohibited_sql_statement_attempted, inside a SECURITY DEFINER function
])

const SESSION_CODES = new Set([
  'PGRST301', // JWT expired or unusable
  'PGRST302', // anonymous where a session was required
])

/** Reads `code` and `message` off anything, without claiming to know the shape. */
function fieldsOf(error: unknown): { code: string | null; message: string; hint: string | null } {
  if (typeof error !== 'object' || error === null) {
    return { code: null, message: typeof error === 'string' ? error : '', hint: null }
  }
  const shape = error as { code?: unknown; message?: unknown; hint?: unknown }
  return {
    code: typeof shape.code === 'string' && shape.code ? shape.code : null,
    message: typeof shape.message === 'string' ? shape.message : '',
    hint: typeof shape.hint === 'string' && shape.hint ? shape.hint : null,
  }
}

/**
 * A failed fetch carries no code at all — supabase-js lets the browser's or
 * React Native's own error through untouched. Matching on the wording is
 * unlovely, but there is nothing else to match on, and the fallback below is
 * harmless: an unrecognised network error simply lands in `unknown` and shows
 * its own message.
 */
const NETWORK_WORDING = /failed to fetch|network request failed|networkerror|load failed|fetch failed/i

function detailOf(code: string | null, message: string, hint: string | null): string | null {
  const parts = [code ? `${code} · ${message}` : message, hint].filter(Boolean)
  const joined = parts.join(' — ').trim()
  return joined || null
}

export function describeDbError(error: unknown): DbErrorReport {
  const { code, message, hint } = fieldsOf(error)
  const detail = detailOf(code, message, hint)

  if (code && SCHEMA_CODES.has(code)) {
    return {
      kind: 'schema',
      title: 'Base de données en retard',
      message:
        'Cette version de l’application attend une base plus récente : une mise à jour du serveur n’a pas été appliquée. Réessayer n’y changera rien.',
      detail,
    }
  }

  if (code && PERMISSION_CODES.has(code)) {
    return {
      kind: 'permission',
      title: 'Accès refusé',
      message:
        'Le serveur a refusé l’opération. Ces données appartiennent peut-être à un autre compte.',
      detail,
    }
  }

  if (code && SESSION_CODES.has(code)) {
    return {
      kind: 'session',
      title: 'Session expirée',
      message: 'Reconnecte-toi pour retrouver tes notes.',
      detail,
    }
  }

  if (!code && NETWORK_WORDING.test(message)) {
    return {
      kind: 'network',
      title: 'Serveur injoignable',
      message:
        'Vérifie la connexion. Ce qui a été écrit hors ligne sera envoyé dès son retour.',
      detail,
    }
  }

  return {
    kind: 'unknown',
    title: 'Lecture impossible',
    message: detail ?? 'Erreur inconnue.',
    detail: null,
  }
}
