/**
 * Punto de entrada HTTP (adaptador web) para la API de búsqueda OpenSanctions.
 * Orquesta Express + caso de uso de búsqueda + acceso a MongoDB (estilo hexagonal).
 */

require('dotenv').config();

const { connectDb } = require('./infrastructure/mongo');
const { isRapidApiEnabled } = require('./infrastructure/rapidApi');
const { createApp } = require('./httpApp');
const { DEFAULT_PORT } = require('./constants');

const PORT = DEFAULT_PORT;
const app = createApp();

// Reintenta el connect inicial: si Mongo tarda en estar disponible (cold start
// de Cloud Run, arranque de la VM Mongo, etc.) no matamos el contenedor al
// primer fallo. Solo abortamos tras agotar los reintentos.
async function connectWithRetry() {
  const maxRetries = Number(process.env.MONGO_CONNECT_RETRIES) || 5;
  const delayMs = Number(process.env.MONGO_CONNECT_RETRY_DELAY_MS) || 3000;
  for (let attempt = 1; ; attempt++) {
    try {
      await connectDb();
      return;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      console.warn(
        `Mongo connect intento ${attempt}/${maxRetries} falló (${err.message}); reintento en ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  await connectWithRetry();
  app.listen(PORT, () => {
    console.log(`API Open Sanctions escuchando en http://localhost:${PORT}`);
    if (isRapidApiEnabled()) {
      console.log('  Modo RapidAPI activo (rapid_api=true): CORS + trust proxy; opcional RAPIDAPI_PROXY_SECRET');
    }
    console.log('  GET/POST /search?q=<texto>  - Búsqueda en entidades');
    console.log('  GET /health                 - Estado del servicio');
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
