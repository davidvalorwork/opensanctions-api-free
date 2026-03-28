/**
 * Aplicación Express sin escuchar puerto: reutilizable en servidor local y Lambda.
 */

const express = require('express');
const { isRapidApiEnabled, applyRapidApiMiddleware } = require('./infrastructure/rapidApi');
const { searchEntities } = require('./application/searchService');
const { getCollection } = require('./infrastructure/mongo');
const { COLLECTIONS } = require('./constants');

const COLLECTION_NAME = COLLECTIONS.ENTITIES;

function createApp() {
  const app = express();
  if (isRapidApiEnabled()) {
    applyRapidApiMiddleware(app);
  }
  app.use(express.json());

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

  return app;
}

module.exports = { createApp };
