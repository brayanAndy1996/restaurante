// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P10 · Permisos, auditoría y trazabilidad de 6b (ruta crítica), criterios 168 a 171:
// - 168: toda ruta de `/facturacion`, `/notas-credito`, `/padron`, `/publico/comprobantes`, `/plataforma/empresas/:id/emisores/:id/pse`,
//   `/plataforma/facturacion` y `/plataforma/padron` está registrada y lleva exactamente lo de la tabla "Endpoints (6b)" (la
//   prueba recorre las rutas de Nest con su propia tabla y falla si una falta, sobra o tiene otra clasificación); ninguna cuelga
//   de los prefijos de 6a (criterio 98); la matriz de `packages/dominio` no cambia;
// - 169: Mozo y Cocina/Barra reciben 403 PROHIBIDO en todas las rutas de 6b con contraseña y con PIN, sin cambios ni auditoría;
//   sin el módulo FACTURACION, 403 MODULO_NO_INCLUIDO; sin sucursal activa, 409 SUCURSAL_NO_ELEGIDA; alcance del Cajero (solo
//   los comprobantes de sus turnos), del Supervisor (la sucursal activa) y del Administrador (la sucursal activa y, en el panel
//   y en las alertas, las demás con `sucursalId`) en el panel, el detalle, el PDF, el enlace, el reintento, la reemisión y las
//   alertas;
// - 170: las rutas de plataforma de 6b son solo del superadministrador (las sesiones de empresa reciben 401), un emisor de otra
//   empresa es 404 y dejan su fila en `auditoria` (origen `plataforma`) sin secretos;
// - 171: `reemitir_comprobante` deja exactamente una fila (ninguna en las réplicas, los rechazos ni el reintento manual); las
//   filas de `envio_pse` e `intento_pse` y los cambios de estado de un comprobante quedan trazados con su actor (la persona que
//   emitió o reintentó, o `worker:envio-pse`) y `configuracion_pse`, con el superadministrador.
// El rol de la nota de crédito (`EMITIR_NOTA_CREDITO`) y su clave están en `nota-credito-clave.spec.ts`.
// Hoy falla por "No implementado": las rutas de 6b responden 500 sin `@Permiso` ni `@RequiereModulo`, la ruta pública y el
// procesador de envíos todavía no están.
import { requisitoPermiso, type Rol } from '@restaurante/dominio';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SUPERADMINISTRADOR } from '../../src/modulos/plataforma';
import {
  PERMISO,
  PUBLICA,
  REQUIERE_MODULO,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from '../../src/modulos/seguridad';
import { rutasDeNest } from '../utilidades';
import { partesDeToken, sesionDeSoporte } from '../acceso/fabrica-equipos';
import {
  api,
  cerrarAdmin,
  crearEscenario,
  equipoDe,
  esperarError,
  exigir,
  filas,
  sesionContrasena,
  sesionPin,
  CLIENTE_RUC,
  type Escenario,
} from '../caja-critica/fabrica-caja';
import {
  aceptar,
  arrancarNotas,
  configurarPse,
  emitirAceptado,
  envioDe,
  estadoDe,
  type AppNotas,
  type Emitido,
  type Libre,
} from './fabrica-notas';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppNotas;
let esc: Escenario;
const A = () => esc.A;
const B = () => esc.B;

beforeAll(async () => {
  ctx = await arrancarNotas();
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

// ------------------------------------------------------------------------------------------------
// La tabla "Endpoints (6b)"
// ------------------------------------------------------------------------------------------------

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Accion = 'COBRAR' | 'EMITIR_NOTA_CREDITO';
type Clase = 'EMPRESA' | 'PUBLICA' | 'PLATAFORMA';

interface Ruta6b {
  clave: string;
  clase: Clase;
  accion: Accion | null;
  modulo: 'FACTURACION' | null;
  metodo: Metodo;
  plantilla: string;
}

const r = (
  metodo: Metodo,
  plantilla: string,
  clase: Clase,
  accion: Accion | null = null,
  modulo: 'FACTURACION' | null = null,
): Ruta6b => ({
  clave: `${metodo.toUpperCase()} ${plantilla.replace(/:[A-Za-z]+/g, ':p')}`,
  clase,
  accion,
  modulo,
  metodo,
  plantilla,
});

const RUTAS: Ruta6b[] = [
  r('get', '/facturacion/comprobantes', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('get', '/facturacion/comprobantes/:id', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('post', '/facturacion/comprobantes/:id/reintento', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('post', '/facturacion/comprobantes/:id/reemision', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('get', '/facturacion/comprobantes/:id/pdf', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('get', '/facturacion/comprobantes/:id/enlace', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('get', '/facturacion/alertas', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('post', '/notas-credito', 'EMPRESA', 'EMITIR_NOTA_CREDITO', 'FACTURACION'),
  r('get', '/padron/ruc/:ruc', 'EMPRESA', 'COBRAR', 'FACTURACION'),
  r('get', '/publico/comprobantes/:sello', 'PUBLICA'),
  r('get', '/plataforma/empresas/:empresaId/emisores/:emisorId/pse', 'PLATAFORMA'),
  r('put', '/plataforma/empresas/:empresaId/emisores/:emisorId/pse', 'PLATAFORMA'),
  r('get', '/plataforma/facturacion/alertas', 'PLATAFORMA'),
  r('get', '/plataforma/padron', 'PLATAFORMA'),
  r('post', '/plataforma/padron/carga', 'PLATAFORMA'),
];

/** Las rutas que cubre el criterio 168. */
const esRutaDe6b = (ruta: string): boolean =>
  /^\/(facturacion|notas-credito|padron)(\/|$)/.test(ruta) ||
  /^\/publico\/comprobantes(\/|$)/.test(ruta) ||
  /^\/plataforma\/empresas\/:[A-Za-z]+\/emisores\/:[A-Za-z]+\/pse$/.test(ruta) ||
  /^\/plataforma\/(facturacion|padron)(\/|$)/.test(ruta);

/** Los prefijos de 6a (criterio 98): ninguna ruta de 6b cuelga de ellos. */
const esRutaDe6a = (ruta: string): boolean =>
  /^\/(turnos|cajas|cuentas|ventas-mostrador|comprobantes)(\/|$)/.test(ruta) ||
  /^\/sucursales\/:[A-Za-z]+\/cajas(\/|$)/.test(ruta) ||
  /^\/emisores\/:[A-Za-z]+\/tasas-igv(\/|$)/.test(ruta);

const normal = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, ':p');

/** Las rutas con sesión de empresa (se prueban por rol, módulo y sucursal). */
const deEmpresa = RUTAS.filter((x) => x.clase === 'EMPRESA');

const rutaConIds = (x: Ruta6b, id: string): string =>
  x.plantilla.replace(':ruc', CLIENTE_RUC.numero).replace(/:[A-Za-z]+/g, id);

// ------------------------------------------------------------------------------------------------
describe('criterio 168 · clasificación de las rutas de 6b', () => {
  it('la matriz de permisos no cambia para las acciones de 6b', () => {
    const ROLES: Rol[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'];
    const fila = (accion: Parameters<typeof requisitoPermiso>[1]) =>
      ROLES.map((rol) => requisitoPermiso(rol, accion));
    expect(fila('EMITIR_NOTA_CREDITO')).toEqual([
      'prohibido',
      'clave',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('COBRAR')).toEqual([
      'prohibido',
      'permitido',
      'prohibido',
      'permitido',
      'permitido',
    ]);
  });

  it('las rutas registradas en Nest son exactamente las de la tabla de endpoints y cada una tiene su acción, su módulo o su guarda', () => {
    const registradas = rutasDeNest(ctx.app).filter((x) => esRutaDe6b(x.ruta));
    const esperadas = new Map(RUTAS.map((x) => [x.clave, x]));
    const problemas: string[] = [];
    const vistas = new Set<string>();
    for (const x of registradas) {
      const clave = `${x.metodo} ${normal(x.ruta)}`;
      if (vistas.has(clave)) problemas.push(`${clave}: ruta registrada dos veces`);
      vistas.add(clave);
      const manejador = x.controlador.prototype[x.manejador] as object;
      const leer = <T>(llave: string | symbol): T | undefined =>
        (Reflect.getMetadata(llave, manejador) as T | undefined) ??
        (Reflect.getMetadata(llave, x.controlador) as T | undefined);
      const esperada = esperadas.get(clave);
      const accion = leer<string>(PERMISO) ?? 'NINGUNA';
      const modulo = leer<string>(REQUIERE_MODULO) ?? null;
      if (esperada === undefined) {
        problemas.push(`${clave}: ruta sin clasificar (tiene ${accion})`);
        continue;
      }
      if (esRutaDe6a(x.ruta)) problemas.push(`${clave}: cuelga de un prefijo de 6a`);
      if (leer<boolean>(SOLO_ADMINISTRADOR) === true) {
        problemas.push(`${clave}: debe usar @Permiso, no @SoloAdministrador`);
      }
      if (esperada.clase === 'PUBLICA') {
        if (leer<boolean>(PUBLICA) !== true) problemas.push(`${clave}: debe ser @Publica()`);
        if (accion !== 'NINGUNA') problemas.push(`${clave}: una ruta pública no lleva @Permiso`);
        if (modulo !== null) problemas.push(`${clave}: una ruta pública no exige módulo`);
        continue;
      }
      if (leer<boolean>(PUBLICA) === true) problemas.push(`${clave}: no puede ser pública`);
      if (esperada.clase === 'PLATAFORMA') {
        if (leer<boolean>(SUPERADMINISTRADOR) !== true) {
          problemas.push(`${clave}: debe llevar la guarda de superadministrador`);
        }
        if (accion !== 'NINGUNA')
          problemas.push(`${clave}: una ruta de plataforma no lleva @Permiso`);
        if (modulo !== null) problemas.push(`${clave}: una ruta de plataforma no exige módulo`);
        continue;
      }
      if (accion !== esperada.accion) {
        problemas.push(`${clave}: debería ser ${esperada.accion} y es ${accion}`);
      }
      if (modulo !== esperada.modulo) {
        problemas.push(`${clave}: debería exigir el módulo ${esperada.modulo} y exige ${modulo}`);
      }
      if (leer<boolean>(REQUIERE_SUCURSAL) !== true)
        problemas.push(`${clave}: falta la sucursal activa`);
      if (leer<boolean>(SUPERADMINISTRADOR) === true) {
        problemas.push(`${clave}: no es una ruta de plataforma`);
      }
    }
    for (const clave of esperadas.keys()) {
      if (!vistas.has(clave)) problemas.push(`${clave}: falta la ruta`);
    }
    expect(registradas.length).toBeGreaterThan(0);
    expect(problemas, problemas.join('\n')).toEqual([]);
  });

  it('ninguna ruta de la tabla de 6b cuelga de los prefijos de 6a ni de /ordenes, /salon o /cocina', () => {
    const cuelgan = RUTAS.filter(
      (x) => esRutaDe6a(x.plantilla) || /^\/(ordenes|salon|cocina)(\/|$)/.test(x.plantilla),
    );
    expect(cuelgan.map((x) => x.clave)).toEqual([]);
    const registradasEnPrefijoDe6a = rutasDeNest(ctx.app)
      .filter((x) => esRutaDe6a(x.ruta))
      .filter((x) => RUTAS.some((t) => t.clave === `${x.metodo} ${normal(x.ruta)}`));
    expect(registradasEnPrefijoDe6a.map((x) => `${x.metodo} ${x.ruta}`)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 169 · rechazos por rol, módulo y sucursal', () => {
  interface Persona {
    nombre: 'mozo' | 'cocina';
    contrasena: string;
    pin: string;
  }
  let sesiones: Persona[] | undefined;
  async function prepararSesiones(): Promise<Persona[]> {
    if (sesiones) return sesiones;
    const hechas: Persona[] = [];
    for (const nombre of ['mozo', 'cocina'] as const) {
      const persona = A().personas[nombre]!;
      const tokenEquipo = await equipoDe(ctx, persona);
      hechas.push({
        nombre,
        contrasena: await sesionContrasena(ctx, persona, A().S1),
        pin: await sesionPin(ctx, persona, tokenEquipo, A().S1),
      });
    }
    sesiones = hechas;
    return hechas;
  }

  const foto = async () => {
    const cuenta = async (sql: string) => Number((await filas(sql, [A().id]))[0]!.n);
    return {
      auditoria: await cuenta('SELECT count(*) AS n FROM auditoria WHERE empresa_id = $1'),
      comprobantes: await cuenta('SELECT count(*) AS n FROM comprobante WHERE empresa_id = $1'),
      series: await cuenta(
        'SELECT coalesce(sum(ultimo_numero), 0) + count(*) AS n FROM serie WHERE empresa_id = $1',
      ),
      eventos: ctx.publicador.eventos().length,
    };
  };

  const cuerpoDe = (metodo: Metodo): unknown => (metodo === 'get' ? undefined : {});

  it('Mozo y Cocina/Barra, con contraseña y con PIN, reciben 403 PROHIBIDO en todas las rutas de 6b, sin cambios, sin auditoría y sin eventos', async () => {
    const todas = await prepararSesiones();
    const antes = await foto();
    const fallos: string[] = [];
    for (const ruta of deEmpresa) {
      for (const persona of todas) {
        for (const [clase, token] of [
          ['contraseña', persona.contrasena],
          ['PIN', persona.pin],
        ] as const) {
          const res = await api(
            ctx,
            token,
            ruta.metodo,
            rutaConIds(ruta, randomUUID()),
            cuerpoDe(ruta.metodo),
            { 'Idempotency-Key': randomUUID() },
          );
          if (res.status !== 403 || res.body?.codigo !== 'PROHIBIDO') {
            fallos.push(
              `${ruta.clave} · ${persona.nombre} (${clase}): ${res.status} ${res.body?.codigo ?? res.text.slice(0, 80)}`,
            );
          }
        }
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await foto()).toEqual(antes);
  });

  it('sin sucursal activa responde 409 SUCURSAL_NO_ELEGIDA en las rutas con sesión de empresa, incluso a un rol que sería rechazado', async () => {
    const sinSucursal = [
      await sesionContrasena(ctx, A().personas.cajero!, null),
      await sesionContrasena(ctx, A().personas.mozoMulti!, null),
      await sesionContrasena(ctx, A().base.admin, null),
    ];
    const fallos: string[] = [];
    for (const token of sinSucursal) {
      for (const ruta of deEmpresa) {
        const res = await api(
          ctx,
          token,
          ruta.metodo,
          rutaConIds(ruta, randomUUID()),
          cuerpoDe(ruta.metodo),
          { 'Idempotency-Key': randomUUID() },
        );
        if (res.status !== 409 || res.body?.codigo !== 'SUCURSAL_NO_ELEGIDA') {
          fallos.push(`${ruta.clave}: ${res.status} ${res.body?.codigo}`);
        }
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
  });

  it('con el módulo FACTURACION fuera del plan de la sucursal, 403 MODULO_NO_INCLUIDO en todas las rutas de 6b con sesión', async () => {
    const supervisor = A().token.supervisorS4!;
    const plan = await api(ctx, esc.sa.token, 'post', '/plataforma/planes', {
      codigo: `P-${randomUUID().slice(0, 8)}`,
      nombre: 'Plan de prueba sin facturación',
      diasGracia: 7,
      modulos: ['SALON', 'COCINA', 'CAJA', 'PEDIDOS_WEB', 'INVENTARIO', 'REPORTES'],
      porDefecto: false,
      activo: true,
      motivo: 'Plan de prueba',
    });
    exigir(plan, 201, 'Crear el plan sin FACTURACION');
    exigir(
      await api(
        ctx,
        esc.sa.token,
        'patch',
        `/plataforma/suscripciones/${A().base.suscripciones[A().S4!]!.id}`,
        { planId: plan.body.id, motivo: 'Cambio de plan de prueba' },
      ),
      200,
      'Cambiar el plan de S4',
    );
    const fallos: string[] = [];
    for (const ruta of deEmpresa) {
      const res = await api(
        ctx,
        supervisor,
        ruta.metodo,
        rutaConIds(ruta, randomUUID()),
        cuerpoDe(ruta.metodo),
        { 'Idempotency-Key': randomUUID() },
      );
      if (res.status !== 403 || res.body?.codigo !== 'MODULO_NO_INCLUIDO') {
        fallos.push(`${ruta.clave}: ${res.status} ${res.body?.codigo}`);
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// Las plataformas: el superadministrador, los emisores de otra empresa y la auditoría de plataforma
// ------------------------------------------------------------------------------------------------
describe('criterio 170 · rutas de plataforma', () => {
  const rutaPse = (empresaId: string, emisorId: string) =>
    `/plataforma/empresas/${empresaId}/emisores/${emisorId}/pse`;
  // Desde 002 la auditoría de plataforma vive en `auditoria` con `origen = 'plataforma'` y `accion` = la operación. Se
  // limita al superadministrador de esta prueba para que otros archivos que corren en paralelo no sumen filas.
  const auditoriaPlataforma = (operacion: string, empresaId: string | null) =>
    filas(
      `SELECT * FROM auditoria
        WHERE origen = 'plataforma' AND accion = $1 AND empresa_id IS NOT DISTINCT FROM $2
          AND actor_superadministrador_id = $3
        ORDER BY ocurrido_en, id`,
      [operacion, empresaId, esc.sa.id],
    );
  /**
   * Filas de auditoría que un intento no autorizado dejaría: las de configurar el PSE de A o de B (de cualquier actor) y
   * las de cargar el padrón que no son de un superadministrador.
   */
  const filasDePlataforma = async (): Promise<string> =>
    (
      await filas(
        `SELECT count(*)::text AS n FROM auditoria
          WHERE origen = 'plataforma'
            AND ((accion = 'configurar_pse_emisor' AND empresa_id = ANY($1::uuid[]))
              OR (accion = 'cargar_padron' AND actor_superadministrador_id IS NULL))`,
        [[A().id, B().id]],
      )
    )[0]!.n as string;

  it('las sesiones de empresa, de soporte y de equipo reciben 401 NO_AUTENTICADO en las rutas de plataforma de 6b y no se ejecuta nada', async () => {
    const soporte = await sesionDeSoporte(ctx.app, esc.sa.token, A().id, A().S1);
    const equipo = await equipoDe(ctx, A().personas.cajero!);
    const intentos: Array<[string, string | undefined]> = [
      ['sin token', undefined],
      ['sesión de empresa', A().token.admin],
      ['sesión de soporte', soporte],
      ['token de equipo', equipo],
    ];
    const antes = await filasDePlataforma();
    const fallos: string[] = [];
    for (const ruta of RUTAS.filter((x) => x.clase === 'PLATAFORMA')) {
      for (const [que, token] of intentos) {
        const res = await api(
          ctx,
          token,
          ruta.metodo,
          rutaConIds(ruta, randomUUID()),
          ruta.metodo === 'get' ? undefined : { modo: 'SIMULADO' },
        );
        if (res.status !== 401 || res.body?.codigo !== 'NO_AUTENTICADO') {
          fallos.push(`${ruta.clave} (${que}): ${res.status} ${res.body?.codigo}`);
        }
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await filasDePlataforma()).toBe(antes);
  });

  it('un emisor de otra empresa o inexistente en la ruta es 404 con el mismo cuerpo', async () => {
    const deB = rutaPse(A().id, B().emisor1);
    const inexistente = rutaPse(A().id, randomUUID());
    for (const metodo of ['get', 'put'] as const) {
      const cuerpo = metodo === 'put' ? { modo: 'SIMULADO' } : undefined;
      const ajeno = await api(ctx, esc.sa.token, metodo, deB, cuerpo);
      const nada = await api(ctx, esc.sa.token, metodo, inexistente, cuerpo);
      expect(ajeno.status, `${metodo} ${ajeno.text}`).toBe(404);
      expect(nada.status).toBe(404);
      expect(ajeno.body).toEqual(nada.body);
    }
    // Una empresa que no es la del emisor.
    const cruzada = await api(ctx, esc.sa.token, 'get', rutaPse(B().id, A().emisor1));
    expect(cruzada.status).toBe(404);
  });

  it('configurar el PSE deja una fila configurar_pse_emisor con el modo y los nombres de los campos, sin los valores; repetir la misma configuración no deja otra', async () => {
    const secretos = { usuario: 'ana-p10-secreta', clave: 'Clave-P10-9981-xyz' };
    const antes = await auditoriaPlataforma('configurar_pse_emisor', A().id);
    const res = await configurarPse(ctx, esc.sa.token, A().id, A().emisor2!, {
      modo: 'SIMULADO',
      credencial: secretos,
    });
    exigir(res, 200, 'Configurar el PSE (006, criterio 122)');
    expect(res.body).toMatchObject({
      emisorId: A().emisor2,
      modo: 'SIMULADO',
      credencialConfigurada: true,
    });
    expect([...(res.body.camposCredencial as string[])].sort()).toEqual(['clave', 'usuario']);
    expect(JSON.stringify(res.body)).not.toContain(secretos.clave);
    expect(JSON.stringify(res.body)).not.toContain(secretos.usuario);
    const despues = await auditoriaPlataforma('configurar_pse_emisor', A().id);
    expect(despues).toHaveLength(antes.length + 1);
    const texto = JSON.stringify(despues.at(-1));
    expect(texto).toContain('SIMULADO');
    expect(texto).toContain('usuario');
    expect(texto).toContain('clave');
    for (const valor of Object.values(secretos)) expect(texto).not.toContain(valor);
    // Repetir la misma configuración (la credencial ausente se conserva) responde 200 sin otra fila.
    const igual = await configurarPse(ctx, esc.sa.token, A().id, A().emisor2!, {
      modo: 'SIMULADO',
    });
    exigir(igual, 200, 'Repetir la configuración');
    expect(await auditoriaPlataforma('configurar_pse_emisor', A().id)).toHaveLength(despues.length);
    // Se guarda quién la escribió: el superadministrador.
    const [fila] = await filas(
      'SELECT creado_por_superadministrador_id, creado_por_usuario_id FROM configuracion_pse WHERE emisor_id = $1',
      [A().emisor2],
    );
    expect(fila).toEqual({
      creado_por_superadministrador_id: esc.sa.id,
      creado_por_usuario_id: null,
    });
  });

  it('las demás rutas de plataforma de 6b responden al superadministrador: alertas, estado del padrón y la carga a pedido (202, con su fila de auditoría)', async () => {
    const alertas = await api(ctx, esc.sa.token, 'get', '/plataforma/facturacion/alertas');
    exigir(alertas, 200, 'Alertas de plataforma (006, criterio 133)');
    expect(Array.isArray(alertas.body)).toBe(true);
    const padron = await api(ctx, esc.sa.token, 'get', '/plataforma/padron');
    exigir(padron, 200, 'Estado del padrón (006, criterio 138)');
    expect(Object.keys(padron.body as Libre).sort()).toEqual(
      ['cargadoEn', 'fechaArchivo', 'filas', 'ultimoError', 'ultimoIntentoEn'].sort(),
    );
    const antes = await auditoriaPlataforma('cargar_padron', null);
    const carga = await api(ctx, esc.sa.token, 'post', '/plataforma/padron/carga');
    expect(carga.status, carga.text).toBe(202);
    const despues = await auditoriaPlataforma('cargar_padron', null);
    expect(despues).toHaveLength(antes.length + 1);
    expect(JSON.stringify(despues.at(-1))).not.toMatch(/postgres:\/\/|password|clave/i);
  });
});

// ------------------------------------------------------------------------------------------------
// El alcance, la reemisión, el reintento y la trazabilidad (con comprobantes reales y el simulador)
// ------------------------------------------------------------------------------------------------
interface Escena {
  x1: Emitido; // aceptada, de `cajero` (S1)
  x2: Emitido; // aceptada, de `cajero2` (S1)
  x3: Emitido; // aceptada, de `cajeroS3` (S3)
  p1: Emitido; // POR_ENVIAR, de `cajero`
  ra: Emitido; // RECHAZADA, de `cajero`
  rb: Emitido; // RECHAZADA, de `cajero2`
  rc: Emitido; // RECHAZADA, de `cajeroS3`
  deB: string; // aceptada, de la empresa B
}
let escenaPendiente: Promise<Escena> | undefined;
const escena = (): Promise<Escena> =>
  (escenaPendiente ??= (async () => {
    for (const [empresa, emisores] of [
      [A(), [A().emisor1]],
      [B(), [B().emisor1]],
    ] as const) {
      for (const emisor of emisores) {
        exigir(
          await configurarPse(ctx, esc.sa.token, empresa.id, emisor),
          200,
          'Configurar el PSE SIMULADO del emisor (006, criterio 122)',
        );
      }
    }
    const nuevo = (o: Parameters<typeof emitirAceptado>[2]) => emitirAceptado(ctx, A(), o);
    const rechazada = async (o: Parameters<typeof emitirAceptado>[2]) => {
      const e = await nuevo({ ...o, aceptado: false });
      ctx.simulador.reglas.rechazarNumero(e.numero, {
        codigo: '2800',
        mensaje: 'Rechazo de prueba',
      });
      try {
        await ctx.procesar(A().id, e.comprobanteId);
      } finally {
        ctx.simulador.reglas.limpiar();
      }
      expect(await estadoDe(e.comprobanteId)).toBe('RECHAZADO');
      return e;
    };
    const x1 = await nuevo({ quien: 'cajero', caja: 'caja1' });
    const x2 = await nuevo({ quien: 'cajero2', caja: 'caja2' });
    const x3 = await nuevo({ sucursal: 'S3', caja: 'caja1', quien: 'cajeroS3' });
    const p1 = await nuevo({ quien: 'cajero', caja: 'caja1', aceptado: false });
    const ra = await rechazada({ quien: 'cajero', caja: 'caja1' });
    const rb = await rechazada({ quien: 'cajero2', caja: 'caja2' });
    const rc = await rechazada({ sucursal: 'S3', caja: 'caja1', quien: 'cajeroS3' });
    const deB = await emitirAceptado(ctx, B(), { quien: 'cajero' });
    return { x1, x2, x3, p1, ra, rb, rc, deB: deB.comprobanteId };
  })());

describe('criterio 169 · alcance de cada rol', () => {
  const sesion = async (
    persona: 'admin' | 'cajero' | 'cajero2' | 'supervisor' | 'cajeroS3' | 'supervisorS3',
  ) => A().token[persona]!;
  const adminEn = (sucursalId: string) => sesionContrasena(ctx, A().base.admin, sucursalId);
  const idsDelPanel = (res: { body: Libre }) =>
    (res.body.items as Libre[]).map((i) => i.id as string);

  it('el panel: el Cajero ve solo los de sus turnos (y sucursalId es 400), el Supervisor los de su sucursal y el Administrador los de todas sus sucursales, con sucursalId opcional', async () => {
    const e = await escena();
    const panel = (token: string, consulta = '') =>
      api(ctx, token, 'get', `/facturacion/comprobantes${consulta}`);
    const delCajero = await panel(await sesion('cajero'));
    exigir(delCajero, 200, 'Panel del Cajero (006, criterio 135)');
    const idsCajero = idsDelPanel(delCajero);
    expect(idsCajero).toEqual(
      expect.arrayContaining([e.x1.comprobanteId, e.p1.comprobanteId, e.ra.comprobanteId]),
    );
    for (const ajeno of [e.x2, e.x3, e.rb, e.rc])
      expect(idsCajero).not.toContain(ajeno.comprobanteId);
    esperarError(
      await panel(await sesion('cajero'), `?sucursalId=${A().S3}`),
      400,
      'DATOS_INVALIDOS',
    );

    const delCajero2 = idsDelPanel(await panel(await sesion('cajero2')));
    expect(delCajero2).toEqual(expect.arrayContaining([e.x2.comprobanteId, e.rb.comprobanteId]));
    for (const ajeno of [e.x1, e.x3, e.ra, e.rc])
      expect(delCajero2).not.toContain(ajeno.comprobanteId);

    const delSupervisor = idsDelPanel(await panel(await sesion('supervisor')));
    expect(delSupervisor).toEqual(
      expect.arrayContaining([e.x1, e.x2, e.p1, e.ra, e.rb].map((x) => x.comprobanteId)),
    );
    for (const ajeno of [e.x3, e.rc]) expect(delSupervisor).not.toContain(ajeno.comprobanteId);

    const admin = await adminEn(A().S1);
    const delAdmin = idsDelPanel(await panel(admin));
    expect(delAdmin).toEqual(
      expect.arrayContaining(
        [e.x1, e.x2, e.x3, e.p1, e.ra, e.rb, e.rc].map((x) => x.comprobanteId),
      ),
    );
    expect(delAdmin).not.toContain(e.deB);
    const soloS3 = idsDelPanel(await panel(admin, `?sucursalId=${A().S3}`));
    expect(soloS3).toEqual(expect.arrayContaining([e.x3.comprobanteId, e.rc.comprobanteId]));
    for (const ajeno of [e.x1, e.x2, e.ra]) expect(soloS3).not.toContain(ajeno.comprobanteId);
    // Una sucursal en la que no es Administrador (la de otra empresa) es 404.
    expect((await panel(admin, `?sucursalId=${B().S1}`)).status).toBe(404);

    const delSupervisorS3 = idsDelPanel(await panel(await sesion('supervisorS3')));
    expect(delSupervisorS3).toEqual(
      expect.arrayContaining([e.x3.comprobanteId, e.rc.comprobanteId]),
    );
    for (const ajeno of [e.x1, e.x2]) expect(delSupervisorS3).not.toContain(ajeno.comprobanteId);
  });

  it('el detalle, el PDF y el enlace siguen el mismo alcance: lo propio 200; el comprobante de otro turno, 403 PROHIBIDO al Cajero; el de otra sucursal o empresa, 404', async () => {
    const e = await escena();
    const tabla: Array<[string, () => Promise<string>, Emitido | string, number[]]> = [
      ['Cajero · suyo', () => sesion('cajero'), e.x1, [200]],
      ['Cajero · de otro Cajero', () => sesion('cajero'), e.x2, [403]],
      ['Cajero · de otra sucursal', () => sesion('cajero'), e.x3, [403, 404]],
      ['Cajero 2 · de otro Cajero', () => sesion('cajero2'), e.x1, [403]],
      ['Cajero 2 · suyo', () => sesion('cajero2'), e.x2, [200]],
      ['Supervisor · de un Cajero', () => sesion('supervisor'), e.x2, [200]],
      ['Supervisor · de otra sucursal', () => sesion('supervisor'), e.x3, [404]],
      ['Administrador en S1 · de S1', () => adminEn(A().S1), e.x1, [200]],
      ['Administrador en S1 · de S3', () => adminEn(A().S1), e.x3, [404]],
      ['Administrador en S3 · de S3', () => adminEn(A().S3), e.x3, [200]],
      ['Supervisor de S3 · de S1', () => sesion('supervisorS3'), e.x1, [404]],
      ['Supervisor · de otra empresa', () => sesion('supervisor'), e.deB, [404]],
      ['Supervisor · inexistente', () => sesion('supervisor'), randomUUID(), [404]],
    ];
    const fallos: string[] = [];
    for (const sufijo of ['', '/pdf', '/enlace']) {
      for (const [que, token, cual, estados] of tabla) {
        const id = typeof cual === 'string' ? cual : cual.comprobanteId;
        const res = await api(
          ctx,
          await token(),
          'get',
          `/facturacion/comprobantes/${id}${sufijo}`,
        );
        if (!estados.includes(res.status)) {
          fallos.push(
            `GET …${sufijo || '/:id'} · ${que}: ${res.status} (se esperaba ${estados.join(' o ')})`,
          );
        }
        if (estados[0] === 200 && res.status === 200 && sufijo === '/pdf') {
          if (!/application\/pdf/.test(String(res.headers['content-type']))) {
            fallos.push(`GET …/pdf · ${que}: no es application/pdf`);
          }
        }
        if (estados[0] === 200 && res.status === 200 && sufijo === '/enlace') {
          if (typeof res.body?.url !== 'string' || typeof res.body?.expiraEn !== 'string') {
            fallos.push(`GET …/enlace · ${que}: sin url y expiraEn`);
          }
        }
        if (estados.length === 1 && estados[0] === 403 && res.body?.codigo !== 'PROHIBIDO') {
          fallos.push(`GET …${sufijo || '/:id'} · ${que}: código ${res.body?.codigo}`);
        }
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    // Lo de otra empresa y lo inexistente responden igual.
    const ajeno = await api(
      ctx,
      await sesion('supervisor'),
      'get',
      `/facturacion/comprobantes/${e.deB}`,
    );
    const nada = await api(
      ctx,
      await sesion('supervisor'),
      'get',
      `/facturacion/comprobantes/${randomUUID()}`,
    );
    expect(ajeno.body).toEqual(nada.body);
  });

  it('las alertas: el Cajero cuenta lo suyo, el Supervisor su sucursal y el Administrador todas las suyas (o la que pida con sucursalId)', async () => {
    await escena();
    const alertas = async (token: string, consulta = '') => {
      const res = await api(ctx, token, 'get', `/facturacion/alertas${consulta}`);
      return res;
    };
    const cajero = await alertas(await sesion('cajero'));
    exigir(cajero, 200, 'Alertas del Cajero (006, criterio 133)');
    expect(cajero.body).toMatchObject({
      rechazados: 1,
      demorados: 0,
      detenidos: 0,
      sinConfiguracion: 0,
    });
    expect(typeof cajero.body.modoSimulado).toBe('boolean');
    expect((await alertas(await sesion('cajero2'))).body).toMatchObject({ rechazados: 1 });
    expect((await alertas(await sesion('supervisor'))).body).toMatchObject({
      rechazados: 2,
      modoSimulado: true,
    });
    const admin = await adminEn(A().S1);
    expect((await alertas(admin)).body).toMatchObject({ rechazados: 3, modoSimulado: true });
    expect((await alertas(admin, `?sucursalId=${A().S3}`)).body).toMatchObject({ rechazados: 1 });
    expect((await alertas(admin, `?sucursalId=${A().S1}`)).body).toMatchObject({ rechazados: 2 });
    expect((await alertas(await sesion('supervisorS3'))).body).toMatchObject({ rechazados: 1 });
    expect((await alertas(admin, `?sucursalId=${B().S1}`)).status).toBe(404);
    esperarError(
      await alertas(await sesion('cajero'), `?sucursalId=${A().S3}`),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('el reintento: el Cajero solo el de sus turnos (403 en los de otro), el Supervisor el de su sucursal (404 en otra) y uno terminado es 409 ENVIO_TERMINADO', async () => {
    const e = await escena();
    const reintento = (token: string, id: string) =>
      api(ctx, token, 'post', `/facturacion/comprobantes/${id}/reintento`, undefined, {
        'Idempotency-Key': randomUUID(),
      });
    esperarError(await reintento(await sesion('cajero2'), e.p1.comprobanteId), 403, 'PROHIBIDO');
    esperarError(
      await reintento(await sesion('supervisorS3'), e.p1.comprobanteId),
      404,
      'NO_ENCONTRADO',
    );
    const propio = await reintento(await sesion('cajero'), e.p1.comprobanteId);
    expect(propio.status, propio.text).toBe(202);
    expect(propio.body).toMatchObject({ estado: 'PENDIENTE' });
    const delSupervisor = await reintento(await sesion('supervisor'), e.p1.comprobanteId);
    expect(delSupervisor.status, delSupervisor.text).toBe(202);
    const admin = await reintento(await adminEn(A().S1), e.p1.comprobanteId);
    expect(admin.status, admin.text).toBe(202);
    esperarError(
      await reintento(await sesion('cajero'), e.x1.comprobanteId),
      409,
      'ENVIO_TERMINADO',
    );
    // El envío de la boleta de otra empresa no existe para A.
    expect((await reintento(await sesion('supervisor'), e.deB)).status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterios 169 y 171 · reemisión: alcance, auditoría y trazabilidad', () => {
  const reemitir = (
    token: string,
    id: string,
    cuerpo: Libre = { tipo: 'BOLETA' },
    ik = randomUUID(),
  ) =>
    api(ctx, token, 'post', `/facturacion/comprobantes/${id}/reemision`, cuerpo, {
      'Idempotency-Key': ik,
    });
  const auditoriaReemision = (rechazadoId: string) =>
    filas(
      `SELECT * FROM auditoria WHERE empresa_id = $1 AND accion = 'reemitir_comprobante' AND detalle->'rechazado'->>'id' = $2`,
      [A().id, rechazadoId],
    );
  const totalDeAuditoria = async () =>
    Number(
      (await filas('SELECT count(*)::text AS n FROM auditoria WHERE empresa_id = $1', [A().id]))[0]!
        .n,
    );

  it('el Cajero reemite solo los suyos (403 PROHIBIDO en los de otro); el Supervisor, los de su sucursal (404 en otra); el Administrador, los de la sucursal que tiene activa; cada reemisión deja una fila reemitir_comprobante y los rechazos y el reintento no', async () => {
    const e = await escena();
    esperarError(await reemitir(A().token.cajero2!, e.ra.comprobanteId), 403, 'PROHIBIDO');
    esperarError(await reemitir(A().token.supervisorS3!, e.rb.comprobanteId), 404, 'NO_ENCONTRADO');
    esperarError(
      await reemitir(await sesionContrasena(ctx, A().base.admin, A().S1), e.rc.comprobanteId),
      404,
      'NO_ENCONTRADO',
    );
    expect(await auditoriaReemision(e.ra.comprobanteId)).toEqual([]);
    expect(
      await filas('SELECT 1 FROM comprobante WHERE reemplaza_a_id = $1', [e.ra.comprobanteId]),
    ).toEqual([]);

    const delCajero = await reemitir(A().token.cajero!, e.ra.comprobanteId);
    expect(delCajero.status, delCajero.text).toBe(201);
    const delSupervisor = await reemitir(A().token.supervisor!, e.rb.comprobanteId);
    expect(delSupervisor.status, delSupervisor.text).toBe(201);
    const delAdmin = await reemitir(
      await sesionContrasena(ctx, A().base.admin, A().S3),
      e.rc.comprobanteId,
      { tipo: 'FACTURA', cliente: CLIENTE_RUC },
    );
    expect(delAdmin.status, delAdmin.text).toBe(201);

    // reemitir_comprobante deja exactamente una fila por reemisión, con el actor y el detalle.
    const de = [
      [e.ra, 'BOLETA', null],
      [e.rb, 'BOLETA', null],
      [e.rc, 'FACTURA', { tipoDocumento: 'RUC', numero: CLIENTE_RUC.numero }],
    ] as const;
    for (const [rechazado, tipo, cliente] of de) {
      const filasDeReemision = await auditoriaReemision(rechazado.comprobanteId);
      expect(filasDeReemision, `${rechazado.numero}`).toHaveLength(1);
      const nuevo = (
        await filas('SELECT id, tipo, serie, numero FROM comprobante WHERE reemplaza_a_id = $1', [
          rechazado.comprobanteId,
        ])
      )[0]!;
      expect(filasDeReemision[0]!.detalle).toMatchObject({
        rechazado: { id: rechazado.comprobanteId, numero: rechazado.numero },
        nuevo: { id: nuevo.id },
        tipo,
        cliente,
      });
      expect(filasDeReemision[0]!.entidad_id).toBe(nuevo.id);
    }
    const [filaRa] = await auditoriaReemision(e.ra.comprobanteId);
    expect(filaRa!.actor_usuario_id).toBe(A().personas.cajero!.id);
    const [filaRb] = await auditoriaReemision(e.rb.comprobanteId);
    expect(filaRb!.actor_usuario_id).toBe(A().personas.supervisor!.id);

    // Los rechazos (YA_REEMPLAZADO, COMPROBANTE_NO_RECHAZADO) y el reintento manual no dejan ninguna fila.
    const antes = await totalDeAuditoria();
    esperarError(
      await reemitir(A().token.supervisor!, e.p1.comprobanteId),
      409,
      'COMPROBANTE_NO_RECHAZADO',
    );
    const yaReemplazado = await reemitir(A().token.supervisor!, e.ra.comprobanteId);
    esperarError(yaReemplazado, 409, 'YA_REEMPLAZADO');
    expect(yaReemplazado.body.comprobanteId).toBeTruthy();
    const reintento = await api(
      ctx,
      A().token.supervisor!,
      'post',
      `/facturacion/comprobantes/${e.p1.comprobanteId}/reintento`,
      undefined,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(reintento.status, reintento.text).toBe(202);
    expect(await totalDeAuditoria()).toBe(antes);
  });

  it('la réplica de una reemisión (misma IK) devuelve lo mismo sin dejar otra fila', async () => {
    const e = await escena();
    const nueva = await emitirAceptado(ctx, A(), {
      quien: 'cajero',
      caja: 'caja1',
      aceptado: false,
    });
    ctx.simulador.reglas.rechazarNumero(nueva.numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    try {
      await ctx.procesar(A().id, nueva.comprobanteId);
    } finally {
      ctx.simulador.reglas.limpiar();
    }
    void e;
    const ik = randomUUID();
    const primera = await reemitir(
      A().token.supervisor!,
      nueva.comprobanteId,
      { tipo: 'BOLETA' },
      ik,
    );
    expect(primera.status, primera.text).toBe(201);
    const replica = await reemitir(
      A().token.supervisor!,
      nueva.comprobanteId,
      { tipo: 'BOLETA' },
      ik,
    );
    expect(replica.status, replica.text).toBe(201);
    expect(replica.body).toEqual(primera.body);
    expect(await auditoriaReemision(nueva.comprobanteId)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 171 · trazabilidad de los envíos, los intentos y los estados', () => {
  it('la fila del envío queda con quien emitió, y el reintento manual con quien reintentó (persona y equipo, con PIN)', async () => {
    const supervisor = A().personas.supervisor!;
    const tokenEquipo = await equipoDe(ctx, supervisor);
    const equipoId = partesDeToken(tokenEquipo).id;
    const conPin = await sesionPin(ctx, supervisor, tokenEquipo, A().S1);
    // Un Supervisor cobra en su propio turno: el autor de la fila del envío es el Supervisor.
    const cobrado = await emitirAceptado(ctx, A(), {
      quien: 'supervisor',
      caja: 'caja3',
      aceptado: false,
    });
    const delEnvio = await envioDe(cobrado.comprobanteId);
    expect(delEnvio).toMatchObject({
      creado_por_usuario_id: supervisor.id,
      creado_por_sistema: null,
    });
    // El reintento manual lo hace el Supervisor con PIN desde su equipo (un minuto después, para que haya algo que mover).
    ctx.reloj.avanzar(60_000);
    const reintento = await api(
      ctx,
      conPin,
      'post',
      `/facturacion/comprobantes/${cobrado.comprobanteId}/reintento`,
      undefined,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(reintento.status, reintento.text).toBe(202);
    const trasReintento = await envioDe(cobrado.comprobanteId);
    expect(trasReintento).toMatchObject({
      actualizado_por_usuario_id: supervisor.id,
      actualizado_por_equipo_id: equipoId,
    });
  });

  it('lo que hace el worker queda con el actor worker:envio-pse: el intento, el envío y el cambio de estado del comprobante', async () => {
    const o = await emitirAceptado(ctx, A(), { quien: 'cajero', caja: 'caja1', aceptado: false });
    await aceptar(ctx, A(), o.comprobanteId);
    const intentos = await filas('SELECT * FROM intento_pse WHERE comprobante_id = $1', [
      o.comprobanteId,
    ]);
    expect(intentos.length).toBeGreaterThanOrEqual(1);
    for (const i of intentos) {
      expect(i).toMatchObject({
        creado_por_sistema: 'worker:envio-pse',
        creado_por_usuario_id: null,
      });
    }
    expect(await envioDe(o.comprobanteId)).toMatchObject({
      actualizado_por_sistema: 'worker:envio-pse',
      actualizado_por_usuario_id: null,
    });
    const [comprobante] = await filas(
      'SELECT estado, actualizado_por_sistema, actualizado_por_usuario_id FROM comprobante WHERE id = $1',
      [o.comprobanteId],
    );
    expect(comprobante).toEqual({
      estado: 'ACEPTADO',
      actualizado_por_sistema: 'worker:envio-pse',
      actualizado_por_usuario_id: null,
    });
  });
});
