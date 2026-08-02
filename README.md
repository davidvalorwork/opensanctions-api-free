# OpenSanctions API — search + LLM alert adjudication

An AML sanctions screening API with an **LLM adjudication layer that leaves a written,
auditable reason for every decision**.

`GET /search` answers *what matches*. It does not answer the question that actually costs money
in compliance: **which of these matches is my customer?**

Searching "Juan Pérez" returns dozens of entities. Separating the sanctioned individual from the
namesake is manual analyst work, and it is the real bottleneck of an AML workflow. `POST /screen`
automates it — and, critically for audit, records *why* each call was made.

```json
{
  "entity_id": "NK-4mkA...",
  "assessment": "likely_match",
  "confidence": 0.96,
  "matched_on": ["name", "birth_date", "nationality"],
  "conflicts": [],
  "rationale": "Full name and date of birth 1962-11-23 match exactly; Venezuelan nationality is consistent.",
  "decided_by": "model"
}
```

## Five design decisions worth reading

**1. Deterministic filter before spending a token.** An incompatible date of birth is an integer
comparison, not an inference. Those candidates come back tagged `decided_by: "rule"` having cost
nothing. Tolerance is ±1 year — sources routinely disagree by transcription or timezone.

**2. Digest, not full entity.** The model receives name, aliases, dates, nationalities, positions
and programs — not the kilobytes of nested properties and relationships FtM returns.

**3. Grounding against hallucination.** Any verdict whose `entity_id` was not in the list sent to
the model is discarded. *In a compliance workflow you do not correct a hallucination — you throw
it out.*

**4. No silent truncation.** Above `MAX_CANDIDATES_PER_CALL`, the remainder is returned in
`not_reviewed`. A screening system that quietly drops candidates is worse than one that refuses
to answer.

**5. Every decision is persisted, not just returned.** The question an auditor asks is not *what
did it decide* but *why, and under which rules*. So the audit record stores the resolved
`model_version` — not the alias — a `prompt_hash` of the evaluation instructions, and the exact
candidate digests the model was shown. Without those three, you cannot tell whether January's
decision and June's were made under the same criteria.

If the audit write fails, the request fails. In compliance, a decision that wasn't recorded is a
decision that didn't happen: it can't be defended, reproduced, or examined.

Cost per alert is reported on every response — input tokens, cache reads, output tokens and
estimated USD — because at screening volume it is a business metric, not a footnote.

## Running it

```bash
npm install
npm run test:unit                # 35 tests, ~0.2s. No network, no API key, no Mongo.
docker compose up                # API on :5001
```

Tests inject a fake LLM through the service boundary, so the suite runs offline and
deterministically.

Without `ANTHROPIC_API_KEY`, `/screen` returns `501` and the rest of the API keeps working.

`/screen` is the only endpoint that costs money per call. Set `SCREEN_API_KEY` and it requires
an `x-api-key` header plus a per-key rate limit — leaving it open is a budget denial-of-service,
not an availability one.

**Stack:** Node.js · MongoDB · Docker · Jest · Anthropic API with prompt caching and JSON-schema
structured output. Hexagonal layout — `domain` / `application` / `infrastructure`.

**Full endpoint documentation:** [`POST /screen`](#adjudicación-de-alertas--post-screen)

> The detailed specification below is in Spanish: data model, search rules, migration script,
> deployment and test suite.

---

## 1. Estructura de los datos (Open Sanctions)

### 1.1 Niveles de organización

- **Nivel 1 – Data set**  
  Corresponde al programa de sanciones o conjunto de datos reunidos por un criterio específico.  
  Ejemplos:
  - *US OFAC Specially Designated Nationals (SDN) List* – lista de sancionados OFAC.
  - *Venezuela Members of the National Assembly* – miembros de la Asamblea Nacional de Venezuela.

- **Nivel 2 – Registro**  
  Dentro de un data set hay una cantidad variable de registros. Cada registro es una **Entidad** según el “Entity schemata” del formato **Follow the Money** (data model para investigaciones de crimen financiero y forense documental). Cada entidad se representa como un **objeto JSON**.

- **Nivel 3 – Schema**  
  Lo determina el par clave-valor `"schema": "Valor"` en el objeto JSON. La **clave** es `schema` y el **valor** puede ser, entre otros:

  `Address`, `Airplane`, `Analyzable`, `Article`, `Asset`, `Associate`, `Audio`, `BankAccount`, `Call`, `CallForTenders`, `CourtCaseParty`, `Company`, `Contract`, `ContractAward`, `CourtCase`, `CryptoWallet`, `EconomicActivity`, `Debt`, `Directorship`, `Pages`, `Documentation`, `Email`, `Employment`, `Event`, `Family`, `Document`, `Folder`, `Identification`, `Image`, `Interest`, `Interval`, `LegalEntity`, `License`, `Membership`, `Mention`, `Message`, `Note`, `Occupancy`, `Organization`, `UnknownLink`, `Ownership`, `Package`, `Page`, `Passport`, `Payment`, `Person`, `Position`, `Project`, `ProjectParticipant`, `PublicBody`, `RealEstate`, `Representation`, `Risk`, `Sanction`, `Security`, `Similar`, `Succession`, `Table`, `TaxRoll`, `PlainText`, `Thing`, `Trip`, `UserAccount`, `Value`, `Vehicle`, `Vessel`, `Video`, `HyperText`, `Workbook`.

  Cada tipo de schema define los posibles **nombres de propiedades** dentro de `properties`; los **valores** los aporta la fuente de datos.

### 1.2 Ejemplo de objeto JSON (entidad)

```json
{
  "id": "NK-5vaKAsud8hFMsyUSjZCv8r",
  "caption": "Behrouz Parsarad",
  "schema": "Person",
  "referents": ["usgsa-s4mrvy6zn", "ofac-53033", "ofac-pr-13fd6f9c46969163c7a2de3e9a8dd1d8d154cb2a"],
  "datasets": ["us_ofac_sdn"],
  "first_seen": "2025-03-04T16:17:34",
  "last_seen": "2025-11-18T18:10:01",
  "last_change": "2025-06-02T12:10:03",
  "properties": {
    "firstName": ["Behrouz", "بهروز"],
    "gender": ["male"],
    "email": ["lazyyytrader@gmail.com", "behrouz.p1985@gmail.com", "..."],
    "lastName": ["Parsarad", "پارسا", "..."],
    "nationality": ["ir"],
    "name": ["بهروز پارسا راد", "Behrouz Parsarad"],
    "birthDate": ["1988-07-02"],
    "phone": ["+989334445690", "..."],
    "sourceUrl": ["https://sanctionssearch.ofac.treas.gov/Details.aspx?id=53033"],
    "addressEntity": ["addr-8569058f35b3be17561e003582e3a15bbaba8aea"],
    "passportNumber": ["M56769976"],
    "address": ["No. 18, No. 8, Bahar, Shahid Bakhtiari St., Tohid Ave., Tehran"],
    "alias": ["Behrouz Parsa", "بهروز پارسا", "..."],
    "topics": ["sanction"],
    "country": ["ir"],
    "programId": ["US-NARCO"]
  },
  "target": true
}
```

---

## 2. Reglas de búsqueda (especificación)

- El **input** de búsqueda es un **string**, con el mayor límite de longitud que se desee soportar.
- Por cada **data set**, por cada **objeto** (entidad), el input se compara:
  - Modo **full**: con **cada valor** de cada par clave-valor del objeto anidado **`properties`** (vía el campo auxiliar `searchableText`).
  - Modo **lite**: con el campo **`caption`**.
  - En ambos modos: con el valor del propio campo **`id`** de la entidad (coincidencias parciales o exactas).
- Cuando hay **coincidencia** (según el modo: `searchableText`/`properties` en full o `caption` en lite, y además `id`), se toma del objeto los pares:
  - `id`
  - `caption`
  - `datasets`
  - `schema`
  - `first_seen`
  - `last_change`
  - Todos los pares clave-valor dentro de **`properties`**

y se arma un **objeto de respuesta base** con este formato:

```json
{
  "id": "",
  "caption": "",
  "datasets": ["", "", ...],
  "schema": "",
  "first_seen": "",
  "last_change": "",
  "properties": {
    "Clave_1": Valor_1,
    "Clave_2": Valor_2,
    "Clave_n": Valor_n
  }
}
```

### Ejemplo de respuesta de la API
La API implementa una versión extendida inspirada en el “Prompt Maestro v4.0”, añadiendo:

- Un campo de enlace directo a OpenSanctions: `OpenSancUrl`.
- Un bloque de metadatos de sanciones: `sanctions_metadata`.
- Un bloque de relaciones de primer nivel: `relationships` (grafo básico FtM).

Ejemplo de respuesta de la API para una entidad (campos ilustrativos):

```json
{
  "count": 1,
  "results": [
    {
      "id": "NK-5vaKAsud8hFMsyUSjZCv8r",
      "OpenSancUrl": "https://www.opensanctions.org/entities/NK-5vaKAsud8hFMsyUSjZCv8r/",
      "caption": "Behrouz Parsarad",
      "datasets": ["us_ofac_sdn"],
      "schema": "Person",
      "first_seen": "2025-03-04T16:17:34",
      "last_change": "2025-06-02T12:10:03",
      "properties": {
        "firstName": ["Behrouz", "بهروز"],
        "gender": ["male"],
        "email": ["lazyyytrader@gmail.com", "behrouz.p1985@gmail.com", "..."],
        "lastName": ["Parsarad", "پارسا", "..."],
        "nationality": ["ir"],
        "name": ["بهروز پارسا راد", "Behrouz Parsarad"],
        "birthDate": ["1988-07-02"],
        "phone": ["+989334445690", "..."],
        "sourceUrl": ["https://sanctionssearch.ofac.treas.gov/Details.aspx?id=53033"],
        "addressEntity": ["addr-8569058f35b3be17561e003582e3a15bbaba8aea"],
        "passportNumber": ["M56769976"],
        "address": ["No. 18, No. 8, Bahar, Shahid Bakhtiari St., Tohid Ave., Tehran"],
        "alias": ["Behrouz Parsa", "بهروز پارسا", "..."],
        "topics": ["sanction"],
        "country": ["ir"],
        "programId": ["US-NARCO"]
      },
      "sanctions_metadata": {
        "is_sanctioned": true,
        "programs": ["US-NARCO"],
        "authorities": [],
        "reasons": ["Entidad listada en dataset(s) de sanciones o con topic \"sanction\"."]
      },
      "relationships": []
    }
  ]
}
```

---

## 3. Script de migración

- **Ubicación:** `scripts/migrate.js`
- **Función:** Lee todos los archivos `.json` en la carpeta `datajson/` (formato NDJSON: una línea = un objeto JSON por entidad), y los inserta/actualiza en MongoDB.
- **Campo auxiliar:** Para cada documento se genera un campo `searchableText` que concatena todos los valores de `properties` (aplanados), para que la API pueda buscar por coincidencia de substring sobre un solo campo (en modo **full**).
- **Colección:** Por defecto `entities` en la base configurada en `MONGO_DB`.

### Cómo ejecutar la migración

1. Tener MongoDB en ejecución (local o remoto).
2. Opcional: copiar `.env.example` a `.env` y ajustar `MONGO_URI` y `MONGO_DB`.
3. Instalar dependencias y ejecutar:

```bash
npm install
npm run migrate
```

Variables de entorno usadas:

| Variable     | Descripción              | Por defecto              |
|-------------|--------------------------|---------------------------|
| `MONGO_URI` | URI de conexión MongoDB  | `mongodb://localhost:27017` |
| `MONGO_DB`  | Nombre de la base de datos | `opensanctions`          |

---

## 4. API (Node.js)

- **Servidor:** Express.
- **Búsqueda:** Compara el string de búsqueda:
  - En modo **full**: con los valores de `properties` (vía el campo `searchableText`).
  - En modo **lite**: con el campo `caption`.
  - En ambos modos: con el campo `id` de la entidad (coincidencias parciales o exactas).
  Si el input aparece en alguno de estos, la entidad se incluye en la respuesta con el formato extendido indicado arriba (`OpenSancUrl`, `sanctions_metadata`, `relationships`).

### Endpoints

| Método | Ruta      | Descripción |
|--------|-----------|-------------|
| GET    | `/search` | Búsqueda con query string `q` (o `query`). |
| POST   | `/search` | Búsqueda con cuerpo JSON `{ "q": "..." }` o `{ "query": "..." }`. |
| POST   | `/screen` | Adjudicación de alertas: busca **y decide** qué coincidencias son el sujeto. |
| GET    | `/health` | Estado del servicio, conexión a la base y disponibilidad de `/screen`. |

### Ejemplos de uso

**GET:**

```bash
curl "http://localhost:3000/search?q=Behrouz"
curl "http://localhost:3000/search?query=OFAC"
```

**POST:**

```bash
curl -X POST http://localhost:3000/search -H "Content-Type: application/json" -d "{\"q\": \"Parsarad\"}"
```

**Respuesta típica (ver ejemplo detallado más arriba en la sección 2):** la API devuelve `count` y un array `results` con cada entidad en el formato enriquecido (`OpenSancUrl`, `sanctions_metadata`, `relationships`).

### Adjudicación de alertas — `POST /screen`

`GET /search` responde *qué coincide*. No responde la pregunta que realmente cuesta dinero en cumplimiento: **cuáles de esas coincidencias son mi cliente**.

Buscar "Juan Pérez" devuelve decenas de entidades. Separar al sancionado del homónimo es trabajo manual de analista, y es el cuello de botella real de un flujo AML. `POST /screen` lo automatiza y —importante para auditoría— **deja por escrito el motivo de cada decisión**.

```bash
curl -X POST http://localhost:5001/screen \
  -H "Content-Type: application/json" \
  -d '{"name": "Nicolas Maduro", "birthDate": "1962-11-23", "nationality": "ve"}'
```

```json
{
  "counts": { "candidates": 12, "clearedByRule": 7, "reviewedByModel": 5, "notReviewed": 0 },
  "verdicts": [
    {
      "entity_id": "NK-4mkA...",
      "name": "Nicolás Maduro Moros",
      "assessment": "likely_match",
      "confidence": 0.96,
      "matched_on": ["name", "birth_date", "nationality"],
      "conflicts": [],
      "rationale": "Nombre completo y fecha de nacimiento 1962-11-23 coinciden exactamente; nacionalidad venezolana concuerda.",
      "decided_by": "model"
    },
    {
      "entity_id": "ve-an-0912",
      "name": "Nicolás Maduro Guerra",
      "assessment": "unlikely_match",
      "confidence": 1,
      "conflicts": ["birth_date"],
      "rationale": "Fecha de nacimiento incompatible: sujeto 1962, candidato 1990.",
      "decided_by": "rule"
    }
  ],
  "usage": {
    "model": "claude-opus-5",
    "input_tokens": 2145,
    "cache_read_input_tokens": 1792,
    "output_tokens": 412,
    "estimated_cost_usd": 0.011051
  }
}
```

**Cómo controla el coste** — el volumen en screening es alto, así que el coste por alerta es una métrica de negocio:

1. **Descarte determinista primero.** Una fecha de nacimiento incompatible se resuelve con una comparación de enteros. Esos candidatos salen marcados `decided_by: "rule"` sin gastar un token. La tolerancia es de ±1 año: las fuentes discrepan de forma rutinaria por transcripción o zona horaria.
2. **Digest, no entidad completa.** Al modelo van nombre, alias, fechas, nacionalidades, cargos y programas — no los KB de propiedades y relaciones anidadas que devuelve FtM.
3. **Caché de prompt.** El prompt de sistema es idéntico en cada llamada y va marcado como cacheable: una lectura de caché cuesta ~10% de un token de entrada.
4. **Tope explícito de candidatos.** Por encima de `MAX_CANDIDATES_PER_CALL` los sobrantes se devuelven en `not_reviewed` — nunca se truncan en silencio.

**Anclaje contra alucinación:** todo veredicto cuyo `entity_id` no esté en la lista enviada se descarta. En un flujo de cumplimiento no se corrige una alucinación, se tira.

**Configuración:**

| Variable | Por defecto | Nota |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Sin ella `/screen` responde `501` y el resto de la API sigue funcionando. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | |
| `ANTHROPIC_EFFORT` | `medium` | `low`–`max`. Palanca principal de coste/latencia. |

### Arranque de la API

```bash
npm install
npm start
```

Modo desarrollo (reinicio automático):

```bash
npm run dev
```

### Integración en otras aplicaciones

Puedes integrar esta API en cualquier aplicación que haga peticiones HTTP. Por ejemplo, en JavaScript:

```js
const res = await fetch('http://localhost:3000/search?q=Behrouz');
const data = await res.json();
console.log(data.results);
```

### Schemas de respuesta posibles

El campo `schema` de cada resultado indica el tipo de entidad Follow the Money que se ha encontrado. Los valores que puede devolver la API (según los datos de Open Sanctions) incluyen, entre otros:

`Address`, `Airplane`, `Analyzable`, `Article`, `Asset`, `Associate`, `Audio`, `BankAccount`, `Call`, `CallForTenders`, `CourtCaseParty`, `Company`, `Contract`, `ContractAward`, `CourtCase`, `CryptoWallet`, `EconomicActivity`, `Debt`, `Directorship`, `Pages`, `Documentation`, `Email`, `Employment`, `Event`, `Family`, `Document`, `Folder`, `Identification`, `Image`, `Interest`, `Interval`, `LegalEntity`, `License`, `Membership`, `Mention`, `Message`, `Note`, `Occupancy`, `Organization`, `UnknownLink`, `Ownership`, `Package`, `Page`, `Passport`, `Payment`, `Person`, `Position`, `Project`, `ProjectParticipant`, `PublicBody`, `RealEstate`, `Representation`, `Risk`, `Sanction`, `Security`, `Similar`, `Succession`, `Table`, `TaxRoll`, `PlainText`, `Thing`, `Trip`, `UserAccount`, `Value`, `Vehicle`, `Vessel`, `Video`, `HyperText`, `Workbook`.

Cada schema define un conjunto distinto de propiedades posibles dentro de `properties`. Para más detalle puedes consultar la documentación oficial de Follow the Money.

Variables de entorno:

| Variable     | Descripción           | Por defecto              |
|-------------|-----------------------|---------------------------|
| `MONGO_URI` | URI MongoDB           | `mongodb://localhost:27017` |
| `MONGO_DB`  | Base de datos         | `opensanctions`           |
| `PORT`      | Puerto HTTP           | `3000`                    |
| `OPENSANCTIONS_SEARCH_LITE` | Activa modo lite (solo `caption` y `id`) | `true` (en Docker) |
| `rapid_api` | Modo proveedor RapidAPI: CORS y `trust proxy` (ver abajo) | *(vacío / desactivado)* |
| `RAPIDAPI_PROXY_SECRET` | Opcional; si se define, valida la cabecera `X-RapidAPI-Proxy-Secret` en `/search` (no en `/health`) | *(vacío)* |

### RapidAPI (publicar la API en RapidAPI)

Si conectas esta API a RapidAPI como **API existente** (Listen / hosting propio), en el `.env` puedes poner:

```env
rapid_api=true
```

Con eso se activa:

- **`trust proxy`**: Express confía en la cadena de proxies de RapidAPI (útil para IP y despliegues detrás de su proxy).
- **CORS**: respuestas compatibles con orígenes que envíe el cliente (p. ej. consola de pruebas de RapidAPI), permitiendo cabeceras habituales (`X-RapidAPI-Key`, `X-RapidAPI-Host`, `X-RapidAPI-Proxy-Secret`, etc.).

Opcionalmente, en el panel de RapidAPI puedes definir un **Proxy Secret**. Si copias el mismo valor en:

```env
RAPIDAPI_PROXY_SECRET=el_mismo_valor_que_en_el_panel
```

el servidor comprobará que las peticiones a **`/search`** incluyan la cabecera `X-RapidAPI-Proxy-Secret` con ese valor (RapidAPI la inyecta al llamar a tu URL). **`GET /health` queda exento** para comprobaciones de disponibilidad sin esa cabecera.

Si **`rapid_api` no está definida**, es `false`, o no es uno de `1`, `true`, `yes`, `on`, la API funciona **igual que antes**: sin este CORS ni `trust proxy` adicionales.

Ejemplo al ejecutar el contenedor:

```bash
docker run -d -p 45001:80 \
  -e MONGO_URI=mongodb://host.docker.internal:27017 \
  -e rapid_api=true \
  -e RAPIDAPI_PROXY_SECRET=tu_secreto_del_panel \
  opensanctions-api
```

#### OpenAPI / Swagger para RapidAPI

En **`openapi/openapi.yaml`** hay una especificación **OpenAPI 3.0.3** (formato que RapidAPI acepta al importar) con esquemas, respuestas y **ejemplos** para `GET/POST /search` y `GET /health`.

1. En RapidAPI: crear o editar la API → **Import** → **OpenAPI** → sube o pega el contenido del YAML.
2. En `servers`, sustituye la variable `host` por el host de tu despliegue (sin `https://` duplicado: la URL del servidor ya lleva esquema en la plantilla).
3. **`/health`** declara `security: []` para monitorización sin `X-RapidAPI-Key`; el resto de operaciones documentan la cabecera **`X-RapidAPI-Key`** (RapidAPI la inyecta a los clientes del hub).

### Docker (producción)

La imagen escucha en el puerto **80** y **requiere** `MONGO_URI` en producción (no usa localhost dentro del contenedor).

**Construir imagen:**

```bash
docker build -t opensanctions-api .
```

**Ejecutar (Mongo en el host, puerto 27017):**

```bash
docker run -d -p 45001:80 \
  --add-host=host.docker.internal:host-gateway \
  -e MONGO_URI=mongodb://host.docker.internal:27017 \
  opensanctions-api
```

**Si MongoDB es otro contenedor en la misma red Docker:**

```bash
docker run -d -p 45001:80 --network mi-red \
  -e MONGO_URI=mongodb://mongo:27017 \
  opensanctions-api
```

Opcional: `-e MONGO_DB=analytikoDB3` si usas otra base.

### Probar la API desplegada con `curl`

Sustituye la URL base por la de tu entorno (host y puerto que hayas publicado). Con los `docker run` de arriba que usan `-p 45001:80`, la API queda en `http://localhost:45001` (el contenedor escucha en el puerto 80; desde fuera accedes por el mapeado).

**Búsqueda (GET):**

```bash
curl -sS "http://localhost:5001/search?q=Behrouz"
```

**Estado del servicio:**

```bash
curl -sS "http://localhost:45001/health"
```

**Búsqueda (POST):**

```bash
curl -sS -X POST "http://localhost:45001/search" \
  -H "Content-Type: application/json" \
  -d '{"q":"Behrouz"}'
```

En un servidor remoto, cambia `localhost:45001` por tu dominio o IP y el puerto expuesto (por ejemplo `https://api.ejemplo.com` si hay TLS y un proxy inverso).

---

## 5. Pruebas de búsqueda

El script `scripts/test-search.js` prueba la búsqueda contra la base de datos (o contra la API) con parámetros que puedes cambiar fácilmente, incluyendo ahora:

- Búsqueda por texto libre sobre `properties` y `id`.
- Un pequeño test específico de búsqueda directa por `id`.

### Cómo ejecutar

```bash
npm test
# o
node scripts/test-search.js
```

### Qué editar

Abre `scripts/test-search.js` y modifica el objeto **CONFIG** al inicio:

| Parámetro      | Descripción |
|----------------|-------------|
| `searchQuery`  | Texto a buscar (ej. `"Behrouz"`, `"Venezuela"`, `"OFAC"`, `"us_ofac_sdn"`, `"Q20015585"`). |
| `searchType`   | `'substring'` = aparece en cualquier parte (por defecto). `'exact'` = palabra completa. `'starts'` = empieza por el texto. |
| `limit`        | Cuántos resultados imprimir (`0` = todos). |
| `target`       | `'db'` = consulta MongoDB directo. `'api'` = llama al servidor HTTP (debe estar levantado). |
| `apiBaseUrl`   | Solo si `target === 'api'` (ej. `http://localhost:3000`). |

Además, al final de la ejecución se realiza un **test dedicado de búsqueda por id** (constante `TEST_ID` en el script) para comprobar rápidamente que una entidad concreta está presente en la base.

Ejemplos de búsquedas para probar con tu data: nombres (`Behrouz`, `Parsarad`), países (`ir`, `ve`), datasets (`us_ofac_sdn`, `ve_asamblea_nacional`), temas (`sanction`, `role.pep`), identificadores (`Q20015585`, `ve-asamblea-...`).

---

## 6. AWS (Lambda + DocumentDB, opcional)

En la carpeta **`lambda/`** hay un orquestador (`deploy.sh`) y scripts que, con **AWS CLI**, pueden crear un clúster **Amazon DocumentDB** (compatible con MongoDB), restaurar el último backup local y desplegar la API en **AWS Lambda** con **Function URL** pública. Resumen en **`lambda/README.md`**; guía amplia (scripts, VPC, RapidAPI, OpenAPI): **`docs/DESPLIEGUE-AWS-RAPIDAPI.md`**.

```bash
cp lambda/config.env.example lambda/config.env
# editar lambda/config.env
npm run lambda:deploy
```

---

## 7. Estructura del proyecto

```
opensanctions/
├── datajson/                    # Archivos NDJSON por data set
│   ├── entities.ftm.US OFAC.json
│   ├── entities.ftm.UK HMT - OFSI.json
│   ├── entities.ftm.SECO.json
│   ├── entities.ftm.Venezuela Members of the National Assembly.json
│   └── EU Financial Sanctions Files (FSF).json
├── scripts/
│   └── migrate.js               # Script de migración a MongoDB
├── lambda/                      # Despliegue AWS (DocumentDB, restore, Lambda + URL pública)
├── docs/
│   └── DESPLIEGUE-AWS-RAPIDAPI.md  # Guía AWS + RapidAPI
├── openapi/                     # OpenAPI 3.0 para importar en RapidAPI (Swagger)
├── src/
│   ├── server.js                # Entrada local (Express)
│   ├── httpApp.js               # App HTTP compartida (local + Lambda)
│   └── lambda-handler.js        # Entrada AWS Lambda
├── .env.example
├── package.json
└── README.md
```

---

## 8. Resumen de especificaciones

| Aspecto | Especificación |
|--------|-----------------|
| **Input de búsqueda** | String, longitud máxima flexible. |
| **Alcance** | Por data set, por objeto (entidad). |
| **Criterio de match** | En modo full: `properties` (vía `searchableText`) y `id`. En modo lite: `caption` y `id`. Hay coincidencia si el texto aparece en los campos consultados según el modo. |
| **Formato de respuesta** | Objeto con `id`, `OpenSancUrl`, `caption`, `datasets`, `schema`, `first_seen`, `last_change`, `properties`, `sanctions_metadata`, `relationships`. |
| **Origen de datos** | Archivos JSON (NDJSON) en `datajson/`. |
| **Persistencia** | MongoDB; migración vía `npm run migrate`. |
| **API** | Node.js + Express; GET/POST `/search`, GET `/health`. |
