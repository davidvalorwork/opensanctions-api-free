/**
 * Capa de infraestructura: conexión MongoDB.
 *
 * Expone funciones para conectar y obtener la base de datos desde el resto
 * de las capas (aplicación / adaptadores).
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const { DEFAULT_DB_NAME } = require('../constants');

// En producción MONGO_URI debe pasarse al contenedor (ej. -e MONGO_URI=mongodb://host.docker.internal:27017)
const MONGO_URI = (() => {
  const uri = process.env.MONGO_URI || (process.env.NODE_ENV === 'production' ? 'http://136.112.135.115/27017' : 'mongodb://localhost:27017');
  if (!uri && process.env.NODE_ENV === 'production') {
    throw new Error(
      'En producción defina MONGO_URI al ejecutar el contenedor (ej. -e MONGO_URI=mongodb://host.docker.internal:27017 o -e MONGO_URI=mongodb://mongo:27017)'
    );
  }
  return uri || 'mongodb://localhost:27017';
})();

let client = null;
let db = null;

async function connectDb() {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DEFAULT_DB_NAME);
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('La base de datos no está conectada. Llama a connectDb() primero.');
  }
  return db;
}

function getCollection(name) {
  return getDb().collection(name);
}

async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = {
  connectDb,
  getDb,
  getCollection,
  closeDb,
};

