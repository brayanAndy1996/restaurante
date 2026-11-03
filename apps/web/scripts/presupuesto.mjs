// Presupuesto de peso de la carta web (criterio 88; carga rápida con datos móviles). Mide, después de
// `pnpm build`, lo que el navegador descarga al abrir cada ruta: el JavaScript (con gzip) y el CSS.
//
//   - Lo común: los <script> y las hojas de estilo del HTML de `/_not-found` (la base de Next y del `layout`),
//     sin los `noModule` (solo los baja un navegador antiguo).
//   - Lo propio de cada ruta: los fragmentos de las islas de cliente de su página y de los `layout` que la
//     envuelven, que Next anota en `page_client-reference-manifest.js`. Los bloques que se cargan bajo demanda
//     (`import()` o `next/dynamic`) no cuentan, porque no se bajan al abrir.
//
// - Lo que se baja después: el modo mesa carga aparte (`import()` en `componentes/mesa/cargar-perezoso.ts`) sus hojas
//   y las reglas de montos de `packages/dominio`, que arrastran `decimal.js` (unos 13 kB). Eso no entra en los 150 kB
//   de la primera carga, pero se mide aparte, con su propio límite, para que no crezca a escondidas: es lo que el
//   cliente descarga al tocar el primer plato.
//
// El peso del HTML (60 kB con 150 productos) y de las imágenes (25 kB cada una) se mide en el E2E con la
// carta real (tarea T25); aquí solo lo que se puede saber del build.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const RAIZ = new URL('../.next/', import.meta.url).pathname;
const KB = 1024;

// Límites del criterio 88: JavaScript de la carta 140 kB y del modo mesa 150 kB, CSS 20 kB (gzip). La carta tenía
// 120 kB, pero la base de Next 16 con React 19 (App Router, sin una sola isla) ya pesa 131.8 kB gzip, así que 120 kB
// no se podía cumplir; el usuario aprobó 140 kB el 2026-11-03: la base más el margen de las islas de la carta
// (disponibilidad y familia en pantalla). El modo mesa conserva sus 150 kB: la barra, el envío con reintento y el
// estado del llamado suman unos 7 kB sobre la carta; las hojas y las reglas de montos con `decimal.js` (unos 17 kB
// juntas) se descargan aparte, al primer toque (ver abajo).
const LIMITE_CSS_KB = 20;
// Lo que el modo mesa baja al tocar el primer plato (hojas y reglas de montos), gzip.
const LIMITE_DIFERIDO_KB = 25;
const RUTAS = [
  { ruta: '/[empresa]', carpeta: '[empresa]', limiteJsKb: 140 },
  { ruta: '/[empresa]/[sucursal]', carpeta: '[empresa]/[sucursal]', limiteJsKb: 140 },
  { ruta: '/m/[codigo]', carpeta: 'm/[codigo]', limiteJsKb: 150 },
];

if (!existsSync(join(RAIZ, 'server/app/_not-found.html'))) {
  console.error(
    'No se encontró el build de apps/web. ¿Corriste `pnpm --filter @restaurante/web build`?',
  );
  process.exit(1);
}

function gzipKb(archivo) {
  return gzipSync(readFileSync(join(RAIZ, archivo))).length / KB;
}

// Base común: lo que declara el HTML de la página 404, que es solo el layout raíz.
const html = readFileSync(join(RAIZ, 'server/app/_not-found.html'), 'utf8');
const quitarPrefijo = (url) => url.replace(/^\/_next\//, '');
const baseJs = new Set();
const soloNavegadoresViejos = new Set();
for (const [, etiqueta] of html.matchAll(/<script\b([^>]*)>/g)) {
  const src = /\ssrc="([^"]+)"/.exec(` ${etiqueta}`)?.[1];
  if (!src?.endsWith('.js')) continue;
  if (/\snoModule\b/i.test(etiqueta)) soloNavegadoresViejos.add(quitarPrefijo(src));
  else baseJs.add(quitarPrefijo(src));
}
const baseCss = new Set();
for (const [etiqueta] of html.matchAll(/<link\b[^>]*>/g)) {
  const href = /\shref="([^"]+\.css)"/.exec(etiqueta)?.[1];
  if (href && /rel="stylesheet"/.test(etiqueta)) baseCss.add(quitarPrefijo(href));
}
if (baseJs.size === 0) {
  console.error('No se encontró el JavaScript base en el HTML de /_not-found.');
  process.exit(1);
}

/** Los fragmentos de la página y de sus `layout` que anota el manifiesto de referencias de cliente. */
function propios(carpeta) {
  const archivo = join(RAIZ, 'server/app', carpeta, 'page_client-reference-manifest.js');
  if (!existsSync(archivo)) return { js: new Set(), css: new Set() };
  const texto = readFileSync(archivo, 'utf8');
  const manifiesto = JSON.parse(texto.slice(texto.indexOf('= {') + 2, texto.lastIndexOf('}') + 1));
  const segmentos = carpeta.split('/');
  const envolventes = ['app/layout'];
  for (let i = 1; i <= segmentos.length; i += 1) {
    envolventes.push(`app/${segmentos.slice(0, i).join('/')}/layout`);
  }
  envolventes.push(`app/${carpeta}/page`);
  const coincide = (clave) => envolventes.some((e) => clave.endsWith(`/${e}`));
  const js = new Set();
  const css = new Set();
  for (const [clave, archivos] of Object.entries(manifiesto.entryJSFiles ?? {})) {
    if (coincide(clave)) archivos.forEach((a) => js.add(a));
  }
  for (const [clave, archivos] of Object.entries(manifiesto.entryCSSFiles ?? {})) {
    if (coincide(clave)) archivos.forEach((a) => css.add(a.path));
  }
  return { js, css };
}

let fallo = false;
const usados = new Set([...baseJs, ...soloNavegadoresViejos]);
for (const { ruta, carpeta, limiteJsKb } of RUTAS) {
  const { js, css } = propios(carpeta);
  const todosJs = new Set([...baseJs, ...js]);
  todosJs.forEach((a) => usados.add(a));
  const todosCss = new Set([...baseCss, ...css]);
  const jsKb = [...todosJs].reduce((suma, a) => suma + gzipKb(a), 0);
  const cssKb = [...todosCss].reduce((suma, a) => suma + gzipKb(a), 0);
  const jsBien = jsKb <= limiteJsKb;
  const cssBien = cssKb <= LIMITE_CSS_KB;
  console.log(
    `${ruta.padEnd(24)} JS ${jsKb.toFixed(1).padStart(6)} kB (límite ${limiteJsKb}) ${jsBien ? 'ok' : 'EXCEDIDO'}` +
      `   CSS ${cssKb.toFixed(1).padStart(5)} kB (límite ${LIMITE_CSS_KB}) ${cssBien ? 'ok' : 'EXCEDIDO'}`,
  );
  if (!jsBien || !cssBien) fallo = true;
}

// Lo que no está en ninguna primera carga se baja bajo demanda.
const diferidos = readdirSync(join(RAIZ, 'static/chunks'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `static/chunks/${f}`)
  .filter((f) => !usados.has(f));
const diferidoKb = diferidos.reduce((suma, a) => suma + gzipKb(a), 0);
const diferidoBien = diferidoKb <= LIMITE_DIFERIDO_KB;
console.log(
  `${'bajo demanda (mesa)'.padEnd(24)} JS ${diferidoKb.toFixed(1).padStart(6)} kB (límite ${LIMITE_DIFERIDO_KB}) ${diferidoBien ? 'ok' : 'EXCEDIDO'}` +
    `   en ${diferidos.length} archivo${diferidos.length === 1 ? '' : 's'}`,
);
if (!diferidoBien) fallo = true;

if (fallo) {
  console.error(
    'La carta web supera el presupuesto del criterio 88. Carga lo nuevo bajo demanda o propone otro límite con su motivo.',
  );
  process.exit(1);
}
