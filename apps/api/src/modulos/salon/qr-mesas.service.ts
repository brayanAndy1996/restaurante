import { Inject, Injectable } from '@nestjs/common';
import type { QrMesaRespuesta, QrMesasRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { AuditoriaService } from '../auditoria';
import { CartaWebConsultaService } from '../carta-web';
import { SucursalesConsultaService } from '../plataforma';
import { CodigosMesaService } from './codigos-mesa.service';
import { conflicto, noEncontrado } from './errores-salon';

/**
 * Hoja de QR de las mesas (historia 005, criterios 7 a 9): lista las mesas con su código y su enlace, crea los
 * códigos que faltan (las mesas anteriores a la sección) y cambia el QR de una mesa. La sucursal va en la ruta:
 * una sucursal de otra empresa y una inexistente dan el mismo 404, y una mesa de otra sucursal se trata como
 * inexistente. Sin `CARTA_WEB_URL` no hay enlace que imprimir: 503 `CONFIGURACION_INCOMPLETA` antes de escribir.
 * Cada acción que cambia algo deja su fila de auditoría (sin los códigos); las réplicas y lo que no cambia, ninguna.
 */
@Injectable()
export class QrMesasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(CodigosMesaService) private readonly codigos: CodigosMesaService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(CartaWebConsultaService) private readonly cartaWeb: CartaWebConsultaService,
  ) {}

  /** `GET /sucursales/:sucursalId/qr-mesas` (criterio 7). */
  async listar(sucursalId: string): Promise<QrMesasRespuesta> {
    const sucursal = await this.exigirSucursal(sucursalId);
    const base = this.exigirUrl();
    return this.armarHoja(sucursal, base);
  }

  /** `POST /sucursales/:sucursalId/qr-mesas` (criterio 8): crea los códigos que faltan y deja `generar_qr_mesas`. */
  async crearFaltantes(sucursalId: string): Promise<QrMesasRespuesta> {
    const sucursal = await this.exigirSucursal(sucursalId);
    const base = this.exigirUrl();
    const creados = await this.codigos.crearFaltantes(sucursalId);
    if (creados > 0) {
      await this.auditoria.registrar({
        accion: 'generar_qr_mesas',
        sucursalId,
        entidad: 'mesa_qr',
        detalle: { sucursalId, creados },
      });
    }
    return this.armarHoja(sucursal, base);
  }

  /** `POST /sucursales/:sucursalId/mesas/:mesaId/qr` (criterio 9): un código nuevo; el anterior deja de funcionar. */
  async cambiar(sucursalId: string, mesaId: string): Promise<QrMesaRespuesta> {
    // Una sucursal ajena o inexistente y una mesa ajena o inexistente dan el mismo 404, con el mismo mensaje
    // (criterio 66): no se puede saber cuál de las dos falló.
    try {
      await this.exigirSucursal(sucursalId);
    } catch (error) {
      if (error instanceof ErrorAplicacion && error.getStatus() === 404) {
        throw noEncontrado('La mesa');
      }
      throw error;
    }
    const base = this.exigirUrl();
    const mesas = await this.conexion.query<{ nombre: string; activa: boolean }>(
      'SELECT nombre, activa FROM mesa WHERE id = $1 AND sucursal_id = $2',
      { bind: [mesaId, sucursalId], type: QueryTypes.SELECT },
    );
    const mesa = mesas[0];
    if (mesa === undefined) throw noEncontrado('La mesa');
    if (!mesa.activa) {
      throw conflicto('La mesa está desactivada; actívala antes de cambiar su QR', [
        { campo: 'mesaId', mensaje: 'La mesa está desactivada' },
      ]);
    }
    const nuevo = await this.codigos.cambiar(mesaId);
    // Sin los códigos: la auditoría no guarda lo que da acceso a la mesa.
    await this.auditoria.registrar({
      accion: 'cambiar_qr_mesa',
      sucursalId,
      entidad: 'mesa_qr',
      entidadId: nuevo.id,
      detalle: { sucursalId, mesaId, mesa: mesa.nombre },
    });
    return {
      mesaId,
      codigo: nuevo.codigo,
      url: `${base}/m/${nuevo.codigo}`,
      generadoEn: nuevo.generadoEn.toISOString(),
    };
  }

  private async armarHoja(
    sucursal: { id: string; nombre: string },
    base: string,
  ): Promise<QrMesasRespuesta> {
    const mesas = await this.codigos.listarDeSucursal(sucursal.id);
    const publicada = await this.cartaWeb.sucursalPublicada(sucursal.id);
    return {
      sucursal: { id: sucursal.id, nombre: sucursal.nombre },
      cartaPublicada: publicada !== null,
      mesas: mesas.map((m) => ({
        mesaId: m.mesaId,
        zona: m.zona,
        nombre: m.nombre,
        codigo: m.codigo,
        url: m.codigo === null ? null : `${base}/m/${m.codigo}`,
        generadoEn: m.generadoEn === null ? null : m.generadoEn.toISOString(),
      })),
    };
  }

  /** La sucursal de la empresa del contexto; 404 si no existe o es de otra empresa (el mismo cuerpo). */
  private async exigirSucursal(sucursalId: string): Promise<{ id: string; nombre: string }> {
    const [sucursal] = await this.sucursales.listar([sucursalId]);
    if (sucursal === undefined) throw noEncontrado('La sucursal');
    return sucursal;
  }

  private exigirUrl(): string {
    const base = this.entorno.CARTA_WEB_URL;
    if (base === undefined) {
      throw new ErrorAplicacion(
        503,
        'CONFIGURACION_INCOMPLETA',
        'El servidor no tiene configurada la dirección de la carta web, así que no se pueden armar los QR. Avisa a soporte.',
      );
    }
    return base;
  }
}
