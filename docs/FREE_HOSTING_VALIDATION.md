# Deployment reliability validation - 2026-10-25

**This is not a validated free hosted deployment.** The user has provisioned the Render Free Docker backend at https://lothold.onrender.com. With explicit publishing authorization, routing commit 4a9c877 was pushed and Vercel now forwards /api requests to that backend; strict readiness returns HTTP 200 on both origins. No purchase or operational-data migration was performed. Hosted API workflow passed 17 checks through Vercel, including registration/session, uploads, real raster analysis, PDF download and byte-identical evidence decryption. Browser login/session, review PDF download and unsigned XML refusal passed separately. All 10 checks passed after the user-reported Render restart, including the same account, case, audit history and byte-identical PDF/evidence. All 10 recovery checks also passed after a separate user-reported filesystem-replacing Render redeployment. The same saved account, case, audit, PDF and evidence were accessible. Evidence: [hosted workflow](evidence/hosted-workflow.json). What *has* been verified live, on 25 October 2026, is the Supabase persistence layer itself: after `deploy/render/supabase.sql` was applied to the project, `node --env-file=.env scripts/verify-supabase.ts --live` created an isolated engineering namespace and passed all 22 checks — RPC claim/commit/status, private immutable uploads, byte-identical read-back and restore after a fresh-cache restart, stale-writer rejection plus direct SQL stale-owner/stale-revision commit rejection with an unchanged pointer, denial of all three RPCs to anon callers, private-bucket denial for anonymous and anon-key callers, and bounded encrypted checkpoint sizes — then removed that namespace only. The record is `docs/evidence/supabase-live.json` (`status: passed`, `liveVerified: true`). Approved XML draft export, evidence-change invalidation and an independent fresh-download XSD validation passed for the hosted demo case ([demo artifact evidence](evidence/demo-artifacts-final.json)); concurrency reliability remains unverified, and the earlier 404 failure recorded in this file's history was resolved by applying that SQL.

## Final production image and resource measurements

The final runtime contains the current frontend and bundled backend, not an inherited frontend overlay. Build identity: `sha256:7457f0ef695b949c2acb719dd131f9c048705f199ee571ab362ae672fb9f3d69` (manifest list). Platform/config identities, frontend asset and raster provenance are in `docs/evidence/release/build-identity.json`. Image inspection reports 458,849,655 bytes. The local build reused only raster bytes from a named data-stage input and reverified all three full SHA-256 pins before building current sources. The portable Dockerfile's default data stage downloads/verifies those same pins.

Measured on that exact image, with a 512 MiB hard limit, no swap and 0.1 CPU:

| Check | Result |
| --- | --- |
| Workflow | 17 checks passed, including real raster results, PDF generation/download, byte-identical decrypted evidence and responsiveness |
| Restart | 10 checks passed: same account/case, evaluation, audit, byte-identical PDF and upload |
| Peak cgroup memory during workflow | 265,109,504 bytes (about 253 MiB); OOM and OOM-kill counters zero |
| First HTTP readiness response after container start | 49.363 s |
| Application startup phases, initial / restart | 8.502 s / 9.801 s |
| First JavaScript milestone after container start | 39.265 s; native initialization/scheduling/CPU contention before that milestone is not separately attributed |
| Forest job | 46.265 s |
| Health during analysis (31 samples) | p95 394 ms; max 409 ms |
| Case-status during analysis | p95 899 ms; max 1,385 ms |
| Supplier PDF request | 15.699 s |

The verifier shares the container budget. HTTP latency measurements include client/scheduling overhead. This is one small sequential engineering scenario on local WSL/Docker, not a capacity benchmark or provider cold-start SLA. Raster work now runs in a single child process with bounded queue/job lifetime; public inspection returns a temporary job and the browser polls queued/running/complete/failed status without invented percentages. Restart uses the same local filesystem; it is **not** a filesystem-replacing hosted redeploy or a remote persistence proof. Live recovery latency, per-request ownership checks/checkpoint traffic and hosted concurrency remain unmeasured.

Raw startup phases, CPU timings, workflow/restart checks, memory counters and image identity are in `docs/evidence/release/`. `measurement.json` separates application time from the first observed readiness response. Cloud checkpoint phases in this disposable run are disabled/no-ops and must not be quoted as Supabase recovery timings.

## Startup cause and changes

An import-only profile of the earlier image attributed 117.199 s to the testnet client graph and 69.298 s to AI imports, with about 213 s across the measured sequential imports. Attribution depends on import order/shared modules; the old 324 s observation was not instrumented and cannot be fully reconstructed. The remaining difference is not claimed to be explained. See `docs/evidence/startup-import-baseline.json`.

Server dependencies are now bundled/tree-shaken at build time. Optional PDF, XML validation, AI and TIFF decoding engines load on demand. The current run measured HTTP imports at 2.8 s, API imports at 4.399 s, database initialization at 306 ms and build-manifest raster checks at 3 ms. The listener starts only after required recovery, database/evidence integrity, initial checkpoint publication and raster verification. Integrity failures stop startup; increasing timeouts was not used as the startup fix.

## Verification

- TypeScript: passed after final code/harness changes.
- Complete unit/integration run: **119 passed**, including eight durability fault tests and a real analysis/HTTP responsiveness test. Machine report: `docs/evidence/reliability-unit.json`.
- Complete browser suite: **23 passed together in 2.3 minutes** against the compiled production backend, after final product changes and after image/resource work finished. No retries, skips or isolated browser runs are required for this final result. Machine report: `docs/evidence/reliability-browser.json`.
- Earlier browser attempts exposed a sign-out redirect race (fixed), an extraction test that checked before its response (synchronized), and an accessibility whole-test timeout during concurrent image build. No axe violation was reported in that timeout. Prior partial runs are not combined into a clean-suite claim.
- Historical responsive sweep: 16 pages/tabs at ten widths (320-1920 px), zero flagged combinations; reviewed registry images in `docs/screenshots/responsive-final/`. The latest browser suite also covers mobile/accessibility; the historical sweep is not presented as a fresh hosted audit.
- Local checkpoint traffic scenario: nine checks passed using real SQLite/encryption and a remote protocol double. Eight publications uploaded 2,310,400 bytes and read back/restored 2,900,288 bytes. This is not Supabase billing telemetry.

## Checkpoint correctness and limits

See [CHECKPOINT_PROTOCOL.md](CHECKPOINT_PROTOCOL.md). Recovery checks database integrity, foreign keys, evidence decryption/length/digests and key continuity. Publication waits for immutable upload, digest read-back and an atomic owner/revision-conditional pointer commit. Tests cover altered ciphertext, wrong keys, missing evidence, interrupted uploads, lost commit responses, stale writers and takeover during upload. Failed operations can have uncertain outcomes; the protocol does not provide rollback/exactly-once semantics or live-database guarantees. It retains two snapshots and can leave orphans. A failed replacement can fence the previous process; operator recovery with original keys is required.

## Remaining manual actions

1. Supabase setup and isolated live verification are complete: 22 checks passed, eight encrypted checkpoints published, two fresh-cache restores succeeded, and the engineering namespace was removed. Keep .env/keys private and preserve the same reviewed keys for a new judging deployment. This does not prove Render restart/redeployment recovery; those hosted checks remain below.
2. Review actual account eligibility, free-plan selections, remaining quotas and billing/spend controls. [FREE_TIER_USAGE.md](FREE_TIER_USAGE.md) gives measured payloads, conditional projections and current official references. Full snapshots can exhaust free egress; no reliable-free claim is justified by the memory result.
3. Render is provisioned and Vercel API routing has been published with explicit authorization. Record the provider image digest, cold/warm startup, API responsiveness during analysis and checkpoint latency. Ten checks passed after the user-reported Render restart, including login, unchanged case/evaluation/audit and byte-identical PDF/evidence. A later replacement deploy was reported Live, but recovery could not be checked because a browser-suite cleanup removed the private engineering credentials. A replacement engineering workspace was seeded outside Playwright output; all 10 recovery checks passed after another separately reported Render redeployment. The restart and redeployment scenarios therefore use different isolated workspaces, each comparing its own saved account and file hashes before/after.
