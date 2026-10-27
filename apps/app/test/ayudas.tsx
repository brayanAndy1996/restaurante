import type { SesionRespuesta } from '@restaurante/contratos';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ErrorApi } from '../src/lib/errores';
import { App } from '../src/App';
import { conexion } from '../src/lib/conexion';
import { SesionProvider } from '../src/modulos/acceso/sesion';

export const ID = {
  empresa: '11111111-1111-4111-8111-111111111111',
  usuario: '22222222-2222-4222-8222-222222222222',
  sucursalA: '33333333-3333-4333-8333-333333333333',
  sucursalB: '44444444-4444-4444-8444-444444444444',
  otro: '55555555-5555-4555-8555-555555555555',
  superadmin: '66666666-6666-4666-8666-666666666666',
} as const;

/** Sesión de empresa válida según `sesionRespuestaSchema`; cada prueba cambia lo que necesita. */
export function sesionDe(parcial: Partial<SesionRespuesta> = {}): SesionRespuesta {
  return {
    tipo: 'CONTRASENA',
    empresaId: ID.empresa,
    usuario: { id: ID.usuario, nombre: 'Marta Pérez', nombreUsuario: 'marta' },
    superadministrador: null,
    rol: null,
    esAdministrador: true,
    sucursal: { id: ID.sucursalA, nombre: 'Miraflores' },
    sucursales: [
      { id: ID.sucursalA, nombre: 'Miraflores', rol: 'ADMINISTRADOR' },
      { id: ID.sucursalB, nombre: 'Surco', rol: 'ADMINISTRADOR' },
    ],
    equipo: null,
    permisos: null,
    modulos: [],
    avisoSuscripcion: null,
    debeCambiarContrasena: false,
    expiraPorInactividadEn: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...parcial,
  };
}

export type Manejador = (pedido: {
  cuerpo: unknown;
  cabeceras: Headers;
  url: URL;
}) => Response | Promise<Response>;

export function json(
  estado: number,
  cuerpo?: unknown,
  cabeceras: Record<string, string> = {},
): Response {
  if (estado === 204 || cuerpo === undefined)
    return new Response(null, { status: estado, headers: cabeceras });
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json', ...cabeceras },
  });
}

export interface LlamadaRegistrada {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  cabeceras: Headers;
}

/**
 * Servidor de mentira: responde por "METODO /ruta". Una ruta sin manejador es un fallo de la prueba
 * (responde 501), no un silencio. Guarda cada llamada para poder comprobarla.
 */
export function servidor(manejadores: Record<string, Manejador>) {
  const llamadas: LlamadaRegistrada[] = [];
  const tabla = { ...manejadores };
  const simulado = vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const cabeceras = new Headers(init?.headers);
    const cuerpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    llamadas.push({ metodo, ruta: url.pathname, cuerpo, cabeceras });
    const manejador = tabla[`${metodo} ${url.pathname}`];
    if (!manejador) {
      return json(501, {
        codigo: 'ERROR_INTERNO',
        mensaje: `Sin manejador para ${metodo} ${url.pathname}`,
      });
    }
    return manejador({ cuerpo, cabeceras, url });
  });
  vi.stubGlobal('fetch', simulado);
  return {
    llamadas,
    simulado,
    poner(clave: string, manejador: Manejador) {
      tabla[clave] = manejador;
    },
    de(metodo: string, ruta: string) {
      return llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta);
    },
  };
}

export function renderApp(ruta: string | { pathname: string; state: unknown } = '/') {
  conexion.reiniciar();
  const clientes = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={clientes}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <App />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Espera que la promesa falle y devuelve el error de la API; si no falla, la prueba falla. */
export async function falla(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (error) {
    return error as ErrorApi;
  }
  throw new Error('Se esperaba que la llamada fallara');
}
