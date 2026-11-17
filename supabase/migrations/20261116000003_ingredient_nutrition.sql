-- Nutrition: one cached row per ingredient, filled from USDA FoodData Central by the
-- nutrition Edge Function the first time a recipe that uses the ingredient is opened.
-- Additive: one new table.
--
-- This is shared reference data, like recipes and ingredient_meta, not a family's data:
-- it holds nothing about any user. Everyone signed in may read it. Nobody can write it
-- through the API (no insert, update or delete policy): only the Edge Function does, with
-- the service role.
create table if not exists public.ingredient_nutrition (
  key         text primary key,           -- normalized US ingredient name ("red onion")
  matched     boolean not null default false,  -- false: USDA has no usable match (shown as such, never counted as zero)
  fdc_id      integer,                    -- FoodData Central id of the matched food
  description text,                       -- its USDA description ("Onions, raw")
  -- Per 100 g.
  kcal        numeric,
  protein_g   numeric,
  carbs_g     numeric,
  fat_g       numeric,
  fiber_g     numeric,
  -- Grams per kitchen unit, from the food's household portions: { "cup": 160, "tbsp": 10, "each": 110 }
  portions    jsonb not null default '{}'::jsonb,
  checked_at  timestamptz not null default now()
);

alter table public.ingredient_nutrition enable row level security;

drop policy if exists "Ingredient nutrition is readable" on public.ingredient_nutrition;
create policy "Ingredient nutrition is readable" on public.ingredient_nutrition for select to authenticated using (true);
