import type { AutorizacionRespuesta } from '@restaurante/contratos';
import { ACCIONES, type Accion, type RequisitoPermiso } from '@restaurante/dominio';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VentanaClaveSupervisor } from '../src/componentes/VentanaClaveSupervisor';
import { useClaveDeSupervisor } from '../src/componentes/useClaveDeSupervisor';
import { api, espera } from '../src/lib/api';
import { requisitoDeSesion } from '../src/modulos/acceso/permisos';
import { ID, TOKEN_SESION, json, renderApp, servidor, sesionDe } from './ayudas';

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AUTORIZADOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const autorizada = (extra: Partial<AutorizacionRespuesta> = {}): AutorizacionRespuesta => ({
  autorizacionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  accion: 'ANULAR_ITEM_ENVIADO',
  autorizadoPor: { id: AUTORIZADOR, nombre: 'Rosa Quispe' },
  expiraEn: new Date(Date.now() + 120_000).toISOString(),
  ...extra,
});
const rechazo = (mensaje = 'x') => json(403, { codigo: 'CLAVE_INVALIDA', mensaje });

async function pin(digitos: string) {
  for (const d of digitos) await userEvent.click(screen.getByRole('button', { name: d }));
}

function Ventana(props: {
  onAutorizada?: (a: AutorizacionRespuesta) => void;
  onCancelar?: () => void;
  atajos?: readonly string[];
}) {
  return (
    <VentanaClaveSupervisor
      abierta
      accion="ANULAR_ITEM_ENVIADO"
      descripcion="Anular ítem: Ceviche mixto x1 · S/ 38.00"
      onAutorizada={props.onAutorizada ?? (() => undefined)}
      onCancelar={props.onCancelar ?? (() => undefined)}
      {...(props.atajos ? { atajos: props.atajos } : {})}
    />
  );
}

describe('VentanaClaveSupervisor: contenido (criterio 98)', () => {
  it('dice qué se autoriza y ofrece motivo con atajos, PIN de 6 puntos y teclado', () => {
    servidor({});
    render(<Ventana />);
    const hoja = screen.getByRole('dialog', { name: 'Clave de supervisor' });
    expect(hoja).toHaveTextContent('Anular ítem: Ceviche mixto x1 · S/ 38.00');
    for (const atajo of ['Error al comandar', 'El cliente lo pidió', 'Producto agotado']) {
      expect(within(hoja).getByRole('button', { name: atajo })).toBeInTheDocument();
    }
    expect(within(hoja).getByLabelText('Motivo')).toBeInTheDocument();
    expect(within(hoja).getByRole('status')).toHaveTextContent('0 de 6 dígitos');
    expect(within(hoja).getByRole('group', { name: 'Teclado numérico' })).toBeInTheDocument();
    expect(within(hoja).getByRole('button', { name: 'Autorizar' })).toBeDisabled();
  });

  it('acepta atajos propios', () => {
    servidor({});
    render(<Ventana atajos={['Cliente se fue', 'Plato frío']} />);
    expect(screen.getByRole('button', { name: 'Cliente se fue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Error al comandar' })).toBeNull();
  });

  it('el PIN no se muestra: solo puntos', async () => {
    servidor({});
    render(<Ventana />);
    await pin('123');
    expect(screen.getByRole('status')).toHaveTextContent('3 de 6 dígitos');
    expect(screen.queryByText('123')).toBeNull();
    expect(screen.queryByDisplayValue('123')).toBeNull();
  });
});

describe('VentanaClaveSupervisor: autorizar', () => {
  it('con el motivo elegido, envía al completar los 6 dígitos y devuelve la autorización', async () => {
    const alAutorizar = vi.fn();
    const respuesta = autorizada();
    const s = servidor({ 'POST /autorizaciones': () => json(201, respuesta) });
    render(<Ventana onAutorizada={alAutorizar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    expect(screen.getByLabelText('Motivo')).toHaveValue('Error al comandar');
    await pin('12345');
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: '6' }));
    await waitFor(() => expect(alAutorizar).toHaveBeenCalledTimes(1));
    expect(alAutorizar.mock.calls[0]?.[0]).toEqual(respuesta);
    const llamada = s.de('POST', '/autorizaciones')[0];
    expect(llamada?.cuerpo).toEqual({
      accion: 'ANULAR_ITEM_ENVIADO',
      motivo: 'Error al comandar',
      pin: '123456',
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un motivo escrito a mano se recorta y viaja tal cual', async () => {
    const s = servidor({ 'POST /autorizaciones': () => json(201, autorizada()) });
    render(<Ventana />);
    await userEvent.type(screen.getByLabelText('Motivo'), '  La mesa pidió otro plato  ');
    await pin('654321');
    await waitFor(() => expect(s.de('POST', '/autorizaciones')).toHaveLength(1));
    expect((s.de('POST', '/autorizaciones')[0]?.cuerpo as { motivo: string }).motivo).toBe(
      'La mesa pidió otro plato',
    );
  });

  it('sin motivo no envía y lo dice; al elegir el motivo con el PIN ya escrito, autoriza', async () => {
    const alAutorizar = vi.fn();
    const s = servidor({ 'POST /autorizaciones': () => json(201, autorizada()) });
    render(<Ventana onAutorizada={alAutorizar} />);
    await pin('123456');
    expect(await screen.findByText('Elige o escribe el motivo')).toBeInTheDocument();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
    // El PIN sigue escrito: elegir el atajo completa el envío.
    expect(screen.getByRole('status')).toHaveTextContent('6 de 6 dígitos');
    await userEvent.click(screen.getByRole('button', { name: 'Producto agotado' }));
    await waitFor(() => expect(alAutorizar).toHaveBeenCalledTimes(1));
    expect((s.de('POST', '/autorizaciones')[0]?.cuerpo as { motivo: string }).motivo).toBe(
      'Producto agotado',
    );
  });

  it('un motivo de solo espacios cuenta como vacío; escrito el motivo, "Autorizar" envía', async () => {
    const alAutorizar = vi.fn();
    servidor({ 'POST /autorizaciones': () => json(201, autorizada()) });
    render(<Ventana onAutorizada={alAutorizar} />);
    await userEvent.type(screen.getByLabelText('Motivo'), '   ');
    await pin('123456');
    expect(await screen.findByText('Elige o escribe el motivo')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Motivo'), 'Cortesía del gerente');
    expect(screen.queryByText('Elige o escribe el motivo')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar' }));
    await waitFor(() => expect(alAutorizar).toHaveBeenCalledTimes(1));
  });

  it('un motivo de más de 300 caracteres no se envía', async () => {
    const s = servidor({});
    render(<Ventana />);
    const campo = screen.getByLabelText('Motivo');
    // maxLength lo impide al escribir; un pegado programático lo prueba igual.
    await userEvent.type(campo, 'a');
    (campo as HTMLTextAreaElement).removeAttribute('maxlength');
    await userEvent.type(campo, 'a'.repeat(300));
    await pin('123456');
    expect(await screen.findByText('Usa 300 caracteres como máximo')).toBeInTheDocument();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
  });

  it('cancelar avisa a quien abrió la ventana y no llama a la API', async () => {
    const alCancelar = vi.fn();
    const s = servidor({});
    render(<Ventana onCancelar={alCancelar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(alCancelar).toHaveBeenCalled();
    expect(s.llamadas).toHaveLength(0);
  });

  it('al volver a abrirla empieza limpia: el PIN y el motivo no sobreviven al cierre', async () => {
    servidor({});
    function Anfitriona() {
      const [abierta, setAbierta] = useState(true);
      return (
        <>
          <button onClick={() => setAbierta((a) => !a)}>alternar</button>
          <VentanaClaveSupervisor
            abierta={abierta}
            accion="ANULAR_ORDEN"
            descripcion="Anular la orden"
            onAutorizada={() => undefined}
            onCancelar={() => setAbierta(false)}
          />
        </>
      );
    }
    render(<Anfitriona />);
    await pin('123');
    await userEvent.type(screen.getByLabelText('Motivo'), 'algo');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Motivo')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'alternar' }));
    expect(screen.getByRole('status')).toHaveTextContent('0 de 6 dígitos');
    expect(screen.getByLabelText('Motivo')).toHaveValue('');
  });
});

describe('VentanaClaveSupervisor: errores', () => {
  it('una clave rechazada dice siempre lo mismo, sea cual sea el mensaje del servidor', async () => {
    const mensajes = ['pin inexistente', 'es cajero', 'fuera de horario', 'es el mismo usuario'];
    let n = 0;
    servidor({ 'POST /autorizaciones': () => rechazo(mensajes[n++ % mensajes.length]) });
    render(<Ventana />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    const textos: string[] = [];
    for (let i = 0; i < mensajes.length; i++) {
      await pin('111111');
      const aviso = await screen.findByRole('alert');
      textos.push(aviso.textContent ?? '');
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0 de 6 dígitos'));
    }
    expect(new Set(textos).size).toBe(1);
    expect(textos[0]).toBe(
      'La clave no es válidaRevisa el PIN del supervisor e inténtalo de nuevo.',
    );
    for (const m of mensajes) expect(document.body).not.toHaveTextContent(m);
  });

  it('el error se ve en los puntos y se puede volver a intentar enseguida', async () => {
    const alAutorizar = vi.fn();
    let intento = 0;
    servidor({
      'POST /autorizaciones': () => (++intento === 1 ? rechazo() : json(201, autorizada())),
    });
    render(<Ventana onAutorizada={alAutorizar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('111111');
    await screen.findByText('La clave no es válida');
    // Sin esperar a que se vacíen, un dígito nuevo empieza otro intento.
    await pin('222222');
    await waitFor(() => expect(alAutorizar).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('La clave no es válida')).toBeNull();
  });

  it('tras varios fallos, el bloqueo muestra la cuenta regresiva y apaga el teclado', async () => {
    const s = servidor({
      'POST /autorizaciones': () =>
        json(
          429,
          { codigo: 'BLOQUEO_TEMPORAL', mensaje: 'x', reintentarEnSegundos: 272 },
          { 'Retry-After': '272' },
        ),
    });
    render(<Ventana />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('111111');
    expect(await screen.findByText('Clave bloqueada por unos minutos')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^4:3[12]$/);
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Autorizar' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(s.de('POST', '/autorizaciones')).toHaveLength(1);
  });

  it('una acción que no necesita clave lo dice', async () => {
    servidor({
      'POST /autorizaciones': () => json(409, { codigo: 'CLAVE_INNECESARIA', mensaje: 'x' }),
    });
    render(<Ventana />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('111111');
    expect(await screen.findByText('Esta acción no necesita clave')).toBeInTheDocument();
  });

  it('una acción prohibida para el rol lo dice sin ofrecer reintentar con otra clave', async () => {
    servidor({ 'POST /autorizaciones': () => json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }) });
    render(<Ventana />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('111111');
    expect(await screen.findByText('No puedes hacer esta acción')).toBeInTheDocument();
  });

  it('un motivo que la API no acepta (400) se marca en el motivo', async () => {
    servidor({
      'POST /autorizaciones': () => json(400, { codigo: 'DATOS_INVALIDOS', mensaje: 'x' }),
    });
    render(<Ventana />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('111111');
    expect(await screen.findByText('Revisa el motivo e inténtalo de nuevo')).toBeInTheDocument();
  });

  it('sin conexión lo dice y deja volver a intentar con lo escrito', async () => {
    servidor({
      'POST /autorizaciones': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    render(<Ventana />);
    await userEvent.type(screen.getByLabelText('Motivo'), 'Error al comandar');
    await pin('111111');
    expect(await screen.findByText('No hay conexión')).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo')).toHaveValue('Error al comandar');
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
  });

  it('el PIN no queda en ningún almacenamiento ni en el cuerpo de la página', async () => {
    servidor({ 'POST /autorizaciones': () => rechazo() });
    render(<Ventana />);
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('987654');
    await screen.findByText('La clave no es válida');
    expect(document.body.innerHTML).not.toContain('987654');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('987654');
  });
});

describe('useClaveDeSupervisor', () => {
  function Prueba({ alResolver }: { alResolver: (a: AutorizacionRespuesta | null) => void }) {
    const { pedir, ventana } = useClaveDeSupervisor();
    return (
      <>
        <button
          onClick={() =>
            void pedir({ accion: 'ANULAR_ITEM_ENVIADO', descripcion: 'Anular ítem' }).then(
              alResolver,
            )
          }
        >
          pedir
        </button>
        {ventana}
      </>
    );
  }

  it('resuelve con la autorización y la ventana se cierra', async () => {
    const resuelve = vi.fn();
    const respuesta = autorizada();
    servidor({ 'POST /autorizaciones': () => json(201, respuesta) });
    render(<Prueba alResolver={resuelve} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'pedir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('123456');
    await waitFor(() => expect(resuelve).toHaveBeenCalledTimes(1));
    expect(resuelve.mock.calls[0]?.[0]).toEqual(respuesta);
    await waitFor(() => expect(screen.queryByLabelText('Motivo')).toBeNull());
  });

  it('resuelve con null si se cancela', async () => {
    const resuelve = vi.fn();
    servidor({});
    render(<Prueba alResolver={resuelve} />);
    await userEvent.click(screen.getByRole('button', { name: 'pedir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(resuelve).toHaveBeenCalledWith(null));
    expect(resuelve).toHaveBeenCalledTimes(1);
  });
});

describe('permisos de la sesión', () => {
  const permisosDe = (parcial: Partial<Record<Accion, RequisitoPermiso>>) =>
    Object.fromEntries(ACCIONES.map((a) => [a, parcial[a] ?? 'permitido'])) as Record<
      Accion,
      RequisitoPermiso
    >;

  it('devuelve lo que dice la sesión y "prohibido" ante la duda', () => {
    const permisos = permisosDe({ ANULAR_ITEM_ENVIADO: 'clave', ADMINISTRAR: 'prohibido' });
    expect(requisitoDeSesion(permisos, 'ANULAR_ITEM_ENVIADO')).toBe('clave');
    expect(requisitoDeSesion(permisos, 'ATENDER_MESA')).toBe('permitido');
    expect(requisitoDeSesion(permisos, 'ADMINISTRAR')).toBe('prohibido');
    expect(requisitoDeSesion(null, 'ATENDER_MESA')).toBe('prohibido');
    expect(requisitoDeSesion(undefined, 'ATENDER_MESA')).toBe('prohibido');
    expect(requisitoDeSesion({}, 'COBRAR')).toBe('prohibido');
  });

  it('usePermiso lee los permisos de GET /sesion', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    servidor({
      'GET /sesion': () =>
        json(
          200,
          sesionDe({
            esAdministrador: false,
            rol: 'CAJERO',
            sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol: 'CAJERO' }],
            permisos: permisosDe({ ANULAR_ITEM_ENVIADO: 'clave', ADMINISTRAR: 'prohibido' }),
          }),
        ),
    });
    renderApp('/demo/clave-supervisor');
    // La pantalla de demostración usa `usePermiso`: con "clave" ofrece pedirla.
    expect(
      await screen.findByRole('button', { name: 'Pedir clave de supervisor' }),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Acción'), 'ANULAR_ORDEN');
    expect(screen.getByText('Tu rol no necesita clave')).toBeInTheDocument();
  });
});

describe('repetir la acción con la autorización', () => {
  it('el cliente manda X-Autorizacion cuando se le da la autorización', async () => {
    const s = servidor({ 'POST /algo': () => json(201, {}) });
    await api.post('/algo', { x: 1 }, { autorizacion: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    expect(s.de('POST', '/algo')[0]?.cabeceras.get('X-Autorizacion')).toBe(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    );
    await api.post('/algo', { x: 1 });
    expect(s.de('POST', '/algo')[1]?.cabeceras.has('X-Autorizacion')).toBe(false);
  });

  it('la demostración (solo desarrollo) recorre la ventana de punta a punta con la API simulada', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    const permisos = Object.fromEntries(
      ACCIONES.map((a) => [a, a === 'ANULAR_ITEM_ENVIADO' ? 'clave' : 'permitido']),
    ) as Record<Accion, RequisitoPermiso>;
    servidor({
      'GET /sesion': () => json(200, sesionDe({ permisos })),
      'POST /autorizaciones': () => json(201, autorizada()),
    });
    renderApp('/demo/clave-supervisor');
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir clave de supervisor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Error al comandar' }));
    await pin('123456');
    expect(await screen.findByText('Autorizó Rosa Quispe')).toBeInTheDocument();
    expect(screen.getByTestId('autorizacion-id')).toHaveTextContent(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    );
    expect(screen.getByRole('timer')).toHaveTextContent(/Vale 1:5\d|Vale 2:00/);
  });
});
