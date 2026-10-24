# data/

Runtime data. Everything here except this file is git-ignored.

- `snapshots/`: public raster tiles fetched by `npm run data:fetch` and verified against pinned SHA-256 values (see `docs/SOURCES.md`):
  - Hansen GFC-2025-v1.13 `lossyear` and `datamask`, tile 10N_010W (CC BY 4.0)
  - JRC GFC2020 V4, tile N10_W10 (no restriction of use; citation required)
- `lothold.sqlite`: the operational database, created empty on first start.
- `evidence/`: uploaded evidence and generated documents, encrypted with `EVIDENCE_ENCRYPTION_KEY`.

The operational database starts empty. Engineering fixtures in `tests/fixtures/engineering/` are only loaded into temporary test databases.
