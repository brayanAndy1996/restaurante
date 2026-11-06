import type { CobroRespuesta, ComprobanteRespuesta } from '@restaurante/contratos';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TiempoRealDeSesion } from '../src/componentes/TiempoRealDeSesion';
import { espera } from '../src/lib/api';
import { conexion } from '../src/lib/conexion';
import { SesionProvider, useSesion } from '../src/modulos/acceso/sesion';
import { ResultadoDeCobro } from '../src/modulos/caja/ResultadoDeCobro';
import { ID, TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { alertasDe, comprobanteDe, detalleDe, envioDe } from './ayudas-facturacion';
import { sesionDeRol, uuid } from './ayudas-salon';
import { socketVigente } from './ayudas-tiempo-real';

// spec: 006-caja-cobro, criterios 173 y 175 en la interfaz (pruebas no protegidas del estado en vivo del comprobante y
// del aviso de alertas).

const MODULOS = ['SALON', 'COCINA', 'CAJA', 'FACTURACION'] as const;
const COMPROBANTE = uuid(7000);
const RUTA_DETALLE = `/facturacion/comprobantes/${COMPROBANTE}`;

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function cobroConComprobante(comprobante: ComprobanteRespuesta): CobroRespuesta {
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

function Resultado({ respuesta }: { respuesta: CobroRespuesta }) {
  const { sesion } = useSesion();
  if (!sesion) return null;
  return (
    <ResultadoDeCobro
      respuesta={respuesta}
      titulo="Mesa 4"
      parteIgual={null}
      textoDeSeguir="Cobrar lo que falta"
      onSeguir={() => undefined}
      volverA="/caja"
    />
  );
}

function montarResultado(comprobante: ComprobanteRespuesta = comprobanteDe({ id: COMPROBANTE })) {
  conexion.reiniciar();
  const clientes = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={clientes}>
      <MemoryRouter>
        <SesionProvider>
          <TiempoRealDeSesion />
          <Resultado respuesta={cobroConComprobante(comprobante)} />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('El estado del comprobante en el resultado del cobro (criterio 173)', () => {
  it('dice «Enviando a SUNAT…» y, cuando llega comprobante.estado, pasa a «Aceptado por SUNAT» sin recargar', async () => {
    let actual = detalleDe({ id: COMPROBANTE, estado: 'POR_ENVIAR' });
    const s = servidor({
      'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: [...MODULOS] })),
      [`GET ${RUTA_DETALLE}`]: () => json(200, actual),
    });
    montarResultado();
    expect(await screen.findByText('Enviando a SUNAT…')).toBeVisible();
    await waitFor(() => expect(s.de('GET', RUTA_DETALLE)).toHaveLength(1));

    // El worker recibe la respuesta del PSE y avisa: el estado cambia en pantalla.
    actual = detalleDe({
      id: COMPROBANTE,
      estado: 'ACEPTADO',
      envio: envioDe({ estado: 'TERMINADO', ultimoResultado: 'ACEPTADO' }),
    });
    act(() =>
      socketVigente()?.desdeElServidor('comprobante.estado', {
        comprobanteId: COMPROBANTE,
        estado: 'ACEPTADO',
        sucursalId: ID.sucursalA,
      }),
    );
    expect(await screen.findByText('Aceptado por SUNAT')).toBeVisible();
    expect(screen.queryByText('Enviando a SUNAT…')).toBeNull();
    expect(s.de('GET', RUTA_DETALLE)).toHaveLength(2);
  });

  it('un evento de otro comprobante no vuelve a pedir este', async () => {
    const s = servidor({
      'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: [...MODULOS] })),
      [`GET ${RUTA_DETALLE}`]: () => json(200, detalleDe({ id: COMPROBANTE })),
    });
    montarResultado();
    await screen.findByText('Enviando a SUNAT…');
    await waitFor(() => expect(s.de('GET', RUTA_DETALLE)).toHaveLength(1));
    act(() =>
      socketVigente()?.desdeElServidor('comprobante.estado', {
        comprobanteId: uuid(7777),
        estado: 'ACEPTADO',
        sucursalId: ID.sucursalA,
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(s.de('GET', RUTA_DETALLE)).toHaveLength(1);
    expect(screen.getByText('Enviando a SUNAT…')).toBeVisible();
  });

  it('un rechazo dice el motivo y ofrece «Emitir otro» a quien puede cobrar', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: [...MODULOS] })),
      [`GET ${RUTA_DETALLE}`]: () =>
        json(
          200,
          detalleDe({
            id: COMPROBANTE,
            estado: 'RECHAZADO',
            sunat: {
              codigo: '2800',
              mensaje: 'El RUC del receptor no existe',
              observaciones: [],
              hash: null,
            },
            envio: envioDe({ estado: 'TERMINADO', ultimoResultado: 'RECHAZADO' }),
          }),
        ),
    });
    montarResultado();
    expect(await screen.findByText('Rechazado: El RUC del receptor no existe')).toBeVisible();
    const emitir = screen.getByRole('link', { name: 'Emitir otro' });
    expect(emitir).toHaveAttribute('href', `/caja/comprobantes/${COMPROBANTE}?emitir=1`);
    // Quien puede emitirlo no necesita avisar a nadie (criterio 173).
    expect(screen.getByText('Corrige los datos y emite otro comprobante.')).toBeVisible();
    expect(screen.queryByText(/avísale a tu supervisor/i)).toBeNull();
  });

  it('quien no puede cobrar ve el rechazo sin «Emitir otro» y con «Avísale a tu supervisor»', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('MOZO', { modulos: [...MODULOS] })),
      [`GET ${RUTA_DETALLE}`]: () =>
        json(
          200,
          detalleDe({
            id: COMPROBANTE,
            estado: 'RECHAZADO',
            sunat: {
              codigo: '2800',
              mensaje: 'El RUC del receptor no existe',
              observaciones: [],
              hash: null,
            },
            envio: envioDe({ estado: 'TERMINADO', ultimoResultado: 'RECHAZADO' }),
          }),
        ),
    });
    montarResultado();
    expect(await screen.findByText('Rechazado: El RUC del receptor no existe')).toBeVisible();
    expect(screen.getByText('Avísale a tu supervisor.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Emitir otro' })).toBeNull();
  });

  it('el comprobante simulado lleva la marca «Simulado»', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: [...MODULOS] })),
      [`GET ${RUTA_DETALLE}`]: () => json(200, detalleDe({ id: COMPROBANTE, simulado: true })),
    });
    montarResultado(comprobanteDe({ id: COMPROBANTE, simulado: true }));
    expect(await screen.findByText(/^Simulado/)).toBeVisible();
  });

  it('un envío detenido o sin configurar no dice «Enviando»: pide atención', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: [...MODULOS] })),
      [`GET ${RUTA_DETALLE}`]: () =>
        json(
          200,
          detalleDe({
            id: COMPROBANTE,
            envio: envioDe({ estado: 'PENDIENTE', ultimoResultado: 'ERROR_CONFIGURACION' }),
          }),
        ),
    });
    montarResultado();
    expect(await screen.findByText('Todavía no se envía a SUNAT')).toBeVisible();
    expect(
      screen.getByText(
        'La facturación electrónica de este RUC no está activada: pide a soporte que la active.',
      ),
    ).toBeVisible();
  });

  it('si no se puede leer, sigue mostrando lo que dijo la emisión', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: [...MODULOS] })),
      [`GET ${RUTA_DETALLE}`]: () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No existe' }),
    });
    montarResultado(comprobanteDe({ id: COMPROBANTE, estado: 'ENVIADO' }));
    expect(await screen.findByText('Enviando a SUNAT…')).toBeVisible();
  });

  it('sin el módulo de Facturación en el plan no muestra estado ni pregunta a la API', async () => {
    const s = servidor({
      'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: ['SALON', 'CAJA'] })),
    });
    montarResultado();
    await screen.findByText('Boleta · B001-00000124');
    expect(screen.queryByLabelText('Estado ante SUNAT')).toBeNull();
    expect(s.llamadas.filter((l) => l.ruta.startsWith('/facturacion'))).toHaveLength(0);
  });
});

describe('El aviso de alertas de la facturación (criterio 175)', () => {
  const API_ALERTAS = '/facturacion/alertas';
  const conServidor = (
    rol: Parameters<typeof sesionDeRol>[0],
    alertas: ReturnType<typeof alertasDe>,
    modulos: readonly string[] = MODULOS,
  ) => {
    const estado = { alertas };
    const s = servidor({
      'GET /sesion': () => json(200, sesionDeRol(rol, { modulos: [...modulos] as never })),
      [`GET ${API_ALERTAS}`]: () => json(200, estado.alertas),
      'GET /turnos/mio': () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No hay turno' }),
      'GET /cajas': () => json(200, []),
      'GET /usuarios': () => json(200, []),
    });
    return Object.assign(s, { estado });
  };
  const aviso = () => screen.queryByText(/comprobantes? rechazados?/);

  it('el Supervisor ve cuántos rechazados y pendientes hay, con un enlace al panel filtrado', async () => {
    conServidor('SUPERVISOR', alertasDe({ rechazados: 2, demorados: 1 }));
    renderApp('/caja');
    expect(
      await screen.findByText('2 comprobantes rechazados · 1 pendiente hace más de 30 minutos'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver comprobantes' })).toHaveAttribute(
      'href',
      '/caja/comprobantes?alerta=1',
    );
  });

  it('el Administrador lo ve en Ajustes y su enlace va al panel de Ajustes', async () => {
    conServidor('ADMINISTRADOR', alertasDe({ rechazados: 1 }));
    renderApp('/administracion/usuarios');
    expect(await screen.findByText('1 comprobante rechazado')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver comprobantes' })).toHaveAttribute(
      'href',
      '/administracion/comprobantes?alerta=1',
    );
  });

  it('el Cajero no lo ve y ni siquiera pregunta las alertas', async () => {
    const s = conServidor('CAJERO', alertasDe({ rechazados: 3, modoSimulado: true }));
    renderApp('/caja');
    await screen.findByRole('heading', { name: 'Caja' });
    await new Promise((r) => setTimeout(r, 50));
    expect(aviso()).toBeNull();
    expect(screen.queryByText('Facturación en modo simulado')).toBeNull();
    expect(s.de('GET', API_ALERTAS)).toHaveLength(0);
  });

  it('sin el módulo de Facturación no hay aviso para el Supervisor', async () => {
    const s = conServidor('SUPERVISOR', alertasDe({ rechazados: 1 }), ['SALON', 'COCINA', 'CAJA']);
    renderApp('/caja');
    await screen.findByRole('heading', { name: 'Caja' });
    await new Promise((r) => setTimeout(r, 50));
    expect(aviso()).toBeNull();
    expect(s.de('GET', API_ALERTAS)).toHaveLength(0);
  });

  it('sin alertas no hay aviso', async () => {
    const s = conServidor('SUPERVISOR', alertasDe());
    renderApp('/caja');
    await waitFor(() => expect(s.de('GET', API_ALERTAS)).toHaveLength(1));
    expect(aviso()).toBeNull();
    expect(screen.queryByText('Facturación en modo simulado')).toBeNull();
  });

  it('dice el modo simulado y la facturación sin activar con sus palabras', async () => {
    conServidor('SUPERVISOR', alertasDe({ modoSimulado: true, sinConfiguracion: 2 }));
    renderApp('/caja');
    expect(await screen.findByText('Facturación en modo simulado')).toBeVisible();
    expect(screen.getByText('Los comprobantes no van a SUNAT.')).toBeVisible();
    expect(screen.getByText('Facturación electrónica sin activar')).toBeVisible();
    expect(
      screen.getByText(
        'La facturación electrónica de este RUC no está activada: pide a soporte que la active.',
      ),
    ).toBeVisible();
  });

  it('el evento facturacion.alerta lo actualiza al instante', async () => {
    const s = conServidor('SUPERVISOR', alertasDe());
    renderApp('/caja');
    await waitFor(() => expect(s.de('GET', API_ALERTAS)).toHaveLength(1));
    expect(aviso()).toBeNull();

    s.estado.alertas = alertasDe({ rechazados: 1 });
    act(() => socketVigente()?.desdeElServidor('facturacion.alerta', { sucursalId: ID.sucursalA }));
    expect(await screen.findByText('1 comprobante rechazado')).toBeVisible();
    expect(s.de('GET', API_ALERTAS)).toHaveLength(2);
  });

  it('no estorba en pleno cobro: solo sale en Caja y en Ajustes', async () => {
    const s = conServidor('SUPERVISOR', alertasDe({ rechazados: 1 }));
    s.poner('GET /cuentas/*', () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No existe' }));
    renderApp(`/caja/cuentas/${uuid(904)}/cobrar`);
    await new Promise((r) => setTimeout(r, 100));
    expect(aviso()).toBeNull();
    expect(s.de('GET', API_ALERTAS)).toHaveLength(0);
  });
});
