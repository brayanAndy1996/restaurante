import type { CocinaRespuesta, SesionRespuesta } from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { conLineaEn, conTodoListo } from '../src/modulos/cocina/cocina';
import { usarMotorDeSonido, type MotorDeSonido } from '../src/modulos/cocina/sonido';
import { ID, json, renderApp, servidor, type Manejador } from './ayudas';
import { cocinaDe, comandaKds, ESTACIONES_KDS, lineaKds, Z_BARRA, Z_COCINA } from './ayudas-cocina';
import { socketVigente } from './ayudas-tiempo-real';
import { salon, sesionDeRol, uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 56 a 62, 96 y 97 (pantalla de cocina; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

/**
 * Un KDS que cambia: cada cambio sube la versión (su `ETag`) y repetir la versión da 304. Las escrituras
 * aplican la misma regla que la API (una línea cambia de estado, "Todo listo", "Enterado").
 */
function servidorDeCocina(
  sesion: SesionRespuesta,
  inicial: CocinaRespuesta,
  extra: Record<string, Manejador> = {},
) {
  let actual = inicial;
  let version = 1;
  const s = servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /cocina/comandas': ({ cabeceras }) =>
      cabeceras.get('If-None-Match') === `"${version}"`
        ? json(304)
        : json(200, actual, { ETag: `"${version}"` }),
    'PUT /cocina/lineas/*/estado': ({ url, cuerpo }) => {
      const lineaId = url.pathname.split('/')[3] ?? '';
      actual = conLineaEn(actual, lineaId, (cuerpo as { estado: 'LISTO' }).estado);
      version += 1;
      return json(200, {});
    },
    'PUT /cocina/comandas/*/listo': ({ url }) => {
      actual = conTodoListo(actual, url.pathname.split('/')[3] ?? '');
      version += 1;
      return json(200, {});
    },
    'PUT /cocina/comandas/*/visto': ({ url }) => {
      const id = url.pathname.split('/')[3];
      const marcar = (c: (typeof actual.pendientes)[number]) =>
        c.id === id ? { ...c, vistaEn: actual.ahora } : c;
      actual = {
        ...actual,
        pendientes: actual.pendientes.filter((c) => c.id !== id),
        recientes: [
          ...actual.recientes,
          ...actual.pendientes.filter((c) => c.id === id).map(marcar),
        ],
      };
      version += 1;
      return json(200, {});
    },
    ...extra,
  });
  return {
    ...s,
    cambiar(nuevo: CocinaRespuesta) {
      actual = nuevo;
      version += 1;
    },
  };
}

/** Un motor de sonido de mentira: anota cada aviso. */
function motorFalso(listo = true) {
  const motor = {
    desbloquear: vi.fn(() => listo),
    listo: vi.fn(() => listo),
    avisar: vi.fn(() => true),
  } satisfies MotorDeSonido;
  usarMotorDeSonido(motor);
  return motor;
}

/** La dirección de la última consulta de comandas, con su `?estacionIds=…`. */
const ultimaConsulta = (s: { simulado: { mock: { calls: unknown[][] } } }) =>
  s.simulado.mock.calls
    .map(([entrada]) => String(entrada))
    .filter((u) => u.includes('/cocina/comandas'))
    .at(-1);

const tarjetas = () => within(screen.getByRole('list', { name: 'Comandas pendientes' }));
const tarjetaDe = (mesa: string) =>
  tarjetas().getByRole('article', { name: new RegExp(`, ${mesa}, `) });

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
  motorFalso();
});
afterEach(() => {
  usarMotorDeSonido();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Cocina: comandas en orden de llegada (criterios 56 y 96)', () => {
  it('las muestra en el orden en que llegaron, aunque la respuesta venga revuelta', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(3, { hace: 5 }),
        comandaKds(1, { hace: 12 }),
        comandaKds(2, { hace: 8 }),
      ]),
    );
    renderApp('/cocina');
    await screen.findByRole('list', { name: 'Comandas pendientes' });
    const orden = tarjetas()
      .getAllByRole('article')
      .map((t) => t.getAttribute('aria-label'));
    expect(orden).toEqual([
      'Comanda, Mesa 1, Cocina',
      'Comanda, Mesa 2, Cocina',
      'Comanda, Mesa 3, Cocina',
    ]);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('3 pendientes');
  });

  it('desempata por el id cuando llegan a la vez', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(9, { creadaEn: '2026-10-29T16:55:00.000Z' }),
        comandaKds(4, { creadaEn: '2026-10-29T16:55:00.000Z' }),
      ]),
    );
    renderApp('/cocina');
    await screen.findByRole('list', { name: 'Comandas pendientes' });
    const orden = tarjetas()
      .getAllByRole('article')
      .map((t) => t.getAttribute('aria-label'));
    expect(orden).toEqual(['Comanda, Mesa 4, Cocina', 'Comanda, Mesa 9, Cocina']);
  });

  it('pone la anulación arriba, por encima de lo que sigue', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(1, { hace: 12 }),
        comandaKds(2, { hace: 1, tipo: 'ANULACION', motivo: 'El cliente se fue' }),
        comandaKds(3, { hace: 6 }),
      ]),
    );
    renderApp('/cocina');
    await screen.findByRole('list', { name: 'Comandas pendientes' });
    const orden = tarjetas()
      .getAllByRole('article')
      .map((t) => t.getAttribute('aria-label'));
    expect(orden).toEqual([
      'Anulación, Mesa 2, Cocina',
      'Comanda, Mesa 1, Cocina',
      'Comanda, Mesa 3, Cocina',
    ]);
  });

  it('sin comandas pendientes lo dice y explica qué pasará', async () => {
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([]));
    renderApp('/cocina');
    expect(await screen.findByText('No hay comandas pendientes')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Sin comandas pendientes');
    expect(screen.queryByRole('list', { name: 'Comandas pendientes' })).toBeNull();
  });
});

describe('Cocina: el tiempo y sus umbrales (criterio 96)', () => {
  it('cambia a ají a los 10 minutos y a rocoto a los 20, siempre con palabras', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(1, { hace: 20 }),
        comandaKds(2, { hace: 19 }),
        comandaKds(3, { hace: 10 }),
        comandaKds(4, { hace: 9 }),
        comandaKds(5, { hace: 0 }),
      ]),
    );
    renderApp('/cocina');
    await screen.findByRole('list', { name: 'Comandas pendientes' });
    const tiempo = (mesa: string) => within(tarjetaDe(mesa)).getByRole('timer');

    expect(tiempo('Mesa 5')).toHaveAttribute('data-nivel', 'normal');
    expect(tiempo('Mesa 5')).toHaveAccessibleName('0 min');
    expect(tiempo('Mesa 4')).toHaveAttribute('data-nivel', 'normal');
    expect(tiempo('Mesa 4')).toHaveAccessibleName('9 min');
    expect(within(tarjetaDe('Mesa 4')).queryByText('Demora')).toBeNull();

    expect(tiempo('Mesa 3')).toHaveAttribute('data-nivel', 'demora');
    expect(tiempo('Mesa 3')).toHaveAccessibleName('10 min, demora');
    expect(within(tarjetaDe('Mesa 3')).getByText('Demora')).toBeInTheDocument();
    expect(tiempo('Mesa 2')).toHaveAttribute('data-nivel', 'demora');
    expect(tiempo('Mesa 2')).toHaveAccessibleName('19 min, demora');

    expect(tiempo('Mesa 1')).toHaveAttribute('data-nivel', 'atraso');
    expect(tiempo('Mesa 1')).toHaveAccessibleName('20 min, atrasada');
    expect(within(tarjetaDe('Mesa 1')).getByText('Atrasada')).toBeInTheDocument();
  });

  it('cuenta con la hora del servidor, no con el reloj del equipo', async () => {
    // El reloj del equipo va 3 horas adelantado: el tiempo de la comanda no cambia.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T20:00:00.000Z'));
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1, { hace: 7 })]));
    renderApp('/cocina');
    await screen.findByRole('list', { name: 'Comandas pendientes' });
    expect(within(tarjetaDe('Mesa 1')).getByRole('timer')).toHaveAccessibleName('7 min');
  });
});

describe('Cocina: el detalle de cada línea (criterios 57 y 96)', () => {
  it('muestra cantidad, nombre, contexto, modificadores, observación y las banderas', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(4, {
          mesas: [
            { id: uuid(104), nombre: '4' },
            { id: uuid(105), nombre: '5' },
          ],
          mozo: 'Lucía Salón',
          lineas: [
            lineaKds(1, {
              cantidad: 2,
              nombre: 'Hamburguesa clásica',
              contexto: 'Combo hamburguesa',
              modificadores: ['Sin cebolla', 'Término medio'],
              observacion: 'Alérgico al maní',
              paraLlevar: true,
            }),
            lineaKds(2, { nombre: 'Lomo saltado', tiempo: 2, esperar: true }),
          ],
        }),
      ]),
    );
    renderApp('/cocina');
    const tarjeta = await screen.findByRole('article', { name: /Mesas 4 y 5/ });
    expect(within(tarjeta).getByRole('heading', { name: 'Mesas 4 y 5' })).toBeInTheDocument();
    expect(tarjeta).toHaveTextContent('Lucía Salón');
    expect(tarjeta).toHaveTextContent('3 comensales');
    expect(within(tarjeta).getByText('Comanda')).toBeInTheDocument();

    const [primera, segunda] = within(tarjeta)
      .getAllByRole('listitem')
      .filter((li) => li.classList.contains('ui-kds__linea'));
    expect(primera).toHaveTextContent('2 ×');
    expect(primera).toHaveTextContent('Hamburguesa clásica');
    expect(primera).toHaveTextContent('Combo hamburguesa');
    const mods = within(primera!).getByRole('list', { name: 'Modificadores' });
    expect(
      within(mods)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['Sin cebolla', 'Término medio']);
    expect(primera).toHaveTextContent('Nota: Alérgico al maní');
    expect(within(primera!).getByText('Para llevar')).toBeInTheDocument();
    expect(within(primera!).queryByText('Esperar')).toBeNull();
    expect(within(segunda!).getByText('Esperar')).toBeInTheDocument();
    expect(within(segunda!).queryByText('Para llevar')).toBeNull();
  });

  it('una adición se ve como adición', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(1, { tipo: 'ADICION', lineas: [lineaKds(1, { nombre: 'Inca Kola' })] }),
      ]),
    );
    renderApp('/cocina');
    const tarjeta = await screen.findByRole('article', { name: /^Adición, Mesa 1/ });
    expect(within(tarjeta).getByText('Adición')).toBeInTheDocument();
    expect(within(tarjeta).getByRole('button', { name: 'Todo listo, Mesa 1' })).toBeInTheDocument();
  });

  it('una marcha dice "Marchar" y se cierra con "Enterado", sin botones de preparación', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(1, { tipo: 'MARCHAR', lineas: [lineaKds(1, { nombre: 'Lomo saltado' })] }),
      ]),
    );
    renderApp('/cocina');
    const tarjeta = await screen.findByRole('article', { name: /^Marchar, Mesa 1/ });
    expect(tarjeta).toHaveTextContent('Marchar: sacar ahora el segundo tiempo.');
    expect(within(tarjeta).getByRole('button', { name: 'Enterado, Mesa 1' })).toBeInTheDocument();
    expect(within(tarjeta).queryByRole('button', { name: /^Preparando/ })).toBeNull();
    expect(within(tarjeta).queryByRole('button', { name: /^Listo/ })).toBeNull();
    expect(within(tarjeta).queryByRole('button', { name: /^Todo listo/ })).toBeNull();
  });

  it('una anulación dice que no se prepare, con su motivo', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(1, {
          tipo: 'ANULACION',
          motivo: 'El cliente se arrepintió',
          lineas: [lineaKds(1, { cantidad: 2, nombre: 'Lomo saltado' })],
        }),
      ]),
    );
    renderApp('/cocina');
    const tarjeta = await screen.findByRole('article', { name: /^Anulación, Mesa 1/ });
    expect(tarjeta).toHaveTextContent('No lo prepares.');
    expect(tarjeta).toHaveTextContent('Motivo: El cliente se arrepintió');
    expect(tarjeta).toHaveTextContent('2 ×');
    expect(within(tarjeta).getByRole('button', { name: 'Enterado, Mesa 1' })).toBeInTheDocument();
  });
});

describe('Cocina: las transiciones (criterios 58 y 59)', () => {
  it('"Preparando" marca la línea al instante y la manda con su clave de idempotencia', async () => {
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    const boton = await screen.findByRole('button', { name: 'Preparando: Lomo saltado' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(boton);
    expect(screen.getByRole('button', { name: 'Preparando: Lomo saltado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(s.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(1));
    const llamada = s.llamadas.find((l) => l.metodo === 'PUT')!;
    expect(llamada.ruta).toBe(`/cocina/lineas/${lineaKds(1).id}/estado`);
    expect(llamada.cuerpo).toEqual({ estado: 'EN_PREPARACION' });
    expect(llamada.cabeceras.get('Idempotency-Key')).toBeTruthy();
    // Lo que dice el servidor coincide: sigue en preparación y la comanda sigue pendiente.
    await waitFor(() => expect(s.de('GET', '/cocina/comandas').length).toBeGreaterThan(1));
    expect(screen.getByRole('button', { name: 'Preparando: Lomo saltado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('"Listo" en la única línea la termina: pasa a Recientes y ofrece "Deshacer"', async () => {
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    await userEvent.click(await screen.findByRole('button', { name: 'Listo: Lomo saltado' }));
    await waitFor(() =>
      expect(s.llamadas.find((l) => l.metodo === 'PUT')?.cuerpo).toEqual({ estado: 'LISTO' }),
    );
    expect(await screen.findByText('No hay comandas pendientes')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Recientes/ }));
    const reciente = within(
      await screen.findByRole('list', { name: 'Comandas recientes' }),
    ).getByRole('article', { name: /Mesa 1/ });
    expect(within(reciente).getByText('Listo')).toBeInTheDocument();

    // Un «Listo» puesto por error se corrige: la línea vuelve a pendiente y la comanda a la pantalla.
    await userEvent.click(
      within(reciente).getByRole('button', { name: 'Deshacer el listo: Lomo saltado' }),
    );
    await waitFor(() =>
      expect(s.llamadas.filter((l) => l.metodo === 'PUT').at(-1)?.cuerpo).toEqual({
        estado: 'ENVIADO',
      }),
    );
    const vuelta = await screen.findByRole('list', { name: 'Comandas pendientes' });
    expect(within(vuelta).getByRole('article', { name: /Mesa 1/ })).toBeInTheDocument();
  });

  it('"Listo" en una línea deja la comanda pendiente mientras quede otra por preparar', async () => {
    const s = servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(1, {
          lineas: [
            lineaKds(1, { nombre: 'Lomo saltado' }),
            lineaKds(2, { nombre: 'Ají de gallina' }),
          ],
        }),
      ]),
    );
    renderApp('/cocina');
    await userEvent.click(await screen.findByRole('button', { name: 'Listo: Lomo saltado' }));
    await waitFor(() => expect(s.llamadas.some((l) => l.metodo === 'PUT')).toBe(true));
    const tarjeta = await screen.findByRole('article', { name: /Mesa 1/ });
    // La línea lista ya no tiene "Preparando" ni "Listo"; la otra sigue con los suyos.
    expect(within(tarjeta).queryByRole('button', { name: 'Listo: Lomo saltado' })).toBeNull();
    expect(
      within(tarjeta).getByRole('button', { name: 'Listo: Ají de gallina' }),
    ).toBeInTheDocument();
    expect(
      within(tarjeta).getByRole('button', { name: 'Deshacer el listo: Lomo saltado' }),
    ).toBeInTheDocument();
  });

  it('"Todo listo" termina toda la comanda con una sola llamada', async () => {
    const s = servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([
        comandaKds(1, { lineas: [lineaKds(1), lineaKds(2, { nombre: 'Ají de gallina' })] }),
        comandaKds(2, { hace: 1 }),
      ]),
    );
    renderApp('/cocina');
    await userEvent.click(await screen.findByRole('button', { name: 'Todo listo, Mesa 1' }));
    await waitFor(() => expect(s.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(1));
    const llamada = s.llamadas.find((l) => l.metodo === 'PUT')!;
    expect(llamada.ruta).toBe(`/cocina/comandas/${comandaKds(1).id}/listo`);
    expect(llamada.cabeceras.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('article', { name: /Mesa 1/ })).toBeNull());
    expect(screen.getByRole('article', { name: /Mesa 2/ })).toBeInTheDocument();
  });

  it('"Enterado" saca la marcha de pendientes', async () => {
    const s = servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([comandaKds(1, { tipo: 'MARCHAR' }), comandaKds(2, { hace: 1 })]),
    );
    renderApp('/cocina');
    await userEvent.click(await screen.findByRole('button', { name: 'Enterado, Mesa 1' }));
    await waitFor(() => expect(s.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(1));
    expect(s.llamadas.find((l) => l.metodo === 'PUT')?.ruta).toBe(
      `/cocina/comandas/${comandaKds(1).id}/visto`,
    );
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: /^Marchar, Mesa 1/ })).toBeNull(),
    );
    expect(screen.getByRole('article', { name: /^Comanda, Mesa 2/ })).toBeInTheDocument();
  });

  it('si la API rechaza el cambio, dice por qué y vuelve a lo que dice el servidor', async () => {
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]), {
      'PUT /cocina/lineas/*/estado': () =>
        json(409, { codigo: 'TRANSICION_INVALIDA', mensaje: 'La línea ya no admite ese cambio' }),
    });
    renderApp('/cocina');
    await userEvent.click(await screen.findByRole('button', { name: 'Listo: Lomo saltado' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos marcar «Lomo saltado»');
    // La comanda sigue en pantalla, sin marcar.
    expect(await screen.findByRole('article', { name: /Mesa 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listo: Lomo saltado' })).toBeInTheDocument();
    // La alerta se pinta al fallar la escritura; la nueva lectura la lanza la consulta un poco después.
    await waitFor(() => expect(s.de('GET', '/cocina/comandas').length).toBeGreaterThan(1));
  });
});

describe('Cocina: el sonido (criterio 96)', () => {
  it('suena una vez al llegar una comanda nueva y la marca como "Nueva"', async () => {
    const motor = motorFalso();
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    await screen.findByRole('article', { name: /Mesa 1/ });
    await waitFor(() => expect(socketVigente()).toBeDefined());
    // Lo que ya estaba al abrir la pantalla no es nuevo.
    expect(motor.avisar).not.toHaveBeenCalled();
    expect(screen.queryByText('Nueva')).toBeNull();

    s.cambiar(cocinaDe([comandaKds(1), comandaKds(2, { hace: 0 })]));
    act(() =>
      socketVigente()!.desdeElServidor('cocina.comanda', {
        comandaId: comandaKds(2).id,
        estacionId: Z_COCINA,
        tipo: 'COMANDA',
      }),
    );
    const nueva = await screen.findByRole('article', { name: /Mesa 2/ });
    expect(within(nueva).getByText('Nueva')).toBeInTheDocument();
    expect(motor.avisar).toHaveBeenCalledTimes(1);
    // La que ya estaba no se marca.
    expect(within(screen.getByRole('article', { name: /Mesa 1/ })).queryByText('Nueva')).toBeNull();
  });

  it('silenciado no suena, pero la comanda nueva se ve igual; y se recuerda en el equipo', async () => {
    const motor = motorFalso();
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    const { unmount } = renderApp('/cocina');
    await screen.findByRole('article', { name: /Mesa 1/ });
    await waitFor(() => expect(socketVigente()).toBeDefined());

    const interruptor = screen.getByRole('switch', { name: 'Sonido' });
    expect(interruptor).toBeChecked();
    await userEvent.click(interruptor);
    expect(interruptor).not.toBeChecked();
    expect(screen.getByText('Silenciado en este equipo.')).toBeInTheDocument();

    s.cambiar(cocinaDe([comandaKds(1), comandaKds(2, { hace: 0 })]));
    act(() =>
      socketVigente()!.desdeElServidor('cocina.comanda', {
        comandaId: comandaKds(2).id,
        estacionId: Z_COCINA,
        tipo: 'COMANDA',
      }),
    );
    const nueva = await screen.findByRole('article', { name: /Mesa 2/ });
    expect(within(nueva).getByText('Nueva')).toBeInTheDocument();
    expect(motor.avisar).not.toHaveBeenCalled();
    unmount();

    // Al volver a abrir la pantalla en el mismo equipo sigue silenciada.
    renderApp('/cocina');
    expect(await screen.findByRole('switch', { name: 'Sonido' })).not.toBeChecked();
  });

  it('al activarlo suena una vez, para comprobar que se oye', async () => {
    const motor = motorFalso();
    localStorage.setItem('restaurante.cocina.sonido', 'silenciado');
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([]));
    renderApp('/cocina');
    await userEvent.click(await screen.findByRole('switch', { name: 'Sonido' }));
    expect(motor.desbloquear).toHaveBeenCalled();
    expect(motor.avisar).toHaveBeenCalledTimes(1);
  });

  it('si el navegador aún no deja sonar, pide un toque en la pantalla', async () => {
    const motor = motorFalso(false);
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    expect(
      await screen.findByText('Toca la pantalla una vez para activar el sonido.'),
    ).toBeInTheDocument();
    motor.listo.mockReturnValue(true);
    motor.desbloquear.mockReturnValue(true);
    await userEvent.click(await screen.findByRole('article', { name: /Mesa 1/ }));
    expect(motor.desbloquear).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText('Toca la pantalla una vez para activar el sonido.')).toBeNull(),
    );
  });
});

describe('Cocina: filtros de estación (criterio 96)', () => {
  it('muestra las estaciones, filtra la consulta y recuerda la elección en el equipo', async () => {
    const s = servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([comandaKds(1), comandaKds(2, { estacion: { id: Z_BARRA, nombre: 'Barra' } })]),
    );
    const { unmount } = renderApp('/cocina');
    const grupo = await screen.findByRole('group', { name: 'Estaciones' });
    expect(within(grupo).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await screen.findByRole('article', { name: /Mesa 1/ });

    await userEvent.click(within(grupo).getByRole('button', { name: 'Barra' }));
    expect(within(grupo).getByRole('button', { name: 'Barra' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(grupo).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await waitFor(() => expect(ultimaConsulta(s)).toContain(`estacionIds=${Z_BARRA}`));
    unmount();

    // Otra vez en el mismo equipo: la estación sigue elegida y la primera consulta ya la pide.
    renderApp('/cocina');
    const grupo2 = await screen.findByRole('group', { name: 'Estaciones' });
    expect(within(grupo2).getByRole('button', { name: 'Barra' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(ultimaConsulta(s)).toContain(`estacionIds=${Z_BARRA}`));
  });

  it('"Todas" quita el filtro', async () => {
    localStorage.setItem(
      `restaurante.cocina.estaciones.${ID.empresa}.${ID.sucursalA}`,
      JSON.stringify([Z_BARRA]),
    );
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([]));
    renderApp('/cocina');
    const grupo = await screen.findByRole('group', { name: 'Estaciones' });
    expect(within(grupo).getByRole('button', { name: 'Barra' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(grupo).getByRole('button', { name: 'Todas' }));
    expect(within(grupo).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      JSON.parse(
        localStorage.getItem(`restaurante.cocina.estaciones.${ID.empresa}.${ID.sucursalA}`) ??
          'null',
      ),
    ).toEqual([]);
  });

  it('las estaciones salen de la respuesta de la cocina: no pide la carta de la sucursal', async () => {
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    const grupo = await screen.findByRole('group', { name: 'Estaciones' });
    expect(within(grupo).getByRole('button', { name: 'Cocina' })).toBeVisible();
    expect(within(grupo).getByRole('button', { name: 'Barra' })).toBeVisible();
    expect(s.llamadas.some((l) => l.ruta === '/carta/sucursal')).toBe(false);
  });

  it('al filtrar, los filtros siguen a la vista mientras llega la respuesta nueva', async () => {
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    const grupo = await screen.findByRole('group', { name: 'Estaciones' });
    await screen.findByRole('article', { name: /Mesa 1/ });
    await userEvent.click(within(grupo).getByRole('button', { name: 'Barra' }));
    // La consulta cambió y todavía no hay respuesta: la lista de estaciones no se vacía.
    expect(screen.getByRole('group', { name: 'Estaciones' })).toBeVisible();
    expect(
      within(screen.getByRole('group', { name: 'Estaciones' })).getByRole('button', {
        name: 'Cocina',
      }),
    ).toBeVisible();
  });

  it('ignora una estación recordada que ya no existe', async () => {
    localStorage.setItem(
      `restaurante.cocina.estaciones.${ID.empresa}.${ID.sucursalA}`,
      JSON.stringify([uuid(999)]),
    );
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    await screen.findByRole('article', { name: /Mesa 1/ });
    const grupo = screen.getByRole('group', { name: 'Estaciones' });
    expect(within(grupo).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(ultimaConsulta(s)).not.toContain('estacionIds'));
  });
});

describe('Cocina: estaciones que salen por impresora (criterio 138)', () => {
  const otraKds = () => ({
    id: uuid(61),
    nombre: 'Postres',
    destino: 'KDS' as const,
    impresora: null,
  });
  const porImpresora = [
    ESTACIONES_KDS[0]!,
    {
      id: Z_BARRA,
      nombre: 'Barra',
      destino: 'IMPRESORA' as const,
      impresora: { id: uuid(101), nombre: 'Impresora de la barra' },
    },
  ];

  it('dice qué estación sale por impresora y que no aparece en la pantalla ni como filtro', async () => {
    const s = servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe([comandaKds(1)], [], porImpresora),
    );
    renderApp('/cocina');
    const lista = await screen.findByRole('list', { name: 'Estaciones que salen por impresora' });
    const items = within(lista).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(
      'Barra sale por la impresora Impresora de la barra y no aparece en esta pantalla.',
    );
    expect(lista).not.toHaveTextContent('Cocina sale');
    // Con una sola estación en la pantalla no hay nada que filtrar: ni "Barra" ni "Cocina" son filtros.
    await screen.findByRole('article', { name: /Mesa 1/ });
    expect(screen.queryByRole('group', { name: 'Estaciones' })).toBeNull();
    expect(ultimaConsulta(s)).not.toContain('estacionIds');
  });

  it('con varias estaciones en la pantalla, solo esas son filtros; la de impresora no', async () => {
    const tres = [
      ...ESTACIONES_KDS,
      {
        id: uuid(60),
        nombre: 'Parrilla',
        destino: 'IMPRESORA' as const,
        impresora: { id: uuid(102), nombre: 'Impresora de la parrilla' },
      },
    ];
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)], [], tres));
    renderApp('/cocina');
    const grupo = await screen.findByRole('group', { name: 'Estaciones' });
    expect(
      within(grupo)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Todas', 'Cocina', 'Barra']);
    expect(
      await screen.findByText(/Parrilla sale por la impresora Impresora de la parrilla/),
    ).toBeVisible();
  });

  it('descarta una estación recordada que ahora sale por impresora: la pantalla no queda vacía', async () => {
    localStorage.setItem(
      `restaurante.cocina.estaciones.${ID.empresa}.${ID.sucursalA}`,
      JSON.stringify([Z_BARRA]),
    );
    const tres = [ESTACIONES_KDS[0]!, porImpresora[1]!, otraKds()];
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)], [], tres));
    renderApp('/cocina');
    await screen.findByRole('article', { name: /Mesa 1/ });
    const grupo = await screen.findByRole('group', { name: 'Estaciones' });
    expect(within(grupo).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(grupo).queryByRole('button', { name: 'Barra' })).toBeNull();
    // La consulta final ya no pide la estación que sale por impresora.
    await waitFor(() => expect(ultimaConsulta(s)).not.toContain('estacionIds'));
    expect(screen.getByRole('article', { name: /Mesa 1/ })).toBeVisible();
  });

  it('si todas las estaciones salen por la pantalla, no dice nada', async () => {
    servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    await screen.findByRole('article', { name: /Mesa 1/ });
    expect(screen.queryByRole('list', { name: 'Estaciones que salen por impresora' })).toBeNull();
  });
});

describe('Cocina: recientes y acceso (criterios 56 y 87)', () => {
  it('"Recientes" va plegada abajo y muestra lo terminado, la más nueva primero', async () => {
    servidorDeCocina(
      sesionDeRol('COCINA_BARRA'),
      cocinaDe(
        [comandaKds(1)],
        [
          comandaKds(7, { hace: 30, lineas: [lineaKds(7, { estado: 'LISTO' })] }),
          comandaKds(8, { hace: 15, lineas: [lineaKds(8, { estado: 'LISTO' })] }),
        ],
      ),
    );
    renderApp('/cocina');
    await screen.findByRole('article', { name: /Mesa 1/ });
    const boton = screen.getByRole('button', { name: /Recientes/ });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(boton).toHaveTextContent('2 comandas de la última hora');
    await userEvent.click(boton);
    const lista = within(await screen.findByRole('list', { name: 'Comandas recientes' }));
    expect(lista.getAllByRole('article').map((t) => t.getAttribute('aria-label'))).toEqual([
      'Comanda, Mesa 8, Cocina',
      'Comanda, Mesa 7, Cocina',
    ]);
    // Las recientes no repiten los botones de preparación.
    expect(lista.queryByRole('button', { name: /^Preparando/ })).toBeNull();
  });

  it('lo ve el Supervisor y el Administrador; el Mozo no tiene la pantalla', async () => {
    servidorDeCocina(sesionDeRol('SUPERVISOR'), cocinaDe([comandaKds(1)]));
    const { unmount } = renderApp('/cocina');
    expect(await screen.findByRole('article', { name: /Mesa 1/ })).toBeInTheDocument();
    unmount();

    const s = servidorDeCocina(sesionDeRol('MOZO'), cocinaDe([comandaKds(1)]), {
      'GET /salon': () => json(200, salon([])),
    });
    renderApp('/cocina');
    // Sin `USAR_KDS` la guarda lo manda al salón, y la cocina ni se consulta.
    await waitFor(() => expect(s.de('GET', '/salon').length).toBeGreaterThan(0));
    expect(screen.queryByRole('article')).toBeNull();
    expect(s.de('GET', '/cocina/comandas')).toHaveLength(0);
  });

  it('las consultas automáticas no renuevan la inactividad, la primera sí', async () => {
    const s = servidorDeCocina(sesionDeRol('COCINA_BARRA'), cocinaDe([comandaKds(1)]));
    renderApp('/cocina');
    await screen.findByRole('article', { name: /Mesa 1/ });
    await waitFor(() => expect(socketVigente()).toBeDefined());
    const primera = s.de('GET', '/cocina/comandas')[0]!;
    expect(primera.cabeceras.get('X-Actividad')).toBeNull();

    s.cambiar(cocinaDe([comandaKds(1), comandaKds(2)]));
    act(() =>
      socketVigente()!.desdeElServidor('cocina.comanda', {
        comandaId: comandaKds(2).id,
        estacionId: Z_COCINA,
        tipo: 'COMANDA',
      }),
    );
    await screen.findByRole('article', { name: /Mesa 2/ });
    const segunda = s.de('GET', '/cocina/comandas').at(-1)!;
    expect(segunda.cabeceras.get('X-Actividad')).toBe('segundo-plano');
    expect(segunda.cabeceras.get('If-None-Match')).toBe('"1"');
  });
});
