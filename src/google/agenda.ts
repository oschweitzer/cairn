/**
 * Connexion à Google Agenda, et envoi d'une note vers lui.
 *
 * Ce module ne détient aucun secret et ne voit jamais de jeton durable. Il mène
 * le consentement jusqu'au code d'autorisation, puis passe la main aux Edge
 * Functions — voir supabase/functions/_shared/google.ts, qui explique pourquoi
 * l'échange n'a pas sa place ici.
 *
 * Deux identifiants de client, parce que Google impose deux types de clients :
 * « Android » pour l'APK, qui seul accepte une redirection en schéma privé, et
 * « Web » pour la PWA. Les deux sont publics par nature — un identifiant de
 * client n'est pas un secret — d'où le préfixe EXPO_PUBLIC_.
 */

import { Platform } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthRequest, makeRedirectUri, type DiscoveryDocument } from 'expo-auth-session'
import { getSupabase, isSupabaseConfigured } from '../db/supabase'
import { keys } from '../db/queries'

/** Doit rester identique au SCOPE_AGENDA des Edge Functions. */
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
const CLIENT_ANDROID = lireEnv(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID)
const CLIENT_WEB = lireEnv(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB)

const estAndroid = Platform.OS !== 'web'

/**
 * Vrai quand la fonctionnalité peut fonctionner de bout en bout.
 *
 * L'interface s'en sert pour ne pas proposer un bouton qui échouerait. Trois
 * conditions, et chacune manque pour une raison différente : Supabase absent
 * (projet non configuré), identifiant de client absent (console Google pas
 * encore faite), adresse web absente (PWA pas encore déployée, donc aucun lien
 * à déposer dans l'évènement).
 */
export const agendaConfigure =
  isSupabaseConfigured && URL_WEB !== null && (estAndroid ? CLIENT_ANDROID : CLIENT_WEB) !== null

/** Adresse publique d'une note. C'est tout ce que Cairn confie à Google. */
export function lienNote(id: string): string | null {
  return URL_WEB ? `${URL_WEB}/note/${id}` : null
}

/**
 * Redirection de retour du consentement.
 *
 * Sur Android, le schéma privé de l'application. Google n'accepte cette forme
 * que pour un client de type « Android », dont la légitimité est vérifiée par
 * le nom de paquet et l'empreinte de signature plutôt que par une liste d'URL.
 *
 * Sur le web, une route de la PWA, à déclarer dans les origines autorisées du
 * client Web.
 */
function redirection(): string {
  return estAndroid
    ? makeRedirectUri({ scheme: 'cairn', path: 'google' })
    : `${URL_WEB ?? ''}/google`
}

// ----------------------------------------------------------------- lecture

export type CompteGoogle = {
  google_email: string | null
  scopes: string[]
  refresh_expires_at: string | null
  needs_reauth: boolean
  connected_at: string
}

/**
 * État de la connexion à l'agenda.
 *
 * Clé volatile, donc jamais écrite sur le disque. L'adresse Google est une
 * donnée personnelle de plus, et la garder en localStorage pour épargner une
 * requête au démarrage serait un mauvais échange.
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

/** Vrai quand l'autorisation existe et n'a pas expiré. */
export function agendaUtilisable(compte: CompteGoogle | null | undefined): boolean {
  if (!compte || compte.needs_reauth) return false
  if (!compte.scopes.includes(SCOPE_AGENDA)) return false
  if (compte.refresh_expires_at && Date.parse(compte.refresh_expires_at) < Date.now()) return false
  return true
}

// -------------------------------------------------------------- connexion

export function useConnecterAgenda() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const clientId = estAndroid ? CLIENT_ANDROID : CLIENT_WEB
      if (!clientId) {
        throw new Error(
          `Identifiant de client Google absent. Renseigne EXPO_PUBLIC_GOOGLE_CLIENT_ID_${estAndroid ? 'ANDROID' : 'WEB'} dans .env.`,
        )
      }

      const redirectUri = redirection()

      /**
       * `access_type: 'offline'` et `prompt: 'consent'`, ensemble et pas l'un
       * sans l'autre.
       *
       * Le premier demande un jeton de rafraîchissement, le second force
       * Google à le redonner même si l'utilisateur a déjà consenti par le
       * passé. Sans le second, une seconde connexion — après une révocation,
       * après une expiration de sept jours — revient sans jeton durable, et
       * l'Edge Function n'a plus qu'à refuser.
       */
      const requete = new AuthRequest({
        clientId,
        redirectUri,
        scopes: [SCOPE_AGENDA],
        responseType: 'code',
        usePKCE: true,
        extraParams: { access_type: 'offline', prompt: 'consent' },
      })

      const resultat = await requete.promptAsync(DECOUVERTE)

      // Fermeture de l'onglet ou refus : ce n'est pas une erreur, et l'écran
      // ne doit pas afficher de bandeau rouge pour un renoncement volontaire.
      if (resultat.type !== 'success') return { annule: true as const }

      const code = resultat.params.code
      if (!code) throw new Error('Google n’a pas renvoyé de code d’autorisation.')
      if (!requete.codeVerifier) throw new Error('Vérificateur PKCE absent.')

      const { data, error } = await getSupabase().functions.invoke('google-connect', {
        body: {
          code,
          redirect_uri: redirectUri,
          code_verifier: requete.codeVerifier,
          platform: estAndroid ? 'android' : 'web',
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

// ------------------------------------------------------------------ envoi

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
          // Le fuseau de l'appareil, pour que 14 h reste 14 h dans l'agenda.
          // Sans lui, Google interprète l'instant en UTC et l'évènement
          // apparaît décalé de l'écart horaire, ce qui est le genre de défaut
          // qu'on ne remarque qu'en hiver.
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      if (error) throw new Error(await messageErreur(error))
      return data as { lien_agenda: string }
    },
    onSuccess: () => {
      // L'état de connexion a pu changer en chemin : l'Edge Function lève
      // `needs_reauth` quand le jeton est mort, et la bannière doit suivre.
      void qc.invalidateQueries({ queryKey: keys.googleAccount })
    },
  })
}

/**
 * Sort le message des Edge Functions plutôt que « Edge Function returned a
 * non-2xx status code », qui ne dit rien à personne.
 *
 * supabase-js range le corps de la réponse dans `context`, un objet Response
 * qu'il faut relire. L'échec de cette relecture n'est pas grave : on retombe
 * alors sur le message d'origine.
 */
async function messageErreur(error: unknown): Promise<string> {
  const contexte = (error as { context?: Response })?.context
  if (contexte && typeof contexte.json === 'function') {
    try {
      const corps = await contexte.json()
      if (corps?.erreur) return String(corps.erreur)
    } catch {
      /* on garde le message d'origine */
    }
  }
  return (error as Error)?.message ?? 'Échec de l’appel au serveur.'
}
