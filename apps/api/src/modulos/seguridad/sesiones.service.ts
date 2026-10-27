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
import { TopeDeIntentos } from './tope-de-intentos';
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

/** Resultado del tiempo 1 (reserva): rechazar ya, tratar como nombre sin cuenta, o evaluar a esta persona. */
type Reserva =
  | { tipo: 'rechazo'; error: ErrorAplicacion; bloqueoVigente?: Date }
  | { tipo: 'sin_cuenta' }
  | { tipo: 'reservado'; usuario: FilaUsuario; turno: number };

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
    @Inject(TopeDeIntentos) private readonly tope: TopeDeIntentos,
  ) {}

  // ---- Ingreso con contraseña ------------------------------------------------------------------

  /**
   * `POST /sesiones/contrasena` (criterios 10 a 13 y 12b). El ingreso va en tres tiempos y ninguna
   * conexión del pool ni bloqueo de fila queda retenido mientras corre scrypt (RNF-03):
   *
   * 1. Transacción corta que bloquea la fila del usuario, revisa el bloqueo y **reserva el intento**
   *    (`BloqueosService.reservarIntento`: lo cuenta como fallo de antemano). Con el bloqueo vigente, o con
   *    el cupo de evaluaciones en curso lleno, responde 429 sin evaluar: ninguna ráfaga evalúa más de 5
   *    contraseñas (criterio 12).
   * 2. La contraseña se evalúa fuera de toda transacción.
   * 3. Otra transacción corta aplica el resultado: si falló, pone el bloqueo cuando la cuenta llegó a 5
   *    (con su fila de auditoría); si es correcta, vuelve a bloquear la fila, comprueba que la persona sigue
   *    activa y con la misma contraseña, reinicia la cuenta (sin borrar un bloqueo vigente), revisa el
   *    horario y crea la sesión.
   *
   * Un nombre sin cuenta activa (inexistente o inactivo) no tiene fila que contar: lo frena
   * `TopeDeIntentos` pone un tope a las que están en curso y, por lo demás, responde igual que una contraseña incorrecta (criterio 11).
   */
  async ingresarConContrasena(entrada: IngresoContrasenaEntrada): Promise<IngresoRespuesta> {
    const nombre = minusculasAscii(entrada.usuario);
    // Una ráfaga contra un mismo nombre no pasa del tope: lo demás se rechaza sin tocar la base (RNF-03).
    const clave = `contrasena:${nombre}`;
    const { soltar, enRafaga } = this.tope.entrar(clave);
    try {
      return await this.ingresarConTope(nombre, entrada.contrasena, clave, enRafaga);
    } finally {
      soltar();
    }
  }

  private async ingresarConTope(
    nombre: string,
    contrasena: string,
    clave: string,
    enRafaga: boolean,
  ): Promise<IngresoRespuesta> {
    // En plena ráfaga contra un nombre que acaba de verse sin cuenta, no se vuelve a preguntar a la base.
    if (this.tope.esSinCuentaReciente(clave)) return this.rechazarSinCuenta(nombre, contrasena);
    const bloqueoReciente = this.tope.bloqueoReciente(clave, this.reloj.ahora());
    if (bloqueoReciente !== null) throw bloqueoTemporal(bloqueoReciente, this.reloj.ahora());
    const empresaId = await buscarEmpresaDeUsuario(this.conexion, nombre);
    if (empresaId === null) {
      if (enRafaga) this.tope.recordarSinCuenta(clave);
      return this.rechazarSinCuenta(nombre, contrasena);
    }

    // La reserva solo escribe `bloqueo_intentos` (sin trazabilidad): no necesita actor.
    const reserva = await this.contexto.ejecutar(empresaId, () => this.reservarIngreso(nombre));
    if (reserva.tipo === 'rechazo') {
      if (enRafaga && reserva.bloqueoVigente !== undefined) {
        this.tope.recordarBloqueo(clave, reserva.bloqueoVigente);
      }
      throw reserva.error;
    }
    if (reserva.tipo === 'sin_cuenta') {
      if (enRafaga) this.tope.recordarSinCuenta(clave);
      return this.rechazarSinCuenta(nombre, contrasena);
    }

    const { usuario, turno } = reserva;
    const correcta = await this.evaluarContrasena(contrasena, usuario.hash_contrasena);
    if (!correcta) {
      await this.ponerBloqueoSiCorresponde(empresaId, usuario);
      throw credencialesInvalidas();
    }
    // Credenciales correctas: de aquí en adelante los cambios quedan a nombre de la persona.
    const resultado = await this.contexto.ejecutar(
      empresaId,
      () => this.completarIngreso(empresaId, usuario, turno),
      { actor: { usuarioId: usuario.id } },
    );
    if (resultado.bloquear) await this.ponerBloqueoSiCorresponde(empresaId, usuario);
    if ('error' in resultado.resultado) throw resultado.resultado.error;
    return resultado.resultado.ok;
  }

  /**
   * Nombre sin cuenta activa: gasta el mismo scrypt y responde como una contraseña incorrecta (siempre 401,
   * nunca se bloquea); `TopeDeIntentos` solo rechaza lo que excede el tope de evaluaciones en curso.
   */
  private async rechazarSinCuenta(nombre: string, contrasena: string): Promise<never> {
    await this.tope.conTopeFalso(`contrasena:${nombre}`, () =>
      this.credenciales.verificarContrasenaFalsa(contrasena),
    );
    throw credencialesInvalidas();
  }

  /** Scrypt fuera de toda transacción; un error al evaluar cuenta como contraseña incorrecta. */
  private async evaluarContrasena(contrasena: string, hash: string): Promise<boolean> {
    try {
      return await this.credenciales.verificarContrasena(contrasena, hash);
    } catch {
      return false;
    }
  }

  /**
   * Tiempo 1 (transacción corta). Bloquea la fila de la persona **activa** (`FOR NO KEY UPDATE` serializa
   * las reservas de la misma cuenta: ingresos y cambios de contraseña; no estorba a las llaves foráneas ni
   * a otras personas) y reserva el intento. Una persona inactiva o inexistente no se bloquea ni se cuenta.
   */
  private async reservarIngreso(nombreUsuario: string): Promise<Reserva> {
    // Camino rápido: un bloqueo vigente se ve sin esperar turno (lectura sin bloquear la fila), así una
    // ráfaga contra una cuenta ya bloqueada se despacha en paralelo y no hace cola por su fila.
    const previo = await this.bloqueoVigente('u.nombre_usuario', nombreUsuario);
    if (previo !== null) return previo;
    const usuarios = await this.conexion.query<FilaUsuario>(
      `SELECT id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo
         FROM usuario WHERE nombre_usuario = $1 AND activo
          FOR NO KEY UPDATE`,
      { bind: [nombreUsuario], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora(); // después de esperar el turno
    const usuario = usuarios[0];
    if (usuario === undefined) return { tipo: 'sin_cuenta' };
    return this.reservar(usuario, ahora);
  }

  /** Rechazo por bloqueo vigente de la persona activa que cumple `columna = valor`, sin bloquear su fila. */
  private async bloqueoVigente(
    columna: 'u.nombre_usuario' | 'u.id',
    valor: string,
  ): Promise<Reserva | null> {
    const ahora = this.reloj.ahora();
    const filas = await this.conexion.query<{ bloqueado_hasta: Date }>(
      `SELECT b.bloqueado_hasta
         FROM usuario u
         JOIN bloqueo_intentos b ON b.objetivo_id = u.id AND b.ambito = 'CONTRASENA_USUARIO'
        WHERE ${columna} = $1 AND u.activo AND b.bloqueado_hasta > $2`,
      { bind: [valor, ahora], type: QueryTypes.SELECT },
    );
    const hasta = filas[0]?.bloqueado_hasta;
    return hasta === undefined
      ? null
      : { tipo: 'rechazo', error: bloqueoTemporal(hasta, ahora), bloqueoVigente: hasta };
  }

  private async reservar(usuario: FilaUsuario, ahora: Date): Promise<Reserva> {
    const reserva = await this.bloqueos.reservarIntento('CONTRASENA_USUARIO', usuario.id, ahora, {
      umbral: FALLOS_PARA_BLOQUEAR_CONTRASENA,
      duracionMs: MINUTOS_BLOQUEO_CONTRASENA * MINUTO_MS,
    });
    if (!reserva.permitido) {
      return {
        tipo: 'rechazo',
        error: bloqueoTemporal(reserva.bloqueadoHasta, ahora),
        bloqueoVigente: reserva.vigente ? reserva.bloqueadoHasta : undefined,
      };
    }
    return { tipo: 'reservado', usuario, turno: reserva.fallosSeguidos };
  }

  /**
   * Tiempo 3, contraseña incorrecta (transacción corta, actor `autenticacion`). El intento ya se contó al
   * reservarlo; aquí solo se pone el bloqueo si la cuenta llegó a 5 y todavía no hay (una vez) y se audita.
   * También lo usa un ingreso correcto si los intentos que llegaron después de él ya llenan el umbral.
   */
  private async ponerBloqueoSiCorresponde(
    empresaId: string,
    usuario: Pick<FilaUsuario, 'id' | 'nombre_usuario'>,
  ): Promise<void> {
    await this.contexto.ejecutar(
      empresaId,
      async () => {
        await this.conexion.query('SELECT id FROM usuario WHERE id = $1 FOR NO KEY UPDATE', {
          bind: [usuario.id],
          type: QueryTypes.SELECT,
        });
        const ahora = this.reloj.ahora();
        const fallo = await this.bloqueos.resolverFallo('CONTRASENA_USUARIO', usuario.id, ahora, {
          umbral: FALLOS_PARA_BLOQUEAR_CONTRASENA,
          duracionMs: MINUTOS_BLOQUEO_CONTRASENA * MINUTO_MS,
        });
        if (!fallo.bloqueoNuevo) return;
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
      },
      { actor: { sistema: 'autenticacion' } },
    );
  }

  /**
   * Tiempo 3, contraseña correcta (transacción corta, actor la persona). Vuelve a leer a la persona con la
   * fila bloqueada: si la desactivaron o le cambiaron la contraseña mientras se evaluaba, no entra.
   */
  private async completarIngreso(
    empresaId: string,
    verificado: FilaUsuario,
    turno: number,
  ): Promise<{ resultado: Resultado<IngresoRespuesta>; bloquear: boolean }> {
    const usuarios = await this.conexion.query<FilaUsuario>(
      `SELECT id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo
         FROM usuario WHERE id = $1
          FOR NO KEY UPDATE`,
      { bind: [verificado.id], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora();
    const usuario = usuarios[0];
    if (
      usuario === undefined ||
      !usuario.activo ||
      usuario.hash_contrasena !== verificado.hash_contrasena
    ) {
      return { resultado: { error: credencialesInvalidas() }, bloquear: false };
    }
    // Perdona los intentos hasta su turno; un bloqueo vigente no se toca (criterio 61).
    const bloquear = await this.bloqueos.liberarIntento(
      'CONTRASENA_USUARIO',
      usuario.id,
      ahora,
      turno,
      FALLOS_PARA_BLOQUEAR_CONTRASENA,
    );

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
        resultado: {
          error: new ErrorAplicacion(
            403,
            'FUERA_DE_HORARIO',
            'Estás fuera de tu horario de acceso; vuelve a intentar dentro de él',
          ),
        },
        bloquear,
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
    return {
      resultado: { ok: { token: armarTokenSesion(empresaId, filas[0]!.id, secreto), sesion } },
      bloquear,
    };
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
   * cuenta para el bloqueo del criterio 12. Mismo reparto en tres tiempos que el ingreso: reserva corta,
   * scrypt (de la actual y, si es correcta, el hash de la nueva) fuera de toda transacción y aplicación corta.
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
    const reserva = await this.contexto.ejecutar(principal.empresaId, () =>
      this.reservarCambio(principal.usuarioId!),
    );
    if (reserva.tipo === 'rechazo') throw reserva.error;
    if (reserva.tipo === 'sin_cuenta') {
      await this.credenciales.verificarContrasenaFalsa(entrada.actual);
      throw credencialesInvalidas();
    }

    const { usuario, turno } = reserva;
    const correcta = await this.evaluarContrasena(entrada.actual, usuario.hash_contrasena);
    if (!correcta) {
      await this.ponerBloqueoSiCorresponde(principal.empresaId, usuario);
      throw credencialesInvalidas();
    }
    const hash = await this.credenciales.hashContrasena(entrada.nueva);
    const resultado = await this.contexto.ejecutar(
      principal.empresaId,
      () => this.aplicarCambio(principal, usuario, hash, turno),
      { actor: { usuarioId: usuario.id, equipoId: principal.equipoId } },
    );
    if (resultado.bloquear) await this.ponerBloqueoSiCorresponde(principal.empresaId, usuario);
    if ('error' in resultado.resultado) throw resultado.resultado.error;
  }

  /** Tiempo 1 del cambio de contraseña: igual que `reservarIngreso`, pero por el id de la sesión. */
  private async reservarCambio(usuarioId: string): Promise<Reserva> {
    const previo = await this.bloqueoVigente('u.id', usuarioId);
    if (previo !== null) return previo;
    const usuarios = await this.conexion.query<FilaUsuario>(
      `SELECT id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo
         FROM usuario WHERE id = $1 AND activo
          FOR NO KEY UPDATE`,
      { bind: [usuarioId], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora(); // después de esperar el turno
    const usuario = usuarios[0];
    if (usuario === undefined) return { tipo: 'sin_cuenta' };
    return this.reservar(usuario, ahora);
  }

  /** Tiempo 3 del cambio: la actual era correcta; aplica la nueva si la persona sigue igual que al evaluar. */
  private async aplicarCambio(
    principal: Principal,
    verificado: FilaUsuario,
    hash: string,
    turno: number,
  ): Promise<{ resultado: Resultado<true>; bloquear: boolean }> {
    const usuarios = await this.conexion.query<FilaUsuario>(
      `SELECT id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo
         FROM usuario WHERE id = $1
          FOR NO KEY UPDATE`,
      { bind: [verificado.id], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora();
    const usuario = usuarios[0];
    if (
      usuario === undefined ||
      !usuario.activo ||
      usuario.hash_contrasena !== verificado.hash_contrasena
    ) {
      return { resultado: { error: credencialesInvalidas() }, bloquear: false };
    }
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
    // Perdona los intentos hasta su turno; un bloqueo vigente no se toca (criterio 61).
    const bloquear = await this.bloqueos.liberarIntento(
      'CONTRASENA_USUARIO',
      usuario.id,
      ahora,
      turno,
      FALLOS_PARA_BLOQUEAR_CONTRASENA,
    );
    await this.auditoria.registrar({
      accion: 'cambiar_contrasena',
      entidad: 'usuario',
      entidadId: usuario.id,
      detalle: { usuarioId: usuario.id, eraTemporal: usuario.contrasena_temporal },
    });
    return { resultado: { ok: true }, bloquear };
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
