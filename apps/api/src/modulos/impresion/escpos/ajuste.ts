/**
 * Ajuste de texto al ancho del papel (criterio 123): todo se mide en columnas de la fuente A, un carácter por
 * columna. Trabaja sobre texto ya adaptado al juego de caracteres (`adaptarTexto`), donde cada carácter ocupa una
 * columna.
 */

/**
 * Parte un texto en líneas de hasta `ancho` columnas sin partir palabras; una palabra más larga que la línea se
 * corta en trozos. `anchoResto` es el de las líneas después de la primera (por defecto, el mismo). Los espacios
 * repetidos se juntan. Un texto vacío da una sola línea vacía.
 */
export function partirEnLineas(texto: string, ancho: number, anchoResto: number = ancho): string[] {
  const palabras = texto.split(/\s+/).filter((p) => p.length > 0);
  if (palabras.length === 0) return [''];
  const lineas: string[] = [];
  let actual = '';
  const limite = (): number => Math.max(1, lineas.length === 0 ? ancho : anchoResto);
  for (let palabra of palabras) {
    while (palabra.length > limite()) {
      // Una palabra que no cabe ni sola en una línea: se completa la línea en curso si queda lugar y se corta.
      if (actual.length > 0) {
        lineas.push(actual);
        actual = '';
      }
      const n = limite();
      lineas.push(palabra.slice(0, n));
      palabra = palabra.slice(n);
    }
    if (palabra.length === 0) continue;
    if (actual.length === 0) actual = palabra;
    else if (actual.length + 1 + palabra.length <= limite()) actual += ` ${palabra}`;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual.length > 0) lineas.push(actual);
  return lineas;
}

/** El texto relleno con espacios a la derecha hasta `ancho`. */
export function rellenarDerecha(texto: string, ancho: number): string {
  return texto + ' '.repeat(Math.max(0, ancho - texto.length));
}

/** El texto relleno con espacios a la izquierda hasta `ancho` (alineado a la derecha). */
export function rellenarIzquierda(texto: string, ancho: number): string {
  return ' '.repeat(Math.max(0, ancho - texto.length)) + texto;
}

/** El texto centrado en `ancho` columnas con `relleno` a los lados (el sobrante, a la derecha). */
export function centrarCon(texto: string, ancho: number, relleno: string): string {
  const falta = Math.max(0, ancho - texto.length);
  const izquierda = Math.floor(falta / 2);
  return relleno.repeat(izquierda) + texto + relleno.repeat(falta - izquierda);
}

/**
 * Una línea con `izquierda` y `derecha`: la derecha queda pegada al borde. Si no caben juntas, la derecha va en
 * la primera línea y la izquierda continúa en las siguientes (con la primera más corta); si la derecha es tan
 * larga que una palabra de la izquierda no cabe a su lado, la izquierda va primero y la derecha, sola y
 * alineada, al final.
 *
 * Con `derechaAlFinal`, si no caben juntas la izquierda sale completa, en líneas seguidas, y la derecha queda
 * alineada al borde en la última línea (si le cabe) o sola en una línea más: el texto de la izquierda no se
 * interrumpe con la derecha (un nombre largo de la pre-cuenta se lee de corrido y su monto cierra el renglón).
 */
export function armarColumnas(
  izquierda: string,
  derecha: string,
  columnas: number,
  derechaAlFinal = false,
): string[] {
  if (derechaAlFinal && derecha.length > 0 && izquierda.length > 0) {
    if (izquierda.length + 1 + derecha.length <= columnas) {
      return [rellenarDerecha(izquierda, columnas - derecha.length) + derecha];
    }
    const lineas = partirEnLineas(izquierda, columnas);
    const ultima = lineas[lineas.length - 1]!;
    const abajo = partirEnLineas(derecha, columnas).map((l) => rellenarIzquierda(l, columnas));
    if (abajo.length === 1 && ultima.length + 1 + derecha.length <= columnas) {
      return [...lineas.slice(0, -1), rellenarDerecha(ultima, columnas - derecha.length) + derecha];
    }
    return [...lineas, ...abajo];
  }
  const lugarIzquierda = columnas - derecha.length - 1;
  if (derecha.length === 0) return partirEnLineas(izquierda, columnas);
  const palabraMasLarga = Math.max(0, ...izquierda.split(/\s+/).map((p) => p.length));
  if (lugarIzquierda < 1 || palabraMasLarga > lugarIzquierda) {
    const arriba = izquierda.length === 0 ? [] : partirEnLineas(izquierda, columnas);
    const abajo = partirEnLineas(derecha, columnas).map((l) => rellenarIzquierda(l, columnas));
    return [...arriba, ...abajo];
  }
  const partes = partirEnLineas(izquierda, lugarIzquierda, columnas);
  const [primera, ...resto] = partes;
  return [rellenarDerecha(primera ?? '', columnas - derecha.length) + derecha, ...resto];
}
