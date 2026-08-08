/**
 * Second consentement Google : l'accès à l'agenda.
 *
 * Distinct de la connexion à Cairn, et c'est délibéré. Se connecter avec Google
 * n'accorde rien sur l'agenda ; l'autorisation est demandée le jour où elle
 * sert, et se retire sans perdre son compte. Les deux flux ne partagent que le
 * fournisseur.
 *
 * Le client mène l'autorisation jusqu'au code, puis passe le relais ici :
 * l'échange du code contre un jeton de rafraîchissement exige le `client_secret`
 * de Google, qui n'a rien à faire dans un APK. Le jeton obtenu ne repart jamais
 * vers le client — il est chiffré et rangé dans `google_credentials`, table dont
 * RLS est actif sans aucune politique.
 */

import { withSupabase } from 'npm:@supabase/server@1'
import { chiffrer } from '../_shared/chiffrement.ts'
import {
  adresseDepuisIdToken,
  echangerCode,
  MARQUE_ANDROID,
  type Plateforme,
  SCOPE_AGENDA,
} from '../_shared/google.ts'

type Corps = {
  code?: string
  redirect_uri?: string
  code_verifier?: string
  /** 'android' pour l'APK, 'web' pour la PWA. Voir `identifiants` côté partagé. */
  platform?: Plateforme
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

    // Liste fermée plutôt que valeur reprise telle quelle : `platform` choisit
    // un jeu d'identifiants côté serveur, et une valeur inattendue doit
    // s'arrêter ici plutôt que de se propager.
    const plateforme: Plateforme = corps.platform === 'android' ? 'android' : 'web'

    let jetons
    try {
      jetons = await echangerCode(code, redirectUri, codeVerifier, plateforme)
    } catch (erreur) {
      return Response.json({ erreur: (erreur as Error).message }, { status: 502 })
    }

    /**
     * Sans jeton de rafraîchissement, il n'y a rien à ranger.
     *
     * Google ne le rend qu'au premier consentement, sauf à redemander
     * explicitement `prompt=consent`. Une seconde autorisation faite sans ce
     * paramètre revient donc avec un jeton d'accès valide une heure et rien
     * d'autre — et l'enregistrer laisserait croire à une connexion durable qui
     * s'éteindrait sans prévenir. Le client demande `prompt=consent` ; ce garde
     * existe pour le cas où il oublierait.
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

    // Le secret d'abord, les métadonnées ensuite. Dans cet ordre, une panne
    // entre les deux laisse un jeton utilisable sans bannière de connexion, ce
    // qui se rattrape à la prochaine tentative. L'ordre inverse afficherait une
    // connexion établie sans jeton derrière, c'est-à-dire un mensonge.
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
     * Sept jours, en mode test Google.
     *
     * Ce n'est pas une valeur devinée : Google fait expirer les jetons de
     * rafraîchissement des projets non vérifiés au bout d'une semaine. La date
     * est posée ici pour que l'interface puisse prévenir avant la panne, plutôt
     * que de laisser découvrir la coupure au moment d'envoyer une note. Un
     * projet vérifié n'expire pas : la colonne accepte donc null.
     */
    const expiration = new Date()
    expiration.setDate(expiration.getDate() + 7)

    const { error: erreurCompte } = await ctx.supabaseAdmin.from('google_accounts').upsert({
      user_id: utilisateur,
      google_email: adresseDepuisIdToken(jetons.id_token),
      // La marque de plateforme voyage avec les scopes. Le rafraîchissement en
      // aura besoin : un jeton obtenu par le client Android ne se rafraîchit
      // pas avec les identifiants Web, et rien d'autre dans la ligne ne dirait
      // lequel des deux a servi.
      scopes: plateforme === 'android' ? [...scopes, MARQUE_ANDROID] : scopes,
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
