-- The chosen order of notes in the grid.
--
-- Until now the order was imposed: pinned first, then by modification date.
-- Writing a word in a note brought it back to the top, and nothing allowed
-- putting a note in a place and leaving it there.
--
-- ── Why a default of zero rather than an initial rank ────────────────────────
-- So every existing note starts level, and ties are broken as before, on
-- `updated_at` descending: the migration changes nobody's order. It is also
-- what puts a freshly created note at the top without writing anything — it is
-- born at zero, so level with the first, and wins the tie since it is the most
-- recent.
--
-- A computed initial rank would have frozen the order as of the migration's
-- day, including for people who will never use drag and drop.

alter table notes add column position integer not null default 0;

comment on column notes.position is
  'Rang choisi dans la grille. Zéro par défaut, départagé par updated_at décroissant.';

-- The main grid's index now carries the rank, between the pin and the date: it
-- is the exact order of the display sort, so Postgres reads it without sorting
-- again. Without this rework, the grid went through an in-memory sort on every
-- read.
drop index notes_active_idx;
create index notes_active_idx
  on notes (user_id, is_pinned desc, position, updated_at desc)
  where deleted_at is null and is_archived = false and is_private = false;

drop index notes_private_idx;
create index notes_private_idx
  on notes (user_id, position, updated_at desc)
  where deleted_at is null and is_private = true;

-- ----------------------------------------------------------- atomic reordering

/*
 * Sets the notes' ranks according to the order of the given array.
 *
 * Same reasoning as `reorder_checklist_items`, and for the same reasons: an
 * upsert from the client would be an insert-or-update, and we only want
 * updates — on a missing id it would attempt an insert and fail on a constraint
 * unrelated to the real problem. A loop of updates would cost a network round
 * trip per moved note, and a cut in the middle would leave the grid in an
 * inconsistent order.
 *
 * SECURITY INVOKER, the default: the function runs with the caller's rights, so
 * the RLS policies of `notes` apply and nobody can reorder someone else's grid.
 * The `set search_path` repeats the hardening already applied to the other
 * functions.
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
