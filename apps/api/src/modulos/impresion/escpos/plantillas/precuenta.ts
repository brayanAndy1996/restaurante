import {
  VERSION_DOCUMENTO_TICKET,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { ajustarAlPresupuesto } from './presupuesto';
import { formatoMonto, juntarEnLineas, limpiarTexto, lineasDeMesas } from './texto';

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

function encabezadoDe(
  precuenta: PrecuentaParaTicket,
  contexto: ContextoDePrecuenta,
): BloqueTicket[] {
  const mesas = precuenta.orden.mesas.map((m) => m.nombre);
  return [
    { tipo: 'titulo', texto: limpiarTexto(contexto.sucursal) },
    { tipo: 'titulo', texto: `PRE-CUENTA N.º ${precuenta.numero}` },
    ...lineasDeMesas(mesas, false).map((texto): BloqueTicket => ({ tipo: 'linea', texto })),
    {
      tipo: 'columnas',
      izquierda: limpiarTexto(`Mozo: ${precuenta.orden.mozo.nombre}`),
      derecha: limpiarTexto(contexto.hora),
    },
    { tipo: 'linea', texto: `Comensales: ${precuenta.orden.comensales}` },
    { tipo: 'regla', caracter: '-' },
  ];
}

function pieDe(precuenta: PrecuentaParaTicket): BloqueTicket[] {
  return [
    { tipo: 'regla', caracter: '=' },
    {
      tipo: 'linea',
      texto: `TOTAL S/ ${formatoMonto(precuenta.total)}`,
      negrita: true,
      alinear: 'derecha',
    },
    { tipo: 'espacio' },
    { tipo: 'linea', texto: limpiarTexto(precuenta.nota) },
  ];
}

/** Las líneas de la cuenta, con todos los modificadores, con ellos juntos en pocas líneas, o sin ellos. */
function cuerpoDe(
  precuenta: PrecuentaParaTicket,
  nivel: 'completo' | 'compacto' | 'sin-modificadores',
): BloqueTicket[] {
  const bloques: BloqueTicket[] = [];
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
  return bloques;
}

/** Último recurso: cada línea con su monto en un texto ("2 × Pizza  S/ 42.00"), rellenando cada línea del ticket. */
function cuerpoEmpaquetado(precuenta: PrecuentaParaTicket): BloqueTicket[] {
  return juntarEnLineas(
    precuenta.lineas.map(
      (l) => `${limpiarTexto(`${l.cantidad} × ${l.nombre}`)}  ${formatoMonto(l.total)}`,
    ),
    ' | ',
  ).map((texto): BloqueTicket => ({ tipo: 'linea', texto }));
}

export function documentoDePrecuenta(
  precuenta: PrecuentaParaTicket,
  contexto: ContextoDePrecuenta,
): DocumentoTicket {
  // Nunca pasa de `PRESUPUESTO_DE_BLOQUES`: los modificadores se juntan, luego se omiten (el precio ya los
  // incluye) y, en una cuenta de miles de líneas, cada línea y su monto van en un texto. El total siempre sale.
  const bloques = ajustarAlPresupuesto(
    encabezadoDe(precuenta, contexto),
    [
      () => cuerpoDe(precuenta, 'completo'),
      () => cuerpoDe(precuenta, 'compacto'),
      () => cuerpoDe(precuenta, 'sin-modificadores'),
      () => cuerpoEmpaquetado(precuenta),
    ],
    pieDe(precuenta),
  );
  return { version: VERSION_DOCUMENTO_TICKET, tipo: 'PRECUENTA', bloques };
}
