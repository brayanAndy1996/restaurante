// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P2 · Crear un llamado desde la mesa · Criterios 26 a 37 (y 21 en lo que sale al cliente). La API real con
// `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`, dos empresas (A con S1 y S2, y B), la carta de
// ejemplo de 004 creada por las rutas de 003, la carta web publicada por sus rutas, las mesas creadas por las
// rutas de 004 con su código leído de la hoja de QR y un `ClientePublico` por cliente (cada uno con su IP).
//
// Cubre: los tres tipos y su respuesta (26); límites de forma (26); la validación con la carta, todo o nada y
// el tope de monto (27); nada a cocina al crear (28); la réplica por id, también después de atender, vencer o
// agotar, y diez simultáneas (29); uno pendiente por mesa y dos simultáneos (30); el vencido que no bloquea y
// queda guardado (31); el límite por mesa (32); el límite por conexión y su huella (33); el orden de los
// rechazos (34); el horario (35); el aviso `llamado.nuevo` con sus destinatarios (36); y lo que queda guardado
// con el actor `carta-web` (37).
import { eventoLlamadoNuevoSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { agotar, enviarOk, pedirPrecuenta, reactivar } from '../salon-critica/fabrica-p2';
import {
  ANTES_DE_ABRIR,
  DESPUES_DE_CERRAR,
  HORARIO_DE_NOCHE,
  HORARIO_DE_SERVICIO,
  HORA_DE_SERVICIO,
  MINUTO,
  abriendo,
  abrirMesa,
  arrancarLlamados,
  atenderOk,
  cambiarProducto,
  clienteNuevo,
  contarLlamadosDeMesa,
  conteoDePedidos,
  crearLlamado,
  crearOk,
  cuerpoLlamarMozo,
  cuerpoPedido,
  cuerpoPedirCuenta,
  descartarOk,
  enviarLlamado,
  esperarError,
  eventosDeLlamado,
  eventosDePedidos,
  exigirEstado,
  filaLlamado,
  lineaDe,
  lineasDe,
  lineasDelPedido,
  limpiarRegistros,
  llamadosDeLaMesa,
  llamar,
  mesaConCodigo,
  mesaEnElMapa,
  mesasConCodigo,
  ordenesAbiertasDeLaMesa,
  pasarOk,
  ponerHorario,
  prepararEscenarioLlamados,
  productoPropio,
  verEstado,
  type AppLlamados,
  type EscenarioLlamados,
  type Lugar,
  type MesaLlamados,
} from './fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;
let L: ReturnType<typeof lineasDe>;

const t = () => esc.token;
const A = () => esc.e.A;
const nuevaMesa = (lugar: Lugar = 'S1'): Promise<MesaLlamados> => mesaConCodigo(ctx, esc, lugar);

beforeAll(async () => {
  ctx = await arrancarLlamados();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioLlamados(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(HORA_DE_SERVICIO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

/** La mesa no tiene ningún llamado guardado. */
async function sinLlamados(mesa: MesaLlamados): Promise<void> {
  expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(0);
}

/** Nada se publicó (ni de llamados ni de pedidos) desde la última limpieza. */
async function sinEventos(): Promise<void> {
  expect((await eventosDeLlamado(ctx)).map((e) => e.nombre)).toEqual([]);
  expect(await eventosDePedidos(ctx)).toEqual([]);
}

// ===================================================================================================
// Criterio 26 · crear un llamado: los tres tipos y su respuesta
// ===================================================================================================

describe('criterio 26 · los tres tipos de llamado y su respuesta', () => {
  it('un PEDIDO responde 201 con las líneas y el total tal como los ve el cliente (con el esquema estricto)', async () => {
    const mesa = await nuevaMesa();
    const id = randomUUID();
    const respuesta = await crearOk(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido(
        [
          L.lomo(['3/4', 'Huevo'], 2, { observacion: 'sin ají' }),
          L.gaseosa(1),
          L.combo(['Cerveza', 'Ensalada'], 1),
        ],
        { id, nota: 'Para compartir' },
      ),
    );
    expect(respuesta).toMatchObject({ id, tipo: 'PEDIDO', estado: 'PENDIENTE' });
    expect(new Date(respuesta.creadoEn).getTime()).toBe(ctx.reloj.ahora().getTime());
    expect(new Date(respuesta.venceEn).getTime()).toBe(ctx.reloj.ahora().getTime() + 15 * MINUTO);

    const [lomo, gaseosa, combo] = respuesta.lineas;
    expect(lomo).toMatchObject({
      nombre: 'Lomo saltado',
      cantidad: 2,
      observacion: 'sin ají',
      precioUnitario: '30.50',
      total: '61.00',
    });
    expect([...lomo!.modificadores].sort()).toEqual(['3/4', 'Huevo']);
    expect(gaseosa).toEqual({
      nombre: 'Gaseosa 1 L',
      modificadores: [],
      cantidad: 1,
      observacion: null,
      precioUnitario: '9.00',
      total: '9.00',
    });
    expect(combo).toMatchObject({
      nombre: 'Combo hamburguesa',
      cantidad: 1,
      precioUnitario: '28.40',
      total: '28.40',
    });
    expect([...combo!.modificadores].sort()).toEqual(['Cerveza', 'Ensalada']);
    // 61.00 + 9.00 + 28.40
    expect(respuesta.total).toBe('98.40');
  });

  it.each([
    ['LLAMAR_MOZO', cuerpoLlamarMozo],
    ['PEDIR_CUENTA', cuerpoPedirCuenta],
  ])('un %s responde 201 sin líneas y con total null', async (tipo, hacer) => {
    const mesa = await nuevaMesa();
    const id = randomUUID();
    const res = await enviarLlamado(clienteNuevo(ctx), mesa.codigo, hacer(id));
    exigirEstado(res, 201, `crear un ${tipo}`);
    expect(res.body).toEqual({
      id,
      tipo,
      estado: 'PENDIENTE',
      creadoEn: ctx.reloj.ahora().toISOString(),
      venceEn: new Date(ctx.reloj.ahora().getTime() + 15 * MINUTO).toISOString(),
      lineas: [],
      total: null,
    });
  });

  it('el id vuelve en minúsculas y las observaciones sin espacios al borde', async () => {
    const mesa = await nuevaMesa();
    const id = randomUUID();
    const res = await enviarLlamado(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido([L.gaseosa(1, { observacion: '  bien fría  ' })], { id: id.toUpperCase() }),
    );
    exigirEstado(res, 201, 'crear con el id en mayúsculas');
    expect(res.body.id).toBe(id.toLowerCase());
    expect(res.body.lineas[0].observacion).toBe('bien fría');
  });

  it('no pide nombre, teléfono ni pago: esos campos son un 400 (entrada estricta)', async () => {
    const mesa = await nuevaMesa();
    for (const extra of [{ nombre: 'Ana' }, { telefono: '999999999' }, { pago: 'TARJETA' }]) {
      const res = await enviarLlamado(clienteNuevo(ctx), mesa.codigo, {
        ...cuerpoPedido([L.gaseosa(1)]),
        ...extra,
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    await sinLlamados(mesa);
  });
});

// ===================================================================================================
// Criterio 26 · límites de forma
// ===================================================================================================

describe('criterio 26 · límites de forma', () => {
  const g = () => L.gaseosa(1);
  const unaLinea = (extra: Record<string, unknown>) => ({ ...g(), ...extra });
  const casos: [string, () => unknown][] = [
    ['sin líneas', () => cuerpoPedido([])],
    ['31 líneas', () => cuerpoPedido(Array.from({ length: 31 }, g))],
    ['cantidad 0', () => cuerpoPedido([unaLinea({ cantidad: 0 })])],
    ['cantidad 21', () => cuerpoPedido([unaLinea({ cantidad: 21 })])],
    ['cantidad con decimales', () => cuerpoPedido([unaLinea({ cantidad: 1.5 })])],
    ['cantidad como texto', () => cuerpoPedido([unaLinea({ cantidad: '2' })])],
    [
      '31 modificadores',
      () =>
        cuerpoPedido([
          unaLinea({ modificadorIds: Array.from({ length: 31 }, () => randomUUID()) }),
        ]),
    ],
    [
      'modificadores repetidos',
      () => {
        const m = randomUUID();
        return cuerpoPedido([unaLinea({ modificadorIds: [m, m] })]);
      },
    ],
    [
      'modificadores repetidos con otra capitalización',
      () => {
        const m = randomUUID();
        return cuerpoPedido([unaLinea({ modificadorIds: [m, m.toUpperCase()] })]);
      },
    ],
    [
      'sin modificadorIds',
      () => ({
        id: randomUUID(),
        tipo: 'PEDIDO',
        lineas: [{ productoId: esc.carta.gaseosa, cantidad: 1 }],
      }),
    ],
    ['observación vacía', () => cuerpoPedido([unaLinea({ observacion: '' })])],
    ['observación de solo espacios', () => cuerpoPedido([unaLinea({ observacion: '   ' })])],
    [
      'observación de 141 caracteres',
      () => cuerpoPedido([unaLinea({ observacion: 'x'.repeat(141) })]),
    ],
    ['nota vacía', () => cuerpoPedido([g()], { nota: '' })],
    ['nota de 141 caracteres', () => cuerpoPedido([g()], { nota: 'n'.repeat(141) })],
    ['productoId que no es un UUID', () => cuerpoPedido([unaLinea({ productoId: 'lomo' })])],
    ['sin id', () => ({ tipo: 'PEDIDO', lineas: [g()] })],
    ['id que no es un UUID', () => cuerpoPedido([g()], { id: 'no-es-un-uuid' })],
    ['sin tipo', () => ({ id: randomUUID(), lineas: [g()] })],
    ['tipo desconocido', () => ({ id: randomUUID(), tipo: 'DELIVERY', lineas: [g()] })],
    ['un PEDIDO sin la clave lineas', () => ({ id: randomUUID(), tipo: 'PEDIDO' })],
    ['LLAMAR_MOZO con líneas', () => ({ ...cuerpoLlamarMozo(), lineas: [g()] })],
    ['PEDIR_CUENTA con nota', () => ({ ...cuerpoPedirCuenta(), nota: 'hola' })],
    ['mesaId en el cuerpo', () => ({ ...cuerpoPedido([g()]), mesaId: randomUUID() })],
    ['sucursalId en el cuerpo', () => ({ ...cuerpoPedido([g()]), sucursalId: A().S1 })],
    ['empresaId en el cuerpo', () => ({ ...cuerpoPedido([g()]), empresaId: A().empresaId })],
    ['precio en la línea', () => cuerpoPedido([unaLinea({ precio: '1.00' })])],
    ['tiempo en la línea', () => cuerpoPedido([unaLinea({ tiempo: 2 })])],
    ['paraLlevar en la línea', () => cuerpoPedido([unaLinea({ paraLlevar: true })])],
    ['un arreglo en vez de un objeto', () => []],
  ];

  it.each(casos)('%s → 400 DATOS_INVALIDOS y no se guarda nada', async (_nombre, hacer) => {
    const mesa = await nuevaMesa();
    await limpiarRegistros(ctx);
    const res = await enviarLlamado(clienteNuevo(ctx), mesa.codigo, hacer());
    esperarError(res, 400, 'DATOS_INVALIDOS');
    await sinLlamados(mesa);
    await sinEventos();
  });

  it('los límites exactos sí se aceptan: 30 líneas, cantidad 20, observación y nota de 140', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 3);
    const treinta = await enviarLlamado(
      clienteNuevo(ctx),
      mesas[0]!.codigo,
      cuerpoPedido(Array.from({ length: 30 }, () => L.gaseosa(1))),
    );
    exigirEstado(treinta, 201, '30 líneas');
    expect(treinta.body.lineas).toHaveLength(30);

    const veinte = await enviarLlamado(
      clienteNuevo(ctx),
      mesas[1]!.codigo,
      cuerpoPedido([L.gaseosa(20)]),
    );
    exigirEstado(veinte, 201, 'cantidad 20');
    expect(veinte.body).toMatchObject({ total: '180.00' });

    const textos = await enviarLlamado(
      clienteNuevo(ctx),
      mesas[2]!.codigo,
      cuerpoPedido([L.gaseosa(1, { observacion: 'o'.repeat(140) })], { nota: 'n'.repeat(140) }),
    );
    exigirEstado(textos, 201, 'textos de 140 caracteres');
    expect(textos.body.lineas[0].observacion).toBe('o'.repeat(140));
  });

  it('30 modificadores pasan la forma y los rechaza la carta (422 por línea), no el 400', async () => {
    const mesa = await nuevaMesa();
    const res = await enviarLlamado(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido([
        {
          productoId: esc.carta.gaseosa,
          modificadorIds: Array.from({ length: 30 }, () => randomUUID()),
          cantidad: 1,
        },
      ]),
    );
    expect(res.status, res.text).toBe(422);
    expect(res.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['lineas.0']);
    await sinLlamados(mesa);
  });

  it('un cuerpo mal formado a un código que no existe responde 400, no 404 (la forma va primero)', async () => {
    const res = await enviarLlamado(clienteNuevo(ctx), 'Z'.repeat(22), {
      id: 'no-es-un-uuid',
      tipo: 'PEDIDO',
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
  });
});

// ===================================================================================================
// Criterio 27 · se valida con la carta, todo o nada
// ===================================================================================================

describe('criterio 27 · la validación con la carta es todo o nada', () => {
  /** Envía [línea buena, línea mala] y comprueba el rechazo, que no quedó nada y que no se publicó nada. */
  async function rechazaLaSegunda(
    mala: ReturnType<typeof lineaDe>,
    estado: 422,
    codigo: string,
  ): Promise<{ mesa: MesaLlamados; id: string; res: Awaited<ReturnType<typeof enviarLlamado>> }> {
    const mesa = await nuevaMesa();
    const id = randomUUID();
    await limpiarRegistros(ctx);
    const res = await enviarLlamado(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido([L.gaseosa(1), mala], { id }),
    );
    esperarError(res, estado, codigo);
    expect(res.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['lineas.1']);
    await sinLlamados(mesa);
    await sinEventos();
    expect(await filaLlamado(admin, mesa.empresaId, id)).toBeUndefined();
    return { mesa, id, res };
  }

  it('un producto agotado es 422 PRODUCTO_NO_VENDIBLE en su línea; al reactivarlo, el mismo id crea el llamado', async () => {
    const plato = await productoPropio(ctx, esc, '15.00');
    await agotar(ctx, t().cocina, plato.id);
    try {
      const { mesa, id } = await rechazaLaSegunda(lineaDe(plato.id), 422, 'PRODUCTO_NO_VENDIBLE');
      await reactivar(ctx, t().cocina, plato.id);
      const ok = await crearOk(
        clienteNuevo(ctx),
        mesa.codigo,
        cuerpoPedido([L.gaseosa(1), lineaDe(plato.id)], { id }),
      );
      expect(ok.id).toBe(id);
      expect(ok.total).toBe('24.00');
    } finally {
      await reactivar(ctx, t().cocina, plato.id).catch(() => undefined);
    }
  });

  it('un producto que no se vende solo (Huevo frito) es 422 PRODUCTO_NO_VENDIBLE', async () => {
    await rechazaLaSegunda(lineaDe(esc.carta.huevoFrito), 422, 'PRODUCTO_NO_VENDIBLE');
  });

  it('un producto que no existe es 422 en su línea', async () => {
    const mesa = await nuevaMesa();
    const res = await enviarLlamado(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido([L.gaseosa(1), lineaDe(randomUUID())]),
    );
    expect(res.status, res.text).toBe(422);
    expect(res.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['lineas.1']);
    await sinLlamados(mesa);
  });

  it('un componente agotado (Hamburguesa) es 422 PRODUCTO_NO_VENDIBLE con COMPONENTE_NO_DISPONIBLE', async () => {
    await agotar(ctx, t().cocina, esc.carta.hamburguesa);
    try {
      const { res } = await rechazaLaSegunda(
        L.combo(['Chicha', 'Ensalada'], 1),
        422,
        'PRODUCTO_NO_VENDIBLE',
      );
      expect(JSON.stringify(res.body.campos)).toContain('COMPONENTE_NO_DISPONIBLE');
    } finally {
      await reactivar(ctx, t().cocina, esc.carta.hamburguesa);
    }
  });

  it('una opción no disponible (Cerveza agotada) es 422 SELECCION_INVALIDA con MODIFICADOR_NO_DISPONIBLE; otra opción del grupo sí pasa', async () => {
    await agotar(ctx, t().cocina, esc.carta.cervezaPilsen);
    try {
      const { res, mesa } = await rechazaLaSegunda(
        L.combo(['Cerveza', 'Ensalada'], 1),
        422,
        'SELECCION_INVALIDA',
      );
      expect(JSON.stringify(res.body.campos)).toContain('MODIFICADOR_NO_DISPONIBLE');
      const otra = await crearOk(
        clienteNuevo(ctx),
        mesa.codigo,
        cuerpoPedido([L.combo(['Chicha', 'Ensalada'], 1)]),
      );
      expect(otra.lineas).toHaveLength(1);
    } finally {
      await reactivar(ctx, t().cocina, esc.carta.cervezaPilsen);
    }
  });

  it.each([
    ['Lomo sin el término obligatorio', () => L.lomo([], 1)],
    ['Combo con dos bebidas', () => L.combo(['Chicha', 'Inca Kola', 'Ensalada'], 1)],
    ['Combo sin acompañamiento', () => L.combo(['Chicha'], 1)],
    ['Menú sin armar', () => L.menu([], 1)],
    ['Lomo con tres extras (máximo 2)', () => L.lomo(['3/4', 'Huevo', 'Plátano', 'Queso'], 1)],
  ])('%s es 422 SELECCION_INVALIDA', async (_nombre, hacer) => {
    await rechazaLaSegunda(hacer(), 422, 'SELECCION_INVALIDA');
  });

  it('una opción del menú que ya no es de hoy es 422 SELECCION_INVALIDA; al armarlo de nuevo, el mismo llamado se acepta', async () => {
    const armar = async (opciones: string[]) => {
      const res = await llamar(ctx, t().adminS1, {
        metodo: 'put',
        ruta: `/carta/sucursal/menu-del-dia/${esc.carta.menu}`,
        cuerpo: { opciones },
      });
      exigirEstado(res, 200, 'armar el menú del día');
    };
    const todas = [
      esc.carta.mod['Sopa'],
      esc.carta.mod['Ají de gallina'],
      esc.carta.mod['Lomo saltado'],
    ];
    await armar([esc.carta.mod['Sopa'], esc.carta.mod['Lomo saltado']]);
    try {
      const { mesa, id } = await rechazaLaSegunda(
        L.menu(['Sopa', 'Ají de gallina'], 1),
        422,
        'SELECCION_INVALIDA',
      );
      await armar(todas);
      const ok = await crearOk(
        clienteNuevo(ctx),
        mesa.codigo,
        cuerpoPedido([L.gaseosa(1), L.menu(['Sopa', 'Ají de gallina'], 1)], { id }),
      );
      expect(ok.lineas).toHaveLength(2);
    } finally {
      await armar(todas);
    }
  });

  it('campos lleva una entrada por línea rechazada y el código es el de la primera', async () => {
    const mesa = await nuevaMesa();
    const huevoFrito = lineaDe(esc.carta.huevoFrito);
    const res = await enviarLlamado(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido([L.lomo(['3/4']), huevoFrito, L.gaseosa(2), L.lomo([]), L.gaseosa(1)]),
    );
    esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
    expect(res.body.campos.map((c: { campo: string }) => c.campo).sort()).toEqual([
      'lineas.1',
      'lineas.3',
    ]);
    const otra = await enviarLlamado(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido([L.lomo(['3/4']), L.lomo([]), huevoFrito, L.gaseosa(1)]),
    );
    esperarError(otra, 422, 'SELECCION_INVALIDA');
    expect(otra.body.campos.map((c: { campo: string }) => c.campo).sort()).toEqual([
      'lineas.1',
      'lineas.2',
    ]);
    await sinLlamados(mesa);
  });

  it('todo o nada: las líneas buenas tampoco se guardan, y el cliente reenvía solo lo bueno', async () => {
    const mesa = await nuevaMesa();
    await limpiarRegistros(ctx);
    const buenas = [L.lomo(['3/4']), L.gaseosa(2)];
    const res = await enviarLlamado(
      clienteNuevo(ctx),
      mesa.codigo,
      cuerpoPedido([...buenas, lineaDe(esc.carta.huevoFrito)]),
    );
    esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
    await sinLlamados(mesa);
    await sinEventos();
    const reenvio = await crearOk(clienteNuevo(ctx), mesa.codigo, cuerpoPedido(buenas));
    expect(reenvio.lineas).toHaveLength(2);
  });

  it('el llamado guarda las líneas como las vio el cliente: un cambio de precio posterior no las cambia', async () => {
    const plato = await productoPropio(ctx, esc, '20.00');
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([lineaDe(plato.id, 2)]));
    expect(creado.respuesta).toMatchObject({ total: '40.00' });
    await cambiarProducto(ctx, esc, plato.id, { precio: '25.00' });
    const fila = await filaLlamado(admin, mesa.empresaId, creado.id);
    expect(fila!.total).toBe('40.00');
    // La réplica devuelve la primera respuesta, con el precio que vio el cliente.
    const replica = await enviarLlamado(creado.cliente, mesa.codigo, creado.cuerpo);
    exigirEstado(replica, 201, 'réplica');
    expect(replica.body).toEqual(creado.respuesta);
  });

  describe('tope de monto (MONTO_FUERA_DE_RANGO)', () => {
    it('una línea que pasa de 99999999.99 es 422 MONTO_FUERA_DE_RANGO y no se guarda nada', async () => {
      const tesoro = await productoPropio(ctx, esc, '99999999.99');
      const mesa = await nuevaMesa();
      const res = await enviarLlamado(
        clienteNuevo(ctx),
        mesa.codigo,
        cuerpoPedido([lineaDe(tesoro.id, 2)]),
      );
      esperarError(res, 422, 'MONTO_FUERA_DE_RANGO');
      await sinLlamados(mesa);
    });

    it('exactamente 99999999.99 sí se acepta', async () => {
      const tesoro = await productoPropio(ctx, esc, '99999999.99');
      const mesa = await nuevaMesa();
      const ok = await crearOk(
        clienteNuevo(ctx),
        mesa.codigo,
        cuerpoPedido([lineaDe(tesoro.id, 1)]),
      );
      expect(ok.total).toBe('99999999.99');
    });

    it('un llamado cuyo total pasa del tope aunque cada línea quepa es 422 MONTO_FUERA_DE_RANGO', async () => {
      const joya = await productoPropio(ctx, esc, '99999999.00');
      const mesa = await nuevaMesa();
      const res = await enviarLlamado(
        clienteNuevo(ctx),
        mesa.codigo,
        cuerpoPedido([lineaDe(joya.id, 1), L.gaseosa(1)]),
      );
      esperarError(res, 422, 'MONTO_FUERA_DE_RANGO');
      await sinLlamados(mesa);
    });
  });
});

// ===================================================================================================
// Criterio 28 · crear no llega a cocina
// ===================================================================================================

describe('criterio 28 · crear un llamado no llega a cocina', () => {
  it.each([
    ['PEDIDO', () => cuerpoPedido(lineasDelPedido(esc), { nota: 'sin picante' })],
    ['LLAMAR_MOZO', () => cuerpoLlamarMozo()],
    ['PEDIR_CUENTA', () => cuerpoPedirCuenta()],
  ])(
    'un %s con la mesa libre no crea orden, envío, ítem, comanda ni trabajo de impresión',
    async (_tipo, hacer) => {
      const mesa = await nuevaMesa();
      const antes = await conteoDePedidos(admin, mesa.empresaId);
      await limpiarRegistros(ctx);

      await crearOk(clienteNuevo(ctx), mesa.codigo, hacer());

      expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(antes);
      expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
      expect(ctx.inventario.llamadas()).toEqual([]);
      expect(await eventosDePedidos(ctx)).toEqual([]);
      const enElMapa = await mesaEnElMapa(ctx, t().mozo, mesa.id);
      expect(enElMapa).toMatchObject({ estado: 'LIBRE', orden: null });
    },
  );

  it('con la mesa ocupada, la orden no cambia: ni ítems, ni versión, ni estado', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo);
    const antes = await conteoDePedidos(admin, mesa.empresaId);
    const version = (await admin.query('SELECT version FROM orden WHERE id = $1', [ordenId]))
      .rows[0].version;
    await limpiarRegistros(ctx);

    await crearOk(clienteNuevo(ctx), mesa.codigo, cuerpoPedido(lineasDelPedido(esc)));

    expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(antes);
    expect(
      (await admin.query('SELECT version, estado FROM orden WHERE id = $1', [ordenId])).rows[0],
    ).toEqual({
      version,
      estado: 'ABIERTA',
    });
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(await eventosDePedidos(ctx)).toEqual([]);
    expect(await mesaEnElMapa(ctx, t().mozo, mesa.id)).toMatchObject({ estado: 'OCUPADA' });
  });

  it('con la mesa en pre-cuenta sigue en pre-cuenta (amarilla)', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo);
    await enviarOk(ctx, t().mozo, ordenId, [L.gaseosa(1)]);
    exigirEstado(await pedirPrecuenta(ctx, t().mozo, ordenId), 201, 'pedir la pre-cuenta');
    await crearOk(clienteNuevo(ctx), mesa.codigo, cuerpoPedirCuenta());
    expect(await mesaEnElMapa(ctx, t().mozo, mesa.id)).toMatchObject({ estado: 'EN_PRECUENTA' });
  });
});

// ===================================================================================================
// Criterio 29 · réplica por id
// ===================================================================================================

describe('criterio 29 · réplica por id', () => {
  it('repetir el POST con el mismo id responde 201 con el cuerpo de la primera respuesta, sin otro llamado ni evento', async () => {
    const mesa = await nuevaMesa();
    const cliente = clienteNuevo(ctx);
    const primera = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)), cliente);
    await limpiarRegistros(ctx);
    for (let i = 0; i < 3; i += 1) {
      ctx.reloj.avanzar(10_000);
      const res = await enviarLlamado(cliente, mesa.codigo, primera.cuerpo);
      exigirEstado(res, 201, `réplica ${i + 1}`);
      expect(res.body).toEqual(primera.respuesta);
    }
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
    await sinEventos();
  });

  it('también desde otro cliente (otra IP): la identidad es el id, no la conexión', async () => {
    const mesa = await nuevaMesa();
    const primera = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    const res = await enviarLlamado(clienteNuevo(ctx), mesa.codigo, primera.cuerpo);
    exigirEstado(res, 201, 'réplica desde otra IP');
    expect(res.body).toEqual(primera.respuesta);
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
  });

  it('con la entrada normalizada: ids en mayúsculas, modificadores en otro orden y textos con espacios al borde', async () => {
    const mesa = await nuevaMesa();
    const id = randomUUID();
    const lomo = L.lomo(['3/4', 'Huevo'], 2, { observacion: 'sin ají' });
    const primera = await crearLlamado(
      ctx,
      mesa,
      cuerpoPedido([lomo, L.gaseosa(1)], { id, nota: 'rápido' }),
    );
    const otraForma = {
      id: id.toUpperCase(),
      tipo: 'PEDIDO',
      lineas: [
        {
          productoId: lomo.productoId.toUpperCase(),
          modificadorIds: [...lomo.modificadorIds].reverse().map((m) => m.toUpperCase()),
          cantidad: 2,
          observacion: '  sin ají ',
        },
        { productoId: esc.carta.gaseosa, modificadorIds: [], cantidad: 1 },
      ],
      nota: ' rápido  ',
    };
    const res = await enviarLlamado(primera.cliente, mesa.codigo, otraForma);
    exigirEstado(res, 201, 'réplica con la entrada normalizada');
    expect(res.body).toEqual(primera.respuesta);
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
  });

  it('sigue siendo una réplica (201 con el mismo cuerpo) después de que el mozo lo atiende', async () => {
    const mesa = await nuevaMesa();
    const primera = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    await atenderOk(ctx, t().mozo, primera.id, abriendo());
    const res = await enviarLlamado(primera.cliente, mesa.codigo, primera.cuerpo);
    exigirEstado(res, 201, 'réplica de un llamado atendido');
    expect(res.body).toEqual(primera.respuesta);
    expect(res.body.estado).toBe('PENDIENTE');
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
  });

  it('sigue siendo una réplica después de vencer (15 minutos) y aun con otro llamado de la mesa en medio', async () => {
    const mesa = await nuevaMesa();
    const primera = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    ctx.reloj.avanzar(16 * MINUTO);
    const segundo = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const res = await enviarLlamado(primera.cliente, mesa.codigo, primera.cuerpo);
    exigirEstado(res, 201, 'réplica de un llamado vencido');
    expect(res.body).toEqual(primera.respuesta);
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(2);
    expect(segundo.respuesta.id).not.toBe(primera.id);
  });

  it('sigue siendo una réplica aunque el producto se haya agotado', async () => {
    const plato = await productoPropio(ctx, esc, '12.00');
    const mesa = await nuevaMesa();
    const primera = await crearLlamado(ctx, mesa, cuerpoPedido([lineaDe(plato.id, 2)]));
    await agotar(ctx, t().cocina, plato.id);
    try {
      const res = await enviarLlamado(primera.cliente, mesa.codigo, primera.cuerpo);
      exigirEstado(res, 201, 'réplica con el producto agotado');
      expect(res.body).toEqual(primera.respuesta);
    } finally {
      await reactivar(ctx, t().cocina, plato.id);
    }
  });

  it('el mismo id con otra entrada o con otra mesa es 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no crea nada', async () => {
    const [mesa, otraMesa] = await mesasConCodigo(ctx, esc, 2);
    const id = randomUUID();
    const primera = await crearLlamado(ctx, mesa!, cuerpoPedido([L.gaseosa(1)], { id }));

    const otraCantidad = await enviarLlamado(
      primera.cliente,
      mesa!.codigo,
      cuerpoPedido([L.gaseosa(2)], { id }),
    );
    esperarError(otraCantidad, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    const otroTipo = await enviarLlamado(primera.cliente, mesa!.codigo, cuerpoLlamarMozo(id));
    esperarError(otroTipo, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    const otraNota = await enviarLlamado(
      primera.cliente,
      mesa!.codigo,
      cuerpoPedido([L.gaseosa(1)], { id, nota: 'otra' }),
    );
    esperarError(otraNota, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    const otraMesaRes = await enviarLlamado(
      primera.cliente,
      otraMesa!.codigo,
      cuerpoPedido([L.gaseosa(1)], { id }),
    );
    esperarError(otraMesaRes, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

    expect(await contarLlamadosDeMesa(admin, mesa!.id)).toBe(1);
    expect(await contarLlamadosDeMesa(admin, otraMesa!.id)).toBe(0);
    // Y la primera sigue siendo la misma.
    const replica = await enviarLlamado(primera.cliente, mesa!.codigo, primera.cuerpo);
    expect(replica.body).toEqual(primera.respuesta);
  });

  it('diez peticiones simultáneas con el mismo id dejan exactamente un llamado y un solo aviso', async () => {
    const mesa = await nuevaMesa();
    const cuerpo = cuerpoPedido(lineasDelPedido(esc));
    const cliente = clienteNuevo(ctx);
    await limpiarRegistros(ctx);
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () => enviarLlamado(cliente, mesa.codigo, cuerpo)),
    );
    const finales = [];
    for (const r of respuestas) {
      if (r.status === 201) {
        finales.push(r.body);
      } else {
        // Un 409 CONFLICTO es aceptable si, repetido, responde 201 (criterio 29).
        expect(r.status, r.text).toBe(409);
        expect(r.body.codigo).toBe('CONFLICTO');
        const repetida = await enviarLlamado(cliente, mesa.codigo, cuerpo);
        exigirEstado(repetida, 201, 'la repetición de un 409');
        finales.push(repetida.body);
      }
    }
    expect(finales).toHaveLength(10);
    for (const cuerpoFinal of finales) expect(cuerpoFinal).toEqual(finales[0]);
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
    expect(await eventosDeLlamado(ctx, 'llamado.nuevo')).toHaveLength(1);
  });
});

// ===================================================================================================
// Criterios 30 y 31 · uno pendiente por mesa; el vencido no bloquea
// ===================================================================================================

describe('criterio 30 · uno pendiente por mesa', () => {
  it.each([
    [
      'PEDIDO y luego LLAMAR_MOZO',
      () => cuerpoPedido(lineasDelPedido(esc)),
      () => cuerpoLlamarMozo(),
    ],
    [
      'LLAMAR_MOZO y luego PEDIDO',
      () => cuerpoLlamarMozo(),
      () => cuerpoPedido(lineasDelPedido(esc)),
    ],
    ['PEDIR_CUENTA y luego PEDIR_CUENTA', () => cuerpoPedirCuenta(), () => cuerpoPedirCuenta()],
    ['LLAMAR_MOZO y luego PEDIR_CUENTA', () => cuerpoLlamarMozo(), () => cuerpoPedirCuenta()],
  ])(
    '%s: el segundo con otro id es 409 LLAMADO_PENDIENTE y no se guarda nada',
    async (_n, primero, segundo) => {
      const mesa = await nuevaMesa();
      const uno = await crearLlamado(ctx, mesa, primero());
      await limpiarRegistros(ctx);
      const res = await enviarLlamado(clienteNuevo(ctx), mesa.codigo, segundo());
      esperarError(res, 409, 'LLAMADO_PENDIENTE');
      expect(res.body.mensaje).toContain('Ya avisamos al mozo');
      expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
      await sinEventos();
      // El primero sigue pendiente y sigue siendo el de la mesa.
      const vista = await enviarLlamado(uno.cliente, mesa.codigo, uno.cuerpo);
      expect(vista.body).toEqual(uno.respuesta);
    },
  );

  it('el pendiente de una mesa no bloquea a otra mesa de la misma sucursal', async () => {
    const [a, b] = await mesasConCodigo(ctx, esc, 2);
    await crearLlamado(ctx, a!, cuerpoLlamarMozo());
    await crearLlamado(ctx, b!, cuerpoLlamarMozo());
  });

  it.each(['ATENDIDO', 'PASADO_A_CUENTA', 'DESCARTADO', 'VENCIDO'] as const)(
    'un llamado %s no bloquea: el cliente puede mandar otro',
    async (estado) => {
      const mesa = await nuevaMesa();
      const primero = await crearLlamado(
        ctx,
        mesa,
        estado === 'PASADO_A_CUENTA' ? cuerpoPedido(lineasDelPedido(esc)) : cuerpoLlamarMozo(),
      );
      switch (estado) {
        case 'ATENDIDO':
          await atenderOk(ctx, t().mozo, primero.id, abriendo());
          break;
        case 'PASADO_A_CUENTA':
          await atenderOk(ctx, t().mozo, primero.id, abriendo());
          await pasarOk(ctx, t().mozo, primero.id, [
            { posicion: 0, cantidad: 2 },
            { posicion: 1, cantidad: 1 },
          ]);
          break;
        case 'DESCARTADO':
          await descartarOk(ctx, t().mozo, primero.id, { motivo: 'Repetido' });
          break;
        case 'VENCIDO':
          ctx.reloj.avanzar(15 * MINUTO);
          break;
      }
      const segundo = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
      expect(segundo.respuesta.estado).toBe('PENDIENTE');
      expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(2);
    },
  );

  it('dos llamados simultáneos de la misma mesa con ids distintos: exactamente uno es 201 y el otro 409 LLAMADO_PENDIENTE', async () => {
    const mesa = await nuevaMesa();
    await limpiarRegistros(ctx);
    const [r1, r2] = await Promise.all([
      enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
      enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoPedido([L.gaseosa(1)])),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const perdedor = r1.status === 409 ? r1 : r2;
    esperarError(perdedor, 409, 'LLAMADO_PENDIENTE');
    const filas = await llamadosDeLaMesa(admin, mesa.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.estado).toBe('PENDIENTE');
    expect(await eventosDeLlamado(ctx, 'llamado.nuevo')).toHaveLength(1);
  });

  it('veinte intentos simultáneos con ids distintos dejan un solo pendiente', async () => {
    const mesa = await nuevaMesa();
    const respuestas = await Promise.all(
      Array.from({ length: 20 }, () =>
        enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
      ),
    );
    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of respuestas.filter((x) => x.status !== 201)) {
      expect([409, 429]).toContain(r.status);
    }
    const filas = await llamadosDeLaMesa(admin, mesa.id);
    expect(filas.filter((f) => f.estado === 'PENDIENTE')).toHaveLength(1);
    expect(filas).toHaveLength(1);
  });
});

describe('criterio 31 · un vencido no bloquea y queda guardado', () => {
  it('a los 14:59.999 todavía bloquea; a los 15:00 ya no, y el viejo queda guardado como VENCIDO', async () => {
    const mesa = await nuevaMesa();
    const viejo = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    ctx.reloj.avanzar(15 * MINUTO - 1);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
      409,
      'LLAMADO_PENDIENTE',
    );
    expect((await filaLlamado(admin, mesa.empresaId, viejo.id))!.estado).toBe('PENDIENTE');

    ctx.reloj.avanzar(1);
    const nuevo = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    expect(nuevo.respuesta.estado).toBe('PENDIENTE');

    const filaViejo = await filaLlamado(admin, mesa.empresaId, viejo.id);
    expect(filaViejo!.estado).toBe('VENCIDO');
    expect(filaViejo!.vencido_en).not.toBeNull();
    expect((await filaLlamado(admin, mesa.empresaId, nuevo.id))!.estado).toBe('PENDIENTE');
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(2);
  });
});

// ===================================================================================================
// Criterio 32 · límite por mesa
// ===================================================================================================

describe('criterio 32 · límite por mesa (6 en 30 minutos)', () => {
  /** Crea `cantidad` llamados de la mesa, uno cada 5 minutos desde ahora, descartando cada uno al crearlo. */
  async function llenar(mesa: MesaLlamados, cantidad: number, cadaMinutos = 5): Promise<number> {
    const inicio = ctx.reloj.ahora().getTime();
    for (let i = 0; i < cantidad; i += 1) {
      ctx.reloj.fijar(inicio + i * cadaMinutos * MINUTO);
      const c = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
      await descartarOk(ctx, t().mozo, c.id, { motivo: 'Prueba' });
    }
    return inicio;
  }

  it('el séptimo en la ventana es 429 DEMASIADOS_LLAMADOS con reintentarEnSegundos exacto y Retry-After, sin guardar nada', async () => {
    const mesa = await nuevaMesa();
    const inicio = await llenar(mesa, 6);
    ctx.reloj.fijar(inicio + 29 * MINUTO);
    await limpiarRegistros(ctx);
    const res = await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo());
    esperarError(res, 429, 'DEMASIADOS_LLAMADOS');
    expect(res.body.reintentarEnSegundos).toBe(60);
    expect(res.headers['retry-after']).toBe('60');
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(6);
    await sinEventos();
  });

  it('un milisegundo antes de que salga el más antiguo se reintenta en 1 segundo; a los 30:00 se permite', async () => {
    const mesa = await nuevaMesa();
    const inicio = await llenar(mesa, 6);
    ctx.reloj.fijar(inicio + 30 * MINUTO - 1);
    const casi = await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo());
    esperarError(casi, 429, 'DEMASIADOS_LLAMADOS');
    expect(casi.body.reintentarEnSegundos).toBe(1);
    expect(casi.headers['retry-after']).toBe('1');

    ctx.reloj.fijar(inicio + 30 * MINUTO);
    const ahora = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    expect(ahora.respuesta.estado).toBe('PENDIENTE');
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(7);
  });

  it('los seis cuentan sea cual sea su estado (descartado, vencido, atendido…)', async () => {
    const mesa = await nuevaMesa();
    const inicio = ctx.reloj.ahora().getTime();
    // 1 vencido (se vence al siguiente), 2 descartados, 1 atendido, 1 pasado y 1 pendiente.
    await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    ctx.reloj.fijar(inicio + 16 * MINUTO); // el primero vence
    const b = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await descartarOk(ctx, t().mozo, b.id);
    const c = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    await descartarOk(ctx, t().mozo, c.id);
    const d = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await atenderOk(ctx, t().mozo, d.id, abriendo());
    const e = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    await atenderOk(ctx, t().mozo, e.id);
    await pasarOk(ctx, t().mozo, e.id, [{ posicion: 0, cantidad: 1 }]);
    const f = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await descartarOk(ctx, t().mozo, f.id);
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(6);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
      429,
      'DEMASIADOS_LLAMADOS',
    );
  });

  it('las réplicas y los rechazados no cuentan: el sexto sí entra y el séptimo no', async () => {
    const mesa = await nuevaMesa();
    const inicio = await llenar(mesa, 4);
    ctx.reloj.fijar(inicio + 20 * MINUTO);
    // Dos rechazos por la carta: no cuentan.
    for (let i = 0; i < 2; i += 1) {
      esperarError(
        await enviarLlamado(
          clienteNuevo(ctx),
          mesa.codigo,
          cuerpoPedido([lineaDe(esc.carta.huevoFrito)]),
        ),
        422,
        'PRODUCTO_NO_VENDIBLE',
      );
    }
    // El quinto queda pendiente; dos intentos más son 409 LLAMADO_PENDIENTE y tampoco cuentan.
    const quinto = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    for (let i = 0; i < 2; i += 1) {
      esperarError(
        await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
        409,
        'LLAMADO_PENDIENTE',
      );
    }
    await descartarOk(ctx, t().mozo, quinto.id);
    // Tres réplicas del quinto: no cuentan.
    for (let i = 0; i < 3; i += 1) {
      exigirEstado(await enviarLlamado(quinto.cliente, mesa.codigo, quinto.cuerpo), 201, 'réplica');
    }
    // El sexto entra (había 5 de verdad); el séptimo ya no.
    ctx.reloj.fijar(inicio + 25 * MINUTO);
    const sexto = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await descartarOk(ctx, t().mozo, sexto.id);
    ctx.reloj.fijar(inicio + 26 * MINUTO);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
      429,
      'DEMASIADOS_LLAMADOS',
    );
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(6);
  });

  it('el límite es de la mesa: la mesa de al lado sigue aceptando llamados', async () => {
    const [llena, libre] = await mesasConCodigo(ctx, esc, 2);
    await llenar(llena!, 6, 1);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), llena!.codigo, cuerpoLlamarMozo()),
      429,
      'DEMASIADOS_LLAMADOS',
    );
    const otra = await crearLlamado(ctx, libre!, cuerpoLlamarMozo());
    expect(otra.respuesta.estado).toBe('PENDIENTE');
  });
});

// ===================================================================================================
// Criterio 33 · límite por conexión
// ===================================================================================================

describe('criterio 33 · límite por conexión (20 en 10 minutos por sucursal)', () => {
  it('el 21 desde la misma IP en la misma sucursal es 429 DEMASIADOS_LLAMADOS con reintentarEnSegundos y Retry-After', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 21);
    const cliente = clienteNuevo(ctx);
    for (const mesa of mesas.slice(0, 20)) await crearOk(cliente, mesa.codigo, cuerpoLlamarMozo());
    await limpiarRegistros(ctx);

    const res = await enviarLlamado(cliente, mesas[20]!.codigo, cuerpoLlamarMozo());
    esperarError(res, 429, 'DEMASIADOS_LLAMADOS');
    expect(res.body.reintentarEnSegundos).toBe(600);
    expect(res.headers['retry-after']).toBe('600');
    expect(await contarLlamadosDeMesa(admin, mesas[20]!.id)).toBe(0);
    await sinEventos();

    // Otra cabecera de IP (X-Forwarded-For) no engaña al límite: la IP sale de la cabecera configurada.
    const enganado = await cliente
      .post(`/publico/mesas/${mesas[20]!.codigo}/llamados`, cuerpoLlamarMozo())
      .set('X-Forwarded-For', '203.0.113.77');
    esperarError(enganado, 429, 'DEMASIADOS_LLAMADOS');

    // Otra IP sí puede.
    const otra = await crearLlamado(ctx, mesas[20]!, cuerpoLlamarMozo(), clienteNuevo(ctx));
    expect(otra.respuesta.estado).toBe('PENDIENTE');
  });

  it('a los 10 minutos de los primeros, la misma IP puede otra vez', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 21);
    const cliente = clienteNuevo(ctx);
    for (const mesa of mesas.slice(0, 20)) await crearOk(cliente, mesa.codigo, cuerpoLlamarMozo());
    ctx.reloj.avanzar(10 * MINUTO - 1);
    esperarError(
      await enviarLlamado(cliente, mesas[20]!.codigo, cuerpoLlamarMozo()),
      429,
      'DEMASIADOS_LLAMADOS',
    );
    ctx.reloj.avanzar(1);
    const ok = await enviarLlamado(cliente, mesas[20]!.codigo, cuerpoLlamarMozo());
    exigirEstado(ok, 201, 'a los 10 minutos');
  });

  it('otra sucursal no cuenta: con 20 en S1, la misma IP puede llamar en S2', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 20);
    const cliente = clienteNuevo(ctx);
    for (const mesa of mesas) await crearOk(cliente, mesa.codigo, cuerpoLlamarMozo());
    const deS2 = await nuevaMesa('S2');
    const ok = await crearLlamado(ctx, deS2, cuerpoLlamarMozo(), cliente);
    expect(ok.respuesta.estado).toBe('PENDIENTE');
  });

  it('una IP no agota a las demás: 20 de una IP no impiden a otra IP en la misma sucursal', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 21);
    const ruidosa = clienteNuevo(ctx);
    for (const mesa of mesas.slice(0, 20)) await crearOk(ruidosa, mesa.codigo, cuerpoLlamarMozo());
    await crearOk(clienteNuevo(ctx), mesas[20]!.codigo, cuerpoLlamarMozo());
  });

  it('guarda huella_ip (la misma para la misma IP, distinta para otra) y nunca la IP', async () => {
    const [m1, m2, m3] = await mesasConCodigo(ctx, esc, 3);
    const a = clienteNuevo(ctx);
    const b = clienteNuevo(ctx);
    const uno = await crearLlamado(ctx, m1!, cuerpoLlamarMozo(), a);
    const dos = await crearLlamado(ctx, m2!, cuerpoLlamarMozo(), a);
    const tres = await crearLlamado(ctx, m3!, cuerpoLlamarMozo(), b);
    const f1 = (await filaLlamado(admin, m1!.empresaId, uno.id))!;
    const f2 = (await filaLlamado(admin, m2!.empresaId, dos.id))!;
    const f3 = (await filaLlamado(admin, m3!.empresaId, tres.id))!;
    for (const f of [f1, f2, f3]) {
      expect(f.huella_ip).not.toBeNull();
      expect(f.huella_ip!.length).toBe(32);
    }
    expect(f1.huella_ip!.equals(f2.huella_ip!)).toBe(true);
    expect(f1.huella_ip!.equals(f3.huella_ip!)).toBe(false);
    for (const [f, cliente] of [
      [f1, a],
      [f2, a],
      [f3, b],
    ] as const) {
      const ip = cliente.ip!;
      expect(f.texto).not.toContain(ip);
      expect(f.texto).not.toContain(Buffer.from(ip).toString('hex'));
      expect(f.huella_ip!.toString('hex')).not.toBe(Buffer.from(ip).toString('hex'));
    }
  });

  it('diez llamados simultáneos desde la misma IP a mesas distintas no pasan del límite', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 25);
    const cliente = clienteNuevo(ctx);
    for (const mesa of mesas.slice(0, 15)) await crearOk(cliente, mesa.codigo, cuerpoLlamarMozo());
    const respuestas = await Promise.all(
      mesas.slice(15, 25).map((mesa) => enviarLlamado(cliente, mesa.codigo, cuerpoLlamarMozo())),
    );
    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(5);
    const rechazadas = respuestas.filter((r) => r.status !== 201);
    expect(rechazadas).toHaveLength(5);
    for (const r of rechazadas) esperarError(r, 429, 'DEMASIADOS_LLAMADOS');
    let guardados = 0;
    for (const mesa of mesas) guardados += await contarLlamadosDeMesa(admin, mesa.id);
    expect(guardados).toBe(20);
  });
});

// ===================================================================================================
// Criterio 34 · el orden de los rechazos
// ===================================================================================================

describe('criterio 34 · el orden de los rechazos', () => {
  it('la forma (400) va antes que el código (404)', async () => {
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), 'Z'.repeat(22), {
        id: randomUUID(),
        tipo: 'PEDIDO',
        lineas: [],
      }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('el código (404) va antes que el horario', async () => {
    ctx.reloj.fijar(DESPUES_DE_CERRAR);
    const res = await enviarLlamado(clienteNuevo(ctx), 'Z'.repeat(22), cuerpoLlamarMozo());
    expect(res.status, res.text).toBe(404);
  });

  it('la réplica (201) va antes que el horario, el pendiente y los límites', async () => {
    const mesa = await nuevaMesa();
    const primera = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    ctx.reloj.fijar(DESPUES_DE_CERRAR);
    const res = await enviarLlamado(primera.cliente, mesa.codigo, primera.cuerpo);
    exigirEstado(res, 201, 'réplica fuera de horario');
    expect(res.body).toEqual(primera.respuesta);
  });

  it('FUERA_DE_HORARIO va antes que LLAMADO_PENDIENTE', async () => {
    const mesa = await nuevaMesa();
    await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await ponerHorario(ctx, A().tokenAdmin, A().S1, HORARIO_DE_NOCHE);
    try {
      esperarError(
        await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
        409,
        'FUERA_DE_HORARIO',
      );
    } finally {
      await ponerHorario(ctx, A().tokenAdmin, A().S1, HORARIO_DE_SERVICIO);
    }
  });

  it('LLAMADO_PENDIENTE (409) va antes que el límite por mesa (429)', async () => {
    const mesa = await nuevaMesa();
    const inicio = ctx.reloj.ahora().getTime();
    for (let i = 0; i < 5; i += 1) {
      ctx.reloj.fijar(inicio + i * MINUTO);
      const c = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
      await descartarOk(ctx, t().mozo, c.id);
    }
    ctx.reloj.fijar(inicio + 5 * MINUTO);
    const sexto = await crearLlamado(ctx, mesa, cuerpoLlamarMozo()); // el sexto queda pendiente
    ctx.reloj.fijar(inicio + 6 * MINUTO);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
      409,
      'LLAMADO_PENDIENTE',
    );
    await descartarOk(ctx, t().mozo, sexto.id);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()),
      429,
      'DEMASIADOS_LLAMADOS',
    );
  });

  it('los límites (429) van antes que la validación de las líneas (422)', async () => {
    const mesa = await nuevaMesa();
    const inicio = ctx.reloj.ahora().getTime();
    for (let i = 0; i < 6; i += 1) {
      ctx.reloj.fijar(inicio + i * MINUTO);
      const c = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
      await descartarOk(ctx, t().mozo, c.id);
    }
    ctx.reloj.fijar(inicio + 7 * MINUTO);
    esperarError(
      await enviarLlamado(
        clienteNuevo(ctx),
        mesa.codigo,
        cuerpoPedido([lineaDe(esc.carta.huevoFrito)]),
      ),
      429,
      'DEMASIADOS_LLAMADOS',
    );
  });

  it('el límite por conexión (429) también va antes que la validación de las líneas (422)', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 21);
    const cliente = clienteNuevo(ctx);
    for (const mesa of mesas.slice(0, 20)) await crearOk(cliente, mesa.codigo, cuerpoLlamarMozo());
    esperarError(
      await enviarLlamado(
        cliente,
        mesas[20]!.codigo,
        cuerpoPedido([lineaDe(esc.carta.huevoFrito)]),
      ),
      429,
      'DEMASIADOS_LLAMADOS',
    );
  });
});

// ===================================================================================================
// Criterio 35 · horario
// ===================================================================================================

describe('criterio 35 · horario', () => {
  it('dentro del horario (14:00) acepta; antes de abrir (10:00) y después de cerrar (23:30) es 409 FUERA_DE_HORARIO y no guarda nada', async () => {
    const [dentro, antes, despues] = await mesasConCodigo(ctx, esc, 3);
    await crearOk(clienteNuevo(ctx), dentro!.codigo, cuerpoLlamarMozo());

    await limpiarRegistros(ctx);
    ctx.reloj.fijar(ANTES_DE_ABRIR);
    const resAntes = await enviarLlamado(
      clienteNuevo(ctx),
      antes!.codigo,
      cuerpoPedido([L.gaseosa(1)]),
    );
    esperarError(resAntes, 409, 'FUERA_DE_HORARIO');
    expect(resAntes.body.mensaje).toBe('El local está cerrado. Habla con el personal');

    ctx.reloj.fijar(DESPUES_DE_CERRAR);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), despues!.codigo, cuerpoLlamarMozo()),
      409,
      'FUERA_DE_HORARIO',
    );

    expect(await contarLlamadosDeMesa(admin, antes!.id)).toBe(0);
    expect(await contarLlamadosDeMesa(admin, despues!.id)).toBe(0);
    await sinEventos();
  });

  it('el borde es [desde, hasta): a las 12:00:00 acepta y a las 23:00:00 ya no', async () => {
    const [apertura, cierre, ultimo] = await mesasConCodigo(ctx, esc, 3);
    ctx.reloj.fijar('2026-11-02T12:00:00-05:00');
    await crearOk(clienteNuevo(ctx), apertura!.codigo, cuerpoLlamarMozo());
    ctx.reloj.fijar('2026-11-02T22:59:59.999-05:00');
    await crearOk(clienteNuevo(ctx), ultimo!.codigo, cuerpoLlamarMozo());
    ctx.reloj.fijar('2026-11-02T23:00:00-05:00');
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), cierre!.codigo, cuerpoLlamarMozo()),
      409,
      'FUERA_DE_HORARIO',
    );
  });

  it.each([
    ['PEDIDO', () => cuerpoPedido([L.gaseosa(1)])],
    ['LLAMAR_MOZO', () => cuerpoLlamarMozo()],
    ['PEDIR_CUENTA', () => cuerpoPedirCuenta()],
  ])(
    'fuera de horario con la cuenta abierta se acepta un %s (los clientes que siguen después del cierre)',
    async (_tipo, hacer) => {
      const mesa = await nuevaMesa();
      await abrirMesa(ctx, esc, mesa, t().mozo);
      ctx.reloj.fijar(DESPUES_DE_CERRAR);
      const ok = await crearOk(clienteNuevo(ctx), mesa.codigo, hacer());
      expect(ok.estado).toBe('PENDIENTE');
    },
  );

  it('fuera de horario con una mesa libre se rechaza aunque otra mesa tenga cuenta abierta', async () => {
    const [ocupada, libre] = await mesasConCodigo(ctx, esc, 2);
    await abrirMesa(ctx, esc, ocupada!, t().mozo);
    ctx.reloj.fijar(DESPUES_DE_CERRAR);
    esperarError(
      await enviarLlamado(clienteNuevo(ctx), libre!.codigo, cuerpoLlamarMozo()),
      409,
      'FUERA_DE_HORARIO',
    );
  });

  it('una sucursal sin horario cargado acepta a toda hora (S2 no tiene horario)', async () => {
    const [a, b, c] = await mesasConCodigo(ctx, esc, 3, 'S2');
    for (const [mesa, hora] of [
      [a!, ANTES_DE_ABRIR],
      [b!, DESPUES_DE_CERRAR],
      [c!, '2026-11-03T03:00:00-05:00'],
    ] as const) {
      ctx.reloj.fijar(hora);
      const ok = await crearOk(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo());
      expect(ok.estado).toBe('PENDIENTE');
    }
  });

  it('una sucursal con la lista de horario vacía también acepta a toda hora', async () => {
    const mesa = await nuevaMesa();
    await ponerHorario(ctx, A().tokenAdmin, A().S1, []);
    try {
      ctx.reloj.fijar('2026-11-03T03:00:00-05:00');
      const ok = await crearOk(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo());
      expect(ok.estado).toBe('PENDIENTE');
    } finally {
      await ponerHorario(ctx, A().tokenAdmin, A().S1, HORARIO_DE_SERVICIO);
    }
  });
});

// ===================================================================================================
// Criterios 36 y 37 · el aviso al mozo y lo que queda guardado
// ===================================================================================================

describe('criterio 36 · llamado.nuevo', () => {
  it('con la mesa libre publica llamado.nuevo con destinatarios null en la sala de S1, con el esquema del contrato', async () => {
    const mesa = await nuevaMesa();
    await limpiarRegistros(ctx);
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    const eventos = await eventosDeLlamado(ctx);
    expect(eventos.map((e) => e.nombre)).toEqual(['llamado.nuevo']);
    const evento = eventoLlamadoNuevoSchema.parse(eventos[0]);
    expect(evento.empresaId).toBe(A().empresaId);
    expect(evento.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
    expect(evento.datos).toEqual({
      llamadoId: creado.id,
      tipo: 'PEDIDO',
      mesaId: mesa.id,
      mesaNombre: mesa.nombre,
      destinatarios: null,
    });
    expect(JSON.stringify(eventos[0]).length).toBeLessThan(4096);
    expect(await eventosDePedidos(ctx)).toEqual([]);
  });

  it('con la mesa ocupada los destinatarios son el mozo responsable de la orden (no quien la abrió)', async () => {
    const mesa = await nuevaMesa();
    await abrirMesa(ctx, esc, mesa, t().mozo, { mozoId: esc.mozo2.id });
    await limpiarRegistros(ctx);
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const eventos = await eventosDeLlamado(ctx, 'llamado.nuevo');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.datos).toEqual({
      llamadoId: creado.id,
      tipo: 'LLAMAR_MOZO',
      mesaId: mesa.id,
      mesaNombre: mesa.nombre,
      destinatarios: [esc.mozo2.id],
    });
  });

  it('se publica también para PEDIR_CUENTA, y las salas son las de la sucursal de cada mesa (S2 y B1 no se mezclan)', async () => {
    const mesaS1 = await nuevaMesa();
    const mesaS2 = await nuevaMesa('S2');
    const mesaB = await nuevaMesa('B1');
    await limpiarRegistros(ctx);
    await crearLlamado(ctx, mesaS1, cuerpoPedirCuenta());
    await crearLlamado(ctx, mesaS2, cuerpoLlamarMozo());
    await crearLlamado(ctx, mesaB, cuerpoLlamarMozo());
    const eventos = await eventosDeLlamado(ctx, 'llamado.nuevo');
    expect(eventos).toHaveLength(3);
    const salas = eventos.map((e) => `${e.empresaId}|${JSON.stringify(e.sala)}`).sort();
    expect(salas).toEqual(
      [
        `${A().empresaId}|${JSON.stringify({ tipo: 'sucursal', sucursalId: A().S1 })}`,
        `${A().empresaId}|${JSON.stringify({ tipo: 'sucursal', sucursalId: A().S2 })}`,
        `${esc.e.B.empresaId}|${JSON.stringify({ tipo: 'sucursal', sucursalId: esc.e.B.S1 })}`,
      ].sort(),
    );
  });

  it('un rechazo (400, 404, 409) o una réplica no publican nada', async () => {
    const mesa = await nuevaMesa();
    const primera = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await limpiarRegistros(ctx);
    const intentos = [
      enviarLlamado(clienteNuevo(ctx), mesa.codigo, { id: 'x', tipo: 'PEDIDO' }), // 400
      enviarLlamado(clienteNuevo(ctx), 'Z'.repeat(22), cuerpoLlamarMozo()), // 404
      enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoLlamarMozo()), // 409 pendiente
      enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpoPedido([lineaDe(esc.carta.huevoFrito)])), // 409 (pendiente va antes)
      enviarLlamado(primera.cliente, mesa.codigo, primera.cuerpo), // réplica
    ];
    const respuestas = await Promise.all(intentos);
    expect(respuestas.map((r) => r.status)).toEqual([400, 404, 409, 409, 201]);
    await sinEventos();
  });
});

describe('criterio 37 · lo que queda guardado', () => {
  it('con la mesa libre: mesa, sucursal, huella de la IP, sin destinatarios ni orden, creado por el actor carta-web', async () => {
    const mesa = await nuevaMesa();
    const cliente = clienteNuevo(ctx);
    const creado = await crearLlamado(
      ctx,
      mesa,
      cuerpoPedido(lineasDelPedido(esc), { nota: 'sin picante' }),
      cliente,
    );
    const fila = (await filaLlamado(admin, mesa.empresaId, creado.id))!;
    expect(fila).toMatchObject({
      mesa_id: mesa.id,
      sucursal_id: mesa.sucursalId,
      tipo: 'PEDIDO',
      estado: 'PENDIENTE',
      nota: 'sin picante',
      total: '70.00',
      destinatario_mozo_id: null,
      orden_id: null,
      creado_por_sistema: 'carta-web',
      creado_por_usuario_id: null,
    });
    expect(fila.huella_ip).not.toBeNull();
    expect(fila.vence_en.getTime()).toBe(ctx.reloj.ahora().getTime() + 15 * MINUTO);
    expect(fila.creado_en.getTime()).toBe(ctx.reloj.ahora().getTime());
    const lineas = fila.lineas as {
      productoId: string;
      modificadorIds: string[];
      cantidad: number;
    }[];
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatchObject({ productoId: esc.carta.lomo });
    expect(lineas[0]!.modificadorIds.sort()).toEqual(
      [esc.carta.mod['3/4'], esc.carta.mod['Huevo']].sort(),
    );
    expect(lineas[1]).toMatchObject({ productoId: esc.carta.gaseosa });
  });

  it('con la mesa ocupada: guarda el mozo responsable como destinatario y la orden abierta al crearlo', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo, { mozoId: esc.mozo2.id });
    const creado = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    const fila = (await filaLlamado(admin, mesa.empresaId, creado.id))!;
    expect(fila).toMatchObject({
      destinatario_mozo_id: esc.mozo2.id,
      orden_id: ordenId,
      tipo: 'PEDIR_CUENTA',
      total: null,
      creado_por_sistema: 'carta-web',
    });
    expect(fila.lineas).toEqual([]);
  });

  it('sin pedido no hay líneas ni total, y el vencimiento guardado es creado + 15 minutos', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const fila = (await filaLlamado(admin, mesa.empresaId, creado.id))!;
    expect(fila.lineas).toEqual([]);
    expect(fila.total).toBeNull();
    expect(fila.vence_en.getTime() - fila.creado_en.getTime()).toBe(15 * MINUTO);
  });
});

// Los ayudantes de estado público se usan en `estado-llamado.spec.ts`; aquí se comprueba solo que el llamado
// recién creado ya se ve con su código (la ruta de lectura del cliente).
describe('el cliente ve su llamado recién creado', () => {
  it('GET /publico/mesas/:codigo/llamados/:id responde PENDIENTE con el mismo vencimiento', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    const res = await verEstado(creado.cliente, mesa.codigo, creado.id);
    exigirEstado(res, 200, 'estado del llamado');
    expect(res.body).toEqual({
      id: creado.id,
      tipo: 'PEDIDO',
      estado: 'PENDIENTE',
      venceEn: creado.respuesta.venceEn,
    });
  });
});
