import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';

// Animation classes only hide content once JavaScript is running, so pages stay readable without it.
document.documentElement.classList.add('js');
import { StrictMode, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, isBackendUnavailable, setCsrf } from './api.ts';
import { Logo, ToastProvider, useToast } from './components/ui.tsx';
import { MethodPage, VerifyPage, InspectPage } from './pages/Public.tsx';
import { Landing } from './pages/Landing.tsx';
import { TestKitPage } from './pages/TestKit.tsx';
import { LoginPage, RegisterPage } from './pages/Auth.tsx';
import { Workspace } from './pages/Workspace.tsx';
import { ShipmentDesk } from './pages/Shipment.tsx';

export type User = { id: string; email: string; name: string; organisation: string; role: string; chainEnabled: boolean };
// `unavailable` means the session could not be checked (server unreachable); it is not the same as signed out.
type AuthState = { user: User | null; loading: boolean; unavailable: string | null; refresh: () => Promise<void>; logout: () => Promise<void> };
const AuthCtx = createContext<AuthState>({ user: null, loading: true, unavailable: null, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User | null; csrf?: string }>('GET', '/api/auth/me');
      setUser(r.user);
      setCsrf(r.csrf ?? null);
      setUnavailable(null);
    } catch (e) {
      setUser(null);
      setUnavailable((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  // Local state is cleared only when the server confirms the session ended; otherwise the error is reported.
  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout');
    setCsrf(null);
    setUser(null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <AuthCtx.Provider value={{ user, loading, unavailable, refresh, logout }}>{children}</AuthCtx.Provider>;
}

/** Shown when this site cannot reach the LotHold server (for example a static-only deployment). */
function BackendNotice() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    api('GET', '/api/health').catch((e) => setDown(isBackendUnavailable(e)));
  }, []);
  if (!down) return null;
  return (
    <div className="backend-notice" role="status">
      <strong>The LotHold server is not running at this address.</strong> This site shows the interface only: sign-in, uploads, forest analysis and the registry need the server (API, database and forest datasets). Run it locally by following the{' '}
      <a href="https://github.com/TheWeirdDee/lothold#run-it-locally">README</a>.
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const firstRender = useRef(true);
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
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="LotHold home">
          <Logo />
          LotHold
        </Link>
        <button className="linkbtn menu-toggle" aria-expanded={open} aria-controls="topnav" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close menu' : 'Menu'}
        </button>
        <nav id="topnav" className={`topnav ${open ? 'open' : ''}`} aria-label="Main">
          <Link to="/#how">How it works</Link>
          <NavLink to="/method">Evidence &amp; methods</NavLink>
          <NavLink to="/inspect">Forest inspector</NavLink>
          <NavLink to="/verify">Registry</NavLink>
          <span className="divider" aria-hidden="true" />
          {user ? (
            <>
              <button
                className="linkbtn"
                onClick={async () => {
                  try {
                    await logout();
                    nav('/');
                  } catch (e) {
                    toast(`Sign-out could not be confirmed by the server: ${(e as Error).message}`, 'error');
                  }
                }}
              >
                Sign out
              </button>
              <NavLink to="/app" className="nav-cta" end={false}>
                Workspace
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/login">Sign in</NavLink>
              <NavLink to="/register" className="nav-cta">
                Open the desk
              </NavLink>
            </>
          )}
        </nav>
      </header>
      <BackendNotice />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      <footer className="footer">
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
              <li><a href="https://github.com/TheWeirdDee/lothold">Source code (GitHub)</a></li>
              <li><a href="/api/templates/sources.csv">Source-table template (CSV)</a></li>
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
      </footer>
    </>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, unavailable, refresh } = useAuth();
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
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
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
              <Route path="/method" element={<MethodPage />} />
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
