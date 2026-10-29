// spec: 004-salon-cocina (pruebas protegidas)
//
// P2 · Enviar comanda · Criterios 15 a 29 y 31 (eventos), con 39 y 72 en lo que toca al envío. La API real con
// `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`, dos empresas (A con S1 y S2, y B), la carta de
// ejemplo de `spec.md` creada por las rutas de 003, las mesas creadas por las rutas de zonas y mesas y las
// personas creadas con `POST /usuarios`.
//
// Cubre: forma y límites (15); la línea guardada como era (16); cada motivo de rechazo con `campos` por línea y
// todo o nada (17, 18); el agotado entre elegir y enviar y su reenvío al reactivarlo (19); producto o
// modificador de B como inexistente (20); el ruteo por estación (22); comanda y adición, con la pre-cuenta
// (23); ESPERAR (24); las réplicas con la misma clave y con el mismo id (25, 26), diez réplicas concurrentes
// (27) y dos envíos a la vez (28); la orden que ya no está abierta (29); y los eventos (31).
import {
  envioRespuestaSchema,
  eventoCocinaComandaSchema,
  eventoOrdenCambioSchema,
  eventoSalonCambioSchema,
  ordenRespuestaSchema,
  salonRespuestaSchema,
} from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  abrirOrden,
  agotar,
  anularOrdenOk,
  arrancarP2,
  asentar,
  camposDe,
  cerrarOrdenPorSql,
  clave,
  comandaDe,
  conEventos,
  conteoDeEmpresa,
  conteoDeOrden,
  crearEnCarta,
  cuerpoSinIds,
  enviarComanda,
  enviarOk,
  envio,
  equipoCompartido,
  esperarError,
  eventosPublicados,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  lineasDeComanda,
  llamar,
  modificarEnCarta,
  nombreUnico,
  pedirPrecuenta,
  prepararEscenarioP2,
  reactivar,
  sesionPin,
  simpleNuevo,
  unirMesasOk,
  verOrden,
  type AppP2,
  type ComandaDePrueba,
  type EnvioRespuestaDePrueba,
  type EscenarioP2,
  type ItemDePrueba,
  type LineaCuerpo,
  type OrdenAbierta,
  type Res,
} from './fabrica-p2';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;

const A = () => esc.e.A;
const carta = () => esc.carta;
const t = () => esc.token;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const CERO = { envios: 0, items: 0, comandas: 0, lineas: 0, marchas: 0 };

/** Abre una mesa nueva de S1 con el Mozo (o con el token dado). */
const abrir = (token: string = t().mozo): Promise<OrdenAbierta> =>
  abrirOrden(ctx, esc.salon, token);

/** Lo mismo que `enviarOk` con el Mozo. */
const enviarComoMozo = (ordenId: string, lineas: LineaCuerpo[], id?: string) =>
  enviarOk(ctx, t().mozo, ordenId, lineas, id);

/** El envío de ejemplo del criterio 22: Combo [Cerveza, Ensalada] × 3, Lomo [3/4, Huevo] × 1, Gaseosa × 2. */
const ejemploCriterio22 = (): LineaCuerpo[] => [
  L.combo(['Cerveza', 'Ensalada'], 3),
  L.lomo(['3/4', 'Huevo'], 1),
  L.gaseosa(2),
];

/** Estado de una mesa en `GET /salon`. */
async function mesaEnSalon(token: string, mesaId: string) {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/salon' });
  exigirEstado(res, 200, 'GET /salon');
  const mesa = salonRespuestaSchema
    .parse(res.body)
    .zonas.flatMap((z) => z.mesas)
    .find((m) => m.id === mesaId);
  if (!mesa) throw new Error(`La mesa ${mesaId} no está en GET /salon`);
  return mesa;
}

const ordenDe = async (ordenId: string, token: string = t().mozo) => {
  const res = await verOrden(ctx, token, ordenId);
  exigirEstado(res, 200, 'GET /ordenes/:id');
  return ordenRespuestaSchema.parse(res.body);
};

const porNombre = <T extends { nombre: string }>(lista: T[]): T[] =>
  [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre));

/** Comprueba que el rechazo no dejó nada en la orden ni llamó al inventario. */
async function sinEfectos(ordenId: string): Promise<void> {
  expect(await conteoDeOrden(admin, ordenId)).toEqual(CERO);
  expect(ctx.inventario.alEnviarLlamadas()).toEqual([]);
}

// ===================================================================================================
// Criterio 15 · forma y límites
// ===================================================================================================

describe('criterio 15 · enviar', () => {
  it('responde 201 con envioRespuesta: número 1, comanda por estación y los ítems en el orden de las líneas', async () => {
    const o = await abrir();
    const id = randomUUID();
    ctx.inventario.limpiar();
    const res = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([L.lomo(['3/4', 'Huevo'], 1), L.combo(['Cerveza', 'Ensalada'], 1), L.gaseosa(3)], id),
    );
    exigirEstado(res, 201, 'enviar la comanda');
    const cuerpo = envioRespuestaSchema.parse(res.body);
    expect(cuerpo).toMatchObject({ id, ordenId: o.id, numero: 1, esAdicion: false });

    expect(cuerpo.items.map((i) => i.productoId)).toEqual([
      carta().lomo,
      carta().combo,
      carta().gaseosa,
    ]);
    expect(cuerpo.items.map((i) => [i.cantidad, i.precioUnitario, i.totalVigente])).toEqual([
      [1, '30.50', '30.50'],
      [1, '28.40', '28.40'],
      [3, '9.00', '27.00'],
    ]);
    const [lomo, combo, gaseosa] = cuerpo.items as [ItemDePrueba, ItemDePrueba, ItemDePrueba];
    expect(porNombre(lomo.modificadores)).toEqual([
      { nombre: '3/4', precioExtra: '0.00' },
      { nombre: 'Huevo', precioExtra: '2.50' },
    ]);
    expect(porNombre(combo.modificadores)).toEqual([
      { nombre: 'Cerveza', precioExtra: '4.50' },
      { nombre: 'Ensalada', precioExtra: '1.00' },
    ]);
    expect(combo.componentes).toEqual([{ nombre: 'Hamburguesa clásica', cantidad: 1 }]);
    expect(gaseosa.modificadores).toEqual([]);
    // Valores por defecto de la línea y estado inicial del ítem.
    for (const item of cuerpo.items) {
      expect(item).toMatchObject({
        envioNumero: 1,
        esAdicion: false,
        cantidadAnulada: 0,
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
        marchadoEn: null,
        estado: 'ENVIADO',
        comandadoPor: { id: A().mozo.id },
      });
      expect(item.cantidadVigente).toBe(item.cantidad);
    }
    // El estado de cocina cuenta las líneas de comanda de cada ítem (Lomo: 1, Combo: 2, Gaseosa: ninguna).
    expect(lomo.cocina).toEqual({ enviado: 1, enPreparacion: 0, listo: 0, anulado: 0 });
    expect(combo.cocina).toEqual({ enviado: 2, enPreparacion: 0, listo: 0, anulado: 0 });
    expect(gaseosa.cocina).toEqual({ enviado: 0, enPreparacion: 0, listo: 0, anulado: 0 });

    expect(cuerpo.comandas.map((c) => [c.estacionNombre, c.tipo, c.destino]).sort()).toEqual([
      ['Barra', 'COMANDA', 'KDS'],
      ['Cocina', 'COMANDA', 'KDS'],
    ]);
    for (const id2 of [cuerpo.id, cuerpo.ordenId, ...cuerpo.items.map((i) => i.id)]) {
      expect(id2).toBe(id2.toLowerCase());
    }

    // La orden refleja el envío con el mismo `itemRespuesta` y el total vigente.
    const orden = await ordenDe(o.id);
    expect(orden.items).toEqual(cuerpo.items);
    expect(orden.total).toBe('85.90');
    expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(1);
  });

  it('sin Idempotency-Key responde 400 DATOS_INVALIDOS con el campo y no guarda nada', async () => {
    const o = await abrir();
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/envios`,
      cuerpo: envio([L.gaseosa(1)]),
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(camposDe(res)).toContain('Idempotency-Key');
    expect(await conteoDeOrden(admin, o.id)).toEqual(CERO);
  });

  it('una Idempotency-Key que no es un UUID responde 400 DATOS_INVALIDOS', async () => {
    const o = await abrir();
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/envios`,
      cuerpo: envio([L.gaseosa(1)]),
      cabeceras: clave('no-es-un-uuid'),
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(await conteoDeOrden(admin, o.id)).toEqual(CERO);
  });

  const invalidos: [string, () => unknown][] = [
    ['sin id', () => ({ lineas: [L.gaseosa(1)] })],
    ['con un id que no es UUID', () => ({ id: 'no-es-uuid', lineas: [L.gaseosa(1)] })],
    ['sin líneas', () => ({ id: randomUUID() })],
    ['con la lista de líneas vacía', () => envio([])],
    ['con 51 líneas', () => envio(Array.from({ length: 51 }, () => L.gaseosa(1)))],
    ['con un campo desconocido en el envío', () => ({ ...envio([L.gaseosa(1)]), total: '1.00' })],
    [
      'con una empresaId en el envío',
      () => ({ ...envio([L.gaseosa(1)]), empresaId: randomUUID() }),
    ],
    [
      'con un campo desconocido en la línea',
      () => envio([{ ...L.gaseosa(1), precio: '1.00' } as LineaCuerpo]),
    ],
    [
      'con una línea sin modificadorIds',
      () => envio([{ productoId: carta().gaseosa, cantidad: 1 } as unknown as LineaCuerpo]),
    ],
    ['con un productoId que no es UUID', () => envio([{ ...L.gaseosa(1), productoId: 'x' }])],
    [
      'con un modificador repetido',
      () =>
        envio([{ ...L.lomo(['3/4']), modificadorIds: [carta().mod['3/4'], carta().mod['3/4']] }]),
    ],
    [
      'con un modificador repetido en mayúsculas',
      () =>
        envio([
          {
            ...L.lomo(['3/4']),
            modificadorIds: [carta().mod['3/4'], carta().mod['3/4'].toUpperCase()],
          },
        ]),
    ],
    [
      'con 31 modificadores',
      () =>
        envio([{ ...L.lomo([]), modificadorIds: Array.from({ length: 31 }, () => randomUUID()) }]),
    ],
    ['con cantidad 0', () => envio([L.gaseosa(0)])],
    ['con cantidad 1000', () => envio([L.gaseosa(1000)])],
    ['con cantidad decimal', () => envio([L.gaseosa(1.5)])],
    [
      'con cantidad como texto',
      () => envio([{ ...L.gaseosa(1), cantidad: '2' as unknown as number }]),
    ],
    ['con observación vacía', () => envio([L.gaseosa(1, { observacion: '' })])],
    [
      'con observación de 141 caracteres',
      () => envio([L.gaseosa(1, { observacion: 'x'.repeat(141) })]),
    ],
    ['con tiempo 3', () => envio([L.gaseosa(1, { tiempo: 3 as unknown as 1 })])],
    ['con tiempo como texto', () => envio([L.gaseosa(1, { tiempo: '1' as unknown as 1 })])],
    [
      'con paraLlevar como texto',
      () => envio([L.gaseosa(1, { paraLlevar: 'si' as unknown as boolean })]),
    ],
  ];

  it.each(invalidos)(
    'un envío %s responde 400 DATOS_INVALIDOS y no guarda nada',
    async (_n, cuerpo) => {
      const o = await abrir();
      ctx.inventario.limpiar();
      const res = await enviarComanda(ctx, t().mozo, o.id, cuerpo());
      esperarError(res, 400, 'DATOS_INVALIDOS');
      await sinEfectos(o.id);
    },
  );

  it('acepta los límites: 50 líneas, cantidad 999 y observación de 140 caracteres', async () => {
    const o = await abrir();
    const cincuenta = await enviarComoMozo(
      o.id,
      Array.from({ length: 50 }, () => L.gaseosa(1)),
    );
    expect(cincuenta.items).toHaveLength(50);
    expect(cincuenta.comandas).toEqual([]);
    expect((await ordenDe(o.id)).total).toBe('450.00');

    const o2 = await abrir();
    const grande = await enviarComoMozo(o2.id, [L.gaseosa(999, { observacion: 'o'.repeat(140) })]);
    expect(grande.items[0]).toMatchObject({
      cantidad: 999,
      totalVigente: '8991.00',
      observacion: 'o'.repeat(140),
    });
  });

  it('conserva el tiempo, la observación y para llevar de cada línea', async () => {
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [
      L.lomo(['Jugoso'], 1, { observacion: 'sin cebolla', tiempo: 2, paraLlevar: true }),
      L.gaseosa(1, { tiempo: 1, paraLlevar: false }),
    ]);
    expect(r.items[0]).toMatchObject({ observacion: 'sin cebolla', tiempo: 2, paraLlevar: true });
    expect(r.items[1]).toMatchObject({ observacion: null, tiempo: 1, paraLlevar: false });
  });
});

// ===================================================================================================
// Criterio 16 · la línea se guarda como era
// ===================================================================================================

describe('criterio 16 · un cambio posterior de la carta no altera lo enviado', () => {
  interface Preparado {
    ordenId: string;
    enviado: EnvioRespuestaDePrueba;
    lineasAntes: Awaited<ReturnType<typeof lineasDeComanda>>[];
    ids: { plato: string; rocoto: string };
  }

  /** Envía y cambia la carta una sola vez; cada prueba espera el mismo resultado (o el mismo fallo). */
  let preparado: Promise<Preparado> | undefined;
  const preparar = (): Promise<Preparado> => (preparado ??= prepararCambios());

  async function prepararCambios(): Promise<Preparado> {
    const token = A().tokenAdmin;
    const salsa = await crearEnCarta(ctx, token, '/carta/grupos-modificadores', {
      nombre: nombreUnico('Salsa mutable'),
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: [
        { nombre: 'Rocoto', precioExtra: '1.00' },
        { nombre: 'Ají amarillo', precioExtra: '0.50' },
      ],
    });
    const rocoto = salsa.modificadores!.find((m) => m.nombre === 'Rocoto')!.id;
    const aji = salsa.modificadores!.find((m) => m.nombre === 'Ají amarillo')!.id;
    const plato = await crearEnCarta(
      ctx,
      token,
      '/carta/productos',
      simpleNuevo(carta(), {
        nombre: 'Plato mutable',
        precio: '15.00',
        gruposModificadores: [salsa.id],
      }),
    );
    const componente = await crearEnCarta(
      ctx,
      token,
      '/carta/productos',
      simpleNuevo(carta(), {
        nombre: 'Componente mutable',
        seVendeSolo: false,
        precio: undefined,
        tipoControlStock: 'PORCIONES',
      }),
    );
    const combo = await crearEnCarta(ctx, token, '/carta/productos', {
      tipo: 'COMBO',
      nombre: 'Combo mutable',
      familiaId: carta().familiaId,
      precio: '20.00',
      tipoControlStock: 'SIN_CONTROL',
      componentes: [{ productoId: componente.id, cantidad: 2 }],
    });
    const ordenId = (await abrir()).id;
    const enviado = await enviarComoMozo(ordenId, [
      { productoId: plato.id, modificadorIds: [rocoto], cantidad: 2 },
      { productoId: combo.id, modificadorIds: [], cantidad: 1 },
    ]);
    const lineasAntes = await Promise.all(
      enviado.comandas.map((c) => lineasDeComanda(admin, c.id)),
    );

    // Cambia todo lo que 003 permite: precio del producto y del modificador, nombre, estación de un
    // componente y el tipo del combo (con confirmación, 003 criterio 10b).
    await modificarEnCarta(ctx, token, `/carta/productos/${plato.id}`, { precio: '99.00' });
    await modificarEnCarta(ctx, token, `/carta/grupos-modificadores/${salsa.id}`, {
      modificadores: [
        { id: rocoto, nombre: 'Rocoto', precioExtra: '7.00' },
        { id: aji, nombre: 'Ají amarillo', precioExtra: '0.50' },
      ],
    });
    await modificarEnCarta(ctx, token, `/carta/productos/${plato.id}`, {
      nombre: 'Plato renombrado',
    });
    await modificarEnCarta(ctx, token, `/carta/productos/${componente.id}`, {
      estacionId: carta().barraId,
    });
    await modificarEnCarta(ctx, token, `/carta/productos/${combo.id}`, {
      tipo: 'SIMPLE',
      estacionId: carta().cocinaId,
      confirmarPerdida: true,
    });
    return { ordenId, enviado, lineasAntes, ids: { plato: plato.id, rocoto } };
  }

  it('el envío guardó el precio y el nombre de cuando se vendió', async () => {
    const { enviado } = await preparar();
    expect(enviado.items[0]).toMatchObject({
      nombre: 'Plato mutable',
      precioUnitario: '16.00',
      totalVigente: '32.00',
    });
    expect(enviado.items[0]!.modificadores).toEqual([{ nombre: 'Rocoto', precioExtra: '1.00' }]);
    expect(enviado.items[1]).toMatchObject({
      nombre: 'Combo mutable',
      tipo: 'COMBO',
      precioUnitario: '20.00',
    });
    expect(enviado.items[1]!.componentes).toEqual([{ nombre: 'Componente mutable', cantidad: 2 }]);
  });

  it('GET /ordenes/:id sigue mostrando exactamente lo enviado', async () => {
    const { ordenId, enviado } = await preparar();
    const orden = await ordenDe(ordenId);
    expect(orden.items).toEqual(enviado.items);
    expect(orden.total).toBe('52.00');
  });

  it('las líneas de las comandas no cambian de nombre, de cantidad ni de estación', async () => {
    const { enviado, lineasAntes } = await preparar();
    const despues = await Promise.all(enviado.comandas.map((c) => lineasDeComanda(admin, c.id)));
    expect(despues).toEqual(lineasAntes);
    // El componente se envió a Cocina y sigue en la comanda de Cocina aunque ahora sea de Barra.
    const cocina = comandaDe(enviado.comandas, 'Cocina');
    const lineasCocina = await lineasDeComanda(admin, cocina.id);
    expect(lineasCocina.map((l) => [l.nombre, l.cantidad])).toEqual([
      ['Plato mutable', 2],
      ['Componente mutable', 2],
    ]);
    expect(enviado.comandas.map((c) => c.estacionNombre)).toEqual(['Cocina']);
  });

  it('la pre-cuenta muestra lo enviado', async () => {
    const { ordenId } = await preparar();
    const res = await pedirPrecuenta(ctx, t().mozo, ordenId);
    exigirEstado(res, 201, 'pedir la pre-cuenta');
    const lineas = (
      res.body.lineas as {
        nombre: string;
        cantidad: number;
        precioUnitario: string;
        total: string;
      }[]
    ).map((l) => [l.nombre, l.cantidad, l.precioUnitario, l.total]);
    expect(lineas).toEqual([
      ['Plato mutable', 2, '16.00', '32.00'],
      ['Combo mutable', 1, '20.00', '20.00'],
    ]);
    expect(res.body.total).toBe('52.00');
  });

  it('una venta nueva sí usa la carta cambiada', async () => {
    const { ids } = await preparar();
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [
      { productoId: ids.plato, modificadorIds: [ids.rocoto], cantidad: 1 },
    ]);
    expect(r.items[0]).toMatchObject({
      nombre: 'Plato renombrado',
      precioUnitario: '106.00',
      totalVigente: '106.00',
    });
  });
});

// ===================================================================================================
// Criterios 17 y 18 · lo que no se vende se rechaza, línea por línea y todo o nada
// ===================================================================================================

describe('criterios 17 y 18 · rechazos', () => {
  /** Envía [línea buena, línea mala] y comprueba el rechazo y que no quedó nada. */
  async function rechazaLaSegunda(mala: LineaCuerpo, codigo: string): Promise<Res> {
    const o = await abrir();
    ctx.inventario.limpiar();
    const res = await enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1), mala]));
    esperarError(res, 422, codigo);
    expect(camposDe(res)).toEqual(['lineas.1']);
    await sinEfectos(o.id);
    return res;
  }

  it('un producto que no se vende solo es PRODUCTO_NO_VENDIBLE', async () => {
    await rechazaLaSegunda(
      { productoId: carta().huevoFrito, modificadorIds: [], cantidad: 1 },
      'PRODUCTO_NO_VENDIBLE',
    );
  });

  it('un producto inactivo es PRODUCTO_NO_VENDIBLE', async () => {
    const p = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', simpleNuevo(carta()));
    await modificarEnCarta(ctx, A().tokenAdmin, `/carta/productos/${p.id}`, { activo: false });
    await rechazaLaSegunda(
      { productoId: p.id, modificadorIds: [], cantidad: 1 },
      'PRODUCTO_NO_VENDIBLE',
    );
  });

  it('un producto no disponible en la sucursal es PRODUCTO_NO_VENDIBLE', async () => {
    const p = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', simpleNuevo(carta()));
    const ajuste = await llamar(ctx, A().tokenAdmin, {
      metodo: 'put',
      ruta: `/carta/productos/${p.id}/sucursales/${A().S1}`,
      cuerpo: { precio: null, disponible: false },
    });
    exigirEstado(ajuste, 200, 'marcar no disponible en S1');
    await rechazaLaSegunda(
      { productoId: p.id, modificadorIds: [], cantidad: 1 },
      'PRODUCTO_NO_VENDIBLE',
    );
  });

  it('un producto agotado es PRODUCTO_NO_VENDIBLE', async () => {
    const p = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', simpleNuevo(carta()));
    await agotar(ctx, t().cocina, p.id);
    await rechazaLaSegunda(
      { productoId: p.id, modificadorIds: [], cantidad: 1 },
      'PRODUCTO_NO_VENDIBLE',
    );
  });

  it('un menú del día sin armar es PRODUCTO_NO_VENDIBLE', async () => {
    const token = A().tokenAdmin;
    const grupo = await crearEnCarta(ctx, token, '/carta/grupos-modificadores', {
      nombre: nombreUnico('Plato sin armar'),
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: [{ nombre: 'Opción única', productoId: carta().ajiDeGallina }],
    });
    const menu = await crearEnCarta(ctx, token, '/carta/productos', {
      tipo: 'MENU_DEL_DIA',
      nombre: nombreUnico('Menú sin armar'),
      familiaId: carta().familiaId,
      precio: '12.00',
      tipoControlStock: 'PORCIONES',
      gruposModificadores: [grupo.id],
    });
    await rechazaLaSegunda(
      { productoId: menu.id, modificadorIds: [grupo.modificadores![0]!.id], cantidad: 1 },
      'PRODUCTO_NO_VENDIBLE',
    );
  });

  it('un combo con un componente no disponible es PRODUCTO_NO_VENDIBLE', async () => {
    const token = A().tokenAdmin;
    const componente = await crearEnCarta(
      ctx,
      token,
      '/carta/productos',
      simpleNuevo(carta(), {
        seVendeSolo: false,
        precio: undefined,
        tipoControlStock: 'PORCIONES',
      }),
    );
    const combo = await crearEnCarta(ctx, token, '/carta/productos', {
      tipo: 'COMBO',
      nombre: nombreUnico('Combo de componente'),
      familiaId: carta().familiaId,
      precio: '20.00',
      tipoControlStock: 'SIN_CONTROL',
      componentes: [{ productoId: componente.id, cantidad: 1 }],
    });
    await agotar(ctx, t().cocina, componente.id);
    await rechazaLaSegunda(
      { productoId: combo.id, modificadorIds: [], cantidad: 1 },
      'PRODUCTO_NO_VENDIBLE',
    );
  });

  const selecciones: [string, () => LineaCuerpo][] = [
    [
      'un modificador desconocido',
      () => ({ ...L.lomo(['3/4']), modificadorIds: [carta().mod['3/4'], randomUUID()] }),
    ],
    ['un modificador de otro producto', () => L.lomo(['3/4', 'Cerveza'])],
    ['menos del mínimo de un grupo obligatorio', () => L.lomo([])],
    ['más del máximo de un grupo múltiple', () => L.lomo(['3/4', 'Huevo', 'Plátano', 'Queso'])],
    ['dos opciones de un grupo de selección única', () => L.lomo(['Jugoso', '3/4'])],
    ['el combo sin su bebida obligatoria', () => L.combo(['Ensalada'])],
  ];

  it.each(selecciones)('%s es SELECCION_INVALIDA', async (_n, linea) => {
    await rechazaLaSegunda(linea(), 'SELECCION_INVALIDA');
  });

  it('campos lleva una entrada por línea rechazada y el código es el de la primera', async () => {
    const o = await abrir();
    ctx.inventario.limpiar();
    const huevoFrito: LineaCuerpo = {
      productoId: carta().huevoFrito,
      modificadorIds: [],
      cantidad: 1,
    };
    const res = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([L.lomo(['3/4']), huevoFrito, L.gaseosa(2), L.lomo([]), L.gaseosa(1)]),
    );
    esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
    expect([...camposDe(res)].sort()).toEqual(['lineas.1', 'lineas.3']);
    await sinEfectos(o.id);

    const res2 = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([L.lomo(['3/4']), L.lomo([]), huevoFrito, L.gaseosa(1)]),
    );
    esperarError(res2, 422, 'SELECCION_INVALIDA');
    expect([...camposDe(res2)].sort()).toEqual(['lineas.1', 'lineas.2']);
    await sinEfectos(o.id);
  });

  it('todo o nada: nada se guarda, ni eventos; y el mozo reenvía el resto', async () => {
    const o = await abrir();
    await asentar();
    ctx.publicador.limpiar();
    const huevoFrito: LineaCuerpo = {
      productoId: carta().huevoFrito,
      modificadorIds: [],
      cantidad: 1,
    };
    const buenas = [L.lomo(['3/4']), L.gaseosa(2)];
    const res = await enviarComanda(ctx, t().mozo, o.id, envio([...buenas, huevoFrito]));
    esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
    expect(await conteoDeOrden(admin, o.id)).toEqual(CERO);
    expect(await eventosPublicados(ctx)).toEqual([]);

    const reenvio = await enviarComoMozo(o.id, buenas);
    expect(reenvio).toMatchObject({ numero: 1, esAdicion: false });
    expect(reenvio.items).toHaveLength(2);
  });

  it('un rechazo en una orden en pre-cuenta no la invalida', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'])]);
    exigirEstado(await pedirPrecuenta(ctx, t().mozo, o.id), 201, 'pre-cuenta');
    const res = await enviarComanda(ctx, t().mozo, o.id, envio([L.lomo([])]));
    esperarError(res, 422, 'SELECCION_INVALIDA');
    const orden = await ordenDe(o.id);
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.precuentaVigente).toMatchObject({ numero: 1 });
    expect((await mesaEnSalon(t().mozo, o.mesaId)).estado).toBe('EN_PRECUENTA');
  });
});

// ===================================================================================================
// Criterio 19 · se agota entre que se elige y se envía
// ===================================================================================================

describe('criterio 19 · agotado entre elegir y enviar', () => {
  const combo = () => L.combo(['Cerveza', 'Ensalada'], 1);

  it('un componente agotado: 422 PRODUCTO_NO_VENDIBLE (COMPONENTE_NO_DISPONIBLE); al reactivarlo, el mismo envío con otro id responde 201', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [combo()]); // vendible antes de agotarlo
    await agotar(ctx, t().cocina, carta().hamburguesa);
    try {
      ctx.inventario.limpiar();
      const antes = await conteoDeOrden(admin, o.id);
      const res = await enviarComanda(ctx, t().mozo, o.id, envio([combo()]));
      esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
      expect(JSON.stringify(res.body.campos)).toContain('COMPONENTE_NO_DISPONIBLE');
      expect(await conteoDeOrden(admin, o.id)).toEqual(antes);
      expect(ctx.inventario.alEnviarLlamadas()).toEqual([]);
    } finally {
      await reactivar(ctx, t().cocina, carta().hamburguesa);
    }
    const r = await enviarComoMozo(o.id, [combo()]);
    expect(r).toMatchObject({ numero: 2, esAdicion: true });
  });

  it('una opción ligada agotada (Cerveza Pilsen): 422 SELECCION_INVALIDA (MODIFICADOR_NO_DISPONIBLE) y solo esa opción; al reactivarla, 201', async () => {
    const o = await abrir();
    await agotar(ctx, t().cocina, carta().cervezaPilsen);
    try {
      ctx.inventario.limpiar();
      const res = await enviarComanda(ctx, t().mozo, o.id, envio([combo()]));
      esperarError(res, 422, 'SELECCION_INVALIDA');
      expect(JSON.stringify(res.body.campos)).toContain('MODIFICADOR_NO_DISPONIBLE');
      await sinEfectos(o.id);
      // Otra opción del mismo grupo sigue vendible.
      const otra = await enviarComoMozo(o.id, [L.combo(['Chicha', 'Ensalada'], 1)]);
      expect(otra.numero).toBe(1);
    } finally {
      await reactivar(ctx, t().cocina, carta().cervezaPilsen);
    }
    const r = await enviarComoMozo(o.id, [combo()]);
    expect(r.numero).toBe(2);
  });

  it('una opción de Término cuyo ligado (Huevo frito) se agota: SELECCION_INVALIDA; la línea sin esa opción sigue siendo vendible', async () => {
    const o = await abrir();
    await agotar(ctx, t().cocina, carta().huevoFrito);
    try {
      const res = await enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['3/4', 'Huevo'])]));
      esperarError(res, 422, 'SELECCION_INVALIDA');
      expect(JSON.stringify(res.body.campos)).toContain('MODIFICADOR_NO_DISPONIBLE');
      expect((await enviarComoMozo(o.id, [L.lomo(['3/4', 'Queso'])])).numero).toBe(1);
    } finally {
      await reactivar(ctx, t().cocina, carta().huevoFrito);
    }
  });

  it('una opción del menú que se quita de las de hoy: 422 SELECCION_INVALIDA; al armarla de nuevo, 201', async () => {
    const o = await abrir();
    const armar = async (opciones: string[]) => {
      const res = await llamar(ctx, t().adminS1, {
        metodo: 'put',
        ruta: `/carta/sucursal/menu-del-dia/${carta().menu}`,
        cuerpo: { opciones },
      });
      exigirEstado(res, 200, 'armar el menú del día');
    };
    const todas = [carta().mod['Sopa'], carta().mod['Ají de gallina'], carta().mod['Lomo saltado']];
    await armar([carta().mod['Sopa'], carta().mod['Lomo saltado']]);
    try {
      ctx.inventario.limpiar();
      const res = await enviarComanda(
        ctx,
        t().mozo,
        o.id,
        envio([L.menu(['Sopa', 'Ají de gallina'])]),
      );
      esperarError(res, 422, 'SELECCION_INVALIDA');
      const detalle = JSON.stringify(res.body.campos);
      expect(detalle).toMatch(/MODIFICADOR_NO_DISPONIBLE|MODIFICADOR_DESCONOCIDO/);
      await sinEfectos(o.id);
    } finally {
      await armar(todas);
    }
    const r = await enviarComoMozo(o.id, [L.menu(['Sopa', 'Ají de gallina'])]);
    expect(r).toMatchObject({ numero: 1, esAdicion: false });
  });
});

// ===================================================================================================
// Criterio 20 · producto o modificador de otra empresa
// ===================================================================================================

describe('criterio 20 · ids de B', () => {
  it('un producto de B se rechaza con el mismo cuerpo que uno inexistente y nada de B cambia', async () => {
    const o = await abrir();
    const antesB = await conteoDeEmpresa(admin, esc.e.B.empresaId);
    ctx.inventario.limpiar();
    const deB = esc.cartaB.gaseosa;
    const inexistente = randomUUID();
    const resB = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([{ productoId: deB, modificadorIds: [], cantidad: 1 }]),
    );
    const resNada = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([{ productoId: inexistente, modificadorIds: [], cantidad: 1 }]),
    );
    expect(resB.status).toBe(422);
    expect(resNada.status).toBe(422);
    expect(cuerpoSinIds(resB, [deB])).toEqual(cuerpoSinIds(resNada, [inexistente]));
    await sinEfectos(o.id);
    expect(await conteoDeEmpresa(admin, esc.e.B.empresaId)).toEqual(antesB);
  });

  it('un modificador de B se rechaza con el mismo cuerpo que uno inexistente', async () => {
    const o = await abrir();
    const deB = esc.cartaB.mod['3/4'];
    const inexistente = randomUUID();
    const resB = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([{ ...L.lomo(['Jugoso']), modificadorIds: [carta().mod['Jugoso'], deB] }]),
    );
    const resNada = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([{ ...L.lomo(['Jugoso']), modificadorIds: [carta().mod['Jugoso'], inexistente] }]),
    );
    esperarError(resB, 422, 'SELECCION_INVALIDA');
    expect(cuerpoSinIds(resB, [deB])).toEqual(cuerpoSinIds(resNada, [inexistente]));
    expect(await conteoDeOrden(admin, o.id)).toEqual(CERO);
  });

  it('un producto de B en la línea de una orden de A no crea nada en B', async () => {
    const o = await abrir();
    const antesB = await conteoDeEmpresa(admin, esc.e.B.empresaId);
    const res = await enviarComanda(
      ctx,
      t().mozo,
      o.id,
      envio([
        { productoId: esc.cartaB.lomo, modificadorIds: [esc.cartaB.mod['3/4']], cantidad: 1 },
      ]),
    );
    expect(res.status).toBe(422);
    expect(await conteoDeEmpresa(admin, esc.e.B.empresaId)).toEqual(antesB);
  });
});

// ===================================================================================================
// Criterio 22 · ruteo por estación
// ===================================================================================================

describe('criterio 22 · ruteo por estación', () => {
  it('el ejemplo: comanda de Cocina con la hamburguesa y el lomo, comanda de Barra con la cerveza, la gaseosa a ninguna', async () => {
    const o = await abrir();
    const r = await enviarComoMozo(o.id, ejemploCriterio22());
    expect(r.comandas.map((c) => c.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    for (const c of r.comandas) expect(c).toMatchObject({ tipo: 'COMANDA', destino: 'KDS' });
    expect(r.comandas.find((c) => c.estacionNombre === 'Cocina')!.estacionId).toBe(
      carta().cocinaId,
    );
    expect(r.comandas.find((c) => c.estacionNombre === 'Barra')!.estacionId).toBe(carta().barraId);

    const forma = (ls: Awaited<ReturnType<typeof lineasDeComanda>>) =>
      ls.map((l) => ({
        rol: l.rol,
        nombre: l.nombre,
        cantidad: l.cantidad,
        contexto: l.contexto,
        modificadores: l.modificadores,
        tiempo: l.tiempo,
        esperar: l.esperar,
        estado: l.estado,
      }));
    const cocina = await lineasDeComanda(admin, comandaDe(r.comandas, 'Cocina').id);
    expect(forma(cocina)).toEqual([
      {
        rol: 'COMPONENTE',
        nombre: 'Hamburguesa clásica',
        cantidad: 3,
        contexto: 'Combo hamburguesa',
        modificadores: ['Ensalada'],
        tiempo: 1,
        esperar: false,
        estado: 'ENVIADO',
      },
      {
        rol: 'PRODUCTO',
        nombre: 'Lomo saltado',
        cantidad: 1,
        contexto: null,
        modificadores: ['3/4', 'Huevo'],
        tiempo: 1,
        esperar: false,
        estado: 'ENVIADO',
      },
    ]);
    const barra = await lineasDeComanda(admin, comandaDe(r.comandas, 'Barra').id);
    expect(forma(barra)).toEqual([
      {
        rol: 'LIGADO',
        nombre: 'Cerveza Pilsen',
        cantidad: 3,
        contexto: 'Combo hamburguesa',
        modificadores: [],
        tiempo: 1,
        esperar: false,
        estado: 'ENVIADO',
      },
    ]);

    // La gaseosa se guarda y se cobra, pero no genera comanda ni líneas.
    const [combo, lomo, gaseosa] = r.items as [ItemDePrueba, ItemDePrueba, ItemDePrueba];
    expect(gaseosa).toMatchObject({ nombre: 'Gaseosa 1 L', cantidad: 2, totalVigente: '18.00' });
    expect(gaseosa.cocina).toEqual({ enviado: 0, enPreparacion: 0, listo: 0, anulado: 0 });
    expect(combo.cocina.enviado).toBe(2);
    expect(lomo.cocina.enviado).toBe(1);
    expect((await ordenDe(o.id)).total).toBe('133.70');
    expect(await conteoDeOrden(admin, o.id)).toEqual({
      envios: 1,
      items: 3,
      comandas: 2,
      lineas: 3,
      marchas: 0,
    });
  });

  it('un producto sin estación con una opción ligada a Barra: solo sale la parte de Barra', async () => {
    const token = A().tokenAdmin;
    const grupo = await crearEnCarta(ctx, token, '/carta/grupos-modificadores', {
      nombre: nombreUnico('Con chicha'),
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: [{ nombre: 'Chicha de la casa', productoId: carta().chichaMorada }],
    });
    const plato = await crearEnCarta(
      ctx,
      token,
      '/carta/productos',
      simpleNuevo(carta(), {
        nombre: nombreUnico('Plato sin estación'),
        estacionId: null,
        gruposModificadores: [grupo.id],
      }),
    );
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [
      { productoId: plato.id, modificadorIds: [grupo.modificadores![0]!.id], cantidad: 2 },
    ]);
    expect(r.comandas.map((c) => c.estacionNombre)).toEqual(['Barra']);
    const lineas = await lineasDeComanda(admin, r.comandas[0]!.id);
    expect(lineas.map((l) => [l.rol, l.nombre, l.cantidad, l.contexto])).toEqual([
      ['LIGADO', 'Chicha morada', 2, plato.nombre],
    ]);
  });

  it('el menú del día: el refresco a Barra, la sopa y el segundo a Cocina', async () => {
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [L.menu(['Sopa', 'Ají de gallina'], 2)]);
    expect(r.comandas.map((c) => c.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    const barra = await lineasDeComanda(admin, comandaDe(r.comandas, 'Barra').id);
    expect(barra.map((l) => [l.rol, l.nombre, l.cantidad, l.contexto])).toEqual([
      ['COMPONENTE', 'Refresco del día', 2, 'Menú del día'],
    ]);
    const cocina = await lineasDeComanda(admin, comandaDe(r.comandas, 'Cocina').id);
    expect(cocina.map((l) => [l.rol, l.nombre, l.cantidad, l.contexto]).sort()).toEqual([
      ['LIGADO', 'Ají de gallina', 2, 'Menú del día'],
      ['LIGADO', 'Sopa de casa', 2, 'Menú del día'],
    ]);
  });

  it('un envío solo de lo que no tiene estación se guarda y se cobra, sin comandas', async () => {
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [L.gaseosa(2)]);
    expect(r.comandas).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(await conteoDeOrden(admin, o.id)).toEqual({
      envios: 1,
      items: 1,
      comandas: 0,
      lineas: 0,
      marchas: 0,
    });
    expect((await ordenDe(o.id)).total).toBe('18.00');
  });
});

// ===================================================================================================
// Criterio 23 · comanda y adición
// ===================================================================================================

describe('criterio 23 · comanda y adición', () => {
  it('el primer envío es la comanda; los siguientes, adiciones con el número siguiente', async () => {
    const o = await abrir();
    const uno = await enviarComoMozo(o.id, [L.lomo(['3/4'])]);
    const dos = await enviarComoMozo(o.id, [L.combo(['Cerveza', 'Ensalada'])]);
    const tres = await enviarComoMozo(o.id, [L.lomo(['Jugoso'])]);
    expect([uno, dos, tres].map((e) => [e.numero, e.esAdicion])).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(uno.comandas.map((c) => c.tipo)).toEqual(['COMANDA']);
    expect(dos.comandas.map((c) => c.tipo)).toEqual(['ADICION', 'ADICION']);
    expect(tres.comandas.map((c) => c.tipo)).toEqual(['ADICION']);
    expect(dos.items[0]).toMatchObject({ envioNumero: 2, esAdicion: true });

    const orden = await ordenDe(o.id);
    expect(orden.items.map((i) => [i.envioNumero, i.esAdicion])).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
    const filas = await admin.query<{ tipo: string }>(
      `SELECT tipo FROM comanda WHERE orden_id = $1 ORDER BY tipo`,
      [o.id],
    );
    expect(filas.rows.map((f) => f.tipo)).toEqual(['ADICION', 'ADICION', 'ADICION', 'COMANDA']);
  });

  it('una adición a una orden en pre-cuenta la devuelve a ABIERTA, invalida la pre-cuenta y la mesa vuelve a OCUPADA', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'])]);
    const p1 = await pedirPrecuenta(ctx, t().mozo, o.id);
    exigirEstado(p1, 201, 'primera pre-cuenta');
    expect(p1.body.numero).toBe(1);
    expect((await ordenDe(o.id)).estado).toBe('EN_PRECUENTA');
    expect((await mesaEnSalon(t().mozo, o.mesaId)).estado).toBe('EN_PRECUENTA');

    const adicion = await enviarComoMozo(o.id, [L.gaseosa(1)]);
    expect(adicion.esAdicion).toBe(true);
    const orden = await ordenDe(o.id);
    expect(orden.estado).toBe('ABIERTA');
    expect(orden.precuentaVigente).toBeNull();
    expect((await mesaEnSalon(t().mozo, o.mesaId)).estado).toBe('OCUPADA');

    const p2 = await pedirPrecuenta(ctx, t().mozo, o.id);
    exigirEstado(p2, 201, 'segunda pre-cuenta');
    expect(p2.body.numero).toBe(2);
  });
});

// ===================================================================================================
// Criterio 24 · ESPERAR
// ===================================================================================================

describe('criterio 24 · ESPERAR', () => {
  it('las partes de un ítem de segundo tiempo se guardan con esperar hasta que se marchan; las de primer tiempo, no', async () => {
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [
      L.combo(['Cerveza', 'Ensalada'], 3, { tiempo: 2 }),
      L.lomo(['3/4', 'Huevo'], 1, { tiempo: 1 }),
      L.menu(['Sopa', 'Ají de gallina'], 1, { tiempo: 2 }),
    ]);
    expect(r.items.map((i) => i.tiempo)).toEqual([2, 1, 2]);
    expect(r.items.every((i) => i.marchadoEn === null)).toBe(true);
    const lineas = (await Promise.all(r.comandas.map((c) => lineasDeComanda(admin, c.id)))).flat();
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) {
      const deSegundoTiempo = l.tiempo === 2;
      expect(l.esperar, `${l.nombre} (tiempo ${l.tiempo})`).toBe(deSegundoTiempo);
    }
    const porItem = new Map(r.items.map((i) => [i.id, i.tiempo]));
    for (const l of lineas) expect(l.tiempo).toBe(porItem.get(l.itemId));
  });

  it('la observación y para llevar viajan a todas las partes del ítem', async () => {
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [
      L.combo(['Cerveza', 'Ensalada'], 1, { observacion: 'sin cebolla', paraLlevar: true }),
    ]);
    const lineas = (await Promise.all(r.comandas.map((c) => lineasDeComanda(admin, c.id)))).flat();
    expect(lineas).toHaveLength(2);
    for (const l of lineas) {
      expect(l).toMatchObject({ observacion: 'sin cebolla', paraLlevar: true });
    }
  });
});

// ===================================================================================================
// Criterio 25 y 26 · réplicas
// ===================================================================================================

describe('criterio 25 · réplica con la misma clave', () => {
  it('devuelve el mismo estado y cuerpo sin crear nada, sin llamar al inventario y sin eventos', async () => {
    const o = await abrir();
    const cuerpo = envio(ejemploCriterio22());
    const k = randomUUID();
    const { resultado: primera } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, cuerpo, k),
    );
    exigirEstado(primera, 201, 'primer envío');
    const filas = await conteoDeOrden(admin, o.id);
    expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(1);

    const { resultado: replica, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, cuerpo, k),
    );
    expect(replica.status).toBe(201);
    expect(replica.body).toEqual(primera.body);
    expect(await conteoDeOrden(admin, o.id)).toEqual(filas);
    expect(ctx.inventario.alEnviarLlamadas()).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('la misma clave con otro cuerpo responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no crea nada', async () => {
    const o = await abrir();
    const k = randomUUID();
    exigirEstado(
      await enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['3/4'])]), k),
      201,
      'envío',
    );
    const filas = await conteoDeOrden(admin, o.id);
    const otro = await enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['Jugoso'])]), k);
    esperarError(otro, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    expect(await conteoDeOrden(admin, o.id)).toEqual(filas);
  });
});

describe('criterio 26 · réplica con el mismo id de envío y otra clave', () => {
  /** Hace el primer envío y devuelve su cuerpo, su respuesta y las filas que dejó. */
  async function primerEnvio(token: string = t().mozo) {
    const o = await abrir();
    const cuerpo = envio(ejemploCriterio22());
    const res = await enviarComanda(ctx, token, o.id, cuerpo);
    exigirEstado(res, 201, 'primer envío');
    return { o, cuerpo, res, filas: await conteoDeOrden(admin, o.id) };
  }

  async function esReplicaSinEfectos(
    token: string,
    p: Awaited<ReturnType<typeof primerEnvio>>,
    cuerpo: unknown = p.cuerpo,
  ) {
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, token, p.o.id, cuerpo),
    );
    expect(resultado.status, resultado.text).toBe(201);
    expect(resultado.body).toEqual(p.res.body);
    expect(await conteoDeOrden(admin, p.o.id)).toEqual(p.filas);
    expect(ctx.inventario.alEnviarLlamadas()).toEqual([]);
    expect(eventos).toEqual([]);
  }

  it('con otra Idempotency-Key en la misma sesión: el envío ya guardado, sin ítems, comandas, eventos ni llamadas nuevas', async () => {
    const p = await primerEnvio();
    await esReplicaSinEfectos(t().mozo, p);
  });

  it('desde otra sesión, después de un cambio rápido de usuario en el mismo equipo', async () => {
    const equipo = await equipoCompartido(ctx, [A().mozo, esc.mozo2]);
    const pinM1 = await sesionPin(ctx, A().mozo, equipo.tokenEquipo, A().S1);
    const p = await primerEnvio(pinM1);
    const pinM2 = await sesionPin(ctx, esc.mozo2, equipo.tokenEquipo, A().S1);
    expect(pinM2).not.toBe(pinM1);
    await esReplicaSinEfectos(pinM2, p);
  });

  it('con la orden anulada entre medio: igual devuelve el envío original', async () => {
    const p = await primerEnvio();
    await anularOrdenOk(ctx, t().supervisor, p.o.id);
    const filas = await conteoDeOrden(admin, p.o.id);
    const { resultado } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, p.o.id, p.cuerpo),
    );
    expect(resultado.status, resultado.text).toBe(201);
    expect(resultado.body).toEqual(p.res.body);
    expect(await conteoDeOrden(admin, p.o.id)).toEqual(filas);
  });

  it('con un producto agotado entre medio: igual devuelve el envío original', async () => {
    const p = await primerEnvio();
    await agotar(ctx, t().cocina, carta().lomo);
    try {
      await esReplicaSinEfectos(t().mozo, p);
    } finally {
      await reactivar(ctx, t().cocina, carta().lomo);
    }
  });

  it('la comparación es sobre la entrada normalizada: ids en mayúsculas, modificadores en otro orden y valores por defecto explícitos', async () => {
    const o = await abrir();
    const original = envio([L.lomo(['3/4', 'Huevo'], 2), L.gaseosa(1)]);
    const res = await enviarComanda(ctx, t().mozo, o.id, original);
    exigirEstado(res, 201, 'primer envío');
    const filas = await conteoDeOrden(admin, o.id);
    const [lomo, gaseosa] = original.lineas as [LineaCuerpo, LineaCuerpo];
    const reescrito = {
      id: original.id.toUpperCase(),
      lineas: [
        {
          productoId: lomo.productoId.toUpperCase(),
          modificadorIds: [...lomo.modificadorIds].reverse().map((m) => m.toUpperCase()),
          cantidad: 2,
          tiempo: 1,
          paraLlevar: false,
        },
        { ...gaseosa, productoId: gaseosa.productoId.toUpperCase(), tiempo: 1, paraLlevar: false },
      ],
    };
    const replica = await enviarComanda(ctx, t().mozo, o.id, reescrito);
    expect(replica.status, replica.text).toBe(201);
    expect(replica.body).toEqual(res.body);
    expect(await conteoDeOrden(admin, o.id)).toEqual(filas);
  });

  it('el mismo id con otras líneas responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no crea nada', async () => {
    const p = await primerEnvio();
    const otro = await enviarComanda(
      ctx,
      t().mozo,
      p.o.id,
      envio([L.lomo(['Jugoso'], 1)], p.cuerpo.id),
    );
    esperarError(otro, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    const menos = await enviarComanda(ctx, t().mozo, p.o.id, envio([L.gaseosa(2)], p.cuerpo.id));
    esperarError(menos, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    expect(await conteoDeOrden(admin, p.o.id)).toEqual(p.filas);
  });

  it('el mismo id en otra orden responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no crea nada', async () => {
    const p = await primerEnvio();
    const otraOrden = await abrir();
    const res = await enviarComanda(ctx, t().mozo, otraOrden.id, p.cuerpo);
    esperarError(res, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    expect(await conteoDeOrden(admin, otraOrden.id)).toEqual(CERO);
    expect(await conteoDeOrden(admin, p.o.id)).toEqual(p.filas);
  });
});

// ===================================================================================================
// Criterios 27 y 28 · concurrencia
// ===================================================================================================

describe('criterio 27 · diez réplicas simultáneas', () => {
  it('dejan exactamente un envío, sus ítems y sus comandas, una llamada al inventario y los eventos de uno', async () => {
    const o = await abrir();
    const cuerpo = envio(ejemploCriterio22());
    await asentar();
    ctx.publicador.limpiar();
    ctx.inventario.limpiar();

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_v, i) =>
        enviarComanda(ctx, i % 2 === 0 ? t().mozo : t().mozo2, o.id, cuerpo, randomUUID()),
      ),
    );
    const cuerpos: unknown[] = [];
    let conflictos = 0;
    for (const r of respuestas) {
      if (r.status === 201) {
        cuerpos.push(r.body);
      } else {
        // Un bloqueo traducido a CONFLICTO se puede repetir y entonces responde con el mismo envío.
        esperarError(r, 409, 'CONFLICTO');
        conflictos += 1;
      }
    }
    expect(cuerpos.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < conflictos; i++) {
      const repetida = await enviarComanda(ctx, t().mozo, o.id, cuerpo, randomUUID());
      expect(repetida.status, repetida.text).toBe(201);
      cuerpos.push(repetida.body);
    }
    for (const c of cuerpos) expect(c).toEqual(cuerpos[0]);
    envioRespuestaSchema.parse(cuerpos[0]);

    expect(await conteoDeOrden(admin, o.id)).toEqual({
      envios: 1,
      items: 3,
      comandas: 2,
      lineas: 3,
      marchas: 0,
    });
    const llamadas = ctx.inventario.alEnviarLlamadas();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ sucursalId: A().S1, envioId: cuerpo.id });

    const eventos = await eventosPublicados(ctx);
    expect(eventos.filter((e) => e.nombre === 'orden.cambio')).toHaveLength(1);
    expect(eventos.filter((e) => e.nombre === 'cocina.comanda')).toHaveLength(2);
  });
});

describe('criterio 28 · dos mozos a la vez', () => {
  it('dos envíos con ids distintos a la misma orden terminan en 201 con los números 1 y 2: una comanda y una adición', async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const o = await abrir();
      ctx.inventario.limpiar();
      const [a, b] = await Promise.all([
        enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['3/4', 'Huevo']), L.gaseosa(1)])),
        enviarComanda(
          ctx,
          t().mozo2,
          o.id,
          envio([L.combo(['Cerveza', 'Ensalada']), L.gaseosa(2)]),
        ),
      ]);
      exigirEstado(a, 201, `ronda ${ronda}: envío del mozo 1`);
      exigirEstado(b, 201, `ronda ${ronda}: envío del mozo 2`);
      const envios = [a.body, b.body] as EnvioRespuestaDePrueba[];
      expect(envios.map((e) => e.numero).sort()).toEqual([1, 2]);
      const primero = envios.find((e) => e.numero === 1)!;
      const segundo = envios.find((e) => e.numero === 2)!;
      expect([primero.esAdicion, segundo.esAdicion]).toEqual([false, true]);
      expect(primero.comandas.every((c: ComandaDePrueba) => c.tipo === 'COMANDA')).toBe(true);
      expect(segundo.comandas.every((c: ComandaDePrueba) => c.tipo === 'ADICION')).toBe(true);
      expect(primero.items.every((i) => !i.esAdicion && i.envioNumero === 1)).toBe(true);
      expect(segundo.items.every((i) => i.esAdicion && i.envioNumero === 2)).toBe(true);
      expect((await conteoDeOrden(admin, o.id)).envios).toBe(2);
      expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(2);
    }
  });
});

// ===================================================================================================
// Criterio 29 · la orden ya no está abierta
// ===================================================================================================

describe('criterio 29 · orden que ya no está abierta', () => {
  it('una orden ANULADA responde 409 ORDEN_NO_ABIERTA y no guarda nada', async () => {
    const o = await abrir();
    await anularOrdenOk(ctx, t().supervisor, o.id);
    ctx.inventario.limpiar();
    const res = await enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)]));
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    await sinEfectos(o.id);
  });

  it('una orden CERRADA responde 409 ORDEN_NO_ABIERTA y no guarda nada', async () => {
    const o = await abrir();
    await cerrarOrdenPorSql(admin, o.id);
    ctx.inventario.limpiar();
    const res = await enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)]));
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    await sinEfectos(o.id);
  });

  it('una orden UNIDA responde 409 ORDEN_NO_ABIERTA con el ordenId de la orden a la que se unió', async () => {
    const principal = await abrir();
    const absorbida = await abrir();
    await unirMesasOk(ctx, t().mozo, principal.id, [absorbida.mesaId]);
    ctx.inventario.limpiar();
    const res = await enviarComanda(ctx, t().mozo, absorbida.id, envio([L.gaseosa(1)]));
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(principal.id);
    await sinEfectos(absorbida.id);
    // Quien manda a la principal sí puede agregar.
    expect((await enviarComoMozo(principal.id, [L.gaseosa(1)])).numero).toBe(1);
  });

  it('una orden de otra sucursal de A o de B responde 404, con el mismo cuerpo que una inexistente', async () => {
    const deS2 = await abrirOrden(ctx, esc.salonS2, t().mozoS2);
    const deB = await abrirOrden(ctx, esc.salonB, t().mozoB);
    const inexistente = randomUUID();
    const antesB = await conteoDeEmpresa(admin, esc.e.B.empresaId);
    const resS2 = await enviarComanda(ctx, t().mozo, deS2.id, envio([L.gaseosa(1)]));
    const resB = await enviarComanda(ctx, t().mozo, deB.id, envio([L.gaseosa(1)]));
    const resNada = await enviarComanda(ctx, t().mozo, inexistente, envio([L.gaseosa(1)]));
    esperarError(resNada, 404, 'NO_ENCONTRADO');
    esperarError(resS2, 404, 'NO_ENCONTRADO');
    esperarError(resB, 404, 'NO_ENCONTRADO');
    expect(cuerpoSinIds(resS2, [deS2.id])).toEqual(cuerpoSinIds(resNada, [inexistente]));
    expect(cuerpoSinIds(resB, [deB.id])).toEqual(cuerpoSinIds(resNada, [inexistente]));
    expect(await conteoDeOrden(admin, deS2.id)).toEqual(CERO);
    expect(await conteoDeEmpresa(admin, esc.e.B.empresaId)).toEqual(antesB);
  });
});

// ===================================================================================================
// Criterio 31 · eventos
// ===================================================================================================

describe('criterio 31 · eventos', () => {
  it('un envío publica cocina.comanda por cada comanda y orden.cambio en la sala de la sucursal, después de confirmar', async () => {
    const o = await abrir();
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio(ejemploCriterio22())),
    );
    exigirEstado(resultado, 201, 'enviar');
    const r = resultado.body as EnvioRespuestaDePrueba;
    for (const ev of eventos) {
      expect(ev.empresaId).toBe(A().empresaId);
      expect(ev.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
    }
    const comandas = eventos
      .filter((e) => e.nombre === 'cocina.comanda')
      .map((e) => eventoCocinaComandaSchema.parse(e));
    expect(
      comandas.map((e) => e.datos).sort((x, y) => x.comandaId.localeCompare(y.comandaId)),
    ).toEqual(
      r.comandas
        .map((c) => ({ comandaId: c.id, estacionId: c.estacionId, tipo: 'COMANDA' as const }))
        .sort((x, y) => x.comandaId.localeCompare(y.comandaId)),
    );
    const cambios = eventos
      .filter((e) => e.nombre === 'orden.cambio')
      .map((e) => eventoOrdenCambioSchema.parse(e));
    expect(cambios.map((e) => e.datos)).toEqual([{ ordenId: o.id }]);
    // La mesa ya estaba ocupada: el envío no cambia su estado.
    expect(eventos.filter((e) => e.nombre === 'salon.cambio')).toEqual([]);
    expect(eventos).toHaveLength(3);
  });

  it('el evento sale después de confirmar: al llamar al inventario, dentro de la transacción, todavía no hay ninguno', async () => {
    const o = await abrir();
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['3/4'])])),
    );
    exigirEstado(resultado, 201, 'enviar');
    expect(ctx.inventario.eventosAlLlamar).toEqual([0]);
    expect(eventos.length).toBeGreaterThan(0);
  });

  it('una adición que saca la orden de la pre-cuenta publica además salon.cambio con la mesa', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'])]);
    exigirEstado(await pedirPrecuenta(ctx, t().mozo, o.id), 201, 'pre-cuenta');
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1), L.lomo(['Jugoso'])])),
    );
    exigirEstado(resultado, 201, 'adición');
    const salon = eventos
      .filter((e) => e.nombre === 'salon.cambio')
      .map((e) => eventoSalonCambioSchema.parse(e));
    expect(salon.map((e) => e.datos)).toEqual([{ mesaIds: [o.mesaId], ordenId: o.id }]);
    const comandas = eventos.filter((e) => e.nombre === 'cocina.comanda');
    expect(comandas).toHaveLength(1);
    expect(comandas[0]!.datos).toMatchObject({ tipo: 'ADICION' });
    expect(eventos.filter((e) => e.nombre === 'orden.cambio')).toHaveLength(1);
  });

  it('una comanda de adición lleva el tipo ADICION en su evento', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'])]);
    const { eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['Jugoso'])])),
    );
    expect(eventos.find((e) => e.nombre === 'cocina.comanda')!.datos).toMatchObject({
      tipo: 'ADICION',
    });
  });

  it('una réplica, un rechazo y una orden no abierta no publican nada', async () => {
    const o = await abrir();
    const cuerpo = envio([L.lomo(['3/4'])]);
    const k = randomUUID();
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, cuerpo, k), 201, 'envío');

    const replicaMismaClave = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, cuerpo, k),
    );
    expect(replicaMismaClave.resultado.status).toBe(201);
    expect(replicaMismaClave.eventos).toEqual([]);

    const replicaMismoId = await conEventos(ctx, () => enviarComanda(ctx, t().mozo, o.id, cuerpo));
    expect(replicaMismoId.resultado.status).toBe(201);
    expect(replicaMismoId.eventos).toEqual([]);

    const rechazo = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.lomo([])])),
    );
    expect(rechazo.resultado.status).toBe(422);
    expect(rechazo.eventos).toEqual([]);

    const invalido = await conEventos(ctx, () => enviarComanda(ctx, t().mozo, o.id, { id: 'x' }));
    expect(invalido.resultado.status).toBe(400);
    expect(invalido.eventos).toEqual([]);

    await anularOrdenOk(ctx, t().supervisor, o.id);
    const cerrada = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)])),
    );
    expect(cerrada.resultado.status).toBe(409);
    expect(cerrada.eventos).toEqual([]);
  });
});
