-- Exporting a note to Google Calendar.
--
-- The initial schema had already planned everything on the reminders side:
-- `google_kind` can be 'event', `google_id` awaits the id returned by Google,
-- and `sync_state` already carries the outcome of the exchange. Two things were
-- missing, which use brought to light rather than rereading the model.
--
-- 1. A reminder has an instant, an event has a duration. `remind_at` said when
--    to alert; it now also says when the event starts, and `ends_at` when it
--    ends. Without this column, every event would have lasted whatever Google
--    decides by default, that is one hour, without Cairn even being able to
--    tell the user.
--
-- 2. Google returns a URL to the created event. Not keeping it would mean
--    calling the API again to reopen what we have just written, when a text
--    column is enough.
--
-- The third part of this file is of a different nature. It writes into the
-- database the rule decided for protected notes, rather than leaving it to the
-- client alone. See the comment that introduces it.

-- ---------------------------------------------------------------- slot end

alter table reminders add column ends_at timestamptz;

comment on column reminders.ends_at is
  'Fin du créneau pour un export ''event''. Nulle pour un rappel purement local.';

-- A slot that ends before it starts is not data to fix later, it is data to
-- reject right away. Equality is rejected too: Google accepts a zero-length
-- event, but it then appears in no view of the calendar, which looks in every
-- respect like a lost export.
alter table reminders add constraint ends_after_start check (
  ends_at is null or ends_at > remind_at
);

-- ------------------------------------------------------- link back to Google

alter table reminders add column google_html_link text;

comment on column reminders.google_html_link is
  'URL de l''évènement chez Google, telle que rendue à la création. Permet de le rouvrir sans rappeler l''API.';

-- ---------------------------------- refusing to export a protected note
--
-- Cairn encrypts some notes end to end and files others in the vault. Sending
-- them to Google would undo that promise, and undo it all the more quietly as
-- nothing in the calendar would recall where the line came from.
--
-- The interface already hides the button on those notes. That is not enough: a
-- note can be filed in the vault afterwards, a third-party client can write to
-- the table, and a display regression does not show. So the rule holds here,
-- on the same footing as "a reminder targets a note or an item, never both".
--
-- The trigger only looks at rows carrying a `google_kind`: a purely local
-- reminder on a vault note stays legitimate, it does not leave the device and
-- the code name already covers it.
create or replace function refuse_export_note_protegee() returns trigger
language plpgsql
set search_path = public
as $$
declare
  protegee boolean;
begin
  if new.google_kind is null then
    return new;
  end if;

  -- The reminder targets a note or a list item, never both: the
  -- `exactly_one_target` constraint guarantees it. So `coalesce` gets back to
  -- the note in both cases, the item going through the note holding it.
  select n.is_encrypted or n.is_private
    into protegee
    from notes n
   where n.id = coalesce(
           new.note_id,
           (select c.note_id from checklist_items c where c.id = new.checklist_item_id)
         );

  if protegee then
    raise exception
      'export Google refusé : la note est chiffrée ou rangée dans le coffre'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger reminders_refuse_export_note_protegee
  before insert or update on reminders
  for each row execute function refuse_export_note_protegee();

-- Same reasoning as in 20260807090000: the execute right granted to `public` by
-- default serves no purpose here, and a useless right is a right to revoke. The
-- trigger keeps firing, Postgres having checked the right when it was created.
revoke execute on function public.refuse_export_note_protegee() from public;

-- ------------------------------------------------------------------ index

-- Reopening the event from a note takes finding its exports. Without an index,
-- that is a scan of the person's whole table every time a note is opened.
create index reminders_google_events_idx on reminders (note_id, remind_at desc)
  where google_kind = 'event';
