import {
  ventaMostradorRespuestaSchema,
  type ProductoDeVenta,
  type VentaMostradorEntrada,
  type VentaMostradorRespuesta,
} from '@restaurante/contratos';
import { fechaLima } from '@restaurante/dominio';
import {
  calcularParte,
  montoIcbperVigente,
  type CuentaEntrada,
  type ParteCalculada,
} from '@restaurante/dominio/caja';
import type { QueryClient } from '@tanstack/react-query';
import { ahoraDelServidor, api, nuevaClaveDeIdempotencia } from '../../lib/api';
import { enviarSinPerder, type ExtraDeEscritura } from '../../lib/envios';
import { ErrorApi } from '../../lib/errores';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { CLAVES_DISPONIBILIDAD, type VistaEnCache } from '../disponibilidad/disponibilidad';
import {
  aLineaDeEnvio,
  cambiarBorrador,
  cambiarEstadoDeEnvio,
  leerBorrador,
  leerEstadoDeEnvio,
  type AvisoDeEnvio,
  type LineaBorrador,
} from '../salon/borrador';
import {
  calcularDeProducto,
  type FamiliaDeVenta,
  type SeleccionPorGrupo,
} from '../salon/comandero';
import { rechazosPorLinea } from '../salon/enviar-borrador';
import { falloDeCobro, type FalloDeCobro, type FormatoDeCobro } from './cobro';

/**
 * La venta de mostrador en la PWA (historia 006, criterios 79 a 85 y 115): el total de lo que arma el cajero, la llamada a
 * la API y los errores dichos en palabras. Ningún monto se decide aquí: el total sale de `calcularParte` de
 * `packages/dominio/caja` sobre la carta que el comandero ya tiene, y la API lo compara con el suyo (409 `CUENTA_CAMBIO`).
 *
 * El `id` de la venta se guarda en el borrador (`envioId`) antes de mandar nada y se conserva hasta una respuesta final:
 * las líneas quedan bloqueadas mientras tanto y «Reintentar la venta» manda lo mismo, así que una respuesta perdida no
 * cobra dos veces. Aparte se guarda lo demás del cuerpo (turno, total, comprobante y pagos), para repetirlo igual tras
 * una recarga.
 */

// --- Llamada a la API ----------------------------------------------------------------------------------

export const venderEnMostrador = (entrada: VentaMostradorEntrada, extra?: ExtraDeEscritura) =>
  api.post<VentaMostradorRespuesta>('/ventas-mostrador', entrada, {
    esquema: ventaMostradorRespuestaSchema,
    ...extra,
  });

/** Lo que hace de «orden» en la clave del borrador del mostrador: una por empresa y persona. */
export const ORDEN_DEL_MOSTRADOR = 'mostrador';

// --- El total ----------------------------------------------------------------------------------------------

export type TotalDeVenta =
  | { ok: true; total: string; calculada: ParteCalculada }
  | { ok: false; motivo: 'VACIA' }
  | { ok: false; motivo: 'FUERA_DE_CARTA'; nombres: string[] };

function productosPorId(familias: readonly FamiliaDeVenta[]): Map<string, ProductoDeVenta> {
  const productos = new Map<string, ProductoDeVenta>();
  for (const familia of familias) for (const p of familia.productos) productos.set(p.id, p);
  return productos;
}

/**
 * El total de la venta con `calcularParte` (una parte `TOTAL` sin descuentos ni cortesías, criterio 85). La tasa de IGV
 * no cambia el total (el precio ya la incluye; solo reparte base e IGV) y esta pantalla no muestra IGV: lo emite la API
 * con la tasa del emisor. El ICBPER es el vigente hoy en Lima, el mismo que usa la API.
 */
export function totalDeLaVenta(
  lineas: readonly LineaBorrador[],
  familias: readonly FamiliaDeVenta[],
  formato: FormatoDeCobro,
  ahoraMs: number = ahoraDelServidor(),
): TotalDeVenta {
  if (lineas.length === 0) return { ok: false, motivo: 'VACIA' };
  const productos = productosPorId(familias);
  const faltan = lineas.filter((l) => !productos.has(l.productoId)).map((l) => l.nombre);
  if (faltan.length > 0) return { ok: false, motivo: 'FUERA_DE_CARTA', nombres: faltan };
  const cuenta: CuentaEntrada = {
    lineas: lineas.map((l) => {
      const producto = productos.get(l.productoId)!;
      return {
        itemId: l.clave,
        precioUnitario: l.precioUnitario,
        cantidad: l.cantidad,
        cantidadCortesia: 0,
        afectacion: producto.afectacionIgv,
        aplicaIcbper: producto.aplicaIcbper,
        descuento: null,
      };
    }),
    descuentoCuenta: null,
    tasaIgv: '18.00',
    montoIcbper: montoIcbperVigente(fechaLima(new Date(ahoraMs))),
  };
  const resultado = calcularParte(cuenta, [], { tipo: 'TOTAL' }, formato);
  if (!resultado.valida) return { ok: false, motivo: 'VACIA' };
  const { valida: _valida, ...calculada } = resultado;
  return { ok: true, total: calculada.totales.total, calculada };
}

/**
 * Las líneas con el precio de la carta de ahora (tras un 409 `CUENTA_CAMBIO`): cada una se vuelve a calcular con
 * `calcularLinea` sobre el producto y las opciones que ya tenía. Una línea cuyo producto o cuyas opciones ya no cuadran
 * se deja como estaba; la API dirá por qué.
 */
export function repreciar(
  lineas: readonly LineaBorrador[],
  familias: readonly FamiliaDeVenta[],
): LineaBorrador[] {
  const productos = productosPorId(familias);
  return lineas.map((linea) => {
    const producto = productos.get(linea.productoId);
    if (!producto) return linea;
    const seleccion: SeleccionPorGrupo = {};
    for (const grupo of producto.grupos) {
      const elegidos = linea.modificadores
        .filter((m) => grupo.modificadores.some((o) => o.id === m.id))
        .map((m) => m.id);
      if (elegidos.length > 0) seleccion[grupo.id] = elegidos;
    }
    const resultado = calcularDeProducto(producto, seleccion, linea.cantidad);
    if (!resultado.valido) return linea;
    return {
      ...linea,
      precioUnitario: resultado.precioUnitario,
      modificadores: linea.modificadores.map((m) => {
        const nuevo = resultado.modificadores.find((r) => r.id === m.id);
        return nuevo ? { ...m, precioExtra: nuevo.precioExtra } : m;
      }),
    };
  });
}

// --- Lo que este equipo recuerda de la venta en curso -----------------------------------------------------

const PREFIJO = 'restaurante.mostrador.';

/** Lo que de la venta en curso no está en el borrador: el turno, el total, el comprobante y los pagos. */
export type CuerpoDeVenta = Omit<VentaMostradorEntrada, 'id' | 'lineas'>;

export interface VentaEnCurso {
  id: string;
  cuerpo: CuerpoDeVenta;
}

export const claveDeVentaEnCurso = (empresaId: string, usuarioId: string | null) =>
  `${PREFIJO}${empresaId}.${usuarioId ?? 'soporte'}`;

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

export function leerVentaEnCurso(clave: string): VentaEnCurso | null {
  try {
    const dato: unknown = JSON.parse(local()?.getItem(clave) ?? 'null');
    if (typeof dato !== 'object' || dato === null) return null;
    const { id, cuerpo } = dato as { id?: unknown; cuerpo?: unknown };
    return typeof id === 'string' && typeof cuerpo === 'object' && cuerpo !== null
      ? { id, cuerpo: cuerpo as CuerpoDeVenta }
      : null;
  } catch {
    return null;
  }
}

export function guardarVentaEnCurso(clave: string, venta: VentaEnCurso | null): void {
  try {
    if (venta) local()?.setItem(clave, JSON.stringify(venta));
    else local()?.removeItem(clave);
  } catch {
    // Sin almacenamiento, tras una recarga se reintenta con lo que se escriba de nuevo (el servidor lo dirá).
  }
}

// --- Errores en palabras -----------------------------------------------------------------------------------

export interface FalloDeVenta extends FalloDeCobro {
  /** El total que ahora da la carta, si cambió un precio. */
  totalNuevo?: string;
}

const MONTO_EN_TEXTO = /(\d{1,12}\.\d{2})/;

export function falloDeVenta(error: unknown): FalloDeVenta {
  if (error instanceof ErrorApi) {
    switch (error.codigo) {
      case 'CUENTA_CAMBIO': {
        const total = MONTO_EN_TEXTO.exec(
          error.campos.find((c) => c.campo === 'total')?.mensaje ?? '',
        );
        return {
          texto:
            'Cambió el precio de algo desde que armaste la venta. Ya actualizamos los precios: revisa el total nuevo y confirma otra vez. Los productos y los pagos siguen aquí.',
          cuentaCambio: true,
          ...(total?.[1] ? { totalNuevo: total[1] } : {}),
        };
      }
      case 'PRODUCTO_NO_VENDIBLE':
        return {
          texto:
            'No se cobró ni se envió nada: algún producto ya no se puede vender. Corrige o quita las líneas marcadas.',
        };
      case 'CLAVE_IDEMPOTENCIA_REUTILIZADA':
        return {
          texto:
            'Esta venta ya se había enviado con otros datos. Antes de repetirla, revisa el Reporte X de tu caja: puede que ya esté cobrada.',
        };
      case 'NO_ENCONTRADO':
        return {
          texto: 'No encontramos tu turno. Vuelve a «Caja» y revisa que siga abierto.',
          turno: true,
        };
      case 'CONFLICTO':
        return {
          texto:
            'Otra operación se estaba aplicando. Toca «Reintentar la venta»: se manda la misma venta y no se duplica.',
          repetir: true,
        };
      default:
        break;
    }
  }
  return falloDeCobro(error);
}

/**
 * ¿La respuesta demuestra que la venta no quedó? Solo entonces se suelta el `id`. La API reconoce la réplica antes de
 * mirar el turno, el plan o los permisos, así que un 403 o un corte no prueban nada: se conserva el `id`.
 */
export function demuestraQueNoQuedo(error: ErrorApi): boolean {
  if (error.sinConexion || error.codigo === 'ENVIO_CANCELADO' || error.estado >= 500) return false;
  if (error.estado === 400 || error.estado === 404 || error.estado === 422) return true;
  if (error.estado === 409) {
    return [
      'TURNO_CERRADO',
      'TURNO_AJENO',
      'SIN_SERIE',
      'SERIE_AGOTADA',
      'TASA_IGV_NO_CONFIGURADA',
      'CUENTA_CAMBIO',
    ].includes(error.codigo);
  }
  return false;
}

// --- El envío ----------------------------------------------------------------------------------------------

export type ResultadoDeVenta =
  | { resultado: 'vendida'; respuesta: VentaMostradorRespuesta }
  /** Cambió un precio: no quedó nada, el borrador sigue (ya con los precios de ahora) y se confirma el total nuevo. */
  | { resultado: 'cambio'; fallo: FalloDeVenta }
  /** La API contestó que no y no guardó nada. */
  | { resultado: 'rechazada'; fallo: FalloDeVenta }
  /** No se sabe si quedó: «Reintentar la venta» con el mismo `id`. */
  | { resultado: 'fallo'; fallo: FalloDeVenta }
  | { resultado: 'nada' };

const aviso = (tipo: AvisoDeEnvio['tipo'], titulo: string, detalle: string): AvisoDeEnvio => ({
  tipo,
  titulo,
  detalle,
});

/**
 * Manda la venta que arma el borrador `clave`. Con un `id` ya guardado (un reintento) manda el cuerpo que se guardó con
 * él; si no, el `cuerpo` nuevo. Nunca lanza: el resultado dice qué pasó y las líneas rechazadas quedan marcadas en el
 * borrador.
 */
export async function venderBorrador({
  clave,
  claveDeVenta,
  cuerpo,
  clientes,
  sucursalId,
}: {
  clave: string;
  claveDeVenta: string;
  cuerpo: CuerpoDeVenta;
  clientes: QueryClient;
  sucursalId: string;
}): Promise<ResultadoDeVenta> {
  if (leerEstadoDeEnvio(clave).fase !== null) return { resultado: 'nada' };
  const actual = leerBorrador(clave);
  if (actual.lineas.length === 0) return { resultado: 'nada' };

  const id = actual.envioId ?? nuevaClaveDeIdempotencia();
  const guardada = leerVentaEnCurso(claveDeVenta);
  const aEnviar: CuerpoDeVenta = actual.envioId && guardada?.id === id ? guardada.cuerpo : cuerpo;
  // El `id` y el cuerpo se guardan antes de mandar nada: si la página se recarga, el reintento manda lo mismo.
  cambiarBorrador(clave, (b) => ({
    envioId: id,
    lineas: b.lineas.map(({ rechazo: _quitado, ...l }) => l),
  }));
  guardarVentaEnCurso(claveDeVenta, { id, cuerpo: aEnviar });
  cambiarEstadoDeEnvio(clave, { fase: 'enviando', aviso: null });
  const entrada: VentaMostradorEntrada = {
    id,
    lineas: actual.lineas.map(aLineaDeEnvio),
    ...aEnviar,
  };

  try {
    const respuesta = await enviarSinPerder((extra) => venderEnMostrador(entrada, extra), {
      alCambiar: (pendiente) =>
        cambiarEstadoDeEnvio(clave, { fase: pendiente ? 'esperando-red' : 'enviando' }),
    });
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.turno });
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
    return { resultado: 'vendida', respuesta };
  } catch (error) {
    const fallo = falloDeVenta(error);
    if (!(error instanceof ErrorApi) || !demuestraQueNoQuedo(error)) {
      const sinRed = error instanceof ErrorApi && error.sinConexion;
      cambiarEstadoDeEnvio(clave, {
        aviso: aviso(
          'alerta',
          sinRed ? 'No hay conexión' : 'No sabemos si la venta quedó',
          `${fallo.texto} Reintenta la venta: si ya estaba hecha, no se duplicará.`,
        ),
      });
      return { resultado: 'fallo', fallo };
    }
    // La API contestó que no y no guardó nada: se suelta el `id`. Las líneas se quedan, con lo rechazado marcado.
    cambiarBorrador(clave, (b) => ({ ...b, envioId: null }));
    guardarVentaEnCurso(claveDeVenta, null);
    if (error.codigo === 'CUENTA_CAMBIO') {
      const clavesDeLaCarta = CLAVES_DISPONIBILIDAD.vista(sucursalId);
      await clientes.invalidateQueries({ queryKey: clavesDeLaCarta }).catch(() => undefined);
      const fresca = clientes.getQueryData<VistaEnCache>(clavesDeLaCarta)?.vista.familias;
      if (fresca) cambiarBorrador(clave, (b) => ({ ...b, lineas: repreciar(b.lineas, fresca) }));
      return { resultado: 'cambio', fallo };
    }
    const rechazos = rechazosPorLinea(error);
    if (rechazos.size > 0) {
      cambiarBorrador(clave, (b) => ({
        ...b,
        lineas: b.lineas.map((l, i) => {
          const { rechazo: _previo, ...resto } = l;
          const motivo = rechazos.get(i);
          return motivo ? { ...resto, rechazo: motivo } : resto;
        }),
      }));
      cambiarEstadoDeEnvio(clave, {
        aviso: aviso(
          'error',
          'No se cobró ni se envió nada',
          rechazos.size === 1
            ? 'Una línea no pasó. Corrígela o quítala, y vuelve a cobrar.'
            : `${rechazos.size} líneas no pasaron. Corrígelas o quítalas, y vuelve a cobrar.`,
        ),
      });
    }
    return { resultado: 'rechazada', fallo };
  } finally {
    cambiarEstadoDeEnvio(clave, { fase: null });
  }
}
