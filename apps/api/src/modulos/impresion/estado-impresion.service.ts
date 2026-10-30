import { Inject, Injectable } from '@nestjs/common';
import { type EstadoImpresionRespuesta, type LatidoEntrada } from '@restaurante/contratos';
import { diaOperativo } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import type { PuenteAutenticado } from '../../nucleo/principal';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { SucursalesConsultaService } from '../plataforma';
import { SesionActual } from '../seguridad';
import { EventosImpresion } from './eventos-impresion';
import { estadoDeImpresoras, puenteDeEstado, type EstadoReportado } from './lectura-impresoras';
import { SenalPuenteService, puenteVuelve } from './senal-puente.service';

/**
 * Estado del puente y de las impresoras (historia 004, 3b, criterios 120 y 121; ruta crítica P6 en lo que toca al
 * aislamiento: el latido de un puente solo cambia las impresoras de su sucursal).
 */
@Injectable()
export class EstadoImpresionService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(EventosImpresion) private readonly eventos: EventosImpresion,
    @Inject(SenalPuenteService) private readonly senal: SenalPuenteService,
  ) {}

  /**
   * `POST /puente/latido` (criterio 120): guarda la señal del puente y el estado de cada impresora (con su
   * `estadoDesde`); la versión de la app es la de la vinculación y no cambia. Una impresora de otra sucursal, de
   * otra empresa o inexistente se ignora. Publica `impresion.estado` en la sala de la sucursal solo si cambió algún
   * estado o si el puente vuelve (más de 60 segundos sin señal, o su desconexión ya se había avisado); el mismo
   * estado repetido no publica nada. Deja al puente bajo la vigilancia de la revisión de señal.
   */
  async latido(puente: PuenteAutenticado, entrada: LatidoEntrada): Promise<void> {
    const ahora = this.reloj.ahora();
    // El latido de un puente se turna con otro del mismo puente: el estado anterior se lee ya bloqueado.
    const filas = await this.conexion.query<{
      ultima_senal_en: Date | null;
      desconexion_avisada_en: Date | null;
      estado_impresoras: Record<string, EstadoReportado>;
    }>(
      `SELECT ultima_senal_en, desconexion_avisada_en, estado_impresoras FROM puente
        WHERE id = $1 AND sucursal_id = $2 AND activo FOR UPDATE`,
      { bind: [puente.puenteId, puente.sucursalId], type: QueryTypes.SELECT },
    );
    const actual = filas[0];
    if (actual === undefined) return;

    const propias = new Set(
      (
        await this.conexion.query<{ id: string }>(
          'SELECT id FROM impresora WHERE sucursal_id = $1',
          {
            bind: [puente.sucursalId],
            type: QueryTypes.SELECT,
          },
        )
      ).map((i) => i.id),
    );
    const nuevo: Record<string, EstadoReportado> = { ...actual.estado_impresoras };
    let cambio = false;
    for (const reporte of entrada.impresoras) {
      const id = reporte.id.toLowerCase();
      if (!propias.has(id)) continue;
      const anterior = nuevo[id];
      const error = reporte.error;
      if (anterior?.estado === reporte.estado) {
        // Mismo estado: se conserva desde cuándo; solo se actualiza el último error.
        nuevo[id] = {
          estado: reporte.estado,
          desde: anterior.desde,
          ...(error === undefined ? {} : { error }),
        };
        continue;
      }
      cambio = true;
      nuevo[id] = {
        estado: reporte.estado,
        desde: ahora.toISOString(),
        ...(error === undefined ? {} : { error }),
      };
    }
    const volvio = puenteVuelve(actual.ultima_senal_en, actual.desconexion_avisada_en, ahora);

    await this.conexion.query(
      `UPDATE puente SET ultima_senal_en = $2, desconexion_avisada_en = NULL,
              estado_impresoras = $3::jsonb, actualizado_en = $2
        WHERE id = $1`,
      {
        bind: [puente.puenteId, ahora, JSON.stringify(nuevo)],
        type: QueryTypes.UPDATE,
      },
    );
    this.senal.vigilar(puente);
    if (cambio || volvio) this.eventos.impresionEstado(puente.sucursalId);
  }

  /** `GET /impresion/estado` (criterio 121): el puente y las impresoras activas de la sucursal activa. */
  async estado(): Promise<EstadoImpresionRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const ahora = this.reloj.ahora();
    const horaCorte = await this.sucursales.horaCorte(sucursalId);
    const momento = { ahora, diaOperativo: diaOperativo(ahora, horaCorte ?? '00:00') };
    const puente = await puenteDeEstado(this.conexion, sucursalId, ahora);
    // Quien consulta (las PWA, cada 30 segundos) también deja al puente bajo vigilancia: si se queda sin señal, se avisa.
    if (puente !== null) {
      this.senal.vigilar({
        empresaId: this.contexto.empresaActual(),
        puenteId: puente.id,
        sucursalId,
      });
    }
    const impresoras = await this.conexion.query<{ id: string; nombre: string }>(
      'SELECT id, nombre FROM impresora WHERE sucursal_id = $1 AND activa ORDER BY lower(nombre), id',
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const estados = await estadoDeImpresoras(
      this.conexion,
      sucursalId,
      impresoras.map((i) => i.id),
      momento,
      puente,
    );
    return {
      ahora: ahora.toISOString(),
      puente:
        puente === null
          ? null
          : {
              id: puente.id,
              nombre: puente.nombre,
              ultimaSenalEn: puente.ultimaSenalEn?.toISOString() ?? null,
              conectado: puente.conectado,
            },
      impresoras: impresoras.map((i) => {
        const e = estados.get(i.id)!;
        return {
          id: i.id,
          nombre: i.nombre,
          estado: e.estado,
          estadoDesde: e.estadoDesde,
          pendientes: e.pendientes,
        };
      }),
    };
  }
}
