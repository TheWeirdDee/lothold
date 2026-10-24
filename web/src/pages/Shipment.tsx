import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api, fmtDate } from '../api.ts';
import { Badge, DIM_LABEL, OVERALL, SeverityBadge, useToast } from '../components/ui.tsx';
import { DetailsTab, SourcesTab, PlotsTab, AllocationTab, DocumentsTab, ActivityTab, ReviewDialog, SignOff } from './DeskParts.tsx';

export type View = any;
export type Focus = { tab: string; row?: number; column?: string; featureIndex?: number; plotRef?: string; field?: string } | null;

const TABS = [
  ['review', 'Findings'],
  ['details', 'Shipment details'],
  ['sources', 'Source lots'],
  ['plots', 'Plots & land evidence'],
  ['allocation', 'Allocation'],
  ['documents', 'Documents'],
  ['activity', 'Activity'],
] as const;

export function ShipmentDesk() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'review';
  const toast = useToast();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const v = await api('GET', `/api/shipments/${id}`);
      setView(v);
      setError(null);
      return v;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  // Poll only while environmental analysis is still running.
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (view?.evaluation?.readiness?.environment === 'IN_PROGRESS' || view?.plots?.features?.some((f: any) => f.env && f.env.state === 'queued')) {
      timer.current = window.setTimeout(() => void load(), 2500);
    }
  }, [view, load]);

  const setTab = (t: string) => {
    const next = new URLSearchParams(sp);
    next.set('tab', t);
    setSp(next, { replace: false });
  };
  const goTo = (f: Focus) => {
    if (!f) return;
    setFocus(f);
    setTab(f.tab);
  };

  if (error && !view)
    return (
      <div className="page narrow">
        <h1>Shipment unavailable</h1>
        <p role="alert">{error}</p>
        <Link to="/app">Back to shipments</Link>
      </div>
    );
  if (!view) return <div className="page">Loading shipment…</div>;

  const ev = view.evaluation;
  const r = ev.readiness;
  const reviewed = view.approval.state === 'current';
  const overall = reviewed ? OVERALL.REVIEWED_DRAFT! : OVERALL[r.overall]!;
  const holds = ev.findings.filter((f: any) => f.severity === 'hold' || f.severity === 'not_supported').length;
  const reviews = ev.findings.filter((f: any) => f.severity === 'review').length;
  const counts: Record<string, [number, string] | undefined> = {
    review: [holds + reviews, holds ? 'hold' : ''],
    plots: view.plots ? [view.plots.features.length, ''] : undefined,
    sources: view.sources ? [view.sources.rows.length, ''] : undefined,
    documents: view.documents.length ? [view.documents.length, ''] : undefined,
  };

  return (
    <div className="page">
      <Link to="/app" className="crumb">
        ← Shipments
      </Link>
      <header className="page-head" style={{ paddingTop: 0 }}>
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Shipment case · opened {fmtDate(view.shipment.createdAt)}</p>
          <h1 className="break" style={{ fontSize: 'clamp(1.6rem, 1.2rem + 1.4vw, 2.3rem)', fontFamily: 'var(--mono)', letterSpacing: '-0.02em', fontWeight: 500 }}>
            {view.shipment.reference}
          </h1>
        </div>
      </header>

      <section className="status-strip" aria-label="Review status">
        <div className={`overall ${overall.cls}`}>
          <Badge cls={overall.cls}>{overall.label}</Badge>
          {view.approval.state === 'stale' && <Badge cls="stale" title={`Signed off ${fmtDate(view.approval.approvedAt)} by ${view.approval.approvedBy}`}>Sign-off out of date</Badge>}
        </div>
        <div className="dims">
          <span>
            Records: <b>{DIM_LABEL.record![r.record]!.label}</b>
          </span>
          <span>
            Land evidence: <b>{DIM_LABEL.environment![r.environment]!.label}</b>
          </span>
          <span>
            Allocation: <b>{DIM_LABEL.allocation![r.allocation]!.label}</b>
          </span>
        </div>
        <div className="process-line">{ev.processLine}</div>
      </section>

      <div className="tabs" role="tablist" aria-label="Shipment sections">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} onClick={() => setTab(k)}>
            {label}
            {counts[k] && counts[k]![0] > 0 && <span className={`count ${counts[k]![1]}`}>{counts[k]![0]}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel" key={tab}>
        {tab === 'review' && <FindingsTab view={view} goTo={goTo} onReview={setReviewKey} reload={load} />}
        {tab === 'details' && <DetailsTab view={view} reload={load} focus={focus} />}
        {tab === 'sources' && <SourcesTab view={view} reload={load} focus={focus} />}
        {tab === 'plots' && <PlotsTab view={view} reload={load} focus={focus} onReview={setReviewKey} />}
        {tab === 'allocation' && <AllocationTab view={view} reload={load} goTo={goTo} />}
        {tab === 'documents' && <DocumentsTab view={view} reload={load} />}
        {tab === 'activity' && <ActivityTab view={view} />}
      </div>

      <ReviewDialog
        view={view}
        findingKey={reviewKey}
        onClose={() => setReviewKey(null)}
        onDone={async () => {
          setReviewKey(null);
          toast('Review decision recorded.');
          await load();
        }}
      />
    </div>
  );
}

export function refToFocus(ref: any): Focus {
  if (ref.kind === 'sources_csv') return { tab: 'sources', row: ref.row, column: ref.column };
  if (ref.kind === 'plots_geojson') return { tab: 'plots', featureIndex: ref.featureIndex, plotRef: ref.plotRef };
  if (ref.kind === 'environment') return { tab: 'plots', plotRef: ref.plotRef };
  if (ref.kind === 'shipment_field') return { tab: 'details', field: ref.field };
  if (ref.kind === 'ledger') return { tab: 'allocation' };
  return null;
}

export function refText(ref: any): string {
  if (ref.kind === 'sources_csv') return ref.row ? `${ref.filename ?? 'source table'} · row ${ref.row}${ref.column ? ` · ${ref.column}` : ''}` : 'Upload a source table';
  if (ref.kind === 'plots_geojson') return ref.featureIndex !== undefined ? `${ref.filename ?? 'plot file'} · feature ${ref.featureIndex + 1}${ref.plotRef ? ` (${ref.plotRef})` : ''}` : 'Upload a plot file';
  if (ref.kind === 'environment') return `Land evidence for ${ref.plotRef}`;
  if (ref.kind === 'shipment_field') return `Field: ${ref.field}${ref.filename ? ` (from ${ref.filename})` : ''}`;
  return 'Allocation ledger';
}

function FindingsTab({ view, goTo, onReview, reload }: { view: View; goTo: (f: Focus) => void; onReview: (k: string) => void; reload: () => Promise<unknown> }) {
  const ev = view.evaluation;
  const order: Record<string, number> = { not_supported: 0, hold: 1, review: 2, warning: 3 };
  const findings = [...ev.findings].sort((a: any, b: any) => order[a.severity]! - order[b.severity]!);
  const decisions = view.decisions.filter((d: any) => d.active);
  const blank = !view.sources && !view.plots && Object.keys(view.fields).length === 0;
  return (
    <div className="split">
      <section aria-label="Findings">
        {blank ? (
          <div className="empty">
            <h2>Nothing uploaded yet</h2>
            <ol className="steps">
              <li>
                <div>
                  <button className="source-link" onClick={() => goTo({ tab: 'details' })}>
                    Enter or extract shipment details
                  </button>
                </div>
              </li>
              <li>
                <div>
                  <button className="source-link" onClick={() => goTo({ tab: 'sources' })}>
                    Upload the source-lot table (CSV)
                  </button>
                </div>
              </li>
              <li>
                <div>
                  <button className="source-link" onClick={() => goTo({ tab: 'plots' })}>
                    Upload plot boundaries (GeoJSON)
                  </button>
                </div>
              </li>
            </ol>
          </div>
        ) : findings.length === 0 ? (
          <div className="callout green">
            <p>No open findings for the current evidence snapshot. Review the plot evidence and sign off below; sign-off records exactly which evidence you reviewed.</p>
          </div>
        ) : (
          <div>
            {findings.map((f: any) => {
              const decision = decisions.find((d: any) => d.findingKey === f.key);
              return (
                <article key={f.key} className="finding" aria-labelledby={`f-${f.key}`}>
                  <h4 id={`f-${f.key}`}>
                    <SeverityBadge severity={f.severity} />
                    <span className="break">{f.title}</span>
                  </h4>
                  <div>
                    {f.resolvableByReview && (
                      <button className="btn small secondary" onClick={() => onReview(f.key)}>
                        {decision ? 'Update review' : 'Record investigation'}
                      </button>
                    )}
                  </div>
                  <p className="msg">{f.message}</p>
                  {(f.original !== undefined || f.normalized !== undefined) && (f.original || f.normalized) && (
                    <div className="compare">
                      <div>
                        <span>As received</span>
                        <code>{f.original || '(empty)'}</code>
                      </div>
                      <div>
                        <span>As interpreted</span>
                        <code>{f.normalized ?? 'not interpretable'}</code>
                      </div>
                    </div>
                  )}
                  {decision && (
                    <p className="action">
                      <strong>{decision.decision === 'investigated_not_blocking' ? 'Investigated — not blocking' : 'Kept on hold'}</strong> by {decision.reviewer}, {fmtDate(decision.at)}: “{decision.rationale}”
                    </p>
                  )}
                  {f.requestedAction && f.supplierActionable && <p className="action">Supplier request: {f.requestedAction}</p>}
                  <div className="refs">
                    {f.refs.map((ref: any, i: number) => {
                      const target = refToFocus(ref);
                      return target ? (
                        <button key={i} className="source-link" onClick={() => goTo(target)}>
                          {i === 0 ? 'Show source: ' : ''}
                          {refText(ref)}
                        </button>
                      ) : null;
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <aside className="stack" aria-label="Next actions">
        <div className="panel">
          <h2 style={{ fontSize: '1rem' }}>Why this status</h2>
          {view.evaluation.readiness.explanation.length ? (
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
              {view.evaluation.readiness.explanation.map((e: string) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="small" style={{ margin: 0 }}>All three dimensions are clear for the current evidence snapshot.</p>
          )}
        </div>
        <div className="panel stack">
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Supplier evidence request</h2>
          <p className="small" style={{ margin: 0 }}>
            {view.evaluation.findings.filter((f: any) => f.supplierActionable && f.severity !== 'warning').length} item(s) can be requested from the supplier, each with its source reference.
          </p>
          <div>
            <button className="btn small" onClick={() => goTo({ tab: 'documents' })}>
              Create evidence request
            </button>
          </div>
        </div>
        <SignOff view={view} reload={reload} />
      </aside>
    </div>
  );
}
