#!/bin/sh
# One backup: pg_dump (custom format) -> s3://$BUCKET/postgres/skein-<UTC time>.dump,
# then keep the newest $KEEP dumps (default 30). Restore: docs/RUNBOOK.md, Backups.
set -eu
: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BUCKET:?BUCKET is not set}"
KEEP="${KEEP:-30}"
log() { printf '{"level":"%s","msg":"%s"%s}\n' "$1" "$2" "${3:-}"; }

ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)
key="postgres/skein-$ts.dump"
file="/tmp/skein-$ts.dump"
started=$(date +%s)

pg_dump --format=custom --no-owner --no-privileges --file="$file" "$DATABASE_URL"
bytes=$(wc -c < "$file" | tr -d ' ')
if [ "$bytes" -lt 1024 ]; then log error "backup too small" ",\"bytes\":$bytes"; exit 1; fi
# A dump that pg_restore cannot list is not a backup.
tables=$(pg_restore --list "$file" | grep -c " TABLE DATA " || true)

aws s3 cp "$file" "s3://$BUCKET/$key" --only-show-errors
rm -f "$file"
log info "backup uploaded" ",\"key\":\"$key\",\"bytes\":$bytes,\"tables\":$tables,\"seconds\":$(( $(date +%s) - started ))"
# Heartbeat for the probe (alerts when the last backup is over 26 h old) and /v1/status.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "INSERT INTO heartbeats (name, at, detail) VALUES ('backup', now(), '$key $bytes bytes') ON CONFLICT (name) DO UPDATE SET at = EXCLUDED.at, detail = EXCLUDED.detail" \
  || log error "backup heartbeat not recorded"

keys=$(aws s3 ls "s3://$BUCKET/postgres/" | awk '{print $4}' | grep '^skein-.*\.dump$' | sort)
count=$(printf '%s\n' "$keys" | grep -c . || true)
if [ "$count" -gt "$KEEP" ]; then
  printf '%s\n' "$keys" | head -n "$((count - KEEP))" | while read -r old; do
    aws s3 rm "s3://$BUCKET/postgres/$old" --only-show-errors
    log info "old backup removed" ",\"key\":\"postgres/$old\""
  done
fi
log info "backups kept" ",\"count\":$(( count > KEEP ? KEEP : count ))"
