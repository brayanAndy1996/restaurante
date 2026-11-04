import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { fijarEntornoDePrueba, rutasDeNest } from '../utilidades';

// Fase A de la historia 006 (prueba del desarrollador, no protegida): los módulos de caja y facturación están
// registrados con todas las rutas de la tabla de endpoints de la entrega 6a, y ninguna cuelga de /ordenes, /salon ni
// /cocina (criterio 98: así la clasificación protegida de 004 no cambia). La clasificación con permisos y módulos y
// su recorrido completo son de las pruebas protegidas de la fase B.

const RUTAS_6A = [
  'GET /sucursales/:sucursalId/cajas',
  'POST /sucursales/:sucursalId/cajas',
  'PATCH /sucursales/:sucursalId/cajas/:id',
  'PUT /sucursales/:sucursalId/cajas/:cajaId/series/:tipo',
  'GET /emisores/:id/tasas-igv',
  'PUT /emisores/:id/tasas-igv/:desde',
  'GET /cajas',
  'POST /turnos',
  'GET /turnos/mio',
  'GET /turnos/:id',
  'POST /turnos/:id/movimientos',
  'GET /turnos/:id/reporte',
  'POST /turnos/:id/reporte-x/impresiones',
  'POST /turnos/:id/cierre',
  'GET /cuentas',
  'GET /cuentas/:ordenId',
  'POST /cuentas/:ordenId/descuentos',
  'DELETE /cuentas/:ordenId/descuentos/:id',
  'POST /cuentas/:ordenId/cortesias',
  'DELETE /cuentas/:ordenId/cortesias/:id',
  'POST /cuentas/:ordenId/cobros',
  'POST /ventas-mostrador',
  'GET /comprobantes/:id',
  'GET /comprobantes',
  'POST /comprobantes/:id/impresiones',
];

describe('rutas de la entrega 6a (fase A)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion();
  });
  afterAll(async () => {
    await app.close();
  });

  it('están registradas todas las rutas de la tabla de endpoints, sin repetir ninguna', () => {
    const registradas = rutasDeNest(app).map((r) => `${r.metodo} ${r.ruta}`);
    for (const esperada of RUTAS_6A) expect(registradas, esperada).toContain(esperada);
    expect(new Set(registradas).size).toBe(registradas.length);
  });

  it('ninguna ruta de caja, cuentas, turnos, mostrador o comprobantes cuelga de /ordenes, /salon ni /cocina', () => {
    for (const ruta of RUTAS_6A) {
      const camino = ruta.split(' ')[1]!;
      expect(camino, ruta).not.toMatch(/^\/(ordenes|salon|cocina)(\/|$)/);
    }
  });
});
