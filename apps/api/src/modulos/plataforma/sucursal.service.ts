import { Inject, Injectable } from '@nestjs/common';
import type {
  SucursalConfigurarEntrada,
  SucursalCrearEntrada,
  SucursalRespuesta,
} from '@restaurante/contratos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { MODELOS_API, type Modelos, type SucursalModelo } from './modelos';
import type { SucursalAtributos } from './modelos/definir-modelos';

const MENSAJE_EMISOR_INVALIDO = 'El emisor no existe en la empresa';

/** Mensaje del 409 por una sucursal repetida (nombre o código de establecimiento del emisor). */
function mensajeDeUnicidad(error: unknown): string {
  return restriccionDe(error) === 'sucursal_empresa_nombre_unico'
    ? 'Ya existe una sucursal de la empresa con ese nombre'
    : 'Ya existe una sucursal de ese emisor con el mismo código de establecimiento';
}

/** Fila de la tabla a la forma de `sucursalRespuesta` (hora de corte `HH:MM`, fechas ISO 8601). */
export function sucursalARespuesta(sucursal: SucursalModelo): SucursalRespuesta {
  return {
    id: sucursal.id,
    empresaId: sucursal.empresaId,
    emisorId: sucursal.emisorId,
    nombre: sucursal.nombre,
    codigoEstablecimiento: sucursal.codigoEstablecimiento,
    direccion: sucursal.direccion,
    horario: sucursal.horario,
    whatsapp: sucursal.whatsapp,
    horaCorte: sucursal.horaCorte.slice(0, 5),
    creadoEn: sucursal.creadoEn.toISOString(),
    actualizadoEn: sucursal.actualizadoEn.toISOString(),
  };
}

/**
 * Sucursales de la empresa del contexto activo (RF-02). Debe llamarse dentro de
 * `ContextoEmpresa.ejecutar`: los modelos son los de la conexión de la API, así que sin contexto
 * lanzan `ContextoEmpresaAusenteError`, y con contexto la RLS limita todo a la propia empresa.
 */
@Injectable()
export class SucursalService {
  constructor(
    @Inject(MODELOS_API) private readonly modelos: Modelos,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
  ) {}

  async listar(): Promise<SucursalRespuesta[]> {
    const filas = await this.modelos.Sucursal.findAll({ order: [['nombre', 'ASC']] });
    return filas.map(sucursalARespuesta);
  }

  /** `null` si no existe o es de otra empresa (se tratan igual: la RLS no deja ver la ajena). */
  async obtener(id: string): Promise<SucursalRespuesta | null> {
    const fila = await this.modelos.Sucursal.findByPk(id);
    return fila ? sucursalARespuesta(fila) : null;
  }

  /**
   * Crea una sucursal en la empresa del contexto (`POST /sucursales`, criterio 70). El emisor se busca
   * por RUC entre los de la empresa: uno ajeno o inexistente es 422 `EMISOR_INVALIDO` (idéntico), y un
   * código de establecimiento o un nombre repetidos, 409 `CONFLICTO`. La suscripción de la sucursal
   * (plan por defecto y vencimiento el día del alta) llega con el grupo C1.
   */
  async crear(entrada: SucursalCrearEntrada): Promise<SucursalRespuesta> {
    const { Sucursal, Emisor } = this.modelos;
    const emisor = await Emisor.findOne({ where: { ruc: entrada.rucEmisor } });
    if (!emisor) throw new ErrorAplicacion(422, 'EMISOR_INVALIDO', MENSAJE_EMISOR_INVALIDO);
    try {
      const creada = await Sucursal.create({
        empresaId: this.contexto.empresaActual(),
        emisorId: emisor.id,
        nombre: entrada.nombre,
        codigoEstablecimiento: entrada.codigoEstablecimiento,
        direccion: entrada.direccion,
        horario: entrada.horario ?? [],
        whatsapp: entrada.whatsapp ?? null,
        horaCorte: entrada.horaCorte ?? '05:00',
      });
      return sucursalARespuesta(creada);
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
        throw new ErrorAplicacion(409, 'CONFLICTO', mensajeDeUnicidad(error));
      }
      throw error;
    }
  }

  /**
   * Aplica cambios absolutos (idempotente). Errores: 404 si no existe o es ajena; 422
   * `EMISOR_INVALIDO` si el emisor no se ve en la empresa (se comprueba antes de actualizar, así
   * nunca se revela nada del emisor de otra empresa); 409 `CONFLICTO` por código o nombre repetidos.
   */
  async configurar(id: string, cambios: SucursalConfigurarEntrada): Promise<SucursalRespuesta> {
    const { Sucursal, Emisor } = this.modelos;
    const existente = await Sucursal.findByPk(id);
    if (!existente) throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');

    if (cambios.emisorId !== undefined) {
      const emisor = await Emisor.findByPk(cambios.emisorId);
      if (!emisor) throw new ErrorAplicacion(422, 'EMISOR_INVALIDO', MENSAJE_EMISOR_INVALIDO);
    }

    const valores: Partial<SucursalAtributos> = {};
    if (cambios.emisorId !== undefined) valores.emisorId = cambios.emisorId;
    if (cambios.nombre !== undefined) valores.nombre = cambios.nombre;
    if (cambios.codigoEstablecimiento !== undefined) {
      valores.codigoEstablecimiento = cambios.codigoEstablecimiento;
    }
    if (cambios.direccion !== undefined) valores.direccion = cambios.direccion;
    if (cambios.horario !== undefined) valores.horario = cambios.horario;
    if (cambios.whatsapp !== undefined) valores.whatsapp = cambios.whatsapp;
    if (cambios.horaCorte !== undefined) valores.horaCorte = cambios.horaCorte;

    try {
      // `Model.update` siempre toca `actualizado_en`, aunque los valores sean los mismos.
      const [, filas] = await Sucursal.update(valores, { where: { id }, returning: true });
      const actualizada = filas[0];
      if (!actualizada) throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
      return sucursalARespuesta(actualizada);
    } catch (error) {
      if (error instanceof ErrorAplicacion) throw error;
      const estado = sqlstateDe(error);
      if (estado === SQLSTATE.VIOLACION_UNICIDAD) {
        throw new ErrorAplicacion(409, 'CONFLICTO', mensajeDeUnicidad(error));
      }
      if (estado === SQLSTATE.VIOLACION_LLAVE_FORANEA) {
        throw new ErrorAplicacion(422, 'EMISOR_INVALIDO', MENSAJE_EMISOR_INVALIDO);
      }
      throw error;
    }
  }
}
