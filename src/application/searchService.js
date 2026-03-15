/**
 * Capa de aplicación: caso de uso de búsqueda.
 *
 * - Construcción de la query (regex segura) sobre MongoDB.
 * - Ejecución de la búsqueda.
 * - Enriquecimiento de resultados vía la capa de dominio (formatEntity).
 */

const { formatEntity } = require('../domain/searchFormatter');

/** Escapa caracteres especiales para usar el input en una regex segura. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Búsqueda: por cada dataset, por cada objeto, se compara el input con cada valor
 * en properties. Coincidencia = el texto de búsqueda aparece (substring) en algún valor.
 * Se usa el campo searchableText (índice normal) con $regex para coincidencia parcial
 * y también se compara contra el campo id.
 */
async function runSearch(collection, q) {
  const regex = new RegExp(escapeRegex(q), 'i');
  const cursor = collection.find(
    {
      $or: [
        { searchableText: regex },
        // Incluir coincidencias por id (parcial o exacta) como pide la especificación
        { id: { $regex: regex } },
      ],
    },
    { projection: { searchableText: 0, _sourceFile: 0 } }
  );
  return cursor.toArray();
}

/**
 * Caso de uso completo: ejecutar la búsqueda y devolver resultados formateados
 * en la estructura del Prompt Maestro v4.0.
 */
async function searchEntities(collection, queryText) {
  const docs = await runSearch(collection, queryText);
  const results = await Promise.all(docs.map((doc) => formatEntity(doc, collection)));
  return {
    count: results.length,
    results,
  };
}

module.exports = {
  searchEntities,
};

