// Validates XML files against the vendored official DDS V3 schema set and prints the result.
import { readFileSync } from 'node:fs';
import { validateDdsXml } from '../server/dds/xml.ts';
for (const f of process.argv.slice(2)) {
  const r = await validateDdsXml(readFileSync(f, 'utf8'));
  console.log(`${r.valid ? 'VALID  ' : 'INVALID'} ${f}`);
  for (const e of r.errors) console.log('   ', e);
}
