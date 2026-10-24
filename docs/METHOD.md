# Environmental interpretation method

Implementation: `server/env/forest.ts` (method version `forest-analysis/2026-10-24.4`).

## Inputs

- A plot geometry that has already passed validation (`core/geometry.ts`): WGS 84 longitude/latitude, closed rings, no self-intersection, no holes, coordinates in range, and for points a declared `Area` ≤ 4 ha.
- Three local rasters, each verified against a pinned SHA-256 at server start (`server/handlers.ts → verifyDatasets`). If verification fails, analysis jobs fail visibly and plots show *Analysis failed*; nothing is inferred.

## Procedure

1. **CRS and grid checks.** The raster must declare EPSG:4326, PixelIsArea, origin (−10°, 10°) and the expected resolution; otherwise it is refused. GeoJSON is already EPSG:4326, so no reprojection is performed. Files that declare any other CRS are rejected at upload with a request to convert them.
2. **Coverage.** A plot whose bounding box lies outside lon −10…0, lat 0…10 is `PLOT_OUTSIDE_COVERAGE`. A plot extending beyond the tile, or containing Hansen no-data pixels, cannot be `NO_POST_2020_LOSS_OBSERVED`.
3. **Sampling.** Every 30 m Hansen pixel whose centre lies inside the polygon is sampled. The polygon is treated as a closed set: a centre on the boundary (within 1e-10°) counts as inside, so edge cases are deterministic. A point plot, or a polygon too small to contain a pixel centre, samples the single pixel containing the point or centroid, and `sampling` records which rule applied.
4. **Per-pixel reading.** Datamask (0 no data, 1 land, 2 water); loss year (0 none, n = 2000+n); and the 9 JRC sub-pixels nested in it (count of forest = 1).
5. **Area.** Exact WGS 84 ellipsoidal area of each lon/lat cell, `a²/2 · Δλ · (q(φ₂) − q(φ₁))` (Snyder's authalic q). Polygon areas use the authalic-latitude mapping of WGS 84. Pixel-count totals remain approximations of mapped extent (UMD usage note), not statistically valid area estimates.
6. **Classification** (shown on the map):
   - loss 2021–2025 on a pixel with any JRC 2020 forest
   - loss 2021–2025 with no JRC forest
   - loss 2001–2020 (context only)
   - JRC forest 2020 with no loss (majority of sub-pixels forest)
   - non-forest with no loss
   - water
   - no data

## Status values

| Status | Condition | Meaning in the review |
|---|---|---|
| `NEEDS_HUMAN_REVIEW` | Any sampled land pixel with loss year 2021–2025 | Land-change signal after the 31 Dec 2020 cut-off. Needs investigation; not a finding of deforestation. |
| `NO_POST_2020_LOSS_OBSERVED` | Fully covered, no 2021–2025 loss | No annual loss observed in the covered interval. **Not** proof of deforestation-free status. |
| `PARTIAL_COVERAGE` | No post-2020 loss in covered part, but no-data pixels or outside-tile area | Uncovered part cannot be assessed |
| `PLOT_OUTSIDE_COVERAGE` | Outside the tile | No inference |
| `UNAVAILABLE` | Too large to analyse (> 0.25°), no pixel sampled, or read error | No inference |
| `PLOT_GEOMETRY_INVALID` | Geometry failed validation | Not analysed until corrected |

These map to the readiness dimension *Land evidence*. Only `NO_POST_2020_LOSS_OBSERVED` on every declared plot, or reviewer investigations recorded **with rationale (≥ 40 characters) and an evidence file**, allow sign-off. A reviewer decision is bound to the specific analysis result ID; a new geometry or method version voids it.

## What this does not show

- Annual Hansen loss includes clearing for any reason, fire, logging, plantation or cocoa replanting cycles, and classification error. It is not legal deforestation under the EUDR.
- It is not a near-real-time alert: no day, month or confidence.
- The JRC 2020 map is a single epoch with its own errors and does not say when or why tree cover changed.
- Cloud cover, sub-pixel clearing and degradation can be missed.
- Results are computed from local snapshots at the time shown; this is not live monitoring.

## Independent cross-check (GDAL / pyproj)

`scripts/gis-crosscheck.py` (requires `pip install rasterio pyproj shapely numpy`) recomputes the analysis outside LotHold and writes `docs/evidence/gis-crosscheck.json`. Run on 24 October 2026 with rasterio 1.5.2 / GDAL 3.12.2 / pyproj 3.8.0:

- **Grids:** EPSG:4326 for all three rasters; identical origin; JRC resolution exactly one third of Hansen (3×3 nesting); lossyear and datamask grids identical; no declared nodata value (Hansen no data comes from the datamask).
- **Value domains** in four windows: JRC values {0, 1} only; datamask values within {0, 1, 2} (water present in the coastal window); loss codes 0–25, maximum 25, meaning 2000+n.
- **Six polygons** (boxes, a concave polygon, a coast/lagoon polygon, a ~1 ha polygon):
  - LotHold's pixel counts, land/water/no-data split and loss-year histogram match an independent re-implementation of the same pixel-centre rule **exactly**.
  - GDAL's own rasteriser differs only on 12 pixels of the concave polygon, all with centres exactly on an edge (a tie-breaking convention), and on none away from edges.
  - Sampled, forest and post-2020 loss areas agree with WGS 84 geodesic cell areas, and polygon areas with `pyproj.Geod`, to within 0.02 % (most within 0.0003 %).
- **Defects this check found and fixed:**
  - Areas were 0.43 % high (spherical model). They are now ellipsoidal.
  - Pixels with centres exactly on an edge were classified by floating-point noise. They are now deterministic.

## Reproducing a result

```bash
npm run data:verify                          # confirms the three pinned files
node scripts/probe-area.ts -7.2 5.75 0.009   # prints the full analysis for a coordinate box (engineering probe)
```

Each stored result records the method version, dataset versions and SHA-256 values, the sampling rule, pixel counts by class, and the analysis timestamp.
