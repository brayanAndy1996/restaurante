import { Inject, Injectable } from '@nestjs/common';
import {
  minusculasAscii,
  type CambiarContrasenaEntrada,
  type ElegirSucursalEntrada,
  type IngresoContrasenaEntrada,
  type IngresoRespuesta,
  type SesionRespuesta,
  type TipoSesion,
} from '@restaurante/contratos';
import { permisosDeRol, type Rol } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { buscarEmpresaDeUsuario } from '../../nucleo/base-de-datos/consultas-sin-empresa';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import type { Principal } from '../../nucleo/principal';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SuscripcionService } from '../plataforma/suscripcion.service';
import { BloqueosService, segundosHasta } from './bloqueos.service';
import { MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO } from './constantes-acceso';
import { Credenciales } from './credenciales';
import { HorarioService } from './horario.service';
import { SesionActual } from './sesion-actual';
import { armarTokenSesion } from './tokens';

/** Inactividad de una sesión de contraseña o de soporte, en minutos (criterios 14 y 66). */
export const MINUTOS_INACTIVIDAD_CONTRASENA = 30;
/** Duración máxima de una sesión de contraseña (criterio 14). */
export const HORAS_MAXIMAS_CONTRASENA = 12;

/** Fallos seguidos que bloquean la cuenta y por cuánto (criterio 12). */
export const FALLOS_PARA_BLOQUEAR_CONTRASENA = 5;
export const MINUTOS_BLOQUEO_CONTRASENA = 15;

const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;

interface SucursalElegible {
  id: string;
  nombre: string;
  rol: Rol;
}

interface FilaUsuario {
  id: string;
  nombre: string;
  nombre_usuario: string;
  hash_contrasena: string;
  contrasena_temporal: boolean;
  horario: unknown;
  es_administrador: boolean;
  activo: boolean;
}

type Resultado<T> = { ok: T } | { error: ErrorAplicacion };

const credencialesInvalidas = () =>
  new ErrorAplicacion(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos');

const bloqueoTemporal = (hasta: Date, ahora: Date) =>
  new ErrorAplicacion(
    429,
    'BLOQUEO_TEMPORAL',
    'Demasiados intentos fallidos; intenta de nuevo más tarde',
    undefined,
    segundosHasta(hasta, ahora),
  );

/**
 * Sesiones de empresa de contraseña y de soporte: ingreso con contraseña, sesión actual, sucursal
 * activa, cambio de la propia contraseña y salida (criterios 10 a 17). El ingreso y el cambio de
 * contraseña abren su propia transacción (`ContextoEmpresa.ejecutar`) y devuelven el error a lanzar:
 * se lanza después de confirmarla, así los fallos, el bloqueo y el rechazo por horario quedan guardados
 * aunque la respuesta sea un error. Toda regla de tiempo usa el reloj de la API.
 */
@Injectable()
export class SesionesService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(HorarioService) private readonly horario: HorarioService,
    @Inject(BloqueosService) private readonly bloqueos: BloqueosService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SesionActual) private readonly actual: SesionActual,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
  ) {}

  // ---- Ingreso con contraseña ------------------------------------------------------------------

  /**
   * `POST /sesiones/contrasena` (criterios 10 a 13 y 12b): busca la empresa del usuario por su nombre
   * (consulta fija, sin contexto), y con ella lee al usuario, revisa el bloqueo, verifica la contraseña,
   * fija el actor (el usuario si es correcta, `autenticacion` si no), revisa el horario y crea la sesión.
   */
  async ingresarConContrasena(entrada: IngresoContrasenaEntrada): Promise<IngresoRespuesta> {
    const nombre = minusculasAscii(entrada.usuario);
    const empresaId = await buscarEmpresaDeUsuario(this.conexion, nombre);
    if (empresaId === null) {
      // Usuario inexistente: el mismo tiempo y el mismo cuerpo que una contraseña incorrecta.
      await this.credenciales.verificarContrasenaFalsa(entrada.contrasena);
      throw credencialesInvalidas();
    }
    const resultado = await this.contexto.ejecutar(empresaId, () =>
      this.ingresoEnContexto(empresaId, nombre, entrada.contrasena),
    );
    if ('error' in resultado) throw resultado.error;
    return resultado.ok;
  }

  private async ingresoEnContexto(
    empresaId: string,
    nombreUsuario: string,
    contrasena: string,
  ): Promise<Resultado<IngresoRespuesta>> {
    // `FOR NO KEY UPDATE` serializa los intentos de la misma persona (ingresos y cambios de contraseña):
    // cada uno lee el bloqueo con los fallos de los anteriores ya confirmados, así que ninguna ráfaga
    // evalúa más de 5 contraseñas (criterio 12). No estorba a las llaves foráneas ni a otras personas.
    const usuarios = await this.conexion.query<FilaUsuario>(
      `SELECT id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo
         FROM usuario WHERE nombre_usuario = $1
          FOR NO KEY UPDATE`,
      { bind: [nombreUsuario], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora(); // después de esperar el turno
    const usuario = usuarios[0];
    if (usuario === undefined || !usuario.activo) {
      await this.credenciales.verificarContrasenaFalsa(contrasena);
      return { error: credencialesInvalidas() };
    }

    const bloqueo = await this.bloqueos.estado('CONTRASENA_USUARIO', usuario.id, ahora);
    if (bloqueo.bloqueadoHasta !== null) {
      return { error: bloqueoTemporal(bloqueo.bloqueadoHasta, ahora) };
    }

    const correcta = await this.credenciales.verificarContrasena(
      contrasena,
      usuario.hash_contrasena,
    );
    if (!correcta) {
      await this.contexto.fijarActor({ sistema: 'autenticacion' });
      await this.contarFallo(usuario);
      return { error: credencialesInvalidas() };
    }

    // Credenciales correctas: de aquí en adelante los cambios quedan a nombre de la persona.
    await this.contexto.fijarActor({ usuarioId: usuario.id });
    await this.bloqueos.reiniciar('CONTRASENA_USUARIO', usuario.id);

    // El horario se mira después de las credenciales y del bloqueo (criterio 107): nadie sin
    // credenciales correctas sabe si alguien tiene horario. No cuenta como fallo.
    if (
      !this.horario.estaDentro(
        { esAdministrador: usuario.es_administrador, horario: usuario.horario },
        ahora,
      )
    ) {
      await this.auditoria.registrar({
        accion: 'ingreso_fuera_de_horario',
        entidad: 'usuario',
        entidadId: usuario.id,
        detalle: { usuarioId: usuario.id, nombreUsuario: usuario.nombre_usuario },
      });
      return {
        error: new ErrorAplicacion(
          403,
          'FUERA_DE_HORARIO',
          'Estás fuera de tu horario de acceso; vuelve a intentar dentro de él',
        ),
      };
    }

    const elegibles = await this.sucursalesElegibles(usuario.id, usuario.es_administrador);
    const sucursalId = elegibles.length === 1 ? elegibles[0]!.id : null;
    const secreto = this.credenciales.generarSecreto();
    const expira = new Date(ahora.getTime() + HORAS_MAXIMAS_CONTRASENA * HORA_MS);
    const filas = await this.conexion.query<{ id: string }>(
      `INSERT INTO sesion (empresa_id, tipo, usuario_id, sucursal_id, huella_secreto,
                           ultima_actividad_en, expira_en, minutos_inactividad, creado_en, actualizado_en)
       VALUES ($1, 'CONTRASENA', $2, $3, $4, $5, $6, $7, $5, $5)
       RETURNING id`,
      {
        bind: [
          empresaId,
          usuario.id,
          sucursalId,
          this.credenciales.huellaSecreto(secreto),
          ahora,
          expira,
          MINUTOS_INACTIVIDAD_CONTRASENA,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const sesion = await this.armarRespuesta({
      tipo: 'CONTRASENA',
      empresaId,
      usuario: { id: usuario.id, nombre: usuario.nombre, nombreUsuario: usuario.nombre_usuario },
      superadministrador: null,
      esAdministrador: usuario.es_administrador,
      sucursalId,
      elegibles,
      debeCambiarContrasena: usuario.contrasena_temporal,
      expiraPorInactividadEn: new Date(
        ahora.getTime() + MINUTOS_INACTIVIDAD_CONTRASENA * MINUTO_MS,
      ),
    });
    return { ok: { token: armarTokenSesion(empresaId, filas[0]!.id, secreto), sesion } };
  }

  /** Cuenta un fallo de contraseña; al quinto bloquea 15 minutos y deja la fila de auditoría (una vez). */
  private async contarFallo(usuario: Pick<FilaUsuario, 'id' | 'nombre_usuario'>): Promise<void> {
    const ahora = this.reloj.ahora();
    const fallo = await this.bloqueos.registrarFallo('CONTRASENA_USUARIO', usuario.id, ahora, {
      umbral: FALLOS_PARA_BLOQUEAR_CONTRASENA,
      duracionMs: MINUTOS_BLOQUEO_CONTRASENA * MINUTO_MS,
    });
    if (fallo.bloqueoNuevo) {
      await this.auditoria.registrar({
        accion: 'bloqueo_contrasena',
        entidad: 'usuario',
        entidadId: usuario.id,
        detalle: {
          usuarioId: usuario.id,
          nombreUsuario: usuario.nombre_usuario,
          fallosSeguidos: fallo.fallosSeguidos,
          bloqueadoHasta: fallo.bloqueadoHasta?.toISOString() ?? null,
        },
      });
    }
  }

  // ---- Sesión actual ---------------------------------------------------------------------------

  /** `GET /sesion` (criterio 42): se calcula de lo guardado, no del principal que ya pudo cambiar. */
  async sesionActual(): Promise<SesionRespuesta> {
    const principal = this.actual.principal();
    if (principal.tipo === 'PRUEBA') {
      return this.armarRespuesta({
        tipo: 'PRUEBA',
        empresaId: principal.empresaId,
        usuario: null,
        superadministrador: null,
        esAdministrador: true,
        sucursalId: principal.sucursalId,
        elegibles: await this.sucursalesElegibles(null, true),
        debeCambiarContrasena: false,
        expiraPorInactividadEn: null,
      });
    }
    const sesiones = await this.conexion.query<{
      sucursal_id: string | null;
      ultima_actividad_en: Date;
      minutos_inactividad: number;
      equipo_id: string | null;
      equipo_recordado_id: string | null;
      equipo_nombre: string | null;
      minutos_sucursal: number | null;
    }>(
      `SELECT s.sucursal_id, s.ultima_actividad_en, s.minutos_inactividad, s.equipo_id,
              s.equipo_recordado_id, e.nombre AS equipo_nombre, sa.minutos_inactividad AS minutos_sucursal
         FROM sesion s
         LEFT JOIN equipo e ON e.id = s.equipo_id AND e.empresa_id = s.empresa_id
         LEFT JOIN sucursal_acceso sa ON sa.sucursal_id = s.sucursal_id AND sa.empresa_id = s.empresa_id
        WHERE s.id = $1`,
      { bind: [principal.sesionId], type: QueryTypes.SELECT },
    );
    const sesion = sesiones[0];
    if (sesion === undefined)
      throw new ErrorAplicacion(
        401,
        'NO_AUTENTICADO',
        'Se requiere autenticación para esta operación',
      );
    // La inactividad de una sesión PIN es la de su sucursal activa (criterio 39); las demás, la guardada.
    const minutos =
      principal.tipo === 'PIN'
        ? (sesion.minutos_sucursal ?? MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO)
        : sesion.minutos_inactividad;
    const expira = new Date(sesion.ultima_actividad_en.getTime() + minutos * MINUTO_MS);
    const equipo =
      sesion.equipo_id !== null && sesion.equipo_recordado_id !== null
        ? {
            id: sesion.equipo_id,
            nombre: sesion.equipo_nombre ?? '',
            equipoRecordadoId: sesion.equipo_recordado_id,
          }
        : null;

    if (principal.tipo === 'SOPORTE') {
      return this.armarRespuesta({
        tipo: 'SOPORTE',
        empresaId: principal.empresaId,
        usuario: null,
        superadministrador: await this.superadministradorDeSoporte(principal),
        esAdministrador: true,
        sucursalId: sesion.sucursal_id,
        elegibles: await this.sucursalesElegibles(null, true),
        debeCambiarContrasena: false,
        expiraPorInactividadEn: expira,
      });
    }

    const usuarios = await this.conexion.query<FilaUsuario>(
      `SELECT id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo
         FROM usuario WHERE id = $1`,
      { bind: [principal.usuarioId], type: QueryTypes.SELECT },
    );
    const usuario = usuarios[0];
    if (usuario === undefined)
      throw new ErrorAplicacion(
        401,
        'NO_AUTENTICADO',
        'Se requiere autenticación para esta operación',
      );
    return this.armarRespuesta({
      tipo: principal.tipo,
      empresaId: principal.empresaId,
      usuario: { id: usuario.id, nombre: usuario.nombre, nombreUsuario: usuario.nombre_usuario },
      superadministrador: null,
      esAdministrador: usuario.es_administrador,
      sucursalId: sesion.sucursal_id,
      elegibles: await this.sucursalesElegibles(usuario.id, usuario.es_administrador),
      debeCambiarContrasena: usuario.contrasena_temporal,
      expiraPorInactividadEn: expira,
      equipo,
    });
  }

  /**
   * Quién da el soporte: la API no puede leer la tabla de superadministradores (ningún privilegio), así
   * que su nombre sale de la fila `inicio_soporte` de la auditoría de esa sesión (inmutable y visible
   * para la empresa).
   */
  private async superadministradorDeSoporte(
    principal: Principal,
  ): Promise<{ id: string; nombre: string }> {
    const filas = await this.conexion.query<{ nombre: string | null }>(
      `SELECT detalle -> 'superadministrador' ->> 'nombre' AS nombre
         FROM auditoria WHERE sesion_id = $1 AND accion = 'inicio_soporte' LIMIT 1`,
      { bind: [principal.sesionId], type: QueryTypes.SELECT },
    );
    return { id: principal.superadministradorId!, nombre: filas[0]?.nombre ?? 'Soporte' };
  }

  // ---- Sucursal activa -------------------------------------------------------------------------

  /** `PUT /sesion/sucursal` (criterio 17): no comprueba el horario (criterio 108). */
  async elegirSucursal(entrada: ElegirSucursalEntrada): Promise<SesionRespuesta> {
    const principal = this.actual.principal();
    if (principal.tipo === 'PRUEBA' || principal.sesionId === null) {
      throw new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para realizar esta operación');
    }
    const elegibles = await this.sucursalesElegibles(
      principal.usuarioId,
      principal.esAdministrador,
    );
    // Sin acceso, de otra empresa o inexistente: la misma respuesta.
    if (!elegibles.some((s) => s.id === entrada.sucursalId.toLowerCase())) {
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
    }
    const ahora = this.reloj.ahora();
    const sucursalId = entrada.sucursalId.toLowerCase();
    await this.conexion.query(
      'UPDATE sesion SET sucursal_id = $2, actualizado_en = $3 WHERE id = $1',
      { bind: [principal.sesionId, sucursalId, ahora] },
    );
    if (principal.tipo === 'PIN' && principal.equipoRecordadoId !== null) {
      // Queda como la última sucursal de esa persona en ese equipo (criterios 17 y 33).
      await this.conexion.query(
        'UPDATE equipo_recordado SET ultima_sucursal_id = $2, actualizado_en = $3 WHERE id = $1',
        { bind: [principal.equipoRecordadoId, sucursalId, ahora] },
      );
    }
    return this.sesionActual();
  }

  // ---- Cambiar la propia contraseña ------------------------------------------------------------

  /**
   * `PUT /sesion/contrasena` (criterio 16): solo sesiones de contraseña. La contraseña actual incorrecta
   * cuenta para el bloqueo del criterio 12. Abre su propia transacción para guardar los fallos.
   */
  async cambiarContrasena(entrada: CambiarContrasenaEntrada): Promise<void> {
    const principal = this.actual.principal();
    if (principal.tipo !== 'CONTRASENA' || principal.usuarioId === null) {
      throw new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para realizar esta operación');
    }
    if (entrada.actual === entrada.nueva) {
      throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Los datos enviados no son válidos', [
        { campo: 'nueva', mensaje: 'La contraseña nueva debe ser distinta de la actual' },
      ]);
    }
    const resultado = await this.contexto.ejecutar(principal.empresaId, () =>
      this.cambioEnContexto(principal, entrada),
    );
    if ('error' in resultado) throw resultado.error;
  }

  private async cambioEnContexto(
    principal: Principal,
    entrada: CambiarContrasenaEntrada,
  ): Promise<Resultado<true>> {
    // `FOR NO KEY UPDATE` serializa los intentos de la misma persona (ingresos y cambios de contraseña):
    // cada uno lee el bloqueo con los fallos de los anteriores ya confirmados, así que ninguna ráfaga
    // evalúa más de 5 contraseñas (criterio 12). No estorba a las llaves foráneas ni a otras personas.
    const usuarios = await this.conexion.query<FilaUsuario>(
      `SELECT id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo
         FROM usuario WHERE id = $1
          FOR NO KEY UPDATE`,
      { bind: [principal.usuarioId], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora(); // después de esperar el turno
    const usuario = usuarios[0];
    if (usuario === undefined || !usuario.activo) {
      await this.credenciales.verificarContrasenaFalsa(entrada.actual);
      return { error: credencialesInvalidas() };
    }
    const bloqueo = await this.bloqueos.estado('CONTRASENA_USUARIO', usuario.id, ahora);
    if (bloqueo.bloqueadoHasta !== null) {
      return { error: bloqueoTemporal(bloqueo.bloqueadoHasta, ahora) };
    }
    const correcta = await this.credenciales.verificarContrasena(
      entrada.actual,
      usuario.hash_contrasena,
    );
    if (!correcta) {
      await this.contexto.fijarActor({ sistema: 'autenticacion' });
      await this.contarFallo(usuario);
      return { error: credencialesInvalidas() };
    }

    await this.contexto.fijarActor({
      usuarioId: usuario.id,
      equipoId: principal.equipoId,
    });
    const hash = await this.credenciales.hashContrasena(entrada.nueva);
    await this.conexion.query(
      `UPDATE usuario SET hash_contrasena = $2, contrasena_temporal = false, actualizado_en = $3
        WHERE id = $1`,
      { bind: [usuario.id, hash, ahora] },
    );
    // Se cierran las demás sesiones de la persona; esta sigue. Los equipos recordados se conservan.
    await this.conexion.query(
      `UPDATE sesion SET cerrada_en = $3, motivo_cierre = 'CONTRASENA_CAMBIADA', actualizado_en = $3
        WHERE usuario_id = $1 AND id <> $2 AND cerrada_en IS NULL`,
      { bind: [usuario.id, principal.sesionId, ahora] },
    );
    await this.bloqueos.reiniciar('CONTRASENA_USUARIO', usuario.id);
    await this.auditoria.registrar({
      accion: 'cambiar_contrasena',
      entidad: 'usuario',
      entidadId: usuario.id,
      detalle: { usuarioId: usuario.id, eraTemporal: usuario.contrasena_temporal },
    });
    return { ok: true };
  }

  // ---- Salida ----------------------------------------------------------------------------------

  /** `DELETE /sesion` (criterio 17): cierra la sesión actual; en soporte deja `fin_soporte`. */
  async salir(): Promise<void> {
    const principal = this.actual.principal();
    if (principal.sesionId === null) return; // el principal de prueba no tiene sesión guardada
    const ahora = this.reloj.ahora();
    const cerradas = await this.conexion.query<{ id: string }>(
      `UPDATE sesion SET cerrada_en = $2, motivo_cierre = 'SALIDA', actualizado_en = $2
        WHERE id = $1 AND cerrada_en IS NULL RETURNING id`,
      { bind: [principal.sesionId, ahora], type: QueryTypes.SELECT },
    );
    if (cerradas.length > 0 && principal.tipo === 'SOPORTE') {
      await this.auditoria.registrar({
        accion: 'fin_soporte',
        entidad: 'sesion',
        entidadId: principal.sesionId,
        motivo: 'Fin del soporte',
        detalle: {},
      });
    }
  }

  // ---- Apoyo -----------------------------------------------------------------------------------

  /**
   * Sucursales que la persona puede elegir, con su rol en cada una. El Administrador, el soporte y el
   * principal de prueba (`usuarioId` nulo o `esAdministrador`) ven todas las de la empresa como
   * `ADMINISTRADOR`. Corre bajo RLS: solo las de la empresa del contexto.
   */
  async sucursalesElegibles(
    usuarioId: string | null,
    esAdministrador: boolean,
  ): Promise<SucursalElegible[]> {
    if (esAdministrador || usuarioId === null) {
      const filas = await this.conexion.query<{ id: string; nombre: string }>(
        'SELECT id, nombre FROM sucursal ORDER BY nombre, id',
        { type: QueryTypes.SELECT },
      );
      return filas.map((f) => ({ id: f.id, nombre: f.nombre, rol: 'ADMINISTRADOR' as const }));
    }
    const filas = await this.conexion.query<{ id: string; nombre: string; rol: Rol }>(
      `SELECT s.id, s.nombre, a.rol
         FROM acceso_sucursal a
         JOIN sucursal s ON s.id = a.sucursal_id AND s.empresa_id = a.empresa_id
        WHERE a.usuario_id = $1
        ORDER BY s.nombre, s.id`,
      { bind: [usuarioId], type: QueryTypes.SELECT },
    );
    return filas;
  }

  /**
   * Arma `sesionRespuesta`. `modulos` son los del plan de la sucursal activa (criterio 77; vacío sin
   * sucursal activa). `equipo` es el equipo recordado de la sesión, si lo tiene. `permisos` es la matriz del
   * rol en la sucursal activa (criterio 43; `null` sin rol). `avisoSuscripcion` (criterio 80) solo lo ve el
   * Administrador y el soporte (`esAdministrador`), tenga o no sucursal activa; para los demás es `null`.
   */
  async armarRespuesta(datos: {
    tipo: TipoSesion;
    empresaId: string;
    usuario: { id: string; nombre: string; nombreUsuario: string } | null;
    superadministrador: { id: string; nombre: string } | null;
    esAdministrador: boolean;
    sucursalId: string | null;
    elegibles: SucursalElegible[];
    debeCambiarContrasena: boolean;
    expiraPorInactividadEn: Date | null;
    equipo?: { id: string; nombre: string; equipoRecordadoId: string } | null;
  }): Promise<SesionRespuesta> {
    const activa = datos.elegibles.find((s) => s.id === datos.sucursalId) ?? null;
    const rol: Rol | null = datos.esAdministrador ? 'ADMINISTRADOR' : (activa?.rol ?? null);
    return {
      tipo: datos.tipo,
      empresaId: datos.empresaId,
      usuario: datos.usuario,
      superadministrador: datos.superadministrador,
      rol,
      esAdministrador: datos.esAdministrador,
      sucursal: activa === null ? null : { id: activa.id, nombre: activa.nombre },
      sucursales: datos.elegibles.map((s) => ({ id: s.id, nombre: s.nombre, rol: s.rol })),
      equipo: datos.equipo ?? null,
      // Sin rol todavía (sin sucursal elegida y sin ser Administrador) no hay permisos que mostrar.
      permisos: rol === null ? null : permisosDeRol(rol),
      modulos: activa === null ? [] : await this.suscripciones.modulosDeSucursal(activa.id),
      avisoSuscripcion: datos.esAdministrador ? await this.suscripciones.avisoDeEmpresa() : null,
      debeCambiarContrasena: datos.debeCambiarContrasena,
      expiraPorInactividadEn: datos.expiraPorInactividadEn?.toISOString() ?? null,
    };
  }
}
