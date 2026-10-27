import { Inject, Injectable } from '@nestjs/common';
import {
  NOMBRE_EQUIPO_POR_DEFECTO,
  type EquipoActualRespuesta,
  type EquipoRecordadoRespuesta,
  type RecordarEquipoEntrada,
  type RecordarEquipoRespuesta,
} from '@restaurante/contratos';
import { MAXIMO_PERSONAS_POR_EQUIPO } from '@restaurante/dominio';
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import type { Principal } from '../../nucleo/principal';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import type { MotivoRevocacion } from './constantes-acceso';
import { Credenciales } from './credenciales';
import { SesionActual } from './sesion-actual';
import { armarTokenEquipo, parsearTokenEquipo, type TokenEquipo } from './tokens';

/** 401 `EQUIPO_NO_RECONOCIDO`, siempre con el mismo cuerpo (falta, mal formado, adulterado, de otra empresa). */
export const equipoNoReconocido = () =>
  new ErrorAplicacion(
    401,
    'EQUIPO_NO_RECONOCIDO',
    'Este equipo no se reconoce; ingresa con tu usuario y contraseña',
  );

const prohibido = () =>
  new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para realizar esta operación');

const usuarioNoExiste = () => new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El usuario no existe');

const equipoRecordadoNoExiste = () =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El equipo recordado no existe');

/** Un equipo que dejó de recordar a una persona. */
export interface EquipoRevocado {
  equipoRecordadoId: string;
  equipoId: string;
  usuarioId: string;
}

/** Texto de la cabecera `X-Equipo` convertido a sus partes (`null` si falta o está mal formada). */
export function tokenEquipoDeCabecera(cabecera: unknown): TokenEquipo | null {
  return typeof cabecera === 'string' ? parsearTokenEquipo(cabecera) : null;
}

interface FilaRecordadoDeLista {
  id: string;
  equipo_id: string;
  equipo_nombre: string;
  recordado_en: Date;
  ultimo_uso_en: Date;
}

/**
 * Equipos recordados (criterios 27 a 32b, RF-10): recordar el equipo, consultarlo, revocarlo (Administrador),
 * olvidarlo (la propia persona) y las revocaciones automáticas. Un equipo es el navegador de una empresa; la
 * API lo identifica por un token `eq.<empresa>.<equipo>.<secreto>` del que solo guarda la huella del secreto.
 * Nunca busca un token fuera de la empresa de la petición.
 *
 * Revocar marca `revocado_en` con su motivo y cierra, en la misma transacción, todas las sesiones (de PIN o
 * de contraseña) asociadas a ese equipo recordado.
 */
@Injectable()
export class EquiposService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SesionActual) private readonly actual: SesionActual,
  ) {}

  // ---- Reconocer un equipo ---------------------------------------------------------------------

  /**
   * El equipo del token dentro del contexto de empresa activo (la RLS ya limita la búsqueda a esa empresa),
   * o `null` si no existe o el secreto no coincide (se compara la huella en tiempo constante).
   */
  async equipoDelToken(
    token: TokenEquipo | null,
  ): Promise<{ id: string; nombre: string; huellaSecreto: Buffer } | null> {
    if (token === null) return null;
    const filas = await this.conexion.query<{ id: string; nombre: string; huella_secreto: Buffer }>(
      'SELECT id, nombre, huella_secreto FROM equipo WHERE id = $1',
      { bind: [token.equipoId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (
      fila === undefined ||
      !this.credenciales.secretoCoincide(token.secreto, fila.huella_secreto)
    )
      return null;
    return { id: fila.id, nombre: fila.nombre, huellaSecreto: fila.huella_secreto };
  }

  // ---- GET /equipo -----------------------------------------------------------------------------

  /**
   * `GET /equipo` (criterio 28, pública): las personas activas que el equipo recuerda, de la usada más
   * recientemente a la más antigua, con el largo de su PIN y hasta cuándo está bloqueada cada una.
   */
  async consultar(cabecera: unknown): Promise<EquipoActualRespuesta> {
    const token = tokenEquipoDeCabecera(cabecera);
    if (token === null) throw equipoNoReconocido();
    const resultado = await this.contexto.ejecutar(token.empresaId, async () => {
      const equipo = await this.equipoDelToken(token);
      if (equipo === null) return null;
      const ahora = this.reloj.ahora();
      const personas = await this.conexion.query<{
        id: string;
        nombre: string;
        largo_pin: 4 | 6;
        bloqueado_hasta: Date | null;
      }>(
        `SELECT u.id, u.nombre, u.largo_pin, b.bloqueado_hasta
           FROM equipo_recordado er
           JOIN usuario u ON u.id = er.usuario_id AND u.empresa_id = er.empresa_id
           LEFT JOIN bloqueo_intentos b
             ON b.empresa_id = er.empresa_id AND b.ambito = 'PIN_EQUIPO_RECORDADO' AND b.objetivo_id = er.id
          WHERE er.equipo_id = $1 AND er.revocado_en IS NULL AND u.activo
          ORDER BY er.ultimo_uso_en DESC, er.recordado_en DESC, er.orden DESC`,
        { bind: [equipo.id], type: QueryTypes.SELECT },
      );
      return {
        equipo: { id: equipo.id, nombre: equipo.nombre },
        personas: personas.map((p) => ({
          usuarioId: p.id,
          nombre: p.nombre,
          largoPin: p.largo_pin,
          bloqueadoHastaEn:
            p.bloqueado_hasta !== null && p.bloqueado_hasta.getTime() > ahora.getTime()
              ? p.bloqueado_hasta.toISOString()
              : null,
        })),
      };
    });
    if (resultado === null) throw equipoNoReconocido();
    return resultado;
  }

  // ---- POST /sesion/equipo ---------------------------------------------------------------------

  /**
   * `POST /sesion/equipo` (criterio 27, 29): solo sesiones de contraseña (la contraseña temporal ya la
   * rechazó el guard). Abre su propia transacción porque el actor de lo que escribe lleva el equipo, que
   * puede ser nuevo: se conoce después de leer la cabecera. Con el `X-Equipo` válido de la empresa usa ese
   * equipo; si no, crea uno nuevo y devuelve su token (única vez). Con `SELECT … FOR UPDATE` sobre la fila
   * del equipo serializa los recordatorios concurrentes: nunca hay más de
   * `MAXIMO_PERSONAS_POR_EQUIPO` personas activas.
   */
  async recordar(
    entrada: RecordarEquipoEntrada,
    cabecera: unknown,
  ): Promise<{ respuesta: RecordarEquipoRespuesta; nuevo: boolean }> {
    const principal = this.actual.principal();
    if (principal.tipo !== 'CONTRASENA' || principal.usuarioId === null) throw prohibido();
    const token = tokenEquipoDeCabecera(cabecera);
    return this.contexto.ejecutar(principal.empresaId, () =>
      this.recordarEnContexto(principal, entrada, token),
    );
  }

  private async recordarEnContexto(
    principal: Principal,
    entrada: RecordarEquipoEntrada,
    token: TokenEquipo | null,
  ): Promise<{ respuesta: RecordarEquipoRespuesta; nuevo: boolean }> {
    const ahora = this.reloj.ahora();
    const usuarioId = principal.usuarioId!;

    // La sesión se bloquea: dos recordatorios de la misma sesión no se pisan.
    const sesiones = await this.conexion.query<{ equipo_id: string | null }>(
      'SELECT equipo_id FROM sesion WHERE id = $1 AND cerrada_en IS NULL FOR UPDATE',
      { bind: [principal.sesionId], type: QueryTypes.SELECT },
    );
    if (sesiones[0] === undefined) {
      throw new ErrorAplicacion(
        401,
        'NO_AUTENTICADO',
        'Se requiere autenticación para esta operación',
      );
    }
    const equipoDeLaSesion = sesiones[0].equipo_id;

    // Un token de otra empresa no se busca: la RLS ya lo dejaría fuera, pero ni se intenta.
    const existente =
      token !== null && token.empresaId === principal.empresaId
        ? await this.equipoDelToken(token)
        : null;

    if (equipoDeLaSesion !== null) {
      // Repetirlo con el mismo equipo no hace nada; con otro, conflicto.
      if (existente !== null && existente.id === equipoDeLaSesion) {
        return {
          respuesta: { equipo: { id: existente.id, nombre: existente.nombre } },
          nuevo: false,
        };
      }
      throw new ErrorAplicacion(409, 'CONFLICTO', 'Esta sesión ya recuerda otro equipo');
    }

    // El actor de lo que sigue es la persona y este equipo (nuevo o conocido); se fija una sola vez.
    let equipo: { id: string; nombre: string };
    let tokenEquipo: string | undefined;
    if (existente !== null) {
      equipo = { id: existente.id, nombre: existente.nombre };
      await this.contexto.fijarActor({ usuarioId, equipoId: equipo.id });
      await this.conexion.query(
        'SELECT id FROM equipo WHERE id = $1 FOR UPDATE', // serializa los recordatorios del equipo
        { bind: [equipo.id], type: QueryTypes.SELECT },
      );
      await this.conexion.query(
        'UPDATE equipo SET ultimo_uso_en = $2, actualizado_en = $2 WHERE id = $1',
        {
          bind: [equipo.id, ahora],
        },
      );
    } else {
      const secreto = this.credenciales.generarSecreto();
      equipo = { id: randomUUID(), nombre: entrada.nombre ?? NOMBRE_EQUIPO_POR_DEFECTO };
      tokenEquipo = armarTokenEquipo(principal.empresaId, equipo.id, secreto);
      await this.contexto.fijarActor({ usuarioId, equipoId: equipo.id });
      await this.conexion.query(
        `INSERT INTO equipo (id, empresa_id, nombre, huella_secreto, ultimo_uso_en, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $5, $5)`,
        {
          bind: [
            equipo.id,
            principal.empresaId,
            equipo.nombre,
            this.credenciales.huellaSecreto(secreto),
            ahora,
          ],
        },
      );
    }

    const recordadoId = await this.recordarPersona(
      principal.empresaId,
      equipo.id,
      usuarioId,
      ahora,
    );
    await this.conexion.query(
      `UPDATE sesion SET equipo_id = $2, equipo_recordado_id = $3, actualizado_en = $4 WHERE id = $1`,
      { bind: [principal.sesionId, equipo.id, recordadoId.id, ahora] },
    );
    if (recordadoId.nuevo) {
      await this.auditoria.registrar({
        accion: 'recordar_equipo',
        entidad: 'equipo',
        entidadId: equipo.id,
        detalle: {
          usuarioId,
          equipoId: equipo.id,
          equipoNombre: equipo.nombre,
          equipoRecordadoId: recordadoId.id,
          equipoNuevo: tokenEquipo !== undefined,
        },
      });
    }
    return {
      respuesta: tokenEquipo === undefined ? { equipo } : { equipo, tokenEquipo },
      nuevo: tokenEquipo !== undefined,
    };
  }

  /**
   * Deja activo el equipo recordado (equipo, persona): si ya lo estaba solo actualiza su último uso; si no,
   * y el equipo ya recuerda a 5 personas, reemplaza a la de último uso más antiguo (a igualdad, a la
   * recordada primero) con motivo `REEMPLAZADO`. El equipo ya está bloqueado por quien llama.
   */
  private async recordarPersona(
    empresaId: string,
    equipoId: string,
    usuarioId: string,
    ahora: Date,
  ): Promise<{ id: string; nuevo: boolean }> {
    const activos = await this.conexion.query<{ id: string; usuario_id: string }>(
      `SELECT id, usuario_id FROM equipo_recordado
        WHERE equipo_id = $1 AND revocado_en IS NULL
        ORDER BY ultimo_uso_en, recordado_en, orden`,
      { bind: [equipoId], type: QueryTypes.SELECT },
    );
    const propio = activos.find((a) => a.usuario_id === usuarioId);
    if (propio !== undefined) {
      await this.conexion.query(
        'UPDATE equipo_recordado SET ultimo_uso_en = $2, actualizado_en = $2 WHERE id = $1',
        { bind: [propio.id, ahora] },
      );
      return { id: propio.id, nuevo: false };
    }

    for (const reemplazada of activos.slice(
      0,
      Math.max(0, activos.length - (MAXIMO_PERSONAS_POR_EQUIPO - 1)),
    )) {
      const revocados = await this.revocarPorId(reemplazada.id, 'REEMPLAZADO', ahora);
      if (revocados.length > 0) {
        await this.auditoria.registrar({
          accion: 'equipo_reemplazado',
          entidad: 'equipo',
          entidadId: equipoId,
          detalle: {
            equipoId,
            usuarioReemplazadoId: reemplazada.usuario_id,
            usuarioNuevoId: usuarioId,
            equipoRecordadoId: reemplazada.id,
          },
        });
      }
    }

    const filas = await this.conexion.query<{ id: string }>(
      `INSERT INTO equipo_recordado (empresa_id, equipo_id, usuario_id, recordado_en, ultimo_uso_en,
                                     creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $4, $4, $4)
       RETURNING id`,
      { bind: [empresaId, equipoId, usuarioId, ahora], type: QueryTypes.SELECT },
    );
    return { id: filas[0]!.id, nuevo: true };
  }

  // ---- Listar -----------------------------------------------------------------------------------

  private async listarDe(
    usuarioId: string,
    actualId?: string,
  ): Promise<EquipoRecordadoRespuesta[]> {
    const filas = await this.conexion.query<FilaRecordadoDeLista>(
      `SELECT er.id, er.equipo_id, e.nombre AS equipo_nombre, er.recordado_en, er.ultimo_uso_en
         FROM equipo_recordado er
         JOIN equipo e ON e.id = er.equipo_id AND e.empresa_id = er.empresa_id
        WHERE er.usuario_id = $1 AND er.revocado_en IS NULL
        ORDER BY er.recordado_en, er.id`,
      { bind: [usuarioId], type: QueryTypes.SELECT },
    );
    return filas.map((f) => ({
      id: f.id,
      equipo: { id: f.equipo_id, nombre: f.equipo_nombre },
      recordadoEn: f.recordado_en.toISOString(),
      ultimoUsoEn: f.ultimo_uso_en.toISOString(),
      ...(actualId === undefined ? {} : { actual: f.id === actualId }),
    }));
  }

  /** `GET /usuarios/:id/equipos` (criterio 30, Administrador): 404 si el usuario no es de la empresa. */
  async listarDeUsuario(usuarioId: string): Promise<EquipoRecordadoRespuesta[]> {
    await this.exigirUsuario(usuarioId);
    return this.listarDe(usuarioId);
  }

  /** `GET /sesion/equipos` (criterio 31): los equipos recordados activos de la propia persona. */
  async listarPropios(): Promise<EquipoRecordadoRespuesta[]> {
    const principal = this.personaDeLaSesion();
    return this.listarDe(principal.usuarioId!, principal.equipoRecordadoId ?? '');
  }

  // ---- Revocar y olvidar ------------------------------------------------------------------------

  /**
   * `DELETE /usuarios/:id/equipos/:equipoRecordadoId` (criterio 30, Administrador): 404 si el usuario no es
   * de la empresa o el equipo recordado es de otra persona; repetirlo responde sin otro efecto ni auditoría.
   */
  async revocarUno(usuarioId: string, equipoRecordadoId: string): Promise<void> {
    await this.exigirUsuario(usuarioId);
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM equipo_recordado WHERE id = $1 AND usuario_id = $2',
      { bind: [equipoRecordadoId, usuarioId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw equipoRecordadoNoExiste();
    const revocados = await this.revocarPorId(equipoRecordadoId, 'REVOCADO', this.reloj.ahora());
    await this.auditarRevocacion('revocar_equipos', usuarioId, 'REVOCADO', revocados);
  }

  /** `DELETE /usuarios/:id/equipos` (criterio 30, Administrador): revoca todos los equipos de la persona. */
  async revocarTodos(usuarioId: string): Promise<void> {
    await this.exigirUsuario(usuarioId);
    const revocados = await this.revocarDeUsuario(usuarioId, 'REVOCADO', this.reloj.ahora());
    await this.auditarRevocacion('revocar_equipos', usuarioId, 'REVOCADO', revocados);
  }

  /**
   * `DELETE /sesion/equipos/:equipoRecordadoId` (criterio 31): la persona deja de recordar un equipo suyo.
   * Si es el de la sesión actual, la sesión también se cierra. 404 si es de otra persona o de otra empresa.
   */
  async olvidar(equipoRecordadoId: string): Promise<void> {
    const principal = this.personaDeLaSesion();
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM equipo_recordado WHERE id = $1 AND usuario_id = $2',
      { bind: [equipoRecordadoId, principal.usuarioId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw equipoRecordadoNoExiste();
    const revocados = await this.revocarPorId(equipoRecordadoId, 'OLVIDADO', this.reloj.ahora());
    await this.auditarRevocacion('olvidar_equipo', principal.usuarioId!, 'OLVIDADO', revocados);
  }

  /**
   * Revoca un equipo recordado (si sigue activo) y cierra las sesiones asociadas. Devuelve lo que revocó
   * (nada si ya estaba revocado). Corre en la transacción en curso.
   */
  revocarPorId(
    equipoRecordadoId: string,
    motivo: MotivoRevocacion,
    ahora: Date,
  ): Promise<EquipoRevocado[]> {
    return this.revocar('id', equipoRecordadoId, motivo, ahora);
  }

  /** Revoca todos los equipos recordados activos de la persona y cierra sus sesiones asociadas. */
  revocarDeUsuario(
    usuarioId: string,
    motivo: MotivoRevocacion,
    ahora: Date,
  ): Promise<EquipoRevocado[]> {
    return this.revocar('usuario_id', usuarioId, motivo, ahora);
  }

  private async revocar(
    columna: 'id' | 'usuario_id',
    valor: string,
    motivo: MotivoRevocacion,
    ahora: Date,
  ): Promise<EquipoRevocado[]> {
    const filas = await this.conexion.query<{ id: string; equipo_id: string; usuario_id: string }>(
      `UPDATE equipo_recordado
          SET revocado_en = $1, motivo_revocacion = $2, actualizado_en = $1
        WHERE revocado_en IS NULL AND ${columna} = $3
        RETURNING id, equipo_id, usuario_id`,
      { bind: [ahora, motivo, valor], type: QueryTypes.SELECT },
    );
    if (filas.length > 0) {
      await this.conexion.query(
        `UPDATE sesion SET cerrada_en = $1, motivo_cierre = $2, actualizado_en = $1
          WHERE equipo_recordado_id = ANY($3::uuid[]) AND cerrada_en IS NULL`,
        { bind: [ahora, `EQUIPO_${motivo}`, filas.map((f) => f.id)] },
      );
    }
    return filas.map((f) => ({
      equipoRecordadoId: f.id,
      equipoId: f.equipo_id,
      usuarioId: f.usuario_id,
    }));
  }

  /** Una fila de auditoría con los equipos que dejaron de recordar a la persona (sin tokens); nada si no hubo ninguno. */
  private async auditarRevocacion(
    accion: 'revocar_equipos' | 'olvidar_equipo',
    usuarioId: string,
    motivo: MotivoRevocacion,
    revocados: EquipoRevocado[],
  ): Promise<void> {
    if (revocados.length === 0) return;
    await this.auditoria.registrar({
      accion,
      entidad: 'usuario',
      entidadId: usuarioId,
      detalle: { usuarioId, motivo, equipos: revocados },
    });
  }

  // ---- Apoyo ------------------------------------------------------------------------------------

  /** La persona de la sesión (contraseña o PIN); soporte y principal de prueba reciben 403. */
  private personaDeLaSesion(): Principal {
    const principal = this.actual.principal();
    if (
      (principal.tipo !== 'CONTRASENA' && principal.tipo !== 'PIN') ||
      principal.usuarioId === null
    ) {
      throw prohibido();
    }
    return principal;
  }

  /** 404 idéntico si el usuario no existe en la empresa del contexto (también si es de otra empresa). */
  private async exigirUsuario(usuarioId: string): Promise<void> {
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM usuario WHERE id = $1',
      {
        bind: [usuarioId],
        type: QueryTypes.SELECT,
      },
    );
    if (filas[0] === undefined) throw usuarioNoExiste();
  }

  /** Cantidad de equipos recordados activos de cada persona (criterio 24). */
  async contarActivosPorUsuario(ids: string[]): Promise<Map<string, number>> {
    const conteo = new Map<string, number>(ids.map((id) => [id, 0]));
    if (ids.length === 0) return conteo;
    const filas = await this.conexion.query<{ usuario_id: string; n: string }>(
      `SELECT usuario_id, count(*)::text AS n FROM equipo_recordado
        WHERE usuario_id = ANY($1::uuid[]) AND revocado_en IS NULL GROUP BY usuario_id`,
      { bind: [ids], type: QueryTypes.SELECT },
    );
    for (const f of filas) conteo.set(f.usuario_id, Number(f.n));
    return conteo;
  }
}
