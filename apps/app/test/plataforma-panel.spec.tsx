import { fechaLima, sumarMeses } from '@restaurante/dominio';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarSesionDePlataforma } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor } from './ayudas';

const TOKEN_SA = 'sa.66666666-6666-4666-8666-666666666666.secreto';
const PLAN_BASE = 'f1111111-1111-4111-8111-111111111111';
const PLAN_PRO = 'f2222222-2222-4222-8222-222222222222';
const SUSC_A = 'a1111111-1111-4111-8111-111111111111';
const SUSC_B = 'a2222222-2222-4222-8222-222222222222';
const EMISOR_A = 'b1111111-1111-4111-8111-111111111111';
const EMISOR_B = 'b2222222-2222-4222-8222-222222222222';
const hoy = fechaLima(new Date());

const planBase = {
  id: PLAN_BASE,
  codigo: 'BASE',
  nombre: 'Plan base',
  precioMensual: null,
  cuotaComprobantesMes: null,
  precioExcedente: null,
  diasGracia: 7,
  modulos: ['SALON', 'COCINA', 'CAJA', 'FACTURACION', 'PEDIDOS_WEB', 'INVENTARIO', 'REPORTES'],
  porDefecto: true,
  activo: true,
  creadoEn: '2026-10-01T15:00:00.000Z',
  actualizadoEn: '2026-10-01T15:00:00.000Z',
};
const planPro = {
  ...planBase,
  id: PLAN_PRO,
  codigo: 'PRO',
  nombre: 'Pro',
  precioMensual: '120.00',
  cuotaComprobantesMes: 500,
  precioExcedente: '0.0500',
  diasGracia: 10,
  modulos: ['SALON', 'CAJA'],
  porDefecto: false,
};

const consumo = (periodo: string, emitidos = 0, cuota: number | null = null) => ({
  periodo,
  emitidos,
  cuota,
  excedente: cuota === null ? 0 : Math.max(0, emitidos - cuota),
});
const resumen = (id: string, sucursal: string, estado: 'ACTIVA' | 'EN_GRACIA' | 'SUSPENDIDA') => ({
  id,
  empresaId: ID.empresa,
  sucursalId: ID.sucursalA,
  plan: { id: PLAN_BASE, codigo: 'BASE', nombre: 'Plan base' },
  vencimiento: '2026-11-10',
  estado,
  suspensionDesde: '2026-11-18',
  diasRestantesGracia: estado === 'EN_GRACIA' ? 3 : null,
  empresaNombre: 'Inversiones Sol del Norte',
  sucursalNombre: sucursal,
  consumoMesActual: consumo('2026-10', 120, 500),
  consumoMesAnterior: consumo('2026-09', 0),
});

const detalle = {
  id: ID.empresa,
  nombre: 'Inversiones Sol del Norte',
  creadoEn: '2026-10-01T15:00:00.000Z',
  emisores: [
    {
      id: EMISOR_A,
      empresaId: ID.empresa,
      ruc: '20100000009',
      razonSocial: 'Sol del Norte S.A.C.',
      regimen: 'GENERAL',
      creadoEn: '2026-10-01T15:00:00.000Z',
      actualizadoEn: '2026-10-01T15:00:00.000Z',
    },
  ],
  sucursales: [
    {
      id: ID.sucursalA,
      empresaId: ID.empresa,
      emisorId: EMISOR_A,
      nombre: 'Miraflores',
      codigoEstablecimiento: '0001',
      direccion: 'Av. Larco 345',
      horario: [],
      whatsapp: null,
      horaCorte: '05:00',
      creadoEn: '2026-10-01T15:00:00.000Z',
      actualizadoEn: '2026-10-01T15:00:00.000Z',
    },
  ],
  suscripciones: [
    {
      id: SUSC_A,
      empresaId: ID.empresa,
      sucursalId: ID.sucursalA,
      plan: { id: PLAN_BASE, codigo: 'BASE', nombre: 'Plan base' },
      vencimiento: '2026-11-10',
      estado: 'ACTIVA',
      suspensionDesde: '2026-11-18',
      diasRestantesGracia: null,
    },
  ],
  administradores: [
    { id: ID.usuario, nombre: 'Marta Pérez', nombreUsuario: 'marta', activo: true },
    { id: ID.otro, nombre: 'Luis Vega', nombreUsuario: 'luis', activo: false },
  ],
};

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarSesionDePlataforma({
    token: TOKEN_SA,
    superadministrador: { id: ID.superadmin, nombre: 'Ana Torres' },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function cambiarFecha(etiqueta: string | RegExp, valor: string) {
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
}

describe('navegación del panel', () => {
  it('tiene empresas, suscripciones y planes, y marca dónde estás', async () => {
    servidor({ 'GET /plataforma/empresas': () => json(200, []) });
    renderApp('/plataforma');
    const nav = await screen.findByRole('navigation', { name: 'Plataforma' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Empresas', 'Suscripciones', 'Planes']);
    expect(within(nav).getByRole('link', { name: 'Empresas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Planes' })).not.toHaveAttribute('aria-current');
  });

  it('la lista de empresas lleva al detalle y al alta', async () => {
    servidor({
      'GET /plataforma/empresas': () =>
        json(200, [
          {
            id: ID.empresa,
            nombre: 'Inversiones Sol del Norte',
            creadoEn: '2026-10-01T15:00:00.000Z',
            sucursales: [],
          },
        ]),
      [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle),
    });
    renderApp('/plataforma');
    expect(await screen.findByRole('link', { name: 'Nueva empresa' })).toHaveAttribute(
      'href',
      '/plataforma/empresas/nueva',
    );
    await userEvent.click(await screen.findByRole('link', { name: /Inversiones Sol del Norte/ }));
    expect(
      await screen.findByRole('heading', { name: 'Inversiones Sol del Norte' }),
    ).toBeInTheDocument();
    // En el detalle, "Empresas" sigue marcada en la navegación.
    expect(
      within(screen.getByRole('navigation', { name: 'Plataforma' })).getByRole('link', {
        name: 'Empresas',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

describe('alta de empresa (criterio 101)', () => {
  async function llenarAlta(extra: { usuario?: string } = {}) {
    await userEvent.type(screen.getByLabelText('Nombre de la empresa'), 'Cevichería El Faro');
    await userEvent.type(screen.getByLabelText('RUC'), '20600000005');
    await userEvent.type(screen.getByLabelText('Razón social'), 'El Faro E.I.R.L.');
    await userEvent.selectOptions(screen.getByLabelText('Régimen tributario'), 'MYPE_TRIBUTARIO');
    await userEvent.type(screen.getByLabelText('Nombre de la sucursal'), 'El Faro · Barranco');
    await userEvent.type(screen.getByLabelText('Dirección'), 'Av. Grau 340');
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'Carmen Rojas');
    await userEvent.type(screen.getByLabelText('Nombre de usuario'), extra.usuario ?? 'faro.admin');
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Temporal-1234');
    await userEvent.type(screen.getByLabelText('Motivo del alta'), 'Cliente nuevo');
  }

  const altaOk = {
    empresaId: ID.empresa,
    emisores: [{ id: EMISOR_A, ruc: '20600000005' }],
    sucursales: [
      {
        id: ID.sucursalA,
        nombre: 'El Faro · Barranco',
        suscripcion: {
          id: SUSC_A,
          empresaId: ID.empresa,
          sucursalId: ID.sucursalA,
          plan: { id: PLAN_BASE, codigo: 'BASE', nombre: 'Plan base' },
          vencimiento: sumarMeses(hoy, 1),
          estado: 'ACTIVA',
          suspensionDesde: sumarMeses(hoy, 1),
          diasRestantesGracia: null,
        },
      },
    ],
    administrador: { id: ID.usuario, pin: '493017' },
  };

  it('valida cada campo con su mensaje antes de llamar a la API', async () => {
    const s = servidor({ 'GET /plataforma/planes': () => json(200, [planBase]) });
    renderApp('/plataforma/empresas/nueva');
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar empresa' }));
    for (const mensaje of [
      'Escribe el nombre de la empresa',
      'Escribe el RUC',
      'Escribe la razón social',
      'Elige el régimen tributario',
      'Escribe el nombre de la sucursal',
      'Escribe la dirección',
      'Escribe el nombre del administrador',
      'Escribe un nombre de usuario',
      'Escribe una contraseña temporal o genera una',
      'Escribe el motivo: queda en la auditoría',
    ]) {
      expect(screen.getByText(mensaje)).toBeInTheDocument();
    }
    await userEvent.type(screen.getByLabelText('RUC'), '20600000006');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar empresa' }));
    expect(screen.getByText(/El RUC no es válido/)).toBeInTheDocument();
    expect(s.de('POST', '/plataforma/empresas')).toHaveLength(0);
  });

  it('registra la empresa con lo escrito y muestra el PIN del administrador una sola vez', async () => {
    const s = servidor({
      'GET /plataforma/planes': () => json(200, [planBase, planPro]),
      'POST /plataforma/empresas': () => json(201, altaOk),
      [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle),
    });
    renderApp('/plataforma/empresas/nueva');
    await screen.findByLabelText('Nombre de la empresa');
    await llenarAlta({ usuario: 'FARO.Admin' });
    await userEvent.selectOptions(await screen.findByLabelText(/^Plan/), PLAN_PRO);
    cambiarFecha(/^Vencimiento/, sumarMeses(hoy, 2));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar empresa' }));

    expect(await screen.findByText('493017')).toBeInTheDocument();
    expect(screen.getByText('Se muestra una sola vez')).toBeInTheDocument();
    expect(screen.getByText('Temporal-1234')).toBeInTheDocument();
    expect(s.de('POST', '/plataforma/empresas')[0]?.cuerpo).toEqual({
      nombre: 'Cevichería El Faro',
      emisores: [
        { ruc: '20600000005', razonSocial: 'El Faro E.I.R.L.', regimen: 'MYPE_TRIBUTARIO' },
      ],
      sucursales: [
        {
          rucEmisor: '20600000005',
          nombre: 'El Faro · Barranco',
          codigoEstablecimiento: '0001',
          direccion: 'Av. Grau 340',
          suscripcion: { planId: PLAN_PRO, vencimiento: sumarMeses(hoy, 2) },
        },
      ],
      administrador: {
        nombre: 'Carmen Rojas',
        nombreUsuario: 'faro.admin',
        contrasenaTemporal: 'Temporal-1234',
      },
      motivo: 'Cliente nuevo',
    });
    // La credencial del superadministrador, no la de una empresa.
    expect(s.de('POST', '/plataforma/empresas')[0]?.cabeceras.get('Authorization')).toBe(
      `Bearer ${TOKEN_SA}`,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ya lo anoté' }));
    expect(
      await screen.findByRole('heading', { name: 'Inversiones Sol del Norte' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('493017')).toBeNull();
  });

  it('sin plan ni vencimiento no manda suscripción: manda el plan por defecto el servidor', async () => {
    const s = servidor({
      'GET /plataforma/planes': () => json(200, [planBase]),
      'POST /plataforma/empresas': () => json(201, altaOk),
    });
    renderApp('/plataforma/empresas/nueva');
    await screen.findByLabelText('Nombre de la empresa');
    await llenarAlta();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar empresa' }));
    await screen.findByText('493017');
    const cuerpo = s.de('POST', '/plataforma/empresas')[0]?.cuerpo as {
      sucursales: Record<string, unknown>[];
    };
    expect(cuerpo.sucursales[0]).not.toHaveProperty('suscripcion');
  });

  it('un usuario ocupado se marca en su campo y no se pierde nada de lo escrito', async () => {
    servidor({
      'GET /plataforma/planes': () => json(200, [planBase]),
      'POST /plataforma/empresas': () => json(409, { codigo: 'CONFLICTO', mensaje: 'x' }),
    });
    renderApp('/plataforma/empresas/nueva');
    await screen.findByLabelText('Nombre de la empresa');
    await llenarAlta();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar empresa' }));
    expect(
      await screen.findByText('Ese nombre de usuario ya está en uso. Elige otro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la empresa')).toHaveValue('Cevichería El Faro');
    expect(screen.getByLabelText('RUC')).toHaveValue('20600000005');
    expect(screen.getByLabelText('Contraseña temporal')).toHaveValue('Temporal-1234');
  });

  it('un RUC repetido que detecta el servidor se marca en su campo, en español', async () => {
    servidor({
      'GET /plataforma/planes': () => json(200, [planBase]),
      'POST /plataforma/empresas': () =>
        json(400, {
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'x',
          campos: [
            { campo: 'emisores.0.ruc', mensaje: 'El RUC ya está registrado' },
            { campo: 'nombre', mensaje: 'Too small: expected string to have >=1 characters' },
          ],
        }),
    });
    renderApp('/plataforma/empresas/nueva');
    await screen.findByLabelText('Nombre de la empresa');
    await llenarAlta();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar empresa' }));
    expect(await screen.findByText('El RUC ya está registrado')).toBeInTheDocument();
    // Un mensaje de validación genérico en inglés no se muestra tal cual.
    expect(screen.queryByText(/Too small/)).toBeNull();
  });

  it('un plan inválido se dice arriba, con la salida', async () => {
    servidor({
      'GET /plataforma/planes': () => json(200, [planBase]),
      'POST /plataforma/empresas': () => json(422, { codigo: 'PLAN_INVALIDO', mensaje: 'x' }),
    });
    renderApp('/plataforma/empresas/nueva');
    await screen.findByLabelText('Nombre de la empresa');
    await llenarAlta();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar empresa' }));
    expect(await screen.findByText('No pudimos registrar la empresa')).toBeInTheDocument();
    expect(screen.getByText(/no existe o está desactivado/)).toBeInTheDocument();
  });

  it('permite agregar y quitar emisores y sucursales, y elegir el emisor de cada sucursal', async () => {
    servidor({ 'GET /plataforma/planes': () => json(200, [planBase]) });
    renderApp('/plataforma/empresas/nueva');
    await screen.findByLabelText('Nombre de la empresa');
    expect(screen.queryByRole('button', { name: /Quitar este emisor/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar otro emisor' }));
    expect(screen.getAllByRole('group', { name: /^Emisor \d/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar otra sucursal' }));
    expect(screen.getAllByRole('group', { name: /^Sucursal \d/ })).toHaveLength(2);
    // Con dos emisores, la sucursal nueva no tiene emisor hasta que se elige.
    const emisores = screen.getAllByLabelText('Emisor');
    expect(emisores[1]).toHaveValue('');
    await userEvent.click(screen.getAllByRole('button', { name: /Quitar este emisor/ })[1]!);
    expect(screen.getAllByRole('group', { name: /^Emisor \d/ })).toHaveLength(1);
    await userEvent.click(screen.getAllByRole('button', { name: /Quitar esta sucursal/ })[1]!);
    expect(screen.getAllByRole('group', { name: /^Sucursal \d/ })).toHaveLength(1);
  });

  it('la fecha de vencimiento no puede ser anterior a hoy', async () => {
    const s = servidor({ 'GET /plataforma/planes': () => json(200, [planBase]) });
    renderApp('/plataforma/empresas/nueva');
    await screen.findByLabelText('Nombre de la empresa');
    await llenarAlta();
    cambiarFecha(/^Vencimiento/, '2020-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar empresa' }));
    expect(await screen.findByText('No puede ser anterior a hoy')).toBeInTheDocument();
    expect(s.de('POST', '/plataforma/empresas')).toHaveLength(0);
  });
});

describe('detalle de la empresa (criterio 101)', () => {
  it('muestra sucursales con su plan y estado, emisores y administradores', async () => {
    servidor({ [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle) });
    renderApp(`/plataforma/empresas/${ID.empresa}`);
    expect(
      await screen.findByRole('heading', { name: 'Inversiones Sol del Norte' }),
    ).toBeInTheDocument();
    const sucursales = screen.getByRole('list', { name: 'Sucursales' });
    expect(sucursales).toHaveTextContent('Miraflores');
    expect(sucursales).toHaveTextContent('Sol del Norte S.A.C. · código 0001');
    expect(sucursales).toHaveTextContent('Activa');
    expect(sucursales).toHaveTextContent('Plan base · vence el 10/11/2026');
    expect(screen.getByRole('list', { name: 'Emisores' })).toHaveTextContent(
      'RUC 20100000009 · Régimen General',
    );
    const admins = screen.getByRole('list', { name: 'Administradores' });
    expect(admins).toHaveTextContent('Marta Pérez');
    expect(admins).toHaveTextContent('Inactivo');
    expect(screen.getByRole('link', { name: 'Agregar sucursal' })).toHaveAttribute(
      'href',
      `/plataforma/empresas/${ID.empresa}/sucursales/nueva`,
    );
    expect(screen.getByRole('link', { name: 'Agregar emisor' })).toHaveAttribute(
      'href',
      `/plataforma/empresas/${ID.empresa}/emisores/nuevo`,
    );
  });

  it('una empresa que no existe lo dice', async () => {
    servidor({
      [`GET /plataforma/empresas/${ID.empresa}`]: () =>
        json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
    });
    renderApp(`/plataforma/empresas/${ID.empresa}`);
    expect(await screen.findByText('No encontramos esta empresa')).toBeInTheDocument();
  });

  it('entra a dar soporte desde el detalle, pidiendo el motivo', async () => {
    const s = servidor({ [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle) });
    renderApp(`/plataforma/empresas/${ID.empresa}`);
    await userEvent.click(await screen.findByRole('button', { name: /Entrar a dar soporte/ }));
    const hoja = await screen.findByRole('dialog');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Entrar a dar soporte' }));
    expect(within(hoja).getByText('Escribe el motivo del soporte')).toBeInTheDocument();
    expect(s.de('POST', `/plataforma/empresas/${ID.empresa}/soporte`)).toHaveLength(0);
  });
});

describe('agregar emisor y sucursal (criterio 101)', () => {
  it('agrega un emisor con motivo y una clave de idempotencia, y vuelve al detalle con el aviso', async () => {
    const s = servidor({
      [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle),
      [`POST /plataforma/empresas/${ID.empresa}/emisores`]: () =>
        json(201, { ...detalle.emisores[0], id: EMISOR_B, ruc: '20600000005' }),
    });
    renderApp(`/plataforma/empresas/${ID.empresa}/emisores/nuevo`);
    await userEvent.type(await screen.findByLabelText('RUC'), '20600000005');
    await userEvent.type(screen.getByLabelText('Razón social'), 'Kiosco Barranco E.I.R.L.');
    await userEvent.selectOptions(screen.getByLabelText('Régimen tributario'), 'NUEVO_RUS');
    await userEvent.type(screen.getByLabelText('Motivo'), 'El cliente abrió un kiosco');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    expect(
      await screen.findByText('Emisor Kiosco Barranco E.I.R.L. agregado.'),
    ).toBeInTheDocument();
    const llamada = s.de('POST', `/plataforma/empresas/${ID.empresa}/emisores`)[0];
    expect(llamada?.cuerpo).toEqual({
      ruc: '20600000005',
      razonSocial: 'Kiosco Barranco E.I.R.L.',
      regimen: 'NUEVO_RUS',
      motivo: 'El cliente abrió un kiosco',
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('no deja repetir un RUC que la empresa ya tiene', async () => {
    const s = servidor({ [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle) });
    renderApp(`/plataforma/empresas/${ID.empresa}/emisores/nuevo`);
    await userEvent.type(await screen.findByLabelText('RUC'), '20100000009');
    await userEvent.type(screen.getByLabelText('Razón social'), 'Otra S.A.C.');
    await userEvent.selectOptions(screen.getByLabelText('Régimen tributario'), 'GENERAL');
    await userEvent.type(screen.getByLabelText('Motivo'), 'Prueba');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    expect(
      await screen.findByText('Esta empresa ya tiene un emisor con este RUC'),
    ).toBeInTheDocument();
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });

  it('agrega una sucursal con su plan y vencimiento; con un solo emisor ya viene elegido', async () => {
    const s = servidor({
      [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle),
      'GET /plataforma/planes': () => json(200, [planBase, planPro]),
      [`POST /plataforma/empresas/${ID.empresa}/sucursales`]: () =>
        json(201, {
          id: ID.sucursalB,
          nombre: 'San Isidro',
          suscripcion: { ...detalle.suscripciones[0], id: SUSC_B, sucursalId: ID.sucursalB },
        }),
    });
    renderApp(`/plataforma/empresas/${ID.empresa}/sucursales/nueva`);
    await userEvent.type(await screen.findByLabelText('Nombre de la sucursal'), 'San Isidro');
    expect(screen.getByLabelText('Emisor')).toHaveValue(EMISOR_A);
    await userEvent.clear(screen.getByLabelText('Código de establecimiento'));
    await userEvent.type(screen.getByLabelText('Código de establecimiento'), '0002');
    await userEvent.type(screen.getByLabelText('Dirección'), 'Calle Los Cedros 120');
    await userEvent.selectOptions(await screen.findByLabelText(/^Plan/), PLAN_PRO);
    await userEvent.type(screen.getByLabelText('Motivo'), 'Segunda sucursal');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar sucursal' }));
    expect(await screen.findByText(/Sucursal San Isidro agregada/)).toBeInTheDocument();
    const llamada = s.de('POST', `/plataforma/empresas/${ID.empresa}/sucursales`)[0];
    expect(llamada?.cuerpo).toEqual({
      rucEmisor: '20100000009',
      nombre: 'San Isidro',
      codigoEstablecimiento: '0002',
      direccion: 'Calle Los Cedros 120',
      suscripcion: { planId: PLAN_PRO },
      motivo: 'Segunda sucursal',
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
  });

  it('valida los datos de la sucursal antes de enviar', async () => {
    const s = servidor({
      [`GET /plataforma/empresas/${ID.empresa}`]: () => json(200, detalle),
      'GET /plataforma/planes': () => json(200, [planBase]),
    });
    renderApp(`/plataforma/empresas/${ID.empresa}/sucursales/nueva`);
    await userEvent.clear(await screen.findByLabelText('Código de establecimiento'));
    await userEvent.type(screen.getByLabelText('Código de establecimiento'), '12');
    await userEvent.type(screen.getByLabelText(/^WhatsApp/), '987654321');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar sucursal' }));
    expect(screen.getByText('Escribe el nombre de la sucursal')).toBeInTheDocument();
    expect(screen.getByText('Son 4 dígitos, por ejemplo 0001')).toBeInTheDocument();
    expect(screen.getByText('Escribe la dirección')).toBeInTheDocument();
    expect(screen.getByText('Usa el formato +519XXXXXXXX')).toBeInTheDocument();
    expect(screen.getByText('Escribe el motivo: queda en la auditoría')).toBeInTheDocument();
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });
});

describe('suscripciones por estado (criterios 76 y 101)', () => {
  it('lista todas y filtra por estado pidiéndolo a la API', async () => {
    const pedidos: (string | null)[] = [];
    const s = servidor({
      'GET /plataforma/suscripciones': ({ url }) => {
        const estado = url.searchParams.get('estado');
        pedidos.push(estado);
        const todas = [
          resumen(SUSC_A, 'Miraflores', 'ACTIVA'),
          resumen(SUSC_B, 'Surco', 'EN_GRACIA'),
        ];
        return json(200, estado ? todas.filter((x) => x.estado === estado) : todas);
      },
    });
    renderApp('/plataforma/suscripciones');
    const lista = await screen.findByRole('list', { name: 'Suscripciones' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
    expect(lista).toHaveTextContent('Inversiones Sol del Norte');
    expect(lista).toHaveTextContent(
      'Plan base · vence el 10/11/2026 · 120 de 500 comprobantes este mes',
    );
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'En gracia' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Suscripciones' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
    // Pidió la lista sin filtro y después la de `EN_GRACIA`, no una sola lista filtrada en el navegador.
    expect(pedidos).toEqual([null, 'EN_GRACIA']);
    expect(
      s
        .de('GET', '/plataforma/suscripciones')
        .some((l) => l.cabeceras.get('Authorization') === `Bearer ${TOKEN_SA}`),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'En gracia' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('un estado sin suscripciones lo dice con una frase propia', async () => {
    servidor({ 'GET /plataforma/suscripciones': () => json(200, []) });
    renderApp('/plataforma/suscripciones?estado=SUSPENDIDA');
    expect(await screen.findByText('No hay suscripciones aquí')).toBeInTheDocument();
    expect(
      screen.getByText('Ninguna sucursal está suspendida. Es una buena noticia.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspendidas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('si no carga, ofrece reintentar', async () => {
    servidor({
      'GET /plataforma/suscripciones': () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    });
    renderApp('/plataforma/suscripciones');
    expect(await screen.findByText('No pudimos cargar las suscripciones')).toBeInTheDocument();
  });
});

describe('detalle de la suscripción: pago, plan y vencimiento (criterio 101)', () => {
  let actual = resumen(SUSC_A, 'Miraflores', 'EN_GRACIA');
  beforeEach(() => {
    actual = resumen(SUSC_A, 'Miraflores', 'EN_GRACIA');
  });
  const base = () => ({
    'GET /plataforma/suscripciones': () => json(200, [actual]),
    'GET /plataforma/planes': () => json(200, [planBase, planPro]),
  });

  it('muestra el estado, las fechas y el consumo de comprobantes del mes', async () => {
    servidor(base());
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    expect(await screen.findByRole('heading', { name: 'Miraflores' })).toBeInTheDocument();
    expect(screen.getByText('Quedan 3 días de gracia')).toBeInTheDocument();
    expect(screen.getByText('10 de noviembre de 2026')).toBeInTheDocument();
    expect(screen.getAllByText('18 de noviembre de 2026').length).toBeGreaterThan(0);
    expect(screen.getByText('120 de 500')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inversiones Sol del Norte' })).toHaveAttribute(
      'href',
      `/plataforma/empresas/${ID.empresa}`,
    );
  });

  it('una suscripción que no está en la lista lo dice', async () => {
    servidor(base());
    renderApp(`/plataforma/suscripciones/${SUSC_B}`);
    expect(await screen.findByText('No encontramos esta suscripción')).toBeInTheDocument();
  });

  async function abrirPago() {
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar pago' }));
    return screen.findByRole('dialog', { name: 'Registrar pago' });
  }

  it('sugiere el vencimiento un mes después del actual, con las reglas de dominio', async () => {
    servidor(base());
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    const hoja = await abrirPago();
    expect(within(hoja).getByLabelText('Vencimiento nuevo')).toHaveValue(
      sumarMeses('2026-11-10', 1),
    );
    expect(
      within(hoja).getByText(/Sugerido: un mes después del actual \(10\/12\/2026\)/),
    ).toBeInTheDocument();
    expect(within(hoja).getByLabelText('Fecha del pago')).toHaveValue(hoy);
  });

  it('valida monto, fechas y motivo antes de enviar', async () => {
    const s = servidor(base());
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    const hoja = await abrirPago();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Registrar pago' }));
    expect(within(hoja).getByText(/Escribe el monto en soles/)).toBeInTheDocument();
    expect(within(hoja).getByText('Escribe el motivo: queda en la auditoría')).toBeInTheDocument();
    fireEvent.change(within(hoja).getByLabelText('Vencimiento nuevo'), {
      target: { value: '2026-11-10' },
    });
    fireEvent.change(within(hoja).getByLabelText('Fecha del pago'), {
      target: { value: sumarMeses(hoy, 1) },
    });
    await userEvent.type(within(hoja).getByLabelText('Monto (S/)'), '0');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Registrar pago' }));
    expect(
      within(hoja).getByText('Debe ser posterior al vencimiento actual (10/11/2026)'),
    ).toBeInTheDocument();
    expect(within(hoja).getByText('El pago no puede ser de una fecha futura')).toBeInTheDocument();
    expect(within(hoja).getByText(/Escribe el monto en soles/)).toBeInTheDocument();
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });

  it('registra el pago con clave de idempotencia y dice cómo quedó la suscripción', async () => {
    const s = servidor(base());
    s.poner(`POST /plataforma/suscripciones/${SUSC_A}/pagos`, () => {
      actual = {
        ...actual,
        estado: 'ACTIVA',
        vencimiento: '2026-12-10',
        diasRestantesGracia: null,
      };
      return json(201, {
        pago: {
          id: SUSC_B,
          suscripcionId: SUSC_A,
          monto: '120.50',
          fechaPago: hoy,
          medio: 'YAPE',
          referencia: 'OP-1',
          vencimientoAnterior: '2026-11-10',
          vencimientoNuevo: '2026-12-10',
          creadoEn: new Date().toISOString(),
        },
        suscripcion: { ...detalle.suscripciones[0], vencimiento: '2026-12-10' },
      });
    });
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    const hoja = await abrirPago();
    await userEvent.type(within(hoja).getByLabelText('Monto (S/)'), '120,5');
    await userEvent.selectOptions(within(hoja).getByLabelText('Medio de pago'), 'YAPE');
    await userEvent.type(within(hoja).getByLabelText(/Referencia/), 'OP-1');
    await userEvent.type(within(hoja).getByLabelText('Motivo'), 'Pago de noviembre');
    // El resultado se anticipa con las reglas de dominio.
    expect(
      within(hoja).getByText(/Con este vencimiento la sucursal quedará activa/),
    ).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText(/Pago de S\/ 120\.50 registrado/)).toBeInTheDocument();
    const llamada = s.de('POST', `/plataforma/suscripciones/${SUSC_A}/pagos`)[0];
    expect(llamada?.cuerpo).toEqual({
      monto: '120.5',
      fechaPago: hoy,
      medio: 'YAPE',
      referencia: 'OP-1',
      vencimientoNuevo: '2026-12-10',
      motivo: 'Pago de noviembre',
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // La pantalla se actualiza con la suscripción nueva.
    await waitFor(() => expect(screen.queryByText('Quedan 3 días de gracia')).toBeNull());
  });

  it('si se corta la red, repetir el envío usa la misma clave y no duplica el pago', async () => {
    let intentos = 0;
    const s = servidor(base());
    s.poner(`POST /plataforma/suscripciones/${SUSC_A}/pagos`, () => {
      if (++intentos <= 7) throw new TypeError('Failed to fetch');
      return json(201, {
        pago: {
          id: SUSC_B,
          suscripcionId: SUSC_A,
          monto: '100.00',
          fechaPago: hoy,
          medio: 'TRANSFERENCIA',
          referencia: null,
          vencimientoAnterior: '2026-11-10',
          vencimientoNuevo: '2026-12-10',
          creadoEn: new Date().toISOString(),
        },
        suscripcion: detalle.suscripciones[0],
      });
    });
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    const hoja = await abrirPago();
    await userEvent.type(within(hoja).getByLabelText('Monto (S/)'), '100');
    await userEvent.type(within(hoja).getByLabelText('Motivo'), 'Pago');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Registrar pago' }));
    expect(
      await within(hoja).findByText(/no sabemos si el pago quedó registrado/),
    ).toBeInTheDocument();
    // Lo escrito se conserva.
    expect(within(hoja).getByLabelText('Monto (S/)')).toHaveValue('100');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText(/Pago de S\/ 100\.00 registrado/)).toBeInTheDocument();
    const claves = new Set(
      s
        .de('POST', `/plataforma/suscripciones/${SUSC_A}/pagos`)
        .map((l) => l.cabeceras.get('Idempotency-Key')),
    );
    expect(claves.size).toBe(1);
  });

  it('un rechazo claro del servidor suelta la clave: el siguiente envío es otra escritura', async () => {
    let n = 0;
    const s = servidor(base());
    s.poner(`POST /plataforma/suscripciones/${SUSC_A}/pagos`, () => {
      n++;
      return json(400, { codigo: 'DATOS_INVALIDOS', mensaje: 'x' });
    });
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    const hoja = await abrirPago();
    await userEvent.type(within(hoja).getByLabelText('Monto (S/)'), '100');
    await userEvent.type(within(hoja).getByLabelText('Motivo'), 'Pago');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Registrar pago' }));
    await within(hoja).findByText('No pudimos registrar el pago');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() => expect(n).toBe(2));
    const claves = s
      .de('POST', `/plataforma/suscripciones/${SUSC_A}/pagos`)
      .map((l) => l.cabeceras.get('Idempotency-Key'));
    expect(new Set(claves).size).toBe(2);
  });

  it('cambia el plan con motivo', async () => {
    const s = servidor(base());
    s.poner(`PATCH /plataforma/suscripciones/${SUSC_A}`, () =>
      json(200, {
        ...detalle.suscripciones[0],
        plan: { id: PLAN_PRO, codigo: 'PRO', nombre: 'Pro' },
      }),
    );
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar plan' }));
    const hoja = await screen.findByRole('dialog', { name: 'Cambiar plan' });
    // Elegir el mismo plan no es un cambio.
    await userEvent.type(within(hoja).getByLabelText('Motivo'), 'Subió de plan');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar plan' }));
    expect(within(hoja).getByText('Elige un plan distinto del actual')).toBeInTheDocument();
    await userEvent.selectOptions(within(hoja).getByLabelText('Plan'), PLAN_PRO);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar plan' }));
    expect(await screen.findByText(/El plan ahora es Pro/)).toBeInTheDocument();
    expect(s.de('PATCH', `/plataforma/suscripciones/${SUSC_A}`)[0]?.cuerpo).toEqual({
      planId: PLAN_PRO,
      motivo: 'Subió de plan',
    });
  });

  it('ajusta el vencimiento a cualquier fecha, con motivo', async () => {
    const s = servidor(base());
    s.poner(`PATCH /plataforma/suscripciones/${SUSC_A}`, () =>
      json(200, { ...detalle.suscripciones[0], vencimiento: '2026-11-05' }),
    );
    renderApp(`/plataforma/suscripciones/${SUSC_A}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Ajustar vencimiento' }));
    const hoja = await screen.findByRole('dialog', { name: 'Ajustar vencimiento' });
    expect(within(hoja).getByLabelText('Vencimiento')).toHaveValue('2026-11-10');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Ajustar vencimiento' }));
    expect(within(hoja).getByText('Elige una fecha distinta de la actual')).toBeInTheDocument();
    fireEvent.change(within(hoja).getByLabelText('Vencimiento'), {
      target: { value: '2026-11-05' },
    });
    await userEvent.type(
      within(hoja).getByLabelText('Motivo'),
      'El pago se anotó con fecha equivocada',
    );
    await userEvent.click(within(hoja).getByRole('button', { name: 'Ajustar vencimiento' }));
    expect(
      await screen.findByText('El vencimiento ahora es el 5 de noviembre de 2026.'),
    ).toBeInTheDocument();
    expect(s.de('PATCH', `/plataforma/suscripciones/${SUSC_A}`)[0]?.cuerpo).toEqual({
      vencimiento: '2026-11-05',
      motivo: 'El pago se anotó con fecha equivocada',
    });
  });
});

describe('planes (criterio 101)', () => {
  it('lista los planes con precio, gracia y marcas', async () => {
    servidor({
      'GET /plataforma/planes': () =>
        json(200, [
          planBase,
          planPro,
          { ...planPro, id: SUSC_B, codigo: 'VIEJO', nombre: 'Viejo', activo: false },
        ]),
    });
    renderApp('/plataforma/planes');
    const lista = await screen.findByRole('list', { name: 'Planes' });
    expect(lista).toHaveTextContent('Plan base');
    expect(lista).toHaveTextContent('BASE · Sin definir al mes · 7 días de gracia');
    expect(lista).toHaveTextContent('PRO · S/ 120.00 al mes · 10 días de gracia');
    expect(lista).toHaveTextContent('Por defecto');
    expect(lista).toHaveTextContent('Inactivo');
    expect(screen.getByRole('link', { name: 'Nuevo plan' })).toHaveAttribute(
      'href',
      '/plataforma/planes/nuevo',
    );
  });

  it('crea un plan con módulos, precios opcionales y motivo', async () => {
    const s = servidor({
      'GET /plataforma/planes': () => json(200, [planBase]),
      'POST /plataforma/planes': () => json(201, planPro),
    });
    renderApp('/plataforma/planes/nuevo');
    await userEvent.click(await screen.findByRole('button', { name: 'Crear plan' }));
    expect(screen.getByText('Escribe el código del plan')).toBeInTheDocument();
    expect(screen.getByText('Escribe el nombre del plan')).toBeInTheDocument();
    expect(s.de('POST', '/plataforma/planes')).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Código'), 'PRO');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Pro');
    await userEvent.clear(screen.getByLabelText('Días de gracia'));
    await userEvent.type(screen.getByLabelText('Días de gracia'), '10');
    await userEvent.type(screen.getByLabelText(/Precio mensual/), '120');
    await userEvent.type(screen.getByLabelText(/Comprobantes incluidos al mes/), '500');
    await userEvent.type(screen.getByLabelText(/Precio por comprobante excedente/), '0.05');
    await userEvent.click(screen.getByRole('switch', { name: 'Inventario' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Reportes' }));
    await userEvent.type(screen.getByLabelText('Motivo'), 'Plan intermedio');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plan' }));
    await waitFor(() => expect(s.de('POST', '/plataforma/planes')).toHaveLength(1));
    expect(s.de('POST', '/plataforma/planes')[0]?.cuerpo).toEqual({
      codigo: 'PRO',
      nombre: 'Pro',
      precioMensual: '120',
      cuotaComprobantesMes: 500,
      precioExcedente: '0.05',
      diasGracia: 10,
      modulos: ['SALON', 'COCINA', 'CAJA', 'FACTURACION', 'PEDIDOS_WEB'],
      porDefecto: false,
      activo: true,
      motivo: 'Plan intermedio',
    });
    expect(await screen.findByRole('list', { name: 'Planes' })).toBeInTheDocument();
  });

  it('al editar manda solo lo que cambió y el motivo', async () => {
    const s = servidor({
      'GET /plataforma/planes': () => json(200, [planBase, planPro]),
      [`PATCH /plataforma/planes/${PLAN_PRO}`]: () => json(200, { ...planPro, diasGracia: 15 }),
    });
    renderApp(`/plataforma/planes/${PLAN_PRO}`);
    const dias = await screen.findByLabelText('Días de gracia');
    expect(dias).toHaveValue('10');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await userEvent.clear(dias);
    await userEvent.type(dias, '15');
    await userEvent.clear(screen.getByLabelText(/Precio mensual/));
    await userEvent.type(screen.getByLabelText('Motivo'), 'Más tiempo para pagar');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(s.de('PATCH', `/plataforma/planes/${PLAN_PRO}`)).toHaveLength(1));
    // El precio vaciado viaja como `null` (sin definir); lo que no cambió no viaja.
    expect(s.de('PATCH', `/plataforma/planes/${PLAN_PRO}`)[0]?.cuerpo).toEqual({
      diasGracia: 15,
      precioMensual: null,
      motivo: 'Más tiempo para pagar',
    });
  });

  it('quitar la marca de plan por defecto sin dar otro lo explica', async () => {
    servidor({
      'GET /plataforma/planes': () => json(200, [planBase]),
      [`PATCH /plataforma/planes/${PLAN_BASE}`]: () =>
        json(409, { codigo: 'CONFLICTO', mensaje: 'x' }),
    });
    renderApp(`/plataforma/planes/${PLAN_BASE}`);
    await userEvent.click(await screen.findByRole('switch', { name: 'Plan por defecto' }));
    await userEvent.type(screen.getByLabelText('Motivo'), 'Prueba');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByText(/Siempre debe haber un plan por defecto activo/),
    ).toBeInTheDocument();
  });

  it('un plan por defecto no puede quedar inactivo', async () => {
    const s = servidor({ 'GET /plataforma/planes': () => json(200, [planBase]) });
    renderApp(`/plataforma/planes/${PLAN_BASE}`);
    await userEvent.click(await screen.findByRole('switch', { name: 'Activo' }));
    await userEvent.type(screen.getByLabelText('Motivo'), 'Prueba');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('El plan por defecto debe estar activo')).toBeInTheDocument();
    expect(s.llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(0);
  });
});
