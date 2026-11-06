import { Pool } from 'pg';
import { QueryTypes, type Sequelize } from 'sequelize';
import { SQL_VERIFICACION_ROLES, type OpcionesSinEmpresa } from './consultas-sin-empresa';
import { RolPrivilegiadoError } from './errores';

interface FilaRol {
  rol: string;
  superusuario: boolean;
  bypassrls: boolean;
  tablas_propias: string[];
  membresias: MembresiaPrivilegiada[];
}

interface MembresiaPrivilegiada {
  rol: string;
  via: string;
  migrador: boolean;
  superusuario: boolean;
  bypassrls: boolean;
  tablas_propias: string[];
}

function describirMembresia(m: MembresiaPrivilegiada): string {
  const motivos: string[] = [];
  if (m.migrador) motivos.push('es el rol migrador, dueño de las tablas');
  if (m.superusuario) motivos.push('es superusuario (SUPERUSER)');
  if (m.bypassrls) motivos.push('tiene el atributo BYPASSRLS');
  if (m.tablas_propias.length > 0) {
    motivos.push(`es dueño de tablas de public (${m.tablas_propias.join(', ')})`);
  }
  const cadena = m.via.includes(' > ') ? ` por la cadena ${m.via}` : '';
  return `es miembro de "${m.rol}"${cadena}, que ${motivos.join(' y ')}`;
}

/** Quién se conecta, solo para el mensaje de rechazo. */
const CONEXIONES_DE_LA_API =
  'La API y la plataforma deben conectarse con un rol sin esos atributos (ver db:preparar).';
const CONEXION_DEL_TIEMPO_REAL =
  'El adaptador de tiempo real debe conectarse con restaurante_tiempo_real, un rol sin esos atributos (ver db:preparar).';

const CONEXION_DE_LA_COLA =
  'La cola de envíos al PSE debe conectarse con restaurante_colas, un rol sin esos atributos (ver db:preparar).';
const CONEXION_DEL_PADRON =
  'La carga del padrón de RUC debe conectarse con restaurante_referencia, un rol sin esos atributos (ver db:preparar).';

/** Lanza `RolPrivilegiadoError` si la fila del rol de la conexión tiene algún atributo que salta la RLS. */
function exigirRolSinPrivilegios(fila: FilaRol | undefined, origen: string, consejo: string): void {
  if (!fila) throw new Error(`No se pudo determinar el rol de la conexión ${origen}`);

  const atributos: string[] = [];
  if (fila.superusuario) atributos.push('es superusuario (SUPERUSER)');
  if (fila.bypassrls) atributos.push('tiene el atributo BYPASSRLS');
  if (fila.tablas_propias.length > 0) {
    atributos.push(`es dueño de tablas de public (${fila.tablas_propias.join(', ')})`);
  }
  for (const membresia of fila.membresias) atributos.push(describirMembresia(membresia));
  if (atributos.length > 0) {
    throw new RolPrivilegiadoError(
      `La API se niega a arrancar: el rol "${fila.rol}" de ${origen} ${atributos.join(' y ')}. ${consejo}`,
      fila.rol,
      atributos,
    );
  }
}

/**
 * Comprueba que el rol de la conexión no pueda saltarse la RLS: no debe ser superusuario, ni tener
 * `BYPASSRLS`, ni ser dueño de ninguna tabla de `public` (el dueño ve sus tablas aunque la RLS esté
 * activa, salvo que esté forzada), ni ser miembro, directo o transitivo, de un rol así (con una
 * membresía puede hacer `SET ROLE` y apagar la RLS; criterio 10b). Lanza `RolPrivilegiadoError` indicando el rol y cada atributo.
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
  exigirRolSinPrivilegios(filas[0], origen, CONEXIONES_DE_LA_API);
}

/**
 * La misma comprobación para el pool del adaptador de Socket.IO (historia 004, criterio 70), que no pasa por
 * Sequelize ni por la guarda de la API: su rol (`restaurante_tiempo_real`) no puede ser superusuario, tener
 * `BYPASSRLS`, ser dueño de tablas de `public` ni miembro de un rol así (como el migrador).
 */
export async function verificarRolDePool(
  pool: Pool,
  origen: string,
  consejo: string = CONEXION_DEL_TIEMPO_REAL,
): Promise<void> {
  let filas: FilaRol[];
  try {
    filas = (await pool.query<FilaRol>(SQL_VERIFICACION_ROLES)).rows;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo verificar el rol de la conexión ${origen}: ${motivo}`);
  }
  exigirRolSinPrivilegios(filas[0], origen, consejo);
}

/**
 * La misma comprobación para los roles de la facturación electrónica (historia 006, entrega 6b, criterio 163):
 * `restaurante_colas` (`DATABASE_COLAS_URL`) y `restaurante_referencia` (`DATABASE_REFERENCIA_URL`) no pueden ser
 * superusuario, tener `BYPASSRLS`, ser dueños de tablas de `public` ni miembros de un rol así (como el migrador).
 * Abre un pool de una conexión, verifica y lo cierra; lanza `RolPrivilegiadoError`.
 */
export async function verificarRolDeFacturacion(
  url: string,
  rol: 'colas' | 'referencia',
  origen: string,
): Promise<void> {
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: `restaurante-verificacion-${rol}`,
  });
  pool.on('error', () => undefined);
  try {
    await verificarRolDePool(
      pool,
      origen,
      rol === 'colas' ? CONEXION_DE_LA_COLA : CONEXION_DEL_PADRON,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}
