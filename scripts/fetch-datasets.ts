// Downloads the pinned environmental snapshots into data/snapshots and verifies size + SHA-256.
// Sources are public: Hansen GFC v1.13 (CC BY 4.0) and JRC GFC2020 V4 (no restriction of use).
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATASETS, type DatasetId } from '../server/env/forest.ts';

const dir = resolve(process.env.DATA_DIR ?? 'data/snapshots');
mkdirSync(dir, { recursive: true });
const verifyOnly = process.argv.includes('--verify-only');

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

let failed = false;
for (const id of Object.keys(DATASETS) as DatasetId[]) {
  const d = DATASETS[id];
  const path = resolve(dir, d.file);
  if (!existsSync(path) || statSync(path).size !== d.bytes) {
    if (verifyOnly) {
      console.log(`MISSING  ${d.file}`);
      failed = true;
      continue;
    }
    for (let attempt = 1; attempt <= 5; attempt++) {
      console.log(`download ${d.file} (attempt ${attempt})`);
      try {
        const res = await fetch(d.sourceUrl, { signal: AbortSignal.timeout(60 * 60_000) });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path + '.part'));
        if (statSync(path + '.part').size !== d.bytes) throw new Error('size mismatch');
        renameSync(path + '.part', path);
        break;
      } catch (e) {
        console.log(`  failed: ${(e as Error).message}`);
        if (existsSync(path + '.part')) unlinkSync(path + '.part');
        if (attempt === 5) failed = true;
      }
    }
  }
  if (!existsSync(path)) continue;
  const got = await sha256(path);
  const ok = got === d.sha256;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK      ' : 'MISMATCH'} ${d.file} sha256=${got}`);
}
process.exitCode = failed ? 1 : 0;
