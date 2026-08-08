/**
 * Crée un évènement Google Agenda à partir d'une note.
 *
 * Ce que Cairn confie à Google : le titre de la note, un créneau, et un lien
 * pour l'ouvrir. Pas le corps, pas les éléments de la liste. Le lien porte
 * l'information ; l'agenda n'a pas à en devenir une copie.
 *
 * Trois refus, à trois profondeurs différentes, et cette redondance est
 * voulue :
 *
 *   ici          on relit la note et on s'arrête si elle est chiffrée ou rangée
 *                dans le coffre, avant tout appel à Google.
 *   la base      le déclencheur `reminders_refuse_export_note_protegee` refuse
 *                la ligne, y compris si la note a changé d'état entre-temps.
 *   l'interface  le bouton n'apparaît pas sur ces notes.
 *
 * La première évite un aller-retour réseau inutile, la deuxième est la seule
 * qui tienne quoi qu'il arrive, la troisième évite de proposer ce qui sera
 * refusé. Aucune ne rend les autres superflues.
 */

import { withSupabase } from 'npm:@supabase/server@1'
import { dechiffrer } from '../_shared/chiffrement.ts'
import {
  creerEvenement,
  plateformeDepuisScopes,
  rafraichirJeton,
  supprimerEvenement,
} from '../_shared/google.ts'

type Corps = {
  note_id?: string
  starts_at?: string
  ends_at?: string
  time_zone?: string
}

/** Vrai si la chaîne est une date ISO que Date sait relire. */
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
     * Lecture sous RLS, et non avec la clé de service.
     *
     * `ctx.supabase` porte le JWT de l'appelant : la politique `own_notes`
     * filtre donc d'elle-même, et une note qui ne lui appartient pas revient
     * simplement absente. Écrire la vérification de propriété à la main
     * ouvrirait la porte à l'oublier un jour ; ici l'oubli est impossible.
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

    // --------------------------------------------------------- jeton Google

    const { data: identifiants } = await ctx.supabaseAdmin
      .from('google_credentials')
      .select('refresh_token_encrypted')
      .eq('user_id', utilisateur)
      .maybeSingle()

    if (!identifiants?.refresh_token_encrypted) {
      return Response.json({ erreur: 'agenda non connecté', code: 'non_connecte' }, { status: 428 })
    }

    // Les scopes disent par quel client la connexion s'est faite. Le jeton
    // n'est rafraîchissable que par celui-là.
    const { data: compte } = await ctx.supabaseAdmin
      .from('google_accounts')
      .select('scopes')
      .eq('user_id', utilisateur)
      .maybeSingle()

    const jetonDurable = await dechiffrer(identifiants.refresh_token_encrypted)
    const acces = jetonDurable
      ? await rafraichirJeton(jetonDurable, plateformeDepuisScopes(compte?.scopes))
      : null

    /**
     * Jeton mort : on le dit, on le note, et on n'insiste pas.
     *
     * `needs_reauth` est ce que lit l'interface pour afficher sa bannière de
     * reconnexion. Sans cette écriture, l'utilisateur reverrait la même erreur à
     * chaque tentative sans jamais comprendre qu'il doit réautoriser — et en
     * mode test Google, cela se produit toutes les semaines.
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

    // ------------------------------------------------------------ évènement

    const base = Deno.env.get('CAIRN_WEB_URL')?.replace(/\/+$/, '')
    if (!base) {
      return Response.json(
        { erreur: 'secret CAIRN_WEB_URL absent des Edge Functions' },
        { status: 500 },
      )
    }
    const lien = `${base}/note/${note.id}`

    // `code_name` ne devrait pas exister ici, une note à nom de code étant
    // forcément privée et donc déjà refusée plus haut. Il est préféré au titre
    // par précaution : si cet invariant venait à bouger, le pire serait un
    // évènement au nom trop discret, jamais un titre échappé.
    const titre = note.code_name ?? note.title ?? 'Note sans titre'

    let evenement
    try {
      evenement = await creerEvenement(acces, { titre, lien, debut, fin, fuseau })
    } catch (erreur) {
      return Response.json({ erreur: (erreur as Error).message }, { status: 502 })
    }

    /**
     * L'enregistrement local, et le retour arrière s'il échoue.
     *
     * Insertion sous RLS, donc le déclencheur de la base a le dernier mot. S'il
     * refuse — la note ayant été rangée dans le coffre pendant l'appel à
     * Google — l'évènement existe déjà chez Google. Le laisser serait garder
     * chez un tiers la trace d'une note que l'utilisateur vient de protéger, et
     * Cairn n'en aurait même pas la référence pour la retirer plus tard. On le
     * supprime donc, et on rend l'erreur.
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
