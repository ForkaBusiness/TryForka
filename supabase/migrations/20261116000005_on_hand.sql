-- Use what you have: a few ingredients the household wants to use up (leftovers, half a
-- bag of spinach). The planner favors meals that use them for a week after they're set.
-- Additive: two new columns on the household's settings row, which row level security
-- already limits to its owner.
alter table public.user_preferences
  add column if not exists on_hand text[] not null default '{}',
  add column if not exists on_hand_at timestamptz;
