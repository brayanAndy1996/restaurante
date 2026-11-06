// spec: 006-caja-cobro (criterio 139 y 140; el 404 del padrón lleva padronAl, prueba del desarrollador)
//
// `RUC_NO_ENCONTRADO` lleva `padronAl` (la fecha de la carga activa, igual que el 200) para el aviso «no figura en el padrón de
// SUNAT del …». No carga el padrón (la carga es de `padron-aislamiento.spec.ts`, que espera el estado «sin carga» al empezar):
// la lógica del servicio se prueba con una conexión de papel y la función de la base, sin escribir nada.
import { errorRespuestaSchema } from '@restaurante/contratos';
import type { Sequelize } from 'sequelize';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PadronService } from '../../src/modulos/facturacion/padron/padron.service';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import { abrirCliente } from '../utilidades';

/** Una conexión de papel: `padron_buscar_ruc` no encuentra nada y `padron_cargado_en` da `cargado`. */
function conexionDePapel(cargado: Date | string | null): Sequelize {
  return {
    query: (sql: string) =>
      Promise.resolve(sql.includes('padron_cargado_en') ? [{ cargado_en: cargado }] : []),
  } as unknown as Sequelize;
}

async function errorDe(servicio: PadronService): Promise<ErrorAplicacion> {
  try {
    await servicio.buscar('20123456786');
  } catch (error) {
    return error as ErrorAplicacion;
  }
  throw new Error('Se esperaba RUC_NO_ENCONTRADO');
}

describe('criterio 139 · el 404 RUC_NO_ENCONTRADO lleva padronAl', () => {
  it('con una carga activa, el detalle lleva el instante de la carga en ISO 8601', async () => {
    const error = await errorDe(
      new PadronService(conexionDePapel(new Date('2026-11-05T09:00:00.000Z'))),
    );
    expect(error.getStatus()).toBe(404);
    expect(error.codigo).toBe('RUC_NO_ENCONTRADO');
    expect(error.detalle).toEqual({ padronAl: '2026-11-05T09:00:00.000Z' });
  });

  it('acepta el instante como texto de la base y lo normaliza', async () => {
    const error = await errorDe(new PadronService(conexionDePapel('2026-11-05 04:00:00+00')));
    expect(error.detalle).toEqual({ padronAl: '2026-11-05T04:00:00.000Z' });
  });

  it('si la base no da fecha, el 404 sale igual, sin detalle', async () => {
    const error = await errorDe(new PadronService(conexionDePapel(null)));
    expect(error.codigo).toBe('RUC_NO_ENCONTRADO');
    expect(error.detalle).toBeUndefined();
  });

  it('el contrato de errores acepta padronAl', () => {
    const cuerpo = {
      codigo: 'RUC_NO_ENCONTRADO',
      mensaje: 'Este RUC no figura en el padrón de SUNAT',
      padronAl: '2026-11-05T09:00:00.000Z',
    };
    expect(errorRespuestaSchema.parse(cuerpo)).toEqual(cuerpo);
  });
});

describe('criterio 139 · public.padron_cargado_en()', () => {
  let admin: Client;
  let api: Client;
  beforeAll(async () => {
    admin = await abrirCliente('admin');
    api = await abrirCliente('api');
  });
  afterAll(async () => {
    await admin?.end();
    await api?.end();
  });

  it('es SECURITY DEFINER, STABLE, de restaurante_migrador, con search_path fijo y EXECUTE solo para la API', async () => {
    const { rows } = await admin.query<{
      definer: boolean;
      volatil: string;
      dueno: string;
      config: string[];
      api: boolean;
      plataforma: boolean;
      publico: number;
    }>(
      `SELECT p.prosecdef AS definer, p.provolatile AS volatil, pg_get_userbyid(p.proowner) AS dueno,
              p.proconfig AS config,
              has_function_privilege('restaurante_api', p.oid, 'EXECUTE') AS api,
              has_function_privilege('restaurante_plataforma', p.oid, 'EXECUTE') AS plataforma,
              (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'padron_cargado_en'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      definer: true,
      volatil: 's',
      dueno: 'restaurante_migrador',
      api: true,
      plataforma: false,
      publico: 0,
    });
    expect(rows[0]!.config).toEqual(['search_path=pg_catalog, pg_temp']);
  });

  it('da el mismo instante que el estado de la carga (o nada si no hay carga) y la API no lee referencia.*', async () => {
    const estado = await admin.query<{ cargado_en: Date | null }>(
      'SELECT cargado_en FROM referencia.padron_estado WHERE tabla_activa IS NOT NULL',
    );
    const funcion = await api.query<{ cargado_en: Date | null }>(
      'SELECT public.padron_cargado_en() AS cargado_en',
    );
    expect(funcion.rows[0]!.cargado_en ?? null).toEqual(estado.rows[0]?.cargado_en ?? null);
    await expect(api.query('SELECT * FROM referencia.padron_estado')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
