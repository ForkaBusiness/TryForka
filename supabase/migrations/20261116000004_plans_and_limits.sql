-- Plans and limits, groundwork only: nothing is blocked yet. Additive: one new table and
-- two new functions.
--
-- The plan lives in its own table rather than on public.users because users can update
-- their own row there (its policy allows it), so a plan column on it could be set to
-- "pro" by anyone. Here a user can only read their row. The plan is set by the service
-- role (a future billing webhook); the counters only move through record_usage().
--
-- Free limits (enforced later by the app, see src/lib/limits.ts): 20 saved recipes,
-- 20 smart imports, 2 saved shopping lists at a time.
--
-- What counts:
--   saved recipes   recipes the household hearted or put in a collection (and, once imports
--                   exist, recipes they imported). Never catalog recipes that are only in
--                   the week plan.
--   smart imports   each import, counted by record_usage('smart_imports').
--   shopping lists  saved lists held at the same time. The weekly list built from the plan
--                   (grocery_lists) never counts. There are no saved lists yet, so this is 0
--                   until that feature adds its table here.
create table if not exists public.user_plans (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  plan                 text not null default 'free' check (plan in ('free', 'pro')),
  -- Imports are counted as they happen. Saved recipes and saved lists are counted live
  -- instead (see usage_summary): a stored count could drift from what's actually saved.
  smart_imports_count  integer not null default 0 check (smart_imports_count >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.user_plans enable row level security;
drop policy if exists "Users can read own plan" on public.user_plans;
create policy "Users can read own plan" on public.user_plans for select using (auth.uid() = user_id);
-- No insert, update or delete policies.

-- Counts one smart import for the signed-in user. Only ever up by one.
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

-- The signed-in user's plan and usage in one row. A user with no user_plans row is on the
-- free plan with nothing used. Saved recipes are the recipes they hearted or put in a
-- collection, each counted once (the same set the Library shows); the week plan is not
-- read at all. Saved shopping lists: 0 until saved lists exist (the weekly list never counts).
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
     ) saved),
    coalesce((select p.smart_imports_count from user_plans p where p.user_id = auth.uid()), 0),
    0
$$;

revoke all on function public.usage_summary() from public, anon;
grant execute on function public.usage_summary() to authenticated;
