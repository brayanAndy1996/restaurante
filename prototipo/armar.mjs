// Genera prototipo/index.html envolviendo el fragmento prototipo/prototipo.html en una página completa.
// Uso: node prototipo/armar.mjs   (no necesita instalar nada)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const carpeta = dirname(fileURLToPath(import.meta.url));
const fragmento = readFileSync(join(carpeta, 'prototipo.html'), 'utf8');

// El fragmento empieza con <title>, un <meta> y los <style>; todo eso va en <head>.
// Desde el primer elemento de contenido (la franja del prototipo) todo va en <body>.
const corte = fragmento.indexOf('<div class="franja">');
if (corte < 0) {
  console.error('No encontré el inicio del contenido en prototipo.html.');
  process.exit(1);
}
const cabeza = fragmento.slice(0, corte).trim();
const cuerpo = fragmento.slice(corte).trim();

const pagina = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${cabeza}
</head>
<body>
${cuerpo}
</body>
</html>
`;

writeFileSync(join(carpeta, 'index.html'), pagina);
console.log(`Listo: prototipo/index.html (${(pagina.length / 1024).toFixed(0)} KB)`);
