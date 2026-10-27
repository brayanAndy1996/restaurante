// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterios 34, 39 y 40 y formato de errores (fallas F5 y F6 del adversarial):
// - F5: el carácter NUL (U+0000) en un texto es un dato mal formado: `PATCH /sucursales/:id` responde
//   400 `DATOS_INVALIDOS` con el campo, y `registrarEmpresa`, `agregarEmisor` y `agregarSucursal`
//   lanzan un error de validación; en ningún caso se crea ni cambia nada (ni se audita).
// - F6: un cuerpo JSON de más de 100 KB responde 413 `CUERPO_DEMASIADO_GRANDE` con `{ codigo,
//   mensaje }` (no un 500 `ERROR_INTERNO`), y la sucursal no cambia.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { PlataformaEmpresasService } from '../../src/modulos/plataforma';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import {
  crearEmpresaSql,
  datosDeEmpresa,
  fotoDeFila,
  rucAleatorio,
  textoUnico,
  type EmpresaSql,
} from './fabrica';

let app: INestApplication;
let servicio: PlataformaEmpresasService;
let plataforma: Client;
let A: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba();
  app = await crearAplicacion();
  await app.init();
  servicio = app.get(PlataformaEmpresasService);
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await plataforma?.end();
});

const http = () => request(app.getHttpServer());
const comoA = () => ({ 'x-empresa-id': A.id });
const NUL = '\u0000';

interface CampoError {
  campo: string;
  mensaje: string;
}

describe('criterio 40 · PATCH /sucursales/:id con NUL en un texto es DATOS_INVALIDOS', () => {
  it.each([
    ['nombre', { nombre: `a${NUL}b` }],
    ['direccion', { direccion: `Calle${NUL}1` }],
  ] as const)(
    'NUL en %s responde 400 con el campo y la sucursal no cambia',
    async (campo, cambios) => {
      const id = A.sucursales[0]!.id;
      const antes = await fotoDeFila(plataforma, 'sucursal', id);

      const res = await http().patch(`/sucursales/${id}`).set(comoA()).send(cambios);

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
      const campos = ((res.body.campos ?? []) as CampoError[]).map((c) => c.campo);
      expect(campos).toContain(campo);
      expect(await fotoDeFila(plataforma, 'sucursal', id)).toEqual(antes);
    },
  );

  it('control · el mismo PATCH sin NUL sí cambia la sucursal', async () => {
    const id = A.sucursales[1]!.id;
    const nombre = textoUnico('Renombrada');
    const res = await http().patch(`/sucursales/${id}`).set(comoA()).send({ nombre });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id, nombre });
  });
});

describe('criterio 34 · las operaciones de plataforma rechazan NUL y no dejan nada', () => {
  async function errorLanzado(promesa: Promise<unknown>): Promise<Error> {
    try {
      await promesa;
    } catch (error) {
      return error as Error;
    }
    throw new Error('Se esperaba un error de validación, pero la operación tuvo éxito');
  }

  function textoDeError(error: Error): string {
    const extra = error as unknown as Record<string, unknown>;
    const partes = [error.message];
    for (const clave of ['campos', 'issues', 'errors', 'response']) {
      if (extra[clave] !== undefined) partes.push(JSON.stringify(extra[clave]));
    }
    return partes.join(' ');
  }

  /** Un error de validación indica el campo y no es un error crudo de la base de datos. */
  function exigirValidacion(error: Error, campo: string) {
    expect(error.name, `error de base de datos en vez de validación: ${error.message}`).not.toMatch(
      /Sequelize|Database/i,
    );
    expect(textoDeError(error)).not.toMatch(/invalid byte sequence|22021/i);
    expect(textoDeError(error)).toContain(campo);
  }

  const auditoriasDe = async (actor: string) =>
    (
      await plataforma.query(
        "SELECT 1 FROM auditoria WHERE origen = 'plataforma' AND actor_sistema = $1",
        [actor],
      )
    ).rows.length;

  const contar = async (tabla: 'emisor' | 'sucursal', empresaId: string) =>
    (
      await plataforma.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${tabla} WHERE empresa_id = $1`,
        [empresaId],
      )
    ).rows[0]!.n;

  describe('registrarEmpresa', () => {
    const variantes: [string, string, (d: ReturnType<typeof datosDeEmpresa>) => void][] = [
      ['nombre de la empresa', 'nombre', (d) => void (d.nombre = `${d.nombre}${NUL}x`)],
      [
        'razón social del emisor',
        'razonSocial',
        (d) => void (d.emisores[0]!.razonSocial = `Razón${NUL}social`),
      ],
      [
        'nombre de la sucursal',
        'nombre',
        (d) => void (d.sucursales[0]!.nombre = `Sucursal${NUL}1`),
      ],
      [
        'dirección de la sucursal',
        'direccion',
        (d) => void (d.sucursales[0]!.direccion = `Av. ${NUL} 123`),
      ],
    ];

    it.each(variantes)(
      'NUL en %s: error de validación y nada creado ni auditado',
      async (_nombre, campo, alterar) => {
        const datos = datosDeEmpresa();
        alterar(datos);
        const actor = textoUnico('actor-nul');

        const error = await errorLanzado(
          servicio.registrarEmpresa(datos, { actor, motivo: 'NUL' }),
        );

        exigirValidacion(error, campo);
        const emisores = await plataforma.query('SELECT 1 FROM emisor WHERE ruc = $1', [
          datos.emisores[0]!.ruc,
        ]);
        expect(emisores.rows).toEqual([]);
        expect(await auditoriasDe(actor)).toBe(0);
      },
    );
  });

  describe('agregarEmisor y agregarSucursal', () => {
    it('agregarEmisor con NUL en la razón social: error de validación y nada creado ni auditado', async () => {
      const actor = textoUnico('actor-nul-emisor');
      const antes = await contar('emisor', A.id);
      const error = await errorLanzado(
        servicio.agregarEmisor(
          A.id,
          { ruc: rucAleatorio(), razonSocial: `Razón${NUL}social`, regimen: 'GENERAL' },
          { actor, motivo: 'NUL' },
        ),
      );
      exigirValidacion(error, 'razonSocial');
      expect(await contar('emisor', A.id)).toBe(antes);
      expect(await auditoriasDe(actor)).toBe(0);
    });

    it.each([
      ['nombre', { nombre: `Sucursal${NUL}1` }],
      ['direccion', { direccion: `Av. ${NUL} 123` }],
    ] as const)(
      'agregarSucursal con NUL en %s: error de validación y nada creado ni auditado',
      async (campo, alterado) => {
        const actor = textoUnico('actor-nul-sucursal');
        const antes = await contar('sucursal', A.id);
        const error = await errorLanzado(
          servicio.agregarSucursal(
            A.id,
            {
              rucEmisor: A.emisores[0]!.ruc,
              nombre: textoUnico('Sucursal'),
              codigoEstablecimiento: '0099',
              direccion: 'Av. Prueba 123, Lima',
              ...alterado,
            },
            { actor, motivo: 'NUL' },
          ),
        );
        exigirValidacion(error, campo);
        expect(await contar('sucursal', A.id)).toBe(antes);
        expect(await auditoriasDe(actor)).toBe(0);
      },
    );
  });
});

describe('formato de errores · cuerpo JSON de más de 100 KB', () => {
  it('PATCH /sucursales/:id responde 413 CUERPO_DEMASIADO_GRANDE (no 500) y la sucursal no cambia', async () => {
    const id = A.sucursales[0]!.id;
    const antes = await fotoDeFila(plataforma, 'sucursal', id);

    const res = await http()
      .patch(`/sucursales/${id}`)
      .set(comoA())
      .send({ direccion: 'x'.repeat(200_000) });

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(413);
    expect(res.body).toMatchObject({ codigo: 'CUERPO_DEMASIADO_GRANDE' });
    expect(typeof res.body.mensaje).toBe('string');
    expect(res.body.mensaje.length).toBeGreaterThan(0);
    expect(await fotoDeFila(plataforma, 'sucursal', id)).toEqual(antes);
  });
});
