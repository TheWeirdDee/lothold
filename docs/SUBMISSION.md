# Submission materials (IEEE ClimateChain Global Hackathon 2026)

**Status on 25 October 2026.** Nothing has been submitted. The repository is public. A frontend-only copy of the site is published at https://lothold.vercel.app; it does **not** run the LotHold server (API, database, forest datasets), so sign-in, uploads and analysis do not work there. The site now says so on every page. The full application runs locally (README → Run it locally) or in the verified container (DEPLOYMENT.md). These are prepared materials for the entrant to review.

## Rules check (retrieved 23 October 2026)

- **Deadline** shown on Devpost: *25 October 2026, 5:00 pm +03* (= 14:00 UTC = 15:00 Lagos).
- **Eligibility contradiction persists.** The overview sidebar says *"Students only"* and *"Companies/professional organizations excluded from participation"*. The detailed rules list *Students, Academic researchers and faculty, Independent developers and startups, Environmental professionals and climate scientists, International participants (with country restrictions noted)*. **Eligibility status: unresolved.**
  - The entrant told the build agent on 24 Oct 2026 that they are a student. Nothing else about their status has been checked, and no organiser has confirmed eligibility.
  - The overview and the detailed rules contradict each other. Which one governs has not been confirmed.
  - The detailed rules mention country restrictions without listing them in the retrieved text. The entrant's country has not been checked against them.
  - To resolve: ask the organisers (Devpost Discussion tab or the contact in the rules) to confirm both points before submitting.
- **Schedule oddity:** the overview shows *"October 25 at 10:00am EDT to deadline"*. 10:00 EDT is the same instant as the 17:00 +03 deadline. The organiser update of 5 October says submissions opened on 5 October. Submit well before the deadline.
- **Required:** track alignment, a 3–5 minute demo video, and a public code repository link. Individuals or teams of 2–5 may enter; a person may be on only one team.
- **Judging criteria:** Climate Impact; Innovation & Creativity; Technical Execution; Practical Usefulness; Presentation & Storytelling.

## Mapping to judging criteria

| Criterion | What LotHold actually does (verified) |
|---|---|
| Climate impact | Targets a concrete bottleneck in forest-risk supply chains: cocoa shipments whose plot evidence is incomplete or contradictory cannot be checked for post-2020 forest conversion. Links declared plots to real published forest data (JRC 2020 forest baseline, Hansen annual loss to 2025) and turns gaps into specific supplier requests. It does **not** claim measured avoided deforestation or emissions. |
| Innovation | Separates declared records, satellite observations, human decisions and shared allocation commitments, and never lets one stand in for another. An evidence snapshot digest invalidates sign-offs and documents when any input changes. A testnet registry enforces source-lot conservation across actors. |
| Technical execution | Pixel-level raster intersection on hash-pinned data; official DDS V3 XSD validation including imports; deterministic fixed-point rules; durable jobs; encrypted evidence; organisation isolation; contract with fuzzed conservation. 123 unit/integration + 18 contract + 23 browser tests (25 Oct 2026) plus an independent GDAL/pyproj cross-check; public-testnet transactions. |
| Practical usefulness | Works from files a compliance desk already has (CSV, GeoJSON, PDF). Output is a one-page supplier request and a review draft usable in an existing workflow. Honest empty state: no fake data. |
| Presentation | Restrained review-desk interface; every hold links to its source row or plot; mobile-usable; documents rendered and checked. |

## Short description (Devpost "What it does"; only verified behaviour)

LotHold is a review desk for cocoa shipments heading into EU deforestation due diligence. A reviewer uploads the shipment's source-lot table (CSV) and plot boundaries (GeoJSON). LotHold:

- validates every row and plot against deterministic rules and the EU Information System's GeoJSON requirements;
- intersects each valid plot, pixel by pixel, with published forest data (JRC forest cover 2020; Hansen annual tree-cover loss to 2025);
- checks that no source lot is allocated beyond its declared quantity.

Every hold links to the exact file, row or plot. A land-change signal after 2020 cannot be cleared without a written investigation and an attached evidence file. LotHold produces a one-page supplier evidence request and a review draft. After reviewer sign-off, it produces a DDS V3 XML draft that passes the official EU XML schema and is never submitted. Allocations can be anchored on an Ethereum Sepolia testnet registry that rejects over-reservation by any authorised actor.

## Inspiration

Cocoa is one of seven commodities the EU names as associated with deforestation, and from 30 December 2026 large and medium operators must file due-diligence statements with plot-level geolocation. In practice, a shipment can arrive at a compliance desk with a missing plot, a boundary with swapped coordinates, or a source lot that two shipments have each claimed in full. Those gaps make forest-conversion checks impossible. We wanted a tool that stops the wrong paperwork, says exactly why, and asks the supplier for exactly what is missing.

## How we built it

- TypeScript throughout: Node 24 (Hono, built-in SQLite), React 19 + Vite.
- Pinned GeoTIFF snapshots (Hansen GFC v1.13 and JRC GFC2020 V4, SHA-256 verified), read with geotiff.js; JRC 10 m pixels nest exactly in Hansen 30 m pixels, so no resampling.
- Official DDS V3 XSDs fetched from the EU WSDL and validated with libxml2 (WebAssembly).
- pdfkit for the one-page request.
- Solidity contract (Foundry) on Sepolia via viem, server-side keys only.
- Field extraction: a deterministic label parser, plus provider adapters (Anthropic, OpenAI-compatible) whose output must quote the document. A Gemini key is configured, but **live model extraction is unverified**: the provider returned 503 and then 429 (free-tier daily quota exhausted). The labelled label parser was verified.

## Challenges (real, from this build)

- The official sample XML's base64 placeholder passes schema validation, so we added an independent base64 round-trip check before any XML download.
- On Sepolia a reservation costs about 4× the gas it costs on a local devnet, and the public RPC served stale state right after confirmed writes. Reads are now pinned to the confirming block.
- A font in our PDF stack crashed on certain glyph sequences; we reproduced it, switched the monospace face, and added a hostile-input PDF test.
- We found and fixed a rate-limit bypass through a spoofed `X-Forwarded-For` header, twice: directly, and again behind a proxy.
- An independent GDAL/pyproj recomputation showed our areas were 0.43 % high (spherical model). We switched to exact WGS 84 ellipsoidal areas.
- We removed the planned "demo shipments". The workspace starts empty, and all test runs use clearly labelled engineering fixtures.

## Accomplishments (with denominators)

- 123/123 unit + integration tests (4 of them need a local Anvil devnet and are skipped without Foundry), 18/18 contract tests (512-run conservation fuzz), 23/23 browser tests; environmental results reproduced independently with GDAL/pyproj (pixel counts exact; areas within 0.02 %). Dated records: `docs/evidence/submission-unit.json`, `docs/evidence/submission-browser.json` (25 Oct 2026).
- Sepolia engineering run: 1 of 1 excess reservation rejected (preflight) and 1 of 1 mined revert with the balance unchanged. In 1 of 1 concurrent pair, exactly one reservation confirmed. Declared total = reserved total at the end.
- In-app anchoring: 6 of 6 transactions confirmed, 2 of 2 reservations read back matching the ledger.
- Environmental reads: real pixel analysis on engineering probe areas, e.g. a 1 km box in Taï National Park (100 % JRC 2020 forest, no 2021–2025 loss) and a box with loss recorded in 2021–2025.

## What we learned

Satellite tree-cover loss is a review trigger, not a legal verdict. A blockchain receipt is only as truthful as the declaration behind it. A useful compliance tool says clearly what it cannot know.

## What's next

- Pilot the supplier request with a real exporter using a permissioned, anonymised shipment file.
- Add dated near-real-time alerts (GFW integrated alerts, which need an API key) and more raster tiles.
- Verify a model provider with permitted documents.
- Validate XML against the EU acceptance environment, only with proper credentials and authorisation.

## Limitations (state these in the video and on Devpost)

No real shipment has been processed. The public Vercel URL is a frontend-only preview without the server. Environmental coverage is one tile, with annual data only. XML passes the official schema but has not been submitted to any EU system. The registry cannot detect the same cocoa under another key. AI extraction against a live model is unverified. LotHold does not certify compliance, legality, land rights or origin.

---

## 3–5 minute recording script (honest version: no invented shipment)

Record the actual running app. Keep the on-screen labels "ENGINEERING TEST" visible whenever fixtures are used.

| Time | Screen | Narration (summary) |
|---|---|---|
| 0:00–0:25 | Landing page | "From 30 December, EU importers of cocoa must show where it was grown, plot by plot. If a plot is missing or wrong, nobody can check that land for forest loss. LotHold is a review desk that catches those gaps before paperwork moves on." |
| 0:25–0:50 | Empty workspace | "A workspace starts empty: no sample shipments. Everything you see next comes from files I upload, and today those are clearly labelled engineering test files, not a real exporter's records." |
| 0:50–1:40 | Create case → details → upload CSV → preview → confirm → upload GeoJSON (P2 missing) | Show the parsed preview with row numbers. Point at the status strip: **HOLD**. Click "Show source" on *Plot ENG-P2 has no geometry* and show the highlighted row. |
| 1:40–2:25 | Upload corrected GeoJSON → Plots tab | "The boundary is now valid, and LotHold reads the actual published satellite pixels inside it: JRC forest 2020 and Hansen annual loss to 2025." Show the pixel map, the post-2020 loss years and the caveats. "This is a signal to investigate, not a finding of deforestation." Then show plot P2: *No post-2020 loss observed*, "which is not proof either." |
| 2:25–2:50 | Documents → supplier request PDF | Open the PDF: the case reference, each missing item with its file/row, the requested action, the data citations, and "NOT a regulatory determination". |
| 2:50–3:30 | Testnet registry page | "Source-lot conservation is enforced on a public test network. In this engineering test, actor A reserved 600 kg of a 1,000 kg test batch; actor B's 600 kg request was rejected and, when forced, reverted on-chain with the balance unchanged." Open one Etherscan link. "It can't prove cocoa exists; it stops participating actors from over-allocating a registered batch." |
| 3:30–4:10 | Findings → Record investigation (evidence required) → Reserve → Sign off → XML | Show that clicking without evidence is refused, then sign off and download the XML: "validated against the official EU schema, marked not submitted." Then edit one field: the sign-off turns *out of date* and the XML is disabled again. |
| 4:10–4:40 | Method page / README limitations | "No real shipment has been processed yet. Coverage is one tile, with annual data. The next step is a pilot with a real exporter's anonymised file." |

Do not narrate impact numbers, adoption, exporter validation or speed comparisons; none were measured.
