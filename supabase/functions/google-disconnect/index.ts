/**
 * Removes Cairn's access to the calendar.
 *
 * Two erasures, in an order that matters, and a revocation at Google. The goal
 * is that no failure path leaves Cairn able to write to a calendar whose key the
 * user believes they have taken back.
 */

import { withSupabase } from 'npm:@supabase/server@1'
import { dechiffrer } from '../_shared/chiffrement.ts'
import { rafraichirJeton, revoquer } from '../_shared/google.ts'

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req: Request, ctx) => {
    const utilisateur = ctx.userClaims?.id
    if (!utilisateur) {
      return Response.json({ erreur: 'session absente' }, { status: 401 })
    }

    const { data: ligne } = await ctx.supabaseAdmin
      .from('google_credentials')
      .select('refresh_token_encrypted')
      .eq('user_id', utilisateur)
      .maybeSingle()

    /**
     * Revocation first, erasure second — but its failure stops nothing.
     *
     * If Google were unreachable and we stopped there, the user would stay
     * connected against their will, with no way to insist. Yet erasing the
     * token from here is enough to make Cairn unable to write anything: the
     * revocation is a clean-up at Google, not the condition for withdrawal. The
     * leftover authorisation stays visible and removable in the Google account
     * settings, which is what the response says.
     */
    let revoque = false
    if (ligne?.refresh_token_encrypted) {
      const jeton = await dechiffrer(ligne.refresh_token_encrypted)
      if (jeton) {
        const acces = await rafraichirJeton(jeton)
        // We revoke the access token when we could get one: Google then revokes
        // the whole bundle, refresh token included.
        revoque = await revoquer(acces ?? jeton)
      }
    }

    // The secret first: it is what gives the power to write. If the second
    // deletion fails, all that is left is a row of harmless metadata, which
    // reconnecting will overwrite.
    await ctx.supabaseAdmin.from('google_credentials').delete().eq('user_id', utilisateur)
    await ctx.supabaseAdmin.from('google_accounts').delete().eq('user_id', utilisateur)

    return Response.json({ revoque })
  }),
}
