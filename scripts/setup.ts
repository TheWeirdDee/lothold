// One-time local setup: creates .env secrets (never printed) if they are missing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const path = '.env';
let env = existsSync(path) ? readFileSync(path, 'utf8') : '';
const add = (k: string, v: string) => {
  if (new RegExp(`^${k}=`, 'm').test(env)) return console.log(`${k} already set`);
  env += (env && !env.endsWith('\n') ? '\n' : '') + `${k}=${v}\n`;
  console.log(`${k} created`);
};
add('EVIDENCE_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
add('DOWNLOAD_SIGNING_KEY', randomBytes(32).toString('hex'));
writeFileSync(path, env, { mode: 0o600 });
console.log('Secrets are stored in .env (git-ignored). Back up EVIDENCE_ENCRYPTION_KEY: stored evidence cannot be decrypted without it.');
