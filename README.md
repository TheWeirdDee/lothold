# LotHold

**An evidence-review desk for cocoa shipments.** LotHold shows a reviewer which plot or source-lot record is missing or contradictory, where published satellite data records tree-cover loss after 2020 inside a declared plot, and which source lots are allocated beyond their declared quantity. It then drafts a specific evidence request for the supplier and, after human sign-off, an EUDR DDS V3 XML draft validated against the official schema.

LotHold does **not** certify sourcing, legality, deforestation-free status, land rights or physical origin, and it never submits anything to the EU Information System.

![Review desk: findings for a held shipment (engineering test data)](docs/screenshots/desk-crop-1440.png)

*Screenshots show the running application with clearly labelled **engineering test fixtures** (suppliers, lots and plots prefixed `ENG-`). Plot boundaries in them are coordinate probe boxes, not farms. The environmental results shown for those boxes are real dataset readings for those coordinates.*

## Why it exists

The EU Deforestation Regulation names cocoa among seven “commodities associated with deforestation” and applies from **30 December 2026** for large and medium operators (European Commission, 13 July 2026). Due diligence depends on plot-level geolocation. If a plot is missing, a boundary is invalid, or a source lot is allocated twice, nobody can check what happened on that land. LotHold turns those gaps into concrete, source-referenced requests before shipment paperwork moves on.

## Current status (24 October 2026)

| Capability | Status | Evidence |
|---|---|---|
| Upload → parse → preview → confirm (CSV source table, GeoJSON plots) | Working | Browser + integration tests |
| Deterministic rules: required fields, HS 1801 scope, ISO countries, exact fixed-point quantities, unit conversion, allocation conservation, geometry validity (EUDR GeoJSON rules), coverage, staleness | Working | 40 unit tests |
| Environmental analysis on **real** pinned rasters (Hansen GFC v1.13 annual loss 2001–2025; JRC GFC2020 V4 forest 2020) with pixel-level intersection and WGS 84 ellipsoidal areas | Working for lon −10…0, lat 0…10 (Côte d’Ivoire and western Ghana) | Unit tests on real rasters; independent GDAL/pyproj cross-check; [method](docs/METHOD.md) |
| Review decisions (rationale + evidence required), sign-off bound to an evidence snapshot digest, automatic invalidation | Working | Integration + browser tests |
| One-page supplier evidence request PDF; review draft PDF | Working, rendered and visually inspected | [screenshot](docs/screenshots/supplier-request-pdf.png) |
| DDS V3 `SubmitDdsRequest` XML, validated against the **official XSD set** (7 schemas, imports resolved) | Working; only after sign-off; marked `DRAFT_NOT_SUBMITTED` in the filename | XSD positive/negative tests |
| Field extraction from documents | **Label parser (deterministic, not AI)** verified. A Gemini key (OpenAI-compatible endpoint) is configured and authenticates, but live model extraction is **not yet verified**: the free-tier daily quota was exhausted (HTTP 429). The labelled fallback was verified live | [docs/AI.md](docs/AI.md) |
| Allocation registry contract | Deployed on **Ethereum Sepolia** `0x1645604d915c55cfd61cf1492ad58ab5e4150b57`; two-actor excess rejection verified on the public testnet | [docs/CHAIN.md](docs/CHAIN.md) |
| In-app anchoring of ledger reservations on Sepolia | Verified with engineering fixtures (6 confirmed transactions, read back from the contract) | `docs/evidence/app-anchoring-sepolia.json` |
| Real commercial shipment records | **Not available.** The workspace starts empty; no real shipment has been processed | — |

## Run it locally

Requirements: Node.js ≥ 24 (uses built-in `node:sqlite` and TypeScript type stripping), pnpm, about 450 MB of free disk for the raster snapshots. Foundry is optional (only for contract tests).

```bash
pnpm install
npm run setup          # creates EVIDENCE_ENCRYPTION_KEY and DOWNLOAD_SIGNING_KEY in .env (never printed)
npm run data:fetch     # downloads the 3 public raster tiles (~431 MB) and verifies their SHA-256 pins
npm run build          # builds the web client into dist/
npm start              # http://127.0.0.1:8787
```

For development, run `npm run dev` and open http://localhost:5173. It starts the API (port 8787, reloads on change) and the Vite web server (port 5173, proxying /api) together; Ctrl+C stops both. Run `npm run setup` and `npm run data:fetch` once beforehand.

The database is created and migrated on first start (`data/lothold.sqlite`, SQLite with WAL and foreign keys). Uploaded evidence is encrypted (AES-256-GCM) under `data/evidence/`. Back up `EVIDENCE_ENCRYPTION_KEY`: evidence cannot be decrypted without it.

Optional configuration is documented in [.env.example](.env.example): model provider, testnet anchoring, registration switch, proxy trust.

### Using it

1. Create a workspace (one organisation per workspace; data is private to it).
2. Create a case with your internal shipment reference.
3. Enter shipment details, or upload a shipping document and accept proposed fields that quote the document.
4. Upload the source-lot CSV ([blank template](http://127.0.0.1:8787/api/templates/sources.csv)) and plot GeoJSON, review the parsed preview, and confirm.
5. Work through **Findings**. Each one links to its file, row, column or plot. Land-change signals need a written investigation **and** an evidence file before they stop blocking.
6. Reserve allocations, sign off the evidence snapshot, then export the documents.

Public pages need no login: **Inspect forest evidence** (runs the real analysis on any area you enter; nothing is stored), **Method & sources**, and **Testnet registry**.

## Verify

```bash
npm run typecheck        # TypeScript (tsc 7) over server, core, web, scripts, tests
npm test                 # vitest: unit + integration (66 tests; includes real-raster, backup/restore and Anvil chain tests)
npm run test:contracts   # forge: 18 contract tests incl. 512-run fuzz (first: cd contracts && forge install foundry-rs/forge-std --no-git)
npm run test:e2e         # Playwright (Chrome): 6 browser journeys on a throwaway database
npm run data:verify      # re-hashes the raster snapshots against the pinned SHA-256 values
python scripts/gis-crosscheck.py   # independent GDAL/pyproj recomputation (pip install rasterio pyproj shapely numpy)
```

Results, scope and what each layer does and does not prove are listed in [docs/VERIFICATION.md](docs/VERIFICATION.md) and classified in [docs/EVIDENCE.md](docs/EVIDENCE.md).

## Documentation

- [Architecture decisions and trust boundaries](docs/ARCHITECTURE.md)
- [Data sources, licences and retrieval register](docs/SOURCES.md)
- [Environmental interpretation method](docs/METHOD.md)
- [AI extraction behaviour and secure credential setup](docs/AI.md)
- [Allocation registry: contract, addresses, transactions, trust assumptions](docs/CHAIN.md)
- [Verification record and known limitations](docs/VERIFICATION.md)
- [Requirement checklist](docs/CHECKLIST.md)
- [Evidence classification](docs/EVIDENCE.md)
- [Deployment plan, costs, backup and recovery](docs/DEPLOYMENT.md)
- [Hackathon submission materials and recording script](docs/SUBMISSION.md)

## Scope

Product scope is verified against the Official Journal texts of Regulation (EU) 2023/1115 and Regulation (EU) 2025/2650 (Publications Office, retrieved 24 October 2026). Annex I lists cocoa under HS 1801–1806. LotHold supports **only HS 1801 (cocoa beans)** and only the plot-geolocation path. It does not support the postal-address option that Art. 4a(5) gives micro and small primary operators, or the July 2026 Delegated Act on Annex I (which was under scrutiny at retrieval). A schema-valid geometry or XML file passes a format check; it is not a compliance determination.

## Limitations

- **No real shipment has been processed.** All end-to-end runs used labelled engineering fixtures. Verifying the commercial workflow needs a permissioned, anonymised source table and plot file from an actual exporter.
- Environmental coverage is one 10°×10° tile. Plots elsewhere are reported as *outside coverage*, never as clear.
- Hansen loss is **annual** (year only, no confidence); it is not a near-real-time alert system such as RADD or GLAD. GFW alert APIs require an API key that was not available.
- A loss signal is not legal deforestation; a no-loss result is not proof of deforestation-free status.
- XML validity means the official XSD accepts it. EU business rules (EORI checks, geolocation checks) apply only on an authorised submission, which LotHold does not perform.
- The testnet registry enforces conservation only for batches registered in it, keyed per organisation. It cannot detect the same cocoa declared under a different key, or allocations recorded elsewhere. In this pilot the server holds the testnet signing keys.
- Once downloaded, a document cannot be recalled. Newer evidence marks it *out of date* in the app only.
