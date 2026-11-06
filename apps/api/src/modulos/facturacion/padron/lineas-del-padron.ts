/**
 * La lectura del texto del padrón reducido de RUC de SUNAT (historia 006, entrega 6b, criterio 138): ISO-8859-1 separado
 * por `|`, con las columnas
 * `RUC|NOMBRE O RAZÓN SOCIAL|ESTADO|CONDICIÓN|UBIGEO|TIPO DE VÍA|NOMBRE DE VÍA|CÓDIGO DE ZONA|TIPO DE ZONA|NÚMERO|INTERIOR|LOTE|DEPARTAMENTO|MANZANA|KILÓMETRO|`.
 * Funciones puras: no tocan la red ni la base.
 */

/** Una fila del padrón tal como se guarda en `referencia.padron_ruc_a` y `_b`. */
export interface FilaDelPadron {
  ruc: string;
  razonSocial: string;
  estado: string;
  condicion: string;
  /** Seis dígitos o `null` (el archivo trae `-` o algo que no es un ubigeo). */
  ubigeo: string | null;
  /** La dirección compuesta (con " - DISTRITO - PROVINCIA - DEPARTAMENTO" si el ubigeo está en el catálogo) o `null`. */
  direccion: string | null;
}

/** El nombre del distrito, la provincia y el departamento de un ubigeo del INEI. */
export interface LugarDeUbigeo {
  departamento: string;
  provincia: string;
  distrito: string;
}

/** Posición de cada columna del archivo (la 12, `DEPARTAMENTO`, es el número de departamento del domicilio y no se usa). */
const COLUMNA = {
  ruc: 0,
  razonSocial: 1,
  estado: 2,
  condicion: 3,
  ubigeo: 4,
  tipoDeVia: 5,
  nombreDeVia: 6,
  codigoDeZona: 7,
  tipoDeZona: 8,
  numero: 9,
  interior: 10,
  lote: 11,
  manzana: 13,
  kilometro: 14,
} as const;

const RUC_DE_11_DIGITOS = /^\d{11}$/;
const UBIGEO_DE_6_DIGITOS = /^\d{6}$/;

/** El valor de una columna: sin espacios en los bordes y con la marca `-` (sin dato) como vacío. */
function valor(campos: string[], posicion: number): string {
  const texto = (campos[posicion] ?? '').trim();
  return texto === '-' ? '' : texto;
}

/**
 * La dirección: tipo y nombre de vía, número, interior, lote, manzana, kilómetro, y la zona (`CÓDIGO DE ZONA` seguido de
 * `TIPO DE ZONA` tal como vienen: en el archivo real la primera trae el tipo, p. ej. `URB.`, y la segunda el nombre),
 * separados por espacios y con los prefijos de SUNAT. Sin ningún componente, `null`.
 */
export function componerDireccion(
  campos: string[],
  lugar: LugarDeUbigeo | undefined,
): string | null {
  const con = (prefijo: string, posicion: number): string => {
    const texto = valor(campos, posicion);
    return texto === '' ? '' : `${prefijo}${texto}`;
  };
  const componentes = [
    valor(campos, COLUMNA.tipoDeVia),
    valor(campos, COLUMNA.nombreDeVia),
    con('NRO. ', COLUMNA.numero),
    con('INT. ', COLUMNA.interior),
    con('LOTE ', COLUMNA.lote),
    con('MZA. ', COLUMNA.manzana),
    con('KM. ', COLUMNA.kilometro),
    valor(campos, COLUMNA.codigoDeZona),
    valor(campos, COLUMNA.tipoDeZona),
  ].filter((c) => c !== '');
  if (componentes.length === 0) return null;
  const calle = componentes.join(' ');
  return lugar === undefined
    ? calle
    : `${calle} - ${lugar.distrito} - ${lugar.provincia} - ${lugar.departamento}`;
}

/**
 * Convierte una línea del archivo en su fila, o `null` si no es un RUC de 11 dígitos (la cabecera, las líneas vacías y las
 * de otro formato se descartan).
 */
export function leerLinea(
  linea: string,
  ubigeos: ReadonlyMap<string, LugarDeUbigeo>,
): FilaDelPadron | null {
  // Un NUL no cabe en un texto de PostgreSQL: si el archivo trae alguno, se quita.
  const campos = (linea.includes('\0') ? linea.replaceAll('\0', '') : linea).split('|');
  const ruc = (campos[COLUMNA.ruc] ?? '').trim();
  if (!RUC_DE_11_DIGITOS.test(ruc)) return null;
  const textoUbigeo = valor(campos, COLUMNA.ubigeo);
  const ubigeo = UBIGEO_DE_6_DIGITOS.test(textoUbigeo) ? textoUbigeo : null;
  return {
    ruc,
    razonSocial: valor(campos, COLUMNA.razonSocial),
    estado: valor(campos, COLUMNA.estado),
    condicion: valor(campos, COLUMNA.condicion),
    ubigeo,
    direccion: componerDireccion(campos, ubigeo === null ? undefined : ubigeos.get(ubigeo)),
  };
}

/** El archivo trae una línea más larga de lo que cabe en cualquier fila del padrón: no es el archivo que se espera. */
export class LineaDemasiadoLargaError extends Error {
  constructor() {
    super('El archivo del padrón trae una línea demasiado larga');
    this.name = 'LineaDemasiadoLargaError';
  }
}

/** Largo máximo de una línea (las reales pasan de poco más de 300 caracteres). */
const LARGO_MAXIMO_DE_LINEA = 16_384;

/**
 * Parte en líneas, en flujo y sin guardar el archivo entero, los trozos de bytes de un texto ISO-8859-1 (cada byte es un
 * carácter, así que un trozo nunca corta un carácter por la mitad). Quita el `\r` del final.
 */
export async function* lineasDe(trozos: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let resto = '';
  for await (const trozo of trozos) {
    const texto = resto + trozo.toString('latin1');
    let inicio = 0;
    let salto = texto.indexOf('\n', inicio);
    while (salto !== -1) {
      const fin = salto > inicio && texto[salto - 1] === '\r' ? salto - 1 : salto;
      yield texto.slice(inicio, fin);
      inicio = salto + 1;
      salto = texto.indexOf('\n', inicio);
    }
    resto = texto.slice(inicio);
    if (resto.length > LARGO_MAXIMO_DE_LINEA) throw new LineaDemasiadoLargaError();
  }
  if (resto !== '') yield resto.endsWith('\r') ? resto.slice(0, -1) : resto;
}
