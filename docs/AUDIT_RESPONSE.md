# Response to the independent audit of 24 October 2026

The audit reviewed `a9abd0d` and the frontend at https://lothold.vercel.app. This file records what changed for each finding, how it is verified, and what remains open. Fixes are verified locally. **The public URL changes only after these commits are pushed and Vercel redeploys.**

| ID | Finding | Status | Change and evidence |
|---|---|---|---|
| LH-01 | The public site has no working API | **Open: hosting.** Mitigated in the interface. | No LotHold server is hosted, because Vercel serves static files only. Every page now detects a non-API answer and shows "The LotHold server is not running at this address" instead of "Request failed (404)". The full application runs locally or in the verified container (`docs/DEPLOYMENT.md`). Test: `workflow.spec.ts`, "a site without the LotHold server says so". |
| LH-02 | Direct links return the host's 404 | **Fixed in config; unverified on Vercel** | `vercel.json` sends every non-`/api` path to the app; real files are still served first, and `/api` stays a genuine 404. Takes effect on the next Vercel deploy and must be checked there. |
| LH-03 | Conflicting countries for one plot reach sign-off | **Fixed** | `core/rules.ts` collects every row's country for each plot. Disagreement between rows is a hold (`PLOT-COUNTRY-ROWS`) citing each row. Any row that disagrees with the plot file is a hold (`PLOT-COUNTRY`). No country is silently preferred. Test: `audit-fixes.test.ts` LH-03 (sign-off refused, 409). |
| LH-04 | A water-only sample counted as a clear result | **Fixed** | `server/env/forest.ts`: no land pixels gives `UNAVAILABLE` ("No land observation"); any water or no-data inside a plot gives `PARTIAL_COVERAGE`. Both need a recorded investigation before sign-off. Method version bumped to `forest-analysis/2026-10-25.1`, so cached results are recomputed. Tests: unit (real raster at −4, 5.2) and `audit-fixes.test.ts` LH-04. |
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
