import type {
  CajaRespuesta,
  EmisorRespuesta,
  ImpresoraRespuesta,
  SesionRespuesta,
  TasaIgvRespuesta,
} from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';

// spec: 006-caja-cobro, criterios 1 a 7 y 117 en la interfaz (pruebas no protegidas de Ajustes › Cajas y
// Ajustes › Emisores) y la guía de primeros pasos de la pregunta 19.

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EMISOR = uuid(900);
const RUTA_CAJAS = `/sucursales/${ID.sucursalA}/cajas`;
const RUTA_IMPRESORAS = `/sucursales/${ID.sucursalA}/impresoras`;
const RUTA_TASAS = `/emisores/${EMISOR}/tasas-igv`;

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

const caja = (n: number, nombre: string, extra: Partial<CajaRespuesta> = {}): CajaRespuesta => ({
  id: uuid(100 + n),
  sucursalId: ID.sucursalA,
  nombre,
  activa: true,
  impresora: null,
  series: [],
  turnoAbierto: null,
  ...extra,
});

const impresora = (n: number, nombre: string, activa = true): ImpresoraRespuesta => ({
  id: uuid(200 + n),
  sucursalId: ID.sucursalA,
  nombre,
  conexion: { tipo: 'RED', host: `192.168.1.${50 + n}`, puerto: 9100 },
  anchoMm: 80,
  juegoCaracteres: 'PC850',
  gaveta: false,
  activa,
  estado: 'LISTA',
  estadoDesde: '2026-10-30T15:00:00.000Z',
  pendientes: 0,
});

const emisor = (extra: Partial<EmisorRespuesta> = {}): EmisorRespuesta => ({
  id: EMISOR,
  empresaId: ID.empresa,
  ruc: '20600000005',
  razonSocial: 'Cevichería El Sol S.A.C.',
  regimen: 'GENERAL',
  creadoEn: '2026-10-01T10:00:00.000Z',
  actualizadoEn: '2026-10-01T10:00:00.000Z',
  ...extra,
});

interface Datos {
  cajas?: CajaRespuesta[];
  impresoras?: ImpresoraRespuesta[];
  emisores?: EmisorRespuesta[];
  tasas?: TasaIgvRespuesta[];
  /** Series que otra caja del RUC ya usa: el PUT responde 409 con `campos.serie`. */
  seriesOcupadas?: string[];
}

/**
 * API de mentira con memoria: aplica las escrituras como lo haría la real (nombre único, series por caja) para
 * recorrer varios pasos seguidos. `respuestas` deja a una prueba forzar el resultado de una ruta.
 */
function api(datos: Datos = {}, respuestas: Record<string, Manejador> = {}) {
  let cajas = structuredClone(datos.cajas ?? []);
  let tasas = structuredClone(datos.tasas ?? []);
  const emisores = datos.emisores ?? [emisor()];
  const impresoras = datos.impresoras ?? [];
  let siguiente = 500;
  const s = servidor({
    'GET /sesion': () => json(200, administrador()),
    [`GET /sucursales/${ID.sucursalA}`]: () =>
      json(200, { id: ID.sucursalA, emisorId: EMISOR, nombre: 'Miraflores' }),
    [`GET /sucursales/${ID.sucursalB}`]: () =>
      json(200, { id: ID.sucursalB, emisorId: EMISOR, nombre: 'Surco' }),
    [`GET /sucursales/${ID.sucursalB}/cajas`]: () =>
      json(200, [caja(90, 'Caja de Surco', { sucursalId: ID.sucursalB })]),
    [`GET ${RUTA_CAJAS}`]: () => json(200, cajas),
    [`POST ${RUTA_CAJAS}`]: ({ cuerpo }) => {
      const c = cuerpo as { nombre: string; impresoraId?: string | null };
      const elegida = impresoras.find((i) => i.id === c.impresoraId);
      const nueva = caja(siguiente++, c.nombre, {
        impresora: elegida
          ? { id: elegida.id, nombre: elegida.nombre, gaveta: elegida.gaveta }
          : null,
      });
      cajas = [...cajas, nueva];
      return json(201, nueva);
    },
    [`PATCH ${RUTA_CAJAS}/*`]: ({ cuerpo, url }) => {
      const id = url.pathname.split('/').at(-1);
      const c = cuerpo as { nombre?: string; impresoraId?: string | null; activa?: boolean };
      cajas = cajas.map((x) => {
        if (x.id !== id) return x;
        const elegida = impresoras.find((i) => i.id === c.impresoraId);
        return {
          ...x,
          ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
          ...(c.activa !== undefined ? { activa: c.activa } : {}),
          ...(c.impresoraId !== undefined
            ? {
                impresora: elegida
                  ? { id: elegida.id, nombre: elegida.nombre, gaveta: elegida.gaveta }
                  : null,
              }
            : {}),
        };
      });
      return json(
        200,
        cajas.find((x) => x.id === id),
      );
    },
    [`PUT ${RUTA_CAJAS}/*/series/*`]: ({ cuerpo, url }) => {
      const partes = url.pathname.split('/');
      const tipo = partes.at(-1) as 'BOLETA' | 'FACTURA';
      const id = partes.at(-3);
      const c = cuerpo as { serie: string; primerNumero?: number };
      if (datos.seriesOcupadas?.includes(c.serie)) {
        return CONFLICTO([{ campo: 'serie', mensaje: 'Ya está en uso por este emisor' }]);
      }
      cajas = cajas.map((x) => {
        if (x.id !== id) return x;
        const previas = x.series.map((sr) =>
          sr.tipo === tipo && sr.serie !== c.serie ? { ...sr, activa: false } : sr,
        );
        const existe = previas.some((sr) => sr.tipo === tipo && sr.serie === c.serie);
        const series = existe
          ? previas.map((sr) =>
              sr.tipo === tipo && sr.serie === c.serie ? { ...sr, activa: true } : sr,
            )
          : [
              ...previas,
              {
                tipo,
                serie: c.serie,
                ultimoNumero: (c.primerNumero ?? 1) - 1,
                activa: true,
              },
            ];
        return { ...x, series };
      });
      return json(
        200,
        cajas.find((x) => x.id === id),
      );
    },
    [`GET ${RUTA_IMPRESORAS}`]: () => json(200, impresoras),
    'GET /emisores': () => json(200, emisores),
    [`GET ${RUTA_TASAS}`]: () => json(200, tasas),
    [`PUT ${RUTA_TASAS}/*`]: ({ cuerpo, url }) => {
      const desde = url.pathname.split('/').at(-1) ?? '';
      const nueva = { desde, tasa: (cuerpo as { tasa: string }).tasa };
      tasas = [...tasas.filter((t) => t.desde !== desde), nueva].sort((a, b) =>
        a.desde.localeCompare(b.desde),
      );
      return json(200, nueva);
    },
    ...respuestas,
  });
  return { ...s, cajas: () => cajas, tasas: () => tasas };
}

const CONFLICTO = (campos: { campo: string; mensaje: string }[], mensaje = 'Conflicto') =>
  json(409, { codigo: 'CONFLICTO', mensaje, ...(campos.length > 0 ? { campos } : {}) });

const campo = (nombre: string) => screen.getByLabelText(nombre);
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

async function abrir(ruta = '/administracion/cajas') {
  renderApp(ruta);
  await screen.findByRole('heading', { name: 'Cajas' });
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Ajustes › Cajas: ver (criterio 117)', () => {
  it('"Cajas" y "Emisores" son secciones de Ajustes', async () => {
    api();
    renderApp('/administracion/usuarios');
    const secciones = await screen.findByRole('group', { name: 'Secciones de Ajustes' });
    await userEvent.click(within(secciones).getByRole('button', { name: 'Cajas' }));
    expect(await screen.findByRole('heading', { name: 'Cajas' })).toBeInTheDocument();
    const otra = screen.getByRole('group', { name: 'Secciones de Ajustes' });
    expect(within(otra).getByRole('button', { name: 'Cajas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(otra).getByRole('button', { name: 'Emisores' })).toBeInTheDocument();
  });

  it('lista cada caja con su impresora y sus series, las activas primero y por nombre', async () => {
    api({
      cajas: [
        caja(1, 'Caja 2', {
          impresora: { id: uuid(201), nombre: 'Caja', gaveta: true },
          series: [
            { tipo: 'BOLETA', serie: 'B002', ultimoNumero: 7, activa: true },
            { tipo: 'FACTURA', serie: 'F002', ultimoNumero: 0, activa: true },
          ],
        }),
        caja(2, 'Caja 1', {
          series: [{ tipo: 'BOLETA', serie: 'B001', ultimoNumero: 130, activa: true }],
          turnoAbierto: {
            id: uuid(300),
            responsable: { id: uuid(301), nombre: 'Ana' },
            abiertoEn: '2026-11-04T23:02:00.000Z',
          },
        }),
        caja(3, 'Caja vieja', { activa: false }),
        caja(4, 'Caja nueva'),
      ],
    });
    await abrir();
    const filas = within(screen.getByRole('list', { name: 'Cajas' })).getAllByRole('listitem');
    expect(filas.map((f) => within(f).getByRole('button').textContent)).toEqual([
      expect.stringContaining('Caja 1'),
      expect.stringContaining('Caja 2'),
      expect.stringContaining('Caja nueva'),
      expect.stringContaining('Caja vieja'),
    ]);
    expect(within(filas[0]!).getByText('Boletas B001')).toBeInTheDocument();
    expect(within(filas[0]!).getByText('Abierta por Ana')).toBeInTheDocument();
    expect(within(filas[0]!).getByText('Impresora de la sucursal')).toBeInTheDocument();
    expect(within(filas[1]!).getByText('Impresora: Caja')).toBeInTheDocument();
    expect(within(filas[1]!).getByText('Boletas B002')).toBeInTheDocument();
    expect(within(filas[1]!).getByText('Facturas F002')).toBeInTheDocument();
    // Una caja activa sin series lo dice con palabras: no emite.
    expect(within(filas[2]!).getByText('Sin series: no emite')).toBeInTheDocument();
    expect(within(filas[3]!).getByText('Inactiva')).toBeInTheDocument();
    expect(screen.getByText('3 cajas activas · 1 inactiva')).toBeInTheDocument();
  });

  it('sin cajas, dice qué falta y deja agregar una', async () => {
    api();
    await abrir();
    expect(screen.getByText('Aún no hay cajas')).toBeInTheDocument();
    expect(boton('Agregar caja')).toBeInTheDocument();
  });

  it('si no puede cargar las cajas, dice el problema y deja reintentar', async () => {
    let falla = true;
    api(
      { cajas: [caja(1, 'Caja 1')] },
      {
        [`GET ${RUTA_CAJAS}`]: () =>
          falla
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
            : json(200, [caja(1, 'Caja 1')]),
      },
    );
    renderApp('/administracion/cajas');
    expect(await screen.findByText('No pudimos cargar las cajas')).toBeInTheDocument();
    falla = false;
    await userEvent.click(boton('Reintentar'));
    expect(await screen.findByRole('heading', { name: 'Cajas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Caja 1/ })).toBeInTheDocument();
  });

  it('con varias sucursales, el selector lleva a las cajas de la otra', async () => {
    const s = api({ cajas: [caja(1, 'Caja 1')] });
    await abrir();
    expect(screen.getByRole('button', { name: /^Caja 1/ })).toBeInTheDocument();
    await userEvent.selectOptions(campo('Sucursal'), ID.sucursalB);
    expect(await screen.findByRole('button', { name: /^Caja de Surco/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Caja 1/ })).toBeNull();
    expect(s.de('GET', `/sucursales/${ID.sucursalB}/cajas`)).toHaveLength(1);
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
    renderApp('/administracion/cajas');
    await screen.findByRole('navigation', { name: 'Principal' });
    expect(screen.queryByRole('heading', { name: 'Cajas' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Secciones de Ajustes' })).toBeNull();
  });
});

describe('Ajustes › Cajas: primeros pasos (pregunta 19)', () => {
  it('sin cajas, series ni tasa dice qué falta, paso por paso, y a dónde ir', async () => {
    api();
    await abrir();
    const guia = await screen.findByRole('region', { name: /Para cobrar falta/ });
    await vi.waitFor(() => expect(within(guia).getAllByRole('listitem')).toHaveLength(3));
    const pasos = within(guia).getAllByRole('listitem');
    expect(pasos.map((p) => p.textContent)).toEqual([
      expect.stringContaining('Crear una caja'),
      expect.stringContaining('Darle una serie de boletas o de facturas'),
      expect.stringContaining('Poner la tasa de IGV del emisor'),
    ]);
    // El estado se dice con palabras, no solo con el color.
    for (const paso of pasos) expect(within(paso).getByText('Falta')).toBeInTheDocument();
    expect(within(guia).getByRole('link', { name: 'Poner la tasa de IGV' })).toHaveAttribute(
      'href',
      '/administracion/emisores',
    );
  });

  it('con una caja sin series y sin tasa marca la caja como hecha y ofrece poner las series', async () => {
    api({ cajas: [caja(1, 'Caja 1')] });
    await abrir();
    const guia = await screen.findByRole('region', { name: /Para cobrar falta/ });
    const pasos = within(guia).getAllByRole('listitem');
    expect(within(pasos[0]!).getByText('Hecho')).toBeInTheDocument();
    expect(within(pasos[1]!).getByText('Falta')).toBeInTheDocument();
    await userEvent.click(within(guia).getByRole('button', { name: 'Poner series a Caja 1' }));
    expect(await screen.findByRole('heading', { name: 'Caja 1' })).toBeInTheDocument();
    expect(campo('Serie de boletas')).toBeInTheDocument();
  });

  it('no aparece cuando hay caja, serie y una tasa que ya rige', async () => {
    const s = api({
      cajas: [
        caja(1, 'Caja 1', {
          series: [{ tipo: 'BOLETA', serie: 'B001', ultimoNumero: 0, activa: true }],
        }),
      ],
      tasas: [{ desde: '2020-01-01', tasa: '18.00' }],
    });
    await abrir();
    await vi.waitFor(() => expect(s.de('GET', RUTA_TASAS)).toHaveLength(1));
    expect(screen.queryByRole('region', { name: /Para cobrar falta/ })).toBeNull();
  });

  it('una tasa que solo rige en el futuro no cuenta: sigue faltando', async () => {
    api({
      cajas: [
        caja(1, 'Caja 1', {
          series: [{ tipo: 'BOLETA', serie: 'B001', ultimoNumero: 0, activa: true }],
        }),
      ],
      tasas: [{ desde: '2999-01-01', tasa: '18.00' }],
    });
    await abrir();
    const guia = await screen.findByRole('region', { name: /Para cobrar falta/ });
    expect(within(guia).getAllByText('Falta')).toHaveLength(1);
    expect(within(guia).getByText('Poner la tasa de IGV del emisor')).toBeInTheDocument();
  });

  it('un emisor del Nuevo RUS no usa tasa: ese paso no aparece', async () => {
    api({ emisores: [emisor({ regimen: 'NUEVO_RUS' })] });
    await abrir();
    const guia = await screen.findByRole('region', { name: /Para cobrar falta/ });
    await vi.waitFor(() => expect(within(guia).getAllByRole('listitem')).toHaveLength(2));
    expect(within(guia).queryByText(/tasa de IGV/)).toBeNull();
  });
});

describe('Ajustes › Cajas: crear (criterios 1 a 3)', () => {
  it('crea una caja con su impresora y manda la clave de idempotencia; sin series, avisa que falta darle una', async () => {
    const s = api({ impresoras: [impresora(1, 'Caja'), impresora(2, 'Vieja', false)] });
    await abrir();
    await userEvent.click(boton('Agregar caja'));
    expect(screen.getByRole('heading', { name: 'Nueva caja' })).toBeInTheDocument();
    // Solo las impresoras activas se pueden elegir.
    const opciones = within(campo('Impresora de la caja')).getAllByRole('option');
    expect(opciones.map((o) => o.textContent)).toEqual(['La de caja de la sucursal', 'Caja']);

    await userEvent.type(campo('Nombre de la caja'), '  Caja 1  ');
    await userEvent.selectOptions(campo('Impresora de la caja'), uuid(201));
    await userEvent.click(boton('Crear caja'));

    expect(
      await screen.findByText(
        'Caja Caja 1 creada. Dale una serie para que pueda emitir comprobantes.',
      ),
    ).toBeInTheDocument();
    const llamada = s.de('POST', RUTA_CAJAS)[0];
    expect(llamada?.cuerpo).toEqual({ nombre: 'Caja 1', impresoraId: uuid(201) });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(s.de('PUT', `${RUTA_CAJAS}/${uuid(600)}/series/BOLETA`)).toHaveLength(0);
    // Vuelve a la lista con la caja nueva, sin volver a pedirla.
    expect(await screen.findByRole('button', { name: /^Caja 1/ })).toBeInTheDocument();
    expect(s.de('GET', RUTA_CAJAS)).toHaveLength(1);
  });

  it('sin impresora, no manda impresoraId: usa la de caja de la sucursal', async () => {
    const s = api();
    await abrir();
    await userEvent.click(boton('Agregar caja'));
    await userEvent.type(campo('Nombre de la caja'), 'Barra');
    await userEvent.click(boton('Crear caja'));
    await screen.findByText(/Caja Barra creada/);
    expect(s.de('POST', RUTA_CAJAS)[0]?.cuerpo).toEqual({ nombre: 'Barra' });
  });

  it('crea la caja y sus dos series, con "Primer número" para seguir una serie que ya se usaba', async () => {
    const s = api();
    await abrir();
    await userEvent.click(boton('Agregar caja'));
    await userEvent.type(campo('Nombre de la caja'), 'Caja 1');

    // "Primer número" aparece cuando la serie está completa, no antes.
    expect(screen.queryByLabelText(/Primer número/)).toBeNull();
    await userEvent.type(campo('Serie de boletas'), 'b001');
    expect(campo('Serie de boletas')).toHaveValue('B001');
    const primeros = screen.getAllByLabelText(/Primer número/);
    expect(primeros).toHaveLength(1);
    await userEvent.type(primeros[0]!, '124');
    await userEvent.type(campo('Serie de facturas'), 'F001');
    await userEvent.click(boton('Crear caja'));

    expect(await screen.findByText('Caja Caja 1 creada.')).toBeInTheDocument();
    const id = uuid(600);
    expect(s.de('PUT', `${RUTA_CAJAS}/${id}/series/BOLETA`)[0]?.cuerpo).toEqual({
      serie: 'B001',
      primerNumero: 124,
    });
    expect(s.de('PUT', `${RUTA_CAJAS}/${id}/series/FACTURA`)[0]?.cuerpo).toEqual({ serie: 'F001' });
    const fila = screen.getByRole('button', { name: /^Caja 1/ });
    expect(within(fila).getByText('Boletas B001')).toBeInTheDocument();
    expect(within(fila).getByText('Facturas F001')).toBeInTheDocument();
  });

  it('no envía nada si faltan datos y dice qué corregir en cada campo', async () => {
    const s = api({ cajas: [caja(1, 'Caja 1')] });
    await abrir();
    await userEvent.click(boton('Agregar caja'));
    await userEvent.click(boton('Crear caja'));
    expect(screen.getByText('Escribe el nombre de la caja')).toBeInTheDocument();

    await userEvent.type(campo('Nombre de la caja'), 'caja 1');
    await userEvent.type(campo('Serie de boletas'), 'F001');
    await userEvent.type(campo('Serie de facturas'), 'B001');
    await userEvent.click(boton('Crear caja'));
    expect(
      screen.getByText('Ya hay una caja con ese nombre en esta sucursal. Usa otro.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/La serie de boletas empieza con B/)).toBeInTheDocument();
    expect(screen.getByText(/La serie de facturas empieza con F/)).toBeInTheDocument();
    expect(s.de('POST', RUTA_CAJAS)).toHaveLength(0);

    await userEvent.clear(campo('Nombre de la caja'));
    await userEvent.type(campo('Nombre de la caja'), 'Caja 2');
    await userEvent.clear(campo('Serie de boletas'));
    await userEvent.type(campo('Serie de boletas'), 'B001');
    await userEvent.clear(campo('Serie de facturas'));
    await userEvent.type(campo('Serie de facturas'), 'F001');
    await userEvent.type(screen.getAllByLabelText(/Primer número/)[0]!, '0');
    await userEvent.click(boton('Crear caja'));
    expect(screen.getByText('Escribe un número entero de 1 a 99,999,999')).toBeInTheDocument();
    expect(s.de('POST', RUTA_CAJAS)).toHaveLength(0);
  });

  it('un nombre repetido que el servidor rechaza queda marcado en el campo', async () => {
    api(
      {},
      {
        [`POST ${RUTA_CAJAS}`]: () =>
          CONFLICTO([{ campo: 'nombre', mensaje: 'Ya existe una caja con ese nombre' }]),
      },
    );
    await abrir();
    await userEvent.click(boton('Agregar caja'));
    await userEvent.type(campo('Nombre de la caja'), 'Caja 1');
    await userEvent.click(boton('Crear caja'));
    expect(
      await screen.findByText('Ya hay una caja con ese nombre en esta sucursal. Usa otro.'),
    ).toBeInTheDocument();
    expect(campo('Nombre de la caja')).toHaveAttribute('aria-invalid', 'true');
  });

  it('la caja 11 activa se explica con palabras y dice cómo seguir', async () => {
    api(
      {},
      {
        [`POST ${RUTA_CAJAS}`]: () =>
          CONFLICTO([], 'La sucursal ya tiene 10 cajas activas, que es el máximo'),
      },
    );
    await abrir();
    await userEvent.click(boton('Agregar caja'));
    await userEvent.type(campo('Nombre de la caja'), 'Caja 11');
    await userEvent.click(boton('Crear caja'));
    expect(await screen.findByText('No pudimos guardar la caja')).toBeInTheDocument();
    expect(
      screen.getByText(/10 cajas activas, que es el máximo. Desactiva una/),
    ).toBeInTheDocument();
  });

  it('si la serie ya la usa otra caja del RUC, la caja queda creada y el error sale en la serie', async () => {
    const s = api({ seriesOcupadas: ['B001'] });
    await abrir();
    await userEvent.click(boton('Agregar caja'));
    await userEvent.type(campo('Nombre de la caja'), 'Caja 1');
    await userEvent.type(campo('Serie de boletas'), 'B001');
    await userEvent.click(boton('Crear caja'));

    expect(
      await screen.findByText(/Esa serie de boletas ya la usa otra caja de este RUC/),
    ).toBeInTheDocument();
    expect(campo('Serie de boletas')).toHaveAttribute('aria-invalid', 'true');
    // La caja ya existe: el formulario sigue abierto sobre ella (no la crea dos veces al reintentar).
    expect(screen.getByRole('heading', { name: 'Caja 1' })).toBeInTheDocument();
    expect(screen.getByText('La caja se creó, pero falta una serie')).toBeInTheDocument();
    await userEvent.clear(campo('Serie de boletas'));
    await userEvent.type(campo('Serie de boletas'), 'B002');
    await userEvent.click(boton('Guardar'));
    await screen.findByText('Cambios de Caja 1 guardados.');
    expect(s.de('POST', RUTA_CAJAS)).toHaveLength(1);
    expect(s.de('PUT', `${RUTA_CAJAS}/${uuid(600)}/series/BOLETA`).at(-1)?.cuerpo).toEqual({
      serie: 'B002',
    });
  });
});

describe('Ajustes › Cajas: editar y series (criterios 1, 3 y 5)', () => {
  const conSeries = () =>
    caja(1, 'Caja 1', {
      impresora: { id: uuid(201), nombre: 'Caja', gaveta: false },
      series: [
        { tipo: 'BOLETA', serie: 'B001', ultimoNumero: 130, activa: true },
        { tipo: 'BOLETA', serie: 'B000', ultimoNumero: 40, activa: false },
      ],
    });

  it('muestra la serie actual con su último número y no pide "Primer número" mientras no cambie', async () => {
    api({ cajas: [conSeries()], impresoras: [impresora(1, 'Caja')] });
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    expect(campo('Serie de boletas')).toHaveValue('B001');
    expect(screen.getByText('Último emitido: B001-00000130')).toBeInTheDocument();
    expect(campo('Serie de facturas')).toHaveValue('');
    expect(screen.queryByLabelText(/Primer número/)).toBeNull();
    expect(campo('Impresora de la caja')).toHaveValue(uuid(201));
    // Sin cambios no se puede guardar.
    expect(boton('Guardar')).toBeDisabled();
  });

  it('al escribir una serie nueva pide "Primer número" y avisa que la anterior conserva su número', async () => {
    const s = api({ cajas: [conSeries()] });
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.clear(campo('Serie de boletas'));
    await userEvent.type(campo('Serie de boletas'), 'B002');
    expect(
      screen.getByText('La serie B001 deja de emitir en esta caja y conserva su último número.'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Primer número/), '500');
    await userEvent.click(boton('Guardar'));
    await screen.findByText('Cambios de Caja 1 guardados.');
    expect(s.de('PATCH', `${RUTA_CAJAS}/${uuid(101)}`)).toHaveLength(0);
    expect(s.de('PUT', `${RUTA_CAJAS}/${uuid(101)}/series/BOLETA`)[0]?.cuerpo).toEqual({
      serie: 'B002',
      primerNumero: 500,
    });
  });

  it('reactivar una serie vieja de la caja no pide "Primer número" y la envía sola', async () => {
    const s = api({ cajas: [conSeries()] });
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.clear(campo('Serie de boletas'));
    await userEvent.type(campo('Serie de boletas'), 'B000');
    expect(screen.queryByLabelText(/Primer número/)).toBeNull();
    expect(screen.getByText(/Ya se usó en esta caja: sigue donde se quedó/)).toBeInTheDocument();
    await userEvent.click(boton('Guardar'));
    await screen.findByText('Cambios de Caja 1 guardados.');
    expect(s.de('PUT', `${RUTA_CAJAS}/${uuid(101)}/series/BOLETA`)[0]?.cuerpo).toEqual({
      serie: 'B000',
    });
  });

  it('una serie no se quita: vaciar la que está activa lo explica y no envía nada', async () => {
    const s = api({ cajas: [conSeries()] });
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.clear(campo('Serie de boletas'));
    await userEvent.click(boton('Guardar'));
    expect(
      screen.getByText('Una serie no se quita: escribe otra para cambiarla o deja B001.'),
    ).toBeInTheDocument();
    expect(s.de('PUT', `${RUTA_CAJAS}/${uuid(101)}/series/BOLETA`)).toHaveLength(0);
  });

  it('manda solo lo que cambió: el nombre por PATCH y la impresora en null para quitarla', async () => {
    const s = api({ cajas: [conSeries()], impresoras: [impresora(1, 'Caja')] });
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.clear(campo('Nombre de la caja'));
    await userEvent.type(campo('Nombre de la caja'), 'Caja principal');
    await userEvent.selectOptions(campo('Impresora de la caja'), '');
    await userEvent.click(boton('Guardar'));
    await screen.findByText('Cambios de Caja principal guardados.');
    expect(s.de('PATCH', `${RUTA_CAJAS}/${uuid(101)}`)[0]?.cuerpo).toEqual({
      nombre: 'Caja principal',
      impresoraId: null,
    });
    expect(s.de('PUT', `${RUTA_CAJAS}/${uuid(101)}/series/BOLETA`)).toHaveLength(0);
  });

  it('el primer número distinto de una serie que ya existe se explica en su campo', async () => {
    api(
      { cajas: [conSeries()] },
      {
        [`PUT ${RUTA_CAJAS}/*/series/*`]: () =>
          CONFLICTO([{ campo: 'primerNumero', mensaje: 'La serie empezó en 124' }]),
      },
    );
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.clear(campo('Serie de boletas'));
    await userEvent.type(campo('Serie de boletas'), 'B009');
    await userEvent.type(screen.getByLabelText(/Primer número/), '1');
    await userEvent.click(boton('Guardar'));
    expect(
      await screen.findByText(/Esa serie ya existe y su primer número no se cambia/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Primer número/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('una impresora que dejó de estar activa se dice en el campo', async () => {
    api(
      { cajas: [caja(1, 'Caja 1')], impresoras: [impresora(1, 'Caja')] },
      {
        [`PATCH ${RUTA_CAJAS}/*`]: () =>
          json(422, {
            codigo: 'REFERENCIA_INVALIDA',
            mensaje: 'x',
            campos: [{ campo: 'impresoraId', mensaje: 'Debe ser una impresora activa' }],
          }),
      },
    );
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.selectOptions(campo('Impresora de la caja'), uuid(201));
    await userEvent.click(boton('Guardar'));
    expect(
      await screen.findByText(/Esa impresora ya no está activa en esta sucursal/),
    ).toBeInTheDocument();
    expect(campo('Impresora de la caja')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Ajustes › Cajas: activar y desactivar (criterio 1)', () => {
  it('desactiva una caja libre y la deja en la lista como inactiva, con su serie conservada', async () => {
    const s = api({
      cajas: [
        caja(1, 'Caja 1', {
          series: [{ tipo: 'BOLETA', serie: 'B001', ultimoNumero: 5, activa: true }],
        }),
      ],
    });
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.click(boton('Desactivar caja'));
    expect(
      await screen.findByText(/Caja Caja 1 desactivada\. Conserva sus series/),
    ).toBeInTheDocument();
    expect(s.de('PATCH', `${RUTA_CAJAS}/${uuid(101)}`)[0]?.cuerpo).toEqual({ activa: false });
    const fila = screen.getByRole('button', { name: /^Caja 1/ });
    expect(within(fila).getByText('Inactiva')).toBeInTheDocument();

    await userEvent.click(fila);
    await userEvent.click(boton('Reactivar caja'));
    expect(await screen.findByText('Caja Caja 1 reactivada.')).toBeInTheDocument();
    expect(s.de('PATCH', `${RUTA_CAJAS}/${uuid(101)}`)[1]?.cuerpo).toEqual({ activa: true });
  });

  it('con un turno abierto no se puede desactivar y dice quién la tiene', async () => {
    const s = api({
      cajas: [
        caja(1, 'Caja 1', {
          turnoAbierto: {
            id: uuid(300),
            responsable: { id: uuid(301), nombre: 'Ana' },
            abiertoEn: '2026-11-04T23:02:00.000Z',
          },
        }),
      ],
    });
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    expect(boton('Desactivar caja')).toBeDisabled();
    expect(
      screen.getByText(/Abierta por Ana desde las \d\d:\d\d\. Para desactivarla/),
    ).toBeInTheDocument();
    expect(s.de('PATCH', `${RUTA_CAJAS}/${uuid(101)}`)).toHaveLength(0);
  });

  it('si el servidor dice que está en uso (otro abrió turno), lo explica sin códigos', async () => {
    api(
      { cajas: [caja(1, 'Caja 1')] },
      {
        [`PATCH ${RUTA_CAJAS}/*`]: () =>
          json(409, { codigo: 'EN_USO', mensaje: 'La caja tiene un turno abierto' }),
      },
    );
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.click(boton('Desactivar caja'));
    expect(
      await screen.findByText('No se puede desactivar: tiene un turno abierto'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ciérrala primero y vuelve a desactivarla/)).toBeInTheDocument();
  });

  it('reactivar con 10 cajas activas explica el máximo', async () => {
    api(
      { cajas: [caja(1, 'Caja 1', { activa: false })] },
      {
        [`PATCH ${RUTA_CAJAS}/*`]: () => CONFLICTO([], 'La sucursal ya tiene 10 cajas activas'),
      },
    );
    await abrir();
    await userEvent.click(boton(/^Caja 1/));
    await userEvent.click(boton('Reactivar caja'));
    expect(await screen.findByText('No se puede activar')).toBeInTheDocument();
    expect(screen.getByText(/10 cajas activas, que es el máximo/)).toBeInTheDocument();
  });
});

describe('Ajustes › Emisores: tasa de IGV (criterios 6 y 117)', () => {
  const abrirEmisores = async () => {
    renderApp('/administracion/emisores');
    await screen.findByRole('heading', { name: 'Tasa de IGV' });
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Cargando las tasas' })).toBeNull(),
    );
  };

  it('lista las tasas por fecha "Desde", la que rige hoy marcada con palabras', async () => {
    api({
      tasas: [
        { desde: '2020-01-01', tasa: '18.00' },
        { desde: '2023-03-01', tasa: '10.50' },
        { desde: '2999-01-01', tasa: '18.00' },
      ],
    });
    await abrirEmisores();
    expect(screen.getByText('Cevichería El Sol S.A.C.')).toBeInTheDocument();
    expect(screen.getByText(/RUC 20600000005 · Régimen General/)).toBeInTheDocument();
    const filas = within(screen.getByRole('list', { name: 'Tasas de IGV' })).getAllByRole(
      'listitem',
    );
    expect(filas.map((f) => f.textContent)).toEqual([
      expect.stringContaining('1 de enero de 2999'),
      expect.stringContaining('1 de marzo de 2023'),
      expect.stringContaining('1 de enero de 2020'),
    ]);
    expect(within(filas[0]!).getByText('Desde una fecha futura')).toBeInTheDocument();
    expect(within(filas[1]!).getByText('Vigente')).toBeInTheDocument();
    expect(within(filas[1]!).getByText(/10\.50\s%/)).toBeInTheDocument();
    expect(within(filas[2]!).getByText('Reemplazada')).toBeInTheDocument();
  });

  it('sin tasa, dice que no se puede cobrar y deja agregar la primera', async () => {
    api();
    await abrirEmisores();
    expect(screen.getByText('Aún no hay tasa de IGV')).toBeInTheDocument();
    expect(screen.getByText(/Sin una tasa no se puede cobrar/)).toBeInTheDocument();
  });

  it('agrega la primera tasa desde hoy y acepta la coma decimal; la manda como texto con 2 decimales', async () => {
    const s = api();
    await abrirEmisores();
    await userEvent.click(boton('Agregar tasa'));
    expect(screen.getByRole('heading', { name: 'Nueva tasa de IGV' })).toBeInTheDocument();
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
    expect(campo('Desde')).toHaveValue(hoy);
    expect(campo('Tasa de IGV (%)')).toHaveValue('');
    await userEvent.type(campo('Tasa de IGV (%)'), '10,5');
    await userEvent.click(boton('Guardar tasa'));
    expect(await screen.findByText(/Tasa de 10\.50\s% guardada desde el/)).toBeInTheDocument();
    const llamada = s.de('PUT', `${RUTA_TASAS}/${hoy}`)[0];
    expect(llamada?.cuerpo).toEqual({ tasa: '10.50' });
    // La lista ya la muestra, sin volver a pedirla.
    expect(await screen.findByText('Vigente')).toBeInTheDocument();
    expect(s.de('GET', RUTA_TASAS)).toHaveLength(1);
  });

  it('una tasa nueva propone mañana como fecha: hoy ya pudo tener ventas', async () => {
    api({ tasas: [{ desde: '2020-01-01', tasa: '18.00' }] });
    await abrirEmisores();
    await userEvent.click(boton('Agregar tasa'));
    const hoy = new Date();
    const manana = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(
      new Date(hoy.getTime() + 24 * 60 * 60 * 1000),
    );
    expect(campo('Desde')).toHaveValue(manana);
  });

  it('no envía nada con una tasa o una fecha que no sirven', async () => {
    const s = api({ tasas: [{ desde: '2020-01-01', tasa: '18.00' }] });
    await abrirEmisores();
    await userEvent.click(boton('Agregar tasa'));
    await userEvent.click(boton('Guardar tasa'));
    expect(screen.getByText('Escribe la tasa, por ejemplo 18')).toBeInTheDocument();

    await userEvent.type(campo('Tasa de IGV (%)'), '31');
    await userEvent.click(boton('Guardar tasa'));
    expect(screen.getByText(/Escribe un porcentaje de 0\.01 a 30/)).toBeInTheDocument();

    await userEvent.clear(campo('Desde'));
    await userEvent.clear(campo('Tasa de IGV (%)'));
    await userEvent.type(campo('Tasa de IGV (%)'), '18');
    await userEvent.click(boton('Guardar tasa'));
    expect(screen.getByText('Elige la fecha desde la que rige la tasa')).toBeInTheDocument();
    expect(s.de('PUT', `${RUTA_TASAS}/2020-01-01`)).toHaveLength(0);
    expect(s.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(0);
  });

  it('cambia una tasa existente sin tocar su fecha', async () => {
    const s = api({ tasas: [{ desde: '2999-01-01', tasa: '18.00' }] });
    await abrirEmisores();
    await userEvent.click(screen.getByRole('button', { name: /1 de enero de 2999/ }));
    expect(
      screen.getByRole('heading', { name: 'Tasa desde el 1 de enero de 2999' }),
    ).toBeInTheDocument();
    expect(campo('Desde')).toHaveAttribute('readonly');
    expect(campo('Tasa de IGV (%)')).toHaveValue('18.00');
    await userEvent.clear(campo('Tasa de IGV (%)'));
    await userEvent.type(campo('Tasa de IGV (%)'), '10');
    await userEvent.click(boton('Guardar'));
    expect(await screen.findByText(/cambiada a 10\.00\s%/)).toBeInTheDocument();
    expect(s.de('PUT', `${RUTA_TASAS}/2999-01-01`)[0]?.cuerpo).toEqual({ tasa: '10.00' });
  });

  it('si el emisor ya emitió desde esa fecha, lo dice en el campo "Desde"', async () => {
    api(
      {},
      {
        [`PUT ${RUTA_TASAS}/*`]: () =>
          CONFLICTO([
            { campo: 'desde', mensaje: 'Debe ser posterior al último comprobante emitido' },
          ]),
      },
    );
    await abrirEmisores();
    await userEvent.click(boton('Agregar tasa'));
    await userEvent.type(campo('Tasa de IGV (%)'), '18');
    await userEvent.click(boton('Guardar tasa'));
    expect(
      await screen.findByText(/ya emitió comprobantes en esa fecha o después/),
    ).toBeInTheDocument();
    expect(campo('Desde')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un emisor del Nuevo RUS no usa tasa: lo explica y no deja agregarla', async () => {
    const s = api({ emisores: [emisor({ regimen: 'NUEVO_RUS' })] });
    renderApp('/administracion/emisores');
    expect(await screen.findByText('Este emisor no usa tasa de IGV')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar tasa' })).toBeNull();
    expect(s.de('GET', RUTA_TASAS)).toHaveLength(0);
  });

  it('con varios emisores, el selector cambia las tasas que se ven', async () => {
    const OTRO = uuid(901);
    api(
      {
        emisores: [
          emisor(),
          emisor({ id: OTRO, ruc: '20100000009', razonSocial: 'Pollería Norte' }),
        ],
        tasas: [{ desde: '2020-01-01', tasa: '18.00' }],
      },
      {
        [`GET /emisores/${OTRO}/tasas-igv`]: () =>
          json(200, [{ desde: '2021-05-01', tasa: '10.50' }]),
      },
    );
    await abrirEmisores();
    expect(screen.getByText(/1 de enero de 2020/)).toBeInTheDocument();
    await userEvent.selectOptions(campo('Emisor'), OTRO);
    expect(await screen.findByText(/1 de mayo de 2021/)).toBeInTheDocument();
    expect(screen.queryByText(/1 de enero de 2020/)).toBeNull();
  });

  it('sin emisores, lo dice', async () => {
    api({ emisores: [] });
    renderApp('/administracion/emisores');
    expect(await screen.findByText('Aún no hay emisores')).toBeInTheDocument();
  });
});
