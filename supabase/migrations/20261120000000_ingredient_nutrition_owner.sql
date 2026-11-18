-- Nutrition cache: a household's own ingredients stay private. Additive: one column, one
-- index, one restrictive policy ("Ingredient nutrition is readable" is left as it is).
--
-- ingredient_nutrition is keyed by the ingredient's name, and every signed-in user can read
-- it. With recipe imports, a household's own recipe can put an unusual name there ("Nana's
-- spice mix"). Now a row first looked up for a household's own recipe belongs to that
-- household (owner_id) and only they can read it. The nutrition function shares a row
-- (owner_id null) as soon as anyone else needs the same ingredient, another household or a
-- catalog recipe, since they use it too (_shared/nutrition.ts cacheOwner). Catalog rows
-- have no owner and read as before.
--
-- Existing rows keep owner_id null (shared): on 2026-11-18 all of them were catalog
-- ingredients and no household recipe existed.
--
-- Rollback: supabase/rollbacks/20261120_ingredient_nutrition_owner_down.sql

alter table public.ingredient_nutrition
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists ingredient_nutrition_owner on public.ingredient_nutrition (owner_id) where owner_id is not null;

drop policy if exists "Household ingredients stay private" on public.ingredient_nutrition;
create policy "Household ingredients stay private" on public.ingredient_nutrition as restrictive for select to anon, authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
