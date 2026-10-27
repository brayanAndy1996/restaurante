import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { SaludRespuesta } from '@restaurante/contratos';
import type { Response } from 'express';
import type { Sequelize } from 'sequelize';
import { CONEXION_API, comprobarConexion } from '../../nucleo/base-de-datos';
import { Publica } from '../seguridad';

@Controller('health')
export class SaludController {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /**
   * 200 `{ estado: 'ok', baseDeDatos: 'ok' }` si la base responde a `SELECT 1` en menos de 2 s;
   * si no, 503 `{ estado: 'error', baseDeDatos: 'error' }` sin mensaje ni datos de conexión.
   */
  @Get()
  @Publica()
  async comprobar(@Res({ passthrough: true }) respuesta: Response): Promise<SaludRespuesta> {
    const baseDeDatos = await comprobarConexion(this.conexion);
    if (baseDeDatos) return { estado: 'ok', baseDeDatos: 'ok' };
    respuesta.status(503);
    return { estado: 'error', baseDeDatos: 'error' };
  }
}
