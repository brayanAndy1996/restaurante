import { Inject, Injectable } from '@nestjs/common';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { SesionActual, SesionesService } from '../seguridad';
import { veTodosLosTurnos } from './alcance-de-turnos';

/** Qué comprobantes ve quien llama al panel y a las alertas (criterio 169). */
export interface AlcanceDelPanel {
  /** Las sucursales cuyos comprobantes ve. */
  sucursales: string[];
  /** El Cajero solo ve los de sus propios turnos; los demás roles, `null`. */
  responsableId: string | null;
}

/**
 * El alcance del panel y de las alertas (historia 006, criterio 169, B.16): el **Cajero** ve solo los comprobantes de sus
 * turnos en la sucursal activa (y `sucursalId` es 400); el **Supervisor**, los de la sucursal activa (`sucursalId` también
 * es 400); el **Administrador**, los de todas las sucursales en las que es Administrador, o solo la que pida con
 * `sucursalId` (404 si no es Administrador en ella o es de otra empresa). La lista de sucursales la da seguridad
 * (`acceso_sucursal`): facturación no lee otras tablas que las suyas.
 */
@Injectable()
export class ResolutorDeAlcanceDelPanel {
  constructor(
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(SesionesService) private readonly sesiones: SesionesService,
  ) {}

  async resolver(sucursalId: string | undefined): Promise<AlcanceDelPanel> {
    const principal = this.sesion.principal();
    const activa = this.sesion.sucursalActiva();
    const esAdministrador = principal.esAdministrador || principal.rol === 'ADMINISTRADOR';
    if (!esAdministrador) {
      if (sucursalId !== undefined) {
        throw new ErrorAplicacion(
          400,
          'DATOS_INVALIDOS',
          'Solo el Administrador puede pedir otra sucursal',
          [{ campo: 'sucursalId', mensaje: 'Solo el Administrador puede pedir otra sucursal' }],
        );
      }
      return {
        sucursales: [activa],
        responsableId: veTodosLosTurnos(principal) ? null : principal.usuarioId,
      };
    }
    const elegibles = await this.sesiones.sucursalesElegibles(
      principal.usuarioId,
      principal.esAdministrador,
    );
    const propias = new Set(elegibles.filter((s) => s.rol === 'ADMINISTRADOR').map((s) => s.id));
    propias.add(activa);
    if (sucursalId !== undefined) {
      const pedida = sucursalId.toLowerCase();
      if (!propias.has(pedida)) {
        throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
      }
      return { sucursales: [pedida], responsableId: null };
    }
    return { sucursales: [...propias], responsableId: null };
  }
}
