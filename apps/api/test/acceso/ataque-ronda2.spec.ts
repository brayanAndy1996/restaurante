// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ataque, ronda 2 (reportado por el adversarial). Cada bloque nace de una falla reproducida o de una
// cobertura que el adversarial no pudo ejecutar:
// - F-1 · criterio 53 y plan ("PIN con HMAC", "Nada secreto se registra") · criterios 85 y 86: la huella con
//   la que se guarda la idempotencia de `POST /autorizaciones` no puede ser un SHA-256 del cuerpo (ruta +
//   actor + cuerpo canónico) que contiene el PIN, porque con solo la base se podrían probar los 10^6 PIN.
//   Ninguna columna de `idempotencia`, `autorizacion` o `auditoria` puede igualar (ni contener) esa huella
//   ni un SHA-256 del PIN o del cuerpo en cualquier orden de claves. La idempotencia sigue funcionando.
// - O-1 · criterio 114: `PATCH /sucursales/:id` rechaza con 400 `DATOS_INVALIDOS` los campos de empresa y de
//   trazabilidad (`empresaId`, `creadoPorUsuarioId`, `creadoPorSistema`, `__proto__`) y no cambia la sucursal.
// - Criterio 36: ráfagas concurrentes de PIN fallidos de la misma persona en el mismo equipo (como máximo 5
//   evaluados antes del primer bloqueo, ningún umbral se salta, el 15.º olvida exactamente una vez).
// - Criterio 29: recordatorios concurrentes de personas distintas en un equipo con 4 personas.
// La API real con `RelojManual` y un pool de 10 conexiones que escucha en un puerto propio (el reloj no
// avanza solo: ningún bloqueo vence durante una ráfaga).
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arrancar, bearer, nuevoSuperadmin, type AppDePrueba } from './fabrica-plataforma';
import {
  MINUTO,
  agregarAEquipo,
  altaEmpresa,
  consultar,
  contienePin,
  crearPersona,
  equipoCon,
  esperarError,
  filasAuditoria,
  llamar,
  loginContrasena,
  loginPin,
  motivoDeRevocacion,
  nuevoEquipo,
  personasActivasDelEquipo,
  pinDistinto,
  pinOk,
  tokenAdmin,
  type Empresa,
  type Libre,
  type Persona,
} from './fabrica-equipos';

let ctx: AppDePrueba;
let A: Empresa;
let B: Empresa;

const app = () => ctx.app;
const sucursalDeA = (i: number) => A.sucursales[i]!.id;

beforeAll(async () => {
  ctx = await arrancar({ poolMax: 10 });
  // Escucha en un puerto propio para que las peticiones concurrentes no compartan un servidor efímero.
  await ctx.app.listen(0);
  const sa = await nuevoSuperadmin(ctx);
  A = await altaEmpresa(app(), sa.token, { sucursales: 3 });
  B = await altaEmpresa(app(), sa.token, { sucursales: 2 });
}, 180_000);

afterAll(async () => {
  await ctx?.cerrar();
});

// ------------------------------------------------------------------------------------------------
// F-1 · criterio 53 · la huella de idempotencia de POST /autorizaciones no es atacable en la base
// ------------------------------------------------------------------------------------------------
describe('F-1 · criterio 53 · la huella de la idempotencia no permite recuperar el PIN del supervisor', () => {
  const ACCION = 'ANULAR_ITEM_ENVIADO';
  const MOTIVO = 'El cliente reclamó el plato';

  interface Escenario {
    empresa: Empresa;
    supervisor: Persona;
    otroSupervisor: Persona;
    cajero: Persona;
    token: string;
  }

  /** Una empresa propia: todas las filas de `idempotencia` de la empresa son de la prueba que la crea. */
  async function escenario(): Promise<Escenario> {
    const sa = await nuevoSuperadmin(ctx);
    const empresa = await altaEmpresa(app(), sa.token, { sucursales: 1 });
    const sucursalId = empresa.sucursales[0]!.id;
    const supervisor = await crearPersona(app(), empresa, {
      accesos: [{ sucursalId, rol: 'SUPERVISOR' }],
    });
    const otroSupervisor = await crearPersona(app(), empresa, {
      accesos: [{ sucursalId, rol: 'SUPERVISOR' }],
    });
    const cajero = await crearPersona(app(), empresa, {
      accesos: [{ sucursalId, rol: 'CAJERO' }],
    });
    const { token } = await loginContrasena(app(), cajero);
    return { empresa, supervisor, otroSupervisor, cajero, token };
  }

  const autorizar = (
    token: string,
    clave: string,
    cuerpo: Record<string, unknown>,
  ): ReturnType<typeof llamar> =>
    llamar(app(), 'post', '/autorizaciones', {
      token,
      cabeceras: { 'Idempotency-Key': clave },
      cuerpo,
    });

  const sha256 = (texto: string): Buffer => createHash('sha256').update(texto, 'utf8').digest();

  /** Un digest en todas las formas en que podría haberse guardado. */
  function formasDe(digest: Buffer): string[] {
    const hex = digest.toString('hex');
    return [hex, hex.toUpperCase(), digest.toString('base64'), digest.toString('base64url')];
  }

  /** JSON con las claves ordenadas, recursivamente. */
  function jsonCanonico(valor: unknown): string {
    if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
    if (valor !== null && typeof valor === 'object') {
      const objeto = valor as Record<string, unknown>;
      return `{${Object.keys(objeto)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${jsonCanonico(objeto[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(valor);
  }

  function permutaciones<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((item, i) =>
      permutaciones([...items.slice(0, i), ...items.slice(i + 1)]).map((resto) => [item, ...resto]),
    );
  }

  /** El cuerpo con el PIN serializado con las claves en cada orden posible, más el canónico. */
  function cuerpos(cuerpo: Record<string, unknown>): string[] {
    const variantes = permutaciones(Object.keys(cuerpo)).map((claves) =>
      JSON.stringify(Object.fromEntries(claves.map((k) => [k, cuerpo[k]]))),
    );
    return [...new Set([jsonCanonico(cuerpo), ...variantes])];
  }

  /** Cadenas de las que podría haberse derivado una huella con el PIN, sin ningún secreto del entorno. */
  function preimagenes(
    cuerpo: Record<string, unknown> & { pin: string },
    ctxFila: { rutas: string[]; actores: string[]; empresaId: string },
  ): string[] {
    const salida = new Set<string>();
    const pin = cuerpo.pin;
    for (const sola of [
      pin,
      JSON.stringify(pin),
      `{"pin":${JSON.stringify(pin)}}`,
      String(Number(pin)),
    ]) {
      salida.add(sola);
      salida.add(`${ctxFila.empresaId}:${sola}`);
    }
    for (const c of cuerpos(cuerpo)) {
      salida.add(c);
      salida.add(`${ctxFila.empresaId}:${c}`);
      for (const r of ctxFila.rutas) {
        for (const a of ctxFila.actores) {
          salida.add(`${r}\n${a}\n${c}`);
          salida.add(`${a}\n${r}\n${c}`);
          salida.add(`${r}|${a}|${c}`);
          salida.add(`${r}:${a}:${c}`);
          salida.add(`${r}${a}${c}`);
        }
        salida.add(`${r}\n${c}`);
      }
    }
    return [...salida];
  }

  /** Textos en los que podría aparecer una huella guardada: cada columna de texto, binaria o JSON de la fila. */
  function textosDeFila(fila: Libre): { columna: string; texto: string }[] {
    const textos: { columna: string; texto: string }[] = [];
    for (const [columna, valor] of Object.entries(fila)) {
      if (typeof valor === 'string') textos.push({ columna, texto: valor });
      else if (Buffer.isBuffer(valor)) {
        for (const forma of [
          valor.toString('hex'),
          valor.toString('base64'),
          valor.toString('base64url'),
        ])
          textos.push({ columna, texto: forma });
        textos.push({ columna, texto: valor.toString('utf8') });
      } else if (valor !== null && typeof valor === 'object' && !(valor instanceof Date)) {
        textos.push({ columna, texto: JSON.stringify(valor) });
      }
    }
    return textos;
  }

  it('ninguna columna de idempotencia, autorizacion ni auditoria guarda un SHA-256 del cuerpo con el PIN, del PIN, ni el PIN', async () => {
    const e = await escenario();
    const cuerpo = { accion: ACCION, motivo: MOTIVO, pin: e.supervisor.pin };
    const res = await autorizar(e.token, randomUUID(), cuerpo);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const empresaId = e.empresa.id;
    const idempotencia = await consultar('SELECT * FROM idempotencia WHERE empresa_id = $1', [
      empresaId,
    ]);
    expect(idempotencia.length, 'la petición dejó su fila de idempotencia').toBeGreaterThan(0);
    const tablas: Record<string, Libre[]> = {
      idempotencia,
      autorizacion: await consultar('SELECT * FROM autorizacion WHERE empresa_id = $1', [
        empresaId,
      ]),
      auditoria: await consultar('SELECT * FROM auditoria WHERE empresa_id = $1', [empresaId]),
    };

    // La ruta y el actor con los que pudo calcularse la huella: valores típicos y los de las propias filas.
    const deLasFilas = Object.values(tablas)
      .flat()
      .flatMap((fila) => textosDeFila(fila).map((t) => t.texto))
      .filter((t) => t.length > 0 && t.length <= 200 && !/^[0-9a-f]{64}$/i.test(t));
    const rutas = [
      '/autorizaciones',
      'autorizaciones',
      'POST /autorizaciones',
      'POST:/autorizaciones',
      'POST',
      ...deLasFilas.filter((t) => t.includes('autorizaciones')),
    ];
    const actores = [
      e.cajero.id,
      `usuario:${e.cajero.id}`,
      `u:${e.cajero.id}`,
      `usuario/${e.cajero.id}`,
      `${empresaId}:${e.cajero.id}`,
      empresaId,
      '',
      ...deLasFilas,
    ];
    const prohibidos = new Set<string>();
    for (const preimagen of preimagenes(cuerpo, { rutas, actores, empresaId })) {
      for (const forma of formasDe(sha256(preimagen))) prohibidos.add(forma);
    }

    // La huella del PIN del propio supervisor (HMAC del usuario) tampoco puede estar en esas tablas.
    const [usuario] = await consultar('SELECT * FROM usuario WHERE id = $1', [e.supervisor.id]);
    const huellaDelUsuario = Object.entries(usuario ?? {})
      .filter(([columna]) => /huella.*pin|pin/i.test(columna))
      .map(([, valor]) => valor)
      .filter((valor) => valor !== null && valor !== undefined);
    const huellasDelPin = new Set<string>();
    for (const valor of huellaDelUsuario) {
      if (typeof valor === 'string') huellasDelPin.add(valor);
      else if (Buffer.isBuffer(valor)) for (const f of formasDe(valor)) huellasDelPin.add(f);
    }

    const coincidencias: string[] = [];
    for (const [tabla, filas] of Object.entries(tablas)) {
      for (const fila of filas) {
        for (const { columna, texto } of textosDeFila(fila)) {
          for (const prohibido of prohibidos) {
            if (texto === prohibido || (prohibido.length >= 43 && texto.includes(prohibido)))
              coincidencias.push(`${tabla}.${columna} = huella SHA-256 sin secreto (${prohibido})`);
          }
          for (const huella of huellasDelPin) {
            if (huella.length >= 16 && texto.includes(huella))
              coincidencias.push(`${tabla}.${columna} contiene la huella del PIN del supervisor`);
          }
          if (contienePin(texto, e.supervisor.pin))
            coincidencias.push(`${tabla}.${columna} contiene el PIN en claro`);
        }
      }
    }
    expect(
      coincidencias,
      'con solo la base se podrían probar los 10^6 PIN: la huella debe llevar un secreto del entorno',
    ).toEqual([]);
  }, 120_000);

  it('la misma clave con el mismo cuerpo devuelve la misma respuesta sin repetir el efecto', async () => {
    const e = await escenario();
    const clave = randomUUID();
    const cuerpo = { accion: ACCION, motivo: MOTIVO, pin: e.supervisor.pin };
    const primera = await autorizar(e.token, clave, cuerpo);
    expect(primera.status, JSON.stringify(primera.body)).toBe(201);
    const segunda = await autorizar(e.token, clave, { ...cuerpo });
    expect(segunda.status).toBe(primera.status);
    expect(segunda.body).toEqual(primera.body);
    // Con las claves en otro orden es el mismo cuerpo.
    const tercera = await autorizar(e.token, clave, {
      pin: e.supervisor.pin,
      motivo: MOTIVO,
      accion: ACCION,
    });
    expect(tercera.status).toBe(201);
    expect(tercera.body).toEqual(primera.body);

    const guardadas = await consultar('SELECT id FROM autorizacion WHERE solicitante_id = $1', [
      e.cajero.id,
    ]);
    expect(guardadas).toHaveLength(1);
    const otorgadas = (await filasAuditoria(e.empresa.id, 'autorizacion_otorgada')).filter(
      (f) => f.actor_usuario_id === e.cajero.id,
    );
    expect(otorgadas).toHaveLength(1);
  }, 120_000);

  it('la misma clave con otro pin o con otro motivo responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no crea otra autorización', async () => {
    const e = await escenario();
    const clave = randomUUID();
    const original = { accion: ACCION, motivo: MOTIVO, pin: e.supervisor.pin };
    const primera = await autorizar(e.token, clave, original);
    expect(primera.status, JSON.stringify(primera.body)).toBe(201);

    const intentos: [string, Record<string, unknown>][] = [
      ['otro pin (un PIN equivocado)', { ...original, pin: pinDistinto(e.supervisor.pin) }],
      ['otro pin (el de otro supervisor válido)', { ...original, pin: e.otroSupervisor.pin }],
      ['otro motivo', { ...original, motivo: 'Otro motivo distinto' }],
    ];
    for (const [nombre, cuerpo] of intentos) {
      const res = await autorizar(e.token, clave, cuerpo);
      expect({ nombre, estado: res.status, codigo: res.body?.codigo }).toEqual({
        nombre,
        estado: 422,
        codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA',
      });
      expect(res.body.autorizacionId, nombre).toBeUndefined();
    }

    // Ni una autorización ni una fila de auditoría de más: solo la primera.
    const guardadas = await consultar('SELECT id FROM autorizacion WHERE solicitante_id = $1', [
      e.cajero.id,
    ]);
    expect(guardadas).toHaveLength(1);
    const otorgadas = (await filasAuditoria(e.empresa.id, 'autorizacion_otorgada')).filter(
      (f) => f.actor_usuario_id === e.cajero.id,
    );
    expect(otorgadas).toHaveLength(1);

    // La clave sigue devolviendo la respuesta original con el cuerpo original.
    const repetida = await autorizar(e.token, clave, original);
    expect(repetida.status).toBe(201);
    expect(repetida.body).toEqual(primera.body);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
// O-1 · criterio 114 · PATCH /sucursales/:id no acepta campos de empresa ni de trazabilidad
// ------------------------------------------------------------------------------------------------
describe('O-1 · criterio 114 · PATCH /sucursales/:id rechaza los campos de empresa y de trazabilidad', () => {
  const instantanea = async (id: string) =>
    (await consultar('SELECT * FROM sucursal WHERE id = $1', [id]))[0];

  function parchar(token: string, sucursalId: string, cuerpoJson: string) {
    return ctx
      .http()
      .patch(`/sucursales/${sucursalId}`)
      .set(bearer(token))
      .set('Content-Type', 'application/json')
      .send(cuerpoJson);
  }

  const casos: [string, (direccion: string) => string][] = [
    ['empresaId (de otra empresa)', (d) => JSON.stringify({ direccion: d, empresaId: B.id })],
    [
      'creadoPorUsuarioId',
      (d) => JSON.stringify({ direccion: d, creadoPorUsuarioId: randomUUID() }),
    ],
    ['creadoPorSistema', (d) => JSON.stringify({ direccion: d, creadoPorSistema: 'impostor' })],
    [
      '__proto__ (clave propia del JSON)',
      (d) => `{"direccion":${JSON.stringify(d)},"__proto__":{"empresaId":${JSON.stringify(B.id)}}}`,
    ],
  ];

  it.each(casos)(
    'con %s en el cuerpo responde 400 DATOS_INVALIDOS y la sucursal no cambia',
    async (_nombre, armar) => {
      const token = await tokenAdmin(app(), A);
      const id = sucursalDeA(0);
      const antes = await instantanea(id);
      const antesDeB = await instantanea(B.sucursales[0]!.id);
      const res = await parchar(token, id, armar(`Intento ${randomUUID().slice(0, 8)} 123`));
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
      expect(await instantanea(id)).toEqual(antes);
      expect(await instantanea(B.sucursales[0]!.id)).toEqual(antesDeB);
    },
  );

  it('el mismo cambio sin el campo extra sí se aplica (control: el 400 se debe al campo desconocido)', async () => {
    const token = await tokenAdmin(app(), A);
    const id = sucursalDeA(1);
    const direccion = `Control ${randomUUID().slice(0, 8)} 456`;
    const res = await parchar(token, id, JSON.stringify({ direccion }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.direccion).toBe(direccion);
    expect((await instantanea(id))?.direccion).toBe(direccion);
  });
});

// ------------------------------------------------------------------------------------------------
// Criterio 36 · ráfagas concurrentes de PIN fallidos de la misma persona en el mismo equipo
// ------------------------------------------------------------------------------------------------
describe('criterio 36 · las ráfagas concurrentes de PIN fallidos no saltan ningún umbral', () => {
  const mozoEn = (...indices: number[]) =>
    crearPersona(app(), A, {
      accesos: indices.map((i) => ({ sucursalId: sucursalDeA(i), rol: 'MOZO' as const })),
    });

  interface Resp {
    status: number;
    body: Libre;
  }

  const rafaga = (tokenEquipo: string, persona: Persona, veces: number): Promise<Resp[]> =>
    Promise.all(
      Array.from({ length: veces }, () =>
        loginPin(app(), tokenEquipo, persona.id, pinDistinto(persona.pin)),
      ),
    );

  const cuenta = (respuestas: Resp[], estado: number) =>
    respuestas.filter((r) => r.status === estado).length;

  /** Cada respuesta es un 401 CREDENCIALES_INVALIDAS o un 429 BLOQUEO_TEMPORAL con los segundos que faltan. */
  function exigirSoloRechazos(respuestas: Resp[]): void {
    const inesperadas = respuestas.filter((r) => r.status !== 401 && r.status !== 429);
    expect(inesperadas.map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
    for (const r of respuestas.filter((x) => x.status === 401))
      expect(r.body).toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS' });
    for (const r of respuestas.filter((x) => x.status === 429)) {
      expect(r.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
      expect(typeof r.body.reintentarEnSegundos).toBe('number');
    }
  }

  const bloqueosAuditados = async (persona: Persona, equipoId: string) =>
    (await filasAuditoria(A.id, 'bloqueo_pin')).filter(
      (f) => f.texto.includes(persona.id) && f.texto.includes(equipoId),
    ).length;

  const olvidosAuditados = async (persona: Persona, equipoId: string) =>
    (await filasAuditoria(A.id, 'equipo_olvidado_por_bloqueo')).filter(
      (f) => f.texto.includes(persona.id) && f.texto.includes(equipoId),
    ).length;

  const sesionesPinAbiertas = async (equipoId: string, usuarioId: string) =>
    (
      await consultar(
        `SELECT 1 FROM sesion WHERE equipo_id = $1 AND usuario_id = $2 AND tipo = 'PIN' AND cerrada_en IS NULL`,
        [equipoId, usuarioId],
      )
    ).length;

  it('15 intentos fallidos simultáneos: se evalúan 5, el resto responde 429 y la persona sigue recordada y bloqueada', async () => {
    const u = await mozoEn(0);
    const v = await mozoEn(0);
    const e = await equipoCon(app(), [u, v]);

    const respuestas = await rafaga(e.tokenEquipo, u, 15);
    exigirSoloRechazos(respuestas);
    expect(
      cuenta(respuestas, 401),
      `solo 5 PIN pueden evaluarse antes del bloqueo; estados: ${respuestas.map((r) => r.status).join(',')}`,
    ).toBe(5);
    expect(cuenta(respuestas, 429)).toBe(10);

    // Un solo bloqueo, sin olvido (solo hubo 5 fallos) y el PIN correcto no entra mientras dure.
    expect(await bloqueosAuditados(u, e.equipoId)).toBe(1);
    expect(await olvidosAuditados(u, e.equipoId)).toBe(0);
    expect(await motivoDeRevocacion(e.equipoId, u.id)).toBeNull();
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e.tokenEquipo });
    const deU = lista.body.personas.find((p: Libre) => p.usuarioId === u.id);
    expect(deU?.bloqueadoHastaEn).not.toBeNull();
    esperarError(await loginPin(app(), e.tokenEquipo, u.id, u.pin), 429, 'BLOQUEO_TEMPORAL');
    expect(await sesionesPinAbiertas(e.equipoId, u.id)).toBe(0);

    // La otra persona del equipo no se afecta.
    expect((await loginPin(app(), e.tokenEquipo, v.id, v.pin)).status).toBe(201);
  }, 120_000);

  it('una ráfaga que cruza el umbral a mitad: 3 fallos seguidos y 10 simultáneos evalúan solo 2 más', async () => {
    const u = await mozoEn(0);
    const e = await equipoCon(app(), [u]);
    for (let i = 0; i < 3; i++) {
      esperarError(
        await loginPin(app(), e.tokenEquipo, u.id, pinDistinto(u.pin)),
        401,
        'CREDENCIALES_INVALIDAS',
      );
    }
    const respuestas = await rafaga(e.tokenEquipo, u, 10);
    exigirSoloRechazos(respuestas);
    expect(cuenta(respuestas, 401)).toBe(2);
    expect(cuenta(respuestas, 429)).toBe(8);
    expect(await bloqueosAuditados(u, e.equipoId)).toBe(1);
  }, 120_000);

  it('ráfagas sucesivas que cruzan el 5.º, el 10.º y el 15.º fallo: dos bloqueos y un solo olvido', async () => {
    const u = await mozoEn(0);
    const v = await mozoEn(0);
    const e = await equipoCon(app(), [u, v]);

    // Fallos 1 a 5: el 5.º bloquea.
    const primera = await rafaga(e.tokenEquipo, u, 12);
    exigirSoloRechazos(primera);
    expect([cuenta(primera, 401), cuenta(primera, 429)]).toEqual([5, 7]);
    esperarError(await loginPin(app(), e.tokenEquipo, u.id, u.pin), 429, 'BLOQUEO_TEMPORAL');

    // El bloqueo vence: los fallos 6 a 10 y el 10.º vuelve a bloquear (la cuenta no se reinició).
    ctx.reloj.avanzar(5 * MINUTO + 1000);
    const segunda = await rafaga(e.tokenEquipo, u, 12);
    exigirSoloRechazos(segunda);
    expect([cuenta(segunda, 401), cuenta(segunda, 429)]).toEqual([5, 7]);
    esperarError(await loginPin(app(), e.tokenEquipo, u.id, u.pin), 429, 'BLOQUEO_TEMPORAL');
    expect(await olvidosAuditados(u, e.equipoId)).toBe(0);

    // Fallos 11 a 15: el 15.º olvida a la persona; los intentos que quedan responden como el criterio 34.
    ctx.reloj.avanzar(5 * MINUTO + 1000);
    const tercera = await rafaga(e.tokenEquipo, u, 12);
    exigirSoloRechazos(tercera);
    expect(cuenta(tercera, 429), 'el 15.º fallo olvida, no bloquea').toBe(0);
    expect(cuenta(tercera, 401)).toBe(12);

    // Exactamente un olvido y dos bloqueos, auditados una sola vez cada uno.
    expect(await olvidosAuditados(u, e.equipoId)).toBe(1);
    expect(await bloqueosAuditados(u, e.equipoId)).toBe(2);
    const revocadas = await consultar(
      `SELECT motivo_revocacion FROM equipo_recordado WHERE equipo_id = $1 AND usuario_id = $2 AND revocado_en IS NOT NULL`,
      [e.equipoId, u.id],
    );
    expect(revocadas).toEqual([{ motivo_revocacion: 'BLOQUEO' }]);
    expect(
      await consultar(
        `SELECT 1 FROM equipo_recordado WHERE equipo_id = $1 AND usuario_id = $2 AND revocado_en IS NULL`,
        [e.equipoId, u.id],
      ),
    ).toHaveLength(0);

    // Ni siquiera el PIN correcto entra; sus sesiones del equipo están cerradas y V no se afecta.
    esperarError(await loginPin(app(), e.tokenEquipo, u.id, u.pin), 401, 'CREDENCIALES_INVALIDAS');
    expect(await sesionesPinAbiertas(e.equipoId, u.id)).toBe(0);
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: e.porPersona[u.id]!.sesion }),
      401,
      'NO_AUTENTICADO',
    );
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e.tokenEquipo });
    expect(lista.body.personas.map((p: Libre) => p.usuarioId)).toEqual([v.id]);
    expect((await pinOk(app(), e.tokenEquipo, v)).token).toBeTruthy();
  }, 180_000);
});

// ------------------------------------------------------------------------------------------------
// Criterio 29 · recordatorios concurrentes en un equipo con 4 personas
// ------------------------------------------------------------------------------------------------
describe('criterio 29 · recordatorios concurrentes en un equipo con 4 personas', () => {
  const mozo = () =>
    crearPersona(app(), A, { accesos: [{ sucursalId: sucursalDeA(0), rol: 'MOZO' }] });

  async function personas(n: number): Promise<Persona[]> {
    const lista: Persona[] = [];
    for (let i = 0; i < n; i++) lista.push(await mozo());
    return lista;
  }

  const revocadasPor = async (equipoId: string, motivo: string) =>
    consultar<{ usuario_id: string }>(
      `SELECT usuario_id FROM equipo_recordado WHERE equipo_id = $1 AND motivo_revocacion = $2`,
      [equipoId, motivo],
    );

  const reemplazosAuditados = async (equipoId: string) =>
    (await filasAuditoria(A.id, 'equipo_reemplazado')).filter((f) => f.texto.includes(equipoId));

  const recordarEnParalelo = async (tokenEquipo: string, nuevas: Persona[]) => {
    const sesiones = await Promise.all(nuevas.map((p) => loginContrasena(app(), p)));
    return Promise.all(
      sesiones.map((s) =>
        llamar(app(), 'post', '/sesion/equipo', {
          token: s.token,
          equipo: tokenEquipo,
          cuerpo: {},
        }),
      ),
    );
  };

  it('6 recordatorios simultáneos de personas distintas: quedan 5 activas y cada reemplazada lo es una sola vez', async () => {
    const [p1, p2, p3, p4, ...nuevas] = await personas(10);
    const originales = [p1!, p2!, p3!, p4!];
    const inicial = await nuevoEquipo(app(), originales[0]!);
    const sesiones: Record<string, string> = { [originales[0]!.id]: inicial.sesion };
    for (const persona of originales.slice(1)) {
      sesiones[persona.id] = (await agregarAEquipo(app(), persona, inicial.tokenEquipo)).sesion;
    }
    expect(await personasActivasDelEquipo(inicial.equipoId)).toBe(4);
    ctx.reloj.avanzar(MINUTO);

    const respuestas = await recordarEnParalelo(inicial.tokenEquipo, nuevas);
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);

    expect(await personasActivasDelEquipo(inicial.equipoId)).toBe(5);
    const lista = await llamar(app(), 'get', '/equipo', { equipo: inicial.tokenEquipo });
    const activas = lista.body.personas.map((p: Libre) => p.usuarioId) as string[];
    expect(new Set(activas).size).toBe(5);

    // Las 4 originales (último uso más antiguo) se reemplazan, y de las 6 nuevas solo una: 5 reemplazos.
    const reemplazadas = (await revocadasPor(inicial.equipoId, 'REEMPLAZADO')).map(
      (f) => f.usuario_id,
    );
    expect(reemplazadas).toHaveLength(5);
    expect(new Set(reemplazadas).size).toBe(5);
    for (const original of originales) expect(reemplazadas).toContain(original.id);
    const nuevasReemplazadas = nuevas.filter((p) => reemplazadas.includes(p.id));
    expect(nuevasReemplazadas).toHaveLength(1);
    expect(activas.sort()).toEqual(
      nuevas
        .filter((p) => !reemplazadas.includes(p.id))
        .map((p) => p.id)
        .sort(),
    );

    // Una fila de auditoría por reemplazo (ni duplicada ni faltante) y las sesiones de las reemplazadas, cerradas.
    const auditoria = await reemplazosAuditados(inicial.equipoId);
    expect(auditoria).toHaveLength(5);
    for (const id of reemplazadas)
      expect(auditoria.filter((f) => f.texto.includes(id))).toHaveLength(1);
    for (const original of originales) {
      esperarError(
        await llamar(app(), 'get', '/sesion', { token: sesiones[original.id]! }),
        401,
        'NO_AUTENTICADO',
      );
    }
  }, 240_000);

  it('2 recordatorios simultáneos con 4 personas: quedan 5 activas y se reemplaza a la de uso más antiguo una sola vez', async () => {
    const [p1, p2, p3, p4, n1, n2] = await personas(6);
    const originales = [p1!, p2!, p3!, p4!];
    const inicial = await nuevoEquipo(app(), originales[0]!);
    // La primera persona queda con el uso más antiguo: las demás se agregan un minuto después.
    ctx.reloj.avanzar(MINUTO);
    for (const persona of originales.slice(1)) {
      await agregarAEquipo(app(), persona, inicial.tokenEquipo);
    }
    ctx.reloj.avanzar(MINUTO);

    const respuestas = await recordarEnParalelo(inicial.tokenEquipo, [n1!, n2!]);
    expect(respuestas.map((r) => r.status)).toEqual([200, 200]);

    expect(await personasActivasDelEquipo(inicial.equipoId)).toBe(5);
    const reemplazadas = await revocadasPor(inicial.equipoId, 'REEMPLAZADO');
    expect(reemplazadas).toEqual([{ usuario_id: originales[0]!.id }]);
    expect(await motivoDeRevocacion(inicial.equipoId, originales[0]!.id)).toBe('REEMPLAZADO');
    expect(await reemplazosAuditados(inicial.equipoId)).toHaveLength(1);
    const lista = await llamar(app(), 'get', '/equipo', { equipo: inicial.tokenEquipo });
    const activas = (lista.body.personas.map((p: Libre) => p.usuarioId) as string[]).sort();
    expect(activas).toEqual(
      [originales[1]!.id, originales[2]!.id, originales[3]!.id, n1!.id, n2!.id].sort(),
    );
  }, 180_000);
});
