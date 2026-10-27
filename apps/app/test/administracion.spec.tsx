import type { UsuarioRespuesta } from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const rosa: UsuarioRespuesta = {
  id: ID.otro,
  nombre: 'Rosa Quispe',
  nombreUsuario: 'rosa.quispe',
  esAdministrador: false,
  accesos: [{ sucursalId: ID.sucursalA, rol: 'MOZO' }],
  activo: true,
  horario: null,
  largoPin: 4,
  contrasenaTemporal: true,
  equiposRecordados: 0,
  creadoEn: '2026-10-27T10:00:00.000Z',
  actualizadoEn: '2026-10-27T10:00:00.000Z',
};
const marta: UsuarioRespuesta = {
  ...rosa,
  id: ID.usuario,
  nombre: 'Marta Pérez',
  nombreUsuario: 'marta',
  esAdministrador: true,
  accesos: [],
  largoPin: 6,
  contrasenaTemporal: false,
};

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const base = () => ({ 'GET /sesion': () => json(200, sesionDe()) });

describe('lista de usuarios', () => {
  it('muestra un esqueleto mientras carga y luego las filas con su estado', async () => {
    servidor({
      ...base(),
      'GET /usuarios': () =>
        json(200, [
          marta,
          {
            ...rosa,
            horario: [{ dia: 5, desde: '18:00', hasta: '02:00' }],
            contrasenaTemporal: false,
          },
          {
            ...rosa,
            id: ID.sucursalB,
            nombre: 'Jorge Ríos',
            nombreUsuario: 'jorge',
            activo: false,
            contrasenaTemporal: false,
            accesos: [{ sucursalId: ID.sucursalB, rol: 'COCINA_BARRA' }],
          },
        ]),
    });
    renderApp('/administracion/usuarios');
    expect(await screen.findByRole('status', { name: 'Cargando usuarios' })).toBeInTheDocument();
    const lista = await screen.findByRole('list', { name: 'Usuarios' });
    expect(within(lista).getByText('Administrador · todas las sucursales')).toBeInTheDocument();
    expect(within(lista).getByText('Mozo · Miraflores')).toBeInTheDocument();
    expect(within(lista).getByText('Cocina/Barra · Surco')).toBeInTheDocument();
    expect(within(lista).getByText('Con horario')).toBeInTheDocument();
    expect(within(lista).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('3 usuarios · 1 inactivo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Agregar usuario/ })).toBeInTheDocument();
  });

  it('sin usuarios dice qué falta y ofrece crearlo', async () => {
    servidor({ ...base(), 'GET /usuarios': () => json(200, []) });
    renderApp('/administracion/usuarios');
    expect(await screen.findByText('Aún no hay usuarios')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Agregar usuario/ }).length).toBeGreaterThan(0);
  });

  it('si falla la carga, nombra el problema y deja reintentar en la misma pantalla', async () => {
    let n = 0;
    servidor({
      ...base(),
      'GET /usuarios': () =>
        ++n === 1 ? json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }) : json(200, [marta]),
    });
    renderApp('/administracion/usuarios');
    expect(await screen.findByText('No pudimos cargar los usuarios')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso para hacer esto.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('link', { name: /Marta Pérez/ })).toBeInTheDocument();
  });
});

describe('alta de usuario', () => {
  async function llenarFormulario() {
    await userEvent.type(screen.getByLabelText('Nombre'), 'Rosa Quispe');
    await userEvent.type(screen.getByLabelText('Nombre de usuario'), 'Rosa.Quispe');
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Temporal-1');
    await userEvent.selectOptions(screen.getByLabelText('Miraflores'), 'MOZO');
  }

  it('no deja crear sin lo mínimo y lo dice campo por campo', async () => {
    const s = servidor(base());
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await userEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));
    expect(screen.getByText('Escribe el nombre de la persona')).toBeInTheDocument();
    expect(screen.getByText('Escribe un nombre de usuario')).toBeInTheDocument();
    expect(screen.getByText('Elige el rol en al menos una sucursal')).toBeInTheDocument();
    expect(s.de('POST', '/usuarios')).toHaveLength(0);
  });

  it('crea el usuario y muestra el PIN una sola vez, sin guardarlo en el navegador', async () => {
    const s = servidor({
      ...base(),
      'GET /usuarios': () => json(200, [marta]),
      'POST /usuarios': () => json(201, { ...rosa, pin: '4821' }),
    });
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await llenarFormulario();
    expect(
      screen.getByText('Su PIN tendrá 4 dígitos. Lo verás una sola vez al crear el usuario.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText('Se muestra una sola vez')).toBeInTheDocument();
    expect(screen.getByText('4821')).toBeInTheDocument();
    expect(screen.getByText('Rosa Quispe ya puede ingresar')).toBeInTheDocument();
    expect(screen.getByText('Temporal-1')).toBeInTheDocument();
    expect(s.de('POST', '/usuarios')[0]?.cuerpo).toEqual({
      nombre: 'Rosa Quispe',
      nombreUsuario: 'rosa.quispe',
      esAdministrador: false,
      accesos: [{ sucursalId: ID.sucursalA, rol: 'MOZO' }],
      contrasenaTemporal: 'Temporal-1',
    });
    // El PIN no está en ningún almacenamiento.
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('4821');

    await userEvent.click(screen.getByRole('button', { name: 'Ya lo anoté' }));
    expect(await screen.findByRole('list', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.queryByText('4821')).toBeNull();
  });

  it('un Cajero lleva PIN de 6 dígitos y lo avisa antes de guardar', async () => {
    servidor(base());
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await userEvent.selectOptions(screen.getByLabelText('Surco'), 'CAJERO');
    expect(
      screen.getByText('Su PIN tendrá 6 dígitos. Lo verás una sola vez al crear el usuario.'),
    ).toBeInTheDocument();
  });

  it('con horario envía los tramos y acepta uno que cruza la medianoche', async () => {
    const s = servidor({ ...base(), 'POST /usuarios': () => json(201, { ...rosa, pin: '4821' }) });
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await llenarFormulario();
    await userEvent.click(screen.getByRole('switch', { name: 'Limitar horario de acceso' }));
    await userEvent.click(screen.getByRole('button', { name: 'Agregar tramo el viernes' }));
    const desde = screen.getByLabelText('Desde');
    const hasta = screen.getByLabelText('Hasta');
    await userEvent.clear(desde);
    await userEvent.type(desde, '18:00');
    await userEvent.clear(hasta);
    await userEvent.type(hasta, '02:00');
    await userEvent.click(screen.getByRole('button', { name: /^Agregar tramo$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));
    await screen.findByText('Se muestra una sola vez');
    expect(s.de('POST', '/usuarios')[0]?.cuerpo).toMatchObject({
      horario: [{ dia: 5, desde: '18:00', hasta: '02:00' }],
    });
  });

  it('desactiva "Crear" mientras los tramos del horario se cruzan', async () => {
    servidor(base());
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await userEvent.click(screen.getByRole('switch', { name: 'Limitar horario de acceso' }));
    for (const [dia, desde, hasta] of [
      ['viernes', '18:00', '02:00'],
      ['sábado', '01:00', '03:00'],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: `Agregar tramo el ${dia}` }));
      const campoDesde = screen.getByLabelText('Desde');
      const campoHasta = screen.getByLabelText('Hasta');
      await userEvent.clear(campoDesde);
      await userEvent.type(campoDesde, desde);
      await userEvent.clear(campoHasta);
      await userEvent.type(campoHasta, hasta);
      await userEvent.click(screen.getByRole('button', { name: /^Agregar tramo$/ }));
    }
    expect(
      screen
        .getAllByRole('alert')
        .some((a) => a.textContent?.includes('se cruza con uno del viernes')),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Crear usuario' })).toBeDisabled();
  });

  it('un nombre de usuario repetido se marca en su campo, sin decir de qué empresa es', async () => {
    servidor({
      ...base(),
      'POST /usuarios': () =>
        json(409, { codigo: 'CONFLICTO', mensaje: 'El nombre de usuario no está disponible' }),
    });
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await llenarFormulario();
    await userEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));
    expect(
      await screen.findByText('Ese nombre de usuario ya está en uso. Elige otro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Rosa Quispe');
  });

  it('si la conexión se cortó y el reintento choca, avisa que pudo haberse creado', async () => {
    let n = 0;
    servidor({
      ...base(),
      'POST /usuarios': () => {
        if (++n === 1) throw new TypeError('Failed to fetch');
        return json(409, { codigo: 'CONFLICTO', mensaje: 'x' });
      },
    });
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await llenarFormulario();
    await userEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));
    expect(
      await screen.findByText(/es posible que el usuario ya se haya creado/),
    ).toBeInTheDocument();
  });

  it('"Generar una contraseña" llena la contraseña temporal', async () => {
    servidor(base());
    renderApp('/administracion/usuarios/nuevo');
    await screen.findByRole('heading', { name: 'Agregar usuario' });
    await userEvent.click(screen.getByRole('button', { name: 'Generar una contraseña' }));
    expect((screen.getByLabelText('Contraseña temporal') as HTMLInputElement).value).toHaveLength(
      10,
    );
  });
});

describe('edición de un usuario', () => {
  const edicion = (extra: Record<string, () => Response> = {}) =>
    servidor({
      ...base(),
      [`GET /usuarios/${ID.otro}`]: () => json(200, rosa),
      ...extra,
    });

  it('carga al usuario, no deja cambiar su nombre de usuario y "Guardar" espera a que haya cambios', async () => {
    edicion();
    renderApp(`/administracion/usuarios/${ID.otro}`);
    expect(await screen.findByRole('heading', { name: 'Rosa Quispe' })).toBeInTheDocument();
    expect(screen.getByText('rosa.quispe')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de usuario')).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Nombre'), ' Díaz');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('guarda solo lo que cambió y lo confirma', async () => {
    const s = edicion({
      [`PATCH /usuarios/${ID.otro}`]: () => json(200, { ...rosa, nombre: 'Rosa Quispe Díaz' }),
    });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await screen.findByRole('heading', { name: 'Rosa Quispe' });
    await userEvent.type(screen.getByLabelText('Nombre'), ' Díaz');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', `/usuarios/${ID.otro}`)[0]?.cuerpo).toEqual({
      nombre: 'Rosa Quispe Díaz',
    });
  });

  it('si el cambio de roles cambia el largo del PIN, lo avisa antes y muestra el nuevo PIN una vez', async () => {
    edicion({
      [`PATCH /usuarios/${ID.otro}`]: () =>
        json(200, {
          ...rosa,
          accesos: [{ sucursalId: ID.sucursalA, rol: 'CAJERO' }],
          largoPin: 6,
          pin: '482193',
        }),
    });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await screen.findByRole('heading', { name: 'Rosa Quispe' });
    await userEvent.selectOptions(screen.getByLabelText('Miraflores'), 'CAJERO');
    expect(screen.getByText(/Con estos cambios pasará a 6/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('482193')).toBeInTheDocument();
    expect(screen.getByText('Cambió el largo del PIN de Rosa Quispe')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ya lo anoté' }));
    expect(screen.queryByText('482193')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Rosa Quispe' })).toBeInTheDocument();
  });

  it('regenerar el PIN pide confirmación que dice qué pasará, y muestra el PIN una vez', async () => {
    const s = edicion({ [`POST /usuarios/${ID.otro}/pin`]: () => json(200, { pin: '7305' }) });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await screen.findByRole('heading', { name: 'Rosa Quispe' });
    await userEvent.click(screen.getByRole('button', { name: 'Regenerar PIN' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/El anterior dejará de funcionar/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(s.de('POST', `/usuarios/${ID.otro}/pin`)).toHaveLength(0);
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Generar PIN nuevo' }));
    expect(await screen.findByText('7305')).toBeInTheDocument();
  });

  it('restablecer la contraseña pide una temporal válida y la muestra al terminar', async () => {
    const s = edicion({ [`POST /usuarios/${ID.otro}/contrasena`]: () => json(204) });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await screen.findByRole('heading', { name: 'Rosa Quispe' });
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    const hoja = await screen.findByRole('dialog');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Restablecer contraseña' }));
    expect(
      within(hoja).getByText('Escribe una contraseña temporal o genera una'),
    ).toBeInTheDocument();
    await userEvent.type(within(hoja).getByLabelText('Contraseña temporal'), 'Nueva-temp-1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await within(hoja).findByText('Contraseña restablecida')).toBeInTheDocument();
    expect(within(hoja).getByText('Nueva-temp-1')).toBeInTheDocument();
    expect(s.de('POST', `/usuarios/${ID.otro}/contrasena`)[0]?.cuerpo).toEqual({
      contrasenaTemporal: 'Nueva-temp-1',
    });
  });

  it('desactivar dice qué pasará y, si es el último administrador, lo explica', async () => {
    edicion({
      [`PATCH /usuarios/${ID.otro}`]: () =>
        json(409, { codigo: 'ULTIMO_ADMINISTRADOR', mensaje: 'x' }),
    });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await screen.findByRole('heading', { name: 'Rosa Quispe' });
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar usuario' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/Se cerrarán sus sesiones abiertas/)).toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Desactivar' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'no puede quedarse sin un administrador activo',
    );
  });

  it('desactiva y deja la opción de reactivar', async () => {
    edicion({
      [`PATCH /usuarios/${ID.otro}`]: () => json(200, { ...rosa, activo: false }),
    });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    await screen.findByRole('heading', { name: 'Rosa Quispe' });
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar usuario' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }),
    );
    expect(await screen.findByRole('button', { name: 'Reactivar usuario' })).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('nadie puede desactivarse a sí mismo desde aquí', async () => {
    servidor({ ...base(), [`GET /usuarios/${ID.usuario}`]: () => json(200, marta) });
    renderApp(`/administracion/usuarios/${ID.usuario}`);
    await screen.findByRole('heading', { name: 'Marta Pérez' });
    expect(screen.queryByRole('button', { name: 'Desactivar usuario' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Regenerar PIN' })).toBeInTheDocument();
  });

  it('un usuario que no existe se dice con palabras', async () => {
    servidor({
      ...base(),
      [`GET /usuarios/${ID.otro}`]: () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
    });
    renderApp(`/administracion/usuarios/${ID.otro}`);
    expect(await screen.findByText('No encontramos a este usuario')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Volver a Usuarios/ })).toBeInTheDocument(),
    );
  });
});
