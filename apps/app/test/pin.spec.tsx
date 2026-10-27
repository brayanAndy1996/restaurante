import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  equipoDeSesion,
  guardarTokenDeEquipo,
  tokenDeEquipo,
  tokenDeSesion,
} from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import {
  ID,
  TOKEN_EQUIPO,
  TOKEN_EQUIPO_B,
  TOKEN_SESION,
  equipoCon,
  json,
  renderApp,
  servidor,
  sesionDe,
} from './ayudas';

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MARTA = { usuarioId: ID.usuario, nombre: 'Marta Pérez', largoPin: 4 as const };
const LUCIA = { usuarioId: ID.otro, nombre: 'Lucía Torres', largoPin: 6 as const };

async function escribirPin(pin: string) {
  for (const d of pin) await userEvent.click(screen.getByRole('button', { name: d }));
}

const sesionPin = () =>
  sesionDe({
    tipo: 'PIN',
    esAdministrador: false,
    rol: 'MOZO',
    sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol: 'MOZO' }],
  });

describe('arranque (criterio 92)', () => {
  it('sin token de equipo va al ingreso con contraseña sin llamar a la API', async () => {
    const s = servidor({});
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
    expect(s.llamadas).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Ingresar con PIN' })).toBeNull();
  });

  it('con un equipo que recuerda a una persona, va directo al teclado de esa persona', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({ 'GET /equipo': () => json(200, equipoCon([MARTA])) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Escribe tu PIN' })).toBeInTheDocument();
    expect(screen.getByText('Marta Pérez')).toBeInTheDocument();
    expect(screen.getByText('PIN de 4 dígitos')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 de 4 dígitos');
    // Consulta pública: con el token del equipo y sin credencial de sesión.
    const llamada = s.de('GET', '/equipo')[0];
    expect(llamada?.cabeceras.get('X-Equipo')).toBe(TOKEN_EQUIPO);
    expect(llamada?.cabeceras.has('Authorization')).toBe(false);
  });

  it('con varias personas muestra sus nombres, los cupos y entra al teclado de la que se elige', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({ 'GET /equipo': () => json(200, equipoCon([MARTA, LUCIA])) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: '¿Quién eres?' })).toBeInTheDocument();
    expect(screen.getByText('Este celular recuerda a 2 de 5 personas.')).toBeInTheDocument();
    expect(screen.getByText('PIN de 4 dígitos')).toBeInTheDocument();
    expect(screen.getByText('PIN de 6 dígitos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Lucía Torres/ }));
    expect(screen.getByRole('heading', { name: 'Escribe tu PIN' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 de 6 dígitos');

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar de persona' }));
    expect(screen.getByRole('heading', { name: '¿Quién eres?' })).toBeInTheDocument();
  });

  it('un celular con personas de dos empresas las junta (un token de equipo por empresa)', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    guardarTokenDeEquipo(ID.empresaB, TOKEN_EQUIPO_B);
    const s = servidor({
      'GET /equipo': ({ cabeceras }) =>
        cabeceras.get('X-Equipo') === TOKEN_EQUIPO
          ? json(200, equipoCon([MARTA]))
          : json(
              200,
              equipoCon([{ usuarioId: ID.usuarioB, nombre: 'Pedro Gómez', largoPin: 6 }], {
                id: ID.equipoB,
              }),
            ),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: '¿Quién eres?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Marta Pérez/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pedro Gómez/ })).toBeInTheDocument();
    // Con dos equipos no se dice "recuerda a N de 5": el máximo es por equipo.
    expect(screen.queryByText(/Este celular recuerda/)).toBeNull();
    expect(s.de('GET', '/equipo')).toHaveLength(2);
  });

  it('si el servidor no reconoce un equipo, borra su token y pasa al ingreso con contraseña', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({
      'GET /equipo': () => json(401, { codigo: 'EQUIPO_NO_RECONOCIDO', mensaje: 'x' }),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
    expect(tokenDeEquipo(ID.empresa)).toBeNull();
  });

  it('si uno de dos equipos no se reconoce, borra solo ese token y sigue con el otro', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    guardarTokenDeEquipo(ID.empresaB, TOKEN_EQUIPO_B);
    servidor({
      'GET /equipo': ({ cabeceras }) =>
        cabeceras.get('X-Equipo') === TOKEN_EQUIPO
          ? json(200, equipoCon([MARTA]))
          : json(401, { codigo: 'EQUIPO_NO_RECONOCIDO', mensaje: 'x' }),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Escribe tu PIN' })).toBeInTheDocument();
    expect(tokenDeEquipo(ID.empresa)).toBe(TOKEN_EQUIPO);
    expect(tokenDeEquipo(ID.empresaB)).toBeNull();
  });

  it('un equipo que ya no recuerda a nadie lleva al ingreso con contraseña', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({ 'GET /equipo': () => json(200, equipoCon([])) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
    // El token se conserva: el equipo existe, solo no recuerda a nadie.
    expect(tokenDeEquipo(ID.empresa)).toBe(TOKEN_EQUIPO);
  });

  it('sin conexión no borra el token: dice el problema y ofrece reintentar', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    let intentos = 0;
    servidor({
      'GET /equipo': () => {
        if (++intentos <= 3) throw new TypeError('Failed to fetch');
        return json(200, equipoCon([MARTA]));
      },
    });
    renderApp('/');
    expect(await screen.findByText('No pudimos abrir el ingreso con PIN')).toBeInTheDocument();
    expect(tokenDeEquipo(ID.empresa)).toBe(TOKEN_EQUIPO);
    expect(
      screen.getByRole('link', { name: 'Ingresar con usuario y contraseña' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Escribe tu PIN' })).toBeInTheDocument();
  });

  it('el ingreso con contraseña ofrece volver al PIN cuando el equipo recuerda a alguien', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({ 'GET /equipo': () => json(200, equipoCon([MARTA])) });
    renderApp('/ingreso');
    const enlace = await screen.findByRole('link', { name: 'Ingresar con PIN' });
    await userEvent.click(enlace);
    expect(await screen.findByRole('heading', { name: 'Escribe tu PIN' })).toBeInTheDocument();
  });
});

describe('teclado y envío (criterio 94)', () => {
  it('envía al completar el largo, guarda la sesión con su equipo y entra', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({
      'GET /equipo': () => json(200, equipoCon([MARTA])),
      'POST /sesiones/pin': () => json(201, { token: TOKEN_SESION, sesion: sesionPin() }),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('123');
    expect(screen.getByRole('status')).toHaveTextContent('3 de 4 dígitos');
    // Nunca se muestra un dígito: solo puntos.
    expect(screen.queryByText('123')).toBeNull();
    expect(s.de('POST', '/sesiones/pin')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: '4' }));
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    const llamada = s.de('POST', '/sesiones/pin')[0];
    expect(llamada?.cuerpo).toEqual({ usuarioId: ID.usuario, pin: '1234' });
    expect(llamada?.cabeceras.get('X-Equipo')).toBe(TOKEN_EQUIPO);
    expect(llamada?.cabeceras.has('Authorization')).toBe(false);
    expect(tokenDeSesion()).toBe(TOKEN_SESION);
    expect(equipoDeSesion()).toBe(TOKEN_EQUIPO);
    // El PIN no queda en ningún almacenamiento.
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('1234');
    expect(JSON.stringify({ ...localStorage })).not.toContain('1234');
  });

  it('el botón de borrar quita el último dígito', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({ 'GET /equipo': () => json(200, equipoCon([MARTA])) });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('12');
    await userEvent.click(screen.getByRole('button', { name: 'Borrar el último dígito' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 de 4 dígitos');
  });

  it('un PIN equivocado dice el problema, vacía los puntos y vuelve a consultar al equipo', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({
      'GET /equipo': () => json(200, equipoCon([MARTA])),
      'POST /sesiones/pin': () => json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' }),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('9999');
    expect(await screen.findByText('El PIN no es correcto')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0 de 4 dígitos'));
    await waitFor(() => expect(s.de('GET', '/equipo')).toHaveLength(2));
    expect(tokenDeSesion()).toBeNull();
    // Se puede volver a intentar de inmediato.
    await escribirPin('1');
    expect(screen.getByRole('status')).toHaveTextContent('1 de 4 dígitos');
  });

  it('tras varios fallos recomienda ingresar con contraseña', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({
      'GET /equipo': () => json(200, equipoCon([MARTA])),
      'POST /sesiones/pin': () => json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' }),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('1111');
    await screen.findByText('Revisa y vuelve a intentar.');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0 de 4 dígitos'));
    await escribirPin('2222');
    expect(
      await screen.findByText('Si no lo recuerdas, ingresa con tu usuario y contraseña.'),
    ).toBeInTheDocument();
  });

  it('si tras el fallo el equipo ya dejó a la persona bloqueada, muestra la cuenta regresiva y apaga el teclado', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    let bloqueo: string | null = null;
    servidor({
      'GET /equipo': () => json(200, equipoCon([{ ...MARTA, bloqueadoHastaEn: bloqueo }])),
      'POST /sesiones/pin': () => {
        bloqueo = new Date(Date.now() + 300_000).toISOString();
        return json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' });
      },
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('1111');
    expect(await screen.findByText('PIN bloqueado por unos minutos')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^[45]:\d\d$/);
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    // La salida con contraseña pasa a ser la principal.
    expect(screen.getByRole('link', { name: 'Ingresar con usuario y contraseña' })).toHaveClass(
      'ui-boton--principal',
    );
  });

  it('un 429 bloquea con los segundos que dice el servidor', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({
      'GET /equipo': () => json(200, equipoCon([MARTA])),
      'POST /sesiones/pin': () =>
        json(
          429,
          { codigo: 'BLOQUEO_TEMPORAL', mensaje: 'x', reintentarEnSegundos: 272 },
          { 'Retry-After': '272' },
        ),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('1111');
    expect(await screen.findByText('PIN bloqueado por unos minutos')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^4:3[12]$/);
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    expect(s.de('POST', '/sesiones/pin')).toHaveLength(1);
  });

  it('una persona bloqueada en la lista no se puede elegir y dice cuándo vuelve', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({
      'GET /equipo': () =>
        json(
          200,
          equipoCon([
            { ...MARTA, bloqueadoHastaEn: new Date(Date.now() + 272_000).toISOString() },
            LUCIA,
          ]),
        ),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: '¿Quién eres?' });
    const bloqueada = screen.getByRole('button', { name: /Marta Pérez/ });
    expect(bloqueada).toBeDisabled();
    expect(bloqueada).toHaveTextContent(/Bloqueado: vuelve en 4:3\d/);
    expect(screen.getByRole('button', { name: /Lucía Torres/ })).toBeEnabled();
  });

  it('al 15.º fallo el equipo deja de recordarla: lo dice y manda a la contraseña', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    let olvidada = false;
    servidor({
      'GET /equipo': () => json(200, equipoCon(olvidada ? [] : [MARTA])),
      'POST /sesiones/pin': () => {
        olvidada = true;
        return json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' });
      },
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('1111');
    expect(await screen.findByText('Este equipo ya no te recuerda')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ingresar con usuario y contraseña' })).toHaveClass(
      'ui-boton--principal',
    );
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
  });

  it('si el equipo ya no es reconocido al enviar el PIN, borra su token y manda a la contraseña', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    let reconocido = true;
    servidor({
      'GET /equipo': () =>
        reconocido
          ? json(200, equipoCon([MARTA]))
          : json(401, { codigo: 'EQUIPO_NO_RECONOCIDO', mensaje: 'x' }),
      'POST /sesiones/pin': () => {
        reconocido = false;
        return json(401, { codigo: 'EQUIPO_NO_RECONOCIDO', mensaje: 'x' });
      },
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('1111');
    expect(await screen.findByText('Este equipo ya no está registrado')).toBeInTheDocument();
    expect(tokenDeEquipo(ID.empresa)).toBeNull();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
  });

  it('fuera de horario lo dice con otra palabra, sin culpar al PIN', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({
      'GET /equipo': () => json(200, equipoCon([MARTA])),
      'POST /sesiones/pin': () => json(403, { codigo: 'FUERA_DE_HORARIO', mensaje: 'x' }),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('1234');
    expect(await screen.findByText('Estás fuera de tu horario de acceso')).toBeInTheDocument();
    expect(screen.queryByText('El PIN no es correcto')).toBeNull();
  });

  it('sin conexión al enviar conserva el equipo y lo dice', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    servidor({
      'GET /equipo': () => json(200, equipoCon([MARTA])),
      'POST /sesiones/pin': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Escribe tu PIN' });
    await escribirPin('1234');
    expect(await screen.findByText('No hay conexión')).toBeInTheDocument();
    expect(tokenDeEquipo(ID.empresa)).toBe(TOKEN_EQUIPO);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0 de 4 dígitos'));
  });

  it('elegir persona y entrar con un PIN de 6 dígitos a la sucursal que falta elegir', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({
      'GET /equipo': () => json(200, equipoCon([MARTA, LUCIA])),
      'POST /sesiones/pin': () =>
        json(201, {
          token: TOKEN_SESION,
          sesion: sesionDe({ tipo: 'PIN', sucursal: null }),
        }),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: /Lucía Torres/ }));
    await escribirPin('123456');
    expect(await screen.findByRole('heading', { name: 'Elige tu sucursal' })).toBeInTheDocument();
    expect(s.de('POST', '/sesiones/pin')[0]?.cuerpo).toEqual({ usuarioId: ID.otro, pin: '123456' });
  });
});

describe('cierre de la sesión y vuelta al PIN (criterios 95 y 96)', () => {
  it('"Cambiar usuario" cierra la sesión y vuelve a la pantalla de PIN', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'GET /equipo': () => json(200, equipoCon([MARTA, LUCIA])),
      'DELETE /sesion': () => json(204),
    });
    // sesión de contraseña ya abierta (con equipo recordado)
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar usuario' }));
    expect(await screen.findByRole('heading', { name: '¿Quién eres?' })).toBeInTheDocument();
    expect(tokenDeSesion()).toBeNull();
    await waitFor(() => expect(s.de('DELETE', '/sesion')).toHaveLength(1));
  });

  it('"Cambiar usuario" no aparece en una sesión de soporte ni si el equipo no la recuerda', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    servidor({ 'GET /sesion': () => json(200, sesionDe({ equipo: null })) });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    expect(screen.queryByRole('button', { name: 'Cambiar usuario' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Olvidar este equipo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mis equipos' })).toBeInTheDocument();
  });

  it('un cierre por inactividad con el equipo recordando a alguien vuelve al PIN con el aviso', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    servidor({
      'GET /sesion': () => json(401, { codigo: 'SESION_EXPIRADA', mensaje: 'x' }),
      'GET /equipo': () => json(200, equipoCon([MARTA])),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Escribe tu PIN' })).toBeInTheDocument();
    expect(screen.getByText('Tu sesión se cerró por inactividad')).toBeInTheDocument();
    expect(screen.getByText('Escribe tu PIN para continuar.')).toBeInTheDocument();
  });

  it('una sesión revocada (401) vuelve al PIN y dice que ya no es válida', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    sessionStorage.setItem(
      'restaurante.sesion',
      JSON.stringify({ token: TOKEN_SESION, equipo: TOKEN_EQUIPO }),
    );
    const s = servidor({
      'GET /sesion': () => json(401, { codigo: 'NO_AUTENTICADO', mensaje: 'x' }),
      'GET /equipo': () => json(200, equipoCon([LUCIA])),
    });
    renderApp('/');
    expect(await screen.findByText('Tu sesión ya no es válida')).toBeInTheDocument();
    // Una sesión PIN manda el token de su equipo en cada petición (criterio 37).
    expect(s.de('GET', '/sesion')[0]?.cabeceras.get('X-Equipo')).toBe(TOKEN_EQUIPO);
  });

  it('con una sesión abierta, /pin lleva al inicio', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    servidor({ 'GET /sesion': () => json(200, sesionDe()) });
    renderApp('/pin');
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
  });
});

describe('contenido de la hoja de la sesión', () => {
  it('ofrece cambiar usuario, mis equipos y olvidar este equipo cuando el equipo recuerda a la persona', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    servidor({ 'GET /sesion': () => json(200, sesionDe()) });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    const hoja = screen.getByRole('dialog');
    for (const nombre of ['Cambiar usuario', 'Mis equipos', 'Olvidar este equipo', 'Salir']) {
      expect(within(hoja).getByRole('button', { name: nombre })).toBeInTheDocument();
    }
    await act(async () => undefined);
  });
});
