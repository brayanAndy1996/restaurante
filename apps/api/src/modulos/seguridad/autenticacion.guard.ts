import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ResolutorEmpresaPorCabecera } from '../../nucleo/contexto-empresa/resolutor-empresa-por-cabecera';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import {
  METADATO_SUPERADMINISTRADOR,
  type PeticionConPrincipal,
  type Principal,
} from '../../nucleo/principal';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { Credenciales } from './credenciales';
import { minutosDeInactividad } from './inactividad';
import {
  PERMITE_CONTRASENA_TEMPORAL,
  PUBLICA,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from './decoradores';
import { parsearTokenEquipo, parsearTokenSesion, type TokenSesion } from './tokens';

/** Token de Nest del resolutor por cabecera del modo de prueba (`null` si el entorno no lo habilita). */
export const MODO_PRUEBA = Symbol('MODO_PRUEBA');

const MINUTO_MS = 60_000;
const ACTIVIDAD_SEGUNDO_PLANO = 'segundo-plano';

type Resultado = { principal: Principal } | { error: ErrorAplicacion };

interface FilaSesion {
  id: string;
  tipo: 'CONTRASENA' | 'PIN' | 'SOPORTE';
  usuario_id: string | null;
  superadministrador_id: string | null;
  equipo_id: string | null;
  equipo_recordado_id: string | null;
  sucursal_id: string | null;
  huella_secreto: Buffer;
  ultima_actividad_en: Date;
  expira_en: Date;
  minutos_inactividad: number;
  cerrada_en: Date | null;
  usuario_activo: boolean | null;
  es_administrador: boolean | null;
  contrasena_temporal: boolean | null;
  /** Huella del secreto del equipo de la sesión (nula sin equipo). */
  equipo_huella: Buffer | null;
  /** El equipo recordado de la sesión: existe (`recordado_id`) y si fue revocado (`recordado_revocado_en`). */
  recordado_id: string | null;
  recordado_revocado_en: Date | null;
  /** Minutos de inactividad configurados en la sucursal activa (nulo si no se configuraron). */
  minutos_sucursal: number | null;
  /** Minutos de inactividad de Cocina/Barra configurados en la sucursal activa (nulo si no se configuraron). */
  minutos_cocina: number | null;
  /** El rol de la persona en la sucursal activa (nulo si no tiene acceso o no hay sucursal activa). */
  rol_en_sucursal: Exclude<Principal['rol'], null> | null;
}

const MENSAJE_NO_AUTENTICADO = 'Se requiere autenticación para esta operación';

/** 401 `NO_AUTENTICADO`, siempre con el mismo cuerpo (no distingue entre token, sesión, empresa o secreto). */
const noAutenticado = () => new ErrorAplicacion(401, 'NO_AUTENTICADO', MENSAJE_NO_AUTENTICADO);

/**
 * Guard global de autenticación (historia 002, criterios 1 a 9): toda ruta exige sesión salvo las
 * marcadas `@Publica()` (lista cerrada) y las de `/plataforma/*` con `@Superadministrador()`, que valida
 * su propio guard. Una ruta nueva sin decorador queda cerrada, no abierta.
 *
 * Con sesión: parsea `Authorization: Bearer se.<empresa>.<sesión>.<secreto>` (cualquier otra forma,
 * incluidos los tokens `sa.` y `eq.`, es 401 sin consultar nada), abre una transacción propia de la
 * empresa del token que se confirma siempre (`validarYRenovar`) y deja el principal en la petición. Así
 * la renovación de la actividad y el cierre por expiración quedan guardados aunque el controlador falle,
 * y la lectura corre bajo RLS con la empresa del token: la sesión de otra empresa no aparece.
 *
 * Modo de prueba: solo con `NODE_ENV=test` y `EMPRESA_POR_HEADER=habilitado`, una petición sin
 * `Authorization` corre con la empresa de `x-empresa-id` como principal de prueba (Administrador, actor de
 * sistema `prueba`); con `Authorization` la cabecera se ignora. Después aplica las reglas de la ruta:
 * contraseña temporal, `@SoloAdministrador` y `@RequiereSucursal`.
 */
@Injectable()
export class AutenticacionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(MODO_PRUEBA) private readonly modoPrueba: ResolutorEmpresaPorCabecera | null,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    // Solo HTTP: otros transportes (colas, WebSockets) autentican a su manera.
    if (contexto.getType() !== 'http') return true;
    const marca = (clave: string) =>
      this.reflector.getAllAndOverride<boolean | undefined>(clave, [
        contexto.getHandler(),
        contexto.getClass(),
      ]) === true;
    if (marca(PUBLICA) || marca(METADATO_SUPERADMINISTRADOR)) return true;

    const peticion = contexto.switchToHttp().getRequest<PeticionConPrincipal>();
    const autorizacion = peticion.headers.authorization;

    let principal: Principal;
    if (autorizacion === undefined && this.modoPrueba !== null) {
      principal = await this.principalDePrueba(peticion);
    } else {
      principal = await this.autenticar(peticion, autorizacion);
    }

    // Reglas de la ruta con el principal (criterios 9, 15 y 17).
    if (principal.debeCambiarContrasena && !marca(PERMITE_CONTRASENA_TEMPORAL)) {
      throw new ErrorAplicacion(
        403,
        'CAMBIO_CONTRASENA_REQUERIDO',
        'Debes cambiar tu contraseña temporal antes de continuar',
      );
    }
    if (marca(SOLO_ADMINISTRADOR) && principal.rol !== 'ADMINISTRADOR') {
      throw new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para realizar esta operación');
    }
    if (marca(REQUIERE_SUCURSAL) && principal.sucursalId === null) {
      throw new ErrorAplicacion(409, 'SUCURSAL_NO_ELEGIDA', 'Elige una sucursal para continuar');
    }
    peticion.principal = principal;
    return true;
  }

  /** Principal del modo de prueba: Administrador con la empresa de `x-empresa-id` y actor `prueba`. */
  private async principalDePrueba(peticion: PeticionConPrincipal): Promise<Principal> {
    const empresaId = await this.modoPrueba!.resolver(peticion);
    if (empresaId === null) {
      throw new ErrorAplicacion(
        401,
        'EMPRESA_NO_RESUELTA',
        'No se pudo determinar la empresa de la petición',
      );
    }
    return {
      tipo: 'PRUEBA',
      empresaId,
      sesionId: null,
      usuarioId: null,
      superadministradorId: null,
      sucursalId: null,
      rol: 'ADMINISTRADOR',
      esAdministrador: true,
      equipoId: null,
      equipoRecordadoId: null,
      debeCambiarContrasena: false,
    };
  }

  /** Valida el token de la cabecera y devuelve el principal, o lanza 401 sin abrir contexto si está mal formado. */
  private async autenticar(
    peticion: PeticionConPrincipal,
    autorizacion: string | undefined,
  ): Promise<Principal> {
    const token =
      typeof autorizacion === 'string' ? /^Bearer (\S+)$/i.exec(autorizacion)?.[1] : null;
    const partes = token ? parsearTokenSesion(token) : null;
    if (partes === null) throw noAutenticado();

    const alSegundoPlano = peticion.headers['x-actividad'] === ACTIVIDAD_SEGUNDO_PLANO;
    const cabeceraEquipo = peticion.headers['x-equipo'];
    // Transacción propia que siempre se confirma: el cierre por expiración y la renovación quedan
    // guardados aunque el controlador falle. El error se lanza después, ya confirmada.
    const resultado = await this.contexto.ejecutar(partes.empresaId, () =>
      this.validarYRenovar(partes, alSegundoPlano, cabeceraEquipo),
    );
    if ('error' in resultado) throw resultado.error;
    return resultado.principal;
  }

  /**
   * Busca la sesión por id bajo RLS (con la empresa del token: una ajena no aparece, criterio 3), compara
   * la huella del secreto en tiempo constante, comprueba que no esté cerrada ni vencida (máximo absoluto
   * e inactividad, con el reloj de la API) y, según el tipo, que la persona siga activa y con acceso a la
   * sucursal activa (criterio 6; si no, cierra la sesión) y, en el soporte, que el superadministrador siga
   * activo (criterio 61; si no, cierra la sesión). **No** comprueba el horario (criterio 108).
   * Si la petición no trae `X-Actividad: segundo-plano`, renueva la actividad. Calcula el rol.
   *
   * Sesión PIN (criterio 37 y 39): exige el `X-Equipo` del mismo equipo (con el secreto correcto) y que el
   * equipo recordado (equipo, persona) siga activo; su inactividad es la de la sucursal activa (5 minutos por
   * defecto, también sin sucursal activa). Si el rol en la sucursal activa es Cocina/Barra, en PIN y en
   * contraseña rige `minutosInactividadCocina` (60 por defecto; criterio 63b): ver `minutosDeInactividad`. Toda sesión asociada a un equipo recordado se cierra cuando ese
   * equipo recordado se revoca (criterio 30).
   */
  private async validarYRenovar(
    partes: TokenSesion,
    alSegundoPlano: boolean,
    cabeceraEquipo: unknown,
  ): Promise<Resultado> {
    const filas = await this.conexion.query<FilaSesion>(
      `SELECT s.id, s.tipo, s.usuario_id, s.superadministrador_id, s.equipo_id, s.equipo_recordado_id,
              s.sucursal_id, s.huella_secreto, s.ultima_actividad_en, s.expira_en, s.minutos_inactividad,
              s.cerrada_en, u.activo AS usuario_activo, u.es_administrador, u.contrasena_temporal,
              e.huella_secreto AS equipo_huella, er.id AS recordado_id,
              er.revocado_en AS recordado_revocado_en, sa.minutos_inactividad AS minutos_sucursal,
              sa.minutos_inactividad_cocina AS minutos_cocina, ac.rol AS rol_en_sucursal
         FROM sesion s
         LEFT JOIN usuario u ON u.id = s.usuario_id AND u.empresa_id = s.empresa_id
         LEFT JOIN equipo e ON e.id = s.equipo_id AND e.empresa_id = s.empresa_id
         LEFT JOIN equipo_recordado er
           ON er.id = s.equipo_recordado_id AND er.empresa_id = s.empresa_id
         LEFT JOIN sucursal_acceso sa ON sa.sucursal_id = s.sucursal_id AND sa.empresa_id = s.empresa_id
         LEFT JOIN acceso_sucursal ac
           ON ac.usuario_id = s.usuario_id AND ac.sucursal_id = s.sucursal_id
          AND ac.empresa_id = s.empresa_id
        WHERE s.id = $1`,
      { bind: [partes.sesionId], type: QueryTypes.SELECT },
    );
    const sesion = filas[0];
    // Sin la sesión, con otro secreto o ya cerrada: el mismo 401, sin tocar nada.
    if (
      sesion === undefined ||
      !this.credenciales.secretoCoincide(partes.secreto, sesion.huella_secreto)
    ) {
      return { error: noAutenticado() };
    }
    if (sesion.cerrada_en !== null) return { error: noAutenticado() };

    // La sesión PIN va atada a su equipo: sin la cabecera, con la de otro equipo o con un secreto que no es,
    // responde igual que una sesión inexistente y sin tocar nada.
    if (
      sesion.tipo === 'PIN' &&
      !this.equipoDeLaCabeceraEsDeLaSesion(sesion, partes, cabeceraEquipo)
    ) {
      return { error: noAutenticado() };
    }

    const ahora = this.reloj.ahora();
    // El rol de la sucursal activa es el mismo que más abajo da los permisos de la petición (criterio 63b); el
    // Administrador y el soporte no tienen fila de acceso y no cambian.
    const rolParaInactividad: Principal['rol'] =
      sesion.tipo === 'SOPORTE' || sesion.es_administrador === true
        ? 'ADMINISTRADOR'
        : sesion.rol_en_sucursal;
    const minutosInactividad = minutosDeInactividad({
      tipo: sesion.tipo,
      rol: rolParaInactividad,
      minutosSucursal: sesion.minutos_sucursal,
      minutosCocina: sesion.minutos_cocina,
      minutosSesion: sesion.minutos_inactividad,
    });
    const venceInactividad = sesion.ultima_actividad_en.getTime() + minutosInactividad * MINUTO_MS;
    if (ahora.getTime() >= sesion.expira_en.getTime() || ahora.getTime() >= venceInactividad) {
      await this.cerrar(sesion.id, ahora, 'EXPIRADA');
      return {
        error: new ErrorAplicacion(401, 'SESION_EXPIRADA', 'La sesión expiró; vuelve a ingresar'),
      };
    }

    // (equipo, persona) debe seguir activo: las sesiones PIN lo exigen siempre, y las de contraseña que
    // quedaron asociadas a un equipo se cierran cuando se revoca (criterio 30).
    if (
      (sesion.tipo === 'PIN' || sesion.equipo_recordado_id !== null) &&
      (sesion.recordado_id === null || sesion.recordado_revocado_en !== null)
    ) {
      await this.cerrar(sesion.id, ahora, 'EQUIPO_REVOCADO');
      return { error: noAutenticado() };
    }

    let principal: Principal;
    if (sesion.tipo === 'SOPORTE') {
      if (sesion.superadministrador_id === null) return { error: noAutenticado() };
      // El superadministrador sigue activo (criterios 61 y 66): si la desactivación ganó la carrera contra
      // la creación de esta sesión, la sesión no vale y se cierra. La API no puede leer su tabla; lo dice
      // una función de la base que solo responde si ese id es de un superadministrador activo.
      if (!(await this.superadministradorActivo(sesion.superadministrador_id))) {
        await this.cerrar(sesion.id, ahora, 'SUPERADMINISTRADOR_INACTIVO');
        return { error: noAutenticado() };
      }
      principal = {
        tipo: 'SOPORTE',
        empresaId: partes.empresaId,
        sesionId: sesion.id,
        usuarioId: null,
        superadministradorId: sesion.superadministrador_id,
        sucursalId: sesion.sucursal_id,
        rol: 'ADMINISTRADOR',
        esAdministrador: true,
        equipoId: null,
        equipoRecordadoId: null,
        debeCambiarContrasena: false,
      };
    } else {
      // Contraseña o PIN: la persona sigue activa y con acceso a la sucursal activa.
      if (sesion.usuario_id === null || sesion.usuario_activo !== true) {
        await this.cerrar(sesion.id, ahora, 'USUARIO_INACTIVO');
        return { error: noAutenticado() };
      }
      const esAdministrador = sesion.es_administrador === true;
      let rol: Principal['rol'] = esAdministrador ? 'ADMINISTRADOR' : null;
      if (!esAdministrador && sesion.sucursal_id !== null) {
        // El rol sale de la misma consulta que fijó el tiempo de inactividad (criterio 63b).
        if (sesion.rol_en_sucursal === null) {
          // Le quitaron el acceso a la sucursal activa: la sesión se cierra (criterio 6).
          await this.cerrar(sesion.id, ahora, 'ACCESO_QUITADO');
          return { error: noAutenticado() };
        }
        rol = sesion.rol_en_sucursal;
      }
      principal = {
        tipo: sesion.tipo,
        empresaId: partes.empresaId,
        sesionId: sesion.id,
        usuarioId: sesion.usuario_id,
        superadministradorId: null,
        sucursalId: sesion.sucursal_id,
        rol,
        esAdministrador,
        equipoId: sesion.equipo_id,
        equipoRecordadoId: sesion.equipo_recordado_id,
        debeCambiarContrasena: sesion.contrasena_temporal === true,
      };
    }

    if (!alSegundoPlano) {
      await this.conexion.query(
        'UPDATE sesion SET ultima_actividad_en = $2, actualizado_en = $2 WHERE id = $1',
        { bind: [sesion.id, ahora] },
      );
    }
    return { principal };
  }

  private async superadministradorActivo(superadministradorId: string): Promise<boolean> {
    const filas = await this.conexion.query<{ activo: boolean }>(
      'SELECT public.superadministrador_activo($1) AS activo',
      { bind: [superadministradorId], type: QueryTypes.SELECT },
    );
    return filas[0]?.activo === true;
  }

  /** El `X-Equipo` es el equipo de la sesión de la misma empresa y su secreto coincide (criterio 37). */
  private equipoDeLaCabeceraEsDeLaSesion(
    sesion: FilaSesion,
    partes: TokenSesion,
    cabeceraEquipo: unknown,
  ): boolean {
    const token = typeof cabeceraEquipo === 'string' ? parsearTokenEquipo(cabeceraEquipo) : null;
    return (
      token !== null &&
      sesion.equipo_id !== null &&
      sesion.equipo_huella !== null &&
      token.empresaId === partes.empresaId &&
      token.equipoId === sesion.equipo_id &&
      this.credenciales.secretoCoincide(token.secreto, sesion.equipo_huella)
    );
  }

  private async cerrar(sesionId: string, ahora: Date, motivo: string): Promise<void> {
    await this.conexion.query(
      `UPDATE sesion SET cerrada_en = $2, motivo_cierre = $3, actualizado_en = $2
        WHERE id = $1 AND cerrada_en IS NULL`,
      { bind: [sesionId, ahora, motivo] },
    );
  }
}
