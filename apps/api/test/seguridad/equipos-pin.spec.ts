// Pruebas del desarrollador (no protegidas) de T32 a T34: lo que las pruebas protegidas de `test/acceso/`
// (equipos recordados, PIN) no alcanzan: concurrencia del ingreso con PIN y del olvido al 15.º fallo, la
// auditoría de recordar sin repetirse, el cierre de sesiones de otra persona del equipo y la migración de
// equipos (subir, bajar con datos y volver a subir). App real con `RelojManual`, sin `EMPRESA_POR_HEADER`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enTransaccion } from '../aislamiento/fabrica';
import {
  crearBaseNueva,
  migracionesEjecutadas,
  migrarHasta,
  revertirHasta,
} from '../acceso/fabrica-plataforma';
import {
  MINUTO,
  agregarAEquipo,
  altaEmpresa,
  consultar,
  crearEntorno,
  crearPersona,
  crearSuperadminDePrueba,
  equipoCon,
  esperarError,
  filasAuditoria,
  ingresarSuperadmin,
  llamar,
  loginPin,
  nuevoEquipo,
  pinDistinto,
  type Empresa,
  type Entorno,
} from '../acceso/fabrica-equipos';
import { abrirCliente } from '../utilidades';

const PREFIJO_EQUIPOS = '202610280005';

let entorno: Entorno;
let A: Empresa;

const app = () => entorno.app;
const mozo = () =>
  crearPersona(app(), A, { accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }] });

beforeAll(async () => {
  entorno = await crearEntorno();
  const sa = await crearSuperadminDePrueba();
  A = await altaEmpresa(app(), await ingresarSuperadmin(app(), sa));
}, 120_000);

afterAll(async () => {
  await entorno?.cerrar();
});

describe('ingreso con PIN · concurrencia', () => {
  it('dos personas que entran a la vez en el mismo equipo dejan una sola sesión PIN abierta', async () => {
    const [u, v] = [await mozo(), await mozo()];
    const e = await equipoCon(app(), [u, v]);
    const respuestas = await Promise.all([
      loginPin(app(), e.tokenEquipo, u.id, u.pin),
      loginPin(app(), e.tokenEquipo, v.id, v.pin),
      loginPin(app(), e.tokenEquipo, u.id, u.pin),
    ]);
    expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201]);
    const abiertas = await consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM sesion WHERE equipo_id = $1 AND tipo = 'PIN' AND cerrada_en IS NULL`,
      [e.equipoId],
    );
    expect(abiertas[0]!.n).toBe('1');
  });

  it('fallos concurrentes no evaden el olvido al 15.º: la persona queda olvidada una sola vez, sin errores 500', async () => {
    const u = await mozo();
    const e = await nuevoEquipo(app(), u);
    const incorrecto = pinDistinto(u.pin);
    const estados: number[] = [];
    for (let ronda = 0; ronda < 3; ronda++) {
      const lote = await Promise.all(
        Array.from({ length: 6 }, () => loginPin(app(), e.tokenEquipo, u.id, incorrecto)),
      );
      estados.push(...lote.map((r) => r.status));
      entorno.reloj.avanzar(5 * MINUTO + 1000);
    }
    expect(
      estados.every((s) => [401, 429].includes(s)),
      estados.join(','),
    ).toBe(true);
    const olvidos = (await filasAuditoria(A.id, 'equipo_olvidado_por_bloqueo')).filter((f) =>
      f.texto.includes(e.equipoId),
    );
    expect(olvidos).toHaveLength(1);
    const filas = await consultar<{ revocado_en: Date | null; motivo_revocacion: string | null }>(
      `SELECT revocado_en, motivo_revocacion FROM equipo_recordado WHERE equipo_id = $1`,
      [e.equipoId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.motivo_revocacion).toBe('BLOQUEO');
    esperarError(await loginPin(app(), e.tokenEquipo, u.id, u.pin), 401, 'CREDENCIALES_INVALIDAS');
  });
});

describe('recordar un equipo', () => {
  it('recordar de nuevo el mismo equipo actualiza el último uso y no repite la fila de auditoría', async () => {
    const u = await mozo();
    const e = await nuevoEquipo(app(), u);
    const antes = (await filasAuditoria(A.id, 'recordar_equipo')).filter((f) =>
      f.texto.includes(e.equipoId),
    );
    expect(antes).toHaveLength(1);
    entorno.reloj.avanzar(2 * MINUTO);
    await agregarAEquipo(app(), u, e.tokenEquipo);
    const despues = (await filasAuditoria(A.id, 'recordar_equipo')).filter((f) =>
      f.texto.includes(e.equipoId),
    );
    expect(despues).toHaveLength(1);
    const filas = await consultar<{ recordado_en: Date; ultimo_uso_en: Date }>(
      `SELECT recordado_en, ultimo_uso_en FROM equipo_recordado WHERE equipo_id = $1`,
      [e.equipoId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.ultimo_uso_en.getTime() - filas[0]!.recordado_en.getTime()).toBe(2 * MINUTO);
  });

  it('el equipo nuevo y su equipo recordado quedan creados a nombre de la persona y de ese mismo equipo', async () => {
    const u = await mozo();
    const e = await nuevoEquipo(app(), u);
    const [equipo] = await consultar(
      `SELECT creado_por_usuario_id, creado_por_equipo_id FROM equipo WHERE id = $1`,
      [e.equipoId],
    );
    expect(equipo).toMatchObject({ creado_por_usuario_id: u.id, creado_por_equipo_id: e.equipoId });
    const [recordado] = await consultar(
      `SELECT creado_por_usuario_id, creado_por_equipo_id FROM equipo_recordado WHERE id = $1`,
      [e.equipoRecordadoId],
    );
    expect(recordado).toMatchObject({
      creado_por_usuario_id: u.id,
      creado_por_equipo_id: e.equipoId,
    });
  });

  it('una sesión asociada a un equipo recordado no puede quedar con el equipo o la persona de otro (llave compuesta)', async () => {
    const [u, v] = [await mozo(), await mozo()];
    const eu = await nuevoEquipo(app(), u);
    const ev = await nuevoEquipo(app(), v);
    const api = await abrirCliente('api');
    try {
      const error = await enTransaccion(
        api,
        A.id,
        async () => {
          try {
            await api.query(
              `UPDATE sesion SET equipo_id = $2, equipo_recordado_id = $3 WHERE id = (
                 SELECT id FROM sesion WHERE equipo_recordado_id = $1 LIMIT 1)`,
              [eu.equipoRecordadoId, ev.equipoId, eu.equipoRecordadoId],
            );
            return null;
          } catch (e) {
            return e as { code?: string };
          }
        },
        { confirmar: false },
      );
      expect(error?.code).toBe('23503');
    } finally {
      await api.end();
    }
  });
});

describe('migración de equipos (up, down con datos y up otra vez)', () => {
  it('baja y vuelve a subir con equipos, sesiones PIN y referencias de trazabilidad ya escritas', async () => {
    const base = await crearBaseNueva('equipos');
    const plataforma = await abrirCliente('plataforma', base.base);
    const api = await abrirCliente('api', base.base);
    const admin = await abrirCliente('admin', base.base);
    try {
      await migrarHasta(base.base);
      const empresa = await enTransaccion(
        plataforma,
        null,
        async () =>
          (
            await plataforma.query(
              `INSERT INTO empresa (nombre, creado_en, actualizado_en) VALUES ('Empresa-eq', now(), now()) RETURNING id`,
            )
          ).rows[0].id as string,
        { confirmar: true },
      );
      const sucursal = await enTransaccion(
        plataforma,
        null,
        async () => {
          const emisor = (
            await plataforma.query(
              `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
               VALUES ($1, '20100070970', 'Emisor SAC', 'GENERAL', now(), now()) RETURNING id`,
              [empresa],
            )
          ).rows[0].id;
          return (
            await plataforma.query(
              `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
               VALUES ($1, $2, 'Sucursal', '0001', 'Av. 1', now(), now()) RETURNING id`,
              [empresa, emisor],
            )
          ).rows[0].id as string;
        },
        { confirmar: true },
      );
      const equipo = randomUUID();
      const usuario = await enTransaccion(
        api,
        empresa,
        async () =>
          (
            await api.query(
              `INSERT INTO usuario (empresa_id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal,
                                    huella_pin, largo_pin, creado_en, actualizado_en)
               VALUES ($1, 'Persona', $2, 'x', false, $3, 4, now(), now()) RETURNING id`,
              [empresa, `p-${randomUUID().slice(0, 10)}`, Buffer.alloc(32, 1)],
            )
          ).rows[0].id as string,
        { confirmar: true },
      );
      // Una escritura a nombre de la persona y de su equipo, un equipo recordado y una sesión PIN.
      await enTransaccion(
        api,
        empresa,
        async () => {
          await api.query('SELECT fijar_contexto_actor($1, $2, NULL, NULL)', [usuario, equipo]);
          await api.query(
            `INSERT INTO equipo (id, empresa_id, nombre, huella_secreto, ultimo_uso_en, creado_en, actualizado_en)
             VALUES ($1, $2, 'Equipo', $3, now(), now(), now())`,
            [equipo, empresa, Buffer.alloc(32, 2)],
          );
          const recordado = (
            await api.query(
              `INSERT INTO equipo_recordado (empresa_id, equipo_id, usuario_id, recordado_en, ultimo_uso_en, creado_en, actualizado_en)
               VALUES ($1, $2, $3, now(), now(), now(), now()) RETURNING id`,
              [empresa, equipo, usuario],
            )
          ).rows[0].id;
          await api.query(
            `INSERT INTO sesion (empresa_id, tipo, usuario_id, equipo_id, equipo_recordado_id, huella_secreto,
                                 ultima_actividad_en, expira_en, minutos_inactividad)
             VALUES ($1, 'PIN', $2, $3, $4, $5, now(), now() + interval '1 hour', 5)`,
            [empresa, usuario, equipo, recordado, Buffer.alloc(32, 3)],
          );
          await api.query(`UPDATE sucursal SET direccion = 'Con equipo' WHERE id = $1`, [sucursal]);
          await api.query(
            `INSERT INTO auditoria (empresa_id, ocurrido_en, origen, accion) VALUES ($1, now(), 'empresa', 'x')`,
            [empresa],
          );
        },
        { confirmar: true, actor: false },
      );
      const antes = await admin.query(
        `SELECT actualizado_por_equipo_id FROM sucursal WHERE id = $1`,
        [sucursal],
      );
      expect(antes.rows[0].actualizado_por_equipo_id).toBe(equipo);

      await revertirHasta(base.base, PREFIJO_EQUIPOS);
      expect(
        (await migracionesEjecutadas(base.base)).some((m) => m.startsWith(PREFIJO_EQUIPOS)),
      ).toBe(false);
      const tablas = await admin.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('equipo', 'equipo_recordado', 'sucursal_acceso')`,
      );
      expect(tablas.rows).toEqual([]);
      // Las sesiones PIN se borraron y ninguna fila quedó apuntando a un equipo que ya no existe.
      expect(
        (await admin.query(`SELECT 1 FROM sesion WHERE tipo = 'PIN' OR equipo_id IS NOT NULL`))
          .rows,
      ).toEqual([]);
      const despues = await admin.query(
        `SELECT actualizado_por_equipo_id, creado_por_equipo_id FROM sucursal WHERE id = $1`,
        [sucursal],
      );
      expect(despues.rows[0]).toEqual({
        actualizado_por_equipo_id: null,
        creado_por_equipo_id: null,
      });
      expect(
        (await admin.query(`SELECT direccion FROM sucursal WHERE id = $1`, [sucursal])).rows[0],
      ).toEqual({ direccion: 'Con equipo' });

      await migrarHasta(base.base);
      const llaves = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_constraint WHERE conname LIKE '%\\_equipo\\_fk' AND contype = 'f'`,
      );
      expect(Number(llaves.rows[0]!.n)).toBeGreaterThanOrEqual(10);
    } finally {
      for (const c of [plataforma, api, admin]) await c.end().catch(() => undefined);
      await base.eliminar();
    }
  }, 180_000);
});

describe('mis equipos', () => {
  it('GET /sesion/equipos devuelve solo los equipos propios, no los de otras personas', async () => {
    const [u, v] = [await mozo(), await mozo()];
    const eu = await nuevoEquipo(app(), u);
    await nuevoEquipo(app(), v);
    const res = await llamar(app(), 'get', '/sesion/equipos', { token: eu.sesion });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].equipo.id).toBe(eu.equipoId);
  });
});
