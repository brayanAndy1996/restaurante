import { Inject, Injectable } from '@nestjs/common';
import type {
  EmisorCrearEntrada,
  EmisorRespuesta,
  TasaIgvEntrada,
  TasaIgvRespuesta,
} from '@restaurante/contratos';
import type { RegimenTributario } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { MODELOS_API, type EmisorModelo, type Modelos } from './modelos';
import { UltimaEmisionDeEmisor } from './ultima-emision';

/** Fila de la tabla a la forma de `emisorRespuesta` (fechas ISO 8601). */
export function emisorARespuesta(emisor: EmisorModelo): EmisorRespuesta {
  return {
    id: emisor.id,
    empresaId: emisor.empresaId,
    ruc: emisor.ruc,
    razonSocial: emisor.razonSocial,
    regimen: emisor.regimen,
    creadoEn: emisor.creadoEn.toISOString(),
    actualizadoEn: emisor.actualizadoEn.toISOString(),
  };
}

/**
 * Lo que un comprobante guarda del emisor y de la sucursal al emitirse (historia 006, criterio 69): la sucursal con
 * su código de establecimiento y el emisor con su RUC, razón social y régimen.
 */
export interface DatosParaComprobante {
  sucursal: { id: string; nombre: string; direccion: string; codigoEstablecimiento: string };
  emisor: { id: string; ruc: string; razonSocial: string; regimen: RegimenTributario };
}

/**
 * Emisores de la empresa del contexto activo (RF-01). Debe llamarse dentro de `ContextoEmpresa.ejecutar`:
 * los modelos son los de la conexión de la API, así que con contexto la RLS limita todo a la propia empresa.
 */
@Injectable()
export class EmisoresService {
  constructor(
    @Inject(MODELOS_API) private readonly modelos: Modelos,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(UltimaEmisionDeEmisor) private readonly ultimaEmision: UltimaEmisionDeEmisor,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  async listar(): Promise<EmisorRespuesta[]> {
    const filas = await this.modelos.Emisor.findAll({
      order: [
        ['razonSocial', 'ASC'],
        ['ruc', 'ASC'],
      ],
    });
    return filas.map(emisorARespuesta);
  }

  /** `POST /emisores`: un RUC ya registrado (en cualquier empresa) responde 400 `DATOS_INVALIDOS` con el campo. */
  async crear(entrada: EmisorCrearEntrada): Promise<EmisorRespuesta> {
    try {
      const creado = await this.modelos.Emisor.create({
        empresaId: this.contexto.empresaActual(),
        ruc: entrada.ruc,
        razonSocial: entrada.razonSocial,
        regimen: entrada.regimen,
      });
      return emisorARespuesta(creado);
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
        throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'El RUC ya está registrado', [
          { campo: 'ruc', mensaje: 'El RUC ya está registrado' },
        ]);
      }
      throw error;
    }
  }

  /**
   * Las tasas de IGV del emisor en orden de `desde` (historia 006, criterio 6). 404 si el emisor no es de la empresa
   * (uno de otra empresa es indistinguible de uno inexistente).
   */
  async tasasIgv(emisorId: string): Promise<TasaIgvRespuesta[]> {
    await this.exigirEmisor(emisorId);
    return this.leerTasas(emisorId);
  }

  /**
   * Las tasas del emisor para emitir un comprobante con la vigente (cobro y venta de mostrador). Toma la fila del
   * emisor con `FOR SHARE` hasta el final de la transacción: choca con el `FOR NO KEY UPDATE` de
   * `configurarTasaIgv`, de modo que "leer la tasa vigente" y "cambiar la tasa" se turnan (nunca dos tasas para la
   * misma fecha de emisión), pero dos cobros del mismo emisor no se esperan entre sí. Va después de los bloqueos de la
   * orden y del turno y antes del de la serie (el orden fijo del plan).
   */
  async tasasIgvParaEmitir(emisorId: string): Promise<TasaIgvRespuesta[]> {
    await this.exigirEmisor(emisorId, 'compartido');
    return this.leerTasas(emisorId);
  }

  /**
   * Crea o cambia la tasa de IGV del emisor desde una fecha (criterio 6). Repetir el mismo valor responde 200 sin
   * auditoría. No se puede crear ni cambiar una tasa con `desde` igual o anterior a la fecha de Lima del último
   * comprobante emitido por el emisor (409 `CONFLICTO`: las ventas pasadas no se recalculan); esa fecha la da el puerto
   * `UltimaEmisionDeEmisor` que registra facturación y, sin registro, se rechaza (falla cerrado). La fila del emisor se
   * toma con `FOR NO KEY UPDATE`: dos cambios del mismo emisor se turnan y esperan a los cobros en curso del emisor,
   * que leen la tasa con `FOR SHARE` (`tasasIgvParaEmitir`) y la sueltan al confirmar; así la última fecha de emisión
   * que se comprueba abajo ya incluye a esos cobros (409 si es de la fecha o posterior).
   */
  async configurarTasaIgv(
    emisorId: string,
    desde: string,
    entrada: TasaIgvEntrada,
  ): Promise<TasaIgvRespuesta> {
    await this.exigirEmisor(emisorId, true);
    const actuales = await this.conexion.query<{ id: string; tasa: string }>(
      `SELECT id, tasa::text AS tasa FROM emisor_tasa_igv WHERE emisor_id = $1 AND desde = $2::date`,
      { bind: [emisorId, desde], type: QueryTypes.SELECT },
    );
    const actual = actuales[0];
    if (actual !== undefined && Number(actual.tasa) === Number(entrada.tasa)) {
      return { desde, tasa: actual.tasa };
    }
    const ultima = await this.ultimaEmision.fecha(emisorId);
    if (ultima !== null && desde <= ultima) {
      throw new ErrorAplicacion(
        409,
        'CONFLICTO',
        `El emisor ya emitió comprobantes hasta el ${ultima}: no se puede crear ni cambiar una tasa desde esa fecha o una anterior`,
        [{ campo: 'desde', mensaje: 'Debe ser posterior al último comprobante emitido' }],
      );
    }
    const guardadas = await this.conexion.query<{ id: string; tasa: string }>(
      actual === undefined
        ? `INSERT INTO emisor_tasa_igv (empresa_id, emisor_id, desde, tasa, creado_en, actualizado_en)
           VALUES ($1, $2, $3::date, $4::numeric, $5, $5) RETURNING id, tasa::text AS tasa`
        : `UPDATE emisor_tasa_igv SET tasa = $4::numeric, actualizado_en = $5
            WHERE emisor_id = $2 AND desde = $3::date AND empresa_id = $1 RETURNING id, tasa::text AS tasa`,
      {
        bind: [this.contexto.empresaActual(), emisorId, desde, entrada.tasa, this.reloj.ahora()],
        type: QueryTypes.SELECT,
      },
    );
    const guardada = guardadas[0]!;
    await this.auditoria.registrar({
      accion: 'configurar_tasa_igv',
      entidad: 'emisor_tasa_igv',
      entidadId: guardada.id,
      detalle: {
        emisorId,
        desde,
        antes: actual?.tasa ?? null,
        despues: guardada.tasa,
      },
    });
    return { desde, tasa: guardada.tasa };
  }

  /**
   * El emisor y la sucursal tal como se guardan en el comprobante (criterio 69). Lo usa el cobro (módulo de caja) y
   * la emisión. 404 si la sucursal no es de la empresa.
   */
  async datosParaComprobante(sucursalId: string): Promise<DatosParaComprobante> {
    const filas = await this.conexion.query<{
      sucursal_id: string;
      nombre: string;
      direccion: string;
      codigo_establecimiento: string;
      emisor_id: string;
      ruc: string;
      razon_social: string;
      regimen: RegimenTributario;
    }>(
      `SELECT s.id AS sucursal_id, s.nombre, s.direccion, s.codigo_establecimiento::text AS codigo_establecimiento,
              e.id AS emisor_id, e.ruc::text AS ruc, e.razon_social, e.regimen
         FROM sucursal s
         JOIN emisor e ON e.id = s.emisor_id AND e.empresa_id = s.empresa_id
        WHERE s.id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined)
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
    return {
      sucursal: {
        id: fila.sucursal_id,
        nombre: fila.nombre,
        direccion: fila.direccion,
        codigoEstablecimiento: fila.codigo_establecimiento,
      },
      emisor: {
        id: fila.emisor_id,
        ruc: fila.ruc,
        razonSocial: fila.razon_social,
        regimen: fila.regimen,
      },
    };
  }

  private async leerTasas(emisorId: string): Promise<TasaIgvRespuesta[]> {
    return this.conexion.query<TasaIgvRespuesta>(
      `SELECT to_char(desde, 'YYYY-MM-DD') AS desde, tasa::text AS tasa
         FROM emisor_tasa_igv WHERE emisor_id = $1 ORDER BY desde`,
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
  }

  private async exigirEmisor(
    emisorId: string,
    bloquear: boolean | 'compartido' = false,
  ): Promise<void> {
    const cerrojo = bloquear === 'compartido' ? ' FOR SHARE' : bloquear ? ' FOR NO KEY UPDATE' : '';
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT id FROM emisor WHERE id = $1${cerrojo}`,
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
    if (filas.length === 0) throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El emisor no existe');
  }
}
