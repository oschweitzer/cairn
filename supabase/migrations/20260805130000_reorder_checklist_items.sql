-- Réordonnancement atomique des éléments d'une liste.
--
-- Pourquoi une fonction et pas un upsert depuis le client : un upsert est un
-- insert-ou-update, alors qu'ici on ne veut que des updates. Sur un identifiant
-- absent il tenterait une insertion sans `content`, qui échouerait sur la
-- contrainte NOT NULL avec un message sans rapport avec le vrai problème.
--
-- Une boucle d'updates côté client marcherait, mais au prix d'un aller-retour
-- réseau par élément déplacé, et sans atomicité : une coupure au milieu
-- laisserait la liste dans un ordre incohérent.
--
-- SECURITY INVOKER, le défaut, est ce qu'il faut ici : la fonction s'exécute avec
-- les droits de l'appelant, donc les politiques RLS de checklist_items
-- s'appliquent normalement et personne ne peut réordonner la liste d'autrui.

create or replace function reorder_checklist_items(p_note_id uuid, p_ids uuid[])
returns void
language sql
as $$
  update checklist_items ci
  set position = array_position(p_ids, ci.id) - 1
  where ci.note_id = p_note_id
    and ci.id = any(p_ids);
$$;

comment on function reorder_checklist_items is
  'Fixe position selon l''ordre du tableau fourni. RLS appliquée, un utilisateur ne peut réordonner que ses propres listes.';

grant execute on function reorder_checklist_items(uuid, uuid[]) to authenticated;
