/**
 * Capa de aplicación: caso de uso de búsqueda.
 *
 * - Construcción de la query (regex segura) sobre MongoDB.
 * - Ejecución de la búsqueda (con tope opcional de resultados vía env).
 * - Enriquecimiento de resultados vía la capa de dominio (formatEntity).
 */

const { formatEntity, indexRelationshipDocsByHolder } = require('../domain/searchFormatter');
const { RELATION_SCHEMAS } = require('../constants');

/** Máximo de entidades devueltas por búsqueda (evita cargar colecciones enteras en memoria). */
const SEARCH_MAX_RESULTS = (() => {
  const n = parseInt(process.env.SEARCH_MAX_RESULTS, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 200;
})();

/** Tope de documentos de relación traídos en la consulta por lotes. */
const SEARCH_REL_BATCH_LIMIT = (() => {
  const n = parseInt(process.env.SEARCH_REL_BATCH_LIMIT, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50_000) : 2000;
})();

/** Escapa caracteres especiales para usar el input en una regex segura. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escapa un único carácter para uso seguro dentro de una regex. */
function escapeRegexChar(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Construye un patrón de regex INSENSIBLE A ACENTOS para un token.
 * Cada letra base se reemplaza por una clase que cubre sus variantes acentuadas,
 * de modo que "Nicolas" matchee "Nicolás" y "Peru" matchee "Perú".
 */
const ACCENT_CLASSES = {
  a: '[aáàâäãåAÁÀÂÄÃÅ]',
  e: '[eéèêëEÉÈÊË]',
  i: '[iíìîïIÍÌÎÏ]',
  o: '[oóòôöõOÓÒÔÖÕ]',
  u: '[uúùûüUÚÙÛÜ]',
  n: '[nñNÑ]',
  c: '[cçCÇ]',
};
function accentInsensitivePattern(token) {
  // Quitamos los diacríticos del propio token para mapear sobre la letra base.
  const base = token.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of base) {
    const lower = ch.toLowerCase();
    out += ACCENT_CLASSES[lower] || escapeRegexChar(ch);
  }
  return out;
}

/**
 * Divide el texto de búsqueda en tokens (palabras) y devuelve una regex
 * insensible a acentos por cada token. Se descartan tokens vacíos.
 */
function buildTokenRegexes(q) {
  return String(q)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((tok) => new RegExp(accentInsensitivePattern(tok), 'i'));
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
  const tokens = buildTokenRegexes(q);
  if (tokens.length === 0) {
    return [];
  }

  const lite = isLiteSearchEnabled();

  // Para cada token, debe aparecer en alguno de los campos buscables. En modo
  // full incluimos `searchableText` (aplanado de properties); en lite usamos
  // `caption` para ser más eficiente. `id` siempre se incluye.
  const clauseFor = (rx) =>
    lite
      ? { $or: [{ caption: rx }, { id: { $regex: rx } }] }
      : {
          $or: [
            { searchableText: rx },
            { caption: rx },
            { id: { $regex: rx } },
          ],
        };

  // AND de todos los tokens → "Nicolas Maduro" matchea "Nicolás Ernesto Maduro
  // Guerra" aunque las palabras no sean contiguas ni lleven los mismos acentos.
  const mongoQuery =
    tokens.length === 1
      ? clauseFor(tokens[0])
      : { $and: tokens.map(clauseFor) };

  return collection
    .find(mongoQuery, { projection: { searchableText: 0, _sourceFile: 0 } })
    .limit(SEARCH_MAX_RESULTS)
    .toArray();
}

async function fetchRelationshipsForHolders(collection, holderIds) {
  if (holderIds.length === 0) {
    return new Map();
  }

  const relDocs = await collection
    .find(
      {
        schema: { $in: RELATION_SCHEMAS },
        'properties.holder': { $in: holderIds },
      },
      { projection: { searchableText: 0, _sourceFile: 0 } }
    )
    .limit(SEARCH_REL_BATCH_LIMIT)
    .toArray();

  return indexRelationshipDocsByHolder(relDocs);
}

/**
 * Caso de uso completo: ejecutar la búsqueda y devolver resultados formateados
 * en la estructura del Prompt Maestro v4.0.
 */
async function searchEntities(collection, queryText) {
  const docs = await runSearch(collection, queryText);
  const holderIds = [...new Set(docs.map((d) => d.id).filter(Boolean))];
  const relsByHolder = await fetchRelationshipsForHolders(collection, holderIds);

  const results = await Promise.all(
    docs.map((doc) => {
      const relDocs = doc.id ? relsByHolder.get(String(doc.id)) || [] : [];
      return formatEntity(doc, collection, relDocs);
    })
  );

  return {
    count: results.length,
    results,
  };
}

module.exports = {
  searchEntities,
  SEARCH_MAX_RESULTS,
};
