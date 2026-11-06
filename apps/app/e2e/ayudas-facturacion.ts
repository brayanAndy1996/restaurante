import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { fechaDeLima, llamarApi } from './ayudas';
import { tokenPorApi } from './ayudas-caja';
import { destino, type EscenarioDeSalon } from './ayudas-salon';

/**
 * Preparación y atajos del E2E de la facturación electrónica (historia 006, entrega 6b, tarea T45, criterio 179). La
 * API corre con el worker de verdad (pg-boss con `DATABASE_COLAS_URL`) y un `SimuladorPse` cuyas reglas se mueven por el
 * puerto de control de `soporte/api-con-simulador.cjs`; el padrón de RUC se carga con el archivo de ejemplo
 * (`PADRON_RUC_URL=file://…/padron-ejemplo.zip`). Aquí van los atajos para dejar listo el emisor (tasa, cajas con sus series,
 * modo simulado) y los de las pantallas del panel de comprobantes.
 */

const SUPERADMIN_USUARIO = process.env.E2E_SUPERADMIN_USUARIO ?? 'superadmin';
const SUPERADMIN_CONTRASENA = process.env.E2E_SUPERADMIN_CONTRASENA ?? 'Superadmin-Demo-1';

/** Dónde escucha el control del simulador (`soporte/api-con-simulador.cjs`). */
export const CONTROL_PSE = process.env.E2E_PSE_CONTROL_URL ?? 'http://127.0.0.1:3100';

/**
 * Los RUC del padrón de ejemplo (`apps/api/test/soporte/padron-ejemplo.zip`) que usa la prueba: todos tienen el dígito
 * verificador bueno. `activo` figura ACTIVO y HABIDO; `bajaDeOficio`, BAJA DE OFICIO y NO HABIDO; `sinPadron` es un RUC
 * válido que el archivo no trae.
 */
export const RUC = {
  activo: {
    numero: '20100070970',
    razonSocial: "SUPERMERCADOS PERUANOS SOCIEDAD ANONIMA 'A'",
    direccion: 'AV. PRIMAVERA NRO. 1234 - SANTIAGO DE SURCO - LIMA - LIMA',
  },
  sunat: {
    numero: '20131312955',
    razonSocial: 'SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA - SUNAT',
    direccion: 'AV. GARCILASO DE LA VEGA NRO. 1472 - LIMA - LIMA - LIMA',
  },
  panaderia: {
    numero: '20601234565',
    razonSocial: 'PANADERÍA EL PIÑÓN S.A.C.',
    direccion: 'CAL. LAS ÑANDÚES NRO. 25',
  },
  bajaDeOficio: {
    numero: '20512345671',
    razonSocial: 'COMERCIAL FANTASMA E.I.R.L.',
  },
} as const;

async function tokenDeSuperadmin(request: APIRequestContext): Promise<string> {
  const ingreso = await llamarApi<{ token: string }>(request, '/plataforma/sesiones', {
    metodo: 'POST',
    cuerpo: { usuario: SUPERADMIN_USUARIO, contrasena: SUPERADMIN_CONTRASENA },
  });
  expect(ingreso.estado, 'ingreso del superadministrador').toBe(201);
  return ingreso.cuerpo.token;
}

// --- El simulador del PSE ---------------------------------------------------------------------------

async function llamarControl(
  request: APIRequestContext,
  ruta: string,
  metodo: 'GET' | 'POST',
  cuerpo?: unknown,
) {
  const respuesta = await request.fetch(`${CONTROL_PSE}${ruta}`, {
    method: metodo,
    ...(cuerpo === undefined ? {} : { data: cuerpo }),
  });
  expect(respuesta.status(), `control del simulador ${metodo} ${ruta}`).toBe(200);
  return respuesta.json() as Promise<unknown>;
}

/** Espera que el control del simulador responda (la API lo levanta justo después de empezar a escuchar). */
export async function esperarControlDelSimulador(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await request.get(`${CONTROL_PSE}/health`)).status();
        } catch {
          return 0;
        }
      },
      { message: `el control del simulador en ${CONTROL_PSE}`, timeout: 30_000 },
    )
    .toBe(200);
}

/** El simulador rechaza (origen SUNAT) los documentos cuyo cliente tenga este RUC. */
export async function rechazarRucEnElSimulador(
  request: APIRequestContext,
  ruc: string,
  rechazo: { codigo: string; mensaje: string },
): Promise<void> {
  await llamarControl(request, '/rechazar-ruc', 'POST', { ruc, ...rechazo });
}

/** Quita todas las reglas del simulador. */
export async function limpiarElSimulador(request: APIRequestContext): Promise<void> {
  await llamarControl(request, '/limpiar', 'POST');
}

// --- Padrón y emisor --------------------------------------------------------------------------------

/** Pide la carga del padrón de ejemplo (la hace el worker) y espera a que quede cargado. */
export async function cargarElPadron(request: APIRequestContext): Promise<void> {
  const token = await tokenDeSuperadmin(request);
  const pedida = await llamarApi(request, '/plataforma/padron/carga', {
    metodo: 'POST',
    token,
    idempotente: true,
  });
  expect(pedida.estado, 'carga del padrón pedida').toBe(202);
  await expect
    .poll(
      async () => {
        const estado = await llamarApi<{ cargadoEn: string | null; ultimoError: string | null }>(
          request,
          '/plataforma/padron',
          { token },
        );
        if (estado.cuerpo.ultimoError)
          throw new Error(`carga del padrón: ${estado.cuerpo.ultimoError}`);
        return estado.cuerpo.cargadoEn !== null;
      },
      { message: 'el worker carga el padrón de ejemplo', timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  await llamarApi(request, '/plataforma/sesion', { metodo: 'DELETE', token });
}

/**
 * Deja lista la facturación de la empresa de la prueba: la tasa de IGV del emisor, Caja 1 y Caja 2 con sus series de
 * boletas, de facturas y de notas de crédito, y el emisor en modo `SIMULADO` (lo único que puede hacer el
 * superadministrador, no el cliente). Es el alta del local; lo que se prueba es lo que viene después.
 */
export async function prepararLaFacturacion(
  request: APIRequestContext,
  e: EscenarioDeSalon,
): Promise<{ emisorId: string }> {
  const token = await tokenPorApi(request, e.administrador);
  const emisores = await llamarApi<{ id: string }[]>(request, '/emisores', { token });
  expect(emisores.estado).toBe(200);
  const emisorId = emisores.cuerpo[0]!.id;

  const tasa = await llamarApi(request, `/emisores/${emisorId}/tasas-igv/${fechaDeLima(-30)}`, {
    metodo: 'PUT',
    token,
    idempotente: true,
    cuerpo: { tasa: '18' },
  });
  expect(tasa.estado, 'tasa de IGV').toBe(200);

  const series = [
    { nombre: 'Caja 1', BOLETA: 'B001', FACTURA: 'F001', NC_B: 'BC01', NC_F: 'FC01' },
    { nombre: 'Caja 2', BOLETA: 'B002', FACTURA: 'F002', NC_B: 'BC02', NC_F: 'FC02' },
  ];
  for (const s of series) {
    const caja = await llamarApi<{ id: string }>(request, `/sucursales/${e.s1.id}/cajas`, {
      metodo: 'POST',
      token,
      idempotente: true,
      cuerpo: { nombre: s.nombre },
    });
    expect(caja.estado, `alta de ${s.nombre}`).toBe(201);
    for (const [tipo, serie] of [
      ['BOLETA', s.BOLETA],
      ['FACTURA', s.FACTURA],
      ['NOTA_CREDITO_BOLETA', s.NC_B],
      ['NOTA_CREDITO_FACTURA', s.NC_F],
    ] as const) {
      const r = await llamarApi(
        request,
        `/sucursales/${e.s1.id}/cajas/${caja.cuerpo.id}/series/${tipo}`,
        { metodo: 'PUT', token, idempotente: true, cuerpo: { serie } },
      );
      expect(r.estado, `serie ${serie} de ${s.nombre}`).toBe(200);
    }
  }
  await llamarApi(request, '/sesion', { metodo: 'DELETE', token });

  const superadmin = await tokenDeSuperadmin(request);
  const modo = await llamarApi(
    request,
    `/plataforma/empresas/${e.empresaId}/emisores/${emisorId}/pse`,
    { metodo: 'PUT', token: superadmin, idempotente: true, cuerpo: { modo: 'SIMULADO' } },
  );
  expect(modo.estado, 'modo simulado del emisor').toBe(200);
  await llamarApi(request, '/plataforma/sesion', { metodo: 'DELETE', token: superadmin });
  return { emisorId };
}

// --- Atajos de la pantalla ----------------------------------------------------------------------------

/** El estado del comprobante ante SUNAT en el resultado del cobro o en el detalle. */
export const estadoAnteSunat = (page: Page): Locator =>
  page.getByRole('region', { name: 'Estado ante SUNAT' });

/** Llena el RUC de una factura y espera que el padrón responda (los datos del cliente quedan escritos). */
export async function escribirRucDeFactura(
  page: Page,
  ruc: string,
  respuestaEsperada: 200 | 404,
): Promise<void> {
  const consulta = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/padron/ruc/${ruc}`,
  );
  await page.getByLabel('RUC', { exact: true }).fill(ruc);
  expect((await consulta).status(), `consulta del RUC ${ruc} en el padrón`).toBe(respuestaEsperada);
}

/** Ajustes › Comprobantes (el panel del Administrador). */
export async function irAlPanelDeAjustes(page: Page): Promise<void> {
  await destino(page, 'Ajustes').click();
  const boton = page
    .getByRole('group', { name: 'Secciones de Ajustes' })
    .getByRole('button', { name: 'Comprobantes', exact: true });
  await boton.click();
  await expect(boton).toHaveAttribute('aria-pressed', 'true');
}
