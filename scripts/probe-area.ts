// Engineering probe: runs the real raster analysis on an arbitrary coordinate box.
// A probe box is a geographic query area, NOT a farm, plot, supplier or shipment.
import { analysePlot, setDatasetHashes, DATASETS, type DatasetId } from '../server/env/forest.ts';

const [lon, lat, sizeDeg = '0.009'] = process.argv.slice(2).map(String);
if (!lon || !lat) throw new Error('usage: node scripts/probe-area.ts <lon> <lat> [sizeDeg]');
const x = Number(lon), y = Number(lat), s = Number(sizeDeg) / 2;
setDatasetHashes(Object.fromEntries((Object.keys(DATASETS) as DatasetId[]).map((k) => [k, DATASETS[k].sha256])));
const geom = { type: 'Polygon' as const, coordinates: [[[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s], [x - s, y - s]] as [number, number][]] };
const t0 = Date.now();
const r = await analysePlot(geom, { geometryValid: true });
const { grid, limitations, ...rest } = r;
console.log(JSON.stringify({ ...rest, gridSize: grid ? `${grid.width}x${grid.height}` : null, ms: Date.now() - t0 }, null, 1));
