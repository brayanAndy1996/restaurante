import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiFalsaDelPuente,
  BytesEscPos,
  EmuladorEscPos,
  ErrorProtocoloPuente,
  SimuladorPuente,
  type OpcionesSimuladorPuente,
} from './index';

// Historia 004, T36: el simulador del puente contra una API falsa que habla el protocolo 1 y contra el emulador de
// impresora (criterios 134 y 135). No es una prueba protegida. Los intervalos del simulador se acortan para no
// esperar 20 ni 30 segundos; los valores reales (20 s, 30 s) son los por defecto.

const RAPIDO: OpcionesSimuladorPuente = {
  intervaloTrabajosMs: 60_000,
  intervaloLatidoMs: 60_000,
  esperaInicialMs: 20,
  esperaMaximaMs: 80,
  tiempoImpresoraMs: 400,
};

const ticket = (...lineas: string[]): Uint8Array => BytesEscPos.ticket(lineas);

describe('SimuladorPuente', () => {
  let api: ApiFalsaDelPuente;
  let cocina: EmuladorEscPos;
  let barra: EmuladorEscPos;
  let simuladores: SimuladorPuente[];

  beforeEach(async () => {
    api = await ApiFalsaDelPuente.iniciar();
    cocina = await EmuladorEscPos.iniciar({ nombre: 'cocina' });
    barra = await EmuladorEscPos.iniciar({ nombre: 'barra' });
    simuladores = [];
  });
  afterEach(async () => {
    await Promise.all(simuladores.map((s) => s.detener()));
    await Promise.all([api.cerrar(), cocina.cerrar(), barra.cerrar()]);
  });

  /** Un simulador vinculado con un QR nuevo de la API falsa. */
  async function vinculado(opciones: OpcionesSimuladorPuente = {}): Promise<SimuladorPuente> {
    const { qr } = api.nuevoQr();
    const simulador = new SimuladorPuente({ ...RAPIDO, qr, ...opciones });
    simuladores.push(simulador);
    await simulador.vincular();
    return simulador;
  }

  describe('vincular', () => {
    it('manda el código del QR, el protocolo 1 y los datos del equipo, y guarda el token y la configuración', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto, 'Cocina');
      const guardados: string[] = [];
      const simulador = await vinculado({
        nombreEquipo: 'Tablet de cocina',
        modelo: 'SM-T295',
        versionApp: '9.9.9',
        guardarToken: (t) => {
          guardados.push(t);
        },
      });
      const peticion = api.peticionesA('POST', '/puente/vinculacion')[0]!;
      expect(peticion.autorizacion).toMatch(/^Bearer vi\./);
      expect(peticion.protocolo).toBe('1');
      expect(peticion.cuerpo).toEqual({
        nombreEquipo: 'Tablet de cocina',
        modelo: 'SM-T295',
        versionApp: '9.9.9',
      });
      expect(simulador.token).toBe(api.token);
      expect(simulador.token).toMatch(/^pu\./);
      expect(guardados).toEqual([api.token]);
      expect(simulador.estado).toBe('vinculado');
      expect(simulador.puente).toEqual(api.puente);
      expect(simulador.sucursal).toEqual(api.sucursal);
      expect(simulador.configuracion?.impresoras).toEqual([impresora]);
    });

    it('un QR que no es de vinculación falla sin llamar a la API', async () => {
      const simulador = new SimuladorPuente({ ...RAPIDO, qr: 'https://ejemplo.pe' });
      await expect(simulador.vincular()).rejects.toMatchObject({ codigo: 'QR_INVALIDO' });
      expect(api.peticiones).toEqual([]);
    });

    it('un código ya usado responde 401 VINCULACION_INVALIDA y no deja al simulador revocado', async () => {
      const { qr } = api.nuevoQr();
      const primero = new SimuladorPuente({ ...RAPIDO, qr });
      simuladores.push(primero);
      await primero.vincular();
      const segundo = new SimuladorPuente({ ...RAPIDO, qr });
      simuladores.push(segundo);
      const error = await segundo.vincular().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorProtocoloPuente);
      expect(error).toMatchObject({ estado: 401, codigo: 'VINCULACION_INVALIDA' });
      expect(segundo.token).toBeNull();
      expect(segundo.revocado).toBe(false);
    });

    it('una respuesta que no sigue el protocolo falla con RESPUESTA_INVALIDA', async () => {
      const { qr } = api.nuevoQr();
      const simulador = new SimuladorPuente({
        ...RAPIDO,
        qr,
        fetch: async () => new Response(JSON.stringify({ token: 'x' }), { status: 201 }),
      });
      await expect(simulador.vincular()).rejects.toMatchObject({ codigo: 'RESPUESTA_INVALIDA' });
    });

    it('sin red falla con estado 0', async () => {
      const { qr } = api.nuevoQr();
      await api.cerrar();
      const simulador = new SimuladorPuente({ ...RAPIDO, qr });
      await expect(simulador.vincular()).rejects.toMatchObject({ estado: 0, codigo: 'SIN_RED' });
    });
  });

  describe('iniciar y pedir trabajos', () => {
    it('al conectarse pide los trabajos pendientes e imprime en el orden en que se crearon', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const t1 = api.encolar(impresora.id, ticket('uno'), { avisar: false });
      const t2 = api.encolar(impresora.id, ticket('dos'), { avisar: false });
      const t3 = api.encolar(impresora.id, ticket('tres'), { avisar: false });
      const simulador = await vinculado();
      await simulador.iniciar();
      expect(simulador.conectado).toBe(true);
      expect(simulador.estado).toBe('iniciado');
      await simulador.esperarImpresos(3);
      expect(simulador.impresos).toEqual([t1.id, t2.id, t3.id]);
      const tickets = await cocina.esperarTickets(3);
      expect(tickets.map((t) => t.texto)).toEqual(['uno', 'dos', 'tres']);
      expect(api.trabajos.map((t) => t.estado)).toEqual(['IMPRESO', 'IMPRESO', 'IMPRESO']);
      // Los bytes son los del trabajo, sin cambios.
      expect(Array.from(tickets[0]!.bytes)).toEqual(Array.from(ticket('uno')));
      expect(Array.from(simulador.impresiones[0]!.bytes)).toEqual(Array.from(ticket('uno')));
      expect(simulador.impresiones.map((i) => i.impresoraId)).toEqual([
        impresora.id,
        impresora.id,
        impresora.id,
      ]);
    });

    it('cada petición lleva el token del puente y la versión del protocolo', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      api.encolar(impresora.id, ticket('x'), { avisar: false });
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarImpresos(1);
      const autenticadas = api.peticiones.filter((p) => p.ruta !== '/puente/vinculacion');
      expect(autenticadas.length).toBeGreaterThan(0);
      for (const p of autenticadas) {
        expect(p.autorizacion, `${p.metodo} ${p.ruta}`).toBe(`Bearer ${api.token}`);
        expect(p.protocolo, `${p.metodo} ${p.ruta}`).toBe('1');
      }
    });

    it('con el aviso trabajo.nuevo pide los trabajos de inmediato', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarHasta(() => api.peticionesA('GET', '/puente/trabajos').length >= 1);
      const antes = api.peticionesA('GET', '/puente/trabajos').length;
      const trabajo = api.encolar(impresora.id, ticket('comanda nueva'));
      await simulador.esperarImpresos(1);
      expect(simulador.impresos).toEqual([trabajo.id]);
      expect((await cocina.esperarTicket()).texto).toBe('comanda nueva');
      expect(api.peticionesA('GET', '/puente/trabajos').length).toBeGreaterThan(antes);
      expect(simulador.bitacora.some((e) => e.tipo === 'trabajo.nuevo')).toBe(true);
    });

    it('sin aviso, pide trabajos cada intervalo (el aviso perdido no deja nada sin imprimir)', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const simulador = await vinculado({ intervaloTrabajosMs: 60 });
      await simulador.iniciar();
      const trabajo = api.encolar(impresora.id, ticket('sin aviso'), { avisar: false });
      await simulador.esperarImpresos(1, 2000);
      expect(simulador.impresos).toEqual([trabajo.id]);
    });

    it('pide trabajos a los intervalos por defecto del protocolo (30 s y 20 s)', async () => {
      const simulador = new SimuladorPuente({ qr: api.nuevoQr().qr });
      const interno = simulador as unknown as {
        intervaloTrabajosMs: number;
        intervaloLatidoMs: number;
      };
      expect(interno.intervaloTrabajosMs).toBe(30_000);
      expect(interno.intervaloLatidoMs).toBe(20_000);
    });

    it('con dos impresoras mantiene el orden de cada una y manda cada trabajo a la suya', async () => {
      const iCocina = api.agregarImpresoraDeRed(cocina.host, cocina.puerto, 'Cocina');
      const iBarra = api.agregarImpresoraDeRed(barra.host, barra.puerto, 'Barra');
      const orden = [
        api.encolar(iCocina.id, ticket('c1'), { avisar: false }),
        api.encolar(iBarra.id, ticket('b1'), { avisar: false }),
        api.encolar(iCocina.id, ticket('c2'), { avisar: false }),
        api.encolar(iBarra.id, ticket('b2'), { avisar: false }),
      ];
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarImpresos(4);
      expect(simulador.impresos).toEqual(orden.map((t) => t.id));
      expect((await cocina.esperarTickets(2)).map((t) => t.texto)).toEqual(['c1', 'c2']);
      expect((await barra.esperarTickets(2)).map((t) => t.texto)).toEqual(['b1', 'b2']);
    });

    it('si la API dejó trabajos fuera por el tope de bytes (cabecera X-Puente-Hay-Mas), vuelve a pedir sin esperar al intervalo', async () => {
      const iCocina = api.agregarImpresoraDeRed(cocina.host, cocina.puerto, 'Cocina');
      // Cada ticket pesa más que la mitad del tope: la API entrega uno por respuesta.
      api.topeDeBytes = ticket('uno').length + 5;
      const orden = ['t1', 't2', 't3'].map((t) =>
        api.encolar(iCocina.id, ticket(t), { avisar: false }),
      );
      const simulador = await vinculado();
      await simulador.iniciar();
      // El intervalo es de 60 s: solo la cabecera explica que lleguen los tres.
      await simulador.esperarImpresos(3, 3000);
      expect(simulador.impresos).toEqual(orden.map((t) => t.id));
      expect(simulador.peticionesDeTrabajos).toBeGreaterThanOrEqual(3);
    });

    it('con X-Puente-Hay-Mas pero sin avanzar (la impresora no responde), no vuelve a pedir enseguida: espera (ronda 3)', async () => {
      // Un puerto cerrado: el trabajo no sale. La API sigue diciendo "hay más", pero el lote no avanzó.
      const muerta = api.agregarImpresoraDeRed('127.0.0.1', 1, 'Muerta');
      api.topeDeBytes = ticket('uno').length + 5;
      api.encolar(muerta.id, ticket('t1'), { avisar: false });
      api.encolar(muerta.id, ticket('t2'), { avisar: false });
      // La espera de reintento de la impresora (5 s) y el intervalo (60 s) quedan fuera de la prueba.
      const simulador = await vinculado({ esperaInicialMs: 5000, esperaMaximaMs: 5000 });
      await simulador.iniciar();
      await new Promise((r) => setTimeout(r, 400));
      expect(simulador.impresiones).toHaveLength(0);
      expect(simulador.peticionesDeTrabajos).toBe(1);
    });

    it('detener para los temporizadores: ya no pide trabajos', async () => {
      const simulador = await vinculado({ intervaloTrabajosMs: 30 });
      await simulador.iniciar();
      await simulador.detener();
      expect(simulador.estado).toBe('detenido');
      expect(simulador.conectado).toBe(false);
      const pedidos = api.peticionesA('GET', '/puente/trabajos').length;
      await new Promise((r) => setTimeout(r, 150));
      expect(api.peticionesA('GET', '/puente/trabajos').length).toBe(pedidos);
    });

    it('iniciar sin vincular falla con un mensaje claro', async () => {
      const simulador = new SimuladorPuente({ ...RAPIDO });
      await expect(simulador.iniciar()).rejects.toThrow(/no está vinculado/);
    });
  });

  describe('no imprimir dos veces', () => {
    it('un trabajo cuyo resultado se perdió vuelve en el siguiente pedido y solo se reporta, sin imprimir de nuevo', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const trabajo = api.encolar(impresora.id, ticket('una sola vez'), { avisar: false });
      api.fallosDeResultado = 1;
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarHasta(() => simulador.impresiones.length === 1);
      expect(api.trabajos[0]!.estado).toBe('PENDIENTE');
      await simulador.pedirTrabajosAhora();
      await simulador.esperarImpresos(1);
      expect(api.trabajos[0]!.estado).toBe('IMPRESO');
      expect(simulador.omitidos).toEqual([trabajo.id]);
      expect(simulador.impresiones).toHaveLength(1);
      expect(cocina.tickets).toHaveLength(1);
    });

    it('un trabajo que la API repite después de reportarlo no se vuelve a imprimir', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const trabajo = api.encolar(impresora.id, ticket('repetido'), { avisar: false });
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarImpresos(1);
      api.trabajos[0]!.estado = 'PENDIENTE';
      await simulador.pedirTrabajosAhora();
      expect(simulador.omitidos).toEqual([trabajo.id]);
      expect(cocina.tickets).toHaveLength(1);
    });

    it('recuerda solo los últimos ids (la memoria es acotada)', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const trabajos = [1, 2, 3, 4].map((n) =>
        api.encolar(impresora.id, ticket(`t${n}`), { avisar: false }),
      );
      const simulador = await vinculado({ idsRecordados: 3 });
      await simulador.iniciar();
      await simulador.esperarImpresos(4);
      expect(simulador.idsRecordadosActuales).toEqual(trabajos.slice(1).map((t) => t.id));
      // El primero ya se olvidó: si la API lo repite, se imprime otra vez; el último no.
      api.trabajos[0]!.estado = 'PENDIENTE';
      api.trabajos[3]!.estado = 'PENDIENTE';
      await simulador.pedirTrabajosAhora();
      expect(cocina.tickets.map((t) => t.texto)).toEqual(['t1', 't2', 't3', 't4', 't1']);
      expect(simulador.omitidos).toEqual([trabajos[3]!.id]);
    });

    it('un resultado rechazado con 404 o 409 se anota y no se reintenta sin fin', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const vencido = api.encolar(impresora.id, ticket('vencido'), { avisar: false });
      api.vencidos.add(vencido.id);
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarHasta(() => simulador.rechazados.length === 1);
      expect(simulador.rechazados[0]).toMatchObject({ trabajoId: vencido.id, estado: 409 });
      expect(simulador.resultados).toEqual([]);
      expect(simulador.revocado).toBe(false);
    });
  });

  describe('impresora que no responde', () => {
    it('reporta NO_IMPRESO, deja el trabajo pendiente y reintenta con espera creciente hasta lograrlo', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      await cocina.apagar();
      const trabajo = api.encolar(impresora.id, ticket('al volver'), { avisar: false });
      const simulador = await vinculado({ esperaInicialMs: 30, esperaMaximaMs: 100 });
      await simulador.iniciar();
      await simulador.esperarHasta(
        () => simulador.bitacora.filter((e) => e.tipo === 'impresora-no-responde').length >= 4,
        3000,
        'cuatro fallos seguidos',
      );
      const demoras = simulador.bitacora
        .filter((e) => e.tipo === 'impresora-no-responde')
        .map((e) => (e.detalle as { demora: number }).demora);
      expect(demoras.slice(0, 4)).toEqual([30, 60, 100, 100]);
      expect(api.trabajos[0]!.estado).toBe('PENDIENTE');
      expect(api.trabajos[0]!.intentos).toBeGreaterThanOrEqual(1);
      expect(api.trabajos[0]!.ultimoError).toMatch(/ECONNREFUSED|no respondió/);
      expect(simulador.resultados.every((r) => r.resultado === 'NO_IMPRESO')).toBe(true);
      await cocina.prender();
      await simulador.esperarImpresos(1, 3000);
      expect(simulador.impresos).toEqual([trabajo.id]);
      expect((await cocina.esperarTicket()).texto).toBe('al volver');
    });

    it('una impresora colgada (acepta y no cierra) también falla por tiempo agotado', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      await cocina.apagar('colgar');
      api.encolar(impresora.id, ticket('colgado'), { avisar: false });
      const simulador = await vinculado({ tiempoImpresoraMs: 100, esperaInicialMs: 5_000 });
      await simulador.iniciar();
      await simulador.esperarHasta(() => api.trabajos[0]!.intentos === 1, 2000);
      expect(api.trabajos[0]!.ultimoError).toMatch(/no respondió en 100 ms/);
    });

    it('no imprime el segundo trabajo de la misma impresora antes que el primero, pero sigue con las demás', async () => {
      const iCocina = api.agregarImpresoraDeRed(cocina.host, cocina.puerto, 'Cocina');
      const iBarra = api.agregarImpresoraDeRed(barra.host, barra.puerto, 'Barra');
      await cocina.apagar();
      api.encolar(iCocina.id, ticket('c1'), { avisar: false });
      api.encolar(iCocina.id, ticket('c2'), { avisar: false });
      api.encolar(iBarra.id, ticket('b1'), { avisar: false });
      const simulador = await vinculado({ esperaInicialMs: 40, esperaMaximaMs: 40 });
      await simulador.iniciar();
      await simulador.esperarImpresos(1);
      expect((await barra.esperarTicket()).texto).toBe('b1');
      // La cocina falló una sola vez en este ciclo: el segundo trabajo no se intentó.
      expect(api.trabajos.map((t) => t.intentos)).toEqual([1, 0, 0]);
      await cocina.prender();
      await simulador.esperarImpresos(3, 3000);
      expect((await cocina.esperarTickets(2)).map((t) => t.texto)).toEqual(['c1', 'c2']);
    });

    it('durante la espera un aviso nuevo no vuelve a intentar la impresora', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      await cocina.apagar();
      api.encolar(impresora.id, ticket('a'), { avisar: false });
      const simulador = await vinculado({ esperaInicialMs: 500, esperaMaximaMs: 500 });
      await simulador.iniciar();
      await simulador.esperarHasta(() => api.trabajos[0]!.intentos === 1);
      api.encolar(impresora.id, ticket('b'));
      await new Promise((r) => setTimeout(r, 100));
      expect(api.trabajos.map((t) => t.intentos)).toEqual([1, 0]);
    });
  });

  describe('latido', () => {
    it('al conectarse manda el estado de cada impresora de red y deja fuera las Bluetooth', async () => {
      const iCocina = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      await barra.apagar();
      const iBarra = api.agregarImpresoraDeRed(barra.host, barra.puerto);
      api.agregarImpresoraBluetooth();
      const simulador = await vinculado({ versionApp: '2.0.0' });
      await simulador.iniciar();
      await simulador.esperarHasta(() => simulador.latidos.length >= 1);
      const latido = api.latidos[0]!;
      expect(latido.versionApp).toBe('2.0.0');
      expect(latido.impresoras).toHaveLength(2);
      expect(latido.impresoras.find((i) => i.id === iCocina.id)).toEqual({
        id: iCocina.id,
        estado: 'LISTA',
      });
      const enBarra = latido.impresoras.find((i) => i.id === iBarra.id)!;
      expect(enBarra.estado).toBe('NO_RESPONDE');
      expect(enBarra.error).toBeTruthy();
      expect(simulador.latidos).toHaveLength(1);
    });

    it('manda un latido cada intervalo', async () => {
      api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const simulador = await vinculado({ intervaloLatidoMs: 50 });
      await simulador.iniciar();
      await simulador.esperarHasta(() => api.latidos.length >= 4, 2000);
    });

    it('al cambiar el estado de una impresora manda un latido sin esperar al intervalo', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const simulador = await vinculado({ esperaInicialMs: 10_000 });
      await simulador.iniciar();
      await simulador.esperarHasta(() => api.latidos.length >= 1);
      expect(api.latidos[0]!.impresoras[0]!.estado).toBe('LISTA');
      await cocina.apagar();
      api.encolar(impresora.id, ticket('falla'));
      await simulador.esperarHasta(
        () => api.latidos.some((l) => l.impresoras[0]?.estado === 'NO_RESPONDE'),
        2000,
        'un latido con la impresora caída',
      );
    });

    it('sin impresoras manda el latido igual, con la lista vacía', async () => {
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarHasta(() => api.latidos.length >= 1);
      expect(api.latidos[0]).toEqual({ versionApp: 'simulador-1.0.0', impresoras: [] });
    });
  });

  describe('impresoras Bluetooth (decisión 12)', () => {
    it('no imprime sus trabajos ni los reporta: quedan pendientes', async () => {
      const bluetooth = api.agregarImpresoraBluetooth();
      const iCocina = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      api.encolar(bluetooth.id, ticket('por bluetooth'), { avisar: false });
      api.encolar(iCocina.id, ticket('por red'), { avisar: false });
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarImpresos(1);
      expect((await cocina.esperarTicket()).texto).toBe('por red');
      expect(api.trabajos.map((t) => [t.estado, t.intentos])).toEqual([
        ['PENDIENTE', 0],
        ['IMPRESO', 0],
      ]);
      expect(simulador.bitacora.some((e) => e.tipo === 'bluetooth-no-soportado')).toBe(true);
    });
  });

  describe('socket', () => {
    it('al reconectarse vuelve a pedir la configuración y los trabajos', async () => {
      const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto);
      const simulador = await vinculado();
      await simulador.iniciar();
      await simulador.esperarHasta(() => api.peticionesA('GET', '/puente/trabajos').length >= 1);
      const pedidos = api.peticionesA('GET', '/puente/trabajos').length;
      const conexiones = api.conexionesDelSocket;
      api.encolar(impresora.id, ticket('durante la caída'), { avisar: false });
      api.cortarSockets();
      await simulador.esperarHasta(
        () => api.conexionesDelSocket === conexiones + 1,
        3000,
        'la reconexión',
      );
      await simulador.esperarImpresos(1);
      expect(api.peticionesA('GET', '/puente/trabajos').length).toBeGreaterThan(pedidos);
      expect((await cocina.esperarTicket()).texto).toBe('durante la caída');
      expect(simulador.revocado).toBe(false);
    });

    it('puente.configuracion hace que vuelva a pedir la configuración y use la impresora nueva', async () => {
      const simulador = await vinculado();
      await simulador.iniciar();
      const nueva = api.agregarImpresoraDeRed(barra.host, barra.puerto, 'Barra');
      const antes = api.peticionesA('GET', '/puente/configuracion').length;
      api.avisarConfiguracion();
      await simulador.esperarHasta(() => simulador.configuracion?.impresoras.length === 1);
      expect(api.peticionesA('GET', '/puente/configuracion').length).toBeGreaterThan(antes);
      api.encolar(nueva.id, ticket('a la barra'));
      await simulador.esperarImpresos(1);
      expect((await barra.esperarTicket()).texto).toBe('a la barra');
    });

    it('un trabajo de una impresora que la configuración no tiene vuelve a pedir la configuración', async () => {
      const simulador = await vinculado();
      await simulador.iniciar();
      const nueva = api.agregarImpresoraDeRed(barra.host, barra.puerto, 'Barra');
      // Sin avisar de la configuración: el simulador la descubre al ver el trabajo.
      api.encolar(nueva.id, ticket('descubierta'));
      await simulador.esperarImpresos(1);
      expect((await barra.esperarTicket()).texto).toBe('descubierta');
    });

    it('si la API revoca el puente, se detiene y no vuelve a intentar', async () => {
      const simulador = await vinculado({ intervaloTrabajosMs: 30 });
      await simulador.iniciar();
      api.revocar();
      await simulador.esperarHasta(() => simulador.revocado, 3000, 'la revocación');
      expect(simulador.estado).toBe('revocado');
      const conexiones = api.conexionesDelSocket;
      const pedidos = api.peticionesA('GET', '/puente/trabajos').length;
      await new Promise((r) => setTimeout(r, 200));
      expect(api.conexionesDelSocket).toBe(conexiones);
      expect(api.peticionesA('GET', '/puente/trabajos').length).toBe(pedidos);
    });

    it('iniciar con un token que la API no reconoce falla y lo deja revocado', async () => {
      const simulador = new SimuladorPuente({
        ...RAPIDO,
        api: api.url,
        token:
          'pu.00000000-0000-0000-0000-000000000000.00000000-0000-0000-0000-000000000001.' +
          'A'.repeat(43),
      });
      simuladores.push(simulador);
      await expect(simulador.iniciar()).rejects.toMatchObject({
        estado: 401,
        codigo: 'NO_AUTENTICADO',
      });
      expect(simulador.revocado).toBe(true);
    });

    it('iniciar con el puente ya revocado en la API falla y lo deja revocado', async () => {
      const simulador = await vinculado();
      api.revocar();
      await expect(simulador.iniciar({ tiempoMs: 300 })).rejects.toThrow(/revocado/i);
      expect(simulador.revocado).toBe(true);
    });

    it('iniciar con esperarConexion falso no espera al socket', async () => {
      const simulador = await vinculado();
      api.revocar();
      await simulador.iniciar({ esperarConexion: false });
      expect(simulador.estado).toBe('iniciado');
    });
  });
});
