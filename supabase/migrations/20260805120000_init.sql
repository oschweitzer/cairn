-- Cairn, schéma initial.
--
-- Deux principes gouvernent ce fichier.
--
-- 1. Les invariants vivent dans la base, pas dans le client. Une note chiffrée ne
--    peut pas contenir de titre en clair, un rappel ne peut pas viser à la fois
--    une note et un élément de liste, un élément de liste ne peut pas appartenir
--    à la note d'un autre utilisateur. Ce sont des contraintes, pas des
--    conventions que le code applicatif devrait se rappeler de respecter.
--
-- 2. Le jeton Google n'est jamais lisible par le client. Il vit dans une table
--    séparée dont RLS est activé sans aucune politique, ce qui interdit tout
--    accès sauf à la clé de service utilisée par les Edge Functions.

-- ---------------------------------------------------------------- types

create type note_kind as enum ('note', 'checklist');

-- Doit rester synchronisé avec `tagPalette` dans src/ui/theme.ts.
-- Ajouter une teinte demande une migration : alter type tag_color add value '...'.
create type tag_color as enum (
  'ocre', 'oxyde', 'grenat', 'amethyste', 'ardoise',
  'malachite', 'mousse', 'silex', 'craie', 'basalte'
);

create type google_target as enum ('task', 'event');
create type sync_state as enum ('pending', 'synced', 'error', 'disabled');
create type theme_preference as enum ('dark', 'light', 'system');

-- ---------------------------------------------------------------- profils

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  -- Miroir du réglage, pour retrouver ses préférences sur un nouvel appareil.
  -- La source de vérité à l'affichage reste le stockage local, lu avant le
  -- premier rendu pour éviter le flash de thème inversé.
  theme_preference theme_preference not null default 'dark',
  -- Le widget peut être forcé en sombre même quand le système est en clair.
  widget_force_dark boolean not null default false,
  -- Les notes privées apparaissent-elles dans le widget, sous leur nom de code.
  widget_show_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ notes

create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,

  kind note_kind not null default 'note',

  -- Nuls lorsque la note est chiffrée : tout est alors dans ciphertext.
  title text,
  body text,

  -- Clé de palette, jamais un hexadécimal. Nul signifie « carte sans teinte ».
  color_key tag_color,

  is_pinned boolean not null default false,
  is_archived boolean not null default false,

  -- Masquage : la note sort de la grille et n'apparaît que dans le coffre.
  is_private boolean not null default false,
  -- Nom de code substitué au titre partout où la note est listée.
  code_name text,

  -- Chiffrement bout en bout, activable note par note.
  is_encrypted boolean not null default false,
  ciphertext text,
  nonce text,
  wrapped_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Permet aux tables filles de référencer (note_id, user_id) d'un seul tenant,
  -- ce qui rend structurellement impossible de rattacher un élément de liste
  -- à la note d'autrui. Voir les clés étrangères composites plus bas.
  unique (id, user_id),

  -- Une note chiffrée ne stocke aucun texte clair, et réciproquement une note
  -- en clair ne stocke pas de matériel de chiffrement à moitié rempli.
  constraint encrypted_note_has_no_plaintext check (
    case when is_encrypted
      then title is null and body is null
           and ciphertext is not null and nonce is not null and wrapped_key is not null
      else ciphertext is null and nonce is null and wrapped_key is null
    end
  ),

  -- Un nom de code n'a de sens que sur une note masquée.
  constraint code_name_requires_private check (code_name is null or is_private),

  -- Le titre en clair reste optionnel, mais s'il existe il n'est pas vide.
  constraint title_not_blank check (title is null or length(btrim(title)) > 0)
);

comment on column notes.code_name is
  'Substitué au titre dans la grille, les notifications et le widget. Masquage, pas chiffrement.';

-- --------------------------------------------------- éléments de liste

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

  -- Clé composite : l'élément suit forcément le propriétaire de sa note.
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

  -- Deux tags de même nom chez un même utilisateur n'apportent rien.
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

-- ----------------------------------------------------------------- rappels

create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,

  -- Exactement une des deux cibles, jamais les deux, jamais aucune.
  note_id uuid,
  checklist_item_id uuid references checklist_items on delete cascade,

  remind_at timestamptz not null,

  -- Notification locale : c'est elle qui prévient réellement l'utilisateur,
  -- elle fonctionne sans réseau et sans Google.
  local_notification_id text,

  -- Export Google, indépendant de la notification locale.
  google_kind google_target,
  google_id text,
  sync_state sync_state not null default 'pending',
  last_error text,
  last_synced_at timestamptz,
  -- Nombre de tentatives, pour espacer les reprises sans boucler indéfiniment.
  attempts integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (note_id, user_id) references notes (id, user_id) on delete cascade,

  constraint exactly_one_target check (
    (note_id is not null) <> (checklist_item_id is not null)
  )
);

-- ------------------------------------------------------- comptes Google

-- Métadonnées visibles par le client : de quoi afficher l'état de la connexion
-- et la bannière de reconnexion, sans jamais exposer de secret.
create table google_accounts (
  user_id uuid primary key references auth.users on delete cascade,
  google_email text,
  scopes text[] not null default '{}',
  -- Expiration du refresh token. En mode test Google, elle tombe à 7 jours.
  refresh_expires_at timestamptz,
  needs_reauth boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Le secret lui-même. RLS activé SANS AUCUNE POLITIQUE : aucun rôle
-- authenticated ou anon ne peut lire, écrire ou même détecter ces lignes.
-- Seule la clé de service, utilisée par les Edge Functions, contourne RLS.
create table google_credentials (
  user_id uuid primary key references auth.users on delete cascade,
  -- Chiffré côté serveur avec une clé stockée dans les secrets Edge Functions.
  refresh_token_encrypted text not null,
  updated_at timestamptz not null default now()
);

comment on table google_credentials is
  'Jamais accessible au client. RLS actif sans politique, seule la clé de service passe.';

-- ------------------------------------------------------------------ index

-- Grille principale : notes vivantes, non archivées, épinglées d'abord.
create index notes_active_idx on notes (user_id, is_pinned desc, updated_at desc)
  where deleted_at is null and is_archived = false and is_private = false;

-- Coffre.
create index notes_private_idx on notes (user_id, updated_at desc)
  where deleted_at is null and is_private = true;

create index notes_archived_idx on notes (user_id, updated_at desc)
  where deleted_at is null and is_archived = true;

create index notes_trash_idx on notes (user_id, deleted_at desc)
  where deleted_at is not null;

create index checklist_items_note_idx on checklist_items (note_id, position);
create index note_tags_tag_idx on note_tags (tag_id);
create index tags_user_idx on tags (user_id, position);

-- File de synchronisation : on ne balaye que ce qui reste à faire.
create index reminders_pending_idx on reminders (user_id, remind_at)
  where sync_state in ('pending', 'error');

create index reminders_upcoming_idx on reminders (user_id, remind_at);

-- Recherche plein texte en français. Ne couvre que les notes en clair :
-- les notes chiffrées se cherchent côté client, sur l'index local déchiffré.
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

-- ------------------------------------------------- profil à l'inscription

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

-- `using` filtre ce qui est lisible, `with check` ce qui est écrivable.
-- Les deux sont nécessaires : sans `with check`, un utilisateur pourrait
-- insérer une ligne au nom d'un autre.

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

-- google_credentials : aucune politique, volontairement. Toute requête d'un
-- client authentifié renvoie zéro ligne et tout écriture échoue.
