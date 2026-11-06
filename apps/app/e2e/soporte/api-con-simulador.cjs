'use strict';
/**
 * La API de las E2E de 6b (historia 006, tarea T45): la misma API de producción (`apps/api/dist`), compilada, con el
 * worker de envíos dentro del proceso (`WORKER=habilitado`, pg-boss real con `DATABASE_COLAS_URL`) y con un
 * `SimuladorPse` propio cuyas reglas se mueven por un puerto de control. El simulador vive en la memoria del proceso
 * (criterio 121) y una API ya levantada no ofrece ninguna ruta para darle reglas; este arranque es solo de pruebas y no
 * toca el código de producción.
 *
 * Control (solo en 127.0.0.1, puerto `E2E_PSE_CONTROL_PUERTO`, por defecto 3100):
 *   POST /rechazar-ruc  { ruc, codigo, mensaje }  → el simulador rechaza (origen SUNAT) los documentos de ese RUC de cliente
 *   POST /limpiar                                   → quita todas las reglas
 *   GET  /llamadas                                  → las llamadas que recibió el simulador
 *
 * Uso: `node e2e/soporte/api-con-simulador.cjs` desde `apps/app`, con la API compilada (`pnpm --filter @restaurante/api build`).
 */
const http = require('node:http');
const dist = '../../../api/dist';
const { crearAplicacion } = require(`${dist}/aplicacion`);
const { cargarEnvDeLaRaiz } = require(`${dist}/config/cargar-env`);
const { ENTORNO } = require(`${dist}/config/entorno`);
const { SimuladorPse } = require(`${dist}/modulos/facturacion/pse/simulador-pse`);

const PUERTO_DE_CONTROL = Number(process.env.E2E_PSE_CONTROL_PUERTO ?? 3100);

function leerJson(peticion) {
  return new Promise((resolver, rechazar) => {
    const trozos = [];
    peticion.on('data', (t) => trozos.push(t));
    peticion.on('end', () => {
      try {
        resolver(trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : {});
      } catch (error) {
        rechazar(error);
      }
    });
    peticion.on('error', rechazar);
  });
}

function servidorDeControl(simulador) {
  return http.createServer((peticion, respuesta) => {
    const responder = (estado, cuerpo) => {
      respuesta.writeHead(estado, { 'content-type': 'application/json' });
      respuesta.end(JSON.stringify(cuerpo));
    };
    const ruta = new URL(peticion.url ?? '/', 'http://localhost').pathname;
    if (peticion.method === 'GET' && ruta === '/health') return responder(200, { ok: true });
    if (peticion.method === 'GET' && ruta === '/llamadas') {
      return responder(200, simulador.llamadas());
    }
    if (peticion.method === 'POST' && ruta === '/limpiar') {
      simulador.reglas.limpiar();
      return responder(200, { ok: true });
    }
    if (peticion.method === 'POST' && ruta === '/rechazar-ruc') {
      leerJson(peticion)
        .then(({ ruc, codigo, mensaje }) => {
          simulador.reglas.rechazarRucDeCliente(String(ruc), {
            codigo: String(codigo),
            mensaje: String(mensaje),
          });
          responder(200, { ok: true });
        })
        .catch(() => responder(400, { error: 'JSON inválido' }));
      return undefined;
    }
    return responder(404, { error: 'no existe' });
  });
}

async function arrancar() {
  cargarEnvDeLaRaiz();
  const simulador = new SimuladorPse();
  const app = await crearAplicacion({ pse: simulador });
  app.enableShutdownHooks();
  const { PORT } = app.get(ENTORNO);
  await app.listen(PORT);
  const control = servidorDeControl(simulador);
  control.listen(PUERTO_DE_CONTROL, '127.0.0.1');
  const cerrar = () => control.close();
  process.once('SIGTERM', cerrar);
  process.once('SIGINT', cerrar);
}

arrancar().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
