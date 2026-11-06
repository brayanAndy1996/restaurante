import type { PadronRucRespuesta } from '@restaurante/contratos';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ClienteFactura } from '../src/modulos/caja/ClienteFactura';
import { CLIENTE_VACIO, type ClienteEscrito } from '../src/modulos/caja/cobro';
import { useClienteFactura } from '../src/modulos/caja/padron';
import { json, servidor } from './ayudas';

// spec: 006-caja-cobro, criterios 139 a 141 y 176 (pruebas no protegidas del cliente de la factura): el padrón llena
// la razón social y la dirección, el cajero las corrige, un RUC con aviso exige «Emitir igual», el padrón caído deja
// escribir a mano y solo se consulta un RUC válido de una factura.

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const RUC = '20100070970';
const OTRO_RUC = '20131312955';
const RUC_INVALIDO = '20100070971';

function padron(extra: Partial<PadronRucRespuesta> = {}): PadronRucRespuesta {
  return {
    ruc: RUC,
    razonSocial: 'Supermercados Peruanos S.A.',
    direccion: 'Av. Principal 123, Lima',
    estado: 'ACTIVO',
    condicion: 'HABIDO',
    activo: true,
    habido: true,
    // 05/11 a las 04:00 en Lima.
    padronAl: '2026-11-05T09:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lo que hace una pantalla de cobro con el componente: el cliente, el intento de cobrar y si ya se podría cobrar. */
function Arnes({
  tipo = 'FACTURA',
  inicial = CLIENTE_VACIO,
  total = '68.50',
}: {
  tipo?: 'BOLETA' | 'FACTURA';
  inicial?: ClienteEscrito;
  total?: string;
}) {
  const [cliente, setCliente] = useState(inicial);
  const [intentado, setIntentado] = useState(false);
  const estado = useClienteFactura(tipo, total, cliente, setCliente);
  return (
    <>
      <ClienteFactura
        tipo={tipo}
        total={total}
        cliente={cliente}
        onCliente={setCliente}
        errores={intentado && !estado.validado.ok ? estado.validado.errores : null}
        padron={estado}
      />
      <button type="button" onClick={() => setIntentado(true)}>
        Cobrar
      </button>
      <output aria-label="Se puede cobrar">{estado.validado.ok ? 'sí' : 'no'}</output>
    </>
  );
}

function montar(
  manejadores: Record<string, Parameters<typeof servidor>[0][string]>,
  props: Parameters<typeof Arnes>[0] = {},
) {
  const s = servidor(manejadores);
  const clientes = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={clientes}>
      <Arnes {...props} />
    </QueryClientProvider>,
  );
  return s;
}

const escribirRuc = (ruc: string) => userEvent.type(screen.getByLabelText('RUC'), ruc);
const sePuedeCobrar = () => screen.getByLabelText('Se puede cobrar').textContent === 'sí';

describe('Autocompletar con el padrón (criterios 139 y 176)', () => {
  it('al completar un RUC válido consulta el padrón y llena la razón social y la dirección', async () => {
    const s = montar({ [`GET /padron/ruc/${RUC}`]: () => json(200, padron()) });
    await escribirRuc(RUC);
    await waitFor(() =>
      expect(screen.getByLabelText('Razón social')).toHaveValue('Supermercados Peruanos S.A.'),
    );
    expect(screen.getByLabelText('Dirección fiscal')).toHaveValue('Av. Principal 123, Lima');
    expect(s.de('GET', `/padron/ruc/${RUC}`)).toHaveLength(1);
    // La fecha es la de la carga, en hora de Lima.
    expect(screen.getByText(/Datos del padrón de SUNAT del 05\/11/)).toBeVisible();
    // Un RUC activo y habido no pide la marca.
    expect(screen.queryByRole('checkbox', { name: 'Emitir igual' })).toBeNull();
    expect(sePuedeCobrar()).toBe(true);
  });

  it('el cajero puede corregir lo autocompletado y no se vuelve a pisar', async () => {
    const s = montar({ [`GET /padron/ruc/${RUC}`]: () => json(200, padron()) });
    await escribirRuc(RUC);
    const razon = screen.getByLabelText('Razón social');
    await waitFor(() => expect(razon).toHaveValue('Supermercados Peruanos S.A.'));

    await userEvent.clear(razon);
    await userEvent.type(razon, 'Peruanos S.A. - Sede Norte');
    await userEvent.clear(screen.getByLabelText('Dirección fiscal'));
    await userEvent.type(screen.getByLabelText('Dirección fiscal'), 'Calle Nueva 45');
    // Corregir otro dígito del RUC y volver a dejarlo igual no borra lo corregido a mano si el RUC no cambió.
    expect(razon).toHaveValue('Peruanos S.A. - Sede Norte');
    expect(screen.getByLabelText('Dirección fiscal')).toHaveValue('Calle Nueva 45');
    expect(s.de('GET', `/padron/ruc/${RUC}`)).toHaveLength(1);
    expect(sePuedeCobrar()).toBe(true);
  });

  it('otro RUC vuelve a llenar los datos con los de ese RUC', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () => json(200, padron()),
      [`GET /padron/ruc/${OTRO_RUC}`]: () =>
        json(
          200,
          padron({ ruc: OTRO_RUC, razonSocial: 'Cementos del Sur S.A.', direccion: 'Jr. Cusco 8' }),
        ),
    });
    await escribirRuc(RUC);
    await waitFor(() =>
      expect(screen.getByLabelText('Razón social')).toHaveValue('Supermercados Peruanos S.A.'),
    );
    await userEvent.clear(screen.getByLabelText('RUC'));
    await escribirRuc(OTRO_RUC);
    await waitFor(() =>
      expect(screen.getByLabelText('Razón social')).toHaveValue('Cementos del Sur S.A.'),
    );
    expect(screen.getByLabelText('Dirección fiscal')).toHaveValue('Jr. Cusco 8');
  });

  it('si el padrón no trae la dirección, la deja en blanco y pide escribirla', async () => {
    montar({ [`GET /padron/ruc/${RUC}`]: () => json(200, padron({ direccion: null })) });
    await escribirRuc(RUC);
    await waitFor(() =>
      expect(screen.getByLabelText('Razón social')).toHaveValue('Supermercados Peruanos S.A.'),
    );
    expect(screen.getByLabelText('Dirección fiscal')).toHaveValue('');
    expect(
      screen.getByText('El padrón no trae la dirección de este RUC. Escríbela.'),
    ).toBeVisible();
    expect(sePuedeCobrar()).toBe(false);
  });

  it('un cliente que ya trae nombre (el del rechazado) se consulta pero no se pisa', async () => {
    const s = montar(
      { [`GET /padron/ruc/${RUC}`]: () => json(200, padron({ razonSocial: 'Otro nombre' })) },
      {
        inicial: {
          tipoDocumento: 'RUC',
          numero: RUC,
          nombre: 'Nombre del rechazado',
          direccion: 'Dirección del rechazado',
        },
      },
    );
    await waitFor(() => expect(s.de('GET', `/padron/ruc/${RUC}`)).toHaveLength(1));
    await screen.findByText(/Datos del padrón de SUNAT del 05\/11/);
    expect(screen.getByLabelText('Razón social')).toHaveValue('Nombre del rechazado');
    expect(screen.getByLabelText('Dirección fiscal')).toHaveValue('Dirección del rechazado');
  });
});

describe('RUC con aviso: «Emitir igual» (criterio 140)', () => {
  const baja = () =>
    padron({
      estado: 'BAJA DE OFICIO',
      condicion: 'NO HABIDO',
      activo: false,
      habido: false,
    });

  it('un RUC de baja y no habido muestra el aviso y no se puede cobrar sin la marca', async () => {
    montar({ [`GET /padron/ruc/${RUC}`]: () => json(200, baja()) });
    await escribirRuc(RUC);
    expect(
      await screen.findByText(
        'Este RUC figura como BAJA DE OFICIO / NO HABIDO en el padrón de SUNAT del 05/11',
      ),
    ).toBeVisible();
    // Igual se llenan los datos: el cajero decide.
    await waitFor(() =>
      expect(screen.getByLabelText('Razón social')).toHaveValue('Supermercados Peruanos S.A.'),
    );
    expect(sePuedeCobrar()).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }));
    expect(await screen.findByText('Marca «Emitir igual» o corrige el RUC.')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Emitir igual' })).toBeInvalid();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Emitir igual' }));
    expect(sePuedeCobrar()).toBe(true);
    expect(screen.queryByText('Marca «Emitir igual» o corrige el RUC.')).toBeNull();
  });

  it('un RUC activo pero no habido también lleva aviso', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () =>
        json(200, padron({ condicion: 'NO HABIDO', habido: false })),
    });
    await escribirRuc(RUC);
    expect(
      await screen.findByText(
        'Este RUC figura como ACTIVO / NO HABIDO en el padrón de SUNAT del 05/11',
      ),
    ).toBeVisible();
    expect(sePuedeCobrar()).toBe(false);
  });

  it('un RUC habido pero que no está activo también lleva aviso', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () =>
        json(200, padron({ estado: 'SUSPENSION TEMPORAL', activo: false })),
    });
    await escribirRuc(RUC);
    expect(
      await screen.findByText(
        'Este RUC figura como SUSPENSION TEMPORAL / HABIDO en el padrón de SUNAT del 05/11',
      ),
    ).toBeVisible();
    expect(sePuedeCobrar()).toBe(false);
  });

  it('la marca vale solo para ese RUC: cambiar el RUC la quita', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () => json(200, baja()),
      [`GET /padron/ruc/${OTRO_RUC}`]: () => json(200, baja()),
    });
    await escribirRuc(RUC);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Emitir igual' }));
    expect(sePuedeCobrar()).toBe(true);

    await userEvent.clear(screen.getByLabelText('RUC'));
    await escribirRuc(OTRO_RUC);
    expect(await screen.findByRole('checkbox', { name: 'Emitir igual' })).not.toBeChecked();
    expect(sePuedeCobrar()).toBe(false);
  });

  it('si el RUC ya no está completo, el aviso se va y la factura vuelve a pedir un RUC válido', async () => {
    montar({ [`GET /padron/ruc/${RUC}`]: () => json(200, baja()) });
    await escribirRuc(RUC);
    await screen.findByRole('checkbox', { name: 'Emitir igual' });
    await userEvent.type(screen.getByLabelText('RUC'), '{Backspace}');
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Emitir igual' })).toBeNull(),
    );
    expect(sePuedeCobrar()).toBe(false);
  });

  it('un RUC que no figura (404) lo dice, deja escribir los datos y se emite con la marca', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () =>
        json(404, {
          codigo: 'RUC_NO_ENCONTRADO',
          mensaje: 'Este RUC no figura en el padrón de SUNAT',
        }),
    });
    await escribirRuc(RUC);
    expect(await screen.findByText('Este RUC no figura en el padrón de SUNAT')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Razón social'), 'Comercial Andina E.I.R.L.');
    await userEvent.type(screen.getByLabelText('Dirección fiscal'), 'Av. Grau 100');
    expect(sePuedeCobrar()).toBe(false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Emitir igual' }));
    expect(sePuedeCobrar()).toBe(true);
    expect(screen.getByLabelText('Razón social')).toHaveValue('Comercial Andina E.I.R.L.');
  });
});

describe('Un RUC que no figura dice la fecha del padrón (criterio 139)', () => {
  it('con padronAl en el 404, el aviso dice «del 05/11»', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () =>
        json(404, {
          codigo: 'RUC_NO_ENCONTRADO',
          mensaje: 'Este RUC no figura en el padrón de SUNAT',
          padronAl: '2026-11-05T09:00:00.000Z',
        }),
    });
    await escribirRuc(RUC);
    expect(
      await screen.findByText('Este RUC no figura en el padrón de SUNAT del 05/11'),
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Emitir igual' })).toBeVisible();
  });

  it('sin padronAl, el aviso no inventa una fecha', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () =>
        json(404, { codigo: 'RUC_NO_ENCONTRADO', mensaje: 'Este RUC no figura en el padrón' }),
    });
    await escribirRuc(RUC);
    const aviso = await screen.findByText('Este RUC no figura en el padrón de SUNAT');
    expect(aviso).toBeVisible();
    expect(aviso.textContent).not.toMatch(/ del \d/);
  });
});

describe('Padrón no disponible (criterio 140)', () => {
  const noDisponible = () =>
    json(503, {
      codigo: 'PADRON_NO_DISPONIBLE',
      mensaje: 'El padrón de RUC todavía no está disponible',
    });

  it('dice «No se pudo consultar el padrón», no reintenta ni bloquea y deja escribir a mano', async () => {
    const s = montar({ [`GET /padron/ruc/${RUC}`]: noDisponible });
    await escribirRuc(RUC);
    expect(await screen.findByText('No se pudo consultar el padrón')).toBeVisible();
    expect(screen.getByText('Escribe el nombre y la dirección a mano.')).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Emitir igual' })).toBeNull();
    // El 503 con su código no se repite solo.
    expect(s.de('GET', `/padron/ruc/${RUC}`)).toHaveLength(1);

    await userEvent.type(screen.getByLabelText('Razón social'), 'Comercial Andina E.I.R.L.');
    await userEvent.type(screen.getByLabelText('Dirección fiscal'), 'Av. Grau 100');
    expect(sePuedeCobrar()).toBe(true);
  });

  it('«Consultar otra vez» vuelve a preguntar y, si ya hay padrón, llena los datos', async () => {
    let llamadas = 0;
    montar({
      [`GET /padron/ruc/${RUC}`]: () => (++llamadas === 1 ? noDisponible() : json(200, padron())),
    });
    await escribirRuc(RUC);
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar otra vez' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Razón social')).toHaveValue('Supermercados Peruanos S.A.'),
    );
    expect(screen.queryByText('No se pudo consultar el padrón')).toBeNull();
  });

  it('una falla de otro tipo (el servidor no responde) se trata igual: se escribe a mano', async () => {
    montar({
      [`GET /padron/ruc/${RUC}`]: () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    });
    await escribirRuc(RUC);
    expect(await screen.findByText('No se pudo consultar el padrón')).toBeVisible();
  });
});

describe('Cuándo se consulta (criterios 139 y 141)', () => {
  it('con un RUC inválido, completo o a medias, no consulta', async () => {
    const s = montar({ [`GET /padron/ruc/${RUC}`]: () => json(200, padron()) });
    await escribirRuc(RUC_INVALIDO);
    // Pasa la espera de la consulta.
    await new Promise((r) => setTimeout(r, 600));
    expect(s.llamadas).toHaveLength(0);
    expect(screen.queryByText('Consultando el padrón de SUNAT…')).toBeNull();
    expect(screen.getByLabelText('Razón social')).toHaveValue('');
  });

  it('con menos de 11 dígitos no consulta', async () => {
    const s = montar({});
    await escribirRuc('2010007097');
    await new Promise((r) => setTimeout(r, 600));
    expect(s.llamadas).toHaveLength(0);
  });

  it('en una boleta con DNI no consulta nada: el nombre se escribe', async () => {
    const s = montar({}, { tipo: 'BOLETA', total: '800.00' });
    await userEvent.type(screen.getByLabelText('Número de DNI'), '45678912');
    await userEvent.type(screen.getByLabelText('Nombre del cliente'), 'Rosa Quispe');
    await new Promise((r) => setTimeout(r, 600));
    expect(s.llamadas).toHaveLength(0);
    expect(sePuedeCobrar()).toBe(true);
  });

  it('una boleta con RUC no consulta: el padrón es del cliente de la factura', async () => {
    const s = montar({}, { tipo: 'BOLETA', total: '800.00' });
    await userEvent.click(screen.getByRole('button', { name: 'RUC' }));
    await userEvent.type(screen.getByLabelText('Número de RUC'), RUC);
    await new Promise((r) => setTimeout(r, 600));
    expect(s.llamadas).toHaveLength(0);
  });

  it('espera a que se termine de escribir y consulta una sola vez', async () => {
    const s = montar({ [`GET /padron/ruc/${RUC}`]: () => json(200, padron()) });
    await escribirRuc(RUC);
    expect(await screen.findByText(/Datos del padrón de SUNAT del 05\/11/)).toBeVisible();
    expect(s.llamadas).toHaveLength(1);
  });
});
