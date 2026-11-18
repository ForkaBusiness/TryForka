-- Recipe imports (phase 2): the household's own recipes, typed in or imported from a
-- link, a photo or a social post. Additive: new columns on recipes, a sequence, new
-- policies, a log table, a storage bucket, and usage_summary() counting imported recipes.
--
-- A household's recipes live in public.recipes beside the catalog, with owner_id set. That
-- is what lets every existing path treat them like catalog recipes without a second code
-- path: the allergy gate (byIds/one), the grocery list (ingredients), cooking mode, and the
-- nutrition function (which reads recipes.ingredients by id as the caller). They have no
-- meal_role, so family_safe_recipes() (browse, the planner's pool) leaves them out; they
-- reach the week plan only when the household puts them there.
--
-- Privacy: a RESTRICTIVE select policy is added beside "Catalog is readable" (left exactly
-- as it is). Restrictive policies are ANDed with the permissive ones, so catalog rows
-- (owner_id null) read as before and a household's rows are visible only to that
-- household. The weekly catalog sync uses the service role and now skips owned rows
-- (supabase/functions/sync-recipes).
--
-- Rollback: supabase/rollbacks/20261119_recipe_imports_down.sql

-- ── Household recipes in public.recipes ───────────────────────────────────

-- Their ids start at 1,000,000,000: far above TheMealDB's (about 53,000 today), so the two
-- never collide and the catalog sync's upsert by id can never touch one.
create sequence if not exists public.household_recipe_ids as integer
  start with 1000000000 minvalue 1000000000 maxvalue 2147483647 no cycle;

alter table public.recipes
  add column if not exists owner_id        uuid references auth.users(id) on delete cascade,
  add column if not exists servings        integer check (servings between 1 and 100),
  add column if not exists prep_minutes    integer check (prep_minutes > 0),
  add column if not exists cook_minutes    integer check (cook_minutes > 0),
  add column if not exists notes           text check (length(notes) <= 5000),
  add column if not exists source_name     text check (length(source_name) <= 200),
  add column if not exists source_kind     text check (source_kind in ('manual', 'website', 'photo', 'social')),
  add column if not exists source_platform text check (source_platform in ('tiktok', 'instagram', 'youtube', 'pinterest', 'facebook')),
  add column if not exists source_handle   text check (length(source_handle) <= 100),
  add column if not exists created_at      timestamptz,
  add column if not exists updated_at      timestamptz;

alter table public.recipes alter column id set default nextval('public.household_recipe_ids');

do $$ begin
  alter table public.recipes add constraint recipes_household_id_range check (owner_id is null or id >= 1000000000);
exception when duplicate_object then null; end $$;

-- "Is this link already in my library?" and the library itself.
create index if not exists recipes_owner_source on public.recipes (owner_id, source_url) where owner_id is not null;

-- Writes: only what a household may set. Until now no role but the service role could
-- write here (there were no write policies); the table-level grants are narrowed to
-- column grants so a household can't choose its own ids, move a recipe to someone else,
-- or set the catalog's columns (meal_role, category, ...) on its rows.
revoke insert, update, delete, truncate on public.recipes from anon, authenticated;
grant insert (owner_id, name, display_name, thumb_url, instructions_raw, steps, ingredients, ingredient_names, allergens, diets,
              total_minutes, servings, prep_minutes, cook_minutes, notes, source_url, source_name, source_kind, source_platform,
              source_handle, created_at, updated_at)
  on public.recipes to authenticated;
grant update (name, display_name, thumb_url, instructions_raw, steps, ingredients, ingredient_names, allergens, diets,
              total_minutes, servings, prep_minutes, cook_minutes, notes, source_url, source_name, source_kind, source_platform,
              source_handle, updated_at)
  on public.recipes to authenticated;
grant delete on public.recipes to authenticated;
grant usage on sequence public.household_recipe_ids to authenticated;

drop policy if exists "Household recipes are private" on public.recipes;
create policy "Household recipes are private" on public.recipes as restrictive for select to anon, authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

drop policy if exists "Households add their own recipes" on public.recipes;
create policy "Households add their own recipes" on public.recipes for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Households edit their own recipes" on public.recipes;
create policy "Households edit their own recipes" on public.recipes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Households delete their own recipes" on public.recipes;
create policy "Households delete their own recipes" on public.recipes for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ── Import outcomes ────────────────────────────────────────────────────────
-- Where imports break, without the recipes themselves: no titles, ingredients, steps,
-- captions or full URLs. Written by the import-recipe function (service role).
create table if not exists public.import_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  source_kind    text not null check (source_kind in ('website', 'photo', 'social', 'text')),
  -- How the recipe was read: json_ld, model, oembed, page_meta, caption, caption_link, ...
  method         text check (length(method) <= 40),
  outcome        text not null check (outcome in ('success', 'partial', 'no_recipe', 'failed', 'duplicate', 'capped')),
  error_code     text check (length(error_code) <= 60),
  -- Host name only ("seriouseats.com"), never the page's path.
  site           text check (length(site) <= 120),
  platform       text check (length(platform) <= 20),
  model          text check (length(model) <= 60),
  image_count    integer,
  -- Which fields were marked for review: "servings", "ingredients.quantity", "steps".
  flagged_fields text[] not null default '{}',
  duration_ms    integer
);

create index if not exists import_events_user_time on public.import_events (user_id, created_at desc);
create index if not exists import_events_time on public.import_events (created_at desc);

alter table public.import_events enable row level security;
drop policy if exists "Users can read own import events" on public.import_events;
create policy "Users can read own import events" on public.import_events for select to authenticated
  using ((select auth.uid()) = user_id);
-- No insert, update or delete policies: only the service role writes.

-- ── Recipe photos ──────────────────────────────────────────────────────────
-- Private: photos of cookbook pages, handwritten cards and the household's own dish
-- photos. Each household reads and writes only its own folder (<user id>/...); the app
-- shows them through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Recipe photo owners can read" on storage.objects;
create policy "Recipe photo owners can read" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Recipe photo owners can upload" on storage.objects;
create policy "Recipe photo owners can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Recipe photo owners can update" on storage.objects;
create policy "Recipe photo owners can update" on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Recipe photo owners can delete" on storage.objects;
create policy "Recipe photo owners can delete" on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── Saved recipes count imported ones ──────────────────────────────────────
-- Same as 20261116000004, with the household's own recipes added to the saved set (each
-- recipe once, however many ways it is saved).
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
