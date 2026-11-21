// "Continue with Google" only shows when Google sign-in is switched on in Supabase, so the
// button never leads to an error. Turning it on later needs no change here.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
  const settings = res.ok ? await res.json() : null;
  if (settings?.external?.google) document.querySelectorAll('[data-provider="google"]').forEach(el => { el.hidden = false; });
} catch {
  // Offline or blocked: email sign-in still works.
}
