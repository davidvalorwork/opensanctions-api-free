/**
 * Registro de auditoría de adjudicaciones.
 *
 * El sistema ya producía la parte cara —una justificación escrita para que un
 * auditor la lea sin contexto— y la tiraba con la respuesta HTTP. Este módulo
 * guarda la parte barata.
 *
 * La pregunta que un auditor hace no es "¿qué decidió?" sino **"¿por qué, y con
 * qué reglas?"**. Para responderla hacen falta tres cosas que no están en el
 * veredicto:
 *
 *  - `model_version`: la respuesta del API trae el modelo resuelto, no el alias.
 *    Dos decisiones tomadas con `claude-opus-5` en meses distintos pueden venir
 *    de pesos distintos.
 *  - `prompt_hash`: si cambian las instrucciones de evaluación, cambian los
 *    criterios. Sin esto no se puede saber si la decisión de enero y la de junio
 *    se tomaron bajo las mismas reglas.
 *  - `candidates_sent`: qué se le puso delante al modelo. Un descarte correcto
 *    sobre datos incompletos sigue siendo un problema, y sin esto no se ve.
 *
 * **Por qué un fallo al escribir aborta la petición.** En cumplimiento, una
 * decisión que no quedó registrada es una decisión que no ocurrió: no se puede
 * defender, no se puede reproducir y no se puede auditar. Devolver el veredicto
 * igualmente daría al cliente algo que parece válido y no lo es. Mongo ya está
 * en la ruta crítica de la búsqueda, así que esto no añade un modo de fallo
 * nuevo.
 */

const crypto = require('node:crypto');

/** Identifica la versión de las instrucciones sin guardarlas enteras en cada fila. */
function hashPrompt(systemPrompt) {
  return crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16);
}

/**
 * Persiste una adjudicación completa.
 *
 * @param {import('mongodb').Collection} collection colección de auditoría
 * @param {object} record
 * @returns {Promise<string>} id del documento escrito
 */
async function recordAdjudication(collection, record) {
  const doc = {
    ...record,
    recorded_at: new Date(),
  };
  const { insertedId } = await collection.insertOne(doc);
  return String(insertedId);
}

/**
 * Índices del registro.
 *
 * `recorded_at` para el barrido temporal que hace cualquier revisión, y
 * `subject.name` porque la consulta real de un auditor es "enséñame todo lo que
 * se decidió sobre esta persona".
 */
async function ensureAuditIndexes(collection) {
  await collection.createIndex({ recorded_at: -1 });
  await collection.createIndex({ 'subject.name': 1, recorded_at: -1 });
  await collection.createIndex({ request_id: 1 });
}

module.exports = { recordAdjudication, ensureAuditIndexes, hashPrompt };
