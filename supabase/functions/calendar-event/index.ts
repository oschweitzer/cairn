/**
 * Creates a Google Calendar event from a note.
 *
 * What Cairn hands over to Google: the note's title, a slot, and a link to open
 * it. Not the body, not the list items. The link carries the information; the
 * calendar does not need to become a copy of it.
 *
 * Three refusals, at three different depths, and the redundancy is deliberate:
 *
 *   here           we read the note again and stop if it is encrypted or filed
 *                  in the vault, before any call to Google.
 *   the database   the `reminders_refuse_export_note_protegee` trigger rejects
 *                  the row, even if the note has changed state in the meantime.
 *   the interface  the button does not appear on those notes.
 *
 * The first avoids a useless network round trip, the second is the only one
 * that holds whatever happens, the third avoids offering what will be refused.
 * None makes the others redundant.
 */

import { withSupabase } from 'npm:@supabase/server@1'
import { dechiffrer } from '../_shared/chiffrement.ts'
import { creerEvenement, rafraichirJeton, supprimerEvenement } from '../_shared/google.ts'

type Corps = {
  note_id?: string
  starts_at?: string
  ends_at?: string
  time_zone?: string
}

/** True if the string is an ISO date that Date can parse back. */
function dateValide(valeur: string | undefined): valeur is string {
  return typeof valeur === 'string' && !Number.isNaN(Date.parse(valeur))
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

    const { note_id: noteId, starts_at: debut, ends_at: fin } = corps
    const fuseau = corps.time_zone || 'UTC'

    if (!noteId || !dateValide(debut) || !dateValide(fin)) {
      return Response.json(
        { erreur: 'note_id, starts_at et ends_at (ISO) sont requis' },
        { status: 400 },
      )
    }
    if (Date.parse(fin) <= Date.parse(debut)) {
      return Response.json({ erreur: 'la fin doit suivre le début' }, { status: 400 })
    }

    /**
     * Read under RLS, and not with the service key.
     *
     * `ctx.supabase` carries the caller's JWT: so the `own_notes` policy filters
     * by itself, and a note that does not belong to them simply comes back
     * missing. Writing the ownership check by hand would open the door to
     * forgetting it one day; here forgetting is impossible.
     */
    const { data: note, error: erreurNote } = await ctx.supabase
      .from('notes')
      .select('id, title, code_name, is_encrypted, is_private, deleted_at')
      .eq('id', noteId)
      .maybeSingle()

    if (erreurNote) {
      return Response.json({ erreur: 'lecture de la note impossible' }, { status: 500 })
    }
    if (!note || note.deleted_at) {
      return Response.json({ erreur: 'note introuvable' }, { status: 404 })
    }
    if (note.is_encrypted || note.is_private) {
      return Response.json(
        { erreur: 'Une note chiffrée ou rangée dans le coffre ne part pas vers Google.' },
        { status: 403 },
      )
    }

    // --------------------------------------------------------- Google token

    const { data: identifiants } = await ctx.supabaseAdmin
      .from('google_credentials')
      .select('refresh_token_encrypted')
      .eq('user_id', utilisateur)
      .maybeSingle()

    if (!identifiants?.refresh_token_encrypted) {
      return Response.json({ erreur: 'agenda non connecté', code: 'non_connecte' }, { status: 428 })
    }

    const jetonDurable = await dechiffrer(identifiants.refresh_token_encrypted)
    const acces = jetonDurable ? await rafraichirJeton(jetonDurable) : null

    /**
     * Dead token: we say so, we record it, and we do not insist.
     *
     * `needs_reauth` is what the interface reads to show its reconnect banner.
     * Without this write, the user would see the same error on every attempt
     * without ever understanding that they must reauthorise — and in Google's
     * test mode, that happens every week.
     */
    if (!acces) {
      await ctx.supabaseAdmin
        .from('google_accounts')
        .update({ needs_reauth: true, updated_at: new Date().toISOString() })
        .eq('user_id', utilisateur)
      return Response.json(
        { erreur: 'autorisation Google expirée', code: 'reconnexion_requise' },
        { status: 428 },
      )
    }

    // ---------------------------------------------------------------- event

    const base = Deno.env.get('CAIRN_WEB_URL')?.replace(/\/+$/, '')
    if (!base) {
      return Response.json(
        { erreur: 'secret CAIRN_WEB_URL absent des Edge Functions' },
        { status: 500 },
      )
    }
    const lien = `${base}/note/${note.id}`

    // `code_name` should not exist here, a note with a code name necessarily
    // being private and so already refused above. It is preferred to the title
    // as a precaution: should that invariant ever move, the worst would be an
    // event with an overly discreet name, never a leaked title.
    const titre = note.code_name ?? note.title ?? 'Note sans titre'

    let evenement
    try {
      evenement = await creerEvenement(acces, { titre, lien, debut, fin, fuseau })
    } catch (erreur) {
      return Response.json({ erreur: (erreur as Error).message }, { status: 502 })
    }

    /**
     * The local record, and the rollback if it fails.
     *
     * An insert under RLS, so the database trigger has the last word. If it
     * refuses — the note having been filed in the vault during the call to
     * Google — the event already exists at Google. Leaving it would mean keeping
     * at a third party the trace of a note the user has just protected, and
     * Cairn would not even have the reference to remove it later. So we delete
     * it, and return the error.
     */
    const { error: erreurRappel } = await ctx.supabase.from('reminders').insert({
      user_id: utilisateur,
      note_id: note.id,
      remind_at: debut,
      ends_at: fin,
      google_kind: 'event',
      google_id: evenement.id,
      google_html_link: evenement.htmlLink,
      sync_state: 'synced',
      last_synced_at: new Date().toISOString(),
    })

    if (erreurRappel) {
      const retire = await supprimerEvenement(acces, evenement.id)
      return Response.json(
        {
          erreur: retire
            ? 'La note ne peut plus être exportée ; l’évènement a été retiré de l’agenda.'
            : 'Enregistrement impossible, et l’évènement n’a pas pu être retiré de l’agenda.',
        },
        { status: 409 },
      )
    }

    return Response.json({
      id: evenement.id,
      lien_agenda: evenement.htmlLink,
      debut,
      fin,
    })
  }),
}
