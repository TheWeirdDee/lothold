#!/bin/sh
# Cloud mode restores an encrypted, committed checkpoint before opening SQLite.
# Requests acknowledge changes only after private Storage + fenced Postgres commit.
set -e
mkdir -p "$(dirname "$DATABASE_PATH")"
if [ "$ALLOW_EPHEMERAL_DATA" = "1" ] && [ "$LOTHOLD_INSTANCE" = "engineering" ]; then
  echo "WARNING: disposable ENGINEERING data; this run does not prove persistence." >&2
  unset DURABLE_STORE
  exec node server/main.ts
fi
if [ "$DURABLE_STORE" = "supabase" ] && [ "$EVIDENCE_STORE" = "sqlite" ]; then
  exec node server/main.ts
fi
echo "Refusing to start: configure DURABLE_STORE=supabase and its server-only settings, or ALLOW_EPHEMERAL_DATA=1 for a disposable engineering instance." >&2
exit 1
