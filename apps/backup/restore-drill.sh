#!/bin/sh
# Restore drill: proves the newest backup can be restored, without touching production.
#
#   BUCKET=...                        the backup bucket (same credentials as backup.sh: AWS_*)
#   RESTORE_DATABASE_URL=postgres://  an EMPTY scratch database to restore into (never production)
#   BACKUP_AGE_IDENTITY=/path/key.txt the age identity file, when the backups are encrypted (.dump.age)
#   BACKUP_KEY=postgres/skein-...     optional: a specific dump instead of the newest
#   DATABASE_URL=postgres://          optional: production, read-only, to compare row counts against
#
# What it does: downloads the dump, decrypts it if needed, lists it, restores
# it into RESTORE_DATABASE_URL with pg_restore (--no-owner, --exit-on-error),
# then counts the evidence tables there. With DATABASE_URL it also reads the
# same counts from production (SELECT only) and fails if the restore holds
# more verdicts or purchases than production does now: evidence is
# append-only, so production can only have grown since the dump.
# Run it monthly and after any change to backup.sh, from a machine or one-off
# Railway service with pg_restore 18 and age installed (the backup image has
# both: docker run --entrypoint /usr/local/bin/restore-drill.sh ...).
# Exit status 0 means the drill passed; the last log line says what was restored.
set -eu
# pipefail where the shell has it (busybox ash in the image does; old dash does not).
(set -o pipefail) 2>/dev/null && set -o pipefail
: "${BUCKET:?BUCKET is not set}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is not set (an empty scratch database)}"
log() { printf '{"level":"%s","msg":"%s"%s}\n' "$1" "$2" "${3:-}"; }

if [ -n "${DATABASE_URL:-}" ] && [ "$RESTORE_DATABASE_URL" = "$DATABASE_URL" ]; then
  log error "RESTORE_DATABASE_URL is the production database: refusing"; exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

key="${BACKUP_KEY:-$(aws s3 ls "s3://$BUCKET/postgres/" | awk '{print $4}' | grep -E '^skein-.*\.dump(\.age)?$' | sort | tail -n 1 | sed 's|^|postgres/|')}"
[ -n "$key" ] || { log error "no backup found"; exit 1; }
aws s3 cp "s3://$BUCKET/$key" "$work/in" --only-show-errors
case "$key" in
  *.age)
    : "${BACKUP_AGE_IDENTITY:?the backup is encrypted: set BACKUP_AGE_IDENTITY to the age identity file}"
    age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$work/dump" "$work/in" ;;
  *) mv "$work/in" "$work/dump" ;;
esac

pg_restore --list "$work/dump" > "$work/list"
tables=$(grep -c " TABLE DATA " "$work/list" || true)
[ "$tables" -gt 0 ] || { log error "the dump holds no table data" ",\"key\":\"$key\""; exit 1; }

existing=$(psql "$RESTORE_DATABASE_URL" -tA -c "select count(*) from pg_tables where schemaname = 'public'")
[ "$existing" -eq 0 ] || { log error "RESTORE_DATABASE_URL is not empty: restore into a fresh database" ",\"tables\":$existing"; exit 1; }
started=$(date +%s)
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$work/dump"

counts() {
  psql "$1" -tA -F ' ' -c "select (select count(*) from verdicts), (select count(*) from purchases), (select count(*) from findings), (select count(*) from spend_ledger)"
}
restored=$(counts "$RESTORE_DATABASE_URL")
set -- $restored
[ "$1" -gt 0 ] || { log error "the restored database has no verdicts" ",\"key\":\"$key\""; exit 1; }
summary=",\"key\":\"$key\",\"tables\":$tables,\"verdicts\":$1,\"purchases\":$2,\"findings\":$3,\"ledger\":$4,\"seconds\":$(( $(date +%s) - started ))"
if [ -n "${DATABASE_URL:-}" ]; then
  r_verdicts=$1; r_purchases=$2
  set -- $(counts "$DATABASE_URL")
  # Evidence is append-only: production can only have more rows than an older dump, never fewer.
  if [ "$1" -lt "$r_verdicts" ] || [ "$2" -lt "$r_purchases" ]; then
    log error "the restore holds more evidence than production: something deleted rows" "$summary,\"prodVerdicts\":$1,\"prodPurchases\":$2"; exit 1
  fi
  summary="$summary,\"prodVerdicts\":$1,\"prodPurchases\":$2"
fi
log info "restore drill passed" "$summary"
