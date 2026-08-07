import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../db/supabase'

/**
 * Marque de récupération en cours, écrite sur le support de stockage.
 *
 * Elle n'est pas là par excès de prudence : sans elle, la retenue ne passait pas
 * le premier rechargement. Constaté en éprouvant le parcours pour de bon —
 * arrivé sur l'écran du nouveau mot de passe, une simple navigation vers la
 * racine emmenait dans les notes. Supabase n'annonce `PASSWORD_RECOVERY` qu'une
 * fois, à l'échange du code ; au rechargement suivant il restaure la session et
 * annonce `INITIAL_SESSION`, un évènement qui ne dit rien de la récupération. Le
 * drapeau en mémoire retombait donc à faux, la règle ordinaire reprenait la
 * main, et le mot de passe oublié le restait — c'est-à-dire précisément la
 * situation que cet écran existe pour empêcher.
 *
 * AsyncStorage plutôt que localStorage : il s'adosse à localStorage sur le web
 * et au stockage natif sur Android, ce qui fait une seule écriture à écrire.
 */
const RECUPERATION = 'cairn.recuperation-en-cours'

/**
 * Session Supabase et actions d'authentification.
 *
 * La connexion Google passe par le flux navigateur avec PKCE, pas par le module
 * natif Google Sign-In. Deux raisons : ce flux fonctionne dès aujourd'hui sur
 * Android comme sur le web sans build natif ni empreinte SHA-1, et les
 * identifiants Google restent entièrement côté Supabase, donc hors du client.
 *
 * Cette connexion ne demande aucun accès à l'agenda. L'autorisation Google Tasks
 * et Calendar est un second flux OAuth, distinct, traité en phase 4. Les séparer
 * évite qu'une autorisation agenda expirée empêche de se connecter, ce qui
 * arrivera régulièrement puisque le mode test Google expire tous les 7 jours.
 */

type AuthContextValue = {
  session: Session | null
  /** Vrai jusqu'à la première lecture de la session persistée. */
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>

  /**
   * Envoie le courriel de récupération. Ne dit jamais si l'adresse est connue :
   * répondre « ce compte n'existe pas » transformerait ce formulaire en outil de
   * découverte des adresses inscrites.
   */
  sendPasswordReset: (email: string) => Promise<void>
  /**
   * Vrai entre le clic sur le lien reçu et la pose du nouveau mot de passe.
   *
   * Le lien ouvre une vraie session : sans ce drapeau, l'aiguillage enverrait
   * droit dans l'application quelqu'un qui n'a pas encore choisi son nouveau mot
   * de passe, et l'écran qui le demande ne serait jamais atteint.
   */
  recovering: boolean
  updatePassword: (password: string) => Promise<void>

  /**
   * Supprime le compte et tout ce qui s'y rattache, sans retour possible.
   *
   * Ne s'occupe que du serveur, de la session et du cache. Ce qui dort sur
   * l'appareil — le code du coffre et la clé de données — est effacé par le
   * fournisseur du coffre, que celui-ci soit configuré ou non. L'écran des
   * réglages enchaîne les deux, dans cet ordre : si l'appel serveur échoue, la
   * clé locale est encore là, et le compte avec ses notes chiffrées reste
   * lisible. L'inverse laisserait des données illisibles à jamais.
   */
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Transforme les messages d'erreur de Supabase en formulations lisibles. */
function readableError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Adresse ou mot de passe incorrect.'
  if (m.includes('email not confirmed')) return 'Adresse non confirmée, regarde ta boîte mail.'
  if (m.includes('user already registered')) return 'Un compte existe déjà avec cette adresse.'
  if (m.includes('password should be at least'))
    return 'Le mot de passe doit faire au moins 6 caractères.'
  if (m.includes('unable to validate email address')) return 'Cette adresse ne semble pas valide.'
  /**
   * Plafonds d'envoi, rencontrés pour de bon en éprouvant le parcours : l'écran
   * affichait « email rate limit exceeded » tel quel, en anglais et dans le
   * vocabulaire du serveur. Les deux plafonds n'appellent pas la même patience,
   * d'où deux messages : celui du projet se compte en heures, celui de la
   * personne en secondes.
   */
  if (m.includes('email rate limit exceeded') || m.includes('over_email_send_rate_limit'))
    return 'Trop de courriels envoyés depuis ce projet dans l’heure. Réessaie un peu plus tard.'
  if (m.includes('for security purposes') || m.includes('over_request_rate_limit'))
    return 'Demande déjà envoyée il y a quelques instants. Patiente une minute avant de réessayer.'
  if (m.includes('failed to fetch') || m.includes('network request failed'))
    return 'Serveur injoignable. Vérifie la connexion et la configuration Supabase.'
  return message
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [recovering, setRecovering] = useState(false)
  const qc = useQueryClient()

  /**
   * Deux lectures à attendre, pas une.
   *
   * L'aiguillage est suspendu à `loading`, et il ne doit s'exécuter qu'une fois
   * la session ET la marque de récupération connues. Un seul drapeau ne
   * suffisait pas : la session revient du stockage bien avant la marque, et
   * l'aiguillage partait alors avec `recovering` encore à faux, emmenait dans
   * les notes, puis se rattrapait quand la marque arrivait. Un aller-retour
   * visible, sur l'écran qu'on cherche justement à ne pas contourner.
   */
  const [sessionLue, setSessionLue] = useState(false)
  const [marqueLue, setMarqueLue] = useState(false)
  const loading = !sessionLue || !marqueLue

  /**
   * Vrai dès que l'état de récupération est tranché par un évènement, lequel
   * fait toujours autorité sur la marque stockée : celle-ci est relue de manière
   * asynchrone et peut revenir après coup, où l'appliquer écraserait ce que
   * Supabase vient d'annoncer.
   */
  const recuperationTranchee = useRef(false)
  const noterRecuperation = useCallback((actif: boolean) => {
    recuperationTranchee.current = true
    setRecovering(actif)
    // L'écriture n'a pas à être attendue : sur le web elle est synchrone sous le
    // capot, et un échec de stockage ne doit pas faire échouer l'authentification.
    void (actif
      ? AsyncStorage.setItem(RECUPERATION, '1')
      : AsyncStorage.removeItem(RECUPERATION)
    ).catch(() => {})
  }, [])

  /**
   * Le cache suit l'identité de la session.
   *
   * Deux situations, deux réponses, et aucune n'est théorique.
   *
   * La session arrive après le premier rendu : rien n'attend le jeton, donc les
   * lectures ont pu partir sans lui et revenir avec zéro ligne, RLS ayant fait
   * son travail. Il faut les rejouer, sans quoi la grille reste vide jusqu'à la
   * prochaine péremption.
   *
   * On change de compte : le cache du précédent est encore là, y compris sur le
   * disque, et il s'affichera le temps d'un aller-retour réseau. Montrer les
   * notes de quelqu'un d'autre, même une seconde, n'est pas un défaut
   * d'affichage. Le cache est donc vidé, pas invalidé.
   *
   * L'identité, et non l'événement : `onAuthStateChange` parle aussi à chaque
   * renouvellement de jeton, où il n'y a rien à refaire.
   */
  const seenUserId = useRef<string | null | undefined>(undefined)
  const syncCacheWithUser = useCallback(
    (next: Session | null) => {
      const nextId = next?.user.id ?? null
      const previous = seenUserId.current
      seenUserId.current = nextId
      if (previous === nextId) return
      if (previous != null) {
        void qc.clear()
        return
      }
      if (nextId != null) void qc.invalidateQueries()
    },
    [qc],
  )

  useEffect(() => {
    // Sans configuration, il n'y a pas de session à lire : on sort du
    // chargement pour laisser l'écran de configuration s'afficher, sans tenter
    // d'appel réseau voué à échouer.
    if (!isSupabaseConfigured) {
      setSessionLue(true)
      setMarqueLue(true)
      return
    }

    let cancelled = false

    // Relecture de la marque de récupération, en parallèle de la session. Elle
    // ne s'applique que si aucun évènement ne l'a déjà tranchée.
    AsyncStorage.getItem(RECUPERATION)
      .then((valeur) => {
        if (cancelled || recuperationTranchee.current) return
        if (valeur === '1') setRecovering(true)
      })
      // Un stockage illisible ne doit pas retenir l'application au chargement.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMarqueLue(true)
      })

    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return
        setSession(data.session)
        setSessionLue(true)
        syncCacheWithUser(data.session)
      })
      // Un stockage illisible ne doit pas laisser l'application en attente pour
      // toujours : l'aiguillage et les écrans de chargement sont tous deux
      // suspendus à ce drapeau. Sans session, on ira sur l'écran de connexion,
      // ce qui est la bonne conclusion d'une session qu'on n'a pas pu lire.
      .catch(() => {
        if (!cancelled) setSessionLue(true)
      })

    const { data: sub } = getSupabase().auth.onAuthStateChange((event, next) => {
      setSession(next)
      setSessionLue(true)
      syncCacheWithUser(next)
      // Supabase annonce l'ouverture d'une session de récupération, mais une
      // seule fois : c'est ici, et nulle part ailleurs, qu'on peut l'apprendre.
      // D'où la marque écrite, qui prend le relais aux chargements suivants.
      if (event === 'PASSWORD_RECOVERY') noterRecuperation(true)
      // Et sans session, il n'y a plus rien à récupérer : sans cette remise à
      // zéro, se déconnecter depuis l'écran du nouveau mot de passe y laisserait
      // enfermé, la navigation y étant retenue par ce même drapeau.
      if (!next) noterRecuperation(false)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [syncCacheWithUser, noterRecuperation])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,

      async signInWithPassword(email, password) {
        const { error } = await getSupabase().auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw new Error(readableError(error.message))
      },

      async signUpWithPassword(email, password) {
        /**
         * L'adresse de retour, que cette fonction était seule à omettre.
         *
         * Sans elle, Supabase se rabat sur l'URL de site du projet : le lien de
         * confirmation envoyait donc vers `http://localhost:8081/`, c'est-à-dire
         * la racine d'un serveur de développement, quel que soit l'endroit d'où
         * l'inscription était faite. Constaté en lisant le courriel reçu, pas en
         * relisant le code — rien ici ne signalait l'absence.
         *
         * Même adresse que la connexion Google et que la récupération : une
         * seule entrée à déclarer côté Supabase, une seule à oublier.
         */
        const { data, error } = await getSupabase().auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: makeRedirectUri({ scheme: 'cairn', path: 'callback' }) },
        })
        if (error) throw new Error(readableError(error.message))
        // Quand la confirmation par courriel est active, Supabase renvoie un
        // utilisateur sans session : il faut le dire plutôt que de laisser
        // l'écran attendre une redirection qui n'arrivera pas.
        return { needsConfirmation: Boolean(data.user) && !data.session }
      },

      async signInWithGoogle() {
        // Doit correspondre exactement à une entrée de la liste blanche Supabase,
        // Authentication puis URL Configuration. Sur le web cela donne
        // <origine>/callback, sur mobile cairn://callback.
        const redirectTo = makeRedirectUri({ scheme: 'cairn', path: 'callback' })

        if (Platform.OS === 'web') {
          const { error } = await getSupabase().auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo },
          })
          if (error) throw new Error(readableError(error.message))
          // La page part en redirection, il n'y a rien à attendre ici.
          return
        }

        // Sur mobile, on récupère l'URL sans la suivre, on ouvre une session de
        // navigateur, puis on échange le code contre une session.
        const { data, error } = await getSupabase().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        })
        if (error) throw new Error(readableError(error.message))
        if (!data.url) throw new Error('Google n’a pas renvoyé d’URL d’autorisation.')

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
        if (result.type !== 'success') {
          // L'utilisateur a fermé l'onglet ou annulé : ce n'est pas une erreur.
          return
        }

        const code = new URL(result.url).searchParams.get('code')
        if (!code) throw new Error('Réponse Google inattendue, code d’autorisation absent.')

        const exchange = await getSupabase().auth.exchangeCodeForSession(code)
        if (exchange.error) throw new Error(readableError(exchange.error.message))
      },

      async sendPasswordReset(email) {
        // Même adresse de retour que la connexion Google : elle est déjà dans la
        // liste blanche du projet, et une seconde à y déclarer serait une seconde
        // à oublier.
        const redirectTo = makeRedirectUri({ scheme: 'cairn', path: 'callback' })
        const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
          redirectTo,
        })
        if (error) throw new Error(readableError(error.message))
      },

      recovering,

      async updatePassword(password) {
        const { error } = await getSupabase().auth.updateUser({ password })
        if (error) throw new Error(readableError(error.message))
        // La marque est levée en même temps que le drapeau : le mot de passe est
        // posé, un rechargement n'a plus de raison de ramener ici.
        noterRecuperation(false)
      },

      async signOut() {
        const { error } = await getSupabase().auth.signOut()
        if (error) throw new Error(readableError(error.message))
      },

      async deleteAccount() {
        const { error } = await getSupabase().rpc('delete_own_account')
        if (error) throw new Error(readableError(error.message))

        /**
         * La déconnexion est locale, et il n'y a pas le choix.
         *
         * Le compte n'existe plus : une déconnexion ordinaire irait révoquer le
         * jeton auprès d'un serveur qui ne connaît plus personne, et rendrait une
         * erreur pour un travail déjà fait — la session ayant été emportée par la
         * cascade. On se contente donc d'effacer le jeton d'ici.
         */
        await getSupabase().auth.signOut({ scope: 'local' })

        // Le cache persisté survit à la déconnexion, par construction : c'est ce
        // qui permet de retrouver ses notes sans attendre le réseau. Ici il n'y a
        // plus de notes à retrouver, et les laisser sur le disque serait garder
        // une copie de ce qu'on vient de promettre d'effacer.
        await qc.clear()
        noterRecuperation(false)
      },
    }),
    [session, loading, recovering, noterRecuperation, qc],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être appelé dans un AuthProvider')
  return ctx
}
