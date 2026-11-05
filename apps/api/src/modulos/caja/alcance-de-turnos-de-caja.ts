import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RegistroAlcanceDeTurnos } from '../facturacion';
import { SesionActual } from '../seguridad';

/**
 * Le dice a facturación quién es el responsable de un turno de la sucursal activa (historia 006, criterio 100), para
 * que `GET /comprobantes?turnoId=` responda 403 a un Cajero que pide los de un turno ajeno aunque ese turno todavía no
 * haya emitido ninguno. Caja es dueña de `turno`; facturación no la lee. Se registra al arrancar.
 */
@Injectable()
export class AlcanceDeTurnosDeCaja implements OnModuleInit {
  constructor(
    @Inject(RegistroAlcanceDeTurnos) private readonly registro: RegistroAlcanceDeTurnos,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(SesionActual) private readonly sesion: SesionActual,
  ) {}

  onModuleInit(): void {
    this.registro.registrar((turnoId) => this.responsableDe(turnoId));
  }

  async responsableDe(turnoId: string): Promise<string | null> {
    const filas = await this.conexion.query<{ responsable_id: string }>(
      'SELECT responsable_id FROM turno WHERE id = $1 AND sucursal_id = $2',
      { bind: [turnoId, this.sesion.sucursalActiva()], type: QueryTypes.SELECT },
    );
    return filas[0]?.responsable_id ?? null;
  }
}
