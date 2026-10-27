// Alta, baja y desbloqueo de superadministradores (personal de nuestra empresa). Son las únicas vías: no hay
// ruta HTTP para crearlos, desactivarlos ni desbloquearlos (criterio 61). Las usa `pnpm plataforma:superadmin` y las pruebas.
//
// Corren por la vía de plataforma (`OperacionPlataforma`, rol `restaurante_plataforma`) con el actor de
// sistema `cli:superadmin`, así que cada una deja su fila de auditoría sin empresa. Toman
// `DATABASE_PLATAFORMA_URL` del entorno, abren su propia conexión y la cierran al terminar.
import {
  minusculasAscii,
  nombreUsuarioSchema,
  contrasenaSchema,
  textoSchema,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { SQLSTATE, sqlstateDe } from '../../src/nucleo/base-de-datos/errores-pg';
import { crearConexionPlataforma } from '../../src/nucleo/base-de-datos/conexion-plataforma';
import { RelojSistema } from '../../src/nucleo/reloj';
import { OperacionPlataforma } from '../../src/modulos/plataforma/operacion-plataforma';
import { hashContrasenaScrypt } from '../../src/modulos/seguridad/credenciales';
import { cerrarSesionesDeSuperadministrador } from '../../src/modulos/seguridad/sesion-soporte';

/** Ya hay un superadministrador con ese nombre de usuario (sin distinguir mayúsculas). */
export class SuperadministradorExistenteError extends Error {
  constructor(usuario: string) {
    super(`Ya existe un superadministrador con el nombre de usuario "${usuario}"`);
    this.name = 'SuperadministradorExistenteError';
  }
}

/** Actor de sistema de las operaciones (criterio 61). */
export const ACTOR_SUPERADMIN = 'cli:superadmin';

export interface DatosNuevoSuperadministrador {
  /** Nombre de usuario (a-z, 0-9, `.`, `_`, `-`; único entre superadministradores, sin distinguir mayúsculas). */
  usuario: string;
  nombre: string;
  /** Contraseña en claro (8 a 128 caracteres); se guarda con scrypt. Nunca se registra ni se audita. */
  contrasena: string;
}

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

/** Abre la conexión de plataforma del entorno, corre `fn` y la cierra siempre. */
async function conOperacion<T>(fn: (operacion: OperacionPlataforma) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_PLATAFORMA_URL;
  if (!url) throw new Error('Falta DATABASE_PLATAFORMA_URL (la conexión de plataforma)');
  const conexion = crearConexionPlataforma(url);
  try {
    return await fn(new OperacionPlataforma(conexion, new RelojSistema()));
  } finally {
    await conexion.cerrar();
  }
}

function validar<T>(
  campo: string,
  resultado:
    { success: true; data: T } | { success: false; error: { issues: { message: string }[] } },
): T {
  if (resultado.success) return resultado.data;
  throw new Error(`${campo}: ${resultado.error.issues.map((i) => i.message).join('; ')}`);
}

/**
 * Crea un superadministrador con la vía de plataforma (actor `cli:superadmin`, auditoría
 * `crear_superadministrador`). Toma `DATABASE_PLATAFORMA_URL` del entorno. Devuelve su id. Un nombre de
 * usuario repetido (sin distinguir mayúsculas) falla.
 */
export async function crearSuperadministrador(
  datos: DatosNuevoSuperadministrador,
): Promise<{ id: string }> {
  const usuario = validar('usuario', nombreUsuarioSchema.safeParse(datos.usuario));
  const nombre = validar('nombre', textoSchema(100).safeParse(datos.nombre));
  const contrasena = validar('contrasena', contrasenaSchema.safeParse(datos.contrasena));
  const hash = await hashContrasenaScrypt(contrasena);
  return conOperacion(async (operacion) => {
    try {
      return await insertar(operacion, usuario, nombre, hash);
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
        throw new SuperadministradorExistenteError(usuario);
      }
      throw error;
    }
  });
}

function insertar(
  operacion: OperacionPlataforma,
  usuario: string,
  nombre: string,
  hash: string,
): Promise<{ id: string }> {
  return operacion.ejecutar(
    {
      actor: ACTOR_SUPERADMIN,
      motivo: 'Alta de superadministrador (pnpm plataforma:superadmin)',
      operacion: 'crear_superadministrador',
    },
    async (transaccion) => {
      const filas = await sequelizeDe(transaccion).query<{ id: string }>(
        `INSERT INTO superadministrador (usuario, nombre, hash_contrasena)
           VALUES ($1, $2, $3) RETURNING id`,
        { transaction: transaccion, bind: [usuario, nombre, hash], type: QueryTypes.SELECT },
      );
      const id = filas[0]!.id;
      operacion.registrarDatosDeAuditoria(transaccion, {
        entidad: 'superadministrador',
        entidadId: id,
        detalle: { superadministradorId: id, usuario, nombre },
      });
      return { id };
    },
  );
}

/**
 * Desactiva un superadministrador: cierra sus sesiones y sus sesiones de soporte abiertas en cualquier
 * empresa (auditoría `desactivar_superadministrador`). Falla si no existe.
 */
export async function desactivarSuperadministrador(datos: { usuario: string }): Promise<void> {
  const usuario = minusculasAscii(datos.usuario);
  await conOperacion((operacion) =>
    operacion.ejecutar(
      {
        actor: ACTOR_SUPERADMIN,
        motivo: 'Baja de superadministrador (pnpm plataforma:superadmin)',
        operacion: 'desactivar_superadministrador',
      },
      async (transaccion) => {
        const sequelize = sequelizeDe(transaccion);
        const ahora = new Date();
        const filas = await sequelize.query<{ id: string }>(
          `UPDATE superadministrador SET activo = false, actualizado_en = $2
            WHERE usuario = $1 RETURNING id`,
          { transaction: transaccion, bind: [usuario, ahora], type: QueryTypes.SELECT },
        );
        const id = filas[0]?.id;
        if (id === undefined) throw new Error(`No existe el superadministrador "${usuario}"`);
        await sequelize.query(
          `UPDATE sesion_superadministrador SET cerrada_en = $2
            WHERE superadministrador_id = $1 AND cerrada_en IS NULL`,
          { transaction: transaccion, bind: [id, ahora] },
        );
        const soporte = await cerrarSesionesDeSuperadministrador(transaccion, id, ahora);
        operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: id,
          detalle: { superadministradorId: id, usuario, sesionesDeSoporteCerradas: soporte },
        });
      },
    ),
  );
}

/**
 * Desbloquea a un superadministrador bloqueado por intentos fallidos (decisión operativa: el bloqueo de 15
 * minutos no tiene otra salida antes de vencer). Limpia `bloqueado_hasta` y `fallos_seguidos` y deja la fila
 * de auditoría `desbloquear_superadministrador` (actor `cli:superadmin`, sin empresa y sin datos sensibles).
 * Falla si no existe. Un superadministrador inactivo también se limpia, pero sigue sin poder entrar.
 */
export async function desbloquearSuperadministrador(datos: { usuario: string }): Promise<void> {
  const usuario = minusculasAscii(datos.usuario);
  await conOperacion((operacion) =>
    operacion.ejecutar(
      {
        actor: ACTOR_SUPERADMIN,
        motivo: 'Desbloqueo de superadministrador (pnpm plataforma:superadmin)',
        operacion: 'desbloquear_superadministrador',
      },
      async (transaccion) => {
        const filas = await sequelizeDe(transaccion).query<{ id: string }>(
          `UPDATE superadministrador
              SET fallos_seguidos = 0, bloqueado_hasta = NULL, actualizado_en = $2
            WHERE usuario = $1 RETURNING id`,
          { transaction: transaccion, bind: [usuario, new Date()], type: QueryTypes.SELECT },
        );
        const id = filas[0]?.id;
        if (id === undefined) throw new Error(`No existe el superadministrador "${usuario}"`);
        operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: id,
          detalle: { superadministradorId: id, usuario },
        });
      },
    ),
  );
}
