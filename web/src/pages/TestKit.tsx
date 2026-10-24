import { Link } from 'react-router';

/* Downloadable engineering-test inputs for independent reviewers. Every file is invented, labelled test data with
   ENG-KIT- identifiers; plot geometries are coordinate probe boxes, not farms. The outcomes listed below are checked
   by tests/integration/test-kit.test.ts on every run, so this page cannot drift from what the app does. */

const KIT = '/test-kit/';
type KitFile = { name: string; what: string };
const FILES: { scenario: string; title: string; files: KitFile[] }[] = [
  {
    scenario: 'A',
    title: 'Complete case, through sign-off',
    files: [
      { name: 'A1_ENGINEERING_TEST_sources.csv', what: 'Source-lot table: one lot, 1 000 kg declared, 600 kg allocated, two plots.' },
      { name: 'A2_ENGINEERING_TEST_plots.geojson', what: 'Two probe boxes: one with recorded post-2020 loss, one without.' },
      { name: 'A3_ENGINEERING_TEST_shipping_document.txt', what: 'Labelled shipping document for field extraction, with an embedded instruction that must be ignored. EORI and country are deliberately absent.' },
      { name: 'A4_ENGINEERING_TEST_investigation_evidence.txt', what: 'Evidence file to attach when recording an investigation.' },
    ],
  },
  {
    scenario: 'B',
    title: 'Holds and corrections',
    files: [
      { name: 'B1_ENGINEERING_TEST_sources_with_errors.csv', what: 'Comma decimal, allocation above the declared quantity, invalid country code, missing plot references.' },
      { name: 'B2_ENGINEERING_TEST_plots_with_errors.geojson', what: 'Self-intersecting polygon, swapped longitude/latitude, unclosed ring, point without an area; one declared plot is missing.' },
      { name: 'B3_ENGINEERING_TEST_broken.geojson', what: 'Truncated JSON that must be rejected.' },
    ],
  },
  {
    scenario: 'C',
    title: 'One source lot shared by two cases',
    files: [
      { name: 'C1_ENGINEERING_TEST_sources_case1.csv', what: 'Case 1 allocates 700 kg of a 1 000 kg lot.' },
      { name: 'C2_ENGINEERING_TEST_sources_case2.csv', what: 'Case 2 allocates 400 kg of the same lot.' },
      { name: 'C3_ENGINEERING_TEST_plots.geojson', what: 'One probe box used by both cases.' },
    ],
  },
];

export function TestKitPage() {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <p className="eyebrow">Engineering test kit</p>
          <h1>Audit LotHold with labelled test files</h1>
        </div>
      </header>

      <div className="callout amber" role="note">
        <p>
          <strong>Every file here is invented engineering test data.</strong> File names contain <span className="mono">ENGINEERING_TEST</span>, every supplier, lot and plot identifier starts with <span className="mono">ENG-KIT-</span>, and the plot shapes are coordinate probe boxes in Côte d’Ivoire, <strong>not farms</strong>. The forest readings LotHold computes for them are genuine dataset values for those coordinates and say nothing about any producer.
        </p>
      </div>

      <section className="section">
        <h2>Keep test data separate</h2>
        <ul className="small">
          <li>Register a separate workspace for testing, for example with the organisation name “ENGINEERING TEST — your name”. Workspaces are isolated from each other.</li>
          <li>Start each case reference with <span className="mono">ENG-KIT-</span> so it is recognisable in lists and exports.</li>
          <li>Nothing from this kit is loaded automatically. Files only enter a workspace when you upload and confirm them.</li>
          <li>Generated PDFs and XML from these cases are engineering drafts. Do not send them to anyone as real records.</li>
        </ul>
      </section>

      {FILES.map((g) => (
        <section className="section" key={g.scenario} aria-labelledby={`kit-${g.scenario}`}>
          <h2 id={`kit-${g.scenario}`}>
            Scenario {g.scenario}: {g.title}
          </h2>
          <ul className="kit-files">
            {g.files.map((f) => (
              <li key={f.name}>
                <a href={KIT + f.name} download className="mono">
                  {f.name}
                </a>
                <span className="small muted">{f.what}</span>
              </li>
            ))}
          </ul>
          {g.scenario === 'A' && (
            <ol className="kit-steps">
              <li>Create a case <span className="mono">ENG-KIT-A</span>. On <em>Shipment details</em>, upload A3 as a document and press <em>Propose fields</em>. Expect the label <em>Label parser (deterministic, not AI)</em> (unless your server has a model configured), activity IMPORT, HS code 1801, net mass 600 kg and the operator proposed; EORI and country of activity <em>not found</em>; nothing from the embedded “99999 / XX123” instruction. No field changes until you press <em>Accept selected fields</em>.</li>
              <li>Accept the proposals, then type the missing EORI and country yourself (test values, e.g. <span className="mono">BE0000000000</span> and <span className="mono">BE</span>).</li>
              <li>Upload and confirm A1 (<em>Source lots</em>) and A2 (<em>Plots &amp; land evidence</em>). Expect <span className="mono">ENG-KIT-A-P1</span> to show a <em>land-change signal</em> (loss recorded 2021–2025) and <span className="mono">ENG-KIT-A-P2</span> <em>no post-2020 loss observed</em>. The case shows <em>Needs human review</em>.</li>
              <li>On <em>Documents</em>, create the supplier evidence request PDF.</li>
              <li>On <em>Findings</em>, record an investigation for P1 with A4 attached. A rationale alone is refused.</li>
              <li>On <em>Allocation</em>, reserve the allocation (600 kg of 1 000 kg). The case becomes <em>Ready for sign-off</em>; sign it off, then create the DDS XML draft. Expect “XSD valid” and 2 producers. The XML is marked DRAFT — NOT SUBMITTED.</li>
              <li>Change any shipment field: the sign-off and documents become <em>out of date</em>.</li>
            </ol>
          )}
          {g.scenario === 'B' && (
            <ol className="kit-steps">
              <li>Create a case <span className="mono">ENG-KIT-B</span>. Upload B3 on <em>Plots</em>: it is rejected with “Not valid JSON”.</li>
              <li>Upload and confirm B1. Expect holds on row 2 (ambiguous separator in “1,000”), row 4 (country “XX”) and row 5 (no plot references), and an over-allocation of <span className="mono">ENG-KIT-LOT-B2</span> by 300 kg.</li>
              <li>Upload and confirm B2. Expect holds for P1 (self-intersection), P2 (possible longitude/latitude swap), P3 (ring not closed), P4 (point without an area) and P5 (declared in row 4 but missing from the file).</li>
              <li>Open P2 and preview the proposed axis swap. LotHold creates a corrected copy; the original stays unchanged until you confirm the copy. After confirming, P2 is analysed: <em>no post-2020 loss observed</em>.</li>
              <li>Each finding’s <em>Show source</em> link opens the exact row, column or plot.</li>
            </ol>
          )}
          {g.scenario === 'C' && (
            <ol className="kit-steps">
              <li>Create two cases, <span className="mono">ENG-KIT-C-1</span> and <span className="mono">ENG-KIT-C-2</span>. Upload and confirm C1 + C3 in the first and C2 + C3 in the second.</li>
              <li>Reserve allocations in case 1: 700 kg is reserved.</li>
              <li>Reserve in case 2: refused. Expect “Source lot ENG-KIT-LOT-C over-allocated by 100 kg” with the arithmetic 1 000 − 700 = 300 kg available, 400 kg requested.</li>
            </ol>
          )}
        </section>
      ))}

      <section className="section">
        <h2>What the kit cannot show</h2>
        <p className="small">
          It does not represent any real exporter’s records, and a clean result on a probe box is not evidence about any farm. Live model extraction depends on the server’s own AI configuration; without one, the labelled label parser is used. See <Link to="/method">Evidence &amp; methods</Link> for data sources and limits, and the repository’s <a href="https://github.com/TheWeirdDee/lothold/blob/main/docs/AUDIT_GUIDE.md">audit guide</a> for the same steps in text form.
        </p>
      </section>
    </div>
  );
}
