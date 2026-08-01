/**
 * Aplicación Express sin escuchar puerto: reutilizable en servidor local y Lambda.
 */

const express = require('express');
const { isRapidApiEnabled, applyRapidApiMiddleware } = require('./infrastructure/rapidApi');
const { searchEntities } = require('./application/searchService');
const { screenSubject } = require('./application/screeningService');
const { isLlmEnabled, getModel } = require('./infrastructure/anthropic');
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

  // Adjudicación: busca y además decide qué coincidencias son realmente el
  // sujeto, con justificación auditable. Ver application/screeningService.js.
  app.post('/screen', async (req, res) => {
    const name = (req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({
        error: 'Falta el nombre del sujeto',
        usage: 'POST /screen con body { "name": "...", "birthDate": "1962-11-23", "nationality": "ve" }',
      });
    }

    // Sin credencial el endpoint se apaga solo: el resto de la API sigue viva.
    if (!isLlmEnabled()) {
      return res.status(501).json({
        error: 'Adjudicación no disponible',
        detail: 'Configura ANTHROPIC_API_KEY para habilitar POST /screen. GET /search funciona sin ella.',
      });
    }

    const subject = {
      name,
      birthDate: req.body?.birthDate,
      nationality: req.body?.nationality,
    };

    try {
      const collection = getCollection(COLLECTION_NAME);
      res.json(await screenSubject(collection, subject));
    } catch (err) {
      console.error('Error en adjudicación:', err);
      res.status(500).json({ error: 'Error interno en la adjudicación', detail: err.message });
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
    res.json({
      status: 'ok',
      db: dbStatus,
      screening: isLlmEnabled() ? { enabled: true, model: getModel() } : { enabled: false },
    });
  });

  return app;
}

module.exports = { createApp };
