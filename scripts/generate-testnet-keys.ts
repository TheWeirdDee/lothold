// Generates testnet-only signing keys into .env without printing them.
// Prints only public addresses. Refuses to overwrite existing keys.
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const path = '.env';
const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
const names = ['CHAIN_DEPLOYER_KEY', 'CHAIN_ACTOR_A_KEY', 'CHAIN_ACTOR_B_KEY'] as const;
const lines: string[] = [];
for (const name of names) {
  if (new RegExp(`^${name}=`, 'm').test(existing)) {
    console.log(`${name} already present; left unchanged.`);
    continue;
  }
  lines.push(`${name}=${generatePrivateKey()}`);
}
if (lines.length) {
  writeFileSync(path, (existing && !existing.endsWith('\n') ? existing + '\n' : existing) + lines.join('\n') + '\n', { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}
}
const env = readFileSync(path, 'utf8');
for (const name of names) {
  const m = new RegExp(`^${name}=(0x[0-9a-fA-F]{64})$`, 'm').exec(env);
  if (m) console.log(`${name.replace('_KEY', '_ADDRESS')}=${privateKeyToAccount(m[1] as `0x${string}`).address}`);
}
