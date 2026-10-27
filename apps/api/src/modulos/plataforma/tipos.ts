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
  /**
   * Clave de idempotencia (criterio 85): si ya hay una respuesta guardada para esa clave y el mismo
   * cuerpo, `ejecutar` la devuelve sin repetir el efecto ni la auditoría; con otro cuerpo, otra ruta u
   * otro actor responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. La respuesta de una operación que sale
   * bien se guarda en la misma transacción.
   */
  idempotencia?: IdempotenciaPlataforma;
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
  /** Solo si el alta incluyó al primer Administrador: su id y su PIN (única vez que se muestra). */
  administrador?: { id: string; pin: string };
}

export interface EmpresaResumen {
  id: string;
  nombre: string;
}

/** El superadministrador autenticado en la petición (lo deja `SuperadministradorGuard`). */
export interface SuperadministradorAutenticado {
  id: string;
  nombre: string;
  /** Sesión `sa.…` con la que llama. */
  sesionId: string;
}

/** Clave de idempotencia de una operación de plataforma (`Idempotency-Key`, criterio 85). */
export interface IdempotenciaPlataforma {
  clave: string;
  /** Ruta de la operación (por ejemplo `POST /plataforma/empresas/:id/emisores`). */
  ruta: string;
  /** Quién la pide: el id del superadministrador. */
  actor: string;
  /** Cuerpo de la petición (su huella canónica decide si es "el mismo cuerpo"). */
  cuerpo: unknown;
}
