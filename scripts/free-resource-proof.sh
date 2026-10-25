#!/bin/sh
# Isolated local evidence only. Uses the existing image; no hosted resource is created.
set -eu
IMAGE=${1:-lothold-render:local}
NAME="lothold-free-proof-$$"
ENV_FILE=$(mktemp)
REPORT_DIR=/mnt/c/Users/DELL/Desktop/lothold/docs/evidence
mkdir -p "$REPORT_DIR"
chmod 600 "$ENV_FILE"
cleanup() {
  docker logs "$NAME" > "$REPORT_DIR/free-resource-server.log" 2>&1 || true
  docker inspect "$NAME" --format '{"memoryLimitBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}},"oomKilled":{{.State.OOMKilled}},"exitCode":{{.State.ExitCode}},"image":"{{.Image}}"}' > "$REPORT_DIR/free-resource-container.json" 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT INT TERM
printf 'EVIDENCE_ENCRYPTION_KEY=%s\nDOWNLOAD_SIGNING_KEY=%s\n' "$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" "$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$ENV_FILE"
docker run -d --name "$NAME" --memory=512m --memory-swap=512m --cpus=0.1 \
  --env-file "$ENV_FILE" -e ALLOW_EPHEMERAL_DATA=1 -e LOTHOLD_INSTANCE=engineering \
  -e PUBLIC_ORIGIN=http://127.0.0.1:10000 -e REGISTER_RATE_LIMIT=1000 "$IMAGE" >/dev/null
docker exec "$NAME" node scripts/container-verify.ts seed http://127.0.0.1:10000 /tmp/engineering-state.json > "$REPORT_DIR/free-resource-workflow.jsonl"
docker exec "$NAME" sh -c 'printf "memory_peak_bytes="; cat /sys/fs/cgroup/memory.peak; printf "memory_events\n"; cat /sys/fs/cgroup/memory.events' > "$REPORT_DIR/free-resource-memory.txt"
docker inspect "$NAME" --format '{"memoryLimitBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}},"oomKilled":{{.State.OOMKilled}},"image":"{{.Image}}"}' > "$REPORT_DIR/free-resource-container.json"
cat "$REPORT_DIR/free-resource-memory.txt"
cat "$REPORT_DIR/free-resource-container.json"
echo 'Representative local workflow completed. This run used disposable data: it does NOT prove remote persistence or hosted readiness.'
