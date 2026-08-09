-- Ordre choisi des notes dans la grille.
--
-- Jusqu'ici l'ordre était subi : épinglées d'abord, puis par date de
-- modification. Écrire un mot dans une note la faisait remonter en tête, et rien
-- ne permettait de ranger une note à une place et de l'y laisser.
--
-- ── Pourquoi un défaut à zéro plutôt qu'un rang initial ──────────────────────
-- Toutes les notes existantes démarrent donc à égalité, et le départage se fait
-- comme avant, sur `updated_at` décroissant : la migration ne change l'ordre de
-- personne. C'est aussi ce qui place une note fraîchement créée en tête sans
-- rien avoir à écrire — elle naît à zéro, donc à égalité avec la première, et
-- gagne le départage puisqu'elle est la plus récente.
--
-- Un rang initial calculé aurait figé l'ordre du jour de la migration, y compris
-- pour qui ne se servira jamais du glisser-déposer.

alter table notes add column position integer not null default 0;

comment on column notes.position is
  'Rang choisi dans la grille. Zéro par défaut, départagé par updated_at décroissant.';

-- L'index de la grille principale porte désormais le rang, entre l'épingle et la
-- date : c'est l'ordre exact du tri d'affichage, donc Postgres le lit sans
-- retrier. Sans cette reprise, la grille repassait par un tri en mémoire à
-- chaque lecture.
drop index notes_active_idx;
create index notes_active_idx
  on notes (user_id, is_pinned desc, position, updated_at desc)
  where deleted_at is null and is_archived = false and is_private = false;

drop index notes_private_idx;
create index notes_private_idx
  on notes (user_id, position, updated_at desc)
  where deleted_at is null and is_private = true;

-- ------------------------------------------------- réordonnancement atomique

/*
 * Fixe le rang des notes selon l'ordre du tableau fourni.
 *
 * Même raisonnement que `reorder_checklist_items`, et pour les mêmes raisons :
 * un upsert depuis le client serait un insert-ou-update, or on ne veut que des
 * updates — sur un identifiant absent il tenterait une insertion et échouerait
 * sur une contrainte sans rapport avec le vrai problème. Une boucle d'updates
 * coûterait un aller-retour réseau par note déplacée, et une coupure au milieu
 * laisserait la grille dans un ordre incohérent.
 *
 * SECURITY INVOKER, le défaut : la fonction s'exécute avec les droits de
 * l'appelant, donc les politiques RLS de `notes` s'appliquent et personne ne
 * peut réordonner la grille d'autrui. Le `set search_path` reprend le
 * durcissement déjà appliqué aux autres fonctions.
 */
create or replace function reorder_notes(p_ids uuid[])
returns void
language sql
set search_path = public
as $$
  update notes n
  set position = array_position(p_ids, n.id) - 1
  where n.id = any(p_ids);
$$;

comment on function reorder_notes is
  'Fixe position selon l''ordre du tableau fourni. RLS appliquée, un utilisateur ne peut réordonner que ses propres notes.';

grant execute on function reorder_notes(uuid[]) to authenticated;
