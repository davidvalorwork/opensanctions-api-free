#!/usr/bin/env bash
# Restaura el backup más reciente hacia DocumentDB (TLS). Requiere conectividad de red al endpoint
# (misma VPC, VPN o bastión); desde un PC típico en Internet no llegará si el clúster es privado.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

load_config
need_cmd aws
need_cmd mongorestore
need_cmd node
need_cmd curl

if [[ "${SKIP_RESTORE:-}" == "1" ]]; then
  echo "SKIP_RESTORE=1: se omite mongorestore."
  exit 0
fi

if [[ ! -f "$LAMBDA_ROOT/.deploy-state" ]]; then
  die "Falta lambda/.deploy-state. Ejecuta antes el paso 01-documentdb (lambda/deploy.sh)."
fi

set -a
# shellcheck source=/dev/null
source "$LAMBDA_ROOT/.deploy-state"
set +a

: "${DOCDB_ENDPOINT:?}"

CERT_DIR="$LAMBDA_ROOT/certs"
mkdir -p "$CERT_DIR"
CERT_FILE="$CERT_DIR/global-bundle.pem"
if [[ ! -f "$CERT_FILE" ]]; then
  curl -sS -o "$CERT_FILE" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
fi

latest="$(ls -d "$BACKUPS_ABS/${MONGO_DB}-"* 2>/dev/null | sort | tail -n 1 || true)"
[[ -n "$latest" && -d "$latest" ]] || die "No hay backup en $BACKUPS_ABS/${MONGO_DB}-* (ejecuta npm run backup)"

dump="$latest/$MONGO_DB"
[[ -d "$dump" ]] || dump="$latest"
[[ -d "$dump" ]] || die "No se encontró el volcado bajo $latest"

ENC_USER=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$DOCDB_MASTER_USERNAME")
ENC_PASS=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$DOCDB_MASTER_PASSWORD")

# Cadena compatible con DocumentDB + herramientas Mongo
MONGO_URI_RESTORE="mongodb://${ENC_USER}:${ENC_PASS}@${DOCDB_ENDPOINT}:27017/?tls=true&tlsCAFile=${CERT_FILE}&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"

echo "Restaurando base '$MONGO_DB' desde $dump hacia $DOCDB_ENDPOINT ..."
echo "(Si falla por timeout, el endpoint suele ser privado: ejecuta este script desde una máquina en la VPC o usa un túnel/bastión.)"

mongorestore --uri="$MONGO_URI_RESTORE" --db="$MONGO_DB" --drop "$dump"

echo "Restauración completada."
