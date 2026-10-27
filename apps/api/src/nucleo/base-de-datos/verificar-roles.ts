import { QueryTypes, type Sequelize } from 'sequelize';
import { SQL_VERIFICACION_ROLES, type OpcionesSinEmpresa } from './consultas-sin-empresa';
import { RolPrivilegiadoError } from './errores';

interface FilaRol {
  rol: string;
  superusuario: boolean;
  bypassrls: boolean;
  tablas_propias: string[];
}

/**
 * Comprueba que el rol de la conexión no pueda saltarse la RLS: no debe ser superusuario, ni tener
 * `BYPASSRLS`, ni ser dueño de ninguna tabla de `public` (el dueño ve sus tablas aunque la RLS esté
 * activa, salvo que esté forzada). Lanza `RolPrivilegiadoError` indicando el rol y cada atributo.
 * `origen` es la variable de entorno de la conexión (por ejemplo `DATABASE_URL`), solo para el mensaje.
 */
export async function verificarRolDeConexion(sequelize: Sequelize, origen: string): Promise<void> {
  const opciones: OpcionesSinEmpresa = {
    type: QueryTypes.SELECT,
    sinEmpresa: 'verificacion-roles',
  };
  let filas: FilaRol[];
  try {
    filas = (await sequelize.query(SQL_VERIFICACION_ROLES, opciones)) as FilaRol[];
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo verificar el rol de la conexión ${origen}: ${motivo}`);
  }
  const fila = filas[0];
  if (!fila) throw new Error(`No se pudo determinar el rol de la conexión ${origen}`);

  const atributos: string[] = [];
  if (fila.superusuario) atributos.push('es superusuario (SUPERUSER)');
  if (fila.bypassrls) atributos.push('tiene el atributo BYPASSRLS');
  if (fila.tablas_propias.length > 0) {
    atributos.push(`es dueño de tablas de public (${fila.tablas_propias.join(', ')})`);
  }
  if (atributos.length > 0) {
    throw new RolPrivilegiadoError(
      `La API se niega a arrancar: el rol "${fila.rol}" de ${origen} ${atributos.join(' y ')}. ` +
        'La API y la plataforma deben conectarse con un rol sin esos atributos (ver db:preparar).',
      fila.rol,
      atributos,
    );
  }
}
