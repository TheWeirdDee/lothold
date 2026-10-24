import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';
import { StrictMode, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, setCsrf } from './api.ts';
import { Logo, ToastProvider } from './components/ui.tsx';
import { Landing, MethodPage, VerifyPage, InspectPage } from './pages/Public.tsx';
import { LoginPage, RegisterPage } from './pages/Auth.tsx';
import { Workspace } from './pages/Workspace.tsx';
import { ShipmentDesk } from './pages/Shipment.tsx';

export type User = { id: string; email: string; name: string; organisation: string; role: string; chainEnabled: boolean };
type AuthState = { user: User | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> };
const AuthCtx = createContext<AuthState>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User | null; csrf?: string }>('GET', '/api/auth/me');
      setUser(r.user);
      setCsrf(r.csrf ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    setCsrf(null);
    setUser(null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <AuthCtx.Provider value={{ user, loading, refresh, logout }}>{children}</AuthCtx.Provider>;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
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
    if (m && loc.hash === '') m.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [loc.pathname]);
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
          {user && <NavLink to="/app">Shipments</NavLink>}
          <NavLink to="/inspect">Inspect forest evidence</NavLink>
          <NavLink to="/method">Method &amp; sources</NavLink>
          <NavLink to="/verify">Testnet registry</NavLink>
          {user ? (
            <button
              className="linkbtn"
              onClick={async () => {
                await logout();
                nav('/');
              }}
            >
              Sign out <span className="muted small" style={{ marginLeft: 6 }}>({user.organisation})</span>
            </button>
          ) : (
            <NavLink to="/login">Sign in</NavLink>
          )}
        </nav>
      </header>
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      <footer className="footer">
        <div className="inner">
          <span>LotHold prototype. It does not certify sourcing, legality, deforestation-free status or physical origin, and it does not submit anything to the EU.</span>
          <span>
            Data: Hansen/UMD/Google/USGS/NASA (CC BY 4.0); European Commission JRC GFC2020 V4. <Link to="/method">Sources</Link>
          </span>
        </div>
      </footer>
    </>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page">Checking your session…</div>;
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
