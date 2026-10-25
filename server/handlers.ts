// Durable job handlers shared by the server process and the integration tests.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { type DB, id, now, run } from './db.ts';
import { analysePlot, DATASETS, setDatasetHashes, markVerificationDone, datasetAvailability, ANALYSIS_METHOD_VERSION, type DatasetId } from './env/forest.ts';
import { DATASETS_KEY } from './service.ts';
import { analyseOffThread } from './analysis.ts';
import { anchorAllocationJob } from './chain/anchor.ts';
import type { JobHandler } from './jobs.ts';

/** Hashes each installed dataset and returns true only if all match their pinned SHA-256. */
export async function verifyDatasets(log: (o: object) => void = (o) => console.log(JSON.stringify(o))): Promise<boolean> {
  const hashes: Partial<Record<DatasetId, string>> = {};
  const dataDir = process.env.DATA_DIR ?? 'data/snapshots';
  // Immutable image builds: trust the manifest written by `fetch-datasets --write-manifest` after it verified each
  // file's SHA-256 against the pins, provided size and modification time still match. Avoids re-hashing 431 MB at
  // every cold start on very small instances. Any mismatch falls back to full hashing.
  const manifestPath = `${dataDir}/verified-manifest.json`;
  if (process.env.DATASETS_TRUST_BUILD_MANIFEST === '1' && existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { entries: { file: string; bytes: number; mtimeMs: number; sha256: string }[] };
      for (const id of Object.keys(DATASETS) as DatasetId[]) {
        const d = DATASETS[id];
        const e = m.entries.find((x) => x.file === d.file);
        const path = `${dataDir}/${d.file}`;
        if (!e || !existsSync(path) || e.sha256 !== d.sha256) continue;
        const st = statSync(path);
        // OCI layer archives may truncate subsecond mtimes. In this explicit
        // immutable-image mode compare the same whole-second precision used by
        // the build manifest; otherwise every cold start rehashes 431 MB.
        if (st.size === e.bytes && st.size === d.bytes && Math.floor(st.mtimeMs / 1000) === Math.floor(e.mtimeMs / 1000)) hashes[id] = e.sha256;
      }
      if ((Object.keys(DATASETS) as DatasetId[]).every((k) => hashes[k])) {
        setDatasetHashes(hashes);
        markVerificationDone();
        for (const k of Object.keys(DATASETS) as DatasetId[]) log({ event: 'dataset.verify', id: k, ok: true, present: true, mode: 'build-manifest' });
        return true;
      }
    } catch (e) {
      log({ event: 'dataset.manifest_unusable', error: (e as Error).message });
    }
  }
  for (const a of datasetAvailability()) {
    if (!a.present || !a.sizeMatches) continue;
    try {
      const h = createHash('sha256');
      await pipeline(createReadStream(`${process.env.DATA_DIR ?? 'data/snapshots'}/${DATASETS[a.id].file}`), h);
      hashes[a.id] = h.digest('hex');
    } catch (e) {
      // An unreadable file counts as unverified (analysis reports unavailable); it must not stop startup.
      log({ event: 'dataset.read_error', id: a.id, error: (e as Error).message });
    }
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
      const result = await analyseOffThread(p.geometry);
      // A read failure is retried and finally recorded as a failed job; it never becomes a result.
      if (result.status === 'UNAVAILABLE' && result.error) throw new Error(result.error);
      run(db, 'INSERT OR IGNORE INTO env_results (id, geometry_hash, method_version, datasets_key, status, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id(), p.geometryHash, ANALYSIS_METHOD_VERSION, DATASETS_KEY, result.status, JSON.stringify(result), now());
    },
    async chain_anchor(p: { allocationId: string }) {
      await anchorAllocationJob(db, p);
    },
  };
}
