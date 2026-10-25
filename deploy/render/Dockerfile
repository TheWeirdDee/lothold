# LotHold on a host WITHOUT a persistent disk (e.g. Render free web service).
# - The pinned forest rasters are downloaded and SHA-256-verified at build time and baked into the immutable image.
# - SQLite is a disposable cache restored from a private, encrypted Supabase
#   snapshot. HTTP writes await object upload + fenced Postgres pointer commit.
# - This bounded judging mode accepts <=1 MB request bodies and <=32 MB databases.
# Build from the repository root:  docker build -f deploy/render/Dockerfile -t lothold-render .
FROM node:24.13.1-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN npm run build && pnpm prune --prod

# Read-only datasets inside the image, verified against the pins; the manifest lets startup skip re-hashing.
ENV DATA_DIR=/app/snapshots
RUN node scripts/fetch-datasets.ts --write-manifest

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    DATABASE_PATH=/data/lothold.sqlite \
    EVIDENCE_STORE=sqlite \
    DURABLE_STORE=supabase \
    DATASETS_TRUST_BUILD_MANIFEST=1 \
    CHAIN_ANCHORING=off \
    TRUST_PROXY=true
COPY deploy/render/start.sh /usr/local/bin/lothold-start
RUN chmod +x /usr/local/bin/lothold-start && mkdir -p /data
EXPOSE 10000
CMD ["lothold-start"]
