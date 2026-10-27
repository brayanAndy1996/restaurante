// Parser de ESLint para el código de `src/`: el de typescript-eslint, más un paso que calcula los
// textos que se pueden conocer sin ejecutar nada, antes de que corran las reglas.
//
// Motivo (criterio 22c): las reglas `no-restricted-syntax` miran literales sueltos. Quien escribiera
// `'app.' + 'empresa_id'` o `` `app.${'empresa_id'}` `` esquivaría la regla del texto `app.empresa_id`
// (o la de la ruta de la conexión de plataforma, en `import('../conexion-' + 'plataforma')`). Aquí cada
// concatenación con `+` y cada plantilla cuyos componentes son todos literales se reemplaza, en el
// árbol, por un único literal con el texto resultante; así las mismas reglas lo ven completo. Lo que
// depende de una variable o de una llamada no se puede calcular y se deja como está.
const { parser: parserTypescript } = require('typescript-eslint');

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

/** Si la expresión es una concatenación o plantilla de literales, la vuelve un solo `Literal`. */
function plegar(nodo) {
  const esConcatenacion = nodo.type === 'BinaryExpression';
  const esPlantillaConPartes = nodo.type === 'TemplateLiteral' && nodo.expressions.length > 0;
  if (!esConcatenacion && !esPlantillaConPartes) return;
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
