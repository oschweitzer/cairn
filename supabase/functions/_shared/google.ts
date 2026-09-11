/**
 * Exchanges with Google: tokens and calendar.
 *
 * Everything touching the client credentials lives here, so on the server.
 *
 * The exchange requires a `client_secret`, and a secret embedded in a bundle or
 * an APK is not a secret. Add to that the token obtained: a refresh token is
 * worth permanent access to a calendar, and passing it through the device and
 * then leaving it asleep in its storage would multiply the places it could leak
 * from. So it never leaves the server.
 */

/**
 * Creating and editing events, on the person's calendars.
 *
 * Deliberately separate from the sign-in scope. Signing in to Cairn gives no
 * access to the calendar: it is a second consent, asked for the day the user
 * sends their first note, and revocable without losing their account.
 *
 * Google classes this scope as sensitive. In test mode, that caps the project at
 * a hundred accounts and makes refresh tokens expire after seven days — hence
 * `refresh_expires_at` and `needs_reauth` in google_accounts, which exist
 * precisely to make that expiry readable rather than endured.
 */
export const SCOPE_AGENDA = 'https://www.googleapis.com/auth/calendar.events'

const POINT_JETON = 'https://oauth2.googleapis.com/token'
const POINT_REVOCATION = 'https://oauth2.googleapis.com/revoke'
const POINT_EVENEMENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/**
 * A single OAuth client, of the "Web" type, for the APK as for the PWA.
 *
 * Google has deprecated private schemes on the Android side: the redirect now
 * goes through an `https://` app link, which the system hands to the installed
 * app. So both platforms share the same return address, and therefore the same
 * client — with its secret, which lives only here.
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
 * Exchanges the authorisation code for tokens.
 *
 * `code_verifier` goes with the code because the client runs a PKCE flow, as
 * for sign-in. The client secret does not make PKCE unnecessary: it protects
 * the exchange, PKCE protects the code on its way back through the deep link,
 * where another installed app could intercept it.
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
 * Returns a fresh access token from the refresh token.
 *
 * Returns `null` when Google answers `invalid_grant`, which means the refresh
 * token is worth nothing any more: revoked by hand, expired after seven days in
 * test mode, or invalidated by a password change. The caller must then set
 * `needs_reauth` rather than retry — no amount of repetition will bring that
 * token back to life.
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

/** Revokes the authorisation with Google. Failure does not block: see the caller. */
export async function revoquer(token: string): Promise<boolean> {
  const reponse = await fetch(POINT_REVOCATION, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  })
  return reponse.ok
}

/**
 * The Google account's address, read from the `id_token`.
 *
 * A JWT's payload is unsigned base64url on the reading side, but here it does
 * not need verifying: this token has just arrived in an HTTPS response from
 * Google to our own request, authenticated by the client secret. It has gone
 * through no intermediary. Besides, the address is only used to display
 * « connecté en tant que… », it authorises nothing.
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
 * Deletes an event. Used to undo a creation that could not be recorded on the
 * Cairn side — see the caller, which explains why leaving the event in place
 * would be worse than removing it.
 */
export async function supprimerEvenement(accessToken: string, id: string): Promise<boolean> {
  const reponse = await fetch(`${POINT_EVENEMENTS}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
  })
  // 410: already deleted. That is the state we are after, so a success.
  return reponse.ok || reponse.status === 410
}

/**
 * Creates the event on the primary calendar.
 *
 * `sendUpdates: 'none'` is explicit: without it, Google may notify guests.
 * There are none here, but relying on the absence of guests not to send email
 * would be relying on an input default rather than on an instruction.
 */
export async function creerEvenement(
  accessToken: string,
  evenement: {
    titre: string
    /** The note's address. It is all Cairn hands over to Google of the content. */
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
      // A sentence rather than the bare URL: in the calendar, an address alone
      // says neither where it comes from nor what it will open.
      description: `Ouvrir la note dans Cairn :\n${evenement.lien}`,
      start: { dateTime: evenement.debut, timeZone: evenement.fuseau },
      end: { dateTime: evenement.fin, timeZone: evenement.fuseau },
      // Filled in on top of the description: Google Calendar shows the source
      // as a clean clickable link, whereas the URL in the description depends on
      // the client to be detected.
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
