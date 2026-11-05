import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { UltimaEmisionDeEmisor } from '../plataforma';

/**
 * Registra en plataforma la fecha del último comprobante de un emisor (historia 006, criterio 6): `max(fecha_emision)`
 * de `comprobante` del emisor, o `null` si no emitió ninguno. Plataforma no lee `comprobante`.
 */
@Injectable()
export class UltimaEmisionDeComprobantes implements OnModuleInit {
  constructor(
    @Inject(UltimaEmisionDeEmisor) private readonly registro: UltimaEmisionDeEmisor,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
  ) {}

  onModuleInit(): void {
    this.registro.registrar((emisorId) => this.fecha(emisorId));
  }

  async fecha(emisorId: string): Promise<string | null> {
    const filas = await this.conexion.query<{ fecha: string | null }>(
      `SELECT to_char(max(fecha_emision), 'YYYY-MM-DD') AS fecha FROM comprobante WHERE emisor_id = $1`,
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
    return filas[0]?.fecha ?? null;
  }
}
