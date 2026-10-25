# Evidence classification

Each claim about LotHold falls into exactly one of these classes. Do not present one class as another.

## A. Automated assertions (re-run with `npm run verify`)

Machine-checked on every run; pass or fail without human judgement.

| Suite | Count | Covers |
|---|---|---|
| `tests/unit` | 57 | Water-only and partial-coverage classification on real rasters, demo-video configuration and CSP, runtime-dependency guard for the production image, quantities, product scope, geometry rules, parsers, decision engine, ellipsoidal areas, edge rule, extraction span checks, official-XSD validation, real-raster analysis on probe areas |
| `tests/integration` | 26 | HTTP API: auth, CSRF/Origin, rate limits (direct and behind a proxy), isolation, uploads, ledger, append-only history, jobs, full review workflow, review-integrity bypass attempts, approval binding, extraction fallback, hostile PDFs, backup/restore, Anvil chain lifecycle and signing safeguards |
| `contracts/test` | 18 | Registry authorisation, conservation (512-run fuzz), duplicates, zero values, events |
| `tests/integration/test-kit.test.ts` | 4 | Every downloadable engineering-test kit file produces the outcomes promised in docs/AUDIT_GUIDE.md |
| `tests/integration/audit-fixes.test.ts` | 6 | Regressions for the 24 Oct independent audit: plot-country conflicts across rows, water-only plots, restoring a released reservation, supplier requests after review, truncated images, revision freeze after anchoring |
| `tests/e2e` | 16 | Server-unavailable state (static host), browser journeys in Chrome on a throwaway server, including labelled landing demonstrations, live readings, reduced motion and AI/parser disclosure; demo-video playback (generated engineering test clip, captions, keyboard) and YouTube facade; test-kit downloads; plus axe WCAG 2.2 A/AA scans, keyboard-only use, dialog focus and live regions |
| `scripts/container-verify.ts` | 16 + 10 checks | Production container: datasets, auth, uploads, analysis, exports; recovery after restart, redeploy and hard kill (`docs/evidence/container-verification.json`) |
| `scripts/gis-crosscheck.py` | 6 polygons × 9 checks | Independent GDAL/pyproj recomputation of the environmental analysis (`docs/evidence/gis-crosscheck.json`) |

## B. Manually inspected results (human review of rendered output)

Judged by looking, not by assertion. Repeatable with the named scripts, but the judgement is not automated.

- UI screenshots at 360, 390, 768, 1024 and 1440 px (`scripts/ui-walkthrough.ts`; the files in `docs/screenshots/`). Reviewed for alignment, spacing, overflow, readability and honest labelling.
- PDFs rasterised in colour and greyscale (`scripts/render-documents.ts`, `scripts/render-pdf.py`). Reviewed for one-page fit, wrapping, monochrome legibility, duplicates and wording.
- Official legal text read for Annex I cocoa rows, definitions and application dates (`docs/SOURCES.md`).

## C. Real environmental observations

Genuine readings of published datasets: Hansen GFC v1.13, JRC GFC2020 V4, hash-pinned. They are observations **for coordinates only**.

- Probe areas (coordinate boxes, not farms) in Côte d'Ivoire: Taï National Park (100 % JRC 2020 forest, no 2021–2025 loss); boxes near −7.56, 6.24 with loss recorded in 2021–2025; a coastal/lagoon box with water pixels.
- These say nothing about any supplier, farm or shipment. No real plot has been analysed.

## D. Public testnet actions (Ethereum Sepolia)

Real transactions on a test network with **engineering quantities**. They prove that the contract and the app's code path behave as described. They prove nothing about cocoa.

- `docs/evidence/chain-engineering-sepolia.json`: two-actor excess rejection (preflight and mined revert), duplicate-ID rejection, a concurrent pair with exactly one success, conservation.
- `docs/evidence/app-anchoring-sepolia.json`: in-app anchoring, 6 confirmed transactions read back from the contract.

## E. Untested or unavailable

| Behaviour | Why | What would verify it |
|---|---|---|
| Processing a real exporter's shipment | No permissioned records available | An anonymised source CSV and plot GeoJSON from an exporter, with permission |
| Live model extraction | A Gemini key is configured and authenticates. The in-app extraction got HTTP 503 (provider overloaded); a later call got HTTP 429 (free-tier daily quota exhausted, limit 20). No model extraction has succeeded. Fallback behaviour was verified live | After the quota resets: `node --env-file=.env scripts/ai-live-verify.ts` (see `docs/evidence/ai-live-verification.json`) |
| Near-real-time disturbance alerts | GFW Data API requires a key | GFW API key and an adapter |
| Hosted backend | No server is hosted. https://lothold.vercel.app serves the frontend only; its `/api` requests return 404 and the site shows a "server not running" notice. The production container was built and verified locally (`docs/evidence/container-verification.json`) | Hosting the container with a persistent volume (see DEPLOYMENT.md) |
| EU Information System acceptance of the XML | Requires operator credentials and authorisation | Acceptance-environment submission by an authorised operator |
| Screen-reader usability | Automated accessibility checks pass (`docs/ACCESSIBILITY.md`), but no screen-reader session has been run | Manual NVDA/VoiceOver pass |
| Organiser eligibility confirmation | External | Reply from organisers on Devpost |

## Isolation of engineering (ENG) records

- Engineering fixtures live only in `tests/fixtures/engineering/` and are loaded only into temporary databases (test harnesses, `scripts/e2e-server.ts`, `scripts/render-documents.ts`, `scripts/app-anchoring-sepolia.ts` all create `mkdtemp` directories).
- The downloadable reviewer kit (`web/public/test-kit/`, page `/test-kit`) is a set of static files with `ENGINEERING_TEST` names and `ENG-KIT-` identifiers. It is never loaded automatically; it enters a workspace only if a reviewer uploads it. `docs/AUDIT_GUIDE.md` asks reviewers to use a dedicated test workspace.
- Scripts that drive a running server (`scripts/ui-walkthrough.ts`, `tests/smoke-api.ts`) refuse to run unless `/api/health` reports `instance: "engineering"`, which is set only by `LOTHOLD_INSTANCE=engineering`.
- The local operational database (`data/lothold.sqlite`) was checked read-only on 24 Oct 2026 (about 16:20 UTC). It holds one organisation, one user and one shipment, created through the UI at 15:10 UTC, and no uploads. None of these records match the engineering fixture patterns (`ENG…` references, `@example.test` emails); the agent's scripts write only to temporary databases. These records were left untouched.
