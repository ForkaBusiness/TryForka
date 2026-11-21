// Prices and Pro only appear once billing is switched on (app_settings.billing_enabled, the
// same switch the app reads), so these pages can go live before launch without showing
// prices. Elements marked data-when-billing="on" show only when it's on; "off" only when
// it's off. Anything that fails (offline, a blocked request) counts as off.
// For review before launch, add ?preview-pricing to the address: it shows the "on" version
// in this browser only and changes nothing.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

async function billingOn() {
  if (new URLSearchParams(window.location.search).has('preview-pricing')) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.billing_enabled&select=value`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return rows?.[0]?.value === true;
  } catch {
    return false;
  }
}

const on = await billingOn();
document.querySelectorAll('[data-when-billing]').forEach(el => {
  el.hidden = (el.getAttribute('data-when-billing') === 'on') !== on;
});
document.documentElement.dataset.billing = on ? 'on' : 'off';
