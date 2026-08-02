/**
 * Capa de aplicación: caso de uso de adjudicación de alertas de sanciones.
 *
 * El problema que resuelve no es buscar — eso ya lo hace `searchService`. Es el
 * paso siguiente: la búsqueda por nombre devuelve 40 coincidencias para "Juan
 * Pérez" y alguien tiene que decidir cuáles son realmente el cliente. Ese
 * descarte es el trabajo caro y manual del analista de cumplimiento, y es donde
 * un LLM aporta algo que una regex no puede: comparar alias, fechas parciales,
 * cargos y nacionalidades, y **escribir por qué**.
 *
 * La justificación escrita no es un adorno. Un descarte en screening AML tiene
 * que quedar auditable; un "no coincide" sin motivo no sirve ante el regulador.
 *
 * Orden deliberado del pipeline: buscar → reducir → descartar por regla →
 * preguntar al modelo. Cada paso barato va antes que el caro.
 */

const { searchEntities } = require('./searchService');
const { toDigest, screenDeterministically } = require('../domain/candidateDigest');
const { completeStructured } = require('../infrastructure/anthropic');
const { recordAdjudication, hashPrompt } = require('../infrastructure/screeningAudit');
const { MAX_CANDIDATES_PER_CALL } = require('../constants');

const SYSTEM_PROMPT = [
  'Eres analista de cumplimiento AML. Decides si un candidato de una lista de',
  'sanciones es la MISMA PERSONA O ENTIDAD que el sujeto revisado.',
  '',
  'Cómo evaluar:',
  '- Nombre y alias: transliteraciones, orden invertido, patronímicos y apellidos',
  '  compuestos son coincidencias frecuentes, no descartes.',
  '- Fecha de nacimiento: coincidencia fuerte. Las fechas parciales (solo año)',
  '  valen menos, no cero.',
  '- Nacionalidad: la discrepancia NO descarta por sí sola; la doble nacionalidad',
  '  es común en este perfil de persona.',
  '- Cargo y sector: úsalos para separar homónimos.',
  '',
  'Reglas de salida:',
  '- Un veredicto por candidato recibido, ni uno más.',
  '- entity_id debe copiarse EXACTAMENTE de la lista de candidatos.',
  '- matched_on y conflicts citan solo campos presentes en los datos.',
  '- Un nombre común que coincide sin ningún otro dato corroborante NO es',
  '  likely_match: es possible_match.',
  '- rationale: una o dos frases, en español, citando los campos concretos que',
  '  llevaron a la decisión. Escríbela para que un auditor la lea sin contexto.',
].join('\n');

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
          assessment: {
            type: 'string',
            enum: ['likely_match', 'possible_match', 'unlikely_match'],
          },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
          matched_on: { type: 'array', items: { type: 'string' } },
          conflicts: { type: 'array', items: { type: 'string' } },
        },
        required: ['entity_id', 'assessment', 'confidence', 'rationale', 'matched_on', 'conflicts'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

/** Orden de revisión: lo más arriesgado primero, que es como se trabaja una cola. */
const RISK_ORDER = { likely_match: 0, possible_match: 1, unlikely_match: 2 };

function byRisk(a, b) {
  const delta = RISK_ORDER[a.assessment] - RISK_ORDER[b.assessment];
  return delta !== 0 ? delta : (b.confidence || 0) - (a.confidence || 0);
}

function buildUserPrompt(subject, digests) {
  return [
    'SUJETO REVISADO:',
    JSON.stringify(subject, null, 2),
    '',
    `CANDIDATOS (${digests.length}):`,
    JSON.stringify(digests, null, 2),
    '',
    'Emite un veredicto por cada candidato.',
  ].join('\n');
}

/**
 * Guarda la adjudicación y devuelve la respuesta con su identificador.
 *
 * Se registra también cuando el modelo no intervino: un descarte por regla es
 * una decisión, y el auditor pregunta por todas, no solo por las caras.
 *
 * Si no hay colección de auditoría configurada, se devuelve tal cual — así el
 * proyecto sigue arrancando en local sin base de datos de auditoría, pero la
 * respuesta lleva `audit_id: null` en vez de aparentar que quedó registrada.
 */
async function persist(response, context, deps) {
  const { auditCollection, requestId } = deps;
  if (!auditCollection) {
    return { ...response, audit_id: null };
  }

  const record = deps.recordAudit || recordAdjudication;
  const auditId = await record(auditCollection, {
    request_id: requestId || null,
    subject: response.subject,
    candidates_sent: context.sent,
    verdicts: response.verdicts,
    not_reviewed: response.not_reviewed,
    counts: response.counts,
    model_version: response.usage?.model || null,
    prompt_hash: hashPrompt(SYSTEM_PROMPT),
    usage: response.usage,
  });

  return { ...response, audit_id: auditId };
}

/**
 * Adjudica los resultados de sanciones para un sujeto.
 *
 * @param {import('mongodb').Collection} collection colección de entidades
 * @param {{name: string, birthDate?: string, nationality?: string}} subject
 * @param {object} deps inyectable para tests (sin red)
 * @param {Function} [deps.complete] cliente del modelo
 * @param {import('mongodb').Collection} [deps.auditCollection] registro de decisiones
 * @param {string} [deps.requestId] correlación con el log HTTP
 */
async function screenSubject(collection, subject, deps = {}) {
  const complete = deps.complete || completeStructured;

  const { results } = await searchEntities(collection, subject.name);
  const digests = results.map(toDigest);

  const { toReview, cleared } = screenDeterministically(subject, digests);

  // Truncar en silencio sería mentir: quien lee la respuesta creería que se
  // revisó todo. Si sobran candidatos, se dicen cuántos y qué hacer.
  const sent = toReview.slice(0, MAX_CANDIDATES_PER_CALL);
  const notReviewed = toReview.slice(MAX_CANDIDATES_PER_CALL);

  // Sin nada que consultar no se llama al modelo: cero tokens, cero coste.
  if (sent.length === 0) {
    return persist(
      {
        subject,
        counts: { candidates: digests.length, clearedByRule: cleared.length, reviewedByModel: 0 },
        verdicts: cleared.sort(byRisk),
        not_reviewed: notReviewed.map((d) => ({ entity_id: d.entity_id, name: d.name })),
        usage: null,
      },
      { sent: [] },
      deps
    );
  }

  const { result, usage, model, costUsd } = await complete({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(subject, sent),
    schema: VERDICT_SCHEMA,
  });

  // Anclaje: un veredicto sobre un entity_id que no enviamos es una alucinación,
  // y en un flujo de cumplimiento se descarta, no se corrige.
  const sentIds = new Set(sent.map((d) => d.entity_id));
  const nameById = new Map(sent.map((d) => [d.entity_id, d.name]));

  const modelVerdicts = (result.verdicts || [])
    .filter((v) => sentIds.has(v.entity_id))
    .map((v) => ({ ...v, name: nameById.get(v.entity_id), decided_by: 'model' }));

  // Un salto en este contador significa que el modelo está inventando ids, y
  // eso es señal de degradación del prompt o del modelo, no ruido.
  const discarded = (result.verdicts || []).length - modelVerdicts.length;

  return persist(
    {
      subject,
      counts: {
        candidates: digests.length,
        clearedByRule: cleared.length,
        reviewedByModel: modelVerdicts.length,
        notReviewed: notReviewed.length,
        discardedUngrounded: discarded,
      },
      verdicts: [...cleared, ...modelVerdicts].sort(byRisk),
      not_reviewed: notReviewed.map((d) => ({ entity_id: d.entity_id, name: d.name })),
      usage: {
        model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        estimated_cost_usd: costUsd,
      },
    },
    { sent },
    deps
  );
}

module.exports = { screenSubject, SYSTEM_PROMPT, VERDICT_SCHEMA };
