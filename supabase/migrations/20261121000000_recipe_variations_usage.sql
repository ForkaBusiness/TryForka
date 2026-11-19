-- Cooking help: count recipe variations ("Make it different"), which become a Pro
-- feature in Phase 4. Groundwork only, nothing is blocked. Additive: one column, and
-- record_usage() learns one more kind; 'smart_imports' works exactly as before.
--
-- The cooking-help Edge Function calls record_usage('recipe_variations') as the user after
-- each answered variations request. Counts only ever go up by one, and only through
-- record_usage (user_plans has no insert or update policy).
--
-- Rollback: supabase/rollbacks/20261121_recipe_variations_usage_down.sql

alter table public.user_plans
  add column if not exists recipe_variations_count integer not null default 0 check (recipe_variations_count >= 0);

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
  if p_kind is distinct from 'smart_imports' and p_kind is distinct from 'recipe_variations' then
    raise exception 'unknown usage kind: %', p_kind;
  end if;
  insert into public.user_plans (user_id) values (uid) on conflict (user_id) do nothing;
  if p_kind = 'smart_imports' then
    update public.user_plans set smart_imports_count = smart_imports_count + 1, updated_at = now() where user_id = uid;
  else
    update public.user_plans set recipe_variations_count = recipe_variations_count + 1, updated_at = now() where user_id = uid;
  end if;
end;
$$;

revoke all on function public.record_usage(text) from public, anon;
grant execute on function public.record_usage(text) to authenticated;
