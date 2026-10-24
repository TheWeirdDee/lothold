// ENGINEERING VERIFICATION — not commercial activity.
// Exercises the shared-allocation constraint with one declarant and two authorised reservers.
// Test quantities (1,000 kg declared; 600 kg + 600 kg requested) are engineering inputs only.
//
// Usage:
//   node --env-file=.env scripts/chain-engineering-verify.ts --network local-devnet
//   node --env-file=.env scripts/chain-engineering-verify.ts --network sepolia [--deploy]
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import {
  accountFromEnv,
  awaitReceipt,
  chainConfigFromEnv,
  explorerTxUrl,
  readBatch,
  readAllowance,
  readReservation,
  registryAbi,
  registryBytecode,
  registryCompiler,
  writeRegistry,
  type ChainConfig,
  type WriteOutcome,
} from '../server/chain/registry.ts';

const argv = process.argv.slice(2);
const network = (argv[argv.indexOf('--network') + 1] ?? 'local-devnet') as 'local-devnet' | 'sepolia';
const forceDeploy = argv.includes('--deploy');

const deployer = accountFromEnv('CHAIN_DEPLOYER_KEY');
const actorA = accountFromEnv('CHAIN_ACTOR_A_KEY');
const actorB = accountFromEnv('CHAIN_ACTOR_B_KEY');
if (!deployer || !actorA || !actorB) {
  console.error('Missing CHAIN_DEPLOYER_KEY / CHAIN_ACTOR_A_KEY / CHAIN_ACTOR_B_KEY. Run scripts/generate-testnet-keys.ts.');
  process.exit(1);
}

let anvil: ChildProcess | null = null;
const env: NodeJS.ProcessEnv = { ...process.env, CHAIN_NETWORK: network };
if (network === 'local-devnet') {
  env.CHAIN_RPC_URL = 'http://127.0.0.1:8546';
  delete env.REGISTRY_ADDRESS;
  anvil = spawn(join(homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil'), ['--port', '8546', '--silent'], {
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));
}
let cfg: ChainConfig = chainConfigFromEnv(env);
const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });

const steps: Record<string, unknown>[] = [];
function record(step: string, outcome: WriteOutcome | Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const o = outcome as WriteOutcome;
  const entry: Record<string, unknown> = { step, ...extra };
  if ('kind' in o) {
    entry.outcome = o.kind;
    if ('txHash' in o && o.txHash) {
      entry.txHash = o.txHash;
      entry.explorer = explorerTxUrl(cfg, o.txHash);
    }
    if ('blockNumber' in o) entry.blockNumber = o.blockNumber.toString();
    if ('gasUsed' in o) entry.gasUsed = o.gasUsed.toString();
    if (o.kind === 'preflight_rejected') entry.revert = { name: o.revert?.name, message: o.error };
    if (o.kind === 'rpc_error') entry.error = o.error;
  } else Object.assign(entry, outcome);
  steps.push(entry);
  console.log(JSON.stringify(entry, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function must(o: WriteOutcome, kind: WriteOutcome['kind'], label: string) {
  if (o.kind !== kind) throw new Error(`${label}: expected ${kind}, got ${o.kind} ${'error' in o ? o.error : ''}`);
  // A mined revert that consumed the whole gas limit is out-of-gas, not a contract-logic rejection.
  if (o.kind === 'reverted' && o.receipt.gasUsed >= FORCED_GAS) throw new Error(`${label}: reverted by gas exhaustion, not contract logic`);
}
const FORCED_GAS = 1_500_000n;

try {
  const chainId = await pub.getChainId();
  if (chainId !== cfg.chain.id) throw new Error(`RPC chain id ${chainId} does not match expected ${cfg.chain.id}`);

  if (network === 'local-devnet') {
    for (const a of [deployer, actorA, actorB]) {
      await pub.request({ method: 'anvil_setBalance' as never, params: [a.address, '0x8AC7230489E80000'] as never });
    }
  }

  // Deploy (or reuse).
  let deployTx: Hash | null = null;
  if (!cfg.registryAddress || forceDeploy) {
    const wallet = createWalletClient({ account: deployer, chain: cfg.chain, transport: http(cfg.rpcUrl) });
    deployTx = await wallet.deployContract({ abi: registryAbi, bytecode: registryBytecode, args: [] });
    const r = await pub.waitForTransactionReceipt({ hash: deployTx, timeout: 240_000 });
    if (r.status !== 'success' || !r.contractAddress) throw new Error('deployment failed');
    cfg = { ...cfg, registryAddress: r.contractAddress };
    record('deploy', { outcome: 'confirmed', txHash: deployTx, explorer: explorerTxUrl(cfg, deployTx), contractAddress: r.contractAddress, blockNumber: r.blockNumber.toString() });
  } else {
    record('reuse-deployment', { contractAddress: cfg.registryAddress });
  }

  // Fund actors with a small amount of test gas (Sepolia only).
  if (network === 'sepolia') {
    const wallet = createWalletClient({ account: deployer, chain: cfg.chain, transport: http(cfg.rpcUrl) });
    for (const a of [actorA, actorB]) {
      const bal = await pub.getBalance({ address: a.address });
      if (bal < parseEther('0.002')) {
        const h = await wallet.sendTransaction({ to: a.address, value: parseEther('0.004') });
        const r = await pub.waitForTransactionReceipt({ hash: h, timeout: 240_000 });
        record('fund-actor-gas', { outcome: r.status === 'success' ? 'confirmed' : 'reverted', txHash: h, explorer: explorerTxUrl(cfg, h), to: a.address, valueEth: '0.004' });
      }
    }
  }

  const runId = new Date().toISOString();
  const batchKey = `0x${createHash('sha256').update(`lothold-engineering-test-batch:${runId}`).digest('hex')}` as Hex;
  const evidenceHash = `0x${createHash('sha256').update(`ENGINEERING TEST ONLY — no commercial evidence — ${runId}`).digest('hex')}` as Hex;
  const allocA = `0x${createHash('sha256').update(`eng-alloc-A:${runId}`).digest('hex')}` as Hex;
  const allocB = `0x${createHash('sha256').update(`eng-alloc-B:${runId}`).digest('hex')}` as Hex;
  const allocB2 = `0x${createHash('sha256').update(`eng-alloc-B2:${runId}`).digest('hex')}` as Hex;
  const allocC1 = `0x${createHash('sha256').update(`eng-alloc-C1:${runId}`).digest('hex')}` as Hex;
  const allocC2 = `0x${createHash('sha256').update(`eng-alloc-C2:${runId}`).digest('hex')}` as Hex;
  const DECLARED = 1_000_000n;

  // Authorisation chain.
  let o = await writeRegistry({ cfg, account: deployer, functionName: 'setDeclarant', args: [deployer.address, true] });
  record('registrar-authorises-declarant', o); must(o, 'confirmed', 'setDeclarant');

  o = await writeRegistry({ cfg, account: actorA, functionName: 'registerBatch', args: [batchKey, DECLARED, evidenceHash] });
  record('unauthorised-registration-attempt (actor A is not a declarant)', o); must(o, 'preflight_rejected', 'unauthorised register');

  o = await writeRegistry({ cfg, account: deployer, functionName: 'registerBatch', args: [batchKey, DECLARED, evidenceHash] });
  record('declarant-registers-test-batch (1,000,000 g)', o, { batchKey, evidenceHash }); must(o, 'confirmed', 'registerBatch');

  for (const [label, acct] of [['A', actorA], ['B', actorB]] as const) {
    o = await writeRegistry({ cfg, account: deployer, functionName: 'authorizeReserver', args: [batchKey, acct.address, DECLARED] });
    record(`declarant-authorises-actor-${label}`, o, { actor: acct.address }); must(o, 'confirmed', 'authorize');
  }

  // Case B: A reserves 600 kg.
  o = await writeRegistry({ cfg, account: actorA, functionName: 'reserve', args: [batchKey, allocA, 600_000n, evidenceHash] });
  record('actor-A-reserves-600000g', o, { allocationKey: allocA }); must(o, 'confirmed', 'reserve A');
  const blockA = (o as Extract<WriteOutcome, { kind: 'confirmed' }>).blockNumber;
  const afterA = await readBatch(cfg, batchKey, blockA);

  // B requests 600 kg -> preflight rejection.
  o = await writeRegistry({ cfg, account: actorB, functionName: 'reserve', args: [batchKey, allocB, 600_000n, evidenceHash] });
  record('actor-B-requests-600000g (preflight)', o, { allocationKey: allocB }); must(o, 'preflight_rejected', 'reserve B preflight');

  // B submits anyway with explicit gas -> mined, reverted transaction.
  o = await writeRegistry({ cfg, account: actorB, functionName: 'reserve', args: [batchKey, allocB, 600_000n, evidenceHash], forceSubmitGas: FORCED_GAS });
  record('actor-B-submits-600000g-without-preflight (mined)', o, { allocationKey: allocB }); must(o, 'reverted', 'reserve B forced');

  const blockB = (o as Extract<WriteOutcome, { kind: 'reverted' }>).blockNumber;
  const afterB = await readBatch(cfg, batchKey, blockB);
  const bAllowance = await readAllowance(cfg, batchKey, actorB.address, blockB);
  const bReservation = await readReservation(cfg, allocB, blockB);
  record('state-after-rejection', {
    readAtBlocks: { afterA: blockA.toString(), afterB: blockB.toString() },
    reservedGramsBefore: afterA?.reservedGrams.toString(),
    reservedGramsAfter: afterB?.reservedGrams.toString(),
    unchanged: afterA?.reservedGrams === afterB?.reservedGrams,
    actorBAllowance: bAllowance.toString(),
    actorBReservationRecorded: bReservation !== null,
  });
  if (afterA?.reservedGrams !== afterB?.reservedGrams || bReservation) throw new Error('state changed after rejection');

  // Retry of A's allocation id cannot reserve twice.
  o = await writeRegistry({ cfg, account: actorA, functionName: 'reserve', args: [batchKey, allocA, 1n, evidenceHash] });
  record('actor-A-retries-same-allocation-id', o); must(o, 'preflight_rejected', 'retry');

  // Concurrent submissions: 400,000 g remain; A and B each submit 300,000 g at once without waiting.
  const [cA, cB] = await Promise.all([
    writeRegistry({ cfg, account: actorA, functionName: 'reserve', args: [batchKey, allocC1, 300_000n, evidenceHash], forceSubmitGas: FORCED_GAS, waitForReceipt: false }),
    writeRegistry({ cfg, account: actorB, functionName: 'reserve', args: [batchKey, allocC2, 300_000n, evidenceHash], forceSubmitGas: FORCED_GAS, waitForReceipt: false }),
  ]);
  const settled: WriteOutcome[] = [];
  for (const c of [cA, cB]) settled.push(c.kind === 'pending' ? await awaitReceipt(cfg, c.txHash) : c);
  record('concurrent-A-300000g', settled[0]!);
  record('concurrent-B-300000g', settled[1]!);
  for (const s of settled) if (s.kind === 'reverted' && s.gasUsed >= FORCED_GAS) throw new Error('concurrent revert was gas exhaustion');
  const kinds = settled.map((s) => s.kind).sort();
  if (!(kinds[0] === 'confirmed' && kinds[1] === 'reverted')) throw new Error(`expected exactly one concurrent success, got ${kinds.join(',')}`);

  // B reserves the exact remainder.
  const lastBlock = settled.reduce((m, s) => ('blockNumber' in s && s.blockNumber > m ? s.blockNumber : m), 0n);
  const remaining = (await readBatch(cfg, batchKey, lastBlock))!;
  const rem = remaining.declaredGrams - remaining.reservedGrams;
  o = await writeRegistry({ cfg, account: actorB, functionName: 'reserve', args: [batchKey, allocB2, rem, evidenceHash] });
  record(`actor-B-reserves-exact-remainder-${rem}g`, o); must(o, 'confirmed', 'remainder');
  const final = (await readBatch(cfg, batchKey, (o as Extract<WriteOutcome, { kind: 'confirmed' }>).blockNumber))!;
  record('final-state', { declaredGrams: final.declaredGrams.toString(), reservedGrams: final.reservedGrams.toString(), conserved: final.reservedGrams === final.declaredGrams });

  const balance = await pub.getBalance({ address: deployer.address });
  const evidence = {
    label: 'ENGINEERING TEST — shared allocation constraint. Not commercial inventory; quantities are test inputs.',
    network,
    chainId,
    rpcHost: new URL(cfg.rpcUrl).host,
    contract: { address: cfg.registryAddress, compiler: registryCompiler, deployTx, source: 'contracts/src/BatchReservations.sol' },
    actors: { registrarAndDeclarant: deployer.address, reserverA: actorA.address, reserverB: actorB.address },
    runAt: runId,
    deployerBalanceAfterEth: formatEther(balance),
    steps,
  };
  mkdirSync('docs/evidence', { recursive: true });
  const file = `docs/evidence/chain-engineering-${network}.json`;
  writeFileSync(file, JSON.stringify(evidence, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
  console.log(`\nPASS — evidence written to ${file}`);
  if (network === 'sepolia') console.log(`REGISTRY_ADDRESS=${cfg.registryAddress as Address}`);
} catch (e) {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  anvil?.kill();
}
