-- Atomic reordering of a list's items.
--
-- Why a function and not an upsert from the client: an upsert is an
-- insert-or-update, whereas here we only want updates. On a missing id it would
-- attempt an insert without `content`, which would fail on the NOT NULL
-- constraint with a message unrelated to the real problem.
--
-- A loop of updates on the client would work, but at the cost of a network
-- round trip per moved item, and without atomicity: a cut in the middle would
-- leave the list in an inconsistent order.
--
-- SECURITY INVOKER, the default, is what is wanted here: the function runs with
-- the caller's rights, so the RLS policies of checklist_items apply normally and
-- nobody can reorder someone else's list.

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
