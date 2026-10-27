import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos/errores-pg';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { Credenciales } from './credenciales';

/**
 * Funciones del módulo de seguridad que usa la plataforma con la transacción de `OperacionPlataforma`
 * (son funciones y no proveedores para evitar dependencias circulares entre módulos de Nest). La
 * transacción ya fijó su actor (el superadministrador o el sistema), así que el trigger de trazabilidad
 * deja a esa persona como creadora de la fila.
 */

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

export interface DatosAdministradorInicial {
  empresaId: string;
  nombre: string;
  /** Ya en minúsculas (`nombreUsuarioSchema`). */
  nombreUsuario: string;
  contrasenaTemporal: string;
  ahora: Date;
}

/**
 * Crea al primer Administrador de una empresa nueva (criterio 63): contraseña temporal, PIN de 6
 * dígitos (único en la empresa, con su huella; solo se devuelve aquí) y sin accesos ni horario. Un nombre
 * de usuario ya usado, en esta empresa o en otra, responde 409 `CONFLICTO` sin decir de cuál.
 */
export async function insertarAdministradorInicial(
  transaccion: Transaction,
  credenciales: Credenciales,
  datos: DatosAdministradorInicial,
): Promise<{ id: string; pin: string }> {
  const sequelize = sequelizeDe(transaccion);
  const { pin, huella } = await credenciales.generarPinUnico(datos.empresaId, 6, async (h) => {
    const filas = await sequelize.query<{ existe: number }>(
      'SELECT 1 AS existe FROM usuario WHERE empresa_id = $1 AND huella_pin = $2',
      { transaction: transaccion, bind: [datos.empresaId, h], type: QueryTypes.SELECT },
    );
    return filas.length > 0;
  });
  const hash = await credenciales.hashContrasena(datos.contrasenaTemporal);
  try {
    const filas = await sequelize.query<{ id: string }>(
      `INSERT INTO usuario (empresa_id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal,
                            huella_pin, largo_pin, horario, es_administrador, activo, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, true, $5, 6, NULL, true, true, $6, $6)
       RETURNING id`,
      {
        transaction: transaccion,
        bind: [datos.empresaId, datos.nombre, datos.nombreUsuario, hash, huella, datos.ahora],
        type: QueryTypes.SELECT,
      },
    );
    return { id: filas[0]!.id, pin };
  } catch (error) {
    if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
      const motivo =
        restriccionDe(error) === 'usuario_pin_unico'
          ? 'No se pudo asignar un PIN; vuelve a intentarlo'
          : 'El nombre de usuario no está disponible';
      throw new ErrorAplicacion(409, 'CONFLICTO', motivo);
    }
    throw error;
  }
}

export interface AdministradorDeEmpresa {
  id: string;
  nombre: string;
  nombreUsuario: string;
  activo: boolean;
}

/** Administradores de una empresa (nombre, nombre de usuario y si están activos), para la consulta de plataforma. */
export async function administradoresDeEmpresa(
  transaccion: Transaction,
  empresaId: string,
): Promise<AdministradorDeEmpresa[]> {
  const filas = await sequelizeDe(transaccion).query<{
    id: string;
    nombre: string;
    nombre_usuario: string;
    activo: boolean;
  }>(
    `SELECT id, nombre, nombre_usuario, activo FROM usuario
      WHERE empresa_id = $1 AND es_administrador ORDER BY nombre, id`,
    { transaction: transaccion, bind: [empresaId], type: QueryTypes.SELECT },
  );
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    nombreUsuario: f.nombre_usuario,
    activo: f.activo,
  }));
}
