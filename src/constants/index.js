/**
 * Constantes compartidas de la API (dominio, aplicación, infraestructura).
 */

require('dotenv').config();

// Nombre por defecto de la base de datos MongoDB
const DEFAULT_DB_NAME = process.env.MONGO_DB || 'opensanctions';

// Colecciones usadas en la aplicación
const COLLECTIONS = {
  ENTITIES: 'entities',
  // Registro inmutable de adjudicaciones. Separado de `entities` porque tiene
  // otro ciclo de vida: las entidades se reemplazan en cada carga de listas, y
  // el registro de decisiones no se toca nunca.
  SCREENING_AUDIT: 'screening_audit',
};

// Puerto HTTP por defecto
const DEFAULT_PORT = process.env.PORT || 5001;

/**
 * Schemas que representan vínculos (edges) en el grafo FtM.
 * Usados para construir el bloque `relationships`.
 */
const RELATION_SCHEMAS = [
  'Occupancy',
  'Family',
  'Ownership',
  'Directorship',
  'Membership',
  'Associate',
  'Employment',
  'Position',
  'Sanction',
];

/**
 * Configuración de la capa de adjudicación con LLM (endpoint /screen).
 */

// Modelo por defecto. Override con ANTHROPIC_MODEL.
const DEFAULT_MODEL = 'claude-opus-5';

// Profundidad de razonamiento: low | medium | high | xhigh | max.
// `medium` rinde muy bien en triaje y es la palanca principal de coste/latencia.
const DEFAULT_EFFORT = 'medium';

// Tope de candidatos enviados al modelo en una sola llamada. Por encima de esto
// la respuesta se degrada y el prompt se encarece sin ganar precisión; los
// descartados se reportan explícitamente en la respuesta, nunca en silencio.
const MAX_CANDIDATES_PER_CALL = 25;

// Precio público por millón de tokens (USD). Solo para estimar coste en la
// respuesta; si un modelo no está aquí, el coste sale como null en vez de mentir.
const MODEL_PRICING_USD_PER_MTOK = {
  'claude-opus-5': { input: 5.0, output: 25.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

module.exports = {
  DEFAULT_DB_NAME,
  COLLECTIONS,
  DEFAULT_PORT,
  RELATION_SCHEMAS,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  MAX_CANDIDATES_PER_CALL,
  MODEL_PRICING_USD_PER_MTOK,
};

