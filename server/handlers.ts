// Durable job handlers shared by the server process and the integration tests.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { type DB, id, now, run } from './db.ts';
import { analysePlot, DATASETS, setDatasetHashes, markVerificationDone, datasetAvailability, ANALYSIS_METHOD_VERSION, type DatasetId } from './env/forest.ts';
import { DATASETS_KEY } from './service.ts';
import { anchorAllocationJob } from './chain/anchor.ts';
import type { JobHandler } from './jobs.ts';

/** Hashes each installed dataset and returns true only if all match their pinned SHA-256. */
export async function verifyDatasets(log: (o: object) => void = (o) => console.log(JSON.stringify(o))): Promise<boolean> {
  const hashes: Partial<Record<DatasetId, string>> = {};
  for (const a of datasetAvailability()) {
    if (!a.present || !a.sizeMatches) continue;
    const h = createHash('sha256');
    await pipeline(createReadStream(`${process.env.DATA_DIR ?? 'data/snapshots'}/${DATASETS[a.id].file}`), h);
    hashes[a.id] = h.digest('hex');
  }
  setDatasetHashes(hashes);
  markVerificationDone();
  for (const k of Object.keys(DATASETS) as DatasetId[]) log({ event: 'dataset.verify', id: k, ok: hashes[k] === DATASETS[k].sha256, present: !!hashes[k] });
  return (Object.keys(DATASETS) as DatasetId[]).every((k) => hashes[k] === DATASETS[k].sha256);
}

export function createJobHandlers(db: DB, opts: { datasetsOk: boolean }): Record<string, JobHandler> {
  return {
    async forest_analysis(p: { geometryHash: string; geometry: never }) {
      if (!opts.datasetsOk) throw new Error('environmental datasets missing or failed SHA-256 verification');
      const result = await analysePlot(p.geometry, { geometryValid: true });
      // A read failure is retried and finally recorded as a failed job; it never becomes a result.
      if (result.status === 'UNAVAILABLE' && result.error) throw new Error(result.error);
      run(db, 'INSERT OR IGNORE INTO env_results (id, geometry_hash, method_version, datasets_key, status, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id(), p.geometryHash, ANALYSIS_METHOD_VERSION, DATASETS_KEY, result.status, JSON.stringify(result), now());
    },
    async chain_anchor(p: { allocationId: string }) {
      await anchorAllocationJob(db, p);
    },
  };
}
