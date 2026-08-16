-- Keeping one vault note's content off its card, note by note.
--
-- A vault card shows a code name in place of the title, and that stays. Its
-- content — body preview, checklist items — is shown in full once the vault is
-- open, which is the right default: the grid is only ever on screen behind the
-- code, and masking a second time there protects nothing while making a card
-- unreadable. The exception becomes explicit and carried by the note, instead of
-- a rule applied to every note whether or not it deserves it.
--
-- Masking, not encryption, exactly like `code_name`. The text goes on living in
-- `ciphertext` and this column changes nothing about what travels or what is
-- stored: it says what a card is allowed to draw. Whoever can read the row can
-- read the text; what this answers is the glance over the shoulder.

alter table notes add column hide_content boolean not null default false;

comment on column notes.hide_content is
  'The vault card shows the code name alone. Masking, not encryption.';

-- Paired with `is_private`, for the same reason as `code_name_requires_private`:
-- outside the vault the flag means nothing, and one left set on a note taken out
-- of the vault would blank a card in the visible grid with no way to see why.
alter table notes add constraint hide_content_requires_private
  check (not hide_content or is_private);
