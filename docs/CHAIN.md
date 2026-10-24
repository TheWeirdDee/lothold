# Allocation registry (testnet)

Contract: `contracts/src/BatchReservations.sol` (Solidity 0.8.28, Foundry). No tokens, no value transfer, no pricing.

## Deployment

| Item | Value |
|---|---|
| Network | Ethereum **Sepolia** testnet, chain ID 11155111 |
| Address | `0x1645604d915c55cfd61cf1492ad58ab5e4150b57` — https://sepolia.etherscan.io/address/0x1645604d915c55cfd61cf1492ad58ab5e4150b57 |
| Deployment tx | `0x3636e84e31320ea3f5aadd250f208b67d483b83f789dffc9dd871c5c3435615e` (2026-10-23) |
| Registrar / declarant (pilot signer) | `0x9f5E6057606bC655E6dB8a6aDab40CB11217FA44` |
| Reserver A (pilot signer) | `0x330D1bC6B9db359FeFed4bB754a21Ded89AE6113` |
| Reserver B (engineering verification only) | `0xeD7a68B3F2d96fAb6BaE926B6F3B84816fc1c058` |

Keys exist only in the git-ignored `.env`; they were generated locally by `scripts/generate-testnet-keys.ts`, which prints addresses only.

## Rules enforced on-chain

- Only the **registrar** (deployer) can authorise declarants.
- Only an authorised **declarant** can register a batch, once per key, with a non-zero mass and a non-zero evidence hash.
- Only the batch's declarant can grant reservers an **allowance** (set, not add; zero revokes).
- `reserve` requires a non-zero allocation key never used before, a non-zero amount within the actor's allowance, and `reserved + amount ≤ declared`. All checks run before any state change, and the event is emitted after the ledger update.

## Engineering verification on Sepolia (2026-10-23, `scripts/chain-engineering-verify.ts`)

**ENGINEERING TEST, not commercial activity.** Quantities are test inputs. Full record: `docs/evidence/chain-engineering-sepolia.json`.

| Step | Outcome | Transaction |
|---|---|---|
| Registrar authorises declarant | confirmed, block 11977279 | `0x7b34b44c…13f3b` |
| Actor A tries to register a batch | **preflight rejected** (`NotDeclarant`), not mined | — |
| Declarant registers 1,000,000 g test batch | confirmed, block 11977280 | `0x1325c794…2ee3` |
| Declarant authorises A and B | confirmed, blocks 11977282 / 11977285 | `0x4a6cd88f…c6e4`, `0xcd479206…abbc` |
| A reserves 600,000 g | confirmed, block 11977286 | `0xe47f5518…a6be` |
| B requests 600,000 g | **preflight rejected** (`ExceedsAvailable(400000, 600000)`), not mined | — |
| B submits 600,000 g anyway | **mined and reverted**, block 11977287 (26,139 gas, below the limit, so a contract revert and not out-of-gas) | `0x37e2e02a…02a0` |
| State after rejection | reserved 600,000 g before and after (read at the confirming blocks); B's allowance unchanged; no reservation recorded | — |
| A retries the same allocation ID | preflight rejected (`AllocationAlreadyUsed`) | — |
| A and B each submit 300,000 g simultaneously (400,000 g left) | exactly one confirmed (B), one reverted (A), same block 11977289 | `0x2f20283a…5178`, `0xcfed88e8…a4a9` |
| B reserves the exact remainder 100,000 g | confirmed, block 11977290 | `0x1e86a1b1…080f` |
| Final state | declared 1,000,000 g = reserved 1,000,000 g | — |

Full hashes are in the evidence JSON.

## In-app anchoring on Sepolia (2026-10-24, `scripts/app-anchoring-sepolia.ts`)

The application path (ledger reservation → durable job → registerBatch → authorizeReserver → reserve → read-back) was run with the labelled engineering fixture: 6 confirmed transactions in blocks 11982223–11982228, and both reservations read back from the contract matching the ledger (600,000 g and 400,000 g). Record: `docs/evidence/app-anchoring-sepolia.json`.

## Transaction lifecycle in the app

`server/chain/registry.ts` and `server/chain/anchor.ts`:

- **Preflight** (`simulateContract`) rejection → `preflight_rejected` with the decoded reason. Labelled "not mined"; no hash is shown.
- **Submission** → the hash is stored *before* waiting (`pending`).
- **Receipt** → `confirmed` or `reverted` with block number.
- **RPC error** → `rpc_error`; the job retries (bounded) and reconciles by hash instead of resubmitting.
- **Restart** → a `pending` row is reconciled from its hash (tested against Anvil: the signer's nonce did not change).
- **Idempotency** → every step has a unique idempotency key; an allocation key can only be reserved once on-chain anyway.
- **Disagreement** → if the chain already holds a batch with a different declared quantity, anchoring stops with an explicit error and the ledger is untouched (tested).
- **Read-back** → the UI shows the reservation as read from the contract, or "not found" / "MISMATCH".
- **Stale reads** on the load-balanced public RPC were observed. Reads after a write are pinned to the confirming block, with bounded waiting.

## Trust assumptions and limits

- **Who may register supply:** the registrar decides which addresses may declare. In this pilot, the LotHold server's declarant key registers each organisation's first confirmed lot totals, using the SHA-256 of the source file as the evidence commitment.
- **Who confirms the declaration:** nobody on-chain. The registry records what the declarant asserted; a dishonest declarant can declare any mass.
- **Duplicate identities:** batch keys are `keccak256("lothold:batch:v1:<org>:<lot id>")`. The same physical cocoa declared under another key, by another organisation, or off-platform is invisible to the contract.
- **Actor identity:** the server signs for reviewers. On-chain addresses identify the pilot signers.
- **Abuse protection** (all enforced server-side, tested against Anvil):
  - **Per organisation:**
    - anchoring is disabled by default (`node scripts/admin.ts enable-chain <email>`);
    - at most 10 anchoring requests per hour;
    - at most `CHAIN_MAX_ALLOCATIONS_PER_REQUEST` (10) allocations per request;
    - at most `CHAIN_DAILY_TX_LIMIT` (30) transactions per 24 hours, counting queued work.
  - **Before any signature:**
    - the RPC's chain ID must equal the configured chain (refuses e.g. a mainnet RPC);
    - the network fee must be below `CHAIN_MAX_FEE_GWEI`.
  - **Keys:** never leave the server, are read only from the environment, and are never logged or returned.
  - **Configuration:** only `sepolia` and `local-devnet` are accepted.
  - **Public deployments:** the template sets `CHAIN_ANCHORING=off`.
- **Gas observation:** a first reservation used 599,076 gas on Sepolia versus 150,776 on a local Anvil devnet, which Sepolia's higher storage-creation pricing explains. Local devnet gas figures are not representative.
