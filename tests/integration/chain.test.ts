// ENGINEERING TEST: in-app anchoring against a local Anvil devnet (not a public network, not commercial).
// Covers confirmation, crash-after-submit reconciliation, idempotent re-runs and DB/chain disagreement.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupEnv, client, CSV_HEADER } from './harness.ts';

const anvilBin = join(homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
const PORT = 8549;
const env = setupEnv();
let anvil: ChildProcess | null = null;

const { openDb, get, all, run } = await import('../../server/db.ts');
const { createApp } = await import('../../server/app.ts');
const { anchorAllocationJob, chainStatus } = await import('../../server/chain/anchor.ts');
const { registryAbi, registryBytecode, batchKeyFor } = await import('../../server/chain/registry.ts');
const db = openDb(env.dbPath);
const app = createApp(db);

describe.skipIf(!existsSync(anvilBin))('testnet anchoring lifecycle (local Anvil)', () => {
  const declarant = generatePrivateKey();
  const reserver = generatePrivateKey();
  let registry: Hex;
  beforeAll(async () => {
    anvil = spawn(anvilBin, ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
    const pub = createPublicClient({ chain: foundry, transport: http(`http://127.0.0.1:${PORT}`) });
    for (let i = 0; i < 50; i++) {
      try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    for (const k of [declarant, reserver]) await pub.request({ method: 'anvil_setBalance' as never, params: [privateKeyToAccount(k).address, '0x8AC7230489E80000'] as never });
    const wallet = createWalletClient({ account: privateKeyToAccount(declarant), chain: foundry, transport: http(`http://127.0.0.1:${PORT}`) });
    const h = await wallet.deployContract({ abi: registryAbi, bytecode: registryBytecode, args: [] });
    registry = (await pub.waitForTransactionReceipt({ hash: h })).contractAddress!;
    const t = await wallet.writeContract({ address: registry, abi: registryAbi, functionName: 'setDeclarant', args: [privateKeyToAccount(declarant).address, true] });
    await pub.waitForTransactionReceipt({ hash: t });
    Object.assign(process.env, { CHAIN_ANCHORING: 'on', CHAIN_NETWORK: 'local-devnet', CHAIN_RPC_URL: `http://127.0.0.1:${PORT}`, REGISTRY_ADDRESS: registry, CHAIN_DEPLOYER_KEY: declarant, CHAIN_ACTOR_A_KEY: reserver });
  });
  afterAll(() => {
    anvil?.kill();
    db.close();
  });

  async function reservedShipment(org: string, grams = '600') {
    const c = client(app);
    await c.register(org);
    const sid = (await c.req('POST', '/api/shipments', { reference: 'ENG-CHAIN' })).json.id;
    const up = await c.upload(sid, 'sources_csv', 's.csv', `${CSV_HEADER}\nENG-S,,ENG-L,1000,${grams},kg,CI,ENG-P\n`);
    await c.req('POST', `/api/uploads/${up.json.uploadId}/confirm`);
    expect((await c.req('POST', `/api/shipments/${sid}/reserve`)).status).toBe(200);
    run(db, `UPDATE orgs SET chain_enabled = 1 WHERE name = ?`, org);
    return { c, sid };
  }

  it('anchors a reservation, survives a crash after submission without sending twice, and reads back from chain', async () => {
    const { c, sid } = await reservedShipment('ENG CHAIN ORG');
    const alloc = get<{ id: string }>(db, `SELECT id FROM allocations WHERE shipment_id = ?`, sid)!;
    expect((await c.req('POST', `/api/shipments/${sid}/chain/anchor`)).status).toBe(202);
    await anchorAllocationJob(db, { allocationId: alloc.id });
    const txs = all<{ action: string; status: string; tx_hash: string }>(db, 'SELECT action, status, tx_hash FROM chain_txs WHERE shipment_id = ? ORDER BY created_at', sid);
    expect(txs.map((t) => `${t.action}:${t.status}`)).toEqual(['registerBatch:confirmed', 'authorizeReserver:confirmed', 'reserve:confirmed']);
    // Simulate a crash after submission: the row is left "pending" with its hash; a re-run must reconcile, not resend.
    run(db, `UPDATE chain_txs SET status = 'pending', block_number = NULL WHERE shipment_id = ? AND action = 'reserve'`, sid);
    const pub = createPublicClient({ chain: foundry, transport: http(`http://127.0.0.1:${PORT}`) });
    const nonceBefore = await pub.getTransactionCount({ address: privateKeyToAccount(reserver).address });
    await anchorAllocationJob(db, { allocationId: alloc.id });
    const nonceAfter = await pub.getTransactionCount({ address: privateKeyToAccount(reserver).address });
    expect(nonceAfter).toBe(nonceBefore);
    expect(get<{ status: string }>(db, `SELECT status FROM chain_txs WHERE shipment_id = ? AND action = 'reserve'`, sid)!.status).toBe('confirmed');
    // A plain re-run is idempotent as well.
    await anchorAllocationJob(db, { allocationId: alloc.id });
    expect(all(db, 'SELECT 1 FROM chain_txs WHERE shipment_id = ?', sid)).toHaveLength(3);
    const status = (await c.req('GET', `/api/shipments/${sid}/chain`)).json;
    expect(status.onChain[0]).toMatchObject({ dbGrams: 600_000, chainGrams: '600000', matches: true });
    expect(status.transactions.every((t: any) => t.txHash && t.explorer === null)).toBe(true); // no explorer for a local devnet
  });

  it('refuses to anchor when the chain already declares a different quantity for the batch (DB/chain disagreement)', async () => {
    const { c, sid } = await reservedShipment('ENG CHAIN CONFLICT');
    const lot = get<{ id: string; org_id: string }>(db, `SELECT l.id, l.org_id FROM source_lots l JOIN shipments s ON s.org_id = l.org_id WHERE s.id = ?`, sid)!;
    // Someone registered the same batch key on-chain with a different declared quantity.
    const wallet = createWalletClient({ account: privateKeyToAccount(declarant), chain: foundry, transport: http(`http://127.0.0.1:${PORT}`) });
    const pub = createPublicClient({ chain: foundry, transport: http(`http://127.0.0.1:${PORT}`) });
    const h = await wallet.writeContract({ address: registry, abi: registryAbi, functionName: 'registerBatch', args: [batchKeyFor(lot.org_id, lot.id), 5n, `0x${'ab'.repeat(32)}`] });
    await pub.waitForTransactionReceipt({ hash: h });
    const alloc = get<{ id: string }>(db, `SELECT id FROM allocations WHERE shipment_id = ?`, sid)!;
    await expect(anchorAllocationJob(db, { allocationId: alloc.id })).rejects.toThrow(/different quantity/);
    expect(all(db, `SELECT 1 FROM chain_txs WHERE shipment_id = ? AND status = 'confirmed' AND action = 'reserve'`, sid)).toHaveLength(0);
    // The ledger reservation is untouched; the UI reports the chain step as not anchored.
    expect(get<{ status: string }>(db, 'SELECT status FROM allocations WHERE id = ?', alloc.id)!.status).toBe('reserved');
    const s = await chainStatus(db, get<any>(db, `SELECT u.id, u.org_id AS orgId, '' AS orgName, '' AS email, '' AS name, 'admin' AS role, '' AS csrf, 1 AS chainEnabled FROM users u WHERE u.org_id = ?`, lot.org_id), sid);
    expect(s.onChain).toEqual([]);
    void c;
  });

  it('organisations without anchoring enabled cannot spend the shared test signer', async () => {
    const c = client(app);
    await c.register('ENG CHAIN DISABLED');
    const sid = (await c.req('POST', '/api/shipments', { reference: 'ENG-NOCHAIN' })).json.id;
    const r = await c.req('POST', `/api/shipments/${sid}/chain/anchor`);
    expect(r.status).toBe(403);
  });
});
