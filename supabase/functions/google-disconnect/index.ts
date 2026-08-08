/**
 * Retire l'accès de Cairn à l'agenda.
 *
 * Deux effacements, dans un ordre qui compte, et une révocation chez Google.
 * Le but est qu'aucun chemin d'échec ne laisse Cairn capable d'écrire dans un
 * agenda dont l'utilisateur croit avoir repris la clé.
 */

import { withSupabase } from 'npm:@supabase/server@1'
import { dechiffrer } from '../_shared/chiffrement.ts'
import { plateformeDepuisScopes, rafraichirJeton, revoquer } from '../_shared/google.ts'

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

    const { data: compte } = await ctx.supabaseAdmin
      .from('google_accounts')
      .select('scopes')
      .eq('user_id', utilisateur)
      .maybeSingle()

    /**
     * La révocation d'abord, l'effacement ensuite — mais son échec n'arrête
     * rien.
     *
     * Si Google est injoignable et qu'on s'arrêtait là, l'utilisateur resterait
     * connecté contre sa volonté, sans moyen d'insister. Or effacer le jeton
     * d'ici suffit à rendre Cairn incapable d'écrire quoi que ce soit : la
     * révocation est un nettoyage chez Google, pas la condition du retrait.
     * L'autorisation résiduelle reste visible et supprimable dans les réglages
     * du compte Google, ce que dit la réponse.
     */
    let revoque = false
    if (ligne?.refresh_token_encrypted) {
      const jeton = await dechiffrer(ligne.refresh_token_encrypted)
      if (jeton) {
        const acces = await rafraichirJeton(jeton, plateformeDepuisScopes(compte?.scopes))
        // On révoque le jeton d'accès quand on a pu en obtenir un : Google
        // révoque alors toute la grappe, jeton de rafraîchissement compris.
        revoque = await revoquer(acces ?? jeton)
      }
    }

    // Le secret en premier : c'est lui qui donne le pouvoir d'écrire. Si la
    // seconde suppression échoue, il ne reste qu'une ligne de métadonnées sans
    // effet, que la reconnexion écrasera.
    await ctx.supabaseAdmin.from('google_credentials').delete().eq('user_id', utilisateur)
    await ctx.supabaseAdmin.from('google_accounts').delete().eq('user_id', utilisateur)

    return Response.json({ revoque })
  }),
}
