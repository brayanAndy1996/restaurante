/**
 * Detección de sentencias que controlan la transacción o la sesión (criterios 32b y 22b). En la
 * conexión de plataforma el código de `fn` nunca puede confirmar, revertir ni reabrir la transacción:
 * eso lo hace solo `OperacionPlataforma`; en la de la API, solo `ContextoEmpresa.ejecutar`. Además de `COMMIT`/`ROLLBACK`/`END`/`ABORT` se rechazan
 * `SAVEPOINT`, `RELEASE`, `BEGIN`, `START`, `PREPARE`/`COMMIT PREPARED` y `SET`/`RESET`/`DISCARD`/
 * `DO` (los dos últimos cambian la sesión, por ejemplo la lectura de cadenas, y servirían para
 * esconder una de las anteriores).
 *
 * El texto se examina sin comentarios ni literales (cadenas, identificadores entre comillas y
 * cadenas con `$$`), y por sentencia: un valor como `'COMMIT'` no es una sentencia, pero
 * `UPDATE …; COMMIT` en un mismo texto sí. Si el texto tiene un literal o comentario sin cerrar, se
 * rechaza (no se puede saber dónde termina).
 */
import { NOMBRE_FUNCION_FIJAR_CONTEXTO } from '../fijar-contexto';

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

/** Carácter que puede formar parte de un identificador de PostgreSQL (`ident_cont` y `$`). */
const CARACTER_DE_IDENTIFICADOR = /[A-Za-z0-9_\u0080-￿$]/;

/** Delimitador de dólar-comillas (`dolqdelim`): la etiqueta no empieza con dígito ni contiene `$`. */
const DELIMITADOR_DOLAR = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;

/** Resultado de `analizar`: el texto sin literales ni comentarios, y esa misma versión con nombres. */
interface Analisis {
  /** Comentarios, cadenas, identificadores entre comillas y cadenas `$$` reemplazados por un espacio. */
  limpio: string;
  /**
   * Igual que `limpio`, pero el contenido de un identificador entre comillas (`"set_config"`) se deja
   * en el texto, porque nombra un objeto y no es un valor: así no sirve para esconder una función.
   * `null` si hay un identificador con escapes Unicode (`U&"…"`), que no se puede leer sin
   * interpretarlo.
   */
  conNombres: string | null;
}

/**
 * Examina el texto igual que el escáner léxico de PostgreSQL 16 (`scan.l`) y devuelve `null` si algún
 * comentario o literal queda sin cerrar o si algo se leería distinto según un ajuste de la sesión.
 * Cualquier diferencia con PostgreSQL deja que la guarda vea algo distinto de lo que se ejecuta, así que
 * ante la duda se rechaza. Reglas que se siguen:
 *
 * - Un comentario `--` termina en `\n` **o** `\r` (`newline [\n\r]`). los de bloque se anidan, y `**` seguido
 *   de `/` también cierra. Ambos pueden empezar en medio de una secuencia de operadores (`+--x`).
 * - Cadenas `'…'`: `''` es una comilla. Solo `E'…'`/`e'…'` (la `E` no puede ser el final de otro
 *   identificador: `typeE'…'` no lleva escapes) interpreta `\` (`\\`, `\'`, …). `U&'…'`, `N'…'`, `B'…'` y
 *   `X'…'` se leen como una cadena normal; el `UESCAPE` de `U&'…'` se aplica después de leer y no cambia
 *   dónde termina el literal. `'a'` + salto de línea + `'b'` son dos literales para esta guarda
 *   (PostgreSQL los une): no cambia nada porque ambos se reemplazan por un espacio.
 * - SUPUESTO: `standard_conforming_strings = on` (el valor por defecto; la guarda impide cambiarlo con
 *   `SET`). Con `off`, `'\'` seguiría abierta. Para no depender de ello, una cadena que no es `E` y
 *   tiene `\` justo antes de una comilla (`'\'`, `'\''`) se rechaza: es el único caso en que ambos modos
 *   la leen distinto.
 * - Identificadores `"…"`: `""` es una comilla. Un `U&"…"` hace que `conNombres` sea `null`.
 * - Dólar-comillas `$etiqueta$…$etiqueta$`: la etiqueta no empieza con dígito (`$1` es un parámetro) y
 *   el `$` de apertura no sigue a un carácter de identificador (`a$$b$$` es un identificador). Se cierra
 *   con la primera aparición de la misma etiqueta: en PostgreSQL toda `$` empieza una lectura nueva,
 *   así que buscarla como subcadena es equivalente.
 * - El carácter anterior se mira en el texto ya limpio, no en el original: tras `$a$…$a$E'…'` o
 *   tras un comentario de bloque la `E` empieza una cadena nueva.
 */
function analizarSinCache(texto: string): Analisis | null {
  let limpio = '';
  let conNombres: string | null = '';
  const emitir = (plano: string, conNombre: string = plano): void => {
    limpio += plano;
    if (conNombres !== null) conNombres += conNombre;
  };
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i]!;
    const siguiente = texto[i + 1];
    if (c === '-' && siguiente === '-') {
      // Termina en `\n` o `\r`; ese carácter queda en el texto y se emite como el espacio que es.
      let fin = i + 2;
      while (fin < n && texto[fin] !== '\n' && texto[fin] !== '\r') fin += 1;
      emitir(' ');
      i = fin;
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
      emitir(' ');
    } else if (c === "'") {
      const previo = limpio[limpio.length - 1];
      const antes = limpio[limpio.length - 2];
      const conEscapes =
        (previo === 'E' || previo === 'e') &&
        !(antes !== undefined && CARACTER_DE_IDENTIFICADOR.test(antes));
      let j = i + 1;
      let cerrada = false;
      while (j < n) {
        const actual = texto[j];
        if (actual === '\\') {
          // Un par de barras se lee igual con y sin standard_conforming_strings; una barra sola antes
          // de una comilla, no.
          if (conEscapes || texto[j + 1] === '\\') j += 2;
          else if (texto[j + 1] === "'") return null;
          else j += 1;
        } else if (actual === "'") {
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
      emitir(' ');
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
      if (/U&$/i.test(texto.slice(Math.max(0, i - 2), i))) {
        conNombres = null;
        limpio += ' ';
      } else {
        emitir(' ', ` ${texto.slice(i + 1, j)} `);
      }
      i = j + 1;
    } else if (c === '$') {
      const previo = limpio[limpio.length - 1];
      const dentroDeIdentificador = previo !== undefined && CARACTER_DE_IDENTIFICADOR.test(previo);
      DELIMITADOR_DOLAR.lastIndex = i;
      const etiqueta = dentroDeIdentificador ? null : DELIMITADOR_DOLAR.exec(texto);
      if (etiqueta) {
        const marca = etiqueta[0];
        const fin = texto.indexOf(marca, i + marca.length);
        if (fin === -1) return null;
        emitir(' ');
        i = fin + marca.length;
      } else {
        emitir(c);
        i += 1;
      }
    } else {
      emitir(c);
      i += 1;
    }
  }
  return { limpio, conNombres };
}

let ultimoTexto: string | undefined;
let ultimoAnalisis: Analisis | null = null;

/**
 * Como `analizarSinCache`, pero recuerda el último texto: la guarda de la API hace tres comprobaciones
 * seguidas sobre la misma consulta y así se examina una sola vez (la función es síncrona).
 */
function analizar(texto: string): Analisis | null {
  if (texto !== ultimoTexto) {
    ultimoAnalisis = analizarSinCache(texto);
    ultimoTexto = texto;
  }
  return ultimoAnalisis;
}

/**
 * `true` si el texto tiene alguna sentencia de control de transacción o de sesión, o si no se puede
 * analizar con certeza.
 */
export function contieneControlDeTransaccion(texto: string): boolean {
  const analisis = analizar(texto);
  if (analisis === null) return true;
  for (const sentencia of analisis.limpio.split(';')) {
    // Los paréntesis y espacios iniciales no cambian la sentencia que viene después. `\s` incluye todo
    // lo que PostgreSQL toma por espacio (`[ \t\n\r\f\v]`) y algo más (por ejemplo U+00A0): leer de más es
    // rechazar de más.
    const palabra = /^[\s(]*([A-Za-z]+)/.exec(sentencia)?.[1];
    if (palabra !== undefined && PALABRAS_DE_CONTROL.has(palabra.toUpperCase())) return true;
  }
  return false;
}

/**
 * Nombres completos que la guarda rechaza fuera de literales y comentarios (criterios 22b, 22d, 22e y
 * 38e), sin distinguir mayúsculas y con o sin esquema (`pg_catalog.lo_get`) o entre comillas dobles.
 * Se rechaza si el carácter anterior y el siguiente no son de identificador, así que `reset_config` o
 * `pg_stat_activity_x` son otros identificadores y pasan.
 *
 * - Cambiar el contexto o ejecutar SQL armado como texto: `set_config`, `pg_settings` (un `UPDATE`
 *   equivale a `set_config`), `ts_rewrite`, `ts_stat` y la fijación del contexto
 *   (`fijar_contexto_empresa`, salvo la fijación propia de `ContextoEmpresa`, que la guarda reconoce
 *   por su origen antes de llegar aquí).
 * - Texto de consultas y sesiones ajenas (38b y 38c): `pg_stat_activity`, `pg_stat_get_activity`,
 *   `pg_cancel_backend`, `pg_terminate_backend` y `pg_signal_backend`.
 * - Objetos grandes (38d): `pg_largeobject`, `pg_largeobject_metadata`, `loread` y `lowrite`.
 *
 * Donde no hay superusuario (producción, criterio 38e) las revocaciones de `pg_catalog` no existen y
 * esta lista, aplicada en la guarda de la API y en la de plataforma, es la barrera de esos objetos.
 */
export const NOMBRES_PROHIBIDOS: readonly string[] = [
  'set_config',
  'pg_settings',
  'ts_rewrite',
  'ts_stat',
  NOMBRE_FUNCION_FIJAR_CONTEXTO,
  'pg_stat_activity',
  'pg_stat_get_activity',
  'pg_cancel_backend',
  'pg_terminate_backend',
  'pg_signal_backend',
  'pg_largeobject',
  'pg_largeobject_metadata',
  'loread',
  'lowrite',
];

/**
 * Prefijos prohibidos: se rechaza todo identificador que empiece así (cualquier continuación cuenta);
 * solo se mira el carácter anterior. Son las familias de funciones de `pg_catalog` de las que no se
 * quiere ni una firma: `pg_stat_get_backend_*` (enumeran sesiones), `lo_*` (objetos grandes), y las
 * funciones `*_to_xml*` que ejecutan SQL recibido como texto (`query_to_xml`, `cursor_to_xml`) o leen
 * una relación nombrada dentro de un literal (`table_to_xml`, `schema_to_xml`, `database_to_xml`, con
 * sus variantes `*schema` y `*_and_xmlschema`). Convención: ninguna tabla, columna ni alias de la
 * aplicación empieza con `lo_`.
 */
export const PREFIJOS_PROHIBIDOS: readonly string[] = [
  'pg_stat_get_backend_',
  'lo_',
  'query_to_xml',
  'cursor_to_xml',
  'table_to_xml',
  'schema_to_xml',
  'database_to_xml',
];

const NO_IDENTIFICADOR_ANTES = '(?<![A-Za-z0-9_\\u0080-\\uffff$])';
const NO_IDENTIFICADOR_DESPUES = '(?![A-Za-z0-9_\\u0080-\\uffff$])';

/**
 * Mención de un nombre o prefijo prohibido, o del propio nombre del parámetro (`app.empresa_id`, con
 * espacios alrededor del punto, que PostgreSQL admite), en el texto ya limpio.
 */
const MENCION_DE_CONTEXTO = new RegExp(
  `${NO_IDENTIFICADOR_ANTES}(?:` +
    `(?:${NOMBRES_PROHIBIDOS.join('|')})${NO_IDENTIFICADOR_DESPUES}|` +
    `${PREFIJOS_PROHIBIDOS.join('|')}|` +
    'app\\s*\\.\\s*empresa_id)',
  'i',
);

/** `false` si el texto tiene un literal o comentario sin cerrar o algo que no se puede leer con certeza. */
export function esTextoAnalizable(texto: string): boolean {
  return analizar(texto) !== null;
}

/**
 * `true` si el texto, sin literales ni comentarios, nombra una función o un objeto de la lista de
 * `NOMBRES_PROHIBIDOS` y `PREFIJOS_PROHIBIDOS` (o el parámetro `app.empresa_id`), si tiene un
 * identificador con escapes Unicode (`U&"…"`) o si no se puede analizar con certeza. Un valor que contiene `set_config` (por ejemplo `'x; set y'` o un nombre de sucursal)
 * no cuenta: se decide sobre el texto limpio (criterio 22b).
 */
export function mencionaContextoDeEmpresa(texto: string): boolean {
  const analisis = analizar(texto);
  return (
    analisis === null ||
    analisis.conNombres === null ||
    MENCION_DE_CONTEXTO.test(analisis.conNombres)
  );
}

/**
 * Primeras palabras de sentencia que la guarda de la API deja pasar dentro de una transacción
 * autorizada (criterio 22d, lista blanca). Todo lo demás (`SET`, `RESET`, `ALTER`, `COPY`,
 * `PREPARE`, `EXECUTE`, `DECLARE`, `FETCH`, `LISTEN`, `NOTIFY`, `CALL`, `DO`, `LOCK`, `ANALYZE`,
 * `EXPLAIN`, `VACUUM`, `CREATE`, `GRANT`, `SHOW`…) se rechaza antes de llegar a la base.
 */
const PALABRAS_PERMITIDAS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'WITH',
  'VALUES',
  'TABLE',
]);

/**
 * `true` si el texto tiene alguna sentencia cuya primera palabra no está en la lista blanca, o si no
 * se puede analizar con certeza. Se examina sin comentarios ni literales y por sentencia (separadas
 * por `;`), de modo que `SELECT 1; LISTEN x` y un `SET` tras un comentario se rechazan y un valor como
 * `'SET x'` no cuenta. Los paréntesis de apertura iniciales (`(SELECT …)`) no cambian la sentencia.
 * Las sentencias vacías (un `;` final) se ignoran. Un texto sin ninguna sentencia se rechaza.
 */
export function contieneSentenciaNoPermitida(texto: string): boolean {
  const analisis = analizar(texto);
  if (analisis === null) return true;
  let hubo = false;
  for (const sentencia of analisis.limpio.split(';')) {
    if (sentencia.trim() === '') continue;
    hubo = true;
    const palabra = /^[\s(]*([A-Za-z]+)(?![A-Za-z0-9_$\u0080-\uffff])/.exec(sentencia)?.[1];
    if (palabra === undefined || !PALABRAS_PERMITIDAS.has(palabra.toUpperCase())) return true;
  }
  return !hubo;
}
