import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// A password-reset link that lands on /app/ (read before the client clears the URL).
export const OPENED_FROM_RECOVERY_LINK = /(^|[#&?])type=recovery(&|$)/.test(window.location.hash + window.location.search);

// Default options on purpose: the default storage key is shared with the website's
// client (same origin), and detectSessionInUrl finishes Google sign-in and email
// confirmation links that land on /app/.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Log in, sign up and password reset live on the website (tryforka.com).
export const WEBSITE_HOME = '/';
export const WEBSITE_LOGIN = '/login.html';
export const WEBSITE_RESET_PASSWORD = '/reset-password.html';

let leaving = false;
/** True once the app is navigating away (sign out), so it doesn't also redirect to log in. */
export const isLeaving = () => leaving;

/** Signs out and goes to the website home. Also used after deleting the account. */
export async function signOutToWebsite() {
  leaving = true;
  // A recipe left unsaved on this device belongs to the person signing out.
  try { localStorage.removeItem('forka_unsaved_recipe'); } catch { /* nothing kept */ }
  try { await supabase.auth.signOut(); } catch { /* the local session is cleared regardless */ }
  window.location.assign(WEBSITE_HOME);
}
