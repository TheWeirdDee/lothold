// Explicit, reviewer-initiated corrections. A correction never edits an upload in place: it produces a new
// derived GeoJSON upload (with provenance in its properties) that the reviewer must preview and confirm.
import { audit } from './db.ts';
import type { DB } from './db.ts';
import type { SessionUser } from './security.ts';
import { HttpError, computeState, handleUpload } from './service.ts';

export function swapAxesCorrection(db: DB, user: SessionUser, shipmentId: string, featureIndex: number) {
  const st = computeState(db, user, shipmentId);
  if (!st.plotsUpload || !st.input.plots) throw new HttpError(409, 'no_plots', 'No confirmed plot file.');
  const feat = st.input.plots.features.find((f) => f.featureIndex === featureIndex);
  const issue = feat?.report.issues.find((i) => i.code === 'possible_lat_lon_swap' && i.proposedCorrection);
  if (!feat || !issue?.proposedCorrection) throw new HttpError(409, 'no_correction', 'No axis-swap correction is proposed for that feature.');
  const original = JSON.parse(Buffer.from(JSON.stringify(st.input.plots.features.map((f) => f))).toString()) as typeof st.input.plots.features;
  const features = original.map((f) => ({
    type: 'Feature',
    properties: {
      ...(f.plotRef && f.plotRefSource === 'plot_ref' ? { plot_ref: f.plotRef } : {}),
      ...(f.plotRef && f.plotRefSource === 'ProductionPlace' ? { ProductionPlace: f.plotRef } : {}),
      ...(f.producerCountry ? { ProducerCountry: f.producerCountry } : {}),
      ...(f.producerName ? { ProducerName: f.producerName } : {}),
      ...(f.declaredAreaHa !== undefined && f.declaredAreaHa !== null ? { Area: f.declaredAreaHa } : {}),
      ...(f.featureIndex === featureIndex
        ? { lothold_correction: `Axes swapped by reviewer ${user.name} on ${new Date().toISOString()} from ${st.plotsUpload!.filename} (sha256 ${st.plotsUpload!.sha256.slice(0, 16)}), feature ${featureIndex + 1}. Confirm with the supplier.` }
        : {}),
    },
    geometry: f.featureIndex === featureIndex ? issue.proposedCorrection!.geometry : f.geometry,
  }));
  const body = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }, null, 1));
  const name = st.plotsUpload.filename.replace(/(\.(geo)?json)?$/i, `.corrected-feature-${featureIndex + 1}.geojson`);
  const r = handleUpload(db, user, shipmentId, 'plots_geojson', name, 'application/geo+json', body);
  audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'correction.proposed', data: { kind: 'swap_axes', featureIndex, fromUpload: st.plotsUpload.id, derivedUpload: r.uploadId } });
  return { ...r, note: 'A corrected copy was created. Review the preview and confirm it to use it; the original file is unchanged.' };
}
