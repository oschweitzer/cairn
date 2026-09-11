/**
 * Google Calendar connection, and sending a note to it.
 *
 * This module holds no secret and never sees a long-lived token. It carries the
 * consent through to the authorisation code, then hands over to the Edge
 * Functions — see supabase/functions/_shared/google.ts, which explains why the
 * exchange has no place here.
 *
 * A single OAuth client, of the "Web" type, for the APK as for the PWA.
 *
 * An "Android" client would have seemed more natural for the APK, but Google
 * has deprecated private schemes on that side — "Custom URI schemes are no
 * longer supported on Android" — and rejects the redirect with a terse
 * `invalid_request`. The way it now pushes is app links: an ordinary
 * `https://` redirect, which Android hands to the installed app rather than the
 * browser, because the domain and the app recognise each other through
 * `/.well-known/assetlinks.json`.
 *
 * Hence a single return address, the same everywhere, and a single client id.
 * It is public by nature — a client id is not a secret — hence the EXPO_PUBLIC_
 * prefix. Only the matching secret stays on the Edge Functions side.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthRequest, makeRedirectUri, type DiscoveryDocument } from 'expo-auth-session'
import { getSupabase, isSupabaseConfigured } from '../db/supabase'
import { keys } from '../db/queries'

/** Must stay identical to the Edge Functions' SCOPE_AGENDA. */
const SCOPE_AGENDA = 'https://www.googleapis.com/auth/calendar.events'

const DECOUVERTE: DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
}

function lireEnv(valeur: string | undefined): string | null {
  const propre = valeur?.trim()
  return propre ? propre : null
}

const URL_WEB = lireEnv(process.env.EXPO_PUBLIC_WEB_URL)?.replace(/\/+$/, '') ?? null
const CLIENT_WEB = lireEnv(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB)

/**
 * True when the feature can work end to end.
 *
 * The interface uses it so as not to offer a button that would fail. Three
 * conditions, and each is missing for a different reason: Supabase absent
 * (project not configured), client id absent (Google console not done yet),
 * web address absent (PWA not deployed yet, so no link to put in the event).
 */
export const agendaConfigure =
  isSupabaseConfigured && URL_WEB !== null && CLIENT_WEB !== null

/** A note's public address. It is all Cairn hands over to Google. */
export function lienNote(id: string): string | null {
  return URL_WEB ? `${URL_WEB}/note/${id}` : null
}

/**
 * The consent's return address, identical on both platforms.
 *
 * On the web, the popup lands there and hands control back to the window that
 * opened it — see app/(auth)/google.tsx.
 *
 * On Android, this same address is declared as an app link in app.config.js:
 * the system hands it to Cairn instead of opening it in the browser, and the
 * authentication session closes with the code. If domain verification failed,
 * the page would open in the browser and consent would not go through — hence
 * the importance of the file produced by `npm run assetlinks`.
 */
function redirection(): string {
  return `${URL_WEB ?? ''}/google`
}

// -------------------------------------------------------------------- read

export type CompteGoogle = {
  google_email: string | null
  scopes: string[]
  refresh_expires_at: string | null
  needs_reauth: boolean
  connected_at: string
}

/**
 * State of the calendar connection.
 *
 * A volatile key, so never written to disk. The Google address is one more
 * piece of personal data, and keeping it in localStorage to spare one request
 * at startup would be a bad trade.
 */
export function useCompteGoogle() {
  return useQuery({
    queryKey: keys.googleAccount,
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<CompteGoogle | null> => {
      const { data, error } = await getSupabase()
        .from('google_accounts')
        .select('google_email, scopes, refresh_expires_at, needs_reauth, connected_at')
        .maybeSingle()
      if (error) throw error
      return (data as CompteGoogle | null) ?? null
    },
  })
}

/** True when the authorisation exists and has not expired. */
export function agendaUtilisable(compte: CompteGoogle | null | undefined): boolean {
  if (!compte || compte.needs_reauth) return false
  if (!compte.scopes.includes(SCOPE_AGENDA)) return false
  if (compte.refresh_expires_at && Date.parse(compte.refresh_expires_at) < Date.now()) return false
  return true
}

// -------------------------------------------------------------- connection

export function useConnecterAgenda() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!CLIENT_WEB) {
        throw new Error(
          'Identifiant de client Google absent. Renseigne EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB dans .env.',
        )
      }

      const redirectUri = redirection()

      /**
       * `access_type: 'offline'` and `prompt: 'consent'`, together and never
       * one without the other.
       *
       * The first asks for a refresh token, the second forces Google to hand
       * it out again even if the user has already consented in the past.
       * Without the second, a second connection — after a revocation, after a
       * seven-day expiry — comes back without a long-lived token, and the Edge
       * Function has no choice but to refuse.
       */
      const requete = new AuthRequest({
        clientId: CLIENT_WEB,
        redirectUri,
        scopes: [SCOPE_AGENDA],
        responseType: 'code',
        usePKCE: true,
        extraParams: { access_type: 'offline', prompt: 'consent' },
      })

      const resultat = await requete.promptAsync(DECOUVERTE)

      // Closing the tab or refusing: that is not an error, and the screen must
      // not show a red banner for a deliberate change of mind.
      if (resultat.type !== 'success') return { annule: true as const }

      const code = resultat.params.code
      if (!code) throw new Error('Google n’a pas renvoyé de code d’autorisation.')
      if (!requete.codeVerifier) throw new Error('Vérificateur PKCE absent.')

      const { data, error } = await getSupabase().functions.invoke('google-connect', {
        body: {
          code,
          redirect_uri: redirectUri,
          code_verifier: requete.codeVerifier,
        },
      })
      if (error) throw new Error(await messageErreur(error))
      return { annule: false as const, email: (data as { email?: string })?.email ?? null }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.googleAccount })
    },
  })
}

export function useDeconnecterAgenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await getSupabase().functions.invoke('google-disconnect', { body: {} })
      if (error) throw new Error(await messageErreur(error))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.googleAccount })
    },
  })
}

// ------------------------------------------------------------------- send

export type EnvoiAgenda = {
  noteId: string
  debut: Date
  fin: Date
}

export function useEnvoyerVersAgenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ noteId, debut, fin }: EnvoiAgenda) => {
      const { data, error } = await getSupabase().functions.invoke('calendar-event', {
        body: {
          note_id: noteId,
          starts_at: debut.toISOString(),
          ends_at: fin.toISOString(),
          // The device's time zone, so 2 pm stays 2 pm in the calendar.
          // Without it, Google reads the instant as UTC and the event shows up
          // shifted by the time difference, the kind of defect nobody notices
          // until winter.
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      if (error) throw new Error(await messageErreur(error))
      return data as { lien_agenda: string }
    },
    onSuccess: () => {
      // The connection state may have changed along the way: the Edge Function
      // sets `needs_reauth` when the token is dead, and the banner must follow.
      void qc.invalidateQueries({ queryKey: keys.googleAccount })
    },
  })
}

/**
 * Pulls out the Edge Functions' message rather than "Edge Function returned a
 * non-2xx status code", which tells nobody anything.
 *
 * supabase-js puts the response body in `context`, a Response object that has
 * to be read again. Failing to read it is not serious: we then fall back on the
 * original message.
 */
async function messageErreur(error: unknown): Promise<string> {
  const contexte = (error as { context?: Response })?.context
  if (contexte && typeof contexte.json === 'function') {
    try {
      const corps = await contexte.json()
      if (corps?.erreur) return String(corps.erreur)
    } catch {
      /* keep the original message */
    }
  }
  return (error as Error)?.message ?? 'Échec de l’appel au serveur.'
}
