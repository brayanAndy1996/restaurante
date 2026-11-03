# Carta web (`apps/web`)

La carta que ve el cliente del restaurante en su celular: la carta de cada sucursal y el modo mesa (el QR de cada mesa). Es una app Next.js 16 con App Router. Lee la API pública de `apps/api` (rutas `/publico/*`); no tiene sesión ni cuenta. Es la historia 005 (`specs/005-carta-web-mesa/`). Su dirección de diseño está en [`PRODUCT.md`](PRODUCT.md) y [`DESIGN.md`](DESIGN.md); cómo levantarla en tu computadora, con el celular y con Docker, en [`DESPLIEGUE-LOCAL.md`](../../DESPLIEGUE-LOCAL.md).

## Scripts

Desde la raíz, `pnpm --filter @restaurante/web <script>`:

| Script           | Qué hace                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`            | Servidor de desarrollo en el puerto 3001. `pnpm dev` en la raíz la levanta junto con la API y la PWA.                                                                                               |
| `build`          | `scripts/construir.mjs`: `next build` sin el `NODE_ENV` del entorno (con `development`, el prerenderizado de `/_global-error` falla). Deja `.next/standalone`.                                      |
| `start:autonomo` | `scripts/servir-autonomo.mjs`: sirve el build con el servidor autónomo de Next (`.next/standalone/apps/web/server.js`), igual que la imagen de Docker. Va después de `build`; puerto 3001 o `PORT`. |
| `presupuesto`    | `scripts/presupuesto.mjs`: mide el JavaScript y el CSS gzip del build y falla si pasan un límite. Va después de `build`. La CI lo corre también.                                                    |
| `test`           | Vitest con jsdom: componentes, horario, pedido, imágenes, rutas y reglas. No necesita base de datos.                                                                                                |
| `e2e`            | Playwright a 360 × 740. Por defecto usa la API falsa de `e2e/api-falsa.mjs` (puerto 3100). Con `E2E_API_URL=http://localhost:3000`, corre el punta a punta con la API real y la PWA (puerto 5174).  |
| `lint`           | ESLint.                                                                                                                                                                                             |
| `typecheck`      | `next typegen` y `tsc --noEmit`.                                                                                                                                                                    |

Para servir el build como en producción y en Docker, usa `start:autonomo`.

## Variables

Se leen de `apps/web/.env.local`. `pnpm local:preparar` lo crea a partir de [`.env.example`](.env.example); si lo copias a mano, hazlo tú. Next solo expone al navegador las variables `NEXT_PUBLIC_*`, y las incrusta al construir: si cambias una, vuelve a construir.

| Variable                     | Uso                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_URL_INTERNA`            | URL de la API para el servidor de Next (`http://localhost:3000`; en Docker, `host.docker.internal`). Lee la carta y el modo mesa.                                                                              |
| `NEXT_PUBLIC_API_URL`        | URL de la API para el navegador: disponibilidad, llamados y su estado. La API acepta por CORS en `/publico/*` el origen de `CARTA_WEB_URL`, desde donde corre esta app.                                        |
| `CARTA_WEB_URL`              | URL pública de esta app, sin barra final. Va en los QR y en las vistas previas. Debe ser la misma que en el `.env` de la API.                                                                                  |
| `ARCHIVOS_URL_PUBLICA`       | Origen de las fotos y los logos. Next solo optimiza imágenes de ese origen.                                                                                                                                    |
| `IMAGENES_PERMITIR_IP_LOCAL` | Solo desarrollo y E2E: `1` deja optimizar fotos de `localhost`. Con `CARTA_WEB_URL` o `ARCHIVOS_URL_PUBLICA` que no sean `localhost` o `127.0.0.1`, el build y el arranque fallan. No se define en producción. |

## Rutas

| Ruta                    | Qué muestra                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/<empresa>`            | Las sucursales publicadas. Con una sola, redirige con 307 a su carta. Sin caché pública.                                                             |
| `/<empresa>/<sucursal>` | La carta de la sucursal, con horario, familias y solo lo que se puede pedir ahora. Caché pública de 30 s (`s-maxage=30, stale-while-revalidate=60`). |
| `/m/<código>`           | El modo mesa del QR. Sin caché (`private, no-store`), con `noindex` y `Referrer-Policy: no-referrer`. Fuera de `robots.txt`.                         |
| Cualquier otra          | «Esta carta no está disponible», con estado 404, también cuando la API responde 404.                                                                 |

Una dirección con mayúsculas redirige con 308 a su versión en minúsculas (`proxy.ts`). Una respuesta 5xx nunca se guarda en caché pública (`next.config.ts`).

## Regla de peso

El criterio 88 de la 005 pide una carta liviana para datos móviles. `pnpm --filter @restaurante/web presupuesto` lo comprueba sobre el build:

- **JavaScript de la primera carga**, gzip: 140 kB en la carta y 150 kB en el modo mesa.
- **Lo que el modo mesa baja al primer toque** (hojas de producto y de pedido, y reglas de montos con `decimal.js`, con `import()`): 25 kB.
- **CSS**: 20 kB. No hay fuentes web.
- **Medido en el E2E**: el HTML de la carta con 150 productos, 60 kB; cada foto, 25 kB como máximo; el logo, 15 kB; la primera vista a 360 × 740, 400 kB en total.

Si una carga nueva pasa un límite, primero se carga bajo demanda. Si aun así no cabe, se propone otro límite con su motivo y lo aprueba el usuario, como se hizo con el de la carta (de 120 a 140 kB, el 2026-11-03).

## Dónde está cada cosa

- `app/`: las rutas de arriba. `componentes/`: la carta (se arma en el servidor) y el modo mesa (`mesa/`, con las hojas que se cargan bajo demanda). `lib/`: la API, el pedido guardado en el navegador, los llamados, el horario y las imágenes.
- `next.config.ts`: las cabeceras de caché, del modo mesa y de las imágenes. `proxy.ts`: la redirección a minúsculas.
- `test/`: Vitest. `e2e/`: Playwright (carta, modo mesa, presupuesto, accesibilidad con axe, compatibilidad en Chromium y punta a punta). La primera vez: `pnpm --filter @restaurante/web exec playwright install chromium`.
