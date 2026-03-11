/**
 * API sencilla para búsqueda en datos Open Sanctions.
 * Compara el input con cada valor en properties de cada entidad y devuelve
 * los objetos en el formato especificado: id, caption, datasets, schema, first_seen, last_change, properties.
 */

const express = require('express');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'opensanctions';
const COLLECTION_NAME = 'entities';
const PORT = process.env.PORT || 3000;

let db = null;
let client = null;

async function connectDb() {
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
}

/**
 * Formatea una entidad al formato de respuesta requerido:
 * id, caption, datasets, schema, first_seen, last_change, properties
 */
function toResultFormat(doc) {
  return {
    id: doc.id,
    caption: doc.caption,
    datasets: doc.datasets || [],
    schema: doc.schema,
    first_seen: doc.first_seen,
    last_change: doc.last_change,
    properties: doc.properties || {},
  };
}

/** Escapa caracteres especiales para usar el input en una regex segura. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Búsqueda: por cada dataset, por cada objeto, se compara el input con cada valor
 * en properties. Coincidencia = el texto de búsqueda aparece (substring) en algún valor.
 * Se usa el campo searchableText (índice normal) con $regex para coincidencia parcial.
 */
async function runSearch(collection, q) {
  const regex = new RegExp(escapeRegex(q), 'i');
  const cursor = collection.find(
    { searchableText: regex },
    { projection: { searchableText: 0, _sourceFile: 0 } }
  );
  return cursor.toArray();
}

app.get('/search', async (req, res) => {
  const q = (req.query.q ?? req.query.query ?? '').trim();
  if (!q) {
    return res.status(400).json({
      error: 'Falta el parámetro de búsqueda',
      usage: 'GET /search?q=<texto> o POST /search con body { "q": "<texto>" }',
    });
  }

  try {
    const collection = db.collection(COLLECTION_NAME);
    const docs = await runSearch(collection, q);
    const results = docs.map(toResultFormat);
    res.json({ count: results.length, results });
  } catch (err) {
    console.error('Error en búsqueda:', err);
    res.status(500).json({ error: 'Error interno en la búsqueda', detail: err.message });
  }
});

app.post('/search', async (req, res) => {
  const q = (req.body?.q ?? req.body?.query ?? req.query?.q ?? '').trim();
  if (!q) {
    return res.status(400).json({
      error: 'Falta el parámetro de búsqueda',
      usage: 'POST /search con body { "q": "<texto>" } o GET /search?q=<texto>',
    });
  }

  try {
    const collection = db.collection(COLLECTION_NAME);
    const docs = await runSearch(collection, q);
    const results = docs.map(toResultFormat);
    res.json({ count: results.length, results });
  } catch (err) {
    console.error('Error en búsqueda:', err);
    res.status(500).json({ error: 'Error interno en la búsqueda', detail: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: db ? 'connected' : 'disconnected' });
});

async function main() {
  await connectDb();
  app.listen(PORT, () => {
    console.log(`API Open Sanctions escuchando en http://localhost:${PORT}`);
    console.log('  GET/POST /search?q=<texto>  - Búsqueda en entidades');
    console.log('  GET /health                 - Estado del servicio');
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
