import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../db/supabase'

/**
 * Marker of a recovery in progress, written to storage.
 *
 * It is not there out of excess caution: without it, the hold did not survive
 * the first reload. Observed by actually walking through the flow — once on the
 * new-password screen, a mere navigation to the root led into the notes.
 * Supabase announces `PASSWORD_RECOVERY` only once, when the code is exchanged;
 * on the next reload it restores the session and announces `INITIAL_SESSION`,
 * an event that says nothing about recovery. So the in-memory flag dropped back
 * to false, the ordinary rule took over again, and the forgotten password stayed
 * forgotten — precisely the situation this screen exists to prevent.
 *
 * AsyncStorage rather than localStorage: it sits on localStorage on the web and
 * on native storage on Android, which makes a single write to write.
 */
const RECUPERATION = 'cairn.recuperation-en-cours'

/**
 * Supabase session and authentication actions.
 *
 * Google sign-in goes through the browser flow with PKCE, not through the
 * native Google Sign-In module. Two reasons: this flow works today on Android
 * as on the web without a native build or a SHA-1 fingerprint, and the Google
 * credentials stay entirely on the Supabase side, so out of the client.
 *
 * This sign-in asks for no calendar access. The Google Tasks and Calendar
 * authorisation is a second, separate OAuth flow, handled in phase 4. Keeping
 * them apart prevents an expired calendar authorisation from blocking sign-in,
 * which will happen regularly since Google's test mode expires every 7 days.
 */

type AuthContextValue = {
  session: Session | null
  /** True until the persisted session has first been read. */
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>

  /**
   * Sends the recovery email. Never says whether the address is known:
   * answering "this account does not exist" would turn this form into a tool
   * for discovering registered addresses.
   */
  sendPasswordReset: (email: string) => Promise<void>
  /**
   * True between the click on the emailed link and setting the new password.
   *
   * The link opens a real session: without this flag, routing would send
   * straight into the app someone who has not yet chosen their new password,
   * and the screen asking for it would never be reached.
   */
  recovering: boolean
  updatePassword: (password: string) => Promise<void>

  /**
   * Deletes the account and everything attached to it, with no way back.
   *
   * Only deals with the server, the session and the cache. What sits on the
   * device — the vault code and the data key — is erased by the vault provider,
   * whether the vault is configured or not. The settings screen chains the two,
   * in that order: if the server call fails, the local key is still there, and
   * the account with its encrypted notes stays readable. The reverse would leave
   * data unreadable forever.
   */
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Turns Supabase error messages into readable wording. */
function readableError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Adresse ou mot de passe incorrect.'
  if (m.includes('email not confirmed')) return 'Adresse non confirmée, regarde ta boîte mail.'
  if (m.includes('user already registered')) return 'Un compte existe déjà avec cette adresse.'
  if (m.includes('password should be at least'))
    return 'Le mot de passe doit faire au moins 6 caractères.'
  if (m.includes('unable to validate email address')) return 'Cette adresse ne semble pas valide.'
  /**
   * Sending limits, actually hit while walking through the flow: the screen
   * showed "email rate limit exceeded" as is, in English and in the server's
   * vocabulary. The two limits do not call for the same patience, hence two
   * messages: the project's is counted in hours, the person's in seconds.
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
   * Two reads to wait for, not one.
   *
   * Routing waits on `loading`, and it must only run once both the session AND
   * the recovery marker are known. A single flag was not enough: the session
   * comes back from storage well before the marker, and routing then set off
   * with `recovering` still false, led into the notes, then corrected itself
   * when the marker arrived. A visible round trip, on the very screen we are
   * trying not to let anyone bypass.
   */
  const [sessionLue, setSessionLue] = useState(false)
  const [marqueLue, setMarqueLue] = useState(false)
  const loading = !sessionLue || !marqueLue

  /**
   * True as soon as the recovery state has been settled by an event, which
   * always takes precedence over the stored marker: the marker is read back
   * asynchronously and can arrive afterwards, where applying it would overwrite
   * what Supabase has just announced.
   */
  const recuperationTranchee = useRef(false)
  const noterRecuperation = useCallback((actif: boolean) => {
    recuperationTranchee.current = true
    setRecovering(actif)
    // The write need not be awaited: on the web it is synchronous under the
    // hood, and a storage failure must not make authentication fail.
    void (actif
      ? AsyncStorage.setItem(RECUPERATION, '1')
      : AsyncStorage.removeItem(RECUPERATION)
    ).catch(() => {})
  }, [])

  /**
   * The cache follows the session's identity.
   *
   * Two situations, two answers, and neither is theoretical.
   *
   * The session arrives after the first render: nothing waits for the token, so
   * reads may have gone out without it and come back with zero rows, RLS having
   * done its job. They have to be replayed, otherwise the grid stays empty until
   * the next expiry.
   *
   * The account changes: the previous one's cache is still there, on the disk
   * too, and it will be displayed for the length of a network round trip.
   * Showing someone else's notes, even for a second, is not a display glitch.
   * So the cache is cleared, not invalidated.
   *
   * The identity, not the event: `onAuthStateChange` also fires on every token
   * refresh, where there is nothing to redo.
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
    // Without configuration there is no session to read: we leave loading so
    // the configuration screen can show, without attempting a network call
    // bound to fail.
    if (!isSupabaseConfigured) {
      setSessionLue(true)
      setMarqueLue(true)
      return
    }

    let cancelled = false

    // Reading the recovery marker back, alongside the session. It only applies
    // if no event has already settled the matter.
    AsyncStorage.getItem(RECUPERATION)
      .then((valeur) => {
        if (cancelled || recuperationTranchee.current) return
        if (valeur === '1') setRecovering(true)
      })
      // Unreadable storage must not hold the app on the loading screen.
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
      // Unreadable storage must not leave the app waiting forever: routing and
      // the loading screens both wait on this flag. Without a session we go to
      // the sign-in screen, which is the right conclusion for a session that
      // could not be read.
      .catch(() => {
        if (!cancelled) setSessionLue(true)
      })

    const { data: sub } = getSupabase().auth.onAuthStateChange((event, next) => {
      setSession(next)
      setSessionLue(true)
      syncCacheWithUser(next)
      // Supabase announces that a recovery session has opened, but only once:
      // this is where, and the only place where, we can learn it. Hence the
      // written marker, which takes over on the following loads.
      if (event === 'PASSWORD_RECOVERY') noterRecuperation(true)
      // And without a session there is nothing left to recover: without this
      // reset, signing out from the new-password screen would leave you locked
      // in there, navigation being held by this very flag.
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
         * The return address, which this function alone used to leave out.
         *
         * Without it, Supabase falls back on the project's site URL: the
         * confirmation link therefore pointed to `http://localhost:8081/`, the
         * root of a development server, wherever the sign-up had been made
         * from. Found by reading the email received, not by rereading the code
         * — nothing here flagged the omission.
         *
         * Same address as Google sign-in and recovery: a single entry to
         * declare on the Supabase side, a single one to forget.
         */
        const { data, error } = await getSupabase().auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: makeRedirectUri({ scheme: 'cairn', path: 'callback' }) },
        })
        if (error) throw new Error(readableError(error.message))
        // When email confirmation is on, Supabase returns a user without a
        // session: that has to be said rather than leaving the screen waiting
        // for a redirect that will not come.
        return { needsConfirmation: Boolean(data.user) && !data.session }
      },

      async signInWithGoogle() {
        // Must match an entry of the Supabase allow list exactly, under
        // Authentication then URL Configuration. On the web that gives
        // <origin>/callback, on mobile cairn://callback.
        const redirectTo = makeRedirectUri({ scheme: 'cairn', path: 'callback' })

        if (Platform.OS === 'web') {
          const { error } = await getSupabase().auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo },
          })
          if (error) throw new Error(readableError(error.message))
          // The page is redirecting away, there is nothing to wait for here.
          return
        }

        // On mobile, we get the URL without following it, open a browser
        // session, then exchange the code for a session.
        const { data, error } = await getSupabase().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        })
        if (error) throw new Error(readableError(error.message))
        if (!data.url) throw new Error('Google n’a pas renvoyé d’URL d’autorisation.')

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
        if (result.type !== 'success') {
          // The user closed the tab or cancelled: that is not an error.
          return
        }

        const code = new URL(result.url).searchParams.get('code')
        if (!code) throw new Error('Réponse Google inattendue, code d’autorisation absent.')

        const exchange = await getSupabase().auth.exchangeCodeForSession(code)
        if (exchange.error) throw new Error(readableError(exchange.error.message))
      },

      async sendPasswordReset(email) {
        // Same return address as Google sign-in: it is already on the project's
        // allow list, and a second one to declare there would be a second one
        // to forget.
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
        // The marker is lifted together with the flag: the password is set, a
        // reload has no reason left to bring you back here.
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
         * Sign-out is local, and there is no choice.
         *
         * The account no longer exists: an ordinary sign-out would go and revoke
         * the token with a server that no longer knows anyone, and return an
         * error for work already done — the session having been swept away by
         * the cascade. So we just erase the token from here.
         */
        await getSupabase().auth.signOut({ scope: 'local' })

        // The persisted cache survives sign-out, by design: that is what lets
        // you find your notes without waiting on the network. Here there are no
        // notes left to find, and leaving them on the disk would mean keeping a
        // copy of what we have just promised to erase.
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
