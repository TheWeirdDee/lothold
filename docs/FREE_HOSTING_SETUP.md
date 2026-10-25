# Free judging deployment - setup handoff

Status: backend provisioned and frontend API routing published with authorization; see [validation and remaining gaps](FREE_HOSTING_VALIDATION.md). Supabase URL, bucket and legacy keys are configured in the saved workspace `.env`, `deploy/render/supabase.sql` has been applied to the project, and the live verifier **passed** on 25 October 2026 in an isolated engineering namespace (`docs/evidence/supabase-live.json`). The Render Free service is live at https://lothold.onrender.com, and https://lothold.vercel.app forwards /api to it after authorized routing commit 4a9c877. Strict readiness returns HTTP 200 through both origins. No purchase or paid resource was created. Hosted API workflow passed 17 checks; browser login, review PDF download and unsigned XML refusal also passed separately. All 10 checks passed after the user-reported Render restart, including the same account, case, audit history and byte-identical PDF/evidence. All 10 recovery checks also passed after a separate user-reported filesystem-replacing Render redeployment. The same saved account, case, audit, PDF and evidence were accessible. See [hosted workflow evidence](evidence/hosted-workflow.json). This is a bounded engineering pilot, not an unlimited production service.

## Architecture and limits

Vercel serves the frontend and proxies `/api` to one Render Docker web service. Pinned, SHA-256-verified raster tiles are baked into its image. Supabase provides a private Storage bucket and a Postgres checkpoint pointer. Existing LotHold accounts and sessions remain in encrypted SQLite snapshots; Supabase Auth is not used.

A successful API write waits for upload of an AES-256-GCM encrypted database snapshot, byte-integrity read-back and an atomic, fenced pointer commit. Startup restores that checkpoint before opening SQLite, then checks database integrity, evidence decryption/digests and key continuity before accepting requests. See [protocol audit](CHECKPOINT_PROTOCOL.md). A newer process fences the previous writer. Storage failures return an uncertain-operation error; inspect the current record before retrying. Never run independent operational services against the same namespace. Deployment overlap can briefly return unavailable responses from the fenced instance.

Pilot limits: 1 MiB request bodies and a 32 MiB SQLite database, with conservative admission headroom. Entire snapshots are uploaded after changes; latency and bandwidth grow with the database. The current and previous committed objects are retained. Failed uploads can leave orphan objects; monitor private bucket usage and remove only objects confirmed absent from both checkpoint pointers. Keep an independent encrypted backup before maintenance. Keys must remain unchanged across redeployments. Losing the encryption key loses access to data.

Free hosting has sleep, inactivity and usage constraints. Render free services spin down after inactivity and have ephemeral files ([Render limits](https://render.com/docs/free)). Supabase free projects have storage/egress limits and may pause after inactivity ([pricing](https://supabase.com/pricing)). There is no promise of perpetual availability or a fixed bill-free entitlement if providers change their plans. Select only free plans and do not enable paid upgrades. No keep-alive tunnel or local computer is required.

## 1. Create Supabase

1. Create a project on the **Free** plan. Store its database password securely; it is not an application setting.
2. In SQL Editor, review and run `deploy/render/supabase.sql`. It creates the private `lothold-private` bucket, an RLS-protected pointer table and service-role-only functions. This SQL creates the pointer table, RLS/permissions, all three RPC functions and the private bucket in one transaction; it also reloads the API schema cache. It has now passed live verification on 25 October 2026 (22 checks); rerun the verifier after future setup changes. The project itself and API keys are created through Supabase, not by this SQL. No Supabase Auth providers, S3 credentials or public storage policies are required. If you use another bucket name, change it consistently in the SQL and SUPABASE_STORAGE_BUCKET. Global Storage file-size settings must permit a checkpoint up to 32 MiB + 32 bytes; the SQL sets this bucket to 40 MiB, within the documented free 50 MB maximum.
3. In project settings, obtain the HTTPS project URL, server-only `service_role` API key and public legacy `anon` API key. The anon key is required by the permission-denial verifier. Never put the service key in Vercel, frontend variables, screenshots, browser code or Git. Keep the bucket private; no public object policies are needed.

4. Put `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` and optional `SUPABASE_STORAGE_BUCKET=lothold-private` in your local process environment or a separate ignored secret file. Run `node scripts/verify-supabase.ts --live` (or explicitly `node --env-file=YOUR_PRIVATE_FILE scripts/verify-supabase.ts --live`). It creates a unique engineering namespace, tests real RPC, private-object denial and two fresh-cache restores, then cleans up only that namespace. Review `docs/evidence/supabase-live.json`: blocked/failed is not verified. The script never loads `.env` implicitly or modifies operational keys/data.

## 2. Prepare Render

See [exact account steps, runtime settings and publishing authorization](RENDER_PUBLISH_HANDOFF.md).

Review `render.yaml` and `deploy/render/Dockerfile`. The final production image is built locally and measured as recorded in FREE_HOSTING_VALIDATION.md; hosted verification is still required. `deploy/render/Dockerfile.proof` is a local resource-test overlay, not the deployment Dockerfile.

Create a Blueprint from the repository only when publishing is explicitly authorized, or configure a Docker web service manually with repository-root context and `deploy/render/Dockerfile`. Select **Free**, one service, no disk and no paid database. Disable automatic deployment until the configuration is reviewed. Use `/api/ready?strict=1` for the health check.

Set these **Render server settings**:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Project HTTPS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key |
| `SUPABASE_STORAGE_BUCKET` | `lothold-private` |
| `DURABLE_STORE` | `supabase` |
| `EVIDENCE_STORE` | `sqlite` |
| `SNAPSHOT_NAMESPACE` | `judging` - preserve across redeploys |
| `EVIDENCE_ENCRYPTION_KEY` | New random 32-byte hexadecimal key; preserve securely |
| `DOWNLOAD_SIGNING_KEY` | Separate random 32-byte hexadecimal key; preserve securely |
| `PUBLIC_ORIGIN` | Actual Vercel HTTPS frontend origin |
| `TRUST_PROXY_HOPS` | `1` |
| `REGISTRATION_OPEN` | `true` during judging; close afterward |
| `REGISTER_RATE_LIMIT` | `50` |

Generate each key separately with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` on your own terminal, then save directly in the provider secret settings and a secure backup. Do not paste keys into chat. The image sets `DATABASE_PATH=/data/lothold.sqlite`, port 10000, and anchoring off. Do not set `ALLOW_EPHEMERAL_DATA` on the hosted service. Never copy an operational local database into a fresh cloud namespace as an implicit migration.

## 3. Connect Vercel

Use the real Render HTTPS origin:

```sh
node scripts/prepare-vercel-routing.ts https://YOUR-SERVICE.onrender.com
```

This writes `deploy/vercel.connected.json` for review; it does not deploy or overwrite `vercel.json`. After review and publishing authorization, replace `vercel.json` with that candidate. Keep the API rewrite before the SPA rewrite. Set the Vercel project build command to `npm run build`, output directory `dist`, and supported Node 24. The repo root is the project root. Set Render `PUBLIC_ORIGIN` to the exact frontend origin. No Supabase credentials belong on Vercel. See [Vercel rewrites](https://vercel.com/docs/routing/rewrites).

## 4. Required hosted acceptance

Do this with explicitly labelled engineering records, not real sourcing claims:

1. Confirm strict readiness includes installed real raster datasets. Run real polygon analysis, CSV/GeoJSON preview-confirm, supplier PDF generation and authenticated evidence download.
2. Register, create a case and upload an evidence file below 1 MiB. Record its SHA-256 locally. Open an isolated browser context and log into the same account; verify the same organization and case.
3. Restart the Render service, then redeploy so its ephemeral filesystem is replaced. Log in again and verify the case and byte-identical decrypted evidence. This is the decisive remote persistence check.
4. Verify the private Supabase bucket is inaccessible anonymously and browser assets/network requests contain no service-role or encryption key.
5. Let Render sleep. Visit the Vercel frontend: the waking notice must preserve unsaved inputs, readiness must recover, and no POST should be replayed automatically.
6. Verify logout, expiry, mobile registry/workspace layout, and native video playback. Record the deployed commit, URLs, actual plan, timestamps, memory, CPU, cold/warm latency and test results.

Until these pass, describe the deployment as prepared, not verified or judge-ready. The local durability tests use a protocol double around real SQLite and encryption; they do not prove the Supabase SQL, credentials, provider behavior or remote latency. The resource test uses disposable local storage and cannot prove remote persistence.

## Local checks and reproduction

Run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, and `npm run build:server`. Latest results are in [FREE_HOSTING_VALIDATION.md](FREE_HOSTING_VALIDATION.md). The complete browser suite must pass together after final product changes.

Build the normal portable production image with `docker build -f deploy/render/Dockerfile -t lothold-release:reliability .`. It downloads and verifies pinned rasters in a separate data stage. To reuse existing dataset bytes locally, supply `--build-context datasets=docker-image://lothold-render:local`; the release stage copies only rasters from that input, rehashes all of them, and builds the current frontend/backend. No frontend/backend is inherited. This does not publish an image.

On Linux/WSL run `sh scripts/free-resource-proof.sh lothold-release:reliability`. It owns an isolated 512 MiB, no-swap, 0.1 CPU container, uses disposable engineering keys/data, verifies actual analysis/PDF/evidence and HTTP responsiveness, records startup phases and the exact image identity, then cleans up. It does not prove live Supabase or hosted persistence. `docs/evidence/release/` contains its results. [Usage assessment](FREE_TIER_USAGE.md) includes measured checkpoint sizes and official provider limits; full snapshots can exhaust free quotas even though a single workflow fits memory.
