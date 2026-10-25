# Free judging deployment ? setup handoff

Status: prepared locally; no cloud projects, deployment, push, or paid resources created. The user selected ?No projects yet ? prepare setup.? Hosted persistence is **not verified**. This is a bounded engineering pilot, not an unlimited production service.

## Architecture and limits

Vercel serves the frontend and proxies `/api` to one Render Docker web service. Pinned, SHA-256-verified raster tiles are baked into its image. Supabase provides a private Storage bucket and a Postgres checkpoint pointer. Existing LotHold accounts and sessions remain in encrypted SQLite snapshots; Supabase Auth is not used.

A successful API write waits for upload of an AES-256-GCM encrypted database snapshot and an atomic, fenced pointer commit. Startup restores that checkpoint before opening SQLite. A newer process fences the previous writer. Storage failures return an uncertain-operation error; inspect the current record before retrying. Never run independent operational services against the same namespace. Deployment overlap can briefly return unavailable responses from the fenced instance.

Pilot limits: 1 MiB request bodies and a 32 MiB SQLite database, with conservative admission headroom. Entire snapshots are uploaded after changes; latency and bandwidth grow with the database. The current and previous committed objects are retained. Failed uploads can leave orphan objects; monitor private bucket usage and remove only objects confirmed absent from both checkpoint pointers. Keep an independent encrypted backup before maintenance. Keys must remain unchanged across redeployments. Losing the encryption key loses access to data.

Free hosting has sleep, inactivity and usage constraints. Render free services spin down after inactivity and have ephemeral files ([Render limits](https://render.com/docs/free)). Supabase free projects have storage/egress limits and may pause after inactivity ([pricing](https://supabase.com/pricing)). There is no promise of perpetual availability or a fixed bill-free entitlement if providers change their plans. Select only free plans and do not enable paid upgrades. No keep-alive tunnel or local computer is required.

## 1. Create Supabase

1. Create a project on the **Free** plan. Store its database password securely; it is not an application setting.
2. In SQL Editor, review and run `deploy/render/supabase.sql`. It creates the private `lothold-private` bucket, an RLS-protected pointer table and service-role-only functions. This SQL is prepared but has not been executed against a live project. Review its actual execution result before continuing.
3. In project settings, obtain the HTTPS project URL and server-only `service_role` API key. Never put the service key in Vercel, frontend variables, screenshots, browser code or Git. Keep the bucket private; no public object policies are needed.

## 2. Prepare Render

Review `render.yaml` and `deploy/render/Dockerfile`. The final production Dockerfile still needs its own clean build and hosted verification. `deploy/render/Dockerfile.proof` is a local resource-test overlay, not the deployment Dockerfile.

Create a Blueprint from the repository only when publishing is explicitly authorized, or configure a Docker web service manually with repository-root context and `deploy/render/Dockerfile`. Select **Free**, one service, no disk and no paid database. Disable automatic deployment until the configuration is reviewed. Use `/api/ready?strict=1` for the health check.

Set these **Render server settings**:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Project HTTPS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key |
| `SUPABASE_STORAGE_BUCKET` | `lothold-private` |
| `DURABLE_STORE` | `supabase` |
| `EVIDENCE_STORE` | `sqlite` |
| `SNAPSHOT_NAMESPACE` | `judging` ? preserve across redeploys |
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

`npm run typecheck`, `npm test`, `npm run test:e2e`, and `node scripts/responsive-sweep.ts docs/screenshots/responsive-final` cover local behavior. The responsive sweep checked ten widths from 320 to 1920 px and reported zero flagged overflow combinations. Full browser run: 20 passed; the cold-start check subsequently passed after fixing an initial-mount event race and measuring navigation after the page settled.

On a Linux Docker host, run `sh scripts/free-resource-proof.sh lothold-free-verified:local` for the local proof image. Evidence is under `docs/evidence/free-resource-*`. The script currently targets the provided WSL workspace path; adjust `REPORT_DIR` for another machine. A 512 MiB / 0.1 CPU local budget tests a representative workflow, not provider uptime or concurrency capacity.
