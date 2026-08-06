-- Chiffrement bout en bout du coffre.
--
-- Le schéma initial prévoyait la place (is_encrypted, ciphertext, nonce,
-- wrapped_key sur notes) mais avec une hypothèse qui ne tient pas à l'usage :
-- une clé par note. Une clé par note oblige à la réenvelopper pour chacune à
-- chaque changement de clé de secours, et ne dit rien de ce qu'il faut faire
-- des éléments de liste, qui n'avaient aucune colonne.
--
-- Le modèle retenu, décrit en détail dans src/vault/crypto.ts :
--
--   clé de secours (160 bits, chez l'utilisateur, affichée une fois)
--        └─HKDF─▶ clé d'enveloppe ─chiffre─▶ clé de données (256 bits)
--                                                  └─chiffre─▶ titres, corps,
--                                                              éléments
--
-- Une seule clé de données par personne, scellée une fois dans vault_keys. Le
-- nonce voyage en tête du chiffré plutôt que dans sa propre colonne : il n'a
-- aucun sens hors du chiffré qu'il accompagne, et deux colonnes à tenir
-- synchronisées sont deux occasions de les désynchroniser.

-- ------------------------------------------------- clé de données scellée

create table vault_keys (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,

  -- Clé de données chiffrée par la clé d'enveloppe. Sans la clé de secours,
  -- cette ligne ne vaut rien : c'est ce qui permet de la garder côté serveur
  -- sans affaiblir le coffre, et c'est ce qui permet d'ouvrir ses notes sur un
  -- appareil neuf.
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

-- --------------------------------------------------- notes : une seule clé

alter table notes drop constraint encrypted_note_has_no_plaintext;
alter table notes drop column nonce;
alter table notes drop column wrapped_key;

-- Même invariant qu'avant, sur le matériel qui reste : une note chiffrée ne
-- garde aucun texte clair, une note en clair ne traîne aucun chiffré.
alter table notes add constraint encrypted_note_has_no_plaintext check (
  case when is_encrypted
    then title is null and body is null and ciphertext is not null
    else ciphertext is null
  end
);

-- ------------------------------------------- éléments de liste chiffrables

alter table checklist_items add column is_encrypted boolean not null default false;
alter table checklist_items add column ciphertext text;

-- `content` devient nul quand l'élément est chiffré. La contrainte de non-blanc
-- est reprise dans la contrainte d'ensemble ci-dessous, où elle ne s'applique
-- qu'au cas en clair.
alter table checklist_items alter column content drop not null;
alter table checklist_items drop constraint content_not_blank;

alter table checklist_items add constraint encrypted_item_has_no_plaintext check (
  case when is_encrypted
    then content is null and ciphertext is not null
    else ciphertext is null and content is not null and length(btrim(content)) > 0
  end
);
