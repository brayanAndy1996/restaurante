import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion, tokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function escribirCredenciales(usuario: string, contrasena: string) {
  await userEvent.type(screen.getByLabelText('Usuario'), usuario);
  await userEvent.type(screen.getByLabelText('Contraseña'), contrasena);
  await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
}

describe('ingreso con usuario y contraseña', () => {
  it('sin sesión, cualquier ruta lleva al ingreso', async () => {
    servidor({});
    renderApp('/administracion/usuarios');
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
  });

  it('pide usuario y contraseña antes de llamar a la API', async () => {
    const s = servidor({});
    renderApp('/ingreso');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(screen.getByText('Escribe tu usuario')).toBeInTheDocument();
    expect(screen.getByText('Escribe tu contraseña')).toBeInTheDocument();
    expect(s.llamadas).toHaveLength(0);
  });

  it('ingresa, guarda el token de la sesión y llega al inicio', async () => {
    const s = servidor({
      'POST /sesiones/contrasena': () => json(201, { token: TOKEN, sesion: sesionDe() }),
    });
    renderApp('/ingreso');
    await escribirCredenciales('  Marta.Perez ', 'Mi-clave-1');
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(s.llamadas[0]?.cuerpo).toEqual({ usuario: 'Marta.Perez', contrasena: 'Mi-clave-1' });
    expect(s.llamadas[0]?.cabeceras.has('Authorization')).toBe(false);
    expect(tokenDeSesion()).toBe(TOKEN);
    expect(sessionStorage.getItem('restaurante.sesion')).not.toContain('Mi-clave-1');
  });

  it('con credenciales incorrectas dice el problema y la salida, y vacía la contraseña', async () => {
    servidor({
      'POST /sesiones/contrasena': () =>
        json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' }),
    });
    renderApp('/ingreso');
    await escribirCredenciales('marta', 'mala');
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('No pudimos ingresarte');
    expect(aviso).toHaveTextContent(
      'Tu usuario o contraseña no son correctos. Revisa y vuelve a intentar.',
    );
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    expect(screen.getByLabelText('Usuario')).toHaveValue('marta');
  });

  it('con bloqueo muestra la cuenta regresiva y no deja intentar', async () => {
    const s = servidor({
      'POST /sesiones/contrasena': () =>
        json(
          429,
          { codigo: 'BLOQUEO_TEMPORAL', mensaje: 'x', reintentarEnSegundos: 272 },
          { 'Retry-After': '272' },
        ),
    });
    renderApp('/ingreso');
    await escribirCredenciales('marta', 'mala');
    expect(await screen.findByText('Ingreso bloqueado por unos minutos')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^4:3[12]$/);
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
    expect(s.llamadas).toHaveLength(1);
  });

  it('fuera de horario lo dice con otra palabra, sin culpar a la contraseña', async () => {
    servidor({
      'POST /sesiones/contrasena': () => json(403, { codigo: 'FUERA_DE_HORARIO', mensaje: 'x' }),
    });
    renderApp('/ingreso');
    await escribirCredenciales('pedro', 'Temporal-Demo-1');
    expect(await screen.findByText('Estás fuera de tu horario de acceso')).toBeInTheDocument();
    expect(screen.queryByText(/no son correctos/)).toBeNull();
  });

  it('sin conexión conserva lo escrito y lo dice', async () => {
    servidor({
      'POST /sesiones/contrasena': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp('/ingreso');
    await escribirCredenciales('marta', 'Mi-clave-1');
    expect(await screen.findByText('No hay conexión')).toBeInTheDocument();
    expect(screen.getByLabelText('Usuario')).toHaveValue('marta');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('Mi-clave-1');
  });

  it('muestra el aviso de cierre por inactividad que trae la navegación', async () => {
    servidor({});
    renderApp({ pathname: '/ingreso', state: { aviso: 'inactividad' } });
    expect(screen.getByText('Tu sesión se cerró por inactividad')).toBeInTheDocument();
    expect(screen.getByText('Ingresa de nuevo para continuar.')).toBeInTheDocument();
  });
});

describe('contraseña temporal', () => {
  it('lleva al cambio obligatorio y no deja ir a otra pantalla', async () => {
    guardarTokenDeSesion(TOKEN);
    servidor({ 'GET /sesion': () => json(200, sesionDe({ debeCambiarContrasena: true })) });
    renderApp('/administracion/usuarios');
    expect(await screen.findByRole('heading', { name: 'Elige tu contraseña' })).toBeInTheDocument();
  });

  it('valida la nueva contraseña antes de enviar', async () => {
    guardarTokenDeSesion(TOKEN);
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe({ debeCambiarContrasena: true })),
    });
    renderApp('/cambiar-contrasena');
    await screen.findByRole('heading', { name: 'Elige tu contraseña' });
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Temporal-Demo-1');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'corta');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByText('Escribe una contraseña de al menos 8 caracteres')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Contraseña nueva'));
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'Temporal-Demo-1');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(
      screen.getByText('La contraseña nueva debe ser distinta de la actual'),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Contraseña nueva'));
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'Nueva-clave-9');
    await userEvent.type(screen.getByLabelText('Repite la contraseña nueva'), 'Otra-clave-9');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByText('Las dos contraseñas no coinciden')).toBeInTheDocument();
    expect(s.de('PUT', '/sesion/contrasena')).toHaveLength(0);
  });

  it('cambia la contraseña, relee la sesión y sigue', async () => {
    guardarTokenDeSesion(TOKEN);
    let temporal = true;
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe({ debeCambiarContrasena: temporal })),
      'PUT /sesion/contrasena': () => {
        temporal = false;
        return json(204);
      },
    });
    renderApp('/cambiar-contrasena');
    await screen.findByRole('heading', { name: 'Elige tu contraseña' });
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Temporal-Demo-1');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'Nueva-clave-9');
    await userEvent.type(screen.getByLabelText('Repite la contraseña nueva'), 'Nueva-clave-9');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(s.de('PUT', '/sesion/contrasena')[0]?.cuerpo).toEqual({
      actual: 'Temporal-Demo-1',
      nueva: 'Nueva-clave-9',
    });
  });

  it('si la temporal es incorrecta lo dice en ese campo', async () => {
    guardarTokenDeSesion(TOKEN);
    servidor({
      'GET /sesion': () => json(200, sesionDe({ debeCambiarContrasena: true })),
      'PUT /sesion/contrasena': () => json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' }),
    });
    renderApp('/cambiar-contrasena');
    await screen.findByRole('heading', { name: 'Elige tu contraseña' });
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'mala');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'Nueva-clave-9');
    await userEvent.type(screen.getByLabelText('Repite la contraseña nueva'), 'Nueva-clave-9');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByText('La contraseña actual no es correcta')).toBeInTheDocument();
  });
});

describe('sucursal y barra de la sesión', () => {
  it('si no hay sucursal elegida y hay varias, pide elegir y entra con la elegida', async () => {
    guardarTokenDeSesion(TOKEN);
    let actual: string | null = null;
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe({ sucursal: null })),
      'PUT /sesion/sucursal': ({ cuerpo }) => {
        actual = (cuerpo as { sucursalId: string }).sucursalId;
        return json(200, sesionDe({ sucursal: { id: ID.sucursalB, nombre: 'Surco' } }));
      },
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Elige tu sucursal' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Surco/ }));
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(actual).toBe(ID.sucursalB);
    expect(s.de('PUT', '/sesion/sucursal')).toHaveLength(1);
    expect(screen.getAllByText(/Surco/).length).toBeGreaterThan(0);
  });

  it('la barra muestra persona, rol y sucursal y permite cambiar de sucursal', async () => {
    guardarTokenDeSesion(TOKEN);
    servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'PUT /sesion/sucursal': () =>
        json(200, sesionDe({ sucursal: { id: ID.sucursalB, nombre: 'Surco' } })),
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: /Miraflores/ }));
    const hoja = await screen.findByRole('dialog');
    await userEvent.click(within(hoja).getByRole('button', { name: /Surco/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Surco/ })).toBeInTheDocument());
  });

  it('salir cierra la sesión, borra el token y vuelve al ingreso', async () => {
    guardarTokenDeSesion(TOKEN);
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'DELETE /sesion': () => json(204),
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
    expect(tokenDeSesion()).toBeNull();
    await waitFor(() => expect(s.de('DELETE', '/sesion')).toHaveLength(1));
  });

  it('un 401 en cualquier llamada cierra la sesión y avisa', async () => {
    guardarTokenDeSesion(TOKEN);
    servidor({ 'GET /sesion': () => json(401, { codigo: 'SESION_EXPIRADA', mensaje: 'x' }) });
    renderApp('/');
    expect(await screen.findByText('Tu sesión se cerró por inactividad')).toBeInTheDocument();
    expect(tokenDeSesion()).toBeNull();
  });

  it('un rol sin permiso no ve la administración ni puede entrar por la dirección', async () => {
    guardarTokenDeSesion(TOKEN);
    servidor({
      'GET /sesion': () =>
        json(
          200,
          sesionDe({
            esAdministrador: false,
            rol: 'MOZO',
            sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol: 'MOZO' }],
          }),
        ),
    });
    renderApp('/administracion/usuarios');
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ajustes' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
  });

  it('si no se puede leer la sesión al abrir, ofrece reintentar', async () => {
    guardarTokenDeSesion(TOKEN);
    let n = 0;
    servidor({
      'GET /sesion': () => {
        if (++n <= 7) throw new TypeError('Failed to fetch');
        return json(200, sesionDe());
      },
    });
    renderApp('/');
    expect(await screen.findByText('No pudimos abrir tu sesión')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
  });
});
