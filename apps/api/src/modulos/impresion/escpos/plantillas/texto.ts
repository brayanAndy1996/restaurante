import { LARGO_TEXTO_TICKET, type BloqueTicket } from '@restaurante/contratos';

/**
 * Ayudas de las plantillas: dejan los textos del usuario (nombres, observaciones, motivos) en lo que acepta el
 * documento lógico (`documentoTicketSchema`): una sola línea por bloque, sin caracteres de control, sin
 * sustitutos sueltos y de hasta `LARGO_TEXTO_TICKET` caracteres.
 *
 * Un texto que pasa de ese largo nunca se recorta: `partirTexto` lo reparte en varias líneas y `aLargoValido`
 * lo hace con todos los bloques de un documento, así ninguna plantilla produce un documento que el renderizador
 * rechace por el largo de un texto (falla F2 y F7 de la ronda 1 del ataque).
 */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;
const SUSTITUTO_SUELTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Un texto apto para un bloque: sin saltos de línea ni controles y con los espacios juntos. No lo recorta. */
export function limpiarTexto(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  return valor.replace(SUSTITUTO_SUELTO, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Reparte un texto limpio en trozos de hasta `maximo` unidades de texto (el largo que mide el esquema del
 * documento), cortando en el último espacio que cabe y, si no hay ninguno, en el máximo sin partir un par de
 * sustitutos. Con un texto vacío devuelve `['']`. Unidos con un espacio, los trozos dan el texto original.
 */
export function partirTexto(texto: string, maximo = LARGO_TEXTO_TICKET): string[] {
  if (texto.length <= maximo) return [texto];
  const trozos: string[] = [];
  let resto = texto;
  while (resto.length > maximo) {
    let corte = resto.lastIndexOf(' ', maximo);
    if (corte <= 0) {
      corte = maximo;
      // No se parte un par de sustitutos (un emoji): el corte retrocede una unidad.
      const anterior = resto.charCodeAt(corte - 1);
      if (anterior >= 0xd800 && anterior <= 0xdbff) corte -= 1;
      trozos.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    } else {
      trozos.push(resto.slice(0, corte));
      resto = resto.slice(corte + 1);
    }
  }
  if (resto.length > 0) trozos.push(resto);
  return trozos;
}

const MONTO = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Un monto guardado como texto ("1234.5") con miles y al menos dos decimales ("1,234.50"). Es solo formato: no
 * redondea ni hace cuentas, así que lo que se imprime es exactamente lo guardado. Un texto que no es un monto se
 * deja como está.
 */
export function formatoMonto(monto: string): string {
  const partes = MONTO.exec(monto.trim());
  if (partes === null) return limpiarTexto(monto);
  const [, signo, entero, decimales] = partes;
  const miles = entero!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}${miles}.${(decimales ?? '').padEnd(2, '0')}`;
}

function nombresDeMesas(nombres: readonly string[]): string[] {
  return nombres.map((n) => limpiarTexto(n).replace(/^mesa\s+/i, '')).filter((n) => n.length > 0);
}

/**
 * "Mesa 4", "Mesas 4 + 5" o "Sin mesa" (en mayúsculas si se pide), repartido en las líneas necesarias para que
 * ninguna pase del máximo de un bloque, cortando entre mesa y mesa. Cada mesa se limpia como cualquier texto y
 * pierde el "Mesa " con que se haya nombrado.
 */
export function lineasDeMesas(nombres: readonly string[], mayusculas: boolean): string[] {
  const limpios = nombresDeMesas(nombres);
  if (limpios.length === 0) return [mayusculas ? 'SIN MESA' : 'Sin mesa'];
  const palabra = limpios.length === 1 ? 'Mesa' : 'Mesas';
  const [primera, ...otras] = limpios;
  const lineas = juntarEnLineas([`${palabra} ${primera}`, ...otras], ' + ');
  return mayusculas ? lineas.map((l) => l.toUpperCase()) : lineas;
}

/**
 * Junta textos con `separador` en las líneas necesarias para que ninguna pase de `LARGO_TEXTO_TICKET` (el máximo
 * de un bloque), sin perder ninguno. Un texto que solo ya pasa del máximo se parte con `partirTexto`.
 */
export function juntarEnLineas(textos: readonly string[], separador = ', '): string[] {
  const lineas: string[] = [];
  let actual = '';
  for (const texto of textos) {
    for (const trozo of partirTexto(texto)) {
      if (actual.length === 0) actual = trozo;
      else if (actual.length + separador.length + trozo.length <= LARGO_TEXTO_TICKET) {
        actual += separador + trozo;
      } else {
        lineas.push(actual);
        actual = trozo;
      }
    }
  }
  if (actual.length > 0) lineas.push(actual);
  return lineas;
}

/** Cuánto más se corre la sangría de las líneas de continuación de un texto partido. */
const SANGRIA_DE_CONTINUACION = 2;
const SANGRIA_MAXIMA = 8;

/**
 * Una copia de los bloques en la que todo texto de más de `LARGO_TEXTO_TICKET` caracteres está repartido en
 * varios bloques con el mismo estilo (nada se recorta). Las líneas de continuación de un `linea` alineado a la
 * izquierda llevan dos columnas más de sangría; de un `columnas`, la izquierda larga sigue en líneas debajo y la
 * derecha larga, en líneas alineadas a la derecha.
 */
export function aLargoValido(bloques: readonly BloqueTicket[]): BloqueTicket[] {
  const salida: BloqueTicket[] = [];
  for (const bloque of bloques) {
    switch (bloque.tipo) {
      case 'titulo':
        for (const texto of partirTexto(bloque.texto)) salida.push({ ...bloque, texto });
        break;
      case 'marca':
        for (const texto of partirTexto(bloque.texto)) salida.push({ ...bloque, texto });
        break;
      case 'linea': {
        const [primero, ...resto] = partirTexto(bloque.texto);
        salida.push({ ...bloque, texto: primero! });
        const izquierda = bloque.alinear === undefined || bloque.alinear === 'izquierda';
        const sangria = izquierda
          ? Math.min((bloque.sangria ?? 0) + SANGRIA_DE_CONTINUACION, SANGRIA_MAXIMA)
          : bloque.sangria;
        for (const texto of resto) {
          salida.push({ ...bloque, texto, ...(sangria === undefined ? {} : { sangria }) });
        }
        break;
      }
      case 'columnas': {
        const [izq, ...restoIzq] = partirTexto(bloque.izquierda);
        const [der, ...restoDer] = partirTexto(bloque.derecha);
        const estilo = {
          ...(bloque.negrita === undefined ? {} : { negrita: bloque.negrita }),
          ...(bloque.dobleAlto === undefined ? {} : { dobleAlto: bloque.dobleAlto }),
        };
        if (bloque.derechaAlFinal === true && restoIzq.length > 0) {
          // La izquierda pasa del máximo de un bloque: sus trozos van seguidos y la derecha acompaña al último.
          const trozos = [izq!, ...restoIzq];
          trozos.slice(0, -1).forEach((texto, i) => {
            salida.push({
              tipo: 'linea',
              texto,
              ...(i === 0 ? {} : { sangria: SANGRIA_DE_CONTINUACION }),
              ...estilo,
            });
          });
          salida.push({ ...bloque, izquierda: trozos[trozos.length - 1]!, derecha: der! });
        } else {
          salida.push({ ...bloque, izquierda: izq!, derecha: der! });
          for (const texto of restoIzq) {
            salida.push({ tipo: 'linea', texto, sangria: SANGRIA_DE_CONTINUACION, ...estilo });
          }
        }
        for (const texto of restoDer) {
          salida.push({ tipo: 'linea', texto, alinear: 'derecha', ...estilo });
        }
        break;
      }
      default:
        salida.push(bloque);
    }
  }
  return salida;
}
