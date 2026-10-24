import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, fmtDate } from '../api.ts';
import { useAuth } from '../main.tsx';
import { Badge, OVERALL, useAsync, useToast } from '../components/ui.tsx';

export function Workspace() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api<{ shipments: any[] }>('GET', '/api/shipments'), []);
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
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h1 style={{ margin: 0 }}>Shipments</h1>
        <span className="muted small">{user?.organisation}</span>
      </div>
      <form className="row" onSubmit={create} style={{ margin: '16px 0 20px', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 240px', maxWidth: 360 }}>
          New case: your internal shipment reference
          <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. your lot or booking number" required maxLength={50} />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create case'}
        </button>
      </form>
      {err && <p role="alert" className="callout rust small">{err}</p>}
      {loading && !data && <p>Loading shipments…</p>}
      {error && (
        <p role="alert" className="callout rust small">
          Could not load shipments: {error.message} <button className="btn small secondary" onClick={() => reload()}>Retry</button>
        </p>
      )}
      {data && rows.length === 0 && (
        <div className="empty">
          <h2>No shipments yet</h2>
          <p>LotHold includes no sample shipments. To review one of yours:</p>
          <ol className="steps" style={{ maxWidth: 680 }}>
            <li>
              <div>
                Create a case above using your internal shipment reference.
              </div>
            </li>
            <li>
              <div>
                Enter the shipment details (activity, HS code 1801, description, net mass, operator). You can type them, or have them proposed from a shipping document and confirm each one.
              </div>
            </li>
            <li>
              <div>
                Upload the source-lot table (CSV). <a href="/api/templates/sources.csv">Blank template</a> · <Link to="/method">field definitions</Link>
              </div>
            </li>
            <li>
              <div>Upload plot boundaries as GeoJSON (WGS 84 longitude/latitude, one Feature per plot with a <code>plot_ref</code> property).</div>
            </li>
          </ol>
          <p className="small muted" style={{ marginTop: 14, marginBottom: 0 }}>
            Uploaded files are encrypted at rest and visible only to your organisation.
          </p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
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
        </div>
      )}
    </div>
  );
}
