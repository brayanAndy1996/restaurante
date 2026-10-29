import type { MesaRespuesta, SesionRespuesta, ZonaRespuesta } from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';

// spec: 004-salon-cocina, criterios 1 a 6 y 88 en el dibujo (pruebas no protegidas del mapa de mesas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const Z_SALON = uuid(1);
const Z_TERRAZA = uuid(2);
const RUTA_ZONAS = `/sucursales/${ID.sucursalA}/zonas`;

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

const mesa = (
  n: number,
  nombre: string,
  columna: number,
  fila: number,
  extra: Partial<MesaRespuesta> = {},
): MesaRespuesta => ({
  id: uuid(100 + n),
  zonaId: Z_SALON,
  nombre,
  capacidad: 4,
  forma: 'CUADRADA',
  columna,
  fila,
  activa: true,
  ...extra,
});

const zona = (
  id: string,
  nombre: string,
  orden: number,
  mesas: MesaRespuesta[] = [],
  extra: Partial<ZonaRespuesta> = {},
): ZonaRespuesta => ({
  id,
  sucursalId: ID.sucursalA,
  nombre,
  orden,
  columnas: 4,
  filas: 3,
  activa: true,
  mesas,
  ...extra,
});

/**
 * API de mentira con memoria: guarda las zonas y aplica las escrituras como lo haría la real, para
 * recorrer varios pasos seguidos. `respuestas` deja a una prueba forzar el resultado de una ruta.
 */
function api(inicial: ZonaRespuesta[], respuestas: Record<string, Manejador> = {}) {
  let zonas = structuredClone(inicial);
  let siguiente = 500;
  const mesas = () => zonas.flatMap((z) => z.mesas);
  const s = servidor({
    'GET /sesion': () => json(200, administrador()),
    [`GET ${RUTA_ZONAS}`]: () => json(200, zonas),
    [`POST ${RUTA_ZONAS}`]: ({ cuerpo }) => {
      const c = cuerpo as { nombre: string; columnas: number; filas: number };
      const nueva = zona(uuid(siguiente++), c.nombre, zonas.length + 1, [], {
        columnas: c.columnas,
        filas: c.filas,
      });
      zonas = [...zonas, nueva];
      return json(201, nueva);
    },
    [`PUT ${RUTA_ZONAS}/orden`]: ({ cuerpo }) => {
      const ids = (cuerpo as { ids: string[] }).ids;
      zonas = ids.map((id, i) => ({ ...zonas.find((z) => z.id === id)!, orden: i + 1 }));
      return json(200, zonas);
    },
    ...Object.fromEntries(
      [Z_SALON, Z_TERRAZA, ...Array.from({ length: 10 }, (_, i) => uuid(500 + i))].flatMap((id) => [
        [
          `PATCH ${RUTA_ZONAS}/${id}`,
          ({ cuerpo }: { cuerpo: unknown }) => {
            zonas = zonas.map((z) => (z.id === id ? { ...z, ...(cuerpo as object) } : z));
            return json(
              200,
              zonas.find((z) => z.id === id),
            );
          },
        ],
        [
          `POST ${RUTA_ZONAS}/${id}/mesas`,
          ({ cuerpo }: { cuerpo: unknown }) => {
            const nueva: MesaRespuesta = {
              ...(cuerpo as Omit<MesaRespuesta, 'id' | 'zonaId' | 'activa'>),
              id: uuid(siguiente++),
              zonaId: id,
              activa: true,
            };
            zonas = zonas.map((z) => (z.id === id ? { ...z, mesas: [...z.mesas, nueva] } : z));
            return json(201, nueva);
          },
        ],
      ]),
    ),
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => uuid(101 + i)).map((id) => [
        `PATCH /sucursales/${ID.sucursalA}/mesas/${id}`,
        ({ cuerpo }: { cuerpo: unknown }) => {
          const actual = mesas().find((m) => m.id === id)!;
          const nueva = { ...actual, ...(cuerpo as object) };
          zonas = zonas.map((z) => ({
            ...z,
            mesas: z.mesas.map((m) => (m.id === id ? nueva : m)),
          }));
          return json(200, nueva);
        },
      ]),
    ),
    ...respuestas,
  });
  return { ...s, zonas: () => zonas };
}

const grilla = (nombre: string) => screen.getByRole('grid', { name: nombre });
const celda = (c: number, f: number) =>
  screen.getByRole('button', { name: `Celda libre, columna ${c}, fila ${f}` });
const botonMesa = (nombre: string) =>
  screen.getByRole('button', { name: new RegExp(`^Mesa ${nombre},`) });

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Ajustes › Mapa de mesas: ver (criterio 88 en el dibujo)', () => {
  it('"Ajustes" es un destino de la navegación y lleva a Usuarios; desde ahí se llega al mapa', async () => {
    api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1)])]);
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    const ajustes = within(nav).getByRole('link', { name: 'Ajustes' });
    expect(within(nav).queryByRole('link', { name: 'Usuarios' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Acceso' })).toBeNull();
    await userEvent.click(ajustes);
    expect(await screen.findByRole('heading', { name: 'Ajustes', level: 1 })).toBeInTheDocument();
    const secciones = screen.getByRole('group', { name: 'Secciones de Ajustes' });
    expect(within(secciones).getByRole('button', { name: 'Usuarios' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(secciones).getByRole('button', { name: 'Mapa de mesas' }));
    expect(await screen.findByRole('grid', { name: /Mesas de/ })).toBeInTheDocument();
    // El destino sigue activo en cualquier sección.
    expect(within(nav).getByRole('link', { name: 'Ajustes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('dibuja las mesas activas de la primera zona en su celda, con nombre, capacidad y forma', async () => {
    api([
      zona(Z_SALON, 'Salón principal', 1, [
        mesa(1, '1', 1, 1),
        mesa(2, '2', 3, 1, { capacidad: 2, forma: 'REDONDA' }),
        mesa(3, 'Vieja', 2, 2, { activa: false }),
      ]),
      zona(Z_TERRAZA, 'Terraza', 2),
    ]);
    renderApp('/administracion/mesas');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    const g = grilla('Mesas de Salón principal');
    expect(within(g).getAllByRole('gridcell')).toHaveLength(12);
    const filas = within(g).getAllByRole('row');
    expect(within(filas[0]!).getAllByRole('gridcell')[0]).toContainElement(botonMesa('1'));
    expect(within(filas[0]!).getAllByRole('gridcell')[2]).toContainElement(
      screen.getByRole('button', { name: 'Mesa 2, 2 personas, redonda' }),
    );
    // La desactivada no ocupa celda: está en su lista.
    expect(within(g).queryByRole('button', { name: /Vieja/ })).toBeNull();
    expect(celda(2, 2)).toBeInTheDocument();
    expect(screen.getByText('4 × 3 celdas · 2 mesas')).toBeInTheDocument();
    const desactivadas = screen.getByRole('list', { name: 'Mesas desactivadas' });
    expect(within(desactivadas).getByText('Vieja')).toBeInTheDocument();
    expect(within(desactivadas).getByText('Inactiva')).toBeInTheDocument();
  });

  it('cambia de zona con los segmentos y dice cuáles están inactivas', async () => {
    api([
      zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1)]),
      zona(Z_TERRAZA, 'Terraza', 2, [], { activa: false, columnas: 2, filas: 2 }),
    ]);
    renderApp('/administracion/mesas');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    const zonas = screen.getByRole('group', { name: 'Zonas del salón' });
    expect(within(zonas).getByRole('button', { name: 'Salón principal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(zonas).getByRole('button', { name: 'Terraza (inactiva)' }));
    expect(await screen.findByRole('grid', { name: 'Mesas de Terraza' })).toBeInTheDocument();
    expect(screen.getByText('Esta zona está inactiva')).toBeInTheDocument();
    expect(screen.getByText('2 × 2 celdas · 0 mesas · Zona inactiva')).toBeInTheDocument();
    // En una zona inactiva no se ofrece agregar mesas.
    expect(screen.queryByRole('button', { name: 'Agregar mesa' })).toBeNull();
  });

  it('sin zonas, dice qué falta y ofrece crear la primera', async () => {
    api([]);
    renderApp('/administracion/mesas');
    expect(await screen.findByText('Aún no hay zonas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar zona' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('si no puede cargar, dice el problema y deja reintentar', async () => {
    let falla = true;
    api([zona(Z_SALON, 'Salón principal', 1)], {
      [`GET ${RUTA_ZONAS}`]: () =>
        falla
          ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, [zona(Z_SALON, 'Salón principal', 1)]),
    });
    renderApp('/administracion/mesas');
    expect(await screen.findByText('No pudimos cargar el mapa de mesas')).toBeInTheDocument();
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('grid', { name: 'Mesas de Salón principal' }),
    ).toBeInTheDocument();
  });

  it('solo el Administrador entra: otro rol vuelve al inicio', async () => {
    servidor({
      'GET /sesion': () =>
        json(
          200,
          sesionDe({
            esAdministrador: false,
            rol: 'MOZO',
            permisos: permisosDeRol('MOZO'),
            sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol: 'MOZO' }],
          }),
        ),
    });
    renderApp('/administracion/mesas');
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Secciones de Ajustes' })).toBeNull();
  });
});

describe('Ajustes › Mapa de mesas: zonas (criterios 1, 2 y 6)', () => {
  it('crea la primera zona, valida cada campo y manda el cuerpo con clave de idempotencia', async () => {
    const s = api([]);
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar zona' }));
    const crear = screen.getByRole('button', { name: 'Crear zona' });

    await userEvent.clear(screen.getByLabelText('Columnas'));
    await userEvent.type(screen.getByLabelText('Columnas'), '1');
    await userEvent.clear(screen.getByLabelText('Filas'));
    await userEvent.type(screen.getByLabelText('Filas'), '31');
    await userEvent.click(crear);
    expect(screen.getByText('Escribe el nombre de la zona')).toBeInTheDocument();
    expect(screen.getByText('Escribe un número entero de 2 a 12')).toBeInTheDocument();
    expect(screen.getByText('Escribe un número entero de 1 a 30')).toBeInTheDocument();
    expect(s.de('POST', RUTA_ZONAS)).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Nombre de la zona'), '  Salón principal ');
    await userEvent.clear(screen.getByLabelText('Columnas'));
    await userEvent.type(screen.getByLabelText('Columnas'), '5');
    await userEvent.clear(screen.getByLabelText('Filas'));
    await userEvent.type(screen.getByLabelText('Filas'), '4');
    await userEvent.click(crear);

    expect(
      await screen.findByRole('grid', { name: 'Mesas de Salón principal' }),
    ).toBeInTheDocument();
    const llamada = s.de('POST', RUTA_ZONAS)[0];
    expect(llamada?.cuerpo).toEqual({ nombre: 'Salón principal', columnas: 5, filas: 4 });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(screen.getByText(/Zona Salón principal creada/)).toBeInTheDocument();
    expect(within(grilla('Mesas de Salón principal')).getAllByRole('gridcell')).toHaveLength(20);
  });

  it('un nombre repetido se dice en el campo, antes y después de enviar', async () => {
    api([zona(Z_SALON, 'Salón principal', 1)], {
      [`POST ${RUTA_ZONAS}`]: () =>
        json(409, {
          codigo: 'CONFLICTO',
          mensaje: 'x',
          campos: [{ campo: 'nombre', mensaje: 'Ya existe' }],
        }),
    });
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva zona' }));
    await userEvent.type(screen.getByLabelText('Nombre de la zona'), 'salón PRINCIPAL');
    await userEvent.click(screen.getByRole('button', { name: 'Crear zona' }));
    // Sin distinguir mayúsculas: ni siquiera sale la petición.
    expect(screen.getByText('Ya tienes una zona con ese nombre. Usa otro.')).toBeInTheDocument();
    // Otra empresa la creó justo antes: lo dice el servidor.
    await userEvent.clear(screen.getByLabelText('Nombre de la zona'));
    await userEvent.type(screen.getByLabelText('Nombre de la zona'), 'Barra');
    await userEvent.click(screen.getByRole('button', { name: 'Crear zona' }));
    expect(
      await screen.findByText('Ya tienes una zona con ese nombre. Usa otro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la zona')).toHaveValue('Barra');
  });

  it('edita el nombre y el tamaño: manda solo lo que cambió', async () => {
    const s = api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1)])]);
    renderApp('/administracion/mesas');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar la zona Salón principal' }),
    );
    expect(screen.getByLabelText('Nombre de la zona')).toHaveValue('Salón principal');
    expect(screen.getByLabelText('Columnas')).toHaveValue('4');
    await userEvent.clear(screen.getByLabelText('Columnas'));
    await userEvent.type(screen.getByLabelText('Columnas'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar zona' }));
    await waitFor(() => expect(s.de('PATCH', `${RUTA_ZONAS}/${Z_SALON}`)).toHaveLength(1));
    expect(s.de('PATCH', `${RUTA_ZONAS}/${Z_SALON}`)[0]?.cuerpo).toEqual({ columnas: 6 });
    expect(await screen.findByText('6 × 3 celdas · 1 mesa')).toBeInTheDocument();
  });

  it('achicar la cuadrícula dejando mesas afuera lo explica y no envía nada', async () => {
    const s = api([
      zona(Z_SALON, 'Salón principal', 1, [
        mesa(1, '1', 1, 1),
        mesa(2, '7', 4, 1),
        mesa(3, '8', 3, 3),
      ]),
    ]);
    renderApp('/administracion/mesas');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar la zona Salón principal' }),
    );
    await userEvent.clear(screen.getByLabelText('Columnas'));
    await userEvent.type(screen.getByLabelText('Columnas'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar zona' }));
    expect(
      screen.getByText('Quedarían fuera las mesas 7 y 8. Muévelas antes de achicar la cuadrícula.'),
    ).toBeInTheDocument();
    expect(s.de('PATCH', `${RUTA_ZONAS}/${Z_SALON}`)).toHaveLength(0);
  });

  it('el aviso del servidor al achicar (409) se muestra tal cual en el campo', async () => {
    api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1)])], {
      [`PATCH ${RUTA_ZONAS}/${Z_SALON}`]: () =>
        json(409, {
          codigo: 'CONFLICTO',
          mensaje: 'La mesa 5 quedaría fuera de la cuadrícula.',
          campos: [{ campo: 'filas', mensaje: 'x' }],
        }),
    });
    renderApp('/administracion/mesas');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar la zona Salón principal' }),
    );
    await userEvent.clear(screen.getByLabelText('Filas'));
    await userEvent.type(screen.getByLabelText('Filas'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar zona' }));
    expect(
      await screen.findByText('La mesa 5 quedaría fuera de la cuadrícula.'),
    ).toBeInTheDocument();
  });

  it('desactivar una zona con mesas activas está apagado y dice por qué; sin mesas, la desactiva', async () => {
    const s = api([
      zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1)]),
      zona(Z_TERRAZA, 'Terraza', 2),
    ]);
    renderApp('/administracion/mesas');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar la zona Salón principal' }),
    );
    expect(screen.getByRole('button', { name: 'Desactivar zona' })).toBeDisabled();
    expect(screen.getByText(/Tiene 1 mesa activa\. Desactívala o pásala/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await userEvent.click(screen.getByRole('button', { name: 'Terraza' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar la zona Terraza' }));
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar zona' }));
    await waitFor(() =>
      expect(s.de('PATCH', `${RUTA_ZONAS}/${Z_TERRAZA}`)[0]?.cuerpo).toEqual({ activa: false }),
    );
    expect(await screen.findByText('Zona Terraza desactivada.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terraza (inactiva)' })).toBeInTheDocument();
  });

  it('ordena las zonas con subir y bajar y guarda el orden', async () => {
    const s = api([zona(Z_SALON, 'Salón principal', 1), zona(Z_TERRAZA, 'Terraza', 2)]);
    renderApp('/administracion/mesas');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar la zona Salón principal' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar las zonas' }));
    const guardar = screen.getByRole('button', { name: 'Guardar orden' });
    expect(guardar).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Subir Terraza' }));
    expect(guardar).toBeEnabled();
    await userEvent.click(guardar);
    await waitFor(() => expect(s.de('PUT', `${RUTA_ZONAS}/orden`)).toHaveLength(1));
    expect(s.de('PUT', `${RUTA_ZONAS}/orden`)[0]?.cuerpo).toEqual({ ids: [Z_TERRAZA, Z_SALON] });
    expect(await screen.findByText('Orden de las zonas guardado.')).toBeInTheDocument();
    const segmentos = screen.getByRole('group', { name: 'Zonas del salón' });
    expect(
      within(segmentos)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Terraza', 'Salón principal', 'Nueva zona']);
  });
});

describe('Ajustes › Mapa de mesas: mesas (criterios 3, 4 y 6)', () => {
  it('tocar una celda libre abre el formulario con el nombre siguiente y crea la mesa ahí', async () => {
    const s = api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1), mesa(2, '2', 2, 1)])]);
    renderApp('/administracion/mesas');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(celda(3, 2));
    expect(celda(3, 2)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Nueva mesa' })).toBeInTheDocument();
    expect(screen.getByText('Columna 3, fila 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la mesa')).toHaveValue('3');
    expect(screen.getByLabelText('Nombre de la mesa')).toHaveFocus();
    expect(screen.getByLabelText('Capacidad (personas)')).toHaveValue('4');
    expect(screen.getByRole('button', { name: 'Cuadrada' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.clear(screen.getByLabelText('Capacidad (personas)'));
    await userEvent.type(screen.getByLabelText('Capacidad (personas)'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Redonda' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear mesa' }));

    expect(
      await screen.findByRole('button', { name: 'Mesa 3, 6 personas, redonda' }),
    ).toBeInTheDocument();
    const llamada = s.de('POST', `${RUTA_ZONAS}/${Z_SALON}/mesas`)[0];
    expect(llamada?.cuerpo).toEqual({
      nombre: '3',
      capacidad: 6,
      forma: 'REDONDA',
      columna: 3,
      fila: 2,
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(screen.getByText('Mesa 3 creada.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nueva mesa' })).toBeNull();
  });

  it('"Agregar mesa" elige la primera celda libre', async () => {
    api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1), mesa(2, '2', 2, 1)])]);
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar mesa' }));
    expect(screen.getByText('Columna 3, fila 1')).toBeInTheDocument();
    expect(celda(3, 1)).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: 'Nueva mesa' })).toBeNull();
  });

  it('con la cuadrícula llena no ofrece agregar mesas', async () => {
    api([
      zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1), mesa(2, '2', 2, 1)], {
        columnas: 2,
        filas: 1,
      }),
    ]);
    renderApp('/administracion/mesas');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    expect(screen.queryByRole('button', { name: 'Agregar mesa' })).toBeNull();
  });

  it('valida nombre, capacidad y nombre repetido sin enviar nada', async () => {
    const s = api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, 'Terraza 1', 1, 1)])]);
    renderApp('/administracion/mesas');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(celda(2, 1));
    await userEvent.clear(screen.getByLabelText('Nombre de la mesa'));
    await userEvent.clear(screen.getByLabelText('Capacidad (personas)'));
    await userEvent.type(screen.getByLabelText('Capacidad (personas)'), '51');
    await userEvent.click(screen.getByRole('button', { name: 'Crear mesa' }));
    expect(screen.getByText('Escribe el nombre de la mesa')).toBeInTheDocument();
    expect(screen.getByText('Escribe un número entero de 1 a 50')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Nombre de la mesa'), 'TERRAZA 1');
    await userEvent.clear(screen.getByLabelText('Capacidad (personas)'));
    await userEvent.type(screen.getByLabelText('Capacidad (personas)'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Crear mesa' }));
    expect(
      screen.getByText('Ya hay una mesa con ese nombre en esta sucursal. Usa otro.'),
    ).toBeInTheDocument();
    expect(s.de('POST', `${RUTA_ZONAS}/${Z_SALON}/mesas`)).toHaveLength(0);
  });

  it('si otra persona ocupó la celda (409), lo dice y conserva lo escrito', async () => {
    api([zona(Z_SALON, 'Salón principal', 1)], {
      [`POST ${RUTA_ZONAS}/${Z_SALON}/mesas`]: () =>
        json(409, {
          codigo: 'CONFLICTO',
          mensaje: 'x',
          campos: [
            { campo: 'columna', mensaje: 'x' },
            { campo: 'fila', mensaje: 'x' },
          ],
        }),
    });
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar mesa' }));
    await userEvent.clear(screen.getByLabelText('Capacidad (personas)'));
    await userEvent.type(screen.getByLabelText('Capacidad (personas)'), '8');
    await userEvent.click(screen.getByRole('button', { name: 'Crear mesa' }));
    expect(await screen.findByText('Esa celda no está libre')).toBeInTheDocument();
    expect(screen.getByLabelText('Capacidad (personas)')).toHaveValue('8');
  });

  it('seleccionar una mesa muestra sus datos; Guardar espera un cambio y manda solo lo que cambió', async () => {
    const s = api([
      zona(Z_SALON, 'Salón principal', 1, [
        mesa(1, '1', 1, 1),
        mesa(2, '2', 2, 1, { capacidad: 2 }),
      ]),
    ]);
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: /^Mesa 2,/ }));
    expect(screen.getByRole('heading', { name: 'Mesa 2' })).toBeInTheDocument();
    expect(botonMesa('2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Nombre de la mesa')).toHaveValue('2');
    expect(screen.getByLabelText('Capacidad (personas)')).toHaveValue('2');
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('Capacidad (personas)'));
    await userEvent.type(screen.getByLabelText('Capacidad (personas)'), '10');
    expect(guardar).toBeEnabled();
    // El dibujo ya refleja el cambio mientras se escribe.
    expect(screen.getByRole('button', { name: /^Mesa 2, 10 personas/ })).toBeInTheDocument();
    await userEvent.click(guardar);
    await waitFor(() =>
      expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/mesas/${uuid(102)}`)).toHaveLength(1),
    );
    expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/mesas/${uuid(102)}`)[0]?.cuerpo).toEqual({
      capacidad: 10,
    });
    expect(await screen.findByText('Cambios de la mesa 2 guardados.')).toBeInTheDocument();
  });

  it('las flechas mueven la mesa de a una celda; un borde u otra mesa lo dicen y no se mueve', async () => {
    const s = api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1), mesa(2, '2', 2, 1)])]);
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: /^Mesa 1,/ }));
    const flecha = (n: string) => screen.getByRole('button', { name: n });

    await userEvent.click(flecha('Mover una celda a la izquierda'));
    expect(screen.getByText('Ya está en el borde de la cuadrícula.')).toBeInTheDocument();
    await userEvent.click(flecha('Mover una celda hacia arriba'));
    expect(screen.getByText('Ya está en el borde de la cuadrícula.')).toBeInTheDocument();
    await userEvent.click(flecha('Mover una celda a la derecha'));
    expect(
      screen.getByText('Ahí está la mesa 2. Elige otra dirección o mueve esa mesa primero.'),
    ).toBeInTheDocument();
    // Nada cambió: Guardar sigue apagado.
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    await userEvent.click(flecha('Mover una celda hacia abajo'));
    expect(screen.getByText('Ahora está en la columna 1, fila 2.')).toBeInTheDocument();
    expect(screen.getByText('Columna 1, fila 2')).toBeInTheDocument();
    await userEvent.click(flecha('Mover una celda a la derecha'));
    await userEvent.click(flecha('Mover una celda a la derecha'));
    expect(screen.getByText('Columna 3, fila 2')).toBeInTheDocument();
    // En el dibujo la mesa ya está en su nueva celda, antes de guardar.
    const g = grilla('Mesas de Salón principal');
    expect(within(within(g).getAllByRole('row')[1]!).getAllByRole('gridcell')[2]).toContainElement(
      botonMesa('1'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/mesas/${uuid(101)}`)).toHaveLength(1),
    );
    expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/mesas/${uuid(101)}`)[0]?.cuerpo).toEqual({
      columna: 3,
      fila: 2,
    });
  });

  it('Cancelar descarta el movimiento y la mesa vuelve a su celda', async () => {
    api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1)])]);
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: /^Mesa 1,/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Mover una celda hacia abajo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const g = grilla('Mesas de Salón principal');
    expect(within(within(g).getAllByRole('row')[0]!).getAllByRole('gridcell')[0]).toContainElement(
      botonMesa('1'),
    );
    expect(screen.queryByRole('heading', { name: 'Mesa 1' })).toBeNull();
  });

  it('desactivar una mesa la saca del dibujo y la deja en la lista de desactivadas', async () => {
    const s = api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1), mesa(2, '2', 2, 1)])]);
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: /^Mesa 2,/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar mesa' }));
    await waitFor(() =>
      expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/mesas/${uuid(102)}`)[0]?.cuerpo).toEqual({
        activa: false,
      }),
    );
    expect(await screen.findByText(/Mesa 2 desactivada/)).toBeInTheDocument();
    expect(
      within(grilla('Mesas de Salón principal')).queryByRole('button', { name: /^Mesa 2,/ }),
    ).toBeNull();
    expect(celda(2, 1)).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Mesas desactivadas' })).getByText('2'),
    ).toBeInTheDocument();
  });

  it('una mesa con cuenta abierta no se puede desactivar (EN_USO) y lo explica', async () => {
    api([zona(Z_SALON, 'Salón principal', 1, [mesa(1, '1', 1, 1)])], {
      [`PATCH /sucursales/${ID.sucursalA}/mesas/${uuid(101)}`]: () =>
        json(409, { codigo: 'EN_USO', mensaje: 'x' }),
    });
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: /^Mesa 1,/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar mesa' }));
    expect(
      await screen.findByText(
        'Esta mesa tiene una cuenta abierta. Ciérrala o libera la mesa antes de desactivarla.',
      ),
    ).toBeInTheDocument();
    expect(botonMesa('1')).toBeInTheDocument();
  });

  it('reactivar una mesa la devuelve a su celda; si la ocupó otra, a la primera libre', async () => {
    const s = api([
      zona(Z_SALON, 'Salón principal', 1, [
        mesa(1, '1', 1, 1),
        mesa(2, 'Vieja', 2, 1, { activa: false }),
        mesa(3, 'Antigua', 1, 1, { activa: false }),
      ]),
    ]);
    renderApp('/administracion/mesas');
    await screen.findByRole('list', { name: 'Mesas desactivadas' });
    await userEvent.click(screen.getByRole('button', { name: 'Reactivar la mesa Vieja' }));
    await waitFor(() =>
      expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/mesas/${uuid(102)}`)[0]?.cuerpo).toEqual({
        activa: true,
      }),
    );
    expect(await screen.findByText('Mesa Vieja reactivada.')).toBeInTheDocument();

    // La celda de "Antigua" (columna 1, fila 1) la tiene la mesa 1: vuelve en la primera libre.
    await userEvent.click(screen.getByRole('button', { name: 'Reactivar la mesa Antigua' }));
    await waitFor(() =>
      expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/mesas/${uuid(103)}`)[0]?.cuerpo).toEqual({
        activa: true,
        columna: 3,
        fila: 1,
      }),
    );
    expect(
      await screen.findByText(
        /Mesa Antigua reactivada en la columna 3, fila 1, porque su celda ya estaba ocupada/,
      ),
    ).toBeInTheDocument();
  });

  it('no reactiva una mesa cuyo nombre ya usa otra activa y lo dice', async () => {
    const s = api([
      zona(Z_SALON, 'Salón principal', 1, [
        mesa(1, '5', 1, 1),
        mesa(2, '5', 2, 1, { activa: false }),
      ]),
    ]);
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivar la mesa 5' }));
    expect(screen.getByText(/Ya hay otra mesa activa con el nombre 5/)).toBeInTheDocument();
    expect(s.llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(0);
  });

  it('sin red, crear una mesa queda "Pendiente de envío" y sale una sola vez con la misma clave', async () => {
    let sinRed = true;
    let esperas = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++esperas === 7) await compuerta;
    });
    const s = api([zona(Z_SALON, 'Salón principal', 1)], {
      [`POST ${RUTA_ZONAS}/${Z_SALON}/mesas`]: ({ cuerpo }) => {
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(201, { ...(cuerpo as object), id: uuid(900), zonaId: Z_SALON, activa: true });
      },
    });
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar mesa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear mesa' }));
    expect((await screen.findAllByText('Pendiente de envío'))[0]).toBeInTheDocument();
    // Lo escrito sigue ahí mientras espera.
    expect(screen.getByLabelText('Nombre de la mesa')).toHaveValue('1');
    sinRed = false;
    liberar();
    expect(await screen.findByText('Mesa 1 creada.')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente de envío')).not.toBeInTheDocument();
    const claves = s
      .de('POST', `${RUTA_ZONAS}/${Z_SALON}/mesas`)
      .map((l) => l.cabeceras.get('Idempotency-Key'));
    expect(claves.length).toBeGreaterThan(1);
    expect(new Set(claves).size).toBe(1);
  });
});
