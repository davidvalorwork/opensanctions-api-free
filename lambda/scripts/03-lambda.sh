#!/usr/bin/env bash
# Empaqueta la app, crea o actualiza la Lambda y expone Function URL pública.
# Si el zip tiene el mismo CodeSha256 que la versión desplegada, no sube código de nuevo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

load_config
need_cmd aws
need_cmd zip
need_cmd openssl
need_cmd node

LAMBDA_RUNTIME="${LAMBDA_RUNTIME:-nodejs20.x}"
LAMBDA_TIMEOUT="${LAMBDA_TIMEOUT:-60}"
LAMBDA_MEMORY="${LAMBDA_MEMORY:-1024}"

if [[ ! -f "$LAMBDA_ROOT/.deploy-state" ]]; then
  die "Falta lambda/.deploy-state. Ejecuta antes 01-documentdb."
fi

set -a
# shellcheck source=/dev/null
source "$LAMBDA_ROOT/.deploy-state"
set +a

: "${DOCDB_ENDPOINT:?}" "${LAMBDA_SG_ID:?}" "${DOCDB_SUBNET_A:?}" "${DOCDB_SUBNET_B:?}"

if [[ -n "${LAMBDA_SUBNET_IDS:-}" ]]; then
  IFS=',' read -r -a SUBNETS_ARR <<< "${LAMBDA_SUBNET_IDS//[[:space:]]/}"
else
  SUBNETS_ARR=("$DOCDB_SUBNET_A" "$DOCDB_SUBNET_B")
fi

ENC_USER=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$DOCDB_MASTER_USERNAME")
ENC_PASS=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$DOCDB_MASTER_PASSWORD")
MONGO_URI_LAMBDA="mongodb://${ENC_USER}:${ENC_PASS}@${DOCDB_ENDPOINT}:27017/?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"

BUILD_ROOT="$LAMBDA_ROOT/build"
PAYLOAD="$BUILD_ROOT/payload"
ZIP_FILE="$BUILD_ROOT/function.zip"
mkdir -p "$PAYLOAD/certs"

rm -rf "$PAYLOAD" "$ZIP_FILE"
mkdir -p "$PAYLOAD"

cp "$REPO_ROOT/package.json" "$REPO_ROOT/package-lock.json" "$PAYLOAD/"
cp -r "$REPO_ROOT/src" "$PAYLOAD/"

curl -sS -o "$PAYLOAD/certs/global-bundle.pem" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

cat >"$PAYLOAD/index.js" <<'EOF'
const { handler } = require('./src/lambda-handler');
module.exports = { handler };
EOF

(
  cd "$PAYLOAD"
  npm ci --omit=dev
)

(
  cd "$PAYLOAD"
  zip -qr "$ZIP_FILE" .
)

LOCAL_SHA=$(openssl dgst -sha256 -binary "$ZIP_FILE" | openssl base64 -A 2>/dev/null || openssl dgst -sha256 -binary "$ZIP_FILE" | base64 | tr -d '\n')

ACCOUNT=$(account_id)
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${LAMBDA_ROLE_NAME}"

TRUST_JSON=$(mktemp)
cleanup() { rm -f "$TRUST_JSON"; }
trap cleanup EXIT

cat >"$TRUST_JSON" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

if aws iam get-role --role-name "$LAMBDA_ROLE_NAME" &>/dev/null; then
  echo "Rol IAM '$LAMBDA_ROLE_NAME' ya existe."
else
  aws iam create-role \
    --role-name "$LAMBDA_ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_JSON"
  aws iam attach-role-policy \
    --role-name "$LAMBDA_ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
  aws iam attach-role-policy \
    --role-name "$LAMBDA_ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Esperando propagación IAM (15s)..."
  sleep 15
fi

SUBNET_CSV=$(IFS=','; echo "${SUBNETS_ARR[*]}")

write_lambda_env_file() {
  local out="$BUILD_ROOT/env.json"
  mkdir -p "$BUILD_ROOT"
  URI_FILE="$BUILD_ROOT/.mongo_uri.tmp"
  printf '%s' "$MONGO_URI_LAMBDA" >"$URI_FILE"
  node -e "
const fs = require('fs');
const uri = fs.readFileSync(process.argv[1], 'utf8').trim();
const vars = {
  MONGO_URI: uri,
  MONGO_DB: process.argv[2],
  MONGO_TLS_CA_FILE: '/var/task/certs/global-bundle.pem',
  NODE_ENV: 'production',
  OPENSANCTIONS_SEARCH_LITE: '1',
};
if (process.env.rapid_api) vars.rapid_api = process.env.rapid_api;
if (process.env.RAPIDAPI_PROXY_SECRET) vars.RAPIDAPI_PROXY_SECRET = process.env.RAPIDAPI_PROXY_SECRET;
fs.writeFileSync(process.argv[3], JSON.stringify({ Variables: vars }));
" "$URI_FILE" "$MONGO_DB" "$out"
  rm -f "$URI_FILE"
  echo "$out"
}

ENV_FILE=$(write_lambda_env_file)
ENV_FILE_URL="file://$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

SKIP_CODE=0
if aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION" &>/dev/null; then
  REMOTE_SHA=$(aws lambda get-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --region "$AWS_REGION" \
    --query CodeSha256 --output text)
  if [[ "$REMOTE_SHA" == "$LOCAL_SHA" ]]; then
    echo "El código de Lambda ya coincide con el paquete local (CodeSha256). No se vuelve a subir el zip."
    SKIP_CODE=1
  fi
fi

if [[ "$SKIP_CODE" -eq 0 ]]; then
  if aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION" &>/dev/null; then
    aws lambda update-function-code \
      --function-name "$LAMBDA_FUNCTION_NAME" \
      --zip-file "fileb://$ZIP_FILE" \
      --region "$AWS_REGION"
    aws lambda wait function-updated --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION"
  else
    aws lambda create-function \
      --function-name "$LAMBDA_FUNCTION_NAME" \
      --runtime "$LAMBDA_RUNTIME" \
      --role "$ROLE_ARN" \
      --handler index.handler \
      --zip-file "fileb://$ZIP_FILE" \
      --timeout "$LAMBDA_TIMEOUT" \
      --memory-size "$LAMBDA_MEMORY" \
      --vpc-config "SubnetIds=${SUBNET_CSV},SecurityGroupIds=${LAMBDA_SG_ID}" \
      --environment "$ENV_FILE_URL" \
      --region "$AWS_REGION"
    aws lambda wait function-active-v2 --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION" 2>/dev/null \
      || aws lambda wait function-active --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION"
  fi
fi

# Alinear variables y VPC (p. ej. contraseña o endpoint rotados)
aws lambda update-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --timeout "$LAMBDA_TIMEOUT" \
  --memory-size "$LAMBDA_MEMORY" \
  --vpc-config "SubnetIds=${SUBNET_CSV},SecurityGroupIds=${LAMBDA_SG_ID}" \
  --environment "$ENV_FILE_URL" \
  --region "$AWS_REGION"

aws lambda wait function-updated --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION"

if aws lambda get-function-url-config --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION" &>/dev/null; then
  echo "Function URL ya configurada."
else
  aws lambda create-function-url-config \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --auth-type NONE \
    --cors '{"AllowOrigins":["*"],"AllowMethods":["GET","POST","OPTIONS"],"AllowHeaders":["*"]}' \
    --region "$AWS_REGION"
  aws lambda add-permission \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --statement-id FunctionURLAllowPublic \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE \
    --region "$AWS_REGION" 2>/dev/null || true
fi

FN_URL=$(aws lambda get-function-url-config \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$AWS_REGION" \
  --query FunctionUrl --output text)

echo ""
echo "=== Lambda desplegada ==="
echo "URL pública (Function URL): $FN_URL"
echo "Ejemplo: ${FN_URL}search?q=test"
echo "Health:   ${FN_URL}health"
