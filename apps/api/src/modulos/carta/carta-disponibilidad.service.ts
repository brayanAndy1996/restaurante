import { Inject, Injectable } from '@nestjs/common';
import type { AgotadoRespuesta } from '@restaurante/contratos';
import {
  agotadoVigente,
  diaOperativo,
  type HastaAgotado,
  type OrigenAgotado,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import { noEncontrado } from './errores-carta';
import { EventosCarta } from './eventos-carta';
import { aIso } from './util-carta';

/** Entrada de `CartaDisponibilidadService.marcarAgotado` (criterio 53). */
export interface MarcarAgotadoEntrada {
  sucursalId: string;
  productoId: string;
  hasta: HastaAgotado;
  origen: OrigenAgotado;
}

/** Entrada de `CartaDisponibilidadService.reactivar` (criterio 53). */
export interface ReactivarEntrada {
  sucursalId: string;
  productoId: string;
}

interface FilaAgotado {
  id: string;
  desde: Date;
  dia_operativo: string;
  hasta: HastaAgotado;
  origen: OrigenAgotado;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que dice un agotado en la auditoría. */
const paraAuditoria = (a: {
  diaOperativo: string;
  hasta: HastaAgotado;
  origen: OrigenAgotado;
}) => ({
  hasta: a.hasta,
  origen: a.origen,
  diaOperativo: a.diaOperativo,
});

/**
 * Agotados (86) con la sucursal y el origen explícitos: lo usan los controladores (la sucursal activa, origen
 * `MANUAL`) y la sección 6 (agotado automático por falta de stock, `SIN_STOCK`). Corren dentro de un contexto de
 * empresa con actor (de persona o de sistema) y no usan el principal de la sesión.
 *
 * La vigencia se calcula siempre al leer, con `agotadoVigente` y el día operativo de la sucursal según el reloj de
 * la API (nunca `now()` de la base): no hay tareas programadas. Cada cambio real deja una fila de auditoría y,
 * después de confirmar, un `carta.disponibilidad`; un no-op no deja ninguna de las dos (criterios 40, 41 y 46).
 */
@Injectable()
export class CartaDisponibilidadService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
  ) {}

  /** Día operativo actual de la sucursal (404 si no es de la empresa) y el id del producto (404 si no es de la empresa). */
  private async preparar(sucursalId: string, productoId: string) {
    const sucursal = sucursalId.toLowerCase();
    const producto = productoId.toLowerCase();
    if (!UUID.test(sucursal)) throw noEncontrado('La sucursal');
    if (!UUID.test(producto)) throw noEncontrado('El producto');
    const horaCorte = await this.sucursales.horaCorte(sucursal);
    if (horaCorte === null) throw noEncontrado('La sucursal');
    const existe = await this.conexion.query<{ id: string }>(
      'SELECT id FROM producto WHERE id = $1',
      { bind: [producto], type: QueryTypes.SELECT },
    );
    if (existe[0] === undefined) throw noEncontrado('El producto');
    return { sucursal, producto, dia: diaOperativo(this.reloj.ahora(), horaCorte) };
  }

  /** El agotado guardado (vigente o vencido) con la fila bloqueada, para decidir el no-op y el antes. */
  private async leerBloqueado(
    producto: string,
    sucursal: string,
  ): Promise<FilaAgotado | undefined> {
    return (
      await this.conexion.query<FilaAgotado>(
        `SELECT id, desde, dia_operativo::text AS dia_operativo, hasta, origen
           FROM producto_agotado WHERE producto_id = $1 AND sucursal_id = $2 FOR UPDATE`,
        { bind: [producto, sucursal], type: QueryTypes.SELECT },
      )
    )[0];
  }

  /**
   * Criterios 39, 40 y 46: marca el producto como agotado en la sucursal, o actualiza el agotado vigente si
   * cambia `hasta` o `origen`. Con el mismo agotado vigente responde lo guardado sin escribir, auditar ni
   * publicar. Si el agotado anterior ya había vencido, es uno nuevo. 404 si el producto o la sucursal no son
   * de la empresa.
   */
  async marcarAgotado(entrada: MarcarAgotadoEntrada): Promise<AgotadoRespuesta> {
    const { sucursal, producto, dia } = await this.preparar(entrada.sucursalId, entrada.productoId);
    const actual = await this.leerBloqueado(producto, sucursal);
    const vigente =
      actual !== undefined &&
      agotadoVigente({ diaOperativo: actual.dia_operativo, hasta: actual.hasta }, dia);

    if (vigente && actual.hasta === entrada.hasta && actual.origen === entrada.origen) {
      return aRespuesta(producto, sucursal, actual);
    }

    const ahora = this.reloj.ahora();
    await this.conexion.query(
      `INSERT INTO producto_agotado (empresa_id, producto_id, sucursal_id, desde, dia_operativo, hasta,
                                     origen, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $4, $4)
       ON CONFLICT (producto_id, sucursal_id)
       DO UPDATE SET desde = EXCLUDED.desde, dia_operativo = EXCLUDED.dia_operativo,
                     hasta = EXCLUDED.hasta, origen = EXCLUDED.origen,
                     actualizado_en = EXCLUDED.actualizado_en`,
      {
        bind: [
          this.contexto.empresaActual(),
          producto,
          sucursal,
          ahora,
          dia,
          entrada.hasta,
          entrada.origen,
        ],
      },
    );
    await this.auditoria.registrar({
      accion: 'marcar_agotado',
      entidad: 'producto',
      entidadId: producto,
      sucursalId: sucursal,
      detalle: {
        antes: vigente ? paraAuditoria({ ...actual, diaOperativo: actual.dia_operativo }) : null,
        despues: paraAuditoria({ diaOperativo: dia, hasta: entrada.hasta, origen: entrada.origen }),
      },
    });
    this.eventos.disponibilidad({
      sucursalId: sucursal,
      productoId: producto,
      agotado: true,
      hasta: entrada.hasta,
      origen: entrada.origen,
    });
    return {
      productoId: producto,
      sucursalId: sucursal,
      desde: aIso(ahora),
      hasta: entrada.hasta,
      diaOperativo: dia,
      origen: entrada.origen,
    };
  }

  /**
   * Criterio 41: reactiva el producto en la sucursal. Si había un agotado vigente, borra la fila, audita y
   * publica; si no lo había, o ya había vencido, borra la fila vencida (si existe) sin auditar ni publicar.
   */
  async reactivar(entrada: ReactivarEntrada): Promise<void> {
    const { sucursal, producto, dia } = await this.preparar(entrada.sucursalId, entrada.productoId);
    const actual = await this.leerBloqueado(producto, sucursal);
    if (actual === undefined) return;
    await this.conexion.query('DELETE FROM producto_agotado WHERE id = $1', {
      bind: [actual.id],
    });
    if (!agotadoVigente({ diaOperativo: actual.dia_operativo, hasta: actual.hasta }, dia)) return;
    await this.auditoria.registrar({
      accion: 'reactivar_agotado',
      entidad: 'producto',
      entidadId: producto,
      sucursalId: sucursal,
      detalle: {
        antes: paraAuditoria({ ...actual, diaOperativo: actual.dia_operativo }),
        despues: null,
      },
    });
    this.eventos.disponibilidad({
      sucursalId: sucursal,
      productoId: producto,
      agotado: false,
      hasta: null,
      origen: null,
    });
  }

  /**
   * Las sucursales donde el producto tiene hoy un agotado vigente (criterio 18: `agotado` de cada sucursal en
   * los ajustes del producto). Una consulta de agotados y una hora de corte por cada sucursal con fila.
   */
  async sucursalesAgotadas(productoId: string): Promise<ReadonlySet<string>> {
    const filas = await this.conexion.query<{
      sucursal_id: string;
      dia_operativo: string;
      hasta: HastaAgotado;
    }>(
      `SELECT sucursal_id, dia_operativo::text AS dia_operativo, hasta
         FROM producto_agotado WHERE producto_id = $1`,
      { bind: [productoId], type: QueryTypes.SELECT },
    );
    const agotadas = new Set<string>();
    for (const fila of filas) {
      const horaCorte = await this.sucursales.horaCorte(fila.sucursal_id);
      if (horaCorte === null) continue;
      const dia = diaOperativo(this.reloj.ahora(), horaCorte);
      if (agotadoVigente({ diaOperativo: fila.dia_operativo, hasta: fila.hasta }, dia)) {
        agotadas.add(fila.sucursal_id);
      }
    }
    return agotadas;
  }
}

function aRespuesta(producto: string, sucursal: string, fila: FilaAgotado): AgotadoRespuesta {
  return {
    productoId: producto,
    sucursalId: sucursal,
    desde: aIso(fila.desde),
    hasta: fila.hasta,
    diaOperativo: fila.dia_operativo,
    origen: fila.origen,
  };
}
