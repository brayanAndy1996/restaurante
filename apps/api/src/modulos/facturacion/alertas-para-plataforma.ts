import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AlertasDeFacturacion } from '../plataforma';
import { contarAlertas } from './envios/alertas-sql';

/**
 * Registra en plataforma cómo contar las alertas de toda una empresa (historia 006, criterio 133): el tablero
 * `GET /plataforma/facturacion/alertas` del superadministrador recorre las empresas y plataforma no lee `comprobante`.
 */
@Injectable()
export class AlertasParaPlataforma implements OnModuleInit {
  constructor(
    @Inject(AlertasDeFacturacion) private readonly registro: AlertasDeFacturacion,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(() =>
      contarAlertas(this.conexion, this.reloj.ahora(), { sucursales: null, responsableId: null }),
    );
  }
}
