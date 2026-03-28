#!/usr/bin/env bash
# Crea DocumentDB (clúster + instancia) si no existen. Compatible con MongoDB (TLS).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

load_config
need_cmd aws

VPC_ID=$(resolve_vpc_id)
echo "VPC: $VPC_ID"

DOCDB_SG_ID=$(ensure_security_group "$DOCDB_SECURITY_GROUP_NAME" "DocumentDB OpenSanctions" "$VPC_ID")
LAMBDA_SG_ID=$(ensure_security_group "$LAMBDA_SECURITY_GROUP_NAME" "Lambda OpenSanctions" "$VPC_ID")

# DocumentDB acepta tráfico desde el SG de Lambda
aws ec2 authorize-security-group-ingress \
  --group-id "$DOCDB_SG_ID" \
  --protocol tcp \
  --port 27017 \
  --source-group "$LAMBDA_SG_ID" \
  --region "$AWS_REGION" 2>/dev/null \
  || echo "(Regla ingress docdb<-lambda ya existía o no aplicable)"

# Subnet group
if aws docdb describe-db-subnet-groups \
  --db-subnet-group-name "$DOCDB_SUBNET_GROUP_NAME" \
  --region "$AWS_REGION" &>/dev/null; then
  echo "Subnet group $DOCDB_SUBNET_GROUP_NAME ya existe."
  DOCDB_SUBNET_A=$(aws docdb describe-db-subnet-groups \
    --db-subnet-group-name "$DOCDB_SUBNET_GROUP_NAME" \
    --query 'DBSubnetGroups[0].Subnets[0].SubnetIdentifier' --output text \
    --region "$AWS_REGION")
  DOCDB_SUBNET_B=$(aws docdb describe-db-subnet-groups \
    --db-subnet-group-name "$DOCDB_SUBNET_GROUP_NAME" \
    --query 'DBSubnetGroups[0].Subnets[1].SubnetIdentifier' --output text \
    --region "$AWS_REGION")
else
  SUBNET_PAIR=$(pick_subnet_ids_for_docdb "$VPC_ID")
  read -r -a SUB_ARR <<< "$SUBNET_PAIR"
  [[ ${#SUB_ARR[@]} -ge 2 ]] || die "Se necesitan al menos 2 subredes en AZ distintas en la VPC $VPC_ID"
  DOCDB_SUBNET_A="${SUB_ARR[0]}"
  DOCDB_SUBNET_B="${SUB_ARR[1]}"
  aws docdb create-db-subnet-group \
    --db-subnet-group-name "$DOCDB_SUBNET_GROUP_NAME" \
    --db-subnet-group-description "OpenSanctions DocumentDB subnets" \
    --subnet-ids "$DOCDB_SUBNET_A" "$DOCDB_SUBNET_B" \
    --region "$AWS_REGION"
  echo "Subnet group $DOCDB_SUBNET_GROUP_NAME creado."
fi

# Clúster
if aws docdb describe-db-clusters \
  --db-cluster-identifier "$DOCDB_CLUSTER_ID" \
  --region "$AWS_REGION" &>/dev/null; then
  echo "Clúster DocumentDB '$DOCDB_CLUSTER_ID' ya existe; no se crea de nuevo."
else
  aws docdb create-db-cluster \
    --db-cluster-identifier "$DOCDB_CLUSTER_ID" \
    --engine docdb \
    --master-username "$DOCDB_MASTER_USERNAME" \
    --master-user-password "$DOCDB_MASTER_PASSWORD" \
    --vpc-security-group-ids "$DOCDB_SG_ID" \
    --db-subnet-group-name "$DOCDB_SUBNET_GROUP_NAME" \
    --backup-retention-period 1 \
    --storage-encrypted \
    --region "$AWS_REGION"
  echo "Clúster '$DOCDB_CLUSTER_ID' en creación..."
fi

# Instancia
if aws docdb describe-db-instances \
  --db-instance-identifier "$DOCDB_INSTANCE_ID" \
  --region "$AWS_REGION" &>/dev/null; then
  echo "Instancia '$DOCDB_INSTANCE_ID' ya existe; no se crea de nuevo."
else
  aws docdb create-db-instance \
    --db-instance-identifier "$DOCDB_INSTANCE_ID" \
    --db-cluster-identifier "$DOCDB_CLUSTER_ID" \
    --db-instance-class "$DOCDB_INSTANCE_CLASS" \
    --engine docdb \
    --region "$AWS_REGION"
  echo "Instancia '$DOCDB_INSTANCE_ID' en creación..."
fi

echo "Esperando a que la instancia DocumentDB esté disponible..."
aws docdb wait db-instance-available \
  --db-instance-identifier "$DOCDB_INSTANCE_ID" \
  --region "$AWS_REGION"

ENDPOINT=$(aws docdb describe-db-clusters \
  --db-cluster-identifier "$DOCDB_CLUSTER_ID" \
  --query 'DBClusters[0].Endpoint' --output text \
  --region "$AWS_REGION")

echo "DocumentDB listo. Endpoint (writer): $ENDPOINT"
echo "$ENDPOINT" >"$LAMBDA_ROOT/.last-docdb-endpoint"
umask 077
cat >"$LAMBDA_ROOT/.deploy-state" <<EOF
VPC_ID=$VPC_ID
DOCDB_SG_ID=$DOCDB_SG_ID
LAMBDA_SG_ID=$LAMBDA_SG_ID
DOCDB_ENDPOINT=$ENDPOINT
DOCDB_SUBNET_A=$DOCDB_SUBNET_A
DOCDB_SUBNET_B=$DOCDB_SUBNET_B
EOF
