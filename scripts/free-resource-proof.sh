#!/bin/sh
# Isolated local evidence only. Uses the existing image; no hosted resource is created.
set -eu
IMAGE=${1:-lothold-release:reliability}
NAME="lothold-free-proof-$$"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPORT_DIR="$ROOT/docs/evidence/release"
mkdir -p "$REPORT_DIR"
cleanup() {
  docker logs "$NAME" > "$REPORT_DIR/free-resource-server.log" 2>&1 || true
  docker inspect "$NAME" --format '{"memoryLimitBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}},"oomKilled":{{.State.OOMKilled}},"exitCode":{{.State.ExitCode}},"image":"{{.Image}}"}' > "$REPORT_DIR/free-resource-container.json" 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
# Generated ENGINEERING keys live only in this shell environment; never in argv/logs.
EVIDENCE_ENCRYPTION_KEY=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
DOWNLOAD_SIGNING_KEY=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
export EVIDENCE_ENCRYPTION_KEY DOWNLOAD_SIGNING_KEY

docker run -d --name "$NAME" --memory=512m --memory-swap=512m --cpus=0.1 \
  -e EVIDENCE_ENCRYPTION_KEY -e DOWNLOAD_SIGNING_KEY -e ALLOW_EPHEMERAL_DATA=1 -e LOTHOLD_INSTANCE=engineering \
  -e PUBLIC_ORIGIN=http://127.0.0.1:10000 -e REGISTER_RATE_LIMIT=1000 "$IMAGE" >/dev/null
timeout 600 docker exec "$NAME" node scripts/container-verify.ts seed http://127.0.0.1:10000 /tmp/engineering-state.json > "$REPORT_DIR/free-resource-workflow.jsonl"
docker exec "$NAME" sh -c 'printf "memory_peak_bytes="; cat /sys/fs/cgroup/memory.peak; printf "memory_events\n"; cat /sys/fs/cgroup/memory.events' > "$REPORT_DIR/free-resource-memory.txt"
docker restart "$NAME" >/dev/null
timeout 300 docker exec "$NAME" node scripts/container-verify.ts after-restart http://127.0.0.1:10000 /tmp/engineering-state.json > "$REPORT_DIR/free-resource-restart.jsonl"
docker exec "$NAME" sh -c 'printf "memory_peak_bytes="; cat /sys/fs/cgroup/memory.peak; printf "memory_events\n"; cat /sys/fs/cgroup/memory.events' > "$REPORT_DIR/free-resource-restart-memory.txt"
docker inspect "$NAME" --format '{"memoryLimitBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}},"oomKilled":{{.State.OOMKilled}},"image":"{{.Image}}"}' > "$REPORT_DIR/free-resource-container.json"
docker image inspect "$IMAGE" --format '{"imageId":"{{.Id}}","repoDigests":{{json .RepoDigests}},"sizeBytes":{{.Size}}}' > "$REPORT_DIR/release-image.json"
cat "$REPORT_DIR/free-resource-memory.txt"
cat "$REPORT_DIR/free-resource-container.json"
echo 'Representative local workflow completed. This run used disposable data: it does NOT prove remote persistence or hosted readiness.'
