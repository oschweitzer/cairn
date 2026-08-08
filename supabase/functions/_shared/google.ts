/**
 * Échanges avec Google : jetons et agenda.
 *
 * Tout ce qui touche aux identifiants de client vit ici, donc côté serveur.
 *
 * L'échange exige un `client_secret`, et un secret embarqué dans un bundle ou
 * dans un APK n'est pas un secret. S'y ajoute le jeton obtenu : un jeton de
 * rafraîchissement vaut l'accès permanent à un agenda, et le faire transiter
 * par l'appareil puis dormir dans son stockage multiplierait les endroits d'où
 * il peut fuir. Il ne quitte donc jamais le serveur.
 */

/**
 * Créer et modifier des évènements, sur les agendas de la personne.
 *
 * Volontairement distinct du scope de connexion. Se connecter à Cairn ne donne
 * aucun accès à l'agenda : c'est un second consentement, demandé le jour où
 * l'utilisateur envoie sa première note, et révocable sans perdre son compte.
 *
 * Google classe ce scope comme sensible. En mode test, cela borne le projet à
 * cent comptes et fait expirer les jetons de rafraîchissement au bout de sept
 * jours — d'où `refresh_expires_at` et `needs_reauth` dans google_accounts, qui
 * existent précisément pour rendre cette expiration lisible plutôt que subie.
 */
export const SCOPE_AGENDA = 'https://www.googleapis.com/auth/calendar.events'

const POINT_JETON = 'https://oauth2.googleapis.com/token'
const POINT_REVOCATION = 'https://oauth2.googleapis.com/revoke'
const POINT_EVENEMENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/**
 * Un seul client OAuth, de type « Web », pour l'APK comme pour la PWA.
 *
 * Google a déprécié les schémas privés côté Android : la redirection y passe
 * désormais par un lien d'application `https://`, que le système remet à
 * l'application installée. Les deux plateformes partagent donc la même adresse
 * de retour, et donc le même client — avec son secret, qui ne vit qu'ici.
 */
function identifiants(): { id: string; secret: string } {
  const id = Deno.env.get('GOOGLE_CLIENT_ID_WEB')
  const secret = Deno.env.get('GOOGLE_CLIENT_SECRET_WEB')
  if (!id || !secret) {
    throw new Error(
      'secrets GOOGLE_CLIENT_ID_WEB ou GOOGLE_CLIENT_SECRET_WEB absents des Edge Functions',
    )
  }
  return { id, secret }
}

export type JetonsGoogle = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  id_token?: string
}

/**
 * Échange le code d'autorisation contre des jetons.
 *
 * `code_verifier` accompagne le code parce que le client mène un flux PKCE,
 * comme pour la connexion. Le secret du client ne dispense pas de PKCE : il
 * protège l'échange, PKCE protège le code pendant son trajet de retour par le
 * lien profond, où une autre application installée pourrait l'intercepter.
 */
export async function echangerCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<JetonsGoogle> {
  const { id, secret } = identifiants()
  const reponse = await fetch(POINT_JETON, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
    }),
  })
  const corps = await reponse.json()
  if (!reponse.ok) {
    throw new Error(`Google a refusé l’échange du code : ${corps.error_description ?? corps.error}`)
  }
  return corps as JetonsGoogle
}

/**
 * Rend un jeton d'accès neuf à partir du jeton de rafraîchissement.
 *
 * Rend `null` quand Google répond `invalid_grant`, ce qui signifie que le jeton
 * de rafraîchissement ne vaut plus rien : révoqué à la main, expiré après sept
 * jours en mode test, ou invalidé par un changement de mot de passe. L'appelant
 * doit alors lever `needs_reauth` plutôt que de retenter — aucune répétition ne
 * fera revivre ce jeton.
 */
export async function rafraichirJeton(refreshToken: string): Promise<string | null> {
  const { id, secret } = identifiants()
  const reponse = await fetch(POINT_JETON, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: 'refresh_token',
    }),
  })
  const corps = await reponse.json()
  if (!reponse.ok) return null
  return (corps as JetonsGoogle).access_token
}

/** Révoque l'autorisation chez Google. L'échec n'est pas bloquant : voir l'appelant. */
export async function revoquer(token: string): Promise<boolean> {
  const reponse = await fetch(POINT_REVOCATION, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  })
  return reponse.ok
}

/**
 * L'adresse du compte Google, lue dans l'`id_token`.
 *
 * La charge utile d'un JWT est du base64url non signé côté lecture, mais ici
 * elle n'a pas à être vérifiée : ce jeton vient d'arriver par une réponse HTTPS
 * de Google en réponse à notre propre requête authentifiée par le secret du
 * client. Il n'a traversé aucun intermédiaire. L'adresse ne sert d'ailleurs qu'à
 * afficher « connecté en tant que… », elle n'autorise rien.
 */
export function adresseDepuisIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const charge = idToken.split('.')[1]
    if (!charge) return null
    const json = atob(charge.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as { email?: string }
    return claims.email ?? null
  } catch {
    return null
  }
}

export type EvenementCree = {
  id: string
  htmlLink: string
}

/**
 * Supprime un évènement. Sert à défaire une création qu'on n'a pas pu
 * enregistrer côté Cairn — voir l'appelant, qui explique pourquoi laisser
 * l'évènement en place serait pire que de le retirer.
 */
export async function supprimerEvenement(accessToken: string, id: string): Promise<boolean> {
  const reponse = await fetch(`${POINT_EVENEMENTS}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
  })
  // 410 : déjà supprimé. C'est l'état recherché, donc un succès.
  return reponse.ok || reponse.status === 410
}

/**
 * Crée l'évènement sur l'agenda principal.
 *
 * `sendUpdates: 'none'` est explicite : sans lui, Google peut prévenir des
 * invités. Il n'y en a aucun ici, mais compter sur l'absence d'invités pour ne
 * pas envoyer de courriel serait compter sur un défaut d'entrée plutôt que sur
 * une consigne.
 */
export async function creerEvenement(
  accessToken: string,
  evenement: {
    titre: string
    /** Adresse de la note. C'est tout ce que Cairn confie à Google du contenu. */
    lien: string
    debut: string
    fin: string
    fuseau: string
  },
): Promise<EvenementCree> {
  const reponse = await fetch(`${POINT_EVENEMENTS}?sendUpdates=none`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      summary: evenement.titre,
      // Une phrase plutôt que l'URL nue : dans l'agenda, une adresse seule ne
      // dit pas d'où elle vient ni ce qu'elle ouvrira.
      description: `Ouvrir la note dans Cairn :\n${evenement.lien}`,
      start: { dateTime: evenement.debut, timeZone: evenement.fuseau },
      end: { dateTime: evenement.fin, timeZone: evenement.fuseau },
      // Renseigné en plus de la description : Google Agenda affiche la source
      // comme un lien cliquable propre, là où l'URL de la description dépend du
      // client pour être détectée.
      source: { title: 'Cairn', url: evenement.lien },
    }),
  })
  const corps = await reponse.json()
  if (!reponse.ok) {
    throw new Error(
      `Google Agenda a refusé la création : ${corps.error?.message ?? reponse.statusText}`,
    )
  }
  return { id: corps.id, htmlLink: corps.htmlLink }
}
