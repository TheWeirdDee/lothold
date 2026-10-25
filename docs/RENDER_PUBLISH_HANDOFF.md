# Exact backend provider and publishing handoff - 2026-10-25

Selected backend: **Render, one Free Docker web service**, named `lothold-api` (Render may require a unique service name). Frontend: Vercel. Persistence: the private Supabase checkpoint bucket plus Postgres pointer/RPC functions; existing LotHold authentication remains inside the encrypted database. No Supabase Auth migration, paid Render database, persistent disk, external worker service or tunnel is needed for this bounded pilot. None of this is a validated hosted deployment yet.

## Account and setup steps

1. Sign up/sign in at https://dashboard.render.com/ using the account that may deploy this project. Choose a workspace whose billing/usage settings you can inspect. Keep the compute plan Free; do not approve paid add-ons. Record the account's remaining included bandwidth and build minutes before publishing.
2. Connect GitHub and grant Render access to **only** `TheWeirdDee/lothold`. The intended branch is `main`. Local commits have not been pushed during this work. Pushing the reviewed release requires explicit authorization. Account login/authorization stays in the provider UI; do not paste tokens into chat.
3. Prepare New > Blueprint from that repository (`render.yaml`), or New > Web Service with Language/Runtime Docker. Applying the Blueprint or clicking Deploy publishes a public service; wait for authorization before that final action. Choose a region near the Supabase project (record the choice; the Blueprint otherwise uses Render's default). Do not create additional database/worker services.
4. Manual Docker settings: repository root context `.`, Dockerfile `deploy/render/Dockerfile`, no start-command override (use image CMD), Free plan, one instance, auto-deploy off, health check `/api/ready?strict=1`. The image binds `0.0.0.0:10000`. BuildKit builds the full current frontend/backend and verifies the raster pins. The local named raster context is a local optimization, not a required Render setting.
5. Enter the server variables below. Do not use a secret file copied into the Docker build. Secrets must be runtime settings and must not appear in Vercel variables, source, build args referenced by the Dockerfile, screenshots or logs. Render makes environment settings available as build arguments too; this Dockerfile never references secret build arguments ([Docker guidance](https://render.com/docs/docker)).
6. After authorization and deployment, record the actual `https://...onrender.com` origin and immutable build/commit identity. Generate the reviewable Vercel proxy candidate with `node scripts/prepare-vercel-routing.ts https://ACTUAL-SERVICE.onrender.com`. Review/copy it to `vercel.json` before an authorized frontend deployment. Set PUBLIC_ORIGIN to the exact frontend HTTPS origin; `https://lothold.vercel.app` in the Blueprint is only correct if that is your actual project origin.

## Required Render environment

| Name | Required value/source |
| --- | --- |
| SUPABASE_URL | HTTPS URL of the project where setup SQL passed |
| SUPABASE_SERVICE_ROLE_KEY | Server-only legacy service-role API key for that project |
| SUPABASE_STORAGE_BUCKET | lothold-private |
| DURABLE_STORE | supabase |
| EVIDENCE_STORE | sqlite |
| SNAPSHOT_NAMESPACE | judging; fixed across restart/redeploy; use only one writer |
| EVIDENCE_ENCRYPTION_KEY | Existing reviewed 64-hex encryption key; preserve and back up securely |
| DOWNLOAD_SIGNING_KEY | Existing reviewed separate 64-hex signing key; preserve and back up securely |
| PUBLIC_ORIGIN | Exact Vercel HTTPS frontend origin |
| TRUST_PROXY_HOPS | 1 |
| REGISTRATION_OPEN | true while judging; false afterward |
| REGISTER_RATE_LIMIT | 50 |

The image sets NODE_ENV=production, HOST=0.0.0.0, PORT=10000, DATABASE_PATH=/data/lothold.sqlite, DATA_DIR=/app/snapshots, DATASETS_TRUST_BUILD_MANIFEST=1, CHAIN_ANCHORING=off and TRUST_PROXY=true. Preserve those defaults. Do not set ALLOW_EPHEMERAL_DATA. SUPABASE_ANON_KEY is needed only for the local permission verifier, not by the backend runtime. No AI or blockchain signing key is required for this deployment; the label parser and anchoring-off disclosures remain honest. Do not repurpose or rotate operational keys as an implicit migration; confirm which keys initialize a new judging namespace and preserve them thereafter.

## Verified provider restrictions

Checked from official documentation on 25 October 2026: the Free web-service plan lists 0.1 CPU and 512 MB RAM ([Blueprint compute plans](https://render.com/docs/blueprint-spec#plan)). Free services sleep after 15 idle minutes; local files can be lost on restart, redeploy or sleep. There are 750 shared workspace free-instance hours/month; no free persistent disk, service scaling or SSH/dashboard shell. Bandwidth/build quota exhaustion and high service-initiated traffic may cause suspension or charges depending on account settings. Exact remaining bandwidth/build amounts require the actual account dashboard; public documentation is not evidence of your account's balance. See [Free restrictions](https://render.com/docs/free) and [usage estimates](FREE_TIER_USAGE.md). Render describes Free as a preview/hobby option, not a production reliability tier. No guaranteed permanent-free or uptime claim is made.

## Exact authorization needed

After the Supabase live verifier passes and account access/quotas are confirmed, authorize this scope in one message:

> Authorize pushing the reviewed LotHold release from local main to TheWeirdDee/lothold main, creating/deploying one Render Free Docker web service with the prepared runtime secrets, updating/deploying the Vercel frontend API rewrite, and using isolated engineering records to test registration/login, raster analysis, PDF/XML exports, cold wake, restart and one filesystem-replacing redeployment. No paid services, upgrades, operational-data migration or unrelated account changes.

Specify the intended Render workspace and Vercel project (and region if you have a preference). This is authorization scope, not a claim that those actions were approved. If credentials/plugin/CLI access is unavailable after authorization, account login/connection remains a separate prerequisite. Do not paste secret values into chat. Applying the Supabase setup SQL and isolated live verification are separate from publishing the application.

## Acceptance evidence required after authorization

Record hosted origin, deployed commit/image digest, region, plan and timestamps. Verify fresh registration and login, isolated-browser access to the same organization/case, source/plot confirmation, real analysis and ordinary API latency during processing, PDF generation/download and schema-valid DDS draft export. Record encrypted evidence download hashes. Restart the service and repeat login/record/hash checks; then redeploy so its cache filesystem is replaced and repeat again. Observe a real cold wake, preserved unsaved form entries and no automatic mutation replay. Check private Storage/RPC permissions and browser assets/network for secret exposure without printing any secrets. If any check fails, record that failure; do not label the hosted deployment validated. Demo narration must use that actual status ([script/shot list](DEMO_SCRIPT_AND_SHOTS.md)).
