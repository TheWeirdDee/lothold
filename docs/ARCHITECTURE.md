# Architecture decisions and trust boundaries

## Shape

```
web/ (React 19 + Vite)  ──HTTP/JSON──▶  server/ (Hono on Node 24)
                                          ├─ core/            pure, deterministic rules (no I/O)
                                          ├─ server/db.ts     SQLite (node:sqlite), migrations, append-only triggers
                                          ├─ server/jobs.ts   durable job queue (leases, retries) in SQLite
                                          ├─ server/env/      raster analysis on pinned local GeoTIFFs (geotiff.js)
                                          ├─ server/ai/       extraction: label parser + provider adapters
                                          ├─ server/dds/      DDS V3 XML builder + official XSD validation (libxml2/wasm)
                                          ├─ server/documents.ts  PDFs (pdfkit) bound to snapshot digests
                                          └─ server/chain/    viem client for the Sepolia registry (server-side keys)
contracts/ (Foundry, Solidity 0.8.28)
```

## Decisions

| # | Decision | Why | Trade-off |
|---|---|---|---|
| 1 | **One Node process, SQLite (WAL)** instead of Postgres + separate services | Smallest setup that is still relational and transactional; nothing to provision; `BEGIN IMMEDIATE` serialises inventory writes | Single-writer; horizontal scaling would need Postgres (`SELECT … FOR UPDATE`). The rules core and schema port directly. |
| 2 | **Hono + Vite React SPA** rather than Next.js (PRD suggestion) | No server rendering is needed; fewer moving parts; the API is the product boundary | No SSR or SEO for the workspace (not required) |
| 3 | **Node 24 type stripping**, no server build step | `node server/main.ts` runs the source that was tested | Only erasable TypeScript syntax is allowed (enforced by `erasableSyntaxOnly`) |
| 4 | **Integer grams** for all conserved quantities; decimal strings parsed by hand; commas rejected | No floating point in inventory; "1,000" is ambiguous | Users must re-enter comma-formatted values |
| 5 | **Local pinned raster snapshots** (SHA-256 verified at startup) instead of a live API | GFW query API requires a key; local files are reproducible and auditable | One tile of coverage; annual data only; files must be fetched once (~431 MB) |
| 6 | **Pixel-centre sampling** on the 30 m Hansen grid, with exact 3×3 nesting of JRC 10 m pixels | Same origin and integer resolution ratio, so no resampling or reprojection | Plots smaller than a pixel are sampled as one pixel (stated in the result) |
| 7 | **Evidence snapshot digest** (canonical SHA-256 over fields, file hashes, analysis result IDs, ledger, decisions, findings) | One comparison detects any change that invalidates sign-off and documents | Unrelated cosmetic changes to rule text can also invalidate (via findings keys/severity) |
| 8 | **Durable jobs in SQLite** with leases | Environmental analysis and chain writes survive restarts; no fire-and-forget | Polling worker (400 ms) |
| 9 | **Chain after database**, never "atomic" | Database reservation is transactional; chain anchoring mirrors it via recorded, idempotent steps; chain state is read back and shown | Two states can diverge; divergence is detected and displayed, not hidden |
| 10 | **Server-held testnet keys, per-organisation enablement** | Visitors never sign; a public visitor cannot drain the test signer or touch another organisation's batches | On-chain addresses identify the pilot signers, not individual reviewers |
| 11 | **XML only after sign-off and only if XSD-valid + base64 round-trip** | libxml2 accepts some invalid base64 (the official sample's placeholder passes), so content is checked independently | Business-rule validation by the EU system is out of reach |
| 12 | **Built-in Courier for monospace PDF text** | The Plex Mono builds crash fontkit's layout on some glyph sequences (reproduced) | Slightly plainer monospace in PDFs |

## Separation of concerns (8 kinds of data)

| Concern | Where | Mutability |
|---|---|---|
| Uploaded source bytes and provenance | `uploads` (+ encrypted files) | Immutable (trigger blocks changes to hash/key/bytes); duplicates de-duplicated by SHA-256 |
| Extracted candidate fields | `extractions` | Append-only records; never applied without acceptance |
| Human-confirmed business records | `confirmations`, `shipment_field_values`, `source_lots` | Append-only revisions; first declared lot total immutable |
| Environmental observations | `env_results` keyed by geometry hash + method version + dataset key | Write-once cache |
| Deterministic findings | computed on read by `core/rules.ts` | Never stored as editable state |
| Review decisions | `review_decisions` | Append-only (trigger); bound to the analysis result they address |
| Shared allocation transactions | `allocations`, `chain_txs` | Ledger rows released only by superseding source revisions; chain steps idempotent |
| Generated document snapshots | `documents` (+ encrypted files) | Immutable; flagged stale when the digest changes |

## Trust boundaries

1. **Browser ↔ server**: session cookie (HttpOnly, SameSite=Strict, Secure in production), CSRF token header, Origin check, rate limits, 1 MB JSON and 26 MB upload body limits, CSP on HTML.
2. **Organisation ↔ organisation**: every query filters by `org_id`; unknown and foreign IDs both return 404; signed download links are bound to the issuing user and expire after 5 minutes.
3. **Uploaded content ↔ logic**: files are untrusted; parsers never execute content; document text sent to a model is delimited, and model output is schema-validated and span-checked server-side.
4. **Server ↔ model provider**: only the document text and a fixed prompt are sent; no other records; outcomes are logged without document text.
5. **Server ↔ public testnet**: only hashes, batch/allocation keys (keccak of internal IDs) and gram quantities are written; no names, plots or documents.
6. **Data at rest**: evidence AES-256-GCM encrypted with an organisation-bound AAD; secrets only in `.env`.
