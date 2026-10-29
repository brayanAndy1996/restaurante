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
import { SucursalesConsultaService } from '../plataforma/sucursales-consulta.service';
import { SuscripcionService } from '../plataforma/suscripcion.service';
import { BloqueosService, decidirReserva, type FilaBloqueo } from './bloqueos.service';
import { CupoScrypt, GRUPO_SIN_CUENTA } from './cupo-scrypt';
import { MINUTOS_INACTIVIDAD_CONTRASENA } from './constantes-acceso';
import { Credenciales } from './credenciales';
import { DesconexionDeSesiones } from './desconexion-de-sesiones';
import { bloqueoTemporal, credencialesInvalidas, errorDeReserva } from './errores-acceso';
import { HorarioService } from './horario.service';
import { minutosDeInactividad } from './inactividad';
import { SesionActual } from './sesion-actual';
import { TopeDeIntentos, claveDeCambioContrasena, claveDeIngresoUsuario } from './tope-de-intentos';
import { armarTokenSesion } from './tokens';

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

/** Rechazo que se responde sin evaluar: el error y, si es un bloqueo vigente, hasta cuándo. */
interface Rechazo {
  error: ErrorAplicacion;
  bloqueoVigente?: Date;
}

/** Resultado del tiempo 1 (reserva): rechazar ya, tratar como nombre sin cuenta, o evaluar a esta persona. */
type Reserva =
  | ({ tipo: 'rechazo' } & Rechazo)
  | { tipo: 'sin_cuenta' }
  | { tipo: 'reservado'; usuario: FilaUsuario };

/** Columnas de `FilaUsuario`. */
const COLUMNAS_USUARIO = `id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal, horario,
              es_administrador, activo`;

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
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(TopeDeIntentos) private readonly tope: TopeDeIntentos,
    @Inject(CupoScrypt) private readonly cupo: CupoScrypt,
    @Inject(DesconexionDeSesiones) private readonly desconexion: DesconexionDeSesiones,
  ) {}

  // ---- Ingreso con contraseña ------------------------------------------------------------------

  /**
   * `POST /sesiones/contrasena` (criterios 10 a 13 y 12b). El ingreso va en tres tiempos y ninguna
   * conexión del pool ni bloqueo de fila queda retenido mientras corre scrypt (RNF-03):
   *
   * 0. Antes de reservar: tope de ingresos por nombre, turno (un ingreso a la vez por nombre), la empresa del
   *    nombre y una **comprobación previa** (lectura corta, sin bloquear la fila y antes de pedir cupo): con
   *    un bloqueo vigente o con `fallos + en curso` en el umbral responde 429 sin entrar en ninguna cola. Solo
   *    entonces toma un cupo del scrypt repartido entre empresas (`CupoScrypt`). Lo que no entra a tiempo
   *    responde 429 de 1 s sin evaluar y sin contar como fallo.
   * 1. Transacción corta que bloquea la fila del usuario, vuelve a revisar el bloqueo (ahora con la fila
   *    bloqueada, que es la comprobación definitiva) y **reserva el intento**
   *    (`BloqueosService.reservarIntento`: lo marca "en curso"). Con el bloqueo vigente responde 429 de la
   *    duración restante; con `fallos + en curso` en el umbral, 429 de 1 s: en ambos casos sin evaluar y sin
   *    contar. Ninguna ráfaga evalúa más de 5 contraseñas (criterio 12).
   * 2. La contraseña se evalúa fuera de toda transacción.
   * 3. Otra transacción corta aplica el resultado: si falló, cuenta el fallo y pone el bloqueo cuando la
   *    cuenta llegó a 5 (con su fila de auditoría); si es correcta, vuelve a bloquear la fila, comprueba que
   *    la persona sigue activa y con la misma contraseña, reinicia la cuenta de fallos (sin borrar un bloqueo
   *    vigente), revisa el horario y crea la sesión.
   *
   * Un nombre sin cuenta activa (inexistente o inactivo) no tiene fila que contar: toma el cupo igual que los
   * demás, gasta el mismo scrypt y responde igual que una contraseña incorrecta (criterio 11).
   */
  async ingresarConContrasena(entrada: IngresoContrasenaEntrada): Promise<IngresoRespuesta> {
    const nombre = minusculasAscii(entrada.usuario);
    // Una ráfaga contra un mismo nombre no pasa del tope: lo demás se rechaza sin tocar la base (RNF-03).
    const clave = claveDeIngresoUsuario(nombre);
    const { soltar, enRafaga } = this.tope.entrar(clave);
    try {
      return await this.tope.conTurno(clave, () =>
        this.ingresarConTope(nombre, entrada.contrasena, clave, enRafaga),
      );
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
    // Solo en plena ráfaga (3 o más ingresos del mismo nombre a la vez) se confía en lo que se vio hace un
    // instante; un reintento normal siempre pregunta a la base.
    if (enRafaga) {
      if (this.tope.esSinCuentaReciente(clave)) return this.rechazarSinCuenta(contrasena);
      const bloqueoReciente = this.tope.bloqueoReciente(clave, this.reloj.ahora());
      if (bloqueoReciente !== null) throw bloqueoTemporal(bloqueoReciente, this.reloj.ahora());
    }
    const empresaId = await buscarEmpresaDeUsuario(this.conexion, nombre);
    if (empresaId === null) {
      if (enRafaga) this.tope.recordarSinCuenta(clave);
      return this.rechazarSinCuenta(contrasena);
    }
    // Una cuenta ya bloqueada (o con 5 evaluaciones decidiéndola) responde 429 aquí, sin ocupar la cola de su
    // empresa: atacar con nombres reales no llena la cola de A (criterios 10 y 11).
    const previo = await this.contexto.ejecutar(empresaId, () =>
      this.comprobarPrevio('u.nombre_usuario', nombre),
    );
    if (previo !== null) {
      if (enRafaga && previo.bloqueoVigente !== undefined) {
        this.tope.recordarBloqueo(clave, previo.bloqueoVigente);
      }
      throw previo.error;
    }
    return this.cupo.conCupo(empresaId, () =>
      this.ingresarConCupo(empresaId, nombre, contrasena, clave, enRafaga),
    );
  }

  private async ingresarConCupo(
    empresaId: string,
    nombre: string,
    contrasena: string,
    clave: string,
    enRafaga: boolean,
  ): Promise<IngresoRespuesta> {
    // La reserva solo escribe `bloqueo_intentos` (sin trazabilidad): no necesita actor.
    const reserva = await this.contexto.ejecutar(empresaId, () =>
      this.reservarPara('nombre_usuario', nombre),
    );
    if (reserva.tipo === 'rechazo') {
      if (enRafaga && reserva.bloqueoVigente !== undefined) {
        this.tope.recordarBloqueo(clave, reserva.bloqueoVigente);
      }
      throw reserva.error;
    }
    if (reserva.tipo === 'sin_cuenta') {
      // Inactivo: ya se tiene el cupo, se gasta el scrypt falso en él.
      if (enRafaga) this.tope.recordarSinCuenta(clave);
      await this.credenciales.verificarContrasenaFalsa(contrasena);
      throw credencialesInvalidas();
    }

    const { usuario } = reserva;
    return this.conLiberacion(empresaId, usuario.id, async () => {
      const correcta = await this.evaluarContrasena(contrasena, usuario.hash_contrasena);
      if (!correcta) {
        await this.resolverFallo(empresaId, usuario);
        throw credencialesInvalidas();
      }
      // Credenciales correctas: de aquí en adelante los cambios quedan a nombre de la persona.
      const resultado = await this.contexto.ejecutar(
        empresaId,
        () => this.completarIngreso(empresaId, usuario),
        { actor: { usuarioId: usuario.id } },
      );
      if ('error' in resultado) throw resultado.error;
      return resultado.ok;
    });
  }

  /**
   * Corre el resto de un ingreso ya reservado; si algo inesperado lo corta (la base falló al resolver), la
   * reserva se libera sin contar para que no quede "en curso" hasta que venza.
   */
  private async conLiberacion<T>(
    empresaId: string,
    usuarioId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ErrorAplicacion)) {
        await this.contexto
          .ejecutar(empresaId, () =>
            this.bloqueos.liberarReserva('CONTRASENA_USUARIO', usuarioId, this.reloj.ahora()),
          )
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Nombre sin cuenta (inexistente): toma un cupo del grupo de los nombres sin cuenta, gasta el mismo scrypt
   * y responde como una contraseña incorrecta (siempre 401, nunca se bloquea). Lo que excede el cupo recibe
   * el mismo 429 que cualquier otro ingreso, tenga o no cuenta el nombre.
   */
  private async rechazarSinCuenta(contrasena: string): Promise<never> {
    await this.cupo.conCupo(GRUPO_SIN_CUENTA, () =>
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
   * a otras personas) y reserva el intento. Una persona inactiva o inexistente no se bloquea ni se cuenta. El
   * ingreso la busca por su nombre de usuario y el cambio de contraseña por el id de la sesión.
   */
  private async reservarPara(por: 'nombre_usuario' | 'id', valor: string): Promise<Reserva> {
    const usuario = await this.leerUsuario(por, valor, { soloActivo: true, bloquear: true });
    const ahora = this.reloj.ahora(); // después de esperar el turno
    if (usuario === undefined) return { tipo: 'sin_cuenta' };
    return this.reservar(usuario, ahora);
  }

  /** Fila de `usuario` por nombre de usuario o por id; `bloquear` la toma con `FOR NO KEY UPDATE`. */
  private async leerUsuario(
    por: 'nombre_usuario' | 'id',
    valor: string,
    opciones: { soloActivo?: boolean; bloquear?: boolean } = {},
  ): Promise<FilaUsuario | undefined> {
    const filas = await this.conexion.query<FilaUsuario>(
      `SELECT ${COLUMNAS_USUARIO}
         FROM usuario WHERE ${por} = $1${opciones.soloActivo === true ? ' AND activo' : ''}
         ${opciones.bloquear === true ? 'FOR NO KEY UPDATE' : ''}`,
      { bind: [valor], type: QueryTypes.SELECT },
    );
    return filas[0];
  }

  /**
   * Tiempo 3 de un ingreso o de un cambio de contraseña con la contraseña correcta: vuelve a leer a la persona
   * con la fila bloqueada. Si la desactivaron o le cambiaron la contraseña mientras se evaluaba, la reserva
   * termina sin contar (ni fallo ni éxito) y devuelve el error a responder; si no, la fila actual y la hora.
   */
  private async releerVerificado(
    verificado: FilaUsuario,
  ): Promise<{ usuario: FilaUsuario; ahora: Date } | { error: ErrorAplicacion }> {
    const usuario = await this.leerUsuario('id', verificado.id, { bloquear: true });
    const ahora = this.reloj.ahora();
    if (
      usuario === undefined ||
      !usuario.activo ||
      usuario.hash_contrasena !== verificado.hash_contrasena
    ) {
      await this.bloqueos.liberarReserva('CONTRASENA_USUARIO', verificado.id, ahora);
      return { error: credencialesInvalidas() };
    }
    return { usuario, ahora };
  }

  /**
   * Comprobación previa al cupo (lectura corta, **sin bloquear la fila**): rechazo si la persona activa que
   * cumple `columna = valor` tiene un bloqueo vigente o `fallos + en curso >= 5`; `null` si puede seguir (también
   * si no tiene cuenta activa o fila de intentos). Es una pista que ahorra la cola: la reserva definitiva sigue
   * haciéndose después, dentro del cupo y con la fila bloqueada.
   */
  private async comprobarPrevio(
    columna: 'u.nombre_usuario' | 'u.id',
    valor: string,
  ): Promise<Rechazo | null> {
    const ahora = this.reloj.ahora();
    const filas = await this.conexion.query<FilaBloqueo>(
      `SELECT b.fallos_seguidos, b.en_curso, b.en_curso_desde, b.bloqueado_hasta
         FROM usuario u
         JOIN bloqueo_intentos b ON b.objetivo_id = u.id AND b.ambito = 'CONTRASENA_USUARIO'
        WHERE ${columna} = $1 AND u.activo`,
      { bind: [valor], type: QueryTypes.SELECT },
    );
    const decision = decidirReserva(filas[0], ahora, { umbral: FALLOS_PARA_BLOQUEAR_CONTRASENA });
    if (decision.permitido) return null;
    return {
      error: errorDeReserva(decision, ahora),
      ...(decision.motivo === 'BLOQUEO' ? { bloqueoVigente: decision.bloqueadoHasta } : {}),
    };
  }

  private async reservar(usuario: FilaUsuario, ahora: Date): Promise<Reserva> {
    const reserva = await this.bloqueos.reservarIntento('CONTRASENA_USUARIO', usuario.id, ahora, {
      umbral: FALLOS_PARA_BLOQUEAR_CONTRASENA,
    });
    if (reserva.permitido) return { tipo: 'reservado', usuario };
    // Cupo de evaluaciones en curso lleno (`CUPO_LLENO`): no se evalúa, no cuenta como fallo y no bloquea.
    return {
      tipo: 'rechazo',
      error: errorDeReserva(reserva, ahora),
      ...(reserva.motivo === 'BLOQUEO' ? { bloqueoVigente: reserva.bloqueadoHasta } : {}),
    };
  }

  /**
   * Tiempo 3, contraseña incorrecta (transacción corta, actor `autenticacion`). La reserva deja de estar en
   * curso y cuenta un fallo; si la cuenta llegó a 5 y todavía no hay bloqueo, lo pone (una sola vez) y lo
   * audita.
   */
  private async resolverFallo(
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
  ): Promise<Resultado<IngresoRespuesta>> {
    const releido = await this.releerVerificado(verificado);
    if ('error' in releido) return releido;
    const { usuario, ahora } = releido;
    // Ingreso correcto: la cuenta de fallos vuelve a cero; un bloqueo vigente no se toca (criterio 61).
    await this.bloqueos.resolverExito('CONTRASENA_USUARIO', usuario.id, ahora);

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
    // Con una sola sucursal, ya hay rol y por tanto el tiempo de Cocina/Barra (criterio 63b).
    const minutosInactividad = minutosDeInactividad({
      tipo: 'CONTRASENA',
      rol: elegibles.find((s) => s.id === sucursalId)?.rol ?? null,
      ...(await this.minutosDeSucursal(sucursalId)),
      minutosSesion: MINUTOS_INACTIVIDAD_CONTRASENA,
    });
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
      expiraPorInactividadEn: new Date(ahora.getTime() + minutosInactividad * MINUTO_MS),
    });
    return { ok: { token: armarTokenSesion(empresaId, filas[0]!.id, secreto), sesion } };
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
      minutos_cocina: number | null;
      rol_en_sucursal: Rol | null;
    }>(
      `SELECT s.sucursal_id, s.ultima_actividad_en, s.minutos_inactividad, s.equipo_id,
              s.equipo_recordado_id, e.nombre AS equipo_nombre, sa.minutos_inactividad AS minutos_sucursal,
              sa.minutos_inactividad_cocina AS minutos_cocina, ac.rol AS rol_en_sucursal
         FROM sesion s
         LEFT JOIN equipo e ON e.id = s.equipo_id AND e.empresa_id = s.empresa_id
         LEFT JOIN sucursal_acceso sa ON sa.sucursal_id = s.sucursal_id AND sa.empresa_id = s.empresa_id
         LEFT JOIN acceso_sucursal ac
           ON ac.usuario_id = s.usuario_id AND ac.sucursal_id = s.sucursal_id
          AND ac.empresa_id = s.empresa_id
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
    // El tiempo que rige (criterios 39 y 63b): el rol sale de la sucursal activa guardada en la sesión, no del
    // principal, que pudo quedar atrás si esta misma petición acaba de cambiar de sucursal.
    const minutos = minutosDeInactividad({
      tipo: principal.tipo,
      rol: principal.esAdministrador ? 'ADMINISTRADOR' : sesion.rol_en_sucursal,
      minutosSucursal: sesion.minutos_sucursal,
      minutosCocina: sesion.minutos_cocina,
      minutosSesion: sesion.minutos_inactividad,
    });
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

    const usuario = await this.leerUsuario('id', principal.usuarioId!);
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
   * para la empresa), que lee `AuditoriaService`.
   */
  private async superadministradorDeSoporte(
    principal: Principal,
  ): Promise<{ id: string; nombre: string }> {
    const detalle = await this.auditoria.detalleDeAccionDeSesion(
      principal.sesionId!,
      'inicio_soporte',
    );
    const superadministrador = detalle?.superadministrador as { nombre?: unknown } | undefined;
    const nombre =
      typeof superadministrador?.nombre === 'string' ? superadministrador.nombre : 'Soporte';
    return { id: principal.superadministradorId!, nombre };
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
    // Cambió de sucursal activa: sus conexiones de tiempo real se cierran al confirmar y la PWA se reconecta
    // a las salas de la sucursal nueva (historia 004, criterio 66).
    this.desconexion.alConfirmar([principal.sesionId]);
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
   * cuenta para el bloqueo del criterio 12. Mismo orden que el ingreso: tope y turno por usuario (clave
   * `cambio-contrasena:<usuario>`: una sesión no ocupa varios lugares a la vez), comprobación previa del
   * bloqueo sin entrar en la cola, cupo del scrypt, reserva corta, scrypt (de la actual y, si es correcta, el
   * hash de la nueva) fuera de toda transacción y aplicación corta. Sin la comprobación y el turno, un mozo
   * con sesión llenaba la cola de su empresa (criterios 10, 11 y 16).
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
    const usuarioId = principal.usuarioId;
    const clave = claveDeCambioContrasena(usuarioId);
    const { soltar } = this.tope.entrar(clave);
    try {
      await this.tope.conTurno(clave, async () => {
        const previo = await this.contexto.ejecutar(principal.empresaId, () =>
          this.comprobarPrevio('u.id', usuarioId),
        );
        if (previo !== null) throw previo.error;
        await this.cupo.conCupo(principal.empresaId, () => this.cambiarConCupo(principal, entrada));
      });
    } finally {
      soltar();
    }
  }

  private async cambiarConCupo(
    principal: Principal,
    entrada: CambiarContrasenaEntrada,
  ): Promise<void> {
    const reserva = await this.contexto.ejecutar(principal.empresaId, () =>
      this.reservarPara('id', principal.usuarioId!),
    );
    if (reserva.tipo === 'rechazo') throw reserva.error;
    if (reserva.tipo === 'sin_cuenta') {
      await this.credenciales.verificarContrasenaFalsa(entrada.actual);
      throw credencialesInvalidas();
    }

    const { usuario } = reserva;
    await this.conLiberacion(principal.empresaId, usuario.id, async () => {
      const correcta = await this.evaluarContrasena(entrada.actual, usuario.hash_contrasena);
      if (!correcta) {
        await this.resolverFallo(principal.empresaId, usuario);
        throw credencialesInvalidas();
      }
      const hash = await this.credenciales.hashContrasena(entrada.nueva);
      const resultado = await this.contexto.ejecutar(
        principal.empresaId,
        () => this.aplicarCambio(principal, usuario, hash),
        { actor: { usuarioId: usuario.id, equipoId: principal.equipoId } },
      );
      if ('error' in resultado) throw resultado.error;
      this.tope.olvidar(claveDeIngresoUsuario(usuario.nombre_usuario));
    });
  }

  /** Tiempo 3 del cambio: la actual era correcta; aplica la nueva si la persona sigue igual que al evaluar. */
  private async aplicarCambio(
    principal: Principal,
    verificado: FilaUsuario,
    hash: string,
  ): Promise<Resultado<true>> {
    const releido = await this.releerVerificado(verificado);
    if ('error' in releido) return releido;
    const { usuario, ahora } = releido;
    await this.conexion.query(
      `UPDATE usuario SET hash_contrasena = $2, contrasena_temporal = false, actualizado_en = $3
        WHERE id = $1`,
      { bind: [usuario.id, hash, ahora] },
    );
    // Se cierran las demás sesiones de la persona; esta sigue. Los equipos recordados se conservan.
    const otras = await this.conexion.query<{ id: string }>(
      `UPDATE sesion SET cerrada_en = $3, motivo_cierre = 'CONTRASENA_CAMBIADA', actualizado_en = $3
        WHERE usuario_id = $1 AND id <> $2 AND cerrada_en IS NULL
        RETURNING id`,
      { bind: [usuario.id, principal.sesionId, ahora], type: QueryTypes.SELECT },
    );
    this.desconexion.alConfirmar(otras.map((o) => o.id));
    // Contraseña actual correcta: la cuenta de fallos vuelve a cero; un bloqueo vigente no se toca (criterio 61).
    await this.bloqueos.resolverExito('CONTRASENA_USUARIO', usuario.id, ahora);
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
    // La conexión de tiempo real de la sesión se cierra al confirmar (historia 004, criterio 66).
    this.desconexion.alConfirmar(cerradas.map((c) => c.id));
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
      const todas = await this.sucursales.listar(null);
      return todas.map((s) => ({ id: s.id, nombre: s.nombre, rol: 'ADMINISTRADOR' as const }));
    }
    const accesos = await this.conexion.query<{ sucursal_id: string; rol: Rol }>(
      'SELECT sucursal_id, rol FROM acceso_sucursal WHERE usuario_id = $1',
      { bind: [usuarioId], type: QueryTypes.SELECT },
    );
    // Los nombres y el orden (nombre, id) los da el módulo dueño de `sucursal`.
    const visibles = await this.sucursales.listar(accesos.map((a) => a.sucursal_id));
    const rolDe = new Map(accesos.map((a) => [a.sucursal_id, a.rol]));
    return visibles.map((s) => ({ id: s.id, nombre: s.nombre, rol: rolDe.get(s.id)! }));
  }

  /**
   * Los minutos de inactividad configurados en la sucursal (`null` sin sucursal o sin fila en
   * `sucursal_acceso`), para `minutosDeInactividad` en el momento del ingreso.
   */
  async minutosDeSucursal(
    sucursalId: string | null,
  ): Promise<{ minutosSucursal: number | null; minutosCocina: number | null }> {
    if (sucursalId === null) return { minutosSucursal: null, minutosCocina: null };
    const filas = await this.conexion.query<{ minutos: number; cocina: number }>(
      `SELECT minutos_inactividad AS minutos, minutos_inactividad_cocina AS cocina
         FROM sucursal_acceso WHERE sucursal_id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return { minutosSucursal: filas[0]?.minutos ?? null, minutosCocina: filas[0]?.cocina ?? null };
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
