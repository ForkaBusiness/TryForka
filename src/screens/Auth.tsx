import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Checkbox, IconButton, Input } from '../components/ds';
import { Wordmark } from '../components/Shell';
import { WelcomePanel } from '../components/WelcomePanel';

// Sign up and log in. Not shown: the website's login.html and signup.html handle this now.
// Form on the left; on desktop, a green panel with a static preview of a real week.
// The style guide can preview it in development (/app/styleguide?preview=login).

type Mode = 'signup' | 'login';

const PANEL_LINE: Record<Mode, string> = {
  signup: 'Dinner for the week, planned in a minute.',
  login: 'Welcome back. Your week is right where you left it.',
};

/** Supabase auth errors in plain words, with what to do next. */
function authMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Check them, or reset your password.";
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first. The link is in your inbox.';
  if (/already registered|already been registered|user already exists/i.test(msg)) return 'There is already an account with this email. Log in instead.';
  if (/password should be at least|password is too short/i.test(msg)) return 'Use a password with at least 8 characters.';
  if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute, then try again.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) return "That sign-in option isn't turned on yet. Use email for now.";
  if (/failed to fetch|network/i.test(msg)) return "Couldn't connect. Check your connection and try again.";
  return msg || 'Something went wrong. Try again.';
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export interface AuthProps {
  mode: Mode;
  onSwitch: (mode: Mode) => void;
  onTerms: () => void;
}

export function Auth({ mode, onSwitch, onTerms }: AuthProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  useEffect(() => { setError(null); setNotice(null); setForgot(false); }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setNotice(null);
    if (forgot) {
      if (!email.trim()) return setError('Enter your email first.');
      setLoading(true);
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      setLoading(false);
      if (err) return setError(authMessage(err));
      setNotice('Check your email for a link to set a new password.');
      return;
    }
    if (mode === 'signup') {
      if (!fullName.trim()) return setError('Enter your name.');
      if (password.length < 8) return setError('Use a password with at least 8 characters.');
      if (!agree) return setError('Agree to the terms to create your account.');
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        // The public.users profile row is created by the on_auth_user_created trigger.
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        if (!data.session) setNotice('Check your email to confirm your account, then log in.');
        // With a session, the auth listener in App moves on to onboarding.
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      }
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const oauth = async (provider: 'google') => {
    setError(null);
    // Supabase redirects even when a provider is switched off, landing on a raw error
    // page; check first and explain instead.
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } });
      const settings = await res.json() as { external?: Record<string, boolean> };
      if (settings.external && !settings.external[provider]) {
        setError("Google sign-in isn't set up yet. Use your email for now.");
        return;
      }
    } catch { /* if the check fails, try the sign-in anyway */ }
    const { error: err } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    if (err) setError(authMessage(err));
  };

  const title = forgot ? 'Reset your password' : mode === 'signup' ? 'Create your account' : 'Log in';

  return (
    <div className="flex min-h-dvh bg-cream">
      <div className="flex flex-1 justify-center px-gutter pt-(--screen-top) pb-10 md:items-center md:px-12 md:py-10">
        <div className="w-full max-w-form">
          <Wordmark className="mb-10" />
          <h1 className="display text-display text-ink">{title}</h1>
          {forgot && <p className="mt-2 text-body text-ink-muted">We'll email you a link to set a new one.</p>}

          <form onSubmit={submit} noValidate className="mt-6 space-y-4">
            {mode === 'signup' && !forgot && (
              <Input label="Name" name="name" autoComplete="name" placeholder="Your name" value={fullName} onChange={e => setFullName(e.target.value)} />
            )}
            <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            {!forgot && (
              <Input
                label="Password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                trailing={<IconButton icon={showPassword ? EyeOff : Eye} label={showPassword ? 'Hide password' : 'Show password'} size="sm" className="mr-1" onClick={() => setShowPassword(s => !s)} />}
              />
            )}
            {mode === 'login' && !forgot && (
              <button type="button" onClick={() => setForgot(true)} className="cursor-pointer text-small font-semibold text-green hover:underline">
                Forgot your password?
              </button>
            )}
            {mode === 'signup' && !forgot && (
              <Checkbox
                checked={agree}
                onChange={setAgree}
                label={<>I agree to the <button type="button" onClick={onTerms} className="cursor-pointer font-semibold text-green underline underline-offset-2">terms</button></>}
              />
            )}
            {error && <p role="alert" className="text-small text-terracotta-deep">{error}</p>}
            {notice && <p role="status" className="text-small font-semibold text-green">{notice}</p>}
            <Button type="submit" size="lg" block loading={loading}>
              {forgot ? 'Send reset link' : mode === 'signup' ? 'Create account' : 'Log in'}
            </Button>
            {forgot && (
              <Button variant="ghost" block onClick={() => setForgot(false)}>Back to log in</Button>
            )}
          </form>

          {!forgot && (
            <>
              <div className="my-6 flex items-center gap-3 text-small text-ink-muted">
                <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
              </div>
              <Button variant="secondary" size="lg" block onClick={() => oauth('google')}>
                <GoogleMark />Continue with Google
              </Button>
              <p className="mt-8 text-body text-ink-muted">
                {mode === 'signup' ? 'Already have an account? ' : 'New to Forka? '}
                <button type="button" onClick={() => onSwitch(mode === 'signup' ? 'login' : 'signup')} className="cursor-pointer font-semibold text-green hover:underline">
                  {mode === 'signup' ? 'Log in' : 'Create an account'}
                </button>
              </p>
            </>
          )}
        </div>
      </div>

      <WelcomePanel line={PANEL_LINE[mode]} />
    </div>
  );
}

/** Shown after following a password-reset link (Supabase PASSWORD_RECOVERY event). */
export function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use a password with at least 8 characters.');
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) return setError(authMessage(err));
    onDone();
  };
  return (
    <div className="flex min-h-dvh justify-center bg-cream px-gutter pt-(--screen-top) pb-10 md:items-center md:py-10">
      <form onSubmit={submit} noValidate className="w-full max-w-form space-y-4">
        <h1 className="display text-display text-ink">Set a new password</h1>
        <Input label="New password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p role="alert" className="text-small text-terracotta-deep">{error}</p>}
        <Button type="submit" size="lg" block loading={loading}>Save password</Button>
      </form>
    </div>
  );
}
