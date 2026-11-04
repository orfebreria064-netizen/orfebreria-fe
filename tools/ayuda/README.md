# Ayuda en la app: manuales PDF y videos narrados

El botón **?** de la barra superior abre la ayuda de la pantalla actual: el video y el manual en PDF.
Qué material existe lo indica `public/ayuda/manifest.json`.

| Material | Dónde queda | Cómo se publica |
|---|---|---|
| Manual PDF | `public/ayuda/manuales/{clave}.pdf` | con la app (commit + Vercel) |
| Video MP4 | `tools/ayuda/salida/videos/{clave}.mp4` | `subir.mjs` → bucket público `ayuda` de Supabase (migración 0023) |

`{clave}` es el primer segmento de la URL de la opción (`/customers` → `customers`).

## Regenerar todo

Requisitos: la app corriendo en http://localhost:51362, `npx playwright install chromium` (una vez) y un usuario
**ADMIN** en `AYUDA_EMAIL` / `AYUDA_PASSWORD`. La voz (neuronal `es-PE-CamilaNeural`) necesita internet.

1. En el SQL Editor de Supabase ejecute `tools/ayuda/limpieza.sql` (deja la base sin datos de demostración).
2. Grabe todo, en el orden del flujo (cada guion usa los datos que creó el anterior):
   ```bash
   node tools/ayuda/generar.mjs --todas     # ~35 min: PDF + video de las 15 opciones
   node tools/ayuda/subir.mjs --todas       # sube los videos y los marca en el manifiesto
   ```
3. Ejecute otra vez `tools/ayuda/limpieza.sql` para borrar los datos de demostración.
4. Haga commit de `public/ayuda/` para publicar los PDF y el manifiesto.

Para una sola opción: `node tools/ayuda/generar.mjs orders` (o `--sin-video` para probar solo el PDF).
Si falla una escena, queda una captura en `tools/ayuda/salida/error-{clave}.png`.

## Escribir o ajustar un guion

Los guiones están en `guiones/{clave}.mjs` y los datos ficticios en `lib/demo.mjs`. Cada escena tiene:
- `voz`: lo que dice la narradora. Frases cortas: la escena dura lo que dura la frase.
- `accion(h, n)`: lo que se hace en pantalla. Ayudantes de `lib/grabar.mjs`: `clic`, `escribir`, `numero`
  (p-inputnumber), `fecha` (p-datepicker), `elegir` (p-select), `autocompletar`, `confirmar`, `firmar`,
  `resaltar(objetivo | [objetivos], n)`, `boton(texto)`, `enDialogo(texto)`, `pestana(texto)`, `cerrarAvisos`.
- `paso` (opcional): `{ titulo, texto, detalle[] }` para el manual; la captura se toma **al terminar la acción**,
  con el resaltado visible. Por eso, guardar o cerrar un diálogo va al **inicio** de la escena siguiente.

`preparar(db)` (opcional) corre antes de grabar con la API de Supabase: busca o deja listos los datos que el
guion necesita; lo que devuelve llega como `h.datos`. Los guiones que solo muestran (Configuración, Tipo de
cambio) no guardan cambios en los datos reales.
