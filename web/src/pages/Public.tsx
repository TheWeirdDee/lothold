import { useState } from 'react';
import { Link } from 'react-router';
import { api, fmtDate } from '../api.ts';
import { useAuth } from '../main.tsx';
import { Badge, ENV_STATUS, useAsync } from '../components/ui.tsx';
import { PixelMap } from '../components/PixelMap.tsx';

export function Landing() {
  const { user } = useAuth();
  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>Hold a cocoa shipment until its plot evidence holds up.</h1>
          <p className="lede">
            LotHold is a review desk for people preparing EU deforestation due-diligence paperwork for cocoa. Upload the shipment’s source-lot table and plot boundaries. LotHold shows which plot or lot record is missing or contradictory, where published satellite data records tree-cover loss after 2020, and which source lots are allocated beyond their declared quantity. It then drafts the exact evidence request for the supplier.
          </p>
          <div className="btn-row" style={{ marginTop: 16 }}>
            {user ? (
              <Link className="btn" to="/app">
                Open your shipments
              </Link>
            ) : (
              <>
                <Link className="btn" to="/register">
                  Create a workspace
                </Link>
                <Link className="btn secondary" to="/login">
                  Sign in
                </Link>
              </>
            )}
            <Link className="btn secondary" to="/inspect">
              Inspect an area’s forest evidence
            </Link>
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            Workspaces start empty. LotHold ships no sample shipments, suppliers or farms: every case is built from records you upload.
          </p>
        </div>
        <div className="panel">
          <h2 style={{ fontSize: '1rem' }}>Why it matters for forests</h2>
          <p className="small">
            The EU Deforestation Regulation names cocoa among seven “commodities associated with deforestation” (European Commission, 13 July 2026). When a shipment’s plot list is incomplete, or a boundary is wrong, nobody can check what happened on that land. LotHold makes those gaps visible and turns them into specific requests before the paperwork moves on.
          </p>
          <p className="small" style={{ marginBottom: 0 }}>
            It does <strong>not</strong> decide whether a shipment is compliant or deforestation-free. A satellite loss signal is a reason to ask questions, and a clean result is not proof.
          </p>
        </div>
      </section>

      <section className="section">
        <figure style={{ margin: 0 }}>
          <img src="/review-desk.png" alt="The LotHold review desk showing a held shipment: a missing plot geometry, a self-intersecting boundary and a land-change signal, each linked to its source row or plot." width={1440} height={944} style={{ width: '100%', height: 'auto', border: '1px solid var(--line)', borderRadius: 4, background: '#fff' }} loading="lazy" />
          <figcaption className="small muted" style={{ marginTop: 6 }}>
            The review desk as it runs, showing <strong>engineering test fixtures</strong> (records prefixed ENG-). The plots are coordinate test boxes, not farms; the land-change result is a real dataset reading for those coordinates.
          </figcaption>
        </figure>
      </section>

      <section className="section">
        <div className="cols3">
          <div>
            <h3>1. Upload what you already have</h3>
            <p className="small">
              A CSV of source lots (supplier, lot, declared and allocated quantity, country, plot references) and a GeoJSON file of plot boundaries in WGS 84. Shipping documents (PDF or text) are optional; their fields can be proposed for you to confirm.
            </p>
            <a className="small" href="/api/templates/sources.csv">
              Download the blank source-table template
            </a>
          </div>
          <div>
            <h3>2. See exactly why a case is held</h3>
            <p className="small">
              Every hold points to the file, row, column or plot that causes it. Original values are shown next to their interpretation. Allocation, record completeness and land evidence are tracked separately, so a missing dataset never looks like approval.
            </p>
          </div>
          <div>
            <h3>3. Leave with paperwork you can use</h3>
            <p className="small">
              A one-page supplier evidence request (PDF), a human-readable review draft with provenance, and, once a reviewer signs off, an EUDR DDS V3 XML draft. The XML is validated against the official schema and marked not submitted.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>What is real here</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Input</th>
                <th>Status</th>
                <th>What it can and cannot show</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tree-cover loss, Hansen/UMD GFC v1.13</td>
                <td>Real public dataset, local pinned copy (SHA-256 verified)</td>
                <td>Annual loss years 2001–2025 at 30 m for lon −10…0, lat 0…10. These are not near-real-time alerts and not legal findings.</td>
              </tr>
              <tr>
                <td>Forest cover 2020, JRC GFC2020 V4</td>
                <td>Real public dataset, local pinned copy</td>
                <td>Forest or non-forest around the EUDR cut-off date. Single epoch; has map error.</td>
              </tr>
              <tr>
                <td>EUDR DDS V3 schema</td>
                <td>Official XSD set from the EU Information System WSDL</td>
                <td>Structural validity only. EU business rules apply on an authorised submission, which LotHold never performs.</td>
              </tr>
              <tr>
                <td>Shipments, suppliers, plots, quantities</td>
                <td>Only what you upload</td>
                <td>LotHold contains no commercial records of its own.</td>
              </tr>
              <tr>
                <td>Allocation registry (Ethereum Sepolia testnet)</td>
                <td>Real testnet contract</td>
                <td>Prevents over-reserving a registered batch within the registry. It does not prove that any cocoa exists.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------- public forest evidence inspector ----------------
export function InspectPage() {
  const [mode, setMode] = useState<'box' | 'geojson'>('box');
  const [lon, setLon] = useState('');
  const [lat, setLat] = useState('');
  const [size, setSize] = useState('1000');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [geom, setGeom] = useState<any>(null);

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
    setBusy(true);
    try {
      const r = await api('POST', '/api/public/forest-check', { geometry });
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
      <h1>Inspect forest evidence for an area</h1>
      <p className="muted" style={{ maxWidth: '70ch' }}>
        This runs the same pixel-level analysis LotHold applies to shipment plots, on the locally installed Hansen GFC v1.13 and JRC GFC2020 V4 tile (longitude −10° to 0°, latitude 0° to 10°, which covers Côte d’Ivoire and western Ghana). Your geometry is not stored. <strong>An area you query is just coordinates. It is not a farm, and it tells you nothing about who produced what.</strong>
      </p>
      <div className="split">
        <form className="panel stack" onSubmit={run} aria-describedby="inspect-help">
          <div className="tabs" role="tablist" style={{ margin: 0 }}>
            <button type="button" role="tab" aria-selected={mode === 'box'} onClick={() => setMode('box')}>
              Coordinate box
            </button>
            <button type="button" role="tab" aria-selected={mode === 'geojson'} onClick={() => setMode('geojson')}>
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
            <button className="btn" disabled={busy}>
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
      <div className="table-wrap">
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
      </div>
      {pre.length > 0 && (
        <details>
          <summary className="small">
            Before the cut-off (context only): {preTotal.pixels} pixels, ≈{preTotal.areaHa.toFixed(2)} ha across {pre.length} year{pre.length === 1 ? '' : 's'} in 2001–2020
          </summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
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
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------- method ----------------
export function MethodPage() {
  const { data, error, loading } = useAsync(() => api('GET', '/api/public/method'), []);
  return (
    <div className="page narrow">
      <h1>Method, sources and limits</h1>
      <p>
        LotHold separates four kinds of information and never lets one stand in for another: <strong>declared business records</strong> (what a supplier or exporter states), <strong>environmental observations</strong> (published satellite-derived datasets), <strong>human review decisions</strong> (with rationale and evidence), and <strong>allocation commitments</strong> (database ledger, optionally anchored on a public testnet).
      </p>
      <section className="section">
        <h2>Environmental datasets</h2>
        {loading && <p>Loading dataset register…</p>}
        {error && <p role="alert">Could not load the dataset register: {error.message}</p>}
        {data?.datasets.map((d: any) => (
          <div key={d.id} className="panel" style={{ marginBottom: 12 }}>
            <h3>{d.title}</h3>
            <dl className="kv small">
              <dt>Version</dt>
              <dd>{d.version}</dd>
              <dt>Resolution</dt>
              <dd>{d.resolutionLabel}</dd>
              <dt>Temporal coverage</dt>
              <dd>{d.temporalCoverage}</dd>
              <dt>Meaning of values</dt>
              <dd>{d.dateSemantics}</dd>
              <dt>Licence</dt>
              <dd>{d.license}</dd>
              <dt>Citation</dt>
              <dd>{d.citation}</dd>
              <dt>Source file</dt>
              <dd className="break">
                <a href={d.sourceUrl}>{d.sourceUrl}</a>
              </dd>
              <dt>Pinned SHA-256</dt>
              <dd className="mono break">{d.sha256}</dd>
              <dt>On this server</dt>
              <dd>{d.availability?.present && d.availability?.sizeMatches ? (d.availability.sha256 === d.sha256 ? 'Present and hash-verified at startup' : 'Present; hash verification pending or failed') : 'Missing; analysis reports “unavailable”'}</dd>
            </dl>
          </div>
        ))}
      </section>
      <section className="section">
        <h2>How a plot is analysed</h2>
        <ol className="small">
          <li>The plot geometry is validated (WGS 84 longitude/latitude, closed rings, no self-intersection, no holes, points need an area of 4 ha or less). Invalid geometry is never analysed or repaired automatically.</li>
          <li>Every 30 m Hansen pixel whose centre lies inside the polygon is sampled. A point plot, or a polygon smaller than one pixel, samples only the pixel that contains it; the result says so.</li>
          <li>For each pixel: the Hansen data mask (land, water, no data), the Hansen loss year, and the nine 10 m JRC 2020 pixels nested exactly inside it are read.</li>
          <li>Loss in 2021–2025 sets <em>Land-change signal</em>. No loss on fully covered land sets <em>No post-2020 loss observed</em>. Missing data or out-of-tile areas give <em>Partial coverage</em> or <em>Outside coverage</em>, never a clear result.</li>
          <li>A reviewer can only set a signal aside with a written rationale (at least 40 characters) <em>and</em> an attached evidence file. A new analysis result invalidates earlier decisions.</li>
        </ol>
        <p className="small muted">Area figures are pixel-count approximations on a spherical authalic earth model. They are not statistically valid area estimates.</p>
      </section>
      <section className="section">
        <h2>Regulatory context checked for this build</h2>
        <ul className="small">
          <li>European Commission, 13 July 2026: the EUDR applies from 30 December 2026 for large and medium operators and from 30 June 2027 for other micro and small operators. Retrieved 23 October 2026.</li>
          <li>The cut-off date is 31 December 2020. Polygons are required for plots over 4 ha (except cattle). Source: EUDR Information System DDS V3 API reference and GeoJSON file description (updated 17 August 2026).</li>
          <li>Scope here is cocoa beans, HS 1801, only. LotHold does not determine scope, risk classification or compliance.</li>
        </ul>
      </section>
      <section className="section">
        <h2>Rules and versions</h2>
        <p className="small">
          Rules {data?.rulesVersion ?? '…'} · analysis method {data?.analysisMethod ?? '…'}. Every generated document records the evidence snapshot digest it was built from. When any source, geometry, quantity, allocation, dataset result or review decision changes, earlier sign-offs and documents are marked out of date. Copies already downloaded cannot be recalled.
        </p>
      </section>
    </div>
  );
}

// ---------------- verify ----------------
export function VerifyPage() {
  const [key, setKey] = useState('');
  const [lookup, setLookup] = useState<any>(null);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const { data, error, loading } = useAsync(() => api('GET', '/api/public/verify'), []);
  const eng = data?.engineering;
  return (
    <div className="page">
      <h1>Testnet allocation registry</h1>
      <p className="muted" style={{ maxWidth: '75ch' }}>
        A small contract on the Ethereum Sepolia <strong>test network</strong>. A registered batch can never be reserved beyond its declared mass, and an allocation identifier can only be used once. It holds no tokens and moves no money. It records hashes and gram quantities only: no supplier names, farmer data or plot coordinates.
      </p>
      {loading && <p>Loading registry details…</p>}
      {error && <p role="alert">Could not load registry details: {error.message}</p>}
      {data && (
        <div className="split">
          <div className="stack">
            <div className="panel">
              <dl className="kv small">
                <dt>Network</dt>
                <dd>
                  {data.network} (chain ID {data.chainId})
                </dd>
                <dt>Contract</dt>
                <dd className="mono break">{data.registryAddress ? <a href={data.registryExplorer}>{data.registryAddress}</a> : 'Not configured'}</dd>
                <dt>Anchored from this app</dt>
                <dd>{data.appAnchoredReservations} confirmed reservation(s)</dd>
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
                <button className="btn secondary">Read from contract</button>
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
          <div className="stack">
            <h2>Engineering verification run</h2>
            {!eng ? (
              <p className="small muted">No engineering verification record is present on this server.</p>
            ) : (
              <>
                <div className="callout amber">
                  <p className="small">
                    <strong>Engineering test, not commercial activity.</strong> One declarant and two authorised test reservers exercised the shared balance on {fmtDate(eng.runAt)}. The quantities (1,000 kg declared; 600 kg then 600 kg requested) are test inputs and describe no real cocoa.
                  </p>
                </div>
                <div className="table-wrap">
                  <table className="data">
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
                          <td className="small">{s.step}</td>
                          <td className="small nowrap">
                            {s.outcome === 'confirmed' && <Badge cls="ready">Confirmed{s.blockNumber ? ` · block ${s.blockNumber}` : ''}</Badge>}
                            {s.outcome === 'reverted' && <Badge cls="hold">Mined, reverted{s.blockNumber ? ` · block ${s.blockNumber}` : ''}</Badge>}
                            {s.outcome === 'preflight_rejected' && <Badge cls="review">Preflight rejected (not mined)</Badge>}
                            {!s.outcome && <span className="muted">state read</span>}
                          </td>
                          <td className="small break">
                            {s.explorer ? <a href={s.explorer}>{s.txHash.slice(0, 12)}…</a> : null}
                            {s.revert ? <div>{s.revert.message}</div> : null}
                            {s.unchanged !== undefined ? <div>Reserved before {s.reservedGramsBefore} g, after {s.reservedGramsAfter} g: {s.unchanged ? 'unchanged' : 'CHANGED'}</div> : null}
                            {s.conserved !== undefined ? <div>Declared {s.declaredGrams} g, reserved {s.reservedGrams} g</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
