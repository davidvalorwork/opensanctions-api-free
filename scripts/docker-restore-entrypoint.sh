#!/bin/sh
# Restaura el backup más reciente de ./backups (montado en /backup) hacia Mongo.
# Variables: MONGO_URI, MONGO_DB, BACKUP_ROOT (por defecto /backup).

set -eu

MONGO_URI="${MONGO_URI:-mongodb://mongodb-test:27017}"
MONGO_DB="${MONGO_DB:-opensanctions}"
BACKUP_ROOT="${BACKUP_ROOT:-/backup}"

if [ ! -d "$BACKUP_ROOT" ]; then
  echo "ERROR: no existe el directorio de backups: $BACKUP_ROOT"
  exit 1
fi

latest="$(ls -d "$BACKUP_ROOT/${MONGO_DB}-"* 2>/dev/null | sort | tail -n 1 || true)"

if [ -z "$latest" ] || [ ! -d "$latest" ]; then
  echo "ERROR: no hay carpeta de backup tipo $BACKUP_ROOT/${MONGO_DB}-<fecha>."
  echo "Genera uno antes con: npm run backup (con MONGO_URI apuntando a tu Mongo con datos)"
  exit 1
fi

dump="$latest/$MONGO_DB"
if [ ! -d "$dump" ]; then
  dump="$latest"
fi

if [ ! -d "$dump" ]; then
  echo "ERROR: no se encontró el volcado dentro de: $latest"
  exit 1
fi

echo "Restaurando en $MONGO_URI base $MONGO_DB desde $dump"
mongorestore --uri="$MONGO_URI" --db="$MONGO_DB" --drop "$dump"
echo "Restauración completada."
