# Módulo 9. Pruebas automáticas, TDD y pruebas adversariales

## Qué son las pruebas automáticas

Son programas que usan el sistema y comprueban que hace lo que debe. Por ejemplo: "si la empresa A
pide la lista de productos, nunca recibe productos de la empresa B". Se ejecutan con un comando, en
minutos, cada vez que algo cambia.

## Para qué sirven

- **Detectan errores antes que los clientes.** Un cambio en la carta no puede romper el ingreso con
  PIN sin que una prueba lo marque.
- **Dan confianza para cambiar código.** Si todas las pruebas pasan, lo que funcionaba sigue
  funcionando.
- **Son la definición de "terminado".** En la ruta crítica, una historia está lista cuando pasan las
  pruebas escritas a partir de su especificación.

## Los tres tipos que usa el proyecto

| Tipo                       | Qué prueba                                                                | Herramienta        | Dónde                    |
| -------------------------- | ------------------------------------------------------------------------- | ------------------ | ------------------------ |
| **Unitarias**              | Una función sola, sin base de datos ni navegador                          | Vitest             | `packages/dominio/test/` |
| **Integración**            | La API completa contra un PostgreSQL real (sin simulaciones)              | Vitest + Supertest | `apps/api/test/`         |
| **E2E** (de punta a punta) | Un navegador real usando la app como una persona, contra la API y la base | Playwright         | `apps/app/e2e/`          |

**Vitest** ejecuta las pruebas y muestra cuáles pasan. **Supertest** envía peticiones HTTP a la API
desde las pruebas. **Playwright** controla un navegador Chrome: escribe, hace clic y comprueba lo que
aparece en pantalla, con tamaño de celular.

## La metodología del proyecto

Cada historia sigue un flujo descrito en `CLAUDE.md`. Lo relacionado con pruebas:

### TDD (Test Driven Development, desarrollo guiado por pruebas)

En las historias de **ruta crítica**, las pruebas se escriben **antes** que el código:

1. El rol `test-writer` escribe las pruebas a partir de la especificación, sin ver la implementación.
2. El rol `tester` confirma que fallan por la razón esperada: la funcionalidad aún no existe.
3. El rol `backend` o `frontend` implementa hasta que pasan.

Estas pruebas están **protegidas**: llevan un comentario `// spec: … (pruebas protegidas)` y quien
implementa no puede modificarlas ni debilitarlas. Así nadie "arregla" una prueba para que pase.

### Pruebas adversariales

Después, el rol `adversarial` intenta romper lo construido: datos raros, dos peticiones a la vez,
saltarse permisos, ver datos de otra empresa. No recibe el razonamiento de quien implementó, para no
heredar sus supuestos. Cada falla que encuentra se convierte en una prueba nueva que falla, y se
vuelve a implementar hasta que pasa. En los commits verás "ronda 1 adversarial", "ronda 2"…

### Solo donde importa

TDD y pruebas adversariales se aplican **solo a la ruta crítica** (aislamiento entre empresas, montos,
comandas, caja, comprobantes, permisos y pedidos web). El resto lleva las pruebas que el desarrollador
considere necesarias. Probarlo todo con el mismo rigor costaría mucho tiempo sin reducir mucho el
riesgo.

## Cómo correr las pruebas

```bash
pnpm --filter @restaurante/dominio test     # unitarias de las reglas de negocio: segundos, sin base
pnpm test                                   # todo el proyecto: varios minutos
```

Las pruebas de la API necesitan saber dónde está el PostgreSQL de Docker. Si fallan pidiendo
`DATABASE_ADMIN_URL`, defínela antes de `pnpm test`:

```bash
# PowerShell (Windows)
$env:DATABASE_ADMIN_URL="postgres://postgres:postgres@localhost:5433/postgres"

# Mac, Linux o Git Bash
export DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5433/postgres
```

Las pruebas crean su propia base, `restaurante_test`, y no tocan tus datos de demostración.

Para las E2E con navegador (la primera vez se descarga Chromium):

```bash
pnpm --filter @restaurante/app exec playwright install chromium
pnpm --filter @restaurante/app e2e
```

## Práctica (10 minutos)

1. Ejecuta `pnpm --filter @restaurante/dominio test`. Verás la lista de pruebas en verde.
2. Abre `packages/dominio/src/ruc.ts` y cambia el `11` de `11 - (suma % 11)` por `10`. Vuelve a
   ejecutar las pruebas: algunas se pondrán en rojo y te dirán qué RUC falló. Deshaz el cambio.
3. Mira los nombres de los archivos en `apps/api/test/aislamiento/`: cada uno ataca una forma distinta
   de que una empresa vea datos de otra.

## Para profundizar

- [Vitest](https://vitest.dev/guide/)
- [Playwright](https://playwright.dev/docs/intro)
- La sección "Pruebas" del `README.md` y `apps/api/test/README.md`
