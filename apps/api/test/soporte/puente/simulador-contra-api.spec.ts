import { armarQrPuente, leerQrPuente } from '@restaurante/contratos';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nuevoSuperadmin, type SuperadminDePrueba } from '../../acceso/fabrica-plataforma';
import {
  arrancarP6,
  conClave,
  crearEmpresaP6,
  crearImpresora,
  crearVinculacion,
  exigirEstado,
  type AppP6,
  type EmpresaP6,
} from '../../impresion-critica/fabrica-p6';
import { ClienteTiempoReal } from '../cliente-tiempo-real';
import { EmuladorEscPos, ErrorProtocoloPuente, SimuladorPuente } from './index';

// Historia 004, T35, T36 y T40: el simulador del puente contra la API real de la entrega 3b (vincula con el texto
// del QR, conecta el espacio `/puente`, pide la configuración, imprime en un emulador y detecta su revocación).
// Las pruebas protegidas de `impresion-critica/` cubren el protocolo desde el lado de la API; esta comprueba que el
// simulador y la API se entienden. No es una prueba protegida.

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const OPCIONES = {
  versionApp: 'simulador-prueba',
  nombreEquipo: 'Puente de prueba',
  modelo: 'Simulador',
  intervaloTrabajosMs: 600_000,
  intervaloLatidoMs: 600_000,
  esperaInicialMs: 50,
  esperaMaximaMs: 400,
  tiempoImpresoraMs: 1_500,
} as const;

describe('el simulador del puente contra la API de la entrega 3b', () => {
  let ctx: AppP6;
  let sa: SuperadminDePrueba;
  let url: string;
  let empresa: EmpresaP6;
  const cerrar: Array<() => Promise<void> | void> = [];

  /** El texto del QR que dio la API, con la URL donde escucha esta prueba (la pública de la API es un ejemplo). */
  const qrDe = async (): Promise<string> => {
    const vinculacion = await crearVinculacion(ctx, empresa.tokenAdmin, empresa.S1);
    const leido = leerQrPuente(vinculacion.qr);
    expect(leido).not.toBeNull();
    return armarQrPuente(url, leido!.token);
  };

  beforeAll(async () => {
    ctx = await arrancarP6();
    sa = await nuevoSuperadmin(ctx);
    url = ClienteTiempoReal.urlDe(ctx.app);
    empresa = await crearEmpresaP6(ctx, sa, 2);
  });

  afterAll(async () => {
    for (const cierre of cerrar.reverse()) await cierre();
    await ctx?.cerrar();
  });

  it('vincula con el QR, trae la configuración de su sucursal y no deja usar el código otra vez', async () => {
    const emulador = await EmuladorEscPos.iniciar({ anchoMm: 80, nombre: 'Cocina' });
    cerrar.push(() => emulador.cerrar());
    const impresora = await crearImpresora(ctx, empresa.tokenAdmin, empresa.S1, {
      conexion: { tipo: 'RED', host: emulador.host, puerto: emulador.puerto },
    });
    const qr = await qrDe();
    const simulador = new SimuladorPuente({ ...OPCIONES, qr });
    cerrar.push(() => simulador.detener());
    const respuesta = await simulador.vincular();
    expect(simulador.token).toBe(respuesta.token);
    expect(simulador.sucursal?.id).toBe(empresa.S1);
    expect(simulador.configuracion?.impresoras.map((i) => i.id)).toEqual([impresora.id]);

    const repetido = new SimuladorPuente({ ...OPCIONES, qr });
    await expect(repetido.vincular()).rejects.toMatchObject({
      estado: 401,
      codigo: 'VINCULACION_INVALIDA',
    });
    await expect(repetido.vincular()).rejects.toBeInstanceOf(ErrorProtocoloPuente);
  });

  it('conecta el espacio /puente, imprime la página de prueba en el emulador y reporta IMPRESO', async () => {
    const emulador = await EmuladorEscPos.iniciar({ anchoMm: 80, nombre: 'Barra' });
    cerrar.push(() => emulador.cerrar());
    const impresora = await crearImpresora(ctx, empresa.tokenAdmin, empresa.S1, {
      conexion: { tipo: 'RED', host: emulador.host, puerto: emulador.puerto },
    });
    const simulador = new SimuladorPuente({ ...OPCIONES, qr: await qrDe() });
    cerrar.push(() => simulador.detener());
    await simulador.vincular();
    await simulador.iniciar();
    expect(simulador.conectado).toBe(true);

    const res = await conClave(
      ctx,
      empresa.tokenAdmin,
      'post',
      `/sucursales/${empresa.S1}/impresoras/${impresora.id}/prueba`,
    );
    exigirEstado(res, 201, 'pedir la página de prueba');
    const ticket = await emulador.esperarTicket(3000);
    expect(ticket.completo).toBe(true);
    expect(ticket.texto).toContain('PÁGINA DE PRUEBA');
    await simulador.esperarImpresos(1, 3000);
    expect(simulador.impresos).toEqual([res.body.trabajoId]);
  });

  it('un segundo puente en la sucursal revoca al primero: el simulador lo detecta y se detiene', async () => {
    const primero = new SimuladorPuente({ ...OPCIONES, qr: await qrDe() });
    cerrar.push(() => primero.detener());
    await primero.vincular();
    await primero.iniciar();
    expect(primero.conectado).toBe(true);

    const segundo = new SimuladorPuente({ ...OPCIONES, qr: await qrDe() });
    cerrar.push(() => segundo.detener());
    await segundo.vincular();

    await vi.waitFor(() => expect(primero.revocado).toBe(true), { timeout: 5000, interval: 50 });
    await expect(primero.pedirTrabajosAhora()).resolves.toBeUndefined();
  });

  it('con un token pu. que no existe, iniciar falla con 401 NO_AUTENTICADO', async () => {
    const simulador = new SimuladorPuente({
      api: url,
      token: `pu.${empresa.empresaId}.${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${'A'.repeat(43)}`,
    });
    await expect(simulador.iniciar()).rejects.toMatchObject({
      estado: 401,
      codigo: 'NO_AUTENTICADO',
    });
  });
});
