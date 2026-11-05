// spec: 006-caja-cobro (pruebas protegidas)
//
// P5 · Permisos, auditoría y trazabilidad de caja (ruta crítica), criterios 98 a 102:
// - 98: toda ruta de `/turnos`, `/cajas`, `/cuentas`, `/ventas-mostrador`, `/comprobantes`, `/sucursales/:id/cajas…` y
//   `/emisores/:id/tasas-igv…` está registrada y lleva exactamente la acción y el módulo de la tabla de endpoints; la
//   matriz de `packages/dominio` no cambia; ninguna ruta nueva cuelga de `/ordenes`, `/salon` ni `/cocina`;
// - 99: para cada rol sin la acción, con contraseña y con PIN, la ruta responde 403 PROHIBIDO sin cambios, sin
//   auditoría y sin eventos; el rol es el de la sucursal activa (sin sucursal, 409 SUCURSAL_NO_ELEGIDA; sin el módulo
//   del plan, 403 MODULO_NO_INCLUIDO);
// - 100: el alcance del Cajero (su turno); 101: la auditoría de la configuración y lo que no se audita;
// - 102: trazabilidad de autor y de equipo, incluido el cobro de un Supervisor en el turno de un Cajero y la sesión de
//   soporte.
// Las pruebas de la clave de supervisor, el consumo y los efectos de los descuentos están en `descuentos-cortesias.spec.ts`.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso` ni `@RequiereModulo`.
import { requisitoPermiso, type Rol } from '@restaurante/dominio';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PERMISO,
  PUBLICA,
  REQUIERE_MODULO,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from '../../src/modulos/seguridad';
import { rutasDeNest } from '../utilidades';
import { partesDeToken, filasAuditoria, sesionDeSoporte } from '../acceso/fabrica-equipos';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cobrar,
  crearCaja,
  crearEscenario,
  cuentaC,
  equipoDe,
  esperarError,
  exigirEstado,
  filas,
  ponerSerie,
  ponerTasa,
  sesionContrasena,
  sesionPin,
  type AppP5,
  type Escenario,
  type Libre,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

type Accion =
  | 'ADMINISTRAR'
  | 'OPERAR_CAJA'
  | 'COBRAR'
  | 'ATENDER_MESA'
  | 'APLICAR_DESCUENTO'
  | 'APLICAR_CORTESIA';
type Modulo = 'CAJA' | 'SALON' | 'FACTURACION' | null;

interface RutaCaja {
  clave: string;
  accion: Accion;
  modulo: Modulo;
  metodo: 'get' | 'post' | 'put' | 'patch' | 'delete';
  ruta: (id: string, s: string) => string;
}

const r = (
  metodo: RutaCaja['metodo'],
  plantilla: string,
  accion: Accion,
  modulo: Modulo,
): RutaCaja => ({
  clave: `${metodo.toUpperCase()} ${plantilla.replace(/:[A-Za-z]+/g, ':p')}`,
  accion,
  modulo,
  metodo,
  ruta: (id, s) =>
    plantilla
      .replace(':sucursalId', s)
      .replace(/:(id|ordenId|cajaId|tipo|desde)/g, (_, n: string) =>
        n === 'tipo' ? 'BOLETA' : n === 'desde' ? '2030-01-01' : id,
      ),
});

/** La tabla de endpoints de 6a: la acción y el módulo de cada ruta (no incluye 6b). */
const RUTAS: RutaCaja[] = [
  r('get', '/sucursales/:sucursalId/cajas', 'ADMINISTRAR', null),
  r('post', '/sucursales/:sucursalId/cajas', 'ADMINISTRAR', null),
  r('patch', '/sucursales/:sucursalId/cajas/:id', 'ADMINISTRAR', null),
  r('put', '/sucursales/:sucursalId/cajas/:cajaId/series/:tipo', 'ADMINISTRAR', null),
  r('get', '/emisores/:id/tasas-igv', 'ADMINISTRAR', null),
  r('put', '/emisores/:id/tasas-igv/:desde', 'ADMINISTRAR', null),
  r('get', '/cajas', 'OPERAR_CAJA', 'CAJA'),
  r('post', '/turnos', 'OPERAR_CAJA', 'CAJA'),
  r('get', '/turnos/mio', 'OPERAR_CAJA', 'CAJA'),
  r('get', '/turnos/:id', 'OPERAR_CAJA', 'CAJA'),
  r('post', '/turnos/:id/movimientos', 'OPERAR_CAJA', 'CAJA'),
  r('get', '/turnos/:id/reporte', 'OPERAR_CAJA', 'CAJA'),
  r('post', '/turnos/:id/reporte-x/impresiones', 'OPERAR_CAJA', 'CAJA'),
  r('post', '/turnos/:id/cierre', 'OPERAR_CAJA', 'CAJA'),
  r('get', '/cuentas', 'COBRAR', 'CAJA'),
  r('get', '/cuentas/:ordenId', 'ATENDER_MESA', 'CAJA'),
  r('post', '/cuentas/:ordenId/descuentos', 'APLICAR_DESCUENTO', 'SALON'),
  r('delete', '/cuentas/:ordenId/descuentos/:id', 'ATENDER_MESA', 'SALON'),
  r('post', '/cuentas/:ordenId/cortesias', 'APLICAR_CORTESIA', 'SALON'),
  r('delete', '/cuentas/:ordenId/cortesias/:id', 'ATENDER_MESA', 'SALON'),
  r('post', '/cuentas/:ordenId/cobros', 'COBRAR', 'CAJA'),
  r('post', '/ventas-mostrador', 'COBRAR', 'CAJA'),
  r('get', '/comprobantes/:id', 'COBRAR', 'FACTURACION'),
  r('get', '/comprobantes', 'COBRAR', 'FACTURACION'),
  r('post', '/comprobantes/:id/impresiones', 'COBRAR', 'FACTURACION'),
];

/** Las rutas que cubre el criterio 98. */
const esRutaDeCaja = (ruta: string): boolean =>
  /^\/(turnos|cajas|cuentas|ventas-mostrador|comprobantes)(\/|$)/.test(ruta) ||
  /^\/sucursales\/:[A-Za-z]+\/cajas(\/|$)/.test(ruta) ||
  /^\/emisores\/:[A-Za-z]+\/tasas-igv(\/|$)/.test(ruta);

const normal = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, ':p');

// ------------------------------------------------------------------------------------------------
describe('criterio 98 · clasificación de las rutas', () => {
  const ROLES: Rol[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'];
  const fila = (accion: Parameters<typeof requisitoPermiso>[1]) =>
    ROLES.map((rol) => requisitoPermiso(rol, accion));

  it('la matriz de permisos no cambia para las acciones de caja', () => {
    expect(fila('COBRAR')).toEqual([
      'prohibido',
      'permitido',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('OPERAR_CAJA')).toEqual([
      'prohibido',
      'permitido',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('APLICAR_DESCUENTO')).toEqual([
      'clave',
      'clave',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('APLICAR_CORTESIA')).toEqual([
      'clave',
      'clave',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('ATENDER_MESA')).toEqual([
      'permitido',
      'permitido',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('ADMINISTRAR')).toEqual([
      'prohibido',
      'prohibido',
      'prohibido',
      'prohibido',
      'permitido',
    ]);
  });

  it('las rutas registradas en Nest son exactamente las de la tabla de endpoints y cada una tiene su acción y su módulo', () => {
    const registradas = rutasDeNest(ctx.app).filter((x) => esRutaDeCaja(x.ruta));
    const esperadas = new Map(RUTAS.map((x) => [x.clave, x]));
    const problemas: string[] = [];
    const vistas = new Set<string>();
    for (const x of registradas) {
      const clave = `${x.metodo} ${normal(x.ruta)}`;
      if (vistas.has(clave)) problemas.push(`${clave}: ruta registrada dos veces`);
      vistas.add(clave);
      const manejador = x.controlador.prototype[x.manejador] as object;
      const leer = <T>(llave: string): T | undefined =>
        (Reflect.getMetadata(llave, manejador) as T | undefined) ??
        (Reflect.getMetadata(llave, x.controlador) as T | undefined);
      const accion = leer<string>(PERMISO) ?? 'NINGUNA';
      const modulo = leer<string>(REQUIERE_MODULO) ?? null;
      const esperada = esperadas.get(clave);
      if (esperada === undefined) {
        // Las rutas de 6b (panel, reintento, notas de crédito, PDF) todavía no existen en 6a.
        problemas.push(`${clave}: ruta sin clasificar (tiene ${accion})`);
        continue;
      }
      if (accion !== esperada.accion)
        problemas.push(`${clave}: debería ser ${esperada.accion} y es ${accion}`);
      if (modulo !== esperada.modulo)
        problemas.push(`${clave}: debería exigir el módulo ${esperada.modulo} y exige ${modulo}`);
      const exigeSucursal = leer<boolean>(REQUIERE_SUCURSAL) ?? false;
      if (esperada.modulo !== null && !exigeSucursal)
        problemas.push(`${clave}: falta la sucursal activa`);
      if (esperada.modulo === null && exigeSucursal)
        problemas.push(`${clave}: la configuración no exige sucursal activa`);
      if (leer<boolean>(SOLO_ADMINISTRADOR) === true)
        problemas.push(`${clave}: debe usar @Permiso, no @SoloAdministrador`);
      if (leer<boolean>(PUBLICA) === true) problemas.push(`${clave}: no puede ser pública`);
    }
    for (const clave of esperadas.keys())
      if (!vistas.has(clave)) problemas.push(`${clave}: falta la ruta`);
    expect(registradas.length).toBeGreaterThan(0);
    expect(problemas, problemas.join('\n')).toEqual([]);
  });

  it('ninguna ruta de caja, cuentas, turnos, mostrador o comprobantes cuelga de /ordenes, /salon ni /cocina', () => {
    const colgadas = rutasDeNest(ctx.app)
      .filter((x) => /^\/(ordenes|salon|cocina)(\/|$)/.test(x.ruta))
      .filter((x) =>
        /\/(cobros|descuentos|cortesias|turnos|comprobantes|cuentas|cajas|ventas-mostrador)(\/|$)/.test(
          x.ruta,
        ),
      );
    expect(colgadas.map((x) => `${x.metodo} ${x.ruta}`)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 99 · rechazos por rol', () => {
  interface Persona {
    nombre: 'mozo' | 'cocina' | 'cajero' | 'supervisor';
    contrasena: string;
    pin: string;
  }
  let sesiones: Persona[];

  async function prepararSesiones(): Promise<Persona[]> {
    if (sesiones) return sesiones;
    sesiones = [];
    for (const nombre of ['mozo', 'cocina', 'cajero', 'supervisor'] as const) {
      const persona = A().personas[nombre]!;
      const tokenEquipo = await equipoDe(ctx, persona);
      sesiones.push({
        nombre,
        contrasena: await sesionContrasena(ctx, persona, A().S1),
        pin: await sesionPin(ctx, persona, tokenEquipo, A().S1),
      });
    }
    return sesiones;
  }

  /** Quiénes no tienen la acción (los que tienen `clave` no reciben PROHIBIDO sino CLAVE_REQUERIDA). */
  const sinLaAccion = (accion: Accion): Array<Persona['nombre']> =>
    accion === 'ADMINISTRAR'
      ? ['mozo', 'cocina', 'cajero', 'supervisor']
      : accion === 'COBRAR' || accion === 'OPERAR_CAJA'
        ? ['mozo', 'cocina']
        : ['cocina'];

  async function fotoDeCambios() {
    const cuenta = async (sql: string) => Number((await filas(sql, [A().id]))[0]!.n);
    return {
      auditoria: await cuenta('SELECT count(*) AS n FROM auditoria WHERE empresa_id = $1'),
      cajas: await cuenta('SELECT count(*) AS n FROM caja WHERE empresa_id = $1'),
      turnos: await cuenta('SELECT count(*) AS n FROM turno WHERE empresa_id = $1'),
      series: await cuenta(
        'SELECT coalesce(sum(ultimo_numero), 0) + count(*) AS n FROM serie WHERE empresa_id = $1',
      ),
      cobros: await cuenta('SELECT count(*) AS n FROM cobro WHERE empresa_id = $1'),
      comprobantes: await cuenta('SELECT count(*) AS n FROM comprobante WHERE empresa_id = $1'),
      descuentos: await cuenta('SELECT count(*) AS n FROM descuento WHERE empresa_id = $1'),
      cortesias: await cuenta('SELECT count(*) AS n FROM cortesia WHERE empresa_id = $1'),
      eventos: ctx.publicador.eventos().length,
    };
  }

  it('cada rol sin la acción, con contraseña y con PIN, recibe 403 PROHIBIDO sin cambios, sin auditoría y sin eventos', async () => {
    const todas = await prepararSesiones();
    const cuenta = await cuentaC(ctx, A());
    const cajas = await A().cajas();
    const antes = await fotoDeCambios();
    const fallos: string[] = [];
    for (const ruta of RUTAS) {
      for (const persona of todas.filter((p) => sinLaAccion(ruta.accion).includes(p.nombre))) {
        for (const [clase, token] of [
          ['contraseña', persona.contrasena],
          ['PIN', persona.pin],
        ] as const) {
          const id = ruta.ruta('x', A().S1).includes('/cajas/') ? cajas.S1!.caja1 : cuenta.ordenId;
          const res = await api(
            ctx,
            token,
            ruta.metodo,
            ruta.ruta(id, A().S1),
            ruta.metodo === 'get' || ruta.metodo === 'delete' ? undefined : {},
            { 'Idempotency-Key': randomUUID() },
          );
          const codigo = (res.body as Libre | undefined)?.codigo;
          if (res.status !== 403 || codigo !== 'PROHIBIDO') {
            fallos.push(
              `${ruta.clave} · ${persona.nombre} (${clase}): ${res.status} ${codigo ?? res.text.slice(0, 80)}`,
            );
          }
        }
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await fotoDeCambios()).toEqual(antes);
  });

  it('sin sucursal activa responde 409 SUCURSAL_NO_ELEGIDA en las rutas de operación', async () => {
    const sinSucursal = await sesionContrasena(ctx, A().personas.cajero!, null);
    const fallos: string[] = [];
    for (const ruta of RUTAS.filter((x) => x.modulo !== null)) {
      const res = await api(
        ctx,
        sinSucursal,
        ruta.metodo,
        ruta.ruta(randomUUID(), A().S1),
        ruta.metodo === 'get' || ruta.metodo === 'delete' ? undefined : {},
        {
          'Idempotency-Key': randomUUID(),
        },
      );
      // Las rutas que el Cajero no puede usar por su rol (descuentos con clave siguen siendo suyas) pasan primero por el rol.
      if (res.status !== 409 || res.body.codigo !== 'SUCURSAL_NO_ELEGIDA')
        fallos.push(`${ruta.clave}: ${res.status} ${res.body.codigo}`);
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
  });

  it('sin sucursal activa no hay rol que evaluar: un Mozo que sería rechazado ve 409 SUCURSAL_NO_ELEGIDA, no 403', async () => {
    const sinSucursal = await sesionContrasena(ctx, A().personas.mozoMulti!, null);
    const fallos: string[] = [];
    for (const ruta of RUTAS.filter((x) => x.modulo !== null)) {
      const res = await api(
        ctx,
        sinSucursal,
        ruta.metodo,
        ruta.ruta(randomUUID(), A().S1),
        ruta.metodo === 'get' || ruta.metodo === 'delete' ? undefined : {},
        { 'Idempotency-Key': randomUUID() },
      );
      if (res.status !== 409 || res.body.codigo !== 'SUCURSAL_NO_ELEGIDA') {
        fallos.push(`${ruta.clave}: ${res.status} ${res.body.codigo}`);
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
  });

  it('el Administrador sin sucursal activa recibe 409 SUCURSAL_NO_ELEGIDA en las rutas con módulo; las de configuración no la necesitan', async () => {
    const admin = A().token.admin!;
    const fallos: string[] = [];
    for (const ruta of RUTAS.filter((x) => x.modulo !== null)) {
      const res = await api(
        ctx,
        admin,
        ruta.metodo,
        ruta.ruta(randomUUID(), A().S1),
        ruta.metodo === 'get' || ruta.metodo === 'delete' ? undefined : {},
        { 'Idempotency-Key': randomUUID() },
      );
      if (res.status !== 409 || res.body.codigo !== 'SUCURSAL_NO_ELEGIDA') {
        fallos.push(`${ruta.clave}: ${res.status} ${res.body.codigo}`);
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    exigirEstado(
      await api(ctx, admin, 'get', `/sucursales/${A().S1}/cajas`),
      200,
      'Configuración sin sucursal activa',
    );
  });

  it('el rol es el de la sucursal activa: el Cajero de S1 es Mozo en S2 y recibe 403 PROHIBIDO en las rutas de COBRAR y OPERAR_CAJA', async () => {
    const enS2 = await sesionContrasena(ctx, A().personas.cajero!, A().S2);
    for (const ruta of RUTAS.filter((x) => x.accion === 'COBRAR' || x.accion === 'OPERAR_CAJA')) {
      const res = await api(
        ctx,
        enS2,
        ruta.metodo,
        ruta.ruta(randomUUID(), A().S2),
        ruta.metodo === 'get' || ruta.metodo === 'delete' ? undefined : {},
        {
          'Idempotency-Key': randomUUID(),
        },
      );
      esperarError(res, 403, 'PROHIBIDO');
    }
  });

  it('con el módulo fuera del plan de la sucursal, 403 MODULO_NO_INCLUIDO en las rutas de ese módulo', async () => {
    const supervisor = A().token.supervisorS4!;
    const cambiarPlan = async (modulos: string[]) => {
      const plan = await api(ctx, esc.sa.token, 'post', '/plataforma/planes', {
        codigo: `P-${randomUUID().slice(0, 8)}`,
        nombre: 'Plan de prueba de módulos',
        diasGracia: 7,
        modulos,
        porDefecto: false,
        activo: true,
        motivo: 'Plan de prueba',
      });
      exigirEstado(plan, 201, 'Crear el plan');
      const cambio = await api(
        ctx,
        esc.sa.token,
        'patch',
        `/plataforma/suscripciones/${A().base.suscripciones[A().S4!]!.id}`,
        {
          planId: plan.body.id,
          motivo: 'Cambio de plan de prueba',
        },
      );
      exigirEstado(cambio, 200, 'Cambiar el plan de S4');
    };
    const probar = async (modulo: Modulo) => {
      const fallos: string[] = [];
      for (const ruta of RUTAS.filter((x) => x.modulo === modulo)) {
        const res = await api(
          ctx,
          supervisor,
          ruta.metodo,
          ruta.ruta(randomUUID(), A().S4!),
          ruta.metodo === 'get' || ruta.metodo === 'delete' ? undefined : {},
          {
            'Idempotency-Key': randomUUID(),
          },
        );
        if (res.status !== 403 || res.body.codigo !== 'MODULO_NO_INCLUIDO')
          fallos.push(`${ruta.clave}: ${res.status} ${res.body.codigo}`);
      }
      return fallos;
    };
    const todos = [
      'SALON',
      'COCINA',
      'CAJA',
      'FACTURACION',
      'PEDIDOS_WEB',
      'INVENTARIO',
      'REPORTES',
    ];
    const fallos: string[] = [];
    for (const modulo of ['CAJA', 'SALON', 'FACTURACION'] as const) {
      await cambiarPlan(todos.filter((m) => m !== modulo));
      fallos.push(...(await probar(modulo)));
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 100 · alcance del Cajero', () => {
  it('el Cajero ve el reporte y los comprobantes de su turno; los de otro turno responden 403; el Supervisor y el Administrador ven los de cualquiera', async () => {
    const cajas = await A().cajas();
    const turnoCajero = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1);
    const turnoCajero2 = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2);
    const adminS1 = await sesionContrasena(ctx, A().base.admin, A().S1);
    for (const ruta of [
      `/turnos/${turnoCajero}`,
      `/turnos/${turnoCajero}/reporte`,
      `/comprobantes?turnoId=${turnoCajero}`,
    ]) {
      exigirEstado(
        await api(ctx, A().token.cajero, 'get', ruta),
        200,
        `El Cajero ve lo suyo: ${ruta}`,
      );
      esperarError(await api(ctx, A().token.cajero2, 'get', ruta), 403, 'PROHIBIDO');
      exigirEstado(
        await api(ctx, A().token.supervisor, 'get', ruta),
        200,
        `El Supervisor ve ${ruta}`,
      );
      exigirEstado(await api(ctx, adminS1, 'get', ruta), 200, `El Administrador ve ${ruta}`);
    }
    esperarError(
      await api(
        ctx,
        A().token.cajero2,
        'post',
        `/turnos/${turnoCajero}/reporte-x/impresiones`,
        undefined,
        { 'Idempotency-Key': randomUUID() },
      ),
      403,
      'PROHIBIDO',
    );
    void turnoCajero2;
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 101 · auditoría', () => {
  const delEmpresa = (accion: string) => filasAuditoria(A().id, accion);

  it('crear_caja, modificar_caja, configurar_serie y configurar_tasa_igv dejan una fila cada uno; repetir sin cambios responde 200 sin fila', async () => {
    const admin = A().token.admin!;
    const caja = await crearCaja(ctx, admin, A().S1, 'Caja auditada');
    const tras = async (accion: string) =>
      (await delEmpresa(accion)).filter((f) => f.texto.includes(caja.id as string));
    expect(await tras('crear_caja')).toHaveLength(1);
    expect((await tras('crear_caja'))[0]!.texto).toContain(A().base.admin.id);

    exigirEstado(
      await api(ctx, admin, 'patch', `/sucursales/${A().S1}/cajas/${caja.id}`, {
        nombre: 'Caja renombrada',
      }),
      200,
      'Renombrar',
    );
    expect(await tras('modificar_caja')).toHaveLength(1);
    const texto = (await tras('modificar_caja'))[0]!.texto;
    expect(texto).toContain('Caja auditada');
    expect(texto).toContain('Caja renombrada');
    exigirEstado(
      await api(ctx, admin, 'patch', `/sucursales/${A().S1}/cajas/${caja.id}`, {
        nombre: 'Caja renombrada',
      }),
      200,
      'Sin cambios',
    );
    expect(await tras('modificar_caja')).toHaveLength(1);

    exigirEstado(
      await ponerSerie(ctx, admin, A().S1, caja.id as string, 'BOLETA', 'B910'),
      200,
      'Serie',
    );
    exigirEstado(
      await ponerSerie(ctx, admin, A().S1, caja.id as string, 'BOLETA', 'B910'),
      200,
      'Serie repetida',
    );
    expect(
      (await delEmpresa('configurar_serie')).filter((f) => f.texto.includes('B910')),
    ).toHaveLength(1);

    exigirEstado(await ponerTasa(ctx, admin, A().emisor1, '2031-01-01', '17.50'), 200, 'Tasa');
    exigirEstado(
      await ponerTasa(ctx, admin, A().emisor1, '2031-01-01', '17.50'),
      200,
      'Tasa repetida',
    );
    expect(
      (await delEmpresa('configurar_tasa_igv')).filter((f) => f.texto.includes('17.50')),
    ).toHaveLength(1);
  });

  it('abrir turno, movimientos, cobros y reportes X no se auditan', async () => {
    // El Supervisor abre su turno en la Caja 3: los de los dos cajeros siguen abiertos desde el criterio 100 (criterio 26).
    const cajas = await A().cajas();
    // La cuenta (la mesa y la comanda son de 004 y la mesa sí se audita) se arma antes de contar.
    const cuenta = await cuentaC(ctx, A());
    const antes = Number(
      (await filas('SELECT count(*) AS n FROM auditoria WHERE empresa_id = $1', [A().id]))[0]!.n,
    );
    const turnoId = await abrirTurno(ctx, A().token.supervisor!, cajas.S1!.caja3);
    exigirEstado(
      await api(
        ctx,
        A().token.supervisor,
        'post',
        `/turnos/${turnoId}/movimientos`,
        { id: randomUUID(), tipo: 'INGRESO', monto: '5.00', motivo: 'Cambio' },
        { 'Idempotency-Key': randomUUID() },
      ),
      201,
      'Movimiento',
    );
    await cobrar(ctx, A().token.supervisor!, cuenta, { turnoId, total: '69.20' });
    exigirEstado(
      await api(ctx, A().token.supervisor, 'get', `/turnos/${turnoId}/reporte`),
      200,
      'X',
    );
    const despues = Number(
      (await filas('SELECT count(*) AS n FROM auditoria WHERE empresa_id = $1', [A().id]))[0]!.n,
    );
    expect(despues).toBe(antes);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 102 · trazabilidad', () => {
  it('un cobro de un Supervisor en el turno de un Cajero queda con el Supervisor como autor y su equipo, y el Cajero como responsable', async () => {
    const cajas = await A().cajas();
    const [abierto] = await filas(
      `SELECT id FROM turno WHERE estado = 'ABIERTO' AND responsable_id = $1`,
      [A().personas.cajero!.id],
    );
    const turnoId =
      (abierto?.id as string | undefined) ??
      (await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1));
    const tokenEquipo = await equipoDe(ctx, A().personas.supervisor!);
    const equipoId = partesDeToken(tokenEquipo).id;
    const sesionPinSup = await sesionPin(ctx, A().personas.supervisor!, tokenEquipo, A().S1);
    const cuenta = await cuentaC(ctx, A());
    const cobro = await cobrar(ctx, sesionPinSup, cuenta, { turnoId, total: '69.20' });
    const mov = await api(
      ctx,
      sesionPinSup,
      'post',
      `/turnos/${turnoId}/movimientos`,
      { id: randomUUID(), tipo: 'EGRESO', monto: '3.00', motivo: 'Propina de hielo' },
      { 'Idempotency-Key': randomUUID() },
    );
    exigirEstado(mov, 201, 'Movimiento del Supervisor');
    const autor = {
      creado_por_usuario_id: A().personas.supervisor!.id,
      creado_por_equipo_id: equipoId,
    };
    const [c] = await filas(
      'SELECT creado_por_usuario_id, creado_por_equipo_id FROM cobro WHERE id = $1',
      [cobro.id],
    );
    expect(c).toEqual(autor);
    const [k] = await filas(
      'SELECT creado_por_usuario_id, creado_por_equipo_id, turno_responsable_id FROM comprobante WHERE id = $1',
      [cobro.comprobante.id],
    );
    expect(k).toEqual({ ...autor, turno_responsable_id: A().personas.cajero!.id });
    const [p] = await filas(
      'SELECT creado_por_usuario_id, creado_por_equipo_id FROM pago WHERE cobro_id = $1',
      [cobro.id],
    );
    expect(p).toEqual(autor);
    const [m] = await filas(
      'SELECT creado_por_usuario_id, creado_por_equipo_id FROM movimiento_caja WHERE id = $1',
      [mov.body.id],
    );
    expect(m).toEqual(autor);
    const [t] = await filas(
      'SELECT creado_por_usuario_id, responsable_id FROM turno WHERE id = $1',
      [turnoId],
    );
    expect(t).toEqual({
      creado_por_usuario_id: A().personas.cajero!.id,
      responsable_id: A().personas.cajero!.id,
    });
  });

  it('una sesión de soporte queda trazada con el superadministrador, no con un usuario de la empresa', async () => {
    const [abierto] = await filas(
      `SELECT id FROM turno WHERE estado = 'ABIERTO' AND responsable_id = $1`,
      [A().personas.cajero!.id],
    );
    const turnoId = abierto!.id as string;
    const soporte = await sesionDeSoporte(ctx.app, esc.sa.token, A().id, A().S1);
    const cuenta = await cuentaC(ctx, A());
    const cobro = await cobrar(ctx, soporte, cuenta, { turnoId, total: '69.20' });
    const [k] = await filas(
      'SELECT creado_por_usuario_id, creado_por_superadministrador_id FROM comprobante WHERE id = $1',
      [cobro.comprobante.id],
    );
    expect(k).toEqual({ creado_por_usuario_id: null, creado_por_superadministrador_id: esc.sa.id });
    const otra = await cuentaC(ctx, A());
    const desc = await api(
      ctx,
      soporte,
      'post',
      `/cuentas/${otra.ordenId}/descuentos`,
      {
        id: randomUUID(),
        itemId: otra.item.lomo,
        tipo: 'PORCENTAJE',
        valor: '10.00',
        motivo: 'Soporte',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    exigirEstado(desc, 201, 'Descuento del soporte');
    const [d] = await filas(
      'SELECT creado_por_usuario_id, creado_por_superadministrador_id FROM descuento WHERE id = $1',
      [desc.body.id],
    );
    expect(d).toEqual({ creado_por_usuario_id: null, creado_por_superadministrador_id: esc.sa.id });
  });

  it('las tablas nuevas llevan las columnas de autor y de equipo (trazabilidad con llave de equipo)', async () => {
    const tablas = [
      'caja',
      'turno',
      'turno_conteo',
      'movimiento_caja',
      'cobro',
      'pago',
      'serie',
      'comprobante',
      'comprobante_linea',
      'emisor_tasa_igv',
      'descuento',
      'cortesia',
      'contador_llamado',
    ];
    const faltan: string[] = [];
    for (const tabla of tablas) {
      const cols = (
        await filas(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [tabla],
        )
      ).map((c) => c.column_name as string);
      for (const col of [
        'creado_por_usuario_id',
        'creado_por_equipo_id',
        'creado_por_superadministrador_id',
        'actualizado_por_usuario_id',
      ]) {
        if (!cols.includes(col)) faltan.push(`${tabla}.${col}`);
      }
    }
    expect(faltan, `faltan: ${faltan.join(', ')}`).toEqual([]);
  });
});
