/**
 * Detección de sentencias que controlan la transacción o la sesión (criterio 32b). En la conexión de
 * plataforma el código de `fn` nunca puede confirmar, revertir ni reabrir la transacción: eso lo
 * hace solo `OperacionPlataforma`. Además de `COMMIT`/`ROLLBACK`/`END`/`ABORT` se rechazan
 * `SAVEPOINT`, `RELEASE`, `BEGIN`, `START`, `PREPARE`/`COMMIT PREPARED` y `SET`/`RESET`/`DISCARD`/
 * `DO` (los dos últimos cambian la sesión, por ejemplo la lectura de cadenas, y servirían para
 * esconder una de las anteriores).
 *
 * El texto se examina sin comentarios ni literales (cadenas, identificadores entre comillas y
 * cadenas con `$$`), y por sentencia: un valor como `'COMMIT'` no es una sentencia, pero
 * `UPDATE …; COMMIT` en un mismo texto sí. Si el texto tiene un literal o comentario sin cerrar, se
 * rechaza (no se puede saber dónde termina).
 */

const PALABRAS_DE_CONTROL = new Set([
  'COMMIT',
  'ROLLBACK',
  'END',
  'ABORT',
  'SAVEPOINT',
  'RELEASE',
  'BEGIN',
  'START',
  'PREPARE',
  'SET',
  'RESET',
  'DISCARD',
  'DO',
]);

const CARACTER_DE_IDENTIFICADOR = /[A-Za-z0-9_\u0080-￿$]/;

/** Reemplaza comentarios y literales por un espacio. `null` si alguno queda sin cerrar. */
function quitarLiteralesYComentarios(texto: string): string | null {
  let salida = '';
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i]!;
    const siguiente = texto[i + 1];
    if (c === '-' && siguiente === '-') {
      const fin = texto.indexOf('\n', i);
      if (fin === -1) return `${salida} `;
      salida += ' ';
      i = fin + 1;
    } else if (c === '/' && siguiente === '*') {
      let nivel = 1;
      i += 2;
      while (i < n && nivel > 0) {
        if (texto[i] === '/' && texto[i + 1] === '*') {
          nivel += 1;
          i += 2;
        } else if (texto[i] === '*' && texto[i + 1] === '/') {
          nivel -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (nivel > 0) return null;
      salida += ' ';
    } else if (c === "'") {
      // Cadena con escapes de barra si va precedida por E/e que no es parte de otro identificador.
      const previo = texto[i - 1];
      const antes = texto[i - 2];
      const conEscapes =
        (previo === 'E' || previo === 'e') &&
        !(antes !== undefined && CARACTER_DE_IDENTIFICADOR.test(antes));
      let j = i + 1;
      let cerrada = false;
      while (j < n) {
        if (conEscapes && texto[j] === '\\') {
          j += 2;
        } else if (texto[j] === "'") {
          if (texto[j + 1] === "'") j += 2;
          else {
            cerrada = true;
            break;
          }
        } else {
          j += 1;
        }
      }
      if (!cerrada) return null;
      salida += ' ';
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      let cerrado = false;
      while (j < n) {
        if (texto[j] === '"') {
          if (texto[j + 1] === '"') j += 2;
          else {
            cerrado = true;
            break;
          }
        } else {
          j += 1;
        }
      }
      if (!cerrado) return null;
      salida += ' ';
      i = j + 1;
    } else if (c === '$') {
      const previo = texto[i - 1];
      const dentroDeIdentificador = previo !== undefined && CARACTER_DE_IDENTIFICADOR.test(previo);
      const etiqueta = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(texto.slice(i));
      if (!dentroDeIdentificador && etiqueta) {
        const marca = etiqueta[0];
        const fin = texto.indexOf(marca, i + marca.length);
        if (fin === -1) return null;
        salida += ' ';
        i = fin + marca.length;
      } else {
        salida += c;
        i += 1;
      }
    } else {
      salida += c;
      i += 1;
    }
  }
  return salida;
}

/**
 * `true` si el texto tiene alguna sentencia de control de transacción o de sesión, o si no se puede
 * analizar con certeza.
 */
export function contieneControlDeTransaccion(texto: string): boolean {
  const limpio = quitarLiteralesYComentarios(texto);
  if (limpio === null) return true;
  for (const sentencia of limpio.split(';')) {
    // Los paréntesis y espacios iniciales no cambian la sentencia que viene después.
    const palabra = /^[\s(]*([A-Za-z]+)/.exec(sentencia)?.[1];
    if (palabra !== undefined && PALABRAS_DE_CONTROL.has(palabra.toUpperCase())) return true;
  }
  return false;
}
