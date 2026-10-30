import {
  COLUMNAS_POR_ANCHO,
  VERSION_DOCUMENTO_TICKET,
  type AnchoPapelMm,
  type DocumentoTicket,
  type JuegoCaracteres,
} from '@restaurante/contratos';
import { limpiarTexto } from './texto';

/** La muestra de caracteres de la página de prueba (criterio 127). */
export const MUESTRA_DE_CARACTERES = 'áéíóú ÁÉÍÓÚ ñ Ñ ü ¿¡ S/ 1,234.50';

/** La impresora de la que se imprime la página de prueba. */
export interface ImpresoraDePrueba {
  nombre: string;
  anchoMm: AnchoPapelMm;
  juegoCaracteres: JuegoCaracteres;
}

/**
 * La página de prueba (criterio 127): el nombre de la impresora, el ancho, el juego de caracteres, una regla de
 * todo el ancho (32 o 48 columnas) y la muestra de caracteres con tildes, eñe, signos de apertura y un monto. Si
 * las tildes salen mal, se prueba otro juego de caracteres.
 */
export function documentoDePrueba(impresora: ImpresoraDePrueba): DocumentoTicket {
  return {
    version: VERSION_DOCUMENTO_TICKET,
    tipo: 'PRUEBA',
    bloques: [
      { tipo: 'titulo', texto: 'PÁGINA DE PRUEBA' },
      { tipo: 'linea', texto: limpiarTexto(`Impresora: ${impresora.nombre}`) },
      {
        tipo: 'linea',
        texto: `Ancho: ${impresora.anchoMm} mm (${COLUMNAS_POR_ANCHO[impresora.anchoMm]} columnas)`,
      },
      { tipo: 'linea', texto: `Juego de caracteres: ${impresora.juegoCaracteres}` },
      { tipo: 'regla', caracter: '=' },
      { tipo: 'linea', texto: MUESTRA_DE_CARACTERES },
      { tipo: 'regla', caracter: '=' },
    ],
  };
}
