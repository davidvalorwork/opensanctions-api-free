# Open Sanctions – Migración MongoDB y API de búsqueda

Proyecto que migra los datos Open Sanctions (formato Follow the Money) desde archivos JSON en `datajson/` a MongoDB y expone una API sencilla en Node.js para búsquedas según la especificación indicada.

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
| GET    | `/health` | Estado del servicio y conexión a la base. |

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
curl -sS "http://localhost:45001/search?q=Behrouz"
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

## 6. Estructura del proyecto

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
├── src/
│   └── server.js                # Servidor Express y lógica de búsqueda
├── .env.example
├── package.json
└── README.md
```

---

## 7. Resumen de especificaciones

| Aspecto | Especificación |
|--------|-----------------|
| **Input de búsqueda** | String, longitud máxima flexible. |
| **Alcance** | Por data set, por objeto (entidad). |
| **Criterio de match** | En modo full: `properties` (vía `searchableText`) y `id`. En modo lite: `caption` y `id`. Hay coincidencia si el texto aparece en los campos consultados según el modo. |
| **Formato de respuesta** | Objeto con `id`, `OpenSancUrl`, `caption`, `datasets`, `schema`, `first_seen`, `last_change`, `properties`, `sanctions_metadata`, `relationships`. |
| **Origen de datos** | Archivos JSON (NDJSON) en `datajson/`. |
| **Persistencia** | MongoDB; migración vía `npm run migrate`. |
| **API** | Node.js + Express; GET/POST `/search`, GET `/health`. |
