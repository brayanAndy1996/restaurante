// Prueba del desarrollador (no protegida) de la tarea T17: idempotencia de las escrituras (criterios 85 y
// 86, RNF-10). `@Idempotente()` + `IdempotenciaInterceptor` en las rutas de empresa (`POST /emisores`,
// `POST /sucursales`) y la idempotencia de plataforma dentro de `OperacionPlataforma.ejecutar`
// (`POST /plataforma/empresas/:id/emisores` y `/sucursales`). Usa la API real con `RelojManual`.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirCliente } from '../utilidades';
import { rucAleatorio, textoUnico } from '../aislamiento/fabrica';
import {
  HORA,
  altaEmpresa,
  arrancar,
  bearer,
  crearUsuarioConSesion,
  exigirEstado,
  ingresarOk,
  nuevoSuperadmin,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';

/** Lunes 1 de abril de 2030, 10:00 en Lima. */
const INICIO = '2030-04-01T10:00:00-05:00';

let ctx: AppDePrueba;
let admin: Client;
let sembradoPendiente:
  Promise<{ sa: SuperadminDePrueba; A: EmpresaDePrueba; B: EmpresaDePrueba }> | undefined;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

function sembrado() {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    return { sa, A: await altaEmpresa(ctx, sa), B: await altaEmpresa(ctx, sa) };
  })();
  return sembradoPendiente;
}

const cuerpoEmisor = (ruc = rucAleatorio()) => ({
  ruc,
  razonSocial: textoUnico('Emisor idempotente'),
  regimen: 'GENERAL',
});

const contar = async (sql: string, parametros: unknown[]) =>
  Number(((await admin.query(sql, parametros)).rows[0] as { n: string }).n);

const emisoresConRuc = (ruc: string) =>
  contar('SELECT count(*)::text AS n FROM emisor WHERE ruc = $1', [ruc]);

describe('idempotencia de empresa (POST /emisores, POST /sucursales)', () => {
  it('repetir la petición con la misma clave y el mismo cuerpo devuelve lo mismo sin repetir el efecto', async () => {
    const { A } = await sembrado();
    const clave = randomUUID();
    const cuerpo = cuerpoEmisor();
    const uno = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    exigirEstado(uno, 201, 'primera vez');
    const dos = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    exigirEstado(dos, 201, 'repetida');
    expect(dos.body).toEqual(uno.body);
    expect(await emisoresConRuc(cuerpo.ruc)).toBe(1);
    // Una sola fila de auditoría: la repetición no audita otra vez.
    const auditoria = await contar(
      `SELECT count(*)::text AS n FROM auditoria WHERE accion = 'crear_emisor' AND entidad_id = $1`,
      [uno.body.id],
    );
    expect(auditoria).toBe(1);
  });

  it('el orden de las claves del cuerpo no cambia la huella', async () => {
    const { A } = await sembrado();
    const clave = randomUUID();
    const ruc = rucAleatorio();
    const razonSocial = textoUnico('Orden');
    const uno = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send({ ruc, razonSocial, regimen: 'GENERAL' });
    const dos = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send({ regimen: 'GENERAL', razonSocial, ruc });
    exigirEstado(uno, 201, 'primera vez');
    exigirEstado(dos, 201, 'otro orden');
    expect(dos.body.id).toBe(uno.body.id);
  });

  it('la misma clave con otro cuerpo responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no ejecuta nada', async () => {
    const { A } = await sembrado();
    const clave = randomUUID();
    exigirEstado(
      await ctx
        .http()
        .post('/emisores')
        .set(bearer(A.admin.token))
        .set('Idempotency-Key', clave)
        .send(cuerpoEmisor()),
      201,
      'primera vez',
    );
    const otro = cuerpoEmisor();
    const res = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send(otro);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
    expect(await emisoresConRuc(otro.ruc)).toBe(0);
  });

  it('la misma clave en otra ruta responde 422', async () => {
    const { A } = await sembrado();
    const clave = randomUUID();
    exigirEstado(
      await ctx
        .http()
        .post('/emisores')
        .set(bearer(A.admin.token))
        .set('Idempotency-Key', clave)
        .send(cuerpoEmisor()),
      201,
      'emisor',
    );
    const res = await ctx
      .http()
      .post('/sucursales')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send({
        rucEmisor: A.emisores[0]!.ruc,
        nombre: textoUnico('Sucursal'),
        codigoEstablecimiento: '0077',
        direccion: 'Calle 1',
      });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
  });

  it('la misma clave con otro usuario responde 422', async () => {
    const { A } = await sembrado();
    const otro = await crearUsuarioConSesion(ctx, A.admin.token, { esAdministrador: true });
    const clave = randomUUID();
    const cuerpo = cuerpoEmisor();
    exigirEstado(
      await ctx
        .http()
        .post('/emisores')
        .set(bearer(A.admin.token))
        .set('Idempotency-Key', clave)
        .send(cuerpo),
      201,
      'primer usuario',
    );
    const res = await ctx
      .http()
      .post('/emisores')
      .set(bearer(otro.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
  });

  it('las claves de A y de B no se mezclan: la misma clave en B ejecuta y nunca devuelve la respuesta de A', async () => {
    const { A, B } = await sembrado();
    const clave = randomUUID();
    const deA = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpoEmisor());
    const cuerpoB = cuerpoEmisor();
    const deB = await ctx
      .http()
      .post('/emisores')
      .set(bearer(B.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpoB);
    exigirEstado(deA, 201, 'A');
    exigirEstado(deB, 201, 'B');
    expect(deB.body.id).not.toBe(deA.body.id);
    expect(deB.body.empresaId).toBe(B.empresaId);
    expect(JSON.stringify(deB.body)).not.toContain(A.empresaId);
    expect(await emisoresConRuc(cuerpoB.ruc)).toBe(1);
  });

  it('las respuestas de error no se guardan: la misma clave sirve después con un cuerpo válido', async () => {
    const { A } = await sembrado();
    const clave = randomUUID();
    const repetido = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpoEmisor(A.emisores[0]!.ruc));
    expect(repetido.status).toBe(400);
    const guardadas = await contar(
      'SELECT count(*)::text AS n FROM idempotencia WHERE clave = $1',
      [clave],
    );
    expect(guardadas).toBe(0);
    const bien = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpoEmisor());
    exigirEstado(bien, 201, 'después del error');
  });

  it('dos peticiones concurrentes con la misma clave ejecutan una sola vez y devuelven la misma respuesta', async () => {
    const { A } = await sembrado();
    const clave = randomUUID();
    const cuerpo = cuerpoEmisor();
    const respuestas = await Promise.all(
      Array.from({ length: 4 }, () =>
        ctx
          .http()
          .post('/emisores')
          .set(bearer(A.admin.token))
          .set('Idempotency-Key', clave)
          .send(cuerpo),
      ),
    );
    for (const res of respuestas) exigirEstado(res, 201, 'concurrente');
    expect(new Set(respuestas.map((r) => r.body.id)).size).toBe(1);
    expect(await emisoresConRuc(cuerpo.ruc)).toBe(1);
  });

  it('una clave que no es un UUID responde 400 DATOS_INVALIDOS; sin clave no se guarda nada', async () => {
    const { A } = await sembrado();
    const mala = await ctx
      .http()
      .post('/emisores')
      .set(bearer(A.admin.token))
      .set('Idempotency-Key', 'no-es-un-uuid')
      .send(cuerpoEmisor());
    expect(mala.status).toBe(400);
    expect(mala.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
    const antes = await contar(
      'SELECT count(*)::text AS n FROM idempotencia WHERE empresa_id = $1',
      [A.empresaId],
    );
    exigirEstado(
      await ctx.http().post('/emisores').set(bearer(A.admin.token)).send(cuerpoEmisor()),
      201,
      'sin clave',
    );
    const despues = await contar(
      'SELECT count(*)::text AS n FROM idempotencia WHERE empresa_id = $1',
      [A.empresaId],
    );
    expect(despues).toBe(antes);
  });

  it('las claves de más de 24 horas se borran al pasar y vuelven a servir', async () => {
    const { A } = await sembrado();
    const clave = randomUUID();
    exigirEstado(
      await ctx
        .http()
        .post('/emisores')
        .set(bearer(A.admin.token))
        .set('Idempotency-Key', clave)
        .send(cuerpoEmisor()),
      201,
      'primera vez',
    );
    ctx.reloj.avanzar(25 * HORA);
    try {
      const { token } = await ingresarOk(ctx, A.admin.usuario, A.admin.contrasena);
      const nuevo = cuerpoEmisor();
      const res = await ctx
        .http()
        .post('/emisores')
        .set(bearer(token))
        .set('Idempotency-Key', clave)
        .send(nuevo);
      exigirEstado(res, 201, 'clave vencida');
      expect(await emisoresConRuc(nuevo.ruc)).toBe(1);
      const filas = await contar('SELECT count(*)::text AS n FROM idempotencia WHERE clave = $1', [
        clave,
      ]);
      expect(filas).toBe(1);
    } finally {
      ctx.reloj.fijar(INICIO);
    }
  });
});

describe('idempotencia de plataforma (POST /plataforma/empresas/:id/emisores y /sucursales)', () => {
  const emisorDePlataforma = (ruc = rucAleatorio()) => ({
    ruc,
    razonSocial: textoUnico('Emisor de plataforma'),
    regimen: 'RER',
    motivo: 'Prueba de idempotencia',
  });

  it('repetir con la misma clave y el mismo cuerpo devuelve lo mismo sin repetir el efecto ni la auditoría', async () => {
    const { sa, A } = await sembrado();
    const clave = randomUUID();
    const cuerpo = emisorDePlataforma();
    const ruta = `/plataforma/empresas/${A.empresaId}/emisores`;
    const uno = await ctx
      .http()
      .post(ruta)
      .set(bearer(sa.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    const dos = await ctx
      .http()
      .post(ruta)
      .set(bearer(sa.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    exigirEstado(uno, 201, 'primera vez');
    exigirEstado(dos, 201, 'repetida');
    expect(dos.body).toEqual(uno.body);
    expect(await emisoresConRuc(cuerpo.ruc)).toBe(1);
    expect(
      await contar(
        `SELECT count(*)::text AS n FROM auditoria WHERE accion = 'agregar_emisor' AND detalle::text LIKE '%' || $1 || '%'`,
        [cuerpo.ruc],
      ),
    ).toBe(1);
  });

  it('la misma clave con otro cuerpo, otra empresa u otro superadministrador responde 422', async () => {
    const { sa, A, B } = await sembrado();
    const otroSa = await nuevoSuperadmin(ctx);
    const clave = randomUUID();
    const cuerpo = emisorDePlataforma();
    const rutaA = `/plataforma/empresas/${A.empresaId}/emisores`;
    exigirEstado(
      await ctx.http().post(rutaA).set(bearer(sa.token)).set('Idempotency-Key', clave).send(cuerpo),
      201,
      'primera vez',
    );
    const intentos = [
      [
        'otro cuerpo',
        () =>
          ctx
            .http()
            .post(rutaA)
            .set(bearer(sa.token))
            .set('Idempotency-Key', clave)
            .send(emisorDePlataforma()),
      ],
      [
        'otra empresa',
        () =>
          ctx
            .http()
            .post(`/plataforma/empresas/${B.empresaId}/emisores`)
            .set(bearer(sa.token))
            .set('Idempotency-Key', clave)
            .send(cuerpo),
      ],
      [
        'otro superadministrador',
        () =>
          ctx
            .http()
            .post(rutaA)
            .set(bearer(otroSa.token))
            .set('Idempotency-Key', clave)
            .send(cuerpo),
      ],
    ] as const;
    for (const [nombre, intento] of intentos) {
      const res = await intento();
      expect(res.status, nombre).toBe(422);
      expect(res.body, nombre).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
    }
  });

  it('una operación que falla no guarda la clave', async () => {
    const { sa, A } = await sembrado();
    const clave = randomUUID();
    const ruta = `/plataforma/empresas/${A.empresaId}/emisores`;
    const malo = await ctx
      .http()
      .post(ruta)
      .set(bearer(sa.token))
      .set('Idempotency-Key', clave)
      .send(emisorDePlataforma(A.emisores[0]!.ruc));
    expect(malo.status).toBe(400);
    exigirEstado(
      await ctx
        .http()
        .post(ruta)
        .set(bearer(sa.token))
        .set('Idempotency-Key', clave)
        .send(emisorDePlataforma()),
      201,
      'después del error',
    );
  });

  it('las sucursales por plataforma también son idempotentes', async () => {
    const { sa, A } = await sembrado();
    const clave = randomUUID();
    const cuerpo = {
      rucEmisor: A.emisores[0]!.ruc,
      nombre: textoUnico('Sucursal idempotente'),
      codigoEstablecimiento: '0088',
      direccion: 'Av. Idempotente 1',
      motivo: 'Prueba de idempotencia',
    };
    const ruta = `/plataforma/empresas/${A.empresaId}/sucursales`;
    const uno = await ctx
      .http()
      .post(ruta)
      .set(bearer(sa.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    const dos = await ctx
      .http()
      .post(ruta)
      .set(bearer(sa.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    exigirEstado(uno, 201, 'primera vez');
    exigirEstado(dos, 201, 'repetida');
    expect(dos.body).toEqual(uno.body);
    expect(
      await contar('SELECT count(*)::text AS n FROM sucursal WHERE nombre = $1', [cuerpo.nombre]),
    ).toBe(1);
  });
});
