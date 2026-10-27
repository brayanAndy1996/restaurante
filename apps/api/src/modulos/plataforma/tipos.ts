import type { Transaction } from 'sequelize';

/** Quién hace una operación de plataforma y por qué; ambos son obligatorios y no pueden ir vacíos. */
export interface AuditoriaPlataformaEntrada {
  /** Texto libre (`semilla`, `cli:<nombre>`) hasta que la historia 002 cree al superadministrador. */
  actor: string;
  motivo: string;
}

export interface OpcionesOperacionPlataforma extends AuditoriaPlataformaEntrada {
  /** Nombre de la operación auditada: `registrar_empresa`, `agregar_emisor`, `agregar_sucursal`… */
  operacion: string;
  /** Empresa afectada, si ya existe. Si la operación la crea, `fn` devuelve su id. */
  empresaId?: string;
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
