import { Inject, Injectable } from '@nestjs/common';
import type { AjusteSucursalEntrada, AjusteSucursalRespuesta } from '@restaurante/contratos';
import { precioEfectivo } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import { datosInvalidos, noEncontrado } from './errores-carta';
import { EventosCarta } from './eventos-carta';
import { PermisosCarta } from './permisos-carta';
import { diferencias } from './util-carta';

interface FilaProductoAjustable {
  precio: string | null;
  se_vende_solo: boolean;
}

interface FilaAjuste extends Record<string, unknown> {
  precio: string | null;
  disponible: boolean;
}

/** Lo que vale una sucursal sin fila guardada (criterio 23). */
const POR_DEFECTO: FilaAjuste = { precio: null, disponible: true };

/**
 * Precio y disponibilidad de un producto por sucursal (HU-06, RF-15, criterios 18 a 23 y 19b).
 * `producto_sucursal` guarda solo lo que difiere: sin fila valen el precio de la empresa y "disponible". El
 * `PUT` hace un `INSERT … ON CONFLICT DO UPDATE` y, si el resultado es el valor por defecto, deja la fila
 * como está (no la borra, para no perder el último autor). Corre dentro de la transacción de la petición.
 */
@Injectable()
export class AjustesSucursalService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(PermisosCarta) private readonly permisos: PermisosCarta,
  ) {}

  /**
   * Criterio 18: una fila por cada sucursal de la empresa, ordenadas por nombre. `editable` dice si quien
   * consulta puede ajustar esa sucursal (criterio 19b). Un producto de otra empresa responde 404 igual que uno
   * inexistente.
   */
  async listar(productoId: string): Promise<AjusteSucursalRespuesta[]> {
    const producto = await this.leerProducto(productoId, false);
    const sucursales = await this.sucursales.listar(null);
    const ajustes = await this.conexion.query<FilaAjuste & { sucursal_id: string }>(
      'SELECT sucursal_id, precio, disponible FROM producto_sucursal WHERE producto_id = $1',
      { bind: [productoId], type: QueryTypes.SELECT },
    );
    const porSucursal = new Map(ajustes.map((a) => [a.sucursal_id, a]));
    const ajustables = await this.permisos.sucursalesAjustables();
    return sucursales.map((s) =>
      this.aRespuesta(
        producto,
        s,
        porSucursal.get(s.id) ?? POR_DEFECTO,
        ajustables === 'todas' || ajustables.has(s.id.toLowerCase()),
      ),
    );
  }

  /**
   * Criterios 19 y 19b. Orden de los rechazos: 400 de forma (el esquema), 404 del producto y de la sucursal
   * (una sucursal de otra empresa responde igual que una inexistente, antes de mirar el rol), 403 si quien
   * pide no puede ajustar esa sucursal y 400 si el producto no se vende solo y trae precio. Repetir el mismo
   * ajuste responde 200 sin auditoría ni evento.
   */
  async ajustar(
    productoId: string,
    sucursalId: string,
    entrada: AjusteSucursalEntrada,
  ): Promise<AjusteSucursalRespuesta> {
    // `FOR NO KEY UPDATE`: serializa los ajustes del mismo producto (el antes de la auditoría es exacto) y se
    // serializa con un `PATCH` del producto (que lo bloquea `FOR UPDATE`) sin bloquear las llaves foráneas.
    const producto = await this.leerProducto(productoId, true);
    const sucursal = (await this.sucursales.listar([sucursalId]))[0];
    if (sucursal === undefined) throw noEncontrado('La sucursal');
    await this.permisos.exigirAjustarSucursal(sucursal.id);

    if (!producto.se_vende_solo && entrada.precio !== null) {
      throw datosInvalidos([
        {
          campo: 'precio',
          mensaje: 'Un producto que no se vende solo no lleva precio por sucursal',
        },
      ]);
    }

    const despues: FilaAjuste = {
      precio: entrada.precio === null ? null : precioEfectivo(entrada.precio, null),
      disponible: entrada.disponible,
    };
    const guardado = (
      await this.conexion.query<FilaAjuste>(
        `SELECT precio, disponible FROM producto_sucursal
          WHERE producto_id = $1 AND sucursal_id = $2 FOR UPDATE`,
        { bind: [productoId, sucursal.id], type: QueryTypes.SELECT },
      )
    )[0];
    const antes = guardado ?? POR_DEFECTO;
    const cambios = diferencias(antes, despues, ['precio', 'disponible']);
    if (Object.keys(cambios).length > 0) {
      await this.conexion.query(
        `INSERT INTO producto_sucursal (empresa_id, producto_id, sucursal_id, precio, disponible,
                                        creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (producto_id, sucursal_id)
         DO UPDATE SET precio = EXCLUDED.precio, disponible = EXCLUDED.disponible,
                       actualizado_en = EXCLUDED.actualizado_en`,
        {
          bind: [
            this.contexto.empresaActual(),
            productoId,
            sucursal.id,
            despues.precio,
            despues.disponible,
            this.reloj.ahora(),
          ],
        },
      );
      await this.auditoria.registrar({
        accion: 'ajustar_producto_sucursal',
        entidad: 'producto',
        entidadId: productoId,
        sucursalId: sucursal.id,
        detalle: cambios,
      });
      this.eventos.cartaActualizada(sucursal.id);
    }
    // Si llegó hasta aquí, puede ajustar esa sucursal.
    return this.aRespuesta(producto, sucursal, despues, true);
  }

  // ---- Apoyo -----------------------------------------------------------------------------------

  /** El producto de la empresa (404 si no existe o es de otra empresa), con o sin bloqueo. */
  private async leerProducto(
    productoId: string,
    bloquear: boolean,
  ): Promise<FilaProductoAjustable> {
    const filas = await this.conexion.query<FilaProductoAjustable>(
      `SELECT precio, se_vende_solo FROM producto WHERE id = $1${bloquear ? ' FOR NO KEY UPDATE' : ''}`,
      { bind: [productoId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw noEncontrado('El producto');
    return filas[0];
  }

  private aRespuesta(
    producto: FilaProductoAjustable,
    sucursal: { id: string; nombre: string },
    ajuste: FilaAjuste,
    editable: boolean,
  ): AjusteSucursalRespuesta {
    return {
      sucursalId: sucursal.id,
      nombre: sucursal.nombre,
      precio: ajuste.precio,
      precioEfectivo: precioEfectivo(producto.precio, ajuste.precio),
      disponible: ajuste.disponible,
      // Los agotados (tabla `producto_agotado`) llegan con el grupo C5: hasta entonces ninguno está agotado.
      agotado: false,
      editable,
    };
  }
}
