/**
 * Punto de entrada HTTP (adaptador web) para la API de búsqueda OpenSanctions.
 * Orquesta Express + caso de uso de búsqueda + acceso a MongoDB (estilo hexagonal).
 */

const express = require('express');
require('dotenv').config();

const { connectDb, getCollection } = require('./infrastructure/mongo');
const { searchEntities } = require('./application/searchService');
const { COLLECTIONS, DEFAULT_PORT } = require('./constants');

const app = express();
app.use(express.json());

const COLLECTION_NAME = COLLECTIONS.ENTITIES;
const PORT = DEFAULT_PORT;

app.get('/search', async (req, res) => {
  const q = (req.query.q ?? req.query.query ?? '').trim();
  if (!q) {
    return res.status(400).json({
      error: 'Falta el parámetro de búsqueda',
      usage: 'GET /search?q=<texto> o POST /search con body { "q": "<texto>" }',
    });
  }

  try {
    const collection = getCollection(COLLECTION_NAME);
    const result = await searchEntities(collection, q);
    res.json(result);
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
    const collection = getCollection(COLLECTION_NAME);
    const result = await searchEntities(collection, q);
    res.json(result);
  } catch (err) {
    console.error('Error en búsqueda:', err);
    res.status(500).json({ error: 'Error interno en la búsqueda', detail: err.message });
  }
});

app.get('/health', (req, res) => {
  let dbStatus = 'disconnected';
  try {
    getCollection(COLLECTION_NAME);
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }
  res.json({ status: 'ok', db: dbStatus });
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
