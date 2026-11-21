-- Rollback for 20261127000000_security_definer_hardening.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261127_security_definer_hardening_down.sql
--
-- Puts back the grants and claim_request() exactly as they were before.

begin;

grant execute on function public.handle_new_user() to public, anon, authenticated;
grant execute on function public.claim_ai_request(integer, integer) to authenticated;

create or replace function public.claim_request(p_kind text, p_per_minute integer, p_per_day integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  wait_seconds numeric;
begin
  if uid is null then
    return -1;
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_requests:' || uid::text || ':' || p_kind));

  delete from ai_requests where user_id = uid and created_at < now() - interval '1 day';

  if (select count(*) from ai_requests where user_id = uid and kind = p_kind) >= p_per_day then
    select extract(epoch from min(created_at) + interval '1 day' - now()) into wait_seconds
      from ai_requests where user_id = uid and kind = p_kind;
    return greatest(1, ceil(wait_seconds))::int;
  end if;

  if (select count(*) from ai_requests where user_id = uid and kind = p_kind and created_at > now() - interval '1 minute') >= p_per_minute then
    select extract(epoch from min(created_at) + interval '1 minute' - now()) into wait_seconds
      from ai_requests where user_id = uid and kind = p_kind and created_at > now() - interval '1 minute';
    return greatest(1, ceil(wait_seconds))::int;
  end if;

  insert into ai_requests (user_id, kind) values (uid, p_kind);
  return 0;
end;
$$;

delete from supabase_migrations.schema_migrations where version = '20261127000000';

commit;
