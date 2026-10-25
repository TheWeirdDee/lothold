# Response to the independent audit of 24 October 2026

The audit reviewed `a9abd0d` and the frontend at https://lothold.vercel.app. This file records what changed for each finding, how it is verified, and what remains open. Fixes are verified locally. **The public URL changes only after these commits are pushed and Vercel redeploys.**

| ID | Finding | Status | Change and evidence |
|---|---|---|---|
| LH-01 | The public site has no working API | **Open: hosting.** Mitigated in the interface. | No LotHold server is hosted, because Vercel serves static files only. Every page now detects a non-API answer and shows "The LotHold server is not running at this address" instead of "Request failed (404)". The full application runs locally or in the verified container (`docs/DEPLOYMENT.md`). Test: `workflow.spec.ts`, "a site without the LotHold server says so". |
| LH-02 | Direct links return the host's 404 | **Fixed in config; unverified on Vercel** | `vercel.json` sends every non-`/api` path to the app; real files are still served first, and `/api` stays a genuine 404. Takes effect on the next Vercel deploy and must be checked there. |
| LH-03 | Conflicting countries for one plot reach sign-off | **Fixed** | `core/rules.ts` collects every row's country for each plot. Disagreement between rows is a hold (`PLOT-COUNTRY-ROWS`) citing each row. Any row that disagrees with the plot file is a hold (`PLOT-COUNTRY`). No country is silently preferred. Test: `audit-fixes.test.ts` LH-03 (sign-off refused, 409). |
| LH-04 | A water-only sample counted as a clear result | **Fixed** | `server/env/forest.ts`: no land pixels gives `UNAVAILABLE` ("No land observation"); any water or no-data inside a plot gives `PARTIAL_COVERAGE`. Both need a recorded investigation before sign-off. Method version bumped to `forest-analysis/2026-10-25.2`, so cached results are recomputed. Tests: unit (real raster at −4, 5.2) and `audit-fixes.test.ts` LH-04. |
| LH-05 | Re-confirming an earlier CSV reports success but reserves nothing | **Fixed** | `reserveAllocations` skips only allocations that are currently reserved for the active table. A released reservation is re-created under a new idempotency generation. The call now reports success only after confirming every requested amount is reserved. Test: `audit-fixes.test.ts` LH-05 (A, then B, then A again: reserved, and retries create nothing). |
| LH-06 | The supplier PDF repeats a request the reviewer already resolved | **Fixed** | A land-change signal covered by a current decision with evidence is no longer supplier-actionable (`reviewedWithEvidence`). The PDF lists it under "Already investigated by the reviewer … (no action requested)". If the decision goes stale, the request returns. Test: `audit-fixes.test.ts` LH-06 (1 item before, 0 after). |
| LH-07 | No playable video; an API failure looked like "coming soon" | **Fixed in the interface; video still to be recorded** | The video section now separates loading, settings unavailable, coming soon (nothing configured) and configured. A real 3–5 minute recording still has to be made and linked (`docs/DEMO_VIDEO.md`). |
| LH-08 | The landing page explains implementation before the user's job | **Revised** | The hero now states who it is for, the problem, the inputs (supplier spreadsheet, plot boundary file) and the output (correction request), with a visible scope line: cocoa beans only, one forest-data tile, annual historical data, nothing submitted to the EU. A three-step "How it works" follows. The evidence-model, registry and sources sections move lower. The primary call to action is "Create a review case". Not user-tested. |
| LH-09 | A short PNG causes a server error | **Fixed** | Signature checks read only bytes that exist; truncated PNG and JPEG files get 415 with a clear message. Test: `audit-fixes.test.ts` LH-09. |
| LH-10 | Stale or incorrect documentation | **Fixed** | SUBMISSION (status, team wording "individuals or teams of 2–5; one team per person", AI status, test counts), CHECKLIST, EVIDENCE, DEPLOYMENT, README and VERIFICATION reconciled and dated. |

## Risks found by reading the source, also addressed

- **Requests that never finish:** `web/src/api.ts` now sets per-request timeouts (45 s by default; longer for uploads, extraction and analysis). A timeout reports a clear error instead of loading forever.
- **Auth unknown vs signed out:** if `/api/auth/me` fails, protected pages say "Your session could not be checked" with a retry, instead of sending you to the sign-in page. Sign-out clears local state only after the server confirms it; otherwise it reports the failure.
- **Revising after testnet anchoring:** the registry contract cannot release capacity. Once a case has a reservation anchored, or anchoring is under way, its source table can no longer be revised (409 `anchored`); the corrected shipment needs a new case. Test: `audit-fixes.test.ts`, "post-anchor revision".

## Still open

- **Hosting:** run the server with a persistent volume, then re-run the audit's hosted checks (sign-up, the full workflow, the five widths) on that URL. Fly.io costs about $7/month (DEPLOYMENT.md), which conflicts with the $0 constraint. Running locally plus the demo video meets the hackathon's stated requirements.
- **Demo video:** record it with the engineering test kit and set `DEMO_VIDEO_URL`.
- **Live AI:** not verified (see `docs/AI.md`).
- **Screen-reader pass:** not done (see `docs/ACCESSIBILITY.md`).
- **Eligibility:** organiser confirmation is still outstanding.

# Response to the build audit of 25 October 2026

Source: `docs/BUILD_AUDIT_2026-10-25.md`, the auditor's report, kept as written. Tests: `tests/unit/build-audit.test.ts` (geometry and ingestion) and `tests/integration/build-audit.test.ts` (workflow and operations), plus one addition to `audit-fixes.test.ts`.

| # | Finding | Status | Change and evidence |
|---|---|---|---|
| 1 | A source revision can race with anchoring in progress | **Fixed** | The anchoring job row, written when anchoring is requested, now locks revision for the whole register → authorise → reserve sequence. A reserve transaction in any state except a definitive rejection (including `rpc_error` with an uncertain submission) also blocks revision. The handler rechecks that the allocation is still reserved after the asynchronous steps and again just before submitting. Not reproduced against a live chain. Test: finding 1 (queued job, then uncertain `rpc_error`; both 409). |
| 2 | A mistaken first lot total cannot be corrected | **Fixed** | New audited workflow: "Correct the recorded total…" on the mismatch finding, `POST /api/shipments/:id/source-lots/correct`. It adopts the total in the confirmed file and needs a rationale (at least 40 characters) and an evidence file. Corrections go into a new append-only table (migration 2); the first total stays immutable. It is refused when other cases hold more than the corrected total, or when the lot is on the testnet registry. Other cases' sign-offs that used the old total go stale through their digest. Test: finding 2. |
| 3 | Decisions on a failed analysis vanish at once | **Fixed** | A decision on a failed run binds to that run's stable identity (geometry, method and datasets), so it stays active. A new **Retry analysis** action re-queues the job, and the new result then needs a fresh decision. Test: finding 3. |
| 4 | Freshness is claimed but not enforced | **Fixed (claims corrected; recency disclosed)** | No maximum data age is enforced: annual data ends in 2025. Every analysed case now shows a non-blocking note (`ENV-RECENCY`) with the latest observation year and the gap to today. The README and CHECKLIST now say "snapshot staleness" (enforced) and separately "observation freshness: not enforced, disclosed". Tests: finding 4, and `audit-fixes` LH-04 (note present with year 2025). |
| 5 | The small-plot fallback can sample outside the plot | **Fixed** | The vertex mean is gone. Each polygon part is sampled at a point guaranteed to lie inside it (the midpoint of its widest interior span). If no such point fits, the result is `UNAVAILABLE`. Method version `forest-analysis/2026-10-25.2` makes cached results recompute. Tests: concave "U" shape; one point per MultiPolygon part. |
| 6 | Overlapping MultiPolygon parts pass and inflate the area | **Fixed** | Parts that overlap, contain one another or repeat are a hold (`multipolygon_overlap`); parts that only touch are allowed. Test: finding 6 (duplicate, overlapping, contained, separate and touching cases). |
| 7 | CSV structural errors are accepted | **Fixed** | Wrong field counts and broken quotes reject the whole file with the row numbers. Test: finding 7. |
| 8 | Malformed JSON returns a server error | **Fixed** | Responds 400 `invalid_json`. Test: finding 8. |
| 9 | GeoJSON member types are not checked | **Fixed** | A member that is not a `Feature`, or has non-object `properties`, is a hold. Test: finding 9. |
| 10 | Lot keys are ambiguous with `::` | **Fixed** | `::` inside supplier or lot identifiers is a hold (`reserved_separator`), so keys cannot collide. Test: finding 10. |
| 11 | No shared capacity limit on public analysis | **Fixed (bounded)** | A global cap on concurrent public analyses (`PUBLIC_ANALYSIS_CONCURRENCY`, default 2; 503 with `Retry-After` when busy) and a 2,000-vertex limit on the public inspector. No load test was run. Test: finding 11. |
| 12 | Rate-limit history grows forever | **Fixed** | A sweep every 15 minutes removes rate-limit events older than 24 h and expired sessions. Test: finding 12. |
| 13 | The workspace list rebuilds every case | **Fixed** | Paginated, 50 per page with "Show more" (maximum 200); full state is computed only for the page shown. Test: finding 13. |
| 14 | A dataset read error can stop the worker starting | **Fixed** | A per-file read error counts as unverified (analysis reports unavailable). Startup always starts the worker, and jobs that don't need rasters still run. |
| 15 | Job infrastructure errors escape the worker loop | **Fixed** | An outer error boundary around each tick and around the loop; errors are logged as `worker.error`. |
| 16 | No account recovery or membership lifecycle | **Open: pilot decision** | Not built. A pilot needs at least password change and reset, user removal and session revocation. Until then, an operator uses `scripts/admin.ts` on the server. Recorded here as a pilot prerequisite. |
| 17 | The supplier PDF has no firm one-page bound | **Fixed** | Each item and the fixed closing sections are measured before drawing; supplier-facing text is capped (the review draft keeps the full text); items that don't fit are counted as omitted. Test: finding 17 (25 rows with 180-character identifiers: 1 page). |
| 18 | Precision warnings apply to every plot | **Fixed** | Precision is read from each geometry's own coordinate text; if the layout can't be mapped reliably, it falls back to the file-wide count. Test: finding 18. |
| 19 | Readiness hides failed dataset verification | **Fixed** | `/api/ready` reports `datasetsVerified` and `degraded`; `?strict=1` returns 503 unless every raster verified. Test: finding 19. |

**Delivery gaps:**
- **Supplier email:** added. The Documents tab has an editable, copyable email built from the outstanding items; nothing is sent.
- **Source URLs:** the supplier PDF and the email now include the Hansen and JRC dataset pages.
- **Still open:** hosted backend, live AI, real pilot data, the demo recording, the manual accessibility checks, cross-browser tests, CI, load testing, and a non-root container user.
