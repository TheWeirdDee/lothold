# LotHold on a host WITHOUT a persistent disk (e.g. Render free web service).
# - The pinned forest rasters are downloaded and SHA-256-verified at build time and baked into the immutable image.
# - SQLite is a disposable cache restored from a private, encrypted Supabase
#   snapshot. HTTP writes await object upload + fenced Postgres pointer commit.
# - This bounded judging mode accepts <=1 MB request bodies and <=32 MB databases.
# Build from the repository root:  docker build -f deploy/render/Dockerfile -t lothold-render .
FROM node:24.13.1-bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
FROM dependencies AS datasets
# Stable data layer: changing UI/API code no longer downloads 431 MB again.
COPY scripts/fetch-datasets.ts scripts/fetch-datasets.ts
COPY server/env/forest.ts server/env/forest.ts
COPY core core
ENV DATA_DIR=/app/snapshots
RUN node scripts/fetch-datasets.ts --write-manifest

FROM dependencies AS release
COPY --from=datasets /app/snapshots /app/snapshots
COPY . .
ENV DATA_DIR=/app/snapshots
RUN node scripts/fetch-datasets.ts --verify-only --write-manifest && npm run build && npm run build:server && pnpm prune --prod
# Runtime ships current build output and production dependencies only.
FROM node:24.13.1-bookworm-slim AS runtime
WORKDIR /app
COPY --from=release /etc/ssl/certs /etc/ssl/certs
COPY --from=release /app/node_modules ./node_modules
COPY --from=release /app/package.json ./package.json
COPY --from=release /app/dist ./dist
COPY --from=release /app/server-dist ./server-dist
COPY --from=release /app/snapshots ./snapshots
COPY --from=release /app/scripts/container-verify.ts ./scripts/container-verify.ts
COPY --from=release /app/tests/fixtures/engineering ./tests/fixtures/engineering
COPY --from=release /app/docs/evidence/chain-engineering-sepolia.json ./docs/evidence/chain-engineering-sepolia.json
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    DATABASE_PATH=/data/lothold.sqlite \
    DATA_DIR=/app/snapshots \
    EVIDENCE_STORE=sqlite \
    DURABLE_STORE=supabase \
    DATASETS_TRUST_BUILD_MANIFEST=1 \
    CHAIN_ANCHORING=off \
    TRUST_PROXY=true
COPY deploy/render/start.sh /usr/local/bin/lothold-start
RUN chmod +x /usr/local/bin/lothold-start && mkdir -p /data
EXPOSE 10000
CMD ["lothold-start"]
