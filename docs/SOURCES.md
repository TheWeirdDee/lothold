# Data sources, licences and retrieval register

All retrievals were made from the build environment on **23 October 2026 (UTC)** unless noted. Raw copies were kept locally and are not committed (third-party content); their SHA-256 values are listed in [research/RETRIEVAL.md](../research/RETRIEVAL.md).

## Regulatory and format sources

| Source | URL | Retrieved | What was verified | Used for |
|---|---|---|---|---|
| European Commission news, 13 July 2026 | https://environment.ec.europa.eu/news/commission-updates-product-scope-and-tools-support-eudr-2026-07-13_en | 2026-10-23 | Page exists. Application from **30 Dec 2026** (large/medium; micro/small already under EUTR) and **30 Jun 2027** (other micro/small). A Delegated Act updating Annex I was sent for scrutiny; new products apply from 30 Dec 2027. Cocoa is listed among seven "commodities associated with deforestation". | Dates and context in UI and docs |
| EUDR IS Operator API — DDS V3 reference | https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/api/due-diligence-statement-v3.html | 2026-10-23 | Field list, cardinality, `geometryGeojson` as base64Binary, 6-decimal coordinates, polygons for plots > 4 ha (except cattle), reference/verification numbers assigned by the IS | XML mapping |
| DDS V3 samples | …/operator/samples/dds-samples.html | 2026-10-23 | Official `submitDds` sample (wood product, HS 4410); cocoa grouped sample with HS 1801 and *Theobroma cacao* | XSD positive control (`tests/fixtures/engineering/official-sample-submitDds-body.xml`) |
| DDS V3 WSDL + XSD set | https://eudr.webcloud.ec.europa.eu/tracesnt/ws/EUDRDueDiligenceStatementServiceV3?wsdl (and `?xsd=1…7`) | 2026-10-23 | 7 schemas across 7 namespaces fetched recursively; vendored in `server/dds/schema/` with only `schemaLocation` rewritten to local names (original SHA-256 values in `MANIFEST.json`) | XML validation |
| EUDR GeoJSON file description ("Updated 17 August 2026") | …/operator/geojson-description.html | 2026-10-23 | WGS 84 lon/lat; accepted types; no holes or crossings; truncation to 6 decimals; point Area defaults to 4 ha; 25 MB limit; property names | Geometry rules |
| EUDR API and UI validation rules | …/operator/validation-rules.html | 2026-10-23 | Positive quantities; net mass mandatory for IMPORT/EXPORT; EORI required for IMPORT/EXPORT; ≤ 100 commodities per DDS | Rules and notes |
| Regulation (EU) 2023/1115, Official Journal L 150, 9.6.2023 | Publications Office cellar: https://publications.europa.eu/resource/celex/32023R1115 (XHTML and PDF; EUR-Lex itself returned a bot challenge) | 2026-10-24 | Annex I cocoa entries HS 1801–1806; Art. 2(3) deforestation, (4) forest, (13) deforestation-free with the 31 Dec 2020 cut-off, (27) plot of land, (28) geolocation (≥ 6 decimals; polygons > 4 ha except cattle) | Product scope, definitions |
| Regulation (EU) 2025/2650, OJ L series, 23.12.2025 | https://publications.europa.eu/resource/celex/32025R2650 | 2026-10-24 | Amends Art. 38: obligations from 30 Dec 2026, from 30 Jun 2027 for micro/small operators established by 31 Dec 2024. Inserts Art. 4a (simplified declaration; postal address may replace geolocation for micro/small **primary** operators). Annex I: only the printed-products line deleted; cocoa entries unchanged | Dates; scope qualification |
| Consolidated version | https://publications.europa.eu/resource/celex/02023R1115-20251223 | 2026-10-24 | **Not found** (404). The two acts above were read together instead | — |

### Scope qualification

LotHold supports one Annex I entry (HS 1801, cocoa beans) and the geolocation path only. It does not support HS 1802–1806, the postal-address alternative for micro and small primary operators (Art. 4a(5)), or the July 2026 Delegated Act on Annex I (sent for scrutiny; not applied). Schema validity of XML or GeoJSON is a format check, not a compliance determination.

### Discrepancies recorded

- The **validation rules page** says at most 100 commodities per DDS; the **XSD** allows `maxOccurs="200"`. LotHold emits exactly one commodity, so it is unaffected.
- The official sample's `<geometryGeojson>BASE64_ENCODED_GEOJSON</geometryGeojson>` placeholder **passes** libxml2's `base64Binary` check. XSD validity therefore does not prove the base64 content is valid; LotHold adds a decode round-trip check.
- The Hansen download page describes `lossyear` values as "1-20" while the same release covers 2001–2025. Real pixel reads contain values up to 25, consistent with 2025 (tests assert years ≤ 2025).
- Annual Hansen loss must not be described as an "alert". The UI says "annual tree-cover loss" and "land-change signal".

## Environmental datasets (installed snapshots)

| Dataset | Version / tile | File SHA-256 (pinned) | Resolution | Temporal meaning | Licence | Citation |
|---|---|---|---|---|---|---|
| Hansen/UMD/Google/USGS/NASA Global Forest Change — `lossyear` | GFC-2025-v1.13, 10N_010W (GCS object modified 2026-03-16) | `d481e6be9013093a1713e7a25f12f7b9e05e2666352216ad3b2269540f1d8b55` | 0.00025° (~30 m) | Value n = stand-replacement loss detected primarily in year 2000+n (2001–2025). Year only. | CC BY 4.0 | Hansen et al. 2013, *Science* 342:850–53; https://glad.earthengine.app/view/global-forest-change |
| Hansen GFC — `datamask` | GFC-2025-v1.13, 10N_010W | `38278ad7de7f5bf7ab8121869b7a3aa061fa5dc3df6ee14578e545f540911b03` | ~30 m | 0 no data, 1 land, 2 water | CC BY 4.0 | as above |
| JRC Global map of forest cover 2020 | Version 4 (metadata 2025-11-28), N10_W10 | `33547f277e30d957c58dae4c8ed1f81915eeb6feeaaed9fdccb4d7ece6bd53df` | 1/12000° (~9.3 m; nominal 10 m) | 1 forest, 0 non-forest, circa 2020 (FAO/EUDR forest definition) | "Free of charge, without restriction of use"; metadata "No limitations on use"; citation required | Bourgoin et al. (2026), doi:10.2905/JRC.3KATEH8 |

All three tiles share origin (−10°, 10°), EPSG:4326 and PixelIsArea; the JRC grid nests exactly 3×3 inside each Hansen pixel. Redistribution: Hansen permits redistribution with credit; JRC has no restriction of use. The repository does not include the rasters (size); `npm run data:fetch` downloads and verifies them.

### Not used

- **Global Forest Watch Data API** (RADD/GLAD/integrated alerts): querying requires an API key (`"Request is missing valid API key"` observed on 2026-10-23). No key was available, so no near-real-time alerts are used. GFW access would add dated, confidence-rated alerts; it is not required for the annual-loss analysis implemented here.
- **Basemap imagery**: none. The plot map draws only the dataset pixels that were analysed.

## Testnet

- Ethereum **Sepolia**, chain ID 11155111, public RPC `https://ethereum-sepolia-rpc.publicnode.com` (responded `eth_chainId = 0xaa36a7` on 2026-10-23).
- Explorer links point to https://sepolia.etherscan.io.

## Hackathon

- Overview: https://ieee-climatechain-hack.devpost.com/ and detailed rules: …/rules (both retrieved 2026-10-23). See [SUBMISSION.md](SUBMISSION.md) for the eligibility contradiction and deadline wording.
