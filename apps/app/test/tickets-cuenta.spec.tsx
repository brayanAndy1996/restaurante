import type { OrdenRespuesta, TrabajoResumen } from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { json, renderApp } from './ayudas';
import { ORDEN_ID, servidorDeCuenta } from './ayudas-comandero';
import { AHORA, itemDeOrden, ordenDeMesa, sesionDeRol, uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 128 y 138 en la interfaz (pruebas no protegidas de "Reimprimir" en la
// cuenta de la mesa).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const RUTA = `/salon/ordenes/${ORDEN_ID}`;

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const minutosAntes = (m: number) => new Date(Date.parse(AHORA) - m * 60_000).toISOString();

const cuenta = (extra: Partial<OrdenRespuesta> = {}): OrdenRespuesta =>
  ordenDeMesa(4, {
    total: '28.00',
    items: [itemDeOrden(1, { nombre: 'Lomo saltado' })],
    ...extra,
  });

const trabajo = (n: number, extra: Partial<TrabajoResumen> = {}): TrabajoResumen => ({
  id: uuid(700 + n),
  tipo: 'COMANDA',
  impresora: { id: uuid(101), nombre: 'Cocina' },
  mesa: '4',
  estado: 'IMPRESO',
  intentos: 0,
  creadoEn: minutosAntes(20),
  impresoEn: minutosAntes(20),
  reimpresionDe: null,
  ordenId: ORDEN_ID,
  envioNumero: null,
  ...extra,
});

function montar(trabajos: TrabajoResumen[], orden = cuenta()) {
  const s = servidorDeCuenta({
    sesion: sesionDeRol('MOZO'),
    orden,
    extra: { 'GET /impresion/trabajos': () => json(200, trabajos) },
  });
  return s;
}

/** Abre "Tickets impresos" y devuelve la lista del primer grupo (la que no tiene envío, si no hay otra). */
async function abrirSeccion() {
  renderApp(RUTA);
  const seccion = await screen.findByRole('button', { name: /Tickets impresos/ });
  await userEvent.click(seccion);
  return (await screen.findAllByRole('list', { name: /^Tickets de / }))[0]!;
}

async function abrirGrupo(titulo: string) {
  await abrirSeccion();
  return screen.getByRole('region', { name: `Tickets: ${titulo}` });
}

describe('Reimprimir en la cuenta de la mesa (criterios 128 y 138)', () => {
  it('la sección está plegada y no pide nada a la API hasta abrirla', async () => {
    const s = montar([trabajo(1)]);
    renderApp(RUTA);
    const boton = await screen.findByRole('button', { name: /Tickets impresos/ });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(s.de('GET', '/impresion/trabajos')).toHaveLength(0);
    await userEvent.click(boton);
    await screen.findAllByRole('list', { name: /^Tickets de / });
    expect(s.de('GET', '/impresion/trabajos')).toHaveLength(1);
  });

  it('pide a la API solo los tickets de esta cuenta (?ordenId=…), no la lista del día', async () => {
    const s = montar([trabajo(1)]);
    await abrirSeccion();
    const urls = s.simulado.mock.calls
      .map(([entrada]) => String(entrada))
      .filter((u) => u.includes('/impresion/trabajos'));
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]!).searchParams.get('ordenId')).toBe(ORDEN_ID);
  });

  it('muestra solo los tickets de esta cuenta (por su ordenId), agrupados por envío', async () => {
    montar(
      [
        trabajo(1, { tipo: 'COMANDA', envioNumero: 1, creadoEn: minutosAntes(24) }),
        trabajo(2, { tipo: 'ADICION', envioNumero: 2, creadoEn: minutosAntes(10) }),
        trabajo(3, {
          tipo: 'PRECUENTA',
          impresora: { id: uuid(102), nombre: 'Caja' },
          creadoEn: minutosAntes(2),
        }),
        trabajo(4, { ordenId: uuid(999), envioNumero: 1 }),
        trabajo(5, { tipo: 'PRUEBA', mesa: null, ordenId: null }),
        trabajo(6, { tipo: 'MARCHAR', creadoEn: minutosAntes(5) }),
      ],
      cuenta({
        items: [
          itemDeOrden(1, { nombre: 'Lomo saltado', envioNumero: 1 }),
          itemDeOrden(2, { nombre: 'Chicha', envioNumero: 2, esAdicion: true }),
        ],
      }),
    );
    const grupoComanda = await abrirGrupo('Comanda');
    expect(within(grupoComanda).getAllByRole('listitem')).toHaveLength(1);
    expect(grupoComanda).toHaveTextContent('Cocina');
    const grupoAdicion = screen.getByRole('region', { name: 'Tickets: Adición 2' });
    expect(within(grupoAdicion).getAllByRole('listitem')).toHaveLength(1);
    const otros = screen.getByRole('region', {
      name: 'Tickets: Marchas, anulaciones y pre-cuentas',
    });
    const filas = within(otros).getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('Marcha');
    expect(filas[1]).toHaveTextContent('Pre-cuenta');
    expect(filas[1]).toHaveTextContent('Caja');
    // Ni la otra cuenta ni la página de prueba.
    expect(screen.getAllByRole('button', { name: /^Reimprimir/ })).toHaveLength(4);
  });

  it('con mesas unidas, los tickets de la principal salen aunque su mesa sea otra', async () => {
    montar([
      trabajo(1, { mesa: '5, 4', envioNumero: 1 }),
      trabajo(2, { mesa: '4', ordenId: uuid(999) }),
    ]);
    const grupo = await abrirGrupo('Comanda');
    expect(within(grupo).getAllByRole('listitem')).toHaveLength(1);
  });

  it('"Reimprimir" manda la reimpresión de ese ticket con una clave de idempotencia y lo confirma', async () => {
    const t = trabajo(1);
    const s = montar([t]);
    s.poner(`POST /impresion/trabajos/${t.id}/reimpresion`, () =>
      json(201, { trabajoId: uuid(950) }),
    );
    const lista = await abrirSeccion();
    await userEvent.click(within(lista).getByRole('button', { name: /^Reimprimir/ }));
    expect(await screen.findByText('Reimpresión en cola')).toBeVisible();
    const [llamada] = s.de('POST', `/impresion/trabajos/${t.id}/reimpresion`);
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    // Reimprimir no cambia la cuenta: sigue abierta, con su total.
    expect(screen.getAllByText('S/ 28.00').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('un corte o un fallo no duplica: la misma clave en cada reintento', async () => {
    const t = trabajo(1);
    const ruta = `/impresion/trabajos/${t.id}/reimpresion`;
    const s = montar([t]);
    let intentos = 0;
    s.poner(`POST ${ruta}`, () => {
      intentos += 1;
      if (intentos <= 2) return json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' });
      if (intentos === 3) return json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' });
      return json(201, { trabajoId: uuid(950) });
    });
    const lista = await abrirSeccion();
    const reimprimir = () => within(lista).getByRole('button', { name: /^Reimprimir/ });
    await userEvent.click(reimprimir());
    expect(await screen.findByText('No pudimos reimprimir')).toBeVisible();
    await userEvent.click(reimprimir());
    await screen.findByText('Reimpresión en cola');
    const llamadas = s.de('POST', ruta);
    expect(llamadas).toHaveLength(4);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
  });

  it('sin tickets impresos, lo dice (lo que sale por la pantalla de cocina no se imprime)', async () => {
    montar([]);
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /Tickets impresos/ }));
    expect(await screen.findByText(/Esta cuenta no tiene tickets impresos/)).toBeVisible();
  });

  it('si no puede cargarlos, lo dice y deja reintentar', async () => {
    const s = montar([trabajo(1)]);
    let falla = true;
    s.poner('GET /impresion/trabajos', () =>
      falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, [trabajo(1)]),
    );
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /Tickets impresos/ }));
    expect(await screen.findByText('No pudimos cargar los tickets')).toBeVisible();
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findAllByRole('list', { name: /^Tickets de / });
  });

  it('una cuenta sin envíos o que ya no está abierta no ofrece reimprimir', async () => {
    montar([trabajo(1)], cuenta({ items: [] }));
    const { unmount } = renderApp(RUTA);
    await screen.findByText('Aún no se envió nada');
    expect(screen.queryByRole('button', { name: /Tickets impresos/ })).toBeNull();
    unmount();

    montar([trabajo(1)], cuenta({ estado: 'ANULADA' }));
    renderApp(RUTA);
    await screen.findByText('Esta cuenta ya no está abierta');
    expect(screen.queryByRole('button', { name: /Tickets impresos/ })).toBeNull();
  });

  it('un ticket de otra cuenta de la misma mesa no se ofrece', async () => {
    montar([trabajo(1, { ordenId: uuid(999) })]);
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /Tickets impresos/ }));
    await waitFor(() =>
      expect(screen.getByText(/Esta cuenta no tiene tickets impresos/)).toBeVisible(),
    );
  });
});
