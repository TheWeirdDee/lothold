# Build checkpoint (engineering notes)

Resume from here if context is lost.

## Verified external facts (retrieved 2026-10-23 UTC, raw copies in research/raw/)
- EC news 13 Jul 2026: EUDR applies 30 Dec 2026 (large/medium) and 30 Jun 2027 (other micro/small). Delegated Act on Annex I scope sent for scrutiny (not yet in force at retrieval).
- DDS V3 docs + samples: namespace http://ec.europa.eu/tracesnt/certificate/eudr/due-diligence-statement/v3. WSDL + 7 XSDs fetched from https://eudr.webcloud.ec.europa.eu/tracesnt/ws/EUDRDueDiligenceStatementServiceV3?wsdl (research/raw/wsdl/).
- EUDR GeoJSON description (updated 17 Aug 2026): WGS84 lon/lat, Point/MultiPoint/Polygon/MultiPolygon/GeometryCollection, no holes, no self-crossing, truncation to 6 decimals, points default 4 ha, >4 ha needs polygon (non-cattle), 25 MB limit.
- Hansen GFC-2025-v1.13 (CC BY 4.0) lossyear + datamask tile 10N_010W; JRC GFC2020 V4 tile N10_W10 (no limitations on use, citation required). All EPSG:4326, PixelIsArea, origin (-10,10). Hansen 0.00025 deg; JRC 1/12000 deg (exactly 3x3 per Hansen pixel).
- GFW Data API query requires API key (not available). EUR-Lex blocked by bot challenge; OJ texts obtained via the Publications Office cellar on 2026-10-24.
- Sepolia publicnode RPC works. Reserve costs ~599k gas on Sepolia vs ~151k on anvil.

## Done
- contracts/src/BatchReservations.sol + 18 forge tests passing.
- Sepolia deployment 0x1645604d915c55cfd61cf1492ad58ab5e4150b57; engineering verification PASS (docs/evidence/chain-engineering-sepolia.json).
- Keys in .env only (CHAIN_DEPLOYER_KEY, CHAIN_ACTOR_A_KEY, CHAIN_ACTOR_B_KEY). Never print.
- core/quantity.ts, core/geometry.ts.

## Git policy
Local commits authorized, one file per commit, NO co-author trailers. No push/deploy/submit.

## Progress (2026-10-24 ~08:20 UTC)
- Backend (Hono + node:sqlite), rules, env analysis, uploads, extraction (label parser + provider adapters), PDFs, XSD-validated XML, chain anchoring module, React UI: implemented.
- Tests: vitest 56/56 (unit + integration), forge 18/18, playwright 4/4.
- Fixed during testing: XFF rate-limit bypass, Plex Mono font crash (Courier now), focus-on-first-load a11y bug, injection-quote acceptance, zero-area on bowtie, precision false-positive.
- Remaining: chain reconciliation test on anvil, PDF visual review, docs, commits.
