# Nightly logical backup of Skein's Postgres to a private Railway bucket.
# Runs as a Railway cron service (see docs/RUNBOOK.md, Backups); exits when done.
# pg_dump 18 dumps any server from 9.2 up.
FROM postgres:18-alpine
RUN apk add --no-cache aws-cli
COPY apps/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
