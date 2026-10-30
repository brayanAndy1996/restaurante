import type {
  EstacionDestinoRespuesta,
  ImpresoraRespuesta,
  SesionRespuesta,
} from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';

// spec: 004-salon-cocina, criterios 99 a 105 y 136 (y 137 en parte) en la interfaz (pruebas no protegidas
// de Ajustes › Impresión).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RAIZ = `/sucursales/${ID.sucursalA}`;
const RUTA_IMPRESORAS = `${RAIZ}/impresoras`;
const RUTA_DESTINOS = `${RAIZ}/estaciones-destino`;
const RUTA_CAJA = `${RAIZ}/impresion`;

const COCINA = uuid(1);
const BARRA = uuid(2);

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

const impresora = (
  n: number,
  nombre: string,
  extra: Partial<ImpresoraRespuesta> = {},
): ImpresoraRespuesta => ({
  id: uuid(100 + n),
  sucursalId: ID.sucursalA,
  nombre,
  conexion: { tipo: 'RED', host: `192.168.1.${50 + n}`, puerto: 9100 },
  anchoMm: 80,
  juegoCaracteres: 'PC850',
  gaveta: false,
  activa: true,
  estado: 'LISTA',
  estadoDesde: '2026-10-30T15:00:00.000Z',
  pendientes: 0,
  ...extra,
});

const estacion = (
  id: string,
  nombre: string,
  impresoraDestino?: ImpresoraRespuesta,
): EstacionDestinoRespuesta => ({
  estacionId: id,
  nombre,
  destino: impresoraDestino ? 'IMPRESORA' : 'KDS',
  impresora: impresoraDestino ? { id: impresoraDestino.id, nombre: impresoraDestino.nombre } : null,
});

interface Datos {
  impresoras?: ImpresoraRespuesta[];
  destinos?: EstacionDestinoRespuesta[];
  impresoraCajaId?: string | null;
}

/**
 * API de mentira con memoria: aplica las escrituras como lo haría la real para recorrer varios pasos
 * seguidos. `respuestas` deja a una prueba forzar el resultado de una ruta.
 */
function api(datos: Datos = {}, respuestas: Record<string, Manejador> = {}) {
  let impresoras = structuredClone(datos.impresoras ?? []);
  let destinos = structuredClone(
    datos.destinos ?? [estacion(COCINA, 'Cocina'), estacion(BARRA, 'Barra')],
  );
  let impresoraCajaId = datos.impresoraCajaId ?? null;
  let siguiente = 500;
  const s = servidor({
    'GET /sesion': () => json(200, administrador()),
    [`GET ${RUTA_IMPRESORAS}`]: () => json(200, impresoras),
    [`POST ${RUTA_IMPRESORAS}`]: ({ cuerpo }) => {
      const c = cuerpo as Omit<ImpresoraRespuesta, 'id' | 'sucursalId' | 'activa' | 'estado'>;
      const nueva: ImpresoraRespuesta = {
        ...c,
        conexion:
          c.conexion.tipo === 'RED'
            ? { ...c.conexion, puerto: c.conexion.puerto ?? 9100 }
            : c.conexion,
        id: uuid(siguiente++),
        sucursalId: ID.sucursalA,
        activa: true,
        estado: 'DESCONOCIDO',
        estadoDesde: null,
        pendientes: 0,
      };
      impresoras = [...impresoras, nueva];
      return json(201, nueva);
    },
    [`PATCH ${RUTA_IMPRESORAS}/*`]: ({ cuerpo, url }) => {
      const id = url.pathname.split('/').at(-1);
      impresoras = impresoras.map((i) => (i.id === id ? { ...i, ...(cuerpo as object) } : i));
      return json(
        200,
        impresoras.find((i) => i.id === id),
      );
    },
    [`GET ${RUTA_DESTINOS}`]: () => json(200, destinos),
    [`PUT ${RUTA_DESTINOS}/*`]: ({ cuerpo, url }) => {
      const id = url.pathname.split('/').at(-1);
      const c = cuerpo as { destino: 'KDS' | 'IMPRESORA'; impresoraId?: string };
      const elegida = impresoras.find((i) => i.id === c.impresoraId);
      destinos = destinos.map((d) =>
        d.estacionId === id ? estacion(d.estacionId, d.nombre, elegida) : d,
      );
      return json(
        200,
        destinos.find((d) => d.estacionId === id),
      );
    },
    [`GET ${RUTA_CAJA}`]: () => json(200, { impresoraCajaId }),
    [`PUT ${RUTA_CAJA}`]: ({ cuerpo }) => {
      impresoraCajaId = (cuerpo as { impresoraCajaId: string | null }).impresoraCajaId;
      return json(200, { impresoraCajaId });
    },
    // El puente y los trabajos de hoy tienen sus propias pruebas (`puente.spec.tsx`): aquí, sin nada.
    'GET /impresion/estado': () =>
      json(200, { ahora: '2026-10-30T17:00:00.000Z', puente: null, impresoras: [] }),
    'GET /impresion/trabajos': () => json(200, []),
    ...respuestas,
  });
  return { ...s, impresoras: () => impresoras, destinos: () => destinos };
}

const CUATRO_CERO_DOS = (campos: { campo: string; mensaje: string }[]) =>
  json(400, { codigo: 'DATOS_INVALIDOS', mensaje: 'Revisa los datos', campos });

const campo = (nombre: string) => screen.getByLabelText(nombre);
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

async function abrir(ruta = '/administracion/impresion') {
  renderApp(ruta);
  await screen.findByRole('heading', { name: 'Impresoras' });
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Ajustes › Impresión: ver (criterio 136)', () => {
  it('"Impresión" es una sección de Ajustes, junto a Usuarios, Acceso y Mapa de mesas', async () => {
    api();
    renderApp('/administracion/usuarios');
    const secciones = await screen.findByRole('group', { name: 'Secciones de Ajustes' });
    await userEvent.click(within(secciones).getByRole('button', { name: 'Impresión' }));
    expect(await screen.findByRole('heading', { name: 'Impresoras' })).toBeInTheDocument();
    // Cada sección es su pantalla: el grupo se vuelve a dibujar con "Impresión" elegida.
    expect(
      within(screen.getByRole('group', { name: 'Secciones de Ajustes' })).getByRole('button', {
        name: 'Impresión',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('lista cada impresora con su conexión, ancho y estado dicho con palabras, y los pendientes', async () => {
    api({
      impresoras: [
        impresora(1, 'Cocina', { pendientes: 3 }),
        impresora(2, 'Barra', { estado: 'NO_RESPONDE', pendientes: 1 }),
        impresora(3, 'Caja', {
          conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF' },
          anchoMm: 58,
          estado: 'DESCONOCIDO',
        }),
        impresora(4, 'Vieja', { activa: false }),
      ],
    });
    await abrir();
    const lista = screen.getByRole('list', { name: 'Impresoras' });
    const filas = within(lista).getAllByRole('listitem');
    // Activas primero y por nombre; la inactiva al final.
    expect(filas.map((f) => within(f).getByRole('button').textContent)).toEqual([
      expect.stringContaining('Barra'),
      expect.stringContaining('Caja'),
      expect.stringContaining('Cocina'),
      expect.stringContaining('Vieja'),
    ]);
    expect(within(filas[0]!).getByText('No responde')).toBeInTheDocument();
    expect(within(filas[0]!).getByText('1 pendiente')).toBeInTheDocument();
    expect(
      within(filas[1]!).getByText('Bluetooth · AA:BB:CC:DD:EE:FF · 58 mm'),
    ).toBeInTheDocument();
    expect(within(filas[1]!).getByText('Sin datos')).toBeInTheDocument();
    expect(within(filas[2]!).getByText('Red · 192.168.1.51:9100 · 80 mm')).toBeInTheDocument();
    expect(within(filas[2]!).getByText('Lista')).toBeInTheDocument();
    expect(within(filas[2]!).getByText('3 pendientes')).toBeInTheDocument();
    expect(within(filas[3]!).getByText('Inactiva')).toBeInTheDocument();
    expect(screen.getByText('3 impresoras activas · 1 inactiva')).toBeInTheDocument();
  });

  it('sin impresoras, dice qué falta y deja agregar una', async () => {
    api();
    await abrir();
    expect(screen.getByText('Aún no hay impresoras')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar impresora' })).toBeInTheDocument();
  });

  it('si no puede cargar las impresoras, dice el problema y deja reintentar', async () => {
    let falla = true;
    api(
      { impresoras: [impresora(1, 'Cocina')] },
      {
        [`GET ${RUTA_IMPRESORAS}`]: () =>
          falla
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
            : json(200, [impresora(1, 'Cocina')]),
      },
    );
    renderApp('/administracion/impresion');
    expect(await screen.findByText('No pudimos cargar las impresoras')).toBeInTheDocument();
    falla = false;
    await userEvent.click(boton('Reintentar'));
    expect(await screen.findByRole('heading', { name: 'Impresoras' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cocina/ })).toBeInTheDocument();
  });

  it('solo el Administrador entra: otro rol vuelve al inicio', async () => {
    api(
      {},
      {
        'GET /sesion': () =>
          json(
            200,
            sesionDe({
              rol: 'CAJERO',
              esAdministrador: false,
              permisos: permisosDeRol('CAJERO'),
            }),
          ),
      },
    );
    renderApp('/administracion/impresion');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(nav).queryByRole('link', { name: 'Ajustes' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Impresoras' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Secciones de Ajustes' })).toBeNull();
  });
});

describe('Ajustes › Impresión: crear (criterios 103 y 136)', () => {
  it('crea una impresora de red con los valores de siempre y con una clave de idempotencia', async () => {
    const s = api();
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    expect(screen.getByRole('heading', { name: 'Nueva impresora' })).toBeInTheDocument();
    // Valores por defecto: puerto 9100, 80 mm, PC850, sin gaveta.
    expect(campo('Puerto')).toHaveValue('9100');
    expect(screen.getByRole('button', { name: '80 mm' })).toHaveAttribute('aria-pressed', 'true');
    expect(campo('Juego de caracteres')).toHaveValue('PC850');
    expect(screen.getByRole('switch', { name: 'Tiene gaveta' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(
      screen.getByText('Si salen símbolos raros en las tildes, prueba otro.'),
    ).toBeInTheDocument();
    expect(screen.getByText('58 mm: 32 columnas · 80 mm: 48 columnas')).toBeInTheDocument();

    await userEvent.type(campo('Nombre de la impresora'), '  Cocina  ');
    await userEvent.type(campo('Dirección de la impresora'), '192.168.1.50');
    await userEvent.click(boton('Crear impresora'));

    expect(
      await screen.findByText(
        'Impresora Cocina creada. Elígela en “Dónde sale cada estación” para usarla.',
      ),
    ).toBeInTheDocument();
    const llamada = s.de('POST', RUTA_IMPRESORAS)[0];
    expect(llamada?.cuerpo).toEqual({
      nombre: 'Cocina',
      conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 9100 },
      anchoMm: 80,
      juegoCaracteres: 'PC850',
      gaveta: false,
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    // Vuelve a la lista con la nueva impresora, sin volver a pedirla.
    expect(await screen.findByRole('button', { name: /Cocina/ })).toBeInTheDocument();
    expect(s.de('GET', RUTA_IMPRESORAS)).toHaveLength(1);
  });

  it('al crear una impresora vuelve a pedir el estado: el aviso de «sin puente» sale al instante', async () => {
    let hayImpresoras = false;
    const s = api(
      {},
      {
        'GET /impresion/estado': () =>
          json(200, {
            ahora: '2026-10-30T17:00:00.000Z',
            puente: null,
            impresoras: hayImpresoras
              ? [
                  {
                    id: uuid(500),
                    nombre: 'Cocina',
                    estado: 'DESCONOCIDO',
                    estadoDesde: null,
                    pendientes: 0,
                  },
                ]
              : [],
          }),
        [`POST ${RUTA_IMPRESORAS}`]: ({ cuerpo }) => {
          hayImpresoras = true;
          return json(201, { ...(cuerpo as object), ...impresora(0, 'Cocina'), id: uuid(500) });
        },
      },
    );
    await abrir();
    await waitFor(() => expect(s.de('GET', '/impresion/estado').length).toBeGreaterThan(0));
    expect(screen.queryByText('No hay un puente de impresión vinculado')).toBeNull();
    const antes = s.de('GET', '/impresion/estado').length;

    await userEvent.click(boton('Agregar impresora'));
    await userEvent.type(campo('Nombre de la impresora'), 'Cocina');
    await userEvent.type(campo('Dirección de la impresora'), '192.168.1.50');
    await userEvent.click(boton('Crear impresora'));
    await screen.findByText(/Impresora Cocina creada/);

    expect(await screen.findByText('No hay un puente de impresión vinculado')).toBeVisible();
    expect(s.de('GET', '/impresion/estado').length).toBeGreaterThan(antes);
  });

  it('al modificar una impresora también vuelve a pedir el estado', async () => {
    const s = api({ impresoras: [impresora(1, 'Cocina')] });
    await abrir();
    await waitFor(() => expect(s.de('GET', '/impresion/estado').length).toBeGreaterThan(0));
    const antes = s.de('GET', '/impresion/estado').length;
    await userEvent.click(screen.getByRole('button', { name: /Cocina/ }));
    await userEvent.click(boton('58 mm'));
    await userEvent.click(boton('Guardar'));
    await screen.findByText('Cambios de Cocina guardados.');
    await waitFor(() => expect(s.de('GET', '/impresion/estado').length).toBeGreaterThan(antes));
  });

  it('con 58 mm, otro juego de caracteres y gaveta, manda exactamente eso', async () => {
    const s = api();
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    await userEvent.type(campo('Nombre de la impresora'), 'Caja');
    await userEvent.type(campo('Dirección de la impresora'), 'termica-caja.local');
    await userEvent.clear(campo('Puerto'));
    await userEvent.type(campo('Puerto'), '9101');
    await userEvent.click(boton('58 mm'));
    await userEvent.selectOptions(campo('Juego de caracteres'), 'SIN_TILDES');
    await userEvent.click(screen.getByRole('switch', { name: 'Tiene gaveta' }));
    await userEvent.click(boton('Crear impresora'));
    await screen.findByText(/Impresora Caja creada/);
    expect(s.de('POST', RUTA_IMPRESORAS)[0]?.cuerpo).toEqual({
      nombre: 'Caja',
      conexion: { tipo: 'RED', host: 'termica-caja.local', puerto: 9101 },
      anchoMm: 58,
      juegoCaracteres: 'SIN_TILDES',
      gaveta: true,
    });
  });

  it('con Bluetooth pide la dirección, dice que requiere la app puente y guarda la MAC en mayúsculas', async () => {
    const s = api();
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    expect(screen.queryByText('Requiere la app puente con Bluetooth')).toBeNull();
    await userEvent.click(boton('Bluetooth'));
    expect(screen.getByText('Requiere la app puente con Bluetooth')).toBeInTheDocument();
    expect(screen.queryByLabelText('Dirección de la impresora')).toBeNull();
    expect(screen.queryByLabelText('Puerto')).toBeNull();

    await userEvent.type(campo('Nombre de la impresora'), 'Barra');
    await userEvent.type(campo('Dirección Bluetooth'), 'aa-bb-cc-dd-ee-0f');
    await userEvent.click(boton('Crear impresora'));
    await screen.findByText(/Impresora Barra creada/);
    expect(s.de('POST', RUTA_IMPRESORAS)[0]?.cuerpo).toMatchObject({
      conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:0F' },
    });
    expect(screen.getByText('Bluetooth · AA:BB:CC:DD:EE:0F · 80 mm')).toBeInTheDocument();
  });

  it('acepta la dirección Bluetooth sin separadores', async () => {
    const s = api();
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    await userEvent.click(boton('Bluetooth'));
    await userEvent.type(campo('Nombre de la impresora'), 'Barra');
    await userEvent.type(campo('Dirección Bluetooth'), '00112233aabb');
    await userEvent.click(boton('Crear impresora'));
    await screen.findByText(/Impresora Barra creada/);
    expect(s.de('POST', RUTA_IMPRESORAS)[0]?.cuerpo).toMatchObject({
      conexion: { tipo: 'BLUETOOTH', mac: '00:11:22:33:AA:BB' },
    });
  });

  it('no envía nada si faltan datos y dice qué corregir en cada campo', async () => {
    const s = api({ impresoras: [impresora(1, 'Cocina')] });
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    await userEvent.click(boton('Crear impresora'));
    expect(screen.getByText('Escribe el nombre de la impresora')).toBeInTheDocument();
    expect(
      screen.getByText('Escribe la IP de la impresora, por ejemplo 192.168.1.50'),
    ).toBeInTheDocument();

    await userEvent.type(campo('Nombre de la impresora'), 'cocina');
    await userEvent.type(campo('Dirección de la impresora'), '999.1.1.1');
    await userEvent.clear(campo('Puerto'));
    await userEvent.type(campo('Puerto'), '70000');
    await userEvent.click(boton('Crear impresora'));
    expect(
      screen.getByText('Ya hay una impresora con ese nombre en esta sucursal. Usa otro.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Esa dirección no sirve/)).toBeInTheDocument();
    expect(
      screen.getByText('Escribe un puerto de 1 a 65535 (casi siempre es 9100)'),
    ).toBeInTheDocument();
    expect(s.de('POST', RUTA_IMPRESORAS)).toHaveLength(0);

    // Con Bluetooth, una dirección mal escrita se explica con el formato.
    await userEvent.click(boton('Bluetooth'));
    await userEvent.type(campo('Dirección Bluetooth'), 'AA:BB');
    await userEvent.click(boton('Crear impresora'));
    expect(screen.getByText(/La dirección debe verse así: AA:BB:CC:DD:EE:FF/)).toBeInTheDocument();
    expect(s.de('POST', RUTA_IMPRESORAS)).toHaveLength(0);
  });

  it('si el servidor dice que el nombre ya existe, lo marca en el campo y conserva lo escrito', async () => {
    api(
      {},
      {
        [`POST ${RUTA_IMPRESORAS}`]: () =>
          json(409, { codigo: 'CONFLICTO', mensaje: 'Nombre repetido' }),
      },
    );
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    await userEvent.type(campo('Nombre de la impresora'), 'Cocina');
    await userEvent.type(campo('Dirección de la impresora'), '192.168.1.50');
    await userEvent.click(boton('Crear impresora'));
    expect(
      await screen.findByText('Ya hay una impresora con ese nombre en esta sucursal. Usa otro.'),
    ).toBeInTheDocument();
    expect(campo('Dirección de la impresora')).toHaveValue('192.168.1.50');
  });

  it('si el servidor rechaza la dirección, la marca en su campo', async () => {
    api(
      {},
      {
        [`POST ${RUTA_IMPRESORAS}`]: () =>
          CUATRO_CERO_DOS([{ campo: 'conexion.host', mensaje: 'No es una dirección conocida' }]),
      },
    );
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    await userEvent.type(campo('Nombre de la impresora'), 'Cocina');
    await userEvent.type(campo('Dirección de la impresora'), 'impresora');
    await userEvent.click(boton('Crear impresora'));
    expect(await screen.findByText('No es una dirección conocida')).toBeInTheDocument();
  });

  it('Cancelar vuelve a la lista sin enviar nada', async () => {
    const s = api({ impresoras: [impresora(1, 'Cocina')] });
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    await userEvent.type(campo('Nombre de la impresora'), 'Otra');
    await userEvent.click(boton('Cancelar'));
    expect(await screen.findByRole('heading', { name: 'Impresoras' })).toBeInTheDocument();
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });

  it('sin red, crear queda "Pendiente de envío" y sale una sola vez con la misma clave', async () => {
    let sinRed = true;
    let esperas = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++esperas === 7) await compuerta;
    });
    const s = api(
      {},
      {
        [`POST ${RUTA_IMPRESORAS}`]: ({ cuerpo }) => {
          if (sinRed) throw new TypeError('Failed to fetch');
          return json(201, {
            ...(cuerpo as object),
            id: uuid(900),
            sucursalId: ID.sucursalA,
            activa: true,
            estado: 'DESCONOCIDO',
            estadoDesde: null,
            pendientes: 0,
          });
        },
      },
    );
    await abrir();
    await userEvent.click(boton('Agregar impresora'));
    await userEvent.type(campo('Nombre de la impresora'), 'Cocina');
    await userEvent.type(campo('Dirección de la impresora'), '192.168.1.50');
    await userEvent.click(boton('Crear impresora'));
    expect((await screen.findAllByText('Pendiente de envío'))[0]).toBeInTheDocument();
    // Lo escrito sigue ahí mientras espera.
    expect(campo('Nombre de la impresora')).toHaveValue('Cocina');
    sinRed = false;
    liberar();
    expect(await screen.findByText(/Impresora Cocina creada/)).toBeInTheDocument();
    const claves = s.de('POST', RUTA_IMPRESORAS).map((l) => l.cabeceras.get('Idempotency-Key'));
    expect(claves.length).toBeGreaterThan(1);
    expect(new Set(claves).size).toBe(1);
  });
});

describe('Ajustes › Impresión: editar y desactivar (criterio 104)', () => {
  it('abre la impresora con sus datos y solo manda lo que cambió', async () => {
    const s = api({
      impresoras: [impresora(1, 'Cocina', { juegoCaracteres: 'PC858', gaveta: true })],
    });
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: /Cocina/ }));
    expect(screen.getByRole('heading', { name: 'Cocina', level: 3 })).toBeInTheDocument();
    expect(campo('Nombre de la impresora')).toHaveValue('Cocina');
    expect(campo('Dirección de la impresora')).toHaveValue('192.168.1.51');
    expect(campo('Puerto')).toHaveValue('9100');
    expect(campo('Juego de caracteres')).toHaveValue('PC858');
    expect(screen.getByRole('switch', { name: 'Tiene gaveta' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Sin cambios, "Guardar" espera.
    expect(boton('Guardar')).toBeDisabled();

    await userEvent.click(boton('58 mm'));
    await userEvent.click(boton('Guardar'));
    expect(await screen.findByText('Cambios de Cocina guardados.')).toBeInTheDocument();
    const llamada = s.de('PATCH', `${RUTA_IMPRESORAS}/${uuid(101)}`)[0];
    expect(llamada?.cuerpo).toEqual({ anchoMm: 58 });
  });

  it('al cambiar de red a Bluetooth manda la conexión entera', async () => {
    const s = api({ impresoras: [impresora(1, 'Cocina')] });
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: /Cocina/ }));
    await userEvent.click(boton('Bluetooth'));
    await userEvent.type(campo('Dirección Bluetooth'), '00:11:22:33:44:55');
    await userEvent.click(boton('Guardar'));
    await screen.findByText('Cambios de Cocina guardados.');
    expect(s.de('PATCH', `${RUTA_IMPRESORAS}/${uuid(101)}`)[0]?.cuerpo).toEqual({
      conexion: { tipo: 'BLUETOOTH', mac: '00:11:22:33:44:55' },
    });
  });

  it('con un solo trabajo pendiente lo dice en singular', async () => {
    api({ impresoras: [impresora(1, 'Cocina', { pendientes: 1 })] });
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: /Cocina/ }));
    expect(
      screen.getByText(/Su trabajo pendiente sigue en cola hasta que venza\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1 trabajos/)).toBeNull();
  });

  it('desactiva una impresora libre y la deja en la lista como inactiva, con opción de reactivarla', async () => {
    const s = api({ impresoras: [impresora(1, 'Cocina', { pendientes: 2 })] });
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: /Cocina/ }));
    expect(screen.getByText(/Sus 2 trabajos pendientes siguen en cola/)).toBeInTheDocument();
    await userEvent.click(boton('Desactivar impresora'));
    expect(
      await screen.findByText('Impresora Cocina desactivada. Puedes reactivarla desde la lista.'),
    ).toBeInTheDocument();
    expect(s.de('PATCH', `${RUTA_IMPRESORAS}/${uuid(101)}`)[0]?.cuerpo).toEqual({ activa: false });
    const fila = screen.getByRole('button', { name: /Cocina/ });
    expect(within(fila).getByText('Inactiva')).toBeInTheDocument();

    await userEvent.click(fila);
    expect(screen.queryByRole('button', { name: 'Desactivar impresora' })).toBeNull();
    await userEvent.click(boton('Reactivar impresora'));
    expect(await screen.findByText('Impresora Cocina reactivada.')).toBeInTheDocument();
    expect(s.de('PATCH', `${RUTA_IMPRESORAS}/${uuid(101)}`)[1]?.cuerpo).toEqual({ activa: true });
    expect(
      within(screen.getByRole('button', { name: /Cocina/ })).getByText('Lista'),
    ).toBeInTheDocument();
  });

  it('EN_USO: avisa antes dónde se usa y, si el servidor lo rechaza, explica qué hacer y la deja activa', async () => {
    const cocina = impresora(1, 'Cocina');
    const s = api(
      {
        impresoras: [cocina],
        destinos: [estacion(COCINA, 'Cocina', cocina), estacion(BARRA, 'Barra')],
        impresoraCajaId: cocina.id,
      },
      {
        [`PATCH ${RUTA_IMPRESORAS}/*`]: () =>
          json(409, {
            codigo: 'EN_USO',
            mensaje: 'La impresora es el destino de Cocina y la impresora de caja.',
          }),
      },
    );
    await abrir();
    await userEvent.click(
      within(screen.getByRole('list', { name: 'Impresoras' })).getByRole('button'),
    );
    // Antes de tocar nada, la ficha ya dice dónde se usa.
    expect(
      await screen.findByText(/Ahora se usa en Cocina y la impresora de caja\. Cambia ese destino/),
    ).toBeInTheDocument();
    await userEvent.click(boton('Desactivar impresora'));
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText('No se puede desactivar: está en uso')).toBeInTheDocument();
    expect(alerta).toHaveTextContent(
      'Se usa en Cocina y la impresora de caja. Elige otro destino en “Dónde sale cada estación” o en “Impresora de caja” y vuelve a desactivarla.',
    );
    expect(s.de('PATCH', `${RUTA_IMPRESORAS}/${cocina.id}`)).toHaveLength(1);
    // Sigue activa y en su ficha: nada se perdió.
    expect(boton('Desactivar impresora')).toBeEnabled();
  });

  it('EN_USO sin datos locales: usa el mensaje del servidor y la misma salida', async () => {
    api(
      { impresoras: [impresora(1, 'Cocina')] },
      {
        [`PATCH ${RUTA_IMPRESORAS}/*`]: () =>
          json(409, { codigo: 'EN_USO', mensaje: 'Es el destino de Barra' }),
      },
    );
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: /Cocina/ }));
    await userEvent.click(boton('Desactivar impresora'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Es el destino de Barra. Elige otro destino en “Dónde sale cada estación” o en “Impresora de caja” y vuelve a desactivarla.',
    );
  });
});

describe('Ajustes › Impresión: dónde sale cada estación (criterios 99 y 100)', () => {
  const cocina = impresora(1, 'Cocina');
  const barra = impresora(2, 'Barra', {
    conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF' },
  });
  const vieja = impresora(3, 'Vieja', { activa: false });

  it('una fila por estación, con "Pantalla de cocina" por defecto y solo las impresoras activas para elegir', async () => {
    api({
      impresoras: [cocina, barra, vieja],
      destinos: [estacion(COCINA, 'Cocina'), estacion(BARRA, 'Barra', cocina)],
    });
    await abrir();
    const bloque = screen.getByRole('region', { name: 'Dónde sale cada estación' });
    const selectorCocina = within(bloque).getByLabelText('Cocina');
    const selectorBarra = within(bloque).getByLabelText('Barra');
    expect(selectorCocina).toHaveValue('KDS');
    expect(selectorBarra).toHaveValue(cocina.id);
    expect(
      within(selectorCocina)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Pantalla de cocina', 'Barra (Bluetooth)', 'Cocina']);
    expect(within(selectorCocina).queryByRole('option', { name: /Vieja/ })).toBeNull();
  });

  it('al elegir una impresora la guarda en el momento y lo confirma con palabras', async () => {
    const s = api({ impresoras: [cocina] });
    await abrir();
    const bloque = screen.getByRole('region', { name: 'Dónde sale cada estación' });
    await userEvent.selectOptions(within(bloque).getByLabelText('Cocina'), cocina.id);
    expect(await within(bloque).findByText('Cocina sale ahora por Cocina.')).toBeInTheDocument();
    const llamada = s.de('PUT', `${RUTA_DESTINOS}/${COCINA}`)[0];
    expect(llamada?.cuerpo).toEqual({ destino: 'IMPRESORA', impresoraId: cocina.id });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(within(bloque).getByLabelText('Cocina')).toHaveValue(cocina.id);

    await userEvent.selectOptions(within(bloque).getByLabelText('Cocina'), 'KDS');
    expect(
      await within(bloque).findByText('Cocina sale ahora por la pantalla de cocina.'),
    ).toBeInTheDocument();
    expect(s.de('PUT', `${RUTA_DESTINOS}/${COCINA}`)[1]?.cuerpo).toEqual({ destino: 'KDS' });
  });

  it('avisa que la comanda por una impresora Bluetooth espera a la app puente', async () => {
    api({
      impresoras: [barra],
      destinos: [estacion(COCINA, 'Cocina', barra), estacion(BARRA, 'Barra')],
    });
    await abrir();
    expect(
      screen.getByText(
        'Requiere la app puente con Bluetooth: los tickets esperan en la cola hasta entonces.',
      ),
    ).toBeInTheDocument();
  });

  it('si no se pudo guardar, lo dice y el selector vuelve a lo que estaba', async () => {
    api(
      { impresoras: [cocina] },
      {
        [`PUT ${RUTA_DESTINOS}/*`]: () =>
          json(422, { codigo: 'REFERENCIA_INVALIDA', mensaje: 'La impresora no existe' }),
      },
    );
    await abrir();
    const bloque = screen.getByRole('region', { name: 'Dónde sale cada estación' });
    await userEvent.selectOptions(within(bloque).getByLabelText('Cocina'), cocina.id);
    const alerta = await within(bloque).findByRole('alert');
    expect(within(alerta).getByText('No pudimos cambiar el destino de Cocina')).toBeInTheDocument();
    expect(alerta).toHaveTextContent('Esa impresora o esa estación ya no está disponible');
    await waitFor(() => expect(within(bloque).getByLabelText('Cocina')).toHaveValue('KDS'));
  });

  it('sin red, el cambio queda "Pendiente de envío" y sale una sola vez al volver', async () => {
    let sinRed = true;
    let esperas = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++esperas === 7) await compuerta;
    });
    const s = api(
      { impresoras: [cocina] },
      {
        [`PUT ${RUTA_DESTINOS}/*`]: ({ url }) => {
          if (sinRed) throw new TypeError('Failed to fetch');
          return json(200, estacion(url.pathname.split('/').at(-1)!, 'Cocina', cocina));
        },
      },
    );
    await abrir();
    const bloque = screen.getByRole('region', { name: 'Dónde sale cada estación' });
    await userEvent.selectOptions(within(bloque).getByLabelText('Cocina'), cocina.id);
    expect((await screen.findAllByText('Pendiente de envío'))[0]).toBeInTheDocument();
    // Se ve como ya hecho mientras espera.
    expect(within(bloque).getByLabelText('Cocina')).toHaveValue(cocina.id);
    sinRed = false;
    liberar();
    expect(await within(bloque).findByText('Cocina sale ahora por Cocina.')).toBeInTheDocument();
    const claves = s
      .de('PUT', `${RUTA_DESTINOS}/${COCINA}`)
      .map((l) => l.cabeceras.get('Idempotency-Key'));
    expect(new Set(claves).size).toBe(1);
  });

  it('sin estaciones o sin impresoras activas, lo dice', async () => {
    api({ impresoras: [vieja] });
    await abrir();
    expect(screen.getByText(/Todavía no tienes una impresora activa/)).toBeInTheDocument();
  });

  it('sin estaciones en la carta, dice dónde se crean', async () => {
    api({ destinos: [] });
    await abrir();
    expect(screen.getByText('Aún no hay estaciones')).toBeInTheDocument();
  });

  it('si no puede cargar los destinos, lo dice en su bloque y el resto sigue', async () => {
    api(
      { impresoras: [cocina] },
      {
        [`GET ${RUTA_DESTINOS}`]: () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
      },
    );
    await abrir();
    expect(
      await screen.findByText('No pudimos cargar dónde sale cada estación'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cocina/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Impresora de caja' })).toBeInTheDocument();
  });
});

describe('Ajustes › Impresión: impresora de caja (criterio 102)', () => {
  const cocina = impresora(1, 'Cocina');
  const caja = impresora(2, 'Caja');

  it('muestra la elegida y deja cambiarla o quitarla', async () => {
    const s = api({ impresoras: [cocina, caja], impresoraCajaId: caja.id });
    await abrir();
    const bloque = screen.getByRole('region', { name: 'Impresora de caja' });
    const selector = within(bloque).getByLabelText('Impresora de la pre-cuenta');
    expect(selector).toHaveValue(caja.id);
    expect(
      within(selector)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ninguna', 'Caja', 'Cocina']);

    await userEvent.selectOptions(selector, cocina.id);
    expect(
      await within(bloque).findByText('La pre-cuenta sale ahora por Cocina.'),
    ).toBeInTheDocument();
    expect(s.de('PUT', RUTA_CAJA)[0]?.cuerpo).toEqual({ impresoraCajaId: cocina.id });
    expect(s.de('PUT', RUTA_CAJA)[0]?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);

    await userEvent.selectOptions(selector, 'Ninguna');
    expect(
      await within(bloque).findByText('La pre-cuenta ya no se imprime: solo se ve en pantalla.'),
    ).toBeInTheDocument();
    expect(s.de('PUT', RUTA_CAJA)[1]?.cuerpo).toEqual({ impresoraCajaId: null });
    expect(selector).toHaveValue('');
  });

  it('sin impresora de caja dice que la pre-cuenta solo se ve en pantalla', async () => {
    api({ impresoras: [cocina] });
    await abrir();
    const bloque = screen.getByRole('region', { name: 'Impresora de caja' });
    expect(within(bloque).getByLabelText('Impresora de la pre-cuenta')).toHaveValue('');
    expect(
      within(bloque).getByText(/Sin impresora de caja, la pre-cuenta solo se ve en pantalla/),
    ).toBeInTheDocument();
  });

  it('si no se pudo guardar, lo dice y deja lo anterior', async () => {
    api(
      { impresoras: [cocina], impresoraCajaId: null },
      {
        [`PUT ${RUTA_CAJA}`]: () =>
          json(422, { codigo: 'REFERENCIA_INVALIDA', mensaje: 'La impresora no existe' }),
      },
    );
    await abrir();
    const bloque = screen.getByRole('region', { name: 'Impresora de caja' });
    await userEvent.selectOptions(
      within(bloque).getByLabelText('Impresora de la pre-cuenta'),
      cocina.id,
    );
    expect(await within(bloque).findByRole('alert')).toHaveTextContent(
      'No pudimos cambiar la impresora de caja',
    );
    await waitFor(() =>
      expect(within(bloque).getByLabelText('Impresora de la pre-cuenta')).toHaveValue(''),
    );
  });
});
