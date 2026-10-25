import { READY_EVENT } from '../api.ts';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export const OVERALL: Record<string, { label: string; cls: string }> = {
  HOLD: { label: 'HOLD', cls: 'hold' },
  NEEDS_HUMAN_REVIEW: { label: 'NEEDS HUMAN REVIEW', cls: 'review' },
  READY_FOR_SIGN_OFF: { label: 'READY FOR SIGN-OFF', cls: 'ready' },
  REVIEWED_DRAFT: { label: 'REVIEWED DRAFT', cls: 'reviewed' },
};

export const ENV_STATUS: Record<string, { label: string; cls: string; explain: string }> = {
  NEEDS_HUMAN_REVIEW: { label: 'Land-change signal', cls: 'review', explain: 'Annual tree-cover loss recorded after 2020 inside the plot. Investigate; this is not a deforestation finding.' },
  NO_POST_2020_LOSS_OBSERVED: { label: 'No post-2020 loss observed', cls: 'observed', explain: 'No annual loss recorded 2021–2025 on the sampled pixels. Not proof the plot is deforestation-free.' },
  PARTIAL_COVERAGE: { label: 'Partial coverage', cls: 'unavailable', explain: 'Part of the plot has no usable observation; that part cannot be assessed.' },
  PLOT_OUTSIDE_COVERAGE: { label: 'Outside dataset coverage', cls: 'unavailable', explain: 'The plot is outside the installed data tile. No inference is made.' },
  UNAVAILABLE: { label: 'No usable observation', cls: 'unavailable', explain: 'The data could not be read for this plot. No conclusion is drawn.' },
  PLOT_GEOMETRY_INVALID: { label: 'Geometry invalid', cls: 'hold', explain: 'Not analysed until the geometry is corrected.' },
  queued: { label: 'Analysis pending', cls: 'neutral', explain: 'Waiting for the environmental analysis job. No conclusion yet.' },
  not_started: { label: 'Not analysed', cls: 'neutral', explain: 'The plot has not been analysed yet.' },
  failed: { label: 'Analysis failed', cls: 'unavailable', explain: 'The analysis job failed. No conclusion is drawn.' },
};

export const DIM_LABEL: Record<string, Record<string, { label: string; cls: string }>> = {
  record: { COMPLETE: { label: 'Complete', cls: 'ready' }, INCOMPLETE: { label: 'Incomplete', cls: 'hold' }, NOT_SUPPORTED: { label: 'Not supported', cls: 'hold' } },
  environment: {
    NOT_STARTED: { label: 'Not started', cls: 'neutral' },
    IN_PROGRESS: { label: 'Analysis running', cls: 'neutral' },
    UNAVAILABLE: { label: 'Unavailable / no coverage', cls: 'unavailable' },
    NEEDS_REVIEW: { label: 'Needs investigation', cls: 'review' },
    REVIEWED_WITH_EVIDENCE: { label: 'Investigated with evidence', cls: 'ready' },
    NO_POST_2020_LOSS_OBSERVED: { label: 'No post-2020 loss observed', cls: 'observed' },
    BLOCKED_BY_GEOMETRY: { label: 'Blocked by geometry', cls: 'hold' },
  },
  allocation: { NO_SOURCES: { label: 'No source table', cls: 'neutral' }, CONFLICT: { label: 'Conflict', cls: 'hold' }, NOT_RESERVED: { label: 'Not reserved', cls: 'review' }, RESERVED: { label: 'Reserved in ledger', cls: 'ready' } },
};

export function Badge({ cls, children, title }: { cls: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${cls}`} title={title}>
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, [string, string]> = { hold: ['hold', 'Hold'], review: ['review', 'Review'], not_supported: ['hold', 'Not supported'], warning: ['warning', 'Note'] };
  const [cls, label] = map[severity] ?? ['neutral', severity];
  return <Badge cls={cls}>{label}</Badge>;
}

// ---------- toast ----------
type Toast = { text: string; kind: 'info' | 'error' } | null;
const ToastCtx = createContext<(text: string, kind?: 'info' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Toast>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setT({ text, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">
        {t && <div className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- tables ----------
/** Horizontal scroll container for tables. Becomes a focusable, labelled region only while it actually overflows,
 *  so keyboard users can scroll it without adding a Tab stop to tables that fit. */
export function TableWrap({ children, label = 'Table', style, stack = false }: { children: ReactNode; label?: string; style?: CSSProperties; stack?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  // With `stack`, phones show each row as a labelled block: label every cell with its column heading.
  useEffect(() => {
    if (!stack || !ref.current) return;
    const heads = [...ref.current.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    ref.current.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
      if (heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]!);
    }));
  });
  return (
    <div ref={ref} className={`table-wrap${stack ? ' stack-wrap' : ''}`} style={style} {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': `${label} (scrolls sideways)` } : {})}>
      {children}
    </div>
  );
}

// ---------- tabs ----------
/** Arrow, Home and End keys for a role="tablist" (WAI-ARIA tabs pattern, automatic activation). Tabs use roving
 *  tabindex: only the selected tab is in the Tab order, and each tab's id is `${idPrefix}${key}`. */
export function tabKeys<K extends string>(e: KeyboardEvent<HTMLElement>, keys: readonly K[], current: K, select: (k: K) => void, idPrefix: string) {
  const i = keys.indexOf(current);
  const next = e.key === 'ArrowRight' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(i - 1 + keys.length) % keys.length] : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : undefined;
  if (next === undefined) return;
  e.preventDefault();
  select(next);
  document.getElementById(`${idPrefix}${next}`)?.focus();
}

// ---------- dialog ----------
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title">
      <div className="dlg-head">
        <h2 id="dlg-title" style={{ margin: 0, fontSize: '1.05rem' }}>
          {title}
        </h2>
        <span className="spacer" />
        <button className="btn secondary small" onClick={onClose} aria-label="Close dialog">
          Close
        </button>
      </div>
      <div className="dlg-body">{children}</div>
      {footer && <div className="dlg-foot">{footer}</div>}
    </dialog>
  );
}

/** LotHold mark: a plot boundary held by a bracket. */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#edeae1" />
      <path d="M10.5 9.5 19.5 8 23.5 15 20 23.5 11 22.5 8.5 15.5Z" fill="none" stroke="#141816" strokeWidth="2" strokeLinejoin="round" />
      <path d="M6 6v20h4" fill="none" stroke="#2c6a4c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Adds the "in" class when an element scrolls into view (content is visible by default without JS). */
export function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.reveal:not(.in)')];
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    els.forEach((e) => io.observe(e));
    // Safety net: never leave content hidden.
    const t = window.setTimeout(() => els.forEach((e) => e.classList.add('in')), 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  });
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      setState({ data, error: null, loading: false });
    } catch (e) {
      setState((s) => ({ data: s.data, error: e as Error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
    const retryRead = () => { void run(); };
    window.addEventListener(READY_EVENT, retryRead);
    return () => window.removeEventListener(READY_EVENT, retryRead);
  }, [run]);
  return { ...state, reload: run };
}
