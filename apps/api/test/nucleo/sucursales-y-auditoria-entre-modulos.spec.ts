// Pruebas del desarrollador (no protegidas) de I-2: las lecturas que el módulo de seguridad hace de tablas
// ajenas pasan por sus dueños (`SucursalesConsultaService` de plataforma y `AuditoriaService`), siempre bajo
// la RLS de la empresa del contexto.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { AuditoriaService } from '../../src/modulos/auditoria';
import { SucursalesConsultaService } from '../../src/modulos/plataforma';
import { estadoActual } from '../../src/nucleo/base-de-datos/estado-operacion';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, enTransaccion, type EmpresaSql } from '../aislamiento/fabrica';

let app: INestApplication;
let contexto: ContextoEmpresa;
let sucursales: SucursalesConsultaService;
let auditoria: AuditoriaService;
let plataforma: Client;
let api: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ empresaPorHeader: false, poolMax: 2 });
  app = await crearAplicacion({ logger: false });
  contexto = app.get(ContextoEmpresa);
  sucursales = app.get(SucursalesConsultaService);
  auditoria = app.get(AuditoriaService);
  plataforma = await abrirCliente('plataforma');
  api = await abrirCliente('api');
  A = await crearEmpresaSql(plataforma, { sucursales: 3 });
  B = await crearEmpresaSql(plataforma, { sucursales: 2 });
});

afterAll(async () => {
  await app?.close();
  await plataforma?.end();
  await api?.end();
});

const idsDe = (e: EmpresaSql) => e.sucursales.map((s) => s.id);

describe('SucursalesConsultaService.existen', () => {
  it('es verdadero si todas son de la empresa del contexto, con repetidas y con la lista vacía', async () => {
    await contexto.ejecutar(A.id, async () => {
      expect(await sucursales.existen(idsDe(A))).toBe(true);
      expect(await sucursales.existen([A.sucursales[0]!.id, A.sucursales[0]!.id])).toBe(true);
      expect(await sucursales.existen([])).toBe(true);
    });
  });

  it('es falso si falta alguna: inexistente o de otra empresa (se tratan igual)', async () => {
    await contexto.ejecutar(A.id, async () => {
      expect(await sucursales.existen([randomUUID()])).toBe(false);
      expect(await sucursales.existen([A.sucursales[0]!.id, randomUUID()])).toBe(false);
      expect(await sucursales.existen([B.sucursales[0]!.id])).toBe(false);
      expect(await sucursales.existen([A.sucursales[0]!.id, B.sucursales[0]!.id])).toBe(false);
    });
  });

  it('fuera de un contexto de empresa no llega a la base', async () => {
    await expect(sucursales.existen(idsDe(A))).rejects.toThrow(/contexto/i);
  });
});

describe('SucursalesConsultaService.listar', () => {
  it('sin filtro devuelve solo las de la empresa del contexto, ordenadas por nombre y luego por id', async () => {
    const deA = await contexto.ejecutar(A.id, () => sucursales.listar(null));
    expect(deA.map((s) => s.id).sort()).toEqual(idsDe(A).sort());
    const nombres = deA.map((s) => s.nombre);
    expect(nombres).toEqual([...nombres].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    expect(deA[0]).toEqual({ id: expect.any(String), nombre: expect.any(String) });
    expect(Object.keys(deA[0]!).sort()).toEqual(['id', 'nombre']);
    const deB = await contexto.ejecutar(B.id, () => sucursales.listar(null));
    expect(deB.map((s) => s.id).sort()).toEqual(idsDe(B).sort());
  });

  it('con ids devuelve solo esas, sin las inexistentes ni las de otra empresa, y con la lista vacía no consulta', async () => {
    await contexto.ejecutar(A.id, async () => {
      const dos = [A.sucursales[0]!.id, A.sucursales[2]!.id];
      expect((await sucursales.listar(dos)).map((s) => s.id).sort()).toEqual([...dos].sort());
      expect(
        (await sucursales.listar([...dos, dos[0]!, randomUUID(), B.sucursales[0]!.id]))
          .map((s) => s.id)
          .sort(),
      ).toEqual([...dos].sort());
      expect(await sucursales.listar([])).toEqual([]);
      expect(await sucursales.listar([B.sucursales[0]!.id])).toEqual([]);
    });
  });

  it('acepta la transacción del contexto como argumento y da lo mismo que sin ella', async () => {
    await contexto.ejecutar(A.id, async () => {
      const transaccion = estadoActual()!.transaccion!;
      expect(await sucursales.listar(null, transaccion)).toEqual(await sucursales.listar(null));
      expect(await sucursales.existen(idsDe(A), transaccion)).toBe(true);
      expect(await sucursales.listar(idsDe(A).slice(0, 1), transaccion)).toHaveLength(1);
    });
  });
});

describe('AuditoriaService.detalleDeAccionDeSesion', () => {
  it('devuelve el detalle de la primera fila de esa acción y sesión de la empresa del contexto, o null', async () => {
    const sesionId = randomUUID();
    // Tres filas de A por SQL como `restaurante_api` (el actor lo pone la base): dos `inicio_soporte` de la
    // misma sesión (cuenta la más antigua) y otra acción.
    await enTransaccion(
      api,
      A.id,
      async () => {
        await api.query(
          `INSERT INTO auditoria (empresa_id, origen, accion, sesion_id, detalle, ocurrido_en)
           VALUES ($1, 'empresa', 'inicio_soporte', $2, $3::jsonb, '2026-11-02T10:05:00-05:00'),
                  ($1, 'empresa', 'inicio_soporte', $2, $4::jsonb, '2026-11-02T10:00:00-05:00'),
                  ($1, 'empresa', 'otra_accion', $2, $5::jsonb, '2026-11-02T09:00:00-05:00')`,
          [
            A.id,
            sesionId,
            JSON.stringify({ superadministrador: { nombre: 'Segunda' } }),
            JSON.stringify({ superadministrador: { nombre: 'Ana' } }),
            JSON.stringify({ x: 1 }),
          ],
        );
      },
      { confirmar: true, actor: 'prueba-lectura-auditoria' },
    );
    const leer = (empresa: EmpresaSql, sesion: string, accion: string) =>
      contexto.ejecutar(empresa.id, () => auditoria.detalleDeAccionDeSesion(sesion, accion));

    expect(await leer(A, sesionId, 'inicio_soporte')).toEqual({
      superadministrador: { nombre: 'Ana' },
    });
    expect(await leer(A, sesionId, 'otra_accion')).toEqual({ x: 1 });
    expect(await leer(A, sesionId, 'no_existe')).toBeNull();
    expect(await leer(A, randomUUID(), 'inicio_soporte')).toBeNull();
    // Otra empresa no ve la fila de A aunque conozca el id de la sesión.
    expect(await leer(B, sesionId, 'inicio_soporte')).toBeNull();
  });
});
