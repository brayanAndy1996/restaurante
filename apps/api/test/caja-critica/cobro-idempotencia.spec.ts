// spec: 006-caja-cobro (pruebas protegidas)
//
// P2 · Idempotencia del cobro (ruta crítica), criterios 54 a 56:
// - 54: la misma `Idempotency-Key` con el mismo cuerpo devuelve la misma respuesta sin cobrar, numerar, imprimir ni
//   abrir la gaveta otra vez; con otro cuerpo, 422 CLAVE_IDEMPOTENCIA_REUTILIZADA;
// - 55: el mismo `id` de cobro con otra clave o desde otra sesión devuelve el cobro ya hecho (aunque la orden o el turno
//   ya estén cerrados), sin efectos; con otra orden, parte, comprobante o pagos, 422; se reconoce antes de validar el
//   turno y la cuenta;
// - 56: diez peticiones concurrentes con el mismo `id` dejan un cobro, un comprobante con un solo número y un trabajo
//   de impresión; todas responden 201 con el mismo cuerpo o alguna 409 CONFLICTO que, repetida, responde 201.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  Cierres,
  cobrarCrudo,
  cobrosDeLaOrden,
  comprobantesDeLaOrden,
  conteo,
  crearEscenario,
  cuentaC,
  cuerpoDeCobro,
  efectivo,
  esperarError,
  exigirEstado,
  filas,
  impresoraDeCaja,
  trabajosDe,
  ultimoNumero,
  versionDe,
  yape,
  type AppP5,
  type Escenario,
  type Libre,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const cierres = new Cierres();
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 8 });
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});

let turnoCajero: Promise<string> | undefined;
const turno = () =>
  (turnoCajero ??= (async () =>
    abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1))());

const numeroDeComprobantes = async (ordenId: string) =>
  (await comprobantesDeLaOrden(ordenId)).length;

describe('criterio 54 · la misma clave', () => {
  it('la misma clave con el mismo cuerpo devuelve la misma respuesta sin cobrar ni numerar otra vez', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '69.20',
    });
    const clave = randomUUID();
    const primera = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo, clave);
    exigirEstado(primera, 201, 'Cobrar (006, criterio 47)');
    const caja1 = (await A().cajas()).S1!.caja1;
    const numero = await ultimoNumero(caja1, 'BOLETA');
    const segunda = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo, clave);
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primera.body);
    expect(await ultimoNumero(caja1, 'BOLETA')).toBe(numero);
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
    expect(await numeroDeComprobantes(cuenta.ordenId)).toBe(1);
  });

  it('la misma clave con otro cuerpo responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const clave = randomUUID();
    exigirEstado(
      await cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId, version, total: '69.20' }),
        clave,
      ),
      201,
      'Cobrar',
    );
    const otro = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version, total: '69.20', pagos: [yape('69.20')] }),
      clave,
    );
    esperarError(otro, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
  });
});

describe('criterio 55 · el mismo id de cobro con otra clave', () => {
  it('devuelve el cobro original con otra clave, desde otra sesión y sin cobrar ni numerar de nuevo', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '69.20',
    });
    const original = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo);
    exigirEstado(original, 201, 'Cobrar');
    const caja1 = (await A().cajas()).S1!.caja1;
    const numero = await ultimoNumero(caja1, 'BOLETA');
    // Otra clave y la orden ya cerrada: se reconoce el id antes de mirar la cuenta.
    const otraClave = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo);
    expect(otraClave.status, otraClave.text).toBe(201);
    expect(otraClave.body).toEqual(original.body);
    // Otra sesión de la empresa (un Supervisor), con una versión y un total ya viejos: no cuentan en la huella.
    const otraSesion = await cobrarCrudo(ctx, A().token.supervisor!, cuenta.ordenId, {
      ...cuerpo,
      version: 1,
      total: '1.00',
    });
    expect(otraSesion.status, otraSesion.text).toBe(201);
    expect(otraSesion.body).toEqual(original.body);
    expect(await ultimoNumero(caja1, 'BOLETA')).toBe(numero);
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
  });

  it('también con el turno cerrado', async () => {
    const cajas = await A().cajas();
    const turno2 = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2);
    await turno(); // el del Cajero sigue abierto: el de la Caja 2 no es el último y se puede cerrar
    const cuenta = await cuentaC(ctx, A());
    const cuerpo = cuerpoDeCobro({
      turnoId: turno2,
      version: await versionDe(cuenta.ordenId),
      total: '69.20',
    });
    const original = await cobrarCrudo(ctx, A().token.cajero2!, cuenta.ordenId, cuerpo);
    exigirEstado(original, 201, 'Cobrar');
    const cierre = await cerrarTurnoCrudo(
      ctx,
      A().token.cajero2!,
      turno2,
      conteo(
        { EFECTIVO: '269.20' },
        { EFECTIVO: 'x', TARJETA_CREDITO: 'x', TARJETA_DEBITO: 'x', YAPE: 'x', PLIN: 'x' },
      ),
    );
    exigirEstado(cierre, 200, 'Cerrar el turno (006, criterio 31)');
    const replica = await cobrarCrudo(ctx, A().token.cajero2!, cuenta.ordenId, cuerpo);
    expect(replica.status, replica.text).toBe(201);
    expect(replica.body).toEqual(original.body);
  });

  it('el mismo id con otra orden, parte, comprobante o pagos responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const id = randomUUID();
    const base = { id, turnoId, version };
    exigirEstado(
      await cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ ...base, total: '69.20' }),
      ),
      201,
      'Cobrar',
    );
    const otraOrden = await cuentaC(ctx, A());
    const variantes: Array<[string, string, Libre]> = [
      [
        'otra orden',
        otraOrden.ordenId,
        cuerpoDeCobro({ ...base, version: await versionDe(otraOrden.ordenId), total: '69.20' }),
      ],
      [
        'otros pagos',
        cuenta.ordenId,
        cuerpoDeCobro({ ...base, total: '69.20', pagos: [yape('69.20')] }),
      ],
      [
        'otro comprobante',
        cuenta.ordenId,
        cuerpoDeCobro({ ...base, total: '69.20', formato: 'CONSUMO' }),
      ],
      [
        'otra parte',
        cuenta.ordenId,
        cuerpoDeCobro({
          ...base,
          total: '34.60',
          parte: { tipo: 'IGUALES', partesRestantes: 2 },
          formato: 'CONSUMO',
          pagos: [efectivo('34.60')],
        }),
      ],
    ];
    for (const [que, ordenId, cuerpo] of variantes) {
      const res = await cobrarCrudo(ctx, A().token.cajero!, ordenId, cuerpo);
      expect(res.status, `${que}: ${res.text}`).toBe(422);
      expect(res.body.codigo, que).toBe('CLAVE_IDEMPOTENCIA_REUTILIZADA');
    }
    expect(await cobrosDeLaOrden(otraOrden.ordenId)).toEqual([]);
  });
});

describe('criterio 56 · réplicas simultáneas', () => {
  it('diez peticiones con el mismo id dejan un cobro, un número y un trabajo de impresión', async () => {
    // S3 tiene impresora de caja con gaveta (emulada) para contar el trabajo del ticket.
    const cajas = await A().cajas();
    await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S3, 'Caja de S3', {
      cajaId: cajas.S3!.caja1,
    });
    const turnoId = await abrirTurno(ctx, A().token.cajeroS3!, cajas.S3!.caja1);
    const cuenta = await cuentaC(ctx, A(), 'S3');
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '69.20',
    });
    const antes = await ultimoNumero(cajas.S3!.caja1, 'BOLETA');
    const claveCompartida = randomUUID();
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        cobrarCrudo(
          ctx,
          A().token.cajeroS3!,
          cuenta.ordenId,
          cuerpo,
          i < 5 ? claveCompartida : randomUUID(),
        ),
      ),
    );
    for (const r of respuestas) {
      expect([201, 409], `${r.status} ${r.text}`).toContain(r.status);
      if (r.status === 409) expect(r.body.codigo).toBe('CONFLICTO');
    }
    const creadas = respuestas.filter((r) => r.status === 201);
    expect(creadas.length).toBeGreaterThan(0);
    for (const r of creadas) expect(r.body).toEqual(creadas[0]!.body);
    // Lo que respondió 409 y se repite responde 201 con el mismo cuerpo.
    for (const r of respuestas.filter((x) => x.status === 409)) {
      void r;
      const repetida = await cobrarCrudo(ctx, A().token.cajeroS3!, cuenta.ordenId, cuerpo);
      expect(repetida.status, repetida.text).toBe(201);
      expect(repetida.body).toEqual(creadas[0]!.body);
    }
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
    expect(await numeroDeComprobantes(cuenta.ordenId)).toBe(1);
    expect(await ultimoNumero(cajas.S3!.caja1, 'BOLETA')).toBe(antes + 1);
    const comprobante = (await comprobantesDeLaOrden(cuenta.ordenId))[0]!;
    const trabajos = (await trabajosDe(A().S3, 'COMPROBANTE')).filter(
      (t) => t.comprobante_id === comprobante.id,
    );
    expect(trabajos).toHaveLength(1);
    expect(
      await filas('SELECT 1 FROM comprobante WHERE orden_id = $1 AND numero = $2', [
        cuenta.ordenId,
        antes + 1,
      ]),
    ).toHaveLength(1);
  });
});
