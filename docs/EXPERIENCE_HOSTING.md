> Updated free-project preparation: see [FREE_HOSTING_SETUP.md](FREE_HOSTING_SETUP.md). Its checkpoint setup supersedes older hosting recommendations below. No cloud deployment has been verified.

# Connection and persistent hosting handoff

## Observed public failure — 25 October 2026

Direct HTTP inspection of `https://lothold.vercel.app` returned:

| Request | Result |
|---|---|
| `/` | 200 HTML, Vercel |
| `/api/health` | 404 plain text, Vercel NOT_FOUND |
| `/api/auth/me` | 404 plain text, Vercel NOT_FOUND |
| `/api/public/method` | 404 plain text, Vercel NOT_FOUND |
| `/api/public/demo-video` | 404 plain text, Vercel NOT_FOUND |
| `/api/public/verify` | 404 plain text, Vercel NOT_FOUND |

These responses are from the frontend host, before the LotHold application. They are not a bad-password response, application origin rejection or an unavailable model. The checked deployment has no `/api` route to a LotHold backend. No deployment account settings or private hosting dashboards were accessed.

The prepared build keeps Docs, methodology, static templates, historical public registry evidence and recorded video/poster/captions on the frontend. It still reports live operations as unavailable; it does not invent registry balances or account success. The global warning was moved to account/work routes, where it is relevant.

## Account and storage architecture

- Accounts and **scrypt password hashes**: `users` in the server-side SQLite database.
- Organisations: `orgs`; every user belongs to an organisation. Protected operations use the authenticated user's `org_id`, not a browser-supplied owner. Registration creates a separate organisation, even when its display name matches another.
- Sessions: `sessions` in SQLite; random bearer token in an HttpOnly, SameSite=Strict cookie, token hash in SQLite, per-session CSRF token, 12-hour expiry. Production cookies require HTTPS. There is no volatile JWT signing secret to rotate on every restart.
- Case records, reservations, decisions, approvals, jobs and audit history: the same SQLite database, WAL enabled.
- Evidence and generated documents: AES-256-GCM encrypted files, authenticated to the organisation, on the evidence volume.
- Encryption: stable `EVIDENCE_ENCRYPTION_KEY` supplied by the operator. Losing/changing it makes existing evidence unreadable.
- Downloads: stable `DOWNLOAD_SIGNING_KEY` signs user-bound five-minute download links. It is distinct from the evidence key. Requests also require the authenticated user.
- Current **public Vercel deployment**: no persistent backend or production database/volume was identified. Do not claim production accounts are provisioned there.
- Local default: database and evidence on the local machine's configured disk. Browser storage is never authoritative for accounts or cases.

## Prepared hosting path

Use one existing Linux host with Docker Compose, DNS and persistent storage. Serve the complete application from one HTTPS origin with Caddy. This fits the long-running Node 24 server, SQLite, encrypted files, 431 MB pinned raster snapshots and always-running worker without introducing Supabase or another authentication system. Keep one application instance. Do not use an ephemeral filesystem or scale-to-zero service for this configuration.

No host/account purchase was made. At a $0 hosting budget, use the local application and bundled public recording, or an already available host. A new VPS/provider account would require the user's provider choice, account setup and spending authorisation. The existing Fly template remains an alternative; no pricing promise is made here.

### Exact remaining operator actions (not executed)

1. Supply an existing internet-accessible Linux host and a DNS name pointing to it. Allow inbound TCP 80/443. If none exists, account creation/billing is the remaining infrastructure decision.
2. Copy this source to that host. Copy `deploy/hosting.env.example` to `deploy/hosting.env`. Set `LOTHOLD_HOST`, `PUBLIC_ORIGIN` and the two stable keys. Keep registration closed initially. Store a secure independent backup of the keys; never commit `hosting.env`.
3. From the repository root, validate/build, populate the persistent named volume, then start the application:

```sh
docker compose --env-file deploy/hosting.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/hosting.env -f deploy/compose.yaml build app
docker compose --env-file deploy/hosting.env -f deploy/compose.yaml run --rm app node scripts/fetch-datasets.ts
docker compose --env-file deploy/hosting.env -f deploy/compose.yaml up -d
```

The Compose project creates `lothold_data`, mounted at `/data`: `/data/lothold.sqlite`, `/data/evidence`, `/data/snapshots`. Docker may prefix the volume with the Compose project name; keep that project name stable across releases. Never remove its volume when redeploying. Caddy has separate certificate/configuration volumes. Secrets are supplied from the host env file, not baked into the image.

4. Verify `https://YOUR-HOST/api/ready?strict=1` returns 200 with `datasetsVerified: true`. Confirm HTTPS sets Secure/HttpOnly cookies; register a test account temporarily or create the first user with the administration command; check a second browser and a case after restart. Then decide whether to open registration.
5. Back up SQLite plus encrypted files using `scripts/backup.ts`, and copy that backup off the host. Back up keys separately. A named volume survives container recreation, not disk loss. Use the same volume and keys on subsequent starts.

The new Compose/Caddy configuration is prepared and reviewed as source; it has not been deployed or validated on a real host. Existing container recovery evidence is in `docs/evidence/container-verification.json`; the new browser/restart evidence is in `docs/evidence/experience-recording.json`.

### Optional: retain Vercel as the application origin

Once a real backend exists, run locally:

```sh
node scripts/prepare-vercel-routing.ts https://YOUR-REAL-BACKEND-HOST
```

This produces `deploy/vercel.connected.json` for review only. It adds an external `/api/:path*` rewrite before the SPA fallback. Set the backend's `PUBLIC_ORIGIN` to `https://lothold.vercel.app`, review/copy the candidate into `vercel.json`, then deploy only with authorisation. The browser continues to use same-origin API URLs and cookies. Do not put a private key or API secret into frontend environment variables.

Validate registration, cookie forwarding, CSRF, uploads, signed downloads, large requests and long-running analyses through the actual proxy before using that arrangement. No external rewrite can replace the missing backend. The simpler preferred arrangement serves both frontend and backend directly from the persistent HTTPS host.

## References checked for configuration

- [Docker persistent volumes](https://docs.docker.com/engine/storage/volumes/)
- [Caddy environment substitutions](https://caddyserver.com/docs/caddyfile/concepts#environment-variables)
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)
- [GSAP responsive motion and cleanup](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/)

## Prepared stack verified locally (25 October 2026)

The Compose stack above (`deploy/compose.yaml` + `deploy/Caddyfile.container`) was built and run in Docker 29 under WSL2. It used `LOTHOLD_HOST=localhost`, fresh throwaway keys, `LOTHOLD_INSTANCE=engineering`, and rasters copied onto the `lothold_data` volume. Record: `docs/evidence/compose-verification.json`.

- `docker compose config` passed. Both services started, and `/api/ready?strict=1` returned 200 with `datasetsVerified: true`.
- The container served the same frontend bundle as a fresh local build.
- **Through Caddy's HTTPS proxy:**
  - registration and session;
  - case creation, CSV and GeoJSON upload and confirmation;
  - real raster analysis;
  - supplier PDF generation and download;
  - byte-identical decryption of an uploaded file.
- **Persistence:** after `restart app`, and again after `up -d --force-recreate` of both containers: login, shipment, unchanged evaluation, identical stored PDF and upload, and audit history.
- **Session cookie through the proxy:** `HttpOnly; Secure; SameSite=Strict`.
- **Not tested:** a real public DNS name and a publicly trusted certificate. Caddy used its local CA for `localhost`.

## $0 option: a Cloudflare Quick Tunnel from your own computer

This is the only way found to give the public a working backend without paying for hosting. Your computer runs LotHold, its data stays on your disk (`data/`), and Cloudflare forwards an HTTPS address to it. It is **not** run by the agent, because it publishes your machine to the internet.

Per Cloudflare's documentation (updated 30 Sep 2026), Quick Tunnels need no account or domain, have no uptime guarantee, allow up to 200 in-flight requests, change hostname on every start, and are intended for testing and development.

1. Start the tunnel and note the printed `https://….trycloudflare.com` address:
   ```sh
   cloudflared tunnel --url http://localhost:8787
   ```
2. In a second terminal, start LotHold with that address as its origin. Use your existing `.env`, which holds stable keys from `npm run setup`, and the verified rasters in `data/snapshots`:
   ```sh
   npm run build
   PUBLIC_ORIGIN=https://<name>.trycloudflare.com NODE_ENV=production TRUST_PROXY=true TRUST_PROXY_HEADER=cf-connecting-ip npm start
   ```
   In PowerShell, set the variables first with `$env:PUBLIC_ORIGIN='https://<name>.trycloudflare.com'`, and so on.
3. Open `https://<name>.trycloudflare.com/api/ready?strict=1`. It should return 200 with `datasetsVerified: true`. Then share that address; it serves the complete application, not just the frontend.
4. Keep both terminals and the computer running while judges use it. Accounts and cases persist on your disk across restarts. A new tunnel gets a new address, so `PUBLIC_ORIGIN` must be updated and the new address shared.

Do **not** point the Vercel site at a Quick Tunnel: the address changes on every start. A stable public address needs a named Cloudflare Tunnel (a free Cloudflare account with a domain on Cloudflare) or a persistent host as described above.
