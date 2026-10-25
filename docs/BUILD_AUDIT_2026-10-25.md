# Build audit — 25 October 2026

Scope: local source, configuration, requirement/document comparison, production build, TypeScript, automated suites, and isolated adversarial probes. Application code and .env were not changed. Secret values were not read. This is a bounded engineering review, not a guarantee that every defect has been discovered. Hosted state, current legal requirements, and live model behavior were not independently verified.

## High priority

1. **Source revision can race with in-progress anchoring.** `server/service.ts:211` blocks revision only when a reserve transaction exists with status queued/pending/confirmed. `server/chain/anchor.ts:82` checks the allocation once, then awaits registration and authorisation before creating the reserve transaction at line 103. A revision during either await can release the DB allocation; the running handler still reserves it on-chain. `rpc_error` with a submitted transaction hash is also absent from the revision guard. Result: database capacity and irreversible chain capacity diverge. Persist an anchoring lock before the first asynchronous step, cover uncertain submitted transactions, and recheck lifecycle state before submission. Source inspection; concurrent live-chain reproduction not attempted.

2. **A mistaken first declared lot total cannot be corrected.** `server/service.ts:218–223` permanently keeps the first total. `core/rules.ts:264–279` then places every corrected upload for that supplier/lot on hold, with no authorised correction operation. A new case in the same organisation still uses the same lot. Reproduced: confirm total 100, confirm corrected total 200, receive `ALLOC-REG-MISMATCH`. Add an audited correction workflow with reservation and chain checks; do not silently overwrite totals.

3. **Failed environmental analysis accepts decisions that immediately become inactive.** `recordDecision` binds a failed analysis to the current snapshot (`server/service.ts:376`); `computeState` accepts ENV decisions only against a completed result ID (`server/service.ts:300`). Reproduced: POST decision returns 201 with valid rationale/evidence, but the next state has zero active decisions and remains UNAVAILABLE. Both investigation and keep-on-hold decisions are affected. Bind failures to a stable job/geometry/version identity or explicitly disallow those decisions and provide a recovery action.

4. **Freshness is claimed but not enforced.** README and CHECKLIST say freshness/staleness rules are verified. `core/rules.ts` has no observation-age rule or time input; cached environmental results are reused by geometry/method/dataset identity indefinitely. Snapshot invalidation covers evidence changes, not elapsed time. Specify acceptable observation age, expose the observation gap, and distinguish snapshot staleness from dataset freshness. Historical annual coverage is documented, but the claimed freshness validation is absent.

5. **Small-geometry fallback can inspect land outside the polygon.** `server/env/forest.ts:212` calls the arithmetic mean of vertices a centroid; line 303 uses it when no pixel centre is inside the polygon. That point can lie outside a concave polygon. MultiPolygon fallback considers only the first component. The resulting pixel may yield a clear observation for the wrong location. Use a point guaranteed inside each relevant component or return insufficient spatial resolution; add concave, thin and disconnected geometry cases. Source inspection.

6. **Overlapping MultiPolygon components pass validation and inflate area.** `core/geometry.ts:246` validates each component independently and sums its area. Reproduced: two identical components return `valid: true` and twice the single polygon area. Environmental sampling uses a union-like point test, so reported geometry and sampled areas disagree. Validate relationships between components and reject overlaps/duplicates.

## Medium priority

7. **CSV structural errors do not block confirmation or readiness.** `core/sources.ts:73–80` rejects delimiter errors but keeps field-count errors only in `headerIssues`; quote errors are not handled as fatal. The service/rule input discards `headerIssues`. Reproduced: an otherwise valid eight-column row with a ninth unexpected value returns `ok: true`, no row issues, and silently drops the extra value from normalised data. Reject malformed structure or carry parser errors into blocking findings.

8. **Malformed JSON is returned as server failure.** `server/app.ts` catches HttpError/ZodError but not JSON SyntaxError. Reproduced: empty body to `/api/auth/login` returns 500. Apply a shared JSON parser returning 400 for malformed or missing JSON on JSON endpoints.

9. **GeoJSON member type is not checked.** `core/sources.ts:180` reads member properties and geometry without requiring `type: 'Feature'`. Reproduced: a FeatureCollection containing a member with `type: 'Banana'` and a valid geometry parses with no issues. Validate each member and the shape of its properties before accepting it.

10. **Source-lot string keys are ambiguous.** `core/rules.ts:235` and `server/service.ts:281` concatenate supplier ID and lot reference with `::`, while the parser permits that delimiter in either value. Supplier `A::B`, lot `C` collides with supplier `A`, lot `B::C`. The database treats these as distinct tuples while evaluation merges them. Use structured tuple encoding or nested maps consistently. Source inspection.

11. **Public expensive operations lack aggregate capacity protection.** Forest checks have per-IP request counts, but no global concurrency queue or complexity budget. Geometry validation and point-in-polygon sampling accept up to 20,000 vertices and run in the API process. Many clients can occupy the shared server despite each remaining under its own rate limit. Add global concurrency/CPU bounds and geometry complexity limits based on measured workload. No load test performed.

12. **Rate-limit history grows without global cleanup.** `server/security.ts:77` deletes expired records only for the currently requested bucket. One-off IP/email buckets remain indefinitely. Add periodic bounded cleanup and expiry indexes as appropriate. Similar housekeeping is needed for never-revisited expired sessions.

13. **Workspace listing recomputes every case without pagination.** `server/service.ts:68–71` loads all shipments and calls `computeState` for each, including row/plot/ledger/decision queries and JSON processing. This grows with the entire workspace and executes synchronous SQLite work on the request thread. Add pagination and avoid rebuilding full case state for every list item.

14. **Dataset verification errors can prevent the worker from starting.** `server/main.ts` attaches `.then` without a rejection handler to `verifyDatasets`; `server/handlers.ts` streams files without per-file error handling. A file can pass presence/size checks but fail during reading, rejecting startup verification rather than returning a controlled unavailable state. Catch errors, log readiness/degradation explicitly, and allow unaffected jobs to run.

15. **Job infrastructure errors escape the worker loop.** `server/jobs.ts:34–63` calls `claim` outside the handler try/catch and starts `void loop()` with no rejection handler. A SQLite claim error rejects the loop; failure while persisting an error does likewise. Add an outer loop error boundary and worker health reporting. This is a failure-mode gap, not a reproduced normal-path crash.

16. **Account recovery and membership lifecycle are incomplete.** Auth routes support registration/login/logout; the CLI creates/adds users and toggles chain access. No password change/reset, user suspension, user removal, session revocation UI, or organisation membership management exists. A lost password or departed reviewer needs direct operational intervention. Decide which are required before a real pilot.

17. **Supplier PDF has no firm one-page layout bound.** `server/documents.ts` checks only the current Y coordinate before drawing an item, not the height of the next title/request/reference block. Long identifiers or long finding text can force PDFKit to add pages despite the one-page contract. Measure blocks before writing, cap supplier-facing text appropriately, and test adversarial maximum-size records. Source inspection; existing short fixtures pass.

18. **Precision warnings are attributed to every plot in the file.** `core/sources.ts:172–198` counts numbers across the entire raw document and passes the same precision count to each feature. Numbers in unrelated arrays can be counted as coordinates, and one coarse feature makes precise features receive the same warning. Calculate coordinate precision per feature from a parser that preserves numeric tokens.

19. **Readiness does not indicate successful dataset verification.** `/api/ready` (`server/app.ts:113`) returns 200 once verification finishes even if all rasters are missing or hashes mismatch. This behavior is explicit in the code, but deployments monitoring only HTTP status cannot distinguish fully functional from degraded. Provide separate liveness/degraded readiness fields or a strict readiness endpoint for deployments requiring environmental analysis.

## Requirement and delivery gaps

- **Hosted backend:** repository documentation says only a static Vercel frontend is hosted. `vercel.json` supplies SPA rewrites but no Node API. The complete workflow needs the stateful backend, volume, keys, verified rasters and same-origin routing. Live hosting was not rechecked in this audit.
- **Supplier email artifact:** the PRD requires a copyable/editable supplier email in addition to the PDF; no corresponding implementation was found. PDF generation is present.
- **Source URLs in the supplier memo:** PRD artifact A asks for source evidence URLs. The PDF includes dataset titles/credits and file references, but does not explicitly render dataset/source URLs.
- **Live model extraction:** documented as unverified after provider 503/429 responses. Automated injected-output tests do not establish live provider reliability.
- **Real workflow evidence:** no permissioned commercial shipment or genuine farm boundary pilot is documented. Engineering probe boxes establish code paths, not actual exporter usability or false-hold rates.
- **Demo recording:** documented as pending unless a real `DEMO_VIDEO_URL` is supplied. Configuration UI tests do not establish that a recording exists.
- **Accessibility:** automatic axe and keyboard checks exist. Manual screen reader use, forced colours/high contrast, 200–400% zoom/text-spacing overrides, voice control and cognitive usability remain unverified, per `docs/ACCESSIBILITY.md`.
- **Cross-browser coverage:** Playwright is configured for Chrome only. Safari/WebKit and Firefox behavior are not covered.
- **Operational resilience:** no automated CI workflow was found; no load/soak test or multi-instance worker test was found. The container runs as root by design; move to a restricted runtime user when volume provisioning permits.
- **Scope limits:** only HS 1801, one raster tile, annual loss through 2025, text-layer PDF extraction without OCR, pilot server-held chain signers, no reservation release, and no official submission. These are disclosed scope choices, not all defects; keep them explicit in demos and pilot acceptance criteria.

## Verification

- TypeScript: passed.
- Production Vite build: passed. Initial sandbox-only EPERM was resolved by running the same checks with permitted subprocess access; this was an environment restriction, not a source build defect.
- Unit/integration: 9 files, 93 tests passed.
- Browser suite: 16 of 16 Chrome Playwright tests passed, including automated accessibility, keyboard paths, mobile layout, exports and the full review workflow.
- Extra isolated probes reproduced findings 2, 3, 6, 7, 8 and 9. No live signing, external submission or messaging was performed.
- Existing untracked `02_LotHold_Full_PRD.md` was read and left unchanged.

Recommended order: fix chain lifecycle consistency, failed-review binding, correction workflow and geometry correctness; then ingestion/error handling; then complete hosting, recovery and human validation required for the intended pilot.
