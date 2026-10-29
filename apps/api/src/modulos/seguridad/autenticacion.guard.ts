import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ResolutorEmpresaPorCabecera } from '../../nucleo/contexto-empresa/resolutor-empresa-por-cabecera';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import {
  METADATO_SUPERADMINISTRADOR,
  type PeticionConPrincipal,
  type Principal,
} from '../../nucleo/principal';
import {
  PERMITE_CONTRASENA_TEMPORAL,
  PUBLICA,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from './decoradores';
import { ValidadorDeSesion } from './validador-de-sesion';

/** Token de Nest del resolutor por cabecera del modo de prueba (`null` si el entorno no lo habilita). */
export const MODO_PRUEBA = Symbol('MODO_PRUEBA');

const ACTIVIDAD_SEGUNDO_PLANO = 'segundo-plano';

/**
 * Guard global de autenticación (historia 002, criterios 1 a 9): toda ruta exige sesión salvo las
 * marcadas `@Publica()` (lista cerrada) y las de `/plataforma/*` con `@Superadministrador()`, que valida
 * su propio guard. Una ruta nueva sin decorador queda cerrada, no abierta.
 *
 * Con sesión: parsea `Authorization: Bearer se.<empresa>.<sesión>.<secreto>` (cualquier otra forma,
 * incluidos los tokens `sa.` y `eq.`, es 401 sin consultar nada), la valida con `ValidadorDeSesion` (el mismo
 * código que usa Socket.IO), que abre una transacción propia de la empresa del token que se confirma siempre, y
 * deja el principal en la petición. Así la renovación de la actividad y el cierre por expiración quedan
 * guardados aunque el controlador falle, y la lectura corre bajo RLS con la empresa del token: la sesión de otra
 * empresa no aparece.
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
    @Inject(ValidadorDeSesion) private readonly validador: ValidadorDeSesion,
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
    const alSegundoPlano = peticion.headers['x-actividad'] === ACTIVIDAD_SEGUNDO_PLANO;
    return this.validador.autenticar(token, peticion.headers['x-equipo'], {
      renovar: !alSegundoPlano,
    });
  }
}
