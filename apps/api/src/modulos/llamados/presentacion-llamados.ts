import { Inject, Injectable } from '@nestjs/common';
import {
  llamadoDetalleSchema,
  llamadoResumenSchema,
  type LineaDeLlamado,
  type LlamadoDetalle,
  type LlamadoResumen,
  type RevisionLinea,
} from '@restaurante/contratos';
import { estadoVigenteLlamado, totalOrden } from '@restaurante/dominio';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { CartaVentaService, ErrorProductoNoVendible, ErrorSeleccionInvalida } from '../carta';
import { NombresDeLlamados } from './nombres-llamados';
import type { LineaGuardada } from './creacion-llamados.service';
import type { FilaLlamado } from './filas-llamado';

/** Lo que dice la revisión cuando una opción elegida ya no se puede pedir (criterio 40). */
const MOTIVO_DE_SELECCION: Record<string, string> = {
  MODIFICADOR_NO_DISPONIBLE: 'Una opción elegida ya no está disponible',
  MODIFICADOR_DESCONOCIDO: 'Una opción elegida ya no existe en la carta',
  MODIFICADOR_REPETIDO: 'Una opción está repetida',
  MENOS_DEL_MINIMO: 'Faltan opciones por elegir',
  MAS_DEL_MAXIMO: 'Hay demasiadas opciones elegidas',
};

const iso = (fecha: Date | null): string | null =>
  fecha === null ? null : new Date(fecha).toISOString();

/**
 * Convierte la fila de `llamado` en lo que ve el mozo (historia 005, criterios 39 y 40): el resumen de la lista y
 * el detalle con la revisión de cada línea. La revisión se calcula con el reloj de la API y `prepararLineas`
 * (un solo cargador para todas las líneas); la persona que atendió o cerró y el nombre de la mesa salen de los
 * servicios de seguridad y de salón, en una consulta cada uno sin importar cuántos llamados haya.
 */
@Injectable()
export class PresentacionLlamados {
  constructor(
    @Inject(NombresDeLlamados) private readonly nombres: NombresDeLlamados,
    @Inject(CartaVentaService) private readonly carta: CartaVentaService,
  ) {}

  /** Los resúmenes de las filas, en el mismo orden. */
  async resumenes(filas: readonly FilaLlamado[], ahora: Date): Promise<LlamadoResumen[]> {
    const { usuarios, mesas } = await this.nombres.de(filas);
    return filas.map((fila) => this.resumen(fila, ahora, usuarios, mesas));
  }

  /** El detalle del llamado con la revisión de sus líneas con la carta de hoy. */
  async detalle(fila: FilaLlamado, ahora: Date): Promise<LlamadoDetalle> {
    const { usuarios, mesas } = await this.nombres.de([fila]);
    const resumen = this.resumen(fila, ahora, usuarios, mesas);
    const revisiones = await this.revisar(fila, ahora);
    const lineas = fila.lineas.map((linea, posicion): LineaDeLlamado => ({
      posicion,
      productoId: linea.productoId,
      nombre: linea.nombre,
      modificadores: linea.modificadores.map((m) => ({
        id: m.id,
        nombre: m.nombre,
        precioExtra: m.precioExtra,
      })),
      cantidad: linea.cantidad,
      observacion: linea.observacion,
      precioCliente: linea.precioUnitario,
      revision: revisiones[posicion]!,
    }));
    const disponibles = lineas.flatMap((l) =>
      l.revision.disponible
        ? [{ precioUnitario: l.revision.precioUnitario, cantidad: l.cantidad, cantidadAnulada: 0 }]
        : [],
    );
    return llamadoDetalleSchema.parse({
      ...resumen,
      lineas,
      totalCliente: fila.total,
      totalActual: fila.tipo === 'PEDIDO' ? totalOrden(disponibles) : null,
      motivoDescarte: fila.motivo_descarte,
      lineasPasadas: fila.lineas_pasadas,
    });
  }

  private resumen(
    fila: FilaLlamado,
    ahora: Date,
    usuarios: ReadonlyMap<string, string>,
    mesas: ReadonlyMap<string, string>,
  ): LlamadoResumen {
    const persona = (id: string | null) =>
      id === null ? null : { id, nombre: usuarios.get(id) ?? '' };
    const venceEn = new Date(fila.vence_en);
    return llamadoResumenSchema.parse({
      id: fila.id,
      tipo: fila.tipo,
      estado: estadoVigenteLlamado({ estado: fila.estado, venceEn }, ahora),
      mesa: { id: fila.mesa_id, nombre: mesas.get(fila.mesa_id) ?? '' },
      creadoEn: new Date(fila.creado_en).toISOString(),
      venceEn: venceEn.toISOString(),
      unidades: fila.lineas.reduce((suma, l) => suma + l.cantidad, 0),
      total: fila.total,
      nota: fila.nota,
      destinatarios: fila.destinatario_mozo_id === null ? null : [fila.destinatario_mozo_id],
      atendidoPor: persona(fila.atendido_por_usuario_id),
      atendidoEn: iso(fila.atendido_en),
      cerradoPor: persona(fila.cerrado_por_usuario_id),
      cerradoEn: iso(fila.cerrado_en),
      ordenId: fila.orden_id,
    });
  }

  /** Cada línea guardada preparada de nuevo con la cantidad que pidió el cliente: disponible o el motivo en palabras. */
  private async revisar(fila: FilaLlamado, ahora: Date): Promise<RevisionLinea[]> {
    if (fila.lineas.length === 0) return [];
    const resultados = await this.carta.prepararLineas(
      fila.sucursal_id,
      fila.lineas.map((l) => ({
        productoId: l.productoId,
        modificadorIds: l.modificadorIds,
        cantidad: l.cantidad,
      })),
      ahora,
    );
    return resultados.map((resultado, indice): RevisionLinea => {
      if (resultado.ok) {
        return {
          disponible: true,
          precioUnitario: resultado.linea.precioUnitario,
          total: resultado.linea.total,
        };
      }
      return motivoDeNoDisponible(resultado.error, fila.lineas[indice]!);
    });
  }
}

/**
 * Por qué una línea del llamado ya no se puede pasar (criterio 40): el código estable y el motivo en palabras. Un
 * producto desactivado muestra su motivo real al mozo (al público se le oculta, decisión del orquestador).
 */
export function motivoDeNoDisponible(error: unknown, linea: LineaGuardada): RevisionLinea {
  if (error instanceof ErrorProductoNoVendible) {
    return { disponible: false, codigo: error.motivo, motivo: error.message };
  }
  if (error instanceof ErrorSeleccionInvalida) {
    const primero = error.errores[0];
    const codigo = primero?.codigo ?? 'SELECCION_INVALIDA';
    const base = MOTIVO_DE_SELECCION[codigo] ?? 'La selección de opciones ya no es válida';
    if (primero !== undefined && 'modificadorId' in primero) {
      const nombre = linea.modificadores.find((m) => m.id === primero.modificadorId)?.nombre;
      if (nombre !== undefined) {
        return { disponible: false, codigo, motivo: `${base}: ${nombre}` };
      }
    }
    return { disponible: false, codigo, motivo: base };
  }
  if (error instanceof ErrorAplicacion && error.codigo === 'NO_ENCONTRADO') {
    return { disponible: false, codigo: 'PRODUCTO_NO_EXISTE', motivo: 'El producto ya no existe' };
  }
  throw error;
}
