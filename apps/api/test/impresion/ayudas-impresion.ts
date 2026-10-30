// Ayudantes de las pruebas de impresoras, destinos e impresora de caja (historia 004, entrega 3b, grupo C7; no
// protegidas): rutas de 3b con la sesión del Administrador y lectura (solo lectura) de las tablas nuevas y de la
// auditoría con un cliente administrador.
import { randomUUID } from 'node:crypto';
import type { ImpresoraRespuesta } from '@restaurante/contratos';
import type { Client } from 'pg';
import { filasDeAuditoria } from '../acceso/fabrica-plataforma';
import { exigirEstado, llamar, type AppP2 } from '../salon-critica/fabrica-p2';

export const unico = (prefijo: string): string => `${prefijo} ${randomUUID().slice(0, 8)}`;

/** Cuerpo válido de `POST /sucursales/:id/impresoras` (impresora de red de 80 mm). */
export const cuerpoRed = (extra: Record<string, unknown> = {}) => ({
  nombre: unico('Impresora'),
  conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 9100 },
  anchoMm: 80,
  juegoCaracteres: 'PC850',
  gaveta: false,
  ...extra,
});

/** Cuerpo válido de una impresora Bluetooth. */
export const cuerpoBluetooth = (extra: Record<string, unknown> = {}) => ({
  nombre: unico('Bluetooth'),
  conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF' },
  anchoMm: 58,
  juegoCaracteres: 'PC850',
  gaveta: false,
  ...extra,
});

/** Crea una impresora y exige 201. */
export async function impresoraCreada(
  ctx: AppP2,
  token: string,
  sucursalId: string,
  cuerpo: Record<string, unknown> = cuerpoRed(),
): Promise<ImpresoraRespuesta> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/impresoras`,
    cuerpo,
  });
  exigirEstado(res, 201, 'crear una impresora');
  return res.body as ImpresoraRespuesta;
}

export const rutaImpresoras = (sucursalId: string) => `/sucursales/${sucursalId}/impresoras`;
export const rutaDestino = (sucursalId: string, estacionId: string) =>
  `/sucursales/${sucursalId}/estaciones-destino/${estacionId}`;
export const rutaImpresion = (sucursalId: string) => `/sucursales/${sucursalId}/impresion`;

/** Filas de auditoría de una acción en una empresa, en orden. */
export async function auditoriaDe(admin: Client, empresaId: string, accion: string) {
  return filasDeAuditoria(admin, 'empresa_id = $1 AND accion = $2', [empresaId, accion]);
}

/** Cuántas filas de auditoría tiene la empresa en total. */
export async function totalAuditoria(admin: Client, empresaId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM auditoria WHERE empresa_id = $1',
    [empresaId],
  );
  return Number(rows[0]!.n);
}
