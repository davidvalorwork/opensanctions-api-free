# Despliegue en AWS e integración con RapidAPI

Esta guía describe el flujo **DocumentDB → restauración de datos → Lambda con URL pública**, los scripts que lo automatizan con **AWS CLI**, y cómo enlazar el resultado con **RapidAPI** (OpenAPI, variables de entorno y buenas prácticas).

---

## 1. Arquitectura resumida

| Componente | Rol |
|------------|-----|
| **Amazon DocumentDB** | Base compatible con MongoDB; aloja la colección `entities` en la base lógica `opensanctions` (configurable con `MONGO_DB`). |
| **Lambda** | Ejecuta la misma API Express empaquetada (`/search`, `/health`), con conexión TLS a DocumentDB. |
| **Function URL** | HTTPS público hacia la función (sin API Gateway en el flujo por defecto). |
| **Scripts Bash** | Crean o reutilizan recursos; actualizan código de Lambda solo si el zip cambia (hash). |

La API de aplicación vive en `src/`; el punto de entrada en Lambda es `src/lambda-handler.js` (adaptador serverless).

---

## 2. Prerrequisitos

- Cuenta AWS con permisos para DocumentDB, EC2 (VPC, security groups, subredes), IAM y Lambda.
- **AWS CLI v2** configurado (`aws configure` o variables de entorno / rol).
- En la máquina desde la que ejecutas los scripts:
  - `bash`, `curl`, `zip`, `openssl`, **Node.js ≥ 18**, `npm`.
  - **MongoDB Database Tools** (`mongorestore`) para el paso de restauración.
- Un **backup** del proyecto en `backups/<MONGO_DB>-<fecha>/` (por ejemplo tras `npm run backup` contra una base que ya tenga datos migrados).

---

## 3. Configuración (`lambda/config.env`)

1. Copia la plantilla:

   ```bash
   cp lambda/config.env.example lambda/config.env
   ```

2. Edita `lambda/config.env`. Lo más importante:

   - **`AWS_REGION`**: región donde se crean los recursos.
   - **`DOCDB_MASTER_USERNAME` / `DOCDB_MASTER_PASSWORD`**: usuario maestro del clúster (restricciones de complejidad de AWS).
   - **`DOCDB_CLUSTER_ID`**, **`DOCDB_INSTANCE_ID`**, **`DOCDB_INSTANCE_CLASS`**: identificadores y tamaño de instancia (por defecto `db.t4g.medium`; DocumentDB no ofrece exactamente 2 GiB en todas las clases).
   - **`MONGO_DB`**: nombre de la base lógica Mongo (por defecto `opensanctions`), debe coincidir con lo que uses en la app y en el backup.
   - **`LAMBDA_FUNCTION_NAME`**, **`LAMBDA_ROLE_NAME`**: nombre de la función y del rol de ejecución.

3. **No subas `config.env` al repositorio** (está en `.gitignore`).

Variables opcionales útiles:

- **`VPC_ID`**: si no la pones, se usa la **VPC por defecto** de la región.
- **`SKIP_RESTORE=1`**: el orquestador salta `mongorestore` (solo infra + Lambda).
- **`LAMBDA_SUBNET_IDS`**: subredes para la Lambda, separadas por coma; si están vacías, se usan las mismas dos subredes del grupo de DocumentDB guardadas en el estado de despliegue.

---

## 4. Orquestador: `lambda/deploy.sh`

Ejecuta en orden los tres pasos descritos abajo. Desde la raíz del repo:

```bash
npm run lambda:deploy
# equivalente a:
bash lambda/deploy.sh
```

Si un paso falla, el script se detiene (`set -euo pipefail`).

---

## 5. Scripts individuales

### 5.1 `lambda/lib/common.sh`

No se ejecuta solo; lo **source-an** los otros scripts. Define:

- Rutas del repo (`LAMBDA_ROOT`, `REPO_ROOT`).
- **`load_config`**: carga `lambda/config.env` y valida variables obligatorias.
- **`resolve_vpc_id`**: VPC por defecto o `VPC_ID` explícita.
- **`pick_subnet_ids_for_docdb`**: elige dos subredes en **zonas de disponibilidad distintas**.
- **`ensure_security_group`**: crea el security group si no existe (mensajes por stderr, ID por stdout).
- **`account_id`**: ID de cuenta vía STS.

### 5.2 `lambda/scripts/01-documentdb.sh`

**Objetivo:** dejar DocumentDB operativo (clúster + instancia).

1. Resuelve VPC y crea o reutiliza dos security groups:
   - uno para DocumentDB,
   - otro para Lambda.
2. Regla de entrada: puerto **27017** en DocumentDB desde el security group de Lambda.
3. **Subnet group** de DocumentDB: lo crea si no existe (mismas dos subredes que luego se guardan para Lambda).
4. **Clúster** `DOCDB_CLUSTER_ID`: si no existe, `aws docdb create-db-cluster` (motor `docdb`, cifrado, retención de backup mínima).
5. **Instancia** `DOCDB_INSTANCE_ID`: si no existe, `aws docdb create-db-instance` con `DOCDB_INSTANCE_CLASS`.
6. Espera a que la instancia esté en estado **available**.
7. Escribe estado local:
   - `lambda/.last-docdb-endpoint` (endpoint writer),
   - **`lambda/.deploy-state`**: `VPC_ID`, IDs de security groups, endpoint, subredes `DOCDB_SUBNET_A/B` (necesarios para Lambda).

**Idempotencia:** si el clúster o la instancia ya existen, no intenta crearlos de nuevo.

### 5.3 `lambda/scripts/02-restore.sh`

**Objetivo:** volcar el backup más reciente sobre la base `MONGO_DB`.

1. Lee `lambda/.deploy-state` (debe existir tras el paso 01).
2. Descarga el bundle CA de RDS (`global-bundle.pem`) si hace falta.
3. Localiza el directorio más reciente `backups/<MONGO_DB>-*`.
4. Ejecuta **`mongorestore`** con TLS y parámetros típicos de DocumentDB (`replicaSet=rs0`, etc.).

**Importante:** el comando se lanza **en la máquina donde corres el script**. El endpoint de DocumentDB suele ser **solo alcanzable dentro de la VPC**. Si estás en tu PC sin túnel/VPN/bastión, el paso puede fallar por timeout. Opciones:

- Ejecutar el script (o solo `mongorestore`) desde una **EC2** en la misma VPC, o
- Usar **SSM port forwarding** / VPN, o
- Poner **`SKIP_RESTORE=1`** y restaurar manualmente desde un host con acceso.

### 5.4 `lambda/scripts/03-lambda.sh`

**Objetivo:** empaquetar la app, crear o actualizar la Lambda y exponer **Function URL**.

1. Lee `lambda/.deploy-state` y construye el **URI de conexión** a DocumentDB (usuario/contraseña codificados para URL).
2. Construye un directorio **`lambda/build/payload`**: copia `package.json`, `package-lock.json`, `src/`, certificado CA, e **`index.js`** que exporta el handler (`index.handler`).
3. `npm ci --omit=dev` y genera **`lambda/build/function.zip`**.
4. Calcula el **SHA-256 en base64** del zip y lo compara con **`CodeSha256`** de la función en AWS (si existe).
   - Si **coinciden**, **no** ejecuta `update-function-code` (código ya alineado).
   - Si no, `update-function-code` o `create-function` la primera vez.
5. **IAM:** rol `LAMBDA_ROLE_NAME` con políticas administradas `AWSLambdaVPCAccessExecutionRole` y `AWSLambdaBasicExecutionRole` (creado si no existe; espera breve tras la creación).
6. **`update-function-configuration`**: tiempo de ejecución, memoria, VPC (subredes + security group de Lambda), variables de entorno (`MONGO_URI`, `MONGO_DB`, `MONGO_TLS_CA_FILE=/var/task/certs/global-bundle.pem`, `NODE_ENV`, `OPENSANCTIONS_SEARCH_LITE`, etc.).
7. **Function URL** con `auth-type NONE` y CORS permisivo si aún no existía; imprime la URL final.

Ejemplos de uso una vez desplegado:

- `{FunctionURL}search?q=texto`
- `{FunctionURL}health`

---

## 6. Integración con RapidAPI

RapidAPI puede publicar tu API como **API existente** (tú hospedas el backend; RapidAPI actúa de proxy y facturación/descubrimiento).

### 6.1 Conectar el backend (Listen / API existente)

1. En el panel de RapidAPI, crea o configura la API apuntando a la **URL base** de tu **Lambda Function URL** (la que imprime el paso 03).  
   - La URL suele terminar en `/`; las rutas documentadas son `/search` y `/health`.
2. Asegúrate de que el **método y la ruta** que pruebas en RapidAPI coinciden con los de tu despliegue (GET/POST `/search`, GET `/health`).

### 6.2 Documentación OpenAPI (formato que aceptan)

En el repositorio está **`openapi/openapi.yaml`** (OpenAPI **3.0.3**), con esquemas y ejemplos pensados para importar en RapidAPI:

- En RapidAPI: **Import** → **OpenAPI** → sube o pega el YAML.
- Ajusta **`servers`** / host para que coincida con tu Function URL (solo el host, sin duplicar el esquema `https` si la plantilla ya lo incluye).
- La spec documenta **`X-RapidAPI-Key`** para consumidores del hub; **`/health`** va sin seguridad global en la spec para reflejar health checks.

### 6.3 Modo `rapid_api` en el servidor Node

Para que Express encaje bien detrás del proxy de RapidAPI (CORS, `trust proxy`, cabeceras), define en **`lambda/config.env`** (y vuelve a ejecutar el paso 03 o `npm run lambda:deploy`):

```env
rapid_api=true
```

Opcional: si en RapidAPI configuras un **Proxy Secret**, usa el mismo valor en:

```env
RAPIDAPI_PROXY_SECRET=<mismo valor que en el panel>
```

El script **`03-lambda.sh`** incluye estas variables en el JSON de entorno de la Lambda cuando están definidas. Con el proxy secret activo, las peticiones a **`/search`** deben llevar **`X-RapidAPI-Proxy-Secret`** (RapidAPI la inyecta). **`/health`** queda exenta en el código para monitorización.

### 6.4 Flujo recomendado end-to-end

1. Migrar datos localmente y generar backup: `npm run migrate`, `npm run backup`.
2. Configurar `lambda/config.env`.
3. `npm run lambda:deploy` (o pasos 01 → 02 → 03 por separado si depuras).
4. Copiar la **Function URL** y registrarla en RapidAPI como base URL del backend.
5. Importar **`openapi/openapi.yaml`** en RapidAPI para documentación y pruebas.
6. Añadir **`rapid_api=true`** (y **`RAPIDAPI_PROXY_SECRET`** si aplica) en `lambda/config.env` y redeplegar para actualizar la Lambda.

---

## 7. Seguridad y costes (recordatorio)

- **Function URL + `NONE` auth** implica que **cualquiera con la URL puede invocar** la función si la conocen. Valora API Gateway con autorización, WAF, o Function URL con `AWS_IAM` en escenarios serios.
- **DocumentDB** y recursos de red (NAT, etc., si los añades) tienen **coste continuo**.
- Rota **`DOCDB_MASTER_PASSWORD`** y restricciones IAM según el principio de mínimo privilegio.

---

## 8. Referencias en el repo

| Ruta | Contenido |
|------|-----------|
| `lambda/deploy.sh` | Orquestador |
| `lambda/scripts/01-documentdb.sh` | DocumentDB |
| `lambda/scripts/02-restore.sh` | Restauración |
| `lambda/scripts/03-lambda.sh` | Lambda + Function URL |
| `lambda/config.env.example` | Plantilla de variables |
| `openapi/openapi.yaml` | OpenAPI 3.0 para RapidAPI |
| `README.md` (raíz) | Secciones RapidAPI y AWS resumidas |

Si algo falla, revisa la salida de AWS CLI, los logs de la Lambda en **CloudWatch Logs** y la conectividad de red desde el cliente que ejecuta `mongorestore` hasta el endpoint de DocumentDB.
