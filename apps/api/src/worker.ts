import { cargarEnvDeLaRaiz } from './config/cargar-env';
import { cargarEntorno, exigirEntornoDelWorker } from './config/entorno';
import { crearWorker } from './crear-worker';

/**
 * Punto de entrada del worker de envíos al PSE como proceso aparte (`node dist/worker.js`; historia 006, entrega 6b,
 * criterio 125). También puede correr dentro del proceso de la API con `WORKER=habilitado`. Exige la conexión de la cola
 * (`DATABASE_COLAS_URL`), la de la carga del padrón (`DATABASE_REFERENCIA_URL`) y la de los eventos de tiempo real
 * (`DATABASE_TIEMPO_REAL_URL`).
 */
async function arrancar(): Promise<void> {
  cargarEnvDeLaRaiz();
  exigirEntornoDelWorker(cargarEntorno(process.env), { procesoAparte: true });
  const worker = await crearWorker();
  worker.contexto.enableShutdownHooks();
  await worker.iniciar();
}

arrancar().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
