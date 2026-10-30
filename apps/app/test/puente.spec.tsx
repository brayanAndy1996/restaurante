import type {
  EstadoImpresionRespuesta,
  ImpresoraRespuesta,
  PuenteRespuesta,
  TrabajoResumen,
  VinculacionRespuesta,
} from '@restaurante/contratos';
import { armarQrPuente, leerQrPuente } from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';

// spec: 004-salon-cocina, criterios 106 a 108, 127, 128, 137 y 139 en la interfaz (pruebas no protegidas del
// puente, la página de prueba y "Trabajos de hoy" de Ajustes › Impresión).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RAIZ = `/sucursales/${ID.sucursalA}`;
const RUTA_VINCULACION = `${RAIZ}/vinculaciones-puente`;
const RUTA_PUENTES = `${RAIZ}/puentes`;
const AHORA = '2026-10-30T17:00:00.000Z';
const PUENTE_ID = uuid(300);

const administrador = () =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

const segundosAntes = (s: number) => new Date(Date.parse(AHORA) - s * 1000).toISOString();

function estadoDe(
  puente: null | { conectado: boolean; haceSegundos: number | null; id?: string; nombre?: string },
): EstadoImpresionRespuesta {
  return {
    ahora: AHORA,
    puente: puente
      ? {
          id: puente.id ?? PUENTE_ID,
          nombre: puente.nombre ?? 'Puente de Cocina',
          ultimaSenalEn: puente.haceSegundos === null ? null : segundosAntes(puente.haceSegundos),
          conectado: puente.conectado,
        }
      : null,
    impresoras: [],
  };
}

const puenteDe = (extra: Partial<PuenteRespuesta> = {}): PuenteRespuesta => ({
  id: PUENTE_ID,
  nombre: 'Puente de Cocina',
  activo: true,
  modelo: 'Pixel 6',
  versionApp: '1.2.0',
  vinculadoEn: segundosAntes(86_400),
  revocadoEn: null,
  ultimaSenalEn: segundosAntes(12),
  ...extra,
});

/** Un código de vinculación que vence `segundos` después de ahora (la hora de la prueba). */
const codigo = (segundos = 600, token = 'vi.secreto-de-prueba'): VinculacionRespuesta => ({
  token,
  qr: armarQrPuente('https://api.ejemplo.pe', token),
  expiraEn: new Date(Date.now() + segundos * 1000).toISOString(),
});

interface Estado {
  estado: EstadoImpresionRespuesta;
  puentes: PuenteRespuesta[];
  impresoras: ImpresoraRespuesta[];
  trabajos: TrabajoResumen[];
}

const impresora = (n: number, extra: Partial<ImpresoraRespuesta> = {}): ImpresoraRespuesta => ({
  id: uuid(100 + n),
  sucursalId: ID.sucursalA,
  nombre: n === 1 ? 'Cocina' : `Impresora ${n}`,
  conexion: { tipo: 'RED', host: `192.168.1.${50 + n}`, puerto: 9100 },
  anchoMm: 80,
  juegoCaracteres: 'PC850',
  gaveta: false,
  activa: true,
  estado: 'LISTA',
  estadoDesde: segundosAntes(3600),
  pendientes: 0,
  ...extra,
});

const trabajo = (n: number, extra: Partial<TrabajoResumen> = {}): TrabajoResumen => ({
  id: uuid(700 + n),
  tipo: 'COMANDA',
  impresora: { id: uuid(101), nombre: 'Cocina' },
  mesa: '4',
  estado: 'IMPRESO',
  intentos: 0,
  creadoEn: '2026-10-30T17:31:00.000Z',
  impresoEn: '2026-10-30T17:31:02.000Z',
  reimpresionDe: null,
  ordenId: null,
  envioNumero: null,
  ...extra,
});

function api(
  inicial: Partial<Estado> = {},
  respuestas: Record<string, Manejador> = {},
): ReturnType<typeof servidor> & { datos: Estado } {
  const datos: Estado = {
    estado: estadoDe(null),
    puentes: [],
    impresoras: [impresora(1)],
    trabajos: [],
    ...inicial,
  };
  const s = servidor({
    'GET /sesion': () => json(200, administrador()),
    [`GET ${RAIZ}/impresoras`]: () => json(200, datos.impresoras),
    [`GET ${RAIZ}/estaciones-destino`]: () => json(200, []),
    [`GET ${RAIZ}/impresion`]: () => json(200, { impresoraCajaId: null }),
    'GET /impresion/estado': () => json(200, datos.estado),
    [`GET ${RUTA_PUENTES}`]: () => json(200, datos.puentes),
    'GET /impresion/trabajos': ({ url }) => {
      const filtro = url.searchParams.get('estado');
      return json(
        200,
        datos.trabajos.filter((t) => !filtro || t.estado === filtro),
      );
    },
    ...respuestas,
  });
  return Object.assign(s, { datos });
}

async function abrir() {
  renderApp('/administracion/impresion');
  return screen.findByRole('region', { name: 'Puente de impresión' });
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Puente de impresión: estado (criterios 121 y 137)', () => {
  it('sin puente, lo dice y ofrece vincular; no ofrece revocar', async () => {
    api();
    const puente = await abrir();
    expect(await within(puente).findByText('Sin puente')).toBeVisible();
    expect(puente).toHaveTextContent('Sin él, los tickets quedan en la cola');
    expect(within(puente).getByRole('button', { name: 'Vincular puente' })).toBeVisible();
    expect(within(puente).queryByRole('button', { name: 'Revocar' })).toBeNull();
  });

  it('conectado: nombre, modelo, versión y la última señal con la hora de la API', async () => {
    api({ estado: estadoDe({ conectado: true, haceSegundos: 12 }), puentes: [puenteDe()] });
    const puente = await abrir();
    expect(await within(puente).findByText('Puente de Cocina')).toBeVisible();
    expect(within(puente).getByText('Conectado')).toBeVisible();
    expect(puente).toHaveTextContent('Última señal hace 12 s.');
    expect(await within(puente).findByText('Pixel 6 · app 1.2.0')).toBeVisible();
    expect(within(puente).getByRole('button', { name: 'Revocar' })).toBeVisible();
  });

  it('sin señal: lo dice con palabras, cuánto hace y que los tickets esperan', async () => {
    api({ estado: estadoDe({ conectado: false, haceSegundos: 150 }) });
    const puente = await abrir();
    expect(await within(puente).findByText('Sin señal')).toBeVisible();
    expect(puente).toHaveTextContent('Última señal hace 2 min.');
    expect(puente).toHaveTextContent('Los tickets esperan en la cola');
    expect(within(puente).queryByText('Conectado')).toBeNull();
  });

  it('un puente que nunca mandó señal lo dice', async () => {
    api({ estado: estadoDe({ conectado: false, haceSegundos: null }) });
    const puente = await abrir();
    expect(await within(puente).findByText('Sin señal')).toBeVisible();
    expect(puente).toHaveTextContent('Todavía no mandó ninguna señal.');
  });

  it('si no puede cargar el estado, lo dice y deja reintentar', async () => {
    let falla = true;
    api(
      {},
      {
        'GET /impresion/estado': () =>
          falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, estadoDe(null)),
      },
    );
    const puente = await abrir();
    expect(await within(puente).findByText('No pudimos cargar el puente')).toBeVisible();
    falla = false;
    await userEvent.click(within(puente).getByRole('button', { name: 'Reintentar' }));
    expect(await within(puente).findByText('Sin puente')).toBeVisible();
  });
});

describe('Vincular puente: QR, texto y cuenta regresiva (criterios 106 y 137)', () => {
  it('pide el código con una clave de idempotencia y muestra el QR, el texto para copiar y los 10 minutos', async () => {
    const vinculacion = codigo();
    const s = api({}, { [`POST ${RUTA_VINCULACION}`]: () => json(201, vinculacion) });
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));

    const qr = await within(puente).findByRole('img', {
      name: 'Código QR para vincular el puente',
    });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    // Es un dibujo de verdad: un trazo con módulos oscuros dentro de un recuadro cuadrado.
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    const [, , ancho, alto] = (qr.getAttribute('viewBox') ?? '').split(' ');
    expect(ancho).toBe(alto);

    // El texto que se copia es exactamente el de la API, y el puente puede leerlo.
    const texto = within(puente).getByLabelText('Si no puedes escanear, copia este texto');
    expect(texto).toHaveValue(vinculacion.qr);
    expect(texto).toHaveAttribute('readonly');
    expect(leerQrPuente((texto as HTMLTextAreaElement).value)).toEqual({
      api: 'https://api.ejemplo.pe',
      token: 'vi.secreto-de-prueba',
    });

    expect(within(puente).getByRole('timer')).toHaveTextContent('10:00');
    const [llamada] = s.de('POST', RUTA_VINCULACION);
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(llamada?.cabeceras.get('Authorization')).toBeTruthy();
    // Con el código a la vista, el botón de vincular se reemplaza por "Cancelar".
    expect(within(puente).queryByRole('button', { name: 'Vincular puente' })).toBeNull();
    expect(within(puente).getByRole('button', { name: 'Cancelar' })).toBeVisible();
  });

  it('copia el texto con un toque y lo confirma con palabras', async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: escribir } });
    const vinculacion = codigo();
    api({}, { [`POST ${RUTA_VINCULACION}`]: () => json(201, vinculacion) });
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));
    await userEvent.click(await within(puente).findByRole('button', { name: 'Copiar texto' }));
    expect(escribir).toHaveBeenCalledWith(vinculacion.qr);
    expect(await within(puente).findByRole('button', { name: 'Texto copiado' })).toBeVisible();
  });

  it('la cuenta regresiva baja cada segundo, avisa en el último minuto y al llegar a cero retira el código', async () => {
    // Solo el reloj y los intervalos son de mentira: las esperas de la prueba siguen siendo reales.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = api({}, { [`POST ${RUTA_VINCULACION}`]: () => json(201, codigo(600)) });
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));
    await within(puente).findByRole('img', { name: 'Código QR para vincular el puente' });
    const reloj = within(puente).getByRole('timer');
    expect(reloj).toHaveTextContent('10:00');
    expect(puente).not.toHaveTextContent('Queda menos de un minuto');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(reloj).toHaveTextContent('9:59');
    expect(reloj).toHaveAccessibleName('Vence en 9 minutos con 59 segundos');

    await act(async () => {
      vi.advanceTimersByTime(539_000);
    });
    expect(reloj).toHaveTextContent('1:00');
    expect(puente).toHaveTextContent('Queda menos de un minuto.');

    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(reloj).toHaveTextContent('0:01');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // Vencido: el QR y el texto desaparecen y se ofrece uno nuevo.
    expect(within(puente).getByText('El código venció')).toBeVisible();
    expect(within(puente).queryByRole('img', { name: /Código QR/ })).toBeNull();
    expect(within(puente).queryByLabelText(/copia este texto/)).toBeNull();
    expect(within(puente).queryByRole('timer')).toBeNull();

    // "Generar otro código" es un código nuevo a propósito: otra petición con otra clave.
    s.poner(`POST ${RUTA_VINCULACION}`, () =>
      json(201, {
        ...codigo(600, 'vi.segundo'),
        expiraEn: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    vi.useRealTimers();
    await userEvent.click(within(puente).getByRole('button', { name: 'Generar otro código' }));
    await within(puente).findByRole('img', { name: 'Código QR para vincular el puente' });
    const [primera, segunda] = s.de('POST', RUTA_VINCULACION);
    expect(segunda?.cabeceras.get('Idempotency-Key')).not.toBe(
      primera?.cabeceras.get('Idempotency-Key'),
    );
    expect(within(puente).getByLabelText(/copia este texto/)).toHaveValue(
      armarQrPuente('https://api.ejemplo.pe', 'vi.segundo'),
    );
  });

  it('con un puente ya vinculado avisa que el nuevo lo reemplaza', async () => {
    api(
      { estado: estadoDe({ conectado: true, haceSegundos: 5 }), puentes: [puenteDe()] },
      { [`POST ${RUTA_VINCULACION}`]: () => json(201, codigo()) },
    );
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));
    expect(await within(puente).findByText('Reemplazará a Puente de Cocina')).toBeVisible();
  });

  it('si no se pudo generar el código, lo dice y reintenta con la misma clave', async () => {
    let intentos = 0;
    const s = api(
      {},
      {
        [`POST ${RUTA_VINCULACION}`]: () => {
          intentos += 1;
          return intentos === 1
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' })
            : json(201, codigo());
        },
      },
    );
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));
    expect(await within(puente).findByText('No pudimos generar el código')).toBeVisible();
    expect(within(puente).queryByRole('img', { name: /Código QR/ })).toBeNull();
    await userEvent.click(within(puente).getByRole('button', { name: 'Reintentar' }));
    await within(puente).findByRole('img', { name: 'Código QR para vincular el puente' });
    const [primera, segunda] = s.de('POST', RUTA_VINCULACION);
    expect(segunda?.cabeceras.get('Idempotency-Key')).toBe(
      primera?.cabeceras.get('Idempotency-Key'),
    );
  });

  it('si falta la dirección pública del sistema (503), lo dice en palabras y no lo reintenta', async () => {
    const s = api(
      {},
      {
        [`POST ${RUTA_VINCULACION}`]: () =>
          json(503, {
            codigo: 'CONFIGURACION_INCOMPLETA',
            mensaje: 'Falta la dirección pública de la API',
          }),
      },
    );
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));
    expect(await within(puente).findByText('No pudimos generar el código')).toBeVisible();
    expect(
      within(puente).getByText(
        'Falta configurar la dirección pública del sistema. Avísale a soporte.',
      ),
    ).toBeVisible();
    // No es un corte de paso: repetir no lo arregla, así que sale una sola petición.
    expect(s.de('POST', RUTA_VINCULACION)).toHaveLength(1);
    expect(within(puente).queryByRole('img', { name: /Código QR/ })).toBeNull();
  });

  it('cancelar cierra el panel sin tocar nada más', async () => {
    api({}, { [`POST ${RUTA_VINCULACION}`]: () => json(201, codigo()) });
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));
    await within(puente).findByRole('img', { name: /Código QR/ });
    await userEvent.click(within(puente).getByRole('button', { name: 'Cancelar' }));
    expect(within(puente).queryByRole('img', { name: /Código QR/ })).toBeNull();
    expect(within(puente).getByRole('button', { name: 'Vincular puente' })).toBeVisible();
  });

  it('cuando el puente se vincula, se cierra y dice "Puente vinculado"', async () => {
    // El sondeo cada 3 segundos es un intervalo de mentira que la prueba adelanta.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const s = api({}, { [`POST ${RUTA_VINCULACION}`]: () => json(201, codigo()) });
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Vincular puente' }));
    await within(puente).findByRole('img', { name: /Código QR/ });

    // El puente escaneó el código: el estado de la API ya trae un puente activo nuevo.
    s.datos.estado = estadoDe({
      conectado: true,
      haceSegundos: 1,
      id: uuid(301),
      nombre: 'Puente de la barra',
    });
    s.datos.puentes = [puenteDe({ id: uuid(301), nombre: 'Puente de la barra' })];
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    vi.useRealTimers();

    const aviso = await within(puente).findByText('Puente vinculado');
    expect(aviso).toBeVisible();
    expect(puente).toHaveTextContent('Puente de la barra ya puede recibir los tickets');
    expect(within(puente).queryByRole('img', { name: /Código QR/ })).toBeNull();
    expect(within(puente).getByText('Conectado')).toBeVisible();
  });
});

describe('Revocar el puente (criterio 108)', () => {
  const conPuente = () =>
    api({ estado: estadoDe({ conectado: true, haceSegundos: 5 }), puentes: [puenteDe()] }, {});

  it('pide confirmación que dice qué pasará, y cancelar no manda nada', async () => {
    const s = conPuente();
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Revocar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Revocar el puente' });
    expect(dialogo).toHaveTextContent('Puente de Cocina dejará de recibir tickets');
    expect(dialogo).toHaveTextContent('esperarán hasta que vincules otro puente');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(s.llamadas.filter((l) => l.metodo === 'DELETE')).toHaveLength(0);
    expect(within(puente).getByText('Conectado')).toBeVisible();
  });

  it('confirmar revoca ese puente con una clave de idempotencia y lo deja sin puente', async () => {
    const s = conPuente();
    s.poner(`DELETE ${RUTA_PUENTES}/${PUENTE_ID}`, () => {
      s.datos.estado = estadoDe(null);
      s.datos.puentes = [puenteDe({ activo: false, revocadoEn: AHORA })];
      return json(204);
    });
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Revocar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Revocar el puente' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Revocar' }));

    expect(await within(puente).findByText('Puente revocado')).toBeVisible();
    const [llamada] = s.de('DELETE', `${RUTA_PUENTES}/${PUENTE_ID}`);
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(await within(puente).findByText('Sin puente')).toBeVisible();
    expect(within(puente).queryByRole('button', { name: 'Revocar' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Revocar el puente' })).toBeNull();
  });

  it('un corte al revocar reintenta con la misma clave', async () => {
    const s = conPuente();
    let intentos = 0;
    s.poner(`DELETE ${RUTA_PUENTES}/${PUENTE_ID}`, () => {
      intentos += 1;
      return intentos < 3 ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(204);
    });
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Revocar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Revocar el puente' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Revocar' }));
    await within(puente).findByText('Puente revocado');
    const llamadas = s.de('DELETE', `${RUTA_PUENTES}/${PUENTE_ID}`);
    expect(llamadas).toHaveLength(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
  });

  it('si falla, lo dice dentro de la confirmación y el puente sigue ahí', async () => {
    const s = conPuente();
    s.poner(`DELETE ${RUTA_PUENTES}/${PUENTE_ID}`, () =>
      json(403, { codigo: 'PROHIBIDO', mensaje: 'No' }),
    );
    const puente = await abrir();
    await userEvent.click(await within(puente).findByRole('button', { name: 'Revocar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Revocar el puente' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Revocar' }));
    expect(await within(dialogo).findByText('No pudimos revocar el puente')).toBeVisible();
    expect(within(puente).queryByText('Puente revocado')).toBeNull();
    expect(within(puente).getByText('Conectado')).toBeVisible();
  });
});

describe('Imprimir página de prueba (criterio 127)', () => {
  const RUTA_PRUEBA = `${RAIZ}/impresoras/${uuid(101)}/prueba`;

  async function abrirFicha(nombre = 'Cocina') {
    renderApp('/administracion/impresion');
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(nombre) }));
    return screen.findByRole('button', { name: 'Imprimir página de prueba' });
  }

  it('manda la prueba con una clave de idempotencia y dice dónde mirar', async () => {
    const s = api(
      { estado: estadoDe({ conectado: true, haceSegundos: 3 }) },
      { [`POST ${RUTA_PRUEBA}`]: () => json(201, { trabajoId: uuid(900) }) },
    );
    const imprimir = await abrirFicha();
    await userEvent.click(imprimir);
    expect(await screen.findByText('Página de prueba en cola')).toBeVisible();
    expect(screen.getByText(/Sale en unos segundos por Cocina/)).toBeVisible();
    expect(screen.getByText(/Búscala en “Trabajos de hoy”/)).toBeVisible();
    const [llamada] = s.de('POST', RUTA_PRUEBA);
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
  });

  it('sin puente conectado no promete que sale ya', async () => {
    api({}, { [`POST ${RUTA_PRUEBA}`]: () => json(201, { trabajoId: uuid(900) }) });
    await userEvent.click(await abrirFicha());
    expect(await screen.findByText(/El puente no está conectado ahora/)).toBeVisible();
  });

  it('también con la impresora desactivada (se prueba antes de activarla)', async () => {
    const s = api(
      { impresoras: [impresora(1, { activa: false })] },
      { [`POST ${RUTA_PRUEBA}`]: () => json(201, { trabajoId: uuid(900) }) },
    );
    await userEvent.click(await abrirFicha());
    await screen.findByText('Página de prueba en cola');
    expect(s.de('POST', RUTA_PRUEBA)).toHaveLength(1);
  });

  it('si falla, lo dice y se puede volver a intentar', async () => {
    api(
      {},
      { [`POST ${RUTA_PRUEBA}`]: () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }) },
    );
    const imprimir = await abrirFicha();
    await userEvent.click(imprimir);
    expect(await screen.findByText('No pudimos mandar la página de prueba')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Imprimir página de prueba' })).toBeEnabled();
  });
});

describe('Trabajos de hoy (criterios 128 y 139)', () => {
  const TRABAJOS = [
    trabajo(1, { tipo: 'COMANDA', estado: 'IMPRESO', creadoEn: '2026-10-30T17:31:00.000Z' }),
    trabajo(2, {
      tipo: 'PRECUENTA',
      impresora: { id: uuid(102), nombre: 'Caja' },
      mesa: '4, 5',
      estado: 'PENDIENTE',
      intentos: 2,
      impresoEn: null,
      creadoEn: '2026-10-30T17:40:00.000Z',
    }),
    trabajo(3, {
      tipo: 'ADICION',
      estado: 'VENCIDO',
      impresoEn: null,
      creadoEn: '2026-10-30T14:00:00.000Z',
    }),
    trabajo(4, {
      tipo: 'PRUEBA',
      mesa: null,
      creadoEn: '2026-10-30T16:00:00.000Z',
    }),
    trabajo(5, {
      tipo: 'COMANDA',
      reimpresionDe: uuid(701),
      estado: 'PENDIENTE',
      impresoEn: null,
      creadoEn: '2026-10-30T17:45:00.000Z',
    }),
  ];

  async function abrirLista() {
    renderApp('/administracion/impresion');
    const seccion = await screen.findByRole('region', { name: 'Trabajos de hoy' });
    await within(seccion).findByRole('list', { name: 'Trabajos de hoy' });
    return seccion;
  }

  it('lista cada ticket con su impresora, mesa, hora y estado dicho con palabras', async () => {
    api({ trabajos: TRABAJOS });
    const seccion = await abrirLista();
    const filas = within(
      within(seccion).getByRole('list', { name: 'Trabajos de hoy' }),
    ).getAllByRole('listitem');
    expect(filas).toHaveLength(5);
    expect(filas[0]).toHaveTextContent('Comanda · Mesa 4');
    expect(filas[0]).toHaveTextContent('Cocina · 12:31');
    expect(within(filas[0]!).getByText('Impreso')).toBeVisible();
    expect(filas[1]).toHaveTextContent('Pre-cuenta · Mesas 4 y 5');
    expect(filas[1]).toHaveTextContent('Caja');
    expect(within(filas[1]!).getByText('Pendiente')).toBeVisible();
    expect(within(filas[1]!).getByText('2 intentos')).toBeVisible();
    expect(within(filas[2]!).getByText('Vencido')).toBeVisible();
    expect(filas[3]).toHaveTextContent('Página de prueba');
    expect(within(filas[4]!).getByText('Reimpresión')).toBeVisible();
    expect(seccion).toHaveTextContent('5 trabajos');
  });

  it('la página de prueba no se reimprime desde aquí; todo lo demás sí', async () => {
    api({ trabajos: TRABAJOS });
    const seccion = await abrirLista();
    expect(within(seccion).getAllByRole('button', { name: /^Reimprimir/ })).toHaveLength(4);
    const filas = within(seccion).getAllByRole('listitem');
    expect(within(filas[3]!).queryByRole('button')).toBeNull();
  });

  it('filtra por estado pidiéndolo a la API', async () => {
    const s = api({ trabajos: TRABAJOS });
    const seccion = await abrirLista();
    await userEvent.click(within(seccion).getByRole('button', { name: 'Pendientes' }));
    await waitFor(() => expect(within(seccion).getAllByRole('listitem')).toHaveLength(2));
    expect(s.llamadas.some((l) => l.ruta === '/impresion/trabajos' && l.metodo === 'GET')).toBe(
      true,
    );
    expect(within(seccion).getByRole('button', { name: 'Pendientes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sin trabajos, dice qué falta; con un filtro, lo dice según el filtro', async () => {
    api({ trabajos: [] });
    renderApp('/administracion/impresion');
    const seccion = await screen.findByRole('region', { name: 'Trabajos de hoy' });
    expect(await within(seccion).findByText('Sin trabajos')).toBeVisible();
    expect(seccion).toHaveTextContent('Aún no se mandó nada a imprimir hoy');
    await userEvent.click(within(seccion).getByRole('button', { name: 'Impresos' }));
    expect(
      await within(seccion).findByText('Todavía no se imprimió ningún ticket hoy.'),
    ).toBeVisible();
  });

  it('"Reimprimir" manda la reimpresión de ese ticket con una clave de idempotencia y avisa que quedó en cola', async () => {
    const s = api(
      { trabajos: TRABAJOS },
      {
        [`POST /impresion/trabajos/${TRABAJOS[0]!.id}/reimpresion`]: () =>
          json(201, { trabajoId: uuid(950) }),
      },
    );
    const seccion = await abrirLista();
    const fila = within(seccion).getAllByRole('listitem')[0]!;
    await userEvent.click(within(fila).getByRole('button', { name: /^Reimprimir/ }));
    expect(await within(seccion).findByText('Reimpresión en cola')).toBeVisible();
    const [llamada] = s.de('POST', `/impresion/trabajos/${TRABAJOS[0]!.id}/reimpresion`);
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    // La lista se vuelve a pedir para mostrar la reimpresión.
    await waitFor(() =>
      expect(
        s.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/impresion/trabajos').length,
      ).toBeGreaterThan(1),
    );
  });

  it('un corte al reimprimir reintenta con la misma clave', async () => {
    const ruta = `/impresion/trabajos/${TRABAJOS[0]!.id}/reimpresion`;
    let intentos = 0;
    const s = api(
      { trabajos: TRABAJOS },
      {
        [`POST ${ruta}`]: () => {
          intentos += 1;
          return intentos < 3
            ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
            : json(201, { trabajoId: uuid(950) });
        },
      },
    );
    const seccion = await abrirLista();
    const fila = within(seccion).getAllByRole('listitem')[0]!;
    await userEvent.click(within(fila).getByRole('button', { name: /^Reimprimir/ }));
    await within(seccion).findByText('Reimpresión en cola');
    const llamadas = s.de('POST', ruta);
    expect(llamadas).toHaveLength(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
  });

  it('si falla y se vuelve a tocar, repite la misma clave; una vez que sale, el siguiente toque usa otra', async () => {
    const ruta = `/impresion/trabajos/${TRABAJOS[0]!.id}/reimpresion`;
    let respuesta: Response = json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' });
    const s = api({ trabajos: TRABAJOS }, { [`POST ${ruta}`]: () => respuesta });
    const seccion = await abrirLista();
    const reimprimir = () =>
      within(within(seccion).getAllByRole('listitem')[0]!).getByRole('button', {
        name: /^Reimprimir/,
      });

    await userEvent.click(reimprimir());
    const error = await within(seccion).findByText('No pudimos reimprimir');
    expect(error).toBeVisible();
    expect(reimprimir()).toBeEnabled();

    respuesta = json(201, { trabajoId: uuid(950) });
    await userEvent.click(reimprimir());
    await within(seccion).findByText('Reimpresión en cola');
    expect(within(seccion).queryByText('No pudimos reimprimir')).toBeNull();

    respuesta = json(201, { trabajoId: uuid(951) });
    await userEvent.click(reimprimir());
    await waitFor(() => expect(s.de('POST', ruta)).toHaveLength(3));
    const [primera, segunda, tercera] = s.de('POST', ruta);
    expect(segunda?.cabeceras.get('Idempotency-Key')).toBe(
      primera?.cabeceras.get('Idempotency-Key'),
    );
    expect(tercera?.cabeceras.get('Idempotency-Key')).not.toBe(
      segunda?.cabeceras.get('Idempotency-Key'),
    );
  });

  it('sin impresora para el ticket, lo dice y dice qué hacer', async () => {
    const ruta = `/impresion/trabajos/${TRABAJOS[0]!.id}/reimpresion`;
    api(
      { trabajos: TRABAJOS },
      { [`POST ${ruta}`]: () => json(409, { codigo: 'SIN_IMPRESORA', mensaje: 'x' }) },
    );
    const seccion = await abrirLista();
    await userEvent.click(
      within(within(seccion).getAllByRole('listitem')[0]!).getByRole('button', {
        name: /^Reimprimir/,
      }),
    );
    expect(await within(seccion).findByRole('alert')).toHaveTextContent(
      'Ya no hay una impresora activa para este ticket',
    );
  });

  it('si no puede cargar la lista, lo dice y deja reintentar', async () => {
    let falla = true;
    api(
      {},
      {
        'GET /impresion/trabajos': () =>
          falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, []),
      },
    );
    renderApp('/administracion/impresion');
    const seccion = await screen.findByRole('region', { name: 'Trabajos de hoy' });
    expect(await within(seccion).findByText('No pudimos cargar los trabajos')).toBeVisible();
    falla = false;
    await userEvent.click(within(seccion).getByRole('button', { name: 'Reintentar' }));
    expect(await within(seccion).findByText('Sin trabajos')).toBeVisible();
  });
});

describe('Ajustes › Impresión: el orden de la pantalla (criterio 137)', () => {
  it('después de la impresora de caja vienen el puente y los trabajos de hoy', async () => {
    api();
    renderApp('/administracion/impresion');
    await screen.findByRole('region', { name: 'Trabajos de hoy' });
    const titulos = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
      .filter((t) => t && !t.startsWith('Ajustes'));
    expect(titulos).toEqual([
      'Impresoras',
      'Dónde sale cada estación',
      'Impresora de caja',
      'Puente de impresión',
      'Trabajos de hoy',
    ]);
  });
});
