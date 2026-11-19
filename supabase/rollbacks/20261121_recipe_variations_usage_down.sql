-- Rollback for 20261121000000_recipe_variations_usage.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261121_recipe_variations_usage_down.sql
--
-- Puts record_usage() back to counting smart imports only, and drops the variations count
-- (the counts are lost). Deploy a cooking-help function that doesn't call
-- record_usage('recipe_variations') first, or its calls will log an error (the answers
-- themselves still reach the user: counting never blocks).

begin;

create or replace function public.record_usage(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  if p_kind is distinct from 'smart_imports' then
    raise exception 'unknown usage kind: %', p_kind;
  end if;
  insert into public.user_plans (user_id) values (uid) on conflict (user_id) do nothing;
  update public.user_plans set smart_imports_count = smart_imports_count + 1, updated_at = now() where user_id = uid;
end;
$$;

revoke all on function public.record_usage(text) from public, anon;
grant execute on function public.record_usage(text) to authenticated;

alter table public.user_plans drop column if exists recipe_variations_count;

delete from supabase_migrations.schema_migrations where version = '20261121000000';

commit;
