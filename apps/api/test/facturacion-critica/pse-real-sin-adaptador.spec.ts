// spec: 006-caja-cobro (pruebas protegidas, 6b, cierre)
//
// Fallar cerrado ante un emisor en modo REAL sin adaptador real (criterios 120 a 122): un emisor REAL nunca se envía con el
// simulador, que aceptaría el documento sin pasar por SUNAT.
// - (1) El entorno rechaza al arrancar un `PSE_CONECTOR` que no sea `simulador` ni el código de un adaptador registrado (en 6b no
//   hay ninguno); el mensaje nombra `PSE_CONECTOR`.
// - (2) Un emisor en modo `REAL` (forzado en la base, sin pasar por el PUT) no se envía con el simulador que la aplicación de
//   pruebas instala con `crearAplicacion({ pse })`: su envío termina en `ERROR_CONFIGURACION` sin llamar a nadie. Un emisor
//   `SIMULADO` sigue usando el simulador.
// - (3) `PUT /plataforma/empresas/:e/emisores/:m/pse` con `REAL` responde 409 `PSE_NO_CONFIGURADO` si no hay un adaptador real
//   registrado para `PSE_CONECTOR`, y el modo del emisor no cambia.
//
// Hoy falla así: (1) el entorno acepta cualquier código con forma válida; (2) `RegistroDeConectores.para` ignora el modo y envía
// con el simulador, que acepta el documento. (3) ya responde 409 con el conector `simulador`: queda de regresión.
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cargarEntorno } from '../../src/config/entorno';
import { urlDeRol } from '../utilidades/bd';
import {
  api,
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  esperarError,
  exigirPse,
  idPse,
  ponerPse,
  procesar,
  rutaPse,
  turnoDe,
  type AppFact,
  type Escenario,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const base = {
  DATABASE_URL: 'postgres://restaurante_api:x@localhost:5432/restaurante_test',
  DATABASE_PLATAFORMA_URL: 'postgres://restaurante_plataforma:x@localhost:5432/restaurante_test',
};
const produccion = {
  ...base,
  NODE_ENV: 'production',
  PIN_PEPPER: Buffer.alloc(32, 7).toString('base64'),
  ORIGENES_PERMITIDOS: 'https://app.ejemplo.pe',
  ARCHIVOS_DRIVER: 'r2',
  ARCHIVOS_URL_PUBLICA: 'https://fotos.ejemplo.pe',
  R2_ACCOUNT_ID: 'x',
  R2_ACCESS_KEY_ID: 'x',
  R2_SECRET_ACCESS_KEY: 'x',
  R2_BUCKET: 'fotos',
  R2_BUCKET_COMPROBANTES: 'comprobantes',
  CLAVE_CIFRADO: Buffer.alloc(32, 3).toString('base64'),
  DATABASE_COLAS_URL: 'postgres://restaurante_colas:x@localhost:5432/restaurante_test',
};

describe('(1) el entorno rechaza un PSE_CONECTOR sin adaptador registrado', () => {
  it.each(['development', 'test'])(
    'con NODE_ENV=%s, PSE_CONECTOR="otro" falla con un mensaje que nombra PSE_CONECTOR',
    (NODE_ENV) => {
      expect(() => cargarEntorno({ ...base, NODE_ENV, PSE_CONECTOR: 'otro' })).toThrow(
        /PSE_CONECTOR/,
      );
    },
  );

  it('en producción, PSE_CONECTOR="otro" también falla, nombrando PSE_CONECTOR', () => {
    expect(() => cargarEntorno({ ...produccion, PSE_CONECTOR: 'otro' })).toThrow(/PSE_CONECTOR/);
  });

  it('PSE_CONECTOR="simulador" sigue siendo válido en cualquier entorno (regresión)', () => {
    expect(
      cargarEntorno({ ...base, NODE_ENV: 'test', PSE_CONECTOR: 'simulador' }).PSE_CONECTOR,
    ).toBe('simulador');
    expect(cargarEntorno({ ...produccion, PSE_CONECTOR: 'simulador' }).PSE_CONECTOR).toBe(
      'simulador',
    );
  });
});

describe('(2) y (3) un emisor REAL nunca se envía con el simulador', () => {
  let ctx: AppFact;
  let esc: Escenario;

  beforeAll(async () => {
    ctx = await arrancarFact();
    esc = await crearEscenarioFact(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrar();
    await cerrarAdmin();
  });
  beforeEach(async () => {
    await exigirPse(esc);
    await esc.A.refrescarSesiones();
    ctx.pse.reglas.limpiar();
    ctx.pse.reiniciar();
    ctx.cola.vaciar();
  });

  /** Fuerza el modo REAL de un emisor en la base, con el rol de plataforma (el único con `UPDATE` sobre la tabla). */
  async function forzarReal(empresaId: string, emisorId: string): Promise<void> {
    const plataforma = new Client({ connectionString: urlDeRol('plataforma') });
    await plataforma.connect();
    try {
      await plataforma.query('BEGIN');
      await plataforma.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba-pse-real')");
      const r = await plataforma.query(
        `UPDATE configuracion_pse SET modo = 'REAL', conector = 'otro'
          WHERE empresa_id = $1 AND emisor_id = $2`,
        [empresaId, emisorId],
      );
      await plataforma.query('COMMIT');
      expect(r.rowCount, 'el emisor tenía configuración').toBe(1);
    } finally {
      await plataforma.end();
    }
  }

  it('(2) con el emisor forzado a REAL, el envío termina en ERROR_CONFIGURACION y el simulador no recibe llamadas', async () => {
    await forzarReal(esc.A.id, esc.A.emisor1);
    const turnoId = await turnoDe(ctx, esc.A, 'cajero', 'S1', 'caja1');
    const c = await cobrarLomo(ctx, esc.A, { turnoId });
    const id = await idPse(c.comprobanteId);
    await procesar(ctx, esc.A.id, c.comprobanteId);

    const delDocumento = ctx.pse
      .llamadas()
      .filter((l) => JSON.stringify(l.id) === JSON.stringify(id));
    expect(delDocumento, 'el simulador no recibió ninguna llamada de un emisor REAL').toEqual([]);
    expect(ctx.pse.recibidos(id)).toBe(0);
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'PENDIENTE',
      ultimo_resultado: 'ERROR_CONFIGURACION',
    });
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('POR_ENVIAR');
  });

  it('(2) un emisor SIMULADO sigue enviándose con el simulador (regresión)', async () => {
    const turnoId = await turnoDe(ctx, esc.B, 'cajero', 'S1', 'caja1');
    const c = await cobrarLomo(ctx, esc.B, { turnoId });
    await procesar(ctx, esc.B.id, c.comprobanteId);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(ctx.pse.recibidos(await idPse(c.comprobanteId))).toBe(1);
  });

  it('(3) el PUT con REAL responde 409 PSE_NO_CONFIGURADO sin adaptador real registrado, y el modo no cambia (regresión)', async () => {
    const res = await ponerPse(ctx, esc, esc.B.id, esc.B.emisor1, { modo: 'REAL' });
    esperarError(res, 409, 'PSE_NO_CONFIGURADO');
    const actual = await api(ctx, esc.sa.token, 'get', rutaPse(esc.B.id, esc.B.emisor1));
    expect(actual.status).toBe(200);
    expect(actual.body.modo).toBe('SIMULADO');
  });
});
