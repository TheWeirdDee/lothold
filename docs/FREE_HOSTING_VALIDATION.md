# Deployment reliability validation - 2026-10-25

**This is not a validated free hosted deployment.** No cloud project, public deployment, push, purchase or operational-data migration was performed. Supabase service verification is blocked by missing project settings; `docs/evidence/supabase-live.json` records that preflight without making external requests.

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

1. Create a free Supabase project and run `deploy/render/supabase.sql` in SQL Editor. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` and optional `SUPABASE_STORAGE_BUCKET` in a private local environment. Never paste keys into chat or place server secrets in Vercel. Run `node scripts/verify-supabase.ts --live`; inspect the actual RPC/Storage, anonymous-denial, two fresh-cache restore and cleanup results. It uses an isolated engineering namespace only. Until it passes, live persistence is unverified.
2. Review actual account eligibility, free-plan selections, remaining quotas and billing/spend controls. [FREE_TIER_USAGE.md](FREE_TIER_USAGE.md) gives measured payloads, conditional projections and current official references. Full snapshots can exhaust free egress; no reliable-free claim is justified by the memory result.
3. When explicitly authorized to publish, connect the repository/image to Render and the frontend to Vercel following [FREE_HOSTING_SETUP.md](FREE_HOSTING_SETUP.md). Record deployed digest, cold/warm startup, API responsiveness during analysis and checkpoint latency. Verify the same engineering account/case/evidence after restart and a filesystem-replacing redeployment, including byte-identical decryption. No host-account or deployment action has been taken here.
