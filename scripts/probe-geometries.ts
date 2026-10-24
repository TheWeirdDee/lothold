// Runs LotHold's environmental analysis for a JSON array of {name, geometry} read from a file and prints results.
// Used by scripts/gis-crosscheck.py to compare against an independent GDAL/pyproj calculation.
//   node scripts/probe-geometries.ts <geometries.json>
import { readFileSync } from 'node:fs';
import { analysePlot, setDatasetHashes, DATASETS, type DatasetId } from '../server/env/forest.ts';
import { validatePlotGeometry } from '../core/geometry.ts';

setDatasetHashes(Object.fromEntries((Object.keys(DATASETS) as DatasetId[]).map((k) => [k, DATASETS[k].sha256])));
const items = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { name: string; geometry: never }[];
const out = [];
for (const it of items) {
  const report = validatePlotGeometry(it.geometry, { declaredAreaHa: 1 });
  const r = await analysePlot(it.geometry, { geometryValid: true });
  const { grid, limitations, ...rest } = r;
  void grid; void limitations;
  out.push({ name: it.name, turfAreaHa: report.areaHa, ...rest });
}
process.stdout.write(JSON.stringify(out));
