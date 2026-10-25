import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../main.tsx';
import { Walkthrough } from '../components/Walkthrough.tsx';
import { usePageMotion } from '../components/motion.ts';

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

const QUESTIONS = [
  ['Who is LotHold for?', 'Cocoa exporters and EU importers reviewing shipment evidence. It helps a reviewer find gaps and prepare follow-up requests before preparing a due-diligence draft.'],
  ['What files do I need?', 'A source-lot CSV listing suppliers, batches, quantities, countries and plot references, plus a GeoJSON file containing those plot boundaries. A shipping document is optional. Docs includes the blank template and field definitions.'],
  ['Does it certify EUDR compliance?', 'No. LotHold supports information gathering and human review. It cannot establish legality, land rights, physical origin or deforestation-free status, and never submits a statement to the EU.'],
  ['What does a forest-change signal mean?', 'Published data records annual tree-cover loss after 2020 in the sampled area. Fire, clearing, plantation rotation or a map error may contribute. Investigate the context and attach supporting evidence; the signal is not a legal determination.'],
  ['Can I use it outside the covered region?', 'You can review structured records, but installed environmental data covers one tile: longitude −10 to 0, latitude 0 to 10, including Côte d’Ivoire and western Ghana. Other plots report outside coverage and require independent evidence.'],
  ['Do I need a wallet?', 'No. Database allocations work without a wallet. Optional Ethereum Sepolia anchoring uses server-held pilot signers, is enabled per organisation, and cannot see allocations outside the registry.'],
  ['Where are my files and account stored?', 'The connected LotHold server stores accounts, password hashes, sessions and case records in SQLite. Evidence files are encrypted on its persistent disk. The public Vercel frontend currently has no connected backend; uploading and accounts require the local server until hosting is connected.'],
  ['Can I log in from another device?', 'Yes, when both devices reach the same persistent backend. Sign in with the same account to access your organisation’s records. Sessions are separate for each browser; records are not stored authoritatively in browser storage.'],
  ['What happens if AI is unavailable?', 'A deterministic label parser can propose fields from labelled text. The interface names the extraction method. You must check the quoted source and accept fields yourself; extraction never changes a review decision. Scanned PDFs need text extraction elsewhere first.'],
  ['What can I export?', 'A supplier evidence request PDF, an editable supplier email you copy into your own email client, and a human-readable review draft. After sign-off of the current evidence snapshot, you can export a DDS V3 XML draft validated against the official schema. It remains a draft and is never submitted by LotHold.'],
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return <section className="band-white" id="faq" aria-labelledby="faq-title"><div className="wrap faq-layout" data-reveal>
    <div><p className="eyebrow">Before you start</p><h2 id="faq-title">A few useful answers.</h2><p>Know what the evidence can show, and what still needs your judgement.</p><Link to="/docs">Read the user guide →</Link></div>
    <div className="faq-list">{QUESTIONS.map(([q, a], i) => <article key={q} className={`faq-item ${open === i ? 'expanded' : ''}`}>
      <h3><button id={`faq-q-${i}`} aria-expanded={open === i} aria-controls={`faq-a-${i}`} onClick={() => setOpen(open === i ? null : i)}><span>{q}</span><span className="faq-indicator" aria-hidden="true">+</span></button></h3>
      <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className="faq-answer" inert={open !== i}><div><p>{a}</p></div></div>
    </article>)}</div>
  </div></section>;
}

export function Landing() {
  const { user } = useAuth();
  const root = useRef<HTMLDivElement>(null);
  usePageMotion(root);
  const workspace = user ? '/app' : '/login';
  return <div ref={root} className="landing">
    <section className="band-dark hero"><div className="wrap">
      <p className="who" data-enter>For cocoa exporters and EU importers reviewing shipment evidence.</p>
      <div className="hero-grid"><div>
        <h1 data-enter>Find missing farm evidence <span className="soft">before shipment paperwork moves.</span></h1>
        <p className="lede" data-enter>Review supplier records and plot boundaries together. See what is missing, investigate published forest-change observations, and prepare a clear request for the evidence you still need.</p>
        <div className="btn-row" data-enter><Link className="btn light" to={workspace}>Open workspace <span aria-hidden="true">→</span></Link><a className="btn ghost-dark" href="#walkthrough">Watch the process</a></div>
        <p className="scope-line">Cocoa beans only · annual forest observations in one West African tile · human review required · nothing is submitted to the EU.</p>
      </div><div data-enter><EvidenceTrace /></div></div>
    </div></section>

    <section className="band-light" aria-labelledby="problem-title"><div className="wrap story-grid" data-reveal>
      <p className="eyebrow">01 / The problem</p><div><h2 id="problem-title">The evidence arrives in pieces.</h2><p className="story-lede">Supplier records arrive in separate spreadsheets and map files. A missing boundary, conflicting quantity, or unresolved land-change observation can be difficult to trace back to the exact record.</p><p>A reviewer needs the source behind the issue and a clear next step before preparing the paperwork.</p></div>
    </div></section>

    <section className="band-white" aria-labelledby="solution-title"><div className="wrap story-grid" data-reveal>
      <p className="eyebrow">02 / One connected review</p><div><h2 id="solution-title">See the gap. Follow the source. Ask for what’s missing.</h2><p className="story-lede">LotHold brings those checks into one review. Each finding points to its source and explains what to request next.</p><p>Keep record completeness, environmental evidence and declared inventory separate. A clean result in one does not erase a gap in another.</p></div>
    </div></section>

    <section className="band-dark"><div className="wrap" data-reveal><div className="section-head"><h2>Watch a case move through review.</h2><p>A recording of real interactions, from upload to a draft export and an out-of-date sign-off.</p></div><Walkthrough /></div></section>

    <section className="band-light" id="how" aria-labelledby="steps-title"><div className="wrap" data-reveal>
      <div className="section-head"><h2 id="steps-title">How it works</h2><p>Your workspace starts empty. Only the records you confirm become active evidence.</p></div>
      <ol className="workflow three">
        <li data-reveal><span className="w-num">01</span><h3>Bring the records together</h3><p>Upload the source-lot CSV and plot GeoJSON. Inspect the parsed preview and confirm the version you want to review.</p></li>
        <li data-reveal><span className="w-num">02</span><h3>Work through the findings</h3><p>Follow each issue to its row or plot. Check published land observations and attach evidence to your investigation.</p></li>
        <li data-reveal><span className="w-num">03</span><h3>Request evidence. Prepare a draft.</h3><p>Download a supplier request. Reserve allocations and sign off the current snapshot before exporting the XML draft.</p></li>
      </ol>
    </div></section>

    <section className="band-white" aria-labelledby="outputs-title"><div className="wrap" data-reveal>
      <div className="section-head"><h2 id="outputs-title">Useful outputs, with a trace back.</h2><p>Take the result into your existing review process.</p></div>
      <div className="output-grid"><figure className="output-capture"><img src="/demo/supplier-request.webp" alt="Supplier evidence request generated from labelled engineering records, listing outstanding actions and source references." width="1000" height="760" loading="lazy" /><figcaption>Generated supplier request · engineering example</figcaption></figure>
        <div className="output-list"><article><span className="eyebrow">Findings</span><h3>The exact record behind the issue</h3><p>File, row, column or plot references let you check the original value and request a specific correction.</p></article><article><span className="eyebrow">Documents</span><h3>A request you can share</h3><p>A supplier evidence request PDF, a review draft and, after sign-off, a schema-validated DDS XML draft.</p></article><article><span className="eyebrow">Review history</span><h3>A sign-off tied to its evidence</h3><p>When relevant evidence changes, earlier sign-offs and documents are marked out of date. Downloaded copies cannot be recalled.</p></article></div>
      </div>
    </div></section>

    <section className="band-light" aria-labelledby="evidence-title"><div className="wrap" data-reveal>
      <div className="section-head"><h2 id="evidence-title">Published observations. Visible limits.</h2><p>A loss signal is a reason to investigate. No observed loss is not proof of deforestation-free status.</p></div>
      <div className="source-notes"><article><span className="eyebrow">Annual loss</span><h3>Hansen Global Forest Change</h3><p>Annual tree-cover loss through 2025, sampled from pinned public raster data. It is historical evidence, not live monitoring.</p><a href="https://glad.earthengine.app/view/global-forest-change">Explore the primary source ↗</a></article><article><span className="eyebrow">2020 baseline</span><h3>JRC Global Forest Cover</h3><p>Forest presence circa 2020 provides context for the loss observations. A map cannot establish the legality of a land-use change.</p><a href="https://forobs.jrc.ec.europa.eu/GFC">Read the JRC source ↗</a></article></div>
      <div className="evidence-links"><Link to="/method">Evidence &amp; methods →</Link><Link to="/inspect">Inspect a coordinate area →</Link><Link to="/verify">Testnet allocation registry →</Link></div>
    </div></section>
    <FAQ />
    <section className="band-dark"><div className="wrap closing-plain" data-reveal><p className="eyebrow">Start with the evidence you have</p><h2>A clearer next step for every missing record.</h2><p>Your workspace starts empty: no sample shipments. Try your own files or the separate, clearly labelled engineering test kit.</p><div className="btn-row"><Link className="btn light" to={workspace}>Open workspace →</Link><Link className="btn ghost-dark" to="/test-kit">Get the engineering test kit</Link></div></div></section>
  </div>;
}
