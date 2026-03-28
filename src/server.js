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

async function main() {
  await connectDb();
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
