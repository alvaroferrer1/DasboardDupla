#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Necesitas instalar Node.js 22.13 o superior: https://nodejs.org"
  read -r -p "Pulsa INTRO para cerrar."
  exit 1
fi
if ! node -e 'process.exit(parseInt(process.versions.node.split(".")[0])>=22?0:1)'; then
  echo "Actualiza Node.js a 22.13 o superior."
  read -r -p "Pulsa INTRO para cerrar."
  exit 1
fi
if [ ! -f "data/dos.sqlite" ]; then
  echo "Primera instalación: prepara los dos usuarios."
  npm run setup || exit 1
fi
echo "Abre http://127.0.0.1:3077 en tu navegador."
npm start
