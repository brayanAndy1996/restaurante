import type {
  QrMesaDeLista,
  QrMesasRespuesta,
  SesionRespuesta,
  ZonaRespuesta,
} from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';

// spec: 005-carta-web-mesa, criterios 75 y 76 en la interfaz (pruebas no protegidas de Ajustes › Mapa de mesas ›
// QR de las mesas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const SITIO = 'http://localhost:3001';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const Z_SALON = uuid(1);
const Z_TERRAZA = uuid(2);
const RUTA = `/sucursales/${ID.sucursalA}`;
const RUTA_QR = `${RUTA}/qr-mesas`;

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

/** Un código de 22 caracteres como los que genera la API. */
const codigo = (n: number) => `Zq${String(n).padStart(2, '0')}abcdefghijklmnopqr`;

const mesa = (
  n: number,
  nombre: string,
  zona: { id: string; nombre: string },
  conCodigo = true,
): QrMesaDeLista => ({
  mesaId: uuid(100 + n),
  zona,
  nombre,
  codigo: conCodigo ? codigo(n) : null,
  url: conCodigo ? `${SITIO}/m/${codigo(n)}` : null,
  generadoEn: conCodigo ? '2026-11-02T15:00:00.000Z' : null,
});

const SALON = { id: Z_SALON, nombre: 'Salón principal' };
const TERRAZA = { id: Z_TERRAZA, nombre: 'Terraza' };

const lista = (
  mesas: QrMesaDeLista[],
  extra: Partial<QrMesasRespuesta> = {},
): QrMesasRespuesta => ({
  sucursal: { id: ID.sucursalA, nombre: 'Miraflores' },
  cartaPublicada: true,
  mesas,
  ...extra,
});

/** API de mentira con memoria: crea los códigos que faltan y cambia el de una mesa como lo haría la real. */
function api(inicial: QrMesasRespuesta, respuestas: Record<string, Manejador> = {}) {
  let datos = structuredClone(inicial);
  let siguiente = 50;
  const s = servidor({
    'GET /sesion': () => json(200, administrador()),
    [`GET ${RUTA_QR}`]: () => json(200, datos),
    [`POST ${RUTA_QR}`]: () => {
      datos = {
        ...datos,
        mesas: datos.mesas.map((m) => {
          if (m.codigo) return m;
          const c = codigo(siguiente++);
          return {
            ...m,
            codigo: c,
            url: `${SITIO}/m/${c}`,
            generadoEn: '2026-11-03T15:00:00.000Z',
          };
        }),
      };
      return json(200, datos);
    },
    [`POST ${RUTA}/mesas/*/qr`]: ({ url }) => {
      const mesaId = url.pathname.split('/').at(-2);
      const c = codigo(siguiente++);
      datos = {
        ...datos,
        mesas: datos.mesas.map((m) =>
          m.mesaId === mesaId
            ? { ...m, codigo: c, url: `${SITIO}/m/${c}`, generadoEn: '2026-11-03T16:00:00.000Z' }
            : m,
        ),
      };
      return json(201, {
        mesaId,
        codigo: c,
        url: `${SITIO}/m/${c}`,
        generadoEn: '2026-11-03T16:00:00.000Z',
      });
    },
    ...respuestas,
  });
  return { ...s, datos: () => datos };
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('imprime-hoja-qr');
});

const MESAS = [
  mesa(1, '1', SALON),
  mesa(2, '2', SALON),
  mesa(3, '3', SALON, false),
  mesa(4, '4', TERRAZA),
];

describe('QR de las mesas: lista por zona (criterio 75)', () => {
  it('desde el mapa de mesas se llega a "QR de las mesas"', async () => {
    const zona: ZonaRespuesta = {
      id: Z_SALON,
      sucursalId: ID.sucursalA,
      nombre: 'Salón principal',
      orden: 1,
      columnas: 4,
      filas: 3,
      activa: true,
      mesas: [],
    };
    api(lista(MESAS), { [`GET ${RUTA}/zonas`]: () => json(200, [zona]) });
    renderApp('/administracion/mesas');
    await userEvent.click(await screen.findByRole('link', { name: 'QR de las mesas' }));
    expect(
      await screen.findByRole('heading', { name: 'QR de las mesas', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a Mapa de mesas' })).toHaveAttribute(
      'href',
      '/administracion/mesas',
    );
  });

  it('muestra las mesas agrupadas por zona, cada una con su QR dibujado en el equipo', async () => {
    api(lista(MESAS));
    renderApp('/administracion/mesas/qr');
    const salon = await screen.findByRole('list', { name: 'Mesas de Salón principal' });
    const terraza = screen.getByRole('list', { name: 'Mesas de Terraza' });
    expect(within(salon).getAllByRole('listitem')).toHaveLength(3);
    expect(within(terraza).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: /Salón principal/ })).toHaveTextContent('3 mesas');
    expect(screen.getByRole('heading', { name: /Terraza/ })).toHaveTextContent('1 mesa');
    // Se dibujan solo las que tienen código.
    expect(await screen.findAllByRole('img', { name: /Código QR de la mesa/ })).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Código QR de la mesa 4' })).toBeInTheDocument();
    expect(within(salon).getAllByText('QR creado el 02/11/2026')).toHaveLength(2);
    // La mesa sin código lo dice con palabras y no ofrece cambiarlo.
    expect(within(salon).getByText('Sin QR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar QR de la mesa 3' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cambiar QR de la mesa 1' })).toBeInTheDocument();
  });

  it('avisa que la carta no está publicada y lleva a publicarla', async () => {
    api(lista(MESAS, { cartaPublicada: false }));
    renderApp('/administracion/mesas/qr');
    expect(
      await screen.findByText('La carta de esta sucursal no está publicada'),
    ).toBeInTheDocument();
    expect(screen.getByText(/«La carta no está disponible»/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Publicar la carta' })).toHaveAttribute(
      'href',
      '/administracion/carta-web',
    );
  });

  it('con la carta publicada no avisa nada', async () => {
    api(lista(MESAS));
    renderApp('/administracion/mesas/qr');
    await screen.findByRole('list', { name: 'Mesas de Salón principal' });
    expect(screen.queryByText('La carta de esta sucursal no está publicada')).toBeNull();
  });

  it('sin mesas lo dice y manda al mapa', async () => {
    api(lista([]));
    renderApp('/administracion/mesas/qr');
    expect(await screen.findByText('Aún no hay mesas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al mapa de mesas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Imprimir la hoja' })).toBeNull();
  });

  it('si falta configurar el sitio de la carta (503) lo dice en palabras y no reintenta solo', async () => {
    const s = api(lista(MESAS), {
      [`GET ${RUTA_QR}`]: () =>
        json(503, { codigo: 'CONFIGURACION_INCOMPLETA', mensaje: 'Falta CARTA_WEB_URL' }),
    });
    renderApp('/administracion/mesas/qr');
    expect(await screen.findByText('No pudimos cargar los QR')).toBeInTheDocument();
    expect(
      screen.getByText(/Falta configurar el sitio donde vive la carta web/),
    ).toBeInTheDocument();
    expect(s.de('GET', RUTA_QR)).toHaveLength(1);
  });

  it('sin sucursal activa pide elegirla', async () => {
    api(lista(MESAS), {
      'GET /sesion': () => json(200, { ...administrador(), sucursal: null, sucursales: [] }),
    });
    renderApp('/administracion/mesas/qr');
    expect(await screen.findByText('Elige una sucursal')).toBeInTheDocument();
  });
});

describe('QR de las mesas: crear los que faltan (criterio 75)', () => {
  it('crea los códigos que faltan y avisa cuántos', async () => {
    const s = api(lista(MESAS));
    renderApp('/administracion/mesas/qr');
    expect(await screen.findByText('1 mesa todavía no tiene QR')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear los QR que faltan' }));
    expect(await screen.findByText(/se crearon el QR de 1 mesa/)).toBeInTheDocument();
    expect(s.de('POST', RUTA_QR)).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Código QR/ })).toHaveLength(4));
    expect(screen.queryByText('Sin QR')).toBeNull();
    expect(screen.queryByText('1 mesa todavía no tiene QR')).toBeNull();
  });

  it('si ninguna mesa tiene QR, "Crear los QR que faltan" es la acción principal y no se ofrece imprimir', async () => {
    api(lista([mesa(1, '1', SALON, false), mesa(2, '2', SALON, false)]));
    renderApp('/administracion/mesas/qr');
    expect(await screen.findByText('Tus mesas todavía no tienen QR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Imprimir la hoja' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Crear los QR que faltan' }));
    expect(await screen.findByText(/se crearon los QR de 2 mesas/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Imprimir la hoja' })).toBeInTheDocument();
  });

  it('si la API falla lo dice y deja reintentar', async () => {
    let intento = 0;
    api(lista(MESAS), {
      [`POST ${RUTA_QR}`]: () =>
        ++intento === 1
          ? json(403, { codigo: 'PROHIBIDO', mensaje: 'x' })
          : json(
              200,
              lista(MESAS.map((m) => ({ ...mesa(3, '3', SALON), ...m, mesaId: m.mesaId }))),
            ),
    });
    renderApp('/administracion/mesas/qr');
    await userEvent.click(await screen.findByRole('button', { name: 'Crear los QR que faltan' }));
    expect(await screen.findByText('No pudimos crear los QR')).toBeInTheDocument();
    expect(screen.getByText('No tienes permiso para hacer esto.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear los QR que faltan' })).toBeEnabled();
  });
});

describe('QR de las mesas: cambiar el QR (criterio 75, HU-42)', () => {
  it('pide confirmación con lo que pasará y no cambia nada si se cancela', async () => {
    const s = api(lista(MESAS));
    renderApp('/administracion/mesas/qr');
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar QR de la mesa 2' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Cambiar el QR de la mesa 2?' });
    expect(
      within(dialogo).getByText(
        'El QR impreso de la mesa 2 dejará de funcionar. Tendrás que imprimir y pegar el nuevo.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });

  it('al confirmar pide un código nuevo con clave de idempotencia y marca la mesa para imprimirla otra vez', async () => {
    const s = api(lista(MESAS));
    renderApp('/administracion/mesas/qr');
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar QR de la mesa 2' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Cambiar el QR de la mesa 2?' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cambiar QR' }));
    expect(await screen.findByText(/El QR de la mesa 2 cambió/)).toBeInTheDocument();
    const llamada = s.de('POST', `${RUTA}/mesas/${uuid(102)}/qr`);
    expect(llamada).toHaveLength(1);
    expect(llamada[0]?.cabeceras.get('Idempotency-Key')).toBeTruthy();
    expect(screen.getByText('QR nuevo: imprímelo')).toBeInTheDocument();
    // La lista usa el código nuevo, no el anterior.
    expect(s.datos().mesas.find((m) => m.mesaId === uuid(102))?.codigo).not.toBe(codigo(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('una mesa desactivada no se puede cambiar y la ventana lo dice sin cerrarse', async () => {
    const s = api(lista(MESAS), {
      [`POST ${RUTA}/mesas/*/qr`]: () => json(409, { codigo: 'CONFLICTO', mensaje: 'x' }),
    });
    renderApp('/administracion/mesas/qr');
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar QR de la mesa 1' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Cambiar el QR de la mesa 1?' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cambiar QR' }));
    expect(await within(dialogo).findByText(/La mesa 1 está desactivada/)).toBeInTheDocument();
    expect(s.de('POST', `${RUTA}/mesas/${uuid(101)}/qr`)).toHaveLength(1);
    expect(screen.queryByText('QR nuevo: imprímelo')).toBeNull();
  });

  it('si la red se corta reintenta con la misma clave y no cambia el código dos veces', async () => {
    let intento = 0;
    const s = api(lista(MESAS), {
      [`POST ${RUTA}/mesas/*/qr`]: ({ url }) =>
        ++intento <= 2
          ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(201, {
              mesaId: url.pathname.split('/').at(-2),
              codigo: codigo(60),
              url: `${SITIO}/m/${codigo(60)}`,
              generadoEn: '2026-11-03T16:00:00.000Z',
            }),
    });
    renderApp('/administracion/mesas/qr');
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar QR de la mesa 4' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Cambiar el QR de la mesa 4?' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cambiar QR' }));
    expect(await screen.findByText(/El QR de la mesa 4 cambió/)).toBeInTheDocument();
    const llamadas = s.de('POST', `${RUTA}/mesas/${uuid(104)}/qr`);
    expect(llamadas).toHaveLength(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
  });
});

describe('QR de las mesas: imprimir la hoja (criterios 75 y 76)', () => {
  it('"Imprimir la hoja" abre el diálogo de impresión del navegador cuando todos los QR están dibujados', async () => {
    api(lista(MESAS));
    const imprimir = vi.fn();
    vi.stubGlobal('print', imprimir);
    renderApp('/administracion/mesas/qr');
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Código QR/ })).toHaveLength(3));
    const boton = await screen.findByRole('button', { name: 'Imprimir la hoja' });
    await waitFor(() => expect(boton).toBeEnabled());
    await userEvent.click(boton);
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  it('cada mesa con QR trae su tarjeta de impresión: sucursal, "Mesa N", el QR y la frase', async () => {
    api(lista(MESAS));
    renderApp('/administracion/mesas/qr');
    const salon = await screen.findByRole('list', { name: 'Mesas de Salón principal' });
    const [primera, segunda, sinQr] = within(salon).getAllByRole('listitem');
    for (const tarjeta of [primera!, segunda!]) {
      expect(within(tarjeta).getByText('Miraflores')).toBeInTheDocument();
      expect(
        within(tarjeta).getByText('Escanea para ver la carta y llamar al mozo'),
      ).toBeInTheDocument();
    }
    expect(within(primera!).getByText('Mesa 1')).toBeInTheDocument();
    // Lo que solo sirve en pantalla lleva la marca que el CSS de impresión oculta; lo de la mesa sin QR no se imprime.
    expect(within(primera!).getByRole('button', { name: 'Cambiar QR de la mesa 1' })).toHaveClass(
      'qr-pantalla',
    );
    expect(within(primera!).getByText('Miraflores')).toHaveClass('qr-impreso');
    expect(sinQr).toHaveClass('qr-mesa--sin-codigo');
  });

  it('mientras la pantalla está abierta, imprimir saca solo la hoja; al salir se quita la marca', async () => {
    api(lista(MESAS));
    const { unmount } = renderApp('/administracion/mesas/qr');
    await screen.findByRole('list', { name: 'Mesas de Salón principal' });
    expect(document.documentElement).toHaveClass('imprime-hoja-qr');
    unmount();
    expect(document.documentElement).not.toHaveClass('imprime-hoja-qr');
  });
});
