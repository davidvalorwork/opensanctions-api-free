#!/usr/bin/env node
/**
 * Harness de evaluación de la adjudicación.
 *
 * Las pruebas unitarias verifican la mecánica: que el grounding filtre, que el
 * orden por riesgo funcione, que no se llame al modelo sin candidatos. Nada de
 * eso mide si las decisiones son CORRECTAS. Esto sí.
 *
 * Por qué hace falta, más allá del sentido común: SR 26-2 y el Anexo IV de la
 * IN BCB 739/2026 esperan que el sistema se pruebe con regularidad. Sin un
 * conjunto etiquetado y una corrida reproducible no hay nada que enseñarle a un
 * auditor cuando pregunta cómo sabes que el sistema sigue funcionando.
 *
 * ADVERTENCIA: esto llama al modelo de verdad y cuesta dinero. El coste total se
 * reporta al final.
 *
 *   node eval/run.js                      # corre todo
 *   node eval/run.js --tag homonym        # solo una familia de casos
 *   node eval/run.js --model claude-sonnet-5
 */

const path = require('node:path');
const { cases } = require('./cases.json');
const { screenSubject } = require('../src/application/screeningService');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Severidad del error, ordenada por lo que cuesta en cumplimiento.
 *
 * Un falso negativo es una persona sancionada que pasó el filtro: es hallazgo de
 * examinador y sanción. Un falso positivo es tiempo de analista. No son
 * comparables, y una métrica de "accuracy" que los promedie esconde justamente
 * lo que hay que vigilar.
 */
const SEVERITY = {
  CRITICO: 'CRÍTICO',   // coincidencia real descartada
  GRAVE: 'GRAVE',       // coincidencia real degradada a dudosa
  RUIDO: 'ruido',       // no-coincidencia elevada: cuesta tiempo, no multas
  OK: 'ok',
};

function classify(expected, actual) {
  if (expected === actual) return SEVERITY.OK;
  if (expected === 'likely_match' && actual === 'unlikely_match') return SEVERITY.CRITICO;
  if (expected === 'likely_match' && actual === 'possible_match') return SEVERITY.GRAVE;
  if (expected === 'possible_match' && actual === 'unlikely_match') return SEVERITY.CRITICO;
  return SEVERITY.RUIDO;
}

/** Entidad con la forma que espera el pipeline, a partir del caso etiquetado. */
function toEntity(candidate) {
  return {
    schema: 'Person',
    datasets: ['eval'],
    sanctions_metadata: { is_sanctioned: true, programs: [], authorities: [] },
    relationships: [],
    ...candidate,
  };
}

/** Colección con un solo candidato: la segunda consulta (relaciones) va vacía. */
function singleCandidateCollection(candidate) {
  let call = 0;
  return {
    find() {
      const payload = call++ === 0 ? [toEntity(candidate)] : [];
      return { limit: () => ({ toArray: async () => payload }) };
    },
  };
}

async function runCase(testCase) {
  const collection = singleCandidateCollection(testCase.candidate);
  const out = await screenSubject(collection, testCase.subject);

  const verdict = out.verdicts[0];
  if (!verdict) {
    return {
      ...testCase,
      actual: null,
      severity: SEVERITY.CRITICO,
      note_result: 'el candidato desapareció del resultado',
      costUsd: out.usage?.estimated_cost_usd || 0,
    };
  }

  const severity = classify(testCase.expected, verdict.assessment);

  // Un error de ruta importa aparte del veredicto: si la regla descarta algo que
  // debía ver el modelo, el modelo nunca tuvo la oportunidad de acertar.
  const routeExpected = testCase.expected_decided_by;
  const routeError = routeExpected && routeExpected !== verdict.decided_by
    ? `esperaba decidir por ${routeExpected}, decidió por ${verdict.decided_by}`
    : null;

  return {
    ...testCase,
    actual: verdict.assessment,
    decided_by: verdict.decided_by,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    severity,
    routeError,
    costUsd: out.usage?.estimated_cost_usd || 0,
  };
}

function parseArgs(argv) {
  const tagIdx = argv.indexOf('--tag');
  const modelIdx = argv.indexOf('--model');
  return {
    tag: tagIdx !== -1 ? argv[tagIdx + 1] : null,
    model: modelIdx !== -1 ? argv[modelIdx + 1] : null,
  };
}

function report(results, model) {
  const bySeverity = (s) => results.filter((r) => r.severity === s);
  const criticos = bySeverity(SEVERITY.CRITICO);
  const graves = bySeverity(SEVERITY.GRAVE);
  const ruido = bySeverity(SEVERITY.RUIDO);
  const ok = bySeverity(SEVERITY.OK);
  const routeErrors = results.filter((r) => r.routeError);
  const total = results.length;
  const costTotal = results.reduce((sum, r) => sum + (r.costUsd || 0), 0);

  console.log(`\n${'='.repeat(72)}`);
  console.log(`EVALUACIÓN DE ADJUDICACIÓN — modelo: ${model}`);
  console.log(`${'='.repeat(72)}\n`);

  for (const r of results) {
    const mark = r.severity === SEVERITY.OK ? '·' : '✗';
    const route = r.decided_by ? ` [${r.decided_by}]` : '';
    console.log(`${mark} ${r.id.padEnd(16)} esperado ${String(r.expected).padEnd(15)} obtuvo ${String(r.actual).padEnd(15)}${route}`);
    if (r.severity !== SEVERITY.OK) {
      console.log(`  ${r.severity}: ${r.note}`);
      if (r.rationale) console.log(`  razón del modelo: ${r.rationale}`);
    }
    if (r.routeError) console.log(`  RUTA: ${r.routeError}`);
  }

  console.log(`\n${'-'.repeat(72)}`);
  console.log(`Correctos             ${ok.length}/${total}`);
  console.log(`CRÍTICOS              ${criticos.length}   coincidencia real descartada o degradada a descarte`);
  console.log(`GRAVES                ${graves.length}   coincidencia real degradada a dudosa`);
  console.log(`Ruido                 ${ruido.length}   falsos positivos: cuestan tiempo de analista`);
  console.log(`Errores de ruta       ${routeErrors.length}   la regla y el modelo no hicieron lo esperado`);
  console.log(`Coste total           $${costTotal.toFixed(4)}`);
  console.log(`Coste por caso        $${(costTotal / total).toFixed(4)}`);
  console.log(`${'-'.repeat(72)}\n`);

  const needsReview = results.filter((r) => r.needs_review).length;
  if (needsReview > 0) {
    console.log(`⚠  ${needsReview} de ${total} casos tienen etiqueta sin confirmar (needs_review: true).`);
    console.log('   Estos números no son verdad hasta que un humano revise esas etiquetas.\n');
  }

  // Los críticos son el único criterio de fallo: en AML el error caro es el que
  // deja pasar, no el que molesta al analista.
  return criticos.length === 0 && routeErrors.length === 0;
}

async function main() {
  const { tag, model } = parseArgs(process.argv);
  if (model) process.env.ANTHROPIC_MODEL = model;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY. Este harness llama al modelo de verdad.');
    process.exit(1);
  }

  const selected = tag ? cases.filter((c) => (c.tags || []).includes(tag)) : cases;
  if (selected.length === 0) {
    console.error(`Ningún caso con la etiqueta "${tag}".`);
    process.exit(1);
  }

  console.log(`Evaluando ${selected.length} casos...`);
  const results = [];
  for (const testCase of selected) {
    results.push(await runCase(testCase));
    process.stdout.write('.');
  }

  const passed = report(results, process.env.ANTHROPIC_MODEL || 'por defecto');
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFallo la evaluación:', err.message);
  process.exit(1);
});
