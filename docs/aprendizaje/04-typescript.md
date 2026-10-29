# Módulo 4. TypeScript

## Qué es

**TypeScript** es JavaScript con **tipos**: anotaciones que dicen qué clase de dato es cada cosa (un
texto, un número, una lista de productos). Antes de ejecutar el código, TypeScript revisa que todo
encaje y avisa de los errores.

```ts
function validarRuc(ruc: string): boolean { … }
//                       ^^^^^^    ^^^^^^^
//                 recibe un texto  devuelve verdadero o falso

validarRuc(20123456789); // ❌ error al compilar: se esperaba un texto, no un número
```

Al final, TypeScript se convierte ("compila") a JavaScript normal, que es lo que ejecutan Node y el
navegador.

## Para qué sirve

- **Detecta errores antes de que lleguen al usuario.** Si alguien cambia el nombre de un campo, todos
  los lugares que lo usan marcan error al instante.
- **El editor te ayuda.** Autocompleta nombres y muestra qué espera cada función.
- **Es documentación que no se desactualiza.** Los tipos dicen qué datos entran y salen.
- **Un solo lenguaje en todo el proyecto:** la API, la app y el código compartido.

## Lo básico que verás en el código

| Sintaxis                                | Significado                                                             |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `const total: number = 10`              | Una variable de tipo número                                             |
| `nombre?: string`                       | Un campo opcional                                                       |
| `'ok' \| 'error'`                       | Uno de esos dos valores, y ningún otro                                  |
| `interface Sucursal { nombre: string }` | Describe la forma de un objeto                                          |
| `Promise<Respuesta>`                    | Un resultado que llega más tarde (por ejemplo, de la base de datos)     |
| `async` / `await`                       | Esperar ese resultado sin bloquear el programa                          |
| `import { x } from '…'` / `export`      | Usar código de otro archivo / ofrecerlo a otros archivos                |
| `@Controller()`, `@Get()`               | Decoradores: etiquetas que le dan instrucciones al framework (módulo 6) |

## Cómo se usa en este proyecto

Todo el código de `apps/` y `packages/` es TypeScript (archivos `.ts` y `.tsx`; la `x` indica que
contiene componentes de React). Un ejemplo completo y corto es `packages/dominio/src/ruc.ts`, que valida
un RUC peruano con su dígito verificador:

```ts
const PREFIJOS_VALIDOS = ['10', '15', '16', '17', '20'];
const FACTORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function validarRuc(ruc: string): boolean {
  if (typeof ruc !== 'string' || !/^\d{11}$/.test(ruc)) return false; // 11 dígitos
  if (!PREFIJOS_VALIDOS.includes(ruc.slice(0, 2))) return false; // prefijo válido

  let suma = 0;
  for (let i = 0; i < FACTORES.length; i++) {
    suma += Number(ruc[i]) * (FACTORES[i] as number);
  }
  const resto = 11 - (suma % 11);
  const digito = resto >= 10 ? resto - 10 : resto;
  return digito === Number(ruc[10]); // dígito verificador
}
```

La configuración de TypeScript está en los archivos `tsconfig.json` de cada proyecto, y la común en
`packages/config`.

## Herramientas que acompañan a TypeScript

| Herramienta | Qué hace                                                   | Comando          |
| ----------- | ---------------------------------------------------------- | ---------------- |
| `tsc`       | El compilador: revisa los tipos y convierte a JavaScript   | `pnpm typecheck` |
| ESLint      | Revisa malas prácticas y errores comunes en el código      | `pnpm lint`      |
| Prettier    | Da formato uniforme al código (espacios, comillas, saltos) | `pnpm format`    |

La integración continua ejecuta los tres en cada cambio.

## Práctica (10 minutos)

1. Abre `packages/dominio/src/ruc.ts` en tu editor (recomendado: [Visual Studio Code](https://code.visualstudio.com/)).
2. Cambia `validarRuc(ruc: string)` por `validarRuc(ruc: number)` y guarda. Ejecuta `pnpm typecheck`:
   verás errores en todos los lugares que usan la función, incluso en la API y la app.
3. Deshaz el cambio (`Ctrl + Z`) y vuelve a ejecutar `pnpm typecheck`: sin errores.

## Para profundizar

- [TypeScript para programadores de JavaScript](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html)
- [Manual de TypeScript](https://www.typescriptlang.org/docs/handbook/intro.html)
