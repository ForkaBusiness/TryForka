// Forka Pro's emails, sent through Resend:
//   - "your trial ends soon", three days before a yearly trial ends;
//   - "welcome to Forka Pro", once for each new subscription: what was bought, the renewal
//     terms, how to cancel and the 14-day refund (what auto-renewal laws ask to confirm in a
//     form the customer can keep);
//   - "your plan renews soon", 35 days before each yearly renewal (inside both California's
//     15 to 45 days and Illinois's 30 to 60 days).
// The words are pure (tested in tests/billing.test.ts); sending needs RESEND_API_KEY and
// EMAIL_FROM (an address on a domain verified in Resend); EMAIL_REPLY_TO, if set, is where
// replies go.

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

/** Days of a full, no-questions refund after any payment (the Terms and the Pro page say the same). */
export const REFUND_DAYS = 14;
/** The yearly renewal reminder goes out this many days before the renewal. */
export const RENEWAL_REMINDER_DAYS = 35;

export interface WelcomeDetails {
  interval: string; amount: number; currency: string;
  /** Set for a trial: when it ends and the first charge happens. */
  trialEnd: Date | null;
  /** When the paid period renews (no trial). */
  renewsOn: Date | null;
  timeZone?: string | null;
}
export interface RenewalDetails { renewsOn: Date; amount: number; currency: string; interval: string; timeZone?: string | null }

type Email = { subject: string; text: string; html: string };
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
const per = (interval: string) => (interval === 'month' ? 'month' : 'year');

/** The shared look: paragraphs, one button, small print. */
function layout(paragraphs: string[], button: { label: string; url: string }, small: string[]): Email['html'] {
  const p = (t: string, style = 'margin:0 0 16px;font-size:16px;line-height:24px') => `<p style="${style}">${escape(t)}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2b2621">
<div style="max-width:520px;margin:0 auto;background:#fffdf8;border-radius:20px;padding:28px">
${p('Hi,')}
${paragraphs.map(t => p(t)).join('\n')}
<p style="margin:0 0 24px"><a href="${escape(button.url)}" style="display:inline-block;background:#2f5d3a;color:#fffdf8;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px">${escape(button.label)}</a></p>
${small.map(t => p(t, 'margin:0 0 12px;font-size:14px;line-height:20px;color:#6b6157')).join('\n')}
${p('Forka', 'margin:12px 0 0;font-size:16px;line-height:24px')}
</div></body></html>`;
}

const refundLine = `Changed your mind? You can have a full refund of any payment within ${REFUND_DAYS} days of it, no questions asked: in Forka, go to Settings, then Refund my last payment. Or contact us through tryforka.com.`;

/** Sent once for each new subscription: what was bought, the renewal terms, how to cancel, the refund. */
export function welcomeEmail(d: WelcomeDetails, manageUrl: string, termsUrl: string): Email {
  const tz = validTimeZone(d.timeZone);
  const price = priceText(d.amount, d.currency, d.interval);
  const every = per(d.interval);
  const cancelHow = `Cancel any time, online, in a few taps: in Forka, go to Settings, then Manage plan (${manageUrl}).`;
  const paragraphs = d.trialEnd
    ? [
        `Your 14-day free trial of Forka Pro has started. It's free until ${longDate(d.trialEnd, tz)}.`,
        `Then ${money(d.amount, d.currency)} is charged to the card you added on ${shortDate(d.trialEnd, tz)}, and every ${every} after that, until you cancel. Forka Pro renews automatically. We'll email you 3 days before the first charge.`,
        `${cancelHow} Cancel before ${shortDate(d.trialEnd, tz)} and you pay nothing.`,
      ]
    : [
        `Thank you for choosing Forka Pro. You paid ${money(d.amount, d.currency)} today for your first ${every}.`,
        `Forka Pro renews automatically every ${every} at ${price}, charged to the card you used, until you cancel.${d.renewsOn ? ` Your next payment is on ${shortDate(d.renewsOn, tz)}.` : ''}`,
        `${cancelHow} You keep Pro until the end of the ${every} you paid for, and you won't be charged again.`,
      ];
  const small = [refundLine, `The full terms of Forka Pro: ${termsUrl}`];
  const text = `Hi,\n\n${[...paragraphs, ...small].join('\n\n')}\n\nForka\n`;
  return {
    subject: d.trialEnd ? 'Welcome to Forka Pro: your free trial has started' : 'Welcome to Forka Pro',
    text,
    html: layout(paragraphs, { label: 'Manage your plan', url: manageUrl }, small),
  };
}

/** Sent RENEWAL_REMINDER_DAYS before each yearly renewal. */
export function renewalReminderEmail(r: RenewalDetails, manageUrl: string, termsUrl: string): Email {
  const tz = validTimeZone(r.timeZone);
  const when = longDate(r.renewsOn, tz);
  const paragraphs = [
    `Your yearly Forka Pro plan renews automatically on ${when}. ${money(r.amount, r.currency)} will be charged to the card on file, for another ${per(r.interval)}.`,
    "If you'd like to keep Pro, there's nothing to do.",
    `To cancel or change your plan, it takes a few taps: in Forka, go to Settings, then Manage plan (${manageUrl}). Cancel before ${shortDate(r.renewsOn, tz)} and you won't be charged.`,
  ];
  const small = [refundLine, `The full terms of Forka Pro: ${termsUrl}`];
  return {
    subject: `Your Forka Pro plan renews on ${when}`,
    text: `Hi,\n\n${[...paragraphs, ...small].join('\n\n')}\n\nForka\n`,
    html: layout(paragraphs, { label: 'Manage or cancel Pro', url: manageUrl }, small),
  };
}

export async function sendEmail(to: string, email: { subject: string; text: string; html: string }): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!key || !from) throw new Error('email is not set up (RESEND_API_KEY, EMAIL_FROM)');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: email.subject, text: email.text, html: email.html, ...(Deno.env.get('EMAIL_REPLY_TO') ? { reply_to: Deno.env.get('EMAIL_REPLY_TO') } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`resend ${res.status}: ${(body as { message?: string }).message ?? 'failed'}`);
  }
}
