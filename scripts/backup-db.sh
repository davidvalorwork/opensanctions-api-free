#!/usr/bin/env bash

# Backup sencillo de la base de datos MongoDB usada por este proyecto.
# Usa las variables de entorno MONGO_URI y MONGO_DB (o los valores por defecto).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f ".env" ]; then
  # Cargar variables de entorno del proyecto
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | xargs -d '\n' -n1)
fi

MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
MONGO_DB="${MONGO_DB:-opensanctions}"

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
BACKUP_DIR="$ROOT_DIR/backups/${MONGO_DB}-${TIMESTAMP}"

mkdir -p "$BACKUP_DIR"

echo "Haciendo backup de MongoDB..."
echo "  URI: $MONGO_URI"
echo "  DB : $MONGO_DB"
echo "  Destino: $BACKUP_DIR"

if ! command -v mongodump >/dev/null 2>&1; then
  echo "ERROR: no se encontró 'mongodump' en el PATH."
  echo "Instala las MongoDB Database Tools y asegúrate de que 'mongodump' esté disponible."
  exit 1
fi

mongodump --uri="$MONGO_URI" --db="$MONGO_DB" --out="$BACKUP_DIR"

echo "Backup completado."
echo "Archivos guardados en: $BACKUP_DIR"

