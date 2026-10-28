// spec: 003-carta (pruebas protegidas)
//
// P1 (parte API) · Criterios 52 y 58 (un solo cálculo): `CartaVentaService.prepararLinea` devuelve
// exactamente lo que `calcularLinea` de `packages/dominio` da con los mismos datos, con el precio de la
// empresa y con el precio de una sucursal, para un producto simple con modificadores, un combo y un menú
// del día; y un producto o un modificador de otra empresa se trata como uno inexistente.
//
// La carta se arma por HTTP con las rutas de `/carta` (como el Administrador de A): una estación, una
// familia, productos simples (algunos ligados a modificadores), grupos, un combo, un menú del día armado
// en S1 y S2, y precios propios en S1. La app real corre con `RelojManual`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { lineaPreparadaSchema } from '@restaurante/contratos';
import {
  calcularLinea,
  precioEfectivo,
  type GrupoDeSeleccion,
  type ProductoParaLinea,
  type ResultadoLinea,
} from '@restaurante/dominio';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { CartaVentaService } from '../../src/modulos/carta';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../src/nucleo/errores';
import {
  escenarioPerezoso,
  sesionAdmin,
  type EmpresaDePrueba,
  type Escenario,
} from '../acceso/fabrica-sesiones';

const sc = escenarioPerezoso({ poolMax: 2 });
afterAll(async () => {
  await sc.cerrar();
});

// ---------------------------------------------------------------------------------------------
// Armado de la carta por HTTP
// ---------------------------------------------------------------------------------------------

type Metodo = 'post' | 'put';

async function enviar(
  esc: Escenario,
  token: string,
  metodo: Metodo,
  ruta: string,
  cuerpo: unknown,
  estado: number,
): Promise<any> {
  const res = await esc.api.llamar(metodo, ruta, { token, cuerpo });
  if (res.status !== estado) {
    throw new Error(
      `Falta la funcionalidad de 003: ${metodo.toUpperCase()} ${ruta} respondió ${res.status} ` +
        `(se esperaba ${estado}): ${res.text}`,
    );
  }
  return res.body;
}

interface ModificadorCreado {
  id: string;
  nombre: string;
  precioExtra: string;
}
interface GrupoCreado {
  id: string;
  minimo: number;
  maximo: number;
  modificadores: ModificadorCreado[];
}

/** Grupo de la especificación en el formato de `calcularLinea` (todos disponibles). */
function paraSeleccion(grupo: GrupoCreado): GrupoDeSeleccion {
  return {
    id: grupo.id,
    minimo: grupo.minimo,
    maximo: grupo.maximo,
    modificadores: grupo.modificadores.map((m) => ({
      id: m.id,
      precioExtra: m.precioExtra,
      disponible: true,
    })),
  };
}

function modificadorDe(grupos: GrupoCreado[], nombre: string): ModificadorCreado {
  for (const grupo of grupos) {
    const encontrado = grupo.modificadores.find((m) => m.nombre === nombre);
    if (encontrado) return encontrado;
  }
  throw new Error(`No hay un modificador ${nombre} en los grupos creados`);
}

interface ProductoCreado {
  id: string;
  precio: string;
  grupos: GrupoCreado[];
}

interface Sembrado {
  S1: string;
  S2: string;
  lomo: ProductoCreado;
  combo: ProductoCreado;
  menu: ProductoCreado;
  /** Precios de sucursal puestos en S1 (S2 usa los de la empresa). */
  precioS1: { lomo: string; combo: string; menu: string };
  /** Un producto simple de B con un grupo y un modificador. */
  productoDeB: string;
  modificadorDeB: string;
}

let sembrado: Promise<Sembrado> | undefined;
function sembrar(): Promise<Sembrado> {
  return (sembrado ??= armarCarta());
}

async function sesionConSucursalActiva(
  esc: Escenario,
  empresa: EmpresaDePrueba,
  sucursalId: string,
): Promise<string> {
  const { token } = await sesionAdmin(esc, empresa);
  const res = await esc.api.put('/sesion/sucursal', { token, cuerpo: { sucursalId } });
  if (res.status !== 200) {
    throw new Error(`No se pudo elegir la sucursal activa (${res.status}): ${res.text}`);
  }
  return token;
}

/** Estación, familia y los productos simples base de una empresa; devuelve lo necesario para armar más. */
async function baseDeEmpresa(esc: Escenario, token: string) {
  const estacion = await enviar(esc, token, 'post', '/carta/estaciones', { nombre: 'Cocina' }, 201);
  const familia = await enviar(esc, token, 'post', '/carta/familias', { nombre: 'Platos' }, 201);
  /** Producto simple que no se vende solo (componente u opción ligada). */
  const auxiliar = (nombre: string): Promise<{ id: string }> =>
    enviar(
      esc,
      token,
      'post',
      '/carta/productos',
      {
        tipo: 'SIMPLE',
        nombre,
        familiaId: familia.id,
        seVendeSolo: false,
        estacionId: estacion.id,
        tipoControlStock: 'UNIDADES',
      },
      201,
    );
  const grupo = (cuerpo: Record<string, unknown>): Promise<GrupoCreado> =>
    enviar(esc, token, 'post', '/carta/grupos-modificadores', cuerpo, 201);
  const producto = (cuerpo: Record<string, unknown>): Promise<{ id: string }> =>
    enviar(esc, token, 'post', '/carta/productos', { familiaId: familia.id, ...cuerpo }, 201);
  return { estacion, familia, auxiliar, grupo, producto };
}

async function armarCarta(): Promise<Sembrado> {
  const esc = await sc.obtener();
  const tokenA = (await sesionAdmin(esc, esc.A)).token;
  const S1 = esc.A.sucursales[0]!.id;
  const S2 = esc.A.sucursales[1]!.id;
  const { estacion, auxiliar, grupo, producto } = await baseDeEmpresa(esc, tokenA);
  const m = (nombre: string, precioExtra = '0.00', productoId: string | null = null) => ({
    nombre,
    precioExtra,
    productoId,
  });

  // Lomo saltado (criterio 57): Término (única, obligatoria) y Extras (múltiple, 0 a 2).
  const huevoFrito = await auxiliar('Huevo frito');
  const termino = await grupo({
    nombre: 'Término',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [m('Jugoso'), m('3/4'), m('Bien cocido')],
  });
  const extras = await grupo({
    nombre: 'Extras',
    seleccion: 'MULTIPLE',
    minimo: 0,
    maximo: 2,
    modificadores: [m('Huevo', '2.50', huevoFrito.id), m('Plátano', '3.00'), m('Queso', '2.00')],
  });
  const lomo = await producto({
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    precio: '28.00',
    seVendeSolo: true,
    estacionId: estacion.id,
    tipoControlStock: 'UNIDADES',
    gruposModificadores: [termino.id, extras.id],
  });

  // Combo hamburguesa (criterio 30).
  const hamburguesa = await auxiliar('Hamburguesa clásica');
  const cervezaProducto = await auxiliar('Cerveza');
  const bebida = await grupo({
    nombre: 'Bebida',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [m('Chicha'), m('Inca Kola'), m('Cerveza', '4.50', cervezaProducto.id)],
  });
  const acompanamiento = await grupo({
    nombre: 'Acompañamiento',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [m('Papas'), m('Ensalada', '1.00')],
  });
  const combo = await producto({
    tipo: 'COMBO',
    nombre: 'Combo hamburguesa',
    precio: '22.90',
    seVendeSolo: true,
    tipoControlStock: 'SIN_CONTROL',
    componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    gruposModificadores: [bebida.id, acompanamiento.id],
  });

  // Menú del día (criterio 57): los platos candidatos van ligados a productos por porciones.
  const platoLigado = async (nombre: string) => (await auxiliar(nombre)).id;
  const entrada = await grupo({
    nombre: 'Entrada',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      m('Papa a la huancaína', '0.00', await platoLigado('Papa a la huancaína (plato)')),
      m('Sopa', '0.00', await platoLigado('Sopa (plato)')),
    ],
  });
  const segundo = await grupo({
    nombre: 'Segundo',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      m('Ají de gallina', '0.00', await platoLigado('Ají de gallina (plato)')),
      m('Lomo saltado del menú', '5.00', await platoLigado('Lomo saltado (plato)')),
    ],
  });
  const menu = await producto({
    tipo: 'MENU_DEL_DIA',
    nombre: 'Menú del día',
    precio: '12.00',
    seVendeSolo: true,
    tipoControlStock: 'PORCIONES',
    gruposModificadores: [entrada.id, segundo.id],
  });

  // El menú del día se arma en cada sucursal con su sucursal activa (día operativo actual).
  const opciones = [...entrada.modificadores, ...segundo.modificadores].map((x) => x.id);
  for (const sucursal of [S1, S2]) {
    const token = await sesionConSucursalActiva(esc, esc.A, sucursal);
    await enviar(esc, token, 'put', `/carta/sucursal/menu-del-dia/${menu.id}`, { opciones }, 200);
  }

  // Precios propios de S1; S2 conserva los de la empresa.
  const precioS1 = { lomo: '30.00', combo: '20.00', menu: '10.00' };
  for (const [producto_, precio] of [
    [lomo.id, precioS1.lomo],
    [combo.id, precioS1.combo],
    [menu.id, precioS1.menu],
  ] as const) {
    await enviar(
      esc,
      tokenA,
      'put',
      `/carta/productos/${producto_}/sucursales/${S1}`,
      { precio, disponible: true },
      200,
    );
  }

  // Un producto simple con un grupo en B.
  const tokenB = (await sesionAdmin(esc, esc.B)).token;
  const baseB = await baseDeEmpresa(esc, tokenB);
  const grupoB = await baseB.grupo({
    nombre: 'Término',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [m('Jugoso'), m('3/4')],
  });
  const productoB = await baseB.producto({
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    precio: '28.00',
    seVendeSolo: true,
    estacionId: baseB.estacion.id,
    tipoControlStock: 'UNIDADES',
    gruposModificadores: [grupoB.id],
  });

  return {
    S1,
    S2,
    lomo: { id: lomo.id, precio: '28.00', grupos: [termino, extras] },
    combo: { id: combo.id, precio: '22.90', grupos: [bebida, acompanamiento] },
    menu: { id: menu.id, precio: '12.00', grupos: [entrada, segundo] },
    precioS1,
    productoDeB: productoB.id,
    modificadorDeB: grupoB.modificadores[0]!.id,
  };
}

// ---------------------------------------------------------------------------------------------
// prepararLinea y el cálculo esperado
// ---------------------------------------------------------------------------------------------

async function preparar(
  sucursalId: string,
  productoId: string,
  modificadorIds: string[],
  cantidad: number,
) {
  const esc = await sc.obtener();
  const instante = esc.reloj.ahora();
  return esc.app
    .get(ContextoEmpresa)
    .ejecutar(
      esc.A.id,
      () =>
        esc.app
          .get(CartaVentaService, { strict: false })
          .prepararLinea({ sucursalId, productoId, modificadorIds, cantidad, instante }),
      { actor: { sistema: 'prueba' } },
    );
}

/** Lo que da `calcularLinea` con el precio efectivo y los grupos del producto. */
function calculoEsperado(
  producto: ProductoCreado,
  precioDeSucursal: string | null,
  elegidos: string[],
  cantidad: number,
): Extract<ResultadoLinea, { valido: true }> {
  const entrada: ProductoParaLinea = {
    precio: precioEfectivo(producto.precio, precioDeSucursal),
    grupos: producto.grupos.map(paraSeleccion),
  };
  const resultado = calcularLinea(entrada, elegidos, cantidad);
  if (!resultado.valido)
    throw new Error(`La selección de la prueba no es válida: ${JSON.stringify(resultado)}`);
  return resultado;
}

const porId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

/** `prepararLinea` devuelve lo mismo que `calcularLinea`: precio unitario, total y precio extra de cada modificador. */
async function verificar(
  producto: ProductoCreado,
  tipo: 'SIMPLE' | 'COMBO' | 'MENU_DEL_DIA',
  sucursalId: string,
  precioDeSucursal: string | null,
  modificadorIds: string[],
  cantidad: number,
  anclas: { precioUnitario: string; total: string },
) {
  const esperado = calculoEsperado(producto, precioDeSucursal, modificadorIds, cantidad);
  const linea = await preparar(sucursalId, producto.id, modificadorIds, cantidad);

  lineaPreparadaSchema.parse(linea);
  expect(linea).toMatchObject({
    productoId: producto.id,
    tipo,
    cantidad,
    precioUnitario: esperado.precioUnitario,
    total: esperado.total,
  });
  expect(
    linea.modificadores.map((x) => ({ id: x.id, precioExtra: x.precioExtra })).sort(porId),
  ).toEqual([...esperado.modificadores].sort(porId));
  // Los valores de la especificación, a mano, para que el cálculo esperado no sea circular.
  expect({ precioUnitario: linea.precioUnitario, total: linea.total }).toEqual(anclas);
  return linea;
}

// ---------------------------------------------------------------------------------------------
// Criterio 58 · prepararLinea = calcularLinea
// ---------------------------------------------------------------------------------------------

describe('criterio 58 · prepararLinea devuelve lo que calcularLinea da con los mismos datos', () => {
  describe('producto simple con modificadores (Lomo saltado)', () => {
    it('con el precio de la empresa (S2): [3/4, Huevo, Plátano] × 2 da "33.50" y "67.00"', async () => {
      const s = await sembrar();
      const ids = ['3/4', 'Huevo', 'Plátano'].map((n) => modificadorDe(s.lomo.grupos, n).id);
      await verificar(s.lomo, 'SIMPLE', s.S2, null, ids, 2, {
        precioUnitario: '33.50',
        total: '67.00',
      });
    });

    it('con el precio de la sucursal (S1, "30.00"): [3/4, Huevo, Plátano] × 2 da "35.50" y "71.00"', async () => {
      const s = await sembrar();
      const ids = ['3/4', 'Huevo', 'Plátano'].map((n) => modificadorDe(s.lomo.grupos, n).id);
      await verificar(s.lomo, 'SIMPLE', s.S1, s.precioS1.lomo, ids, 2, {
        precioUnitario: '35.50',
        total: '71.00',
      });
    });

    it('con el precio de la sucursal (S1): [3/4] × 1 da "30.00" y "30.00" (criterio 57)', async () => {
      const s = await sembrar();
      const ids = [modificadorDe(s.lomo.grupos, '3/4').id];
      await verificar(s.lomo, 'SIMPLE', s.S1, s.precioS1.lomo, ids, 1, {
        precioUnitario: '30.00',
        total: '30.00',
      });
    });

    it('el precio propio de S1 no se aplica en S2: [3/4] × 1 en S2 da "28.00"', async () => {
      const s = await sembrar();
      const ids = [modificadorDe(s.lomo.grupos, '3/4').id];
      await verificar(s.lomo, 'SIMPLE', s.S2, null, ids, 1, {
        precioUnitario: '28.00',
        total: '28.00',
      });
    });
  });

  describe('combo (Combo hamburguesa)', () => {
    it('con el precio de la empresa (S2): [Cerveza, Ensalada] × 3 da "28.40" y "85.20"', async () => {
      const s = await sembrar();
      const ids = ['Cerveza', 'Ensalada'].map((n) => modificadorDe(s.combo.grupos, n).id);
      await verificar(s.combo, 'COMBO', s.S2, null, ids, 3, {
        precioUnitario: '28.40',
        total: '85.20',
      });
    });

    it('con el precio de la empresa (S2): [Chicha, Papas] × 1 da "22.90" y "22.90"', async () => {
      const s = await sembrar();
      const ids = ['Chicha', 'Papas'].map((n) => modificadorDe(s.combo.grupos, n).id);
      await verificar(s.combo, 'COMBO', s.S2, null, ids, 1, {
        precioUnitario: '22.90',
        total: '22.90',
      });
    });

    it('con el precio de la sucursal (S1, "20.00"): [Cerveza, Ensalada] × 3 da "25.50" y "76.50"', async () => {
      const s = await sembrar();
      const ids = ['Cerveza', 'Ensalada'].map((n) => modificadorDe(s.combo.grupos, n).id);
      await verificar(s.combo, 'COMBO', s.S1, s.precioS1.combo, ids, 3, {
        precioUnitario: '25.50',
        total: '76.50',
      });
    });
  });

  describe('menú del día', () => {
    it('con el precio de la empresa (S2): [Sopa, Lomo saltado] × 1 da "17.00" y "17.00"', async () => {
      const s = await sembrar();
      const ids = ['Sopa', 'Lomo saltado del menú'].map((n) => modificadorDe(s.menu.grupos, n).id);
      await verificar(s.menu, 'MENU_DEL_DIA', s.S2, null, ids, 1, {
        precioUnitario: '17.00',
        total: '17.00',
      });
    });

    it('con el precio de la sucursal (S1, "10.00"): [Sopa, Lomo saltado] × 2 da "15.00" y "30.00"', async () => {
      const s = await sembrar();
      const ids = ['Sopa', 'Lomo saltado del menú'].map((n) => modificadorDe(s.menu.grupos, n).id);
      await verificar(s.menu, 'MENU_DEL_DIA', s.S1, s.precioS1.menu, ids, 2, {
        precioUnitario: '15.00',
        total: '30.00',
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 52 · un producto o un modificador de B es como uno inexistente
// ---------------------------------------------------------------------------------------------

/** Lo que lanza `fn`; falla si no lanza nada. */
async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Esperaba un error y la operación terminó bien');
}

/** El error como lo vería el cliente, con el id enviado reemplazado para poder comparar dos ids distintos. */
function huella(error: unknown, idEnviado: string): string {
  expect(error, `no es un ErrorAplicacion: ${String(error)}`).toBeInstanceOf(ErrorAplicacion);
  const e = error as ErrorAplicacion;
  return JSON.stringify({
    estado: e.getStatus(),
    codigo: e.codigo,
    mensaje: e.message,
    campos: e.campos,
    propio: { ...e },
  }).replaceAll(idEnviado, '<id>');
}

describe('criterio 52 · producto o modificador de otra empresa, igual que uno inexistente', () => {
  it('un producto inexistente lanza un error de la aplicación (no encontrado)', async () => {
    const esc = await sc.obtener();
    const error = await capturar(() => preparar(esc.A.sucursales[0]!.id, randomUUID(), [], 1));
    expect(error).toBeInstanceOf(ErrorAplicacion);
    expect(['NO_ENCONTRADO', 'REFERENCIA_INVALIDA']).toContain((error as ErrorAplicacion).codigo);
  });

  it('un producto de B (con una sucursal de A) da el mismo error que un producto inexistente', async () => {
    const s = await sembrar();
    const inexistente = randomUUID();
    const deB = await capturar(() => preparar(s.S1, s.productoDeB, [], 1));
    const sinExistir = await capturar(() => preparar(s.S1, inexistente, [], 1));
    expect(['NO_ENCONTRADO', 'REFERENCIA_INVALIDA']).toContain((deB as ErrorAplicacion).codigo);
    expect(huella(deB, s.productoDeB)).toBe(huella(sinExistir, inexistente));
  });

  it('un modificador de B junto a una selección válida da el mismo error que uno inexistente', async () => {
    const s = await sembrar();
    const valido = modificadorDe(s.lomo.grupos, '3/4').id;
    const inexistente = randomUUID();
    const deB = await capturar(() => preparar(s.S1, s.lomo.id, [valido, s.modificadorDeB], 1));
    const sinExistir = await capturar(() => preparar(s.S1, s.lomo.id, [valido, inexistente], 1));
    for (const error of [deB, sinExistir]) {
      expect(error).toBeInstanceOf(ErrorAplicacion);
      expect(error).toMatchObject({ codigo: 'SELECCION_INVALIDA' });
      expect((error as ErrorAplicacion).getStatus()).toBe(422);
    }
    expect(huella(deB, s.modificadorDeB)).toBe(huella(sinExistir, inexistente));
  });
});
