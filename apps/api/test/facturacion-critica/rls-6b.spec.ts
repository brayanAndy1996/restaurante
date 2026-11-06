// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P9 · Aislamiento entre empresas de las tablas nuevas de 6b, por SQL y por HTTP (ruta crítica), criterios 166 y 167:
// - `envio_pse`, `intento_pse`, `configuracion_pse` y `nota_credito`: con el contexto de A y un actor de A fijado no se
//   leen, actualizan, borran ni insertan filas de B (el rechazo es el de la política RLS «row-level security», o el de
//   permisos donde `restaurante_api` no tiene el privilegio de la tabla «Permisos» de `spec.md`);
// - `restaurante_api` no puede insertar ni actualizar `configuracion_pse` (42501) y los privilegios de `comprobante` se dan
//   por columna: solo las de estado y respuesta del PSE, nunca montos, líneas, serie, número, cliente, vínculos ni
//   `simulado`;
// - las referencias cruzadas fallan por la llave foránea compuesta (23503): envío o intento con comprobante de B, nota con
//   original, turno o comprobante de B, configuración con emisor de B, comprobante con `afecta_a_id` o `reemplaza_a_id` de
//   B, movimiento con una nota de B;
// - en toda ruta de 6b un id de B responde con el mismo cuerpo que uno inexistente, y el mismo `id` de nota de crédito en A
//   y en B crea dos filas.
// Las filas se crean por la API real (cobros, el worker a mano, notas de crédito, movimientos) y se leen como
// administrador; lo que se escribe por SQL lo hace `restaurante_api` con el contexto y el actor fijados.
// Hoy falla porque las tablas y las columnas de 6b todavía no existen.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  anularComprobante,
  api,
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  crearEscenarioFact,
  escribir,
  exigirEstado,
  exigirPse,
  filas,
  procesar,
  seriesDeNotas,
  turnoDe,
  rutaPse,
  type AppFact,
  type Cobrado,
  type EmpresaCaja,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

type Privilegio = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const TABLAS_6B: Array<{ tabla: string; api: Privilegio[] }> = [
  { tabla: 'envio_pse', api: ['SELECT', 'INSERT', 'UPDATE'] },
  { tabla: 'intento_pse', api: ['SELECT', 'INSERT'] },
  { tabla: 'configuracion_pse', api: ['SELECT'] },
  { tabla: 'nota_credito', api: ['SELECT', 'INSERT'] },
];

let ctx: AppFact;
let esc: Escenario;
let admin: Client;
let apiCliente: Client;
const A = () => esc.A;
const B = () => esc.B;

interface Sembrada {
  /** Un comprobante aceptado con su envío terminado y su intento. */
  aceptado: Cobrado;
  /** Otro comprobante sin procesar. */
  libre: Cobrado;
  turnoId: string;
}
let sembradas: Promise<{ A: Sembrada; B: Sembrada }> | undefined;
let conNotas: Promise<{ A: string; B: string }> | undefined;

async function sembrarEmpresa(e: EmpresaCaja): Promise<Sembrada> {
  const turnoId = await turnoDe(ctx, e, 'cajero', 'S1', 'caja1');
  const aceptado = await cobrarLomo(ctx, e, { turnoId });
  const libre = await cobrarLomo(ctx, e, { turnoId });
  await procesar(ctx, e.id, aceptado.comprobanteId);
  return { aceptado, libre, turnoId };
}
/** Envíos, intentos, configuración y comprobantes de A y de B (sin notas de crédito). */
const sembrado = () =>
  (sembradas ??= (async () => ({
    A: await sembrarEmpresa(A()),
    B: await sembrarEmpresa(B()),
  }))());

/** Una nota de crédito (anulación) de un comprobante aceptado de cada empresa; devuelve el id de cada nota. */
const notas = () =>
  (conNotas ??= (async () => {
    const s = await sembrado();
    const emitir = async (e: EmpresaCaja, original: Cobrado): Promise<string> => {
      await seriesDeNotas(ctx, e);
      const res = await anularComprobante(
        ctx,
        e.token.supervisor!,
        original.comprobanteId,
        '28.00',
      );
      exigirEstado(res, 201, 'Nota de crédito de siembra (006, criterio 144)');
      return res.body.nota.id as string;
    };
    return { A: await emitir(A(), s.A.aceptado), B: await emitir(B(), s.B.aceptado) };
  })());

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});
afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
  await cerrarAdmin();
});

beforeEach(async () => {
  await exigirPse(esc);
});

const idsDe = async (tabla: string, empresaId: string): Promise<string[]> =>
  (
    await admin.query<{ id: string }>(`SELECT id FROM ${tabla} WHERE empresa_id = $1 ORDER BY id`, [
      empresaId,
    ])
  ).rows.map((f) => f.id);

const fotoDe = async (tabla: string, empresaId: string) =>
  (
    await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    )
  ).rows.map((f) => f.fila);

const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

describe.each(TABLAS_6B)('criterios 166 y 167 · $tabla', ({ tabla, api: privilegios }) => {
  const puede = (privilegio: Privilegio) => privilegios.includes(privilegio);

  async function exigirSinPermiso(sentencia: Promise<unknown>): Promise<void> {
    const error = await errorDe(sentencia);
    expect(error.code, error.message).toBe('42501');
    expect(error.message).toMatch(/permission denied/i);
  }

  /** La siembra común y, para `nota_credito`, las notas. */
  const preparar = async () => {
    await sembrado();
    if (tabla === 'nota_credito') await notas();
  };

  it('la siembra dejó filas de A y de B en la tabla (la prueba no es vacía)', async () => {
    await preparar();
    expect((await idsDe(tabla, A().id)).length, `filas de A en ${tabla}`).toBeGreaterThan(0);
    expect((await idsDe(tabla, B().id)).length, `filas de B en ${tabla}`).toBeGreaterThan(0);
  });

  it('lectura: con el contexto de A no se leen filas de B por id ni sin WHERE, y sí las de A', async () => {
    await preparar();
    const idsB = await idsDe(tabla, B().id);
    const idsA = await idsDe(tabla, A().id);
    await comoApi(A().id, async () => {
      const todas = await apiCliente.query<{ id: string; empresa_id: string }>(
        `SELECT id, empresa_id FROM ${tabla}`,
      );
      expect(todas.rows.map((f) => f.id).sort()).toEqual(idsA);
      expect(todas.rows.every((f) => f.empresa_id === A().id)).toBe(true);
      const porId = await apiCliente.query(`SELECT id FROM ${tabla} WHERE id = ANY($1::uuid[])`, [
        idsB,
      ]);
      expect(porId.rows).toEqual([]);
      const deB = await apiCliente.query(`SELECT id FROM ${tabla} WHERE empresa_id = $1`, [B().id]);
      expect(deB.rows).toEqual([]);
    });
    await comoApi(B().id, async () => {
      const propias = await apiCliente.query<{ id: string }>(`SELECT id FROM ${tabla}`);
      expect(propias.rows.map((f) => f.id).sort()).toEqual(idsB);
    });
  });

  it('actualización: el UPDATE por id y sin WHERE no toca filas de B, y cambiar el dueño a B falla', async () => {
    await preparar();
    const idsB = await idsDe(tabla, B().id);
    const idsA = await idsDe(tabla, A().id);
    const antesB = await fotoDe(tabla, B().id);
    await comoApi(A().id, async () => {
      if (!puede('UPDATE')) {
        await exigirSinPermiso(apiCliente.query(`UPDATE ${tabla} SET empresa_id = empresa_id`));
        return;
      }
      const porId = await apiCliente.query(
        `UPDATE ${tabla} SET empresa_id = empresa_id WHERE id = ANY($1::uuid[]) RETURNING id`,
        [idsB],
      );
      expect(porId.rowCount).toBe(0);
      const sinWhere = await apiCliente.query<{ id: string }>(
        `UPDATE ${tabla} SET empresa_id = empresa_id RETURNING id`,
      );
      expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
      await apiCliente.query('SAVEPOINT dueno');
      const cambio = await errorDe(
        apiCliente.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [B().id, idsA[0]]),
      );
      expect(cambio.code, cambio.message).toBe('42501');
      expect(cambio.message).toMatch(/row-level security/);
      await apiCliente.query('ROLLBACK TO SAVEPOINT dueno');
    });
    expect(await fotoDe(tabla, B().id)).toEqual(antesB);
  });

  it('borrado: la API no tiene DELETE en la tabla y el intento se rechaza por permisos, sin tocar a B', async () => {
    await preparar();
    const idsA = await idsDe(tabla, A().id);
    const idsB = await idsDe(tabla, B().id);
    const antesB = await fotoDe(tabla, B().id);
    expect(puede('DELETE'), 'ninguna tabla nueva de 6b da DELETE a restaurante_api').toBe(false);
    await comoApi(A().id, async () => {
      await apiCliente.query('SAVEPOINT sin_where');
      await exigirSinPermiso(apiCliente.query(`DELETE FROM ${tabla}`));
      await apiCliente.query('ROLLBACK TO SAVEPOINT sin_where');
      await exigirSinPermiso(
        apiCliente.query(`DELETE FROM ${tabla} WHERE id = ANY($1::uuid[])`, [idsB]),
      );
    });
    expect(await fotoDe(tabla, B().id)).toEqual(antesB);
    expect(await idsDe(tabla, A().id), 'A conserva sus filas').toEqual(idsA);
  });

  it(
    puede('INSERT')
      ? 'inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado) y no se crea'
      : 'inserción: restaurante_api no tiene INSERT y el intento se rechaza por permisos (42501)',
    async () => {
      await preparar();
      const antesB = await fotoDe(tabla, B().id);
      const idsAntes = await idsDe(tabla, B().id);
      const copiar = `INSERT INTO ${tabla}
        SELECT (jsonb_populate_record(NULL::${tabla},
                 to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
          FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`;
      await comoApi(A().id, async () => {
        const error = await errorDe(apiCliente.query(copiar, [B().id, A().id]));
        expect(error.code, error.message).toBe('42501');
        if (puede('INSERT')) {
          expect(error.message).toMatch(/row-level security/);
          expect(error.message).not.toMatch(/contexto de actor ausente/);
        } else {
          expect(error.message).toMatch(/permission denied/i);
        }
      });
      expect(await idsDe(tabla, B().id)).toEqual(idsAntes);
      expect(await fotoDe(tabla, B().id)).toEqual(antesB);
    },
  );
});

describe('criterio 166 · restaurante_api no escribe la configuración del PSE y los privilegios son los de «Permisos»', () => {
  it('no puede insertar, actualizar ni borrar configuracion_pse, ni siquiera de su propia empresa', async () => {
    await sembrado();
    const propia = await idsDe('configuracion_pse', A().id);
    expect(propia.length).toBeGreaterThan(0);
    await comoApi(A().id, async () => {
      for (const sentencia of [
        `UPDATE configuracion_pse SET modo = modo WHERE id = '${propia[0]}'`,
        `UPDATE configuracion_pse SET credencial = NULL, clave_id = NULL WHERE id = '${propia[0]}'`,
        `DELETE FROM configuracion_pse WHERE id = '${propia[0]}'`,
        `INSERT INTO configuracion_pse (empresa_id, emisor_id, modo) VALUES ('${A().id}', '${A().emisor2}', 'SIMULADO')`,
      ]) {
        await apiCliente.query('SAVEPOINT s');
        const error = await errorDe(apiCliente.query(sentencia));
        expect(error.code, `${sentencia}: ${error.message}`).toBe('42501');
        expect(error.message).toMatch(/permission denied/i);
        await apiCliente.query('ROLLBACK TO SAVEPOINT s');
      }
    });
  });

  it('privilegios por tabla: envio_pse S/I/U, intento_pse S/I, configuracion_pse S (plataforma S/I/U), nota_credito S/I; nada de DELETE', async () => {
    const tiene = async (rol: string, tabla: string, privilegio: Privilegio) =>
      (
        await admin.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
          rol,
          `public.${tabla}`,
          privilegio,
        ])
      ).rows[0]!.ok as boolean;
    for (const { tabla, api: esperados } of TABLAS_6B) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as Privilegio[]) {
        expect(await tiene('restaurante_api', tabla, p), `api ${p} ${tabla}`).toBe(
          esperados.includes(p),
        );
      }
    }
    for (const p of ['SELECT', 'INSERT', 'UPDATE'] as Privilegio[]) {
      expect(await tiene('restaurante_plataforma', 'configuracion_pse', p), `plataforma ${p}`).toBe(
        true,
      );
    }
    expect(await tiene('restaurante_plataforma', 'configuracion_pse', 'DELETE')).toBe(false);
    for (const tabla of ['envio_pse', 'intento_pse', 'nota_credito']) {
      expect(await tiene('restaurante_plataforma', tabla, 'SELECT'), `plataforma ${tabla}`).toBe(
        false,
      );
    }
  });

  it('comprobante: restaurante_api solo actualiza las columnas de estado y de respuesta del PSE', async () => {
    const puedeActualizar = async (columna: string) =>
      (
        await admin.query(
          `SELECT has_column_privilege('restaurante_api', 'public.comprobante', $1, 'UPDATE') AS ok`,
          [columna],
        )
      ).rows[0]!.ok as boolean;
    for (const columna of [
      'estado',
      'enviado_en',
      'aceptado_en',
      'rechazado_en',
      'anulado_en',
      'sunat_codigo',
      'sunat_mensaje',
      'sunat_observaciones',
      'hash',
      'referencia_pse',
      'xml_clave',
      'cdr_clave',
      'pdf_clave',
    ]) {
      expect(await puedeActualizar(columna), `UPDATE de ${columna}`).toBe(true);
    }
    for (const columna of [
      'id',
      'empresa_id',
      'total',
      'subtotal',
      'descuentos',
      'igv',
      'icbper',
      'op_gravadas',
      'serie',
      'numero',
      'serie_id',
      'tipo',
      'formato',
      'fecha_emision',
      'emitido_en',
      'cliente_tipo_documento',
      'cliente_numero',
      'cliente_nombre',
      'cliente_direccion',
      'tasa_igv',
      'emisor',
      'sucursal',
      'cobro_id',
      'turno_id',
      'orden_id',
      'detalle_parte',
      'afecta_a_id',
      'tipo_nota',
      'motivo_nota',
      'reemplaza_a_id',
      'motivo_reemplazo',
      'simulado',
    ]) {
      expect(await puedeActualizar(columna), `UPDATE de ${columna}`).toBe(false);
    }
    for (const tabla of ['comprobante', 'comprobante_linea']) {
      expect(
        (
          await admin.query(`SELECT has_table_privilege('restaurante_api', $1, 'DELETE') AS ok`, [
            `public.${tabla}`,
          ])
        ).rows[0]!.ok,
        `DELETE de ${tabla}`,
      ).toBe(false);
    }
    expect(
      (
        await admin.query(
          `SELECT has_table_privilege('restaurante_api', 'public.comprobante_linea', 'UPDATE') AS ok`,
        )
      ).rows[0]!.ok,
    ).toBe(false);
  });

  it('un UPDATE de montos, de vínculos o de `simulado` de un comprobante se rechaza por permisos con el contexto de la empresa', async () => {
    const s = await sembrado();
    await comoApi(A().id, async () => {
      for (const set of [
        "total = '1.00'",
        'numero = numero + 1',
        'simulado = NOT simulado',
        "tipo_nota = 'ANULACION'",
        `afecta_a_id = '${s.A.libre.comprobanteId}'`,
      ]) {
        await apiCliente.query('SAVEPOINT u');
        const error = await errorDe(
          apiCliente.query(`UPDATE comprobante SET ${set} WHERE id = $1`, [
            s.A.aceptado.comprobanteId,
          ]),
        );
        expect(error.code, `${set}: ${error.message}`).toBe('42501');
        await apiCliente.query('ROLLBACK TO SAVEPOINT u');
      }
    });
  });
});

describe('criterio 167 · las referencias cruzadas fallan por la llave foránea compuesta', () => {
  const insertar = (empresaId: string, sql: string, p: unknown[]) =>
    comoApi(empresaId, async () => {
      const error = await errorDe(apiCliente.query(sql, p));
      expect(error.code, error.message).toBe('23503');
    });

  it('un envío con un comprobante de B', async () => {
    const s = await sembrado();
    await insertar(
      A().id,
      `INSERT INTO envio_pse (id, empresa_id, comprobante_id, plazo_hasta, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, now(), now(), now())`,
      [A().id, s.B.libre.comprobanteId],
    );
  });

  it('un intento con un comprobante de B (aunque su envío sea de A) y con un envío de B', async () => {
    const s = await sembrado();
    const envioA = (
      await filas('SELECT id FROM envio_pse WHERE comprobante_id = $1', [
        s.A.aceptado.comprobanteId,
      ])
    )[0]!.id as string;
    const envioB = (
      await filas('SELECT id FROM envio_pse WHERE comprobante_id = $1', [
        s.B.aceptado.comprobanteId,
      ])
    )[0]!.id as string;
    const sql = `INSERT INTO intento_pse (id, empresa_id, envio_id, comprobante_id, numero, operacion, iniciado_en, terminado_en, resultado, creado_en, actualizado_en)
                 VALUES (gen_random_uuid(), $1, $2, $3, 99, 'EMITIR', now(), now(), 'ERROR_TRANSPORTE', now(), now())`;
    await insertar(A().id, sql, [A().id, envioA, s.B.aceptado.comprobanteId]);
    await insertar(A().id, sql, [A().id, envioB, s.A.aceptado.comprobanteId]);
  });

  describe('una nota de crédito con ...', () => {
    const sql = `INSERT INTO nota_credito (id, empresa_id, comprobante_id, factura_id, original_id, turno_id, tipo, total, devuelto,
                                            huella_entrada, respuesta, creado_en, actualizado_en)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, '28.00', '0.00',
                         decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex'), '{}'::jsonb, now(), now())`;

    it('el original de B', async () => {
      const s = await sembrado();
      await insertar(A().id, sql, [
        A().id,
        s.A.libre.comprobanteId,
        null,
        s.B.aceptado.comprobanteId,
        null,
        'ANULACION',
      ]);
    });

    it('el turno de B', async () => {
      const s = await sembrado();
      await insertar(A().id, sql, [
        A().id,
        s.A.libre.comprobanteId,
        null,
        s.A.aceptado.comprobanteId,
        s.B.turnoId,
        'DEVOLUCION',
      ]);
    });

    it('el comprobante (la nota) de B', async () => {
      const s = await sembrado();
      await insertar(A().id, sql, [
        A().id,
        s.B.libre.comprobanteId,
        null,
        s.A.aceptado.comprobanteId,
        null,
        'ANULACION',
      ]);
    });

    it('la factura de un cambio de B', async () => {
      const s = await sembrado();
      await insertar(A().id, sql, [
        A().id,
        s.A.libre.comprobanteId,
        s.B.libre.comprobanteId,
        s.A.aceptado.comprobanteId,
        null,
        'CAMBIO_A_FACTURA',
      ]);
    });
  });

  it('una configuración de PSE con un emisor de B (escrita como administrador, que salta la RLS pero no las llaves)', async () => {
    await sembrado();
    const error = await errorDe(
      enTransaccion(
        admin,
        null,
        () =>
          admin.query(
            `INSERT INTO configuracion_pse (id, empresa_id, emisor_id, modo) VALUES (gen_random_uuid(), $1, $2, 'SIMULADO')`,
            [A().id, B().emisor1],
          ),
        { confirmar: false },
      ),
    );
    expect(error.code, error.message).toBe('23503');
  });

  /** Una copia de un comprobante de A con los vínculos que se le pasen (todas las demás columnas, las de A). */
  const copiaDeComprobante = (cambios: Record<string, unknown>) => `
    INSERT INTO comprobante
    SELECT (jsonb_populate_record(NULL::comprobante,
             to_jsonb(x) || '${JSON.stringify(cambios)}'::jsonb
                         || jsonb_build_object('id', gen_random_uuid()::text, 'numero', 90000001,
                                               'cobro_id', NULL, 'detalle_parte', NULL,
                                               'orden_id', NULL, 'numero_parte', NULL,
                                               'estado', 'POR_ENVIAR', 'aceptado_en', NULL, 'enviado_en', NULL,
                                               'rechazado_en', NULL, 'anulado_en', NULL))).*
      FROM comprobante x WHERE x.id = $1`;

  it('un comprobante con afecta_a_id de B (una nota que modifica un documento de B)', async () => {
    const s = await sembrado();
    await comoApi(A().id, async () => {
      const error = await errorDe(
        apiCliente.query(
          copiaDeComprobante({
            tipo: 'NOTA_CREDITO_BOLETA',
            tipo_nota: 'ANULACION',
            motivo_nota: 'Prueba',
            afecta_a_id: s.B.aceptado.comprobanteId,
          }),
          [s.A.aceptado.comprobanteId],
        ),
      );
      expect(error.code, error.message).toBe('23503');
    });
  });

  it('un comprobante con reemplaza_a_id de B (una reemisión de un documento de B)', async () => {
    const s = await sembrado();
    await comoApi(A().id, async () => {
      const error = await errorDe(
        apiCliente.query(
          copiaDeComprobante({
            reemplaza_a_id: s.B.aceptado.comprobanteId,
            motivo_reemplazo: 'REEMISION',
          }),
          [s.A.aceptado.comprobanteId],
        ),
      );
      expect(error.code, error.message).toBe('23503');
    });
  });

  it('un movimiento de caja con un comprobante (la nota de una devolución) de B', async () => {
    const s = await sembrado();
    await comoApi(A().id, async () => {
      const error = await errorDe(
        apiCliente.query(
          `INSERT INTO movimiento_caja (id, empresa_id, turno_id, tipo, medio, monto, motivo, comprobante_id, creado_en, actualizado_en)
           VALUES (gen_random_uuid(), $1, $2, 'EGRESO', 'EFECTIVO', '28.00', 'Devolución NC', $3, now(), now())`,
          [A().id, s.A.turnoId, s.B.libre.comprobanteId],
        ),
      );
      expect(error.code, error.message).toBe('23503');
    });
  });
});

describe('criterio 167 · por HTTP un id de B responde como uno inexistente', () => {
  /** Llama con el id de B y con uno inexistente y exige el mismo estado (404 o 422) y el mismo cuerpo. */
  async function igual(
    llamada: (id: string) => Promise<{ status: number; body: unknown; text: string }>,
    idDeB: string,
  ): Promise<void> {
    const deB = await llamada(idDeB);
    const inexistente = await llamada(randomUUID());
    expect([404, 422], `id de B: ${deB.text}`).toContain(deB.status);
    expect(deB.status).toBe(inexistente.status);
    expect(deB.body).toEqual(inexistente.body);
  }
  const supervisor = () => A().token.supervisor!;

  it('el panel, el detalle, el PDF, el enlace, el reintento y la reemisión', async () => {
    const s = await sembrado();
    const id = s.B.aceptado.comprobanteId;
    await igual((x) => api(ctx, supervisor(), 'get', `/facturacion/comprobantes/${x}`), id);
    await igual((x) => api(ctx, supervisor(), 'get', `/facturacion/comprobantes/${x}/pdf`), id);
    await igual((x) => api(ctx, supervisor(), 'get', `/facturacion/comprobantes/${x}/enlace`), id);
    await igual(
      (x) => escribir(ctx, supervisor(), 'post', `/facturacion/comprobantes/${x}/reintento`),
      id,
    );
    await igual(
      (x) =>
        escribir(ctx, supervisor(), 'post', `/facturacion/comprobantes/${x}/reemision`, {
          tipo: 'BOLETA',
        }),
      id,
    );
  });

  it('una nota de crédito sobre un comprobante de B, o con el turno de la devolución de B', async () => {
    const s = await sembrado();
    await igual(
      (x) =>
        escribir(ctx, supervisor(), 'post', '/notas-credito', {
          id: randomUUID(),
          comprobanteId: x,
          tipo: 'ANULACION',
          motivo: 'Prueba',
          total: '28.00',
        }),
      s.B.libre.comprobanteId,
    );
    // Un original de A que sí se puede devolver (aceptado y sin notas).
    const turnoA = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const original = await cobrarLomo(ctx, A(), { turnoId: turnoA });
    await procesar(ctx, A().id, original.comprobanteId);
    await igual(
      (x) =>
        escribir(ctx, supervisor(), 'post', '/notas-credito', {
          id: randomUUID(),
          comprobanteId: original.comprobanteId,
          tipo: 'DEVOLUCION',
          motivo: 'Prueba',
          total: '28.00',
          lineas: [{ posicion: 1, cantidad: 1 }],
          devolucion: {
            turnoId: x,
            pagos: [{ medio: 'EFECTIVO', monto: '28.00' }],
            redondeo: '0.00',
          },
        }),
      s.B.turnoId,
    );
  });

  it('la configuración del PSE de un emisor de B bajo la empresa A (rutas de plataforma)', async () => {
    await sembrado();
    await igual((x) => api(ctx, esc.sa.token, 'get', rutaPse(A().id, x)), B().emisor1);
    await igual(
      (x) => escribir(ctx, esc.sa.token, 'put', rutaPse(A().id, x), { modo: 'SIMULADO' }),
      B().emisor1,
    );
  });

  it('el mismo id de nota de crédito en A y en B crea dos filas', async () => {
    await sembrado();
    await notas();
    const mismoId = randomUUID();
    const nueva = async (e: EmpresaCaja) => {
      const turnoId = await turnoDe(ctx, e, 'cajero', 'S1', 'caja1');
      const c = await cobrarLomo(ctx, e, { turnoId });
      await procesar(ctx, e.id, c.comprobanteId);
      return escribir(ctx, e.token.supervisor!, 'post', '/notas-credito', {
        id: mismoId,
        comprobanteId: c.comprobanteId,
        tipo: 'ANULACION',
        motivo: 'Anulación de prueba',
        total: '28.00',
      });
    };
    const [deA, deB] = [await nueva(A()), await nueva(B())];
    exigirEstado(deA, 201, 'Nota con el id compartido en A');
    exigirEstado(deB, 201, 'Nota con el id compartido en B');
    const filasDeLaNota = await filas('SELECT empresa_id FROM nota_credito WHERE id = $1', [
      mismoId,
    ]);
    expect(filasDeLaNota.map((f) => f.empresa_id as string).sort()).toEqual(
      [A().id, B().id].sort(),
    );
    expect((deA.body as Libre).nota.id).not.toBe((deB.body as Libre).nota.id);
  });
});
