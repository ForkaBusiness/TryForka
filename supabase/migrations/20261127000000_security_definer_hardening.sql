-- SECURITY DEFINER review (docs/security/security-definer-review.md). Additive hardening:
-- no table, column or data changes, and nothing that runs today behaves differently for a
-- legitimate caller.
--
-- 1. handle_new_user(): a trigger function (creates public.users on sign-up). It can only
--    run as a trigger, but anon and authenticated could see it; they no longer can. The
--    trigger keeps firing: privileges are checked when a trigger is created, not when it fires.
-- 2. claim_ai_request(): the old rate limiter, called by nothing (main or Phase 4). Clients
--    can no longer call it, so it can't be used to add rows to ai_requests.
-- 3. claim_request(): the rate limiter every Edge Function uses, called as the signed-in
--    user. Its limits come from the caller, so a client calling it directly could pass huge
--    limits or endless made-up kinds and fill ai_requests with its own rows. Now:
--      - kinds must be short lowercase names (every kind in use is);
--      - limits are capped at 120 a minute and 1,000 a day;
--      - a user is refused past 2,000 requests a day across all kinds (the busiest real
--        user makes about 30);
--      - fully schema-qualified, with an empty search_path.
--    For the Edge Functions' own calls the answers are exactly the same as before.
--
-- Rollback: supabase/rollbacks/20261127_security_definer_hardening_down.sql

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.claim_ai_request(integer, integer) from public, anon, authenticated;

create or replace function public.claim_request(p_kind text, p_per_minute integer, p_per_day integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  wait_seconds numeric;
  per_minute integer := least(greatest(coalesce(p_per_minute, 0), 0), 120);
  per_day integer := least(greatest(coalesce(p_per_day, 0), 0), 1000);
begin
  if uid is null then
    return -1;
  end if;
  if p_kind is null or p_kind !~ '^[a-z][a-z_]{0,39}$' then
    raise exception 'unknown request kind';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_requests:' || uid::text || ':' || p_kind));

  delete from public.ai_requests where user_id = uid and created_at < now() - interval '1 day';

  -- Across every kind: nobody needs this many in a day.
  if (select count(*) from public.ai_requests where user_id = uid) >= 2000 then
    return 3600;
  end if;

  if (select count(*) from public.ai_requests where user_id = uid and kind = p_kind) >= per_day then
    select extract(epoch from min(created_at) + interval '1 day' - now()) into wait_seconds
      from public.ai_requests where user_id = uid and kind = p_kind;
    return greatest(1, ceil(wait_seconds))::int;
  end if;

  if (select count(*) from public.ai_requests where user_id = uid and kind = p_kind and created_at > now() - interval '1 minute') >= per_minute then
    select extract(epoch from min(created_at) + interval '1 minute' - now()) into wait_seconds
      from public.ai_requests where user_id = uid and kind = p_kind and created_at > now() - interval '1 minute';
    return greatest(1, ceil(wait_seconds))::int;
  end if;

  insert into public.ai_requests (user_id, kind) values (uid, p_kind);
  return 0;
end;
$$;
revoke all on function public.claim_request(text, integer, integer) from public, anon;
grant execute on function public.claim_request(text, integer, integer) to authenticated, service_role;
