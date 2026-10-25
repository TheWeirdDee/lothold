# Requirement checklist

Status: **Verified** (tested, with evidence) · **Implemented** (built, not independently verified) · **Blocked** (needs an external input) · **Deferred** (deliberately out of scope).

| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Data feasibility | Official EUDR dates, Annex I scope and definitions verified from primary sources | Verified | EC 13 Jul 2026 page; OJ texts of Reg. 2023/1115 and 2025/2650 via Publications Office; SOURCES.md |
| | Official DDS V3 schema obtained and used for validation | Verified | `server/dds/schema/`, XSD tests |
| | Real environmental dataset retrieved, licensed, pinned, spatially queried | Verified | METHOD.md, real-raster unit tests |
| | Genuine cocoa plots / permissioned shipment records | **Blocked** | None available; workspace empty |
| | Working testnet RPC and secure signing | Verified | Sepolia transactions, CHAIN.md |
| | Model provider | **Blocked** | Gemini key configured; live extraction unverified (503, then 429 quota exhausted); label parser used and labelled |
| Architecture | React/TS web app, server-side validation, relational storage, private evidence storage | Verified | ARCHITECTURE.md, tests |
| | Deterministic rules; environmental adapter; extraction adapter with fallback; document generation; registry; append-only audit | Verified (model path Implemented) | tests |
| | Fixed-point quantities with original units | Verified | unit tests |
| | Versioned rules, analysis method, datasets, parser and extraction config | Verified | versions shown in UI and stored records |
| Frontend | Restrained design tokens, readable tables, no fake content | Verified (visual review) | docs/screenshots |
| | Every hold links to row/page/geometry; original vs normalised shown | Verified | browser test (row highlight) |
| | Distinct loading / unavailable / pending / rejected / incomplete / reviewed / stale states | Verified | badges; integration tests |
| | 360/390/768/1024/1440 widths; no page-wide overflow | Verified | walkthrough overflow check |
| | Keyboard, focus, touch targets, reduced motion | Verified (partial) | skip link and focus tests; 40 px targets; reduced-motion CSS. No screen-reader audit performed |
| Ingestion | CSV + GeoJSON with validation, hashing, private storage, provenance, preview, confirmation | Verified | integration + browser tests |
| | PDF/text extraction | Verified (text layer only; no OCR, stated) | tests |
| | Idempotent duplicates; revisions never overwrite; approvals invalidated | Verified | tests |
| Rules | Required fields, HS scope, ISO codes, quantity precision/conversion/positivity, allocation conservation, geometry validity/type/order/bounds/CRS/self-intersection/limits, relationships, coverage, freshness | Verified | unit tests |
| | Separate record / environment / allocation dimensions; transparent overall | Verified | status strip |
| | No-data / outside / no-alert never the same green state | Verified | unit test |
| | Material environmental finding needs rationale + evidence | Verified | unit + integration + browser |
| Environment | CRS, units, intersection, no-data, date semantics, coverage, observation vs retrieval, caveats | Verified | METHOD.md; independent GDAL/pyproj cross-check |
| | Near-real-time alerts | **Blocked / deferred** | GFW requires API key; annual loss used and labelled |
| AI | Strict schema, span check, human confirmation, no model authority, adversarial tests | Verified (with injected model output) | tests |
| | Live model call | **Blocked** | no credentials |
| Blockchain | Registration authority, authorised reservers, positive integers, unique IDs, conservation, events, evidence commitments | Verified | forge tests |
| | Two-actor shared-state behaviour on public testnet | Verified | CHAIN.md |
| | Lifecycle: preflight vs mined revert, pending, confirmation, reconciliation, no double allocation | Verified | Anvil integration test, Sepolia runs |
| | Server signing access-controlled and rate-limited | Verified | 403 test; per-organisation flag |
| Backend | Auth, server-side authorisation, cross-org tests, migrations, constraints, indexes, transactional inventory, signed expiring downloads, rate limits, durable jobs, structured logs | Verified | integration tests |
| Documents | One-page supplier request rendered and inspected | Verified | PDF rasterised (colour/grey) |
| | Review draft with provenance | Verified | rendered |
| | DDS XML only after official-schema validation; draft marker outside envelope | Verified | tests |
| Testing | Unit, integration, contract, browser, real-data, testnet | Verified | VERIFICATION.md |
| Docs | README, .env.example, architecture, sources/licences, method, AI, chain, verification, submission, recording script | Verified | this folder |
| Delivery | Production start path, persistent storage, dataset provisioning, backup/restore, deployment plan with costs | Verified (container built and recovery-tested locally) | DEPLOYMENT.md; `docs/evidence/container-verification.json`; backup test |
| | Local commits, one file per commit, no co-author trailers | Done | `git log` |
| | Push | Done for commits up to `a9abd0d` (authorised 24 Oct); later commits local until authorised | `git log` |
| | Hosted backend | **Not hosted.** A frontend-only copy exists on Vercel; it shows a "server not running" notice | DEPLOYMENT.md |
| | Submit | Not done; awaiting the entrant | — |
