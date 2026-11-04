// Genera el manual PDF y el video narrado de una o varias opciones del menú.
//
//   node tools/ayuda/generar.mjs customers orders     (opciones concretas)
//   node tools/ayuda/generar.mjs --todas              (todas, en el orden del flujo de trabajo)
//   node tools/ayuda/generar.mjs customers --sin-video (solo el PDF, más rápido)
//
// Variables de entorno: AYUDA_EMAIL y AYUDA_PASSWORD (usuario ADMIN de demostración),
// AYUDA_URL (por defecto http://localhost:51362).
//
// Los guiones encadenan datos de demostración (cliente → cotización → pedido → pago → entrega):
// grábelos en el orden de ORDEN. Cada guion puede declarar `preparar(db)` para buscar o dejar
// listos sus datos; lo que devuelve llega a las acciones como `h.datos`.
//
// Salida: public/ayuda/manuales/{clave}.pdf (se publica con la app) y
// tools/ayuda/salida/videos/{clave}.mp4 (se sube a Supabase Storage con subir.mjs).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { conectar } from './lib/db.mjs';
import { grabarGuion } from './lib/grabar.mjs';
import { generarManual } from './lib/manual.mjs';

export const ORDEN = [
  'settings', 'tipo-cambio', 'materials', 'jewelers', 'customers', 'quotations', 'orders', 'production',
  'payments', 'deliveries', 'reparaciones', 'vitrina', 'finanzas', 'dashboard', 'reports',
];

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '../..');
const salida = path.join(aqui, 'salida');
const manifiestoRuta = path.join(raiz, 'public/ayuda/manifest.json');

const args = process.argv.slice(2);
const conVideo = !args.includes('--sin-video');
const disponibles = (await readdir(path.join(aqui, 'guiones'))).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4));
const ordenadas = [...ORDEN.filter((c) => disponibles.includes(c)), ...disponibles.filter((c) => !ORDEN.includes(c))];
const pedidas = args.filter((a) => !a.startsWith('--'));
const claves = args.includes('--todas') ? ordenadas : ordenadas.filter((c) => pedidas.includes(c));

if (!claves.length) {
  console.log(`Indique qué opciones generar o --todas. Guiones disponibles: ${ordenadas.join(', ')}`);
  process.exit(1);
}
for (const p of pedidas.filter((p) => !disponibles.includes(p))) console.error(`✗ ${p}: no hay guion en tools/ayuda/guiones/${p}.mjs`);

const email = process.env.AYUDA_EMAIL;
const password = process.env.AYUDA_PASSWORD;
if (!email || !password) {
  console.error('Defina AYUDA_EMAIL y AYUDA_PASSWORD con el usuario de demostración.');
  process.exit(1);
}
const baseUrl = process.env.AYUDA_URL ?? 'http://localhost:51362';
const fecha = new Date().toISOString().slice(0, 10);
const db = await conectar();

const manifiesto = JSON.parse(await readFile(manifiestoRuta, 'utf8').catch(() => '{}'));
let fallas = 0;

for (const clave of claves) {
  const { default: guion } = await import(pathToFileURL(path.join(aqui, 'guiones', `${clave}.mjs`)).href);
  try {
    console.log(`▶ ${guion.titulo}: grabando${conVideo ? ' video y' : ''} capturas…`);
    const datos = (await guion.preparar?.(db)) ?? {};
    const { pasos, video } = await grabarGuion(guion, { baseUrl, email, password, salida, conVideo, datos });
    const pdf = await generarManual(guion, pasos, {
      destino: path.join(raiz, 'public/ayuda/manuales', `${clave}.pdf`),
      logo: path.join(raiz, 'public/brillos-logo.png'),
      fecha,
    });
    console.log(`  ✓ PDF: ${path.relative(raiz, pdf)}`);
    if (video) console.log(`  ✓ Video: ${path.relative(raiz, video)}`);
    // El video queda marcado como disponible recién al subirlo (subir.mjs)
    manifiesto[clave] = { ...manifiesto[clave], pdf: true, version: fecha };
    await writeFile(manifiestoRuta, JSON.stringify(manifiesto, null, 2) + '\n');
  } catch (err) {
    fallas++;
    console.error(`  ✗ ${clave}: ${err.message.split('\n').slice(0, 16).join('\n    ')}`);
  }
}

await db.auth.signOut();
console.log(fallas ? `Terminado con ${fallas} error(es).` : 'Listo. Manifiesto: public/ayuda/manifest.json');
process.exit(fallas ? 1 : 0);
