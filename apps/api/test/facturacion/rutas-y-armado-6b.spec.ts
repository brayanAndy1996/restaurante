import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { crearWorker } from '../../src/crear-worker';
import { CONECTOR_PSE, SimuladorPse } from '../../src/modulos/facturacion';
import { PERMISO, PUBLICA, REQUIERE_MODULO } from '../../src/modulos/seguridad';
import { EmpresasConsulta, SUPERADMINISTRADOR } from '../../src/modulos/plataforma';
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

/** Rutas de 6b que ya llevan `@Permiso` y `@RequiereModulo` (T36: la búsqueda del padrón). */
const CLASIFICADAS = [
  'GET /padron/ruc/:ruc',
  // T32: el panel, el reintento, la reemisión, el PDF, el enlace y las alertas.
  'GET /facturacion/comprobantes',
  'GET /facturacion/comprobantes/:id',
  'POST /facturacion/comprobantes/:id/reintento',
  'POST /facturacion/comprobantes/:id/reemision',
  'GET /facturacion/comprobantes/:id/pdf',
  'GET /facturacion/comprobantes/:id/enlace',
  'GET /facturacion/alertas',
  // T40: la nota de crédito (`EMITIR_NOTA_CREDITO` y `FACTURACION`).
  'POST /notas-credito',
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
    // Las que ya tienen su acceso (la fase C las va clasificando; la clasificación completa es de las pruebas protegidas).
    for (const r of de6b.filter((r) => !CLASIFICADAS.includes(`${r.metodo} ${r.ruta}`))) {
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

  it('la única ruta pública de 6b es GET /publico/comprobantes/:sello, @Publica() y sin permiso ni módulo (T43)', () => {
    const publicas = rutasDeNest(app).filter((r) => r.ruta.startsWith('/publico/comprobantes'));
    expect(publicas.map((r) => `${r.metodo} ${r.ruta}`)).toEqual([
      'GET /publico/comprobantes/:sello',
    ]);
    const r = publicas[0]!;
    const manejador = r.controlador.prototype[r.manejador] as object;
    const leer = (llave: string) =>
      Reflect.getMetadata(llave, manejador) ?? Reflect.getMetadata(llave, r.controlador);
    expect(leer(PUBLICA)).toBe(true);
    expect(leer(PERMISO)).toBeUndefined();
    expect(leer(REQUIERE_MODULO)).toBeUndefined();
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

  it('las rutas clasificadas piden sucursal activa antes de ejecutar nada (con una sesión de prueba sin sucursal)', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const empresa = '22222222-2222-2222-2222-222222222222';
    const servidor = () => request(app.getHttpServer());
    const res = await servidor()
      .get(`/facturacion/comprobantes/${id}/enlace`)
      .set('x-empresa-id', empresa);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('SUCURSAL_NO_ELEGIDA');
  });
});

describe('crearWorker', () => {
  it('arma el contexto sin HTTP con las piezas que se le pasan y se cierra', async () => {
    fijarEntornoDePrueba();
    const pse = new SimuladorPse();
    const cola = new ColaEnMemoria();
    const worker = await crearWorker({ pse, colaPse: cola });
    try {
      expect(worker.contexto.get(CONECTOR_PSE, { strict: false })).toBe(pse);
      expect(worker.contexto.get(COLA_PSE, { strict: false })).toBe(cola);
      // Un trabajo con un comprobante que no existe termina sin hacer nada (T31).
      await expect(
        worker.procesador.procesar(
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
        ),
      ).resolves.toBeUndefined();
      // El barrido recorre las empresas (aquí ninguna: otros archivos comparten la base) y el worker arranca y se
      // detiene sin dejar nada vivo.
      vi.spyOn(worker.contexto.get(EmpresasConsulta), 'ids').mockResolvedValue([]);
      await expect(worker.barrido.barrerAhora()).resolves.toEqual({
        reencolados: 0,
        detenidos: 0,
        alertas: 0,
        pdfPendientes: 0,
      });
      await expect(worker.iniciar()).resolves.toBeUndefined();
    } finally {
      await worker.cerrar();
    }
  });
});
