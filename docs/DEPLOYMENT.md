# Deployment plan

**Current state (25 Oct 2026):** no LotHold server is hosted. https://lothold.vercel.app is a frontend-only copy (static files). Vercel cannot run LotHold's long-running server, SQLite database, encrypted evidence store and 431 MB of forest rasters, so every `/api` request there returns 404. The frontend detects this and shows a "server not running" notice instead of failing silently. `vercel.json` makes direct links and page refreshes load the app, while `/api` stays a genuine 404. Verifying this needs a redeploy and was not done locally.

## What production needs

| Need | Detail |
|---|---|
| Runtime | One long-running Node.js 24 process: HTTP API, built web client, and the durable job worker. Do not scale to zero; jobs need the worker running. |
| Persistent disk | `/data` (or `data/`) holding `lothold.sqlite` (WAL), `evidence/` (encrypted uploads and documents), and `snapshots/` (three raster tiles, 431 MB, hash-pinned). 3 GB is ample for a pilot. |
| Secrets | `EVIDENCE_ENCRYPTION_KEY`, `DOWNLOAD_SIGNING_KEY` (from `npm run setup`). Optional AI and testnet keys. Never bake them into images. |
| HTTPS | Mandatory: session cookies are `Secure` in production (verified), so they are not stored over plain HTTP. |
| Origin | `PUBLIC_ORIGIN=https://<host>`. Without it, browser POSTs fail the Origin check. |
| Client IP | Behind a proxy set `TRUST_PROXY=true`, plus `TRUST_PROXY_HEADER` when the platform provides a single-value header (Fly: `fly-client-ip`). Otherwise the last `X-Forwarded-For` entry is used. |
| Single instance | SQLite is single-writer. Run exactly one instance. |

## Verified locally

A fresh clone was installed (`pnpm install --frozen-lockfile`), built and started with `NODE_ENV=production`:

- The health check reports the instance and dataset availability.
- Missing rasters yield `UNAVAILABLE` analyses, never a clear result.
- The cookie is `HttpOnly; Secure; SameSite=Strict`.
- Backup and restore: `tests/integration/backup.test.ts` (online snapshot, restore, evidence decrypts byte for byte).

### Production container (verified 24 Oct 2026)

The image from `deploy/Dockerfile` was built and run locally with Docker Engine 29.1.3 in WSL2. It used a throwaway volume, fresh random secrets and `LOTHOLD_INSTANCE=engineering`. The full record is in `docs/evidence/container-verification.json`.

- **Defect found and fixed:** the first image crashed at startup. The PDF fonts (`@fontsource/ibm-plex-sans`) were a devDependency, and `pnpm prune --prod` removed them. They are now a runtime dependency, and `tests/unit/runtime-deps.test.ts` guards against a repeat.
- **What `scripts/container-verify.ts` checked**, all passing:
  - readiness, and the three rasters hash-verified at startup;
  - the built frontend served;
  - registration and session;
  - case creation, CSV and GeoJSON uploads and confirmation;
  - real raster analysis (same pixel counts as the native run);
  - the supplier request PDF generated and downloaded;
  - an uploaded file decrypted byte for byte.
- **Recovery**, all passing: login, shipment, evaluation, byte-identical stored files and audit history all survive:
  - `docker restart`;
  - removing and recreating the container on the same volume (as a redeploy does);
  - the host VM stopping (the restart policy brought it back).
  - The migration record is unchanged, and SQLite `integrity_check` returns ok.
- **Hard kill:** a `SIGKILL` during a running analysis job recovers. The job is retried once its lease expires, which took about 2 minutes.
- **Not exercised:**
  - TLS and proxy headers on a real host;
  - `npm run data:fetch` inside the container (the rasters were copied from the local verified snapshot);
  - any hosting platform.

To repeat the check (needs Docker):

```bash
docker build -f deploy/Dockerfile -t lothold:local .
docker volume create lothold_eng_data            # then copy the three rasters into /data/snapshots on it
docker run -d --name lothold-eng -p 127.0.0.1:8790:8787 -v lothold_eng_data:/data   -e EVIDENCE_ENCRYPTION_KEY=$(openssl rand -hex 32) -e DOWNLOAD_SIGNING_KEY=$(openssl rand -hex 32)   -e LOTHOLD_INSTANCE=engineering -e PUBLIC_ORIGIN=http://127.0.0.1:8790 -e CHAIN_ANCHORING=off lothold:local
node scripts/container-verify.ts seed http://127.0.0.1:8790 state.json
docker restart lothold-eng && node scripts/container-verify.ts after-restart http://127.0.0.1:8790 state.json
```

## Hosting options and costs

Prices and limits were checked on each provider's own pages on 24 October 2026. Check them again before acting.

| Option | Cost | Fits LotHold? |
|---|---|---|
| **Run locally and show it in the demo video** | $0 | Yes. The hackathon requires a demo video and a public repository, not a hosted instance. |
| **Fly.io**, one machine with one 3 GB volume (below) | ≈ $7.25–7.75/month; needs a billing account | Yes. This is the recommended path if a public instance is wanted. The trial (2 hours of machine runtime or 7 days, whichever comes first) is too short to host judging. |
| Render Free web service | $0 | **No.** Free web services cannot attach a persistent disk and spin down after 15 minutes without traffic (render.com/docs/free). The database and evidence would be lost, and 431 MB of rasters re-downloaded, on every cold start. |
| Hugging Face Spaces (Docker) | Paid plan required | **No.** Docker Spaces need a PRO or Team plan to create, and Space disk is not persistent (huggingface.co/docs/hub/spaces-overview). |
| Single VPS with systemd and Caddy (below) | Provider-dependent | Yes, technically. No price has been verified on a provider's own page. |

## Fly.io, one machine with one volume

Prices are from Fly.io's official pricing page (https://docs.fly.io/about/pricing), fetched again on 24 October 2026. Check them again before purchase.

| Item | Unit price | Pilot quantity | Monthly |
|---|---|---|---|
| Machine `shared-cpu-1x`, 1 GB RAM, always on | $6.70/month | 1 | $6.70 |
| Volume | $0.15/GB-month | 3 GB | $0.45 |
| Volume snapshots (backups) | first 10 GB free, then $0.08/GB-month | under 1 GB | $0.00 |
| Outbound data | $0.02/GB (NA/EU); $0.12/GB (Africa/India) | ~5 GB | $0.10–0.60 |
| Shared IPv4 and IPv6 (a dedicated IPv4 would be $2/month) | included | — | $0.00 |
| **Estimated total** | | | **≈ $7.25–7.75 / month** |

Fly.io has no free tier or monthly free allowance for new organisations. The trial is 2 hours of machine runtime or 7 days, whichever comes first, and needs no card. The volume is billed even while the machine is stopped.

### Steps (each needs your authorisation and a Fly.io account with billing)

```bash
fly launch --no-deploy --copy-config --config deploy/fly.toml --name <app>   # edit APP_NAME/region first
fly volumes create lothold_data --size 3 --region jnb
fly secrets set EVIDENCE_ENCRYPTION_KEY=$(openssl rand -hex 32) DOWNLOAD_SIGNING_KEY=$(openssl rand -hex 32)
fly deploy --config deploy/fly.toml --dockerfile deploy/Dockerfile
fly ssh console -C "node scripts/fetch-datasets.ts"      # downloads + verifies the 3 rasters into /data/snapshots
fly machine restart                                       # re-verifies dataset hashes at startup
curl https://<app>.fly.dev/api/health                     # expect instance=operational and 3 datasets present
```

Keep a copy of `EVIDENCE_ENCRYPTION_KEY` outside Fly. Evidence is unrecoverable without it.

### Public-instance settings

- Keep `CHAIN_ANCHORING=off` (the template default). If testnet anchoring is wanted for a review, set the three testnet keys as Fly secrets and enable anchoring for one organisation only (`node scripts/admin.ts enable-chain <email>`). Limits then apply:
  - 10 allocations per request (`CHAIN_MAX_ALLOCATIONS_PER_REQUEST`);
  - 30 transactions per organisation per 24 hours (`CHAIN_DAILY_TX_LIMIT`);
  - a 50 gwei fee ceiling (`CHAIN_MAX_FEE_GWEI`);
  - a refusal to sign if the RPC is not chain 11155111.
- `REGISTRATION_OPEN=true` lets judges create their own empty workspaces. Set `false` to close sign-ups.
- Leave `AI_PROVIDER` unset unless a key is supplied. The label parser is used and labelled.

## Alternative: single VPS with systemd and Caddy

Use `deploy/lothold.service` with `deploy/Caddyfile` (automatic HTTPS). Install Node 24 and pnpm, clone to `/opt/lothold`, then run `pnpm install --frozen-lockfile && npm run build && pnpm prune --prod`, `npm run setup` and `npm run data:fetch`, and enable the unit. Third-party listings in August 2026 put Hetzner's smallest shared plans at about €6/month including IPv4, but that was **not verified on Hetzner's own price page**. Confirm availability and price before choosing it.

## Backup and recovery

- **Backup** (safe while running): `npm run backup -- /path/to/backups` creates a consistent `VACUUM INTO` copy of the database, a copy of `evidence/`, and a `MANIFEST.json` (SHA-256 values, `integrity_check`, row counts). On Fly, also review the volume snapshot schedule and retention in Fly's documentation (snapshot storage pricing is listed above).
- **Not in the backup:** `.env` secrets (store them separately, e.g. in a password manager) and raster snapshots (re-create with `npm run data:fetch`; hashes are pinned).
- **Restore:**
  1. Stop the service.
  2. Copy `lothold.sqlite` to `DATABASE_PATH` and `evidence/` to `EVIDENCE_DIR`.
  3. Restore the same `EVIDENCE_ENCRYPTION_KEY`.
  4. Start the service and check `/api/health`.
  5. Open one shipment and download one document to confirm decryption.
- **Recovery objective for a pilot:** at most the interval between backups. Schedule `npm run backup` (cron or a Fly machine schedule) at least daily.
