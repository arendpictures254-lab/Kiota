#!/usr/bin/env bash
# Nightly backups (runs in the "backup" container, see docker-compose.prod.yml).
#  - database: pg_dump custom format  -> /backups/db/kiota-YYYY-MM-DD.dump
#  - uploaded files (photos, documents, imports) -> /backups/files/kiota-files-YYYY-MM-DD.tar.gz
# Keeps KEEP_DAYS days (default 14). /backups is ./backups on the server: copy it off the
# server regularly (docs/deploy.md, "Backups").
set -euo pipefail

BACKUP_HOUR="${BACKUP_HOUR:-2}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p /backups/db /backups/files

run_backup() {
  local day
  day="$(date +%F)"
  echo "[backup] $(date -Is) starting"
  pg_dump --format=custom --no-owner --file="/backups/db/kiota-${day}.dump.part"
  mv "/backups/db/kiota-${day}.dump.part" "/backups/db/kiota-${day}.dump"
  tar -czf "/backups/files/kiota-files-${day}.tar.gz.part" -C /data storage
  mv "/backups/files/kiota-files-${day}.tar.gz.part" "/backups/files/kiota-files-${day}.tar.gz"
  # Delete backups older than KEEP_DAYS days.
  find /backups/db -name 'kiota-*.dump' -mtime "+$((KEEP_DAYS - 1))" -delete
  find /backups/files -name 'kiota-files-*.tar.gz' -mtime "+$((KEEP_DAYS - 1))" -delete
  echo "[backup] $(date -Is) done: $(ls -1 /backups/db | wc -l) database backups kept"
}

if [ "${1:-}" = "now" ]; then
  run_backup
  exit 0
fi

while true; do
  now=$(date +%s)
  next=$(date -d "today ${BACKUP_HOUR}:00" +%s)
  if [ "$next" -le "$now" ]; then next=$(date -d "tomorrow ${BACKUP_HOUR}:00" +%s); fi
  echo "[backup] next backup at $(date -d "@${next}" -Is)"
  sleep $((next - now))
  run_backup || echo "[backup] FAILED at $(date -Is)"
done
