/**
 * Capa de dominio: reducción de entidades FtM a "digests" y descarte determinista.
 *
 * Dos responsabilidades, ambas puras (sin Mongo, sin red, testeables solas):
 *
 * 1. `toDigest`: una entidad OpenSanctions completa pesa varios KB (properties
 *    anidadas, relaciones, metadatos de sanción). Mandarla entera al LLM es caro
 *    y además empeora la señal: el modelo se pierde entre campos irrelevantes.
 *    El digest deja solo lo que un analista mira para decidir identidad.
 *
 * 2. `screenDeterministically`: lo que se puede resolver con una comparación de
 *    fechas no necesita un LLM. Descartar aquí es gratis y baja el coste real
 *    de la corrida, no solo el número de candidatos.
 */

/** Devuelve `properties[key]` siempre como array (FtM guarda todo en arrays). */
function propList(entity, key) {
  const value = entity?.properties?.[key];
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Primeros `limit` valores únicos, recortados. Evita digests desbalanceados. */
function take(values, limit) {
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].slice(0, limit);
}

/**
 * Extrae el año de una fecha FtM. El dataset mezcla granularidades:
 * "1962", "1962-11", "1962-11-23" son todos válidos y conviven en el mismo campo.
 * Solo el año es comparable de forma fiable entre fuentes.
 *
 * @returns {number|null} año, o null si no hay uno legible.
 */
function yearOf(dateString) {
  const match = /^(\d{4})/.exec(String(dateString ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1800 && year <= 2200 ? year : null;
}

/**
 * Reduce una entidad formateada a los campos que deciden identidad.
 * Los topics y programas se conservan porque explican *por qué* está sancionada,
 * que es la mitad de la respuesta que necesita el analista.
 */
function toDigest(entity) {
  const meta = entity.sanctions_metadata || {};
  return {
    entity_id: entity.id,
    name: entity.caption || null,
    schema: entity.schema || null,
    aliases: take([...propList(entity, 'alias'), ...propList(entity, 'weakAlias')], 8),
    birth_dates: take(propList(entity, 'birthDate'), 4),
    nationalities: take([...propList(entity, 'nationality'), ...propList(entity, 'country')], 6),
    positions: take(propList(entity, 'position'), 4),
    topics: take(propList(entity, 'topics'), 6),
    is_sanctioned: Boolean(meta.is_sanctioned),
    programs: take(meta.programs || [], 4),
    authorities: take(meta.authorities || [], 4),
    datasets: take(entity.datasets || [], 4),
  };
}

/**
 * Descarte determinista por fecha de nacimiento.
 *
 * Regla: si conocemos el año del sujeto y el candidato **solo** declara años que
 * difieren en más de uno, no es la misma persona. La tolerancia de ±1 año es
 * deliberada — las listas de sanciones y los sistemas bancarios discrepan de
 * forma rutinaria por zona horaria, calendario local o error de transcripción.
 *
 * Deliberadamente NO se descarta por nacionalidad: la doble nacionalidad es
 * común justo en el perfil de persona que aparece en estas listas, así que esa
 * comparación es un indicio para el LLM, no un veredicto.
 *
 * @param {{birthDate?: string}} subject datos conocidos del cliente
 * @param {Array} digests candidatos ya reducidos
 * @returns {{toReview: Array, cleared: Array}}
 */
function screenDeterministically(subject, digests) {
  const subjectYear = yearOf(subject?.birthDate);
  if (subjectYear == null) {
    return { toReview: digests, cleared: [] };
  }

  const toReview = [];
  const cleared = [];

  for (const digest of digests) {
    const years = digest.birth_dates.map(yearOf).filter((y) => y != null);
    // Sin fecha declarada no hay contradicción posible: lo decide el LLM.
    if (years.length === 0) {
      toReview.push(digest);
      continue;
    }
    if (years.some((year) => Math.abs(year - subjectYear) <= 1)) {
      toReview.push(digest);
    } else {
      cleared.push({
        entity_id: digest.entity_id,
        name: digest.name,
        assessment: 'unlikely_match',
        confidence: 1,
        rationale: `Fecha de nacimiento incompatible: sujeto ${subjectYear}, candidato ${years.join('/')}.`,
        matched_on: [],
        conflicts: ['birth_date'],
        decided_by: 'rule',
      });
    }
  }

  return { toReview, cleared };
}

module.exports = { toDigest, screenDeterministically, yearOf };
