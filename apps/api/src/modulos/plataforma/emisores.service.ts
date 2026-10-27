import { Inject, Injectable } from '@nestjs/common';
import type { EmisorCrearEntrada, EmisorRespuesta } from '@restaurante/contratos';
import { SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { MODELOS_API, type EmisorModelo, type Modelos } from './modelos';

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
 * Emisores de la empresa del contexto activo (RF-01). Debe llamarse dentro de `ContextoEmpresa.ejecutar`:
 * los modelos son los de la conexión de la API, así que con contexto la RLS limita todo a la propia empresa.
 */
@Injectable()
export class EmisoresService {
  constructor(
    @Inject(MODELOS_API) private readonly modelos: Modelos,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
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
}
