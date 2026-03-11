/**
 * Script de prueba de búsqueda contra la base de datos (o contra la API).
 * Edita los parámetros en CONFIG más abajo y ejecuta: npm test
 * o: node scripts/test-search.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

// ============== CONFIGURA AQUÍ TUS PRUEBAS ==============
const CONFIG = {
  // Texto a buscar (prueba con nombres, países, emails, etc.)
  searchQuery: 'Behrouz',

  // Tipo de búsqueda:
  // - 'substring' = el texto aparece en cualquier parte del valor (por defecto, case-insensitive)
  // - 'exact'    = el valor coincide exactamente (case-insensitive)
  // - 'starts'   = el valor empieza por el texto
  searchType: 'substring',

  // Cuántos resultados imprimir (0 = todos)
  limit: 5,

  // Probar contra: 'db' = MongoDB directo, 'api' = servidor HTTP (debe estar corriendo)
  target: 'db',

  // Solo si target === 'api': URL base (ej. http://localhost:3000)
  apiBaseUrl: 'http://localhost:3000',
};
// =======================================================

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'opensanctions';
const COLLECTION_NAME = 'entities';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function buildQuery(searchQuery, searchType) {
  const q = searchQuery.trim();
  if (!q) return null;

  const escaped = escapeRegex(q);
  if (searchType === 'exact') {
    // Palabra completa (el texto aparece como palabra, no como parte de otra)
    return new RegExp(`\\b${escaped}\\b`, 'i');
  }
  if (searchType === 'starts') {
    // El texto concatenado empieza por la búsqueda (o un valor empieza por ella)
    return new RegExp(`(^|\\s)${escaped}`, 'i');
  }
  // substring (default): el texto aparece en cualquier parte
  return new RegExp(escaped, 'i');
}

async function searchInDb() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const collection = client.db(MONGO_DB).collection(COLLECTION_NAME);
  const regex = buildQuery(CONFIG.searchQuery, CONFIG.searchType);
  if (!regex) {
    console.log('searchQuery está vacío. Edita CONFIG.searchQuery en el script.');
    await client.close();
    return;
  }

  const cursor = collection.find(
    { searchableText: regex },
    { projection: { searchableText: 0, _sourceFile: 0 } }
  );
  const docs = await cursor.toArray();
  await client.close();
  return docs.map(toResultFormat);
}

async function searchViaApi() {
  const url = `${CONFIG.apiBaseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(CONFIG.searchQuery)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.detail || res.statusText);
  return data.results || [];
}

function printInputs() {
  const inputs = {
    searchQuery: CONFIG.searchQuery,
    searchType: CONFIG.searchType,
    limit: CONFIG.limit,
    target: CONFIG.target,
    apiBaseUrl: CONFIG.apiBaseUrl,
  };
  console.log('\n======== ENTRADA (inputs) ========');
  console.log(JSON.stringify(inputs, null, 2));
  console.log('==================================\n');
}

function printOutput(results) {
  const limit = CONFIG.limit > 0 ? CONFIG.limit : results.length;
  const toShow = results.slice(0, limit);
  console.log('======== SALIDA (output) ========');
  console.log('count:', results.length);
  console.log('showing:', toShow.length);
  console.log('');
  console.log('results (JSON):');
  console.log(JSON.stringify(toShow, null, 2));
  console.log('=================================\n');
}

async function main() {
  printInputs();

  let results;
  try {
    if (CONFIG.target === 'api') {
      results = await searchViaApi();
    } else {
      results = await searchInDb();
    }

    printOutput(results);
  } catch (err) {
    console.error('Error:', err.message);
    if (CONFIG.target === 'api') {
      console.error('Asegúrate de que la API esté corriendo (npm start) y apiBaseUrl sea correcta.');
    } else {
      console.error('Asegúrate de que MongoDB esté corriendo y que hayas ejecutado npm run migrate.');
    }
    process.exit(1);
  }
}

main();
