// The renewal terms shown before anyone pays (the Pro page). Auto-renewal laws ask for the
// price, that it renews until cancelled and how often, when the first charge is, and how to
// cancel, clearly and before purchase. Pure, tested in tests/renewal.test.ts.

type Interval = 'month' | 'year';

/** The refund promise (Terms 8.7). */
const REFUND = 'Changed your mind? Full refund within 14 days of any payment, no questions asked.';

const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** The renewal terms, in full, before anyone pays. */
export function renewalTerms(interval: Interval, trial: boolean, now = new Date()): string {
  if (interval === 'year' && trial) {
    const first = longDate(new Date(now.getTime() + 14 * 86_400_000));
    return `Free for 14 days. Then $39.99 is charged on ${first} and every year after, until you cancel. A card is needed now; we email you 3 days before the first charge. Cancel any time in Settings, in one tap: cancel before ${first} and you pay nothing. ${REFUND}`;
  }
  return interval === 'year'
    ? `$39.99 today, then $39.99 every year until you cancel. Cancel any time in Settings, in one tap; you keep Pro until the end of the year you paid for. ${REFUND}`
    : `$4.99 today, then $4.99 every month until you cancel. Cancel any time in Settings, in one tap; you keep Pro until the end of the month you paid for. ${REFUND}`;
}

