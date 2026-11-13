# Nightly logical backup of Skein's Postgres to a private Railway bucket.
# Runs as a Railway cron service (see docs/RUNBOOK.md, Backups); exits when done.
# pg_dump 18 dumps any server from 9.2 up. age encrypts the dump before upload
# when BACKUP_AGE_RECIPIENT is set; restore-drill.sh (same image, other
# entrypoint) proves a dump restores.
FROM postgres:18-alpine
RUN apk add --no-cache aws-cli age
COPY apps/backup/backup.sh /usr/local/bin/backup.sh
COPY apps/backup/restore-drill.sh /usr/local/bin/restore-drill.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-drill.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
