import type { LlamadoDetalle, LlamadoResumen, SesionRespuesta } from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarSonidoDeLlamados } from '../src/lib/avisos-de-llamados';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { usarMotorDeSonido, type MotorDeSonido } from '../src/modulos/cocina/sonido';
import { claveDeBorrador, leerBorrador } from '../src/modulos/salon/borrador';
import { ID, json, renderApp, servidor, type Manejador } from './ayudas';
import { cocinaDe } from './ayudas-cocina';
import {
  idDeLlamado,
  lineaDeLlamado,
  listaDeLlamados,
  llamadoDetalle,
  llamadoResumen,
} from './ayudas-llamados';
import { AHORA, mesa, ordenDeMesa, salon, sesionDeRol, uuid, zona, Z_SALON } from './ayudas-salon';
import { socketVigente } from './ayudas-tiempo-real';

// spec: 005-carta-web-mesa, criterios 68 a 73 y 76 (llamados en la PWA; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const OTRA_PERSONA = uuid(31);

/** El salón de los ejemplos: la mesa 1 libre, la 4 libre y la 5 con cuenta de Ana. */
const salonDeEjemplo = () =>
  salon([
    zona(Z_SALON, 'Salón', [
      mesa(1, '1'),
      mesa(4, '4', { columna: 2, capacidad: 4 }),
      mesa(5, '5', { columna: 3, orden: {} }),
    ]),
  ]);

interface Opciones {
  sesion?: SesionRespuesta;
  llamados?: () => LlamadoResumen[];
  ahora?: () => string;
  detalle?: (id: string) => LlamadoDetalle;
  extra?: Record<string, Manejador>;
}

function servidorDeLlamados(o: Opciones = {}) {
  return servidor({
    'GET /sesion': () => json(200, o.sesion ?? sesionDeRol('MOZO')),
    'GET /salon': () => json(200, salonDeEjemplo()),
    'GET /llamados': () => json(200, listaDeLlamados(o.llamados?.() ?? [], o.ahora?.() ?? AHORA)),
    'GET /llamados/*': ({ url }) =>
      json(
        200,
        (o.detalle ?? ((id: string) => llamadoDetalle(Number(id.slice(-4)) - 7000)))(
          url.pathname.split('/').pop() ?? '',
        ),
      ),
    'GET /ordenes/*': () => json(200, ordenDeMesa(4)),
    'GET /cocina/comandas': () => json(200, cocinaDe([])),
    ...o.extra,
  });
}

/** Un motor de sonido de mentira: cuenta cuántas veces sonó y si se despertó. */
function motorFalso(): MotorDeSonido & { sono: number; despertado: number } {
  const motor = {
    sono: 0,
    despertado: 0,
    desbloquear() {
      motor.despertado += 1;
      return true;
    },
    listo: () => true,
    avisar() {
      motor.sono += 1;
      return true;
    },
  };
  return motor;
}

async function conectado() {
  await waitFor(() => expect(socketVigente()).toBeDefined());
  return socketVigente()!;
}

const nuevo = (extra: Record<string, unknown> = {}) => ({
  llamadoId: idDeLlamado(1),
  tipo: 'PEDIDO',
  mesaId: uuid(104),
  mesaNombre: '4',
  destinatarios: null,
  ...extra,
});

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  usarMotorDeSonido();
});

describe('Salón: segmentos y etiqueta en la baldosa (criterio 68)', () => {
  it('muestra «Mesas» y «Llamados (n)» y pone la etiqueta del llamado en la baldosa de su mesa', async () => {
    servidorDeLlamados({
      llamados: () => [
        llamadoResumen(1),
        llamadoResumen(2, {
          tipo: 'PEDIR_CUENTA',
          unidades: 0,
          total: null,
          mesa: { n: 5, nombre: '5' },
        }),
        llamadoResumen(3, {
          tipo: 'LLAMAR_MOZO',
          unidades: 0,
          total: null,
          mesa: { n: 1, nombre: '1' },
          estado: 'ATENDIDO',
        }),
      ],
    });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });

    expect(await screen.findByRole('button', { name: 'Llamados (2)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Mesas' })).toHaveAttribute('aria-pressed', 'true');

    // La etiqueta dice el tipo con texto: «Pedido» en la mesa 4 y «Pide la cuenta» en la 5; la 1 no tiene.
    expect(screen.getByRole('button', { name: /^Mesa 4,.*Pedido$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Mesa 5,.*Pide la cuenta$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Mesa 1,/ })).not.toHaveAccessibleName(/Llama/);
  });

  it('«Llamados» abre la lista y se puede volver a «Mesas»', async () => {
    servidorDeLlamados({ llamados: () => [llamadoResumen(1)] });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await userEvent.click(await screen.findByRole('button', { name: 'Llamados (1)' }));
    expect(await screen.findByRole('heading', { name: 'Pendientes' })).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Mesas de Salón' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Mesas' }));
    expect(await screen.findByRole('grid', { name: 'Mesas de Salón' })).toBeInTheDocument();
  });
});

describe('Lista de llamados (criterio 70)', () => {
  it('muestra cada pendiente con su tipo, «Para ti», «vence en» y quién atiende, y «Recientes» abajo', async () => {
    servidorDeLlamados({
      llamados: () => [
        llamadoResumen(1, { destinatarios: [ID.usuario] }),
        llamadoResumen(2, {
          tipo: 'LLAMAR_MOZO',
          unidades: 0,
          total: null,
          minutos: 1,
          mesa: { n: 5, nombre: '5' },
          destinatarios: [OTRA_PERSONA],
        }),
        llamadoResumen(3, {
          estado: 'ATENDIDO',
          atendidoPor: { id: OTRA_PERSONA, nombre: 'Lucía Salón' },
          atendidoEn: AHORA,
          mesa: { n: 1, nombre: '1' },
          ordenId: uuid(901),
        }),
        llamadoResumen(4, {
          estado: 'PASADO_A_CUENTA',
          cerradoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
          cerradoEn: '2026-10-29T16:50:00.000Z',
          atendidoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
          minutos: 12,
          mesa: { n: 5, nombre: '5' },
        }),
      ],
    });
    renderApp('/salon?vista=llamados');

    const pendientes = await screen.findByRole('list', { name: 'Llamados pendientes' });
    const filas = within(pendientes).getAllByRole('listitem');
    // El más antiguo primero: el de la mesa 4 (hace 3 min) antes que el de la 5 (hace 1 min)… al revés: hace 3 min es el más viejo.
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('Mesa 4');
    expect(filas[0]).toHaveTextContent('Pedido · 3 platos');
    expect(filas[0]).toHaveTextContent('hace 3 min');
    expect(filas[0]).toHaveTextContent('vence en 12 min');
    expect(within(filas[0]!).getByText('Para ti')).toBeInTheDocument();
    expect(
      within(filas[0]!).getByRole('button', { name: 'Atender la mesa 4' }),
    ).toBeInTheDocument();
    expect(filas[1]).toHaveTextContent('Mesa 5');
    expect(filas[1]).toHaveTextContent('Llama al mozo');
    expect(filas[1]).toHaveTextContent('vence en 14 min');
    // No es para esta persona: sin «Para ti».
    expect(within(filas[1]!).queryByText('Para ti')).toBeNull();

    // El pedido que alguien ya atendió y falta pasar a la cuenta.
    const enAtencion = screen.getByRole('list', { name: 'Pedidos en atención' });
    expect(enAtencion).toHaveTextContent('Atiende Lucía Salón');
    expect(enAtencion).toHaveTextContent('Falta pasarlo a la cuenta');

    const recientes = screen.getByRole('list', { name: 'Llamados recientes' });
    expect(recientes).toHaveTextContent('Mesa 5');
    expect(recientes).toHaveTextContent('Pedido');
    expect(recientes).toHaveTextContent('Pasó a la cuenta');
  });

  it('el vencimiento se calcula con el `ahora` del servidor, no con el reloj del equipo', async () => {
    // El equipo está años después de la hora del servidor: con su reloj este llamado estaría vencido.
    servidorDeLlamados({
      llamados: () => [llamadoResumen(1)],
      ahora: () => AHORA,
    });
    renderApp('/salon?vista=llamados');
    const fila = (await screen.findByRole('list', { name: 'Llamados pendientes' })).querySelector(
      'li',
    );
    expect(fila).toHaveTextContent('vence en 12 min');
    expect(screen.getByRole('button', { name: 'Llamados (1)' })).toBeInTheDocument();
  });

  it('un pendiente que el servidor ya da por vencido sale de pendientes y queda en «Recientes»', async () => {
    // Creado hace 16 minutos: venció hace un minuto según el reloj de la API.
    servidorDeLlamados({ llamados: () => [llamadoResumen(1, { minutos: 16 })] });
    renderApp('/salon?vista=llamados');
    expect(await screen.findByText('No hay llamados pendientes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Llamados (0)' })).toBeInTheDocument();
    const recientes = screen.getByRole('list', { name: 'Llamados recientes' });
    expect(recientes).toHaveTextContent('Mesa 4');
    expect(recientes).toHaveTextContent('Pedido');
    expect(recientes).toHaveTextContent('Venció');
  });

  it('cuando llega su hora, el pendiente pasa a vencido sin recargar', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    // Vence dentro de 61 segundos según el servidor; el servidor sigue la hora del equipo desde la lectura.
    const inicio = Date.now();
    servidorDeLlamados({
      llamados: () => [
        llamadoResumen(1, {
          minutos: 14,
          venceEn: new Date(Date.parse(AHORA) + 61_000).toISOString(),
        }),
      ],
      ahora: () => new Date(Date.parse(AHORA) + (Date.now() - inicio)).toISOString(),
    });
    renderApp('/salon?vista=llamados');
    const lista = await screen.findByRole('list', { name: 'Llamados pendientes' });
    expect(lista).toHaveTextContent('vence en 2 min');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Llamados pendientes' })).toBeNull(),
    );
    expect(screen.getByRole('list', { name: 'Llamados recientes' })).toHaveTextContent('Venció');
  });

  it('llamado.nuevo y llamado.cambio vuelven a pedir la lista', async () => {
    let llamados = [llamadoResumen(1)];
    const s = servidorDeLlamados({ llamados: () => llamados });
    renderApp('/salon?vista=llamados');
    await screen.findByRole('list', { name: 'Llamados pendientes' });
    expect(s.de('GET', '/llamados')).toHaveLength(1);
    const socket = await conectado();

    llamados = [
      llamadoResumen(1),
      llamadoResumen(2, {
        tipo: 'PEDIR_CUENTA',
        unidades: 0,
        total: null,
        mesa: { n: 5, nombre: '5' },
      }),
    ];
    act(() =>
      socket.desdeElServidor(
        'llamado.nuevo',
        nuevo({ llamadoId: idDeLlamado(2), tipo: 'PEDIR_CUENTA', mesaNombre: '5' }),
      ),
    );
    expect(await screen.findByText('Pide la cuenta')).toBeInTheDocument();

    llamados = [
      llamadoResumen(1, {
        estado: 'ATENDIDO',
        atendidoPor: { id: OTRA_PERSONA, nombre: 'Lucía Salón' },
        atendidoEn: AHORA,
      }),
    ];
    act(() =>
      socket.desdeElServidor('llamado.cambio', {
        llamadoId: idDeLlamado(2),
        mesaId: uuid(105),
        estado: 'ATENDIDO',
      }),
    );
    await waitFor(() => expect(screen.queryByText('Pide la cuenta')).toBeNull());
  });

  it('sin socket se refresca cada 30 segundos con el ETag', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const version = 1;
    const s = servidorDeLlamados({
      extra: {
        'GET /llamados': ({ cabeceras }) =>
          cabeceras.get('If-None-Match') === `"${version}"`
            ? json(304)
            : json(200, listaDeLlamados([llamadoResumen(1)]), { ETag: `"${version}"` }),
      },
    });
    renderApp('/salon?vista=llamados');
    await screen.findByRole('list', { name: 'Llamados pendientes' });
    expect(s.de('GET', '/llamados')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(s.de('GET', '/llamados').length).toBeGreaterThanOrEqual(2));
    const segunda = s.de('GET', '/llamados')[1];
    expect(segunda?.cabeceras.get('If-None-Match')).toBe('"1"');
    expect(segunda?.cabeceras.get('X-Actividad')).toBe('segundo-plano');
    // Un 304 deja la lista como estaba.
    expect(screen.getByRole('list', { name: 'Llamados pendientes' })).toHaveTextContent('Mesa 4');
  });
});

describe('Aviso en vivo (criterio 69)', () => {
  it('avisa con banner, sonido y vibración a quien es destinatario, y el banner dice cuántos platos', async () => {
    const motor = motorFalso();
    usarMotorDeSonido(motor);
    const vibrar = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate: vibrar });
    servidorDeLlamados({ sesion: sesionDeRol('SUPERVISOR'), llamados: () => [llamadoResumen(1)] });
    renderApp('/cocina');
    await screen.findByText('No hay comandas pendientes');
    const socket = await conectado();

    act(() => socket.desdeElServidor('llamado.nuevo', nuevo({ destinatarios: [ID.usuario] })));
    // El banner aparece en cualquier pantalla; las unidades salen de la lista.
    expect(await screen.findByText('Mesa 4 · Pedido (3 platos)')).toBeInTheDocument();
    const ver = screen.getByRole('link', { name: 'Ver' });
    expect(ver).toHaveAttribute('href', `/salon/llamados/${idDeLlamado(1)}`);
    expect(motor.sono).toBe(1);
    expect(vibrar).toHaveBeenCalledTimes(1);
  });

  it('con `destinatarios: null` avisa a todas las personas que atienden mesas', async () => {
    const motor = motorFalso();
    usarMotorDeSonido(motor);
    servidorDeLlamados({
      llamados: () => [llamadoResumen(1, { tipo: 'LLAMAR_MOZO', unidades: 0, total: null })],
    });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() =>
      socket.desdeElServidor('llamado.nuevo', nuevo({ tipo: 'LLAMAR_MOZO', destinatarios: null })),
    );
    expect(await screen.findByText('Mesa 4 · Llama al mozo')).toBeInTheDocument();
    expect(motor.sono).toBe(1);
  });

  it('el aviso sale solo para los destinatarios: las demás lo ven en la lista, sin banner ni sonido', async () => {
    const motor = motorFalso();
    usarMotorDeSonido(motor);
    const vibrar = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate: vibrar });
    servidorDeLlamados({ llamados: () => [llamadoResumen(1, { destinatarios: [OTRA_PERSONA] })] });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();

    act(() =>
      socket.desdeElServidor('llamado.nuevo', nuevo({ destinatarios: [OTRA_PERSONA, uuid(33)] })),
    );
    // Un evento mal formado tampoco hace nada.
    act(() => socket.desdeElServidor('llamado.nuevo', { mesaNombre: '4' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: 'Ver' })).toBeNull();
    expect(motor.sono).toBe(0);
    expect(vibrar).not.toHaveBeenCalled();

    // En la lista sí está: el segmento cuenta el llamado.
    expect(await screen.findByRole('button', { name: 'Llamados (1)' })).toBeInTheDocument();
  });

  it('el silencio del equipo apaga el sonido pero el banner se ve igual', async () => {
    const motor = motorFalso();
    usarMotorDeSonido(motor);
    guardarSonidoDeLlamados(false);
    servidorDeLlamados({ llamados: () => [llamadoResumen(1)] });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() => socket.desdeElServidor('llamado.nuevo', nuevo()));
    expect(await screen.findByText(/^Mesa 4 · Pedido/)).toBeInTheDocument();
    expect(motor.sono).toBe(0);
  });

  it('el sonido se puede silenciar desde la lista y se recuerda en el equipo', async () => {
    usarMotorDeSonido(motorFalso());
    servidorDeLlamados();
    renderApp('/salon?vista=llamados');
    const interruptor = await screen.findByRole('switch', { name: 'Sonido de avisos' });
    expect(interruptor).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(interruptor);
    expect(interruptor).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('restaurante.llamados.sonido')).toBe('silenciado');
    expect(
      screen.getByText('Silenciado en este equipo. Seguirás viendo los avisos.'),
    ).toBeInTheDocument();
  });

  it('el audio se despierta con el primer toque en la app', async () => {
    const motor = motorFalso();
    usarMotorDeSonido(motor);
    servidorDeLlamados();
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await conectado();
    const antes = motor.despertado;
    await userEvent.click(screen.getByRole('button', { name: 'Mesas' }));
    expect(motor.despertado).toBeGreaterThan(antes);
  });

  it('el banner se quita cuando otro equipo atiende el llamado', async () => {
    usarMotorDeSonido(motorFalso());
    servidorDeLlamados({ llamados: () => [llamadoResumen(1)] });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() => socket.desdeElServidor('llamado.nuevo', nuevo()));
    await screen.findByRole('link', { name: 'Ver' });
    act(() =>
      socket.desdeElServidor('llamado.cambio', {
        llamadoId: idDeLlamado(1),
        mesaId: uuid(104),
        estado: 'ATENDIDO',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Ver' })).toBeNull());
  });

  it('los avisos son de la persona: otra sesión no los hereda', async () => {
    usarMotorDeSonido(motorFalso());
    servidorDeLlamados({ llamados: () => [llamadoResumen(1)] });
    const { unmount } = renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() => socket.desdeElServidor('llamado.nuevo', nuevo()));
    await screen.findByRole('link', { name: 'Ver' });
    unmount();

    servidorDeLlamados({
      sesion: sesionDeRol('MOZO', { id: OTRA_PERSONA, nombre: 'Lucía Salón' }),
    });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    expect(screen.queryByRole('link', { name: 'Ver' })).toBeNull();
  });
});

describe('Atender (criterios 41, 42 y 71)', () => {
  const atencion = (extra: Omit<Partial<LlamadoDetalle>, 'mesa'> = {}) =>
    json(200, {
      llamado: llamadoDetalle(1, {
        estado: 'ATENDIDO',
        atendidoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
        atendidoEn: AHORA,
        ordenId: uuid(904),
        ...extra,
      }),
      ordenId: uuid(904),
      mesaAbierta: true,
    });

  it('con la mesa libre pide los comensales (la capacidad por defecto) y abre la mesa al atender', async () => {
    let atendida = false;
    const s = servidorDeLlamados({
      llamados: () => [llamadoResumen(1)],
      detalle: () =>
        atendida
          ? llamadoDetalle(1, {
              estado: 'ATENDIDO',
              atendidoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
              atendidoEn: AHORA,
              ordenId: uuid(904),
            })
          : llamadoDetalle(1),
      extra: {
        'POST /llamados/*/atencion': () => {
          atendida = true;
          return atencion();
        },
      },
    });
    renderApp('/salon?vista=llamados');
    await userEvent.click(await screen.findByRole('button', { name: 'Atender la mesa 4' }));

    const hoja = await screen.findByRole('dialog', { name: 'Atender la mesa 4' });
    expect(within(hoja).getByText('4')).toBeInTheDocument();
    expect(within(hoja).getByText('La mesa es para 4 personas.')).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar uno a comensales' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Atender y abrir la mesa' }));

    await waitFor(() =>
      expect(s.de('POST', `/llamados/${idDeLlamado(1)}/atencion`)).toHaveLength(1),
    );
    const llamada = s.de('POST', `/llamados/${idDeLlamado(1)}/atencion`)[0]!;
    expect(llamada.cuerpo).toMatchObject({ comensales: 5 });
    expect((llamada.cuerpo as { ordenId: string }).ordenId).toMatch(/^[0-9a-f-]{36}$/);
    expect(llamada.cabeceras.get('Idempotency-Key')).toBeTruthy();
    // Un pedido atendido lleva al detalle, para revisarlo con el cliente.
    expect(await screen.findByRole('button', { name: 'Pasar a la cuenta' })).toBeInTheDocument();
  });

  it('con la mesa ocupada atiende de una vez, sin pedir comensales', async () => {
    const s = servidorDeLlamados({
      llamados: () => [llamadoResumen(1, { mesa: { n: 5, nombre: '5' }, ordenId: uuid(905) })],
      extra: { 'POST /llamados/*/atencion': () => atencion() },
    });
    renderApp('/salon?vista=llamados');
    await userEvent.click(await screen.findByRole('button', { name: 'Atender la mesa 5' }));
    await waitFor(() =>
      expect(s.de('POST', `/llamados/${idDeLlamado(1)}/atencion`)).toHaveLength(1),
    );
    expect(s.de('POST', `/llamados/${idDeLlamado(1)}/atencion`)[0]?.cuerpo).toEqual({});
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('si otra persona lo tomó primero, dice quién lo está atendiendo', async () => {
    servidorDeLlamados({
      llamados: () => [llamadoResumen(1, { mesa: { n: 5, nombre: '5' }, ordenId: uuid(905) })],
      extra: {
        'POST /llamados/*/atencion': () =>
          json(409, {
            codigo: 'LLAMADO_TOMADO',
            mensaje: 'Ya lo atiende otra persona',
            atendidoPor: { id: OTRA_PERSONA, nombre: 'Ana' },
          }),
      },
    });
    renderApp('/salon?vista=llamados');
    await userEvent.click(await screen.findByRole('button', { name: 'Atender la mesa 5' }));
    expect(await screen.findByText('Ana ya está atendiendo este llamado.')).toBeInTheDocument();
  });

  it('un llamado vencido o cerrado se dice en palabras', async () => {
    let codigo: Record<string, unknown> = { codigo: 'LLAMADO_VENCIDO', mensaje: 'venció' };
    servidorDeLlamados({
      llamados: () => [llamadoResumen(1, { mesa: { n: 5, nombre: '5' }, ordenId: uuid(905) })],
      extra: { 'POST /llamados/*/atencion': () => json(409, codigo) },
    });
    renderApp('/salon?vista=llamados');
    await userEvent.click(await screen.findByRole('button', { name: 'Atender la mesa 5' }));
    expect(await screen.findByText(/venció sin que nadie lo atendiera/)).toBeInTheDocument();

    codigo = { codigo: 'LLAMADO_CERRADO', mensaje: 'cerrado', estado: 'DESCARTADO' };
    await userEvent.click(await screen.findByRole('button', { name: 'Atender la mesa 5' }));
    expect(await screen.findByText('Este llamado ya se descartó.')).toBeInTheDocument();
  });

  it('«Pide la cuenta» lleva a la cuenta de la mesa con la pre-cuenta a la vista', async () => {
    servidorDeLlamados({
      llamados: () => [
        llamadoResumen(2, {
          tipo: 'PEDIR_CUENTA',
          unidades: 0,
          total: null,
          mesa: { n: 5, nombre: '5' },
          ordenId: uuid(905),
        }),
      ],
      extra: {
        'GET /ordenes/*': () => json(200, ordenDeMesa(4, { items: [], total: '0.00' })),
        'POST /llamados/*/atencion': () =>
          json(200, {
            llamado: llamadoDetalle(2, {
              tipo: 'PEDIR_CUENTA',
              estado: 'ATENDIDO',
              lineas: [],
              atendidoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
              atendidoEn: AHORA,
              ordenId: uuid(904),
            }),
            ordenId: uuid(904),
            mesaAbierta: false,
          }),
      },
    });
    renderApp('/salon?vista=llamados');
    await userEvent.click(await screen.findByRole('button', { name: 'Atender la mesa 5' }));
    expect(await screen.findByText('El cliente pidió la cuenta')).toBeInTheDocument();
  });

  it('«Llama al mozo» atendido solo cierra el aviso', async () => {
    const s = servidorDeLlamados({
      llamados: () => [
        llamadoResumen(3, {
          tipo: 'LLAMAR_MOZO',
          unidades: 0,
          total: null,
          mesa: { n: 5, nombre: '5' },
          ordenId: uuid(905),
        }),
      ],
      extra: {
        'POST /llamados/*/atencion': () =>
          json(200, {
            llamado: llamadoDetalle(3, {
              tipo: 'LLAMAR_MOZO',
              estado: 'ATENDIDO',
              lineas: [],
              atendidoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
              atendidoEn: AHORA,
            }),
            ordenId: uuid(905),
            mesaAbierta: false,
          }),
      },
    });
    renderApp('/salon?vista=llamados');
    await userEvent.click(await screen.findByRole('button', { name: 'Atender la mesa 5' }));
    expect(await screen.findByText('Llamado atendido')).toBeInTheDocument();
    expect(s.de('POST', `/llamados/${idDeLlamado(3)}/atencion`)).toHaveLength(1);
  });
});

describe('Detalle: revisar, pasar a la cuenta y descartar (criterios 71 a 73)', () => {
  const RUTA = `/salon/llamados/${idDeLlamado(1)}`;
  const atendido = (extra: Omit<Partial<LlamadoDetalle>, 'mesa'> = {}) =>
    llamadoDetalle(1, {
      estado: 'ATENDIDO',
      atendidoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
      atendidoEn: AHORA,
      ordenId: uuid(904),
      ...extra,
    });
  const respuestaDelPaso = (posiciones = [0, 1]) => ({
    llamado: atendido({ estado: 'PASADO_A_CUENTA' }),
    ordenId: uuid(904),
    lineas: posiciones.map((p) => ({
      posicion: p,
      productoId: uuid(500 + p),
      nombre: p === 0 ? 'Combo hamburguesa' : 'Gaseosa 1 L',
      modificadores: p === 0 ? [{ id: uuid(600), nombre: 'Ensalada', precioExtra: '0.00' }] : [],
      cantidad: p === 0 ? 1 : 1,
      observacion: null,
      precioUnitario: p === 0 ? '30.00' : '8.00',
      total: p === 0 ? '30.00' : '8.00',
    })),
  });

  it('muestra cada línea con el precio del sistema y, si cambió, lo que el cliente vio', async () => {
    servidorDeLlamados({
      detalle: () =>
        atendido({
          lineas: [
            lineaDeLlamado(0, {
              precioCliente: '28.00',
              revision: { disponible: true, precioUnitario: '30.00', total: '60.00' },
            }),
            lineaDeLlamado(1, {
              nombre: 'Gaseosa 1 L',
              cantidad: 1,
              modificadores: [],
              precioCliente: '8.00',
              revision: { disponible: true, precioUnitario: '8.00', total: '8.00' },
            }),
          ],
        }),
    });
    renderApp(RUTA);
    const lineas = await screen.findByRole('list', { name: 'Lo que pidió el cliente' });
    const [combo, gaseosa] = within(lineas).getAllByRole('listitem');
    expect(combo).toHaveTextContent('2 × Combo hamburguesa');
    expect(combo).toHaveTextContent('Ensalada');
    expect(combo).toHaveTextContent('S/ 30.00 c/u');
    expect(combo).toHaveTextContent('El cliente vio S/ 28.00');
    expect(combo).toHaveTextContent('S/ 60.00');
    expect(gaseosa).not.toHaveTextContent('El cliente vio');
    // 2 × 30.00 + 1 × 8.00 con los precios del sistema.
    expect(screen.getByText('Total para la cuenta').parentElement).toHaveTextContent('S/ 68.00');
  });

  it('− y + cambian la cantidad y «Quitar» saca la línea; pasa solo lo que quedó', async () => {
    const s = servidorDeLlamados({
      detalle: () => atendido(),
      extra: { 'POST /llamados/*/paso-a-cuenta': () => json(200, respuestaDelPaso([0])) },
    });
    renderApp(RUTA);
    const lineas = await screen.findByRole('list', { name: 'Lo que pidió el cliente' });
    const [combo, gaseosa] = within(lineas).getAllByRole('listitem');
    // 2 → 1: baja una unidad.
    await userEvent.click(
      within(combo!).getByRole('button', { name: /Quitar una unidad de Combo hamburguesa/ }),
    );
    expect(combo).toHaveTextContent('1 × Combo hamburguesa');
    // Se quita la gaseosa.
    await userEvent.click(within(gaseosa!).getByRole('button', { name: 'Quitar Gaseosa 1 L' }));
    expect(screen.getByText('Quitaste Gaseosa 1 L')).toBeInTheDocument();
    expect(screen.getByText('Total para la cuenta').parentElement).toHaveTextContent('S/ 28.00');

    await userEvent.click(screen.getByRole('button', { name: 'Pasar a la cuenta' }));
    await waitFor(() =>
      expect(s.de('POST', `/llamados/${idDeLlamado(1)}/paso-a-cuenta`)).toHaveLength(1),
    );
    const llamada = s.de('POST', `/llamados/${idDeLlamado(1)}/paso-a-cuenta`)[0]!;
    expect(llamada.cuerpo).toEqual({ lineas: [{ posicion: 0, cantidad: 1 }] });
    expect(llamada.cabeceras.get('Idempotency-Key')).toBeTruthy();
  });

  it('«Deshacer» devuelve una línea quitada', async () => {
    servidorDeLlamados({ detalle: () => atendido() });
    renderApp(RUTA);
    const lineas = await screen.findByRole('list', { name: 'Lo que pidió el cliente' });
    await userEvent.click(within(lineas).getByRole('button', { name: 'Quitar Gaseosa 1 L' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Deshacer: volver a poner Gaseosa 1 L' }),
    );
    expect(
      within(screen.getByRole('list', { name: 'Lo que pidió el cliente' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(2);
  });

  it('lo no disponible va marcado con su motivo y no se puede pasar hasta quitarlo', async () => {
    servidorDeLlamados({
      detalle: () =>
        atendido({
          lineas: [
            lineaDeLlamado(0, {
              revision: {
                disponible: false,
                codigo: 'COMPONENTE_NO_DISPONIBLE',
                motivo: 'Cerveza Pilsen agotada',
              },
            }),
            lineaDeLlamado(1, {
              nombre: 'Gaseosa 1 L',
              cantidad: 1,
              modificadores: [],
              precioCliente: '8.00',
              revision: { disponible: true, precioUnitario: '8.00', total: '8.00' },
            }),
          ],
        }),
    });
    renderApp(RUTA);
    const lineas = await screen.findByRole('list', { name: 'Lo que pidió el cliente' });
    const [agotada] = within(lineas).getAllByRole('listitem');
    expect(agotada?.firstElementChild).toHaveClass('linea-llamado--no-disponible');
    expect(agotada).toHaveTextContent('No disponible: Falta un componente del producto');

    const pasar = screen.getByRole('button', { name: 'Pasar a la cuenta' });
    expect(pasar).toBeDisabled();
    expect(
      screen.getByText('Quita lo que no está disponible para poder pasar el pedido.'),
    ).toBeInTheDocument();

    await userEvent.click(within(agotada!).getByRole('button', { name: /^Quitar/ }));
    expect(screen.getByRole('button', { name: 'Pasar a la cuenta' })).toBeEnabled();
  });

  it('al pasar, las líneas con los precios del sistema van al borrador de la cuenta y avisa que se revise', async () => {
    servidorDeLlamados({
      detalle: () => atendido(),
      extra: { 'POST /llamados/*/paso-a-cuenta': () => json(200, respuestaDelPaso()) },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pasar a la cuenta' }));

    expect(
      await screen.findByText(
        'Revisa el pedido con el cliente y pulsa Enviar para mandarlo a cocina',
      ),
    ).toBeInTheDocument();
    const borrador = leerBorrador(claveDeBorrador(ID.empresa, ID.usuario, uuid(904)));
    expect(borrador.envioId).toBeNull();
    expect(borrador.lineas).toHaveLength(2);
    expect(borrador.lineas[0]).toMatchObject({
      nombre: 'Combo hamburguesa',
      precioUnitario: '30.00',
      llamadoId: idDeLlamado(1),
      tiempo: 1,
      paraLlevar: false,
    });
    // Nada se manda a cocina: queda «Por enviar» en la cuenta.
    expect(await screen.findByText('Por enviar')).toBeInTheDocument();
  });

  it('una réplica del paso (la misma respuesta otra vez) no duplica las líneas en el borrador', async () => {
    const s = servidorDeLlamados({
      detalle: () => atendido(),
      extra: { 'POST /llamados/*/paso-a-cuenta': () => json(200, respuestaDelPaso()) },
    });
    const clave = claveDeBorrador(ID.empresa, ID.usuario, uuid(904));
    const primera = renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pasar a la cuenta' }));
    await screen.findByText(
      'Revisa el pedido con el cliente y pulsa Enviar para mandarlo a cocina',
    );
    expect(leerBorrador(clave).lineas).toHaveLength(2);
    primera.unmount();

    // El mozo vuelve (otra sesión del mismo equipo, un corte, un segundo toque) y el servidor responde la misma
    // respuesta guardada: el borrador no cambia.
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pasar a la cuenta' }));
    await waitFor(() =>
      expect(s.de('POST', `/llamados/${idDeLlamado(1)}/paso-a-cuenta`)).toHaveLength(2),
    );
    await screen.findByText(
      'Revisa el pedido con el cliente y pulsa Enviar para mandarlo a cocina',
    );
    expect(leerBorrador(clave).lineas).toHaveLength(2);
  });

  it('con un envío pendiente en esa cuenta, «Pasar a la cuenta» queda apagado y dice por qué', async () => {
    localStorage.setItem(
      claveDeBorrador(ID.empresa, ID.usuario, uuid(904)),
      JSON.stringify({ lineas: [], envioId: uuid(9999) }),
    );
    servidorDeLlamados({ detalle: () => atendido() });
    renderApp(RUTA);
    const pasar = await screen.findByRole('button', { name: 'Pasar a la cuenta' });
    expect(pasar).toBeDisabled();
    expect(screen.getByText(/La cuenta tiene un envío a cocina sin terminar/)).toBeInTheDocument();
  });

  it('con MESA_SIN_CUENTA ofrece abrir la mesa y vuelve a pasar el pedido', async () => {
    let intentos = 0;
    const s = servidorDeLlamados({
      detalle: () => atendido(),
      extra: {
        'POST /llamados/*/paso-a-cuenta': () => {
          intentos += 1;
          return intentos === 1
            ? json(409, { codigo: 'MESA_SIN_CUENTA', mensaje: 'La mesa no tiene cuenta' })
            : json(200, respuestaDelPaso());
        },
        'POST /ordenes': () => json(201, ordenDeMesa(4, { id: uuid(910) })),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pasar a la cuenta' }));
    expect(await screen.findByText('La mesa ya no tiene cuenta abierta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir la mesa' }));
    const hoja = await screen.findByRole('dialog', { name: /Abrir mesa 4/ });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));

    await waitFor(() =>
      expect(s.de('POST', `/llamados/${idDeLlamado(1)}/paso-a-cuenta`)).toHaveLength(2),
    );
    expect(
      await screen.findByText(
        'Revisa el pedido con el cliente y pulsa Enviar para mandarlo a cocina',
      ),
    ).toBeInTheDocument();
  });

  it('una línea rechazada al pasar queda marcada y nada se agrega al borrador', async () => {
    servidorDeLlamados({
      detalle: () => atendido(),
      extra: {
        'POST /llamados/*/paso-a-cuenta': () =>
          json(422, {
            codigo: 'SELECCION_INVALIDA',
            mensaje: 'Una opción ya no está disponible',
            campos: [{ campo: 'lineas.0', mensaje: 'Posición 0: MODIFICADOR_NO_DISPONIBLE' }],
          }),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pasar a la cuenta' }));
    expect(await screen.findByText('No pasó:')).toBeInTheDocument();
    expect(screen.getByText('Una opción elegida ya no está disponible')).toBeInTheDocument();
    expect(leerBorrador(claveDeBorrador(ID.empresa, ID.usuario, uuid(904))).lineas).toHaveLength(0);
  });

  it('«Descartar» ofrece atajos de motivo y descarta con el elegido', async () => {
    const s = servidorDeLlamados({
      detalle: () => atendido(),
      extra: {
        'POST /llamados/*/descarte': () =>
          json(
            200,
            atendido({
              estado: 'DESCARTADO',
              motivoDescarte: 'Pedido falso',
              cerradoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
              cerradoEn: AHORA,
            }),
          ),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    const hoja = await screen.findByRole('dialog', { name: 'Descartar este llamado' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedido falso' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Descartar' }));

    await waitFor(() =>
      expect(s.de('POST', `/llamados/${idDeLlamado(1)}/descarte`)).toHaveLength(1),
    );
    const llamada = s.de('POST', `/llamados/${idDeLlamado(1)}/descarte`)[0]!;
    expect(llamada.cuerpo).toEqual({ motivo: 'Pedido falso' });
    expect(llamada.cabeceras.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByText('Llamado descartado')).toBeInTheDocument();
    // Si la atención abrió la mesa, se ofrece liberarla desde su cuenta.
    expect(screen.getByRole('link', { name: 'libérala desde su cuenta' })).toHaveAttribute(
      'href',
      `/salon/ordenes/${uuid(904)}`,
    );
  });

  it('un pendiente se atiende desde su detalle y no se puede pasar antes', async () => {
    servidorDeLlamados({ detalle: () => llamadoDetalle(1) });
    renderApp(RUTA);
    expect(await screen.findByRole('button', { name: 'Atender' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pasar a la cuenta' })).toBeNull();
    // Sin atender no se edita: ni − + ni «Quitar».
    expect(screen.queryByRole('button', { name: /^Quitar Gaseosa/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });

  it('un llamado cerrado se ve sin acciones', async () => {
    servidorDeLlamados({
      detalle: () =>
        atendido({
          estado: 'PASADO_A_CUENTA',
          cerradoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
          cerradoEn: AHORA,
          lineasPasadas: [{ posicion: 0, cantidad: 1 }],
        }),
    });
    renderApp(RUTA);
    expect(await screen.findByText('Pasó a la cuenta', { selector: 'b' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pasar a la cuenta' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull();
    expect(screen.getByText('Pasaste 1 a la cuenta')).toBeInTheDocument();
    expect(screen.getByText('No la pasaste a la cuenta')).toBeInTheDocument();
  });
});
