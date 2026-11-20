import { useState } from 'react';
import { CalendarDays, ChefHat, Target } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { openPortal, planLine, PRICES, startCheckout, type Interval } from '../lib/billing';
import { trialAllowed } from '../../supabase/functions/_shared/billing/state.ts';
import { Button, Card, PageContainer, cx } from '../components/ds';

// Forka Pro: the one sentence, the three things it changes in a parent's week (with real
// examples, not a checklist), and the two plans. Checkout and cancelling both happen on
// Stripe's pages; cancelling is one tap from Settings.

const FEATURES = [
  {
    icon: CalendarDays,
    title: 'Every meal, not just dinner',
    body: 'Breakfasts, lunches and snacks planned with the same care as dinner, and a packable school lunch for each child who needs one. It all lands on one grocery list.',
    example: 'Tuesday: yogurt with berries for breakfast, turkey and cheese roll-ups in Maya\'s lunchbox, apple slices after school, and the chicken traybake for dinner.',
  },
  {
    icon: Target,
    title: 'A goal for each person, one meal for everyone',
    body: 'Set a simple goal for anyone at the table, like more protein or lighter. Meals stay shared; Forka sizes each person\'s portion and shows estimated daily totals.',
    example: 'Same lasagna for everyone: a larger plate for Sam toward more protein, a lighter one for Alex, and a full growing-kid plate for Maya.',
  },
  {
    icon: ChefHat,
    title: 'An hour of prep, a calmer week',
    body: 'Turn the week\'s plan into one prep session that fits about an hour, in the right order, with timers, read aloud and storage notes. Cook once, eat twice, and the list buys enough.',
    example: 'Sunday afternoon: the rice simmers while you chop peppers for two dinners, and Monday\'s chili is a double batch that comes back for Tuesday\'s lunch.',
  },
] as const;

export function Pro() {
  const { billing, back } = useApp();
  const trial = trialAllowed(billing.row, 'year');
  const [interval, setInterval] = useState<Interval>('year');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPro = billing.plan === 'pro';
  // Past the grace period with a payment still being retried: the card is fixed in the
  // portal, never with a second subscription.
  const owed = !isPro && billing.row?.billing_status === 'past_due';

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await (isPro || owed ? openPortal() : startCheckout(interval));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open checkout. Try again.");
      setBusy(false);
    }
  };

  const line = planLine(billing.view);
  return (
    <PageContainer onBack={back}>
      <section className="pb-2">
        <p className="label">Forka Pro</p>
        <h1 className="display mt-2 text-display text-ink">Free plans your family's dinners. Pro plans your family's whole week.</h1>
        <p className="mt-3 text-body text-ink-muted">Everything Free does today stays free. Pro adds the rest of the week.</p>
      </section>

      <ul className="mt-6 flex flex-col gap-4">
        {FEATURES.map(f => (
          <li key={f.title}>
            <Card className="p-5">
              <div className="flex items-start gap-4">
                <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-green-soft text-green"><f.icon size={22} strokeWidth={1.75} /></span>
                <div className="min-w-0">
                  <h2 className="text-heading font-semibold text-ink">{f.title}</h2>
                  <p className="mt-1 text-body text-ink-muted">{f.body}</p>
                  <p className="mt-3 rounded-input bg-cream px-4 py-3 text-small text-ink">{f.example}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-4 px-1 text-small text-ink-muted">Also: unlimited saved recipes, imports and lists, and as many "Make it different" ideas and ingredient answers as you need.</p>

      {billing.status === 'ready' && !billing.enabled ? (
        <Card className="mt-6 p-5">
          <p className="text-body text-ink">Every feature is included for now. Nothing to choose or pay.</p>
        </Card>
      ) : billing.status !== 'ready' ? (
        <Card className="mt-6 p-5" role="status">
          <p className="text-body text-ink">{billing.status === 'loading' ? 'Checking your plan.' : "Couldn't load your plan. Check your connection, then reload."}</p>
        </Card>
      ) : billing.view.kind === 'founding' ? (
        <Card className="mt-6 p-5">
          <p className="text-heading font-semibold text-ink">Founding family</p>
          <p className="mt-1 text-body text-ink-muted">Pro is yours for life. Thank you for being here early.</p>
        </Card>
      ) : owed ? (
        <Card className="mt-6 p-5">
          <p className="text-heading font-semibold text-ink">Your last payment didn't go through</p>
          <p className="mt-1 text-body text-ink-muted">Pro is paused until it does. Update your payment method and Pro comes back right away, with nothing to set up again.</p>
          <Button size="lg" className="mt-4 w-full sm:w-auto" loading={busy} onClick={go}>Update payment method</Button>
          {error && <p role="alert" className="mt-3 text-small text-terracotta-deep">{error}</p>}
        </Card>
      ) : isPro ? (
        <Card className="mt-6 p-5">
          <p className="text-heading font-semibold text-ink">{line.title}</p>
          <p className="mt-1 text-body text-ink-muted">{line.detail}</p>
          <Button size="lg" variant="secondary" className="mt-4 w-full sm:w-auto" loading={busy} onClick={go}>Manage plan</Button>
        </Card>
      ) : (
        <section aria-label="Choose a plan" className="mt-6">
          <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-2">
            {(['year', 'month'] as const).map(i => {
              const selected = interval === i;
              return (
                <button key={i} type="button" role="radio" aria-checked={selected} onClick={() => setInterval(i)}
                  className={cx('flex min-h-24 cursor-pointer flex-col items-start justify-center rounded-card border px-5 py-4 text-left transition-[border-color,background-color] duration-150',
                    selected ? 'border-green bg-green-soft' : 'border-line bg-surface hover:border-ink-muted')}>
                  <span className="text-small font-semibold text-ink-muted">{i === 'year' ? 'Yearly' : 'Monthly'}</span>
                  <span className="mt-1 text-heading font-semibold text-ink">{PRICES[i].amount} <span className="text-body font-normal text-ink-muted">{PRICES[i].per}</span></span>
                  <span className="mt-1 text-small text-ink-muted">{i === 'year' ? (trial ? PRICES.year.note : 'About $3.33 a month.') : PRICES.month.note}</span>
                </button>
              );
            })}
          </div>
          <Button size="lg" className="mt-5 w-full" loading={busy} onClick={go}>
            {interval === 'year' && trial ? 'Start 14 days free' : 'Continue to payment'}
          </Button>
          {error && <p role="alert" className="mt-3 text-small text-terracotta-deep">{error}</p>}
          <p className="mt-3 text-small text-ink-muted">
            {interval === 'year' && trial
              ? "Card needed, not charged for 14 days. We'll email you 3 days before the trial ends. Cancel any time in Settings, in one tap."
              : 'Cancel any time in Settings, in one tap. You keep Pro until the end of what you paid for.'}
          </p>
        </section>
      )}
    </PageContainer>
  );
}
