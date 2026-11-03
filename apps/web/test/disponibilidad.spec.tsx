import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disponibilidad } from '../componentes/Disponibilidad';
import { aplicarDisponibilidad, esDisponibilidad } from '../lib/disponibilidad';

// Disponibilidad en vivo de la carta (criterio 82, HU-09, RF-41).

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const OPCION = '00000000-0000-4000-8000-000000000301';

/** Lo que pinta el servidor: dos familias, la segunda con un producto con opciones. */
function pintarCarta() {
  document.body.innerHTML = `
    <nav>
      <ul>
        <li data-familia-enlace="f1"><a href="#f-f1">Entradas</a></li>
        <li data-familia-enlace="f2"><a href="#f-f2">Fondos</a></li>
      </ul>
    </nav>
    <section data-familia-id="f1" id="f-f1">
      <ul>
        <li data-producto-id="${A}">Causa</li>
        <li data-producto-id="${B}">Anticuchos</li>
      </ul>
    </section>
    <section data-familia-id="f2" id="f-f2">
      <ul>
        <li data-producto-id="${C}">Menú
          <span data-modificador-id="${OPCION}">Ensalada</span>
          <span data-modificador-id="otra">Causa</span>
        </li>
      </ul>
    </section>`;
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector) as HTMLElement;

describe('aplicarDisponibilidad', () => {
  beforeEach(pintarCarta);

  it('oculta el producto que ya no está en vendibles y deja los demás', () => {
    aplicarDisponibilidad(document, {
      vendibles: [
        { id: A, modificadoresNoDisponibles: [] },
        { id: C, modificadoresNoDisponibles: [] },
      ],
    });
    expect(q(`[data-producto-id="${B}"]`).hidden).toBe(true);
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(false);
    expect(q(`[data-producto-id="${C}"]`).hidden).toBe(false);
  });

  it('oculta los modificadores que no están disponibles y solo esos', () => {
    aplicarDisponibilidad(document, {
      vendibles: [
        { id: A, modificadoresNoDisponibles: [] },
        { id: B, modificadoresNoDisponibles: [] },
        { id: C, modificadoresNoDisponibles: [OPCION] },
      ],
    });
    expect(q(`[data-modificador-id="${OPCION}"]`).hidden).toBe(true);
    expect(q('[data-modificador-id="otra"]').hidden).toBe(false);
  });

  it('una familia sin productos visibles se oculta con su enlace de la fila fija', () => {
    aplicarDisponibilidad(document, { vendibles: [{ id: C, modificadoresNoDisponibles: [] }] });
    expect(q('[data-familia-id="f1"]').hidden).toBe(true);
    expect(q('[data-familia-enlace="f1"]').hidden).toBe(true);
    expect(q('[data-familia-id="f2"]').hidden).toBe(false);
    expect(q('[data-familia-enlace="f2"]').hidden).toBe(false);
  });

  it('lo que vuelve a estar disponible se muestra otra vez', () => {
    aplicarDisponibilidad(document, {
      vendibles: [{ id: C, modificadoresNoDisponibles: [OPCION] }],
    });
    aplicarDisponibilidad(document, {
      vendibles: [
        { id: A, modificadoresNoDisponibles: [] },
        { id: B, modificadoresNoDisponibles: [] },
        { id: C, modificadoresNoDisponibles: [] },
      ],
    });
    expect(document.querySelectorAll('[hidden]')).toHaveLength(0);
  });
});

describe('esDisponibilidad', () => {
  it('acepta la forma del contrato y rechaza lo demás', () => {
    expect(esDisponibilidad({ vendibles: [] })).toBe(true);
    expect(esDisponibilidad({ vendibles: [{ id: A, modificadoresNoDisponibles: [] }] })).toBe(true);
    expect(esDisponibilidad(null)).toBe(false);
    expect(esDisponibilidad({})).toBe(false);
    expect(esDisponibilidad({ vendibles: [{ id: A }] })).toBe(false);
    expect(esDisponibilidad({ vendibles: 'x' })).toBe(false);
  });
});

describe('isla Disponibilidad', () => {
  const URL_DISPONIBILIDAD = 'http://api.publica/publico/cartas/sabor/miraflores/disponibilidad';
  let visibilidad: DocumentVisibilityState;
  const fetchFalso = vi.fn<typeof fetch>();

  function respuesta(vendibles: string[], etag: string, estado = 200): Response {
    return new Response(
      estado === 304
        ? null
        : JSON.stringify({
            vendibles: vendibles.map((id) => ({ id, modificadoresNoDisponibles: [] })),
          }),
      { status: estado, headers: { ETag: etag, 'Content-Type': 'application/json' } },
    );
  }

  /** Deja pasar las promesas pendientes (la consulta termina en microtareas). */
  const asentar = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  const pasar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    pintarCarta();
    visibilidad = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilidad);
    fetchFalso.mockReset();
    vi.stubGlobal('fetch', fetchFalso);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('consulta al cargar y oculta lo agotado sin recargar', async () => {
    fetchFalso.mockResolvedValue(respuesta([A, C], '"e1"'));
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls[0]?.[0]).toBe(URL_DISPONIBILIDAD);
    expect(q(`[data-producto-id="${B}"]`).hidden).toBe(true);
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(false);
  });

  it('la primera consulta va sin If-None-Match y las siguientes llevan el ETag recibido', async () => {
    fetchFalso.mockResolvedValue(respuesta([A, B, C], '"e1"'));
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    const primera = new Headers(fetchFalso.mock.calls[0]?.[1]?.headers);
    expect(primera.has('If-None-Match')).toBe(false);

    fetchFalso.mockResolvedValue(respuesta([], '"e1"', 304));
    await pasar(15_000);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchFalso.mock.calls[1]?.[1]?.headers).get('If-None-Match')).toBe('"e1"');
    // Un 304 no cambia nada: todo sigue a la vista.
    expect(document.querySelectorAll('[hidden]')).toHaveLength(0);
  });

  it('cada 15 segundos y no antes', async () => {
    fetchFalso.mockResolvedValue(respuesta([A, B, C], '"e1"'));
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    await pasar(14_000);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    await pasar(1_000);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    await pasar(15_000);
    expect(fetchFalso).toHaveBeenCalledTimes(3);
  });

  it('un plato que se agota después desaparece en la consulta siguiente', async () => {
    fetchFalso.mockResolvedValue(respuesta([A, B, C], '"e1"'));
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(false);
    fetchFalso.mockResolvedValue(respuesta([B, C], '"e2"'));
    await pasar(15_000);
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(true);
  });

  it('con la pestaña oculta no consulta; al volver, consulta de una vez', async () => {
    fetchFalso.mockResolvedValue(respuesta([A, B, C], '"e1"'));
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    visibilidad = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await pasar(60_000);
    expect(fetchFalso).toHaveBeenCalledTimes(1);

    visibilidad = 'visible';
    fetchFalso.mockResolvedValue(respuesta([B, C], '"e2"'));
    document.dispatchEvent(new Event('visibilitychange'));
    await asentar();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(true);
  });

  it('abierta en una pestaña oculta no consulta hasta que se vea', async () => {
    visibilidad = 'hidden';
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await pasar(30_000);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sin red se queda con lo último y vuelve a intentar', async () => {
    fetchFalso.mockResolvedValue(respuesta([B, C], '"e1"'));
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(true);

    fetchFalso.mockRejectedValue(new TypeError('Failed to fetch'));
    await pasar(15_000);
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(true);

    fetchFalso.mockResolvedValue(respuesta([A, B, C], '"e2"'));
    await pasar(15_000);
    expect(q(`[data-producto-id="${A}"]`).hidden).toBe(false);
  });

  it('una respuesta rota o un error del servidor no cambian nada', async () => {
    fetchFalso.mockResolvedValueOnce(new Response('no es json', { status: 200 }));
    render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    fetchFalso.mockResolvedValue(new Response('{}', { status: 500 }));
    await pasar(15_000);
    expect(document.querySelectorAll('[hidden]')).toHaveLength(0);
  });

  it('al salir de la página deja de consultar', async () => {
    fetchFalso.mockResolvedValue(respuesta([A, B, C], '"e1"'));
    const { unmount } = render(<Disponibilidad empresa="sabor" sucursal="miraflores" />);
    await asentar();
    unmount();
    await pasar(60_000);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
