-- Grocery list built around the week: a recipe's ingredients can be taken off the list
-- (and put back) without changing the plan. Additive: one new column.
--
-- Ids of this week's recipes whose ingredients the household took off the list. The list
-- itself (items) still holds what every recipe needs, so putting one back needs no rebuild.
alter table public.grocery_lists add column if not exists excluded_recipes integer[] not null default '{}';
