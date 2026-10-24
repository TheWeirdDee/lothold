// Developer tool: decrypts the most recent generated document of a kind to a local file for inspection.
//   DATABASE_PATH=... EVIDENCE_DIR=... node --env-file=.env scripts/export-document.ts <kind> <outfile>
import { writeFileSync } from 'node:fs';
import { openDb, get } from '../server/db.ts';
import { readBytes } from '../server/security.ts';
const [kind, out] = process.argv.slice(2);
const db = openDb();
const d = get<{ storage_key: string; org_id: string; filename: string }>(db, 'SELECT d.storage_key, s.org_id, d.filename FROM documents d JOIN shipments s ON s.id = d.shipment_id WHERE d.kind = ? ORDER BY d.created_at DESC LIMIT 1', kind!);
if (!d) throw new Error('no document');
writeFileSync(out!, readBytes(d.org_id, d.storage_key));
console.log(`${d.filename} -> ${out}`);
