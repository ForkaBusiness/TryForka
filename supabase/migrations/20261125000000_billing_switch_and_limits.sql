-- The billing switch, and Free limits the database enforces. Additive.
--
-- 1. app_settings.billing_enabled (false until launch). While off, nobody is limited and
--    everyone has every feature: the database, the Edge Functions and the app all read
--    the same switch (billing_on()). Flip it at launch with one statement:
--      update public.app_settings set value = 'true', updated_at = now() where key = 'billing_enabled';
--    user_plans.billing_preview turns billing on for one account only (the QA account),
--    so billing can be tested end to end while the switch is off for everyone else.
--    Both are written by the service role only.
--
-- 2. effective_plan(): the plan the caller gets, with the switch: 'pro' while billing is
--    off; otherwise founding families, and Pro until its grace period runs out.
--
-- 3. Free limits, enforced here so they can't be bypassed by calling Supabase directly:
--    - 20 recipes of a household's own (typed in or imported) on Free: a trigger refuses
--      the 21st insert. Hearts and collections of catalog recipes never count or block.
--      Recipes already over the limit stay: only adding is refused.
--    - 20 smart imports on Free: claim_smart_import() reserves one atomically before the
--      model runs (so parallel requests can't slip past); the import-recipe function hands
--      it back with release_smart_import() (service role only) when the import fails.
--    Pro and founding families are never limited, and nothing is enforced while billing is
--    off. The numbers match FREE_LIMITS in supabase/functions/_shared/billing/limits.ts.
--
-- usage_summary() now reports the plan with the switch and counts a household's own
-- recipes as its saved recipes. The app on main doesn't read it.
--
-- Rollback: supabase/rollbacks/20261125_billing_switch_and_limits_down.sql

-- ── The switch ─────────────────────────────────────────────────────────────

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "Anyone can read app settings" on public.app_settings;
create policy "Anyone can read app settings" on public.app_settings for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.app_settings from anon, authenticated;
insert into public.app_settings (key, value) values ('billing_enabled', 'false'::jsonb) on conflict (key) do nothing;

alter table public.user_plans add column if not exists billing_preview boolean not null default false;

-- Whether billing applies to the signed-in user. Security invoker: reads the public
-- setting and the caller's own plan row (row level security allows only that).
create or replace function public.billing_on()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'billing_enabled'), false)
      or coalesce((select p.billing_preview from public.user_plans p where p.user_id = (select auth.uid())), false)
$$;
revoke all on function public.billing_on() from public, anon;
grant execute on function public.billing_on() to authenticated, service_role;

create or replace function public.effective_plan()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when not public.billing_on() then 'pro'
    else coalesce((select case
        when p.founding then 'pro'
        when p.plan = 'pro' and (p.pro_until is null or p.pro_until > now()) then 'pro'
        else 'free' end
      from public.user_plans p where p.user_id = (select auth.uid())), 'free')
  end
$$;
revoke all on function public.effective_plan() from public, anon;
grant execute on function public.effective_plan() to authenticated, service_role;

-- ── Free: 20 recipes of your own ───────────────────────────────────────────

create or replace function public.enforce_own_recipe_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  n integer;
begin
  -- The service role (no signed-in user) and catalog rows aren't limited.
  if uid is null or new.owner_id is null or new.owner_id <> uid then
    return new;
  end if;
  if public.effective_plan() = 'pro' then
    return new;
  end if;
  -- One insert at a time per household, so two at once can't both take the 20th place.
  perform pg_advisory_xact_lock(hashtextextended('own_recipes:' || uid::text, 0));
  select count(*) into n from public.recipes r where r.owner_id = uid;
  if n >= 20 then
    raise exception 'free_limit_recipes'
      using errcode = 'P0001',
            detail = 'Free includes 20 recipes of your own. Every recipe you have stays yours.',
            hint = 'Pro has no limit.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_own_recipe_limit() from public, anon, authenticated;

drop trigger if exists own_recipe_limit on public.recipes;
create trigger own_recipe_limit before insert on public.recipes
  for each row execute function public.enforce_own_recipe_limit();

-- ── Free: 20 smart imports ─────────────────────────────────────────────────

-- Reserves one smart import for the signed-in user, or returns false at Free's limit.
-- Security definer: it writes the caller's own counter (clients can't write user_plans).
create or replace function public.claim_smart_import()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  used integer;
begin
  if uid is null then
    return false;
  end if;
  insert into public.user_plans (user_id) values (uid) on conflict (user_id) do nothing;
  select p.smart_imports_count into used from public.user_plans p where p.user_id = uid for update;
  if public.effective_plan() = 'free' and used >= 20 then
    return false;
  end if;
  update public.user_plans set smart_imports_count = used + 1, updated_at = now() where user_id = uid;
  return true;
end;
$$;
revoke all on function public.claim_smart_import() from public, anon;
grant execute on function public.claim_smart_import() to authenticated;

-- Hands back a reserved import that didn't happen. Service role only: a client that could
-- call this could reset its own count.
create or replace function public.release_smart_import(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_plans set smart_imports_count = greatest(smart_imports_count - 1, 0), updated_at = now() where user_id = p_user;
$$;
revoke all on function public.release_smart_import(uuid) from public, anon, authenticated;
grant execute on function public.release_smart_import(uuid) to service_role;

-- ── What the app reads ─────────────────────────────────────────────────────

create or replace function public.usage_summary()
returns table (plan text, saved_recipes integer, smart_imports integer, shopping_lists integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.effective_plan(),
    (select count(*)::int from recipes r where r.owner_id = auth.uid()),
    coalesce((select p.smart_imports_count from user_plans p where p.user_id = auth.uid()), 0),
    0
$$;
revoke all on function public.usage_summary() from public, anon;
grant execute on function public.usage_summary() to authenticated;
