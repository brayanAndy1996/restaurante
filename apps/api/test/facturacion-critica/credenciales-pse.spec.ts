// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P9 · Credenciales del PSE cifradas (ruta crítica), criterios 123 y 166:
// - `PUT /plataforma/empresas/:empresaId/emisores/:emisorId/pse` con `{ modo, credencial? }`: la credencial es un objeto de 1
//   a 5 pares (nombres `^[a-z][a-zA-Z0-9_]{0,39}$`, valores de 1 a 2000 caracteres), `null` la borra y ausente la conserva; la
//   respuesta (y el `GET`) dice si hay credencial y los **nombres** de sus campos, nunca los valores;
// - se guarda cifrada (AES-256-GCM con datos asociados `credencial-pse:<empresaId>:<emisorId>`): el valor guardado no contiene
//   la credencial en claro ni en base64, cada escritura lleva un IV nuevo, y repetir la misma configuración no cambia nada;
// - el cifrado de A copiado a la fila de B (o con un byte cambiado) no se abre: el envío de B termina en
//   `ERROR_CONFIGURACION` sin llamar al PSE ni usar la credencial de A; con la fila restaurada, B envía con la suya;
// - el worker le pasa al conector la credencial de su emisor y de ningún otro;
// - `restaurante_api` ve las filas de su empresa pero no las de B; ninguna respuesta, evento, fila de `intento_pse`,
//   `envio_pse` o `comprobante`, auditoría ni registro capturado durante un envío contiene los valores de la credencial; el
//   cambio deja `configurar_pse_emisor` en la auditoría con los nombres de los campos, nunca los valores;
// - el Administrador del cliente no las ve ni las configura.
// Hoy falla porque `configuracion_pse` no existe y las rutas de plataforma de 6b responden «No implementado».
import { configuracionPseRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { conActor, enTransaccion } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  activarSimulado,
  api,
  arrancarFact,
  capturarRegistros,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  escribir,
  exigirEstado,
  filas,
  filasDeAuditoria,
  intentosDe,
  limitarBarrido,
  ponerPse,
  procesar,
  rutaPse,
  textoDeAuditoria,
  turnoDe,
  type AppFact,
  type EmpresaCaja,
  type Escenario,
  type Libre,
  type Res,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

const SECRETO_A = { usuarioPse: 'usr-A-9f31c2d8', tokenPse: 'TKN-Ultra-Secreto-A-7b21d8e4a6' };
const SECRETO_B = { usuarioPse: 'usr-B-4e7a90c1', tokenPse: 'TKN-Ultra-Secreto-B-c0a1f3d95e' };
const OTRO = { usuarioPse: 'usr-A-otro-3d5e7f', tokenPse: 'TKN-Otro-Secreto-A-12ab34cd56' };

let ctx: AppFact;
let esc: Escenario;
let admin: Client;
let apiCliente: Client;
let restaurarBarrido: () => void;
const A = () => esc.A;
const B = () => esc.B;
const MIN = 60_000;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx, { conPse: false });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
  restaurarBarrido = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurarBarrido?.();
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
  await cerrarAdmin();
});
beforeEach(() => {
  ctx.pse.reglas.limpiar();
  ctx.pse.reiniciar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
});

const poner = (e: EmpresaCaja, cuerpo: Libre, emisorId: string = e.emisor1): Promise<Res> =>
  ponerPse(ctx, esc, e.id, emisorId, cuerpo);

async function configurar(
  e: EmpresaCaja,
  credencial: Record<string, string> | null,
): Promise<Libre> {
  const res = await poner(e, { modo: 'SIMULADO', credencial });
  exigirEstado(res, 200, 'Configurar el PSE del emisor (006, criterios 122 y 123)');
  return configuracionPseRespuestaSchema.parse(res.body);
}

const filaConfig = async (e: EmpresaCaja, emisorId: string = e.emisor1): Promise<Libre> =>
  (
    await filas('SELECT * FROM configuracion_pse WHERE empresa_id = $1 AND emisor_id = $2', [
      e.id,
      emisorId,
    ])
  )[0]!;
const bytesDe = async (e: EmpresaCaja): Promise<Buffer | null> =>
  (await filaConfig(e)).credencial as Buffer | null;

/** Las formas en que un valor podría aparecer escondido en un texto o en unos bytes. */
function formasDe(valor: string): string[] {
  const b = Buffer.from(valor);
  return [valor, b.toString('base64'), b.toString('base64url'), b.toString('hex')];
}
function sinSecretos(texto: string | Buffer, secretos: Record<string, string>[], donde: string) {
  const contenido = typeof texto === 'string' ? texto : texto.toString('latin1');
  const crudo = typeof texto === 'string' ? Buffer.from(texto) : texto;
  for (const secreto of secretos) {
    for (const valor of Object.values(secreto)) {
      for (const forma of formasDe(valor)) {
        expect(contenido.includes(forma), `${donde} no debe llevar «${forma}»`).toBe(false);
      }
      expect(crudo.includes(Buffer.from(valor)), `${donde} (bytes) no debe llevar «${valor}»`).toBe(
        false,
      );
    }
  }
}

describe('criterios 122 y 123 · la respuesta nunca trae los valores', () => {
  it('un emisor sin configuración responde modo null y sin credencial', async () => {
    const res = await api(ctx, esc.sa.token, 'get', rutaPse(A().id, A().emisor1));
    exigirEstado(res, 200, 'GET de la configuración del PSE (006, criterio 122)');
    expect(configuracionPseRespuestaSchema.parse(res.body)).toEqual({
      emisorId: A().emisor1,
      modo: null,
      conector: null,
      credencialConfigurada: false,
      camposCredencial: [],
      actualizadaEn: null,
    });
  });

  it('el PUT con credencial responde los nombres de los campos y no los valores; el GET igual', async () => {
    const res = await poner(A(), { modo: 'SIMULADO', credencial: SECRETO_A });
    exigirEstado(res, 200, 'PUT de la configuración del PSE');
    const cuerpo = configuracionPseRespuestaSchema.parse(res.body);
    expect(cuerpo).toMatchObject({
      emisorId: A().emisor1,
      modo: 'SIMULADO',
      conector: null,
      credencialConfigurada: true,
    });
    expect([...cuerpo.camposCredencial].sort()).toEqual(['tokenPse', 'usuarioPse']);
    expect(cuerpo.actualizadaEn).not.toBeNull();
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'actualizadaEn',
        'camposCredencial',
        'conector',
        'credencialConfigurada',
        'emisorId',
        'modo',
      ].sort(),
    );
    sinSecretos(res.text, [SECRETO_A], 'la respuesta del PUT');
    const lectura = await api(ctx, esc.sa.token, 'get', rutaPse(A().id, A().emisor1));
    exigirEstado(lectura, 200, 'GET de la configuración del PSE');
    expect(lectura.body).toEqual(res.body);
    sinSecretos(lectura.text, [SECRETO_A], 'la respuesta del GET');
  });

  it('el Administrador del cliente no la ve ni la configura (las rutas de /plataforma no son suyas)', async () => {
    for (const token of [A().token.admin, A().token.supervisor, A().token.cajero]) {
      const lectura = await api(ctx, token, 'get', rutaPse(A().id, A().emisor1));
      expect([401, 403]).toContain(lectura.status);
      sinSecretos(lectura.text, [SECRETO_A], 'la respuesta a una sesión de empresa');
      const escritura = await escribir(ctx, token, 'put', rutaPse(A().id, A().emisor1), {
        modo: 'SIMULADO',
        credencial: OTRO,
      });
      expect([401, 403]).toContain(escritura.status);
    }
    expect((await configurar(A(), SECRETO_A)).camposCredencial.length).toBe(2);
  });
});

describe('criterio 123 · cifrada con AES-256-GCM, un IV por escritura', () => {
  it('el valor guardado no contiene la credencial en claro ni en base64, y lleva la versión, la clave y el IV', async () => {
    await configurar(A(), SECRETO_A);
    const fila = await filaConfig(A());
    const bytes = fila.credencial as Buffer;
    expect(Buffer.isBuffer(bytes)).toBe(true);
    // versión (1) + clave (1) + IV (12) + etiqueta (16) + cifrado (≥ 1).
    expect(bytes.length).toBeGreaterThan(30);
    expect(fila.clave_id).not.toBeNull();
    expect([...(fila.campos_credencial as string[])].sort()).toEqual(['tokenPse', 'usuarioPse']);
    sinSecretos(bytes, [SECRETO_A], 'el valor guardado');
    sinSecretos(JSON.stringify(fila), [SECRETO_A], 'la fila completa');
    // Ni la JSON de la credencial ni sus nombres con sus valores.
    expect(bytes.includes(Buffer.from(JSON.stringify(SECRETO_A)))).toBe(false);
  });

  it('repetir la misma configuración responde 200 sin cambios ni auditoría; cambiarla y volver deja otro IV', async () => {
    await configurar(A(), SECRETO_A);
    const antes = (await bytesDe(A()))!;
    const actualizada = (await filaConfig(A())).actualizado_en as Date;
    const auditorias = async () =>
      (
        await filasDeAuditoria(admin, "accion = 'configurar_pse_emisor' AND empresa_id = $1", [
          A().id,
        ])
      ).length;
    const filasAntes = await auditorias();
    const repetida = await poner(A(), { modo: 'SIMULADO', credencial: SECRETO_A });
    exigirEstado(repetida, 200, 'Repetir la misma configuración (006, criterio 122)');
    expect((await bytesDe(A()))!.equals(antes)).toBe(true);
    expect((await filaConfig(A())).actualizado_en).toEqual(actualizada);
    expect(await auditorias()).toBe(filasAntes);

    await configurar(A(), OTRO);
    const cambiada = (await bytesDe(A()))!;
    expect(cambiada.equals(antes)).toBe(false);
    expect(await auditorias()).toBe(filasAntes + 1);
    await configurar(A(), SECRETO_A);
    const devuelta = (await bytesDe(A()))!;
    expect(
      devuelta.equals(antes),
      'el mismo texto cifrado dos veces da bytes distintos (IV aleatorio)',
    ).toBe(false);
    sinSecretos(devuelta, [SECRETO_A, OTRO], 'el valor guardado');
    expect(await auditorias()).toBe(filasAntes + 2);
  });

  it('`credencial` ausente la conserva y `null` la borra', async () => {
    await configurar(A(), SECRETO_A);
    const antes = (await bytesDe(A()))!;
    const conserva = await poner(A(), { modo: 'SIMULADO' });
    exigirEstado(conserva, 200, 'PUT sin credencial');
    expect(configuracionPseRespuestaSchema.parse(conserva.body).credencialConfigurada).toBe(true);
    expect((await bytesDe(A()))!.equals(antes)).toBe(true);

    const borra = await poner(A(), { modo: 'SIMULADO', credencial: null });
    exigirEstado(borra, 200, 'PUT con credencial null');
    expect(configuracionPseRespuestaSchema.parse(borra.body)).toMatchObject({
      credencialConfigurada: false,
      camposCredencial: [],
    });
    const fila = await filaConfig(A());
    expect(fila.credencial).toBeNull();
    expect(fila.clave_id).toBeNull();
    expect(fila.campos_credencial).toEqual([]);
    await configurar(A(), SECRETO_A);
  });

  it('rechaza con 400 una credencial mal formada y no cambia nada', async () => {
    await configurar(A(), SECRETO_A);
    const antes = (await bytesDe(A()))!;
    const malas: unknown[] = [
      {},
      Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`campo${i}`, 'valor'])),
      { Usuario: 'valor' },
      { '1abc': 'valor' },
      { 'a-b': 'valor' },
      { ['a'.repeat(41)]: 'valor' },
      { usuario: '' },
      { usuario: 'x'.repeat(2001) },
      { usuario: 123 },
      ['usuario'],
      'texto',
    ];
    for (const credencial of malas) {
      const res = await poner(A(), { modo: 'SIMULADO', credencial });
      expect(res.status, JSON.stringify(credencial).slice(0, 60)).toBe(400);
    }
    for (const cuerpo of [{}, { modo: 'OTRO' }, { modo: 'SIMULADO', empresaId: randomUUID() }]) {
      expect((await poner(A(), cuerpo)).status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect((await bytesDe(A()))!.equals(antes)).toBe(true);
    // Los límites válidos: 5 campos y valores de 2000 caracteres.
    const limite = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`c${'x'.repeat(i)}`, 'v'.repeat(2000)]),
    );
    exigirEstado(
      await poner(A(), { modo: 'SIMULADO', credencial: limite }),
      200,
      'Límites válidos',
    );
    await configurar(A(), SECRETO_A);
  });

  it('un emisor de otra empresa en la ruta responde 404', async () => {
    const res = await ponerPse(ctx, esc, A().id, B().emisor1, { modo: 'SIMULADO' });
    expect(res.status, res.text).toBe(404);
    const lectura = await api(ctx, esc.sa.token, 'get', rutaPse(A().id, B().emisor1));
    expect(lectura.status).toBe(404);
  });
});

describe('criterio 166 · con el contexto de A no se lee la configuración de B', () => {
  it('restaurante_api solo ve las filas de su empresa, y no las puede insertar ni cambiar', async () => {
    await configurar(A(), SECRETO_A);
    await configurar(B(), SECRETO_B);
    await enTransaccion(apiCliente, A().id, async () => {
      const visibles = await apiCliente.query<{ emisor_id: string; empresa_id: string }>(
        'SELECT emisor_id, empresa_id FROM configuracion_pse',
      );
      expect(visibles.rows.every((f) => f.empresa_id === A().id)).toBe(true);
      expect(visibles.rows.map((f) => f.emisor_id)).toContain(A().emisor1);
      const deB = await apiCliente.query(
        'SELECT credencial FROM configuracion_pse WHERE emisor_id = $1 OR empresa_id = $2',
        [B().emisor1, B().id],
      );
      expect(deB.rows).toEqual([]);
    });
  });
});

describe('criterios 123 y 166 · el worker usa la credencial de su emisor y de ningún otro', () => {
  it('cada emisor envía con la suya', async () => {
    await configurar(A(), SECRETO_A);
    await configurar(B(), SECRETO_B);
    const espia = vi.spyOn(ctx.pse, 'emitir');
    try {
      const turnoA = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
      const turnoB = await turnoDe(ctx, B(), 'cajero', 'S1', 'caja1');
      const deA = await cobrarLomo(ctx, A(), { turnoId: turnoA });
      const deB = await cobrarLomo(ctx, B(), { turnoId: turnoB });
      await procesar(ctx, A().id, deA.comprobanteId);
      await procesar(ctx, B().id, deB.comprobanteId);
      expect(espia.mock.calls).toHaveLength(2);
      // A y B pueden tener la misma serie y el mismo número: lo que las distingue es el RUC del emisor.
      const credencialDe = async (comprobanteId: string) => {
        const fila = await comprobanteFila(comprobanteId);
        const llamada = espia.mock.calls.find(
          ([doc]) =>
            doc.id.rucEmisor === (fila.emisor as { ruc: string }).ruc &&
            doc.id.serie === fila.serie &&
            doc.id.numero === Number(fila.numero),
        );
        expect(llamada, `la llamada del comprobante ${comprobanteId}`).toBeDefined();
        return llamada![1];
      };
      expect(await credencialDe(deA.comprobanteId)).toEqual(SECRETO_A);
      expect(await credencialDe(deB.comprobanteId)).toEqual(SECRETO_B);
    } finally {
      espia.mockRestore();
    }
  });

  /** Copia (o altera) la credencial guardada de B como administrador y devuelve cómo restaurarla. */
  async function trastocarCredencialDeB(
    como: 'copiar-la-de-A' | 'cambiar-un-byte',
  ): Promise<() => Promise<void>> {
    const original = await filaConfig(B());
    await conActor(
      admin,
      async () => {
        if (como === 'copiar-la-de-A') {
          await admin.query(
            `UPDATE configuracion_pse b
                SET credencial = a.credencial, clave_id = a.clave_id, campos_credencial = a.campos_credencial
               FROM configuracion_pse a
              WHERE a.empresa_id = $1 AND a.emisor_id = $2 AND b.empresa_id = $3 AND b.emisor_id = $4`,
            [A().id, A().emisor1, B().id, B().emisor1],
          );
        } else {
          const alterado = Buffer.from(original.credencial as Buffer);
          alterado[alterado.length - 1] = alterado[alterado.length - 1]! ^ 0xff;
          await admin.query(
            'UPDATE configuracion_pse SET credencial = $1 WHERE empresa_id = $2 AND emisor_id = $3',
            [alterado, B().id, B().emisor1],
          );
        }
      },
      { confirmar: true },
    );
    return () =>
      conActor(
        admin,
        async () => {
          await admin.query(
            `UPDATE configuracion_pse SET credencial = $1, clave_id = $2, campos_credencial = $3
              WHERE empresa_id = $4 AND emisor_id = $5`,
            [
              original.credencial,
              original.clave_id,
              original.campos_credencial,
              B().id,
              B().emisor1,
            ],
          );
        },
        { confirmar: true },
      );
  }

  it.each(['copiar-la-de-A', 'cambiar-un-byte'] as const)(
    'si la de B no se puede abrir (%s) el envío de B termina en ERROR_CONFIGURACION sin llamar al PSE ni usar otra credencial',
    async (como) => {
      await configurar(A(), SECRETO_A);
      await configurar(B(), SECRETO_B);
      const turnoB = await turnoDe(ctx, B(), 'cajero', 'S1', 'caja1');
      const deB = await cobrarLomo(ctx, B(), { turnoId: turnoB });
      const restaurar = await trastocarCredencialDeB(como);
      const espia = vi.spyOn(ctx.pse, 'emitir');
      try {
        await procesar(ctx, B().id, deB.comprobanteId);
        expect(espia).not.toHaveBeenCalled();
        expect(ctx.pse.llamadas()).toEqual([]);
        expect((await comprobanteFila(deB.comprobanteId)).estado).toBe('POR_ENVIAR');
        expect(await envioDe(deB.comprobanteId)).toMatchObject({
          estado: 'PENDIENTE',
          ultimo_resultado: 'ERROR_CONFIGURACION',
        });
        sinSecretos(
          JSON.stringify(await envioDe(deB.comprobanteId)),
          [SECRETO_A, SECRETO_B],
          'envio_pse',
        );
        sinSecretos(
          JSON.stringify(await intentosDe(deB.comprobanteId)),
          [SECRETO_A, SECRETO_B],
          'intento_pse',
        );
      } finally {
        espia.mockRestore();
        await restaurar();
      }
      // Con la fila restaurada, B envía con su propia credencial.
      const reintento = vi.spyOn(ctx.pse, 'emitir');
      try {
        ctx.reloj.avanzar(2 * MIN);
        await procesar(ctx, B().id, deB.comprobanteId);
        expect((await comprobanteFila(deB.comprobanteId)).estado).toBe('ACEPTADO');
        expect(reintento.mock.calls.map(([, credencial]) => credencial)).toEqual([SECRETO_B]);
      } finally {
        reintento.mockRestore();
      }
    },
  );
});

describe('criterio 123 · el valor descifrado no llega a respuestas, eventos, intentos, auditoría ni registros', () => {
  it('durante envíos aceptados, con error y rechazados no aparece en ningún lado', async () => {
    await configurar(A(), SECRETO_A);
    await configurar(B(), SECRETO_B);
    const registros = capturarRegistros();
    const respuestas: string[] = [];
    try {
      const turnoA = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
      const aceptada = await cobrarLomo(ctx, A(), { turnoId: turnoA });
      const conError = await cobrarLomo(ctx, A(), { turnoId: turnoA });
      const rechazada = await cobrarLomo(ctx, A(), { turnoId: turnoA });
      ctx.pse.reglas.rechazarNumero(
        (rechazada.respuesta.comprobante as { numero: string }).numero,
        { codigo: '2800', mensaje: 'Rechazo de prueba' },
      );
      await procesar(ctx, A().id, aceptada.comprobanteId);
      await procesar(ctx, A().id, rechazada.comprobanteId);
      ctx.pse.reglas.fallarTransmision(1);
      await procesar(ctx, A().id, conError.comprobanteId);
      ctx.reloj.avanzar(2 * MIN);
      ctx.pse.reglas.errorDeConfiguracion(1);
      await procesar(ctx, A().id, conError.comprobanteId);
      await ctx.barrido.barrerAhora();

      for (const c of [aceptada, conError, rechazada]) {
        const detalle = await api(
          ctx,
          A().token.supervisor,
          'get',
          `/facturacion/comprobantes/${c.comprobanteId}`,
        );
        respuestas.push(detalle.text);
      }
      respuestas.push(
        (await api(ctx, esc.sa.token, 'get', rutaPse(A().id, A().emisor1))).text,
        (await api(ctx, esc.sa.token, 'get', '/plataforma/facturacion/alertas')).text,
        (await api(ctx, A().token.supervisor, 'get', '/facturacion/alertas')).text,
      );
      const todas = [aceptada, conError, rechazada].map((c) => c.comprobanteId);
      const filasDe = async (tabla: string, columna: string) =>
        JSON.stringify(
          await filas(
            `SELECT to_jsonb(t) AS f FROM ${tabla} t WHERE ${columna} = ANY($1::uuid[])`,
            [todas],
          ),
        );
      const secretos = [SECRETO_A, SECRETO_B];
      sinSecretos(await filasDe('intento_pse', 'comprobante_id'), secretos, 'intento_pse');
      sinSecretos(await filasDe('envio_pse', 'comprobante_id'), secretos, 'envio_pse');
      sinSecretos(await filasDe('comprobante', 'id'), secretos, 'comprobante');
      sinSecretos(respuestas.join('\n'), secretos, 'las respuestas de la API');
      sinSecretos(JSON.stringify(ctx.publicador.eventos()), secretos, 'los eventos');
      sinSecretos(JSON.stringify(ctx.cola.pendientes()), secretos, 'la cola');
      sinSecretos((await textoDeAuditoria(admin)).join('\n'), secretos, 'la auditoría');
      sinSecretos(registros.texto(), secretos, 'los registros capturados');
    } finally {
      registros.restaurar();
    }
  });

  it('el cambio queda en la auditoría de plataforma con el modo y los nombres de los campos, nunca los valores', async () => {
    const res = await configurar(B(), OTRO);
    expect(res.credencialConfigurada).toBe(true);
    const filasAuditoria = await filasDeAuditoria(
      admin,
      "accion = 'configurar_pse_emisor' AND empresa_id = $1",
      [B().id],
    );
    expect(filasAuditoria.length).toBeGreaterThanOrEqual(1);
    const ultima = filasAuditoria.at(-1)!;
    expect(ultima.actor_superadministrador_id).toBe(esc.sa.id);
    const texto = JSON.stringify(ultima);
    expect(texto).toContain('SIMULADO');
    expect(texto).toContain('usuarioPse');
    expect(texto).toContain('tokenPse');
    sinSecretos(texto, [SECRETO_A, SECRETO_B, OTRO], 'la fila de auditoría');
    await configurar(B(), SECRETO_B);
  });

  it('activar al otro emisor de A no mezcla credenciales: cada fila guarda la suya', async () => {
    await configurar(A(), SECRETO_A);
    await activarSimulado(ctx, esc, A(), A().emisor2!, OTRO);
    const a1 = (await bytesDe(A()))!;
    const a2 = (await filaConfig(A(), A().emisor2!)).credencial as Buffer;
    expect(a1.equals(a2)).toBe(false);
    sinSecretos(a2, [SECRETO_A, OTRO], 'el valor guardado del segundo emisor');
  });
});
