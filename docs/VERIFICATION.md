# Verification record

**Latest full run: 25 October 2026**, Windows 11, Node v24.13.1, pnpm 11.5.0, Chrome (Playwright `chrome` channel), Foundry 1.8.6.

Latest post-routing browser run: **23/23 passed together in 4.3 minutes**, no retries/skips, against the local compiled backend ([report](evidence/connected-browser.json)); hosted workflow/recovery probes are recorded separately. No isolated results were merged into this count.

| Command | Result (25 Oct 2026) | Machine-readable record |
|---|---|---|
| `npm run typecheck` | 0 errors (TypeScript 7, strict) | — |
| `npm test` | **123 / 123 passed** (68 unit + 55 integration, including the 4 Anvil chain tests with Foundry installed) | `docs/evidence/submission-unit.json` |
| `npm run test:contracts` | **18 / 18 passed** (512-run conservation fuzz) | — |
| `npm run test:e2e` | **23 / 23 passed** in ~3 minutes, no retries and no skips | `docs/evidence/submission-browser.json` |
| `npm run docs:check` | every relative link and image in the Markdown resolves | asserted again by `tests/unit/doc-links.test.ts` |
| Fresh-clone walkthrough | separate checkout: `pnpm install --frozen-lockfile` → `npm run setup` → `npm run data:fetch` (3/3 SHA-256, ~431 MB) → `npm run build` → `npm start` → `/api/ready?strict=1` returned 200 with `datasetsVerified: true` | performed 25 October 2026 |
| Live AI verification attempt | **still unverified**: provider timeout after 90 s (earlier attempts: 503, then 429 daily quota). Deterministic fallback verified live again | `docs/evidence/ai-live-verification.json` |
| Sepolia contract re-check | code present at `0x1645604d915c55cfd61cf1492ad58ab5e4150b57` (`eth_getCode`, block 11991100) | `docs/CHAIN.md` |
| Public site connection | Vercel `/api/ready?strict=1` returns 200 through the published Render rewrite (`4a9c877`); authenticated browser session and saved case visible | `docs/evidence/hosted-workflow.json` |
| Hosted workflow and restart | 17 API workflow checks; browser login/session, review PDF and unsigned XML refusal; 10 checks after user-reported Render restart, including byte-identical PDF/evidence. 10 recovery checks also passed after a separately reported replacement redeployment | `docs/evidence/hosted-workflow.json` |
| Fresh-clone README walk-through | clone → install → setup → data:fetch (3/3 pins) → build → start → strict readiness 200 → 123 tests → 23 browser tests → `docs:check` pass | `docs/evidence/readme-quickstart.json` |

## Commands and results (24 October 2026 run)

Kept for its wider manual scope; the counts above supersede the unit/e2e figures in this table.

| Command | Result | Scope |
|---|---|---|
| `npm run typecheck` | 0 errors | server, core, web, scripts, tests (TypeScript 7.0.2, strict) |
| `npm test` | **110 / 110 passed** (Foundry installed; without Anvil, 4 chain tests are skipped) | `tests/unit` (64, incl. build-audit geometry/ingestion regressions, water-only coverage, runtime-dependency guard and demo-video configuration) + `tests/integration` build-audit regressions (10) + audit regressions (6) + test kit (4) + `tests/integration` (26, incl. 4 against a local Anvil devnet and 1 backup/restore) |
| `python scripts/gis-crosscheck.py` | 0 failures (6 polygons) | Independent GDAL 3.12.2 / pyproj 3.8.0 recomputation; see METHOD.md |
| `npm run test:contracts` | **18 / 18 passed** (fuzz: 512 runs) | `contracts/test/BatchReservations.t.sol` |
| `npm run test:e2e` | **19 / 19 passed** | Playwright + Chrome, real server, throwaway database: workflow journeys (upload to export, stale sign-off, test-kit downloads, extraction disclosure), recorded walkthrough playback/captions/fullscreen at 1440 and 390 px without API, mobile navigation focus and Escape, FAQ keyboard use, route-specific footers, public pages without API (including the inspector's server notice), cross-device login and sign-out, and 5 accessibility checks |
| Production container | **Passed** | Built from `deploy/Dockerfile` and checked with `scripts/container-verify.ts`: datasets, auth, uploads, analysis, exports, restart, redeploy and hard-kill recovery (`docs/evidence/container-verification.json`) |
| `npm run data:verify` | 3 / 3 SHA-256 match | raster snapshots |
| `node scripts/chain-engineering-verify.ts --network sepolia` | PASS | public testnet; see CHAIN.md |
| `node scripts/app-anchoring-sepolia.ts` | 6 confirmed tx, read-back matches | public testnet, app code path |
| `node scripts/ui-walkthrough.ts` | 0 console errors; no horizontal overflow at 360/390/768/1024/1440 on 5 pages | visual walkthrough (screenshots reviewed manually) |
| `node scripts/render-documents.ts` + `scripts/render-pdf.py` | Supplier requests 1 page; review drafts 1–2 pages; XML XSD-valid | PDFs rasterised (colour and greyscale) and read |

## What each layer covers

**Core rules (unit)**
- Quantity parsing: exact unit conversion, no floating point, rejection of commas/negatives/zero/over-precision/unknown units.
- HS 1801 scope.
- Geometry: valid polygon, self-intersection (no fake zero area), open ring, holes, LineString, empty, out of bounds, axis swap against the country box and by latitude range (correction proposed, never applied), point area rules, projected CRS refusal, 6-decimal truncation collapse.
- CSV/GeoJSON parsing: missing columns, per-cell issues, raw-text precision.
- Decision engine: ready only when all dimensions clear; excess allocation arithmetic with row links; first declaration kept; unavailable/outside/partial/pending never clear; land-change signal requires rationale **and** evidence; keep-on-hold becomes a hold; missing geometry; unsupported product; net-mass mismatch; determinism.

**Extraction (unit)**
- Accepts quotes found on the cited page.
- Rejects fabricated values, values outside their quote, wrong pages, ambiguous candidates, and quotes without a field label (embedded-instruction case).
- The label parser is deterministic and flags conflicting values.

**XML (unit)**
- The official sample validates (positive control).
- Generated XML validates and keeps exact quantities, with no draft markers or reference numbers inside.
- Four malformed variants fail (description > 150 characters, invalid activity type, malformed HS code, non-EU country of activity).

**Environmental (unit, real rasters)**
- Outside tile → outside coverage; tile edge → never clear; invalid geometry not analysed; pixel arithmetic consistent (1,600 pixels for a 0.01° box); years within 2001–2025; a point samples exactly one pixel.

**HTTP integration**
- CSRF and Origin enforcement.
- Registration rate limit that ignores spoofed `X-Forwarded-For`.
- Weak passwords and bad logins rejected.
- No secrets in public responses; oversized JSON refused (413).
- **Cross-organisation isolation** on every protected route, including signed links (issued to one user, refused for another).
- Expired and tampered links refused.
- Upload limits: size, extension, fake PDF, non-UTF-8, empty, malformed JSON. Rejected files cannot be confirmed; duplicate uploads are idempotent.
- Evidence encrypted at rest.
- Over-allocation across shipments rejected with balances unchanged; retries do not double-reserve.
- Concurrent reservations: exactly one succeeds. Within one process the synchronous SQLite driver serialises requests; across connections, `BEGIN IMMEDIATE` provides the lock.
- First declaration immutable; append-only tables refuse UPDATE/DELETE.
- Abandoned jobs resume after an expired lease; failing jobs stop after bounded attempts.
- Full workflow: holds, environmental signal, one-page PDF, XML refused before sign-off, missing boundary supplied, decision without evidence refused, reserve, stale-digest sign-off refused, sign-off, XSD-valid XML, review draft, field change → stale sign-off and documents, geometry change → environmental decision voided.
- Axis-swap correction creates a new upload that must be confirmed.
- Extraction: label parser labelled, nothing auto-applied, unverified fields not acceptable, document text not logged; model output failing the schema falls back; invented model values rejected.
- Hostile cell values (quotes, CJK, emoji, 400-character values) still give a one-page supplier PDF.

**Chain (Anvil integration)**
- Full anchoring confirmed.
- Crash after submission is reconciled without resending (signer nonce unchanged).
- Re-runs idempotent.
- Read-back matches the ledger.
- On-chain quantity disagreement stops anchoring with the ledger untouched.
- Organisations without enablement get 403.

**Browser (Playwright)**
- Public pages and every internal link return 200.
- Honest empty workspace; blank template exact.
- Field entry, CSV upload/preview/confirm, malformed GeoJSON rejected with message, source-to-finding navigation (row highlighted), boundary correction, real pixel map, supplier PDF download (`%PDF-`), XML disabled before sign-off, evidence-required review dialog, reserve, sign-off, XML download, persistence after reload, invalidation after edit, list shows "Sign-off out of date".
- Public inspection: clear and outside-coverage results.
- 360 px layout with menu; skip link is the first focus stop; 40 px touch targets.

## Distinguishing kinds of verification

| Kind | Done | Notes |
|---|---|---|
| Local automated verification | Yes | All suites above |
| Genuine external data | Yes | Hansen GFC v1.13 and JRC GFC2020 V4 tiles downloaded from their publishers, hash-pinned, read pixel by pixel; official DDS V3 XSDs from the EU WSDL |
| Public testnet | Yes | Sepolia transactions listed in CHAIN.md (engineering quantities) |
| Model provider | **No** (blocked by quota) | Gemini key configured and authenticated; in-app extraction got HTTP 503, then a diagnostic call got HTTP 429 (free-tier daily quota exhausted); fallback verified live; see `docs/evidence/ai-live-verification.json` |
| Actual user/commercial records | **No** | No permissioned shipment data available. Every end-to-end run used labelled engineering fixtures |

## Defects found and fixed during verification

| Severity | Defect | Fix |
|---|---|---|
| High (security) | Per-IP rate limits trusted client `X-Forwarded-For`, allowing unlimited rotation | Socket address used; XFF only with `TRUST_PROXY=true`; test added |
| High (correctness) | A quote copied from an embedded instruction could support an extracted value | Quote must contain a field label; test added |
| Medium (security) | No request body limit on JSON endpoints, including public analysis | 1 MB JSON / 26 MB upload limits; test added |
| Medium (security) | No Content-Security-Policy on HTML | Strict same-origin CSP |
| Medium (crash) | Plex Mono font crashed fontkit on certain glyph sequences (review draft 500) | Built-in Courier for monospace; hostile-input PDF test |
| Medium (documents) | Review draft footers spilled onto blank extra pages | Footer drawn inside a lifted bottom margin |
| Medium (chain) | Public RPC returned stale state right after a confirmed write | Reads pinned to the confirming block with bounded wait |
| Medium (chain test) | Forced-revert transactions ran out of gas (Sepolia charges ~4× Anvil), masking contract reverts | Gas limit raised; out-of-gas distinguished from contract revert |
| Medium (a11y) | Focus moved to main on initial load, skipping the skip link | Only on client navigation; test added |
| Medium (UI) | Files in the built client other than /assets (landing image) were answered with the SPA shell, so the image was broken | All built files served before the SPA fallback; browser test asserts no broken images |
| Medium (API) | Unknown /api GET paths returned the HTML shell with 200 instead of a JSON 404 | SPA fallback excludes /api; browser test added |
| Medium (environment) | Areas used a spherical model and were 0.43 % high versus the WGS 84 ellipsoid, enough to flip a borderline 4 ha decision | Exact ellipsoidal cell and polygon areas; matched to pyproj within 0.02 % |
| Low (environment) | Pixel centres exactly on a polygon edge were classified by floating-point noise | Closed-polygon rule with 1e-10° tolerance; identical results from two independent implementations |
| High (security) | Behind a proxy, the first (client-controlled) X-Forwarded-For entry was trusted, re-opening the rate-limit bypass | Last entry or a platform single-value header; test added |
| Medium (signing) | One anchoring request could queue an unbounded number of testnet transactions; no chain-ID or fee checks before signing | Per-request and daily per-organisation caps; chain-ID and fee ceiling checks; tests added |
| Medium (environment) | The public analysis endpoint did not check that rasters passed hash verification | Returns UNAVAILABLE unless all three hashes verified |
| Low (scope) | Product scope relied on an XML sample, not the legal text | Annex I and definitions read from the Official Journal; scope qualified in UI and docs |
| Low | Self-intersecting polygons also reported "zero area" / "0 ha" | Area reported as unknown |
| Low | Precision warning fired on 6-decimal coordinates (JSON drops trailing zeros) | Precision judged from raw file text |
| Low | Supplier PDF listed the same over-allocation twice | Row-level duplicate suppressed |
| Low | Startup "database is locked" when a stale process held the DB | `busy_timeout` set before WAL pragma |
| Low | Dependency: `unicode-properties@1.4.0` broken `exports` path broke pdfkit | pnpm override to 1.4.1 |

## Known limitations and residual risk

- Single-tile environmental coverage; annual data only; no near-real-time alerts (GFW key unavailable).
- No live model verification.
- No real shipment records processed.
- SQLite single-writer architecture; adequate for a pilot, not for multi-instance deployment.
- PDF typography for non-Latin text: characters outside the embedded Latin subset are substituted with "?" and shown in full in the app.
- Testnet trust model as described in CHAIN.md.
- Not externally penetration-tested.
