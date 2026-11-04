// Sube los videos generados al bucket público "ayuda" de Supabase Storage (migración 0023)
// y los marca como disponibles en public/ayuda/manifest.json.
//
//   node tools/ayuda/subir.mjs customers orders
//   node tools/ayuda/subir.mjs --todas
//
// Usa AYUDA_EMAIL y AYUDA_PASSWORD: el usuario debe tener rol ADMIN (solo ADMIN escribe en el bucket).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '../..');
const carpeta = path.join(aqui, 'salida/videos');
const manifiestoRuta = path.join(raiz, 'public/ayuda/manifest.json');

// Misma URL y clave pública que la app (src/environments/environment.ts)
const env = await readFile(path.join(raiz, 'src/environments/environment.ts'), 'utf8');
const url = /supabaseUrl:\s*'([^']+)'/.exec(env)[1];
const key = /supabaseKey:\s*'([^']+)'/.exec(env)[1];

const args = process.argv.slice(2);
const hechos = (await readdir(carpeta).catch(() => [])).filter((f) => f.endsWith('.mp4')).map((f) => f.slice(0, -4));
const claves = args.includes('--todas') ? hechos : args.filter((a) => !a.startsWith('--'));
if (!claves.length) {
  console.log(`Indique qué videos subir o --todas. Generados: ${hechos.join(', ') || '(ninguno)'}`);
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { error: errLogin } = await supabase.auth.signInWithPassword({
  email: process.env.AYUDA_EMAIL ?? '',
  password: process.env.AYUDA_PASSWORD ?? '',
});
if (errLogin) {
  console.error('No se pudo iniciar sesión:', errLogin.message);
  process.exit(1);
}

const manifiesto = JSON.parse(await readFile(manifiestoRuta, 'utf8').catch(() => '{}'));
const fecha = new Date().toISOString().slice(0, 10);
for (const clave of claves) {
  const archivo = path.join(carpeta, `${clave}.mp4`);
  const datos = await readFile(archivo).catch(() => null);
  if (!datos) {
    console.error(`✗ ${clave}: no existe ${path.relative(raiz, archivo)}; genérelo primero.`);
    continue;
  }
  const { error } = await supabase.storage
    .from('ayuda')
    .upload(`videos/${clave}.mp4`, datos, { contentType: 'video/mp4', upsert: true, cacheControl: '3600' });
  if (error) {
    console.error(`✗ ${clave}: ${error.message}`);
    continue;
  }
  manifiesto[clave] = { ...manifiesto[clave], video: true, version: fecha };
  console.log(`✓ ${clave}: subido (${(datos.length / 1048576).toFixed(1)} MB)`);
}
await writeFile(manifiestoRuta, JSON.stringify(manifiesto, null, 2) + '\n');
await supabase.auth.signOut();
console.log('Manifiesto actualizado: public/ayuda/manifest.json (publíquelo con un commit para que la app lo vea).');
