-- Cairn, initial schema.
--
-- Two principles govern this file.
--
-- 1. Invariants live in the database, not in the client. An encrypted note
--    cannot hold a plaintext title, a reminder cannot target both a note and a
--    list item, a list item cannot belong to another user's note. These are
--    constraints, not conventions the application code would have to remember
--    to respect.
--
-- 2. The Google token is never readable by the client. It lives in a separate
--    table with RLS enabled and no policy at all, which forbids any access
--    except to the service key used by the Edge Functions.

-- ---------------------------------------------------------------- types

create type note_kind as enum ('note', 'checklist');

-- Must stay in sync with `tagPalette` in src/ui/theme.ts.
-- Adding a hue takes a migration: alter type tag_color add value '...'.
create type tag_color as enum (
  'ocre', 'oxyde', 'grenat', 'amethyste', 'ardoise',
  'malachite', 'mousse', 'silex', 'craie', 'basalte'
);

create type google_target as enum ('task', 'event');
create type sync_state as enum ('pending', 'synced', 'error', 'disabled');
create type theme_preference as enum ('dark', 'light', 'system');

-- ---------------------------------------------------------------- profiles

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  -- Mirror of the setting, to find one's preferences again on a new device.
  -- The source of truth for display stays local storage, read before the first
  -- render to avoid a flash of the inverted theme.
  theme_preference theme_preference not null default 'dark',
  -- The widget can be forced dark even when the system is light.
  widget_force_dark boolean not null default false,
  -- Whether private notes appear in the widget, under their code name.
  widget_show_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ notes

create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,

  kind note_kind not null default 'note',

  -- Null when the note is encrypted: everything is then in ciphertext.
  title text,
  body text,

  -- Palette key, never a hexadecimal. Null means "card without a tint".
  color_key tag_color,

  is_pinned boolean not null default false,
  is_archived boolean not null default false,

  -- Hiding: the note leaves the grid and only appears in the vault.
  is_private boolean not null default false,
  -- Code name substituted for the title wherever the note is listed.
  code_name text,

  -- End-to-end encryption, which can be turned on note by note.
  is_encrypted boolean not null default false,
  ciphertext text,
  nonce text,
  wrapped_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Lets child tables reference (note_id, user_id) in one piece, which makes it
  -- structurally impossible to attach a list item to someone else's note. See
  -- the composite foreign keys below.
  unique (id, user_id),

  -- An encrypted note stores no plaintext, and conversely a plaintext note
  -- stores no half-filled encryption material.
  constraint encrypted_note_has_no_plaintext check (
    case when is_encrypted
      then title is null and body is null
           and ciphertext is not null and nonce is not null and wrapped_key is not null
      else ciphertext is null and nonce is null and wrapped_key is null
    end
  ),

  -- A code name only makes sense on a hidden note.
  constraint code_name_requires_private check (code_name is null or is_private),

  -- The plaintext title stays optional, but if it exists it is not empty.
  constraint title_not_blank check (title is null or length(btrim(title)) > 0)
);

comment on column notes.code_name is
  'Substitué au titre dans la grille, les notifications et le widget. Masquage, pas chiffrement.';

-- ------------------------------------------------------------ list items

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  user_id uuid not null default auth.uid(),

  content text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  due_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite key: the item necessarily follows its note's owner.
  foreign key (note_id, user_id) references notes (id, user_id) on delete cascade,

  constraint content_not_blank check (length(btrim(content)) > 0)
);

-- --------------------------------------------------------------------- tags

create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color_key tag_color not null default 'silex',
  position integer not null default 0,
  created_at timestamptz not null default now(),

  -- Two tags with the same name for the same user add nothing.
  unique (user_id, name),
  unique (id, user_id),

  constraint name_not_blank check (length(btrim(name)) > 0)
);

create table note_tags (
  note_id uuid not null,
  tag_id uuid not null,
  user_id uuid not null default auth.uid(),

  primary key (note_id, tag_id),

  foreign key (note_id, user_id) references notes (id, user_id) on delete cascade,
  foreign key (tag_id, user_id) references tags (id, user_id) on delete cascade
);

-- --------------------------------------------------------------- reminders

create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,

  -- Exactly one of the two targets, never both, never neither.
  note_id uuid,
  checklist_item_id uuid references checklist_items on delete cascade,

  remind_at timestamptz not null,

  -- Local notification: it is what actually alerts the user, and it works
  -- without network and without Google.
  local_notification_id text,

  -- Google export, independent of the local notification.
  google_kind google_target,
  google_id text,
  sync_state sync_state not null default 'pending',
  last_error text,
  last_synced_at timestamptz,
  -- Number of attempts, to space out retries without looping forever.
  attempts integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (note_id, user_id) references notes (id, user_id) on delete cascade,

  constraint exactly_one_target check (
    (note_id is not null) <> (checklist_item_id is not null)
  )
);

-- --------------------------------------------------------- Google accounts

-- Metadata visible to the client: enough to show the connection state and the
-- reconnect banner, without ever exposing a secret.
create table google_accounts (
  user_id uuid primary key references auth.users on delete cascade,
  google_email text,
  scopes text[] not null default '{}',
  -- Refresh token expiry. In Google's test mode, it falls at 7 days.
  refresh_expires_at timestamptz,
  needs_reauth boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The secret itself. RLS enabled WITH NO POLICY AT ALL: no authenticated or
-- anon role can read, write or even detect these rows. Only the service key,
-- used by the Edge Functions, bypasses RLS.
create table google_credentials (
  user_id uuid primary key references auth.users on delete cascade,
  -- Encrypted server-side with a key stored in the Edge Functions secrets.
  refresh_token_encrypted text not null,
  updated_at timestamptz not null default now()
);

comment on table google_credentials is
  'Jamais accessible au client. RLS actif sans politique, seule la clé de service passe.';

-- ------------------------------------------------------------------ index

-- Main grid: live notes, not archived, pinned first.
create index notes_active_idx on notes (user_id, is_pinned desc, updated_at desc)
  where deleted_at is null and is_archived = false and is_private = false;

-- Vault.
create index notes_private_idx on notes (user_id, updated_at desc)
  where deleted_at is null and is_private = true;

create index notes_archived_idx on notes (user_id, updated_at desc)
  where deleted_at is null and is_archived = true;

create index notes_trash_idx on notes (user_id, deleted_at desc)
  where deleted_at is not null;

create index checklist_items_note_idx on checklist_items (note_id, position);
create index note_tags_tag_idx on note_tags (tag_id);
create index tags_user_idx on tags (user_id, position);

-- Sync queue: only what is left to do gets scanned.
create index reminders_pending_idx on reminders (user_id, remind_at)
  where sync_state in ('pending', 'error');

create index reminders_upcoming_idx on reminders (user_id, remind_at);

-- French full-text search. Only covers plaintext notes: encrypted notes are
-- searched on the client, over the decrypted local index.
alter table notes add column search_vector tsvector
  generated always as (
    to_tsvector('french'::regconfig, coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored;

create index notes_search_idx on notes using gin (search_vector);

-- ---------------------------------------------------------------- updated_at

create or replace function touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_touch before update on notes
  for each row execute function touch_updated_at();
create trigger checklist_items_touch before update on checklist_items
  for each row execute function touch_updated_at();
create trigger reminders_touch before update on reminders
  for each row execute function touch_updated_at();
create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();
create trigger google_accounts_touch before update on google_accounts
  for each row execute function touch_updated_at();

-- ------------------------------------------------------ profile on sign-up

create or replace function create_profile_for_new_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function create_profile_for_new_user();

-- ------------------------------------------------------------------- RLS

alter table profiles enable row level security;
alter table notes enable row level security;
alter table checklist_items enable row level security;
alter table tags enable row level security;
alter table note_tags enable row level security;
alter table reminders enable row level security;
alter table google_accounts enable row level security;
alter table google_credentials enable row level security;

-- `using` filters what is readable, `with check` what is writable. Both are
-- needed: without `with check`, a user could insert a row in someone else's
-- name.

create policy own_profile on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create policy own_notes on notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_checklist_items on checklist_items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_tags on tags for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_note_tags on note_tags for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_reminders on reminders for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_google_account on google_accounts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- google_credentials: no policy, on purpose. Every query from an authenticated
-- client returns zero rows and every write fails.
