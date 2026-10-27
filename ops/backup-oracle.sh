#!/usr/bin/env bash
# Backup SQLite online into persistent volume, then copy an archive to a host directory.
# This does NOT replace an independent/off-server encrypted backup.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DOS_HOST_BACKUP_DIR:-/var/backups/dos-espacios}"
# Backup destination must be an explicit dos-espacios directory, never a filesystem root.
if [[ "$DEST" != /*/dos-espacios && "$DEST" != /var/backups/dos-espacios ]];then echo "Ruta de backup insegura; debe terminar en /dos-espacios" >&2;exit 1;fi
if [[ "${EUID}" -ne 0 ]];then echo 'Requiere sudo/root para acceder a los respaldos privados';exit 1;fi
umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$ROOT"
APP_ID="$(docker compose ps -q app)"
if [[ -z "$APP_ID" ]];then echo 'El servidor app no está arrancado';exit 1;fi
# Temporary snapshots live on the persistent volume until docker cp finishes.
docker compose exec -T -e DOS_BACKUP_DIR=/app/data/_temporary_backups app node scripts/backup.mjs
# Unique directory copied from the app, inaccessible to unprivileged host users.
TODAY="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST/$TODAY"
docker cp "$APP_ID:/app/data/_temporary_backups/." "$DEST/$TODAY/"
# Guard the backup by checking a SQLite file and manifest were copied.
if ! find "$DEST/$TODAY" -name 'dos.sqlite' -type f | grep -q .;then
  echo "ERROR: no se ha copiado la base a $DEST/$TODAY" >&2;exit 1
fi
if ! find "$DEST/$TODAY" -name manifest.json -type f | grep -q .;then
  echo 'ERROR: falta manifest.json' >&2;exit 1
fi
# Clean only a known, dedicated staging path inside the docker volume.
docker compose exec -T app sh -c 'rm -rf /app/data/_temporary_backups'
find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +13 -exec rm -rf -- {} +
echo "Backup completo en $DEST/$TODAY (hacer también copia EXTERNA cifrada)"
