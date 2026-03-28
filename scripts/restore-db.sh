#!/usr/bin/env bash

# Restaura la base de datos MongoDB desde un backup creado con scripts/backup-db.sh
# Uso:
#   npm run restore                # restaura el backup más reciente
#   npm run restore -- <ruta>      # restaura desde una ruta concreta de backup

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

BACKUPS_DIR="$ROOT_DIR/backups"

if [ ! -d "$BACKUPS_DIR" ]; then
  echo "ERROR: no existe el directorio de backups: $BACKUPS_DIR"
  exit 1
fi

if [ "${1-}" != "" ]; then
  BACKUP_PATH="$1"
else
  # Tomar el backup más reciente para esta base de datos
  BACKUP_PATH="$(ls -d "$BACKUPS_DIR/${MONGO_DB}-"* 2>/dev/null | sort | tail -n 1 || true)"
fi

if [ -z "${BACKUP_PATH:-}" ] || [ ! -d "$BACKUP_PATH" ]; then
  echo "ERROR: no se encontró un backup para la base de datos '$MONGO_DB'."
  echo "Asegúrate de haber ejecutado antes: npm run backup"
  exit 1
fi

DB_DUMP_DIR="$BACKUP_PATH/$MONGO_DB"

if [ ! -d "$DB_DUMP_DIR" ]; then
  # En algunos casos mongodump puede volcar directamente en la carpeta raíz
  DB_DUMP_DIR="$BACKUP_PATH"
fi

echo "Se va a RESTAURAR la base de datos:"
echo "  URI: $MONGO_URI"
echo "  DB : $MONGO_DB"
echo "  Desde: $DB_DUMP_DIR"
echo
if [ "${SKIP_RESTORE_CONFIRM:-}" = "1" ]; then
  echo "SKIP_RESTORE_CONFIRM=1: continuando sin preguntar."
else
  read -r -p "Esto sobrescribirá los datos actuales. ¿Continuar? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Restauración cancelada."
    exit 0
  fi
fi

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "ERROR: no se encontró 'mongorestore' en el PATH."
  echo "Instala las MongoDB Database Tools y asegúrate de que 'mongorestore' esté disponible."
  exit 1
fi

mongorestore --uri="$MONGO_URI" --db="$MONGO_DB" --drop "$DB_DUMP_DIR"

echo "Restauración completada desde: $DB_DUMP_DIR"

