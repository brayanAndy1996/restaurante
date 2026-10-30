// spec: 004-salon-cocina (pruebas protegidas)
//
// P6 (parte 1) · Credenciales del puente de impresión (ruta crítica), entrega 3b, criterios 106 a 111 y 130:
// - 106: solo el Administrador crea el código `vi.<empresa>.<id>.<secreto>` de una sucursal de su empresa (201 con
//   `{ token, qr, expiraEn }`, vence a los 10 minutos, el QR trae la URL de la API y el token); crear otro invalida
//   los pendientes de esa sucursal; solo se guarda la huella del secreto;
// - 107: vincular con el código (201 con el token `pu.<empresa>.<id>.<secreto>`, el puente, la sucursal y la
//   configuración); vencida, usada, de otra vinculación, adulterada, inexistente o de B es 401 `VINCULACION_INVALIDA`
//   con el mismo cuerpo y sin crear nada; dos usos simultáneos, exactamente uno gana;
// - 108: un puente activo por sucursal: vincular revoca al anterior (su token da 401 y su conexión se cierra);
//   listar y revocar son del Administrador; revocar dos veces no cambia nada;
// - 109: el token `pu.` solo sirve en `/puente/*` y un `se.`, `sa.`, `eq.` o `vi.` no sirve allí; sin
//   `Authorization`, 401; sin bloqueo por intentos; el actor de la petición es `puente:<id>`;
// - 111: Socket.IO, espacio `/puente`: entra con `pu.`, se rechaza con cualquier otro token (`NO_AUTENTICADO`), una
//   persona no entra al espacio del puente ni un puente al de la PWA, y la señal se actualiza al conectar y al
//   desconectar;
// - 130: `crear_impresora`, `modificar_impresora`, `configurar_destino_estacion`, `configurar_impresion_sucursal`,
//   `crear_vinculacion_puente`, `vincular_puente` (actor `puente:<id>`) y `revocar_puente` dejan una fila cada una;
//   los latidos, los resultados, las páginas de prueba y las reimpresiones no dejan ninguna.
// Hoy las rutas de 3b responden 500 "No implementado" (sin `@Permiso`, con credenciales que rechazan todo), las
// tablas no existen y el espacio `/puente` rechaza toda conexión con "No implementado": las pruebas fallan por eso.
// Las pruebas que hoy pasan son las que fijó la fase A (401 sin credencial, 401 con otro tipo de token, 403 con
// contraseña temporal) y llevan un control o un aviso en su descripción.
import { randomUUID } from 'node:crypto';
import {
  configuracionPuenteSchema,
  leerQrPuente,
  puenteRespuestaSchema,
  vinculacionRespuestaSchema,
  vincularPuenteRespuestaSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MINUTO,
  crearUsuario,
  ingresarOk,
  nuevoSuperadmin,
  textoDeAuditoria,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';
import { equipoDe, sesionPin } from '../carta-critica/fabrica-permisos-carta';
import { ClienteTiempoReal } from '../soporte';
import { abrirCliente } from '../utilidades';
import {
  ENTRADA_PUENTE,
  ROLES_SIN_ADMINISTRAR,
  URL_API_PUBLICA,
  arrancarP6,
  auditoriaImpresion,
  auditoriaNueva,
  autorDe,
  conClave,
  conEmpresaDe,
  conIdDe,
  conSecretoAdulterado,
  conSecretoDe,
  contarAuditoria,
  crearEmpresaP6,
  crearEstacion,
  crearImpresora,
  crearPrueba,
  crearRolesP6,
  crearVinculacion,
  cuerpoDe,
  exigirEstado,
  exigirSinFallos,
  instantaneaImpresion,
  listarPuentes,
  llamar,
  llamarPuente,
  nuevoPuente,
  partesDe,
  regexToken,
  tokenAleatorio,
  trabajosDelPuente,
  vincular,
  type AppP6,
  type EmpresaP6,
  type PuenteVinculado,
} from './fabrica-p6';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP6;
let admin: Client;
let sa: SuperadminDePrueba;

beforeAll(async () => {
  ctx = await arrancarP6({ poolMax: 2 });
  admin = await abrirCliente('admin');
  sa = await nuevoSuperadmin(ctx);
});

afterAll(async () => {
  for (const cliente of abiertos.splice(0)) cliente.cerrar();
  await ctx?.cerrar();
  await admin?.end();
});

// ------------------------------------------------------------------------------------------------
// Conexiones de Socket.IO que hay que cerrar
// ------------------------------------------------------------------------------------------------
const abiertos: ClienteTiempoReal[] = [];

afterEach(() => {
  for (const cliente of abiertos.splice(0)) cliente.cerrar();
});

async function conectarPuente(token: string): Promise<ClienteTiempoReal> {
  const cliente = await ClienteTiempoReal.conectar(ctx.app, { token }, { espacio: '/puente' });
  abiertos.push(cliente);
  return cliente;
}

/** Intenta entrar al espacio indicado; devuelve el error de la conexión (o `null` si entró). */
async function intentar(
  auth: { token?: string; equipo?: string },
  espacio = '/puente',
): Promise<string | null> {
  const { cliente, error } = await ClienteTiempoReal.intentarConectar(ctx.app, auth, { espacio });
  if (cliente !== null) abiertos.push(cliente);
  return error;
}

// ------------------------------------------------------------------------------------------------
// Utilidades de las pruebas
// ------------------------------------------------------------------------------------------------

interface RutaPuente {
  metodo: 'get' | 'post';
  ruta: string;
  cuerpo?: unknown;
}

/** Las cuatro rutas de `/puente/*` que exigen `pu.…` (con cuerpos válidos para que solo importe la credencial). */
const rutasDelPuente = (trabajoId: string = randomUUID()): RutaPuente[] => [
  { metodo: 'get', ruta: '/puente/configuracion' },
  { metodo: 'get', ruta: '/puente/trabajos' },
  {
    metodo: 'post',
    ruta: `/puente/trabajos/${trabajoId}/resultado`,
    cuerpo: { resultado: 'IMPRESO' },
  },
  { metodo: 'post', ruta: '/puente/latido', cuerpo: { versionApp: '1.0.3', impresoras: [] } },
];

/** Exige 401 NO_AUTENTICADO en cada ruta de `/puente/*` y en la vinculación con ese token. */
async function exigirRechazoEnElPuente(
  token: string | undefined,
  descripcion: string,
  incluirVinculacion = false,
): Promise<string[]> {
  const fallos: string[] = [];
  const rutas: RutaPuente[] = [
    ...rutasDelPuente(),
    ...(incluirVinculacion
      ? [{ metodo: 'post', ruta: '/puente/vinculacion', cuerpo: ENTRADA_PUENTE } as RutaPuente]
      : []),
  ];
  for (const r of rutas) {
    const res = await llamarPuente(ctx, token, r.metodo, r.ruta, r.cuerpo);
    if (res.status !== 401 || (res.body as { codigo?: string }).codigo !== 'NO_AUTENTICADO') {
      fallos.push(
        `${descripcion}: ${r.metodo.toUpperCase()} ${r.ruta} dio ${res.status} ${JSON.stringify(res.body)} y se esperaba 401 NO_AUTENTICADO`,
      );
    }
  }
  return fallos;
}

/** Comprueba que el token del puente funciona (control de las pruebas de rechazo). */
async function exigirPuenteVivo(puente: PuenteVinculado, contexto: string): Promise<void> {
  const res = await llamarPuente(ctx, puente.token, 'get', '/puente/configuracion');
  exigirEstado(res, 200, `${contexto}: el token del puente debe seguir sirviendo`);
}

const iso = (ms: number): string => new Date(ms).toISOString();

// ------------------------------------------------------------------------------------------------
// 106 · Código de vinculación
// ------------------------------------------------------------------------------------------------
describe('criterio 106 · el Administrador crea el código de vinculación', () => {
  it('201 con token vi.<empresa>.<id>.<secreto>, qr con la URL de la API y expiraEn a diez minutos', async () => {
    const A = await crearEmpresaP6(ctx, sa, 3);
    const res = await llamar(ctx, A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${A.S1}/vinculaciones-puente`,
    });
    exigirEstado(res, 201, 'crear el código de vinculación');
    expect(Object.keys(res.body).sort()).toEqual(['expiraEn', 'qr', 'token']);
    const cuerpo = vinculacionRespuestaSchema.parse(res.body);
    expect(cuerpo.token).toMatch(regexToken('vi', A.empresaId));
    expect(new Date(cuerpo.expiraEn).getTime()).toBe(ctx.reloj.ahora().getTime() + 10 * MINUTO);
    expect(cuerpo.qr.startsWith('restaurante-puente://vincular?')).toBe(true);
    expect(leerQrPuente(cuerpo.qr)).toEqual({ api: URL_API_PUBLICA, token: cuerpo.token });
  });

  it('cada código es distinto y se crea para cualquier sucursal de la empresa, con o sin sucursal activa', async () => {
    const A = await crearEmpresaP6(ctx, sa, 3);
    const uno = await crearVinculacion(ctx, A.tokenAdmin, A.S1);
    const dos = await crearVinculacion(ctx, A.tokenAdmin, A.S2);
    const tres = await crearVinculacion(ctx, A.tokenS1, A.S3!);
    const ids = [uno, dos, tres].map((v) => partesDe(v.token).id);
    expect(new Set(ids).size).toBe(3);
    expect(new Set([uno, dos, tres].map((v) => partesDe(v.token).secreto)).size).toBe(3);
  });

  it('solo el Administrador: los otros cuatro roles, con sesión de contraseña y de PIN, reciben 403 PROHIBIDO y no se crea nada; sin sesión, 401', async () => {
    const A = await crearEmpresaP6(ctx, sa, 3);
    const roles = await crearRolesP6(ctx, A);
    const antes = await instantaneaImpresion(admin, A.empresaId);
    const fallos: string[] = [];
    for (const rol of ROLES_SIN_ADMINISTRAR) {
      for (const [tipo, token] of [
        ['contraseña', roles[rol].contrasena],
        ['PIN', roles[rol].pin],
      ] as const) {
        const res = await llamar(ctx, token, {
          metodo: 'post',
          ruta: `/sucursales/${A.S1}/vinculaciones-puente`,
        });
        if (res.status !== 403 || res.body.codigo !== 'PROHIBIDO') {
          fallos.push(`${rol} (${tipo}): ${res.status} ${JSON.stringify(res.body)}`);
        }
      }
    }
    const sin = await llamar(ctx, undefined, {
      metodo: 'post',
      ruta: `/sucursales/${A.S1}/vinculaciones-puente`,
    });
    if (sin.status !== 401 || sin.body.codigo !== 'NO_AUTENTICADO') {
      fallos.push(`sin sesión: ${sin.status} ${JSON.stringify(sin.body)}`);
    }
    exigirSinFallos(fallos);
    expect(await instantaneaImpresion(admin, A.empresaId)).toEqual(antes);
    // Control: el Administrador sí puede.
    await crearVinculacion(ctx, A.tokenAdmin, A.S1);
  });

  it('una sucursal de B o inexistente responde 404 con el mismo cuerpo, sin crear nada', async () => {
    const A = await crearEmpresaP6(ctx, sa, 3);
    const B = await crearEmpresaP6(ctx, sa, 2);
    const antesA = await instantaneaImpresion(admin, A.empresaId);
    const antesB = await instantaneaImpresion(admin, B.empresaId);
    const deB = await llamar(ctx, A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${B.S1}/vinculaciones-puente`,
    });
    const inexistente = await llamar(ctx, A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${randomUUID()}/vinculaciones-puente`,
    });
    expect(deB.status, JSON.stringify(deB.body)).toBe(404);
    expect(deB.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(cuerpoDe(deB)).toBe(cuerpoDe(inexistente));
    expect(await instantaneaImpresion(admin, A.empresaId)).toEqual(antesA);
    expect(await instantaneaImpresion(admin, B.empresaId)).toEqual(antesB);
    // Control: la sucursal propia sí.
    await crearVinculacion(ctx, A.tokenAdmin, A.S1);
  });

  it('crear otro código invalida los pendientes de esa sucursal, pero no los de otra sucursal ni los de otra empresa', async () => {
    const A = await crearEmpresaP6(ctx, sa, 3);
    const B = await crearEmpresaP6(ctx, sa, 2);
    const viejoS1 = await crearVinculacion(ctx, A.tokenAdmin, A.S1);
    const deS2 = await crearVinculacion(ctx, A.tokenAdmin, A.S2);
    const deB = await crearVinculacion(ctx, B.tokenAdmin, B.S1);
    const nuevoS1 = await crearVinculacion(ctx, A.tokenAdmin, A.S1);
    const invalido = await vincular(ctx, viejoS1.token);
    expect(invalido.status, JSON.stringify(invalido.body)).toBe(401);
    expect(invalido.body).toMatchObject({ codigo: 'VINCULACION_INVALIDA' });
    exigirEstado(await vincular(ctx, nuevoS1.token), 201, 'el código nuevo de S1');
    exigirEstado(await vincular(ctx, deS2.token), 201, 'el código pendiente de S2');
    exigirEstado(await vincular(ctx, deB.token), 201, 'el código pendiente de B');
  });

  it('solo se guarda la huella del secreto: ni las filas, ni la lista de puentes, ni la auditoría lo contienen', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const codigo = await crearVinculacion(ctx, A.tokenAdmin, A.S1);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    const secretos = [
      partesDe(codigo.token).secreto,
      partesDe(puente.token).secreto,
      partesDe(puente.codigo).secreto,
    ];
    const prohibidos = secretos.flatMap((s) => [s, Buffer.from(s, 'base64url').toString('hex')]);
    const textos: string[] = [];
    for (const tabla of ['vinculacion_puente', 'puente'] as const) {
      const { rows } = await admin.query<{ texto: string }>(
        `SELECT to_jsonb(t)::text AS texto FROM ${tabla} t WHERE empresa_id = $1`,
        [A.empresaId],
      );
      expect(rows.length, `filas de ${tabla}`).toBeGreaterThan(0);
      textos.push(...rows.map((r) => r.texto));
    }
    textos.push(JSON.stringify(await listarPuentes(ctx, A.tokenAdmin, A.S2)));
    textos.push(...(await textoDeAuditoria(admin)));
    const fallos = prohibidos.flatMap((p) =>
      textos.filter((t) => t.includes(p)).map(() => `aparece el secreto ${p.slice(0, 8)}…`),
    );
    exigirSinFallos(fallos);
    const huella = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM puente WHERE empresa_id = $1 AND huella_secreto IS NOT NULL`,
      [A.empresaId],
    );
    expect(Number(huella.rows[0]!.n)).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------
// 107 · Vincular
// ------------------------------------------------------------------------------------------------
describe('criterio 107 · vincular el puente con el código', () => {
  it('201 con el token pu.<empresa>.<id>.<secreto>, el puente, la sucursal y la configuración con las impresoras activas', async () => {
    const A = await crearEmpresaP6(ctx, sa, 3);
    const imp1 = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    const imp2 = await crearImpresora(ctx, A.tokenAdmin, A.S1, { anchoMm: 58, gaveta: true });
    const inactiva = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    exigirEstado(
      await llamar(ctx, A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${A.S1}/impresoras/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar una impresora',
    );
    await crearImpresora(ctx, A.tokenAdmin, A.S2);
    const codigo = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const res = await vincular(ctx, codigo, ENTRADA_PUENTE);
    exigirEstado(res, 201, 'vincular');
    const cuerpo = vincularPuenteRespuestaSchema.parse(res.body);
    expect(cuerpo.token).toMatch(regexToken('pu', A.empresaId));
    expect(partesDe(cuerpo.token).id).toBe(cuerpo.puente.id);
    expect(cuerpo.puente.nombre).toBe(ENTRADA_PUENTE.nombreEquipo);
    expect(cuerpo.sucursal).toEqual({ id: A.S1, nombre: A.nombreS1 });
    expect(cuerpo.configuracion.puente).toEqual(cuerpo.puente);
    expect(cuerpo.configuracion.sucursal).toEqual(cuerpo.sucursal);
    expect(cuerpo.configuracion.impresoras.map((i) => i.id).sort()).toEqual(
      [imp1.id, imp2.id].sort(),
    );
    const porId = new Map(cuerpo.configuracion.impresoras.map((i) => [i.id, i]));
    expect(porId.get(imp1.id)).toMatchObject({
      nombre: imp1.nombre,
      conexion: { tipo: 'RED', host: '127.0.0.1', puerto: 9100 },
      anchoMm: 80,
      juegoCaracteres: 'PC850',
      gaveta: false,
    });
    expect(porId.get(imp2.id)).toMatchObject({ anchoMm: 58, gaveta: true });

    // La misma configuración la sirve `GET /puente/configuracion` con el token nuevo.
    const config = await llamarPuente(ctx, cuerpo.token, 'get', '/puente/configuracion');
    exigirEstado(config, 200, 'pedir la configuración');
    const leida = configuracionPuenteSchema.parse(config.body);
    expect(leida.puente).toEqual(cuerpo.puente);
    expect(leida.sucursal).toEqual(cuerpo.sucursal);
    expect(leida.impresoras.map((i) => i.id).sort()).toEqual([imp1.id, imp2.id].sort());

    // Y el Administrador lo ve en la lista de su sucursal, no en la de otra.
    const lista = await listarPuentes(ctx, A.tokenAdmin, A.S1);
    expect(lista).toHaveLength(1);
    const fila = puenteRespuestaSchema.parse(lista[0]);
    expect(fila).toMatchObject({
      id: cuerpo.puente.id,
      nombre: ENTRADA_PUENTE.nombreEquipo,
      activo: true,
      modelo: ENTRADA_PUENTE.modelo,
      versionApp: ENTRADA_PUENTE.versionApp,
      revocadoEn: null,
      ultimaSenalEn: null,
    });
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S2)).toEqual([]);
  });

  it('sin nombreEquipo ni modelo también vincula: el puente queda con un nombre y sin modelo', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const codigo = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const res = await vincular(ctx, codigo, { versionApp: '2.0.0' });
    exigirEstado(res, 201, 'vincular solo con la versión');
    const cuerpo = vincularPuenteRespuestaSchema.parse(res.body);
    expect(cuerpo.puente.nombre.length).toBeGreaterThanOrEqual(1);
    expect(cuerpo.puente.nombre.length).toBeLessThanOrEqual(60);
    const [fila] = await listarPuentes(ctx, A.tokenAdmin, A.S1);
    expect(fila).toMatchObject({ modelo: null, versionApp: '2.0.0' });
  });

  it('una entrada inválida es 400 DATOS_INVALIDOS (sin versionApp, con un campo de más o con empresaId) y el código sigue sirviendo', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const codigo = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const fallos: string[] = [];
    for (const [nombre, cuerpo] of [
      ['sin versionApp', { nombreEquipo: 'Tablet' }],
      ['campo desconocido', { versionApp: '1.0.0', sucursalId: A.S2 }],
      ['empresaId', { versionApp: '1.0.0', empresaId: A.empresaId }],
      ['nombre de 61 caracteres', { versionApp: '1.0.0', nombreEquipo: 'x'.repeat(61) }],
    ] as const) {
      const res = await vincular(ctx, codigo, cuerpo);
      if (res.status !== 400 || res.body.codigo !== 'DATOS_INVALIDOS') {
        fallos.push(`${nombre}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    exigirSinFallos(fallos);
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S1)).toEqual([]);
    exigirEstado(await vincular(ctx, codigo), 201, 'el código no se gastó con los 400');
  });

  it('la vinculación queda usada: un segundo intento es 401 VINCULACION_INVALIDA y no crea otro puente', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const p = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const segundo = await vincular(ctx, p.codigo);
    expect(segundo.status, JSON.stringify(segundo.body)).toBe(401);
    expect(segundo.body).toMatchObject({ codigo: 'VINCULACION_INVALIDA' });
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S1)).toHaveLength(1);
    await exigirPuenteVivo(p, 'después del segundo intento');
  });

  it('adulterada, de otra vinculación, de B, inexistente, usada o vencida: 401 VINCULACION_INVALIDA con el mismo cuerpo y sin crear nada', async () => {
    const A = await crearEmpresaP6(ctx, sa, 3);
    const B = await crearEmpresaP6(ctx, sa, 2);
    const vencida = (await crearVinculacion(ctx, A.tokenAdmin, A.S3!)).token;
    const usada = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    const buena = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const deB = (await crearVinculacion(ctx, B.tokenAdmin, B.S1)).token;
    const antesB = await listarPuentes(ctx, B.tokenAdmin, B.S1);

    const casos: [string, string][] = [
      ['usada', usada.codigo],
      ['inexistente', tokenAleatorio('vi', A.empresaId)],
      ['id cambiado', conIdDe(buena, randomUUID())],
      ['secreto adulterado', conSecretoAdulterado(buena)],
      ['secreto de otra vinculación', conSecretoDe(buena, vencida)],
      ['id de otra vinculación', conIdDe(buena, partesDe(vencida).id)],
      ['empresa cambiada a B', conEmpresaDe(buena, B.empresaId)],
      ['código de B con la empresa de A', conEmpresaDe(deB, A.empresaId)],
      ['código de B con su id y el secreto de A', conSecretoDe(deB, buena)],
    ];
    const cuerpos = new Map<string, string[]>();
    const fallos: string[] = [];
    for (const [nombre, token] of casos) {
      const res = await vincular(ctx, token);
      if (res.status !== 401 || res.body.codigo !== 'VINCULACION_INVALIDA') {
        fallos.push(`${nombre}: ${res.status} ${JSON.stringify(res.body)}`);
      }
      const clave = cuerpoDe(res);
      cuerpos.set(clave, [...(cuerpos.get(clave) ?? []), nombre]);
    }
    exigirSinFallos(fallos);
    expect([...cuerpos.entries()], 'todos los rechazos tienen el mismo cuerpo').toHaveLength(1);

    // No se creó ningún puente: solo el de la vinculación usada.
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S1)).toEqual([]);
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S3!)).toEqual([]);
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S2)).toHaveLength(1);
    expect(await listarPuentes(ctx, B.tokenAdmin, B.S1)).toEqual(antesB);

    // Control: los códigos sin tocar siguen sirviendo, cada uno en su sucursal y su empresa.
    const bueno = await vincular(ctx, buena);
    exigirEstado(bueno, 201, 'el código sin adulterar');
    expect(bueno.body.sucursal.id).toBe(A.S1);
    const bueno2 = await vincular(ctx, deB);
    exigirEstado(bueno2, 201, 'el código de B');
    expect(bueno2.body.sucursal.id).toBe(B.S1);
    expect(partesDe(bueno2.body.token).empresaId).toBe(B.empresaId);

    // La vencida: pasados los 10 minutos tiene el mismo cuerpo que las demás.
    ctx.reloj.avanzar(10 * MINUTO + 1000);
    const alVencer = await vincular(ctx, vencida);
    expect(alVencer.status, JSON.stringify(alVencer.body)).toBe(401);
    expect(alVencer.body).toMatchObject({ codigo: 'VINCULACION_INVALIDA' });
    expect(cuerpoDe(alVencer)).toBe([...cuerpos.keys()][0]);
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S3!)).toEqual([]);
  });

  it('el código vale hasta los diez minutos: a los 9:59 vincula y a los 10:01 ya no', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const deS1 = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const deS2 = (await crearVinculacion(ctx, A.tokenAdmin, A.S2)).token;
    ctx.reloj.avanzar(9 * MINUTO + 59_000);
    exigirEstado(await vincular(ctx, deS2), 201, 'a los 9 minutos 59 segundos');
    ctx.reloj.avanzar(2000);
    const tarde = await vincular(ctx, deS1);
    expect(tarde.status, JSON.stringify(tarde.body)).toBe(401);
    expect(tarde.body).toMatchObject({ codigo: 'VINCULACION_INVALIDA' });
  });

  it('mal formada o de otro tipo es 401 NO_AUTENTICADO sin gastar el código (aviso: la parte de rechazo ya la da la fase A; el control exige la vinculación)', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const codigo = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    const fallos: string[] = [];
    for (const [nombre, token] of [
      ['sin Authorization', undefined],
      ['basura', 'vi.no-es-un-codigo'],
      ['vi. sin secreto', `vi.${A.empresaId}.${randomUUID()}`],
      ['pu. del puente', puente.token],
      ['sesión de persona', A.tokenAdmin],
    ] as const) {
      const res = await vincular(ctx, token);
      if (res.status !== 401 || res.body.codigo !== 'NO_AUTENTICADO') {
        fallos.push(`${nombre}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    exigirSinFallos(fallos);
    exigirEstado(await vincular(ctx, codigo), 201, 'el código sigue sirviendo');
  });

  it('dos usos simultáneos del mismo código: exactamente uno responde 201 y los demás 401 VINCULACION_INVALIDA', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const fallos: string[] = [];
    for (let ronda = 1; ronda <= 3; ronda++) {
      const antes = (await auditoriaImpresion(admin, A.empresaId)).filter(
        (f) => f.accion === 'vincular_puente',
      ).length;
      const codigo = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
      const respuestas = await Promise.all(Array.from({ length: 6 }, () => vincular(ctx, codigo)));
      const ganadoras = respuestas.filter((r) => r.status === 201);
      const perdedoras = respuestas.filter((r) => r.status !== 201);
      if (ganadoras.length !== 1) {
        fallos.push(
          `ronda ${ronda}: ${ganadoras.length} respuestas 201 (${respuestas.map((r) => r.status).join(', ')})`,
        );
      }
      for (const r of perdedoras) {
        if (r.status !== 401 || r.body.codigo !== 'VINCULACION_INVALIDA') {
          fallos.push(`ronda ${ronda}: perdedora ${r.status} ${JSON.stringify(r.body)}`);
        }
      }
      const puentes = await listarPuentes(ctx, A.tokenAdmin, A.S1);
      if (puentes.length !== ronda) fallos.push(`ronda ${ronda}: ${puentes.length} puentes`);
      if (puentes.filter((p) => p.activo).length !== 1) {
        fallos.push(`ronda ${ronda}: debe haber exactamente un puente activo`);
      }
      const despues = (await auditoriaImpresion(admin, A.empresaId)).filter(
        (f) => f.accion === 'vincular_puente',
      ).length;
      if (despues - antes !== 1) {
        fallos.push(`ronda ${ronda}: ${despues - antes} filas vincular_puente (debe ser 1)`);
      }
      if (ganadoras[0] !== undefined) {
        const res = await llamarPuente(
          ctx,
          ganadoras[0].body.token,
          'get',
          '/puente/configuracion',
        );
        if (res.status !== 200) fallos.push(`ronda ${ronda}: el token ganador dio ${res.status}`);
      }
    }
    exigirSinFallos(fallos);
  });

  it('no hay bloqueo por intentos: treinta códigos falsos seguidos no impiden que el verdadero vincule', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const codigo = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const fallos: string[] = [];
    for (let i = 0; i < 30; i++) {
      const falso = i % 2 === 0 ? conSecretoAdulterado(codigo) : tokenAleatorio('vi', A.empresaId);
      const res = await vincular(ctx, falso);
      if (res.status !== 401 || res.body.codigo !== 'VINCULACION_INVALIDA') {
        fallos.push(`intento ${i}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    exigirSinFallos(fallos);
    exigirEstado(await vincular(ctx, codigo), 201, 'el código verdadero después de 30 falsos');
  });
});

// ------------------------------------------------------------------------------------------------
// 108 · Un puente por sucursal
// ------------------------------------------------------------------------------------------------
describe('criterio 108 · un puente activo por sucursal y su revocación', () => {
  it('vincular un segundo puente revoca al anterior: su token da 401 en todas las rutas, el nuevo funciona y la lista trae los dos', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const primero = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1, {
      nombreEquipo: 'Primero',
      modelo: 'Modelo 1',
      versionApp: '1.0.0',
    });
    await exigirPuenteVivo(primero, 'antes de vincular el segundo');
    const segundo = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1, {
      nombreEquipo: 'Segundo',
      modelo: 'Modelo 2',
      versionApp: '1.0.1',
    });
    exigirSinFallos(await exigirRechazoEnElPuente(primero.token, 'puente revocado'));
    for (const r of rutasDelPuente()) {
      const res = await llamarPuente(ctx, segundo.token, r.metodo, r.ruta, r.cuerpo);
      expect([200, 204, 404], `${r.metodo} ${r.ruta} con el puente nuevo`).toContain(res.status);
    }
    const lista = await listarPuentes(ctx, A.tokenAdmin, A.S1);
    expect(lista).toHaveLength(2);
    for (const fila of lista) puenteRespuestaSchema.parse(fila);
    const vieja = lista.find((p) => p.id === primero.id)!;
    const nueva = lista.find((p) => p.id === segundo.id)!;
    expect(vieja).toMatchObject({
      nombre: 'Primero',
      activo: false,
      modelo: 'Modelo 1',
      versionApp: '1.0.0',
    });
    expect(vieja.revocadoEn).not.toBeNull();
    expect(nueva).toMatchObject({
      nombre: 'Segundo',
      activo: true,
      modelo: 'Modelo 2',
      versionApp: '1.0.1',
      revocadoEn: null,
    });
  });

  it('la conexión de Socket.IO del puente anterior se cierra y la del nuevo sigue; el anterior ya no puede volver a entrar', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const primero = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const conexionVieja = await conectarPuente(primero.token);
    expect(conexionVieja.conectado).toBe(true);
    const segundo = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    await conexionVieja.esperarDesconexion(3000);
    expect(conexionVieja.conectado).toBe(false);
    const conexionNueva = await conectarPuente(segundo.token);
    expect(conexionNueva.conectado).toBe(true);
    expect(await intentar({ token: primero.token })).toBe('NO_AUTENTICADO');
    expect(conexionNueva.conectado).toBe(true);
  });

  it('solo se revoca el puente de la misma sucursal: los de otra sucursal y de otra empresa siguen activos', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const B = await crearEmpresaP6(ctx, sa, 2);
    const deS1 = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const deS2 = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    const deB = await nuevoPuente(ctx, B.tokenAdmin, B, B.S1);
    const conexionS2 = await conectarPuente(deS2.token);
    await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    await exigirPuenteVivo(deS2, 'el de S2');
    await exigirPuenteVivo(deB, 'el de B');
    expect(conexionS2.conectado).toBe(true);
    const rechazado = await llamarPuente(ctx, deS1.token, 'get', '/puente/configuracion');
    expect(rechazado.status).toBe(401);
    expect((await listarPuentes(ctx, A.tokenAdmin, A.S2))[0]).toMatchObject({ activo: true });
    expect((await listarPuentes(ctx, B.tokenAdmin, B.S1))[0]).toMatchObject({ activo: true });
  });

  it('DELETE revoca: 204, el token da 401, la conexión se cierra, repetirlo es 204 sin efecto y sin otra fila de auditoría', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const conexion = await conectarPuente(puente.token);
    const antes = await auditoriaImpresion(admin, A.empresaId);
    const ruta = `/sucursales/${A.S1}/puentes/${puente.id}`;
    const primera = await llamar(ctx, A.tokenAdmin, { metodo: 'delete', ruta });
    expect(primera.status, JSON.stringify(primera.body)).toBe(204);
    await conexion.esperarDesconexion(3000);
    exigirSinFallos(
      await exigirRechazoEnElPuente(puente.token, 'puente revocado por el Administrador'),
    );
    const [fila] = await listarPuentes(ctx, A.tokenAdmin, A.S1);
    expect(fila).toMatchObject({ id: puente.id, activo: false });
    expect(fila!.revocadoEn).not.toBeNull();
    const tras = await auditoriaNueva(admin, A.empresaId, antes);
    expect(tras.filter((f) => f.accion === 'revocar_puente')).toHaveLength(1);

    const repetida = await llamar(ctx, A.tokenAdmin, { metodo: 'delete', ruta });
    expect(repetida.status, JSON.stringify(repetida.body)).toBe(204);
    expect(await listarPuentes(ctx, A.tokenAdmin, A.S1)).toEqual([fila]);
    const trasRepetir = await auditoriaNueva(admin, A.empresaId, antes);
    expect(trasRepetir.map((f) => f.id)).toEqual(tras.map((f) => f.id));
  });

  it('revocar un puente inexistente, de otra sucursal o de B es 404 con el mismo cuerpo y no cambia nada', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const B = await crearEmpresaP6(ctx, sa, 2);
    const deS1 = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const deS2 = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    const deB = await nuevoPuente(ctx, B.tokenAdmin, B, B.S1);
    const antesA = await instantaneaImpresion(admin, A.empresaId);
    const antesB = await instantaneaImpresion(admin, B.empresaId);
    const borrar = (sucursalId: string, id: string) =>
      llamar(ctx, A.tokenAdmin, {
        metodo: 'delete',
        ruta: `/sucursales/${sucursalId}/puentes/${id}`,
      });
    // Un puente que no existe en una sucursal propia, y una sucursal que no existe.
    const puenteInexistente = await borrar(A.S1, randomUUID());
    expect(puenteInexistente.status, JSON.stringify(puenteInexistente.body)).toBe(404);
    expect(puenteInexistente.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
    const sucursalInexistente = await borrar(randomUUID(), randomUUID());
    expect(sucursalInexistente.status, JSON.stringify(sucursalInexistente.body)).toBe(404);
    const fallos: string[] = [];
    for (const [nombre, res, esperado] of [
      ['puente de S2 por la ruta de S1', await borrar(A.S1, deS2.id), puenteInexistente],
      ['puente de B por la ruta de S1', await borrar(A.S1, deB.id), puenteInexistente],
      ['puente de B por la ruta de B', await borrar(B.S1, deB.id), sucursalInexistente],
      ['puente de S1 por la ruta de B', await borrar(B.S1, deS1.id), sucursalInexistente],
    ] as const) {
      if (cuerpoDe(res) !== cuerpoDe(esperado)) {
        fallos.push(`${nombre}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    exigirSinFallos(fallos);
    expect(await instantaneaImpresion(admin, A.empresaId)).toEqual(antesA);
    expect(await instantaneaImpresion(admin, B.empresaId)).toEqual(antesB);
    await exigirPuenteVivo(deS1, 'el de S1');
    await exigirPuenteVivo(deS2, 'el de S2');
    await exigirPuenteVivo(deB, 'el de B');
  });

  it('listar y revocar son solo del Administrador: los otros roles, con contraseña y con PIN, reciben 403 PROHIBIDO y nada cambia', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const antes = await instantaneaImpresion(admin, A.empresaId);
    const fallos: string[] = [];
    for (const rol of ROLES_SIN_ADMINISTRAR) {
      for (const [tipo, token] of [
        ['contraseña', roles[rol].contrasena],
        ['PIN', roles[rol].pin],
      ] as const) {
        for (const [metodo, ruta] of [
          ['get', `/sucursales/${A.S1}/puentes`],
          ['delete', `/sucursales/${A.S1}/puentes/${puente.id}`],
        ] as const) {
          const res = await llamar(ctx, token, { metodo, ruta });
          if (res.status !== 403 || res.body.codigo !== 'PROHIBIDO') {
            fallos.push(
              `${rol} (${tipo}) ${metodo.toUpperCase()}: ${res.status} ${JSON.stringify(res.body)}`,
            );
          }
        }
      }
    }
    exigirSinFallos(fallos);
    expect(await instantaneaImpresion(admin, A.empresaId)).toEqual(antes);
    await exigirPuenteVivo(puente, 'después de los intentos de los otros roles');
  });
});

// ------------------------------------------------------------------------------------------------
// 109 · La credencial del puente
// ------------------------------------------------------------------------------------------------
describe('criterio 109 · el token pu. solo sirve en /puente/* y en /puente/* solo sirve el pu.', () => {
  it('un pu. válido no sirve en ninguna ruta de personas, de configuración ni de plataforma: 401 NO_AUTENTICADO (y en /puente/* sí sirve)', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    await exigirPuenteVivo(puente, 'control');
    const id = randomUUID();
    const rutas = [
      ['get', '/sesion'],
      ['get', '/usuarios'],
      ['get', '/sucursales'],
      ['get', '/salon'],
      ['get', '/cocina/comandas'],
      ['get', '/carta/productos'],
      ['get', '/impresion/estado'],
      ['get', '/impresion/trabajos'],
      ['post', `/impresion/trabajos/${id}/reimpresion`],
      ['get', `/sucursales/${A.S1}/impresoras`],
      ['post', `/sucursales/${A.S1}/impresoras`],
      ['get', `/sucursales/${A.S1}/estaciones-destino`],
      ['get', `/sucursales/${A.S1}/impresion`],
      ['post', `/sucursales/${A.S1}/vinculaciones-puente`],
      ['get', `/sucursales/${A.S1}/puentes`],
      ['delete', `/sucursales/${A.S1}/puentes/${puente.id}`],
      ['post', '/ordenes'],
      ['get', '/plataforma/empresas'],
    ] as const;
    const fallos: string[] = [];
    for (const [metodo, ruta] of rutas) {
      const res = await llamar(ctx, puente.token, {
        metodo,
        ruta,
        ...(metodo === 'post' ? { cuerpo: {} } : {}),
        cabeceras: { 'Idempotency-Key': randomUUID() },
      });
      if (res.status !== 401 || res.body.codigo !== 'NO_AUTENTICADO') {
        fallos.push(`${metodo.toUpperCase()} ${ruta}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    exigirSinFallos(fallos);
    await exigirPuenteVivo(puente, 'después de usarlo fuera de /puente/*');
  });

  it('un se., sa., eq. o vi. en /puente/* es 401 NO_AUTENTICADO y no gasta el código (control: el pu. sí entra)', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    await exigirPuenteVivo(puente, 'control');
    const codigoSinUsar = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    const equipo = await equipoDe(ctx, roles.MOZO.persona);
    const fallos = [
      ...(await exigirRechazoEnElPuente(A.tokenAdmin, 'sesión del Administrador')),
      ...(await exigirRechazoEnElPuente(A.tokenS1, 'sesión del Administrador con S1 activa')),
      ...(await exigirRechazoEnElPuente(roles.MOZO.contrasena, 'sesión de contraseña del Mozo')),
      ...(await exigirRechazoEnElPuente(roles.MOZO.pin, 'sesión de PIN del Mozo')),
      ...(await exigirRechazoEnElPuente(sa.token, 'sesión de superadministrador (sa.)')),
      ...(await exigirRechazoEnElPuente(equipo, 'token de equipo (eq.)')),
      ...(await exigirRechazoEnElPuente(codigoSinUsar, 'código de vinculación (vi.)')),
    ];
    exigirSinFallos(fallos);
    exigirEstado(await vincular(ctx, codigoSinUsar), 201, 'el código sigue sirviendo');
  });

  it('una sesión con contraseña temporal recibe 403 CAMBIO_CONTRASENA_REQUERIDO en /puente/*, como en el resto de la API (regla de 002; hoy ya la da la fase A)', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const persona = await crearUsuario(ctx, A.tokenAdmin, { esAdministrador: true });
    const { token } = await ingresarOk(ctx, persona.usuario, persona.contrasenaTemporal);
    const fallos: string[] = [];
    for (const r of rutasDelPuente()) {
      const res = await llamarPuente(ctx, token, r.metodo, r.ruta, r.cuerpo);
      if (res.status !== 403 || res.body.codigo !== 'CAMBIO_CONTRASENA_REQUERIDO') {
        fallos.push(
          `${r.metodo.toUpperCase()} ${r.ruta}: ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
    }
    exigirSinFallos(fallos);
  });

  it('sin Authorization toda ruta de /puente/* responde 401 NO_AUTENTICADO, también con la empresa en una cabecera (la lista de rutas públicas de 002 no cambia; hoy ya lo da la fase A)', async () => {
    const fallos = await exigirRechazoEnElPuente(undefined, 'sin Authorization', true);
    const rutas: RutaPuente[] = [
      ...rutasDelPuente(),
      { metodo: 'post', ruta: '/puente/vinculacion', cuerpo: ENTRADA_PUENTE },
    ];
    for (const r of rutas) {
      const peticion = ctx.http()[r.metodo](r.ruta);
      const res = await peticion
        .set('X-Empresa-Id', randomUUID())
        .send(r.cuerpo as object | undefined);
      if (res.status !== 401) {
        fallos.push(`${r.metodo.toUpperCase()} ${r.ruta} con X-Empresa-Id: ${res.status}`);
      }
    }
    exigirSinFallos(fallos);
  });

  it('un pu. adulterado (secreto, id, empresa), mal formado o con otro esquema es 401 NO_AUTENTICADO; el verdadero sigue sirviendo', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const B = await crearEmpresaP6(ctx, sa, 2);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const deB = await nuevoPuente(ctx, B.tokenAdmin, B, B.S1);
    const fallos: string[] = [];
    for (const [nombre, token] of [
      ['secreto adulterado', conSecretoAdulterado(puente.token)],
      ['secreto de otro puente', conSecretoDe(puente.token, deB.token)],
      ['id cambiado', conIdDe(puente.token, randomUUID())],
      ['id del puente de B', conIdDe(puente.token, deB.id)],
      ['empresa cambiada a B', conEmpresaDe(puente.token, B.empresaId)],
      ['puente de B con la empresa de A', conEmpresaDe(deB.token, A.empresaId)],
      ['inexistente', tokenAleatorio('pu', A.empresaId)],
      ['mal formado', 'pu.esto-no-es-un-token'],
      ['sin secreto', `pu.${A.empresaId}.${puente.id}`],
      ['prefijo en mayúsculas', puente.token.replace(/^pu/, 'PU')],
    ] as const) {
      fallos.push(...(await exigirRechazoEnElPuente(token, nombre)));
    }
    for (const r of rutasDelPuente()) {
      const peticion = ctx.http()[r.metodo](r.ruta);
      const res = await peticion
        .set('Authorization', `Basic ${puente.token}`)
        .send(r.cuerpo as object | undefined);
      if (res.status !== 401) fallos.push(`esquema Basic ${r.ruta}: ${res.status}`);
    }
    exigirSinFallos(fallos);
    await exigirPuenteVivo(puente, 'el verdadero');
    await exigirPuenteVivo(deB, 'el de B');
  });

  it('no hay bloqueo por intentos: treinta pu. falsos seguidos no impiden que el verdadero siga sirviendo', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const fallos: string[] = [];
    for (let i = 0; i < 30; i++) {
      const falso =
        i % 2 === 0 ? conSecretoAdulterado(puente.token) : tokenAleatorio('pu', A.empresaId);
      const res = await llamarPuente(ctx, falso, 'get', '/puente/configuracion');
      if (res.status !== 401) fallos.push(`intento ${i}: ${res.status}`);
    }
    exigirSinFallos(fallos);
    await exigirPuenteVivo(puente, 'después de 30 intentos falsos');
  });

  it('la petición corre con el actor de sistema puente:<id>: así quedan los trabajos que entrega y reporta y la fila del propio puente', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const impresora = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const trabajoId = await crearPrueba(ctx, A.tokenAdmin, A.S1, impresora.id);
    // Quien pidió el trabajo es el Administrador.
    expect(await autorDe(admin, 'trabajo_impresion', trabajoId)).toMatchObject({
      creadoPorUsuarioId: A.adminId,
      creadoPorSistema: null,
    });
    const lista = await trabajosDelPuente(ctx, puente);
    expect(lista.map((t) => t.id)).toEqual([trabajoId]);
    const reporte = await llamarPuente(
      ctx,
      puente.token,
      'post',
      `/puente/trabajos/${trabajoId}/resultado`,
      {
        resultado: 'IMPRESO',
      },
    );
    expect(reporte.status, JSON.stringify(reporte.body)).toBe(200);
    const autor = await autorDe(admin, 'trabajo_impresion', trabajoId);
    expect(autor.actualizadoPorSistema).toBe(`puente:${puente.id}`);
    expect(autor.actualizadoPorUsuarioId).toBeNull();
    // El trabajo sigue siendo de quien lo pidió.
    expect(autor.creadoPorUsuarioId).toBe(A.adminId);

    const latido = await llamarPuente(ctx, puente.token, 'post', '/puente/latido', {
      versionApp: '1.0.4',
      impresoras: [{ id: impresora.id, estado: 'LISTA' }],
    });
    expect(latido.status, JSON.stringify(latido.body)).toBe(204);
    const delPuente = await autorDe(admin, 'puente', puente.id);
    expect(delPuente.actualizadoPorSistema).toBe(`puente:${puente.id}`);
    expect(delPuente.actualizadoPorUsuarioId).toBeNull();
    // Al vincular, el puente nace con un actor de sistema del puente.
    expect(delPuente.creadoPorSistema).toMatch(/^puente:/);
  });
});

// ------------------------------------------------------------------------------------------------
// 111 · Socket del puente
// ------------------------------------------------------------------------------------------------
describe('criterio 111 · espacio /puente de Socket.IO', () => {
  it('el puente entra con su pu. y recibe, solo en su sala, trabajo.nuevo y puente.configuracion', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const impresora = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const cliente = await conectarPuente(puente.token);
    expect(cliente.conectado).toBe(true);
    const trabajoId = await crearPrueba(ctx, A.tokenAdmin, A.S1, impresora.id);
    expect(await cliente.esperarEvento<{ trabajoId: string }>('trabajo.nuevo')).toEqual({
      trabajoId,
    });
    exigirEstado(
      await llamar(ctx, A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${A.S1}/impresoras/${impresora.id}`,
        cuerpo: { nombre: `${impresora.nombre} 2` },
      }),
      200,
      'cambiar la impresora',
    );
    expect(await cliente.esperarEvento('puente.configuracion')).toEqual({});
  });

  it('se rechaza con NO_AUTENTICADO: sin token, basura, sesiones de personas (se.), sa., eq., y pu. o vi. que no existen', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const equipo = await equipoDe(ctx, roles.MOZO.persona);
    const pinMozo = await sesionPin(ctx, roles.MOZO.persona, equipo, A.S1);
    const casos: [string, { token?: string; equipo?: string }][] = [
      ['sin token', {}],
      ['token vacío', { token: '' }],
      ['basura', { token: 'esto-no-es-un-token' }],
      ['sesión del Administrador (se.)', { token: A.tokenAdmin }],
      ['sesión del Administrador con S1 activa (se.)', { token: A.tokenS1 }],
      ['sesión de contraseña del Mozo (se.)', { token: roles.MOZO.contrasena }],
      ['sesión de PIN con su equipo (se.)', { token: pinMozo, equipo }],
      ['sesión de superadministrador (sa.)', { token: sa.token }],
      ['token de equipo (eq.)', { token: equipo }],
      ['token de equipo (eq.) con el mismo equipo', { token: equipo, equipo }],
      ['código de vinculación (vi.) que no existe', { token: tokenAleatorio('vi', A.empresaId) }],
      ['pu. que no existe', { token: tokenAleatorio('pu', A.empresaId) }],
    ];
    const fallos: string[] = [];
    for (const [nombre, auth] of casos) {
      const error = await intentar(auth);
      if (error !== 'NO_AUTENTICADO') {
        fallos.push(
          `${nombre}: se esperaba el error NO_AUTENTICADO y fue ${JSON.stringify(error)}`,
        );
      }
    }
    exigirSinFallos(fallos);
  });

  it('se rechaza con NO_AUTENTICADO un pu. adulterado, de otra empresa o revocado y un vi. sin gastar; entran el verdadero y el que reemplazó al revocado', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const B = await crearEmpresaP6(ctx, sa, 2);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const viejo = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    const reemplazo = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
    const deB = await nuevoPuente(ctx, B.tokenAdmin, B, B.S1);
    const codigo = (await crearVinculacion(ctx, A.tokenAdmin, A.S1)).token;
    await conectarPuente(puente.token);

    const casos: [string, { token?: string; equipo?: string }][] = [
      ['código de vinculación (vi.) válido', { token: codigo }],
      ['pu. con el secreto adulterado', { token: conSecretoAdulterado(puente.token) }],
      ['pu. con el id cambiado', { token: conIdDe(puente.token, randomUUID()) }],
      ['pu. con la empresa cambiada a B', { token: conEmpresaDe(puente.token, B.empresaId) }],
      ['pu. de B con la empresa de A', { token: conEmpresaDe(deB.token, A.empresaId) }],
      ['pu. revocado por otro puente', { token: viejo.token }],
    ];
    const fallos: string[] = [];
    for (const [nombre, auth] of casos) {
      const error = await intentar(auth);
      if (error !== 'NO_AUTENTICADO') {
        fallos.push(
          `${nombre}: se esperaba el error NO_AUTENTICADO y fue ${JSON.stringify(error)}`,
        );
      }
    }
    exigirSinFallos(fallos);
    // El código de vinculación no se gastó al intentar entrar.
    exigirEstado(await vincular(ctx, codigo), 201, 'el código sigue sirviendo');
    // Controles: el verdadero, el reemplazo y el de B entran.
    expect(await intentar({ token: reemplazo.token })).toBeNull();
    expect(await intentar({ token: deB.token })).toBeNull();
  });

  it('una persona no entra al espacio /puente ni un puente al espacio / (cada una entra al suyo)', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    expect(await intentar({ token: A.tokenS1 }, '/puente'), 'la persona en el del puente').toBe(
      'NO_AUTENTICADO',
    );
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    expect(
      await intentar({ token: puente.token }, '/puente'),
      'el puente en su espacio',
    ).toBeNull();
    expect(await intentar({ token: puente.token }, '/'), 'el puente en el de la PWA').toBe(
      'NO_AUTENTICADO',
    );
    expect(await intentar({ token: A.tokenS1 }, '/'), 'la persona en el suyo').toBeNull();
  });

  it('la señal del puente se actualiza al conectarse y al desconectarse', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    expect((await listarPuentes(ctx, A.tokenAdmin, A.S1))[0]!.ultimaSenalEn).toBeNull();
    ctx.reloj.avanzar(5 * MINUTO);
    const alConectar = ctx.reloj.ahora().getTime();
    const cliente = await conectarPuente(puente.token);
    await vi.waitFor(
      async () => {
        const [fila] = await listarPuentes(ctx, A.tokenAdmin, A.S1);
        expect(fila!.ultimaSenalEn).toBe(iso(alConectar));
      },
      { timeout: 5000, interval: 100 },
    );
    ctx.reloj.avanzar(30_000);
    const alDesconectar = ctx.reloj.ahora().getTime();
    cliente.cerrar();
    await vi.waitFor(
      async () => {
        const [fila] = await listarPuentes(ctx, A.tokenAdmin, A.S1);
        expect(fila!.ultimaSenalEn).toBe(iso(alDesconectar));
      },
      { timeout: 5000, interval: 100 },
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 130 · Auditoría y trazabilidad
// ------------------------------------------------------------------------------------------------
describe('criterio 130 · auditoría de la impresión', () => {
  async function unaNueva(
    e: EmpresaP6,
    antes: Awaited<ReturnType<typeof auditoriaImpresion>>,
    accion: string,
  ) {
    const nuevas = await auditoriaNueva(admin, e.empresaId, antes);
    expect(
      nuevas.map((f) => f.accion),
      `filas de auditoría de 3b nuevas (se esperaba ${accion})`,
    ).toEqual([accion]);
    return nuevas[0]!;
  }

  it('cada acción deja exactamente una fila, con el autor, la sucursal y la entidad; los repetidos y los rechazos no dejan ninguna', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const estacionId = await crearEstacion(ctx, A.tokenAdmin);
    let antes = await auditoriaImpresion(admin, A.empresaId);
    const avanzar = async () => {
      antes = await auditoriaImpresion(admin, A.empresaId);
    };

    // crear_impresora
    const impresora = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    let fila = await unaNueva(A, antes, 'crear_impresora');
    expect(fila).toMatchObject({
      actor_usuario_id: A.adminId,
      sucursal_id: A.S1,
      actor_sistema: null,
    });
    await avanzar();

    // modificar_impresora
    exigirEstado(
      await llamar(ctx, A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${A.S1}/impresoras/${impresora.id}`,
        cuerpo: { nombre: `${impresora.nombre} bis`, anchoMm: 58 },
      }),
      200,
      'modificar la impresora',
    );
    fila = await unaNueva(A, antes, 'modificar_impresora');
    expect(fila).toMatchObject({ actor_usuario_id: A.adminId, sucursal_id: A.S1 });
    await avanzar();

    // configurar_destino_estacion (y el repetido no audita)
    const destino = () =>
      llamar(ctx, A.tokenAdmin, {
        metodo: 'put',
        ruta: `/sucursales/${A.S1}/estaciones-destino/${estacionId}`,
        cuerpo: { destino: 'IMPRESORA', impresoraId: impresora.id },
      });
    exigirEstado(await destino(), 200, 'configurar el destino');
    fila = await unaNueva(A, antes, 'configurar_destino_estacion');
    expect(fila).toMatchObject({ actor_usuario_id: A.adminId, sucursal_id: A.S1 });
    await avanzar();
    exigirEstado(await destino(), 200, 'repetir el destino');
    expect(await auditoriaNueva(admin, A.empresaId, antes)).toEqual([]);

    // configurar_impresion_sucursal
    exigirEstado(
      await llamar(ctx, A.tokenAdmin, {
        metodo: 'put',
        ruta: `/sucursales/${A.S1}/impresion`,
        cuerpo: { impresoraCajaId: impresora.id },
      }),
      200,
      'configurar la impresora de caja',
    );
    fila = await unaNueva(A, antes, 'configurar_impresion_sucursal');
    expect(fila).toMatchObject({ actor_usuario_id: A.adminId, sucursal_id: A.S1 });
    await avanzar();

    // crear_vinculacion_puente
    const vinculacion = await crearVinculacion(ctx, A.tokenAdmin, A.S1);
    fila = await unaNueva(A, antes, 'crear_vinculacion_puente');
    expect(fila).toMatchObject({ actor_usuario_id: A.adminId, sucursal_id: A.S1 });
    await avanzar();

    // vincular_puente: el actor es el propio puente, y el detalle lleva la vinculación y quién la creó
    const res = await vincular(ctx, vinculacion.token);
    exigirEstado(res, 201, 'vincular');
    const puenteId = res.body.puente.id as string;
    fila = await unaNueva(A, antes, 'vincular_puente');
    expect(fila).toMatchObject({
      actor_sistema: `puente:${puenteId}`,
      actor_usuario_id: null,
      actor_superadministrador_id: null,
      sucursal_id: A.S1,
    });
    const detalle = JSON.stringify(fila.detalle);
    expect(detalle).toContain(partesDe(vinculacion.token).id);
    expect(detalle).toContain(A.adminId);
    await avanzar();

    // Un rechazo (otro rol) y un intento con una vinculación usada no dejan nada.
    const rechazo = await llamar(ctx, roles.MOZO.contrasena, {
      metodo: 'delete',
      ruta: `/sucursales/${A.S1}/puentes/${puenteId}`,
    });
    expect(rechazo.status).toBe(403);
    expect((await vincular(ctx, vinculacion.token)).status).toBe(401);
    expect(await auditoriaNueva(admin, A.empresaId, antes)).toEqual([]);

    // revocar_puente (y el repetido no audita)
    const revocar = () =>
      llamar(ctx, A.tokenAdmin, {
        metodo: 'delete',
        ruta: `/sucursales/${A.S1}/puentes/${puenteId}`,
      });
    expect((await revocar()).status).toBe(204);
    fila = await unaNueva(A, antes, 'revocar_puente');
    expect(fila).toMatchObject({ actor_usuario_id: A.adminId, sucursal_id: A.S1 });
    await avanzar();
    expect((await revocar()).status).toBe(204);
    expect(await auditoriaNueva(admin, A.empresaId, antes)).toEqual([]);
  });

  it('los latidos, los resultados, las páginas de prueba y las reimpresiones no dejan fila de auditoría y quedan en la trazabilidad del trabajo', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const impresora = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const antes = await contarAuditoria(admin, A.empresaId);

    const prueba = await crearPrueba(ctx, A.tokenAdmin, A.S1, impresora.id);
    const latido = await llamarPuente(ctx, puente.token, 'post', '/puente/latido', {
      versionApp: '1.0.3',
      impresoras: [{ id: impresora.id, estado: 'NO_RESPONDE', error: 'Sin papel' }],
    });
    expect(latido.status, JSON.stringify(latido.body)).toBe(204);
    expect((await trabajosDelPuente(ctx, puente)).map((t) => t.id)).toEqual([prueba]);
    const reportado = await llamarPuente(
      ctx,
      puente.token,
      'post',
      `/puente/trabajos/${prueba}/resultado`,
      {
        resultado: 'NO_IMPRESO',
        error: 'La impresora no respondió',
      },
    );
    expect(reportado.status, JSON.stringify(reportado.body)).toBe(200);
    const impreso = await llamarPuente(
      ctx,
      puente.token,
      'post',
      `/puente/trabajos/${prueba}/resultado`,
      {
        resultado: 'IMPRESO',
      },
    );
    expect(impreso.status, JSON.stringify(impreso.body)).toBe(200);

    const reimpresion = await conClave(
      ctx,
      roles.MOZO.contrasena,
      'post',
      `/impresion/trabajos/${prueba}/reimpresion`,
    );
    exigirEstado(reimpresion, 201, 'reimprimir');
    const nuevoId = reimpresion.body.trabajoId as string;
    expect(nuevoId).not.toBe(prueba);

    expect(await contarAuditoria(admin, A.empresaId)).toBe(antes);
    // La reimpresión queda con quien la pidió y con el trabajo del que sale.
    expect(await autorDe(admin, 'trabajo_impresion', nuevoId)).toMatchObject({
      creadoPorUsuarioId: roles.MOZO.persona.id,
    });
    const fila = await admin.query<{ reimpresion_de_id: string | null; impresora_id: string }>(
      `SELECT reimpresion_de_id, impresora_id FROM trabajo_impresion WHERE id = $1`,
      [nuevoId],
    );
    expect(fila.rows[0]).toEqual({ reimpresion_de_id: prueba, impresora_id: impresora.id });
    expect(await autorDe(admin, 'trabajo_impresion', prueba)).toMatchObject({
      creadoPorUsuarioId: A.adminId,
    });
  });
});
