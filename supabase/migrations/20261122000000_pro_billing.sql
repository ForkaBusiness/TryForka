-- Forka Pro billing. Additive: billing columns on user_plans, one table for Stripe event
-- ids, and usage_summary() reporting the plan the app honors.
--
-- Only the service role writes plans: user_plans has a read-own policy and no insert,
-- update or delete policies (20261116000004), and that stays. The stripe-webhook Edge
-- Function is the only thing that changes plan and billing columns; the billing function
-- (service role) only records the Stripe customer id when it creates the customer.
--
-- Rollback: supabase/rollbacks/20261122_pro_billing_down.sql

alter table public.user_plans
  add column if not exists billing_status text not null default 'none'
    check (billing_status in ('none', 'trialing', 'active', 'past_due', 'incomplete', 'paused', 'ended', 'refunded', 'founding')),
  add column if not exists billing_interval text check (billing_interval in ('month', 'year')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists current_period_end timestamptz,
  add column if not exists trial_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  -- Past due: Pro until here (the grace period), then Free.
  add column if not exists pro_until timestamptz,
  -- One yearly trial per account, ever.
  add column if not exists trial_used boolean not null default false,
  -- Founding families: Pro for life, never changed by Stripe.
  add column if not exists founding boolean not null default false,
  -- The trial end the "your trial ends soon" email was sent for.
  add column if not exists trial_reminder_for timestamptz;

create unique index if not exists user_plans_stripe_customer on public.user_plans (stripe_customer_id) where stripe_customer_id is not null;

-- Each Stripe event id once: a duplicate delivery is recognized and skipped. Service role only.
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;
-- No policies: nobody but the service role reads or writes it.

-- The plan the app honors: Pro while the webhook says so and any grace period hasn't run
-- out; founding families always. Same columns and counts as 20261119000000.
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
