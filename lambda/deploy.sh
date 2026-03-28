#!/usr/bin/env bash
# Orquestador: DocumentDB → restauración → Lambda + Function URL.
# Prerrequisitos: AWS CLI configurado, mongorestore (Database Tools), Node 18+, zip, openssl, curl.
# Configuración: copia lambda/config.env.example → lambda/config.env

set -euo pipefail

LAMBDA_ROOT="$(cd "$(dirname "$0")" && pwd)"

bash "$LAMBDA_ROOT/scripts/01-documentdb.sh"
bash "$LAMBDA_ROOT/scripts/02-restore.sh"
bash "$LAMBDA_ROOT/scripts/03-lambda.sh"

echo ""
echo "Despliegue completo."
