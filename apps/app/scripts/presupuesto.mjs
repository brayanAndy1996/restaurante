// Presupuesto de peso del paquete inicial de la PWA (carga rápida con datos móviles, RNF-03):
// falla si el JavaScript que se descarga al abrir la app, comprimido con gzip, supera el límite.
// Se ejecuta después de `pnpm build` (en la CI también). La administración y el panel de
// plataforma son bloques aparte que se cargan bajo demanda y no cuentan aquí.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMITE_KB = 170;
const carpeta = new URL('../dist/assets/', import.meta.url).pathname;

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const iniciales = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
if (iniciales.length === 0) {
  console.error('No se encontró el JavaScript inicial en dist/index.html. ¿Corriste `pnpm build`?');
  process.exit(1);
}

let totalKb = 0;
for (const archivo of iniciales) {
  const kb = gzipSync(readFileSync(join(carpeta, archivo))).length / 1024;
  totalKb += kb;
  console.log(`  ${archivo}: ${kb.toFixed(1)} kB (gzip)`);
}
const bloquesAparte = readdirSync(carpeta).filter(
  (f) => f.endsWith('.js') && !iniciales.includes(f),
).length;
console.log(
  `Paquete inicial: ${totalKb.toFixed(1)} kB gzip (límite ${LIMITE_KB} kB); ${bloquesAparte} bloques bajo demanda.`,
);
if (totalKb > LIMITE_KB) {
  console.error(
    `El paquete inicial supera el presupuesto de ${LIMITE_KB} kB. Carga lo nuevo bajo demanda.`,
  );
  process.exit(1);
}
