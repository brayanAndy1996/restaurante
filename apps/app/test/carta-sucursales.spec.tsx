import type {
  AjusteSucursalRespuesta,
  ProductoRespuesta,
  SesionRespuesta,
} from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const FAM = 'f1000000-0000-4000-8000-000000000001';
const EST = 'e1000000-0000-4000-8000-000000000001';
const P_CEVICHE = 'a1000000-0000-4000-8000-000000000001';
const P_AJI = 'a4000000-0000-4000-8000-000000000004';
const INSTANTE = '2026-10-29T10:00:00.000Z';
const RUTA = `/carta/productos/${P_CEVICHE}`;
const RUTA_SUCURSALES = `${RUTA}/sucursales`;
const RUTA_A = `${RUTA_SUCURSALES}/${ID.sucursalA}`;
const RUTA_B = `${RUTA_SUCURSALES}/${ID.sucursalB}`;

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

const cajero = (): SesionRespuesta =>
  sesionDe({
    esAdministrador: false,
    rol: 'CAJERO',
    permisos: permisosDeRol('CAJERO'),
    sucursales: [
      { id: ID.sucursalA, nombre: 'Miraflores', rol: 'CAJERO' },
      { id: ID.sucursalB, nombre: 'Surco', rol: 'MOZO' },
    ],
  });

const ceviche = (extra: Partial<ProductoRespuesta> = {}): ProductoRespuesta => ({
  id: P_CEVICHE,
  tipo: 'SIMPLE',
  nombre: 'Ceviche mixto',
  familiaId: FAM,
  precio: '25.00',
  seVendeSolo: true,
  estacionId: EST,
  tipoControlStock: 'PORCIONES',
  fotoUrl: null,
  activo: true,
  orden: 1,
  descripcion: null,
  afectacionIgv: 'GRAVADO',
  aplicaIcbper: false,
  grupos: [],
  componentes: [],
  usadoEn: { combos: [], modificadores: [] },
  creadoEn: INSTANTE,
  actualizadoEn: INSTANTE,
  ...extra,
});

const fila = (
  sucursalId: string,
  nombre: string,
  extra: Partial<AjusteSucursalRespuesta> = {},
): AjusteSucursalRespuesta => ({
  sucursalId,
  nombre,
  precio: null,
  precioEfectivo: '25.00',
  disponible: true,
  agotado: false,
  editable: true,
  ...extra,
});

const MIRAFLORES = fila(ID.sucursalA, 'Miraflores');
const SURCO = fila(ID.sucursalB, 'Surco');

function carta(
  sesion: SesionRespuesta,
  extra: Parameters<typeof servidor>[0] = {},
  producto: ProductoRespuesta = ceviche(),
) {
  return servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /carta/familias': () =>
      json(200, [
        {
          id: FAM,
          nombre: 'Entradas',
          orden: 1,
          activa: true,
          productos: 1,
          creadoEn: INSTANTE,
          actualizadoEn: INSTANTE,
        },
      ]),
    'GET /carta/estaciones': () =>
      json(200, [
        {
          id: EST,
          nombre: 'Cocina',
          activa: true,
          productosActivos: 1,
          creadoEn: INSTANTE,
          actualizadoEn: INSTANTE,
        },
      ]),
    [`GET /carta/productos/${producto.id}`]: () => json(200, producto),
    // El formulario del producto lee los grupos de modificadores (003, C3); su prueba está en carta-grupos.
    'GET /carta/grupos-modificadores': () => json(200, []),
    ...extra,
  });
}

/** La `<li>` de una sucursal, por su nombre. */
async function filaDe(nombre: string): Promise<HTMLElement> {
  const titulo = await screen.findByRole('heading', { name: nombre, level: 3 });
  const li = titulo.closest('li');
  if (!li) throw new Error(`No hay fila para ${nombre}`);
  return li;
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('precio por sucursal: lectura', () => {
  it('muestra un esqueleto y luego una fila por sucursal con su precio efectivo y su origen', async () => {
    carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () =>
        json(200, [
          fila(ID.sucursalA, 'Miraflores', { precio: '27.50', precioEfectivo: '27.50' }),
          SURCO,
        ]),
    });
    renderApp(RUTA);
    expect(await screen.findByRole('status', { name: 'Cargando sucursales' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Precio por sucursal' })).toBeInTheDocument();
    expect(
      screen.getByText(/Sin precio propio, se usa el de la empresa \(S\/ 25\.00\)/),
    ).toBeInTheDocument();

    const miraflores = await filaDe('Miraflores');
    expect(within(miraflores).getByText('S/ 27.50')).toBeInTheDocument();
    expect(
      within(miraflores).getByText(/Precio propio\. La empresa cobra S\/ 25\.00/),
    ).toBeInTheDocument();
    expect(within(miraflores).getByLabelText('Precio propio en Miraflores')).toHaveValue('27.50');

    const surco = await filaDe('Surco');
    expect(within(surco).getByText('S/ 25.00')).toBeInTheDocument();
    expect(within(surco).getByText('Es el precio de la empresa.')).toBeInTheDocument();
    expect(within(surco).getByLabelText('Precio propio en Surco')).toHaveValue('');
    expect(within(surco).getByLabelText('Precio propio en Surco')).toHaveAttribute(
      'placeholder',
      '25.00',
    );
  });

  it('marca "Agotado" con texto y deja el interruptor en su estado guardado', async () => {
    carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () =>
        json(200, [fila(ID.sucursalA, 'Miraflores', { agotado: true })]),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    expect(within(miraflores).getByText('Agotado')).toBeInTheDocument();
    expect(
      within(miraflores).getByRole('switch', { name: 'Disponible en Miraflores' }),
    ).toBeChecked();
  });

  it('las filas con editable: false son solo de lectura y dicen por qué', async () => {
    carta(cajero(), {
      [`GET ${RUTA_SUCURSALES}`]: () =>
        json(200, [
          MIRAFLORES,
          fila(ID.sucursalB, 'Surco', {
            editable: false,
            disponible: false,
            precio: '30.00',
            precioEfectivo: '30.00',
          }),
        ]),
    });
    renderApp(RUTA);
    const surco = await filaDe('Surco');
    expect(
      within(surco).getByText('Solo la cambia el Administrador o un Cajero de esta sucursal.'),
    ).toBeInTheDocument();
    expect(within(surco).getByText('No disponible')).toBeInTheDocument();
    expect(within(surco).getByText('S/ 30.00')).toBeInTheDocument();
    expect(within(surco).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(surco).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(surco).queryByRole('button')).not.toBeInTheDocument();
    // La sucursal donde sí es Cajero se puede cambiar.
    const miraflores = await filaDe('Miraflores');
    expect(
      within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }),
    ).toBeInTheDocument();
    expect(within(miraflores).queryByText(/Solo la cambia/)).not.toBeInTheDocument();
  });

  it('si no se vende solo, no hay precio: solo la disponibilidad, y se envía precio null', async () => {
    const aji = ceviche({ id: P_AJI, nombre: 'Ají de gallina', seVendeSolo: false, precio: null });
    const rutaAji = `/carta/productos/${P_AJI}/sucursales`;
    const s = carta(
      administrador(),
      {
        [`GET ${rutaAji}`]: () =>
          json(200, [fila(ID.sucursalA, 'Miraflores', { precioEfectivo: null })]),
        [`PUT ${rutaAji}/${ID.sucursalA}`]: ({ cuerpo }) =>
          json(200, {
            ...fila(ID.sucursalA, 'Miraflores', { precioEfectivo: null }),
            disponible: (cuerpo as { disponible: boolean }).disponible,
          }),
      },
      aji,
    );
    renderApp(`/carta/productos/${P_AJI}`);
    const miraflores = await filaDe('Miraflores');
    expect(screen.getByText(/no se vende solo, así que no lleva precio/)).toBeInTheDocument();
    expect(within(miraflores).queryByLabelText(/Precio propio/)).not.toBeInTheDocument();
    await userEvent.click(within(miraflores).getByRole('switch'));
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    await waitFor(() => expect(s.de('PUT', `${rutaAji}/${ID.sucursalA}`)).toHaveLength(1));
    expect(s.de('PUT', `${rutaAji}/${ID.sucursalA}`)[0]?.cuerpo).toEqual({
      precio: null,
      disponible: false,
    });
  });
});

describe('precio por sucursal: guardar una fila', () => {
  it('guarda solo esa fila con su clave de idempotencia y muestra el precio efectivo nuevo', async () => {
    const s = carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [MIRAFLORES, SURCO]),
      [`PUT ${RUTA_A}`]: ({ cuerpo }) =>
        json(200, {
          ...MIRAFLORES,
          precio: (cuerpo as { precio: string }).precio,
          precioEfectivo: (cuerpo as { precio: string }).precio,
          disponible: (cuerpo as { disponible: boolean }).disponible,
        }),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    const guardar = within(miraflores).getByRole('button', { name: 'Guardar Miraflores' });
    expect(guardar).toBeDisabled();

    await userEvent.type(within(miraflores).getByLabelText('Precio propio en Miraflores'), '27.5');
    await userEvent.click(within(miraflores).getByRole('switch'));
    expect(guardar).toBeEnabled();
    await userEvent.click(guardar);

    await waitFor(() => expect(within(miraflores).getByText('Guardado')).toBeInTheDocument());
    expect(s.de('PUT', RUTA_A)).toHaveLength(1);
    expect(s.de('PUT', RUTA_B)).toHaveLength(0);
    const llamada = s.de('PUT', RUTA_A)[0];
    expect(llamada?.cuerpo).toEqual({ precio: '27.50', disponible: false });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
    // El campo se completa a 2 decimales, el precio efectivo se actualiza y ya no hay cambios por guardar.
    expect(within(miraflores).getByLabelText('Precio propio en Miraflores')).toHaveValue('27.50');
    expect(within(miraflores).getByText('S/ 27.50')).toBeInTheDocument();
    expect(guardar).toBeDisabled();
    // La otra sucursal sigue igual.
    const surco = await filaDe('Surco');
    expect(within(surco).getByText('S/ 25.00')).toBeInTheDocument();
    expect(within(surco).getByRole('switch', { name: 'Disponible en Surco' })).toBeChecked();
  });

  it('con el campo vacío envía precio null (usa el de la empresa)', async () => {
    const propio = fila(ID.sucursalA, 'Miraflores', { precio: '27.50', precioEfectivo: '27.50' });
    const s = carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [propio]),
      [`PUT ${RUTA_A}`]: () => json(200, MIRAFLORES),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    await userEvent.clear(within(miraflores).getByLabelText('Precio propio en Miraflores'));
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    await waitFor(() => expect(s.de('PUT', RUTA_A)).toHaveLength(1));
    expect(s.de('PUT', RUTA_A)[0]?.cuerpo).toEqual({ precio: null, disponible: true });
    expect(await within(miraflores).findByText('S/ 25.00')).toBeInTheDocument();
    expect(within(miraflores).getByText('Es el precio de la empresa.')).toBeInTheDocument();
  });

  it('un precio de 0 no se envía y dice qué escribir', async () => {
    const s = carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [MIRAFLORES]),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    await userEvent.type(within(miraflores).getByLabelText('Precio propio en Miraflores'), '0');
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    expect(
      await within(miraflores).findByText(/Escribe un precio mayor que 0, o déjalo vacío/),
    ).toBeInTheDocument();
    expect(s.de('PUT', RUTA_A)).toHaveLength(0);
    // Al corregirlo, el error desaparece.
    await userEvent.type(within(miraflores).getByLabelText('Precio propio en Miraflores'), '5');
    expect(within(miraflores).queryByText(/Escribe un precio mayor que 0/)).not.toBeInTheDocument();
  });

  it('un 403 explica por qué, relee las filas y deja la sucursal solo para leer', async () => {
    let lecturas = 0;
    const s = carta(cajero(), {
      [`GET ${RUTA_SUCURSALES}`]: () =>
        json(
          200,
          lecturas++ === 0 ? [MIRAFLORES, SURCO] : [{ ...MIRAFLORES, editable: false }, SURCO],
        ),
      [`PUT ${RUTA_A}`]: () => json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    await userEvent.type(within(miraflores).getByLabelText('Precio propio en Miraflores'), '30');
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    expect(
      await screen.findByText(
        /Solo puedes cambiar el precio y la disponibilidad en las sucursales donde eres Cajero/,
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(s.de('GET', RUTA_SUCURSALES).length).toBeGreaterThan(1));
    // Ya relevida: la fila pasa a solo lectura con su nota.
    await waitFor(async () =>
      expect(
        within(await filaDe('Miraflores')).getByText(/Solo la cambia el Administrador o un Cajero/),
      ).toBeInTheDocument(),
    );
  });

  it('el error de una fila no toca a las demás', async () => {
    carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [MIRAFLORES, SURCO]),
      [`PUT ${RUTA_A}`]: () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
      [`PUT ${RUTA_B}`]: () => json(200, { ...SURCO, disponible: false }),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    const surco = await filaDe('Surco');
    await userEvent.click(within(miraflores).getByRole('switch'));
    await userEvent.click(within(surco).getByRole('switch'));
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    expect(
      await within(miraflores).findByText('No pudimos guardar Miraflores'),
    ).toBeInTheDocument();
    expect(within(surco).queryByText(/No pudimos guardar/)).not.toBeInTheDocument();
    await userEvent.click(within(surco).getByRole('button', { name: 'Guardar Surco' }));
    expect(await within(surco).findByText('Guardado')).toBeInTheDocument();
    // Lo que no se pudo guardar se conserva para intentarlo otra vez.
    expect(
      within(miraflores).getByRole('switch', { name: 'Disponible en Miraflores' }),
    ).not.toBeChecked();
  });

  it('ante un corte reintenta con la misma clave de idempotencia y no repite el efecto', async () => {
    let intentos = 0;
    const s = carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [MIRAFLORES]),
      [`PUT ${RUTA_A}`]: () =>
        ++intentos < 3
          ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, { ...MIRAFLORES, disponible: false }),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    await userEvent.click(within(miraflores).getByRole('switch'));
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    expect(await within(miraflores).findByText('Guardado')).toBeInTheDocument();
    const puts = s.de('PUT', RUTA_A);
    expect(puts).toHaveLength(3);
    const claves = new Set(puts.map((p) => p.cabeceras.get('Idempotency-Key')));
    expect(claves.size).toBe(1);
  });

  it('sin conexión dice que lo escrito sigue ahí y deja volver a guardar', async () => {
    let sinRed = true;
    const s = carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [MIRAFLORES]),
      [`PUT ${RUTA_A}`]: () => {
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(200, { ...MIRAFLORES, precio: '31.00', precioEfectivo: '31.00' });
      },
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    await userEvent.type(within(miraflores).getByLabelText('Precio propio en Miraflores'), '31');
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    expect(
      await within(miraflores).findByText(/No hay conexión con el servidor/),
    ).toBeInTheDocument();
    expect(within(miraflores).getByLabelText('Precio propio en Miraflores')).toHaveValue('31.00');
    sinRed = false;
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    expect(await within(miraflores).findByText('Guardado')).toBeInTheDocument();
    expect(within(miraflores).queryByText(/No hay conexión/)).not.toBeInTheDocument();
    expect(s.de('PUT', RUTA_A).length).toBeGreaterThan(1);
  });

  it('si la red tarda más que los reintentos la fila queda "Pendiente de envío" y sale sola con la misma clave', async () => {
    let sinRed = true;
    let esperas = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++esperas === 7) await compuerta;
    });
    const s = carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [MIRAFLORES, SURCO]),
      [`PUT ${RUTA_A}`]: () => {
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(200, { ...MIRAFLORES, precio: '31.00', precioEfectivo: '31.00' });
      },
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    await userEvent.type(within(miraflores).getByLabelText('Precio propio en Miraflores'), '31');
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    // Solo la fila que se está guardando lo dice; la otra sigue como estaba.
    expect(await within(miraflores).findByText('Pendiente de envío')).toBeInTheDocument();
    expect(within(await filaDe('Surco')).queryByText('Pendiente de envío')).not.toBeInTheDocument();
    expect(within(miraflores).getByLabelText('Precio propio en Miraflores')).toHaveValue('31.00');
    sinRed = false;
    liberar();
    expect(await within(miraflores).findByText('Guardado')).toBeInTheDocument();
    expect(within(miraflores).queryByText('Pendiente de envío')).not.toBeInTheDocument();
    expect(new Set(s.de('PUT', RUTA_A).map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
  });

  it('un 400 sobre el precio lo marca en el campo', async () => {
    carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [MIRAFLORES]),
      [`PUT ${RUTA_A}`]: () =>
        json(400, {
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'x',
          campos: [{ campo: 'precio', mensaje: 'Too small' }],
        }),
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    await userEvent.type(within(miraflores).getByLabelText('Precio propio en Miraflores'), '5');
    await userEvent.click(within(miraflores).getByRole('button', { name: 'Guardar Miraflores' }));
    expect(
      await within(miraflores).findAllByText(/Escribe un precio mayor que 0/),
    ).not.toHaveLength(0);
    expect(within(miraflores).getByLabelText('Precio propio en Miraflores')).toBeInvalid();
  });
});

describe('precio por sucursal: carga y errores', () => {
  it('si falla la carga, lo dice y deja reintentar', async () => {
    let falla = true;
    const s = carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () =>
        falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, [MIRAFLORES]),
    });
    renderApp(RUTA);
    expect(await screen.findByText('No pudimos cargar las sucursales')).toBeInTheDocument();
    // El resto del producto se puede usar.
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await filaDe('Miraflores');
    expect(s.de('GET', RUTA_SUCURSALES).length).toBeGreaterThan(1);
  });

  it('sin conexión al cargar, el título dice "Sin conexión"', async () => {
    carta(administrador(), {
      [`GET ${RUTA_SUCURSALES}`]: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp(RUTA);
    const aviso = (await screen.findByText(/No hay conexión con el servidor/)).closest(
      '[role="alert"]',
    );
    expect(aviso).toHaveTextContent('Sin conexión');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('al guardar los cambios del producto vuelve a leer los precios efectivos', async () => {
    let precio = '25.00';
    const s = carta(administrador(), {
      [`GET ${RUTA}`]: () => json(200, ceviche({ precio })),
      [`GET ${RUTA_SUCURSALES}`]: () => json(200, [{ ...MIRAFLORES, precioEfectivo: precio }]),
      [`PATCH ${RUTA}`]: ({ cuerpo }) => {
        precio = (cuerpo as { precio: string }).precio;
        return json(200, ceviche({ precio }));
      },
    });
    renderApp(RUTA);
    const miraflores = await filaDe('Miraflores');
    expect(within(miraflores).getByText('S/ 25.00')).toBeInTheDocument();
    const campo = screen.getByLabelText('Precio con IGV');
    await userEvent.clear(campo);
    await userEvent.type(campo, '26');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(miraflores).findByText('S/ 26.00')).toBeInTheDocument();
    expect(s.de('GET', RUTA_SUCURSALES).length).toBeGreaterThan(1);
  });
});
