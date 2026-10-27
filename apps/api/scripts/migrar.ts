// pnpm db:migrar     -> aplica las migraciones pendientes
// pnpm db:revertir   -> revierte la última migración aplicada
// Usa DATABASE_MIGRADOR_URL; si falta, la deriva de DATABASE_ADMIN_URL (rol migrador, base `restaurante`).
import { cargarEnvDeLaRaiz } from '../src/config/cargar-env';
import { migrarArriba, revertirUltima } from './lib/migraciones';
import { BASE_DE_DATOS_POR_DEFECTO, exigirUrlAdmin, urlParaRol } from './lib/roles';

function urlMigrador(): string {
  return (
    process.env.DATABASE_MIGRADOR_URL ??
    urlParaRol(exigirUrlAdmin(), 'migrador', BASE_DE_DATOS_POR_DEFECTO)
  );
}

async function main() {
  cargarEnvDeLaRaiz();
  if (process.argv[2] === 'revertir') {
    const nombre = await revertirUltima(urlMigrador());
    console.log(nombre ? `Revertida: ${nombre}` : 'No hay migraciones que revertir.');
    return;
  }
  const aplicadas = await migrarArriba(urlMigrador());
  console.log(
    aplicadas.length
      ? `Migraciones aplicadas: ${aplicadas.join(', ')}`
      : 'No hay migraciones pendientes.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
