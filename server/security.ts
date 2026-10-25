import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { type DB, get, run, now, id } from './db.ts';

// ---------- secrets ----------
function requireHexKey(name: string): Buffer {
  const v = process.env[name];
  if (!v || !/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${name} must be a 64-character hex string (run "npm run setup").`);
  return Buffer.from(v, 'hex');
}
export const secrets = {
  evidenceKey: () => requireHexKey('EVIDENCE_ENCRYPTION_KEY'),
  signingKey: () => requireHexKey('DOWNLOAD_SIGNING_KEY'),
};

// ---------- passwords ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const dk = scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(dk, expected);
}
export const PASSWORD_MIN = 10;

// ---------- sessions ----------
export const SESSION_COOKIE = 'lh_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: string): { token: string; csrf: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  run(db, 'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha(token), userId, csrf, now(), expiresAt);
  return { token, csrf, expiresAt };
}

export type SessionUser = { id: string; orgId: string; orgName: string; email: string; name: string; role: 'reviewer' | 'admin'; csrf: string; chainEnabled: boolean };

export function sessionUser(db: DB, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = get<{ id: string; org_id: string; org_name: string; email: string; name: string; role: 'reviewer' | 'admin'; csrf_token: string; expires_at: string; chain_enabled: number }>(
    db,
    `SELECT u.id, u.org_id, o.name AS org_name, u.email, u.name, u.role, s.csrf_token, s.expires_at, o.chain_enabled
     FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs o ON o.id = u.org_id WHERE s.token_hash = ?`,
    sha(token),
  );
  if (!row) return null;
  if (row.expires_at < now()) {
    run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha(token));
    return null;
  }
  return { id: row.id, orgId: row.org_id, orgName: row.org_name, email: row.email, name: row.name, role: row.role, csrf: row.csrf_token, chainEnabled: row.chain_enabled === 1 };
}

export function destroySession(db: DB, token: string) {
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

export function csrfMatches(expected: string, got: string | undefined): boolean {
  if (!got) return false;
  const a = Buffer.from(expected), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- rate limiting (persistent, sliding window) ----------
export function rateLimit(db: DB, bucket: string, limit: number, windowMs: number): { ok: boolean; retryAfterS: number } {
  const t = Date.now();
  run(db, 'DELETE FROM rate_events WHERE bucket = ? AND at_ms < ?', bucket, t - windowMs);
  const c = get<{ n: number; oldest: number | null }>(db, 'SELECT COUNT(*) AS n, MIN(at_ms) AS oldest FROM rate_events WHERE bucket = ?', bucket)!;
  if (c.n >= limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil(((c.oldest ?? t) + windowMs - t) / 1000)) };
  run(db, 'INSERT INTO rate_events (bucket, at_ms) VALUES (?, ?)', bucket, t);
  return { ok: true, retryAfterS: 0 };
}

// ---------- private evidence storage (AES-256-GCM at rest) ----------
const STORAGE_DIR = () => resolve(process.env.EVIDENCE_DIR ?? 'data/evidence');

export function storeBytes(orgId: string, bytes: Buffer): string {
  const key = secrets.evidenceKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(orgId));
  const enc = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  const storageKey = `${orgId}/${id()}.bin`;
  const path = resolve(STORAGE_DIR(), storageKey);
  if (!path.startsWith(STORAGE_DIR() + sep)) throw new Error('invalid storage path');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([Buffer.from('LH1'), iv, tag, enc]), { mode: 0o600 });
  return storageKey;
}

export function readBytes(orgId: string, storageKey: string): Buffer {
  if (!storageKey.startsWith(orgId + '/') || storageKey.includes('..')) throw new Error('storage key does not belong to organisation');
  const path = resolve(STORAGE_DIR(), storageKey);
  if (!path.startsWith(STORAGE_DIR() + sep) || !existsSync(path)) throw new Error('stored object missing');
  const buf = readFileSync(path);
  if (buf.subarray(0, 3).toString() !== 'LH1') throw new Error('unknown storage format');
  const iv = buf.subarray(3, 15), tag = buf.subarray(15, 31), enc = buf.subarray(31);
  const d = createDecipheriv('aes-256-gcm', secrets.evidenceKey(), iv);
  d.setAAD(Buffer.from(orgId));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

export function sha256Hex(b: Buffer | string): string {
  return createHash('sha256').update(b).digest('hex');
}

// ---------- signed, expiring download tokens ----------
export const DOWNLOAD_TTL_S = 300;
export function signDownload(kind: 'upload' | 'document', objectId: string, userId: string, ttlS = DOWNLOAD_TTL_S): string {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const payload = `${kind}.${objectId}.${userId}.${exp}`;
  const sig = createHmac('sha256', secrets.signingKey()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}
export function verifyDownload(token: string): { kind: 'upload' | 'document'; objectId: string; userId: string } | { error: 'invalid' | 'expired' } {
  const [p, sig] = token.split('.');
  if (!p || !sig) return { error: 'invalid' };
  const payload = Buffer.from(p, 'base64url').toString();
  const expect = createHmac('sha256', secrets.signingKey()).update(payload).digest('base64url');
  if (expect.length !== sig.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return { error: 'invalid' };
  const [kind, objectId, userId, exp] = payload.split('.');
  if ((kind !== 'upload' && kind !== 'document') || !objectId || !userId || !exp) return { error: 'invalid' };
  if (Number(exp) < Date.now() / 1000) return { error: 'expired' };
  return { kind, objectId, userId };
}

/** Removes control characters and path separators from an uploaded filename for display/storage. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 180);
  return cleaned || 'upload';
}

/** Deletes expired sessions and rate-limit events older than the longest window in use (24 h). */
export function housekeeping(db: DB, nowMs = Date.now()): { rateEvents: number; sessions: number } {
  const rate = run(db, 'DELETE FROM rate_events WHERE at_ms < ?', nowMs - 24 * 60 * 60 * 1000);
  const sessions = run(db, 'DELETE FROM sessions WHERE expires_at < ?', new Date(nowMs).toISOString());
  return { rateEvents: Number(rate.changes), sessions: Number(sessions.changes) };
}
