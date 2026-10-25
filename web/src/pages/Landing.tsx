import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { useAuth } from '../main.tsx';
import { Badge, ENV_STATUS, Logo, useReveal } from '../components/ui.tsx';
import { PixelMap } from '../components/PixelMap.tsx';

/* Every visual on this page is either an abstract illustration (labelled as such), a capture or recording of the
   running application with clearly labelled engineering-test records, or a live reading from a real dataset/testnet.
   No exporter, shipment, farm, quantity, review or finding is invented for presentation. */

function EvidenceTrace() {
  return (
    <figure className="trace enter d3" style={{ margin: 0 }}>
      <div className="trace-head">
        <span>HOW ONE HOLD IS TRACED</span>
        <span>ILLUSTRATION · NOT A SHIPMENT</span>
      </div>
      <div className="trace-scroll" tabIndex={0} role="region" aria-label="Evidence trace diagram, scrolls sideways on narrow screens">
      <svg viewBox="0 0 560 316" role="img" aria-labelledby="trace-title trace-desc">
        <title id="trace-title">How LotHold traces a hold</title>
        <desc id="trace-desc">A source-table row that references a plot is linked to the plot file, where that plot has no boundary, and to a satellite reading for another plot. Both feed numbered items in a supplier evidence request.</desc>
        {/* column 1: source table */}
        <text className="t-label" x="14" y="22">SOURCE TABLE · CSV</text>
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(14 ${36 + i * 34})`}>
            <rect width="148" height="26" rx="5" fill={i === 1 ? 'rgba(233,139,122,0.12)' : 'rgba(255,255,255,0.04)'} stroke={i === 1 ? 'rgba(233,139,122,0.55)' : 'rgba(255,255,255,0.10)'} />
            <text className="t-label" x="10" y="17">row {i + 2}</text>
            <rect x="52" y="10" width={i === 1 ? 54 : 70 - i * 6} height="6" rx="3" fill="rgba(255,255,255,0.16)" />
          </g>
        ))}
        <text className="t-label t-hold" x="14" y="190">plot_refs → no geometry</text>

        {/* column 2: plots */}
        <text className="t-label" x="214" y="22">PLOT FILE · GEOJSON</text>
        <g transform="translate(214 36)">
          <rect width="150" height="170" rx="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.10)" />
          {/* pixel grid */}
          {Array.from({ length: 7 }).map((_, r) =>
            Array.from({ length: 7 }).map((__, c) => (
              <rect key={`${r}-${c}`} x={14 + c * 18} y={14 + r * 18} width="17" height="17" fill={(r === 2 && c > 3) || (r === 3 && c === 5) ? 'rgba(231,176,106,0.55)' : (r + c) % 3 === 0 ? 'rgba(111,191,147,0.22)' : 'rgba(111,191,147,0.10)'} />
            )),
          )}
          <path className="draw" d="M24 30 L118 22 L136 78 L108 120 L30 112 Z" fill="none" stroke="#e9e6dd" strokeWidth="1.6" strokeLinejoin="round" />
          <circle className="pulse" cx="113" cy="56" r="5" fill="#e7b06a" />
          <rect x="14" y="140" width="122" height="20" rx="4" fill="none" stroke="rgba(233,139,122,0.7)" strokeDasharray="4 4" />
          <text className="t-label t-hold" x="22" y="154">2nd plot: boundary missing</text>
        </g>
        <text className="t-label t-review" x="214" y="226">loss after 2020 → review</text>

        {/* column 3: request */}
        <text className="t-label" x="410" y="22">SUPPLIER REQUEST · PDF</text>
        <g transform="translate(410 36)">
          <rect width="136" height="176" rx="8" fill="#edeae1" />
          <rect x="12" y="14" width="80" height="8" rx="3" fill="#141816" />
          <rect x="12" y="28" width="56" height="5" rx="2.5" fill="#9aa29b" />
          {[0, 1].map((i) => (
            <g key={i} transform={`translate(12 ${52 + i * 52})`}>
              <text x="0" y="9" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="#141816">{i + 1}.</text>
              <rect x="16" y="2" width="92" height="6" rx="3" fill="#333a35" />
              <rect x="16" y="14" width="100" height="5" rx="2.5" fill="#9aa29b" />
              <rect x="16" y="24" width="72" height="5" rx="2.5" fill="#9aa29b" />
              <rect x="16" y="34" width="58" height="4" rx="2" fill={i === 0 ? '#b24534' : '#b5701f'} opacity="0.7" />
            </g>
          ))}
          <rect x="12" y="156" width="112" height="1" fill="#bdb8a9" />
          <text x="12" y="168" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" fill="#5b635d">NOT A DETERMINATION</text>
        </g>

        {/* wires */}
        <path className="wire hold" d="M162 83 C 196 83, 196 196, 228 196" />
        <path className="wire hold" d="M350 196 C 388 196, 388 100, 422 100" />
        <path className="wire" d="M327 92 C 380 92, 372 152, 422 152" />

        {/* state */}
        <g transform="translate(14 250)">
          <rect width="532" height="52" rx="10" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.10)" />
          <rect x="12" y="15" width="58" height="22" rx="11" fill="rgba(233,139,122,0.16)" stroke="rgba(233,139,122,0.6)" />
          <text className="t-label t-hold" x="24" y="30">HOLD</text>
          <text className="t-strong" x="84" y="25">Records · Land evidence · Allocation</text>
          <text className="t-label" x="84" y="41">tracked separately; missing data never reads as clear</text>
        </g>
      </svg>
      </div>
      <figcaption className="trace-caption">Schematic only. It shows the kinds of links LotHold draws; it is not a real shipment, plot or finding.</figcaption>
    </figure>
  );
}

type DemoVideoState =
  | { status: 'coming_soon' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; kind: 'youtube' | 'vimeo'; provider: string; embedUrl: string; poster: string | null }
  | { status: 'ready'; kind: 'file'; src: string; type: string; poster: string | null; captions: string | null };

/** The poster drawn in CSS/SVG when no poster image is configured: sharp at any size, and not a screenshot. */
function DesignedPoster({ soon }: { soon: boolean }) {
  return (
    <div className="video-poster" aria-hidden="true">
      <div className="vp-mark">
        <Logo />
        <span>LotHold</span>
      </div>
      <p className="vp-title">Evidence review walkthrough</p>
      <p className="vp-sub">{soon ? 'Recording in progress' : 'Upload · findings · land evidence · supplier request · sign-off'}</p>
    </div>
  );
}

/** Landing demo video. Shows "coming soon" until a real recording is configured (docs/DEMO_VIDEO.md); embedded
 *  players load only after the visitor presses play, and nothing plays with sound on its own. */
function DemoVideo() {
  const [cfg, setCfg] = useState<DemoVideoState | null>(null);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    api<DemoVideoState>('GET', '/api/public/demo-video')
      .then(setCfg)
      // A failed request is reported as such, never disguised as "no video configured".
      .catch((e: Error) => setCfg({ status: 'unavailable', message: e.message }));
  }, []);
  useEffect(() => {
    if (playing) frameRef.current?.focus();
  }, [playing]);

  let stage: ReactNode;
  if (!cfg) stage = <div className="video-frame skeleton" aria-busy="true" aria-label="Loading the demo video" />;
  else if (cfg.status === 'unavailable')
    stage = (
      <div className="video-frame soon">
        <DesignedPoster soon={false} />
        <div className="video-soon-card" role="status">
          <h3>The demo video settings could not be loaded</h3>
          <p>{cfg.message} Whether a recording is configured is unknown from here.</p>
          <div className="row">
            <Link className="btn light small" to="/test-kit">
              Get the engineering test kit
            </Link>
          </div>
        </div>
      </div>
    );
  else if (cfg.status === 'coming_soon')
    stage = (
      <div className="video-frame soon">
        <DesignedPoster soon />
        <div className="video-soon-card">
          <h3>Demo video coming soon</h3>
          <p>A recorded walkthrough of the review desk will appear here. Until then you can try the desk yourself with your own files or the labelled engineering test kit.</p>
          <div className="row">
            <Link className="btn light small" to="/test-kit">
              Get the engineering test kit
            </Link>
            <Link className="btn ghost-dark small" to="/register">
              Open the desk
            </Link>
          </div>
        </div>
      </div>
    );
  else if (cfg.kind === 'file')
    stage = (
      <div className="video-frame">
        <video controls preload="none" playsInline poster={cfg.poster ?? undefined} aria-label="LotHold demo video" crossOrigin={cfg.captions ? 'anonymous' : undefined}>
          <source src={cfg.src} type={cfg.type} />
          {cfg.captions && <track kind="captions" src={cfg.captions} srcLang="en" label="English" default />}
          <p>
            Your browser cannot play this video. <a href={cfg.src}>Download the demo video</a>.
          </p>
        </video>
      </div>
    );
  else
    stage = playing ? (
      <div className="video-frame">
        <iframe
          ref={frameRef}
          src={cfg.embedUrl}
          title="LotHold demo video"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    ) : (
      <div className="video-frame">
        <button type="button" className="video-facade" onClick={() => setPlaying(true)} aria-describedby="demo-provider">
          {cfg.poster ? <img src={cfg.poster} alt="" width={1280} height={720} decoding="async" /> : <DesignedPoster soon={false} />}
          <span className="video-play-btn">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
            <span>Play demo video</span>
          </span>
        </button>
        <span id="demo-provider" className="video-provider">
          Loads {cfg.provider} when you press play
        </span>
      </div>
    );

  return (
    <section className="demo enter d4" aria-labelledby="demo-heading">
      <div className="demo-head">
        <h2 id="demo-heading">Product walkthrough</h2>
        <span className="eng-tag">Engineering test records</span>
      </div>
      {stage}
      <p className="demo-note">
        The walkthrough uses <strong>engineering test records</strong>: invented, labelled cases, suppliers and plots (references start with ENG-). The forest data it reads (Hansen GFC v1.13, JRC GFC2020 V4) is genuine, and any registry transactions shown are genuine Sepolia testnet transactions.
      </p>
    </section>
  );
}

/** A live reading from the real datasets for a fixed coordinate box. Not a farm; nothing is stored. */
function LiveReading() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; data?: any; error?: string }>({ status: 'idle' });
  const geometry = { type: 'Polygon', coordinates: [[[-7.5595, 6.2405], [-7.5505, 6.2405], [-7.5505, 6.2495], [-7.5595, 6.2495], [-7.5595, 6.2405]]] };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const run = () => {
      setState({ status: 'loading' });
      api('POST', '/api/public/forest-check', { geometry })
        .then((r) => setState({ status: r.analysis ? 'done' : 'error', data: r.analysis, error: r.analysis ? undefined : 'Geometry not analysed.' }))
        .catch((e) => setState({ status: 'error', error: (e as Error).message }));
    };
    if (!('IntersectionObserver' in window)) return run();
    const io = new IntersectionObserver((en) => {
      if (en.some((x) => x.isIntersecting)) {
        io.disconnect();
        run();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = state.data;
  const st = a ? ENV_STATUS[a.status] : null;
  return (
    <div className="live-reading" ref={ref}>
      <div className="v-label">
        <span>Live reading · lon −7.555, lat 6.245 · 1 km box</span>
        <span>Coordinates only — not a farm</span>
      </div>
      {state.status !== 'done' && state.status !== 'error' && <div className="skeleton" role="status">Reading published dataset pixels…</div>}
      {state.status === 'error' && (
        <div className="callout" role="status">
          <p className="small">The live reading is unavailable right now ({state.error}). No result is shown rather than a placeholder.</p>
        </div>
      )}
      {a && a.grid && <PixelMap grid={a.grid} geometry={geometry} label="Probe box" />}
      {a && st && (
        <div className="lr-status">
          <Badge cls={st.cls}>{st.label}</Badge>
          <span className="small muted">{a.summary}</span>
        </div>
      )}
      {a && !a.grid && a.status === 'UNAVAILABLE' && <p className="small muted">{a.summary}</p>}
    </div>
  );
}

function RegistryLedger() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api('GET', '/api/public/verify').then(setData).catch((e) => setErr((e as Error).message));
  }, []);
  // Routine authorisation transactions are omitted here for length; the registry page lists every step.
  const steps = (data?.engineering?.steps ?? []).filter((s: any) => (s.outcome || s.unchanged !== undefined || s.conserved !== undefined) && !/authorises/.test(s.step));
  const label = (s: any) =>
    s.step
      .replace('registrar-authorises-declarant', 'Registrar authorises a declarant')
      .replace('unauthorised-registration-attempt (actor A is not a declarant)', 'Unauthorised actor tries to register a batch')
      .replace('declarant-registers-test-batch (1,000,000 g)', 'Declarant registers a 1,000 kg test batch')
      .replace('declarant-authorises-actor-A', 'Declarant authorises reviewer A')
      .replace('declarant-authorises-actor-B', 'Declarant authorises reviewer B')
      .replace('actor-A-reserves-600000g', 'Reviewer A reserves 600 kg')
      .replace('actor-B-requests-600000g (preflight)', 'Reviewer B requests 600 kg')
      .replace('actor-B-submits-600000g-without-preflight (mined)', 'Reviewer B submits 600 kg anyway')
      .replace('state-after-rejection', 'Shared balance after rejection')
      .replace('actor-A-retries-same-allocation-id', 'Reviewer A retries the same allocation')
      .replace('concurrent-A-300000g', 'Simultaneous request A · 300 kg')
      .replace('concurrent-B-300000g', 'Simultaneous request B · 300 kg')
      .replace(/actor-B-reserves-exact-remainder-(\d+)g/, 'Reviewer B reserves the exact remainder')
      .replace('final-state', 'Final state');
  return (
    <div className="ledger">
      <div className="ledger-head">
        <span>ETHEREUM SEPOLIA · ENGINEERING RUN</span>
        <span>{data?.engineering ? `test quantities · ${String(data.engineering.runAt).slice(0, 10)} · key steps` : 'loading'}</span>
      </div>
      {err && <p style={{ padding: 16 }} className="small">Registry details unavailable: {err}</p>}
      {!data && !err && <p style={{ padding: 16 }} className="small">Reading the engineering record…</p>}
      {data && !data.engineering && <p style={{ padding: 16 }} className="small">No engineering verification record on this server.</p>}
      {steps.length > 0 && (
        <ol>
          {steps.map((s: any, i: number) => (
            <li key={i}>
              <span>
                {label(s)}
                {s.unchanged !== undefined && <span className="mono" style={{ display: 'block', fontSize: '0.72rem', color: 'var(--night-muted)' }}>reserved {s.reservedGramsBefore} g → {s.reservedGramsAfter} g ({s.unchanged ? 'unchanged' : 'changed'})</span>}
                {s.conserved !== undefined && <span className="mono" style={{ display: 'block', fontSize: '0.72rem', color: 'var(--night-muted)' }}>declared {s.declaredGrams} g = reserved {s.reservedGrams} g</span>}
                {s.explorer && (
                  <a href={s.explorer} style={{ display: 'block' }}>
                    {s.txHash.slice(0, 14)}… ↗
                  </a>
                )}
              </span>
              <span className={`l-state ${s.outcome === 'confirmed' ? 'l-ok' : s.outcome === 'reverted' ? 'l-rev' : s.outcome === 'preflight_rejected' ? 'l-pre' : ''}`}>
                {s.outcome === 'confirmed' ? 'CONFIRMED' : s.outcome === 'reverted' ? 'REVERTED ON-CHAIN' : s.outcome === 'preflight_rejected' ? 'REJECTED · NOT MINED' : 'READ'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Landing() {
  const { user } = useAuth();
  useReveal();
  const primary = user ? { to: '/app', label: 'Open your workspace' } : { to: '/register', label: 'Create a review case' };
  return (
    <>
      {/* ---------------- hero ---------------- */}
      <section className="band-dark hero">
        <div className="wrap">
          <p className="who enter">For cocoa exporters and EU importers who review shipment evidence</p>
          <h1 className="enter d1">
            Find missing evidence <span className="soft">before you prepare cocoa shipment paperwork.</span>
          </h1>
          <div className="hero-grid">
            <div>
              <p className="lede enter d2">
                Missing or conflicting supplier records stop you from checking where a shipment’s cocoa was grown. Upload your supplier spreadsheet and plot boundary file: LotHold shows what is missing or contradictory, flags published forest-change evidence for review, and prepares a clear correction request for your supplier.
              </p>
              <div className="btn-row enter d3">
                <Link className="btn light" to={primary.to}>
                  {primary.label} <span className="arrow" aria-hidden="true">→</span>
                </Link>
                <Link className="btn ghost-dark" to="/test-kit">
                  Try it with labelled test files
                </Link>
              </div>
              <p className="scope-line enter d3">
                <strong>Scope:</strong> cocoa beans (HS 1801) only · forest data covers Côte d’Ivoire and western Ghana · annual historical data, not live monitoring · a review aid: nothing is submitted to the EU.
              </p>
              <ul className="hero-receives enter d4" aria-label="What a reviewer receives">
                <li>The exact spreadsheet row or plot behind every issue</li>
                <li>A one-page correction request for your supplier</li>
                <li>A review draft and, after sign-off, an EU-format due-diligence draft that passes the official file-format check</li>
              </ul>
            </div>
            <EvidenceTrace />
          </div>
          <DemoVideo />
        </div>
      </section>

      {/* ---------------- three steps ---------------- */}
      <section className="band-light" aria-labelledby="steps-title">
        <div className="wrap">
          <div className="section-head reveal">
            <h2 id="steps-title">How it works</h2>
            <p>Your workspace starts empty. Everything in a case comes from files you upload.</p>
          </div>
          <ol className="workflow three reveal">
            <li>
              <span className="w-num">01</span>
              <h3>Upload your records</h3>
              <p>The supplier spreadsheet (which batches and plots supply the shipment, as CSV) and the plot boundary file (GeoJSON). Check the parsed preview before anything counts.</p>
            </li>
            <li>
              <span className="w-num">02</span>
              <h3>Review the issues</h3>
              <p>Each issue links to the row or plot that causes it. Plots with forest loss recorded after 2020 need your investigation and an evidence file.</p>
            </li>
            <li>
              <span className="w-num">03</span>
              <h3>Request corrections, then sign off</h3>
              <p>Download a one-page request for your supplier. When nothing is outstanding, sign off the exact version you reviewed and download the drafts.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* ---------------- feature narrative ---------------- */}
      <section className="band-white" id="how" aria-labelledby="how-title">
        <div className="wrap">
          <div className="section-head reveal">
            <h2 id="how-title">What you get back</h2>
            <p>From one supplier spreadsheet and one plot file, each result tied to the record that produced it.</p>
          </div>

          <article className="feature reveal">
            <div className="f-copy">
              <span className="f-num">01 · SOURCE FIELDS</span>
              <h3>Find the exact field that blocks the case</h3>
              <p>Every hold links back to its file, row and column, with the value as received next to its interpretation. Quantities are converted exactly, never rounded, and ambiguous entries such as “1,000” are refused rather than guessed.</p>
              <ul className="f-points">
                <li>Missing geometry, invalid boundaries, swapped coordinates</li>
                <li>Unknown countries, out-of-scope HS codes, impossible quantities</li>
              </ul>
            </div>
            <div className="f-visual">
              <div className="v-label">
                <span>Source table · preview</span>
                <span>Engineering example</span>
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>source_lot_ref</th>
                    <th>allocated</th>
                    <th>plot_refs</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>2</td>
                    <td>ENG-LOT-001</td>
                    <td>600 kg</td>
                    <td>ENG-PLOT-A; ENG-PLOT-B</td>
                  </tr>
                  <tr className="hit">
                    <td>3</td>
                    <td>ENG-LOT-002</td>
                    <td>0.4 t</td>
                    <td>ENG-PLOT-C</td>
                  </tr>
                </tbody>
              </table>
              <div className="mini-finding">
                <div className="row" style={{ gap: 8 }}>
                  <Badge cls="hold">Hold</Badge>
                  <strong style={{ fontSize: '0.9rem' }}>Plot ENG-PLOT-C has no geometry</strong>
                </div>
                <span className="muted small">Declared in row 3 · column plot_refs · not present in the plot file</span>
              </div>
            </div>
          </article>

          <article className="feature flip reveal">
            <div className="f-copy">
              <span className="f-num">02 · LAND EVIDENCE</span>
              <h3>Inspect dated land-change evidence and its limits</h3>
              <p>Each valid plot is read against the JRC 2020 forest map and Hansen annual tree-cover loss. A loss after 2020 opens an investigation, never a verdict. No data, partial coverage and “no loss observed” each stay visibly different.</p>
              <ul className="f-points">
                <li>Pixel-level analysis, cross-checked with GDAL; areas on the WGS 84 ellipsoid</li>
                <li>Signals clear only with a written rationale and an evidence file</li>
              </ul>
            </div>
            <div className="f-visual">
              <LiveReading />
            </div>
          </article>

          <article className="feature reveal">
            <div className="f-copy">
              <span className="f-num">03 · SUPPLIER REQUEST</span>
              <h3>Send a request the supplier can act on</h3>
              <p>LotHold drafts a one-page request: each missing or contradictory item, its source reference, the exact action needed, and citations for any land-change observation. Missing values stay marked as missing.</p>
            </div>
            <div className="f-visual">
              <div className="v-label">
                <span>Generated PDF · page 1 of 1</span>
                <span>Engineering example</span>
              </div>
              <img src="/demo/supplier-request.webp" alt="A generated supplier evidence request for an engineering-test case, listing three items with their source rows and the data citations." width={1000} height={760} loading="lazy" decoding="async" />
            </div>
          </article>

          <article className="feature flip reveal">
            <div className="f-copy">
              <span className="f-num">04 · SNAPSHOTS</span>
              <h3>Sign off a snapshot and see when it goes stale</h3>
              <p>Sign-off binds to a digest of the exact source files, plot geometry, analysis results, dataset versions, reservations and decisions. Change any of them and the sign-off, and every document built from it, is marked out of date.</p>
            </div>
            <div className="f-visual">
              <div className="v-label">
                <span>Review history · schematic</span>
                <span>Illustration</span>
              </div>
              <ol className="timeline">
                <li className="ok">
                  <span>
                    <span className="tl-title">Reviewer signs off snapshot</span>
                    <br />
                    <span className="tl-meta">digest of files · plots · analyses · ledger · decisions</span>
                  </span>
                </li>
                <li className="ok">
                  <span>
                    <span className="tl-title">DDS V3 XML draft exported</span>
                    <br />
                    <span className="tl-meta">validated against the official XSD set · marked DRAFT_NOT_SUBMITTED</span>
                  </span>
                </li>
                <li className="warn">
                  <span>
                    <span className="tl-title">A source file is replaced</span>
                    <br />
                    <span className="tl-meta">new digest · decisions bound to old results lapse</span>
                  </span>
                </li>
                <li className="warn">
                  <span>
                    <span className="tl-title">
                      Sign-off and documents marked <Badge cls="stale">Out of date</Badge>
                    </span>
                    <br />
                    <span className="tl-meta">XML export disabled until the new snapshot is signed off</span>
                  </span>
                </li>
              </ol>
            </div>
          </article>
        </div>
      </section>

      {/* ---------------- principle statement ---------------- */}
      <section className="band-light statement">
        <div className="wrap reveal">
          <blockquote>
            A loss signal is a reason to ask. <span className="soft">A clean result is not proof.</span>
          </blockquote>
          <p className="attrib">How LotHold reads satellite data</p>
        </div>
      </section>

      {/* ---------------- four kinds of evidence ---------------- */}
      <section className="band-light">
        <div className="wrap">
          <div className="section-head reveal">
            <h2>How LotHold keeps evidence honest</h2>
            <p>A satellite reading does not make a supplier’s declaration true, and a testnet receipt does not prove cocoa exists. LotHold keeps them apart and says what each cannot show.</p>
          </div>
          <div className="kinds reveal">
            <div>
              <span className="k-num">01 · DECLARED</span>
              <h3>Shipment information</h3>
              <p>Your source-lot table, plot file and shipping documents, stored encrypted with their hashes and row references.</p>
              <p className="cannot">Cannot show that the declaration is true.</p>
            </div>
            <div>
              <span className="k-num">02 · OBSERVED</span>
              <h3>Published environmental data</h3>
              <p>Annual tree-cover loss and 2020 forest cover read pixel by pixel inside each plot, with dates and coverage.</p>
              <p className="cannot">Cannot show legality. A loss signal is not a deforestation finding.</p>
            </div>
            <div>
              <span className="k-num">03 · DECIDED</span>
              <h3>Human review</h3>
              <p>A reviewer’s investigation, rationale and evidence file, bound to the exact snapshot they looked at.</p>
              <p className="cannot">Lapses automatically when any source, plot or quantity changes.</p>
            </div>
            <div>
              <span className="k-num">04 · COMMITTED</span>
              <h3>Allocation receipts</h3>
              <p>Ledger reservations, optionally anchored on a public testnet registry that rejects over-allocation.</p>
              <p className="cannot">Cannot show physical origin, or allocations made elsewhere.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- registry (dark rhythm break) ---------------- */}
      <section className="band-dark">
        <div className="wrap registry reveal">
          <div>
            <span className="f-num">05 · SHARED LIMITS</span>
            <h2>One declared batch, no matter who reserves from it</h2>
            <p>A small registry contract on a public testnet keeps every authorised reviewer inside the declared balance. Over-allocation is rejected before it is mined, and still rejected on-chain if someone forces it through.</p>
            <p>It cannot prove that cocoa exists, or see allocations recorded outside the registry. The ledger alongside is a real engineering run with test quantities.</p>
            <div className="btn-row" style={{ marginTop: 20 }}>
              <Link className="btn ghost-dark" to="/verify">
                Open the registry page
              </Link>
            </div>
          </div>
          <RegistryLedger />
        </div>
      </section>

      {/* ---------------- sources (instead of a logo strip) ---------------- */}
      <section className="band-dark sources-strip" aria-label="Sources and standards used">
        <div className="wrap">
          <p className="eyebrow">Built on published sources and standards</p>
          <ul>
            <li>Hansen Global Forest Change<span>v1.13 · annual loss 2001–2025</span></li>
            <li>JRC Global Forest Cover 2020<span>V4 · 10 m</span></li>
            <li>EUDR DDS V3 schema<span>EU Information System</span></li>
            <li>Regulation (EU) 2023/1115<span>as amended by 2025/2650</span></li>
            <li>Ethereum Sepolia<span>testnet</span></li>
          </ul>
        </div>
      </section>

      {/* ---------------- closing ---------------- */}
      <section className="band-light">
        <div className="wrap" style={{ paddingTop: 0 }}>
          <div className="closing reveal">
            <div>
              <h2>Start a review case with your own files.</h2>
              <p>Your workspace starts empty: no sample shipments. An optional, clearly labelled engineering test kit is available if you want to try it first.</p>
              <div className="btn-row" style={{ marginTop: 22 }}>
                <Link className="btn light" to={primary.to}>
                  {primary.label} <span className="arrow" aria-hidden="true">→</span>
                </Link>
                <a className="btn ghost-dark" href="/api/templates/sources.csv">
                  Download the spreadsheet template
                </a>
                <Link className="btn ghost-dark" to="/test-kit">
                  Engineering test kit
                </Link>
              </div>
            </div>
            <div className="stamp" aria-hidden="true">
              HOLD
              <small>UNTIL THE EVIDENCE HOLDS</small>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
