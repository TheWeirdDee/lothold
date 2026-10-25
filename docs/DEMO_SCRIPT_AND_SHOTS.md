# LotHold demo script and shot list - engineering edition

Target: about 3 minutes, with a separate reliability appendix. Current delivery status: locally verified; Supabase live checks and hosted acceptance are pending. The existing bundled recording is a real local engineering run, not evidence of a deployed backend. Do not relabel it as a hosted run.

## Setup and capture

Use a separate organization named `ENGINEERING TEST - DEMO`, references prefixed `ENG-DEMO-`, and the downloadable files under `web/public/test-kit/`. Never use operational accounts or sourcing claims. Prepare 1440x900 desktop capture plus a short 390 px mobile insert. Hide the IDE, provider dashboards, terminal history, .env, email/password entry and any secret-management screen. Capture the browser application and downloaded drafts only. Use native video pause/fullscreen controls when showing the landing recording. Readiness/cold-start waiting is real time unless explicitly captioned as an edited wait; preserve the measured elapsed time in an appendix. No invented progress percentage, model result, blockchain transaction or regulatory submission.

## Main narration and shots

| Target time | Narration | Action / shot | Visible evidence |
| --- | --- | --- | --- |
| 0:00-0:15 | "A shipment file can look complete while a source row has no matching plot, or the same lot is overallocated. LotHold links those gaps back to their evidence." | Landing hero, then create `ENG-DEMO-A` in the engineering workspace. Cut around credentials. | Empty organization/case before upload; engineering label. |
| 0:15-0:40 | "Upload is not acceptance. The reviewer sees the parsed rows and explicitly confirms which file becomes the source." | Upload A1 source CSV; open preview; inspect exact declared/allocated quantities; confirm. Upload A2 plots; preview and confirm. | Preview source filename, rows and confirmation state. |
| 0:40-0:58 | "The document reader proposes fields; it does not silently overwrite the case." | Upload A3 shipping text; Propose fields; show the actual method badge, source span and human acceptance. Fill any remaining required fields with clearly invented demo values. | If unconfigured, say "deterministic label parser, not AI." Never call it a model result. |
| 0:58-1:23 | "Raster analysis runs in a background process. The result distinguishes observed tree-cover loss from a legal finding." | Show running/queued status without percentages. When complete, open ENG-KIT-A1 plot, actual pixels, loss years, JRC baseline and limitations. | Genuine pinned-raster values for coordinate probe boxes, which are not farms. Keep the source dates visible. |
| 1:23-1:43 | "This signal becomes a specific supplier evidence request." | Generate supplier-request PDF and open its downloaded bytes in the native viewer. Zoom enough to read a source-referenced request. | Actual PDF filename/content; no mock PDF. |
| 1:43-2:08 | "A human investigation requires rationale and an attachment. This engineering attachment does not establish a real sourcing conclusion." | Attach A4 investigation text, record a clearly labelled test rationale, reserve the fixture allocation and sign off once permitted by the actual case state. | Rationale/evidence references, review state and conservation checks. If blocked, show the hold rather than bypass it. |
| 2:08-2:28 | "The output is a validated XML draft, not a regulatory submission." | Export DDS XML and show draft filename, schema-validation result and a few non-sensitive fields. | Real export; no invented acceptance/reference number. |
| 2:28-2:45 | "Change the evidence and the previous sign-off becomes stale." | Make a real accepted evidence/field change through the interface. | Sign-off/export staleness visibly updates. |
| 2:45-3:00 | "The same workflow works on a narrow screen, with source links and readable controls." | Mobile insert: tabs, registry engineering run below summary cards, source-row link. Close with the actual deployment status. | No sideways page overflow. Say "prepared locally" until hosted checks pass. |

Optional alternate opening: use Scenario B in a different `ENG-DEMO-B` case to show invalid quantity/country/boundary holds. Optional 20-second appendix: Scenario C in two separate engineering cases demonstrates conservation of one declared lot; an excess request must be rejected. Do not mix these fixtures into the clean A case without explaining the resulting holds.

## Reliability appendix - capture only after authorization

1. Show the deployed frontend origin and release identifier, never secret dashboards.
2. Register an engineering account and create a case; analyze a real fixture and open PDF/XML drafts. Record cold/warm latency and ordinary API latency during processing.
3. Log in from an isolated browser context and verify the same organization/case. Download evidence and calculate its SHA-256 locally without showing keys.
4. Restart the hosted backend, log in again and compare the downloaded bytes/hash.
5. Redeploy so the ephemeral filesystem is replaced, then repeat login, record and byte comparisons. Record the new deployment ID and immutable image digest/commit.
6. Observe a natural cold wake. Show honest starting/unavailable/failed/ready UI and preserved unsaved input; no mutation replay. Do not run a keep-alive tunnel.

Until all hosted checks pass, end with: "The local production image and browser workflow are verified. Cloud persistence and hosted redeployment are still awaiting verification." After they pass, replace that line with the exact measured scope, release and date, retaining the engineering-data and draft-output labels. A successful demo never proves legality, physical origin or deforestation-free status.
