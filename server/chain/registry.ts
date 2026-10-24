// Testnet allocation-registry client. Keys stay server-side; the browser never signs.
// Every write goes through: preflight simulation -> submission -> receipt (confirmed or reverted).
// A preflight rejection is NOT a mined transaction and is labelled as such.
import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  http,
  keccak256,
  toHex,
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia, foundry } from 'viem/chains';

const artifact = JSON.parse(readFileSync(new URL('./artifact.json', import.meta.url), 'utf8')) as {
  abi: Abi;
  bytecode: Hex;
  compiler: string;
};
export const registryAbi = artifact.abi;
export const registryBytecode = artifact.bytecode;
export const registryCompiler = artifact.compiler;

export type ChainConfig = {
  chain: Chain;
  rpcUrl: string;
  explorerBase: string | null;
  registryAddress: Address | null;
  network: 'sepolia' | 'local-devnet';
};

export function chainConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ChainConfig {
  const network = env.CHAIN_NETWORK === 'local-devnet' ? 'local-devnet' : 'sepolia';
  const chain = network === 'sepolia' ? sepolia : foundry;
  const rpcUrl =
    env.CHAIN_RPC_URL || (network === 'sepolia' ? 'https://ethereum-sepolia-rpc.publicnode.com' : 'http://127.0.0.1:8545');
  const addr = env.REGISTRY_ADDRESS;
  return {
    chain,
    rpcUrl,
    network,
    explorerBase: network === 'sepolia' ? 'https://sepolia.etherscan.io' : null,
    registryAddress: addr && /^0x[0-9a-fA-F]{40}$/.test(addr) ? (addr as Address) : null,
  };
}

export function accountFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): PrivateKeyAccount | null {
  const key = env[name];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as Hex);
}

export function publicClientFor(cfg: ChainConfig): PublicClient {
  return createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl, { timeout: 20_000, retryCount: 2 }) }) as PublicClient;
}

/** Deterministic, non-identifying on-chain keys. Inputs are internal IDs, never names or geometry. */
export function batchKeyFor(namespace: string, sourceLotId: string): Hex {
  return keccak256(toHex(`lothold:batch:v1:${namespace}:${sourceLotId}`));
}
export function allocationKeyFor(namespace: string, allocationId: string): Hex {
  return keccak256(toHex(`lothold:allocation:v1:${namespace}:${allocationId}`));
}

export type DecodedRevert = { name: string; args: readonly unknown[] | undefined; message: string };

export function decodeRevert(err: unknown): DecodedRevert | null {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data) {
      return {
        name: revert.data.errorName,
        args: revert.data.args,
        message: describeRevert(revert.data.errorName, revert.data.args),
      };
    }
    const raw = err.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null;
    if (raw?.data) {
      try {
        const d = decodeErrorResult({ abi: registryAbi, data: raw.data });
        return { name: d.errorName, args: d.args, message: describeRevert(d.errorName, d.args) };
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

export function describeRevert(name: string, args: readonly unknown[] | undefined): string {
  const a = (args ?? []).map((x) => (typeof x === 'bigint' ? x.toString() : String(x)));
  switch (name) {
    case 'ExceedsAvailable':
      return `Request of ${a[1]} g exceeds the ${a[0]} g still available on the registered batch.`;
    case 'ExceedsAllowance':
      return `Request of ${a[1]} g exceeds this actor's remaining allowance of ${a[0]} g.`;
    case 'AllocationAlreadyUsed':
      return 'This allocation identifier has already been reserved; a retry cannot reserve it twice.';
    case 'NotAuthorizedReserver':
      return 'This signer has no allowance on the batch.';
    case 'BatchAlreadyRegistered':
      return 'This batch key is already registered.';
    case 'UnknownBatch':
      return 'The batch is not registered on this contract.';
    case 'NotDeclarant':
      return 'Signer is not an authorised declarant.';
    case 'NotBatchDeclarant':
      return 'Only the batch declarant may authorise reservers.';
    case 'NotRegistrar':
      return 'Only the registrar may authorise declarants.';
    case 'ZeroAmount':
      return 'Quantity must be greater than zero.';
    case 'ZeroKey':
      return 'Keys and evidence commitments must be non-zero.';
    default:
      return name;
  }
}

export type WriteOutcome =
  | { kind: 'preflight_rejected'; revert: DecodedRevert | null; error: string }
  | { kind: 'rpc_error'; stage: 'preflight' | 'submit' | 'receipt'; error: string; txHash?: Hash }
  | { kind: 'pending'; txHash: Hash }
  | { kind: 'confirmed'; txHash: Hash; blockNumber: bigint; gasUsed: bigint; receipt: TransactionReceipt }
  | { kind: 'reverted'; txHash: Hash; blockNumber: bigint; gasUsed: bigint; receipt: TransactionReceipt };

type WriteArgs = {
  cfg: ChainConfig;
  account: PrivateKeyAccount;
  functionName: 'setDeclarant' | 'registerBatch' | 'authorizeReserver' | 'reserve';
  args: readonly unknown[];
  /** Skip simulation and send with an explicit gas limit so a rejection is mined (engineering evidence only). */
  forceSubmitGas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  onSubmitted?: (txHash: Hash) => void | Promise<void>;
};

function shortError(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : String(e);
}

export async function writeRegistry(w: WriteArgs): Promise<WriteOutcome> {
  const { cfg, account } = w;
  if (!cfg.registryAddress) throw new Error('REGISTRY_ADDRESS is not configured');
  const pub = publicClientFor(cfg);
  const wallet = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl, { timeout: 20_000 }) });
  let request: Parameters<typeof wallet.writeContract>[0];
  if (w.forceSubmitGas) {
    request = {
      address: cfg.registryAddress,
      abi: registryAbi,
      functionName: w.functionName,
      args: w.args,
      gas: w.forceSubmitGas,
      account,
      chain: cfg.chain,
    } as Parameters<typeof wallet.writeContract>[0];
  } else {
    try {
      const sim = await pub.simulateContract({
        address: cfg.registryAddress,
        abi: registryAbi,
        functionName: w.functionName,
        args: w.args,
        account,
      });
      request = sim.request as Parameters<typeof wallet.writeContract>[0];
    } catch (e) {
      const revert = decodeRevert(e);
      if (revert) return { kind: 'preflight_rejected', revert, error: revert.message };
      return { kind: 'rpc_error', stage: 'preflight', error: shortError(e) };
    }
  }
  let txHash: Hash;
  try {
    txHash = await wallet.writeContract(request);
  } catch (e) {
    const revert = decodeRevert(e);
    if (revert) return { kind: 'preflight_rejected', revert, error: revert.message };
    return { kind: 'rpc_error', stage: 'submit', error: shortError(e) };
  }
  await w.onSubmitted?.(txHash);
  if (w.waitForReceipt === false) return { kind: 'pending', txHash };
  return awaitReceipt(cfg, txHash, w.receiptTimeoutMs);
}

export async function awaitReceipt(cfg: ChainConfig, txHash: Hash, timeoutMs = 180_000): Promise<WriteOutcome> {
  const pub = publicClientFor(cfg);
  try {
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs, pollingInterval: 2_000 });
    const base = { txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, receipt };
    return receipt.status === 'success' ? { kind: 'confirmed', ...base } : { kind: 'reverted', ...base };
  } catch (e) {
    return { kind: 'rpc_error', stage: 'receipt', error: shortError(e), txHash };
  }
}

/** Looks up a previously submitted transaction without resubmitting it (reconciliation after restart). */
export async function reconcileTx(cfg: ChainConfig, txHash: Hash): Promise<WriteOutcome> {
  const pub = publicClientFor(cfg);
  try {
    const receipt = await pub.getTransactionReceipt({ hash: txHash });
    const base = { txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, receipt };
    return receipt.status === 'success' ? { kind: 'confirmed', ...base } : { kind: 'reverted', ...base };
  } catch {
    try {
      const tx = await pub.getTransaction({ hash: txHash });
      return tx ? { kind: 'pending', txHash } : { kind: 'rpc_error', stage: 'receipt', error: 'transaction not found', txHash };
    } catch (e) {
      return { kind: 'rpc_error', stage: 'receipt', error: shortError(e), txHash };
    }
  }
}

export type OnChainBatch = {
  declarant: Address;
  declaredGrams: bigint;
  reservedGrams: bigint;
  evidenceHash: Hex;
  registeredAt: bigint;
};

/**
 * Public RPCs are load-balanced; a node may not yet have the block that confirmed a write.
 * Reads that follow a write pass the confirming block so they never observe stale state.
 */
export async function waitForBlock(cfg: ChainConfig, minBlock: bigint, timeoutMs = 60_000): Promise<bigint> {
  const pub = publicClientFor(cfg);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n = await pub.getBlockNumber({ cacheTime: 0 });
    if (n >= minBlock) return n;
    if (Date.now() > deadline) throw new Error(`RPC did not reach block ${minBlock} (at ${n})`);
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

async function readAt<T>(cfg: ChainConfig, functionName: string, args: readonly unknown[], minBlock?: bigint): Promise<T> {
  const pub = publicClientFor(cfg);
  const call = (blockNumber?: bigint) =>
    pub.readContract({ address: cfg.registryAddress!, abi: registryAbi, functionName, args, blockNumber }) as Promise<T>;
  if (minBlock === undefined) return call();
  for (let attempt = 0; ; attempt++) {
    try {
      await waitForBlock(cfg, minBlock);
      return await call(minBlock);
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

export async function readBatch(cfg: ChainConfig, batchKey: Hex, minBlock?: bigint): Promise<OnChainBatch | null> {
  if (!cfg.registryAddress) return null;
  const b = await readAt<OnChainBatch>(cfg, 'getBatch', [batchKey], minBlock);
  return b.declarant === '0x0000000000000000000000000000000000000000' ? null : b;
}

export async function readReservation(cfg: ChainConfig, allocationKey: Hex, minBlock?: bigint) {
  if (!cfg.registryAddress) return null;
  const r = await readAt<{ batchKey: Hex; actor: Address; amountGrams: bigint; evidenceHash: Hex; reservedAt: bigint }>(
    cfg, 'getReservation', [allocationKey], minBlock);
  return r.actor === '0x0000000000000000000000000000000000000000' ? null : r;
}

export async function readAllowance(cfg: ChainConfig, batchKey: Hex, actor: Address, minBlock?: bigint): Promise<bigint> {
  if (!cfg.registryAddress) return 0n;
  return readAt<bigint>(cfg, 'allowanceGrams', [batchKey, actor], minBlock);
}

export function explorerTxUrl(cfg: ChainConfig, txHash: string): string | null {
  return cfg.explorerBase ? `${cfg.explorerBase}/tx/${txHash}` : null;
}
export function explorerAddressUrl(cfg: ChainConfig, address: string): string | null {
  return cfg.explorerBase ? `${cfg.explorerBase}/address/${address}` : null;
}
