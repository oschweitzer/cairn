-- Hardening the functions, following a report from the Supabase advisor.
--
-- Nothing exploitable was found: the two functions concerned run with the
-- caller's rights, so under RLS. This is hygiene, not an emergency fix — but it
-- is free, and it shuts the door before a future function, running with the
-- definer's rights, slips through it.

-- ---------------------------------------------------- fixed search path

-- Without a fixed path, a caller can put a schema of their own in front of
-- `public`, containing a table or function of the same name, and divert what
-- the body refers to. Fixing the path shuts that door.
--
-- `public` and not the empty string the documentation recommends: the bodies
-- below name their tables without qualifying them, and emptying the path would
-- break them. Fixing it is enough in practice.
alter function public.touch_updated_at() set search_path = public;
alter function public.reorder_checklist_items(uuid, uuid[]) set search_path = public;

-- ------------------------------------------------- trigger execute rights

/*
 * The two trigger functions have no reason to be callable.
 *
 * The advisor flags them as reachable through `/rest/v1/rpc/`, which overstates
 * the risk: they return `trigger`, and PostgREST does not expose that type. The
 * right is still granted for no reason, and a useless right is a right to
 * revoke.
 *
 * The revocation targets `public` and not the named roles. Postgres grants
 * `execute` to `public` by default on every function: revoking the right from
 * `anon` and `authenticated` takes nothing away from them, since they hold it
 * from there. A first attempt written that way was applied without the
 * slightest effect.
 *
 * A trigger keeps firing: Postgres checks `execute` when the trigger is
 * created, not every time it fires. The « updated_at avance à la modification »
 * test in scripts/test-schema.mts demonstrates it — it runs as the
 * `authenticated` role, which no longer has that right.
 *
 * `reorder_checklist_items` is not touched: the app calls it over RPC, and
 * revoking its right would break it.
 */
revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.create_profile_for_new_user() from public;
