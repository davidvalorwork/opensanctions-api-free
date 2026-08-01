/**
 * Adaptador de infraestructura: cliente Claude para adjudicación de alertas.
 *
 * Aísla el SDK del resto de la app igual que `mongo.js` aísla el driver. La capa
 * de aplicación pide un veredicto y recibe `{ result, usage }`; no sabe qué
 * modelo respondió ni cómo se fuerza el JSON.
 *
 * Decisiones que importan:
 * - Salida estructurada por `output_config.format`, no parseando texto libre.
 *   El API valida contra el schema antes de responder, así que no hay JSON roto.
 * - El system prompt va marcado como cacheable: es idéntico en cada llamada, y
 *   una lectura de caché cuesta ~10% de un token de entrada normal.
 * - El coste se calcula y se devuelve. En screening el volumen es alto y el
 *   coste por alerta es una métrica de negocio, no un detalle de implementación.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { DEFAULT_MODEL, DEFAULT_EFFORT, MODEL_PRICING_USD_PER_MTOK } = require('../constants');

let client = null;

/** El endpoint de screening se apaga solo si no hay credencial configurada. */
function isLlmEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!isLlmEnabled()) {
    throw new Error('ANTHROPIC_API_KEY no configurada');
  }
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

function getModel() {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

/**
 * Coste en USD de una respuesta.
 *
 * Las lecturas de caché se facturan a ~0.1x la entrada y las escrituras a 1.25x
 * (TTL de 5 minutos). Ignorar esos dos campos infla el coste estimado justo en
 * el caso que más nos interesa medir: muchas llamadas seguidas con el mismo
 * prompt de sistema.
 *
 * @returns {number|null} coste, o null si el modelo no está en la tabla.
 */
function estimateCostUsd(model, usage) {
  const price = MODEL_PRICING_USD_PER_MTOK[model];
  if (!price || !usage) return null;

  const fresh = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const output = usage.output_tokens || 0;

  const cost =
    (fresh * price.input +
      cacheRead * price.input * 0.1 +
      cacheWrite * price.input * 1.25 +
      output * price.output) /
    1_000_000;

  return Number(cost.toFixed(6));
}

/**
 * Una llamada a Claude con salida forzada a `schema`.
 *
 * @param {object} params
 * @param {string} params.system prompt estable (se cachea)
 * @param {string} params.user contenido variable de esta corrida
 * @param {object} params.schema JSON Schema de la respuesta
 * @returns {Promise<{result: object, usage: object, model: string, costUsd: number|null}>}
 */
async function completeStructured({ system, user, schema }) {
  const model = getModel();

  const response = await getClient().messages.create({
    model,
    // Con thinking activo por defecto en Opus 5, max_tokens acota razonamiento
    // + respuesta juntos. Un veredicto JSON es corto; el margen es para pensar.
    max_tokens: 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: {
      effort: process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT,
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('El modelo rechazó la solicitud de adjudicación');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Respuesta truncada por max_tokens; reduce el número de candidatos');
  }

  // `output_config.format` garantiza que el primer bloque de texto es JSON válido.
  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text) {
    throw new Error('El modelo no devolvió contenido de texto');
  }

  return {
    result: JSON.parse(text),
    usage: response.usage,
    model: response.model,
    costUsd: estimateCostUsd(response.model, response.usage),
  };
}

module.exports = { isLlmEnabled, completeStructured, estimateCostUsd, getModel };
