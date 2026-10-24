import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, setCsrf } from '../api.ts';
import { useAuth } from '../main.tsx';

function safeNext(n: string | null) {
  return n && n.startsWith('/app') && !n.startsWith('//') ? n : '/app';
}

export function LoginPage() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="page narrow" style={{ maxWidth: 440 }}>
      <h1>Sign in</h1>
      <form
        className="panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setBusy(true);
          try {
            const r = await api<{ csrf: string }>('POST', '/api/auth/login', { email, password });
            setCsrf(r.csrf);
            await refresh();
            nav(safeNext(sp.get('next')));
          } catch (er) {
            setErr((er as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err && <p role="alert" className="callout rust small">{err}</p>}
        <button className="btn" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="small" style={{ marginTop: 14 }}>
        No account? <Link to="/register">Create a workspace</Link>.
      </p>
    </div>
  );
}

export function RegisterPage() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', organisation: '', email: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="page narrow" style={{ maxWidth: 480 }}>
      <h1>Create a workspace</h1>
      <p className="muted small">A workspace belongs to one organisation. Its shipments and evidence are private to its members. It starts empty.</p>
      <form
        className="panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setBusy(true);
          try {
            const r = await api<{ csrf: string }>('POST', '/api/auth/register', f);
            setCsrf(r.csrf);
            await refresh();
            nav('/app');
          } catch (er) {
            setErr((er as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Your name
          <input type="text" autoComplete="name" value={f.name} onChange={set('name')} required maxLength={200} />
        </label>
        <label className="field">
          Organisation
          <input type="text" autoComplete="organization" value={f.organisation} onChange={set('organisation')} required maxLength={200} />
        </label>
        <label className="field">
          Email
          <input type="email" autoComplete="email" value={f.email} onChange={set('email')} required />
        </label>
        <label className="field">
          Password
          <span className="hint">At least 10 characters.</span>
          <input type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={set('password')} required />
        </label>
        {err && <p role="alert" className="callout rust small">{err}</p>}
        <button className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </div>
  );
}
