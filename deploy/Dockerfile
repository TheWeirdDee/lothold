# LotHold production image. NOT YET BUILT: Docker was unavailable in the build environment.
# Build context is the repository root:  docker build -f deploy/Dockerfile -t lothold .
FROM node:24.13.1-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN npm run build && pnpm prune --prod
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/lothold.sqlite \
    EVIDENCE_DIR=/data/evidence \
    DATA_DIR=/data/snapshots
# Runs as root inside the container because platform volumes (e.g. Fly) mount root-owned at /data.
EXPOSE 8787
CMD ["node", "server/main.ts"]
