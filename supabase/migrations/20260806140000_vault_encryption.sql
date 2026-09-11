-- End-to-end encryption of the vault.
--
-- The initial schema had made room for it (is_encrypted, ciphertext, nonce,
-- wrapped_key on notes) but with an assumption that does not hold in use: one
-- key per note. One key per note forces rewrapping it for each note on every
-- change of recovery key, and says nothing about what to do with list items,
-- which had no column at all.
--
-- The model chosen, described in detail in src/vault/crypto.ts:
--
--   recovery key (160 bits, held by the user, shown once)
--        └─HKDF─▶ wrapping key ─encrypts─▶ data key (256 bits)
--                                              └─encrypts─▶ titles, bodies,
--                                                           items
--
-- A single data key per person, sealed once in vault_keys. The nonce travels at
-- the head of the ciphertext rather than in its own column: it means nothing
-- outside the ciphertext it goes with, and two columns to keep in sync are two
-- chances to let them fall out of sync.

-- ------------------------------------------------------------ sealed data key

create table vault_keys (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,

  -- The data key encrypted by the wrapping key. Without the recovery key, this
  -- row is worth nothing: that is what makes it possible to keep it on the
  -- server without weakening the vault, and what makes it possible to open
  -- one's notes on a new device.
  wrapped_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint wrapped_key_not_blank check (length(btrim(wrapped_key)) > 0)
);

comment on table vault_keys is
  'Clé de données du coffre, scellée par la clé de secours de l''utilisateur. Inutilisable sans elle.';

alter table vault_keys enable row level security;

create policy own_vault_key on vault_keys for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger vault_keys_touch before update on vault_keys
  for each row execute function touch_updated_at();

-- --------------------------------------------------------- notes: one key

alter table notes drop constraint encrypted_note_has_no_plaintext;
alter table notes drop column nonce;
alter table notes drop column wrapped_key;

-- Same invariant as before, on the material that remains: an encrypted note
-- keeps no plaintext, a plaintext note carries no ciphertext.
alter table notes add constraint encrypted_note_has_no_plaintext check (
  case when is_encrypted
    then title is null and body is null and ciphertext is not null
    else ciphertext is null
  end
);

-- ------------------------------------------------------ encryptable list items

alter table checklist_items add column is_encrypted boolean not null default false;
alter table checklist_items add column ciphertext text;

-- `content` becomes null when the item is encrypted. The not-blank constraint is
-- folded into the overall constraint below, where it only applies to the
-- plaintext case.
alter table checklist_items alter column content drop not null;
alter table checklist_items drop constraint content_not_blank;

alter table checklist_items add constraint encrypted_item_has_no_plaintext check (
  case when is_encrypted
    then content is null and ciphertext is not null
    else ciphertext is null and content is not null and length(btrim(content)) > 0
  end
);
