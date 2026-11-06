import { Inject, Injectable } from '@nestjs/common';
import type { PadronRucRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, sqlstateDe } from '../../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../../nucleo/errores/error-aplicacion';

/** SQLSTATE con que `padron_buscar_ruc` avisa que todavía no hay ninguna carga (migración `202611060004-padron`). */
const SQLSTATE_SIN_CARGA = 'RF503';

interface FilaPadron {
  ruc: string;
  razon_social: string;
  estado: string;
  condicion: string;
  direccion: string | null;
  cargado_en: Date | string;
}

/** 404 `RUC_NO_ENCONTRADO`: el RUC es válido pero el padrón no lo tiene (criterio 139). */
const rucNoEncontrado = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'RUC_NO_ENCONTRADO', 'Este RUC no figura en el padrón de SUNAT');

/** 503 `PADRON_NO_DISPONIBLE`: el padrón todavía no se ha cargado (criterio 139). */
const padronNoDisponible = (): ErrorAplicacion =>
  new ErrorAplicacion(503, 'PADRON_NO_DISPONIBLE', 'El padrón de RUC todavía no está disponible');

/**
 * La búsqueda de un RUC en el padrón (historia 006, entrega 6b, criterios 139 y 142): llama a
 * `public.padron_buscar_ruc(ruc)` (`SECURITY DEFINER`, `STABLE`) con la conexión de la API, dentro de la transacción de
 * la petición; la función no lee ni escribe tablas de clientes. Solo responde por un RUC exacto de 11 dígitos, no escribe
 * nada y no guarda quién consultó qué: la respuesta para un RUC es la misma desde cualquier empresa. 404
 * `RUC_NO_ENCONTRADO`; 503 `PADRON_NO_DISPONIBLE` sin ninguna carga.
 */
@Injectable()
export class PadronService {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  async buscar(ruc: string): Promise<PadronRucRespuesta> {
    let filas: FilaPadron[];
    try {
      filas = await this.conexion.query<FilaPadron>(
        'SELECT ruc, razon_social, estado, condicion, direccion, cargado_en FROM padron_buscar_ruc($1)',
        { bind: [ruc], type: QueryTypes.SELECT },
      );
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE_SIN_CARGA) throw padronNoDisponible();
      throw error;
    }
    const fila = filas[0];
    if (fila === undefined) throw rucNoEncontrado();
    return {
      ruc: fila.ruc.trim(),
      razonSocial: fila.razon_social,
      direccion: fila.direccion,
      estado: fila.estado,
      condicion: fila.condicion,
      activo: fila.estado === 'ACTIVO',
      habido: fila.condicion === 'HABIDO',
      padronAl: new Date(fila.cargado_en).toISOString(),
    };
  }
}
