// Manual de usuario en PDF: portada, para qué sirve, cuándo usarlo, pasos con capturas, consejos y qué sigue.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Permite **negrita** en los textos del guion. */
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const img = async (ruta) => `data:image/png;base64,${(await readFile(ruta)).toString('base64')}`;

export async function generarManual(guion, pasos, { destino, logo, fecha }) {
  const logoSrc = await img(logo);
  const pasosHtml = [];
  for (const p of pasos) {
    pasosHtml.push(`
      <section class="paso">
        <h3><span class="num">${p.numero}</span>${fmt(p.titulo)}</h3>
        ${p.texto ? `<p>${fmt(p.texto)}</p>` : ''}
        ${p.detalle?.length ? `<ul>${p.detalle.map((d) => `<li>${fmt(d)}</li>`).join('')}</ul>` : ''}
        <img class="captura" src="${await img(p.captura)}" />
      </section>`);
  }

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm 16mm 20mm; }
    * { box-sizing: border-box; }
    body { font: 10.5pt/1.5 'Segoe UI', system-ui, sans-serif; color: #2b2a27; margin: 0; }
    .portada { height: 250mm; display: flex; flex-direction: column; justify-content: center; align-items: center;
      text-align: center; page-break-after: always; }
    .portada img { width: 120px; margin-bottom: 18px; }
    .portada .marca { letter-spacing: .3em; color: #775727; font-weight: 700; font-size: 12pt; }
    .portada h1 { font-size: 30pt; margin: 14px 0 6px; color: #1f2430; }
    .portada .sub { color: #7b776f; font-size: 12pt; max-width: 120mm; }
    .portada .linea { width: 60px; height: 3px; background: #c9a352; margin: 22px auto; }
    .portada .pie { color: #a29e96; font-size: 9pt; margin-top: 40px; }
    h2 { color: #775727; font-size: 14pt; border-bottom: 2px solid #e8d7ab; padding-bottom: 4px; margin: 22px 0 10px; }
    .caja { background: #fbf8f0; border-left: 4px solid #c9a352; padding: 10px 14px; border-radius: 4px; }
    .paso { page-break-inside: avoid; margin: 0 0 18px; }
    .paso h3 { display: flex; align-items: center; gap: 10px; font-size: 12pt; margin: 0 0 6px; color: #1f2430; }
    .num { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #775727; color: #fff;
      font-size: 11pt; text-align: center; line-height: 26px; }
    .paso p, .paso ul { margin: 0 0 8px 36px; }
    .captura { display: block; width: 100%; border: 1px solid #e2e0dc; border-radius: 6px; margin-top: 4px; }
    ul { padding-left: 18px; }
    li { margin-bottom: 3px; }
    .video { margin-top: 24px; text-align: center; color: #5f5b54; }
    .video .pi { display: inline-block; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #775727;
      color: #775727; font-weight: 700; line-height: 18px; margin: 0 3px; }
  </style></head><body>
    <div class="portada">
      <img src="${logoSrc}" />
      <div class="marca">BRILLOS</div>
      <h1>${esc(guion.titulo)}</h1>
      <div class="sub">${fmt(guion.paraQue)}</div>
      <div class="linea"></div>
      <div class="sub">Manual de usuario</div>
      <div class="pie">Versión ${esc(fecha)}</div>
    </div>

    <h2>¿Para qué sirve?</h2>
    <div class="caja">${fmt(guion.paraQue)}</div>

    ${guion.cuando?.length ? `<h2>¿Cuándo se usa?</h2><ul>${guion.cuando.map((c) => `<li>${fmt(c)}</li>`).join('')}</ul>` : ''}

    <h2>Paso a paso</h2>
    ${pasosHtml.join('')}

    ${guion.consejos?.length ? `<h2>Consejos y errores comunes</h2><ul>${guion.consejos.map((c) => `<li>${fmt(c)}</li>`).join('')}</ul>` : ''}

    ${guion.siguiente ? `<h2>¿Qué sigue?</h2><div class="caja">${fmt(guion.siguiente)}</div>` : ''}

    <p class="video">¿Prefiere verlo en video? En la app pulse el botón <span class="pi">?</span> de la parte superior,
      estando en <strong>${esc(guion.titulo)}</strong>.</p>
  </body></html>`;

  await mkdir(path.dirname(destino), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: destino,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font:8pt 'Segoe UI',sans-serif;color:#a29e96;padding:0 16mm;display:flex;justify-content:space-between">
        <span>BRILLOS · ${esc(guion.titulo)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
  return destino;
}
