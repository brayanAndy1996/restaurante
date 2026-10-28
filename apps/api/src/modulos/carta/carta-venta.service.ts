import { Inject, Injectable } from '@nestjs/common';
import type { CartaSucursalRespuesta, LineaPreparada } from '@restaurante/contratos';
import { calcularLinea, diaOperativo, type ProductoParaLinea } from '@restaurante/dominio';
import { type Sequelize } from 'sequelize';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../nucleo/archivos';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { SucursalesConsultaService } from '../plataforma';
import { armarProductoDeVenta, armarVista } from './armador-carta';
import { cargarCarta, type CartaCargada } from './cargador-carta';
import { ErrorProductoNoVendible, ErrorSeleccionInvalida, noEncontrado } from './errores-carta';
import { esUuid } from './util-carta';

/** Entrada de `CartaVentaService.prepararLinea` (criterio 52). */
export interface PrepararLineaEntrada {
  sucursalId: string;
  productoId: string;
  /** Ids de los modificadores elegidos, en cualquier orden. */
  modificadorIds: readonly string[];
  /** Entero de 1 a 999. */
  cantidad: number;
  /** Instante de la venta: define el día operativo (menú del día y agotados). */
  instante: Date;
}

/**
 * Contrato de la carta para el comandero (sección 3) y la carta web (sección 5): la vista de una sucursal y el
 * armado de una línea de venta (criterios 47 a 52 y 58). Corre dentro de un contexto de empresa
 * (`ContextoEmpresa`), con o sin sesión: no usa el principal, así que sirve igual para un actor de sistema.
 * Solo lee; el precio sale de `packages/dominio` (`precioEfectivo` en la vista y `calcularLinea` en la línea).
 */
@Injectable()
export class CartaVentaService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
  ) {}

  private urlFoto = (clave: string): string => this.almacen.urlPublica(clave);

  /**
   * Día operativo de la sucursal en `instante` con su hora de corte (calculado con el instante que llega, que
   * viene del reloj de la API, nunca con `now()` de la base). 404 si la sucursal no es de la empresa.
   */
  private async diaDe(sucursalId: string, instante: Date): Promise<string> {
    const horaCorte = esUuid(sucursalId) ? await this.sucursales.horaCorte(sucursalId) : null;
    if (horaCorte === null) throw noEncontrado('La sucursal');
    return diaOperativo(instante, horaCorte);
  }

  /**
   * La misma vista de `GET /carta/sucursal`, para cualquier sucursal de la empresa del contexto (criterio
   * 51). Seis consultas del cargador más la hora de corte de la sucursal, sin importar cuántos productos haya.
   */
  async cartaDeSucursal(sucursalId: string, instante: Date): Promise<CartaSucursalRespuesta> {
    const dia = await this.diaDe(sucursalId, instante);
    const carta = await cargarCarta(this.conexion, {
      sucursalId: sucursalId.toLowerCase(),
      diaOperativo: dia,
    });
    return armarVista(carta, this.urlFoto);
  }

  /**
   * Valida la selección y calcula el precio de una línea con `calcularLinea` de `packages/dominio`
   * (criterios 52 y 58). Orden de los rechazos: 404 (sucursal o producto que no existe en la empresa; uno de otra
   * empresa es igual), 422 `PRODUCTO_NO_VENDIBLE` (no se vende solo o con el motivo de `vendibilidad`) y 422
   * `SELECCION_INVALIDA` (con los errores de `validarSeleccion`; un modificador de otra empresa es
   * `MODIFICADOR_DESCONOCIDO`, como uno inexistente). Una cantidad fuera de 1 a 999 lanza `RangeError`. No
   * escribe nada.
   */
  async prepararLinea(entrada: PrepararLineaEntrada): Promise<LineaPreparada> {
    const dia = await this.diaDe(entrada.sucursalId, entrada.instante);
    const productoId = entrada.productoId.toLowerCase();
    if (!esUuid(productoId)) throw noEncontrado('El producto');
    const carta = await cargarCarta(this.conexion, {
      sucursalId: entrada.sucursalId.toLowerCase(),
      diaOperativo: dia,
      productoId,
    });
    const producto = carta.porId.get(productoId);
    if (producto === undefined) throw noEncontrado('El producto');

    const venta = armarProductoDeVenta(carta, producto, this.urlFoto);
    if (!venta.seVendeSolo) throw new ErrorProductoNoVendible('NO_SE_VENDE_SOLO');
    if (!venta.vendible) throw new ErrorProductoNoVendible(venta.motivo ?? 'INACTIVO');

    const paraLinea: ProductoParaLinea = {
      precio: venta.precio,
      grupos: venta.grupos.map((g) => ({
        id: g.id,
        minimo: g.minimo,
        maximo: g.maximo,
        modificadores: g.modificadores.map((m) => ({
          id: m.id,
          precioExtra: m.precioExtra,
          disponible: m.disponible,
        })),
      })),
    };
    const elegidos = entrada.modificadorIds.map((id) => id.toLowerCase());
    const calculo = calcularLinea(paraLinea, elegidos, entrada.cantidad);
    if (!calculo.valido) {
      const errores = calculo.errores.flatMap((e) =>
        e.codigo === 'PRODUCTO_SIN_PRECIO' ? [] : [e],
      );
      if (errores.length === 0) throw new ErrorProductoNoVendible('NO_SE_VENDE_SOLO');
      throw new ErrorSeleccionInvalida(errores);
    }

    return {
      productoId: venta.id,
      nombre: venta.nombre,
      tipo: venta.tipo,
      cantidad: entrada.cantidad,
      precioUnitario: calculo.precioUnitario,
      total: calculo.total,
      afectacionIgv: venta.afectacionIgv,
      aplicaIcbper: venta.aplicaIcbper,
      estacionId: venta.estacionId,
      tipoControlStock: venta.tipoControlStock,
      modificadores: calculo.modificadores.map((elegido) =>
        modificadorDeLinea(carta, venta, elegido),
      ),
      componentes: venta.componentes.map((c) => ({
        productoId: c.productoId,
        nombre: c.nombre,
        cantidad: c.cantidad,
        estacionId: c.estacionId,
        tipoControlStock: carta.porId.get(c.productoId)?.tipoControlStock ?? 'SIN_CONTROL',
      })),
    };
  }
}

/** Un modificador elegido con su grupo y su producto ligado, tal como lo guarda la venta. */
function modificadorDeLinea(
  carta: CartaCargada,
  venta: ReturnType<typeof armarProductoDeVenta>,
  elegido: { id: string; precioExtra: string },
): LineaPreparada['modificadores'][number] {
  const grupo = venta.grupos.find((g) => g.modificadores.some((m) => m.id === elegido.id))!;
  const modificador = grupo.modificadores.find((m) => m.id === elegido.id)!;
  const ligado =
    modificador.productoId === null ? undefined : carta.porId.get(modificador.productoId);
  return {
    id: elegido.id,
    nombre: modificador.nombre,
    grupoId: grupo.id,
    grupoNombre: grupo.nombre,
    precioExtra: elegido.precioExtra,
    productoLigado:
      ligado === undefined
        ? null
        : {
            id: ligado.id,
            nombre: ligado.nombre,
            estacionId: ligado.estacionId,
            tipoControlStock: ligado.tipoControlStock,
          },
  };
}
