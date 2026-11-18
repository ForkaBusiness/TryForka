-- Rollback for 20261118000000_rls_initplan. Not a migration: run it by hand only if that
-- migration has to come out. It puts each policy's expressions back exactly as they were
-- before (read from the production database on 2026-11-18). No data is touched.
begin;

alter policy "Users can manage own collection recipes" on public.collection_recipes
  using ((auth.uid() = ( SELECT collections.user_id
   FROM public.collections
  WHERE (collections.id = collection_recipes.collection_id))));

alter policy "Users can manage own collections" on public.collections
  using ((auth.uid() = user_id));

alter policy "Users can manage own cooked log" on public.cooked_recipes
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

alter policy "Users can add own lookups" on public.dish_lookups
  with check ((auth.uid() = user_id));

alter policy "Users can read own lookups" on public.dish_lookups
  using ((auth.uid() = user_id));

alter policy "Users can manage own family members" on public.family_members
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

alter policy "Users can manage own favorites" on public.favorites
  using ((auth.uid() = user_id));

alter policy "Users can manage own feedback" on public.feedback
  using ((auth.uid() = user_id));

alter policy "Users can manage own grocery list" on public.grocery_lists
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

alter policy "Users can manage own check-ins" on public.meal_checkins
  using ((auth.uid() = user_id))
  with check (((auth.uid() = user_id) AND ((member_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.family_members m
  WHERE ((m.id = meal_checkins.member_id) AND (m.user_id = auth.uid())))))));

alter policy "Users can manage own notes" on public.notes
  using ((auth.uid() = user_id));

alter policy "Users can manage own plan events" on public.plan_events
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

alter policy "Users can manage own ratings" on public.recipe_ratings
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

alter policy "Users can read own plan" on public.user_plans
  using ((auth.uid() = user_id));

alter policy "users_own_preferences_insert" on public.user_preferences
  with check ((auth.uid() = user_id));

alter policy "users_own_preferences_select" on public.user_preferences
  using ((auth.uid() = user_id));

alter policy "users_own_preferences_update" on public.user_preferences
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

alter policy "Users can manage own profile" on public.users
  using ((auth.uid() = id));

alter policy "Users can manage own week plan" on public.week_plans
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

delete from supabase_migrations.schema_migrations where version = '20261118000000';
commit;
