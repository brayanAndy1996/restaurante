// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P4 (parte 2) · Trazabilidad de autor y auditoría de la carta web, los QR y los llamados (ruta crítica), criterios
// 60 y 61 (y el 1 de 002 en lo que toca a las rutas públicas, que cubre `permisos-llamados.spec.ts`):
// - 60: `llamado.atendido_por_usuario_id` / `atendido_por_equipo_id` y `cerrado_por_usuario_id` /
//   `cerrado_por_equipo_id` guardan quién lo atendió y quién lo pasó o descartó, con su equipo, en la misma
//   transacción, y `llamadoDetalle` los muestra; la creación queda trazada con el actor de sistema `carta-web`;
//   cada cambio, con la persona (trazabilidad de 002); una sesión de soporte deja esas columnas nulas y queda
//   trazada con el superadministrador;
// - 61: `configurar_carta_web`, `configurar_carta_web_sucursal`, `cambiar_logo_carta_web`, `quitar_logo_carta_web`,
//   `generar_qr_mesas` y `cambiar_qr_mesa` dejan exactamente una fila cada una, en la misma transacción, con el
//   actor, la sucursal cuando aplica y el antes y el después; ninguna en las operaciones sin cambios ni en las
//   réplicas; los llamados no dejan filas de auditoría.
// Hoy las rutas lanzan "No implementado" y las tablas no existen: las pruebas fallan por eso.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { altaEmpresa, bearer, partesDeToken } from '../acceso/fabrica-plataforma';
import { enTransaccion } from '../aislamiento/fabrica';
import { pngValido } from '../carta-critica/fabrica-permisos-carta';
import { autorDeFila, cerca } from '../salon-critica/fabrica-p3';
import { abrirCliente } from '../utilidades';
import {
  ACCIONES_AUDITADAS_005,
  arrancarAislamiento,
  asentar,
  atenderLlamado,
  auditoria005,
  auditoriaNueva005,
  clave,
  clientePublico,
  crearLlamadoOk,
  crearMundo,
  descartarLlamado,
  esperarError,
  exigirEstado,
  fotoDeLlamados,
  llamar,
  llamarAlMozo,
  mesasNuevas,
  pedidoDeLomo,
  postConClave,
  sesiones,
  unico,
  type AppP4,
  type FilaAuditoria005,
  type Mundo,
} from './fabrica-aislamiento';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP4;
let admin: Client;
let mundoPendiente: Promise<Mundo> | undefined;
const mundo = () => (mundoPendiente ??= crearMundo(ctx));

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2 });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

async function filaLlamado(id: string, empresaId: string): Promise<Record<string, any>> {
  const { rows } = await admin.query(`SELECT * FROM llamado WHERE id = $1 AND empresa_id = $2`, [
    id,
    empresaId,
  ]);
  expect(rows, `el llamado ${id}`).toHaveLength(1);
  return rows[0] as Record<string, any>;
}

/** Una mesa nueva de A con una orden abierta por `tokenMozo`, y un pedido pendiente en ella. */
async function pedidoEnMesaOcupada(m: Mundo, tokenMozo: string) {
  const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
  const abrir = await postConClave(ctx, tokenMozo, '/ordenes', {
    id: randomUUID(),
    mesaId: mesa!.id,
    comensales: 2,
  });
  exigirEstado(abrir, 201, 'abrir la mesa');
  const llamadoId = randomUUID();
  await crearLlamadoOk(
    clientePublico(ctx),
    mesa!.codigo,
    pedidoDeLomo(m.A.carta, { id: llamadoId }),
  );
  return { mesa: mesa!, ordenId: abrir.body.id as string, llamadoId };
}

// ------------------------------------------------------------------------------------------------
// 60 · Quién creó el llamado
// ------------------------------------------------------------------------------------------------
describe('criterio 60 · la creación queda trazada con el actor de sistema carta-web', () => {
  it('el llamado creado por el cliente lleva creado_por_sistema = carta-web y ninguna persona', async () => {
    const m = await mundo();
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, pedidoDeLomo(m.A.carta, { id }));
    expect(await autorDeFila(admin, 'llamado', id)).toEqual({
      usuarioId: null,
      equipoId: null,
      superadministradorId: null,
      sistema: 'carta-web',
    });
    const fila = await filaLlamado(id, m.A.empresaId);
    expect(fila.atendido_por_usuario_id).toBeNull();
    expect(fila.atendido_por_equipo_id).toBeNull();
    expect(fila.cerrado_por_usuario_id).toBeNull();
    expect(fila.cerrado_por_equipo_id).toBeNull();
  });

  it('LLAMAR_MOZO y PEDIR_CUENTA también', async () => {
    const m = await mundo();
    const [a, b] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 2);
    const cliente = clientePublico(ctx);
    for (const [mesa, cuerpo] of [
      [a!, llamarAlMozo()],
      [b!, { id: randomUUID(), tipo: 'PEDIR_CUENTA' }],
    ] as const) {
      await crearLlamadoOk(cliente, mesa.codigo, cuerpo);
      expect((await autorDeFila(admin, 'llamado', cuerpo.id)).sistema).toBe('carta-web');
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 60 · Quién atendió
// ------------------------------------------------------------------------------------------------
describe('criterio 60 · quién atendió, con su equipo', () => {
  it('con sesión de contraseña: queda el usuario y ningún equipo, con la hora del reloj de la API, y llamadoDetalle lo muestra', async () => {
    const m = await mundo();
    const s = await sesiones(ctx, m.A.mozo, m.A.S1);
    const { llamadoId, ordenId } = await pedidoEnMesaOcupada(m, s.contrasena);
    const res = await atenderLlamado(ctx, s.contrasena, llamadoId);
    const fila = await filaLlamado(llamadoId, m.A.empresaId);
    expect(fila).toMatchObject({
      estado: 'ATENDIDO',
      atendido_por_usuario_id: m.A.mozo.id,
      atendido_por_equipo_id: null,
      cerrado_por_usuario_id: null,
      cerrado_por_equipo_id: null,
      orden_id: ordenId,
    });
    expect(
      cerca(fila.atendido_en, ctx.reloj.ahora().getTime()),
      'atendido_en es la hora de la API',
    ).toBe(true);
    // Cada cambio, con la persona (trazabilidad de 002); la creación sigue siendo del sistema.
    expect(fila).toMatchObject({
      creado_por_sistema: 'carta-web',
      actualizado_por_usuario_id: m.A.mozo.id,
      actualizado_por_equipo_id: null,
      actualizado_por_sistema: null,
    });
    const detalle = res.body.llamado;
    expect(detalle.atendidoPor).toMatchObject({ id: m.A.mozo.id });
    expect(typeof detalle.atendidoPor.nombre).toBe('string');
    expect(cerca(detalle.atendidoEn, ctx.reloj.ahora().getTime())).toBe(true);
    expect(detalle.cerradoPor).toBeNull();
    // La lista y el detalle por id muestran lo mismo.
    const deNuevo = await llamar(ctx, s.contrasena, {
      metodo: 'get',
      ruta: `/llamados/${llamadoId}`,
    });
    exigirEstado(deNuevo, 200, 'el detalle');
    expect(deNuevo.body.atendidoPor).toEqual(detalle.atendidoPor);
    const lista = await llamar(ctx, s.contrasena, { metodo: 'get', ruta: '/llamados' });
    exigirEstado(lista, 200, 'la lista');
    const enLista = (lista.body.llamados as { id: string; atendidoPor: unknown }[]).find(
      (l) => l.id === llamadoId,
    );
    expect(enLista?.atendidoPor).toEqual(detalle.atendidoPor);
  });

  it('con sesión de PIN: queda también el equipo recordado de la sesión', async () => {
    const m = await mundo();
    const s = await sesiones(ctx, m.A.mozo, m.A.S1);
    const { llamadoId } = await pedidoEnMesaOcupada(m, s.contrasena);
    await atenderLlamado(ctx, s.pin, llamadoId);
    const fila = await filaLlamado(llamadoId, m.A.empresaId);
    expect(fila).toMatchObject({
      atendido_por_usuario_id: m.A.mozo.id,
      atendido_por_equipo_id: s.equipoId,
      actualizado_por_usuario_id: m.A.mozo.id,
      actualizado_por_equipo_id: s.equipoId,
    });
  });

  it('otra persona que intenta atenderlo recibe 409 LLAMADO_TOMADO con quién, y nada cambia; la misma persona otra vez, 200 sin cambiar la hora', async () => {
    const m = await mundo();
    const a = await sesiones(ctx, m.A.mozo, m.A.S1);
    const b = await sesiones(ctx, m.e.mozo2, m.A.S1);
    const { llamadoId } = await pedidoEnMesaOcupada(m, a.contrasena);
    await atenderLlamado(ctx, a.pin, llamadoId);
    const antes = await filaLlamado(llamadoId, m.A.empresaId);
    ctx.reloj.avanzar(60_000);
    const otra = await postConClave(ctx, b.pin, `/llamados/${llamadoId}/atencion`, {});
    expect(otra.status, otra.text).toBe(409);
    expect(otra.body.codigo).toBe('LLAMADO_TOMADO');
    expect(otra.body.atendidoPor).toMatchObject({ id: m.A.mozo.id });
    const repetida = await postConClave(ctx, a.pin, `/llamados/${llamadoId}/atencion`, {});
    exigirEstado(repetida, 200, 'la misma persona otra vez');
    expect(await filaLlamado(llamadoId, m.A.empresaId)).toEqual(antes);
  });
});

// ------------------------------------------------------------------------------------------------
// 60 · Quién pasó o descartó
// ------------------------------------------------------------------------------------------------
describe('criterio 60 · quién pasó a la cuenta o descartó, con su equipo', () => {
  it('descartar por otra persona con PIN: queda quien atendió y, aparte, quien cerró, cada una con su equipo', async () => {
    const m = await mundo();
    const a = await sesiones(ctx, m.A.mozo, m.A.S1);
    const b = await sesiones(ctx, m.e.mozo2, m.A.S1);
    const { llamadoId } = await pedidoEnMesaOcupada(m, a.contrasena);
    await atenderLlamado(ctx, a.pin, llamadoId);
    const res = await descartarLlamado(ctx, b.pin, llamadoId, { motivo: 'Pedido falso' });
    const fila = await filaLlamado(llamadoId, m.A.empresaId);
    expect(fila).toMatchObject({
      estado: 'DESCARTADO',
      atendido_por_usuario_id: m.A.mozo.id,
      atendido_por_equipo_id: a.equipoId,
      cerrado_por_usuario_id: m.e.mozo2.id,
      cerrado_por_equipo_id: b.equipoId,
      motivo_descarte: 'Pedido falso',
      actualizado_por_usuario_id: m.e.mozo2.id,
      actualizado_por_equipo_id: b.equipoId,
    });
    expect(cerca(fila.cerrado_en, ctx.reloj.ahora().getTime())).toBe(true);
    expect(res.body.atendidoPor).toMatchObject({ id: m.A.mozo.id });
    expect(res.body.cerradoPor).toMatchObject({ id: m.e.mozo2.id });
    expect(res.body.motivoDescarte).toBe('Pedido falso');
  });

  it('descartar un pendiente que nadie atendió: solo quien cerró, sin atendido_*', async () => {
    const m = await mundo();
    const sup = await sesiones(ctx, m.A.supervisor, m.A.S1);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, llamarAlMozo(id));
    await descartarLlamado(ctx, sup.contrasena, id, { motivo: 'Repetido' });
    const fila = await filaLlamado(id, m.A.empresaId);
    expect(fila).toMatchObject({
      estado: 'DESCARTADO',
      atendido_por_usuario_id: null,
      atendido_por_equipo_id: null,
      cerrado_por_usuario_id: m.A.supervisor.id,
      cerrado_por_equipo_id: null,
    });
    expect(fila.atendido_en).toBeNull();
  });

  it('pasar a la cuenta lo puede hacer otra persona con ATENDER_MESA (el Cajero): queda quien atendió y quien pasó', async () => {
    const m = await mundo();
    const a = await sesiones(ctx, m.A.mozo, m.A.S1);
    const caja = await sesiones(ctx, m.A.cajero, m.A.S1);
    const { llamadoId, ordenId } = await pedidoEnMesaOcupada(m, a.contrasena);
    await atenderLlamado(ctx, a.pin, llamadoId);
    const paso = await postConClave(ctx, caja.pin, `/llamados/${llamadoId}/paso-a-cuenta`, {
      lineas: [{ posicion: 0, cantidad: 2 }],
    });
    exigirEstado(paso, 200, 'pasar a la cuenta');
    const fila = await filaLlamado(llamadoId, m.A.empresaId);
    expect(fila).toMatchObject({
      estado: 'PASADO_A_CUENTA',
      atendido_por_usuario_id: m.A.mozo.id,
      atendido_por_equipo_id: a.equipoId,
      cerrado_por_usuario_id: m.A.cajero.id,
      cerrado_por_equipo_id: caja.equipoId,
      orden_id: ordenId,
      lineas_pasadas: [{ posicion: 0, cantidad: 2 }],
    });
    expect(paso.body.llamado.cerradoPor).toMatchObject({ id: m.A.cajero.id });
    expect(paso.body.llamado.atendidoPor).toMatchObject({ id: m.A.mozo.id });
    expect(paso.body.llamado.lineasPasadas).toEqual([{ posicion: 0, cantidad: 2 }]);
  });

  it('un rechazo (cerrado, vencido, transición inválida) no cambia quién ni cuándo', async () => {
    const m = await mundo();
    const a = await sesiones(ctx, m.A.mozo, m.A.S1);
    const { llamadoId } = await pedidoEnMesaOcupada(m, a.contrasena);
    await atenderLlamado(ctx, a.pin, llamadoId);
    await descartarLlamado(ctx, a.pin, llamadoId);
    const antes = await filaLlamado(llamadoId, m.A.empresaId);
    const fotoAntes = await fotoDeLlamados(admin, m.A.empresaId);
    const b = await sesiones(ctx, m.e.mozo2, m.A.S1);
    const paso = await postConClave(ctx, b.pin, `/llamados/${llamadoId}/paso-a-cuenta`, {
      lineas: [{ posicion: 0, cantidad: 1 }],
    });
    expect(paso.status, paso.text).toBe(409);
    expect(paso.body.codigo).toBe('LLAMADO_CERRADO');
    expect(paso.body.estado).toBe('DESCARTADO');
    const atencion = await postConClave(ctx, b.pin, `/llamados/${llamadoId}/atencion`, {});
    expect(atencion.status, atencion.text).toBe(409);
    expect(atencion.body.codigo).toBe('LLAMADO_CERRADO');
    expect(await filaLlamado(llamadoId, m.A.empresaId)).toEqual(antes);
    expect(await fotoDeLlamados(admin, m.A.empresaId)).toEqual(fotoAntes);
  });
});

// ------------------------------------------------------------------------------------------------
// 60 · Soporte
// ------------------------------------------------------------------------------------------------
describe('criterio 60 · una sesión de soporte queda trazada con el superadministrador', () => {
  async function abrirSoporte(m: Mundo): Promise<{ token: string; sesionId: string }> {
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${m.A.empresaId}/soporte`)
      .set(bearer(m.e.sa.token))
      .send({ motivo: unico('Soporte de llamados'), sucursalId: m.A.S1 });
    exigirEstado(res, 201, 'abrir soporte');
    const token = res.body.token as string;
    return { token, sesionId: partesDeToken(token).sesionId };
  }

  it('atender y descartar con una mesa ocupada dejan las columnas de persona nulas y al superadministrador en la fila', async () => {
    const m = await mundo();
    const mozo = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    const { token } = await abrirSoporte(m);
    const { llamadoId } = await pedidoEnMesaOcupada(m, mozo);
    const atender = await atenderLlamado(ctx, token, llamadoId);
    let fila = await filaLlamado(llamadoId, m.A.empresaId);
    expect(fila).toMatchObject({
      estado: 'ATENDIDO',
      atendido_por_usuario_id: null,
      atendido_por_equipo_id: null,
      actualizado_por_superadministrador_id: m.e.sa.id,
      actualizado_por_usuario_id: null,
      creado_por_sistema: 'carta-web',
    });
    expect(fila.atendido_en).not.toBeNull();
    expect(atender.body.llamado.atendidoPor).toBeNull();
    await descartarLlamado(ctx, token, llamadoId, { motivo: 'Soporte' });
    fila = await filaLlamado(llamadoId, m.A.empresaId);
    expect(fila).toMatchObject({
      estado: 'DESCARTADO',
      cerrado_por_usuario_id: null,
      cerrado_por_equipo_id: null,
      actualizado_por_superadministrador_id: m.e.sa.id,
    });
    expect(fila.cerrado_en).not.toBeNull();
  });

  it('con la mesa libre, soporte no puede abrirla: 422 REFERENCIA_INVALIDA y el llamado no cambia', async () => {
    const m = await mundo();
    const { token } = await abrirSoporte(m);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, pedidoDeLomo(m.A.carta, { id }));
    const antes = await filaLlamado(id, m.A.empresaId);
    const res = await postConClave(ctx, token, `/llamados/${id}/atencion`, {
      ordenId: randomUUID(),
      comensales: 2,
    });
    expect(res.status, res.text).toBe(422);
    expect(res.body.codigo).toBe('REFERENCIA_INVALIDA');
    expect(await filaLlamado(id, m.A.empresaId)).toEqual(antes);
  });
});

// ------------------------------------------------------------------------------------------------
// 61 · Auditoría de la configuración y de los QR
// ------------------------------------------------------------------------------------------------
interface EmpresaDeAuditoria {
  empresaId: string;
  token: string;
  adminId: string;
  S1: string;
  S2: string;
  mesa1: { id: string; nombre: string };
  mesa2: { id: string; nombre: string };
  zonaId: string;
}

let empresaCPendiente: Promise<EmpresaDeAuditoria> | undefined;
/** Una empresa aparte, con dos sucursales, una zona y dos mesas, y sin carta web (para ver su creación). */
const empresaC = (): Promise<EmpresaDeAuditoria> =>
  (empresaCPendiente ??= (async () => {
    const m = await mundo();
    const base = await altaEmpresa(ctx, m.e.sa);
    const token = base.admin.token;
    const [S1, S2] = base.sucursales.map((s) => s.id) as [string, string];
    const zona = await llamar(ctx, token, {
      metodo: 'post',
      ruta: `/sucursales/${S1}/zonas`,
      cuerpo: { nombre: 'Salón C', columnas: 6, filas: 6 },
    });
    exigirEstado(zona, 201, 'crear la zona');
    const mesa = async (nombre: string, columna: number) => {
      const res = await llamar(ctx, token, {
        metodo: 'post',
        ruta: `/sucursales/${S1}/zonas/${zona.body.id as string}/mesas`,
        cuerpo: { nombre, capacidad: 4, forma: 'CUADRADA', columna, fila: 1 },
      });
      exigirEstado(res, 201, `crear la mesa ${nombre}`);
      return { id: res.body.id as string, nombre };
    };
    return {
      empresaId: base.empresaId,
      token,
      adminId: base.admin.id,
      S1,
      S2,
      mesa1: await mesa('C1', 1),
      mesa2: await mesa('C2', 2),
      zonaId: zona.body.id as string,
    };
  })());

const texto = (fila: FilaAuditoria005): string => JSON.stringify(fila.detalle ?? {});

/** La empresa C con su carta web configurada (sin mirar la auditoría de esa configuración). */
async function conCartaWeb(c: EmpresaDeAuditoria): Promise<void> {
  const actual = await llamar(ctx, c.token, { metodo: 'get', ruta: '/carta-web' });
  exigirEstado(actual, 200, 'la carta web de C');
  if (actual.body.configurada === true) return;
  exigirEstado(
    await llamar(ctx, c.token, {
      metodo: 'put',
      ruta: '/carta-web',
      cuerpo: {
        nombre: 'Empresa C',
        slug: `audit-${randomUUID().slice(0, 8)}`,
        colorPrincipal: '#1D4A9E',
      },
    }),
    200,
    'configurar la carta web de C',
  );
}

describe('criterio 61 · configurar_carta_web', () => {
  it('crear la configuración deja una fila con el actor y el después; cambiarla, otra con el antes y el después; repetirla igual, ninguna', async () => {
    const c = await empresaC();
    const slug1 = `audit-${randomUUID().slice(0, 8)}`;
    const slug2 = `audit-${randomUUID().slice(0, 8)}`;
    const put = (cuerpo: object) =>
      llamar(ctx, c.token, { metodo: 'put', ruta: '/carta-web', cuerpo });
    const sesionId = partesDeToken(c.token).sesionId;

    let antes = await auditoria005(admin, c.empresaId);
    exigirEstado(
      await put({ nombre: 'Primer nombre', slug: slug1, colorPrincipal: '#aabbcc' }),
      200,
      'crear la configuración',
    );
    const creada = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(creada.map((f) => f.accion)).toEqual(['configurar_carta_web']);
    expect(creada[0]).toMatchObject({
      actor_usuario_id: c.adminId,
      actor_superadministrador_id: null,
      sesion_id: sesionId,
      sucursal_id: null,
      entidad: 'carta_web',
    });
    expect(texto(creada[0]!)).toContain('Primer nombre');
    expect(texto(creada[0]!)).toContain(slug1);
    expect(texto(creada[0]!)).toContain('AABBCC');

    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(
      await put({ nombre: 'Segundo nombre', slug: slug2, colorPrincipal: '#AABBCC' }),
      200,
      'cambiar la configuración',
    );
    const cambiada = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(cambiada.map((f) => f.accion)).toEqual(['configurar_carta_web']);
    for (const dato of ['Primer nombre', 'Segundo nombre', slug1, slug2]) {
      expect(texto(cambiada[0]!), `el antes y el después traen ${dato}`).toContain(dato);
    }

    // Sin cambios (el color en minúsculas es el mismo guardado en mayúsculas): 200 sin fila.
    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(
      await put({ nombre: 'Segundo nombre', slug: slug2, colorPrincipal: '#aabbcc' }),
      200,
      'repetir la configuración',
    );
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);

    // Un rechazo (dirección fuera de forma o reservada) tampoco deja fila.
    for (const mala of [
      { nombre: 'X', slug: 'Mal Slug', colorPrincipal: '#AABBCC' },
      { nombre: 'X', slug: 'api', colorPrincipal: '#AABBCC' },
    ]) {
      expect((await put(mala)).status).toBe(400);
    }
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);
  });
});

describe('criterio 61 · cambiar_logo_carta_web y quitar_logo_carta_web', () => {
  it('subir, cambiar y quitar el logo dejan una fila cada vez; quitarlo sin logo, ninguna; sin configuración, 409 sin fila', async () => {
    const m = await mundo();
    const c = await empresaC();
    await conCartaWeb(c);
    const sesionId = partesDeToken(c.token).sesionId;
    const subir = (ancho: number) =>
      llamar(ctx, c.token, {
        metodo: 'put',
        ruta: '/carta-web/logo',
        binario: { tipo: 'image/png', datos: pngValido(ancho, ancho) },
      });

    let antes = await auditoria005(admin, c.empresaId);
    exigirEstado(await subir(200), 200, 'subir el logo');
    let nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['cambiar_logo_carta_web']);
    expect(nuevas[0]).toMatchObject({
      actor_usuario_id: c.adminId,
      sesion_id: sesionId,
      entidad: 'carta_web',
    });

    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(await subir(300), 200, 'cambiar el logo');
    nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['cambiar_logo_carta_web']);

    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(
      await llamar(ctx, c.token, { metodo: 'delete', ruta: '/carta-web/logo' }),
      204,
      'quitar el logo',
    );
    nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['quitar_logo_carta_web']);

    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(
      await llamar(ctx, c.token, { metodo: 'delete', ruta: '/carta-web/logo' }),
      204,
      'quitar el logo otra vez',
    );
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);

    // Una empresa sin configuración de carta web: 409 sin fila.
    const d = await altaEmpresa(ctx, m.e.sa);
    const antesD = await auditoria005(admin, d.empresaId);
    const res = await llamar(ctx, d.admin.token, {
      metodo: 'put',
      ruta: '/carta-web/logo',
      binario: { tipo: 'image/png', datos: pngValido(200, 200) },
    });
    esperarError(res, 409, 'CARTA_WEB_SIN_CONFIGURAR');
    expect(await auditoriaNueva005(admin, d.empresaId, antesD)).toEqual([]);
  });
});

describe('criterio 61 · configurar_carta_web_sucursal', () => {
  it('publicar y cambiar la dirección dejan una fila con la sucursal, el antes y el después; repetir lo mismo o fallar, ninguna', async () => {
    const c = await empresaC();
    await conCartaWeb(c);
    const put = (sucursalId: string, cuerpo: object) =>
      llamar(ctx, c.token, { metodo: 'put', ruta: `/carta-web/sucursales/${sucursalId}`, cuerpo });
    const sesionId = partesDeToken(c.token).sesionId;

    let antes = await auditoria005(admin, c.empresaId);
    exigirEstado(await put(c.S1, { slug: 'centro', publicada: false }), 200, 'configurar S1');
    let nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['configurar_carta_web_sucursal']);
    expect(nuevas[0]).toMatchObject({
      sucursal_id: c.S1,
      actor_usuario_id: c.adminId,
      sesion_id: sesionId,
      entidad: 'carta_web_sucursal',
    });
    expect(texto(nuevas[0]!)).toContain('centro');

    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(await put(c.S1, { slug: 'centro-sur', publicada: true }), 200, 'publicar S1');
    nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['configurar_carta_web_sucursal']);
    for (const dato of ['centro', 'centro-sur']) expect(texto(nuevas[0]!)).toContain(dato);
    expect(nuevas[0]!.sucursal_id).toBe(c.S1);

    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(await put(c.S1, { slug: 'centro-sur', publicada: true }), 200, 'repetir');
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);

    // Un rechazo (dirección repetida en la empresa, forma inválida) tampoco deja fila.
    expect((await put(c.S2, { slug: 'centro-sur', publicada: true })).status).toBe(409);
    expect((await put(c.S2, { slug: 'Mal Slug', publicada: true })).status).toBe(400);
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);

    // La otra sucursal, con su propia fila y su propia sucursal.
    exigirEstado(await put(c.S2, { slug: 'norte', publicada: true }), 200, 'configurar S2');
    nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => [f.accion, f.sucursal_id])).toEqual([
      ['configurar_carta_web_sucursal', c.S2],
    ]);
  });
});

describe('criterio 61 · generar_qr_mesas', () => {
  it('no deja fila si no creó ninguno; con una mesa sin código deja una con la cantidad; repetirlo no deja otra ni cambia ningún código', async () => {
    const c = await empresaC();
    const post = () =>
      llamar(ctx, c.token, { metodo: 'post', ruta: `/sucursales/${c.S1}/qr-mesas` });
    const codigos = async () =>
      (
        await admin.query<{ mesa_id: string; codigo: string }>(
          `SELECT mesa_id, codigo FROM mesa_qr WHERE empresa_id = $1 ORDER BY mesa_id`,
          [c.empresaId],
        )
      ).rows;

    // Todas las mesas se crearon con su código: no hay nada que generar.
    let antes = await auditoria005(admin, c.empresaId);
    const sinNada = await post();
    exigirEstado(sinNada, 200, 'generar sin faltantes');
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);

    // Una mesa creada antes de la sección (sin código): se inserta por SQL como administrador de la base.
    const idMesaNueva = randomUUID();
    await enTransaccion(
      admin,
      null,
      async () => {
        await admin.query(
          `INSERT INTO mesa
             SELECT (jsonb_populate_record(NULL::mesa, to_jsonb(x) || $1::jsonb)).*
               FROM mesa x WHERE x.id = $2`,
          [JSON.stringify({ id: idMesaNueva, nombre: 'C3', columna: 3, fila: 1 }), c.mesa1.id],
        );
      },
      { confirmar: true },
    );
    const codigosAntes = await codigos();
    antes = await auditoria005(admin, c.empresaId);
    const creado = await post();
    exigirEstado(creado, 200, 'generar el faltante');
    const nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['generar_qr_mesas']);
    expect(nuevas[0]).toMatchObject({
      sucursal_id: c.S1,
      actor_usuario_id: c.adminId,
      entidad: 'mesa_qr',
    });
    expect(texto(nuevas[0]!)).toMatch(/\b1\b/);
    const despues = await codigos();
    expect(despues).toHaveLength(codigosAntes.length + 1);
    for (const previo of codigosAntes) expect(despues).toContainEqual(previo);

    // Repetirlo: ni fila ni cambios.
    antes = await auditoria005(admin, c.empresaId);
    exigirEstado(await post(), 200, 'repetir');
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);
    expect(await codigos()).toEqual(despues);
  });
});

describe('criterio 61 · cambiar_qr_mesa', () => {
  it('cambiar el QR deja una fila con la mesa y su nombre, sin los códigos; la réplica no deja otra; otra clave, otra fila', async () => {
    const c = await empresaC();
    const sesionId = partesDeToken(c.token).sesionId;
    const cambiar = (sucursal: string, mesaId: string, k: string) =>
      llamar(ctx, c.token, {
        metodo: 'post',
        ruta: `/sucursales/${sucursal}/mesas/${mesaId}/qr`,
        cabeceras: { 'Idempotency-Key': k },
      });
    const codigoActual = async (mesaId: string): Promise<string> =>
      (
        await admin.query<{ codigo: string }>(`SELECT codigo FROM mesa_qr WHERE mesa_id = $1`, [
          mesaId,
        ])
      ).rows[0]!.codigo;

    const viejo = await codigoActual(c.mesa1.id);
    const k1 = randomUUID();
    let antes = await auditoria005(admin, c.empresaId);
    const primera = await cambiar(c.S1, c.mesa1.id, k1);
    exigirEstado(primera, 201, 'cambiar el QR');
    const nuevo = primera.body.codigo as string;
    expect(nuevo).not.toBe(viejo);
    let nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['cambiar_qr_mesa']);
    expect(nuevas[0]).toMatchObject({
      sucursal_id: c.S1,
      actor_usuario_id: c.adminId,
      sesion_id: sesionId,
    });
    const fila = JSON.stringify(nuevas[0]);
    expect(fila).toContain(c.mesa1.id);
    expect(fila).toContain(c.mesa1.nombre);
    expect(fila, 'la auditoría no guarda el código anterior').not.toContain(viejo);
    expect(fila, 'la auditoría no guarda el código nuevo').not.toContain(nuevo);

    // La misma clave: la misma respuesta y ninguna fila.
    antes = await auditoria005(admin, c.empresaId);
    const replica = await cambiar(c.S1, c.mesa1.id, k1);
    exigirEstado(replica, 201, 'la réplica');
    expect(replica.body).toEqual(primera.body);
    expect(await codigoActual(c.mesa1.id)).toBe(nuevo);
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);

    // Otra clave: otro código y otra fila.
    const segunda = await cambiar(c.S1, c.mesa1.id, randomUUID());
    exigirEstado(segunda, 201, 'otra clave');
    expect(segunda.body.codigo).not.toBe(nuevo);
    nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['cambiar_qr_mesa']);
  });

  it('una mesa inactiva (409), una mesa de otra sucursal (404) y sin clave (400) no dejan fila ni cambian el código', async () => {
    const c = await empresaC();
    const codigoActual = async (mesaId: string): Promise<string> =>
      (
        await admin.query<{ codigo: string }>(`SELECT codigo FROM mesa_qr WHERE mesa_id = $1`, [
          mesaId,
        ])
      ).rows[0]!.codigo;
    const antesCodigo = await codigoActual(c.mesa2.id);
    exigirEstado(
      await llamar(ctx, c.token, {
        metodo: 'patch',
        ruta: `/sucursales/${c.S1}/mesas/${c.mesa2.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la mesa',
    );
    const antes = await auditoria005(admin, c.empresaId);
    const inactiva = await llamar(ctx, c.token, {
      metodo: 'post',
      ruta: `/sucursales/${c.S1}/mesas/${c.mesa2.id}/qr`,
      cabeceras: clave(),
    });
    expect(inactiva.status, inactiva.text).toBe(409);
    expect(inactiva.body.codigo).toBe('CONFLICTO');
    const deOtraSucursal = await llamar(ctx, c.token, {
      metodo: 'post',
      ruta: `/sucursales/${c.S2}/mesas/${c.mesa1.id}/qr`,
      cabeceras: clave(),
    });
    expect(deOtraSucursal.status, deOtraSucursal.text).toBe(404);
    const sinClave = await llamar(ctx, c.token, {
      metodo: 'post',
      ruta: `/sucursales/${c.S1}/mesas/${c.mesa1.id}/qr`,
    });
    expect(sinClave.status, sinClave.text).toBe(400);
    expect(await codigoActual(c.mesa2.id)).toBe(antesCodigo);
    expect(await auditoriaNueva005(admin, c.empresaId, antes)).toEqual([]);
    exigirEstado(
      await llamar(ctx, c.token, {
        metodo: 'patch',
        ruta: `/sucursales/${c.S1}/mesas/${c.mesa2.id}`,
        cuerpo: { activa: true },
      }),
      200,
      'reactivar la mesa',
    );
  });

  it('una sesión de soporte deja la fila con el superadministrador', async () => {
    const m = await mundo();
    const c = await empresaC();
    const abrir = await ctx
      .http()
      .post(`/plataforma/empresas/${c.empresaId}/soporte`)
      .set(bearer(m.e.sa.token))
      .send({ motivo: unico('Soporte de QR'), sucursalId: c.S1 });
    exigirEstado(abrir, 201, 'abrir soporte');
    const token = abrir.body.token as string;
    const antes = await auditoria005(admin, c.empresaId);
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'post',
        ruta: `/sucursales/${c.S1}/mesas/${c.mesa1.id}/qr`,
        cabeceras: clave(),
      }),
      201,
      'cambiar el QR como soporte',
    );
    const nuevas = await auditoriaNueva005(admin, c.empresaId, antes);
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]).toMatchObject({
      accion: 'cambiar_qr_mesa',
      actor_superadministrador_id: m.e.sa.id,
      actor_usuario_id: null,
      sesion_id: partesDeToken(token).sesionId,
    });
  });
});

describe('criterio 61 · los llamados no dejan filas de auditoría', () => {
  it('crear, atender, pasar a la cuenta, descartar y la réplica no agregan ninguna fila de auditoría de llamados', async () => {
    const m = await mundo();
    const a = await sesiones(ctx, m.A.mozo, m.A.S1);
    const b = await sesiones(ctx, m.e.mozo2, m.A.S1);
    const filasDeLlamados = async () =>
      (
        await admin.query(
          `SELECT id, accion, entidad FROM auditoria
            WHERE empresa_id = $1
              AND (entidad = 'llamado' OR accion ~* 'llamado' OR accion ~* 'paso|descarte|atencion')
            ORDER BY id`,
          [m.A.empresaId],
        )
      ).rows;
    const todas005 = () => auditoria005(admin, m.A.empresaId);
    const antes = await filasDeLlamados();
    const antes005 = await todas005();
    const { llamadoId } = await pedidoEnMesaOcupada(m, a.contrasena);
    await atenderLlamado(ctx, a.pin, llamadoId);
    const paso = await postConClave(ctx, a.pin, `/llamados/${llamadoId}/paso-a-cuenta`, {
      lineas: [{ posicion: 0, cantidad: 1 }],
    });
    exigirEstado(paso, 200, 'pasar a la cuenta');
    // La réplica del descarte con la misma clave.
    const otro = await pedidoEnMesaOcupada(m, b.contrasena);
    const claveDescarte = randomUUID();
    const descarte = () =>
      llamar(ctx, b.pin, {
        metodo: 'post',
        ruta: `/llamados/${otro.llamadoId}/descarte`,
        cuerpo: { motivo: 'Repetido' },
        cabeceras: { 'Idempotency-Key': claveDescarte },
      });
    exigirEstado(await descarte(), 200, 'descartar');
    exigirEstado(await descarte(), 200, 'la réplica del descarte');
    const [pendiente] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const id = randomUUID();
    const cliente = clientePublico(ctx);
    await crearLlamadoOk(cliente, pendiente!.codigo, llamarAlMozo(id));
    await crearLlamadoOk(cliente, pendiente!.codigo, llamarAlMozo(id), 'la réplica de la creación');
    await asentar();
    expect(await filasDeLlamados()).toEqual(antes);
    expect(await todas005()).toEqual(antes005);
    // Y el conjunto de acciones de la sección sigue siendo el de la tabla "Acciones auditadas".
    const acciones = new Set((await todas005()).map((f) => f.accion));
    for (const accion of acciones)
      expect(ACCIONES_AUDITADAS_005 as readonly string[]).toContain(accion);
  });
});
