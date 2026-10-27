#!/usr/bin/env bash
# Oracle Cloud Always Free - Ubuntu 24.04/22.04 arm64 or amd64.
# Run inside the dos-espacios project on the VM: sudo bash ops/INSTALAR_ORACLE_ALWAYS_FREE.sh <PUBLIC_IPV4>
set -euo pipefail
if [[ "$EUID" -ne 0 ]];then echo 'Uso: sudo bash ops/INSTALAR_ORACLE_ALWAYS_FREE.sh TU_IP_PUBLICA';exit 1;fi
IP="${1:-}"
if [[ ! "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]];then echo 'Indica una dirección IPv4 pública válida';exit 1;fi
IFS=. read -r a b c d <<< "$IP"
for octet in "$a" "$b" "$c" "$d";do if (( 10#$octet > 255 ));then echo 'Octeto inválido';exit 1;fi;done
if (( a==0 || a==10 || a==127 || (a==192 && b==168) || (a==172 && b>=16 && b<=31) || (a==169 && b==254) || a>=224 ));then echo 'Usa la IP pública del VPS, no una IP privada/local';exit 1;fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${IP//./-}.sslip.io"
cd "$ROOT"
if [[ -e .env ]];then echo 'Existe .env: no sobrescribiré el servidor ya configurado';exit 1;fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1;then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  # Ubuntu 24.04: Compose V2 is in the universe repository.
  if command -v add-apt-repository >/dev/null 2>&1;then add-apt-repository -y universe >/dev/null || true;fi
  apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker
if ! docker compose version >/dev/null 2>&1;then echo 'Docker Compose V2 no disponible';exit 1;fi
umask 077
SETUP_TOKEN="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
cat > .env <<ENV
DOMAIN=$DOMAIN
SETUP_TOKEN=$SETUP_TOKEN
OPENAI_API_KEY=
WORK_WEBHOOK_URL=
ENV
chmod 600 .env
# Restrict what is listening publicly: only Caddy has host ports 80/443; Node is private.
docker compose config --quiet
docker compose up -d --build
# Automatic daily host-local snapshots. Additional backups outside the Oracle VM are necessary.
cat > /etc/systemd/system/dos-espacios-backup.service <<EOF
[Unit]
Description=DOS ESPACIOS SQLite and files backup
After=docker.service
[Service]
Type=oneshot
ExecStart=/bin/bash $ROOT/ops/backup-oracle.sh
EOF
cat > /etc/systemd/system/dos-espacios-backup.timer <<'EOF'
[Unit]
Description=Daily DOS ESPACIOS backup
[Timer]
OnCalendar=*-*-* 03:20:00 UTC
Persistent=true
RandomizedDelaySec=10m
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now dos-espacios-backup.timer
cat <<OUT

✅ Servicios Docker arrancados. Verifica desde fuera HTTPS antes de comunicar la URL:
   https://$DOMAIN

1) OCI Networking: abre 80/443 TCP entrantes y 22 SOLO desde tu IP en NSG/Security List.
   No abras 3077. Asegúrate de que la imagen Ubuntu no bloquee 80/443 localmente.
2) Caddy necesita que DNS y ambos puertos estén accesibles para emitir TLS.
   Revisa: docker compose logs --tail=80 caddy
3) Clave privada de activación: está en el archivo .env del VPS, NO la compartas.
   Usadla SOLO para crear las dos cuentas desde la pantalla inicial.
4) Después de activar las cuentas, borra SETUP_TOKEN del .env y aplica:
   docker compose up -d --force-recreate app
5) Cada madrugada habrá backups LOCALES en /var/backups/dos-espacios.
   Hay que copiar esos archivos cifrados FUERA de Oracle regularmente.

Oracle puede recuperar VMs Always Free inactivas. No existe SLA ni disponibilidad garantizada.
OUT
