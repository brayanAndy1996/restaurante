// spec: 003-carta (pruebas protegidas)
//
// P2 (parte 1) · Permisos y auditoría de la carta (ruta crítica), criterios 2b, 38, 42, 43, 60, 61 y 62:
// - 60: la matriz con la fila `EDITAR_CARTA` cambiada para el Cajero y la clasificación de TODAS las rutas
//   de `/carta` que Nest tiene registradas (cuatro clases cerradas; falla si una ruta no está clasificada o
//   tiene otra acción);
// - 61 y 2b: cada rol sin el permiso (Mozo, Cocina/Barra y Supervisor en `EDITAR_CARTA`; Mozo, Cajero,
//   Cocina/Barra y Supervisor en `ADMINISTRAR`; Mozo y Cajero en `GESTIONAR_DISPONIBILIDAD`), con sesión de
//   contraseña y de PIN, recibe 403 `PROHIBIDO` en cada ruta, sin cambiar filas, sin auditoría, sin archivos
//   y sin eventos;
// - 38, 42 y 43: Cocina/Barra, Supervisor y Administrador marcan agotados y arman el menú del día en su
//   sucursal activa (sin ella, 409; con otro rol en la sucursal activa, 403); `GET /carta/sucursal` sirve a
//   todos los roles con sucursal activa;
// - 61 (soporte) y 62: una fila de auditoría por escritura con el antes y el después exactos de cada
//   cambio de precio, el autor correcto y ninguna en las escrituras que no cambian nada.
// El Cajero (criterios 19b y 61b) está en `cajero-carta.spec.ts`. Hoy las rutas no tienen `@Permiso` y no
// existen las tablas: las pruebas fallan por eso (500 en lugar de 403 y 2xx, tablas inexistentes).
import { randomUUID } from 'node:crypto';
import { requisitoPermiso, type Rol } from '@restaurante/dominio';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PERMISO,
  REQUIERE_MODULO,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from '../../src/modulos/seguridad';
import { abrirCliente, rutasDeNest } from '../utilidades';
import { partesDeToken } from '../acceso/fabrica-plataforma';
import {
  arrancarCarta,
  auditoriaCarta,
  crearEscenarioCarta,
  crearPersona,
  ejecutarYAuditar,
  asentar,
  esperarError,
  exigirEstado,
  exigirSinFallos,
  idsAleatorios,
  idsDe,
  instantaneaCarta,
  llamar,
  pngValido,
  productoSimpleNuevo,
  RUTAS_CARTA,
  rutasDeClase,
  sembrarCarta,
  sesionContrasena,
  sesionesDe,
  unaFila,
  unico,
  type AppCarta,
  type ClaseDePermiso,
  type DatosCarta,
  type EscenarioCarta,
  type PersonaCarta,
  type SesionesDe,
} from './fabrica-permisos-carta';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

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
const datosA = async () =>
  (datosPendientes ??= esc().then((e) => sembrarCarta(ctx, e.A.tokenAdmin)));

const sesionesMemo = new Map<string, Promise<SesionesDe>>();
/** Una sesión de contraseña y una de PIN de la persona con esa sucursal activa (se abren una sola vez). */
function sesiones(persona: PersonaCarta, sucursalId: string | null): Promise<SesionesDe> {
  const clave = `${persona.id}:${sucursalId}`;
  let p = sesionesMemo.get(clave);
  if (!p) {
    p = sesionesDe(ctx, persona, sucursalId);
    sesionesMemo.set(clave, p);
  }
  return p;
}

const TIPOS_DE_SESION = ['contrasena', 'pin'] as const;

// ------------------------------------------------------------------------------------------------
// 60 · La matriz y la clasificación de las rutas
// ------------------------------------------------------------------------------------------------
describe('criterio 60 · matriz de permisos con la fila de la carta', () => {
  const ROLES: Rol[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'];

  it('EDITAR_CARTA: solo el Cajero y el Administrador; ADMINISTRAR y GESTIONAR_DISPONIBILIDAD no cambian', () => {
    const fila = (accion: Parameters<typeof requisitoPermiso>[1]) =>
      ROLES.map((rol) => requisitoPermiso(rol, accion));
    expect(fila('EDITAR_CARTA')).toEqual([
      'prohibido',
      'permitido',
      'prohibido',
      'prohibido',
      'permitido',
    ]);
    expect(fila('ADMINISTRAR')).toEqual([
      'prohibido',
      'prohibido',
      'prohibido',
      'prohibido',
      'permitido',
    ]);
    expect(fila('GESTIONAR_DISPONIBILIDAD')).toEqual([
      'prohibido',
      'prohibido',
      'permitido',
      'permitido',
      'permitido',
    ]);
  });

  it.each(TIPOS_DE_SESION)(
    'GET /sesion del Cajero con S1 activa trae EDITAR_CARTA permitido y no ADMINISTRAR ni disponibilidad (sesión de %s)',
    async (tipo) => {
      const { A } = await esc();
      const s = await sesiones(A.cajero, A.S1);
      const res = await llamar(ctx, s[tipo], { metodo: 'get', ruta: '/sesion' });
      exigirEstado(res, 200, 'GET /sesion del Cajero');
      expect(res.body.permisos).toMatchObject({
        EDITAR_CARTA: 'permitido',
        ADMINISTRAR: 'prohibido',
        GESTIONAR_DISPONIBILIDAD: 'prohibido',
      });
    },
  );
});

describe('criterio 60 · toda ruta de /carta tiene @Permiso, en cuatro clases cerradas', () => {
  /** `:id`, `:sucursalId` y `:productoId` valen lo mismo para esta comparación. */
  const normal = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, ':p');

  it('las rutas registradas son exactamente las 25 de la tabla de endpoints y cada una tiene su acción', async () => {
    await esc(); // la aplicación ya está arriba
    const registradas = rutasDeNest(ctx.app).filter(
      (r) => r.ruta === '/carta' || r.ruta.startsWith('/carta/'),
    );
    const esperadas = new Map(RUTAS_CARTA.map((r) => [normal(r.clave), r.clase]));
    const problemas: string[] = [];
    const vistas = new Set<string>();
    for (const r of registradas) {
      const clave = `${r.metodo} ${normal(r.ruta)}`;
      vistas.add(clave);
      const manejador = r.controlador.prototype[r.manejador] as object;
      const accion =
        (Reflect.getMetadata(PERMISO, manejador) as string | undefined) ??
        (Reflect.getMetadata(PERMISO, r.controlador) as string | undefined) ??
        'NINGUNA';
      const clase = esperadas.get(clave);
      if (clase === undefined) {
        problemas.push(`${clave}: ruta sin clasificar (tiene ${accion})`);
        continue;
      }
      if (accion !== clase) problemas.push(`${clave}: debería ser ${clase} y es ${accion}`);
      // Las que dependen de la sucursal activa la exigen (criterios 38, 43 y 47).
      const exigeSucursal =
        (Reflect.getMetadata(REQUIERE_SUCURSAL, manejador) as boolean | undefined) ??
        (Reflect.getMetadata(REQUIERE_SUCURSAL, r.controlador) as boolean | undefined) ??
        false;
      if (
        (clase === 'GESTIONAR_DISPONIBILIDAD' || clave === 'GET /carta/sucursal') &&
        !exigeSucursal
      ) {
        problemas.push(`${clave}: falta @RequiereSucursal()`);
      }
      // La carta no depende de un módulo del plan ni usa @SoloAdministrador (criterio 61).
      if (
        Reflect.getMetadata(REQUIERE_MODULO, manejador) !== undefined ||
        Reflect.getMetadata(REQUIERE_MODULO, r.controlador) !== undefined
      ) {
        problemas.push(`${clave}: no debe llevar @RequiereModulo`);
      }
      if (
        Reflect.getMetadata(SOLO_ADMINISTRADOR, manejador) === true ||
        Reflect.getMetadata(SOLO_ADMINISTRADOR, r.controlador) === true
      ) {
        problemas.push(`${clave}: debe usar @Permiso, no @SoloAdministrador`);
      }
    }
    for (const clave of esperadas.keys()) {
      if (!vistas.has(clave)) problemas.push(`${clave}: falta la ruta`);
    }
    expect(registradas.length).toBeGreaterThan(0);
    exigirSinFallos(problemas);
  });
});

// ------------------------------------------------------------------------------------------------
// 61 y 2b · Rechazos por rol
// ------------------------------------------------------------------------------------------------
type Caso = {
  rol: string;
  persona: (e: EscenarioCarta) => PersonaCarta;
  sinPermiso: ClaseDePermiso[];
};
const CASOS_DE_ROL: Caso[] = [
  {
    rol: 'Mozo',
    persona: (e) => e.A.mozo,
    sinPermiso: ['EDITAR_CARTA', 'ADMINISTRAR', 'GESTIONAR_DISPONIBILIDAD'],
  },
  {
    rol: 'Cocina/Barra',
    persona: (e) => e.A.cocina,
    sinPermiso: ['EDITAR_CARTA', 'ADMINISTRAR'],
  },
  {
    rol: 'Supervisor',
    persona: (e) => e.A.supervisor,
    sinPermiso: ['EDITAR_CARTA', 'ADMINISTRAR'],
  },
  {
    rol: 'Cajero',
    persona: (e) => e.A.cajero,
    sinPermiso: ['ADMINISTRAR', 'GESTIONAR_DISPONIBILIDAD'],
  },
];

describe('criterios 61 y 2b · cada rol sin el permiso recibe 403 PROHIBIDO (ids cualquiera)', () => {
  for (const caso of CASOS_DE_ROL) {
    for (const tipo of TIPOS_DE_SESION) {
      it(`${caso.rol} con sesión de ${tipo}: 403 en las rutas ${caso.sinPermiso.join(', ')}`, async () => {
        const e = await esc();
        const s = await sesiones(caso.persona(e), e.A.S1);
        const fallos: string[] = [];
        for (const ruta of RUTAS_CARTA.filter((r) => caso.sinPermiso.includes(r.clase))) {
          // El 403 sale antes de mirar si el producto existe: los ids son cualquiera.
          const res = await llamar(ctx, s[tipo], ruta.construir(idsAleatorios(e.A.S2)));
          const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
          if (res.status !== 403 || codigo !== 'PROHIBIDO') {
            fallos.push(`${ruta.clave}: se esperaba 403 PROHIBIDO y fue ${res.status} ${codigo}`);
          }
        }
        exigirSinFallos(fallos);
      });
    }
  }
});

describe('criterios 61 y 2b · los rechazos no cambian nada (con la carta sembrada)', () => {
  for (const caso of CASOS_DE_ROL) {
    for (const tipo of TIPOS_DE_SESION) {
      it(`${caso.rol} con sesión de ${tipo}: ninguna fila, auditoría, archivo ni evento cambia`, async () => {
        const e = await esc();
        const datos = await datosA();
        const s = await sesiones(caso.persona(e), e.A.S1);
        const ids = idsDe(datos, e.A.S2);
        await asentar();
        ctx.publicador.limpiar();
        const antes = await instantaneaCarta(admin, e.A.empresaId);
        const auditoriaAntes = await auditoriaCarta(admin, e.A.empresaId);
        const clavesAntes = ctx.almacen.claves();
        const fallos: string[] = [];
        for (const ruta of RUTAS_CARTA.filter((r) => caso.sinPermiso.includes(r.clase))) {
          const res = await llamar(ctx, s[tipo], ruta.construir(ids));
          const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
          if (res.status !== 403 || codigo !== 'PROHIBIDO') {
            fallos.push(`${ruta.clave}: se esperaba 403 PROHIBIDO y fue ${res.status} ${codigo}`);
          }
        }
        exigirSinFallos(fallos);
        expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
        expect(await auditoriaCarta(admin, e.A.empresaId)).toEqual(auditoriaAntes);
        expect(ctx.almacen.claves()).toEqual(clavesAntes);
        await asentar();
        expect(ctx.publicador.eventos()).toEqual([]);
      });
    }
  }

  it('el 403 no deja ver detalles de la base y tiene la forma { codigo, mensaje }', async () => {
    const e = await esc();
    const s = await sesiones(e.A.mozo, e.A.S1);
    const res = await llamar(ctx, s.contrasena, {
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimpleNuevo({ familiaId: randomUUID(), estacionId: randomUUID() }),
    });
    esperarError(res, 403, 'PROHIBIDO');
  });
});

// ------------------------------------------------------------------------------------------------
// 38, 42 y 43 · Disponibilidad: agotados y menú del día
// ------------------------------------------------------------------------------------------------
describe('criterios 38, 42 y 43 · quién marca agotados y arma el menú del día', () => {
  for (const tipo of TIPOS_DE_SESION) {
    for (const [rol, persona] of [
      ['Cocina/Barra', (e: EscenarioCarta) => e.A.cocina],
      ['Supervisor', (e: EscenarioCarta) => e.A.supervisor],
    ] as const) {
      it(`${rol} con sesión de ${tipo}: marca, reactiva y arma el menú en su sucursal activa, con su auditoría`, async () => {
        const e = await esc();
        const datos = await datosA();
        const p = persona(e);
        const token = (await sesiones(p, e.A.S1))[tipo];
        const fijar = { actorUsuarioId: p.id, entidad: 'producto', sucursalId: e.A.S1 };

        const marcar = await ejecutarYAuditar(ctx, admin, e.A.empresaId, token, {
          metodo: 'put',
          ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
          cuerpo: { hasta: 'FIN_DEL_DIA' },
        });
        exigirEstado(marcar.res, 200, 'marcar agotado');
        expect(marcar.res.body).toMatchObject({
          productoId: datos.ligadoId,
          sucursalId: e.A.S1,
          hasta: 'FIN_DEL_DIA',
          origen: 'MANUAL',
        });
        unaFila(marcar.nuevas, { accion: 'marcar_agotado', entidadId: datos.ligadoId, ...fijar });

        const reactivar = await ejecutarYAuditar(ctx, admin, e.A.empresaId, token, {
          metodo: 'delete',
          ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
        });
        exigirEstado(reactivar.res, 204, 'reactivar agotado');
        unaFila(reactivar.nuevas, {
          accion: 'reactivar_agotado',
          entidadId: datos.ligadoId,
          ...fijar,
        });

        const armar = await ejecutarYAuditar(ctx, admin, e.A.empresaId, token, {
          metodo: 'put',
          ruta: `/carta/sucursal/menu-del-dia/${datos.menuId}`,
          cuerpo: { opciones: [datos.opcionesMenuIds[0]] },
        });
        exigirEstado(armar.res, 200, 'armar el menú del día');
        expect(armar.res.body).toMatchObject({ productoId: datos.menuId });
        unaFila(armar.nuevas, { accion: 'armar_menu_del_dia', entidadId: datos.menuId, ...fijar });
        // Vuelve a dejarlo sin opciones para no condicionar otras pruebas.
        exigirEstado(
          await llamar(ctx, token, {
            metodo: 'put',
            ruta: `/carta/sucursal/menu-del-dia/${datos.menuId}`,
            cuerpo: { opciones: [] },
          }),
          200,
          'vaciar el menú del día',
        );

        const leer = await llamar(ctx, token, {
          metodo: 'get',
          ruta: '/carta/sucursal/menu-del-dia',
        });
        exigirEstado(leer, 200, 'GET menu-del-dia');
        expect(Array.isArray(leer.body)).toBe(true);
        expect((leer.body as { productoId: string }[]).map((m) => m.productoId)).toContain(
          datos.menuId,
        );
      });
    }
  }

  it('el Administrador con una sucursal activa marca agotados y arma el menú; sin sucursal activa recibe 409 SUCURSAL_NO_ELEGIDA', async () => {
    const e = await esc();
    const datos = await datosA();
    const conSucursal = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
    const marcar = await ejecutarYAuditar(ctx, admin, e.A.empresaId, conSucursal, {
      metodo: 'put',
      ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
      cuerpo: {},
    });
    exigirEstado(marcar.res, 200, 'el Administrador marca un agotado');
    expect(marcar.res.body).toMatchObject({ sucursalId: e.A.S1, hasta: 'FIN_DEL_DIA' });
    unaFila(marcar.nuevas, {
      accion: 'marcar_agotado',
      actorUsuarioId: e.A.base.admin.id,
      sucursalId: e.A.S1,
    });
    exigirEstado(
      await llamar(ctx, conSucursal, {
        metodo: 'delete',
        ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
      }),
      204,
      'el Administrador reactiva',
    );

    const sinSucursal = await sesionContrasena(ctx, e.A.base.admin, null);
    const sesion = await llamar(ctx, sinSucursal, { metodo: 'get', ruta: '/sesion' });
    expect(sesion.body.sucursal, 'el Administrador entra sin sucursal activa').toBeNull();
    for (const ruta of rutasDeClase('GESTIONAR_DISPONIBILIDAD')) {
      const res = await llamar(ctx, sinSucursal, ruta.construir(idsDe(datos, e.A.S1)));
      esperarError(res, 409, 'SUCURSAL_NO_ELEGIDA');
    }
    const vista = await llamar(ctx, sinSucursal, { metodo: 'get', ruta: '/carta/sucursal' });
    esperarError(vista, 409, 'SUCURSAL_NO_ELEGIDA');
  });

  it('Cocina/Barra con acceso a dos sucursales y ninguna activa recibe 409 SUCURSAL_NO_ELEGIDA', async () => {
    const e = await esc();
    const datos = await datosA();
    const cocina2 = await crearPersona(ctx, e.A.tokenAdmin, [
      { sucursalId: e.A.S1, rol: 'COCINA_BARRA' },
      { sucursalId: e.A.S2, rol: 'COCINA_BARRA' },
    ]);
    const token = await sesionContrasena(ctx, cocina2, null);
    for (const ruta of rutasDeClase('GESTIONAR_DISPONIBILIDAD')) {
      esperarError(
        await llamar(ctx, token, ruta.construir(idsDe(datos, e.A.S1))),
        409,
        'SUCURSAL_NO_ELEGIDA',
      );
    }
  });

  it('el rol es el de la sucursal activa: Cocina/Barra en S1 y Mozo en S2 marca con S1 activa y recibe 403 con S2 activa; nada cambia en S2', async () => {
    const e = await esc();
    const datos = await datosA();
    const mixto = await crearPersona(ctx, e.A.tokenAdmin, [
      { sucursalId: e.A.S1, rol: 'COCINA_BARRA' },
      { sucursalId: e.A.S2, rol: 'MOZO' },
    ]);
    for (const tipo of TIPOS_DE_SESION) {
      const enS1 = (await sesionesDe(ctx, mixto, e.A.S1))[tipo];
      const enS2 = (await sesionesDe(ctx, mixto, e.A.S2))[tipo];
      const ok = await llamar(ctx, enS1, {
        metodo: 'put',
        ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
        cuerpo: { hasta: 'FIN_DEL_DIA' },
      });
      exigirEstado(ok, 200, 'con S1 activa');
      expect(ok.body.sucursalId).toBe(e.A.S1);

      await asentar();

      ctx.publicador.limpiar();
      const antesS2 = await admin.query(
        `SELECT to_jsonb(t) AS fila FROM producto_agotado t WHERE sucursal_id = $1 ORDER BY id::text`,
        [e.A.S2],
      );
      const auditoriaAntes = await auditoriaCarta(admin, e.A.empresaId);
      for (const ruta of rutasDeClase('GESTIONAR_DISPONIBILIDAD')) {
        esperarError(
          await llamar(ctx, enS2, ruta.construir(idsDe(datos, e.A.S2))),
          403,
          'PROHIBIDO',
        );
      }
      const despuesS2 = await admin.query(
        `SELECT to_jsonb(t) AS fila FROM producto_agotado t WHERE sucursal_id = $1 ORDER BY id::text`,
        [e.A.S2],
      );
      expect(despuesS2.rows).toEqual(antesS2.rows);
      expect(await auditoriaCarta(admin, e.A.empresaId)).toEqual(auditoriaAntes);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);

      exigirEstado(
        await llamar(ctx, enS1, {
          metodo: 'delete',
          ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
        }),
        204,
        'reactivar en S1',
      );
    }
  });

  it('marcar y reactivar en S1 no cambia S2: la sucursal es siempre la activa y no se puede elegir por el cuerpo', async () => {
    const e = await esc();
    const datos = await datosA();
    const token = (await sesiones(e.A.cocina, e.A.S1)).contrasena;
    const antesS2 = (
      await admin.query(`SELECT count(*)::int AS n FROM producto_agotado WHERE sucursal_id = $1`, [
        e.A.S2,
      ])
    ).rows[0].n;
    const ok = await llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/sucursal/agotados/${datos.productoId}`,
      cuerpo: {},
    });
    exigirEstado(ok, 200, 'marcar en S1');
    const filasDelProducto = await admin.query<{ sucursal_id: string }>(
      `SELECT sucursal_id FROM producto_agotado WHERE producto_id = $1`,
      [datos.productoId],
    );
    expect(filasDelProducto.rows.map((f) => f.sucursal_id)).toEqual([e.A.S1]);
    // Un cuerpo con otra sucursal no se acepta (campo desconocido) y no marca nada en S2.
    const intento = await llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/sucursal/agotados/${datos.productoId}`,
      cuerpo: { hasta: 'FIN_DEL_DIA', sucursalId: e.A.S2 },
    });
    esperarError(intento, 400, 'DATOS_INVALIDOS');
    const despuesS2 = (
      await admin.query(`SELECT count(*)::int AS n FROM producto_agotado WHERE sucursal_id = $1`, [
        e.A.S2,
      ])
    ).rows[0].n;
    expect(despuesS2).toBe(antesS2);
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'delete',
        ruta: `/carta/sucursal/agotados/${datos.productoId}`,
      }),
      204,
      'reactivar en S1',
    );
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS n FROM producto_agotado WHERE sucursal_id = $1`,
          [e.A.S2],
        )
      ).rows[0].n,
    ).toBe(antesS2);
  });

  it.each(TIPOS_DE_SESION)(
    'GET /carta/sucursal responde a todos los roles con sucursal activa (sesión de %s) y 409 sin ella',
    async (tipo) => {
      const e = await esc();
      const todos: [string, PersonaCarta][] = [
        ['Mozo', e.A.mozo],
        ['Cocina/Barra', e.A.cocina],
        ['Supervisor', e.A.supervisor],
        ['Cajero', e.A.cajero],
      ];
      for (const [rol, persona] of todos) {
        const token = (await sesiones(persona, e.A.S1))[tipo];
        const res = await llamar(ctx, token, { metodo: 'get', ruta: '/carta/sucursal' });
        exigirEstado(res, 200, `vista de la sucursal para ${rol}`);
        expect(res.body.sucursalId, rol).toBe(e.A.S1);
        expect(Array.isArray(res.body.familias), rol).toBe(true);
      }
      const adminEnS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
      const comoAdmin = await llamar(ctx, adminEnS1, { metodo: 'get', ruta: '/carta/sucursal' });
      exigirEstado(comoAdmin, 200, 'vista para el Administrador');
      expect(comoAdmin.body.sucursalId).toBe(e.A.S1);

      // Con dos sucursales y ninguna activa no hay vista.
      const sinActiva = (await sesiones(e.A.cajero, null))[tipo];
      esperarError(
        await llamar(ctx, sinActiva, { metodo: 'get', ruta: '/carta/sucursal' }),
        409,
        'SUCURSAL_NO_ELEGIDA',
      );
    },
  );

  it('con otro rol en la sucursal activa, GET /carta/sucursal sigue respondiendo (no tiene @Permiso) y el menú del día no', async () => {
    const e = await esc();
    const s = await sesiones(e.A.cajero, e.A.S2); // Mozo en S2
    exigirEstado(
      await llamar(ctx, s.contrasena, { metodo: 'get', ruta: '/carta/sucursal' }),
      200,
      'vista como Mozo de S2',
    );
    esperarError(
      await llamar(ctx, s.contrasena, { metodo: 'get', ruta: '/carta/sucursal/menu-del-dia' }),
      403,
      'PROHIBIDO',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 61 · Soporte
// ------------------------------------------------------------------------------------------------
describe('criterio 61 · la sesión de soporte tiene permisos de Administrador y queda trazada', () => {
  it('edita la carta y define estaciones; la auditoría y la fila llevan al superadministrador', async () => {
    const e = await esc();
    const datos = await datosA();
    const abrir = await ctx
      .http()
      .post(`/plataforma/empresas/${e.A.empresaId}/soporte`)
      .set({ Authorization: `Bearer ${e.sa.token}` })
      .send({ motivo: unico('Soporte de la carta'), sucursalId: e.A.S1 });
    exigirEstado(abrir, 201, 'abrir soporte');
    const token = abrir.body.token as string;
    const sesionId = partesDeToken(token).sesionId;

    const estacion = await ejecutarYAuditar(ctx, admin, e.A.empresaId, token, {
      metodo: 'post',
      ruta: '/carta/estaciones',
      cuerpo: { nombre: unico('Parrilla') },
    });
    exigirEstado(estacion.res, 201, 'soporte crea una estación');
    const fila = unaFila(estacion.nuevas, {
      accion: 'crear_estacion',
      actorSuperadministradorId: e.sa.id,
      entidad: 'estacion',
      entidadId: estacion.res.body.id,
    });
    expect(fila.sesion_id).toBe(sesionId);

    const precio = await ejecutarYAuditar(ctx, admin, e.A.empresaId, token, {
      metodo: 'patch',
      ruta: `/carta/productos/${datos.productoId}`,
      cuerpo: { precio: '31.00' },
    });
    exigirEstado(precio.res, 200, 'soporte cambia un precio');
    const filaPrecio = unaFila(precio.nuevas, {
      accion: 'modificar_producto',
      actorSuperadministradorId: e.sa.id,
      entidad: 'producto',
      entidadId: datos.productoId,
    });
    expect(filaPrecio.sesion_id).toBe(sesionId);
    expect((filaPrecio.detalle as { precio: unknown }).precio).toEqual({
      antes: '25.00',
      despues: '31.00',
    });
    const producto = await admin.query(`SELECT * FROM producto WHERE id = $1`, [datos.productoId]);
    expect(producto.rows[0].actualizado_por_superadministrador_id).toBe(e.sa.id);
    expect(producto.rows[0].actualizado_por_usuario_id).toBeNull();

    // Y vuelve al precio original para no condicionar otras pruebas.
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/carta/productos/${datos.productoId}`,
        cuerpo: { precio: '25.00' },
      }),
      200,
      'soporte restaura el precio',
    );

    const agotar = await ejecutarYAuditar(ctx, admin, e.A.empresaId, token, {
      metodo: 'put',
      ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
      cuerpo: {},
    });
    exigirEstado(agotar.res, 200, 'soporte marca un agotado en la sucursal de la sesión');
    unaFila(agotar.nuevas, {
      accion: 'marcar_agotado',
      actorSuperadministradorId: e.sa.id,
      sucursalId: e.A.S1,
    });
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'delete',
        ruta: `/carta/sucursal/agotados/${datos.ligadoId}`,
      }),
      204,
      'soporte reactiva',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 62 · Auditoría: una fila por escritura, antes y después exactos, y ninguna si no cambia nada
// ------------------------------------------------------------------------------------------------
describe('criterio 62 · una fila de auditoría por escritura, con el autor y el antes y el después', () => {
  /** Los ayudantes con el Administrador de A (sin sucursal activa para la configuración). */
  async function comoAdmin() {
    const e = await esc();
    const datos = await sembrarCarta(ctx, e.A.tokenAdmin);
    const token = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
    const actor = e.A.base.admin.id;
    const hacer = (llamada: Parameters<typeof llamar>[2]) =>
      ejecutarYAuditar(ctx, admin, e.A.empresaId, token, llamada);
    return { e, datos, token, actor, hacer };
  }

  it('estaciones, familias y orden: una fila por cada escritura real', async () => {
    const { e, datos, actor, hacer } = await comoAdmin();
    const nombre = unico('Barra');
    const crear = await hacer({ metodo: 'post', ruta: '/carta/estaciones', cuerpo: { nombre } });
    exigirEstado(crear.res, 201, 'crear estación');
    unaFila(crear.nuevas, {
      accion: 'crear_estacion',
      actorUsuarioId: actor,
      entidad: 'estacion',
      entidadId: crear.res.body.id,
    });
    const nuevoNombre = unico('Barra');
    const renombrar = await hacer({
      metodo: 'patch',
      ruta: `/carta/estaciones/${crear.res.body.id}`,
      cuerpo: { nombre: nuevoNombre },
    });
    exigirEstado(renombrar.res, 200, 'renombrar estación');
    const filaEstacion = unaFila(renombrar.nuevas, {
      accion: 'modificar_estacion',
      actorUsuarioId: actor,
      entidadId: crear.res.body.id,
    });
    expect(JSON.stringify(filaEstacion.detalle)).toContain(nombre);
    expect(JSON.stringify(filaEstacion.detalle)).toContain(nuevoNombre);

    const crearFamilia = await hacer({
      metodo: 'post',
      ruta: '/carta/familias',
      cuerpo: { nombre: unico('Postres') },
    });
    exigirEstado(crearFamilia.res, 201, 'crear familia');
    unaFila(crearFamilia.nuevas, {
      accion: 'crear_familia',
      actorUsuarioId: actor,
      entidad: 'familia',
      entidadId: crearFamilia.res.body.id,
    });
    const lista = await llamar(ctx, e.A.tokenAdmin, { metodo: 'get', ruta: '/carta/familias' });
    exigirEstado(lista, 200, 'listar familias');
    const ids = (lista.body as { id: string }[]).map((f) => f.id).reverse();
    const ordenar = await hacer({ metodo: 'put', ruta: '/carta/familias/orden', cuerpo: { ids } });
    exigirEstado(ordenar.res, 200, 'ordenar familias');
    unaFila(ordenar.nuevas, { accion: 'ordenar_familias', actorUsuarioId: actor });

    const productos = await llamar(ctx, e.A.tokenAdmin, {
      metodo: 'get',
      ruta: '/carta/productos',
    });
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
    exigirEstado(ordenarProductos.res, 200, 'ordenar productos');
    unaFila(ordenarProductos.nuevas, { accion: 'ordenar_productos', actorUsuarioId: actor });
  });

  it('cada cambio de precio del producto guarda el antes y el después exactos como texto; repetirlo no deja fila', async () => {
    const { datos, actor, hacer } = await comoAdmin();
    const crear = await hacer({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimpleNuevo(
        { familiaId: datos.familiaId, estacionId: datos.estacionId },
        { precio: '25.00' },
      ),
    });
    exigirEstado(crear.res, 201, 'crear producto');
    const id = crear.res.body.id as string;
    unaFila(crear.nuevas, {
      accion: 'crear_producto',
      actorUsuarioId: actor,
      entidad: 'producto',
      entidadId: id,
    });
    expect(JSON.stringify(crear.nuevas[0]!.detalle)).toContain('25.00');

    const cambio = await hacer({
      metodo: 'patch',
      ruta: `/carta/productos/${id}`,
      cuerpo: { precio: '26.00' },
    });
    exigirEstado(cambio.res, 200, 'cambiar el precio');
    const fila = unaFila(cambio.nuevas, {
      accion: 'modificar_producto',
      actorUsuarioId: actor,
      entidad: 'producto',
      entidadId: id,
    });
    expect((fila.detalle as { precio: unknown }).precio).toEqual({
      antes: '25.00',
      despues: '26.00',
    });

    const repetido = await hacer({
      metodo: 'patch',
      ruta: `/carta/productos/${id}`,
      cuerpo: { precio: '26.00' },
    });
    exigirEstado(repetido.res, 200, 'repetir el mismo precio');
    expect(repetido.nuevas).toEqual([]);

    const nombreIgual = await hacer({
      metodo: 'patch',
      ruta: `/carta/productos/${id}`,
      cuerpo: { nombre: crear.res.body.nombre },
    });
    exigirEstado(nombreIgual.res, 200, 'cambio que no cambia nada');
    expect(nombreIgual.nuevas).toEqual([]);
  });

  it('el ajuste por sucursal audita el precio de la sucursal con su sucursal_id y el antes y el después; repetirlo no deja fila', async () => {
    const { e, datos, actor, hacer } = await comoAdmin();
    const ruta = `/carta/productos/${datos.productoId}/sucursales/${e.A.S1}`;
    const primero = await hacer({
      metodo: 'put',
      ruta,
      cuerpo: { precio: '27.50', disponible: true },
    });
    exigirEstado(primero.res, 200, 'primer ajuste');
    const f1 = unaFila(primero.nuevas, {
      accion: 'ajustar_producto_sucursal',
      actorUsuarioId: actor,
      entidad: 'producto',
      entidadId: datos.productoId,
      sucursalId: e.A.S1,
    });
    expect(JSON.stringify(f1.detalle)).toContain('27.50');

    const repetido = await hacer({
      metodo: 'put',
      ruta,
      cuerpo: { precio: '27.50', disponible: true },
    });
    exigirEstado(repetido.res, 200, 'repetir el ajuste');
    expect(repetido.nuevas).toEqual([]);

    const segundo = await hacer({
      metodo: 'put',
      ruta,
      cuerpo: { precio: '29.00', disponible: false },
    });
    exigirEstado(segundo.res, 200, 'segundo ajuste');
    const f2 = unaFila(segundo.nuevas, {
      accion: 'ajustar_producto_sucursal',
      entidadId: datos.productoId,
      sucursalId: e.A.S1,
    });
    const detalle = f2.detalle as { precio: unknown; disponible: unknown };
    expect(detalle.precio).toEqual({ antes: '27.50', despues: '29.00' });
    expect(detalle.disponible).toEqual({ antes: true, despues: false });

    // Volver a usar el precio de la empresa: antes "29.00", después nulo.
    const nulo = await hacer({ metodo: 'put', ruta, cuerpo: { precio: null, disponible: true } });
    exigirEstado(nulo.res, 200, 'volver al precio de la empresa');
    expect(
      (
        unaFila(nulo.nuevas, { accion: 'ajustar_producto_sucursal' }).detalle as {
          precio: { antes: unknown; despues: unknown };
        }
      ).precio,
    ).toEqual({ antes: '29.00', despues: null });
  });

  it('el precio extra de un modificador guarda el antes y el después exactos; crear un grupo deja una fila', async () => {
    const { datos, actor, hacer } = await comoAdmin();
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
          { nombre: 'Plátano', precioExtra: '3.00' },
        ],
      },
    });
    exigirEstado(crear.res, 201, 'crear grupo');
    const grupoId = crear.res.body.id as string;
    unaFila(crear.nuevas, {
      accion: 'crear_grupo_modificadores',
      actorUsuarioId: actor,
      entidad: 'grupo_modificadores',
      entidadId: grupoId,
    });
    const [huevo, platano] = crear.res.body.modificadores as { id: string; nombre: string }[];
    const modificar = await hacer({
      metodo: 'patch',
      ruta: `/carta/grupos-modificadores/${grupoId}`,
      cuerpo: {
        modificadores: [
          { id: huevo!.id, nombre: 'Huevo', precioExtra: '2.80' },
          { id: platano!.id, nombre: 'Plátano', precioExtra: '3.00' },
        ],
      },
    });
    exigirEstado(modificar.res, 200, 'cambiar el precio extra');
    const fila = unaFila(modificar.nuevas, {
      accion: 'modificar_grupo_modificadores',
      actorUsuarioId: actor,
      entidad: 'grupo_modificadores',
      entidadId: grupoId,
    });
    const texto = JSON.stringify(fila.detalle);
    expect(texto).toContain('2.50');
    expect(texto).toContain('2.80');
    void datos;
  });

  it('la foto deja una fila al cambiarla y otra al quitarla; quitarla sin foto no deja ninguna', async () => {
    const { e, datos, actor, hacer } = await comoAdmin();
    const crear = await hacer({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimpleNuevo({ familiaId: datos.familiaId, estacionId: datos.estacionId }),
    });
    exigirEstado(crear.res, 201, 'crear producto');
    const id = crear.res.body.id as string;
    const subir = await hacer({
      metodo: 'put',
      ruta: `/carta/productos/${id}/foto`,
      binario: { tipo: 'image/png', datos: pngValido() },
    });
    exigirEstado(subir.res, 200, 'subir foto');
    unaFila(subir.nuevas, {
      accion: 'cambiar_foto_producto',
      actorUsuarioId: actor,
      entidad: 'producto',
      entidadId: id,
    });
    expect(ctx.almacen.claves().some((c) => c.startsWith(`carta/${e.A.empresaId}/${id}/`))).toBe(
      true,
    );
    const quitar = await hacer({ metodo: 'delete', ruta: `/carta/productos/${id}/foto` });
    exigirEstado(quitar.res, 204, 'quitar foto');
    unaFila(quitar.nuevas, {
      accion: 'quitar_foto_producto',
      actorUsuarioId: actor,
      entidadId: id,
    });
    const otraVez = await hacer({ metodo: 'delete', ruta: `/carta/productos/${id}/foto` });
    exigirEstado(otraVez.res, 204, 'quitar sin foto');
    expect(otraVez.nuevas).toEqual([]);
  });

  it('agotados y menú del día: una fila por cambio real y ninguna al repetir', async () => {
    const { e, datos, hacer } = await comoAdmin();
    const ruta = `/carta/sucursal/agotados/${datos.ligadoId}`;
    const marcar = await hacer({ metodo: 'put', ruta, cuerpo: { hasta: 'FIN_DEL_DIA' } });
    exigirEstado(marcar.res, 200, 'marcar');
    unaFila(marcar.nuevas, {
      accion: 'marcar_agotado',
      actorUsuarioId: e.A.base.admin.id,
      entidadId: datos.ligadoId,
      sucursalId: e.A.S1,
    });
    const repetir = await hacer({ metodo: 'put', ruta, cuerpo: { hasta: 'FIN_DEL_DIA' } });
    exigirEstado(repetir.res, 200, 'repetir el agotado');
    expect(repetir.nuevas).toEqual([]);
    const cambiar = await hacer({ metodo: 'put', ruta, cuerpo: { hasta: 'REACTIVAR' } });
    exigirEstado(cambiar.res, 200, 'cambiar el hasta');
    expect(cambiar.nuevas).toHaveLength(1);
    const reactivar = await hacer({ metodo: 'delete', ruta });
    exigirEstado(reactivar.res, 204, 'reactivar');
    unaFila(reactivar.nuevas, { accion: 'reactivar_agotado', entidadId: datos.ligadoId });
    const otraVez = await hacer({ metodo: 'delete', ruta });
    exigirEstado(otraVez.res, 204, 'reactivar lo que no estaba agotado');
    expect(otraVez.nuevas).toEqual([]);

    const rutaMenu = `/carta/sucursal/menu-del-dia/${datos.menuId}`;
    const armar = await hacer({
      metodo: 'put',
      ruta: rutaMenu,
      cuerpo: { opciones: [datos.opcionesMenuIds[0]] },
    });
    exigirEstado(armar.res, 200, 'armar el menú');
    unaFila(armar.nuevas, {
      accion: 'armar_menu_del_dia',
      entidadId: datos.menuId,
      sucursalId: e.A.S1,
    });
    const igual = await hacer({
      metodo: 'put',
      ruta: rutaMenu,
      cuerpo: { opciones: [datos.opcionesMenuIds[0]] },
    });
    exigirEstado(igual.res, 200, 'repetir el menú');
    expect(igual.nuevas).toEqual([]);
  });

  it('la fila de auditoría y la fila de la carta quedan en la misma transacción: una escritura rechazada no deja auditoría', async () => {
    const { e, datos, hacer } = await comoAdmin();
    const antes = await auditoriaCarta(admin, e.A.empresaId);
    const repetido = await hacer({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimpleNuevo(
        { familiaId: datos.familiaId, estacionId: datos.estacionId },
        {
          nombre: (
            await llamar(ctx, e.A.tokenAdmin, {
              metodo: 'get',
              ruta: `/carta/productos/${datos.productoId}`,
            })
          ).body.nombre,
        },
      ),
    });
    esperarError(repetido.res, 409, 'CONFLICTO');
    expect(repetido.nuevas).toEqual([]);
    expect(await auditoriaCarta(admin, e.A.empresaId)).toHaveLength(antes.length);
  });
});
