import { useEffect, useState } from 'react';
import { useApp } from '../app/AppContext';
import { effectivePlan, type BillingReturn, type PlanRow } from '../lib/billing';
import { CalendarDays, Target } from 'lucide-react';
import { BottomSheet, Button, ListGroup, ListRow, Spinner } from './ds';

// Back from Stripe Checkout. Pro turns on when Stripe tells our webhook, usually within a
// few seconds: until then the sheet says so ("checkout pending"), then shows the trial or
// the plan that started. Back without paying: nothing changed.

const WAIT_MS = 45_000;
const EVERY_MS = 2_000;
const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '');

type Phase = 'pending' | 'slow' | 'done' | 'cancelled';

export function CheckoutSheet({ ret, onClose, children }: { ret: BillingReturn; onClose: () => void; children?: (row: PlanRow, close: () => void) => React.ReactNode }) {
  const { billing } = useApp();
  const [phase, setPhase] = useState<Phase>('pending');
  const [row, setRow] = useState<PlanRow | null>(null);

  useEffect(() => {
    if (ret === 'checkout_cancelled') { setPhase('cancelled'); return; }
    if (ret !== 'checkout_success') return;
    setPhase('pending');
    let stop = false;
    const started = Date.now();
    const poll = async () => {
      while (!stop) {
        const r = await billing.refresh().catch(() => null);
        if (r && effectivePlan(r, new Date()) === 'pro') { setRow(r); setPhase('done'); return; }
        if (Date.now() - started > WAIT_MS) { setPhase('slow'); return; }
        await new Promise(res => setTimeout(res, EVERY_MS));
      }
    };
    void poll();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per return from Stripe
  }, [ret]);

  if (!ret || (ret !== 'checkout_success' && ret !== 'checkout_cancelled')) return null;
  const trial = row?.billing_status === 'trialing';
  const title = phase === 'pending' ? 'Finishing your upgrade'
    : phase === 'slow' ? 'Your payment is going through'
    : phase === 'cancelled' ? 'No change made'
    : trial ? 'Your Pro trial has started' : "You're on Pro";
  return (
    <BottomSheet open onClose={onClose} title={title} side="bottom"
      footer={phase === 'pending' ? undefined : <div className="flex justify-end"><Button size="lg" className="w-full sm:w-auto" onClick={onClose}>{phase === 'done' ? 'Start planning' : 'Done'}</Button></div>}
    >
      {phase === 'pending' && (
        <div role="status" className="flex items-center gap-3">
          <Spinner />
          <p className="text-body text-ink">Stripe is confirming your plan. This takes a few seconds.</p>
        </div>
      )}
      {phase === 'slow' && <p role="status" className="text-body text-ink">Stripe hasn't confirmed it yet. Pro turns on by itself in a minute or two; keep using Forka as usual. If it doesn't, Settings shows where your plan stands.</p>}
      {phase === 'cancelled' && <p className="text-body text-ink">You're still on Free, and nothing was charged. Pro is here whenever you'd like it.</p>}
      {phase === 'done' && row && (
        <div>
          <p className="text-body text-ink">
            {trial
              ? `Pro is free until ${dateFmt(row.trial_end)}, then $39.99 a year. We'll email you three days before, and you can cancel in one tap from Settings.`
              : `Thank you. Your family's whole week is ready to plan: every meal, goals for each person, and meal prep.`}
          </p>
          {children?.(row, onClose)}
        </div>
      )}
    </BottomSheet>
  );
}

/** The first session of a trial: two things worth doing now, each one tap. */
export function TrialStart({ onLunches, onGoals }: { onLunches: () => Promise<void>; onGoals: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lunches = async () => {
    setBusy(true); setError(null);
    try { await onLunches(); } catch { setError("Couldn't plan lunches right now. You can turn them on any time in Settings, under Planning."); setBusy(false); }
  };
  return (
    <div className="mt-6">
      <p className="label mb-2 px-1">Two good places to start</p>
      <ListGroup>
        <ListRow leading={<CalendarDays size={22} strokeWidth={1.75} className="text-green" />} title={busy ? "Planning this week's lunches…" : "Plan this week's lunches"}
          subtitle="Added around the dinners you already have, on the same grocery list" chevron onClick={busy ? undefined : () => void lunches()} />
        <ListRow leading={<Target size={22} strokeWidth={1.75} className="text-green" />} title="Set a goal for someone"
          subtitle="Like more protein or lighter. Meals stay shared; portions change" chevron onClick={busy ? undefined : onGoals} />
      </ListGroup>
      {error && <p role="alert" className="mt-3 text-small text-terracotta-deep">{error}</p>}
    </div>
  );
}
