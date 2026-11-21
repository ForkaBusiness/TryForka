// Shared Supabase client for the website. The app at /app/ uses the same project,
// the same anon key and the default storage key, so a session created here is the
// session the app sees (both run on tryforka.com, one origin).
// Pinned to the version in the app's package-lock.json; bump both together.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.103.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';


export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const APP_PATH = '/app/';

export function goToApp() {
  window.location.href = APP_PATH;
}

/** Resolves to the current session, or null. */
export async function getSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}
