import { type DB, all, get } from './db.ts';
import type { SessionUser } from './security.ts';
import { computeState, geometryHash, DATASETS_KEY } from './service.ts';
import { ANALYSIS_METHOD_VERSION, DATASETS } from './env/forest.ts';
import { formatKg } from '../core/quantity.ts';
import { documentList } from './documents.ts';

export function buildShipmentView(db: DB, user: SessionUser, shipmentId: string) {
  const st = computeState(db, user, shipmentId);
  const { input, evaluation } = st;
  const uploads = all<{ id: string; kind: string; filename: string; sha256: string; bytes: number; parser: string | null; parser_version: string | null; parse_status: string; parse_error: string | null; uploaded_at: string; name: string }>(
    db,
    'SELECT u.id, u.kind, u.filename, u.sha256, u.bytes, u.parser, u.parser_version, u.parse_status, u.parse_error, u.uploaded_at, us.name FROM uploads u JOIN users us ON us.id = u.uploaded_by WHERE u.shipment_id = ? ORDER BY u.uploaded_at DESC',
    shipmentId,
  );
  const confirmedIds = new Set([st.sourcesUpload?.id, st.plotsUpload?.id].filter(Boolean));
  const everConfirmed = new Set(all<{ upload_id: string }>(db, 'SELECT upload_id FROM confirmations WHERE shipment_id = ?', shipmentId).map((r) => r.upload_id));

  const plots = (input.plots?.features ?? []).map((f) => {
    let env = null;
    if (f.report.valid && f.geometry) {
      const r = get<{ id: string; result_json: string }>(db, 'SELECT id, result_json FROM env_results WHERE geometry_hash = ? AND method_version = ? AND datasets_key = ?', geometryHash(f.geometry), ANALYSIS_METHOD_VERSION, DATASETS_KEY);
      env = r ? { resultId: r.id, ...JSON.parse(r.result_json) } : { state: f.plotRef ? input.env[f.plotRef]?.state ?? 'not_started' : 'not_started', error: f.plotRef && input.env[f.plotRef]?.state === 'failed' ? (input.env[f.plotRef] as { error: string }).error : undefined };
    }
    return { ...f, geometryHash: f.geometry ? geometryHash(f.geometry) : null, env };
  });

  const decisions = all<{ id: string; finding_key: string; decision: string; rationale: string; evidence_upload_id: string | null; created_at: string; name: string; snapshot_digest: string }>(
    db,
    'SELECT d.id, d.finding_key, d.decision, d.rationale, d.evidence_upload_id, d.created_at, u.name, d.snapshot_digest FROM review_decisions d JOIN users u ON u.id = d.reviewer_id WHERE d.shipment_id = ? ORDER BY d.created_at DESC',
    shipmentId,
  );
  const activeDecisionKeys = new Set(input.decisions.map((d) => `${d.findingKey}|${d.createdAt}`));

  return {
    shipment: { id: st.shipment.id, reference: st.shipment.reference, createdAt: st.shipment.created_at },
    fields: input.shipment.fields,
    evaluation,
    digest: st.digest,
    approval: st.approval,
    sources: st.sourcesUpload
      ? {
          upload: { id: st.sourcesUpload.id, filename: st.sourcesUpload.filename, sha256: st.sourcesUpload.sha256, parserVersion: st.sourcesUpload.parser_version },
          rows: (input.sources?.rows ?? []).map((r) => ({
            row: r.row,
            raw: r.raw,
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            sourceLotRef: r.sourceLotRef,
            producerCountry: r.producerCountry,
            plotRefs: r.plotRefs,
            declared: r.declaredQuantity.ok ? { grams: r.declaredQuantity.grams, display: formatKg(r.declaredQuantity.grams), conversion: r.declaredQuantity.conversion } : { error: r.declaredQuantity.message },
            allocated: r.allocatedQuantity.ok ? { grams: r.allocatedQuantity.grams, display: formatKg(r.allocatedQuantity.grams), conversion: r.allocatedQuantity.conversion } : { error: r.allocatedQuantity.message },
            issues: r.issues,
          })),
        }
      : null,
    plots: st.plotsUpload ? { upload: { id: st.plotsUpload.id, filename: st.plotsUpload.filename, sha256: st.plotsUpload.sha256, parserVersion: st.plotsUpload.parser_version }, features: plots } : null,
    allocation: evaluation.allocationSummary.map((a) => ({ ...a, display: { requested: formatKg(a.requestedGrams), declared: a.declaredGrams === null ? null : formatKg(a.declaredGrams), others: formatKg(a.reservedByOthersGrams), here: formatKg(a.reservedHereGrams), available: a.availableGrams === null ? null : formatKg(Math.max(0, a.availableGrams)), excess: formatKg(a.excessGrams) } })),
    uploads: uploads.map((u) => ({ id: u.id, kind: u.kind, filename: u.filename, sha256: u.sha256, bytes: u.bytes, parser: u.parser, parserVersion: u.parser_version, parseStatus: u.parse_status, parseError: u.parse_error, uploadedAt: u.uploaded_at, uploadedBy: u.name, active: confirmedIds.has(u.id), superseded: everConfirmed.has(u.id) && !confirmedIds.has(u.id) })),
    decisions: decisions.map((d) => ({ id: d.id, findingKey: d.finding_key, decision: d.decision, rationale: d.rationale, evidenceUploadId: d.evidence_upload_id, at: d.created_at, reviewer: d.name, active: activeDecisionKeys.has(`${d.finding_key}|${d.created_at}`) })),
    documents: documentList(db, user, shipmentId),
    datasets: Object.values(DATASETS).map((d) => ({ id: d.id, title: d.title, version: d.version, resolution: d.resolutionLabel, temporal: d.temporalCoverage, dateSemantics: d.dateSemantics, license: d.license, credit: d.credit, sourceUrl: d.sourceUrl, sha256: d.sha256 })),
  };
}
