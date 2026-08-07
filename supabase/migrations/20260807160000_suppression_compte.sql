-- Suppression du compte, et de tout ce qui y est rattaché.
--
-- ── Une seule ligne à supprimer ──────────────────────────────────────────────
-- Toutes les tables de l'application référencent `auth.users` en cascade, soit
-- directement (notes, tags, profiles, reminders, vault_keys, google_accounts,
-- google_credentials), soit à travers elles (checklist_items et note_tags
-- pendent de notes et de tags). Le schéma `auth` de Supabase fait de même pour
-- les identités, les sessions, les jetons à usage unique et les facteurs MFA.
-- Supprimer la ligne d'`auth.users` suffit donc, et surtout : rien à tenir à
-- jour ici quand une table s'ajoutera, à condition qu'elle cascade comme les
-- autres. Une liste explicite d'ordres DELETE, elle, aurait vieilli en silence
-- et laissé des données derrière.
--
-- ── Pourquoi une fonction, et pas des ordres depuis le client ────────────────
-- Le client ne peut pas toucher à `auth.users` : ce n'est pas exposé par
-- PostgREST, et les politiques RLS de l'application ne parlent que de `public`.
-- Effacer ses notes une par une depuis le client laisserait de toute façon le
-- compte lui-même en place, avec son adresse et ses identités.
--
-- SECURITY DEFINER parce que la suppression a lieu dans `auth`, hors de portée
-- du rôle `authenticated`. Le pouvoir emprunté reste borné à une ligne, la
-- sienne : `auth.uid()` est lu à l'intérieur de la fonction et n'est pas un
-- paramètre, donc il n'y a pas d'identifiant à falsifier depuis l'appelant.
--
-- ── Ce que cette suppression ne fait pas ─────────────────────────────────────
-- Elle est immédiate et sans délai de grâce : rien ne reste à restaurer, y
-- compris depuis la corbeille de l'application. C'est le comportement demandé,
-- et c'est aussi le seul qui se tienne pour un coffre chiffré — garder une copie
-- « au cas où » contredirait ce que le chiffrement promet.
--
-- Elle ne touche pas au stockage sur l'appareil : la clé de données du coffre
-- vit dans le Keystore ou dans localStorage, hors de la base. Le client l'efface
-- de son côté, après cet appel.

create or replace function delete_own_account() returns void
language plpgsql
security definer
-- Chemin vidé : tout est qualifié ci-dessous, donc aucun schéma placé en tête
-- par un appelant ne peut détourner un nom vers sa propre fonction.
set search_path = ''
as $$
declare
  moi uuid := auth.uid();
begin
  -- Sans session il n'y a pas de compte à supprimer. Le dire plutôt que de
  -- laisser passer un DELETE sur `id = null`, qui ne toucherait rien et
  -- rendrait un succès trompeur.
  if moi is null then
    raise exception 'Aucune session, rien à supprimer'
      using errcode = '28000';
  end if;

  delete from auth.users where id = moi;
end;
$$;

/*
 * Deux retraits, et il faut les deux.
 *
 * Postgres accorde `execute` à PUBLIC sur toute fonction nouvelle. Supabase y
 * ajoute un `alter default privileges` qui l'accorde en plus, nommément, à
 * `anon`, `authenticated` et `service_role`. Ce sont deux sources distinctes :
 * retirer l'une laisse l'autre debout.
 *
 * La migration de durcissement note l'inverse — que retirer le droit aux rôles
 * nommés « ne leur enlève rien ». C'est faux, et l'observation qui l'avait fait
 * écrire était mal lue : le premier retrait, visant les rôles nommés, avait bien
 * agi, mais sans changer la réponse de `has_function_privilege` puisque PUBLIC
 * accordait encore le droit par ailleurs. D'où l'impression d'un coup dans
 * l'eau. Vérifié cette fois sur `proacl`, qui montre les entrées une à une
 * plutôt qu'un oui-ou-non déjà agrégé.
 *
 * `service_role` garde le sien : il ne sort jamais du serveur, et c'est par lui
 * que passerait une éventuelle suppression administrative.
 */
revoke execute on function delete_own_account() from public, anon;
grant execute on function delete_own_account() to authenticated;

comment on function delete_own_account() is
  'Supprime le compte de l''appelant et, par cascade, toutes ses données. Sans retour possible.';
