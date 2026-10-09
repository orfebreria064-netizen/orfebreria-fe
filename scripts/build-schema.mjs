// Concatena supabase/migrations/*.sql en supabase/schema.sql (esquema completo en un solo archivo).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const header =
  '-- =====================================================================\n' +
  '-- schema.sql — ARCHIVO GENERADO con `npm run db:schema`. No editar a mano.\n' +
  '-- Fuente: supabase/migrations/*.sql (en orden). Ejecutar en un proyecto\n' +
  '-- Supabase vacío desde el SQL Editor; luego, opcionalmente, seed.sql.\n' +
  '-- =====================================================================\n\n';
const body = files.map((f) => `-- >>> ${f}\n${readFileSync(join(dir, f), 'utf8').trim()}\n`).join('\n');
writeFileSync('supabase/schema.sql', header + body);
console.log(`schema.sql generado a partir de ${files.length} migraciones.`);
