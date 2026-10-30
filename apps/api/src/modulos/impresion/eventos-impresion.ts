import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../nucleo/eventos';

/**
 * Los eventos de la impresión (historia 004, 3b, "Eventos en tiempo real"), registrados con
 * `ContextoEmpresa.alConfirmar`: salen solo después de confirmar la transacción, nunca en una reversión ni en una
 * escritura que no cambió nada. Llevan solo ids. `trabajo.nuevo` y `puente.configuracion` van a la sala del puente
 * activo de la sucursal (si no tiene uno, no se publica nada y el trabajo espera, criterio 112);
 * `impresion.estado`, a la sala de la sucursal.
 */
@Injectable()
export class EventosImpresion {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
  ) {}

  /** El id del puente activo de la sucursal, o `null` si no tiene uno vinculado. */
  async puenteActivo(sucursalId: string): Promise<string | null> {
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM puente WHERE sucursal_id = $1 AND activo',
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return filas[0]?.id ?? null;
  }

  /** `trabajo.nuevo` (criterio 112): uno por trabajo, al puente activo de la sucursal. */
  async trabajosNuevos(sucursalId: string, trabajoIds: readonly string[]): Promise<void> {
    if (trabajoIds.length === 0) return;
    const puenteId = await this.puenteActivo(sucursalId);
    if (puenteId === null) return;
    for (const trabajoId of trabajoIds) {
      this.alPuente(puenteId, 'trabajo.nuevo', { trabajoId });
    }
  }

  /** `puente.configuracion` (criterio 110): el puente de la sucursal vuelve a pedir su configuración. */
  async configuracionCambio(sucursalId: string): Promise<void> {
    const puenteId = await this.puenteActivo(sucursalId);
    if (puenteId === null) return;
    this.alPuente(puenteId, 'puente.configuracion', {});
  }

  /** `impresion.estado` (criterio 120): cambió el estado del puente o de alguna impresora de la sucursal. */
  impresionEstado(sucursalId: string): void {
    const empresaId = this.contexto.empresaActual();
    this.contexto.alConfirmar(() =>
      this.publicador.publicar({
        empresaId,
        sala: { tipo: 'sucursal', sucursalId },
        nombre: 'impresion.estado',
        datos: { sucursalId },
      }),
    );
  }

  private alPuente(puenteId: string, nombre: string, datos: Record<string, unknown>): void {
    const empresaId = this.contexto.empresaActual();
    this.contexto.alConfirmar(() =>
      this.publicador.publicar({ empresaId, sala: { tipo: 'puente', puenteId }, nombre, datos }),
    );
  }
}
