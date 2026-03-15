/**
 * Capa de infraestructura: conexión MongoDB.
 *
 * Expone funciones para conectar y obtener la base de datos desde el resto
 * de las capas (aplicación / adaptadores).
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const { DEFAULT_DB_NAME } = require('../constants');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';

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

