// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P1 (parte 4) · Referencias cruzadas entre empresas de las tablas nuevas de 005, por SQL (ruta crítica), criterio
// 64: con el contexto de A, insertar o actualizar una fila de A que apunte a una de B (un `llamado` con sucursal,
// mesa, orden, mozo destinatario, usuario que atendió o cerró, o equipo de B; un `mesa_qr` con mesa o sucursal de B;
// una `carta_web_sucursal` con sucursal de B) falla por la llave foránea compuesta, igual que con un id
// inexistente: mismo código 23503 y misma restricción, y nunca un error de unicidad (que revelaría que la fila de B
// existe). Cada caso tiene un control: la misma copia sin la referencia cruzada se inserta.
// Las filas se siembran por las rutas de la historia (nunca por SQL); la copia de prueba se inserta como
// `restaurante_api` con el contexto de A y el actor `prueba` fijados. Hoy las tablas no existen: fallan por eso.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  arrancarAislamiento,
  clientePublico,
  crearMundo,
  sembrarLlamados,
  sesiones,
  type AppP4,
  type LlamadosSembrados,
  type Mundo,
} from './fabrica-aislamiento';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP4;
let admin: Client;
let apiCliente: Client;

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2 });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

interface Sembrado {
  m: Mundo;
  sA: LlamadosSembrados;
  sB: LlamadosSembrados;
  equipoB: string;
  ordenB: string;
}

let sembradoPendiente: Promise<Sembrado> | undefined;
function sembrado(): Promise<Sembrado> {
  sembradoPendiente ??= (async () => {
    const m = await crearMundo(ctx);
    const sA = await sembrarLlamados(ctx, m.A, clientePublico(ctx), m.e.mozo2);
    const sB = await sembrarLlamados(ctx, m.B, clientePublico(ctx));
    const equipoB = (await sesiones(ctx, m.B.mozo, m.B.S1)).equipoId;
    return { m, sA, sB, equipoB, ordenB: sB.ordenId };
  })();
  return sembradoPendiente;
}

const ACTOR_DE_LA_COPIA = {
  creado_por_usuario_id: null,
  creado_por_equipo_id: null,
  creado_por_superadministrador_id: null,
  creado_por_sistema: 'prueba',
  actualizado_por_usuario_id: null,
  actualizado_por_equipo_id: null,
  actualizado_por_superadministrador_id: null,
  actualizado_por_sistema: 'prueba',
};

const fotoDe = async (tabla: string, empresaId: string) =>
  (
    await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    )
  ).rows.map((f) => f.fila);

const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

type Tabla = 'carta_web_sucursal' | 'mesa_qr' | 'llamado';
type Objetivo = 'sucursal' | 'mesa' | 'orden' | 'usuario' | 'equipo';

interface Referencia {
  tabla: Tabla;
  columna: string;
  objetivo: Objetivo;
}

/** Cada llave foránea compuesta de las tablas de 005 hacia otra tabla de empresa (y hacia `sucursal`). */
const REFERENCIAS: Referencia[] = [
  { tabla: 'carta_web_sucursal', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'mesa_qr', columna: 'mesa_id', objetivo: 'mesa' },
  { tabla: 'mesa_qr', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'llamado', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'llamado', columna: 'mesa_id', objetivo: 'mesa' },
  { tabla: 'llamado', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'llamado', columna: 'destinatario_mozo_id', objetivo: 'usuario' },
  { tabla: 'llamado', columna: 'atendido_por_usuario_id', objetivo: 'usuario' },
  { tabla: 'llamado', columna: 'cerrado_por_usuario_id', objetivo: 'usuario' },
  { tabla: 'llamado', columna: 'atendido_por_equipo_id', objetivo: 'equipo' },
  { tabla: 'llamado', columna: 'cerrado_por_equipo_id', objetivo: 'equipo' },
];

const deB = (s: Sembrado, objetivo: Objetivo): string =>
  ({
    sucursal: s.m.B.S1,
    mesa: s.m.B.mesa4.id,
    orden: s.ordenB,
    usuario: s.m.B.mozo.id,
    equipo: s.equipoB,
  })[objetivo];

/** El `id` de la fila de A de la que sale la copia (y la que se actualiza). */
async function filaDeA(s: Sembrado, tabla: Tabla): Promise<string> {
  const consulta: Record<Tabla, [string, unknown[]]> = {
    carta_web_sucursal: [
      `SELECT id FROM carta_web_sucursal WHERE empresa_id = $1 AND sucursal_id = $2`,
      [s.m.A.empresaId, s.m.A.S1],
    ],
    mesa_qr: [
      `SELECT id FROM mesa_qr WHERE empresa_id = $1 AND mesa_id = $2`,
      [s.m.A.empresaId, s.m.A.mesa12.id],
    ],
    llamado: [
      `SELECT id FROM llamado WHERE empresa_id = $1 AND id = $2`,
      [s.m.A.empresaId, s.sA.descartado],
    ],
  };
  const [sql, parametros] = consulta[tabla];
  const { rows } = await admin.query<{ id: string }>(sql, parametros);
  expect(rows, `la fila de A en ${tabla}`).toHaveLength(1);
  return rows[0]!.id;
}

/**
 * Inserta (dentro de la transacción de prueba) una mesa de A sin código de QR, copiando otra mesa de A por SQL. Así
 * una copia de `mesa_qr` puede apuntar a una mesa de A que no choca con la fila de la que sale.
 */
async function mesaSinQr(s: Sembrado): Promise<string> {
  const id = randomUUID();
  await apiCliente.query(
    `INSERT INTO mesa
       SELECT (jsonb_populate_record(NULL::mesa,
                to_jsonb(x) || $1::jsonb)).*
         FROM mesa x WHERE x.id = $2`,
    [
      JSON.stringify({
        id,
        nombre: `SQ${randomBytes(3).toString('hex')}`,
        columna: 9,
        fila: 9,
        ...ACTOR_DE_LA_COPIA,
      }),
      s.m.A.mesa12.id,
    ],
  );
  return id;
}

/**
 * Cambios que evitan que la copia choque con la fila de A de la que sale (una dirección o un código únicos, una
 * mesa o una sucursal con una sola fila de QR o de carta). Nunca tocan la columna que se prueba ni los valores que
 * compartiría con la fila de B: si un índice único dejara ver la fila de B, el error sería 23505 y no 23503, y la
 * prueba lo señala.
 */
async function sinChocarConA(
  s: Sembrado,
  tabla: Tabla,
  columna: string,
  control: boolean,
): Promise<Record<string, unknown>> {
  switch (tabla) {
    case 'carta_web_sucursal':
      return {
        slug: `copia-${randomBytes(4).toString('hex')}`,
        // En el control la copia necesita una sucursal de A sin carta configurada (S3).
        ...(control ? { sucursal_id: s.m.A.S3 } : {}),
      };
    case 'mesa_qr':
      return {
        codigo: randomBytes(16).toString('base64url'),
        ...(columna === 'mesa_id' && !control ? {} : { mesa_id: await mesaSinQr(s) }),
      };
    case 'llamado':
      return {};
  }
}

describe.each(REFERENCIAS)(
  'criterio 64 · $tabla · $columna apunta a otra empresa',
  ({ tabla, columna, objetivo }) => {
    /** Copia una fila de A cambiando `columna` (y el id) y la inserta con el contexto de A. */
    async function insertarCopia(s: Sembrado, valor: string | null) {
      const origen = await filaDeA(s, tabla);
      const cambios: Record<string, unknown> = {
        id: randomUUID(),
        ...(await sinChocarConA(s, tabla, columna, valor === null)),
        ...(valor === null ? {} : { [columna]: valor }),
        ...ACTOR_DE_LA_COPIA,
      };
      return apiCliente.query(
        `INSERT INTO ${tabla}
           SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
             FROM ${tabla} x WHERE x.id = $2 AND x.empresa_id = $3`,
        [JSON.stringify(cambios), origen, s.m.A.empresaId],
      );
    }

    it('control: la copia de la fila de A con otro id y sin la referencia cruzada se inserta', async () => {
      const s = await sembrado();
      const resultado = await comoApi(s.m.A.empresaId, () => insertarCopia(s, null));
      expect(resultado.rowCount).toBe(1);
    });

    it('insertar una fila de A que apunta a una de B falla por la llave foránea, igual que con un id inexistente', async () => {
      const s = await sembrado();
      const cruzada = await comoApi(s.m.A.empresaId, () =>
        errorDe(insertarCopia(s, deB(s, objetivo))),
      );
      const inexistente = await comoApi(s.m.A.empresaId, () =>
        errorDe(insertarCopia(s, randomUUID())),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint, 'llave foránea nombrada').toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
    });

    it('actualizar una fila de A para que apunte a una de B falla por la llave foránea y no cambia la fila', async () => {
      const s = await sembrado();
      const origen = await filaDeA(s, tabla);
      const antes = await fotoDe(tabla, s.m.A.empresaId);
      const actualizar = (valor: string) =>
        apiCliente.query(`UPDATE ${tabla} SET ${columna} = $1 WHERE id = $2 AND empresa_id = $3`, [
          valor,
          origen,
          s.m.A.empresaId,
        ]);
      const cruzada = await comoApi(s.m.A.empresaId, () => errorDe(actualizar(deB(s, objetivo))));
      const inexistente = await comoApi(s.m.A.empresaId, () => errorDe(actualizar(randomUUID())));
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint).toBe(inexistente.constraint);
      expect(await fotoDe(tabla, s.m.A.empresaId)).toEqual(antes);
    });
  },
);

describe('criterio 64 · el rechazo no revela a B', () => {
  it('ningún mensaje de error de las referencias cruzadas trae ids ni nombres de la empresa B', async () => {
    const s = await sembrado();
    const secretos = [
      s.m.B.empresaId,
      s.m.B.S1,
      s.m.B.mesa4.id,
      s.ordenB,
      s.m.B.mozo.id,
      s.equipoB,
    ];
    const fallos: string[] = [];
    for (const { tabla, columna, objetivo } of REFERENCIAS) {
      const origen = await filaDeA(s, tabla);
      const error = await comoApi(s.m.A.empresaId, () =>
        errorDe(
          apiCliente.query(
            `UPDATE ${tabla} SET ${columna} = $1 WHERE id = $2 AND empresa_id = $3`,
            [deB(s, objetivo), origen, s.m.A.empresaId],
          ),
        ),
      );
      const texto = JSON.stringify([error.message, error.detail, error.hint]);
      // El valor que escribió el atacante puede aparecer en el mensaje ("Key (x)=(…) is not present"); lo que
      // no puede aparecer es otro dato de B.
      for (const secreto of secretos) {
        if (secreto !== deB(s, objetivo) && texto.includes(secreto)) {
          fallos.push(`${tabla}.${columna}: el error nombra ${secreto}`);
        }
      }
    }
    expect(fallos).toEqual([]);
  });
});
