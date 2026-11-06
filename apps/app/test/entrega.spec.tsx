import type {
  CobroRespuesta,
  ComprobanteRespuesta,
  NotaCreditoRespuesta,
} from '@restaurante/contratos';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espera } from '../src/lib/api';
import { conexion } from '../src/lib/conexion';
import { SesionProvider, useSesion } from '../src/modulos/acceso/sesion';
import { ResultadoDeCobro } from '../src/modulos/caja/ResultadoDeCobro';
import { NotaCreditoHecha } from '../src/modulos/facturacion/NotaCreditoHecha';
import { TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { boletaAceptada, comprobanteDe, detalleDe, envioDe } from './ayudas-facturacion';
import { sesionDeRol, uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 159 a 162 y 174 en la interfaz (pruebas no protegidas de «Ver PDF», «Compartir por
// WhatsApp» e «Imprimir otra vez»).

type Modulo = NonNullable<NonNullable<Parameters<typeof sesionDeRol>[1]>['modulos']>[number];
const MODULOS: readonly Modulo[] = ['SALON', 'COCINA', 'CAJA', 'FACTURACION'];
const COMPROBANTE = uuid(7000);
const API_DETALLE = `/facturacion/comprobantes/${COMPROBANTE}`;
const API_PDF = `${API_DETALLE}/pdf`;
const API_ENLACE = `${API_DETALLE}/enlace`;
const API_IMPRESION = `/comprobantes/${COMPROBANTE}/impresiones`;
const URL_PUBLICA = 'https://api.ejemplo.pe/publico/comprobantes/SELLO123';
const textoDe = (total: string) =>
  `Tu BOLETA B001-00000124 de Cevichería Sol S.A.C. por S/ ${total}: ${URL_PUBLICA}`;
/** La boleta aceptada del detalle suma S/ 66.20; la del cobro, S/ 68.50. */
const TEXTO = textoDe('66.20');

const pdf = () =>
  new Response(new TextEncoder().encode('%PDF-1.4'), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });
const enlace = () => json(200, { url: URL_PUBLICA, expiraEn: '2026-12-06T00:00:00.000Z' });

/** La pestaña que abre el toque: se le pone la dirección cuando llega la respuesta. */
function pestana() {
  return { location: { href: '' }, close: vi.fn(), closed: false };
}

let abierta: ReturnType<typeof pestana>;
let abrir: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
  abierta = pestana();
  abrir = vi.spyOn(window, 'open').mockReturnValue(abierta as unknown as Window);
  URL.createObjectURL = vi.fn(() => 'blob:http://app.prueba/pdf-1');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

type Manejadores = Parameters<typeof servidor>[0];

function montarDetalle(
  detalle = boletaAceptada({ id: COMPROBANTE, pdfDisponible: true }),
  extra: Manejadores = {},
  rol: Parameters<typeof sesionDeRol>[0] = 'CAJERO',
  modulos: readonly Modulo[] = MODULOS,
) {
  const s = servidor({
    'GET /sesion': () => json(200, sesionDeRol(rol, { modulos: [...modulos] })),
    [`GET ${API_DETALLE}`]: () => json(200, detalle),
    ...extra,
  });
  renderApp(`/caja/comprobantes/${COMPROBANTE}`);
  return s;
}

const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

describe('«Ver PDF» (criterios 159 y 174)', () => {
  it('baja el PDF con la sesión y lo abre como blob en otra pestaña', async () => {
    const s = montarDetalle(undefined, { [`GET ${API_PDF}`]: pdf });
    await userEvent.click(await screen.findByRole('button', { name: 'Ver PDF' }));
    await waitFor(() => expect(abierta.location.href).toBe('blob:http://app.prueba/pdf-1'));
    // La pestaña se abre en el mismo toque (antes de esperar a la API) para que el celular no la bloquee.
    expect(abrir).toHaveBeenCalledWith('', '_blank');
    const llamada = s.de('GET', API_PDF)[0];
    expect(llamada?.cabeceras.get('Authorization')).toBe(`Bearer ${TOKEN_SESION}`);
    expect(llamada?.cabeceras.get('Accept')).toContain('application/pdf');
    expect(abierta.close).not.toHaveBeenCalled();
  });

  it('con 409 PDF_NO_DISPONIBLE dice lo que la API dice y cierra la pestaña en blanco', async () => {
    montarDetalle(undefined, {
      [`GET ${API_PDF}`]: () =>
        json(409, {
          codigo: 'PDF_NO_DISPONIBLE',
          mensaje: 'El PDF se está preparando; inténtalo de nuevo en un minuto',
        }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Ver PDF' }));
    expect(await screen.findByText('El PDF aún no está listo')).toBeVisible();
    expect(
      screen.getByText('El PDF se está preparando; inténtalo de nuevo en un minuto'),
    ).toBeVisible();
    expect(abierta.close).toHaveBeenCalled();
    expect(abierta.location.href).toBe('');
    // No es una falla: se puede volver a tocar.
    expect(boton('Ver PDF')).toBeEnabled();
  });

  it('antes de que SUNAT acepte avisa «El PDF estará listo cuando SUNAT acepte» y, al tocar, lo confirma la API', async () => {
    montarDetalle(detalleDe({ id: COMPROBANTE, estado: 'ENVIADO' }), {
      [`GET ${API_PDF}`]: () =>
        json(409, {
          codigo: 'PDF_NO_DISPONIBLE',
          mensaje: 'El PDF estará listo cuando SUNAT acepte el comprobante',
        }),
    });
    const ver = await screen.findByRole('button', { name: 'Ver PDF' });
    expect(
      screen.getByText('El PDF estará listo cuando SUNAT acepte el comprobante.'),
    ).toBeVisible();
    expect(ver).toBeEnabled();
    await userEvent.click(ver);
    expect(await screen.findByText('El PDF aún no está listo')).toBeVisible();
  });

  it('otro fallo (sin permiso) se dice como falla', async () => {
    montarDetalle(undefined, {
      [`GET ${API_PDF}`]: () => json(403, { codigo: 'PROHIBIDO', mensaje: 'No' }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Ver PDF' }));
    expect(await screen.findByText('No pudimos abrir el PDF')).toBeVisible();
    expect(screen.getByText('Este comprobante no es de tus turnos.')).toBeVisible();
  });

  it('si el navegador bloquea la pestaña, deja un enlace para tocar', async () => {
    abrir.mockReturnValue(null);
    montarDetalle(undefined, { [`GET ${API_PDF}`]: pdf });
    await userEvent.click(await screen.findByRole('button', { name: 'Ver PDF' }));
    const enlaceManual = await screen.findByRole('link', { name: /Toca aquí para abrir el PDF/ });
    expect(enlaceManual).toHaveAttribute('href', 'blob:http://app.prueba/pdf-1');
  });
});

describe('«Compartir por WhatsApp» (criterio 161)', () => {
  const compartir = async (celular?: string) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir por WhatsApp' }));
    if (celular !== undefined)
      await userEvent.type(screen.getByRole('textbox', { name: /Celular del cliente/ }), celular);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }));
  };

  it('sin celular abre wa.me con el texto y el enlace público, para elegir el contacto', async () => {
    const s = montarDetalle(undefined, { [`GET ${API_ENLACE}`]: enlace });
    await compartir();
    await waitFor(() =>
      expect(abierta.location.href).toBe(`https://wa.me/?text=${encodeURIComponent(TEXTO)}`),
    );
    expect(s.de('GET', API_ENLACE)).toHaveLength(1);
    expect(s.de('GET', API_ENLACE)[0]?.cabeceras.get('Authorization')).toBe(
      `Bearer ${TOKEN_SESION}`,
    );
  });

  it('con celular agrega 51 y deja solo los dígitos', async () => {
    montarDetalle(undefined, { [`GET ${API_ENLACE}`]: enlace });
    await compartir('987 654-321');
    await waitFor(() =>
      expect(abierta.location.href).toBe(
        `https://wa.me/51987654321?text=${encodeURIComponent(TEXTO)}`,
      ),
    );
  });

  it('un celular inválido se rechaza con la salida y no pide el enlace ni abre nada', async () => {
    const s = montarDetalle(undefined, { [`GET ${API_ENLACE}`]: enlace });
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir por WhatsApp' }));
    const campo = screen.getByRole('textbox', { name: /Celular del cliente/ });
    await userEvent.type(campo, '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }));
    expect(
      await screen.findByText(
        'Escribe un celular de 9 dígitos que empiece con 9, por ejemplo 987 654 321.',
      ),
    ).toBeVisible();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(s.de('GET', API_ENLACE)).toHaveLength(0);
    expect(abrir).not.toHaveBeenCalled();
    // Al corregirlo, el aviso se va y sigue.
    await userEvent.clear(campo);
    await userEvent.type(campo, '912345678');
    expect(campo).not.toHaveAttribute('aria-invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }));
    await waitFor(() => expect(abierta.location.href).toContain('https://wa.me/51912345678?text='));
  });

  it('el celular no se guarda: ni en el navegador, ni en la API, ni al volver a abrir el campo', async () => {
    const s = montarDetalle(undefined, { [`GET ${API_ENLACE}`]: enlace });
    await compartir('987654321');
    await waitFor(() => expect(abierta.location.href).toContain('wa.me/51987654321'));
    // Solo la dirección de wa.me lo lleva.
    for (const l of s.llamadas) {
      expect(l.ruta).not.toContain('987654321');
      expect(JSON.stringify(l.cuerpo ?? null)).not.toContain('987654321');
    }
    expect(s.llamadas.filter((l) => l.metodo !== 'GET')).toHaveLength(0);
    expect(JSON.stringify({ ...localStorage })).not.toContain('987654321');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('987654321');
    await userEvent.click(boton('Compartir por WhatsApp'));
    expect(screen.getByRole('textbox', { name: /Celular del cliente/ })).toHaveValue('');
  });

  it('el campo es opcional y dice que no se guarda', async () => {
    montarDetalle(undefined, { [`GET ${API_ENLACE}`]: enlace });
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir por WhatsApp' }));
    expect(screen.getByRole('textbox', { name: /Celular del cliente.*opcional/ })).toBeVisible();
    expect(screen.getByText(/No lo guardamos/)).toBeVisible();
    expect(boton('Compartir por WhatsApp')).toHaveAttribute('aria-expanded', 'true');
  });

  it('con 409 PDF_NO_DISPONIBLE no abre WhatsApp y lo dice', async () => {
    montarDetalle(undefined, {
      [`GET ${API_ENLACE}`]: () =>
        json(409, {
          codigo: 'PDF_NO_DISPONIBLE',
          mensaje: 'El PDF estará listo cuando SUNAT acepte el comprobante',
        }),
    });
    await compartir();
    expect(await screen.findByText('El PDF aún no está listo')).toBeVisible();
    expect(abierta.close).toHaveBeenCalled();
    expect(abierta.location.href).toBe('');
  });
});

describe('«Imprimir otra vez» en el detalle (criterios 90 y 174)', () => {
  const TRABAJO = uuid(961);
  const trabajos = () =>
    json(200, [
      {
        id: TRABAJO,
        tipo: 'COMPROBANTE',
        impresora: { id: uuid(60), nombre: 'Epson de caja' },
        mesa: '4',
        estado: 'PENDIENTE',
        intentos: 0,
        creadoEn: '2026-11-05T00:10:00.000Z',
        impresoEn: null,
        reimpresionDe: null,
        ordenId: uuid(900),
        envioNumero: null,
      },
    ]);

  it('pide la reimpresión con su clave de idempotencia y dice dónde sale', async () => {
    const s = montarDetalle(undefined, {
      [`POST ${API_IMPRESION}`]: () => json(201, { trabajoId: TRABAJO, impresion: 'EN_COLA' }),
      'GET /impresion/trabajos': trabajos,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Imprimir otra vez' }));
    expect(await screen.findByText('Imprimiendo otra copia en Epson de caja')).toBeVisible();
    const llamada = s.de('POST', API_IMPRESION)[0];
    expect(llamada?.cuerpo).toBeUndefined();
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
  });

  it('sin impresora de caja lo dice con la salida', async () => {
    montarDetalle(undefined, {
      [`POST ${API_IMPRESION}`]: () => json(201, { trabajoId: null, impresion: 'SIN_IMPRESORA' }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Imprimir otra vez' }));
    expect(await screen.findByText('Sin impresora de caja')).toBeVisible();
  });

  it('los errores de 004 se dicen en palabras y el detalle sigue ahí', async () => {
    montarDetalle(undefined, {
      [`POST ${API_IMPRESION}`]: () => json(403, { codigo: 'PROHIBIDO', mensaje: 'No' }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Imprimir otra vez' }));
    expect(await screen.findByText('No pudimos imprimir otra vez')).toBeVisible();
    expect(screen.getByText(/Solo quien cobró en este turno/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ver PDF' })).toBeVisible();
  });

  it('sin el módulo de Facturación no hay PDF ni WhatsApp (la reimpresión es de 004)', async () => {
    montarDetalle(undefined, {}, 'CAJERO', ['SALON', 'COCINA', 'CAJA']);
    await screen.findByRole('heading', { name: 'Datos' }).catch(() => undefined);
    expect(screen.queryByRole('button', { name: 'Ver PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Compartir por WhatsApp' })).toBeNull();
  });
});

// --- En los resultados ----------------------------------------------------------------------------

function Sesionado({ children }: { children: React.ReactNode }) {
  const { sesion } = useSesion();
  return sesion ? <>{children}</> : null;
}

function montarEnSesion(hijo: React.ReactNode) {
  conexion.reiniciar();
  const clientes = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={clientes}>
      <MemoryRouter>
        <SesionProvider>
          <Sesionado>{hijo}</Sesionado>
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function cobroCon(comprobante: ComprobanteRespuesta): CobroRespuesta {
  return {
    id: uuid(8000),
    ordenId: uuid(900),
    turnoId: uuid(300),
    parte: { tipo: 'TOTAL' },
    total: '68.50',
    redondeo: '0.00',
    vuelto: '0.00',
    pagos: [{ medio: 'EFECTIVO', monto: '68.50', recibido: null, operacion: null }],
    comprobante,
    cuenta: { estado: 'CERRADA', saldo: '0.00', version: 4 },
    impresion: 'SIN_IMPRESORA',
    trabajoId: null,
  };
}

describe('En el resultado del cobro y de la nota de crédito (criterios 161 y 174)', () => {
  const sesion = () => json(200, sesionDeRol('CAJERO', { modulos: [...MODULOS] }));

  it('el resultado del cobro ofrece «Ver PDF» y «Compartir por WhatsApp» junto a «Imprimir otra vez»', async () => {
    servidor({
      'GET /sesion': sesion,
      [`GET ${API_DETALLE}`]: () => json(200, detalleDe({ id: COMPROBANTE, estado: 'ACEPTADO' })),
      [`GET ${API_ENLACE}`]: enlace,
    });
    montarEnSesion(
      <ResultadoDeCobro
        respuesta={cobroCon(comprobanteDe({ id: COMPROBANTE }))}
        titulo="Mesa 4"
        parteIgual={null}
        textoDeSeguir="Cobrar lo que falta"
        onSeguir={() => undefined}
        volverA="/caja"
      />,
    );
    expect(await screen.findByRole('button', { name: 'Imprimir otra vez' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ver PDF' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Compartir por WhatsApp' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }));
    await waitFor(() =>
      expect(abierta.location.href).toBe(
        `https://wa.me/?text=${encodeURIComponent(textoDe('68.50'))}`,
      ),
    );
  });

  it('el resultado del cobro usa el estado vivo: un comprobante aún sin aceptar avisa que el PDF espera', async () => {
    servidor({
      'GET /sesion': sesion,
      [`GET ${API_DETALLE}`]: () =>
        json(200, detalleDe({ id: COMPROBANTE, estado: 'ENVIADO', envio: envioDe() })),
    });
    montarEnSesion(
      <ResultadoDeCobro
        respuesta={cobroCon(comprobanteDe({ id: COMPROBANTE }))}
        titulo="Mesa 4"
        parteIgual={null}
        textoDeSeguir="Cobrar lo que falta"
        onSeguir={() => undefined}
        volverA="/caja"
      />,
    );
    expect(
      await screen.findByText('El PDF estará listo cuando SUNAT acepte el comprobante.'),
    ).toBeVisible();
  });

  it('la nota de crédito con cambio a factura ofrece los botones de cada documento, bien distinguidos', async () => {
    const NOTA = uuid(7101);
    const FACTURA = uuid(7102);
    servidor({
      'GET /sesion': sesion,
      [`GET /facturacion/comprobantes/${NOTA}`]: () =>
        json(
          200,
          detalleDe({
            id: NOTA,
            estado: 'ACEPTADO',
            tipo: 'NOTA_CREDITO_BOLETA',
            numero: 'BC01-00000002',
          }),
        ),
      [`GET /facturacion/comprobantes/${FACTURA}`]: () =>
        json(
          200,
          detalleDe({
            id: FACTURA,
            estado: 'POR_ENVIAR',
            tipo: 'FACTURA',
            numero: 'F001-00000031',
          }),
        ),
      [`GET /facturacion/comprobantes/${NOTA}/enlace`]: enlace,
    });
    const respuesta: NotaCreditoRespuesta = {
      id: uuid(7100),
      nota: comprobanteDe({ id: NOTA, tipo: 'NOTA_CREDITO_BOLETA', numero: 'BC01-00000002' }),
      factura: comprobanteDe({ id: FACTURA, tipo: 'FACTURA', numero: 'F001-00000031' }),
      devolucion: null,
      impresion: 'SIN_IMPRESORA',
      trabajoIds: [],
    };
    montarEnSesion(
      <NotaCreditoHecha
        respuesta={respuesta}
        tipo="CAMBIO_A_FACTURA"
        original={{ tipo: 'BOLETA', numero: 'B001-00000124' }}
        base="/caja/comprobantes"
        volver=""
        onListo={() => undefined}
      />,
    );
    const verNota = await screen.findByRole('button', { name: 'Ver PDF de BC01-00000002' });
    expect(verNota).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ver PDF de F001-00000031' })).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Compartir por WhatsApp BC01-00000002' }),
    );
    const formulario = screen.getByRole('textbox', { name: /Celular del cliente/ }).closest('form');
    await userEvent.click(
      within(formulario as HTMLElement).getByRole('button', { name: 'Abrir WhatsApp' }),
    );
    await waitFor(() => expect(abierta.location.href).toContain('wa.me/?text='));
    expect(decodeURIComponent(abierta.location.href)).toContain(
      'Tu NOTA DE CRÉDITO BC01-00000002 de',
    );
  });
});
