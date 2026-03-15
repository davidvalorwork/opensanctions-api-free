/**
 * Script de prueba de búsqueda contra la base de datos (o contra la API).
 * Edita los parámetros en CONFIG más abajo y ejecuta: npm test
 * o: node scripts/test-search.js
 */

require('dotenv').config();
const { connectDb, getCollection } = require('../src/infrastructure/mongo');
const { searchEntities } = require('../src/application/searchService');
const { COLLECTIONS } = require('../src/constants');

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

const COLLECTION_NAME = COLLECTIONS.ENTITIES;
async function searchInDb() {
  const q = CONFIG.searchQuery.trim();
  if (!q) {
    console.log('searchQuery está vacío. Edita CONFIG.searchQuery en el script.');
    return;
  }

  await connectDb();
  const collection = getCollection(COLLECTION_NAME);
  const { results } = await searchEntities(collection, q);
  return results;
}

// Test específico: búsqueda directa por id exacto contra MongoDB.
// Útil para comprobar que los documentos están presentes y ver el formato de salida.
const TEST_ID = 'Q20015585';

async function testSearchById() {
  await connectDb();
  const collection = getCollection(COLLECTION_NAME);
  const { results } = await searchEntities(collection, TEST_ID);
  const doc = results[0];

  console.log('\n======== TEST BÚSQUEDA POR ID ========');
  console.log(`id: ${TEST_ID}`);
  if (!doc) {
    console.log('No se encontró ningún documento con ese id. Revisa que hayas ejecutado "npm run migrate".');
  } else {
    console.log('Documento encontrado (formato enriquecido por la API):');
    console.log(JSON.stringify(doc, null, 2));
  }
  console.log('======================================\n');
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

    // Además de la búsqueda principal, ejecutamos un test dedicado de búsqueda por id.
    // Puedes cambiar TEST_ID arriba si quieres probar otros identificadores.
    await testSearchById();
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
