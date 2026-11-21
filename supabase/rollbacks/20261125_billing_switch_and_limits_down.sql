-- Rollback for 20261125000000_billing_switch_and_limits.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261125_billing_switch_and_limits_down.sql
--
-- Removes the billing switch, the recipe-limit trigger and the import reservation
-- functions, and puts usage_summary() back as 20261122000000 left it. Deploy Edge
-- Functions that don't call billing_on() / claim_smart_import() first, or imports and
-- plan checks will fail.

begin;

drop trigger if exists own_recipe_limit on public.recipes;
drop function if exists public.enforce_own_recipe_limit();
drop function if exists public.claim_smart_import();
drop function if exists public.release_smart_import(uuid);

create or replace function public.usage_summary()
returns table (plan text, saved_recipes integer, smart_imports integer, shopping_lists integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce((select case
        when p.founding then 'pro'
        when p.plan = 'pro' and (p.pro_until is null or p.pro_until > now()) then 'pro'
        else 'free' end
      from user_plans p where p.user_id = auth.uid()), 'free'),
    (select count(*)::int from (
       select f.recipe_id from favorites f where f.user_id = auth.uid()
       union
       select cr.recipe_id from collection_recipes cr join collections c on c.id = cr.collection_id where c.user_id = auth.uid()
       union
       select r.id from recipes r where r.owner_id = auth.uid()
     ) saved),
    coalesce((select p.smart_imports_count from user_plans p where p.user_id = auth.uid()), 0),
    0
$$;
revoke all on function public.usage_summary() from public, anon;
grant execute on function public.usage_summary() to authenticated;

drop function if exists public.effective_plan();
drop function if exists public.billing_on();
alter table public.user_plans drop column if exists billing_preview;
drop table if exists public.app_settings;

delete from supabase_migrations.schema_migrations where version = '20261125000000';

commit;
