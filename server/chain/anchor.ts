// In-app anchoring of confirmed database reservations on the public testnet registry.
// The database reservation happens first (transactional). Anchoring then mirrors it on-chain, step by step:
// registerBatch -> authorizeReserver -> reserve. Every step is written to chain_txs BEFORE submission and
// keyed by an idempotency key, so a retry or restart reconciles the existing transaction instead of sending
// a second one. Confirmed on-chain state is authoritative for what is shown as anchored.
//
// Trust disclosure: in this pilot the LotHold server holds the testnet signing keys. The registrar/declarant
// signer registers batches for every participating organisation, and one pilot reserver signer submits
// reservations. On-chain actor addresses therefore identify the pilot signers, not individual reviewers.
// Batch keys are namespaced per organisation; the registry cannot know whether two batch keys describe the
// same physical cocoa.
import { existsSync, readFileSync } from 'node:fs';
import { type Hex, type Hash } from 'viem';
import { type DB, EFFECTIVE_DECLARED_SQL, all, audit, get, id, now, run } from '../db.ts';
import type { SessionUser } from '../security.ts';
import { HttpError, computeState, getShipment } from '../service.ts';
import {
  accountFromEnv, allocationKeyFor, batchKeyFor, chainConfigFromEnv, explorerAddressUrl, explorerTxUrl, readBatch, readReservation, reconcileTx, writeRegistry, type ChainConfig, type WriteOutcome,
} from './registry.ts';
import { enqueue } from '../jobs.ts';

export function chainSetup() {
  const cfg = chainConfigFromEnv();
  const declarant = accountFromEnv('CHAIN_DEPLOYER_KEY');
  const reserver = accountFromEnv('CHAIN_ACTOR_A_KEY');
  const ready = !!(cfg.registryAddress && declarant && reserver && process.env.CHAIN_ANCHORING !== 'off');
  return { cfg, declarant, reserver, ready };
}

type ChainTx = { id: string; action: string; idempotency_key: string; status: string; tx_hash: string | null; block_number: number | null; detail: string | null; allocation_id: string | null; source_lot_id: string | null; created_at: string; updated_at: string; signer: string; args_json: string };

function upsertTx(db: DB, row: Omit<ChainTx, 'created_at' | 'updated_at' | 'tx_hash' | 'block_number' | 'detail' | 'status'> & { orgId: string; shipmentId: string; cfg: ChainConfig }) {
  const existing = get<ChainTx>(db, 'SELECT * FROM chain_txs WHERE idempotency_key = ?', row.idempotency_key);
  if (existing) return existing;
  run(
    db,
    `INSERT INTO chain_txs (id, org_id, shipment_id, allocation_id, source_lot_id, action, idempotency_key, network, chain_id, contract_address, signer, args_json, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    row.id, row.orgId, row.shipmentId, row.allocation_id, row.source_lot_id, row.action, row.idempotency_key, row.cfg.network, row.cfg.chain.id, row.cfg.registryAddress!, row.signer, row.args_json, now(), now(),
  );
  return get<ChainTx>(db, 'SELECT * FROM chain_txs WHERE idempotency_key = ?', row.idempotency_key)!;
}

function record(db: DB, txId: string, o: WriteOutcome) {
  const detail = o.kind === 'preflight_rejected' ? JSON.stringify({ revert: o.revert?.name ?? null, message: o.error }) : o.kind === 'rpc_error' ? JSON.stringify({ stage: o.stage, message: o.error }) : null;
  run(
    db,
    'UPDATE chain_txs SET status = ?, tx_hash = COALESCE(?, tx_hash), block_number = ?, detail = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?',
    o.kind, 'txHash' in o ? (o.txHash ?? null) : null, 'blockNumber' in o ? Number(o.blockNumber) : null, detail, now(), txId,
  );
}

/** Executes (or reconciles) one chain step. Returns true when the step is settled successfully. */
async function step(db: DB, cfg: ChainConfig, tx: ChainTx, send: (onSubmitted: (h: Hash) => void) => Promise<WriteOutcome>, alreadyDone: () => Promise<boolean>): Promise<boolean> {
  if (tx.status === 'confirmed') return true;
  if ((tx.status === 'pending' || tx.status === 'rpc_error') && tx.tx_hash) {
    const r = await reconcileTx(cfg, tx.tx_hash as Hash);
    record(db, tx.id, r);
    if (r.kind === 'confirmed') return true;
    if (r.kind === 'pending' || r.kind === 'rpc_error') throw new Error(`transaction ${tx.tx_hash} not yet settled`);
    return false; // reverted
  }
  if (tx.status === 'reverted') return false;
  if (await alreadyDone()) {
    run(db, `UPDATE chain_txs SET status = 'confirmed', detail = ?, updated_at = ? WHERE id = ?`, JSON.stringify({ note: 'already present on-chain; no transaction sent' }), now(), tx.id);
    return true;
  }
  const o = await send((h) => {
    run(db, `UPDATE chain_txs SET status = 'pending', tx_hash = ?, updated_at = ? WHERE id = ?`, h, now(), tx.id);
  });
  record(db, tx.id, o);
  if (o.kind === 'confirmed') return true;
  if (o.kind === 'rpc_error') throw new Error(`RPC error at ${o.stage}: ${o.error}`);
  return false;
}

/** Job handler: anchors one DB allocation. Safe to re-run any number of times. */
export async function anchorAllocationJob(db: DB, payload: { allocationId: string }) {
  const { cfg, declarant, reserver, ready } = chainSetup();
  if (!ready || !declarant || !reserver) throw new Error('testnet anchoring is not configured');
  const a = get<{ id: string; org_id: string; shipment_id: string; source_lot_id: string; grams: number; status: string; sources_upload_id: string }>(db, 'SELECT * FROM allocations WHERE id = ?', payload.allocationId);
  if (!a || a.status !== 'reserved') return;
  const lot = get<{ id: string; declared_grams: number; first_upload_id: string }>(db, `SELECT id, ${EFFECTIVE_DECLARED_SQL} AS declared_grams, first_upload_id FROM source_lots WHERE id = ?`, a.source_lot_id)!;
  const evidence = get<{ sha256: string }>(db, 'SELECT sha256 FROM uploads WHERE id = ?', lot.first_upload_id)!;
  const allocEvidence = get<{ sha256: string }>(db, 'SELECT sha256 FROM uploads WHERE id = ?', a.sources_upload_id)!;
  const batchKey = batchKeyFor(a.org_id, lot.id);
  const allocationKey = allocationKeyFor(a.org_id, a.id);
  run(db, 'UPDATE source_lots SET chain_batch_key = ? WHERE id = ? AND chain_batch_key IS NULL', batchKey, lot.id);
  const base = { orgId: a.org_id, shipmentId: a.shipment_id, cfg };

  const reg = upsertTx(db, { ...base, id: id(), action: 'registerBatch', idempotency_key: `registerBatch:${cfg.chain.id}:${cfg.registryAddress}:${batchKey}`, allocation_id: null, source_lot_id: lot.id, signer: declarant.address, args_json: JSON.stringify({ batchKey, declaredGrams: lot.declared_grams, evidenceHash: `0x${evidence.sha256}` }) });
  const okReg = await step(db, cfg, reg, (onSubmitted) => writeRegistry({ cfg, account: declarant, functionName: 'registerBatch', args: [batchKey, BigInt(lot.declared_grams), `0x${evidence.sha256}` as Hex], onSubmitted }), async () => {
    const b = await readBatch(cfg, batchKey);
    if (b && b.declaredGrams !== BigInt(lot.declared_grams)) throw new Error('on-chain batch declares a different quantity');
    return !!b;
  });
  if (!okReg) throw new Error('batch registration was rejected');

  const auth = upsertTx(db, { ...base, id: id(), action: 'authorizeReserver', idempotency_key: `authorizeReserver:${cfg.chain.id}:${cfg.registryAddress}:${batchKey}:${reserver.address}`, allocation_id: null, source_lot_id: lot.id, signer: declarant.address, args_json: JSON.stringify({ batchKey, actor: reserver.address, allowanceGrams: lot.declared_grams }) });
  const okAuth = await step(db, cfg, auth, (onSubmitted) => writeRegistry({ cfg, account: declarant, functionName: 'authorizeReserver', args: [batchKey, reserver.address, BigInt(lot.declared_grams)], onSubmitted }), async () => false);
  if (!okAuth) throw new Error('reserver authorisation was rejected');

  // Recheck after the asynchronous steps: never reserve on-chain an allocation the database no longer holds.
  const still = get<{ status: string }>(db, 'SELECT status FROM allocations WHERE id = ?', a.id);
  if (still?.status !== 'reserved') {
    audit(db, { orgId: a.org_id, shipmentId: a.shipment_id, type: 'chain.reserve_skipped', data: { allocationId: a.id, reason: 'allocation no longer reserved' } });
    return;
  }
  const res = upsertTx(db, { ...base, id: id(), action: 'reserve', idempotency_key: `reserve:${cfg.chain.id}:${cfg.registryAddress}:${allocationKey}`, allocation_id: a.id, source_lot_id: lot.id, signer: reserver.address, args_json: JSON.stringify({ batchKey, allocationKey, amountGrams: a.grams, evidenceHash: `0x${allocEvidence.sha256}` }) });
  const okRes = await step(db, cfg, res, (onSubmitted) => {
    if (get<{ status: string }>(db, 'SELECT status FROM allocations WHERE id = ?', a.id)?.status !== 'reserved') throw new Error('allocation released before submission; reservation not sent');
    return writeRegistry({ cfg, account: reserver, functionName: 'reserve', args: [batchKey, allocationKey, BigInt(a.grams), `0x${allocEvidence.sha256}` as Hex], onSubmitted });
  }, async () => !!(await readReservation(cfg, allocationKey)));
  audit(db, { orgId: a.org_id, shipmentId: a.shipment_id, type: okRes ? 'chain.reserved' : 'chain.reserve_rejected', data: { allocationId: a.id, batchKey, allocationKey } });
  // A rejected reservation is a settled outcome (recorded), not a retryable job failure.
}

export function queueAnchoring(db: DB, user: SessionUser, shipmentId: string) {
  getShipment(db, user, shipmentId);
  const { ready } = chainSetup();
  if (!ready) throw new HttpError(503, 'chain_unconfigured', 'Testnet anchoring is not configured on this server.');
  if (!user.chainEnabled) throw new HttpError(403, 'chain_not_enabled', 'Testnet anchoring is not enabled for your organisation. An administrator enables it per organisation to protect the shared test signer.');
  const st = computeState(db, user, shipmentId);
  if (st.evaluation.readiness.allocation !== 'RESERVED') throw new HttpError(409, 'not_reserved', 'Reserve the allocations in the ledger before anchoring them on the testnet.');
  const allocs = all<{ id: string }>(db, `SELECT id FROM allocations WHERE shipment_id = ? AND status = 'reserved' AND sources_upload_id = ?`, shipmentId, st.sourcesUpload!.id);
  // Bound what one organisation can make the shared test signer do: each allocation costs up to 3 transactions.
  const maxAlloc = Number(process.env.CHAIN_MAX_ALLOCATIONS_PER_REQUEST ?? 10);
  const dailyTx = Number(process.env.CHAIN_DAILY_TX_LIMIT ?? 30);
  if (allocs.length > maxAlloc) throw new HttpError(422, 'too_many_allocations', `This shipment has ${allocs.length} allocations; testnet anchoring is limited to ${maxAlloc} per request on this server.`);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const usedTx = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM chain_txs WHERE org_id = ? AND created_at >= ?`, user.orgId, since)!.n;
  const pendingJobs = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM jobs WHERE type = 'chain_anchor' AND status IN ('queued','running') AND json_extract(payload_json, '$.allocationId') IN (SELECT id FROM allocations WHERE org_id = ?)`, user.orgId)!.n;
  if (usedTx + 3 * (pendingJobs + allocs.length) > dailyTx) throw new HttpError(429, 'chain_budget', `Your organisation's testnet transaction budget (${dailyTx} per 24 h) would be exceeded. Try again later.`);
  const jobs = allocs.map((a) => enqueue(db, 'chain_anchor', { allocationId: a.id }, `chain_anchor:${a.id}`, 5));
  audit(db, { orgId: user.orgId, shipmentId, actorId: user.id, type: 'chain.anchor_queued', data: { allocations: allocs.length } });
  return { queued: jobs.length };
}

export async function chainStatus(db: DB, user: SessionUser, shipmentId: string) {
  getShipment(db, user, shipmentId);
  const { cfg, ready, declarant, reserver } = chainSetup();
  const txs = all<ChainTx>(db, 'SELECT * FROM chain_txs WHERE shipment_id = ? ORDER BY created_at', shipmentId);
  const jobs = all<{ status: string; last_error: string | null; payload_json: string }>(db, `SELECT status, last_error, payload_json FROM jobs WHERE type = 'chain_anchor' AND payload_json IN (SELECT json_object('allocationId', id) FROM allocations WHERE shipment_id = ?)`, shipmentId);
  // Chain-confirmed state is authoritative: read each anchored reservation back from the contract.
  const onChain: { allocationId: string; allocationKey: string; dbGrams: number; chainGrams: string | null; matches: boolean | null; error?: string }[] = [];
  if (ready) {
    for (const t of txs.filter((x) => x.action === 'reserve')) {
      const args = JSON.parse(t.args_json) as { allocationKey: Hex; amountGrams: number };
      try {
        const r = await readReservation(cfg, args.allocationKey, t.block_number ? BigInt(t.block_number) : undefined);
        onChain.push({ allocationId: t.allocation_id!, allocationKey: args.allocationKey, dbGrams: args.amountGrams, chainGrams: r ? r.amountGrams.toString() : null, matches: r ? r.amountGrams === BigInt(args.amountGrams) : null });
      } catch (e) {
        onChain.push({ allocationId: t.allocation_id!, allocationKey: args.allocationKey, dbGrams: args.amountGrams, chainGrams: null, matches: null, error: (e as Error).message.slice(0, 200) });
      }
    }
  }
  return {
    configured: ready,
    enabledForOrganisation: user.chainEnabled,
    network: cfg.network,
    chainId: cfg.chain.id,
    registryAddress: cfg.registryAddress,
    registryExplorer: cfg.registryAddress ? explorerAddressUrl(cfg, cfg.registryAddress) : null,
    signers: { declarant: declarant?.address ?? null, reserver: reserver?.address ?? null },
    jobs: jobs.map((j) => ({ status: j.status, error: j.last_error })),
    transactions: txs.map((t) => ({ action: t.action, status: t.status, txHash: t.tx_hash, explorer: t.tx_hash ? explorerTxUrl(cfg, t.tx_hash) : null, blockNumber: t.block_number, detail: t.detail ? JSON.parse(t.detail) : null, updatedAt: t.updated_at })),
    onChain,
  };
}

export async function publicVerify(db: DB, batchKey: string | null) {
  const { cfg, ready } = chainSetup();
  const evidencePath = 'docs/evidence/chain-engineering-sepolia.json';
  const engineering = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : null;
  let lookup = null;
  if (batchKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(batchKey)) throw new HttpError(400, 'bad_key', 'A batch key is a 32-byte hex value (0x + 64 hex characters).');
    try {
      const b = await readBatch(cfg, batchKey as Hex);
      lookup = b ? { found: true, declarant: b.declarant, declaredGrams: b.declaredGrams.toString(), reservedGrams: b.reservedGrams.toString(), evidenceHash: b.evidenceHash, registeredAt: new Date(Number(b.registeredAt) * 1000).toISOString() } : { found: false };
    } catch (e) {
      lookup = { found: null, error: `Could not read the registry: ${(e as Error).message.slice(0, 160)}` };
    }
  }
  const anchored = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM chain_txs WHERE action = 'reserve' AND status = 'confirmed'`)!.n;
  return {
    configured: ready,
    network: cfg.network,
    chainId: cfg.chain.id,
    registryAddress: cfg.registryAddress,
    registryExplorer: cfg.registryAddress ? explorerAddressUrl(cfg, cfg.registryAddress) : null,
    appAnchoredReservations: anchored,
    engineering,
    lookup,
    cannotVerify: [
      'that any cocoa was physically produced, or in the declared quantity',
      'land rights or legality of production',
      'physical movement of a shipment',
      'allocations recorded outside this contract or under a different batch key',
      'the accuracy of the documents whose hashes are committed',
      'authority to submit an EUDR due-diligence statement',
    ],
  };
}
