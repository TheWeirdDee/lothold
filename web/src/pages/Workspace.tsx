import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, fmtDate } from '../api.ts';
import { useAuth } from '../main.tsx';
import { Badge, OVERALL, useAsync, useToast, TableWrap } from '../components/ui.tsx';

export function Workspace() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [pageSize, setPageSize] = useState(50);
  const { data, error, loading, reload } = useAsync(() => api<{ shipments: any[]; total: number }>('GET', `/api/shipments?limit=${pageSize}`), [pageSize]);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ id: string }>('POST', '/api/shipments', { reference: ref });
      toast('Shipment case created.');
      nav(`/app/shipments/${r.id}`);
    } catch (er) {
      setErr((er as Error).message);
      void reload();
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.shipments ?? [];
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{user?.organisation}</p>
          <h1>Shipments</h1>
          <p className="sub">Each case holds one shipment’s records, plot evidence, findings and review history.</p>
        </div>
        <form className="row" onSubmit={create} style={{ alignItems: 'flex-end', gap: 10 }}>
          <label className="field" style={{ flex: '1 1 260px', minWidth: 0 }}>
            New case: your internal shipment reference
            <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. your lot or booking number" required maxLength={50} />
          </label>
          <button className="btn" disabled={busy}>
            {busy ? 'Creating…' : 'Create case'}
          </button>
        </form>
      </header>
      {err && <p role="alert" className="callout rust small">{err}</p>}
      {loading && !data && <div className="skeleton" role="status" style={{ minHeight: 160 }}>Loading shipments…</div>}
      {error && (
        <p role="alert" className="callout rust small">
          Could not load shipments: {error.message} <button className="btn small secondary" onClick={() => reload()}>Retry</button>
        </p>
      )}
      {data && rows.length === 0 && (
        <div className="empty" style={{ display: 'grid', gap: 24 }}>
          <div>
            <h2 style={{ fontSize: 'var(--fs-h2)', letterSpacing: '-0.03em' }}>No shipments yet</h2>
            <p className="muted" style={{ maxWidth: '62ch', margin: 0 }}>
              LotHold includes no sample shipments. A case is built only from records you upload. Uploaded files are encrypted at rest and visible only to your organisation.
            </p>
          </div>
          <div className="split even">
            <div>
              <p className="eyebrow" style={{ marginBottom: 10 }}>What you need</p>
              <ol className="steps">
                <li>
                  <div>
                    <strong>Source-lot table (CSV).</strong> Supplier, source lot, declared and allocated quantity, producer country, plot references.{' '}
                    <a href="/api/templates/sources.csv">Blank template</a> · <Link to="/method">field definitions</Link>
                  </div>
                </li>
                <li>
                  <div>
                    <strong>Plot boundaries (GeoJSON).</strong> WGS 84 longitude/latitude, one Feature per plot with a <code>plot_ref</code> property.
                  </div>
                </li>
                <li>
                  <div>
                    <strong>Shipment details.</strong> Activity, HS code 1801, description, net mass, operator. Type them, or have them proposed from a shipping document and confirm each one.
                  </div>
                </li>
              </ol>
            </div>
            <div>
              <p className="eyebrow" style={{ marginBottom: 10 }}>What happens next</p>
              <ol className="steps">
                <li><div>You preview every parsed row and feature before it counts.</div></li>
                <li><div>Each hold links to the exact file, row or plot that causes it.</div></li>
                <li><div>Valid plots are checked against published forest data; signals need investigation with evidence.</div></li>
                <li><div>You send the supplier a one-page request, then sign off the snapshot.</div></li>
              </ol>
            </div>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <>
        <TableWrap stack label="Shipment cases">
          <table className="data">
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Goods</th>
                <th>Producer country</th>
                <th>Plots valid / declared</th>
                <th>Evidence status</th>
                <th>Main reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const o = s.approval === 'current' ? OVERALL.REVIEWED_DRAFT! : OVERALL[s.overall]!;
                return (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/app/shipments/${s.id}`} className="mono break">
                        {s.reference}
                      </Link>
                      <span className="small muted" style={{ display: 'block' }}>{fmtDate(s.createdAt)}</span>
                    </td>
                    <td className="break">{s.goods ?? <span className="muted">not entered</span>}{s.hsCode ? <span className="small muted"> · HS {s.hsCode}</span> : null}</td>
                    <td>{s.producerCountries.length ? s.producerCountries.join(', ') : <span className="muted">—</span>}</td>
                    <td className="num">
                      {s.plots.valid} / {s.plots.declared}
                    </td>
                    <td>
                      <Badge cls={o.cls}>{o.label}</Badge>
                      {s.approval === 'stale' && <Badge cls="stale">Sign-off out of date</Badge>}
                    </td>
                    <td className="small break">{s.topReason ?? <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        {data && data.total > rows.length && (
          <p className="small muted" style={{ marginTop: 10 }}>
            Showing the newest {rows.length} of {data.total} cases.{' '}
            <button className="linkbtn" onClick={() => setPageSize((n) => Math.min(n + 50, 200))} disabled={pageSize >= 200}>
              Show more
            </button>
          </p>
        )}
        </>
      )}
    </div>
  );
}
