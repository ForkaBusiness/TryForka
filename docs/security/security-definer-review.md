# SECURITY DEFINER functions: review (2026-11-20)

Supabase's security advisor flags functions that run with their owner's rights (SECURITY DEFINER) instead of the caller's. For each one, the questions are:

- Who can call it?
- Can a caller reach anything beyond their own data?
- Is its `search_path` fixed?

## The functions

Queried live from the production database. There were four in `public` before tonight. Tonight's billing migration added two more (`claim_smart_import`, `release_smart_import`), reviewed here too. If the advisor still lists a fifth from earlier, it was probably counting one of these, or `usage_summary` / `billing_on` / `effective_plan`. Those three are SECURITY INVOKER: they run with the caller's rights, under row level security.

| Function | What it does | Who could call it | Finding | Change |
|---|---|---|---|---|
| `handle_new_user()` | Trigger on `auth.users`: creates the matching `public.users` row at sign-up. | Granted to PUBLIC, `anon` and `authenticated`. | Not exploitable: it returns `trigger`, so Postgres refuses to run it except as a trigger. Still, nobody needs it granted. | Execute revoked from PUBLIC, `anon` and `authenticated`. The trigger keeps firing; tested by creating a user inside a rolled-back transaction. |
| `claim_ai_request(int, int)` | The original rate limiter, from before kinds existed. | `authenticated` | Not called by anything, on main or Phase 4. A signed-in user could still call it to add rows to `ai_requests` for themselves. | Execute revoked from clients. The function stays, so the rollback is trivial. |
| `claim_request(text, int, int)` | The rate limiter every Edge Function uses, called as the signed-in user so it knows who it is. Counts and records requests in `ai_requests`. | `authenticated` (it has to be: the functions call it with the user's token) | Only ever touches the caller's own rows (`auth.uid()`), so no one else's data. **But the limits and the kind come from the caller.** A user calling it directly could pass huge limits, or endless made-up kinds, and fill `ai_requests` with rows. That is storage abuse and a slow table, though nobody else's data or limits are affected. Its `search_path` was `public` rather than empty. | Kinds must be short lowercase names; every kind in use is. Limits are capped at 120 a minute and 1,000 a day. Above 2,000 requests a day across all kinds, a user is refused (the busiest real user makes about 30). Every table name is fully qualified, with an empty `search_path`. For the Edge Functions' own calls, the answers are unchanged; tested in a rolled-back transaction and live. |
| `record_usage(text)` | Adds one to the caller's own smart-import or variations counter. | `authenticated` | Only moves the caller's own counters, and only up, so a caller can only count against themselves. Unknown kinds are refused. Empty `search_path`. | None needed. |
| `claim_smart_import()` (new tonight) | Reserves one smart import for the caller, or refuses at Free's limit. Locks the caller's own row. | `authenticated` | Only the caller's own row (`auth.uid()`). Calling it directly only uses up the caller's own imports. Empty `search_path`. | None needed. |
| `release_smart_import(uuid)` (new tonight) | Hands back a reserved import that didn't happen. | `service_role` only | It takes any user id, which is why clients can't call it. A client that could would reset its own count. | None needed. |

## Applied

- **Migration:** `supabase/migrations/20261127000000_security_definer_hardening.sql`. Applied after a verified backup (`db-backups/forka-2026-11-20-before-definer-hardening`) and a dry run in a rolled-back transaction.
- **Dry run checked:**
  - grants;
  - the sign-up trigger still creates the user row;
  - the Edge Functions' calls return what they did before;
  - a bad kind is refused;
  - an oversized limit is capped.
- **Afterwards, live:** import-recipe and cooking-help answered normally.
- **Rollback:** `supabase/rollbacks/20261127_security_definer_hardening_down.sql` puts everything back exactly.

## Other things noticed (not changed)

- **`record_usage` still counts smart imports.** The client-callable `record_usage('smart_imports')` is still used by main's import code path. It only increases the caller's own count, so it's harmless.
- **The advisor's other warnings:** leaked-password protection and the Postgres version are dashboard settings, covered in `docs/launch/go-live.md` (step 3).
