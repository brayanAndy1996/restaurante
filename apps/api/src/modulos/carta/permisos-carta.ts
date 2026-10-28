import { Inject, Injectable } from '@nestjs/common';
import { requisitoPermiso, type Rol } from '@restaurante/dominio';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { SesionActual, SesionesService } from '../seguridad';

/** Mensaje del 403 del criterio 19b. */
export const MENSAJE_SUCURSAL_NO_AJUSTABLE =
  'Solo puedes cambiar el precio y la disponibilidad en las sucursales donde eres Cajero';

/**
 * Qué sucursales puede ajustar quien hace la petición (criterio 19b, ruta crítica): el precio y la
 * disponibilidad de una sucursal los cambia quien tiene `EDITAR_CARTA` como `permitido` con su rol **en la
 * sucursal ajustada**, no en la activa.
 *
 * - El Administrador, el soporte y el principal de prueba (`esAdministrador`): todas.
 * - Los demás: las sucursales donde su rol cumple `requisitoPermiso(rol, 'EDITAR_CARTA') === 'permitido'`. La
 *   regla sale de la matriz de `packages/dominio`: no hay una lista aparte de roles que ajustan precios. Sin
 *   acceso a la sucursal, no.
 *
 * El rol se lee en cada petición, dentro de la transacción de la petición (`SesionesService.sucursalesElegibles`),
 * así que un cambio de rol hecho por el Administrador vale desde la siguiente petición (criterio 6 de 002).
 */
@Injectable()
export class PermisosCarta {
  constructor(
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(SesionesService) private readonly sesiones: SesionesService,
  ) {}

  /**
   * Los ids (en minúsculas) de las sucursales que puede ajustar, o `'todas'` si puede ajustar cualquiera de la
   * empresa. Una sola lectura de los roles por petición.
   */
  async sucursalesAjustables(): Promise<'todas' | ReadonlySet<string>> {
    const principal = this.sesion.principal();
    if (principal.esAdministrador) return 'todas';
    if (principal.usuarioId === null) return new Set();
    const elegibles = await this.sesiones.sucursalesElegibles(principal.usuarioId, false);
    return new Set(
      elegibles.filter((s) => cumpleEditarCarta(s.rol)).map((s) => s.id.toLowerCase()),
    );
  }

  /** `true` si puede ajustar el precio y la disponibilidad de esa sucursal. */
  async puedeAjustarSucursal(sucursalId: string): Promise<boolean> {
    const ajustables = await this.sucursalesAjustables();
    return ajustables === 'todas' || ajustables.has(sucursalId.toLowerCase());
  }

  /**
   * 403 `PROHIBIDO` si no puede ajustar esa sucursal. Quien llama ya comprobó que la sucursal existe en la
   * empresa (404 antes que 403), para que el cuerpo de una sucursal de otra empresa no se distinga del de una
   * inexistente.
   */
  async exigirAjustarSucursal(sucursalId: string): Promise<void> {
    if (!(await this.puedeAjustarSucursal(sucursalId))) throw sucursalNoAjustable();
  }

  /**
   * 403 si alguna de las sucursales no se puede ajustar (`noDisponibleEn` del alta). Con una sola lectura de
   * los roles.
   */
  async exigirAjustarSucursales(sucursalIds: readonly string[]): Promise<void> {
    const ajustables = await this.sucursalesAjustables();
    if (ajustables === 'todas') return;
    if (sucursalIds.some((id) => !ajustables.has(id.toLowerCase()))) throw sucursalNoAjustable();
  }
}

const cumpleEditarCarta = (rol: Rol): boolean =>
  requisitoPermiso(rol, 'EDITAR_CARTA') === 'permitido';

const sucursalNoAjustable = (): ErrorAplicacion =>
  new ErrorAplicacion(403, 'PROHIBIDO', MENSAJE_SUCURSAL_NO_AJUSTABLE);
