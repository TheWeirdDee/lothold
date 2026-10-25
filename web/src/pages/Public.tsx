import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, fmtDate, isBackendUnavailable } from '../api.ts';
import { useAuth } from '../main.tsx';
import { Badge, ENV_STATUS, useAsync, TableWrap } from '../components/ui.tsx';
import { PixelMap } from '../components/PixelMap.tsx';
import engineering from '../../../docs/evidence/chain-engineering-sepolia.json' with { type: 'json' };

// ---------------- public forest evidence inspector ----------------
export function InspectPage() {
  const [mode, setMode] = useState<'box' | 'geojson'>('box');
  const [lon, setLon] = useState('');
  const [lat, setLat] = useState('');
  const [size, setSize] = useState('1000');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [geom, setGeom] = useState<any>(null);
  // Analysis runs on the LotHold server; say so up front when this site cannot reach it.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    api('GET', '/api/health').catch((e) => setOffline(isBackendUnavailable(e)));
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResult(null);
    let geometry: any;
    if (mode === 'box') {
      const x = Number(lon), y = Number(lat), m = Number(size);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90) return setErr('Enter a longitude (−180 to 180) and latitude (−90 to 90) in decimal degrees.');
      if (!(m >= 30 && m <= 5000)) return setErr('Box size must be between 30 and 5000 metres.');
      const dLat = m / 2 / 111_320, dLon = m / 2 / (111_320 * Math.cos((y * Math.PI) / 180));
      const r = (n: number) => Math.round(n * 1e6) / 1e6;
      geometry = { type: 'Polygon', coordinates: [[[r(x - dLon), r(y - dLat)], [r(x + dLon), r(y - dLat)], [r(x + dLon), r(y + dLat)], [r(x - dLon), r(y + dLat)], [r(x - dLon), r(y - dLat)]]] };
    } else {
      try {
        const j = JSON.parse(text);
        geometry = j.type === 'Feature' ? j.geometry : j.type === 'FeatureCollection' ? j.features?.[0]?.geometry : j;
      } catch {
        return setErr('That is not valid JSON. Paste a GeoJSON Polygon, Feature or FeatureCollection.');
      }
    }
    setProgress('Submitting analysis job.'); setBusy(true);
    try {
      let r = await api('POST', '/api/public/forest-check', { geometry }, { timeoutMs: 15000 });
      if (r.pollUrl) {
        const pollUrl = r.pollUrl; const deadline = Date.now() + 360_000;
        while (true) {
          setProgress(r.status === 'running' ? 'Processing raster pixels. No percentage estimate is available.' : 'Queued for raster processing.');
          await new Promise((resolve) => setTimeout(resolve, 1000));
          r = await api('GET', pollUrl, undefined, { timeoutMs: 15000 });
          if (r.status === 'complete') { r = r.result; break; }
          if (r.status === 'failed') throw new Error(r.error);
          if (Date.now() > deadline) throw new Error('Inspection is still unconfirmed. Retry explicitly; no result is implied.');
        }
      }
      setResult(r);
      setGeom(geometry);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const a = result?.analysis;
  const st = a ? ENV_STATUS[a.status] : null;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Public tool · nothing is stored</p>
          <h1>Inspect forest evidence for an area</h1>
        </div>
      </header>
      <p className="muted" style={{ maxWidth: '72ch', marginTop: -6 }}>
        This runs the same pixel-level analysis LotHold applies to shipment plots, on the locally installed Hansen GFC v1.13 and JRC GFC2020 V4 tile (longitude −10° to 0°, latitude 0° to 10°, which covers Côte d’Ivoire and western Ghana). Your geometry is not stored. <strong>An area you query is just coordinates. It is not a farm, and it tells you nothing about who produced what.</strong>
      </p>
      {busy && <p role="status" aria-live="polite">{progress}</p>}
      <div className="split">
        <form className="panel stack" onSubmit={run} aria-describedby="inspect-help">
          {offline && (
            <p className="callout amber small" role="status">
              Analysis needs the LotHold server, which is not available at this address. The method is described in <Link to="/method">Evidence &amp; methods</Link>; to run it, start LotHold locally (<Link to="/docs#local-setup">setup guide</Link>).
            </p>
          )}
          <div className="tabs" role="group" aria-label="Area input method" style={{ margin: 0 }}>
            <button type="button" aria-pressed={mode === 'box'} onClick={() => setMode('box')}>
              Coordinate box
            </button>
            <button type="button" aria-pressed={mode === 'geojson'} onClick={() => setMode('geojson')}>
              Paste GeoJSON
            </button>
          </div>
          {mode === 'box' ? (
            <div className="form-grid">
              <label className="field">
                Longitude (centre)
                <input type="text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="e.g. -6.6" required />
              </label>
              <label className="field">
                Latitude (centre)
                <input type="text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="e.g. 5.8" required />
              </label>
              <label className="field">
                Box size (metres)
                <input type="number" min={30} max={5000} value={size} onChange={(e) => setSize(e.target.value)} />
              </label>
            </div>
          ) : (
            <label className="field">
              GeoJSON (WGS 84 longitude, latitude)
              <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="mono" placeholder='{"type":"Polygon","coordinates":[[[lon,lat],…]]}' />
            </label>
          )}
          <p id="inspect-help" className="small muted" style={{ margin: 0 }}>
            Up to 5,000 ha. Coordinates are never swapped or repaired automatically.
          </p>
          <div className="btn-row">
            <button className="btn" disabled={busy || offline}>
              {busy ? 'Reading dataset pixels…' : 'Run analysis'}
            </button>
          </div>
          {err && (
            <div className="callout rust" role="alert">
              <p>{err}</p>
            </div>
          )}
        </form>
        <div className="stack" aria-live="polite">
          {!result && !busy && <div className="empty small muted">Results appear here: status, the pixels that were read, dates, coverage and dataset citations.</div>}
          {busy && <div className="empty small">Checking published tree-cover loss inside the area. No conclusion until the read finishes.</div>}
          {result && !a && (
            <div className="callout rust">
              <p>
                <strong>Geometry not analysed.</strong>
              </p>
              <ul className="small">
                {result.report.issues.map((i: any) => (
                  <li key={i.code}>{i.message}</li>
                ))}
              </ul>
            </div>
          )}
          {a && st && (
            <>
              <div className="panel">
                <div className="row">
                  <Badge cls={st.cls}>{st.label}</Badge>
                  <span className="small muted">{st.explain}</span>
                </div>
                <p style={{ marginTop: 10 }}>{a.summary}</p>
                <dl className="kv small">
                  <dt>Sampled</dt>
                  <dd>
                    {a.hansenPixels.total} pixels ({a.hansenPixels.land} land, {a.hansenPixels.water} water, {a.hansenPixels.noData} no data) · ≈{a.areaHa.sampled} ha
                  </dd>
                  <dt>Forest 2020 (JRC)</dt>
                  <dd>≈{a.areaHa.jrcForest2020} ha</dd>
                  <dt>Loss 2021–2025</dt>
                  <dd>
                    ≈{a.areaHa.postCutoffLoss} ha {a.firstPostCutoffLossYear ? `(years ${a.firstPostCutoffLossYear}–${a.latestPostCutoffLossYear})` : ''}
                  </dd>
                  <dt>Loss 2001–2020</dt>
                  <dd>≈{a.areaHa.preCutoffLoss} ha (context only)</dd>
                  <dt>Covered interval</dt>
                  <dd>{a.coveredInterval}</dd>
                  <dt>Analysed</dt>
                  <dd>
                    {fmtDate(a.analysedAt)} · method {a.methodVersion}
                  </dd>
                </dl>
              </div>
              {a.grid && <PixelMap grid={a.grid} geometry={geom} label="Queried area" />}
              <LossYears lossByYear={a.lossByYear} />
              <details className="panel">
                <summary>Limitations of this result</summary>
                <ul className="small">
                  {a.limitations.map((l: string) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function LossYears({ lossByYear }: { lossByYear: Record<string, { pixels: number; areaHa: number; onJrcForestAreaHa: number }> }) {
  const years = Object.keys(lossByYear).sort();
  if (!years.length) return <p className="small muted">No annual loss recorded in any year 2001–2025 for the sampled pixels.</p>;
  const post = years.filter((y) => Number(y) > 2020);
  const pre = years.filter((y) => Number(y) <= 2020);
  const preTotal = pre.reduce((s, y) => ({ pixels: s.pixels + lossByYear[y]!.pixels, areaHa: s.areaHa + lossByYear[y]!.areaHa }), { pixels: 0, areaHa: 0 });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <TableWrap>
        <table className="data">
          <caption className="sr-only">Hansen annual tree-cover loss after the cut-off</caption>
          <thead>
            <tr>
              <th>Loss year (after 31 Dec 2020)</th>
              <th className="num">Pixels</th>
              <th className="num">≈ ha</th>
              <th className="num">≈ ha on JRC 2020 forest</th>
            </tr>
          </thead>
          <tbody>
            {post.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  None recorded 2021–2025.
                </td>
              </tr>
            )}
            {post.map((y) => (
              <tr key={y}>
                <td>{y}</td>
                <td className="num">{lossByYear[y]!.pixels}</td>
                <td className="num">{lossByYear[y]!.areaHa.toFixed(2)}</td>
                <td className="num">{lossByYear[y]!.onJrcForestAreaHa.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {pre.length > 0 && (
        <details>
          <summary className="small">
            Before the cut-off (context only): {preTotal.pixels} pixels, ≈{preTotal.areaHa.toFixed(2)} ha across {pre.length} year{pre.length === 1 ? '' : 's'} in 2001–2020
          </summary>
          <TableWrap style={{ marginTop: 8 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Loss year</th>
                  <th className="num">Pixels</th>
                  <th className="num">≈ ha</th>
                </tr>
              </thead>
              <tbody>
                {pre.map((y) => (
                  <tr key={y}>
                    <td>{y}</td>
                    <td className="num">{lossByYear[y]!.pixels}</td>
                    <td className="num">{lossByYear[y]!.areaHa.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </details>
      )}
    </div>
  );
}

// ---------------- verify ----------------
export function VerifyPage() {
  const [key, setKey] = useState('');
  const [lookup, setLookup] = useState<any>(null);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const { data: live, error, loading } = useAsync(() => api('GET', '/api/public/verify', undefined, { timeoutMs: 8000 }), []);
  // Bundled public engineering evidence is historical, never a substitute for a live balance.
  const data = live ?? { network: engineering.network, chainId: engineering.chainId, registryAddress: engineering.contract.address, registryExplorer: `https://sepolia.etherscan.io/address/${engineering.contract.address}`, appAnchoredReservations: null, engineering, cannotVerify: ['physical origin or existence of cocoa', 'land rights or legality', 'allocations outside this registry or under a different batch key', 'the truth of private source records'] };
  const eng = data.engineering;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Ethereum Sepolia · test network</p>
          <h1>Testnet allocation registry</h1>
        </div>
      </header>
      <p className="muted" style={{ maxWidth: '75ch' }}>
        A small contract on the Ethereum Sepolia <strong>test network</strong>. A registered batch can never be reserved beyond its declared mass, and an allocation identifier can only be used once. It holds no tokens and moves no money. It records hashes and gram quantities only: no supplier names, farmer data or plot coordinates.
      </p>
      {loading && <p>Loading registry details…</p>}
      {error && <p className="callout" role="status">Live registry service unavailable. The public engineering record below is a historical snapshot, not a current balance. <Link to="/docs#troubleshooting">Connection help</Link>.</p>}
      {data && (
        <div className="registry-layout">
          <div className="registry-top">
            <div className="panel">
              <dl className="kv small">
                <dt>Network</dt>
                <dd>
                  {data.network} (chain ID {data.chainId})
                </dd>
                <dt>Contract</dt>
                <dd className="mono break">{data.registryAddress ? <a href={data.registryExplorer}>{data.registryAddress}</a> : 'Not configured'}</dd>
                <dt>Anchored from this app</dt>
                <dd>{live ? `${data.appAnchoredReservations} confirmed reservation(s)` : 'Live count unavailable'}</dd>
              </dl>
            </div>
            <form
              className="panel stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setLookErr(null);
                setLookup(null);
                try {
                  setLookup((await api('GET', `/api/public/verify?batchKey=${encodeURIComponent(key.trim())}`)).lookup);
                } catch (er) {
                  setLookErr((er as Error).message);
                }
              }}
            >
              <label className="field">
                Look up a batch key
                <span className="hint">The 32-byte batch key shown on an allocation receipt. Read directly from the contract.</span>
                <input type="text" className="mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="0x…" required />
              </label>
              <div>
                <button className="btn secondary" disabled={!live}>Read from contract</button>
              </div>
              {lookErr && <p role="alert" className="small">{lookErr}</p>}
              {lookup && (lookup.found ? (
                <dl className="kv small">
                  <dt>Declared</dt>
                  <dd>{Number(lookup.declaredGrams) / 1000} kg</dd>
                  <dt>Reserved</dt>
                  <dd>{Number(lookup.reservedGrams) / 1000} kg</dd>
                  <dt>Declarant</dt>
                  <dd className="mono break">{lookup.declarant}</dd>
                  <dt>Evidence hash</dt>
                  <dd className="mono break">{lookup.evidenceHash}</dd>
                  <dt>Registered</dt>
                  <dd>{fmtDate(lookup.registeredAt)}</dd>
                </dl>
              ) : lookup.found === false ? <p className="small">No batch is registered under that key.</p> : <p className="small" role="alert">{lookup.error}</p>)}
            </form>
            <div className="callout">
              <p className="small"><strong>The registry cannot verify:</strong></p>
              <ul className="small" style={{ margin: 0 }}>
                {data.cannotVerify.map((c: string) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
          <section className="stack" aria-labelledby="eng-run-title">
            <h2 id="eng-run-title">Engineering verification run</h2>
            {!eng ? (
              <p className="small muted">No engineering verification record is present on this server.</p>
            ) : (
              <>
                <div className="callout amber">
                  <p className="small">
                    <strong>Engineering test, not commercial activity.</strong> One declarant and two authorised test reservers exercised the shared balance on {fmtDate(eng.runAt)}. The quantities (1,000 kg declared; 600 kg then 600 kg requested) are test inputs and describe no real cocoa.
                  </p>
                </div>
                <TableWrap label="Engineering verification steps">
                  <table className="data stack-sm">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Outcome</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eng.steps.map((s: any, i: number) => (
                        <tr key={i}>
                          <td className="small" data-label="Step">{String(s.step).replace(/-/g, ' ')}</td>
                          <td className="small" data-label="Outcome">
                            {s.outcome === 'confirmed' && <Badge cls="ready">Confirmed{s.blockNumber ? ` · block ${s.blockNumber}` : ''}</Badge>}
                            {s.outcome === 'reverted' && <Badge cls="hold">Mined, reverted{s.blockNumber ? ` · block ${s.blockNumber}` : ''}</Badge>}
                            {s.outcome === 'preflight_rejected' && <Badge cls="review">Preflight rejected (not mined)</Badge>}
                            {!s.outcome && <span className="muted">state read</span>}
                          </td>
                          <td className="small break" data-label="Evidence">
                            {s.explorer ? <a href={s.explorer}>{s.txHash.slice(0, 12)}…</a> : null}
                            {s.revert ? <div>{s.revert.message}</div> : null}
                            {s.unchanged !== undefined ? <div>Reserved before {s.reservedGramsBefore} g, after {s.reservedGramsAfter} g: {s.unchanged ? 'unchanged' : 'CHANGED'}</div> : null}
                            {s.conserved !== undefined ? <div>Declared {s.declaredGrams} g, reserved {s.reservedGrams} g</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
