// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P1 (parte 2) · Lo que sale por las rutas públicas (ruta crítica), criterio 21 (y la misma regla para los
// criterios 18, 23, 25, 26 y 38): cada respuesta pública tiene exactamente las claves de su esquema, que aquí se
// escribe como un esquema estricto en la prueba (no se importa de `packages/contratos`):
// - `empresaPublica`, `cartaPublica`, `disponibilidadPublica`, `mesaPublica`, `llamadoPublico` y
//   `estadoLlamadoPublico` no traen `empresaId`, `sucursalId`, ids de mesa, de orden ni de usuario, `estacionId`,
//   `tipoControlStock`, `afectacionIgv`, `aplicaIcbper`, `agotado`, `vendible`, `motivo`, el `productoId` de los
//   modificadores y de los componentes, la hora de corte, el código de establecimiento, el RUC, el emisor ni el
//   WhatsApp;
// - todo UUID que sale es el id de una familia, un producto, un grupo o un modificador de la empresa del código (o
//   el `id` del llamado que mandó el cliente), nunca de otra empresa, de otra tabla ni de un producto que la
//   sucursal no vende; ningún dato de B ni de S2 con datos parecidos aparece en la carta de S1.
// Hoy las rutas públicas no existen (sin `@Publica()` responden 401) y la carta web no se puede configurar: las
// pruebas fallan por eso.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { abrirCliente } from '../utilidades';
import {
  CAMPOS_PROHIBIDOS_EN_PUBLICO,
  UUID_RE,
  arrancarAislamiento,
  atenderLlamado,
  clavesOrdenadas,
  clientePublico,
  crearLlamadoOk,
  crearMundo,
  descartarLlamado,
  exigirEstado,
  exigirSinFallos,
  llamar,
  llamarAlMozo,
  mesasNuevas,
  nombresDeCampos,
  pedidoDeLomo,
  pedirLaCuenta,
  postConClave,
  problemasDeUuidsPublicos,
  rutaDeLlamados,
  sembrarLlamados,
  sesiones,
  textosSinUrls,
  uuidsComoValores,
  type AppP4,
  type EmpresaDelMundo,
  type Mundo,
} from './fabrica-aislamiento';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP4;
let admin: Client;
let mundoPendiente: Promise<Mundo & { datos: DatosSensibles }> | undefined;

/** Datos que no deben salir: los de S1 y S2 (RUC, razón social, WhatsApp, hora de corte, código de establecimiento). */
interface DatosSensibles {
  S1: Record<string, unknown>;
  S2: Record<string, unknown>;
  valores: string[];
}

async function sembrarDatosSensibles(m: Mundo): Promise<DatosSensibles> {
  const A = m.A;
  const cambios: [string, Record<string, unknown>][] = [
    [A.S1, { whatsapp: '+51987654321', horaCorte: '05:30' }],
    [A.S2, { whatsapp: '+51912345678', horaCorte: '06:15' }],
  ];
  for (const [id, cuerpo] of cambios) {
    exigirEstado(
      await llamar(ctx, A.tokenAdmin, { metodo: 'patch', ruta: `/sucursales/${id}`, cuerpo }),
      200,
      'cargar el WhatsApp y la hora de corte',
    );
  }
  const leer = async (id: string) => {
    const res = await llamar(ctx, A.tokenAdmin, { metodo: 'get', ruta: `/sucursales/${id}` });
    exigirEstado(res, 200, 'leer la sucursal');
    return res.body as Record<string, unknown>;
  };
  const S1 = await leer(A.S1);
  const S2 = await leer(A.S2);
  const emisores = m.e.A.base.emisores.map((x) => x.ruc);
  const valores = [
    ...emisores,
    '+51987654321',
    '+51912345678',
    '05:30',
    '06:15',
    String(S1.codigoEstablecimiento),
    String(S2.codigoEstablecimiento),
  ];
  return { S1, S2, valores };
}

const mundo = () =>
  (mundoPendiente ??= (async () => {
    const m = await crearMundo(ctx);
    return { ...m, datos: await sembrarDatosSensibles(m) };
  })());

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2 });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

// ------------------------------------------------------------------------------------------------
// Los esquemas estrictos de la prueba
// ------------------------------------------------------------------------------------------------
const uuid = z.string().regex(UUID_RE);
const instante = z.iso.datetime();
const monto = z.string().regex(/^\d+\.\d{2}$/);

const marca = z.strictObject({
  nombre: z.string().min(1),
  logoUrl: z.string().nullable(),
  colorPrincipal: z.string().regex(/^#[0-9A-F]{6}$/),
});

const esquemaEmpresaPublica = z.strictObject({
  empresa: marca,
  sucursales: z.array(
    z.strictObject({ nombre: z.string(), slug: z.string(), direccion: z.string() }),
  ),
});

const esquemaProducto = z.strictObject({
  id: uuid,
  tipo: z.enum(['SIMPLE', 'COMBO', 'MENU_DEL_DIA']),
  nombre: z.string(),
  descripcion: z.string().nullable(),
  fotoUrl: z.string().nullable(),
  precio: monto,
  grupos: z.array(
    z.strictObject({
      id: uuid,
      nombre: z.string(),
      seleccion: z.enum(['UNICA', 'MULTIPLE']),
      minimo: z.number().int(),
      maximo: z.number().int(),
      obligatorio: z.boolean(),
      modificadores: z.array(z.strictObject({ id: uuid, nombre: z.string(), precioExtra: monto })),
    }),
  ),
  componentes: z.array(z.strictObject({ nombre: z.string(), cantidad: z.number().int() })),
});

const esquemaCartaPublica = z.strictObject({
  empresa: marca,
  sucursal: z.strictObject({
    nombre: z.string(),
    slug: z.string(),
    direccion: z.string(),
    horario: z.array(
      z.strictObject({
        dia: z.number().int().min(1).max(7),
        desde: z.string().regex(/^\d\d:\d\d$/),
        hasta: z.string().regex(/^\d\d:\d\d$/),
      }),
    ),
    abiertaAhora: z.boolean().nullable(),
  }),
  familias: z.array(
    z.strictObject({ id: uuid, nombre: z.string(), productos: z.array(esquemaProducto) }),
  ),
});

const esquemaDisponibilidad = z.strictObject({
  vendibles: z.array(z.strictObject({ id: uuid, modificadoresNoDisponibles: z.array(uuid) })),
});

const esquemaMesaPublica = z.strictObject({
  mesa: z.strictObject({ nombre: z.string() }),
  carta: z.strictObject({ empresaSlug: z.string(), sucursalSlug: z.string() }),
  aceptaLlamados: z.boolean(),
  motivoNoAcepta: z.literal('FUERA_DE_HORARIO').nullable(),
  llamadoPendiente: z
    .strictObject({
      tipo: z.enum(['PEDIDO', 'LLAMAR_MOZO', 'PEDIR_CUENTA']),
      venceEn: instante,
    })
    .nullable(),
});

const esquemaLlamadoPublico = z.strictObject({
  id: uuid,
  tipo: z.enum(['PEDIDO', 'LLAMAR_MOZO', 'PEDIR_CUENTA']),
  estado: z.literal('PENDIENTE'),
  creadoEn: instante,
  venceEn: instante,
  lineas: z.array(
    z.strictObject({
      nombre: z.string(),
      modificadores: z.array(z.string()),
      cantidad: z.number().int(),
      observacion: z.string().nullable(),
      precioUnitario: monto,
      total: monto,
    }),
  ),
  total: monto.nullable(),
});

const esquemaEstado = z.strictObject({
  id: uuid,
  tipo: z.enum(['PEDIDO', 'LLAMAR_MOZO', 'PEDIR_CUENTA']),
  estado: z.enum(['PENDIENTE', 'ATENDIDO', 'PASADO_A_CUENTA', 'DESCARTADO', 'VENCIDO']),
  venceEn: instante,
});

// El mismo contenido, como modelo de claves (un valor cualquiera de cada tipo).
const MODELO_MARCA = { nombre: '', logoUrl: '', colorPrincipal: '' };
const MODELO_CARTA = {
  empresa: MODELO_MARCA,
  sucursal: {
    nombre: '',
    slug: '',
    direccion: '',
    horario: [{ dia: 1, desde: '', hasta: '' }],
    abiertaAhora: true,
  },
  familias: [
    {
      id: '',
      nombre: '',
      productos: [
        {
          id: '',
          tipo: '',
          nombre: '',
          descripcion: '',
          fotoUrl: '',
          precio: '',
          grupos: [
            {
              id: '',
              nombre: '',
              seleccion: '',
              minimo: 0,
              maximo: 0,
              obligatorio: true,
              modificadores: [{ id: '', nombre: '', precioExtra: '' }],
            },
          ],
          componentes: [{ nombre: '', cantidad: 1 }],
        },
      ],
    },
  ],
};

// ------------------------------------------------------------------------------------------------
// Comprobaciones comunes
// ------------------------------------------------------------------------------------------------

/** Nada de la lista de campos prohibidos, a ninguna profundidad (los nombres de campo, no los valores). */
function camposProhibidosEn(cuerpo: unknown): string[] {
  const nombres = nombresDeCampos(cuerpo);
  return CAMPOS_PROHIBIDOS_EN_PUBLICO.filter((c) => nombres.has(c));
}

/** Los UUID de los productos que la carta oculta: ligados a un modificador o a un combo (no se venden solos). */
function idsOcultos(A: EmpresaDelMundo): string[] {
  return [A.carta.huevoFritoId, A.carta.hamburguesaId, A.carta.cervezaPilsenId];
}

/**
 * Comprueba, para una respuesta de la carta o de la disponibilidad, los UUID que salen: todos son de la carta de la
 * empresa y ninguno es el de un producto oculto (los que no se venden solos y, salvo que `exclusivoVisible`, el
 * producto propio de la empresa que la sucursal no vende).
 */
async function exigirUuidsDeLaCarta(
  cuerpo: unknown,
  A: EmpresaDelMundo,
  exclusivoVisible = false,
): Promise<void> {
  const uuids = uuidsComoValores(cuerpo);
  const problemas = await problemasDeUuidsPublicos(admin, uuids, A.empresaId);
  const ocultos = exclusivoVisible ? idsOcultos(A) : [...idsOcultos(A), A.productoExclusivo.id];
  for (const oculto of ocultos) {
    if (uuids.has(oculto))
      problemas.push(`${oculto}: es de un producto que la sucursal no muestra`);
  }
  exigirSinFallos(problemas);
}

/** Ningún texto de las respuestas es uno de los datos que no deben salir. */
function exigirSinTextos(cuerpo: unknown, prohibidos: string[], donde: string): void {
  const textos = new Set(textosSinUrls(cuerpo));
  const vistos = prohibidos.filter((p) => textos.has(p));
  expect(vistos, `${donde}: salieron datos que no debían`).toEqual([]);
}

// ------------------------------------------------------------------------------------------------
// 18 · La empresa
// ------------------------------------------------------------------------------------------------
describe('criterio 21 · GET /publico/cartas/:empresaSlug (empresaPublica)', () => {
  it('trae exactamente las claves del esquema, con las sucursales publicadas de A y nada de B', async () => {
    const { A, B } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/cartas/${A.slug}`);
    exigirEstado(res, 200, 'la empresa pública');
    esquemaEmpresaPublica.parse(res.body);
    expect(clavesOrdenadas(res.body)).toEqual(
      clavesOrdenadas({
        empresa: MODELO_MARCA,
        sucursales: [{ nombre: '', slug: '', direccion: '' }],
      }),
    );
    expect(res.body.empresa).toMatchObject({
      nombre: A.nombreCarta,
      colorPrincipal: A.colorPrincipal,
    });
    expect(res.body.empresa.logoUrl, 'la empresa subió su logo').toEqual(expect.any(String));
    expect((res.body.sucursales as { slug: string }[]).map((s) => s.slug).sort()).toEqual(
      [A.slugS1, A.slugS2].sort(),
    );
    expect(camposProhibidosEn(res.body)).toEqual([]);
    expect(uuidsComoValores(res.body).size, 'ningún id sale').toBe(0);
    exigirSinTextos(res.body, [B.nombreCarta, B.slug, A.empresaId, B.empresaId], 'empresa');
  });

  it('lo mismo con la empresa B: sus datos, no los de A', async () => {
    const { A, B } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/cartas/${B.slug}`);
    exigirEstado(res, 200, 'la empresa pública de B');
    esquemaEmpresaPublica.parse(res.body);
    expect(res.body.empresa.nombre).toBe(B.nombreCarta);
    exigirSinTextos(res.body, [A.nombreCarta, A.slug], 'empresa B');
  });
});

// ------------------------------------------------------------------------------------------------
// 19 a 21 · La carta de la sucursal
// ------------------------------------------------------------------------------------------------
describe('criterio 21 · GET /publico/cartas/:empresaSlug/:sucursalSlug (cartaPublica)', () => {
  it('trae exactamente las claves del esquema estricto y ninguna de la lista de lo que nunca sale', async () => {
    const { A } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/cartas/${A.slug}/${A.slugS1}`);
    exigirEstado(res, 200, 'la carta de S1');
    esquemaCartaPublica.parse(res.body);
    expect(clavesOrdenadas(res.body)).toEqual(clavesOrdenadas(MODELO_CARTA));
    expect(camposProhibidosEn(res.body)).toEqual([]);
    const productos = (res.body.familias as { productos: { nombre: string }[] }[]).flatMap(
      (f) => f.productos,
    );
    expect(productos.map((p) => p.nombre).sort()).toEqual(
      ['Combo hamburguesa', 'Gaseosa 1 L', 'Lomo saltado'].sort(),
    );
  });

  it('todo UUID que sale es el id de una familia, un producto, un grupo o un modificador de A; ningún id de otra tabla ni de un producto oculto', async () => {
    const { A } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/cartas/${A.slug}/${A.slugS1}`);
    exigirEstado(res, 200, 'la carta de S1');
    const uuids = uuidsComoValores(res.body);
    expect(uuids.size).toBeGreaterThan(8);
    await exigirUuidsDeLaCarta(res.body, A);
    // Los ids de la carta que sí deben estar.
    for (const id of [
      A.carta.lomoId,
      A.carta.comboId,
      A.carta.gaseosaId,
      A.carta.familiaId,
      A.carta.terminoIds.tresCuartos,
      A.carta.bebidaIds.cerveza,
    ]) {
      expect(uuids.has(id), `falta ${id}`).toBe(true);
    }
    for (const id of A.grupoIds.slice(0, 3))
      expect(uuids.has(id), `falta el grupo ${id}`).toBe(true);
  });

  it('ningún dato de B ni de S2 con datos parecidos: ni su nombre, ni su producto, ni sus ids, ni la dirección, el WhatsApp o la hora de corte', async () => {
    const { A, B, datos } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/cartas/${A.slug}/${A.slugS1}`);
    exigirEstado(res, 200, 'la carta de S1');
    exigirSinTextos(
      res.body,
      [
        B.nombreCarta,
        B.slug,
        B.productoExclusivo.nombre,
        A.productoExclusivo.nombre,
        String(datos.S2.nombre),
        String(datos.S2.direccion),
        ...datos.valores,
        A.empresaId,
        B.empresaId,
        A.S1,
        A.S2,
        B.S1,
      ],
      'carta de S1',
    );
    // Los ids de la carta de B no salen aunque sus nombres sean los mismos.
    const uuids = uuidsComoValores(res.body);
    for (const id of [B.carta.lomoId, B.carta.comboId, B.carta.gaseosaId, B.productoExclusivo.id]) {
      expect(uuids.has(id), `salió el id ${id} de B`).toBe(false);
    }
    expect(res.body.sucursal.direccion).toBe(String(datos.S1.direccion));
    expect(res.body.sucursal.nombre).toBe(String(datos.S1.nombre));
  });

  it('la carta de S2 trae su producto propio y nada de S1 ni de B', async () => {
    const { A, B, datos } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/cartas/${A.slug}/${A.slugS2}`);
    exigirEstado(res, 200, 'la carta de S2');
    esquemaCartaPublica.parse(res.body);
    const nombres = (res.body.familias as { productos: { nombre: string }[] }[]).flatMap((f) =>
      f.productos.map((p) => p.nombre),
    );
    expect(nombres).toContain(A.productoExclusivo.nombre);
    exigirSinTextos(
      res.body,
      [
        B.nombreCarta,
        B.productoExclusivo.nombre,
        String(datos.S1.nombre),
        String(datos.S1.direccion),
        ...datos.valores,
        A.S1,
        A.S2,
      ],
      'carta de S2',
    );
    await exigirUuidsDeLaCarta(res.body, A, true);
  });

  it('la carta de B trae sus propios datos', async () => {
    const { A, B } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/cartas/${B.slug}/${B.slugS1}`);
    exigirEstado(res, 200, 'la carta de B');
    esquemaCartaPublica.parse(res.body);
    expect(res.body.empresa.nombre).toBe(B.nombreCarta);
    exigirSinTextos(res.body, [A.nombreCarta, A.productoExclusivo.nombre, A.slug], 'carta de B');
    await exigirUuidsDeLaCarta(res.body, B, true);
    const uuids = uuidsComoValores(res.body);
    for (const id of [A.carta.lomoId, A.carta.comboId, A.carta.gaseosaId]) {
      expect(uuids.has(id), `salió el id ${id} de A en la carta de B`).toBe(false);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 23 · Disponibilidad
// ------------------------------------------------------------------------------------------------
describe('criterio 21 · GET /publico/cartas/:empresaSlug/:sucursalSlug/disponibilidad (disponibilidadPublica)', () => {
  const ruta = (A: EmpresaDelMundo) => `/publico/cartas/${A.slug}/${A.slugS1}/disponibilidad`;

  it('trae exactamente { vendibles: [{ id, modificadoresNoDisponibles }] } con ids de la carta de A', async () => {
    const { A } = await mundo();
    const res = await clientePublico(ctx).get(ruta(A));
    exigirEstado(res, 200, 'la disponibilidad de S1');
    esquemaDisponibilidad.parse(res.body);
    expect(clavesOrdenadas(res.body)).toEqual(
      clavesOrdenadas({ vendibles: [{ id: '', modificadoresNoDisponibles: [''] }] }),
    );
    expect(camposProhibidosEn(res.body)).toEqual([]);
    expect(
      (res.body.vendibles as { id: string }[]).map((v) => v.id).sort(),
      'los mismos productos que la carta',
    ).toEqual([A.carta.lomoId, A.carta.comboId, A.carta.gaseosaId].sort());
    await exigirUuidsDeLaCarta(res.body, A);
  });

  it('con una opción agotada, el combo sigue y trae solo el id del modificador no disponible', async () => {
    const { A } = await mundo();
    const cocina = (await sesiones(ctx, A.cocina, A.S1)).contrasena;
    const agotar = await llamar(ctx, cocina, {
      metodo: 'put',
      ruta: `/carta/sucursal/agotados/${A.carta.cervezaPilsenId}`,
      cuerpo: { hasta: 'FIN_DEL_DIA' },
    });
    exigirEstado(agotar, 200, 'agotar la Cerveza Pilsen');
    try {
      const res = await clientePublico(ctx).get(ruta(A));
      exigirEstado(res, 200, 'la disponibilidad con la cerveza agotada');
      esquemaDisponibilidad.parse(res.body);
      const combo = (
        res.body.vendibles as { id: string; modificadoresNoDisponibles: string[] }[]
      ).find((v) => v.id === A.carta.comboId);
      expect(combo?.modificadoresNoDisponibles).toEqual([A.carta.bebidaIds.cerveza]);
      await exigirUuidsDeLaCarta(res.body, A);
      expect(uuidsComoValores(res.body).has(A.carta.cervezaPilsenId)).toBe(false);
    } finally {
      exigirEstado(
        await llamar(ctx, cocina, {
          metodo: 'delete',
          ruta: `/carta/sucursal/agotados/${A.carta.cervezaPilsenId}`,
        }),
        204,
        'reactivar la Cerveza Pilsen',
      );
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 25 · La mesa
// ------------------------------------------------------------------------------------------------
describe('criterio 21 · GET /publico/mesas/:codigo (mesaPublica)', () => {
  it('trae exactamente las claves del esquema y no dice nada de la mesa, el mozo ni la cuenta', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const res = await cliente.get(`/publico/mesas/${A.mesa12.codigo}`);
    exigirEstado(res, 200, 'la mesa 12');
    esquemaMesaPublica.parse(res.body);
    expect(Object.keys(res.body).sort()).toEqual(
      ['aceptaLlamados', 'carta', 'llamadoPendiente', 'mesa', 'motivoNoAcepta'].sort(),
    );
    expect(res.body.mesa).toEqual({ nombre: '12' });
    expect(res.body.carta).toEqual({ empresaSlug: A.slug, sucursalSlug: A.slugS1 });
    expect(camposProhibidosEn(res.body)).toEqual([]);
    expect(uuidsComoValores(res.body).size, 'ningún id sale').toBe(0);
  });

  it('es la misma con la mesa libre y con la mesa ocupada: no dice si hay una cuenta abierta', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const libre = await cliente.get(`/publico/mesas/${mesa!.codigo}`);
    exigirEstado(libre, 200, 'la mesa libre');
    const mozo = (await sesiones(ctx, A.mozo, A.S1)).contrasena;
    exigirEstado(
      await postConClave(ctx, mozo, '/ordenes', {
        id: randomUUID(),
        mesaId: mesa!.id,
        comensales: 3,
      }),
      201,
      'abrir la mesa',
    );
    const ocupada = await cliente.get(`/publico/mesas/${mesa!.codigo}`);
    exigirEstado(ocupada, 200, 'la mesa ocupada');
    expect(ocupada.body).toEqual(libre.body);
    esquemaMesaPublica.parse(ocupada.body);
  });

  it('con un llamado pendiente trae solo { tipo, venceEn }', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(cliente, mesa!.codigo, pedidoDeLomo(A.carta, { id }));
    const res = await cliente.get(`/publico/mesas/${mesa!.codigo}`);
    exigirEstado(res, 200, 'la mesa con un pendiente');
    esquemaMesaPublica.parse(res.body);
    expect(Object.keys(res.body.llamadoPendiente as object).sort()).toEqual(['tipo', 'venceEn']);
    expect(res.body.llamadoPendiente.tipo).toBe('PEDIDO');
    expect(textosSinUrls(res.body)).not.toContain(id);
  });

  it('la mesa de S2 dice la dirección de S2', async () => {
    const { A } = await mundo();
    const res = await clientePublico(ctx).get(`/publico/mesas/${A.mesaS2.codigo}`);
    exigirEstado(res, 200, 'la mesa de S2');
    expect(res.body.carta).toEqual({ empresaSlug: A.slug, sucursalSlug: A.slugS2 });
  });
});

// ------------------------------------------------------------------------------------------------
// 26 y 38 · El llamado y su estado
// ------------------------------------------------------------------------------------------------
describe('criterio 21 · POST /publico/mesas/:codigo/llamados (llamadoPublico)', () => {
  it('un pedido trae exactamente las claves del esquema, con los nombres y precios que vio el cliente', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const id = randomUUID();
    const res = await cliente.post(rutaDeLlamados(mesa!.codigo), {
      id,
      tipo: 'PEDIDO',
      lineas: [
        {
          productoId: A.carta.comboId,
          modificadorIds: [A.carta.bebidaIds.cerveza],
          cantidad: 2,
          observacion: 'Sin cebolla',
        },
        { productoId: A.carta.gaseosaId, modificadorIds: [], cantidad: 1 },
      ],
      nota: 'Para compartir',
    });
    exigirEstado(res, 201, 'crear el pedido');
    esquemaLlamadoPublico.parse(res.body);
    expect(clavesOrdenadas(res.body)).toEqual(
      clavesOrdenadas({
        id: '',
        tipo: '',
        estado: '',
        creadoEn: '',
        venceEn: '',
        lineas: [
          {
            nombre: '',
            modificadores: [''],
            cantidad: 1,
            observacion: '',
            precioUnitario: '',
            total: '',
          },
        ],
        total: '',
      }),
    );
    expect(res.body.lineas[0]).toMatchObject({
      nombre: 'Combo hamburguesa',
      modificadores: ['Cerveza'],
      cantidad: 2,
      precioUnitario: '27.40',
      total: '54.80',
    });
    expect(res.body.total).toBe('63.80');
    expect(camposProhibidosEn(res.body)).toEqual([]);
    expect([...uuidsComoValores(res.body)]).toEqual([id]);
  });

  it('LLAMAR_MOZO y PEDIR_CUENTA traen las mismas claves, sin líneas y con total null', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [m1, m2] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 2);
    for (const [mesa, cuerpo] of [
      [m1!, llamarAlMozo()],
      [m2!, pedirLaCuenta()],
    ] as const) {
      const res = await cliente.post(rutaDeLlamados(mesa.codigo), cuerpo);
      exigirEstado(res, 201, `crear ${cuerpo.tipo}`);
      esquemaLlamadoPublico.parse(res.body);
      expect(Object.keys(res.body).sort()).toEqual(
        ['creadoEn', 'estado', 'id', 'lineas', 'tipo', 'total', 'venceEn'].sort(),
      );
      expect(res.body.lineas).toEqual([]);
      expect(res.body.total).toBeNull();
      expect(camposProhibidosEn(res.body)).toEqual([]);
      expect([...uuidsComoValores(res.body)]).toEqual([cuerpo.id]);
    }
  });

  it('la réplica con el mismo id trae el mismo cuerpo y las mismas claves', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const cuerpo = pedidoDeLomo(A.carta);
    const primera = await crearLlamadoOk(cliente, mesa!.codigo, cuerpo);
    const replica = await cliente.post(rutaDeLlamados(mesa!.codigo), cuerpo);
    exigirEstado(replica, 201, 'la réplica');
    esquemaLlamadoPublico.parse(replica.body);
    expect(replica.body).toEqual(primera.body);
  });
});

describe('criterio 21 · GET /publico/mesas/:codigo/llamados/:id (estadoLlamadoPublico)', () => {
  it('con un pendiente trae solo { id, tipo, estado, venceEn }', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(cliente, mesa!.codigo, pedirLaCuenta(id));
    const res = await cliente.get(`/publico/mesas/${mesa!.codigo}/llamados/${id}`);
    exigirEstado(res, 200, 'el estado');
    esquemaEstado.parse(res.body);
    expect(Object.keys(res.body).sort()).toEqual(['estado', 'id', 'tipo', 'venceEn']);
    expect(res.body.estado).toBe('PENDIENTE');
    expect(camposProhibidosEn(res.body)).toEqual([]);
  });

  it('atendido y descartado traen las mismas cuatro claves y ningún nombre ni id de las personas que atendieron', async () => {
    const { A, e } = await mundo();
    const cliente = clientePublico(ctx);
    const sembrados = await sembrarLlamados(ctx, A, cliente, e.mozo2);
    const ruta = `/publico/mesas/${A.mesa4.codigo}/llamados/${sembrados.descartado}`;
    const descartado = await cliente.get(ruta);
    exigirEstado(descartado, 200, 'el estado del descartado');
    esquemaEstado.parse(descartado.body);
    expect(descartado.body.estado).toBe('DESCARTADO');
    // Atendido, sin cerrar: una mesa nueva con un pedido que el Mozo atiende.
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(cliente, mesa!.codigo, pedidoDeLomo(A.carta, { id }));
    const mozo = (await sesiones(ctx, A.mozo, A.S1)).contrasena;
    await atenderLlamado(ctx, mozo, id, { ordenId: randomUUID(), comensales: 2 });
    const atendido = await cliente.get(`/publico/mesas/${mesa!.codigo}/llamados/${id}`);
    exigirEstado(atendido, 200, 'el estado del atendido');
    esquemaEstado.parse(atendido.body);
    expect(atendido.body.estado).toBe('ATENDIDO');
    // Ni el nombre de usuario ni el id de quien atendió.
    for (const cuerpo of [descartado.body, atendido.body]) {
      const textos = textosSinUrls(cuerpo);
      for (const prohibido of [
        A.mozo.id,
        A.mozo.usuario,
        e.mozo2.id,
        e.mozo2.usuario,
        sembrados.ordenId,
        A.mesa4.id,
        A.S1,
      ]) {
        expect(textos, `salió ${prohibido}`).not.toContain(prohibido);
      }
      expect(camposProhibidosEn(cuerpo)).toEqual([]);
    }
    // Descartar otro más no cambia la forma.
    const [otra] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const idOtro = randomUUID();
    await crearLlamadoOk(cliente, otra!.codigo, llamarAlMozo(idOtro));
    await descartarLlamado(ctx, mozo, idOtro, { motivo: 'Repetido' });
    const cerrado = await cliente.get(`/publico/mesas/${otra!.codigo}/llamados/${idOtro}`);
    exigirEstado(cerrado, 200, 'el estado del descartado sin atender');
    esquemaEstado.parse(cerrado.body);
    expect(Object.keys(cerrado.body).sort()).toEqual(['estado', 'id', 'tipo', 'venceEn']);
  });
});
