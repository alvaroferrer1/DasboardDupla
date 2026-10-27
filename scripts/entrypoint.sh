#!/bin/sh
set -eu
# Railway mounts persistent volumes owned by root.
# Adjust ONLY the private volume, then drop privileges before starting Node.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  if [ ! -w /app/data ] || [ "$(stat -c '%u' /app/data)" != "$(id -u node)" ]; then
    chown -R node:node /app/data
  fi
  exec gosu node "$@"
fi
exec "$@"
