'use client';

import { FormEvent, useState } from 'react';
import { Check, CircleAlert, LockKeyhole, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type AuthMode = 'signin' | 'signup';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trustPoints = [
  'Your content is checked inside your browser',
  'Nothing is published or shared on your behalf',
  'Your private session clears after 30 minutes',
];

export function AuthGate(): JSX.Element {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!supabase) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-setup-title">
          <span className="auth-card-icon"><CircleAlert size={18} /></span>
          <h2 id="auth-setup-title">Sign-in is not set up yet</h2>
          <p className="auth-lede">This site needs its database connection before people can sign in. Add the NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY settings in your hosting environment, then redeploy.</p>
        </section>
      </main>
    );
  }

  const client = supabase;

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setMessage(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    const result = mode === 'signin'
      ? await client.auth.signInWithPassword({ email: trimmedEmail, password })
      : await client.auth.signUp({ email: trimmedEmail, password });

    setSubmitting(false);
    setPassword('');

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === 'signup' && !result.data.session) {
      setMessage('Account created. Sign in with your new password.');
      setMode('signin');
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-aside">
        <div className="auth-brand"><span className="brand-mark"><Shield size={18} strokeWidth={2.5} /></span><span>Privacy Before You Post</span></div>
        <div className="eyebrow"><span className="eyebrow-dot" /> PRIVATE BY DEFAULT</div>
        <h1>Sign in before you check a post.</h1>
        <p className="auth-aside-lede">Your account keeps access to the privacy checker limited to you.</p>
        <ul className="auth-points">
          {trustPoints.map((point) => <li key={point}><Check size={14} />{point}</li>)}
        </ul>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        <span className="auth-card-icon"><LockKeyhole size={18} /></span>
        <h2 id="auth-title">{mode === 'signin' ? 'Sign in to continue' : 'Create your account'}</h2>
        <p className="auth-lede">{mode === 'signin' ? 'Enter your email and password to open the privacy checker.' : 'Takes a moment. You will be signed in right after.'}</p>

        <div className="mode-tabs auth-tabs" role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button>
        </div>

        <form className="auth-form" onSubmit={(event) => { void handleSubmit(event); }} noValidate>
          <label>
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            <span>Password</span>
            <input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-success" role="status">{message}</p>}

          <button type="submit" className="button primary large auth-submit" disabled={submitting}>
            {submitting ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="auth-footer"><LockKeyhole size={13} /> Your privacy checks still run in your browser.</div>
      </section>
    </main>
  );
}
