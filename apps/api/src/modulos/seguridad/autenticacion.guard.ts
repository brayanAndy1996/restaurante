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
import {
  PERMITE_CONTRASENA_TEMPORAL,
  PUBLICA,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from './decoradores';
import { parsearTokenSesion, type TokenSesion } from './tokens';

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
    // Transacción propia que siempre se confirma: el cierre por expiración y la renovación quedan
    // guardados aunque el controlador falle. El error se lanza después, ya confirmada.
    const resultado = await this.contexto.ejecutar(partes.empresaId, () =>
      this.validarYRenovar(partes, alSegundoPlano),
    );
    if ('error' in resultado) throw resultado.error;
    return resultado.principal;
  }

  /**
   * Busca la sesión por id bajo RLS (con la empresa del token: una ajena no aparece, criterio 3), compara
   * la huella del secreto en tiempo constante, comprueba que no esté cerrada ni vencida (máximo absoluto
   * e inactividad, con el reloj de la API) y, según el tipo, que la persona siga activa y con acceso a la
   * sucursal activa (criterio 6; si no, cierra la sesión). **No** comprueba el horario (criterio 108).
   * Si la petición no trae `X-Actividad: segundo-plano`, renueva la actividad. Calcula el rol.
   */
  private async validarYRenovar(partes: TokenSesion, alSegundoPlano: boolean): Promise<Resultado> {
    const filas = await this.conexion.query<FilaSesion>(
      `SELECT s.id, s.tipo, s.usuario_id, s.superadministrador_id, s.equipo_id, s.equipo_recordado_id,
              s.sucursal_id, s.huella_secreto, s.ultima_actividad_en, s.expira_en, s.minutos_inactividad,
              s.cerrada_en, u.activo AS usuario_activo, u.es_administrador, u.contrasena_temporal
         FROM sesion s
         LEFT JOIN usuario u ON u.id = s.usuario_id AND u.empresa_id = s.empresa_id
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

    const ahora = this.reloj.ahora();
    const venceInactividad =
      sesion.ultima_actividad_en.getTime() + sesion.minutos_inactividad * MINUTO_MS;
    if (ahora.getTime() >= sesion.expira_en.getTime() || ahora.getTime() >= venceInactividad) {
      await this.cerrar(sesion.id, ahora, 'EXPIRADA');
      return {
        error: new ErrorAplicacion(401, 'SESION_EXPIRADA', 'La sesión expiró; vuelve a ingresar'),
      };
    }

    let principal: Principal;
    if (sesion.tipo === 'SOPORTE') {
      if (sesion.superadministrador_id === null) return { error: noAutenticado() };
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
    } else if (sesion.tipo === 'CONTRASENA') {
      if (sesion.usuario_id === null || sesion.usuario_activo !== true) {
        await this.cerrar(sesion.id, ahora, 'USUARIO_INACTIVO');
        return { error: noAutenticado() };
      }
      const esAdministrador = sesion.es_administrador === true;
      let rol: Principal['rol'] = esAdministrador ? 'ADMINISTRADOR' : null;
      if (!esAdministrador && sesion.sucursal_id !== null) {
        const accesos = await this.conexion.query<{ rol: Exclude<Principal['rol'], null> }>(
          'SELECT rol FROM acceso_sucursal WHERE usuario_id = $1 AND sucursal_id = $2',
          { bind: [sesion.usuario_id, sesion.sucursal_id], type: QueryTypes.SELECT },
        );
        if (accesos[0] === undefined) {
          // Le quitaron el acceso a la sucursal activa: la sesión se cierra (criterio 6).
          await this.cerrar(sesion.id, ahora, 'ACCESO_QUITADO');
          return { error: noAutenticado() };
        }
        rol = accesos[0].rol;
      }
      principal = {
        tipo: 'CONTRASENA',
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
    } else {
      // Las sesiones PIN (atadas al equipo recordado, con la inactividad de la sucursal activa) las
      // valida la tarea T34, cuando existan los equipos recordados y el ingreso con PIN. Mientras no
      // existan, ninguna sesión PIN es válida (falla cerrada).
      return { error: noAutenticado() };
    }

    if (!alSegundoPlano) {
      await this.conexion.query(
        'UPDATE sesion SET ultima_actividad_en = $2, actualizado_en = $2 WHERE id = $1',
        { bind: [sesion.id, ahora] },
      );
    }
    return { principal };
  }

  private async cerrar(sesionId: string, ahora: Date, motivo: string): Promise<void> {
    await this.conexion.query(
      `UPDATE sesion SET cerrada_en = $2, motivo_cierre = $3, actualizado_en = $2
        WHERE id = $1 AND cerrada_en IS NULL`,
      { bind: [sesionId, ahora, motivo] },
    );
  }
}
