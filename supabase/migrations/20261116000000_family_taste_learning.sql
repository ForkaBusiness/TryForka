-- Family taste learning: who is at the table, what each person ate, and what the household
-- did with its plan. Additive only: three new tables, nothing existing is changed.
--
-- "Family" is the account: every row is keyed to the signed-in user, and row level
-- security limits each table to the rows of that user. Deleting the account removes the
-- rows through ON DELETE CASCADE, like every other user table.

-- ── Family members ──────────────────────────────────────────────────────────
-- Per-person likes, dislikes and allergies. The household settings in user_preferences
-- stay as they are and apply to everyone; a person's allergies are added on top of them
-- as hard filters by the app's recipe filter. Likes and dislikes only affect ranking.
create table if not exists public.family_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 40),
  kind       text not null default 'adult' check (kind in ('adult', 'kid')),
  -- Normalized ingredient names, the same form as user_preferences.skip_ingredients.
  likes      text[] not null default '{}',
  dislikes   text[] not null default '{}',
  -- Allergen keys ("tree_nut") or normalized ingredient names, as in user_preferences.allergies.
  allergies  text[] not null default '{}',
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists family_members_user on public.family_members (user_id, position);

alter table public.family_members enable row level security;
drop policy if exists "Users can manage own family members" on public.family_members;
create policy "Users can manage own family members" on public.family_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── After-dinner check-ins ──────────────────────────────────────────────────
-- One row per person per dinner. member_id is null when the household answered as a
-- whole (no family members set up yet).
create table if not exists public.meal_checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  integer not null,
  member_id  uuid references public.family_members(id) on delete cascade,
  response   text not null check (response in ('loved', 'fine', 'skipped')),
  -- The local date of the dinner, so "tonight" and "last week" read right in any time zone.
  eaten_on   date not null,
  created_at timestamptz not null default now()
);

create index if not exists meal_checkins_user_date on public.meal_checkins (user_id, eaten_on desc);
create index if not exists meal_checkins_user_recipe on public.meal_checkins (user_id, recipe_id);

alter table public.meal_checkins enable row level security;
drop policy if exists "Users can manage own check-ins" on public.meal_checkins;
create policy "Users can manage own check-ins" on public.meal_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Plan events ─────────────────────────────────────────────────────────────
-- What the household did to its plan by hand: picked a recipe, swapped one out, removed
-- one, or said they didn't cook it. Changes the app makes on its own are not recorded.
create table if not exists public.plan_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  integer not null,
  kind       text not null check (kind in ('picked', 'swapped_out', 'removed', 'not_cooked')),
  day        text,
  created_at timestamptz not null default now()
);

create index if not exists plan_events_user_time on public.plan_events (user_id, created_at desc);

alter table public.plan_events enable row level security;
drop policy if exists "Users can manage own plan events" on public.plan_events;
create policy "Users can manage own plan events" on public.plan_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
