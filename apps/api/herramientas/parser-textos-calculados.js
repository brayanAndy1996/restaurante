// Parser de ESLint para el código de `src/`: el de typescript-eslint, más un paso que calcula los
// textos que se pueden conocer sin ejecutar nada, antes de que corran las reglas.
//
// Motivo (criterio 22c): las reglas `no-restricted-syntax` miran literales sueltos. Quien escribiera
// `'app.' + 'empresa_id'` o `` `app.${'empresa_id'}` `` esquivaría la regla del texto `app.empresa_id`
// (o la de la ruta de la conexión de plataforma, en `import('../conexion-' + 'plataforma')`). Aquí cada
// concatenación con `+` y cada plantilla cuyos componentes son todos literales se reemplaza, en el
// árbol, por un único literal con el texto resultante; así las mismas reglas lo ven completo. Lo mismo
// pasa con `.concat()` sobre un literal de texto (uno o varios argumentos, también en cadena) y con
// `.join()` sobre un arreglo de literales (separador literal o, sin argumento, la coma), criterio 37c.
// Lo que depende de una variable o de una llamada distinta no se puede calcular y se deja como está.
const { parser: parserTypescript } = require('typescript-eslint');

/** Nombre del método de una llamada `objeto.metodo(...)` o `objeto['metodo'](...)`, o `undefined`. */
function nombreDeMetodo(llamada) {
  const callee = llamada.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.optional) return undefined;
  if (!callee.computed)
    return callee.property.type === 'Identifier' ? callee.property.name : undefined;
  const clave = valorEstatico(callee.property);
  return typeof clave === 'string' ? clave : undefined;
}

/** Valor de `'a'.concat('b', 'c')` o de `['a', 'b'].join('.')` formados solo por literales. */
function valorDeLlamada(llamada) {
  const metodo = nombreDeMetodo(llamada);
  const objeto = llamada.callee.object;
  const argumentos = llamada.arguments;
  if (metodo === 'concat') {
    const base = valorEstatico(objeto);
    if (typeof base !== 'string') return undefined;
    let texto = base;
    for (const argumento of argumentos) {
      const valor = valorEstatico(argumento);
      if (valor === undefined) return undefined;
      texto += String(valor);
    }
    return texto;
  }
  if (metodo === 'join') {
    const base = valorDeArreglo(objeto);
    if (base === undefined || argumentos.length > 1) return undefined;
    let separador = ',';
    if (argumentos.length === 1) {
      const valor = valorEstatico(argumentos[0]);
      if (valor === undefined) return undefined;
      separador = String(valor);
    }
    return base.map(String).join(separador);
  }
  return undefined;
}

/** Elementos de un arreglo formado solo por literales (sin huecos ni `...`), o `undefined`. */
function valorDeArreglo(nodo) {
  if (
    nodo.type === 'TSAsExpression' ||
    nodo.type === 'TSNonNullExpression' ||
    nodo.type === 'TSSatisfiesExpression'
  ) {
    return valorDeArreglo(nodo.expression);
  }
  if (nodo.type !== 'ArrayExpression') return undefined;
  const valores = [];
  for (const elemento of nodo.elements) {
    if (elemento === null) return undefined;
    const valor = valorEstatico(elemento);
    if (valor === undefined) return undefined;
    valores.push(valor);
  }
  return valores;
}

/** Valor `string | number` de una expresión formada solo por literales, o `undefined`. */
function valorEstatico(nodo) {
  switch (nodo.type) {
    case 'Literal':
      return typeof nodo.value === 'string' || typeof nodo.value === 'number'
        ? nodo.value
        : undefined;
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return valorEstatico(nodo.expression);
    case 'TemplateLiteral': {
      let texto = nodo.quasis[0].value.cooked;
      if (typeof texto !== 'string') return undefined;
      for (let i = 0; i < nodo.expressions.length; i += 1) {
        const parte = valorEstatico(nodo.expressions[i]);
        const cola = nodo.quasis[i + 1].value.cooked;
        if (parte === undefined || typeof cola !== 'string') return undefined;
        texto += String(parte) + cola;
      }
      return texto;
    }
    case 'CallExpression':
      return nodo.optional ? undefined : valorDeLlamada(nodo);
    case 'BinaryExpression': {
      if (nodo.operator !== '+') return undefined;
      const izquierda = valorEstatico(nodo.left);
      const derecha = valorEstatico(nodo.right);
      if (izquierda === undefined || derecha === undefined) return undefined;
      // Dos números se suman; si alguno es texto, se concatenan.
      return typeof izquierda === 'number' && typeof derecha === 'number'
        ? izquierda + derecha
        : String(izquierda) + String(derecha);
    }
    default:
      return undefined;
  }
}

/** Si la expresión es una concatenación, plantilla, `concat` o `join` de literales, la vuelve un solo `Literal`. */
function plegar(nodo) {
  const esConcatenacion = nodo.type === 'BinaryExpression';
  const esLlamada = nodo.type === 'CallExpression';
  const esPlantillaConPartes = nodo.type === 'TemplateLiteral' && nodo.expressions.length > 0;
  if (!esConcatenacion && !esLlamada && !esPlantillaConPartes) return;
  const valor = valorEstatico(nodo);
  if (typeof valor !== 'string') return;
  const { range, loc } = nodo;
  const parent = nodo.parent;
  for (const clave of Object.keys(nodo)) delete nodo[clave];
  Object.assign(nodo, { type: 'Literal', value: valor, raw: JSON.stringify(valor), range, loc });
  if (parent) nodo.parent = parent;
}

function recorrer(nodo, clavesDeVisita) {
  const claves = clavesDeVisita[nodo.type] ?? [];
  for (const clave of claves) {
    const hijo = nodo[clave];
    if (Array.isArray(hijo)) {
      for (const elemento of hijo)
        if (elemento && typeof elemento.type === 'string') recorrer(elemento, clavesDeVisita);
    } else if (hijo && typeof hijo.type === 'string') {
      recorrer(hijo, clavesDeVisita);
    }
  }
  plegar(nodo);
}

function parseForESLint(codigo, opciones) {
  const resultado = parserTypescript.parseForESLint(codigo, opciones);
  recorrer(resultado.ast, resultado.visitorKeys ?? {});
  return resultado;
}

module.exports = {
  meta: { name: 'parser-textos-calculados', version: '1.0.0' },
  parseForESLint,
  parse: (codigo, opciones) => parseForESLint(codigo, opciones).ast,
};
