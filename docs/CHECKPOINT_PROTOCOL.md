# Bounded checkpoint protocol and guarantees

This is a single-writer, whole-SQLite checkpoint protocol, not a live hosted relational database, distributed transaction manager, or replicated database service. It is limited to small engineering workspaces. Supabase SQL and private object behavior remain unverified until `scripts/verify-supabase.ts --live` passes against an actual project.

## Recovery and publication

1. The process atomically claims an owner UUID in Postgres. This fences earlier writers; claiming is an operator-controlled deployment action, not a periodic attempt to steal a lease.
2. The committed immutable object is fetched, its SHA-256 checked, then AES-256-GCM authenticated with namespace-bound additional data. The SQLite header is checked. A temporary recovered file is renamed into the disposable cache before SQLite opens. Wrong/missing keys, corrupted bytes or a missing object fail startup; there is no empty-workspace fallback.
3. SQLite migrations run. Integrity/foreign-key checks and every referenced upload/document are checked: matching blob organization, successful authenticated decryption, plaintext byte count and SHA-256. Key fingerprints inside the encrypted database reject encryption/signing key discontinuity. Existing snapshots without the new identity metadata acquire it on first upgrade; they cannot prove signing-key continuity before that upgrade.
4. The HTTP listener starts only after recovery, integrity, initial checkpoint publication and raster verification. A failure stops startup rather than accepting writes early.
5. Each API operation performs an owner check. A changed database is copied using synchronous `VACUUM INTO` on its owning connection; no async interleaving occurs while SQLite captures the copy. All referenced evidence lives in the same database, so the object includes both records and encrypted bytes. Orphan blobs may be harmless; dangling or cross-organization references prevent publication.
6. The whole snapshot is encrypted, uploaded to a unique immutable key, downloaded and checked before publication. The Postgres commit RPC changes the authoritative pointer only if owner and revision match. A lost commit response is reconciled against the exact key, digest, owner and next revision. An HTTP success waits for confirmation. No external-service success is inferred from a local SQLite commit.
7. Two committed snapshots are retained. Superseded objects are removed best-effort. Interrupted uploads and ambiguous failures can leave orphans. Do not delete any object referenced by either committed pointer; automated global bucket cleanup is intentionally absent.

## Faults and practical limits

- Failed/uncertain writes can still exist in the local dirty cache and can be included in a later successful checkpoint. The response explicitly says the outcome is uncertain. There is no claim of rollback, idempotent replay or exactly-once execution. Inspect current records before retrying; the browser never automatically replays mutations.
- A new owner can interrupt the old deployment during upload. Its conditional commit must fail. An old process may continue local computation, but cannot publish a checkpoint under the new owner's revision. A failed new deployment can leave the older service fenced and unavailable; the operator must recover/redeploy with the original keys.
- Reads, authentication, hashing/encryption and snapshot creation still cost CPU. Raster decoding is isolated in a child process; this does not guarantee unlimited concurrency or bound every PDF, SQLite, password hashing or provider request latency.
- No multi-region or multi-writer use. An operator with service-role access can replace pointers or delete storage; cryptographic integrity does not prevent an authorized rollback to a previously valid snapshot. No anti-rollback promise across compromised administrative credentials.
- Storage upload plus pointer commit is not one distributed transaction: publication is conditional, while object orphans are possible. Provider acknowledgement/durability and row/object permissions must be tested live. Two retained objects are not an independent disaster-recovery backup.
- Restore validates all evidence; publication checks references. Immutable evidence bytes are encrypted by organization as well as by the outer database checkpoint. Both keys and an independent encrypted backup require secure continuity.

## Evidence

The eight durability integration tests cover fresh-cache account/org/evidence restoration, missing evidence, wrong encryption/signing keys, altered ciphertext, interrupted upload, lost commit responses, stale writers, and replacement during an in-flight upload. These are local protocol fault tests. The live verifier separately exercises actual RPC/Storage calls and anon-key denial using a unique engineering namespace, then deletes only that namespace's objects and pointer.
