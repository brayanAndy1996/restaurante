import type { UsuarioRespuesta } from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeEquipo, tokenDeEquipo, tokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, TOKEN_EQUIPO, TOKEN_SESION, json, renderApp, servidor, sesionDe } from './ayudas';

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NUEVO_TOKEN = `eq.${ID.empresa}.${ID.equipo}.secreto-nuevo`;

describe('recordatorio automático después del ingreso con contraseña (criterio 93)', () => {
  it('llama a POST /sesion/equipo sin pedir nada, guarda el token nuevo y relee la sesión', async () => {
    let recordado = false;
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe(recordado ? {} : { equipo: null })),
      'POST /sesion/equipo': () => {
        recordado = true;
        return json(201, {
          equipo: { id: ID.equipo, nombre: 'Chrome · Linux' },
          tokenEquipo: NUEVO_TOKEN,
        });
      },
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await waitFor(() => expect(tokenDeEquipo(ID.empresa)).toBe(NUEVO_TOKEN));
    const llamada = s.de('POST', '/sesion/equipo')[0];
    expect((llamada?.cuerpo as { nombre: string }).nombre).toMatch(/\S/);
    // Es la primera vez en este celular: no manda ningún token de equipo.
    expect(llamada?.cabeceras.has('X-Equipo')).toBe(false);
    // Releída la sesión, la hoja ya ofrece cambiar de usuario.
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    expect(await screen.findByRole('button', { name: 'Cambiar usuario' })).toBeInTheDocument();
  });

  it('si la persona elige sucursal mientras se relee la sesión, la lectura vieja no la devuelve a "Elige tu sucursal"', async () => {
    let lecturas = 0;
    let soltarLecturaVieja!: () => void;
    const vieja = new Promise<void>((resolver) => (soltarLecturaVieja = resolver));
    const s = servidor({
      'GET /sesion': async () => {
        lecturas += 1;
        // La primera lectura es la de entrar; la segunda es la que sigue a recordar el equipo y sale
        // antes de que la persona elija: llega tarde, con la sucursal todavía sin elegir.
        if (lecturas === 2) await vieja;
        return json(200, sesionDe({ sucursal: null, equipo: null }));
      },
      'POST /sesion/equipo': () =>
        json(201, {
          equipo: { id: ID.equipo, nombre: 'Chrome · Linux' },
          tokenEquipo: NUEVO_TOKEN,
        }),
      'PUT /sesion/sucursal': () =>
        json(200, sesionDe({ sucursal: { id: ID.sucursalB, nombre: 'Surco' } })),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Elige tu sucursal' });
    await waitFor(() => expect(lecturas).toBe(2));
    await userEvent.click(screen.getByRole('button', { name: /Surco/ }));
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    soltarLecturaVieja();
    await waitFor(() => expect(s.de('GET', '/sesion')).toHaveLength(2));
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(screen.getByText('Hola, Marta')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elige tu sucursal' })).not.toBeInTheDocument();
  });

  it('con un token de equipo ya guardado lo manda y conserva el mismo si no llega uno nuevo', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe({ equipo: null })),
      'POST /sesion/equipo': () =>
        json(200, { equipo: { id: ID.equipo, nombre: 'Chrome · Android' } }),
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await waitFor(() => expect(s.de('POST', '/sesion/equipo')).toHaveLength(1));
    expect(s.de('POST', '/sesion/equipo')[0]?.cabeceras.get('X-Equipo')).toBe(TOKEN_EQUIPO);
    expect(tokenDeEquipo(ID.empresa)).toBe(TOKEN_EQUIPO);
  });

  it('no lo intenta mientras la contraseña es temporal, ni en sesiones PIN o de soporte', async () => {
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe({ equipo: null, debeCambiarContrasena: true })),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Elige tu contraseña' });
    expect(s.de('POST', '/sesion/equipo')).toHaveLength(0);
  });

  it('en una sesión de soporte no recuerda el equipo', async () => {
    const s = servidor({
      'GET /sesion': () =>
        json(
          200,
          sesionDe({
            equipo: null,
            tipo: 'SOPORTE',
            usuario: null,
            superadministrador: { id: ID.superadmin, nombre: 'Ana Torres' },
          }),
        ),
    });
    renderApp('/');
    await screen.findByText(/Estás en la cuenta de|Hola/);
    expect(s.de('POST', '/sesion/equipo')).toHaveLength(0);
  });

  it('si falla (sin red o 403), la persona sigue trabajando y no se reintenta en bucle', async () => {
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe({ equipo: null })),
      'POST /sesion/equipo': () => json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }),
    });
    renderApp('/');
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    await waitFor(() => expect(s.de('POST', '/sesion/equipo')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 150));
    expect(s.de('POST', '/sesion/equipo')).toHaveLength(1);
    expect(tokenDeEquipo(ID.empresa)).toBeNull();
  });
});

describe('olvidar este equipo (criterio 95)', () => {
  it('pide confirmación, dice qué pasará, olvida el equipo y vuelve a la pantalla de PIN', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'DELETE /sesion/equipos/88888888-8888-4888-8888-888888888888': () => json(204),
      'GET /equipo': () => json(200, { equipo: { id: ID.equipo, nombre: 'Chrome' }, personas: [] }),
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    await userEvent.click(screen.getByRole('button', { name: 'Olvidar este equipo' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar este equipo' });
    expect(dialogo).toHaveTextContent('se cerrará tu sesión');
    expect(dialogo).toHaveTextContent('tendrás que ingresar con tu usuario y contraseña');
    // Nada se olvida hasta confirmar.
    expect(s.de('DELETE', `/sesion/equipos/${ID.equipoRecordado}`)).toHaveLength(0);
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Olvidar este equipo' }));
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
    expect(s.de('DELETE', `/sesion/equipos/${ID.equipoRecordado}`)).toHaveLength(1);
    expect(tokenDeSesion()).toBeNull();
  });

  it('cancelar no olvida nada', async () => {
    const s = servidor({ 'GET /sesion': () => json(200, sesionDe()) });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    await userEvent.click(screen.getByRole('button', { name: 'Olvidar este equipo' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar este equipo' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(s.llamadas.filter((l) => l.metodo === 'DELETE')).toHaveLength(0);
    expect(tokenDeSesion()).toBe(TOKEN_SESION);
  });

  it('si no se pudo, lo dice dentro de la confirmación y no cierra la sesión', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDe()),
      [`DELETE /sesion/equipos/${ID.equipoRecordado}`]: () =>
        json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    await userEvent.click(screen.getByRole('button', { name: 'Olvidar este equipo' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar este equipo' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Olvidar este equipo' }));
    expect(await within(dialogo).findByText('No pudimos hacerlo')).toBeInTheDocument();
    expect(tokenDeSesion()).toBe(TOKEN_SESION);
  });
});

const miEquipo = {
  id: ID.equipoRecordado,
  equipo: { id: ID.equipo, nombre: 'Chrome · Android' },
  recordadoEn: '2026-10-20T15:00:00.000Z',
  ultimoUsoEn: new Date().toISOString(),
  actual: true,
};
const otroEquipo = {
  id: ID.otro,
  equipo: { id: ID.equipoB, nombre: 'Safari · iPhone' },
  recordadoEn: '2026-10-01T15:00:00.000Z',
  ultimoUsoEn: '2026-10-05T23:40:00.000Z',
  actual: false,
};

describe('Mis equipos (criterio 97)', () => {
  it('lista los equipos con su último uso y marca cuál es este', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'GET /sesion/equipos': () => json(200, [miEquipo, otroEquipo]),
    });
    renderApp('/mis-equipos');
    const lista = await screen.findByRole('list', { name: 'Mis equipos' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('Chrome · Android');
    expect(filas[0]).toHaveTextContent('Este equipo');
    expect(filas[0]).toHaveTextContent(/Último uso: hoy \d\d:\d\d/);
    expect(filas[1]).toHaveTextContent('Safari · iPhone');
    expect(filas[1]).toHaveTextContent('Último uso: 05/10/2026');
    expect(filas[1]).not.toHaveTextContent('Este equipo');
  });

  it('olvida otro equipo con confirmación y vuelve a leer la lista', async () => {
    let olvidado = false;
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'GET /sesion/equipos': () => json(200, olvidado ? [miEquipo] : [miEquipo, otroEquipo]),
      [`DELETE /sesion/equipos/${ID.otro}`]: () => {
        olvidado = true;
        return json(204);
      },
    });
    renderApp('/mis-equipos');
    await screen.findByRole('list', { name: 'Mis equipos' });
    await userEvent.click(screen.getByRole('button', { name: /Olvidar Safari · iPhone/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar un equipo' });
    expect(dialogo).toHaveTextContent('Safari · iPhone dejará de recordarte');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Olvidar' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Mis equipos' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
    expect(s.de('DELETE', `/sesion/equipos/${ID.otro}`)).toHaveLength(1);
    expect(tokenDeSesion()).toBe(TOKEN_SESION);
  });

  it('olvidar el equipo de esta sesión la cierra y vuelve a la pantalla de PIN', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'GET /sesion/equipos': () => json(200, [miEquipo]),
      [`DELETE /sesion/equipos/${ID.equipoRecordado}`]: () => json(204),
    });
    renderApp('/mis-equipos');
    await screen.findByRole('list', { name: 'Mis equipos' });
    await userEvent.click(screen.getByRole('button', { name: /Olvidar Chrome · Android/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar este equipo' });
    expect(dialogo).toHaveTextContent('se cerrará tu sesión');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Olvidar' }));
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
    expect(tokenDeSesion()).toBeNull();
  });

  it('sin equipos recordados dice qué hacer', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'GET /sesion/equipos': () => json(200, []),
    });
    renderApp('/mis-equipos');
    expect(await screen.findByText('Ningún equipo te recuerda')).toBeInTheDocument();
  });

  it('si no carga, ofrece reintentar', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDe()),
      'GET /sesion/equipos': () => json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }),
    });
    renderApp('/mis-equipos');
    expect(await screen.findByText('No pudimos cargar tus equipos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

const rosa: UsuarioRespuesta = {
  id: ID.otro,
  nombre: 'Rosa Quispe',
  nombreUsuario: 'rosa.quispe',
  esAdministrador: false,
  accesos: [{ sucursalId: ID.sucursalA, rol: 'MOZO' }],
  activo: true,
  horario: null,
  largoPin: 4,
  contrasenaTemporal: false,
  equiposRecordados: 2,
  creadoEn: '2026-10-27T10:00:00.000Z',
  actualizadoEn: '2026-10-27T10:00:00.000Z',
};
const equipoDeRosa = (id: string, nombre: string) => ({
  id,
  equipo: { id: ID.equipoB, nombre },
  recordadoEn: '2026-10-20T15:00:00.000Z',
  ultimoUsoEn: '2026-10-26T20:00:00.000Z',
});
const EQ1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EQ2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('equipos recordados en la administración de usuarios (criterios 30 y 100)', () => {
  function servidorDeRosa(equipos: () => unknown[]) {
    return servidor({
      'GET /sesion': () => json(200, sesionDe()),
      [`GET /usuarios/${ID.otro}`]: () => json(200, rosa),
      [`GET /usuarios/${ID.otro}/equipos`]: () => json(200, equipos()),
    });
  }

  it('lista los equipos de la persona y olvida uno con confirmación', async () => {
    let lista = [equipoDeRosa(EQ1, 'Chrome · Android'), equipoDeRosa(EQ2, 'Safari · iPhone')];
    const s = servidorDeRosa(() => lista);
    s.poner(`DELETE /usuarios/${ID.otro}/equipos/${EQ1}`, () => {
      lista = lista.filter((e) => e.id !== EQ1);
      return json(204);
    });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    const seccion = await screen.findByRole('region', { name: 'Equipos recordados' });
    const equipos = await within(seccion).findByRole('list', { name: 'Equipos recordados' });
    expect(within(equipos).getAllByRole('listitem')).toHaveLength(2);

    await userEvent.click(
      within(equipos).getByRole('button', { name: /Olvidar Chrome · Android/ }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar un equipo' });
    expect(dialogo).toHaveTextContent('El PIN de Rosa Quispe dejará de servir en Chrome · Android');
    expect(dialogo).toHaveTextContent('se cerrarán sus sesiones');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Olvidar' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Equipos recordados' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
    expect(s.de('DELETE', `/usuarios/${ID.otro}/equipos/${EQ1}`)).toHaveLength(1);
  });

  it('olvida todos los equipos con una sola confirmación', async () => {
    let lista = [equipoDeRosa(EQ1, 'Chrome · Android'), equipoDeRosa(EQ2, 'Safari · iPhone')];
    const s = servidorDeRosa(() => lista);
    s.poner(`DELETE /usuarios/${ID.otro}/equipos`, () => {
      lista = [];
      return json(204);
    });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Olvidar todos los equipos' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar todos los equipos' });
    expect(dialogo).toHaveTextContent('en todos sus equipos');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Olvidar todos' }));
    expect(await screen.findByText(/Ningún equipo recuerda a Rosa Quispe/)).toBeInTheDocument();
    expect(s.de('DELETE', `/usuarios/${ID.otro}/equipos`)).toHaveLength(1);
  });

  it('sin equipos lo dice y no ofrece olvidar', async () => {
    servidorDeRosa(() => []);
    renderApp(`/administracion/usuarios/${ID.otro}`);
    expect(await screen.findByText(/Ningún equipo recuerda a Rosa Quispe/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Olvidar todos los equipos' })).toBeNull();
  });

  it('si un equipo ya no está (404), lo dice y vuelve a leer la lista', async () => {
    const s = servidorDeRosa(() => [equipoDeRosa(EQ1, 'Chrome · Android')]);
    s.poner(`DELETE /usuarios/${ID.otro}/equipos/${EQ1}`, () =>
      json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
    );
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await userEvent.click(await screen.findByRole('button', { name: /Olvidar Chrome · Android/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Olvidar un equipo' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Olvidar' }));
    expect(
      await within(dialogo).findByText('Ese equipo ya no está en la lista.'),
    ).toBeInTheDocument();
  });
});

describe('acceso de la sucursal (criterio 100)', () => {
  const acceso = (id: string, minutos: number) =>
    json(200, { sucursalId: id, minutosInactividad: minutos });

  it('un rol sin permiso no ve "Acceso" ni entra por la dirección', async () => {
    servidor({
      'GET /sesion': () =>
        json(
          200,
          sesionDe({
            esAdministrador: false,
            rol: 'CAJERO',
            sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol: 'CAJERO' }],
          }),
        ),
    });
    renderApp('/administracion/acceso');
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Acceso' })).toBeNull();
  });

  it('muestra los minutos de cada sucursal y guarda solo las que cambiaron', async () => {
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe()),
      [`GET /sucursales/${ID.sucursalA}/acceso`]: () => acceso(ID.sucursalA, 5),
      [`GET /sucursales/${ID.sucursalB}/acceso`]: () => acceso(ID.sucursalB, 10),
      [`PATCH /sucursales/${ID.sucursalB}/acceso`]: ({ cuerpo }) =>
        acceso(ID.sucursalB, (cuerpo as { minutosInactividad: number }).minutosInactividad),
    });
    renderApp('/administracion/acceso');
    const miraflores = await screen.findByLabelText('Miraflores: minutos sin uso');
    const surco = screen.getByLabelText('Surco: minutos sin uso');
    expect(miraflores).toHaveValue('5');
    expect(surco).toHaveValue('10');
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeDisabled();

    await userEvent.clear(surco);
    await userEvent.type(surco, '15');
    expect(guardar).toBeEnabled();
    await userEvent.click(guardar);
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', `/sucursales/${ID.sucursalB}/acceso`)[0]?.cuerpo).toEqual({
      minutosInactividad: 15,
    });
    expect(s.de('PATCH', `/sucursales/${ID.sucursalA}/acceso`)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('valida el rango de 1 a 120 antes de enviar', async () => {
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe()),
      [`GET /sucursales/${ID.sucursalA}/acceso`]: () => acceso(ID.sucursalA, 5),
      [`GET /sucursales/${ID.sucursalB}/acceso`]: () => acceso(ID.sucursalB, 5),
    });
    renderApp('/administracion/acceso');
    const campo = await screen.findByLabelText('Miraflores: minutos sin uso');
    for (const malo of ['0', '121', '2.5', 'abc', '']) {
      await userEvent.clear(campo);
      if (malo) await userEvent.type(campo, malo);
      await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      expect(await screen.findByText('Escribe un número entero de 1 a 120')).toBeInTheDocument();
    }
    expect(s.llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(0);
  });

  it('si una sucursal no se pudo guardar, dice cuál y conserva lo escrito', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDe()),
      [`GET /sucursales/${ID.sucursalA}/acceso`]: () => acceso(ID.sucursalA, 5),
      [`GET /sucursales/${ID.sucursalB}/acceso`]: () => acceso(ID.sucursalB, 5),
      [`PATCH /sucursales/${ID.sucursalA}/acceso`]: () =>
        json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
    });
    renderApp('/administracion/acceso');
    const campo = await screen.findByLabelText('Miraflores: minutos sin uso');
    await userEvent.clear(campo);
    await userEvent.type(campo, '8');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByText(/No pudimos guardar la sucursal Miraflores/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Miraflores: minutos sin uso')).toHaveValue('8');
  });
});
