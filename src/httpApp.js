/**
 * Aplicación Express sin escuchar puerto: reutilizable en servidor local y Lambda.
 */

const crypto = require('node:crypto');
const express = require('express');
const { isRapidApiEnabled, applyRapidApiMiddleware } = require('./infrastructure/rapidApi');
const { searchEntities } = require('./application/searchService');
const { screenSubject } = require('./application/screeningService');
const { isLlmEnabled, getModel } = require('./infrastructure/anthropic');
const { screenGuard } = require('./infrastructure/screenGuard');
const { getCollection } = require('./infrastructure/mongo');
const { COLLECTIONS } = require('./constants');

const COLLECTION_NAME = COLLECTIONS.ENTITIES;

/**
 * Un fallo interno se registra completo y se responde vacío.
 *
 * `err.message` viene de Mongo o del SDK y puede llevar cadenas de conexión,
 * rutas o estructura de esquema. El cliente recibe un identificador; el detalle
 * vive en el log, que es donde se puede leer sin exponerlo.
 */
function serverError(res, req, scope, err) {
  console.error(JSON.stringify({
    level: 'error',
    scope,
    request_id: req.id,
    message: err.message,
    stack: err.stack,
  }));
  res.status(500).json({ error: `Error interno en ${scope}`, request_id: req.id });
}

function createApp() {
  const app = express();
  if (isRapidApiEnabled()) {
    applyRapidApiMiddleware(app);
  }
  app.use(express.json());

  // Identificador por petición: correlaciona la respuesta del cliente con el log
  // y, cuando exista el registro de auditoría, con la decisión almacenada.
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || crypto.randomUUID();
    res.set('x-request-id', req.id);
    next();
  });

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
      serverError(res, req, 'la búsqueda', err);
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
      serverError(res, req, 'la búsqueda', err);
    }
  });

  // Adjudicación: busca y además decide qué coincidencias son realmente el
  // sujeto, con justificación auditable. Ver application/screeningService.js.
  app.post('/screen', screenGuard, async (req, res) => {
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
      serverError(res, req, 'la adjudicación', err);
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
