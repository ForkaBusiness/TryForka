import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.103.3';
import { effectivePlan, FREE_ROW, type Plan, type PlanRow } from './state.ts';

// The caller's plan, for Edge Functions that treat Free and Pro differently. Read as the
// caller (user_plans: read own row only), so nobody can claim someone else's plan; written
// only by the stripe-webhook function.

export async function callerPlan(db: SupabaseClient): Promise<{ plan: Plan; row: PlanRow; smartImports: number }> {
  const { data, error } = await db.from('user_plans').select('plan, founding, pro_until, billing_status, smart_imports_count').maybeSingle();
  if (error) console.error('[plan] read failed:', error.message);
  const row = { ...FREE_ROW, ...(data ?? {}) } as PlanRow & { smart_imports_count?: number };
  return { plan: effectivePlan(row, new Date()), row, smartImports: Number(row.smart_imports_count ?? 0) };
}
