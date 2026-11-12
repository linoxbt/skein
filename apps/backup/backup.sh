#!/bin/sh
# One backup: pg_dump (custom format) -> s3://$BUCKET/postgres/skein-<UTC time>.dump[.age],
# then keep the newest $KEEP dumps (default 30). Restore: restore-drill.sh here, and docs/RUNBOOK.md, Backups.
#
# Encryption (client-side, before upload): set BACKUP_AGE_RECIPIENT to an age
# public key (age1...). The dump is encrypted to it and uploaded as .dump.age;
# this job never holds the private key, so a leaked bucket or job secret does
# not expose the data. Keep the identity (AGE-SECRET-KEY-...) offline, and give
# it to restore-drill.sh only when restoring. Without BACKUP_AGE_RECIPIENT the
# dump is uploaded as before (unencrypted, relying on the bucket's access
# control), and the log says so.
set -eu
# pipefail where the shell has it (busybox ash in the image does; old dash does not).
(set -o pipefail) 2>/dev/null && set -o pipefail
: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BUCKET:?BUCKET is not set}"
KEEP="${KEEP:-30}"
log() { printf '{"level":"%s","msg":"%s"%s}\n' "$1" "$2" "${3:-}"; }

ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)
file="/tmp/skein-$ts.dump"
list="/tmp/skein-$ts.list"
trap 'rm -f "$file" "$file.age" "$list"' EXIT
started=$(date +%s)

pg_dump --format=custom --no-owner --no-privileges --file="$file" "$DATABASE_URL"
bytes=$(wc -c < "$file" | tr -d ' ')
if [ "$bytes" -lt 1024 ]; then log error "backup too small" ",\"bytes\":$bytes"; exit 1; fi
# A dump that pg_restore cannot list, or that holds no table data, is not a backup.
pg_restore --list "$file" > "$list"
tables=$(grep -c " TABLE DATA " "$list" || true)
if [ "$tables" -eq 0 ]; then log error "backup holds no table data" ",\"bytes\":$bytes"; exit 1; fi
for t in verdicts purchases findings spend_ledger; do
  if ! grep -Eq " TABLE DATA public $t( |\$)" "$list"; then log error "backup is missing a table" ",\"table\":\"$t\""; exit 1; fi
done

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$file.age" "$file"
  rm -f "$file"
  upload="$file.age"
  key="postgres/skein-$ts.dump.age"
  encrypted=true
else
  log warn "BACKUP_AGE_RECIPIENT is not set: uploading the dump unencrypted"
  upload="$file"
  key="postgres/skein-$ts.dump"
  encrypted=false
fi

aws s3 cp "$upload" "s3://$BUCKET/$key" --only-show-errors
log info "backup uploaded" ",\"key\":\"$key\",\"bytes\":$bytes,\"tables\":$tables,\"encrypted\":$encrypted,\"seconds\":$(( $(date +%s) - started ))"
# Heartbeat for the probe (alerts when the last backup is over 26 h old) and /v1/status.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "INSERT INTO heartbeats (name, at, detail) VALUES ('backup', now(), '$key $bytes bytes $tables tables') ON CONFLICT (name) DO UPDATE SET at = EXCLUDED.at, detail = EXCLUDED.detail" \
  || log error "backup heartbeat not recorded"

keys=$(aws s3 ls "s3://$BUCKET/postgres/" | awk '{print $4}' | grep -E '^skein-.*\.dump(\.age)?$' | sort || true)
count=$(printf '%s\n' "$keys" | grep -c . || true)
if [ "$count" -gt "$KEEP" ]; then
  printf '%s\n' "$keys" | head -n "$((count - KEEP))" | while read -r old; do
    aws s3 rm "s3://$BUCKET/postgres/$old" --only-show-errors
    log info "old backup removed" ",\"key\":\"postgres/$old\""
  done
fi
log info "backups kept" ",\"count\":$(( count > KEEP ? KEEP : count ))"
