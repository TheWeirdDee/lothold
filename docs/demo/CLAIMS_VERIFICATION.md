# Claims and workflow verification

The hosted validation passed all **16 steps**, including real sign-off, DDS XML draft generation, and evidence-change invalidation. See [workflow results](../evidence/demo-workflow-validation.json). The separate recording completed eight scenes without recorded errors: [recording timeline](../evidence/demo-recording-timeline.json).

| Claim shown | Evidence and limit |
|---|---|
| Workspace and case creation | ENGINEERING TEST - DEMO / ENG-DEMO-A; actual hosted registration and case transitions |
| Shipping text extraction | Deterministic label parser, quoted proposals and explicit human acceptance; no AI inference claimed |
| Source and plot uploads | Real CSV/GeoJSON requests, preview and active-version confirmation |
| Source-linked missing boundary | Partial engineering geometry file creates the finding; exact source row is highlighted |
| Satellite observations | Pinned Hansen/JRC readings: 47 of 1600 sampled pixels after 2020, about 3.59 ha; no JRC-2020 forest overlap for this probe. Cached results can be reused; probe boxes are not farms |
| Supplier request PDF | Actual generated and downloaded PDF, source references and limits visible |
| Investigation | Labelled test attachment and rationale; no real sourcing conclusion asserted |
| Allocation reservation | Declared fixture quantity reserved in the local ledger; no public blockchain transaction |
| Snapshot sign-off | Real REVIEWED DRAFT transition after the application permits it |
| XML draft | Actual DDS-V3 DRAFT_NOT_SUBMITTED download; server validates the draft before offering it. XML was not submitted to an authority |
| Stale sign-off | A real accepted description change creates Out of date state and disables XML export |
| Hosted evidence recovery | Earlier independent restart/redeployment checks in [hosted evidence](../evidence/hosted-workflow.json); narrated as previous pilot evidence, not shown as a newly filmed restart |

No requested core demo workflow was blocked or replaced with a mock success. A cold-start experiment, sustained load/capacity, provider quota telemetry, and regulatory acceptance are outside the video. No physical-origin, legality, adoption or environmental-impact result is asserted.

PDF/XML preview views use presentation-only browser routes to display the actual downloaded bytes. They do not replace business API responses or create documents. The stored XML is also downloaded again and checked independently: [final artifact check](../evidence/demo-artifacts-final.json).
