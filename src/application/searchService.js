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

function isLiteSearchEnabled() {
  // Se activa para hacer la búsqueda más eficiente:
  // - full: busca en searchableText (aplanado de properties) y en id
  // - lite: busca solo en caption y en id
  const v = process.env.OPENSANCTIONS_SEARCH_LITE ?? process.env.SEARCH_LITE ?? '';
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/**
 * Búsqueda: por cada dataset, por cada objeto, se compara el input con cada valor
 * según el modo:
 * - Modo **full**: Coincidencia = el texto aparece (substring) en algún valor de `properties`
 *   (vía el campo auxiliar `searchableText`) o en el campo `id`.
 * - Modo **lite**: Coincidencia = el texto aparece en `caption` o en el campo `id`.
 */
async function runSearch(collection, q) {
  const regexFull = new RegExp(escapeRegex(q), 'i');
  // "LIKE" = contiene/subcadena (no anclado). Para caption, NO case sensitive.
  const regexCaptionLike = new RegExp(escapeRegex(q));
  // Para id mantenemos case-insensitive por compatibilidad (IDs suelen ser alfanuméricos).
  const regexIdLike = new RegExp(escapeRegex(q), 'i');

  const lite = isLiteSearchEnabled();
  const mongoQuery = lite
    ? {
        // Modo lite: evitamos searchableText (aplanado de properties) para ser más eficiente.
        $or: [{ caption: regexCaptionLike }, { id: { $regex: regexIdLike } }],
      }
    : {
        $or: [
          { searchableText: regexFull },
          // Incluir coincidencias por id (parcial o exacta) como pide la especificación
          { id: { $regex: regexIdLike } },
        ],
      };

  const cursor = collection.find(mongoQuery, { projection: { searchableText: 0, _sourceFile: 0 } });
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

