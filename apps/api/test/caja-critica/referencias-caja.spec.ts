// spec: 006-caja-cobro (pruebas protegidas)
//
// P6 (parte 2) · Referencias cruzadas entre empresas en la base (ruta crítica), criterio 105: con el contexto de A, una
// fila de A que apunte a una de B (caja con sucursal o impresora de B, serie con caja o emisor de B, turno con caja de
// B, cobro con orden, turno o comprobante de B, comprobante con serie, caja o turno de B, descuento con ítem de B y cada
// llave foránea compuesta de las tablas nuevas) falla por la llave foránea compuesta, igual que con un id inexistente:
// mismo código 23503 y misma restricción, y nunca un error de unicidad (que revelaría que la fila de B existe). Cada caso
// tiene un control: la misma copia sin la referencia cruzada se inserta.
// Hoy falla porque las tablas todavía no existen.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { altaEmpresa, nuevoSuperadmin, type EmpresaDePrueba } from '../acceso/fabrica-plataforma';
import { sembrarCarta } from '../carta-critica/fabrica-permisos-carta';
import { arrancarP5, type AppP5 } from '../impresion-critica/fabrica-p5';
import { abrirCliente } from '../utilidades';
import {
  impresoraDeSiembra,
  PRIVILEGIOS_CAJA,
  sembrarFilasCaja,
  type BaseCaja,
  type FilasCaja,
  type TablaCaja,
} from './fabrica-aislamiento-caja';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP5;
let admin: Client;
let apiCliente: Client;

beforeAll(async () => {
  ctx = await arrancarP5({ poolMax: 2 });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});
afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

interface Sembrada {
  base: BaseCaja;
  filas: FilasCaja;
}

async function sembrarEmpresa(empresa: EmpresaDePrueba): Promise<Sembrada> {
  const carta = await sembrarCarta(ctx, empresa.admin.token);
  const base: BaseCaja = {
    empresaId: empresa.empresaId,
    sucursal1: empresa.sucursales[0]!.id,
    sucursal2: empresa.sucursales[1]!.id,
    usuarioId: empresa.admin.id,
    estacionId: carta.estacionId,
    productoId: carta.productoId,
    emisorId: empresa.emisores[0]!.id,
    impresoraId: await impresoraDeSiembra(ctx, empresa.admin.token, empresa.sucursales[0]!.id),
  };
  return { base, filas: await sembrarFilasCaja(apiCliente, base) };
}

let sembradoPendiente: Promise<{ A: Sembrada; B: Sembrada }> | undefined;
function sembrado() {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    const A = await altaEmpresa(ctx, sa);
    const B = await altaEmpresa(ctx, sa);
    return { A: await sembrarEmpresa(A), B: await sembrarEmpresa(B) };
  })();
  return sembradoPendiente;
}

const fotoDe = async (tabla: string, empresaId: string) =>
  (
    await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    )
  ).rows.map((f) => f.fila);

const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

type Objetivo =
  | 'sucursal'
  | 'usuario'
  | 'emisor'
  | 'impresora'
  | 'caja'
  | 'turno'
  | 'serie'
  | 'comprobante'
  | 'cobro'
  | 'orden'
  | 'item';

interface Referencia {
  tabla: TablaCaja;
  columna: string;
  objetivo: Objetivo;
}

/** Cada llave foránea compuesta de las tablas de 6a hacia otra tabla de empresa (y hacia `sucursal`). */
const REFERENCIAS: Referencia[] = [
  { tabla: 'caja', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'caja', columna: 'impresora_id', objetivo: 'impresora' },
  { tabla: 'turno', columna: 'caja_id', objetivo: 'caja' },
  { tabla: 'turno', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'turno', columna: 'responsable_id', objetivo: 'usuario' },
  { tabla: 'turno_conteo', columna: 'turno_id', objetivo: 'turno' },
  { tabla: 'movimiento_caja', columna: 'turno_id', objetivo: 'turno' },
  { tabla: 'cobro', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'cobro', columna: 'turno_id', objetivo: 'turno' },
  { tabla: 'cobro', columna: 'comprobante_id', objetivo: 'comprobante' },
  { tabla: 'pago', columna: 'cobro_id', objetivo: 'cobro' },
  { tabla: 'pago', columna: 'turno_id', objetivo: 'turno' },
  { tabla: 'serie', columna: 'caja_id', objetivo: 'caja' },
  { tabla: 'serie', columna: 'emisor_id', objetivo: 'emisor' },
  { tabla: 'comprobante', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'comprobante', columna: 'emisor_id', objetivo: 'emisor' },
  { tabla: 'comprobante', columna: 'caja_id', objetivo: 'caja' },
  { tabla: 'comprobante', columna: 'turno_id', objetivo: 'turno' },
  { tabla: 'comprobante', columna: 'turno_responsable_id', objetivo: 'usuario' },
  { tabla: 'comprobante', columna: 'serie_id', objetivo: 'serie' },
  { tabla: 'comprobante_linea', columna: 'comprobante_id', objetivo: 'comprobante' },
  { tabla: 'emisor_tasa_igv', columna: 'emisor_id', objetivo: 'emisor' },
  { tabla: 'descuento', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'descuento', columna: 'item_id', objetivo: 'item' },
  { tabla: 'cortesia', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'cortesia', columna: 'item_id', objetivo: 'item' },
  { tabla: 'contador_llamado', columna: 'sucursal_id', objetivo: 'sucursal' },
];

const deB = (b: Sembrada, objetivo: Objetivo): string =>
  ({
    sucursal: b.base.sucursal1,
    usuario: b.base.usuarioId,
    emisor: b.base.emisorId,
    impresora: b.base.impresoraId,
    caja: b.filas.caja,
    turno: b.filas.turno,
    serie: b.filas.serie,
    comprobante: b.filas.comprobante,
    cobro: b.filas.cobro,
    orden: b.filas.orden,
    item: b.filas.item,
  })[objetivo];

/**
 * Cambios que evitan que la copia choque con la fila de A de la que sale (un nombre, un número o una serie únicos, un
 * turno que ya no está abierto, un descuento ya quitado). Nunca tocan la columna que se prueba ni los valores que
 * compartiría con la fila de B: si un índice único dejara ver la fila de B, el error sería 23505 y no 23503.
 */
function sinChocarConA(tabla: TablaCaja, columna: string, a: Sembrada): Record<string, unknown> {
  const ahora = new Date().toISOString();
  switch (tabla) {
    case 'caja':
      return { nombre: `Caja copia ${randomUUID().slice(0, 8)}` };
    case 'turno':
      return { estado: 'CERRADO', cerrado_en: ahora, cerrado_por_id: a.base.usuarioId };
    case 'turno_conteo':
      return { medio: 'PLIN' };
    case 'cobro':
      return columna === 'comprobante_id' ? {} : { comprobante_id: a.filas.comprobante2 };
    case 'serie':
      return { serie: 'B9Z1', activa: false };
    case 'comprobante':
      return { numero: 50, numero_parte: 5, cobro_id: randomUUID() };
    case 'comprobante_linea':
      return { posicion: 2 };
    case 'emisor_tasa_igv':
      return { desde: '2030-01-01' };
    case 'descuento':
      return { quitado_en: ahora, quitado_por_id: a.base.usuarioId };
    case 'contador_llamado':
      return { dia_operativo: '2030-01-01' };
    default:
      return {};
  }
}

describe.each(REFERENCIAS)(
  'criterio 105 · $tabla · $columna apunta a otra empresa',
  ({ tabla, columna, objetivo }) => {
    /** Copia una fila de A cambiando `columna` (y el id) y la inserta con el contexto de A. */
    const insertarCopia = (a: Sembrada, valor: string | null) => {
      const cambios: Record<string, unknown> = {
        id: randomUUID(),
        ...sinChocarConA(tabla, columna, a),
        ...(valor === null ? {} : { [columna]: valor }),
      };
      return apiCliente.query(
        `INSERT INTO ${tabla}
           SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
             FROM ${tabla} x WHERE x.empresa_id = $2 ORDER BY x.id LIMIT 1`,
        [JSON.stringify(cambios), a.base.empresaId],
      );
    };

    it('control: la copia de la fila de A con otro id y sin la referencia cruzada se inserta', async () => {
      const { A } = await sembrado();
      const resultado = await comoApi(A.base.empresaId, () => insertarCopia(A, null));
      expect(resultado.rowCount).toBe(1);
    });

    it('insertar una fila de A que apunta a una de B falla por la llave foránea, igual que con un id inexistente', async () => {
      const { A, B } = await sembrado();
      const cruzada = await comoApi(A.base.empresaId, () =>
        errorDe(insertarCopia(A, deB(B, objetivo))),
      );
      const inexistente = await comoApi(A.base.empresaId, () =>
        errorDe(insertarCopia(A, randomUUID())),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint, 'llave foránea nombrada').toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
    });

    if (PRIVILEGIOS_CAJA[tabla].includes('UPDATE') && tabla !== 'comprobante') {
      it('actualizar una fila de A para que apunte a una de B falla por la llave foránea y no cambia la fila', async () => {
        const { A, B } = await sembrado();
        const antes = await fotoDe(tabla, A.base.empresaId);
        const actualizar = (valor: string) =>
          apiCliente.query(`UPDATE ${tabla} SET ${columna} = $1 WHERE empresa_id = $2`, [
            valor,
            A.base.empresaId,
          ]);
        const cruzada = await comoApi(A.base.empresaId, () =>
          errorDe(actualizar(deB(B, objetivo))),
        );
        const inexistente = await comoApi(A.base.empresaId, () =>
          errorDe(actualizar(randomUUID())),
        );
        expect(cruzada.code, cruzada.message).toBe('23503');
        expect(inexistente.code, inexistente.message).toBe('23503');
        expect(cruzada.constraint).toBe(inexistente.constraint);
        expect(await fotoDe(tabla, A.base.empresaId)).toEqual(antes);
      });
    } else {
      it('la API no puede actualizar esa columna: el intento de apuntar a otra empresa se rechaza por permisos', async () => {
        const { A, B } = await sembrado();
        const antes = await fotoDe(tabla, A.base.empresaId);
        const error = await comoApi(A.base.empresaId, () =>
          errorDe(
            apiCliente.query(`UPDATE ${tabla} SET ${columna} = $1 WHERE empresa_id = $2`, [
              deB(B, objetivo),
              A.base.empresaId,
            ]),
          ),
        );
        expect(error.code, error.message).toBe('42501');
        expect(error.message).toMatch(/permission denied/i);
        expect(await fotoDe(tabla, A.base.empresaId)).toEqual(antes);
      });
    }
  },
);
