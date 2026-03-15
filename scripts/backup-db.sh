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

USE_DOCKER=false
if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump local no encontrado. Comprobando si el contenedor refactor-grafo-mongodb-dev está en ejecución..."
  if docker ps --format '{{.Names}}' | grep -q 'refactor-grafo-mongodb-dev'; then
    echo "Contenedor detectado. Se usará mongodump desde Docker."
    USE_DOCKER=true
  else
    echo "ERROR: no se encontró 'mongodump' en el PATH."
    echo "Instala las MongoDB Database Tools y asegúrate de que 'mongodump' esté disponible."
    exit 1
  fi
fi

if [ "$USE_DOCKER" = "true" ]; then
  # La ruta dentro del contenedor /opensanctions_backups está mapeada a ../opensanctions/backups
  DOCKER_OUT_DIR="/opensanctions_backups/${MONGO_DB}-${TIMESTAMP}"
  docker exec refactor-grafo-mongodb-dev mongodump \
    --uri="mongodb://localhost:27017" \
    --db="$MONGO_DB" \
    --out="$DOCKER_OUT_DIR"
else
  mkdir -p "$BACKUP_DIR"
  mongodump --uri="$MONGO_URI" --db="$MONGO_DB" --out="$BACKUP_DIR"
fi

echo "Backup completado."
echo "Archivos guardados en: $BACKUP_DIR"
