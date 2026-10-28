// spec: 003-carta (pruebas protegidas)
//
// P2 (parte 2) · El Cajero y la carta (ruta crítica), decisión 5 y criterios 2b, 19b, 38, 43, 61, 61b y 62.
// Dado el Cajero (Cajero en S1, Mozo en S2, S1 activa), con sesión de contraseña y de PIN:
// - puede crear y editar familias, productos de los tres tipos (precio de la empresa, foto, tipo, desactivar),
//   grupos con precios extra, leer las estaciones, consultar los ajustes de todas las sucursales (`editable`
//   solo en S1) y ajustar el precio y la disponibilidad de S1; cada escritura deja exactamente una fila de
//   auditoría con él como autor y, en los cambios de precio, el antes y el después exactos;
// - no puede ajustar S2 ni S3 (403 `PROHIBIDO`, sin cambios, sin auditoría y sin eventos, y la misma sesión
//   sí ajusta S1 antes y después), ni poner S2 en `noDisponibleEn`, ni crear o modificar estaciones, ni
//   marcar agotados ni armar el menú; con S2 activa toda ruta de `EDITAR_CARTA` responde 403, sin sucursal
//   activa 409, y al perder el rol de Cajero la siguiente petición responde 403;
// - otros casos: un Cajero de S1 y S2 ajusta las dos; un Cajero en S1 y Supervisor en S2 ajusta S1 y no S2;
//   el Administrador ajusta cualquier sucursal con o sin sucursal activa.
// Hoy las rutas no tienen `@Permiso` y no existen las tablas: las pruebas fallan por eso.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  auditoriaCarta,
  contarFilas,
  crearEscenarioCarta,
  crearPersona,
  ejecutarYAuditar,
  asentar,
  esperarError,
  exigirEstado,
  exigirSinFallos,
  filaProductoSucursal,
  idsAleatorios,
  idsDe,
  instantaneaCarta,
  llamar,
  pngValido,
  productoSimpleNuevo,
  rutasDeClase,
  sembrarCarta,
  sesionContrasena,
  sesionesDe,
  unaFila,
  unico,
  type AppCarta,
  type DatosCarta,
  type EscenarioCarta,
  type Llamada,
  type PersonaCarta,
  type RutaCarta,
  type SesionesDe,
} from './fabrica-permisos-carta';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let ctx: AppCarta;
let admin: Client;
let escenarioPendiente: Promise<EscenarioCarta> | undefined;
let datosPendientes: Promise<DatosCarta> | undefined;

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const esc = () => (escenarioPendiente ??= crearEscenarioCarta(ctx));
const datosA = () => (datosPendientes ??= esc().then((e) => sembrarCarta(ctx, e.A.tokenAdmin)));

const memo = new Map<string, Promise<SesionesDe>>();
function sesiones(persona: PersonaCarta, sucursalId: string | null): Promise<SesionesDe> {
  const clave = `${persona.id}:${sucursalId}`;
  let p = memo.get(clave);
  if (!p) {
    p = sesionesDe(ctx, persona, sucursalId);
    memo.set(clave, p);
  }
  return p;
}

const TIPOS = ['contrasena', 'pin'] as const;

/** Un producto simple nuevo de A creado por el Administrador (para probar ajustes sin tocar los demás). */
async function productoDelAdmin(
  e: EscenarioCarta,
  datos: DatosCarta,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; nombre: string }> {
  const res = await llamar(ctx, e.A.tokenAdmin, {
    metodo: 'post',
    ruta: '/carta/productos',
    cuerpo: productoSimpleNuevo(
      { familiaId: datos.familiaId, estacionId: datos.estacionId },
      { precio: '25.00', ...extra },
    ),
  });
  exigirEstado(res, 201, 'el Administrador crea un producto');
  return { id: res.body.id as string, nombre: res.body.nombre as string };
}

/** Las filas de las tablas, la auditoría, los archivos y los eventos no cambian mientras corre `fn`. */
async function sinCambios(e: EscenarioCarta, fn: () => Promise<void>): Promise<void> {
  await asentar();
  ctx.publicador.limpiar();
  const tablas = await instantaneaCarta(admin, e.A.empresaId);
  const auditoria = await auditoriaCarta(admin, e.A.empresaId);
  const claves = ctx.almacen.claves();
  await fn();
  expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(tablas);
  expect(await auditoriaCarta(admin, e.A.empresaId)).toEqual(auditoria);
  expect(ctx.almacen.claves()).toEqual(claves);
  await asentar();
  expect(ctx.publicador.eventos()).toEqual([]);
}

/** Envía cada ruta y devuelve las que no respondieron `estado` y `codigo`. */
async function fallosEn(
  token: string,
  rutas: RutaCarta[],
  ids: ReturnType<typeof idsDe>,
  estado: number,
  codigo: string,
): Promise<string[]> {
  const fallos: string[] = [];
  for (const ruta of rutas) {
    const res = await llamar(ctx, token, ruta.construir(ids));
    const c = (res.body as { codigo?: string } | undefined)?.codigo;
    if (res.status !== estado || c !== codigo) {
      fallos.push(`${ruta.clave}: se esperaba ${estado} ${codigo} y fue ${res.status} ${c}`);
    }
  }
  exigirSinFallos(fallos);
  return fallos;
}

// ------------------------------------------------------------------------------------------------
// 61b · Lo que el Cajero puede
// ------------------------------------------------------------------------------------------------
describe.each(TIPOS)('criterio 61b · lo que el Cajero puede (sesión de %s)', (tipo) => {
  async function preparar() {
    const e = await esc();
    const datos = await datosA();
    const token = (await sesiones(e.A.cajero, e.A.S1))[tipo];
    const cajeroId = e.A.cajero.id;
    const hacer = (llamada: Llamada) => ejecutarYAuditar(ctx, admin, e.A.empresaId, token, llamada);
    return { e, datos, token, cajeroId, hacer };
  }

  it('crea, edita y ordena familias y ordena los productos de una familia, una fila por escritura y él como autor', async () => {
    const { e, datos, token, cajeroId, hacer } = await preparar();
    const crear = await hacer({
      metodo: 'post',
      ruta: '/carta/familias',
      cuerpo: { nombre: unico('Entradas') },
    });
    exigirEstado(crear.res, 201, 'el Cajero crea una familia');
    unaFila(crear.nuevas, {
      accion: 'crear_familia',
      actorUsuarioId: cajeroId,
      entidad: 'familia',
      entidadId: crear.res.body.id,
    });
    const renombrar = await hacer({
      metodo: 'patch',
      ruta: `/carta/familias/${crear.res.body.id}`,
      cuerpo: { nombre: unico('Entradas frías') },
    });
    exigirEstado(renombrar.res, 200, 'el Cajero edita una familia');
    unaFila(renombrar.nuevas, {
      accion: 'modificar_familia',
      actorUsuarioId: cajeroId,
      entidadId: crear.res.body.id,
    });

    const lista = await llamar(ctx, token, { metodo: 'get', ruta: '/carta/familias' });
    exigirEstado(lista, 200, 'el Cajero lista las familias');
    const ids = (lista.body as { id: string }[]).map((f) => f.id).reverse();
    expect(ids.length).toBeGreaterThan(1);
    const ordenar = await hacer({ metodo: 'put', ruta: '/carta/familias/orden', cuerpo: { ids } });
    exigirEstado(ordenar.res, 200, 'el Cajero ordena las familias');
    expect((ordenar.res.body as { id: string }[]).map((f) => f.id)).toEqual(ids);
    unaFila(ordenar.nuevas, { accion: 'ordenar_familias', actorUsuarioId: cajeroId });

    const productos = await llamar(ctx, token, { metodo: 'get', ruta: '/carta/productos' });
    exigirEstado(productos, 200, 'el Cajero lista los productos');
    const deLaFamilia = (productos.body as { id: string; familiaId: string }[])
      .filter((p) => p.familiaId === datos.familiaId)
      .map((p) => p.id)
      .reverse();
    expect(deLaFamilia.length).toBeGreaterThan(1);
    const ordenarProductos = await hacer({
      metodo: 'put',
      ruta: `/carta/familias/${datos.familiaId}/productos/orden`,
      cuerpo: { ids: deLaFamilia },
    });
    exigirEstado(ordenarProductos.res, 200, 'el Cajero ordena los productos de una familia');
    unaFila(ordenarProductos.nuevas, { accion: 'ordenar_productos', actorUsuarioId: cajeroId });
    void e;
  });

  it('crea un producto simple, un combo y un menú del día; el producto queda con su autor', async () => {
    const { e, datos, cajeroId, hacer } = await preparar();
    const simple = await hacer({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimpleNuevo({ familiaId: datos.familiaId, estacionId: datos.estacionId }),
    });
    exigirEstado(simple.res, 201, 'el Cajero crea un producto simple');
    unaFila(simple.nuevas, {
      accion: 'crear_producto',
      actorUsuarioId: cajeroId,
      entidad: 'producto',
      entidadId: simple.res.body.id,
    });
    const combo = await hacer({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: {
        tipo: 'COMBO',
        nombre: unico('Combo'),
        familiaId: datos.familiaId,
        precio: '22.90',
        tipoControlStock: 'SIN_CONTROL',
        componentes: [{ productoId: datos.productoId, cantidad: 1 }],
        gruposModificadores: [datos.grupoId],
      },
    });
    exigirEstado(combo.res, 201, 'el Cajero crea un combo');
    unaFila(combo.nuevas, { accion: 'crear_producto', actorUsuarioId: cajeroId });
    const menu = await hacer({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: {
        tipo: 'MENU_DEL_DIA',
        nombre: unico('Menú'),
        familiaId: datos.familiaId,
        precio: '12.00',
        tipoControlStock: 'PORCIONES',
        gruposModificadores: [datos.grupoMenuId],
      },
    });
    exigirEstado(menu.res, 201, 'el Cajero crea un menú del día');
    unaFila(menu.nuevas, { accion: 'crear_producto', actorUsuarioId: cajeroId });

    const fila = await admin.query(`SELECT * FROM producto WHERE id = $1`, [simple.res.body.id]);
    expect(fila.rows[0].creado_por_usuario_id).toBe(cajeroId);
    expect(fila.rows[0].actualizado_por_usuario_id).toBe(cajeroId);
    void e;
  });

  it('cambia el precio de la empresa: una fila con el antes y el después exactos; el precio efectivo de S2 cambia también', async () => {
    const { e, datos, token, cajeroId, hacer } = await preparar();
    const creado = await hacer({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimpleNuevo(
        { familiaId: datos.familiaId, estacionId: datos.estacionId },
        { precio: '25.00' },
      ),
    });
    exigirEstado(creado.res, 201, 'el Cajero crea un producto');
    const id = creado.res.body.id as string;
    const cambio = await hacer({
      metodo: 'patch',
      ruta: `/carta/productos/${id}`,
      cuerpo: { precio: '26.00' },
    });
    exigirEstado(cambio.res, 200, 'el Cajero cambia el precio');
    const fila = unaFila(cambio.nuevas, {
      accion: 'modificar_producto',
      actorUsuarioId: cajeroId,
      entidad: 'producto',
      entidadId: id,
    });
    expect((fila.detalle as { precio: unknown }).precio).toEqual({
      antes: '25.00',
      despues: '26.00',
    });
    const actualizado = await admin.query(`SELECT * FROM producto WHERE id = $1`, [id]);
    expect(actualizado.rows[0].actualizado_por_usuario_id).toBe(cajeroId);

    // Lo que es de toda la empresa vale en S2, donde no es Cajero, mientras S2 no tenga precio propio.
    const sucursales = await llamar(ctx, token, {
      metodo: 'get',
      ruta: `/carta/productos/${id}/sucursales`,
    });
    exigirEstado(sucursales, 200, 'ajustes por sucursal');
    const porId = new Map(
      (sucursales.body as { sucursalId: string; precioEfectivo: string }[]).map((s) => [
        s.sucursalId,
        s,
      ]),
    );
    expect(porId.get(e.A.S2)?.precioEfectivo).toBe('26.00');
    expect(porId.get(e.A.S1)?.precioEfectivo).toBe('26.00');

    const repetido = await hacer({
      metodo: 'patch',
      ruta: `/carta/productos/${id}`,
      cuerpo: { precio: '26.00' },
    });
    exigirEstado(repetido.res, 200, 'repetir el precio');
    expect(repetido.nuevas).toEqual([]);
  });

  it('sube y quita la foto con las claves bajo su empresa; una fila por cambio', async () => {
    const { e, datos, cajeroId, hacer } = await preparar();
    const producto = await productoDelAdmin(e, datos);
    const subir = await hacer({
      metodo: 'put',
      ruta: `/carta/productos/${producto.id}/foto`,
      binario: { tipo: 'image/png', datos: pngValido() },
    });
    exigirEstado(subir.res, 200, 'el Cajero sube la foto');
    expect(typeof subir.res.body.fotoUrl).toBe('string');
    unaFila(subir.nuevas, {
      accion: 'cambiar_foto_producto',
      actorUsuarioId: cajeroId,
      entidad: 'producto',
      entidadId: producto.id,
    });
    const claves = ctx.almacen
      .claves()
      .filter((c) => c.startsWith(`carta/${e.A.empresaId}/${producto.id}/`));
    expect(claves).toHaveLength(1);
    const quitar = await hacer({ metodo: 'delete', ruta: `/carta/productos/${producto.id}/foto` });
    exigirEstado(quitar.res, 204, 'el Cajero quita la foto');
    unaFila(quitar.nuevas, {
      accion: 'quitar_foto_producto',
      actorUsuarioId: cajeroId,
      entidadId: producto.id,
    });
    await vi.waitFor(() => expect(ctx.almacen.claves()).not.toContain(claves[0]));
  });

  it('desactiva un producto y le cambia el tipo; una fila por cambio con él como autor', async () => {
    const { e, datos, cajeroId, hacer } = await preparar();
    const aDesactivar = await productoDelAdmin(e, datos);
    const desactivar = await hacer({
      metodo: 'patch',
      ruta: `/carta/productos/${aDesactivar.id}`,
      cuerpo: { activo: false },
    });
    exigirEstado(desactivar.res, 200, 'el Cajero desactiva un producto');
    unaFila(desactivar.nuevas, {
      accion: 'modificar_producto',
      actorUsuarioId: cajeroId,
      entidadId: aDesactivar.id,
    });

    // Un simple sin estación pasa a combo sin perder nada: no hace falta confirmar.
    const sinEstacion = await productoDelAdmin(e, datos, { estacionId: null });
    const aCombo = await hacer({
      metodo: 'patch',
      ruta: `/carta/productos/${sinEstacion.id}`,
      cuerpo: { tipo: 'COMBO', componentes: [{ productoId: datos.productoId, cantidad: 1 }] },
    });
    exigirEstado(aCombo.res, 200, 'el Cajero cambia el tipo');
    expect(aCombo.res.body.tipo).toBe('COMBO');
    const fila = unaFila(aCombo.nuevas, {
      accion: 'modificar_producto',
      actorUsuarioId: cajeroId,
      entidadId: sinEstacion.id,
    });
    const texto = JSON.stringify(fila.detalle);
    expect(texto).toContain('SIMPLE');
    expect(texto).toContain('COMBO');
  });

  it('crea y edita grupos con precios extra; el cambio del precio extra guarda el antes y el después', async () => {
    const { cajeroId, hacer } = await preparar();
    const crear = await hacer({
      metodo: 'post',
      ruta: '/carta/grupos-modificadores',
      cuerpo: {
        nombre: unico('Extras'),
        seleccion: 'MULTIPLE',
        minimo: 0,
        maximo: 2,
        modificadores: [
          { nombre: 'Huevo', precioExtra: '2.50' },
          { nombre: 'Queso', precioExtra: '2.00' },
        ],
      },
    });
    exigirEstado(crear.res, 201, 'el Cajero crea un grupo');
    const grupoId = crear.res.body.id as string;
    unaFila(crear.nuevas, {
      accion: 'crear_grupo_modificadores',
      actorUsuarioId: cajeroId,
      entidad: 'grupo_modificadores',
      entidadId: grupoId,
    });
    const [huevo, queso] = crear.res.body.modificadores as { id: string }[];
    const modificar = await hacer({
      metodo: 'patch',
      ruta: `/carta/grupos-modificadores/${grupoId}`,
      cuerpo: {
        modificadores: [
          { id: huevo!.id, nombre: 'Huevo', precioExtra: '3.00' },
          { id: queso!.id, nombre: 'Queso', precioExtra: '2.00' },
        ],
      },
    });
    exigirEstado(modificar.res, 200, 'el Cajero edita un grupo');
    const fila = unaFila(modificar.nuevas, {
      accion: 'modificar_grupo_modificadores',
      actorUsuarioId: cajeroId,
      entidadId: grupoId,
    });
    const texto = JSON.stringify(fila.detalle);
    expect(texto).toContain('2.50');
    expect(texto).toContain('3.00');
  });

  it('lee las estaciones pero no las modifica: GET 200, POST y PATCH 403 sin cambios', async () => {
    const { e, datos, token } = await preparar();
    const lectura = await llamar(ctx, token, { metodo: 'get', ruta: '/carta/estaciones' });
    exigirEstado(lectura, 200, 'el Cajero lee las estaciones');
    expect((lectura.body as { id: string }[]).map((s) => s.id)).toContain(datos.estacionId);
    await sinCambios(e, async () => {
      for (const ruta of rutasDeClase('ADMINISTRAR')) {
        esperarError(
          await llamar(ctx, token, ruta.construir(idsDe(datos, e.A.S2))),
          403,
          'PROHIBIDO',
        );
      }
    });
  });

  it('consulta los ajustes de todas las sucursales de la empresa con editable solo en S1', async () => {
    const { e, datos, token } = await preparar();
    const res = await llamar(ctx, token, {
      metodo: 'get',
      ruta: `/carta/productos/${datos.productoId}/sucursales`,
    });
    exigirEstado(res, 200, 'GET ajustes por sucursal');
    const filas = res.body as { sucursalId: string; editable: boolean }[];
    expect(filas.map((f) => f.sucursalId).sort()).toEqual([e.A.S1, e.A.S2, e.A.S3!].sort());
    expect(Object.fromEntries(filas.map((f) => [f.sucursalId, f.editable]))).toEqual({
      [e.A.S1]: true,
      [e.A.S2]: false,
      [e.A.S3!]: false,
    });
  });

  it('ajusta el precio y la disponibilidad de S1: 200, una fila con sucursal_id S1 y el antes y el después; S2 no cambia', async () => {
    const { e, datos, cajeroId, hacer } = await preparar();
    const producto = await productoDelAdmin(e, datos);
    const ruta = (sucursalId: string) => `/carta/productos/${producto.id}/sucursales/${sucursalId}`;
    const primero = await hacer({
      metodo: 'put',
      ruta: ruta(e.A.S1),
      cuerpo: { precio: '27.50', disponible: true },
    });
    exigirEstado(primero.res, 200, 'el Cajero ajusta S1');
    expect(primero.res.body).toMatchObject({
      sucursalId: e.A.S1,
      precio: '27.50',
      precioEfectivo: '27.50',
      disponible: true,
      editable: true,
    });
    unaFila(primero.nuevas, {
      accion: 'ajustar_producto_sucursal',
      actorUsuarioId: cajeroId,
      entidad: 'producto',
      entidadId: producto.id,
      sucursalId: e.A.S1,
    });
    const repetido = await hacer({
      metodo: 'put',
      ruta: ruta(e.A.S1),
      cuerpo: { precio: '27.50', disponible: true },
    });
    exigirEstado(repetido.res, 200, 'repetir el ajuste');
    expect(repetido.nuevas).toEqual([]);
    const segundo = await hacer({
      metodo: 'put',
      ruta: ruta(e.A.S1),
      cuerpo: { precio: '29.00', disponible: false },
    });
    exigirEstado(segundo.res, 200, 'segundo ajuste');
    const fila = unaFila(segundo.nuevas, {
      accion: 'ajustar_producto_sucursal',
      actorUsuarioId: cajeroId,
      sucursalId: e.A.S1,
    });
    expect((fila.detalle as { precio: unknown }).precio).toEqual({
      antes: '27.50',
      despues: '29.00',
    });
    expect(await filaProductoSucursal(admin, producto.id, e.A.S2)).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------
// 19b · Lo que el Cajero no puede
// ------------------------------------------------------------------------------------------------
describe('criterio 19b · el Cajero no ajusta sucursales donde no es Cajero', () => {
  for (const tipo of TIPOS) {
    for (const [nombre, sucursal, conFilaPrevia] of [
      ['S2 (Mozo)', (e: EscenarioCarta) => e.A.S2, true],
      ['S3 (sin acceso)', (e: EscenarioCarta) => e.A.S3!, false],
    ] as const) {
      it(`${nombre} con sesión de ${tipo}: solo precio, solo disponibilidad y ambos responden 403 sin cambios; la misma sesión ajusta S1 antes y después`, async () => {
        const e = await esc();
        const datos = await datosA();
        const token = (await sesiones(e.A.cajero, e.A.S1))[tipo];
        const producto = await productoDelAdmin(e, datos);
        const ajustar = (sucursalId: string, cuerpo: unknown) =>
          llamar(ctx, token, {
            metodo: 'put',
            ruta: `/carta/productos/${producto.id}/sucursales/${sucursalId}`,
            cuerpo,
          });
        const destino = sucursal(e);
        let precioActual: string | null = null;
        if (conFilaPrevia) {
          // El Administrador deja un ajuste propio en esa sucursal: el 403 no debe tocarlo.
          const previo = await llamar(ctx, e.A.tokenAdmin, {
            metodo: 'put',
            ruta: `/carta/productos/${producto.id}/sucursales/${destino}`,
            cuerpo: { precio: '20.00', disponible: true },
          });
          exigirEstado(previo, 200, 'el Administrador ajusta la sucursal');
          precioActual = '20.00';
        }
        // Control antes: la misma sesión sí ajusta S1.
        exigirEstado(
          await ajustar(e.A.S1, { precio: '27.50', disponible: true }),
          200,
          'control antes: el Cajero ajusta S1',
        );

        const filaAntes = await filaProductoSucursal(admin, producto.id, destino);
        await sinCambios(e, async () => {
          const casos = [
            { precio: '31.00', disponible: true }, // solo el precio
            { precio: precioActual, disponible: false }, // solo la disponibilidad
            { precio: '31.00', disponible: false }, // ambos
          ];
          for (const cuerpo of casos) {
            const res = await ajustar(destino, cuerpo);
            esperarError(res, 403, 'PROHIBIDO');
            expect(res.body.mensaje).toMatch(/sucursales donde eres Cajero/);
          }
        });
        expect(await filaProductoSucursal(admin, producto.id, destino)).toEqual(filaAntes);

        // Control después: la sesión sigue siendo válida y sigue ajustando S1.
        exigirEstado(
          await ajustar(e.A.S1, { precio: '28.00', disponible: true }),
          200,
          'control después: el Cajero ajusta S1',
        );
      });
    }
  }

  it('una sucursal de B o inexistente responde 404 NO_ENCONTRADO con el mismo cuerpo (antes de mirar el rol)', async () => {
    const e = await esc();
    const datos = await datosA();
    const token = (await sesiones(e.A.cajero, e.A.S1)).contrasena;
    const producto = await productoDelAdmin(e, datos);
    const cuerpo = { precio: '31.00', disponible: false };
    const deB = await llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/productos/${producto.id}/sucursales/${e.B.S1}`,
      cuerpo,
    });
    const inexistente = await llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/productos/${producto.id}/sucursales/${randomUUID()}`,
      cuerpo,
    });
    esperarError(deB, 404, 'NO_ENCONTRADO');
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    expect(deB.body).toEqual(inexistente.body);
    expect(await filaProductoSucursal(admin, producto.id, e.B.S1)).toBeUndefined();
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS n FROM producto_sucursal WHERE sucursal_id = $1`,
          [e.B.S1],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  for (const tipo of TIPOS) {
    it(`crear un producto con S2 en noDisponibleEn responde 403 y no crea nada (sesión de ${tipo}); con S1 sí, y la de B o inexistente es 422`, async () => {
      const e = await esc();
      const datos = await datosA();
      const token = (await sesiones(e.A.cajero, e.A.S1))[tipo];
      const base = { familiaId: datos.familiaId, estacionId: datos.estacionId };
      const nombre = unico('Producto con sucursales');
      await sinCambios(e, async () => {
        const productosAntes = await contarFilas(admin, 'producto', e.A.empresaId);
        const ajustesAntes = await contarFilas(admin, 'producto_sucursal', e.A.empresaId);
        for (const noDisponibleEn of [[e.A.S2], [e.A.S3!], [e.A.S1, e.A.S2]]) {
          const res = await llamar(ctx, token, {
            metodo: 'post',
            ruta: '/carta/productos',
            cuerpo: productoSimpleNuevo(base, { nombre, noDisponibleEn }),
          });
          esperarError(res, 403, 'PROHIBIDO');
        }
        expect(await contarFilas(admin, 'producto', e.A.empresaId)).toBe(productosAntes);
        expect(await contarFilas(admin, 'producto_sucursal', e.A.empresaId)).toBe(ajustesAntes);
        const porNombre = await admin.query(
          `SELECT count(*)::int AS n FROM producto WHERE empresa_id = $1 AND lower(nombre) = lower($2)`,
          [e.A.empresaId, nombre],
        );
        expect(porNombre.rows[0].n).toBe(0);
      });

      // Una sucursal de B y una inexistente siguen siendo 422, con el mismo cuerpo.
      const deB = await llamar(ctx, token, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: productoSimpleNuevo(base, { nombre, noDisponibleEn: [e.B.S1] }),
      });
      const inexistente = await llamar(ctx, token, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: productoSimpleNuevo(base, { nombre, noDisponibleEn: [randomUUID()] }),
      });
      esperarError(deB, 422, 'REFERENCIA_INVALIDA');
      esperarError(inexistente, 422, 'REFERENCIA_INVALIDA');
      expect(deB.body).toEqual(inexistente.body);

      // Con una sucursal donde sí es Cajero, el producto nace no disponible ahí y disponible en las demás.
      const propio = await llamar(ctx, token, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: productoSimpleNuevo(base, { noDisponibleEn: [e.A.S1] }),
      });
      exigirEstado(propio, 201, 'noDisponibleEn con S1');
      const ajuste = await filaProductoSucursal(admin, propio.body.id, e.A.S1);
      expect(ajuste).toMatchObject({ disponible: false });
      const enS2 = await filaProductoSucursal(admin, propio.body.id, e.A.S2);
      expect(enS2 === undefined || (enS2 as { disponible: boolean }).disponible === true).toBe(
        true,
      );
    });
  }

  it('agotados y menú del día: 403 con S1 activa donde es Cajero, sin cambios', async () => {
    const e = await esc();
    for (const tipo of TIPOS) {
      const token = (await sesiones(e.A.cajero, e.A.S1))[tipo];
      await sinCambios(e, async () => {
        // El 403 sale antes de mirar si el producto existe.
        await fallosEn(
          token,
          rutasDeClase('GESTIONAR_DISPONIBILIDAD'),
          idsAleatorios(e.A.S1),
          403,
          'PROHIBIDO',
        );
      });
    }
  });

  for (const tipo of TIPOS) {
    it(`con S2 activa (Mozo) toda ruta de EDITAR_CARTA responde 403 y no cambia nada (sesión de ${tipo})`, async () => {
      const e = await esc();
      const token = (await sesiones(e.A.cajero, e.A.S2))[tipo];
      await sinCambios(e, async () => {
        await fallosEn(
          token,
          rutasDeClase('EDITAR_CARTA'),
          idsAleatorios(e.A.S2),
          403,
          'PROHIBIDO',
        );
      });
    });

    it(`sin sucursal activa responde 409 SUCURSAL_NO_ELEGIDA en las rutas de la carta y de disponibilidad (sesión de ${tipo})`, async () => {
      const e = await esc();
      const token = (await sesiones(e.A.cajero, null))[tipo];
      const sesion = await llamar(ctx, token, { metodo: 'get', ruta: '/sesion' });
      expect(sesion.body.sucursal, 'el Cajero de dos sucursales entra sin activa').toBeNull();
      await sinCambios(e, async () => {
        await fallosEn(
          token,
          [...rutasDeClase('EDITAR_CARTA'), ...rutasDeClase('GESTIONAR_DISPONIBILIDAD')],
          idsAleatorios(e.A.S1),
          409,
          'SUCURSAL_NO_ELEGIDA',
        );
      });
    });
  }

  it('al perder el rol de Cajero en S1, la siguiente petición de la misma sesión responde 403', async () => {
    const e = await esc();
    const datos = await datosA();
    const persona = await crearPersona(ctx, e.A.tokenAdmin, [
      { sucursalId: e.A.S1, rol: 'CAJERO' },
      { sucursalId: e.A.S2, rol: 'MOZO' },
    ]);
    const token = await sesionContrasena(ctx, persona, e.A.S1);
    const crear = () =>
      llamar(ctx, token, {
        metodo: 'post',
        ruta: '/carta/familias',
        cuerpo: { nombre: unico('Familia de prueba') },
      });
    exigirEstado(await crear(), 201, 'antes de perder el rol');
    const cambio = await llamar(ctx, e.A.tokenAdmin, {
      metodo: 'patch',
      ruta: `/usuarios/${persona.id}`,
      cuerpo: {
        accesos: [
          { sucursalId: e.A.S1, rol: 'MOZO' },
          { sucursalId: e.A.S2, rol: 'MOZO' },
        ],
      },
    });
    exigirEstado(cambio, 200, 'el Administrador cambia el rol');
    const familiasAntes = await contarFilas(admin, 'familia', e.A.empresaId);
    esperarError(await crear(), 403, 'PROHIBIDO');
    expect(await contarFilas(admin, 'familia', e.A.empresaId)).toBe(familiasAntes);
    esperarError(
      await llamar(ctx, token, {
        metodo: 'put',
        ruta: `/carta/productos/${datos.productoId}/sucursales/${e.A.S1}`,
        cuerpo: { precio: '33.00', disponible: true },
      }),
      403,
      'PROHIBIDO',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 19b · Otros casos de sucursal
// ------------------------------------------------------------------------------------------------
describe('criterio 19b · otros casos de sucursal', () => {
  it('un Cajero de S1 y S2 con S1 activa ajusta las dos; si pierde el rol en S2, la siguiente petición a S2 responde 403 y S1 sigue', async () => {
    const e = await esc();
    const datos = await datosA();
    const dos = await crearPersona(ctx, e.A.tokenAdmin, [
      { sucursalId: e.A.S1, rol: 'CAJERO' },
      { sucursalId: e.A.S2, rol: 'CAJERO' },
    ]);
    for (const tipo of TIPOS) {
      const token = (await sesionesDe(ctx, dos, e.A.S1))[tipo];
      const producto = await productoDelAdmin(e, datos);
      for (const sucursalId of [e.A.S1, e.A.S2]) {
        const r = await ejecutarYAuditar(ctx, admin, e.A.empresaId, token, {
          metodo: 'put',
          ruta: `/carta/productos/${producto.id}/sucursales/${sucursalId}`,
          cuerpo: { precio: '27.50', disponible: true },
        });
        exigirEstado(r.res, 200, `el Cajero de dos sucursales ajusta ${sucursalId}`);
        expect(r.res.body.editable).toBe(true);
        unaFila(r.nuevas, {
          accion: 'ajustar_producto_sucursal',
          actorUsuarioId: dos.id,
          entidadId: producto.id,
          sucursalId,
        });
      }
    }
    // El Administrador le quita el rol en S2: el rol se lee en cada petición.
    const token = (await sesionesDe(ctx, dos, e.A.S1)).contrasena;
    const producto = await productoDelAdmin(e, datos);
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/usuarios/${dos.id}`,
        cuerpo: {
          accesos: [
            { sucursalId: e.A.S1, rol: 'CAJERO' },
            { sucursalId: e.A.S2, rol: 'MOZO' },
          ],
        },
      }),
      200,
      'el Administrador cambia el rol en S2',
    );
    const enS2 = await llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/productos/${producto.id}/sucursales/${e.A.S2}`,
      cuerpo: { precio: '30.00', disponible: false },
    });
    esperarError(enS2, 403, 'PROHIBIDO');
    expect(await filaProductoSucursal(admin, producto.id, e.A.S2)).toBeUndefined();
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'put',
        ruta: `/carta/productos/${producto.id}/sucursales/${e.A.S1}`,
        cuerpo: { precio: '30.00', disponible: false },
      }),
      200,
      'S1 sigue siendo suya',
    );
  });

  it('un Cajero en S1 y Supervisor en S2, con S1 activa, ajusta S1 y recibe 403 en S2; con S2 activa (Supervisor) toda ruta de EDITAR_CARTA responde 403', async () => {
    const e = await esc();
    const datos = await datosA();
    const mixto = await crearPersona(ctx, e.A.tokenAdmin, [
      { sucursalId: e.A.S1, rol: 'CAJERO' },
      { sucursalId: e.A.S2, rol: 'SUPERVISOR' },
    ]);
    for (const tipo of TIPOS) {
      const enS1 = (await sesionesDe(ctx, mixto, e.A.S1))[tipo];
      const producto = await productoDelAdmin(e, datos);
      exigirEstado(
        await llamar(ctx, enS1, {
          metodo: 'put',
          ruta: `/carta/productos/${producto.id}/sucursales/${e.A.S1}`,
          cuerpo: { precio: '27.50', disponible: true },
        }),
        200,
        'ajusta S1',
      );
      await sinCambios(e, async () => {
        esperarError(
          await llamar(ctx, enS1, {
            metodo: 'put',
            ruta: `/carta/productos/${producto.id}/sucursales/${e.A.S2}`,
            cuerpo: { precio: '27.50', disponible: false },
          }),
          403,
          'PROHIBIDO',
        );
      });
      const enS2 = (await sesionesDe(ctx, mixto, e.A.S2))[tipo];
      await sinCambios(e, async () => {
        expect(
          await fallosEn(
            enS2,
            rutasDeClase('EDITAR_CARTA'),
            idsDe(datos, e.A.S2),
            403,
            'PROHIBIDO',
          ),
        ).toEqual([]);
      });
    }
  });

  it('el Administrador ajusta cualquier sucursal con o sin sucursal activa y edita la carta sin sucursal activa', async () => {
    const e = await esc();
    const datos = await datosA();
    const sinActiva = await sesionContrasena(ctx, e.A.base.admin, null);
    const sesion = await llamar(ctx, sinActiva, { metodo: 'get', ruta: '/sesion' });
    expect(sesion.body.sucursal, 'el Administrador entra sin sucursal activa').toBeNull();
    const producto = await productoDelAdmin(e, datos);
    for (const sucursalId of [e.A.S1, e.A.S2, e.A.S3!]) {
      const r = await ejecutarYAuditar(ctx, admin, e.A.empresaId, sinActiva, {
        metodo: 'put',
        ruta: `/carta/productos/${producto.id}/sucursales/${sucursalId}`,
        cuerpo: { precio: '27.50', disponible: true },
      });
      exigirEstado(r.res, 200, `el Administrador ajusta ${sucursalId} sin sucursal activa`);
      expect(r.res.body.editable).toBe(true);
      unaFila(r.nuevas, {
        accion: 'ajustar_producto_sucursal',
        actorUsuarioId: e.A.base.admin.id,
        sucursalId,
      });
    }
    const lista = await llamar(ctx, sinActiva, {
      metodo: 'get',
      ruta: `/carta/productos/${producto.id}/sucursales`,
    });
    exigirEstado(lista, 200, 'ajustes por sucursal del Administrador');
    expect((lista.body as { editable: boolean }[]).every((f) => f.editable)).toBe(true);
    exigirEstado(
      await llamar(ctx, sinActiva, {
        metodo: 'post',
        ruta: '/carta/familias',
        cuerpo: { nombre: unico('Familia sin sucursal') },
      }),
      201,
      'crear familia sin sucursal activa',
    );
    exigirEstado(
      await llamar(ctx, sinActiva, {
        metodo: 'post',
        ruta: '/carta/estaciones',
        cuerpo: { nombre: unico('Estación sin sucursal') },
      }),
      201,
      'crear estación sin sucursal activa',
    );

    // Con una sucursal activa distinta también ajusta otra.
    const enS2 = await sesionContrasena(ctx, e.A.base.admin, e.A.S2);
    exigirEstado(
      await llamar(ctx, enS2, {
        metodo: 'put',
        ruta: `/carta/productos/${producto.id}/sucursales/${e.A.S1}`,
        cuerpo: { precio: '28.00', disponible: true },
      }),
      200,
      'el Administrador con S2 activa ajusta S1',
    );
  });
});
