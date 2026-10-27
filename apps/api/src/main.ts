import { crearAplicacion } from './aplicacion';
import { cargarEnvDeLaRaiz } from './config/cargar-env';
import { ENTORNO, type Entorno } from './config/entorno';

async function arrancar() {
  cargarEnvDeLaRaiz();
  const app = await crearAplicacion();
  app.enableShutdownHooks();
  const { PORT } = app.get<Entorno>(ENTORNO);
  await app.listen(PORT);
}

arrancar().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
