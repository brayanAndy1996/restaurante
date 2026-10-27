// Ayudantes de las pruebas del desarrollador de la sección de acceso (no protegidas). Siembran por SQL lo
// que las rutas de ingreso y de usuarios (tareas T12 y T13) crearán más adelante: usuarios, accesos y
// sesiones, para probar el guard, el principal y la trazabilidad sin depender de ellas.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { PIN_PEPPER_LOCAL, type Entorno } from '../../src/config/entorno';
import { Credenciales } from '../../src/modulos/seguridad/credenciales';
import { armarTokenEquipo, armarTokenSesion } from '../../src/modulos/seguridad/tokens';
import { enTransaccion } from '../aislamiento/fabrica';

export const credenciales = new Credenciales({ PIN_PEPPER: PIN_PEPPER_LOCAL } as Entorno);

export type RolDeAcceso = 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR';

export interface OpcionesUsuario {
  /** Nombre de usuario; por defecto uno único. */
  nombreUsuario?: string;
  esAdministrador?: boolean;
  activo?: boolean;
  contrasenaTemporal?: boolean;
  horario?: unknown;
  accesos?: { sucursalId: string; rol: RolDeAcceso }[];
}

/** Inserta un usuario (y sus accesos) como `restaurante_api` con el actor de sistema `prueba`. */
export async function insertarUsuario(
  api: Client,
  empresaId: string,
  opciones: OpcionesUsuario = {},
): Promise<{ id: string; nombreUsuario: string }> {
  const nombreUsuario = opciones.nombreUsuario ?? `u-${randomUUID().slice(0, 12)}`;
  const id = await enTransaccion(
    api,
    empresaId,
    async () => {
      const { rows } = await api.query<{ id: string }>(
        `INSERT INTO usuario (empresa_id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal,
                              huella_pin, largo_pin, horario, es_administrador, activo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 'sin-contrasena', $4, $5, 6, $6::jsonb, $7, $8, now(), now()) RETURNING id`,
        [
          empresaId,
          `Persona ${nombreUsuario}`,
          nombreUsuario,
          opciones.contrasenaTemporal ?? false,
          randomBytes(32),
          opciones.horario === undefined || opciones.horario === null
            ? null
            : JSON.stringify(opciones.horario),
          opciones.esAdministrador ?? false,
          opciones.activo ?? true,
        ],
      );
      const usuarioId = rows[0]!.id;
      for (const acceso of opciones.accesos ?? []) {
        await api.query(
          `INSERT INTO acceso_sucursal (empresa_id, usuario_id, sucursal_id, rol, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, now(), now())`,
          [empresaId, usuarioId, acceso.sucursalId, acceso.rol],
        );
      }
      return usuarioId;
    },
    { confirmar: true },
  );
  return { id, nombreUsuario };
}

export interface OpcionesSesion {
  usuarioId?: string;
  superadministradorId?: string;
  tipo?: 'CONTRASENA' | 'PIN' | 'SOPORTE';
  sucursalId?: string | null;
  /** Instante de la última actividad y de creación; por defecto el reloj de la prueba. */
  ahora: Date;
  minutosInactividad?: number;
  horasDeDuracion?: number;
  equipoId?: string | null;
  equipoRecordadoId?: string | null;
}

/** Inserta una sesión por SQL con su huella y devuelve el token en claro (`se.<empresa>.<sesión>.<secreto>`). */
export async function insertarSesion(
  api: Client,
  empresaId: string,
  opciones: OpcionesSesion,
): Promise<{ id: string; token: string; secreto: string }> {
  const secreto = credenciales.generarSecreto();
  const tipo = opciones.tipo ?? (opciones.superadministradorId ? 'SOPORTE' : 'CONTRASENA');
  const vence = new Date(opciones.ahora.getTime() + (opciones.horasDeDuracion ?? 12) * 3_600_000);
  const id = await enTransaccion(
    api,
    empresaId,
    async () => {
      const { rows } = await api.query<{ id: string }>(
        `INSERT INTO sesion (empresa_id, tipo, usuario_id, superadministrador_id, equipo_id,
                             equipo_recordado_id, sucursal_id, huella_secreto, ultima_actividad_en,
                             expira_en, minutos_inactividad, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $9, $9) RETURNING id`,
        [
          empresaId,
          tipo,
          opciones.usuarioId ?? null,
          opciones.superadministradorId ?? null,
          opciones.equipoId ?? null,
          opciones.equipoRecordadoId ?? null,
          opciones.sucursalId ?? null,
          credenciales.huellaSecreto(secreto),
          opciones.ahora,
          vence,
          opciones.minutosInactividad ?? 30,
        ],
      );
      return rows[0]!.id;
    },
    { confirmar: true },
  );
  return { id, token: armarTokenSesion(empresaId, id, secreto), secreto };
}

export interface EquipoSembrado {
  equipoId: string;
  equipoRecordadoId: string;
  /** Token del equipo (`eq.<empresa>.<equipo>.<secreto>`), para la cabecera `X-Equipo`. */
  tokenEquipo: string;
}

/**
 * Inserta un equipo de la empresa que recuerda a `usuarioId` (las llaves de `sesion` y de la trazabilidad
 * exigen que el equipo exista). Con el actor de sistema `prueba`.
 */
export async function insertarEquipo(
  api: Client,
  empresaId: string,
  usuarioId: string,
): Promise<EquipoSembrado> {
  const secreto = credenciales.generarSecreto();
  const equipoId = randomUUID();
  const equipoRecordadoId = await enTransaccion(
    api,
    empresaId,
    async () => {
      await api.query(
        `INSERT INTO equipo (id, empresa_id, nombre, huella_secreto, ultimo_uso_en, creado_en, actualizado_en)
         VALUES ($1, $2, 'Equipo de prueba', $3, now(), now(), now())`,
        [equipoId, empresaId, credenciales.huellaSecreto(secreto)],
      );
      const { rows } = await api.query<{ id: string }>(
        `INSERT INTO equipo_recordado (empresa_id, equipo_id, usuario_id, recordado_en, ultimo_uso_en,
                                       creado_en, actualizado_en)
         VALUES ($1, $2, $3, now(), now(), now(), now()) RETURNING id`,
        [empresaId, equipoId, usuarioId],
      );
      return rows[0]!.id;
    },
    { confirmar: true },
  );
  return {
    equipoId,
    equipoRecordadoId,
    tokenEquipo: armarTokenEquipo(empresaId, equipoId, secreto),
  };
}

/** Inserta un superadministrador como `restaurante_plataforma` (la tabla no es de empresa ni lleva actor). */
export async function insertarSuperadministrador(plataforma: Client): Promise<string> {
  const usuario = `sa-${randomUUID().slice(0, 12)}`;
  const { rows } = await plataforma.query<{ id: string }>(
    `INSERT INTO superadministrador (usuario, nombre, hash_contrasena)
     VALUES ($1, 'Superadmin de prueba', 'sin-contrasena') RETURNING id`,
    [usuario],
  );
  return rows[0]!.id;
}
