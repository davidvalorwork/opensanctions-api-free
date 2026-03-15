/**
 * Capa de dominio: reglas de formato y enriquecimiento para entidades OpenSanctions.
 *
 * - Construcción de sanctions_metadata
 * - Descubrimiento de relaciones (relationships)
 * - Ensamblado del objeto de respuesta final para la API / Prompt Maestro.
 */

/**
 * Construye el bloque sanctions_metadata según las reglas del Prompt Maestro v4.0.
 */
function buildSanctionsMetadata(doc) {
  const datasets = doc.datasets || [];
  const props = doc.properties || {};
  const topics = Array.isArray(props.topics) ? props.topics : [];

  const lowerDatasets = datasets.map((d) => String(d).toLowerCase());
  const lowerTopics = topics.map((t) => String(t).toLowerCase());

  // Inferir programas, autoridades y razones desde distintas propiedades posibles
  const programs = [];
  ['program', 'programId', 'programs'].forEach((key) => {
    if (Array.isArray(props[key])) {
      props[key].forEach((v) => {
        if (v != null) programs.push(String(v));
      });
    }
  });

  const authorities = [];
  ['authority', 'authorities'].forEach((key) => {
    if (Array.isArray(props[key])) {
      props[key].forEach((v) => {
        if (v != null) authorities.push(String(v));
      });
    }
  });

  const reasons = [];
  ['reason', 'reasons'].forEach((key) => {
    if (Array.isArray(props[key])) {
      props[key].forEach((v) => {
        if (v != null) reasons.push(String(v));
      });
    }
  });

  const hasSanctionDataset = lowerDatasets.some((d) => d.includes('sanction'));
  const hasSanctionTopic = lowerTopics.includes('sanction');
  const isPep = lowerTopics.includes('role.pep');

  const is_sanctioned =
    hasSanctionDataset || hasSanctionTopic || programs.length > 0 || authorities.length > 0;

  if (!is_sanctioned && isPep && reasons.length === 0) {
    reasons.push(
      'Persona Expuesta Políticamente (PEP) sin sanción explícita; aparece en dataset de PEP.'
    );
  }

  return {
    is_sanctioned,
    programs: Array.from(new Set(programs)),
    authorities: Array.from(new Set(authorities)),
    reasons,
  };
}

/**
 * Relación de schemas que representan vínculos (edges) en el grafo FtM.
 * Aquí se listan los más comunes; se puede ampliar según necesidad.
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
 * Construye el array relationships para una entidad:
 * busca documentos de relación (RELATION_SCHEMAS) donde el id de la entidad
 * aparezca como holder (u otro campo que apunte a la entidad).
 *
 * Nota: en el dataset de ejemplo de la Asamblea Nacional de Venezuela,
 * las relaciones se modelan principalmente como schema "Occupancy"
 * con properties.holder = <id de la persona> y properties.post = <id del cargo>.
 */
async function buildRelationshipsForEntity(entity, collection) {
  const id = entity.id;
  if (!id) return [];

  const relDocs = await collection
    .find({
      schema: { $in: RELATION_SCHEMAS },
      'properties.holder': id,
    })
    .toArray();

  return relDocs.map((rel) => {
    const props = rel.properties || {};
    const status = Array.isArray(props.status) ? props.status[0] : undefined;
    const post = Array.isArray(props.post) ? props.post[0] : undefined;

    const descriptionParts = [];
    if (status) descriptionParts.push(`status=${status}`);
    if (post) descriptionParts.push(`post=${post}`);

    return {
      target_id: rel.id,
      target_name: rel.caption || rel.schema || 'Related entity',
      relationship_type: rel.schema || 'Relation',
      description: descriptionParts.join(', '),
    };
  });
}

/**
 * Ensambla una entidad en el formato de respuesta requerido por el Prompt Maestro v4.0:
 * id, OpenSancUrl, caption, datasets, schema, first_seen, last_change, properties,
 * sanctions_metadata, relationships.
 */
async function formatEntity(doc, collection) {
  const base = {
    id: doc.id,
    OpenSancUrl: doc.id
      ? `https://www.opensanctions.org/entities/${doc.id}/`
      : null,
    caption: doc.caption,
    datasets: doc.datasets || [],
    schema: doc.schema,
    first_seen: doc.first_seen,
    last_change: doc.last_change,
    properties: doc.properties || {},
  };

  const sanctions_metadata = buildSanctionsMetadata(doc);
  const relationships = await buildRelationshipsForEntity(doc, collection);

  return {
    ...base,
    sanctions_metadata,
    relationships,
  };
}

module.exports = {
  formatEntity,
  buildSanctionsMetadata,
};

