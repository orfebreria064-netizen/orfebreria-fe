// Recorre un guion en la app: graba el video, sincroniza la narración y toma las capturas del manual.
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { montar, narrar } from './voz.mjs';

const ANCHO = 1280;
const ALTO = 720;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
/** Texto completo del elemento (sin contar espacios), para no confundir «Guardar» con «Guardar precios». */
const escaparRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textoExacto = (t) => new RegExp(`^\\s*${escaparRegex(t)}\\s*$`);

/** Cursor visible (Playwright no lo graba) y recuadro dorado para resaltar elementos. */
const SCRIPT_PAGINA = () => {
  const instalar = () => {
    if (document.getElementById('__ayuda_cursor')) return;
    const c = document.createElement('div');
    c.id = '__ayuda_cursor';
    c.style.cssText =
      'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(201,163,82,.45);border:2px solid #775727;pointer-events:none;left:-50px;top:-50px;' +
      'transition:transform .12s ease;';
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => {
      c.style.left = e.clientX + 'px';
      c.style.top = e.clientY + 'px';
    }, true);
    document.addEventListener('mousedown', () => (c.style.transform = 'scale(.7)'), true);
    document.addEventListener('mouseup', () => (c.style.transform = 'scale(1)'), true);
  };
  if (document.body) instalar();
  else document.addEventListener('DOMContentLoaded', instalar);
};

function crearAyudante(page) {
  const h = {
    page,
    /** Botón por su texto visible exacto, en toda la página. */
    boton: (nombre) => page.locator('button:visible').filter({ hasText: textoExacto(nombre) }).first(),
    pausa: (ms = 600) => espera(ms),

    async ir(ruta) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle').catch(() => {});
      await espera(400);
    },

    /** Lleva el cursor al elemento con un movimiento visible. */
    async apuntar(objetivo) {
      const loc = typeof objetivo === 'string' ? page.locator(objetivo).first() : objetivo;
      await loc.waitFor({ state: 'visible' });
      await loc.scrollIntoViewIfNeeded();
      const caja = await loc.boundingBox();
      if (caja) await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2, { steps: 18 });
      await espera(200);
      return loc;
    },

    async clic(objetivo) {
      const loc = await h.apuntar(objetivo);
      await loc.click();
      await espera(500);
    },

    async escribir(objetivo, texto) {
      const loc = await h.apuntar(objetivo);
      await loc.click();
      await loc.fill('');
      await loc.pressSequentially(texto, { delay: 45 });
      await espera(250);
    },

    /** Elige una opción de un p-select por el texto visible (exacto, o expresión regular). */
    async elegir(objetivo, opcion) {
      await h.clic(objetivo);
      const nombre = opcion instanceof RegExp ? opcion : textoExacto(opcion);
      await h.clic(page.locator('[role="option"]:visible').filter({ hasText: nombre }).first());
    },

    /** Escribe en un campo numérico (p-inputnumber) reemplazando lo que tenga. */
    async numero(objetivo, valor) {
      const loc = await h.apuntar(objetivo);
      await loc.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await loc.pressSequentially(String(valor), { delay: 60 });
      await espera(250);
    },

    /** Escribe una fecha dd/mm/aaaa en un p-datepicker y cierra el calendario. */
    async fecha(objetivo, valor) {
      const loc = await h.apuntar(objetivo);
      await loc.click();
      await page.keyboard.press('Control+A');
      await loc.pressSequentially(valor, { delay: 50 });
      await page.keyboard.press('Escape');
      await espera(300);
    },

    /** Botón por su texto dentro del diálogo visible. */
    enDialogo(nombre) {
      return page.getByRole('dialog').filter({ visible: true }).last().locator('button').filter({ hasText: textoExacto(nombre) }).first();
    },

    /** Pestaña (p-tab) por su texto. */
    pestana(nombre) {
      return page.getByRole('tab', { name: nombre });
    },

    /** Autocompletado (p-autocomplete): escribe, espera las sugerencias y elige la que contiene `opcion`. */
    async autocompletar(objetivo, texto, opcion = texto) {
      await h.escribir(objetivo, texto);
      const item = page.locator('[role="option"]:visible').filter({ hasText: opcion }).first();
      await item.waitFor({ state: 'visible', timeout: 15_000 });
      await h.clic(item);
    },

    /** Pulsa un botón de un diálogo de confirmación (p-confirmdialog). */
    async confirmar(...etiquetas) {
      // Acepta varias etiquetas: el diálogo puede mostrar el texto propio («Aprobar») o el genérico («Sí»)
      const re = new RegExp(`^\\s*(${etiquetas.map(escaparRegex).join('|')})\\s*$`);
      const boton = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ visible: true }).locator('button').filter({ hasText: re }).last();
      await boton.waitFor({ state: 'visible', timeout: 15_000 });
      await h.clic(boton);
    },

    /** Firma simulada con el mouse sobre un canvas. */
    async firmar(objetivo) {
      const loc = await h.apuntar(objetivo);
      const c = await loc.boundingBox();
      const y0 = c.y + c.height * 0.55;
      await page.mouse.move(c.x + c.width * 0.2, y0);
      await page.mouse.down();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        await page.mouse.move(c.x + c.width * (0.2 + 0.55 * t), y0 - Math.sin(t * Math.PI * 3) * c.height * 0.22, { steps: 2 });
      }
      await page.mouse.up();
      await espera(300);
    },

    /** Espera a que aparezca un aviso (toast) y lo cierra para que no tape la pantalla. */
    async cerrarAvisos() {
      await espera(400);
      const cerrar = page.locator('.p-toast .p-toast-close-button');
      for (const b of await cerrar.all()) await b.click().catch(() => {});
    },

    /** Datos que devolvió `preparar` del guion. */
    datos: {},

    /** Recuadro dorado (con número opcional) sobre uno o varios elementos; reemplaza al anterior. */
    async resaltar(objetivos, numero) {
      await h.quitarResaltado();
      const lista = (Array.isArray(objetivos) ? objetivos : [objetivos]).map((o) =>
        typeof o === 'string' ? page.locator(o).first() : o,
      );
      // Se desplaza solo una vez: si se desplazara por cada elemento, los recuadros anteriores quedarían corridos
      for (const loc of lista) await loc.waitFor({ state: 'visible' });
      await lista[0].scrollIntoViewIfNeeded();
      await espera(150);
      for (const [i, loc] of lista.entries()) {
        const caja = await loc.boundingBox();
        if (!caja) continue;
        await page.evaluate(
          ({ caja, etiqueta }) => {
            const d = document.createElement('div');
            d.className = '__ayuda_marca';
            d.style.cssText =
              `position:fixed;z-index:2147483646;pointer-events:none;left:${caja.x - 6}px;top:${caja.y - 6}px;` +
              `width:${caja.width + 12}px;height:${caja.height + 12}px;border:3px solid #c9a352;border-radius:10px;` +
              'box-shadow:0 0 0 4000px rgba(31,36,48,.18),0 0 14px rgba(201,163,82,.8);';
            if (etiqueta) {
              const b = document.createElement('span');
              b.textContent = etiqueta;
              b.style.cssText =
                'position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:#775727;' +
                'color:#fff;font:700 14px/26px system-ui,sans-serif;text-align:center;';
              d.appendChild(b);
            }
            document.body.appendChild(d);
          },
          { caja, etiqueta: numero != null ? String(lista.length > 1 ? `${numero}.${i + 1}` : numero) : '' },
        );
      }
      await espera(300);
    },

    async quitarResaltado() {
      await page.evaluate(() => document.querySelectorAll('.__ayuda_marca').forEach((e) => e.remove()));
    },
  };
  return h;
}

/** Inicia sesión una vez y devuelve el estado (localStorage de Supabase) para reutilizarlo. */
async function iniciarSesion(browser, { baseUrl, email, password }) {
  const ctx = await browser.newContext({ baseURL: baseUrl });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password input, input#password').first().fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const estado = await ctx.storageState();
  await ctx.close();
  return estado;
}

/**
 * Ejecuta el guion y deja en `salida`: videos/{clave}.mp4 y capturas/{clave}-NN.png.
 * Devuelve los pasos del manual con la ruta de su captura.
 */
export async function grabarGuion(guion, opciones) {
  const { baseUrl, salida, conVideo = true } = opciones;
  const tmp = path.join(salida, 'tmp', guion.clave);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await mkdir(path.join(salida, 'capturas'), { recursive: true });

  const browser = await chromium.launch();
  try {
    const storageState = await iniciarSesion(browser, opciones);
    const ctx = await browser.newContext({
      baseURL: baseUrl,
      storageState,
      viewport: { width: ANCHO, height: ALTO },
      locale: 'es-PE',
      timezoneId: 'America/Lima',
      ...(conVideo ? { recordVideo: { dir: tmp, size: { width: ANCHO, height: ALTO } } } : {}),
    });
    await ctx.addInitScript(SCRIPT_PAGINA);
    const page = await ctx.newPage();
    const t0 = Date.now();
    const seg = () => (Date.now() - t0) / 1000;
    const h = crearAyudante(page);
    h.datos = opciones.datos ?? {};

    await h.ir(typeof guion.ruta === 'function' ? guion.ruta(h.datos) : guion.ruta);
    await page.mouse.move(ANCHO / 2, ALTO / 2);
    const recorteInicio = seg();

    const narraciones = [];
    const pasos = [];
    let numeroPaso = 0;
    for (const [i, escena] of guion.escenas.entries()) {
      const audio = conVideo ? await narrar(escena.voz, path.join(tmp, `voz-${i}.mp3`)) : { duracion: 0 };
      const inicio = seg();
      if (conVideo) narraciones.push({ ruta: audio.ruta, inicio });

      if (escena.paso) numeroPaso++;
      try {
        await escena.accion?.(h, escena.paso ? numeroPaso : undefined);
      } catch (err) {
        const ruta = path.join(salida, `error-${guion.clave}.png`);
        await page.screenshot({ path: ruta }).catch(() => {});
        err.message = `escena ${i + 1} (${escena.paso?.titulo ?? escena.voz.slice(0, 40)}): ${err.message}\n    captura: ${ruta}`;
        throw err;
      }

      if (escena.paso) {
        const captura = path.join(salida, 'capturas', `${guion.clave}-${String(numeroPaso).padStart(2, '0')}.png`);
        await page.locator('#__ayuda_cursor').evaluate((e) => (e.style.visibility = 'hidden')).catch(() => {});
        await page.screenshot({ path: captura });
        await page.locator('#__ayuda_cursor').evaluate((e) => (e.style.visibility = 'visible')).catch(() => {});
        pasos.push({ ...escena.paso, numero: numeroPaso, captura });
      }

      // La escena dura lo que su narración, más un respiro
      const restante = inicio + audio.duracion + 0.7 - seg();
      if (restante > 0) await espera(restante * 1000);
      await h.quitarResaltado();
    }
    await espera(800);
    await ctx.close();

    let video = null;
    if (conVideo) {
      const webm = (await readdir(tmp)).find((f) => f.endsWith('.webm'));
      video = await montar({
        video: path.join(tmp, webm),
        narraciones,
        recorteInicio,
        destino: path.join(salida, 'videos', `${guion.clave}.mp4`),
      });
    }
    return { pasos, video };
  } finally {
    await browser.close();
  }
}
