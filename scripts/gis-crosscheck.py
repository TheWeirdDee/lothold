"""Independent cross-check of LotHold's environmental analysis using GDAL (rasterio) and pyproj.

Engineering verification only: the polygons are coordinate probe areas, not farms.

Requires: pip install rasterio pyproj shapely numpy   (rasterio wheels bundle GDAL)
Usage:    python scripts/gis-crosscheck.py [data/snapshots] [docs/evidence/gis-crosscheck.json]

Checks
  1. Raster metadata: CRS, transform, data type, declared nodata, and exact 3x3 nesting of JRC in Hansen.
  2. Value domains in sample windows (JRC values, Hansen loss-year range, datamask codes).
  3. Per polygon: pixel selection via GDAL rasterisation (pixel-centre rule, all_touched=False), loss-year
     histogram, datamask classes, JRC forest sub-pixels, areas on the WGS84 ellipsoid (pyproj.Geod),
     compared with LotHold's own result (node scripts/probe-geometries.ts). LotHold's pixel-centre rule is re-implemented
     independently; GDAL differences are accepted only when the pixel centre lies on the polygon edge (a tie).
"""
import json, subprocess, sys, os, tempfile
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds, Window
from pyproj import Geod
from shapely.geometry import shape, box, mapping

DATA = sys.argv[1] if len(sys.argv) > 1 else 'data/snapshots'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/evidence/gis-crosscheck.json'
F = {
    'loss': os.path.join(DATA, 'Hansen_GFC-2025-v1.13_lossyear_10N_010W.tif'),
    'mask': os.path.join(DATA, 'Hansen_GFC-2025-v1.13_datamask_10N_010W.tif'),
    'jrc': os.path.join(DATA, 'JRC_GFC2020_V4_N10_W10.tif'),
}
geod = Geod(ellps='WGS84')
report = {'tool': f'rasterio {rasterio.__version__} / GDAL {rasterio.__gdal_version__}; pyproj Geod WGS84', 'metadata': {}, 'domains': {}, 'polygons': [], 'failures': []}

def fail(msg):
    report['failures'].append(msg)

# ---------- 1. metadata ----------
src = {k: rasterio.open(v) for k, v in F.items()}
for k, s in src.items():
    report['metadata'][k] = {'crs': str(s.crs), 'transform': list(s.transform)[:6], 'dtype': s.dtypes[0], 'nodata': s.nodata, 'width': s.width, 'height': s.height}
    if s.crs.to_epsg() != 4326:
        fail(f'{k}: CRS is not EPSG:4326')
th, tj = src['loss'].transform, src['jrc'].transform
if (th.c, th.f) != (tj.c, tj.f):
    fail('origins differ between Hansen and JRC')
if not (abs(th.a / tj.a - 3) < 1e-9 and abs(th.e / tj.e - 3) < 1e-9):
    fail('JRC pixels do not nest exactly 3x3 inside Hansen pixels')
if src['loss'].transform != src['mask'].transform:
    fail('lossyear and datamask grids differ')

# ---------- 2. value domains ----------
windows = {'Soubre (-6.65,5.75)': (-6.70, 5.70, -6.60, 5.80), 'Tai NP (-7.25,5.75)': (-7.30, 5.70, -7.20, 5.80), 'Abidjan coast/lagoon (-4.0,5.25)': (-4.10, 5.15, -3.90, 5.35), 'Ghana (-1.5,6.5)': (-1.60, 6.40, -1.40, 6.60)}
for name, b in windows.items():
    d = {}
    for k in ('loss', 'mask', 'jrc'):
        s = src[k]
        a = s.read(1, window=from_bounds(*b, transform=s.transform))
        vals, counts = np.unique(a, return_counts=True)
        d[k] = {int(v): int(c) for v, c in zip(vals, counts)}
    report['domains'][name] = d
    if set(d['jrc']) - {0, 1}:
        fail(f'{name}: unexpected JRC values {sorted(set(d["jrc"]) - {0, 1})}')
    if max(d['loss']) > 25:
        fail(f'{name}: loss year code above 25')
    if set(d['mask']) - {0, 1, 2}:
        fail(f'{name}: unexpected datamask values')
all_loss = set().union(*[set(v['loss']) for v in report['domains'].values()])
report['domains']['_summary'] = {'loss_codes_seen': sorted(int(x) for x in all_loss), 'max_loss_code': int(max(all_loss)), 'interpretation': 'code n = loss year 2000+n'}

# ---------- 3. polygons ----------
def sq(x, y, d):
    return {'type': 'Polygon', 'coordinates': [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]}
polys = [
    {'name': 'box 0.01deg, loss area', 'geometry': sq(-7.56, 6.24, 0.01)},
    {'name': 'box 0.009deg, Tai NP', 'geometry': sq(-7.2045, 5.7455, 0.009)},
    {'name': 'box 0.02deg, mixed', 'geometry': sq(-7.56, 6.24, 0.02)},
    {'name': 'concave irregular polygon', 'geometry': {'type': 'Polygon', 'coordinates': [[[-6.6100, 5.7700], [-6.5950, 5.7710], [-6.5940, 5.7800], [-6.6010, 5.7760], [-6.6030, 5.7860], [-6.6110, 5.7830], [-6.6080, 5.7760], [-6.6100, 5.7700]]]}},
    {'name': 'lagoon/coast polygon (water + land)', 'geometry': sq(-4.02, 5.24, 0.01)},
    {'name': 'small polygon (~1 ha, few pixels)', 'geometry': sq(-7.5555, 6.2455, 0.0009)},
]
with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as tf:
    json.dump(polys, tf)
    tmp = tf.name
lot = json.loads(subprocess.run(['node', 'scripts/probe-geometries.ts', tmp], capture_output=True, text=True, check=True).stdout)
os.unlink(tmp)

from shapely.geometry import Point

def on_segment(x, y, a, b, eps=1e-10):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
    px, py = a[0] + t * dx - x, a[1] + t * dy - y
    return px * px + py * py <= eps * eps

def raycast(rings, x, y):
    """Same pixel-centre rule LotHold uses (closed polygon: on-edge counts as inside; even-odd ray casting
    otherwise), re-implemented here independently."""
    ring = rings[0]
    if any(on_segment(x, y, ring[i], ring[i + 1]) for i in range(len(ring) - 1)):
        return True
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def rel(a, b):
    return 0.0 if a == b == 0 else abs(a - b) / max(abs(a), abs(b))

for p, L in zip(polys, lot):
    g = shape(p['geometry'])
    s = src['loss']
    win = from_bounds(*g.bounds, transform=s.transform).round_offsets(op='floor').round_lengths(op='ceil')
    win = Window(win.col_off, win.row_off, win.width + 1, win.height + 1)
    wt = s.window_transform(win)
    loss = s.read(1, window=win)
    mask = src['mask'].read(1, window=win)
    jrc = src['jrc'].read(1, window=Window(win.col_off * 3, win.row_off * 3, win.width * 3, win.height * 3))
    gdal_sel = ~geometry_mask([mapping(g)], out_shape=loss.shape, transform=wt, all_touched=False)
    ray_sel = np.zeros(loss.shape, dtype=bool)
    ties, non_ties = 0, 0
    for r in range(loss.shape[0]):
        for c in range(loss.shape[1]):
            x, y = wt * (c + 0.5, r + 0.5)
            ray_sel[r, c] = raycast(p['geometry']['coordinates'], x, y)
            if ray_sel[r, c] != gdal_sel[r, c]:
                if g.boundary.distance(Point(x, y)) < 1e-9: ties += 1
                else: non_ties += 1
    areas = np.zeros(loss.shape)
    for r in range(loss.shape[0]):
        x0, y0 = wt * (0, r); x1, y1 = wt * (1, r + 1)
        a, _ = geod.polygon_area_perimeter([x0, x1, x1, x0], [y0, y0, y1, y1])
        areas[r, :] = abs(a) / 10_000
    jrc_sub = jrc.reshape(loss.shape[0], 3, loss.shape[1], 3).sum(axis=(1, 3))
    def summarise(sel):
        land = sel & (mask == 1)
        years = {}
        for code in np.unique(loss[land]):
            if code:
                years[str(2000 + int(code))] = int((land & (loss == code)).sum())
        post = land & (loss >= 21)
        return {
            'pixels': int(sel.sum()), 'land': int(land.sum()), 'water': int((sel & (mask == 2)).sum()), 'noData': int((sel & (mask == 0)).sum()),
            'sampledLandAreaHa': float(areas[land].sum()), 'jrcForestAreaHa': float((areas * jrc_sub / 9)[land].sum()),
            'postCutoffLossAreaHa': float(areas[post].sum()), 'postCutoffLossPixels': int(post.sum()), 'lossByYearPixels': years,
        }
    ref = summarise(ray_sel)
    gd = summarise(gdal_sel)
    poly_area, _ = geod.geometry_area_perimeter(g)
    lh = {
        'pixels': L['hansenPixels']['total'], 'land': L['hansenPixels']['land'], 'water': L['hansenPixels']['water'], 'noData': L['hansenPixels']['noData'],
        'sampledLandAreaHa': L['areaHa']['sampled'], 'jrcForestAreaHa': L['areaHa']['jrcForest2020'], 'postCutoffLossAreaHa': L['areaHa']['postCutoffLoss'],
        'lossByYearPixels': {y: v['pixels'] for y, v in L['lossByYear'].items()}, 'status': L['status'], 'sampling': L['sampling'], 'polygonAreaHa': L['turfAreaHa'],
    }
    cmp = {
        'lothold_counts_match_reference': (lh['pixels'], lh['land'], lh['water'], lh['noData']) == (ref['pixels'], ref['land'], ref['water'], ref['noData']),
        'lothold_loss_years_match_reference': lh['lossByYearPixels'] == ref['lossByYearPixels'],
        'gdal_vs_reference_edge_ties': ties,
        'gdal_vs_reference_non_tie_differences': non_ties,
        'sampled_area_rel_diff': rel(lh['sampledLandAreaHa'], ref['sampledLandAreaHa']),
        'jrc_area_rel_diff': rel(lh['jrcForestAreaHa'], ref['jrcForestAreaHa']),
        'post_loss_area_rel_diff': rel(lh['postCutoffLossAreaHa'], ref['postCutoffLossAreaHa']),
        'polygon_area_rel_diff_vs_geodesic': rel(lh['polygonAreaHa'] or 0, abs(poly_area) / 10_000),
    }
    expected = 'NEEDS_HUMAN_REVIEW' if ref['postCutoffLossPixels'] > 0 else ('PARTIAL_COVERAGE' if ref['noData'] > 0 else 'NO_POST_2020_LOSS_OBSERVED')
    cmp['status_consistent'] = lh['status'] == expected
    for k, v in cmp.items():
        if isinstance(v, bool) and not v: fail(f"{p['name']}: {k} is false")
        if k == 'gdal_vs_reference_non_tie_differences' and v: fail(f"{p['name']}: {v} pixel(s) differ from GDAL away from polygon edges")
        if isinstance(v, float) and v > 0.0005: fail(f"{p['name']}: {k} = {v:.6f} exceeds 0.05 %")
    report['polygons'].append({'name': p['name'], 'lothold': lh, 'reference_raycast': ref, 'gdal_rasterize': gd, 'polygonAreaHa_geodesic': abs(poly_area) / 10_000, 'comparison': cmp})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(report, fh, indent=1)
print(json.dumps({'failures': report['failures'], 'polygons': [{'name': x['name'], **x['comparison']} for x in report['polygons']], 'loss_codes': report['domains']['_summary']}, indent=1))
sys.exit(1 if report['failures'] else 0)
