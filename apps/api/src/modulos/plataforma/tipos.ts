import type { Transaction } from 'sequelize';

/**
 * Quién hace una operación de plataforma: un texto (actor de sistema, de 1 a 100 caracteres: `semilla`,
 * `cli:<nombre>`) o un superadministrador (`{ superadministradorId }`, en las rutas HTTP de plataforma y
 * en el soporte). Es también el actor de trazabilidad de la transacción (criterio 117).
 */
export type ActorPlataforma = string | { superadministradorId: string };

/** Quién hace una operación de plataforma y por qué; ambos son obligatorios y no pueden ir vacíos. */
export interface AuditoriaPlataformaEntrada {
  actor: ActorPlataforma;
  motivo: string;
}

export interface OpcionesOperacionPlataforma extends AuditoriaPlataformaEntrada {
  /** Nombre de la operación auditada: `registrar_empresa`, `agregar_emisor`, `agregar_sucursal`… */
  operacion: string;
  /** Empresa afectada, si ya existe. Si la operación la crea, `fn` devuelve su id. */
  empresaId?: string;
  /** Sesión de superadministrador o de soporte desde la que se hace, si la hay (queda en la auditoría). */
  sesionId?: string;
}

/** Transacción explícita de la conexión de plataforma que recibe `fn`. */
export type TransaccionPlataforma = Transaction;

export interface ResultadoRegistroEmpresa {
  empresaId: string;
  emisores: { id: string; ruc: string }[];
  sucursales: { id: string; nombre: string }[];
}

export interface EmpresaResumen {
  id: string;
  nombre: string;
}
