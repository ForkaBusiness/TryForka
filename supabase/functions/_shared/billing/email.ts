// The "your trial ends soon" email, sent through Resend three days before a yearly trial
// ends. The words are pure (tested in tests/billing.test.ts); sending needs RESEND_API_KEY
// and EMAIL_FROM (an address on a domain verified in Resend).

export interface TrialReminder { trialEnd: Date; amount: number; currency: string; interval: string; /** The family's time zone (from the app at checkout), so the date is their date. */ timeZone?: string | null }

/** A real IANA time zone, or US Eastern (most families) when there's none or it's unknown. */
export function validTimeZone(tz: string | null | undefined): string {
  if (tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { /* unknown */ } }
  return 'America/New_York';
}

/** "$39.99 a year" */
export function priceText(amount: number, currency: string, interval: string): string {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  return `${money} a ${interval === 'month' ? 'month' : 'year'}`;
}

const longDate = (d: Date, timeZone: string) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone });
const shortDate = (d: Date, timeZone: string) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone });
const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function trialReminderEmail(r: TrialReminder, manageUrl: string): { subject: string; text: string; html: string } {
  const tz = validTimeZone(r.timeZone);
  const when = longDate(r.trialEnd, tz);
  const price = priceText(r.amount, r.currency, r.interval);
  const lines = [
    `Your Forka Pro trial ends on ${when}. After that, Pro is ${price}, charged to the card you added.`,
    "If you'd like to keep Pro, there's nothing to do.",
    `To change your plan or cancel, it takes one tap: ${manageUrl}`,
    `Cancel before ${shortDate(r.trialEnd, tz)} and you won't be charged.`,
  ];
  const text = `Hi,\n\n${lines.join('\n\n')}\n\nForka\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2b2621">
<div style="max-width:520px;margin:0 auto;background:#fffdf8;border-radius:20px;padding:28px">
<p style="margin:0 0 16px;font-size:16px;line-height:24px">Hi,</p>
<p style="margin:0 0 16px;font-size:16px;line-height:24px">Your Forka Pro trial ends on <strong>${escape(when)}</strong>. After that, Pro is <strong>${escape(price)}</strong>, charged to the card you added.</p>
<p style="margin:0 0 16px;font-size:16px;line-height:24px">If you'd like to keep Pro, there's nothing to do.</p>
<p style="margin:0 0 24px"><a href="${escape(manageUrl)}" style="display:inline-block;background:#2f5d3a;color:#fffdf8;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px">Manage or cancel Pro</a></p>
<p style="margin:0 0 16px;font-size:14px;line-height:20px;color:#6b6157">Cancel before ${escape(shortDate(r.trialEnd, tz))} and you won't be charged.</p>
<p style="margin:0;font-size:16px;line-height:24px">Forka</p>
</div></body></html>`;
  return { subject: `Your Forka Pro trial ends on ${when}`, text, html };
}

export async function sendEmail(to: string, email: { subject: string; text: string; html: string }): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!key || !from) throw new Error('email is not set up (RESEND_API_KEY, EMAIL_FROM)');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: email.subject, text: email.text, html: email.html }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`resend ${res.status}: ${(body as { message?: string }).message ?? 'failed'}`);
  }
}
