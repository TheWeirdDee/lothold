// Environmental evidence: pixel-level intersection of a plot geometry with pinned local raster snapshots.
//  - Hansen/UMD Global Forest Change v1.13: ANNUAL tree-cover loss year (2001–2025), 30 m. Not an alert system.
//  - Hansen datamask: land / water / no data.
//  - JRC Global Forest Cover 2020 V4: forest / non-forest circa 2020, 10 m (EUDR cut-off context).
// Results are investigation signals; they are not legal determinations of deforestation.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromFile, type GeoTIFF, type GeoTIFFImage } from 'geotiff';
import { interiorPoints, pointInGeometry, type PlotGeometry } from '../../core/geometry.ts';
import { cellAreaM2 } from '../../core/ellipsoid.ts';

export const ANALYSIS_METHOD_VERSION = 'forest-analysis/2026-10-25.2';
export const CUTOFF_YEAR = 2020;
/** Latest year of annual loss in the pinned Hansen GFC v1.13 tile (loss years 2001–2025). */
export const LATEST_LOSS_YEAR = 2025;
const MAX_BBOX_DEG = 0.25; // ~27 km; plots larger than this are refused rather than silently sampled.

export type DatasetId = 'hansen_lossyear' | 'hansen_datamask' | 'jrc_gfc2020';

export type DatasetSpec = {
  id: DatasetId;
  title: string;
  version: string;
  file: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
  pixelDeg: number;
  resolutionLabel: string;
  temporalCoverage: string;
  dateSemantics: string;
  license: string;
  citation: string;
  credit: string;
  publishedOrModified: string;
};

const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data/snapshots');

export const DATASETS: Record<DatasetId, DatasetSpec> = {
  hansen_lossyear: {
    id: 'hansen_lossyear',
    title: 'Hansen/UMD/Google/USGS/NASA Global Forest Change — year of gross forest cover loss',
    version: 'GFC-2025-v1.13, tile 10N_010W',
    file: 'Hansen_GFC-2025-v1.13_lossyear_10N_010W.tif',
    sourceUrl: 'https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/Hansen_GFC-2025-v1.13_lossyear_10N_010W.tif',
    sha256: 'd481e6be9013093a1713e7a25f12f7b9e05e2666352216ad3b2269540f1d8b55',
    bytes: 127_404_260,
    pixelDeg: 0.00025,
    resolutionLabel: '1 arc-second (~30 m at the equator)',
    temporalCoverage: 'Annual loss years 2001–2025',
    dateSemantics:
      'Value n = stand-replacement loss detected primarily in year 2000+n. Year-level only: no day, month or confidence. Not a near-real-time alert.',
    license: 'CC BY 4.0',
    citation:
      'Hansen, M. C. et al. 2013. High-Resolution Global Maps of 21st-Century Forest Cover Change. Science 342: 850–53. Data: https://glad.earthengine.app/view/global-forest-change',
    credit: 'Source: Hansen/UMD/Google/USGS/NASA',
    publishedOrModified: 'Object last modified 2026-03-16 (Google Cloud Storage header)',
  },
  hansen_datamask: {
    id: 'hansen_datamask',
    title: 'Hansen/UMD Global Forest Change — data mask',
    version: 'GFC-2025-v1.13, tile 10N_010W',
    file: 'Hansen_GFC-2025-v1.13_datamask_10N_010W.tif',
    sourceUrl: 'https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/Hansen_GFC-2025-v1.13_datamask_10N_010W.tif',
    sha256: '38278ad7de7f5bf7ab8121869b7a3aa061fa5dc3df6ee14578e545f540911b03',
    bytes: 15_293_782,
    pixelDeg: 0.00025,
    resolutionLabel: '1 arc-second (~30 m)',
    temporalCoverage: 'Static mask based on 2000–2012',
    dateSemantics: '0 = no data, 1 = mapped land surface, 2 = persistent water.',
    license: 'CC BY 4.0',
    citation: 'Hansen et al. 2013 (as above).',
    credit: 'Source: Hansen/UMD/Google/USGS/NASA',
    publishedOrModified: 'GFC-2025-v1.13 release',
  },
  jrc_gfc2020: {
    id: 'jrc_gfc2020',
    title: 'JRC Global map of forest cover 2020',
    version: 'Version 4 (metadata dated 2025-11-28), tile N10_W10',
    file: 'JRC_GFC2020_V4_N10_W10.tif',
    sourceUrl: 'https://ies-ows.jrc.ec.europa.eu/iforce/gfc2020/download.py?version=v4&type=tile&lat=N10&lon=W10',
    sha256: '33547f277e30d957c58dae4c8ed1f81915eeb6feeaaed9fdccb4d7ece6bd53df',
    bytes: 288_760_743,
    pixelDeg: 1 / 12000,
    resolutionLabel: '1/12000° (~9.3 m at the equator; product nominal 10 m)',
    temporalCoverage: 'Forest presence circa 2020 (single epoch)',
    dateSemantics: '1 = forest, 0 = non-forest, as at 2020. Does not record when any change happened.',
    license: 'Free of charge, without restriction of use; attribution required (JRC Forest Observatory licence statement).',
    citation:
      'Bourgoin, C. et al. (2026): Global map of forest cover 2020 – version 4. European Commission, Joint Research Centre. doi:10.2905/JRC.3KATEH8',
    credit: 'Source: European Commission, Joint Research Centre — GFC2020 V4',
    publishedOrModified: 'Metadata date 2025-11-28',
  },
};

/** The single 10°×10° tile available locally: lon −10…0, lat 0…10 (covers Côte d'Ivoire and western Ghana). */
export const COVERAGE_BBOX: [number, number, number, number] = [-10, 0, 0, 10];

export type EnvStatus =
  | 'UNAVAILABLE'
  | 'PLOT_GEOMETRY_INVALID'
  | 'PLOT_OUTSIDE_COVERAGE'
  | 'PARTIAL_COVERAGE'
  | 'NEEDS_HUMAN_REVIEW'
  | 'NO_POST_2020_LOSS_OBSERVED';

export type PixelClass =
  | 0 // outside plot
  | 1 // no data
  | 2 // water
  | 3 // 2020 forest (JRC), no Hansen loss
  | 4 // not forest 2020 (JRC), no Hansen loss
  | 5 // Hansen loss 2001–2020 (pre-cut-off context)
  | 6 // Hansen loss 2021+ on JRC 2020 forest
  | 7; // Hansen loss 2021+ not on JRC 2020 forest

export type ForestAnalysis = {
  status: EnvStatus;
  methodVersion: string;
  analysedAt: string;
  datasets: { id: DatasetId; version: string; sha256: string; file: string }[];
  geometryType: string;
  sampling: 'pixel_centres_in_polygon' | 'single_pixel_containing_point' | 'pixels_containing_interior_points';
  bbox: [number, number, number, number];
  coveredFraction: number;
  hansenPixels: { total: number; land: number; water: number; noData: number };
  areaHa: { sampled: number; jrcForest2020: number; postCutoffLoss: number; postCutoffLossOnJrcForest: number; preCutoffLoss: number };
  lossByYear: Record<string, { pixels: number; areaHa: number; onJrcForestAreaHa: number }>;
  firstPostCutoffLossYear: number | null;
  latestPostCutoffLossYear: number | null;
  coveredInterval: string;
  summary: string;
  limitations: string[];
  grid: { width: number; height: number; west: number; north: number; pixelDeg: number; classes: string } | null;
  error?: string;
};

const LIMITATIONS = [
  'Hansen loss is annual, stand-replacement tree-cover loss detected from Landsat; it includes clearing for any reason (agriculture, fire, logging, plantation rotation) and classification error. It is not proof of deforestation as legally defined in the EUDR.',
  'Hansen loss years are year-level only (no date, no confidence). They are not near-real-time disturbance alerts such as RADD or GLAD.',
  'The JRC 2020 forest map is a single-epoch baseline with its own map errors; it does not say when or why tree cover changed.',
  'Pixel counts are not statistically valid area estimates (UMD usage note). Areas shown are pixel-count approximations.',
  'A plot with no observed loss may still have had unobserved change (cloud cover, sub-pixel clearing, degradation).',
  'Only one local 10°×10° tile (lon −10…0, lat 0…10) is installed; plots elsewhere are reported as outside coverage.',
];

let tiffs: Partial<Record<DatasetId, { tiff: GeoTIFF; image: GeoTIFFImage }>> = {};
let datasetHashes: Partial<Record<DatasetId, string>> = {};

let verificationDone = false;
export function setDatasetHashes(h: Partial<Record<DatasetId, string>>) {
  datasetHashes = { ...datasetHashes, ...h };
}
/** Marks the startup hash verification as finished (successfully or not). */
export function markVerificationDone() {
  verificationDone = true;
}
export function isVerificationDone() {
  return verificationDone;
}

export function datasetAvailability(): { id: DatasetId; present: boolean; sizeMatches: boolean; sha256: string | null }[] {
  return (Object.keys(DATASETS) as DatasetId[]).map((id) => {
    const p = resolve(DATA_DIR, DATASETS[id].file);
    const present = existsSync(p);
    const sizeMatches = present && statSync(p).size === DATASETS[id].bytes;
    return { id, present, sizeMatches, sha256: datasetHashes[id] ?? null };
  });
}

async function open(id: DatasetId) {
  const cached = tiffs[id];
  if (cached) return cached;
  const p = resolve(DATA_DIR, DATASETS[id].file);
  if (!existsSync(p)) throw new Error(`Dataset file missing: ${DATASETS[id].file}. Run "npm run data:fetch".`);
  if (statSync(p).size !== DATASETS[id].bytes) throw new Error(`Dataset file size mismatch: ${DATASETS[id].file}`);
  const tiff = await fromFile(p);
  const image = await tiff.getImage();
  const keys = image.getGeoKeys() as { GeographicTypeGeoKey?: number; GTRasterTypeGeoKey?: number };
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  // Refuse to interpret a raster whose CRS or grid differs from the pinned specification.
  if (keys.GeographicTypeGeoKey !== 4326) throw new Error(`${id}: CRS is not EPSG:4326`);
  if (keys.GTRasterTypeGeoKey !== 1) throw new Error(`${id}: expected PixelIsArea raster`);
  if (ox !== COVERAGE_BBOX[0] || oy !== COVERAGE_BBOX[3]) throw new Error(`${id}: unexpected origin ${ox},${oy}`);
  if (Math.abs(rx! - DATASETS[id].pixelDeg) > 1e-12 || Math.abs(-ry! - DATASETS[id].pixelDeg) > 1e-12)
    throw new Error(`${id}: unexpected resolution`);
  tiffs[id] = { tiff, image };
  return tiffs[id]!;
}

export async function closeDatasets() {
  for (const t of Object.values(tiffs)) await t?.tiff.close?.();
  tiffs = {};
}

const ha = (n: number) => (n >= 10 ? n.toFixed(1) : n.toFixed(2));

function pixelAreaHa(latCentreDeg: number, pixelDeg: number): number {
  // Exact WGS 84 ellipsoidal area of a lon/lat cell.
  return cellAreaM2(latCentreDeg - pixelDeg / 2, latCentreDeg + pixelDeg / 2, pixelDeg) / 10_000;
}

function geometryBbox(g: PlotGeometry): [number, number, number, number] {
  const ps = g.type === 'Point' ? [g.coordinates] : g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2);
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ps) {
    a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y);
  }
  return [a, b, c, d];
}


async function readWindow(id: DatasetId, col0: number, row0: number, col1: number, row1: number): Promise<Uint8Array> {
  const { image } = await open(id);
  const data = (await image.readRasters({ window: [col0, row0, col1, row1], samples: [0], interleave: true })) as unknown as Uint8Array;
  return data;
}

export async function analysePlot(geometry: PlotGeometry, opts: { geometryValid: boolean; now?: Date } = { geometryValid: true }): Promise<ForestAnalysis> {
  const analysedAt = (opts.now ?? new Date()).toISOString();
  const bbox = geometryBbox(geometry);
  const datasets = (Object.keys(DATASETS) as DatasetId[]).map((id) => ({
    id,
    version: DATASETS[id].version,
    sha256: datasetHashes[id] === DATASETS[id].sha256 ? DATASETS[id].sha256 : `unverified (pinned ${DATASETS[id].sha256.slice(0, 12)}…)`,
    file: DATASETS[id].file,
  }));
  const base: ForestAnalysis = {
    status: 'UNAVAILABLE',
    methodVersion: ANALYSIS_METHOD_VERSION,
    analysedAt,
    datasets,
    geometryType: geometry.type,
    sampling: 'pixel_centres_in_polygon',
    bbox,
    coveredFraction: 0,
    hansenPixels: { total: 0, land: 0, water: 0, noData: 0 },
    areaHa: { sampled: 0, jrcForest2020: 0, postCutoffLoss: 0, postCutoffLossOnJrcForest: 0, preCutoffLoss: 0 },
    lossByYear: {},
    firstPostCutoffLossYear: null,
    latestPostCutoffLossYear: null,
    coveredInterval: `Hansen annual loss 2001–2025 (post-cut-off years ${CUTOFF_YEAR + 1}–2025); JRC forest presence 2020`,
    summary: '',
    limitations: LIMITATIONS,
    grid: null,
  };

  if (!opts.geometryValid) {
    return { ...base, status: 'PLOT_GEOMETRY_INVALID', summary: 'Not analysed: the plot geometry failed validation. Correct the geometry first.' };
  }
  const [W, S, E, N] = COVERAGE_BBOX;
  const inside = (x: number, y: number) => x >= W && x < E && y > S && y <= N;
  if (bbox[2] < W || bbox[0] >= E || bbox[3] <= S || bbox[1] > N) {
    return {
      ...base,
      status: 'PLOT_OUTSIDE_COVERAGE',
      summary: 'Not analysed: the plot lies outside the installed dataset tile (lon −10…0, lat 0…10). No inference is made.',
    };
  }
  if (bbox[2] - bbox[0] > MAX_BBOX_DEG || bbox[3] - bbox[1] > MAX_BBOX_DEG) {
    return { ...base, status: 'UNAVAILABLE', summary: `Not analysed: the plot extent exceeds ${MAX_BBOX_DEG}° in one dimension, beyond the supported analysis size.` };
  }

  try {
    const hp = DATASETS.hansen_lossyear.pixelDeg;
    const clampCol = (c: number) => Math.max(0, Math.min(40000, c));
    const clampRow = (r: number) => Math.max(0, Math.min(40000, r));
    const col0 = clampCol(Math.floor((bbox[0] - W) / hp));
    const col1 = clampCol(Math.floor((bbox[2] - W) / hp) + 1);
    const row0 = clampRow(Math.floor((N - bbox[3]) / hp));
    const row1 = clampRow(Math.floor((N - bbox[1]) / hp) + 1);
    const w = col1 - col0;
    const h = row1 - row0;
    const [loss, mask, jrc] = await Promise.all([
      readWindow('hansen_lossyear', col0, row0, col1, row1),
      readWindow('hansen_datamask', col0, row0, col1, row1),
      readWindow('jrc_gfc2020', col0 * 3, row0 * 3, col1 * 3, row1 * 3),
    ]);

    // Decide which Hansen pixels are sampled.
    const sampled = new Uint8Array(w * h);
    let sampling: ForestAnalysis['sampling'] = 'pixel_centres_in_polygon';
    let count = 0;
    if (geometry.type !== 'Point') {
      for (let r = 0; r < h; r++) {
        const y = N - (row0 + r + 0.5) * hp;
        for (let c = 0; c < w; c++) {
          const x = W + (col0 + c + 0.5) * hp;
          if (pointInGeometry(x, y, geometry)) {
            sampled[r * w + c] = 1;
            count++;
          }
        }
      }
    }
    if (count === 0) {
      // Plot smaller than the pixel grid: sample the pixel containing the point, or a point guaranteed to lie inside
      // each polygon component (never the vertex mean, which can fall outside a concave plot).
      const pts = geometry.type === 'Point' ? [geometry.coordinates] : interiorPoints(geometry);
      sampling = geometry.type === 'Point' ? 'single_pixel_containing_point' : 'pixels_containing_interior_points';
      if (pts.length === 0) {
        return { ...base, sampling, status: 'UNAVAILABLE', summary: 'The plot is too thin to place a sample point inside it at this resolution. No conclusion is drawn.' };
      }
      const inTile = pts.filter(([px, py]) => inside(px!, py!));
      if (inTile.length === 0) {
        return { ...base, sampling, status: 'PLOT_OUTSIDE_COVERAGE', summary: 'Not analysed: the sampled location lies outside the installed tile.' };
      }
      for (const [px, py] of inTile) {
        const c = Math.floor((px! - W) / hp) - col0;
        const r = Math.floor((N - py!) / hp) - row0;
        if (c >= 0 && c < w && r >= 0 && r < h && !sampled[r * w + c]) {
          sampled[r * w + c] = 1;
          count++;
        }
      }
    }

    // Coverage: fraction of polygon vertices' bbox inside tile (pixel windows were clamped).
    const outsideTile = !(bbox[0] >= W && bbox[2] < E && bbox[1] > S && bbox[3] <= N);

    const res = { ...base, sampling };
    const classes = new Uint8Array(w * h);
    let land = 0, water = 0, noData = 0;
    for (let r = 0; r < h; r++) {
      const lat = N - (row0 + r + 0.5) * hp;
      const hArea = pixelAreaHa(lat, hp);
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (!sampled[i]) continue;
        const m = mask[i]!;
        const ly = loss[i]!;
        // 3×3 JRC sub-pixels exactly nested in the Hansen pixel.
        let jrcForestSub = 0;
        for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (jrc[(r * 3 + dr) * (w * 3) + (c * 3 + dc)] === 1) jrcForestSub++;
        const jrcForestHa = (jrcForestSub / 9) * hArea;
        if (m === 0) { noData++; classes[i] = 1; continue; }
        if (m === 2) { water++; classes[i] = 2; continue; }
        land++;
        res.areaHa.sampled += hArea;
        res.areaHa.jrcForest2020 += jrcForestHa;
        if (ly === 0) {
          classes[i] = jrcForestSub >= 5 ? 3 : 4;
          continue;
        }
        const year = 2000 + ly;
        const entry = (res.lossByYear[String(year)] ??= { pixels: 0, areaHa: 0, onJrcForestAreaHa: 0 });
        entry.pixels++;
        entry.areaHa += hArea;
        if (year <= CUTOFF_YEAR) {
          res.areaHa.preCutoffLoss += hArea;
          classes[i] = 5;
        } else {
          entry.onJrcForestAreaHa += jrcForestHa;
          res.areaHa.postCutoffLoss += hArea;
          res.areaHa.postCutoffLossOnJrcForest += jrcForestHa;
          classes[i] = jrcForestSub > 0 ? 6 : 7;
          res.firstPostCutoffLossYear = Math.min(res.firstPostCutoffLossYear ?? year, year);
          res.latestPostCutoffLossYear = Math.max(res.latestPostCutoffLossYear ?? year, year);
        }
      }
    }
    res.hansenPixels = { total: count, land, water, noData };
    const round = (n: number) => Math.round(n * 10_000) / 10_000;
    res.areaHa = Object.fromEntries(Object.entries(res.areaHa).map(([k, v]) => [k, round(v)])) as ForestAnalysis['areaHa'];
    for (const e of Object.values(res.lossByYear)) {
      e.areaHa = round(e.areaHa);
      e.onJrcForestAreaHa = round(e.onJrcForestAreaHa);
    }
    res.coveredFraction = count === 0 ? 0 : round(land / count);

    if (w * h <= 250 * 250) {
      res.grid = { width: w, height: h, west: W + col0 * hp, north: N - row0 * hp, pixelDeg: hp, classes: Buffer.from(classes).toString('base64') };
    }

    const postYears = res.firstPostCutoffLossYear
      ? res.firstPostCutoffLossYear === res.latestPostCutoffLossYear
        ? String(res.firstPostCutoffLossYear)
        : `${res.firstPostCutoffLossYear}–${res.latestPostCutoffLossYear}`
      : '';
    if (count === 0) {
      res.status = 'UNAVAILABLE';
      res.summary = 'No dataset pixel could be sampled for this geometry.';
    } else if (res.areaHa.postCutoffLoss > 0) {
      res.status = 'NEEDS_HUMAN_REVIEW';
      const lossPixels = Object.entries(res.lossByYear).filter(([y]) => Number(y) > CUTOFF_YEAR).reduce((s, [, e]) => s + e.pixels, 0);
      const onForest = res.areaHa.postCutoffLossOnJrcForest > 0 ? `≈${ha(res.areaHa.postCutoffLossOnJrcForest)} ha of it on land mapped as forest in 2020 by JRC` : 'none of it on land mapped as forest in 2020 by JRC';
      res.summary = `Annual tree-cover loss recorded in ${postYears} on ${lossPixels} of ${count} sampled 30 m pixels (≈${ha(res.areaHa.postCutoffLoss)} ha; ${onForest}). This is a land-change signal after the cut-off that needs investigation, not a finding of deforestation.`;
    } else if (land === 0) {
      // Only water or no-data pixels: there is no land observation at all, so this is never a clear result.
      res.status = 'UNAVAILABLE';
      res.summary = `No land observation: the ${count} sampled pixel${count === 1 ? ' is' : 's are'} ${water} water and ${noData} no-data${outsideTile ? ', and the plot extends beyond the installed tile' : ''}. No conclusion is drawn; check the geometry or provide other evidence for this plot.`;
    } else if (outsideTile || noData > 0 || water > 0) {
      // Water inside a declared production plot is a coverage gap, not land observed without loss.
      res.status = 'PARTIAL_COVERAGE';
      res.summary = `Part of the plot has no usable land observation (${land} land, ${water} water, ${noData} no-data pixels${outsideTile ? '; extends beyond the installed tile' : ''}). No post-2020 loss was recorded on the land part; the rest cannot be assessed.`;
    } else {
      res.status = 'NO_POST_2020_LOSS_OBSERVED';
      res.summary = `No Hansen annual loss recorded for 2021–2025 on ${count} sampled 30 m pixel${count === 1 ? '' : 's'} (≈${ha(res.areaHa.sampled)} ha). This is not evidence that the plot is deforestation-free.`;
    }
    if (outsideTile && res.status === 'NEEDS_HUMAN_REVIEW') res.summary += ' Part of the plot extends beyond the installed tile and was not assessed.';
    return res;
  } catch (e) {
    return { ...base, status: 'UNAVAILABLE', summary: 'Environmental datasets could not be read; no conclusion is drawn.', error: (e as Error).message };
  }
}
