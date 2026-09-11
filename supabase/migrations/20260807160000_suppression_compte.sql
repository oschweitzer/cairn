-- Deleting the account, and everything attached to it.
--
-- ── A single row to delete ───────────────────────────────────────────────────
-- Every table of the app references `auth.users` with a cascade, either
-- directly (notes, tags, profiles, reminders, vault_keys, google_accounts,
-- google_credentials) or through them (checklist_items and note_tags hang off
-- notes and tags). Supabase's `auth` schema does the same for identities,
-- sessions, one-time tokens and MFA factors. So deleting the `auth.users` row
-- is enough, and above all: there is nothing to keep up to date here when a
-- table is added, provided it cascades like the others. An explicit list of
-- DELETE statements would have aged silently and left data behind.
--
-- ── Why a function, and not statements from the client ───────────────────────
-- The client cannot touch `auth.users`: it is not exposed by PostgREST, and the
-- app's RLS policies only speak of `public`. Erasing one's notes one by one from
-- the client would leave the account itself in place anyway, with its address
-- and its identities.
--
-- SECURITY DEFINER because the deletion happens in `auth`, out of reach of the
-- `authenticated` role. The borrowed power stays bounded to one row, the
-- caller's own: `auth.uid()` is read inside the function and is not a
-- parameter, so there is no id for the caller to forge.
--
-- ── What this deletion does not do ───────────────────────────────────────────
-- It is immediate, with no grace period: nothing is left to restore, including
-- from the app's trash. That is the requested behaviour, and it is also the
-- only one that holds for an encrypted vault — keeping a copy "just in case"
-- would contradict what encryption promises.
--
-- It does not touch storage on the device: the vault's data key lives in the
-- Keystore or in localStorage, outside the database. The client erases it on
-- its side, after this call.

create or replace function delete_own_account() returns void
language plpgsql
security definer
-- Emptied path: everything below is qualified, so no schema put first by a
-- caller can divert a name to its own function.
set search_path = ''
as $$
declare
  moi uuid := auth.uid();
begin
  -- Without a session there is no account to delete. Say so rather than let a
  -- DELETE on `id = null` through, which would touch nothing and return a
  -- misleading success.
  if moi is null then
    raise exception 'Aucune session, rien à supprimer'
      using errcode = '28000';
  end if;

  delete from auth.users where id = moi;
end;
$$;

/*
 * Two revocations, and both are needed.
 *
 * Postgres grants `execute` to PUBLIC on every new function. Supabase adds an
 * `alter default privileges` that also grants it, by name, to `anon`,
 * `authenticated` and `service_role`. These are two separate sources: revoking
 * one leaves the other standing.
 *
 * The hardening migration notes the opposite — that revoking the right from the
 * named roles "takes nothing away from them". That is wrong, and the observation
 * that led to writing it was misread: the first revocation, aimed at the named
 * roles, did take effect, but without changing the answer of
 * `has_function_privilege`, since PUBLIC still granted the right elsewhere.
 * Hence the impression of a shot in the dark. Checked this time on `proacl`,
 * which shows the entries one by one rather than an already aggregated yes or
 * no.
 *
 * `service_role` keeps its own: it never leaves the server, and any
 * administrative deletion would go through it.
 */
revoke execute on function delete_own_account() from public, anon;
grant execute on function delete_own_account() to authenticated;

comment on function delete_own_account() is
  'Supprime le compte de l''appelant et, par cascade, toutes ses données. Sans retour possible.';
