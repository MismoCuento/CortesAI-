#!/bin/bash
# CortesAI · Iniciar el motor local (doble clic en Mac)
cd "$(dirname "$0")"
clear
echo "Iniciando el motor local de CortesAI..."
echo ""
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js no está instalado."
  echo "    Instálalo desde https://nodejs.org (versión LTS) y vuelve a abrir este archivo."
  echo ""
  read -p "Presiona Enter para cerrar."
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/ffmpeg ] && [ ! -x /usr/local/bin/ffmpeg ]; then
  echo "[!] FFmpeg no está instalado."
  echo "    Instálalo con:  brew install ffmpeg"
  echo "    (Si no tienes Homebrew: https://brew.sh)"
  echo ""
fi
node server.js
echo ""
read -p "El motor se detuvo. Presiona Enter para cerrar."
