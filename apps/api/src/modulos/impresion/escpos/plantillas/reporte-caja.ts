import {
  VERSION_DOCUMENTO_TICKET,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import type { MedioPago, TipoComprobante } from '@restaurante/dominio';
import { ETIQUETA_DE_MEDIO, esCero } from './etiquetas-caja';
import { ajustarAlPresupuesto } from './presupuesto';
import { formatoMonto, limpiarTexto } from './texto';

/**
 * Plantilla del reporte X y de la Z del turno de caja (historia 006, criterios 29, 31 y 95): el turno (caja, cajero,
 * apertura), el fondo, las ventas (comprobantes, por tipo y por medio de pago, descuentos, cortesías, IGV, ICBPER,
 * redondeos y vueltos), los ingresos y egresos con su motivo, y lo que debería haber de cada medio. La Z agrega el
 * conteo del cierre (esperado, contado, diferencia y motivo de cada medio) y quién cerró.
 *
 * Los montos son los del reporte: aquí solo se les da formato.
 */

/** Lo que el ticket toma del reporte; `ReporteCaja` (contratos) lo cumple tal cual. */
export interface ReporteParaTicket {
  turno: { caja: { nombre: string }; responsable: { nombre: string } };
  fondo: string;
  ventas: {
    total: string;
    cantidad: number;
    porTipo: readonly { tipo: TipoComprobante; cantidad: number; total: string }[];
    porMedio: readonly { medio: MedioPago; cantidad: number; monto: string }[];
    descuentos: string;
    cortesias: string;
    igv: string;
    icbper: string;
    redondeos: string;
    vueltos: string;
  };
  movimientos: {
    ingresos: string;
    egresos: string;
    lista: readonly { tipo: 'INGRESO' | 'EGRESO'; monto: string; motivo: string }[];
  };
  esperado: readonly { medio: MedioPago; monto: string }[];
  cierre?:
    | {
        cerradoPor: { nombre: string };
        conteo: readonly {
          medio: MedioPago;
          esperado: string;
          contado: string;
          diferencia: string;
          motivo: string | null;
        }[];
      }
    | undefined;
}

/** Lo que el reporte toma de la sucursal y de los momentos, ya en la hora local (`02/11 10:00`). */
export interface ContextoDeReporteCaja {
  sucursal: string;
  abierto: string;
  /** Cuándo se cerró el turno (solo en la Z). */
  cerrado?: string | null;
  /** Cuándo se generó el reporte. */
  generado: string;
}

const ETIQUETA_DE_TIPO: Readonly<Record<TipoComprobante, string>> = {
  BOLETA: 'Boletas',
  FACTURA: 'Facturas',
};

function fila(izquierda: string, monto: string, negrita = false): BloqueTicket {
  return {
    tipo: 'columnas',
    izquierda: limpiarTexto(izquierda),
    derecha: formatoMonto(monto),
    ...(negrita ? { negrita: true } : {}),
  };
}

function seccion(texto: string): BloqueTicket[] {
  return [
    { tipo: 'linea', texto, negrita: true },
    { tipo: 'regla', caracter: '-' },
  ];
}

/** Un monto con signo explícito para las diferencias del arqueo (`+5.00`, `-2.50`, `0.00`). */
function conSigno(monto: string): string {
  const formateado = formatoMonto(monto);
  return esCero(formateado) || formateado.startsWith('-') ? formateado : `+${formateado}`;
}

function encabezadoDe(
  tipo: 'REPORTE_X' | 'REPORTE_Z',
  r: ReporteParaTicket,
  ctx: ContextoDeReporteCaja,
): BloqueTicket[] {
  const bloques: BloqueTicket[] = [
    { tipo: 'titulo', texto: limpiarTexto(ctx.sucursal) },
    {
      tipo: 'titulo',
      texto: tipo === 'REPORTE_X' ? 'REPORTE X' : 'REPORTE Z',
    },
    {
      tipo: 'linea',
      texto: tipo === 'REPORTE_X' ? 'Turno abierto (parcial)' : 'Cierre del turno',
      alinear: 'centro',
    },
    { tipo: 'linea', texto: limpiarTexto(`Caja: ${r.turno.caja.nombre}`) },
    { tipo: 'linea', texto: limpiarTexto(`Cajero: ${r.turno.responsable.nombre}`) },
    { tipo: 'linea', texto: `Abierto: ${limpiarTexto(ctx.abierto)}` },
  ];
  if (tipo === 'REPORTE_Z' && r.cierre !== undefined) {
    bloques.push(
      { tipo: 'linea', texto: `Cerrado: ${limpiarTexto(ctx.cerrado ?? ctx.generado)}` },
      { tipo: 'linea', texto: limpiarTexto(`Cerró: ${r.cierre.cerradoPor.nombre}`) },
    );
  } else {
    bloques.push({ tipo: 'linea', texto: `Impreso: ${limpiarTexto(ctx.generado)}` });
  }
  bloques.push({ tipo: 'regla', caracter: '=' });
  return bloques;
}

function ventasDe(r: ReporteParaTicket): BloqueTicket[] {
  const v = r.ventas;
  const bloques: BloqueTicket[] = [fila('Fondo inicial', r.fondo), { tipo: 'espacio' }];
  bloques.push(...seccion('VENTAS'));
  bloques.push({
    tipo: 'columnas',
    izquierda: `Comprobantes (${v.cantidad})`,
    derecha: formatoMonto(v.total),
    negrita: true,
  });
  for (const t of v.porTipo) {
    bloques.push(fila(`  ${ETIQUETA_DE_TIPO[t.tipo]} (${t.cantidad})`, t.total));
  }
  bloques.push(fila('Descuentos', v.descuentos), fila('Cortesías', v.cortesias));
  bloques.push(fila('IGV', v.igv), fila('ICBPER', v.icbper));
  bloques.push(fila('Redondeos', v.redondeos), fila('Vueltos', v.vueltos));
  bloques.push({ tipo: 'espacio' }, ...seccion('POR MEDIO DE PAGO'));
  for (const m of v.porMedio) {
    bloques.push(fila(`${ETIQUETA_DE_MEDIO[m.medio]} (${m.cantidad})`, m.monto));
  }
  return bloques;
}

function movimientosDe(r: ReporteParaTicket, conLista: boolean): BloqueTicket[] {
  const m = r.movimientos;
  const bloques: BloqueTicket[] = [{ tipo: 'espacio' }, ...seccion('MOVIMIENTOS DE EFECTIVO')];
  bloques.push(fila('Ingresos', m.ingresos), fila('Egresos', m.egresos));
  if (conLista) {
    for (const mov of m.lista) {
      bloques.push(fila(`  ${mov.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'}`, mov.monto), {
        tipo: 'linea',
        texto: limpiarTexto(mov.motivo),
        sangria: 4,
      });
    }
  }
  return bloques;
}

function pieDe(tipo: 'REPORTE_X' | 'REPORTE_Z', r: ReporteParaTicket): BloqueTicket[] {
  const bloques: BloqueTicket[] = [{ tipo: 'espacio' }, ...seccion('ESPERADO EN CAJA')];
  for (const e of r.esperado) bloques.push(fila(ETIQUETA_DE_MEDIO[e.medio], e.monto));
  if (tipo === 'REPORTE_Z' && r.cierre !== undefined) {
    bloques.push({ tipo: 'espacio' }, ...seccion('CONTEO DEL CIERRE'));
    for (const c of r.cierre.conteo) {
      bloques.push(
        { tipo: 'linea', texto: ETIQUETA_DE_MEDIO[c.medio], negrita: true },
        fila('  Esperado', c.esperado),
        fila('  Contado', c.contado),
        {
          tipo: 'columnas',
          izquierda: '  Diferencia',
          derecha: conSigno(c.diferencia),
          negrita: !esCero(c.diferencia),
        },
      );
      if (c.motivo !== null && limpiarTexto(c.motivo).length > 0) {
        bloques.push({ tipo: 'linea', texto: limpiarTexto(`Motivo: ${c.motivo}`), sangria: 2 });
      }
    }
  }
  bloques.push(
    { tipo: 'regla', caracter: '=' },
    {
      tipo: 'linea',
      texto:
        tipo === 'REPORTE_X'
          ? 'Reporte parcial: el turno sigue abierto.'
          : 'Reporte definitivo del turno.',
      alinear: 'centro',
    },
  );
  return bloques;
}

export function documentoDeReporteCaja(
  tipo: 'REPORTE_X' | 'REPORTE_Z',
  reporte: ReporteParaTicket,
  contexto: ContextoDeReporteCaja,
): DocumentoTicket {
  // Con muchos movimientos se omite la lista (los totales de ingresos y egresos siempre salen).
  const bloques = ajustarAlPresupuesto(
    [...encabezadoDe(tipo, reporte, contexto), ...ventasDe(reporte)],
    [() => movimientosDe(reporte, true), () => movimientosDe(reporte, false)],
    pieDe(tipo, reporte),
  );
  return { version: VERSION_DOCUMENTO_TICKET, tipo, bloques };
}
