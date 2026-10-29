import { Inject, Injectable } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import type { Accion } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SesionActual } from './sesion-actual';

export interface ConsumirAutorizacion {
  autorizacionId: string;
  accion: Accion;
  entidad?: string;
  entidadId?: string;
  detalle?: unknown;
}

export interface AutorizacionConsumida {
  solicitanteId: string;
  autorizadorId: string;
  motivo: string;
}

/**
 * Mismo cuerpo para toda autorización que no sirve (usada, vencida, de otra acción, sesión o sucursal, de
 * otra empresa o inexistente; criterio 49): quien la presenta no distingue por qué.
 */
export const autorizacionInvalida = () =>
  new ErrorAplicacion(403, 'AUTORIZACION_INVALIDA', 'La autorización no es válida');

interface FilaConsumida {
  solicitante_id: string;
  autorizador_id: string;
  motivo: string;
}

/** Autorizaciones de supervisor de un solo uso (HU-03, criterios 44 a 53). */
@Injectable()
export class AutorizacionService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Consume la autorización de la petición dentro del contexto de la acción (misma transacción): la
   * marca usada solo si es de esta sesión y de esta persona, de esta acción y de esta sucursal, no se usó
   * y no venció; si no, 403 `AUTORIZACION_INVALIDA` y la acción no se ejecuta. El `UPDATE` condicional
   * resuelve la concurrencia: de dos peticiones con la misma autorización, la segunda espera a la primera y
   * ya no la encuentra libre (criterio 50). Deja la fila de auditoría de la acción con quién pidió (el
   * actor de la transacción), quién autorizó, el motivo y el `autorizacionId` (criterio 48), en la misma
   * transacción: si la acción falla, se revierten el consumo y la fila. `@Permiso` la llama sola.
   */
  async consumir(
    datos: ConsumirAutorizacion,
  ): Promise<AutorizacionConsumida & { autorizacionId: string }> {
    const principal = this.sesion.principal();
    const id = uuidSchema.safeParse(datos.autorizacionId);
    if (
      !id.success ||
      principal.sesionId === null ||
      principal.usuarioId === null ||
      principal.sucursalId === null
    ) {
      throw autorizacionInvalida();
    }
    const ahora = this.reloj.ahora();
    const filas = await this.conexion.query<FilaConsumida>(
      `UPDATE autorizacion SET usada_en = $6, actualizado_en = $6
        WHERE id = $1 AND sesion_id = $2 AND solicitante_id = $3 AND sucursal_id = $4 AND accion = $5
          AND usada_en IS NULL AND expira_en > $6
        RETURNING solicitante_id, autorizador_id, motivo`,
      {
        bind: [
          id.data.toLowerCase(),
          principal.sesionId,
          principal.usuarioId,
          principal.sucursalId,
          datos.accion,
          ahora,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const fila = filas[0];
    if (fila === undefined) throw autorizacionInvalida();

    const consumida = {
      autorizacionId: id.data.toLowerCase(),
      solicitanteId: fila.solicitante_id,
      autorizadorId: fila.autorizador_id,
      motivo: fila.motivo,
    };
    await this.auditoria.registrar({
      accion: datos.accion,
      motivo: consumida.motivo,
      entidad: datos.entidad ?? null,
      entidadId: datos.entidadId ?? null,
      autorizadoPorId: consumida.autorizadorId,
      autorizacionId: id.data.toLowerCase(),
      detalle: {
        solicitanteId: consumida.solicitanteId,
        autorizadorId: consumida.autorizadorId,
        ...(datos.detalle === undefined ? {} : { detalle: datos.detalle }),
      },
    });
    return consumida;
  }
}
