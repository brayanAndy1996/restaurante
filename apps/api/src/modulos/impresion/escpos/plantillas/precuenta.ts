import {
  MAXIMO_BLOQUES_TICKET,
  VERSION_DOCUMENTO_TICKET,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { descripcionDeMesas, formatoMonto, juntarEnLineas, limpiarTexto } from './texto';

/**
 * Plantilla de la pre-cuenta (historia 004, criterio 125): nombre de la sucursal, "PRE-CUENTA N.º 2", mesas,
 * mozo, comensales y hora; líneas con cantidad, nombre y total alineado a la derecha; "TOTAL S/ 169.20" y la nota
 * del criterio 51. Sin desglose de IGV ni de base imponible (decisión 5). Los montos son los guardados en la
 * pre-cuenta: aquí solo se les da formato, no se calcula nada.
 */

/** Lo que el ticket toma de la pre-cuenta; `PrecuentaRespuesta` (contratos) lo cumple tal cual. */
export interface PrecuentaParaTicket {
  numero: number;
  orden: {
    mesas: readonly { nombre: string }[];
    mozo: { nombre: string };
    comensales: number;
  };
  lineas: readonly {
    nombre: string;
    modificadores: readonly string[];
    cantidad: number;
    /** Total de la línea tal como se guardó ("42.00"). */
    total: string;
  }[];
  /** Total tal como se guardó ("169.20"). */
  total: string;
  /** "Precios con IGV incluido. No es un comprobante de pago." y, con ICBPER, "El ICBPER se suma al cobrar.". */
  nota: string;
}

/** Lo que la pre-cuenta toma de la sucursal y del momento de la impresión. */
export interface ContextoDePrecuenta {
  /** Nombre de la sucursal. */
  sucursal: string;
  /** Hora de emisión ya formateada en la hora local de la sucursal ("20:15"). */
  hora: string;
}

/**
 * Con tantos bloques los modificadores de cada producto se juntan en pocas líneas y, si aun así son muchos, se
 * omiten (el precio ya los incluye): así el documento nunca pasa el máximo de bloques.
 */
const BLOQUES_PARA_COMPACTAR = MAXIMO_BLOQUES_TICKET - 20;

function armar(
  precuenta: PrecuentaParaTicket,
  contexto: ContextoDePrecuenta,
  nivel: 'completo' | 'compacto' | 'sin-modificadores',
): BloqueTicket[] {
  const mesas = precuenta.orden.mesas.map((m) => m.nombre);
  const bloques: BloqueTicket[] = [
    { tipo: 'titulo', texto: limpiarTexto(contexto.sucursal) },
    { tipo: 'titulo', texto: `PRE-CUENTA N.º ${precuenta.numero}` },
    { tipo: 'linea', texto: descripcionDeMesas(mesas) },
    {
      tipo: 'columnas',
      izquierda: limpiarTexto(`Mozo: ${precuenta.orden.mozo.nombre}`),
      derecha: limpiarTexto(contexto.hora),
    },
    { tipo: 'linea', texto: `Comensales: ${precuenta.orden.comensales}` },
    { tipo: 'regla', caracter: '-' },
  ];
  for (const l of precuenta.lineas) {
    const modificadores = l.modificadores.map(limpiarTexto).filter((m) => m.length > 0);
    bloques.push({
      tipo: 'columnas',
      izquierda: limpiarTexto(`${l.cantidad} × ${l.nombre}`),
      derecha: formatoMonto(l.total),
    });
    for (const texto of nivel === 'completo'
      ? modificadores
      : nivel === 'compacto'
        ? juntarEnLineas(modificadores)
        : []) {
      bloques.push({ tipo: 'linea', texto, sangria: 2 });
    }
  }
  bloques.push(
    { tipo: 'regla', caracter: '=' },
    {
      tipo: 'linea',
      texto: `TOTAL S/ ${formatoMonto(precuenta.total)}`,
      negrita: true,
      alinear: 'derecha',
    },
    { tipo: 'espacio' },
    { tipo: 'linea', texto: limpiarTexto(precuenta.nota) },
  );
  return bloques;
}

export function documentoDePrecuenta(
  precuenta: PrecuentaParaTicket,
  contexto: ContextoDePrecuenta,
): DocumentoTicket {
  let bloques = armar(precuenta, contexto, 'completo');
  if (bloques.length > BLOQUES_PARA_COMPACTAR) bloques = armar(precuenta, contexto, 'compacto');
  if (bloques.length > BLOQUES_PARA_COMPACTAR) {
    bloques = armar(precuenta, contexto, 'sin-modificadores');
  }
  return { version: VERSION_DOCUMENTO_TICKET, tipo: 'PRECUENTA', bloques };
}
