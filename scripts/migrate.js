/**
 * Script de migración: lee los archivos NDJSON en datajson/ y los inserta en MongoDB.
 * Cada entidad se guarda con un campo searchableText (todos los valores de properties
 * aplanados) para permitir búsqueda por coincidencia en la API.
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATAJSON_DIR = path.join(__dirname, '..', 'datajson');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'opensanctions';
const COLLECTION_NAME = 'entities';

/**
 * Extrae todos los valores del objeto properties (arrays o escalares) y los
 * concatena en un solo string para indexación de búsqueda.
 */
function buildSearchableText(properties) {
  if (!properties || typeof properties !== 'object') return '';
  const parts = [];
  for (const key of Object.keys(properties)) {
    const val = properties[key];
    if (Array.isArray(val)) {
      val.forEach((v) => {
        if (v != null && String(v).trim()) parts.push(String(v).trim());
      });
    } else if (val != null && String(val).trim()) {
      parts.push(String(val).trim());
    }
  }
  return parts.join(' ');
}

async function migrate() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const jsonFiles = fs.readdirSync(DATAJSON_DIR).filter((f) => f.endsWith('.json'));
    if (jsonFiles.length === 0) {
      console.log('No se encontraron archivos .json en', DATAJSON_DIR);
      process.exit(1);
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const file of jsonFiles) {
      const filePath = path.join(DATAJSON_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');
      let entities = [];

      // Formato 1: archivo es un array JSON [ {...}, {...} ]
      const trimmed = content.trim();
      if (trimmed.startsWith('[')) {
        try {
          let toParse = content;
          // Algunos archivos tienen un objeto por línea pero sin coma entre ellos: }\n{
          if (!/\}\s*,\s*\{/.test(content) && /\}\s*\n\s*\{/.test(content)) {
            toParse = content.replace(/\}\s*\n\s*\{/g, '},\n{');
          }
          const arr = JSON.parse(toParse);
          if (Array.isArray(arr)) {
            entities = arr;
            console.log(`  ${file}: detectado array JSON con ${entities.length} elementos`);
          }
        } catch (err) {
          console.error(`  ${file}: no se pudo parsear como array JSON (${err.message}), intentando NDJSON...`);
        }
      }

      // Formato 2: NDJSON (una línea = un objeto) o fallback si el array falló
      if (entities.length === 0) {
        const lines = content.split(/\r?\n/).filter((line) => line.trim());
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i].trim();
          if (line === '[' || line === ']') continue;
          if (line.endsWith(',')) line = line.slice(0, -1);
          if (line.endsWith(']')) line = line.slice(0, -1);
          // Una línea puede tener varios objetos concatenados (ej. }{ sin coma)
          while (line.length) {
            try {
              const entity = JSON.parse(line);
              entities.push(entity);
              break;
            } catch (err) {
              const posMatch = err.message.match(/position (\d+)/);
              if (posMatch && parseInt(posMatch[1], 10) > 0) {
                const pos = parseInt(posMatch[1], 10);
                try {
                  const entity = JSON.parse(line.slice(0, pos));
                  entities.push(entity);
                  line = line.slice(pos).trim();
                  if (line.startsWith(',')) line = line.slice(1).trim();
                } catch (_) {
                  totalErrors++;
                  console.error(`Error en ${file} línea ${i + 1}:`, err.message);
                  break;
                }
              } else {
                totalErrors++;
                console.error(`Error en ${file} línea ${i + 1}:`, err.message);
                break;
              }
            }
          }
        }
        if (entities.length > 0 && !trimmed.startsWith('[')) {
          console.log(`  ${file}: ${entities.length} registros NDJSON`);
        }
      }

      // Deduplicar por id: una sola entrada por entidad (se conserva la última si se repite)
      const byId = new Map();
      for (const entity of entities) {
        if (!entity || typeof entity.id === 'undefined') continue;
        byId.set(entity.id, entity);
      }
      const uniqueEntities = Array.from(byId.values());

      const bulkOps = [];
      for (const entity of uniqueEntities) {
        const searchableText = buildSearchableText(entity.properties || {});
        const doc = {
          ...entity,
          searchableText,
          _sourceFile: file,
        };
        bulkOps.push({
          updateOne: {
            filter: { id: entity.id },
            update: { $set: doc },
            upsert: true,
          },
        });
      }

      if (bulkOps.length > 0) {
        const result = await collection.bulkWrite(bulkOps, { ordered: false });
        totalInserted += result.upsertedCount + result.modifiedCount;
        totalSkipped += result.matchedCount - result.modifiedCount;
        console.log(`  ${file}: ${bulkOps.length} entidades procesadas`);
      }
    }

    console.log('\nResumen:');
    console.log('  Insertados/actualizados:', totalInserted);
    console.log('  Sin cambios:', totalSkipped);
    console.log('  Errores:', totalErrors);
  } finally {
    await client.close();
  }
}

migrate().catch((err) => {
  console.error('Error de migración:', err);
  process.exit(1);
});
