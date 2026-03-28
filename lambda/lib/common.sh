#!/usr/bin/env bash
# Funciones y variables compartidas para los scripts de despliegue AWS.

set -euo pipefail

LAMBDA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$LAMBDA_ROOT/.." && pwd)"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Falta el comando '$1' en el PATH"
}

load_config() {
  if [[ -f "$LAMBDA_ROOT/config.env" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$LAMBDA_ROOT/config.env"
    set +a
  else
    die "Crea lambda/config.env a partir de lambda/config.env.example"
  fi

  : "${AWS_REGION:?Defina AWS_REGION en lambda/config.env}"
  : "${DOCDB_CLUSTER_ID:?}"
  : "${DOCDB_INSTANCE_ID:?}"
  : "${DOCDB_MASTER_USERNAME:?}"
  : "${DOCDB_MASTER_PASSWORD:?}"
  : "${DOCDB_INSTANCE_CLASS:?}"
  : "${DOCDB_SUBNET_GROUP_NAME:?}"
  : "${DOCDB_SECURITY_GROUP_NAME:?}"
  : "${LAMBDA_SECURITY_GROUP_NAME:?}"
  : "${MONGO_DB:?}"
  : "${LAMBDA_FUNCTION_NAME:?}"
  : "${LAMBDA_ROLE_NAME:?}"

  BACKUPS_DIR="${BACKUPS_DIR:-backups}"
  BACKUPS_ABS="$REPO_ROOT/$BACKUPS_DIR"
}

resolve_vpc_id() {
  if [[ -n "${VPC_ID:-}" ]]; then
    echo "$VPC_ID"
    return
  fi
  local id
  id=$(aws ec2 describe-vpcs \
    --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text \
    --region "$AWS_REGION" 2>/dev/null || true)
  [[ -n "$id" && "$id" != "None" ]] || die "No hay VPC por defecto; define VPC_ID en config.env"
  echo "$id"
}

# Dos subredes en AZ distintas (IDs separados por espacio)
pick_subnet_ids_for_docdb() {
  local vpc="$1"
  aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$vpc" \
    --query 'Subnets[].[SubnetId,AvailabilityZone]' --output text \
    --region "$AWS_REGION" \
    | awk '!seen[$2]++ { print $1 }' | head -2 | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

ensure_security_group() {
  local name="$1" description="$2" vpc="$3"
  local id
  id=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$name" "Name=vpc-id,Values=$vpc" \
    --query 'SecurityGroups[0].GroupId' --output text \
    --region "$AWS_REGION" 2>/dev/null || true)
  if [[ -z "$id" || "$id" == "None" ]]; then
    id=$(aws ec2 create-security-group \
      --group-name "$name" \
      --description "$description" \
      --vpc-id "$vpc" \
      --region "$AWS_REGION" \
      --query GroupId --output text)
    echo "Creado security group $name -> $id" >&2
  else
    echo "Security group $name ya existe: $id" >&2
  fi
  echo "$id"
}

account_id() {
  aws sts get-caller-identity --query Account --output text --region "$AWS_REGION"
}
