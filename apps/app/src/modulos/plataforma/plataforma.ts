import {
  altaEmpresaRespuestaSchema,
  empresaPlataformaDetalleSchema,
  empresaPlataformaResumenSchema,
  emisorRespuestaSchema,
  pagoRegistradoRespuestaSchema,
  planRespuestaSchema,
  sucursalPlataformaRespuestaSchema,
  suscripcionResumenSchema,
  suscripcionRespuestaSchema,
  type AltaEmpresaEntrada,
  type EmisorPlataformaEntrada,
  type EstadoSuscripcionRespuesta,
  type PagoEntrada,
  type PlanCrearEntrada,
  type PlanModificarEntrada,
  type SucursalPlataformaEntrada,
  type SuscripcionModificarEntrada,
} from '@restaurante/contratos';
import type { Modulo, RegimenTributario } from '@restaurante/dominio';
import type { TonoEtiqueta } from '@restaurante/ui';
import { api, listaDe } from '../../lib/api';

/** Todas las consultas del panel cuelgan de `['plataforma', …]`: salir del panel las borra juntas. */
export const CLAVES = {
  empresas: ['plataforma', 'empresas'] as const,
  empresa: (id: string) => ['plataforma', 'empresa', id] as const,
  planes: ['plataforma', 'planes'] as const,
  suscripciones: (estado?: EstadoSuscripcionRespuesta) =>
    ['plataforma', 'suscripciones', estado ?? 'todas'] as const,
};

const ambito = { ambito: 'plataforma' } as const;

// --- Llamadas a la API -----------------------------------------------------------------------------

export const listarEmpresas = (senal?: AbortSignal) =>
  api.get('/plataforma/empresas', {
    esquema: listaDe(empresaPlataformaResumenSchema),
    ...ambito,
    ...(senal ? { senal } : {}),
  });

export const obtenerEmpresa = (id: string, senal?: AbortSignal) =>
  api.get(`/plataforma/empresas/${id}`, {
    esquema: empresaPlataformaDetalleSchema,
    ...ambito,
    ...(senal ? { senal } : {}),
  });

export const registrarEmpresa = (entrada: AltaEmpresaEntrada) =>
  api.post('/plataforma/empresas', entrada, { esquema: altaEmpresaRespuestaSchema, ...ambito });

export const agregarEmisor = (
  empresaId: string,
  entrada: EmisorPlataformaEntrada,
  claveDeIdempotencia: string,
) =>
  api.post(`/plataforma/empresas/${empresaId}/emisores`, entrada, {
    esquema: emisorRespuestaSchema,
    idempotente: claveDeIdempotencia,
    ...ambito,
  });

export const agregarSucursal = (
  empresaId: string,
  entrada: SucursalPlataformaEntrada,
  claveDeIdempotencia: string,
) =>
  api.post(`/plataforma/empresas/${empresaId}/sucursales`, entrada, {
    esquema: sucursalPlataformaRespuestaSchema,
    idempotente: claveDeIdempotencia,
    ...ambito,
  });

export const listarPlanes = (senal?: AbortSignal) =>
  api.get('/plataforma/planes', {
    esquema: listaDe(planRespuestaSchema),
    ...ambito,
    ...(senal ? { senal } : {}),
  });

export const crearPlan = (entrada: PlanCrearEntrada) =>
  api.post('/plataforma/planes', entrada, { esquema: planRespuestaSchema, ...ambito });

export const modificarPlan = (id: string, cambios: PlanModificarEntrada) =>
  api.patch(`/plataforma/planes/${id}`, cambios, { esquema: planRespuestaSchema, ...ambito });

export const listarSuscripciones = (estado?: EstadoSuscripcionRespuesta, senal?: AbortSignal) =>
  api.get(`/plataforma/suscripciones${estado ? `?estado=${estado}` : ''}`, {
    esquema: listaDe(suscripcionResumenSchema),
    ...ambito,
    ...(senal ? { senal } : {}),
  });

export const registrarPago = (
  suscripcionId: string,
  entrada: PagoEntrada,
  claveDeIdempotencia: string,
) =>
  api.post(`/plataforma/suscripciones/${suscripcionId}/pagos`, entrada, {
    esquema: pagoRegistradoRespuestaSchema,
    idempotente: claveDeIdempotencia,
    ...ambito,
  });

export const modificarSuscripcion = (id: string, cambios: SuscripcionModificarEntrada) =>
  api.patch(`/plataforma/suscripciones/${id}`, cambios, {
    esquema: suscripcionRespuestaSchema,
    ...ambito,
  });

// --- Presentación ------------------------------------------------------------------------------------

export const TEXTO_DE_ESTADO: Record<
  EstadoSuscripcionRespuesta,
  { texto: string; tono: TonoEtiqueta }
> = {
  ACTIVA: { texto: 'Activa', tono: 'ok' },
  EN_GRACIA: { texto: 'En gracia', tono: 'alerta' },
  SUSPENDIDA: { texto: 'Suspendida', tono: 'mal' },
};

export const NOMBRE_DE_MODULO: Record<Modulo, string> = {
  SALON: 'Salón',
  COCINA: 'Cocina y barra',
  CAJA: 'Caja',
  FACTURACION: 'Facturación electrónica',
  PEDIDOS_WEB: 'Pedidos web',
  INVENTARIO: 'Inventario',
  REPORTES: 'Reportes',
};

export const NOMBRE_DE_REGIMEN: Record<RegimenTributario, string> = {
  NUEVO_RUS: 'Nuevo RUS',
  RER: 'Régimen Especial (RER)',
  MYPE_TRIBUTARIO: 'MYPE Tributario',
  GENERAL: 'Régimen General',
};

export const NOMBRE_DE_MEDIO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};

/** "S/ 120.00" a partir del texto decimal de la API; sin precio, "Sin definir". */
export function textoDePrecio(valor: string | null): string {
  if (valor === null) return 'Sin definir';
  const n = Number(valor);
  if (Number.isNaN(n)) return valor;
  return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** "120 de 500" con cuota; sin cuota, solo la cantidad emitida. */
export function textoDeConsumo(c: { emitidos: number; cuota: number | null }): string {
  return c.cuota === null ? `${c.emitidos}` : `${c.emitidos} de ${c.cuota}`;
}

/** "0 comprobantes este mes", "1 comprobante este mes", "120 de 500 comprobantes este mes". */
export function textoDeComprobantesDelMes(c: { emitidos: number; cuota: number | null }): string {
  const unidad = c.cuota === null && c.emitidos === 1 ? 'comprobante' : 'comprobantes';
  return `${textoDeConsumo(c)} ${unidad} este mes`;
}

/** "Plan Pro" para el plan "Pro"; "Plan base" se queda como está (ya empieza con "Plan"). */
export function textoDePlan(nombre: string): string {
  return /^plan\b/i.test(nombre.trim()) ? nombre.trim() : `Plan ${nombre.trim()}`;
}
