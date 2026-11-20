import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.103.3';
import { effectivePlan, FREE_ROW, type Plan, type PlanRow } from './state.ts';

// The caller's plan, for Edge Functions that treat Free and Pro differently. Read as the
// caller (user_plans: read own row only), so nobody can claim someone else's plan; written
// only by the stripe-webhook function.
//
// The billing switch (app_settings.billing_enabled, or the account's billing_preview) comes
// first: while billing is off, everyone gets everything, as before Pro existed. If the
// switch can't be read, billing counts as off: nobody is wrongly limited.

export async function callerPlan(db: SupabaseClient): Promise<{ plan: Plan; row: PlanRow; smartImports: number; billingOn: boolean }> {
  const [plan, on] = await Promise.all([
    db.from('user_plans').select('plan, founding, pro_until, billing_status, smart_imports_count').maybeSingle(),
    db.rpc('billing_on'),
  ]);
  if (plan.error) console.error('[plan] read failed:', plan.error.message);
  if (on.error) console.error('[plan] billing switch unreadable:', on.error.message);
  const row = { ...FREE_ROW, ...(plan.data ?? {}) } as PlanRow & { smart_imports_count?: number };
  const billingOn = !on.error && on.data === true;
  return { plan: billingOn ? effectivePlan(row, new Date()) : 'pro', row, smartImports: Number(row.smart_imports_count ?? 0), billingOn };
}
