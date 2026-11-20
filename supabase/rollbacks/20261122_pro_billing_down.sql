-- Rollback for 20261122000000_pro_billing.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261122_pro_billing_down.sql
--
-- Drops the billing columns and the Stripe event log, and puts usage_summary() back to
-- reading user_plans.plan as stored. Subscriptions in Stripe are not touched: cancel them
-- there first, or Pro customers lose Pro in the app while still being billed. Deploy app
-- and functions that don't read these columns first.

begin;

create or replace function public.usage_summary()
returns table (plan text, saved_recipes integer, smart_imports integer, shopping_lists integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce((select p.plan from user_plans p where p.user_id = auth.uid()), 'free'),
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

drop table if exists public.stripe_events;
drop index if exists public.user_plans_stripe_customer;
alter table public.user_plans
  drop column if exists billing_status,
  drop column if exists billing_interval,
  drop column if exists stripe_customer_id,
  drop column if exists stripe_subscription_id,
  drop column if exists current_period_end,
  drop column if exists trial_end,
  drop column if exists cancel_at_period_end,
  drop column if exists pro_until,
  drop column if exists trial_used,
  drop column if exists founding,
  drop column if exists trial_reminder_for;

delete from supabase_migrations.schema_migrations where version = '20261122000000';

commit;
