// spec: 001-base-multitenancy (pruebas protegidas)
//
// P6 · Criterios 32 a 35 y 35b: `registrarEmpresa`, `agregarEmisor` y `agregarSucursal` con auditoría,
// actor o motivo vacíos, datos inválidos sin dejar rastro, y hora de corte `05:00` cuando la
// sucursal se da de alta sin `horaCorte` (por el servicio y por SQL como `restaurante_api`).
import type { INestApplication } from '@nestjs/common';
import type {
  EmisorEntrada,
  RegistrarEmpresaEntrada,
  SucursalEntrada,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import {
  OperacionPlataforma,
  PlataformaEmpresasService,
  SucursalService,
} from '../../src/modulos/plataforma';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import {
  crearEmpresaSql,
  datosDeEmpresa,
  enTransaccion,
  rucAleatorio,
  textoUnico,
  type EmpresaSql,
} from './fabrica';

let app: INestApplication;
let servicio: PlataformaEmpresasService;
let operacion: OperacionPlataforma;
let contexto: ContextoEmpresa;
let sucursales: SucursalService;
let plataforma: Client;
let api: Client;

beforeAll(async () => {
  fijarEntornoDePrueba();
  app = await crearAplicacion();
  servicio = app.get(PlataformaEmpresasService);
  operacion = app.get(OperacionPlataforma);
  contexto = app.get(ContextoEmpresa);
  sucursales = app.get(SucursalService);
  plataforma = await abrirCliente('plataforma');
  api = await abrirCliente('api');
});

afterAll(async () => {
  await app?.close();
  await plataforma?.end();
  await api?.end();
});

/** Texto con el mensaje del error y los campos que traiga (ErrorAplicacion, ZodError…), para buscar el campo. */
function textoDeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const extra = error as unknown as Record<string, unknown>;
  const partes = [error.message];
  for (const clave of ['campos', 'issues', 'errors', 'response']) {
    if (extra[clave] !== undefined) partes.push(JSON.stringify(extra[clave]));
  }
  return partes.join(' ');
}

async function errorLanzado(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error de validación, pero la operación tuvo éxito');
}

const auditoriasDe = (empresaId: string, operacionNombre: string) =>
  plataforma.query(
    "SELECT actor_sistema AS actor, accion AS operacion, motivo, empresa_id, detalle FROM auditoria WHERE origen = 'plataforma' AND empresa_id = $1 AND accion = $2",
    [empresaId, operacionNombre],
  );

const horaCorteDe = async (sucursalId: string) =>
  (
    await plataforma.query<{ hora: string }>(
      `SELECT to_char(hora_corte, 'HH24:MI') AS hora FROM sucursal WHERE id = $1`,
      [sucursalId],
    )
  ).rows[0]?.hora;

describe('criterio 32 · registrarEmpresa', () => {
  it('crea empresa, emisores, sucursales y una fila de auditoría en una sola operación', async () => {
    const datos = datosDeEmpresa({ emisores: 2, sucursalesPorEmisor: 2 });
    datos.sucursales[0] = {
      ...datos.sucursales[0]!,
      horario: [
        { dia: 1, desde: '09:00', hasta: '23:00' },
        { dia: 5, desde: '18:00', hasta: '02:00' },
      ],
      whatsapp: '+51999888777',
      horaCorte: '03:30',
    };
    const auditoria = { actor: textoUnico('actor-32'), motivo: 'Alta de empresa de prueba' };

    const resultado = await servicio.registrarEmpresa(datos, auditoria);

    expect(resultado.empresaId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(resultado.emisores.map((e) => e.ruc).sort()).toEqual(
      datos.emisores.map((e) => e.ruc).sort(),
    );
    expect(resultado.sucursales.map((s) => s.nombre).sort()).toEqual(
      datos.sucursales.map((s) => s.nombre).sort(),
    );

    const empresa = await plataforma.query('SELECT nombre FROM empresa WHERE id = $1', [
      resultado.empresaId,
    ]);
    expect(empresa.rows).toEqual([{ nombre: datos.nombre }]);

    const emisores = await plataforma.query(
      'SELECT id, ruc, razon_social, regimen FROM emisor WHERE empresa_id = $1',
      [resultado.empresaId],
    );
    expect(emisores.rows).toHaveLength(2);
    for (const entrada of datos.emisores) {
      const fila = emisores.rows.find((f) => f.ruc === entrada.ruc);
      expect(fila, `emisor ${entrada.ruc}`).toMatchObject({
        razon_social: entrada.razonSocial,
        regimen: entrada.regimen,
      });
      expect(resultado.emisores).toContainEqual({ id: fila.id, ruc: entrada.ruc });
    }

    const filasSucursal = await plataforma.query(
      `SELECT id, emisor_id, nombre, codigo_establecimiento, direccion, horario, whatsapp,
              to_char(hora_corte, 'HH24:MI') AS hora_corte
         FROM sucursal WHERE empresa_id = $1`,
      [resultado.empresaId],
    );
    expect(filasSucursal.rows).toHaveLength(datos.sucursales.length);
    for (const entrada of datos.sucursales) {
      const fila = filasSucursal.rows.find((f) => f.nombre === entrada.nombre);
      const emisor = emisores.rows.find((f) => f.ruc === entrada.rucEmisor);
      expect(fila, `sucursal ${entrada.nombre}`).toMatchObject({
        emisor_id: emisor.id,
        codigo_establecimiento: entrada.codigoEstablecimiento,
        direccion: entrada.direccion,
        horario: entrada.horario ?? [],
        whatsapp: entrada.whatsapp ?? null,
        hora_corte: entrada.horaCorte ?? '05:00',
      });
      expect(resultado.sucursales).toContainEqual({ id: fila.id, nombre: entrada.nombre });
    }

    const auditorias = await auditoriasDe(resultado.empresaId, 'registrar_empresa');
    expect(auditorias.rows).toHaveLength(1);
    expect(auditorias.rows[0]).toMatchObject({ actor: auditoria.actor, motivo: auditoria.motivo });
    const detalle = JSON.stringify(auditorias.rows[0].detalle);
    for (const emisor of datos.emisores) expect(detalle).toContain(emisor.ruc);
    for (const sucursal of datos.sucursales) expect(detalle).toContain(sucursal.nombre);
  });
});

describe('criterio 33 · actor o motivo vacíos', () => {
  const combinaciones: [string, string, string][] = [
    ['actor vacío', '', 'motivo válido'],
    ['actor solo con espacios', '   ', 'motivo válido'],
    ['motivo vacío', 'actor-valido', ''],
    ['motivo solo con espacios', 'actor-valido', ' \t '],
  ];

  async function nadaAuditado(actor: string, motivo: string) {
    const { rows } = await plataforma.query(
      "SELECT 1 FROM auditoria WHERE origen = 'plataforma' AND actor_sistema = $1 AND motivo = $2",
      [actor, motivo],
    );
    expect(rows, 'no debe quedar fila de auditoría').toEqual([]);
  }

  it.each(combinaciones)(
    'registrarEmpresa con %s lanza un error de validación y no crea nada',
    async (_n, actor0, motivo0) => {
      const actor = actor0 === 'actor-valido' ? textoUnico('actor-33') : actor0;
      const motivo = motivo0 === 'motivo válido' ? textoUnico('motivo-33') : motivo0;
      const datos = datosDeEmpresa();
      const error = await errorLanzado(servicio.registrarEmpresa(datos, { actor, motivo }));
      expect(textoDeError(error)).toMatch(/actor|motivo/i);

      const empresas = await plataforma.query('SELECT 1 FROM empresa WHERE nombre = $1', [
        datos.nombre,
      ]);
      expect(empresas.rows).toEqual([]);
      const emisores = await plataforma.query('SELECT 1 FROM emisor WHERE ruc = ANY($1::text[])', [
        datos.emisores.map((e) => e.ruc),
      ]);
      expect(emisores.rows).toEqual([]);
      await nadaAuditado(actor, motivo);
    },
  );

  describe('sobre una empresa existente', () => {
    let empresa: EmpresaSql;
    beforeAll(async () => {
      empresa = await crearEmpresaSql(plataforma);
    });

    it.each(combinaciones)(
      'agregarEmisor con %s lanza un error de validación y no crea nada',
      async (_n, actor0, motivo0) => {
        const actor = actor0 === 'actor-valido' ? textoUnico('actor-33') : actor0;
        const motivo = motivo0 === 'motivo válido' ? textoUnico('motivo-33') : motivo0;
        const nuevo: EmisorEntrada = {
          ruc: rucAleatorio(),
          razonSocial: 'No debe existir SAC',
          regimen: 'RER',
        };
        const error = await errorLanzado(
          servicio.agregarEmisor(empresa.id, nuevo, { actor, motivo }),
        );
        expect(textoDeError(error)).toMatch(/actor|motivo/i);
        const emisores = await plataforma.query('SELECT 1 FROM emisor WHERE ruc = $1', [nuevo.ruc]);
        expect(emisores.rows).toEqual([]);
        await nadaAuditado(actor, motivo);
      },
    );

    it.each(combinaciones)(
      'agregarSucursal con %s lanza un error de validación y no crea nada',
      async (_n, actor0, motivo0) => {
        const actor = actor0 === 'actor-valido' ? textoUnico('actor-33') : actor0;
        const motivo = motivo0 === 'motivo válido' ? textoUnico('motivo-33') : motivo0;
        const nueva: SucursalEntrada = {
          rucEmisor: empresa.emisores[0]!.ruc,
          nombre: textoUnico('No debe existir'),
          codigoEstablecimiento: '0042',
          direccion: 'Calle 42',
        };
        const error = await errorLanzado(
          servicio.agregarSucursal(empresa.id, nueva, { actor, motivo }),
        );
        expect(textoDeError(error)).toMatch(/actor|motivo/i);
        const filas = await plataforma.query('SELECT 1 FROM sucursal WHERE nombre = $1', [
          nueva.nombre,
        ]);
        expect(filas.rows).toEqual([]);
        await nadaAuditado(actor, motivo);
      },
    );

    it.each(combinaciones)(
      'OperacionPlataforma.ejecutar con %s lanza un error de validación sin correr la operación',
      async (_n, actor0, motivo0) => {
        const actor = actor0 === 'actor-valido' ? textoUnico('actor-33') : actor0;
        const motivo = motivo0 === 'motivo válido' ? textoUnico('motivo-33') : motivo0;
        let corrio = false;
        const error = await errorLanzado(
          operacion.ejecutar({ actor, motivo, operacion: textoUnico('operacion_33') }, async () => {
            corrio = true;
          }),
        );
        expect(textoDeError(error)).toMatch(/actor|motivo/i);
        expect(corrio).toBe(false);
        await nadaAuditado(actor, motivo);
      },
    );
  });
});

describe('criterio 34 · registrarEmpresa con datos inválidos', () => {
  let existente: EmpresaSql;
  beforeAll(async () => {
    existente = await crearEmpresaSql(plataforma);
  });

  type Datos = ReturnType<typeof datosDeEmpresa>;
  const casos: [string, (datos: Datos, rucRegistrado: string) => void, RegExp, number][] = [
    [
      'RUC con dígito verificador incorrecto',
      (d) => {
        const bueno = d.emisores[0]!.ruc;
        const malo = bueno.slice(0, 10) + String((Number(bueno[10]) + 1) % 10);
        d.emisores[0]!.ruc = malo;
        d.sucursales.forEach((s) => {
          if (s.rucEmisor === bueno) s.rucEmisor = malo;
        });
      },
      /ruc/i,
      0,
    ],
    [
      'RUC repetido en la entrada',
      (d) => {
        const anterior = d.emisores[1]!.ruc;
        d.emisores[1]!.ruc = d.emisores[0]!.ruc;
        d.sucursales.forEach((s) => {
          if (s.rucEmisor === anterior) s.rucEmisor = d.emisores[0]!.ruc;
        });
      },
      /ruc/i,
      0,
    ],
    [
      'RUC ya registrado por otra empresa (el primer emisor es nuevo y debe deshacerse)',
      (d, registrado) => {
        const anterior = d.emisores[1]!.ruc;
        d.emisores[1]!.ruc = registrado;
        d.sucursales.forEach((s) => {
          if (s.rucEmisor === anterior) s.rucEmisor = registrado;
        });
      },
      /ruc/i,
      1,
    ],
    [
      'sucursal que referencia un RUC que no está en la entrada',
      (d) => {
        d.sucursales[0]!.rucEmisor = rucAleatorio();
      },
      /rucEmisor/i,
      0,
    ],
    [
      'código de establecimiento que no tiene 4 dígitos',
      (d) => {
        d.sucursales[0]!.codigoEstablecimiento = '123';
      },
      /codigoEstablecimiento/i,
      0,
    ],
    [
      'dos sucursales del mismo emisor con el mismo código',
      (d) => {
        d.sucursales[1]!.codigoEstablecimiento = d.sucursales[0]!.codigoEstablecimiento;
        d.sucursales[1]!.rucEmisor = d.sucursales[0]!.rucEmisor;
      },
      /codigoEstablecimiento/i,
      0,
    ],
    [
      'hora de corte mal formada',
      (d) => {
        d.sucursales[0]!.horaCorte = '25:00';
      },
      /horaCorte/i,
      0,
    ],
    [
      'WhatsApp mal formado',
      (d) => {
        d.sucursales[0]!.whatsapp = '12345';
      },
      /whatsapp/i,
      0,
    ],
  ];

  it.each(casos)(
    '%s lanza un error que indica el campo y no deja nada creado ni auditado',
    async (_nombre, estropear, campo, preexistentes) => {
      const datos = datosDeEmpresa({ emisores: 2, sucursalesPorEmisor: 2 });
      estropear(datos, existente.emisores[0]!.ruc);
      const auditoria = { actor: textoUnico('actor-34'), motivo: textoUnico('motivo-34') };

      const error = await errorLanzado(
        servicio.registrarEmpresa(datos as RegistrarEmpresaEntrada, auditoria),
      );
      expect(textoDeError(error)).toMatch(campo);

      const empresas = await plataforma.query('SELECT 1 FROM empresa WHERE nombre = $1', [
        datos.nombre,
      ]);
      expect(empresas.rows, 'no debe quedar la empresa').toEqual([]);
      const rucs = [...new Set(datos.emisores.map((e) => e.ruc))];
      const emisores = await plataforma.query(
        'SELECT ruc FROM emisor WHERE ruc = ANY($1::text[])',
        [rucs],
      );
      expect(emisores.rows, 'no debe quedar ningún emisor nuevo').toHaveLength(preexistentes);
      const filas = await plataforma.query(
        'SELECT 1 FROM sucursal WHERE nombre = ANY($1::text[])',
        [datos.sucursales.map((s) => s.nombre)],
      );
      expect(filas.rows, 'no debe quedar ninguna sucursal').toEqual([]);
      const auditorias = await plataforma.query(
        "SELECT 1 FROM auditoria WHERE origen = 'plataforma' AND actor_sistema = $1",
        [auditoria.actor],
      );
      expect(auditorias.rows, 'no debe quedar fila de auditoría').toEqual([]);
    },
  );
});

describe('criterio 35 · agregarEmisor y agregarSucursal', () => {
  let empresa: EmpresaSql;
  beforeAll(async () => {
    empresa = await crearEmpresaSql(plataforma);
  });

  it('agregarEmisor crea el emisor en esa empresa y lo audita como agregar_emisor', async () => {
    const entrada: EmisorEntrada = {
      ruc: rucAleatorio(),
      razonSocial: 'Segundo emisor SAC',
      regimen: 'MYPE_TRIBUTARIO',
    };
    const auditoria = { actor: textoUnico('actor-35'), motivo: textoUnico('motivo-35') };
    const resultado = await servicio.agregarEmisor(empresa.id, entrada, auditoria);
    expect(resultado.ruc).toBe(entrada.ruc);

    const { rows } = await plataforma.query(
      'SELECT id, empresa_id, razon_social, regimen FROM emisor WHERE ruc = $1',
      [entrada.ruc],
    );
    expect(rows).toEqual([
      {
        id: resultado.id,
        empresa_id: empresa.id,
        razon_social: entrada.razonSocial,
        regimen: entrada.regimen,
      },
    ]);

    const auditorias = await plataforma.query(
      "SELECT actor_sistema AS actor, motivo, empresa_id FROM auditoria WHERE origen = 'plataforma' AND accion = $1 AND actor_sistema = $2",
      ['agregar_emisor', auditoria.actor],
    );
    expect(auditorias.rows).toEqual([
      { actor: auditoria.actor, motivo: auditoria.motivo, empresa_id: empresa.id },
    ]);
  });

  it('agregarSucursal crea la sucursal en esa empresa y la audita como agregar_sucursal', async () => {
    const entrada: SucursalEntrada = {
      rucEmisor: empresa.emisores[0]!.ruc,
      nombre: textoUnico('Sucursal agregada'),
      codigoEstablecimiento: '0009',
      direccion: 'Jr. Agregado 321, Lima',
      horario: [{ dia: 6, desde: '12:00', hasta: '23:30' }],
      whatsapp: '+51955444333',
      horaCorte: '04:00',
    };
    const auditoria = { actor: textoUnico('actor-35'), motivo: textoUnico('motivo-35') };
    const resultado = await servicio.agregarSucursal(empresa.id, entrada, auditoria);
    expect(resultado.nombre).toBe(entrada.nombre);

    const { rows } = await plataforma.query(
      `SELECT id, empresa_id, emisor_id, codigo_establecimiento, direccion, horario, whatsapp,
              to_char(hora_corte, 'HH24:MI') AS hora_corte
         FROM sucursal WHERE nombre = $1`,
      [entrada.nombre],
    );
    expect(rows).toEqual([
      {
        id: resultado.id,
        empresa_id: empresa.id,
        emisor_id: empresa.emisores[0]!.id,
        codigo_establecimiento: entrada.codigoEstablecimiento,
        direccion: entrada.direccion,
        horario: entrada.horario,
        whatsapp: entrada.whatsapp,
        hora_corte: '04:00',
      },
    ]);

    const auditorias = await plataforma.query(
      "SELECT actor_sistema AS actor, motivo, empresa_id FROM auditoria WHERE origen = 'plataforma' AND accion = $1 AND actor_sistema = $2",
      ['agregar_sucursal', auditoria.actor],
    );
    expect(auditorias.rows).toEqual([
      { actor: auditoria.actor, motivo: auditoria.motivo, empresa_id: empresa.id },
    ]);
  });
});

describe('criterio 35b · hora de corte por defecto', () => {
  const auditoria = () => ({ actor: textoUnico('actor-35b'), motivo: textoUnico('motivo-35b') });

  it('registrarEmpresa sin horaCorte deja las sucursales con 05:00 y la respuesta de la sucursal lo muestra', async () => {
    const datos = datosDeEmpresa();
    expect(datos.sucursales.every((s) => s.horaCorte === undefined)).toBe(true);
    const resultado = await servicio.registrarEmpresa(datos, auditoria());
    for (const sucursal of resultado.sucursales) {
      expect(await horaCorteDe(sucursal.id)).toBe('05:00');
      const vista = await contexto.ejecutar(resultado.empresaId, () =>
        sucursales.obtener(sucursal.id),
      );
      expect(vista?.horaCorte).toBe('05:00');
    }
  });

  it('agregarSucursal sin horaCorte deja la sucursal con 05:00', async () => {
    const empresa = await crearEmpresaSql(plataforma);
    const resultado = await servicio.agregarSucursal(
      empresa.id,
      {
        rucEmisor: empresa.emisores[0]!.ruc,
        nombre: textoUnico('Sin hora de corte'),
        codigoEstablecimiento: '0010',
        direccion: 'Av. Sin Hora 1',
      },
      auditoria(),
    );
    expect(await horaCorteDe(resultado.id)).toBe('05:00');
    const vista = await contexto.ejecutar(empresa.id, () => sucursales.obtener(resultado.id));
    expect(vista?.horaCorte).toBe('05:00');
  });

  it('una inserción por SQL como restaurante_api sin la columna hora_corte también queda con 05:00', async () => {
    const empresa = await crearEmpresaSql(plataforma);
    const id = await enTransaccion(
      api,
      empresa.id,
      async () => {
        const { rows } = await api.query<{ id: string }>(
          `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
           VALUES ($1, $2, $3, '0011', 'Av. SQL 1', now(), now()) RETURNING id`,
          [empresa.id, empresa.emisores[0]!.id, textoUnico('Por SQL')],
        );
        return rows[0]!.id;
      },
      { confirmar: true },
    );
    expect(await horaCorteDe(id)).toBe('05:00');
  });
});
