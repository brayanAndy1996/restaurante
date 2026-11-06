import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { crearWorker } from '../../src/crear-worker';
import { CONECTOR_PSE, SimuladorPse } from '../../src/modulos/facturacion';
import { PERMISO, PUBLICA, REQUIERE_MODULO } from '../../src/modulos/seguridad';
import { SUPERADMINISTRADOR } from '../../src/modulos/plataforma';
import { ALMACEN_COMPROBANTES, AlmacenComprobantesEnMemoria } from '../../src/nucleo/archivos';
import { COLA_PSE, ColaEnMemoria } from '../../src/nucleo/colas';
import { fijarEntornoDePrueba, rutasDeNest } from '../utilidades';

// Fase A de la entrega 6b de la historia 006 (prueba del desarrollador, no protegida): las rutas de «Endpoints (6b)» están
// registradas sin @Permiso ni @RequiereModulo, ninguna cuelga de los prefijos de 6a, `crearAplicacion` y `crearWorker`
// aceptan sus piezas de prueba y el worker se arma sin HTTP. La clasificación completa es de las pruebas protegidas de la
// fase B (P10).

const RUTAS_6B = [
  'GET /facturacion/comprobantes',
  'GET /facturacion/comprobantes/:id',
  'POST /facturacion/comprobantes/:id/reintento',
  'POST /facturacion/comprobantes/:id/reemision',
  'GET /facturacion/comprobantes/:id/pdf',
  'GET /facturacion/comprobantes/:id/enlace',
  'GET /facturacion/alertas',
  'POST /notas-credito',
  'GET /padron/ruc/:ruc',
  'GET /plataforma/empresas/:empresaId/emisores/:emisorId/pse',
  'PUT /plataforma/empresas/:empresaId/emisores/:emisorId/pse',
  'GET /plataforma/facturacion/alertas',
  'GET /plataforma/padron',
  'POST /plataforma/padron/carga',
];

/** Los prefijos de 6a que la clasificación protegida de 6a (criterio 98) vigila. */
const PREFIJOS_6A = [
  '/turnos',
  '/cajas',
  '/cuentas',
  '/ventas-mostrador',
  '/comprobantes',
  '/ordenes',
  '/salon',
  '/cocina',
];

describe('rutas de la entrega 6b (fase A)', () => {
  let app: INestApplication;
  const pse = new SimuladorPse();
  const cola = new ColaEnMemoria();
  const almacen = new AlmacenComprobantesEnMemoria();

  beforeAll(async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion({ pse, colaPse: cola, almacenComprobantes: almacen });
  });
  afterAll(async () => {
    await app.close();
  });

  it('están registradas todas las rutas, sin repetir ninguna', () => {
    const registradas = rutasDeNest(app).map((r) => `${r.metodo} ${r.ruta}`);
    for (const esperada of RUTAS_6B) expect(registradas, esperada).toContain(esperada);
    expect(new Set(registradas).size).toBe(registradas.length);
  });

  it('ninguna cuelga de los prefijos de 6a', () => {
    for (const ruta of RUTAS_6B) {
      const camino = ruta.split(' ')[1] ?? '';
      for (const prefijo of PREFIJOS_6A) {
        expect(camino === prefijo || camino.startsWith(`${prefijo}/`), `${ruta} ~ ${prefijo}`).toBe(
          false,
        );
      }
    }
  });

  it('sin @Permiso ni @RequiereModulo todavía (se agregan en la fase C), ninguna pública', () => {
    const de6b = rutasDeNest(app).filter((r) => RUTAS_6B.includes(`${r.metodo} ${r.ruta}`));
    expect(de6b).toHaveLength(RUTAS_6B.length);
    for (const r of de6b) {
      const manejador = r.controlador.prototype[r.manejador] as object;
      const leer = (llave: string) =>
        Reflect.getMetadata(llave, manejador) ?? Reflect.getMetadata(llave, r.controlador);
      expect(leer(PERMISO), `${r.metodo} ${r.ruta}`).toBeUndefined();
      expect(leer(REQUIERE_MODULO), `${r.metodo} ${r.ruta}`).toBeUndefined();
      expect(leer(PUBLICA), `${r.metodo} ${r.ruta}`).toBeUndefined();
    }
  });

  it('las de /plataforma llevan la guarda de superadministrador (regla general de 002)', () => {
    const deLaPlataforma = rutasDeNest(app).filter(
      (r) => RUTAS_6B.includes(`${r.metodo} ${r.ruta}`) && r.ruta.startsWith('/plataforma'),
    );
    expect(deLaPlataforma).toHaveLength(5);
    for (const r of deLaPlataforma) {
      expect(Reflect.getMetadata(SUPERADMINISTRADOR, r.controlador), `${r.metodo} ${r.ruta}`).toBe(
        true,
      );
    }
  });

  it('la ruta pública de los enlaces todavía no está registrada (choca con pruebas protegidas de 3b y 005)', () => {
    const registradas = rutasDeNest(app).map((r) => r.ruta);
    expect(registradas.filter((r) => r.startsWith('/publico/comprobantes'))).toEqual([]);
  });

  it('crearAplicacion usa el conector, la cola y el almacén que se le pasan', () => {
    expect(app.get(CONECTOR_PSE, { strict: false })).toBe(pse);
    expect(app.get(COLA_PSE, { strict: false })).toBe(cola);
    expect(app.get(ALMACEN_COMPROBANTES, { strict: false })).toBe(almacen);
  });

  it('sin piezas de prueba usa un simulador, la cola y el almacén en memoria', async () => {
    fijarEntornoDePrueba();
    const otra = await crearAplicacion();
    try {
      expect(otra.get(CONECTOR_PSE, { strict: false })).toBeInstanceOf(SimuladorPse);
      expect(otra.get(COLA_PSE, { strict: false })).toBeInstanceOf(ColaEnMemoria);
      expect(otra.get(ALMACEN_COMPROBANTES, { strict: false })).toBeInstanceOf(
        AlmacenComprobantesEnMemoria,
      );
    } finally {
      await otra.close();
    }
  });

  it('las rutas responden «No implementado» como 500 sin detalles (con una sesión de prueba)', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const empresa = '22222222-2222-2222-2222-222222222222';
    const servidor = () => request(app.getHttpServer());
    const res = await servidor()
      .get(`/facturacion/comprobantes/${id}/enlace`)
      .set('x-empresa-id', empresa);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('No implementado');
  });
});

describe('crearWorker (fase A)', () => {
  it('arma el contexto sin HTTP con las piezas que se le pasan y se cierra', async () => {
    fijarEntornoDePrueba();
    const pse = new SimuladorPse();
    const cola = new ColaEnMemoria();
    const worker = await crearWorker({ pse, colaPse: cola });
    try {
      expect(worker.contexto.get(CONECTOR_PSE, { strict: false })).toBe(pse);
      expect(worker.contexto.get(COLA_PSE, { strict: false })).toBe(cola);
      await expect(
        worker.procesador.procesar('11111111-1111-1111-1111-111111111111', 'x'),
      ).rejects.toThrow('No implementado');
      await expect(worker.barrido.barrerAhora()).rejects.toThrow('No implementado');
      await expect(worker.iniciar()).rejects.toThrow('No implementado');
    } finally {
      await worker.cerrar();
    }
  });
});
