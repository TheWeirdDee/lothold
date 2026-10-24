// Starts the real server against a throwaway database for browser tests (engineering only).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'lothold-e2e-'));
process.env.DATABASE_PATH = join(dir, 'db.sqlite');
process.env.EVIDENCE_DIR = join(dir, 'evidence');
process.env.PORT = process.env.E2E_PORT ?? '8798';
process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${process.env.PORT}`;
process.env.EVIDENCE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.DOWNLOAD_SIGNING_KEY = randomBytes(32).toString('hex');
process.env.REGISTER_RATE_LIMIT = '1000';
process.env.CHAIN_ANCHORING = 'off';
process.env.LOTHOLD_INSTANCE = 'engineering';
delete process.env.AI_PROVIDER;
await import('../server/main.ts');
