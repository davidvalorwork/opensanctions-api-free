/**
 * Tests de la capa de adjudicación. Sin red y sin Mongo: el LLM se inyecta como
 * doble y la colección es un stub. Lo que se verifica es la lógica que decide
 * qué se envía al modelo y qué se hace con lo que devuelve.
 */

const { toDigest, screenDeterministically, yearOf } = require('../src/domain/candidateDigest');
const { estimateCostUsd } = require('../src/infrastructure/anthropic');
const { screenSubject } = require('../src/application/screeningService');

/** Entidad tal como la devuelve formatEntity (FtM: propiedades en arrays). */
function entity(id, props = {}, caption = id) {
  return {
    id,
    caption,
    schema: 'Person',
    datasets: ['us_ofac_sdn'],
    properties: props,
    sanctions_metadata: { is_sanctioned: true, programs: ['SDGT'], authorities: ['OFAC'] },
    relationships: [],
  };
}

/**
 * Stub de colección: la primera consulta devuelve entidades, la segunda (las
 * relaciones) devuelve vacío, que es lo que hace searchEntities.
 */
function fakeCollection(docs) {
  let call = 0;
  return {
    find() {
      const payload = call++ === 0 ? docs : [];
      return { limit: () => ({ toArray: async () => payload }) };
    },
  };
}

describe('yearOf', () => {
  test('acepta las granularidades que trae FtM', () => {
    expect(yearOf('1962')).toBe(1962);
    expect(yearOf('1962-11')).toBe(1962);
    expect(yearOf('1962-11-23')).toBe(1962);
  });

  test('rechaza basura y años imposibles', () => {
    expect(yearOf('desconocido')).toBeNull();
    expect(yearOf('')).toBeNull();
    expect(yearOf(undefined)).toBeNull();
    expect(yearOf('0042')).toBeNull();
  });
});

describe('toDigest', () => {
  test('conserva los campos que deciden identidad y deduplica alias', () => {
    const digest = toDigest(
      entity(
        'ofac-123',
        {
          alias: ['Juan Perez', 'Juan Perez', 'J. Pérez'],
          birthDate: ['1962-11-23'],
          nationality: ['ve'],
          position: ['Ministro'],
          topics: ['sanction'],
          // Ruido que no debe llegar al prompt:
          address: ['Calle Falsa 123, Caracas'],
          notes: ['x'.repeat(5000)],
        },
        'Juan Pérez'
      )
    );

    expect(digest).toMatchObject({
      entity_id: 'ofac-123',
      name: 'Juan Pérez',
      birth_dates: ['1962-11-23'],
      nationalities: ['ve'],
      is_sanctioned: true,
    });
    expect(digest.aliases).toEqual(['Juan Perez', 'J. Pérez']);
    expect(JSON.stringify(digest)).not.toContain('Calle Falsa');
  });
});

describe('screenDeterministically', () => {
  const subject = { name: 'Juan Pérez', birthDate: '1962-11-23' };

  test('descarta al candidato cuyo año de nacimiento no es compatible', () => {
    const digests = [toDigest(entity('a', { birthDate: ['1985'] }))];
    const { toReview, cleared } = screenDeterministically(subject, digests);

    expect(toReview).toHaveLength(0);
    expect(cleared[0]).toMatchObject({
      entity_id: 'a',
      assessment: 'unlikely_match',
      decided_by: 'rule',
      conflicts: ['birth_date'],
    });
    expect(cleared[0].rationale).toMatch(/1985/);
  });

  test('tolera ±1 año: las fuentes discrepan por transcripción o zona horaria', () => {
    const digests = [toDigest(entity('a', { birthDate: ['1963'] }))];
    expect(screenDeterministically(subject, digests).toReview).toHaveLength(1);
  });

  test('sin fecha en el candidato no hay contradicción: decide el modelo', () => {
    const digests = [toDigest(entity('a', {}))];
    expect(screenDeterministically(subject, digests).toReview).toHaveLength(1);
  });

  test('sin fecha del sujeto no se descarta a nadie por regla', () => {
    const digests = [toDigest(entity('a', { birthDate: ['1985'] }))];
    const { toReview, cleared } = screenDeterministically({ name: 'Juan Pérez' }, digests);
    expect(toReview).toHaveLength(1);
    expect(cleared).toHaveLength(0);
  });

  test('una sola fecha compatible basta cuando el candidato declara varias', () => {
    const digests = [toDigest(entity('a', { birthDate: ['1985', '1962'] }))];
    expect(screenDeterministically(subject, digests).toReview).toHaveLength(1);
  });
});

describe('estimateCostUsd', () => {
  test('cobra las lecturas de caché a 0.1x y las escrituras a 1.25x', () => {
    // Opus 5: $5/MTok entrada, $25/MTok salida.
    const cost = estimateCostUsd('claude-opus-5', {
      input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // 5 + 0.5 + 6.25 + 25
    expect(cost).toBeCloseTo(36.75, 5);
  });

  test('devuelve null para un modelo sin tarifa en vez de inventar una', () => {
    expect(estimateCostUsd('modelo-inexistente', { input_tokens: 100 })).toBeNull();
  });
});

describe('screenSubject', () => {
  const subject = { name: 'Juan Pérez', birthDate: '1962-11-23' };

  test('descarta veredictos sobre entity_id que nunca se enviaron', async () => {
    const collection = fakeCollection([entity('real-1', { birthDate: ['1962'] })]);

    const complete = jest.fn().mockResolvedValue({
      result: {
        verdicts: [
          {
            entity_id: 'real-1',
            assessment: 'likely_match',
            confidence: 0.9,
            rationale: 'Nombre y año de nacimiento coinciden.',
            matched_on: ['name', 'birth_date'],
            conflicts: [],
          },
          {
            entity_id: 'inventado-999',
            assessment: 'likely_match',
            confidence: 0.95,
            rationale: 'Alucinación.',
            matched_on: ['name'],
            conflicts: [],
          },
        ],
      },
      usage: { input_tokens: 900, output_tokens: 120 },
      model: 'claude-opus-5',
      costUsd: 0.0075,
    });

    const out = await screenSubject(collection, subject, { complete });

    expect(out.verdicts).toHaveLength(1);
    expect(out.verdicts[0].entity_id).toBe('real-1');
    expect(out.verdicts[0].decided_by).toBe('model');
    expect(out.usage.estimated_cost_usd).toBe(0.0075);
  });

  test('no llama al modelo si las reglas ya descartaron todo', async () => {
    const collection = fakeCollection([entity('a', { birthDate: ['1985'] })]);
    const complete = jest.fn();

    const out = await screenSubject(collection, subject, { complete });

    expect(complete).not.toHaveBeenCalled();
    expect(out.usage).toBeNull();
    expect(out.counts).toMatchObject({ candidates: 1, clearedByRule: 1, reviewedByModel: 0 });
  });

  test('ordena por riesgo: lo que hay que mirar primero va primero', async () => {
    const collection = fakeCollection([
      entity('a', { birthDate: ['1962'] }),
      entity('b', { birthDate: ['1962'] }),
    ]);

    const complete = jest.fn().mockResolvedValue({
      result: {
        verdicts: [
          { entity_id: 'a', assessment: 'unlikely_match', confidence: 0.8, rationale: '.', matched_on: [], conflicts: [] },
          { entity_id: 'b', assessment: 'likely_match', confidence: 0.9, rationale: '.', matched_on: ['name'], conflicts: [] },
        ],
      },
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'claude-opus-5',
      costUsd: 0.001,
    });

    const out = await screenSubject(collection, subject, { complete });
    expect(out.verdicts.map((v) => v.entity_id)).toEqual(['b', 'a']);
  });
});
