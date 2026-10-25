import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';

// Animation classes only hide content once JavaScript is running, so pages stay readable without it.

import { StrictMode, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, setCsrf, WAKING_EVENT, READY_EVENT, ApiError } from './api.ts';
import { Logo, ToastProvider, useToast } from './components/ui.tsx';
import { VerifyPage, InspectPage } from './pages/Public.tsx';
import { gsap } from 'gsap';
import { DocsPage, MethodsPage } from './pages/Docs.tsx';
import { Landing } from './pages/Landing.tsx';
import { TestKitPage } from './pages/TestKit.tsx';
import { LoginPage, RegisterPage } from './pages/Auth.tsx';
import { Workspace } from './pages/Workspace.tsx';
import { ShipmentDesk } from './pages/Shipment.tsx';

export type User = { id: string; email: string; name: string; organisation: string; role: string; chainEnabled: boolean };
// `unavailable` means the session could not be checked (server unreachable); it is not the same as signed out.
type AuthState = { user: User | null; loading: boolean; unavailable: string | null; starting: boolean; signedOut: boolean; refresh: () => Promise<void>; logout: () => Promise<void> };
const AuthCtx = createContext<AuthState>({ user: null, loading: true, unavailable: null, starting: false, signedOut: false, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const r = await api<{ user: User | null; csrf?: string }>('GET', '/api/auth/me');
      if (version !== refreshVersion.current) return;
      setUser(r.user); if (r.user) setSignedOut(false);
      setCsrf(r.csrf ?? null);
      setUnavailable(null); setStarting(false);
    } catch (e) {
      if (version !== refreshVersion.current) return;
      setUser(null);
      setUnavailable((e as Error).message);
      setStarting(e instanceof ApiError && ['timeout', 'backend_starting'].includes(e.code));
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, []);
  // Local state is cleared only when the server confirms the session ended; otherwise the error is reported.
  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout');
    ++refreshVersion.current; setSignedOut(true);
    setCsrf(null); setUser(null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const waking = () => setStarting(true), ready = () => { setStarting(false); void refresh(); };
    window.addEventListener(WAKING_EVENT, waking); window.addEventListener(READY_EVENT, ready);
    return () => { window.removeEventListener(WAKING_EVENT, waking); window.removeEventListener(READY_EVENT, ready); };
  }, [refresh]);
  return <AuthCtx.Provider value={{ user, loading, unavailable, starting, signedOut, refresh, logout }}>{children}</AuthCtx.Provider>;
}

/** Poll readiness without reloading or discarding any form state. */
function StartingNotice() {
  const { starting: sessionStarting } = useAuth();
  const [starting, setStarting] = useState(false);
  const [waited, setWaited] = useState(0);
  const [ready, setReady] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (sessionStarting) { setStarting(true); setReady(false); } }, [sessionStarting]);
  useEffect(() => {
    const on = (event: Event) => { setStarting(true); setReady(false); setFailed(false); if ((event as CustomEvent).detail?.state === 'unavailable') setExhausted(true); };
    window.addEventListener(WAKING_EVENT, on);
    return () => window.removeEventListener(WAKING_EVENT, on);
  }, []);
  useEffect(() => {
    if (!starting) return;
    let stopped = false;
    const started = Date.now(); setExhausted(false);
    const poll = async () => {
      while (!stopped && Date.now() - started < 240_000) {
        setWaited(Math.round((Date.now() - started) / 1000));
        try {
          const r = await fetch('/api/ready', { credentials: 'same-origin', signal: AbortSignal.timeout(20_000) });
          if ((r.headers.get('content-type') ?? '').includes('json')) {
            const status = await r.json();
            if (r.ok && status.ready === true) { if (!stopped) { setReady(true); window.dispatchEvent(new Event(READY_EVENT)); } return; }
            if (status.state === 'failed') { if (!stopped) setFailed(true); return; }
            if (status.state === 'unavailable') { if (!stopped) setExhausted(true); return; }
          }
        } catch { /* still starting */ }
        await new Promise((res) => setTimeout(res, 5_000));
      }
      if (!stopped) setExhausted(true);
    };
    void poll();
    return () => { stopped = true; };
  }, [starting, attempt]);
  if (!starting) return null;
  return (
    <div className="backend-notice" role="status" aria-live="polite">
      {ready ? (
        <>
          <strong>The LotHold server is ready.</strong> Your form entries are still here. Retry the operation when you are ready.
        </>
      ) : failed ? <><strong>Server readiness failed.</strong> Required integrity checks did not pass; no successful operation is implied. <button className="linkbtn" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>Retry connection</button></> : exhausted ? <><strong>The service is still unavailable.</strong> No empty workspace or successful save is implied. <button className="linkbtn" onClick={() => setAttempt((n) => n + 1)}>Retry connection</button></> : (
        <>
          <strong>The LotHold server is starting up.</strong> A free service may take a minute or longer to wake. Your form entries stay on this page{waited > 0 ? ` (waiting ${waited} s)` : ''}.
        </>
      )}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout, unavailable, starting } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const firstRender = useRef(true);
  const menu = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const isApp = loc.pathname.startsWith('/app');
  const isAuth = ['/login', '/register'].includes(loc.pathname);
  const isLanding = loc.pathname === '/';
  useEffect(() => {
    const dialog = menu.current;
    if (!dialog) return;
    if (!open) { if (dialog.open) dialog.close(); return; }
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(dialog.querySelectorAll('nav > *'), { x: 12, duration: 0.28, stagger: 0.035, clearProps: 'transform' });
    });
    const desktop = matchMedia('(min-width: 1051px)');
    const closeOnResize = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', closeOnResize);
    return () => { media.revert(); document.body.style.overflow = previousOverflow; desktop.removeEventListener('change', closeOnResize); if (dialog.open) dialog.close(); };
  }, [open]);
  useEffect(() => setOpen(false), [loc.pathname]);
  // Move focus to the new page's content on client-side navigation (not on the initial load, so the
  // skip link stays the first keyboard stop).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const m = document.getElementById('main');
    if (m && loc.hash === '') {
      m.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [loc.pathname]);
  // In-page anchors (e.g. /#how) scroll to their section after render.
  useEffect(() => {
    if (!loc.hash) return;
    const t = window.setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' }), 30);
    return () => window.clearTimeout(t);
  }, [loc.pathname, loc.hash]);
  const navigation = <>
    <Link to="/#how">How it works</Link>
    <NavLink to="/docs">Docs</NavLink>
    <NavLink to="/method">Evidence &amp; methods</NavLink>
    <NavLink to="/inspect">Forest inspector</NavLink>
    <NavLink to="/verify">Registry</NavLink>
    {user ? <button className="linkbtn" onClick={async () => {
      try { await logout(); setOpen(false); nav('/'); }
      catch (e) { toast(`Sign-out could not be confirmed: ${(e as Error).message}`, 'error'); }
    }}>Sign out</button> : <NavLink to="/register">Create an account</NavLink>}
    <NavLink to={user ? '/app' : '/login'} className="nav-cta">Open workspace</NavLink>
  </>;
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="LotHold home"><Logo />LotHold</Link>
        <button ref={toggle} className="menu-toggle" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(true)}>
          <span className="menu-icon" aria-hidden="true"><i /><i /></span>
        </button>
        <nav className="topnav" aria-label="Main">{navigation}</nav>
      </header>
      <dialog ref={menu} id="mobile-nav" className="mobile-drawer" aria-labelledby="mobile-nav-title" onCancel={() => setOpen(false)} onClose={() => { setOpen(false); toggle.current?.focus(); }} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div className="drawer-head"><span id="mobile-nav-title">LotHold / Explore</span><button className="menu-toggle is-open" aria-label="Close navigation" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(false)}><span className="menu-icon" aria-hidden="true"><i /><i /></span></button></div>
        <nav aria-label="Mobile" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>{navigation}</nav>
        <p className="drawer-note">Find the source. Ask for the evidence.<br />A review aid for cocoa shipments.</p>
      </dialog>
      {(isApp || isAuth) && unavailable && !starting && <div className="backend-notice" role="status"><strong>The LotHold server is not running at this address.</strong> Account access and case work need a connected server. <Link to="/docs#troubleshooting">Connection help</Link></div>}
      <StartingNotice />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      {isLanding && <footer className="footer">
        <div className="inner">
          <div>
            <Link to="/" className="brand" aria-label="LotHold home">
              <Logo />
              LotHold
            </Link>
            <p style={{ marginTop: 12, maxWidth: '44ch' }}>Evidence review for cocoa shipments. A prototype: it does not certify sourcing, legality, deforestation-free status or physical origin, and it never submits anything to the EU.</p>
          </div>
          <nav aria-label="Product">
            <ul>
              <li><Link to={user ? '/app' : '/register'}>Workspace</Link></li>
              <li><Link to="/inspect">Forest inspector</Link></li>
              <li><Link to="/method">Evidence &amp; methods</Link></li>
              <li><Link to="/verify">Testnet registry</Link></li>
            </ul>
          </nav>
          <nav aria-label="Resources">
            <ul>
              <li><Link to="/docs">Docs &amp; getting started</Link></li>
              <li><a href="https://github.com/TheWeirdDee/lothold">Source code (GitHub)</a></li>
              <li><a href="/templates/sources.csv">Source-table template (CSV)</a></li>
              <li><Link to="/test-kit">Engineering test kit</Link></li>
              <li><a href="https://glad.earthengine.app/view/global-forest-change">Hansen Global Forest Change</a></li>
              <li><a href="https://forobs.jrc.ec.europa.eu/GFC">JRC Global Forest Cover 2020</a></li>
            </ul>
          </nav>
          <div className="fine">
            <span>Data: Hansen/UMD/Google/USGS/NASA (CC BY 4.0) · European Commission JRC GFC2020 V4</span>
            <span>Testnet registry on Ethereum Sepolia · no tokens, no value transfer</span>
          </div>
        </div>
      </footer>}
      {!isLanding && !isApp && <footer className="utility-footer"><Link to="/docs">User guide</Link><Link to="/method">Evidence &amp; methods</Link><Link to="/">LotHold home</Link></footer>}
    </>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, unavailable, refresh, signedOut } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page">Checking your session…</div>;
  if (!user && unavailable)
    return (
      <div className="page narrow">
        <h1>Your session could not be checked</h1>
        <p role="alert">{unavailable}</p>
        <p>You may still be signed in. Nothing was changed.</p>
        <button className="btn" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  if (!user) return <Navigate to={signedOut ? '/' : `/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="page narrow">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Return to the start page</Link>.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/inspect" element={<InspectPage />} />
              <Route path="/method" element={<MethodsPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/test-kit" element={<TestKitPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/app" element={<RequireAuth><Workspace /></RequireAuth>} />
              <Route path="/app/shipments/:id" element={<RequireAuth><ShipmentDesk /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Shell>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
