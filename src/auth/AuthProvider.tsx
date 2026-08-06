import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../db/supabase'

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
  if (m.includes('failed to fetch') || m.includes('network request failed'))
    return 'Serveur injoignable. Vérifie la connexion et la configuration Supabase.'
  return message
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

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
      setLoading(false)
      return
    }

    let cancelled = false

    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return
        setSession(data.session)
        setLoading(false)
        syncCacheWithUser(data.session)
      })
      // Un stockage illisible ne doit pas laisser l'application en attente pour
      // toujours : l'aiguillage et les écrans de chargement sont tous deux
      // suspendus à ce drapeau. Sans session, on ira sur l'écran de connexion,
      // ce qui est la bonne conclusion d'une session qu'on n'a pas pu lire.
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    const { data: sub } = getSupabase().auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
      syncCacheWithUser(next)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [syncCacheWithUser])

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
        const { data, error } = await getSupabase().auth.signUp({
          email: email.trim(),
          password,
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

      async signOut() {
        const { error } = await getSupabase().auth.signOut()
        if (error) throw new Error(readableError(error.message))
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être appelé dans un AuthProvider')
  return ctx
}
