/**
 * Modo proveedor RapidAPI: CORS, trust proxy y validación opcional del proxy secret.
 * Se activa con rapid_api=true (o 1/yes/on). Sin eso, el servidor no carga esta lógica.
 */

const cors = require('cors');

function isRapidApiEnabled() {
  const v = process.env.rapid_api ?? '';
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/** Cabecera que envía el proxy de RapidAPI si configuraste "Proxy Secret" en el portal. */
const PROXY_SECRET_HEADER = 'x-rapidapi-proxy-secret';

/**
 * Si RAPIDAPI_PROXY_SECRET está definido, exige que la cabecera coincida (salvo /health).
 */
function proxySecretMiddleware(req, res, next) {
  const expected = process.env.RAPIDAPI_PROXY_SECRET;
  if (!expected || String(expected).trim() === '') {
    return next();
  }
  if (req.path === '/health') {
    return next();
  }
  const sent = req.get(PROXY_SECRET_HEADER);
  if (sent !== expected) {
    return res.status(403).json({
      error: 'Acceso denegado',
      detail: 'Cabecera de proxy RapidAPI no válida o ausente',
    });
  }
  next();
}

/**
 * Aplica middleware necesario para exponer la API detrás de RapidAPI.
 * @param {import('express').Express} app
 */
function applyRapidApiMiddleware(app) {
  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-RapidAPI-Key',
        'X-RapidAPI-Host',
        'X-RapidAPI-User',
        'X-RapidAPI-Proxy-Secret',
      ],
    })
  );
  app.use(proxySecretMiddleware);
}

module.exports = {
  isRapidApiEnabled,
  applyRapidApiMiddleware,
};
