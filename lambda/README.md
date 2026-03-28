# Despliegue AWS (DocumentDB + Lambda)

Scripts en Bash que usan **AWS CLI** para:

1. **DocumentDB** (motor compatible con MongoDB): clúster e instancia si no existen, ~2 vCPU y recurso mínimo cercano a 2 GiB de RAM (AWS no ofrece exactamente 2 GiB en todas las clases; por defecto `db.t4g.medium`, 4 GiB).
2. **Restauración** del volcado más reciente en `backups/<MONGO_DB>-*` hacia la base lógica `opensanctions`.
3. **Lambda** con el código de esta API, **Function URL** pública (HTTPS) y comprobación de **CodeSha256**: si el zip local coincide con el desplegado, no vuelve a subir código (solo actualiza configuración/variables si aplica).

## Requisitos

- `aws` CLI (credenciales y región válidas).
- `mongorestore` ([MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools)).
- `node` (≥ 18), `npm`, `zip`, `openssl`, `curl`, `bash`.
- Al menos un backup local: `npm run backup` (desde una instancia que tenga los datos).

## Configuración

```bash
cp lambda/config.env.example lambda/config.env
# Edita lambda/config.env (contraseña maestra, región, etc.)
```

No subas `lambda/config.env` al repositorio (contiene secretos).

## Ejecutar todo desde la raíz del repo

```bash
npm run lambda:deploy
# o
bash lambda/deploy.sh
```

Pasos individuales:

```bash
bash lambda/scripts/01-documentdb.sh
bash lambda/scripts/02-restore.sh
bash lambda/scripts/03-lambda.sh
```

- `SKIP_RESTORE=1` en `config.env` omite `mongorestore` (solo infra + Lambda).
- Tras el paso 01 se generan `lambda/.deploy-state` y `lambda/.last-docdb-endpoint` (estado para los otros scripts).

## Restauración y red

El endpoint de DocumentDB suele ser **solo dentro de la VPC**. El paso 02 ejecuta `mongorestore` **en la máquina donde corras el script**; si no hay ruta de red al clúster (VPN, bastión, EC2 en la misma VPC, SSM port-forward, etc.), fallará por timeout. En ese caso, copia el backup a un host con acceso y ejecuta allí el `mongorestore` manualmente con TLS y el bundle RDS, o usa `SKIP_RESTORE=1` y restaura por tu cuenta.

## URL pública

El paso 03 imprime la **Lambda Function URL**. Ejemplos:

- `{URL}search?q=texto`
- `{URL}health`

La URL termina en `/`; las rutas son las mismas que en Express (`/search`, `/health`).

## Coste y seguridad

DocumentDB y NAT (si lo necesitas para otras cargas) generan coste en AWS. La Function URL con `auth-type NONE` es **pública**: restringe en producción (p. ej. API Gateway con autorización o `AWS_IAM` en Function URL).
