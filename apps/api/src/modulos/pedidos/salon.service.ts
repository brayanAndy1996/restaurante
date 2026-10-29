import { Inject, Injectable } from '@nestjs/common';
import type { MesaDelSalon, SalonRespuesta, StockSalonRespuesta } from '@restaurante/contratos';
import { estadoDeMesa, totalOrden, type EstadoOrden } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { MesasConsultaService } from '../salon';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import { INVENTARIO, type InventarioPuerto } from './inventario';

interface FilaOrdenAbierta {
  id: string;
  estado: Extract<EstadoOrden, 'ABIERTA' | 'EN_PRECUENTA'>;
  mozo_id: string | null;
  comensales: number;
  abierta_en: Date;
  mesa_id: string;
}

interface FilaItemVigente {
  orden_id: string;
  precio_unitario: string;
  cantidad: number;
  cantidad_anulada: number;
}

/** El mapa del salón con el estado de cada mesa y la parte de la respuesta que cubre el `ETag`. */
export interface MapaDelSalon {
  respuesta: SalonRespuesta;
  /** Lo que se compara para el `ETag`: la respuesta sin `ahora`, que cambia en cada petición. */
  paraEtag: Omit<SalonRespuesta, 'ahora'>;
}

/**
 * `GET /salon` (HU-10, criterio 7): las zonas activas de la sucursal activa con sus mesas activas y el estado de
 * cada una, calculado de su orden abierta (`estadoDeMesa`, criterio 8; no hay columna de estado). Se arma con
 * una cantidad fija de consultas sin importar cuántas mesas haya: las zonas y las mesas (`MesasConsultaService`),
 * las órdenes abiertas con sus mesas vigentes, los ítems de esas órdenes (para `totalOrden`), los nombres de los
 * mozos y las personas que pueden ser el mozo responsable (`mozos`). El `ETag` cubre también esa lista.
 */
@Injectable()
export class SalonService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(INVENTARIO) private readonly inventario: InventarioPuerto,
  ) {}

  /**
   * `GET /salon/stock?productoIds=…` (criterio 73, decisión 2): lo que responde el puerto de inventario para los
   * productos pedidos de la sucursal activa. Con `InventarioNulo` (hasta la sección 6) es siempre
   * `{ productos: [] }`: el comandero no muestra "quedan N". Solo se devuelven los productos pedidos.
   */
  async stock(consulta: { productoIds: readonly string[] }): Promise<StockSalonRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const pedidos = [...new Set(consulta.productoIds.map((id) => id.toLowerCase()))];
    const disponibles = await this.inventario.disponibles({ sucursalId, productoIds: pedidos });
    return {
      productos: pedidos.flatMap((productoId) => {
        const disponible = disponibles.get(productoId);
        return disponible === undefined ? [] : [{ productoId, disponible }];
      }),
    };
  }

  async mapa(): Promise<MapaDelSalon> {
    const sucursalId = this.sesion.sucursalActiva();
    const zonas = await this.mesas.listar(sucursalId);
    const abiertas = await this.conexion.query<FilaOrdenAbierta>(
      `SELECT o.id, o.estado, o.mozo_id, o.comensales, o.abierta_en, om.mesa_id
         FROM orden o
         JOIN orden_mesa om ON om.orden_id = o.id AND om.empresa_id = o.empresa_id AND om.hasta IS NULL
        WHERE o.sucursal_id = $1 AND o.estado IN ('ABIERTA', 'EN_PRECUENTA')
        ORDER BY o.abierta_en, o.id, om.desde, om.id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const ordenIds = [...new Set(abiertas.map((f) => f.id))];
    const items = await this.conexion.query<FilaItemVigente>(
      `SELECT orden_id, precio_unitario, cantidad, cantidad_anulada FROM item
        WHERE orden_id = ANY($1::uuid[])`,
      { bind: [ordenIds], type: QueryTypes.SELECT },
    );
    const nombresMozos = await this.usuarios.nombres(
      abiertas.flatMap((f) => (f.mozo_id === null ? [] : [f.mozo_id])),
    );
    const mozos = await this.usuarios.quienesAtiendenMesa(sucursalId);

    const nombreDeMesa = new Map<string, string>();
    for (const zona of zonas) for (const mesa of zona.mesas) nombreDeMesa.set(mesa.id, mesa.nombre);

    // Una fila por (orden, mesa vigente): se agrupa por orden y se queda con la mesa de cada una.
    const porOrden = new Map<string, { fila: FilaOrdenAbierta; mesaIds: string[] }>();
    const ordenDeMesa = new Map<string, string>();
    for (const fila of abiertas) {
      const grupo = porOrden.get(fila.id) ?? { fila, mesaIds: [] };
      grupo.mesaIds.push(fila.mesa_id);
      porOrden.set(fila.id, grupo);
      ordenDeMesa.set(fila.mesa_id, fila.id);
    }
    const itemsDe = new Map<string, FilaItemVigente[]>();
    for (const item of items) {
      const lista = itemsDe.get(item.orden_id) ?? [];
      lista.push(item);
      itemsDe.set(item.orden_id, lista);
    }

    const salonZonas: SalonRespuesta['zonas'] = [];
    for (const zona of zonas) {
      // Una mesa inactiva con orden abierta (no debería existir, criterio 4) igual aparece.
      const mesas = zona.mesas.filter((m) => m.activa || ordenDeMesa.has(m.id));
      if (!zona.activa && mesas.length === 0) continue;
      salonZonas.push({
        id: zona.id,
        nombre: zona.nombre,
        columnas: zona.columnas,
        filas: zona.filas,
        mesas: mesas.map((m): MesaDelSalon => {
          const ordenId = ordenDeMesa.get(m.id);
          const grupo = ordenId === undefined ? undefined : porOrden.get(ordenId);
          return {
            id: m.id,
            nombre: m.nombre,
            capacidad: m.capacidad,
            forma: m.forma,
            columna: m.columna,
            fila: m.fila,
            estado: estadoDeMesa(grupo?.fila.estado ?? null),
            orden:
              grupo === undefined
                ? null
                : {
                    id: grupo.fila.id,
                    mozo: {
                      id: grupo.fila.mozo_id ?? '',
                      nombre: nombresMozos.get(grupo.fila.mozo_id ?? '') ?? '',
                    },
                    comensales: grupo.fila.comensales,
                    abiertaEn: new Date(grupo.fila.abierta_en).toISOString(),
                    total: totalOrden(
                      (itemsDe.get(grupo.fila.id) ?? []).map((i) => ({
                        precioUnitario: i.precio_unitario,
                        cantidad: i.cantidad,
                        cantidadAnulada: i.cantidad_anulada,
                      })),
                    ),
                    mesas: grupo.mesaIds.map((id) => ({ id, nombre: nombreDeMesa.get(id) ?? '' })),
                  },
          };
        }),
      });
    }

    const paraEtag = { sucursalId, mozos, zonas: salonZonas };
    return { respuesta: { ...paraEtag, ahora: this.reloj.ahora().toISOString() }, paraEtag };
  }
}
