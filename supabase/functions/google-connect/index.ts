/**
 * The second Google consent: access to the calendar.
 *
 * Separate from signing in to Cairn, and deliberately so. Signing in with
 * Google grants nothing on the calendar; the authorisation is asked for the day
 * it is needed, and is withdrawn without losing one's account. The two flows
 * share nothing but the provider.
 *
 * The client carries the authorisation through to the code, then hands over
 * here: exchanging the code for a refresh token requires Google's
 * `client_secret`, which has no business in an APK. The token obtained never
 * goes back to the client — it is encrypted and stored in `google_credentials`,
 * a table with RLS enabled and no policy at all.
 */

import { withSupabase } from 'npm:@supabase/server@1'
import { chiffrer } from '../_shared/chiffrement.ts'
import { adresseDepuisIdToken, echangerCode, SCOPE_AGENDA } from '../_shared/google.ts'

type Corps = {
  code?: string
  redirect_uri?: string
  code_verifier?: string
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx) => {
    const utilisateur = ctx.userClaims?.id
    if (!utilisateur) {
      return Response.json({ erreur: 'session absente' }, { status: 401 })
    }

    let corps: Corps
    try {
      corps = await req.json()
    } catch {
      return Response.json({ erreur: 'corps JSON attendu' }, { status: 400 })
    }

    const { code, redirect_uri: redirectUri, code_verifier: codeVerifier } = corps
    if (!code || !redirectUri || !codeVerifier) {
      return Response.json(
        { erreur: 'code, redirect_uri et code_verifier sont requis' },
        { status: 400 },
      )
    }

    let jetons
    try {
      jetons = await echangerCode(code, redirectUri, codeVerifier)
    } catch (erreur) {
      return Response.json({ erreur: (erreur as Error).message }, { status: 502 })
    }

    /**
     * Without a refresh token, there is nothing to store.
     *
     * Google only returns it on the first consent, unless `prompt=consent` is
     * explicitly asked for again. So a second authorisation made without that
     * parameter comes back with an access token valid for an hour and nothing
     * else — and recording it would suggest a lasting connection that would die
     * without warning. The client asks for `prompt=consent`; this guard exists
     * for the case where it forgets.
     */
    if (!jetons.refresh_token) {
      return Response.json(
        {
          erreur:
            'Google n’a pas renvoyé de jeton durable. Retire l’accès de Cairn dans ton compte Google, puis recommence.',
        },
        { status: 409 },
      )
    }

    const scopes = jetons.scope ? jetons.scope.split(' ') : []
    if (!scopes.includes(SCOPE_AGENDA)) {
      return Response.json(
        { erreur: 'L’autorisation d’écrire dans l’agenda n’a pas été accordée.' },
        { status: 403 },
      )
    }

    // The secret first, the metadata second. In that order, a failure between
    // the two leaves a usable token without a connection banner, which is made
    // up for on the next attempt. The reverse order would show an established
    // connection with no token behind it, that is to say a lie.
    const { error: erreurSecret } = await ctx.supabaseAdmin
      .from('google_credentials')
      .upsert({
        user_id: utilisateur,
        refresh_token_encrypted: await chiffrer(jetons.refresh_token),
        updated_at: new Date().toISOString(),
      })

    if (erreurSecret) {
      return Response.json({ erreur: 'enregistrement du jeton impossible' }, { status: 500 })
    }

    /**
     * Seven days, in Google's test mode.
     *
     * It is not a guessed value: Google expires the refresh tokens of
     * unverified projects after a week. The date is set here so the interface
     * can warn before the failure, rather than letting the cut be discovered at
     * the moment of sending a note. A verified project does not expire: so the
     * column accepts null.
     */
    const expiration = new Date()
    expiration.setDate(expiration.getDate() + 7)

    const { error: erreurCompte } = await ctx.supabaseAdmin.from('google_accounts').upsert({
      user_id: utilisateur,
      google_email: adresseDepuisIdToken(jetons.id_token),
      scopes,
      refresh_expires_at: expiration.toISOString(),
      needs_reauth: false,
      updated_at: new Date().toISOString(),
    })

    if (erreurCompte) {
      return Response.json({ erreur: 'enregistrement du compte impossible' }, { status: 500 })
    }

    return Response.json({
      email: adresseDepuisIdToken(jetons.id_token),
      expire_le: expiration.toISOString(),
    })
  }),
}
