import { Inject, Injectable } from '@nestjs/common';
import type {
  EstacionDestinoEntrada,
  EstacionDestinoRespuesta,
  ImpresionSucursalEntrada,
  ImpresionSucursalRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { CartaConsultaService } from '../carta';
import { SucursalesConsultaService } from '../plataforma';
import { impresoraInvalida, noEncontrado } from './errores-impresion';

interface FilaDestino {
  id: string;
  destino: 'KDS' | 'IMPRESORA';
  impresora_id: string | null;
}

/**
 * Destino de cada estación e impresora de caja de la sucursal (RF-19, segunda parte; criterios 99, 100 y 102). La
 * sucursal va en la ruta: una sucursal de otra empresa y una inexistente dan el mismo 404. Una estación sin fila
 * sale por el `KDS`; configurar el `KDS` en una estación sin fila no crea nada. Repetir una configuración no
 * cambia nada ni audita. La impresora elegida debe ser una impresora activa de la misma sucursal: la de otra
 * sucursal, la de otra empresa, la inactiva y la inexistente dan el mismo 422.
 */
@Injectable()
export class DestinosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(CartaConsultaService) private readonly carta: CartaConsultaService,
  ) {}

  /** Criterio 99: una fila por estación activa de la empresa, con su destino en esta sucursal. */
  async listar(sucursalId: string): Promise<EstacionDestinoRespuesta[]> {
    await this.exigirSucursal(sucursalId);
    const estaciones = await this.carta.estaciones();
    const filas = await this.conexion.query<{
      estacion_id: string;
      destino: 'KDS' | 'IMPRESORA';
      impresora_id: string | null;
      impresora_nombre: string | null;
    }>(
      `SELECT d.estacion_id, d.destino, d.impresora_id, i.nombre AS impresora_nombre
         FROM estacion_destino d
         LEFT JOIN impresora i ON i.id = d.impresora_id AND i.empresa_id = d.empresa_id
        WHERE d.sucursal_id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const porEstacion = new Map(filas.map((f) => [f.estacion_id, f]));
    return estaciones.map((e) => {
      const f = porEstacion.get(e.id);
      const impresora =
        f?.destino === 'IMPRESORA' && f.impresora_id !== null
          ? { id: f.impresora_id, nombre: f.impresora_nombre ?? '' }
          : null;
      return {
        estacionId: e.id,
        nombre: e.nombre,
        destino: impresora === null ? ('KDS' as const) : ('IMPRESORA' as const),
        impresora,
      };
    });
  }

  /**
   * Criterio 100: `KDS` o `IMPRESORA` con una impresora activa de la sucursal (422 `REFERENCIA_INVALIDA`). Una
   * estación inactiva, de otra empresa o inexistente es 404. Responde la fila de la estación.
   */
  async configurar(
    sucursalId: string,
    estacionId: string,
    entrada: EstacionDestinoEntrada,
  ): Promise<EstacionDestinoRespuesta> {
    await this.exigirSucursal(sucursalId);
    const estaciones = await this.carta.estaciones();
    if (!estaciones.some((e) => e.id === estacionId)) throw noEncontrado('La estación');

    const impresoraId = entrada.destino === 'IMPRESORA' ? entrada.impresoraId.toLowerCase() : null;
    // La impresora se lee con FOR SHARE: desactivarla (FOR UPDATE) espera a que este cambio termine y, si ya la
    // desactivaron, esta lectura no la encuentra (criterio 104).
    if (impresoraId !== null) await this.exigirImpresoraActiva(sucursalId, impresoraId);

    const seleccionar = () =>
      this.conexion.query<FilaDestino>(
        `SELECT id, destino, impresora_id FROM estacion_destino
          WHERE sucursal_id = $1 AND estacion_id = $2 FOR UPDATE`,
        { bind: [sucursalId, estacionId], type: QueryTypes.SELECT },
      );
    let actual = (await seleccionar())[0];
    const ahora = this.reloj.ahora();
    let id = actual?.id;
    let cambio = false;
    // Sin fila, el destino es KDS: configurar KDS no crea nada.
    if (actual === undefined && impresoraId !== null) {
      const creada = await this.conexion.query<{ id: string }>(
        `INSERT INTO estacion_destino (empresa_id, sucursal_id, estacion_id, destino, impresora_id,
                                       creado_en, actualizado_en)
         VALUES ($1, $2, $3, 'IMPRESORA', $4, $5, $5)
         ON CONFLICT (empresa_id, sucursal_id, estacion_id) DO NOTHING
         RETURNING id`,
        {
          bind: [this.contexto.empresaActual(), sucursalId, estacionId, impresoraId, ahora],
          type: QueryTypes.SELECT,
        },
      );
      if (creada[0] !== undefined) {
        id = creada[0].id;
        cambio = true;
      } else {
        // Otra petición creó la fila a la vez: ahora esta la bloquea y se trata como una existente.
        actual = (await seleccionar())[0];
        id = actual?.id;
      }
    }
    const antes = { destino: actual?.destino ?? 'KDS', impresoraId: actual?.impresora_id ?? null };
    if (
      !cambio &&
      actual !== undefined &&
      (actual.destino !== entrada.destino || actual.impresora_id !== impresoraId)
    ) {
      await this.conexion.query(
        'UPDATE estacion_destino SET destino = $2, impresora_id = $3, actualizado_en = $4 WHERE id = $1',
        { bind: [actual.id, entrada.destino, impresoraId, ahora] },
      );
      cambio = true;
    }
    if (cambio && id !== undefined) {
      await this.auditoria.registrar({
        accion: 'configurar_destino_estacion',
        sucursalId,
        entidad: 'estacion_destino',
        entidadId: id,
        detalle: {
          sucursalId,
          estacionId,
          antes,
          despues: { destino: entrada.destino, impresoraId },
        },
      });
    }
    return this.vista(sucursalId, estacionId);
  }

  /** Criterio 102: la impresora de caja de la sucursal, o `null` si no tiene. */
  async verImpresion(sucursalId: string): Promise<ImpresionSucursalRespuesta> {
    await this.exigirSucursal(sucursalId);
    const filas = await this.conexion.query<{ impresora_caja_id: string | null }>(
      'SELECT impresora_caja_id FROM impresion_sucursal WHERE sucursal_id = $1',
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return { impresoraCajaId: filas[0]?.impresora_caja_id ?? null };
  }

  /** Criterio 102: elige (o quita con `null`) la impresora de caja; debe ser una impresora activa de la sucursal. */
  async configurarImpresion(
    sucursalId: string,
    entrada: ImpresionSucursalEntrada,
  ): Promise<ImpresionSucursalRespuesta> {
    await this.exigirSucursal(sucursalId);
    const nueva = entrada.impresoraCajaId === null ? null : entrada.impresoraCajaId.toLowerCase();
    if (nueva !== null) await this.exigirImpresoraActiva(sucursalId, nueva);

    const seleccionar = () =>
      this.conexion.query<{ id: string; impresora_caja_id: string | null }>(
        `SELECT id, impresora_caja_id FROM impresion_sucursal WHERE sucursal_id = $1 FOR UPDATE`,
        { bind: [sucursalId], type: QueryTypes.SELECT },
      );
    let actual = (await seleccionar())[0];
    const antes = actual?.impresora_caja_id ?? null;
    const ahora = this.reloj.ahora();
    let id = actual?.id;
    let cambio = false;

    if (actual === undefined && nueva !== null) {
      const creada = await this.conexion.query<{ id: string }>(
        `INSERT INTO impresion_sucursal (empresa_id, sucursal_id, impresora_caja_id, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (empresa_id, sucursal_id) DO NOTHING
         RETURNING id`,
        {
          bind: [this.contexto.empresaActual(), sucursalId, nueva, ahora],
          type: QueryTypes.SELECT,
        },
      );
      if (creada[0] !== undefined) {
        id = creada[0].id;
        cambio = true;
      } else {
        actual = (await seleccionar())[0];
        id = actual?.id;
      }
    }
    if (!cambio && actual !== undefined && actual.impresora_caja_id !== nueva) {
      await this.conexion.query(
        'UPDATE impresion_sucursal SET impresora_caja_id = $2, actualizado_en = $3 WHERE id = $1',
        { bind: [actual.id, nueva, ahora] },
      );
      cambio = true;
    }
    if (cambio) {
      await this.auditoria.registrar({
        accion: 'configurar_impresion_sucursal',
        sucursalId,
        entidad: 'impresion_sucursal',
        ...(id === undefined ? {} : { entidadId: id }),
        detalle: {
          sucursalId,
          impresoraCajaId: { antes, despues: nueva },
        },
      });
    }
    return this.verImpresion(sucursalId);
  }

  private async vista(sucursalId: string, estacionId: string): Promise<EstacionDestinoRespuesta> {
    const fila = (await this.listar(sucursalId)).find((e) => e.estacionId === estacionId);
    if (fila === undefined) throw noEncontrado('La estación');
    return fila;
  }

  /** 422 si la impresora no es una impresora activa de la sucursal; la deja leída con `FOR SHARE`. */
  private async exigirImpresoraActiva(sucursalId: string, impresoraId: string): Promise<void> {
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT id FROM impresora WHERE id = $1 AND sucursal_id = $2 AND activa FOR SHARE`,
      { bind: [impresoraId, sucursalId], type: QueryTypes.SELECT },
    );
    if (filas.length === 0) throw impresoraInvalida();
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw noEncontrado('La sucursal');
  }
}
