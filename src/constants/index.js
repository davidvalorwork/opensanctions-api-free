/**
 * Constantes compartidas de la API (dominio, aplicación, infraestructura).
 */

require('dotenv').config();

// Nombre por defecto de la base de datos MongoDB
const DEFAULT_DB_NAME = process.env.MONGO_DB || 'opensanctions';

// Colecciones usadas en la aplicación
const COLLECTIONS = {
  ENTITIES: 'entities',
};

// Puerto HTTP por defecto
const DEFAULT_PORT = process.env.PORT || 3000;

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

module.exports = {
  DEFAULT_DB_NAME,
  COLLECTIONS,
  DEFAULT_PORT,
  RELATION_SCHEMAS,
};

