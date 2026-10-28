# App del personal (PWA)

PWA de React + Vite, móvil primero (se diseña a 360 px y se adapta a tableta y escritorio). Es lo que cada
trabajador abre en su celular: acceso con PIN, carta, disponibilidad y administración. Usa
`packages/ui`, `packages/contratos` y `packages/dominio`; la interfaz nunca calcula montos.

## Cómo correrla

Desde la raíz del repositorio, con la base preparada (`pnpm local:preparar`, ver el README de la raíz):

```bash
pnpm dev   # API en http://localhost:3000 y esta app en http://localhost:5173
```

Solo la PWA: `pnpm --filter @restaurante/app dev`. Llama a la API que diga `VITE_API_URL` (por defecto
`http://localhost:3000`); esa dirección de la PWA debe estar en `ORIGENES_PERMITIDOS` de la API.

| Comando                                      | Qué hace                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm --filter @restaurante/app test`        | Pruebas con Vitest y Testing Library (no necesitan base de datos)          |
| `pnpm --filter @restaurante/app typecheck`   | Verificación de tipos de la app y de las pruebas E2E                       |
| `pnpm --filter @restaurante/app lint`        | ESLint                                                                     |
| `pnpm --filter @restaurante/app build`       | Genera `dist/` con el service worker (solo guarda archivos estáticos)      |
| `pnpm --filter @restaurante/app presupuesto` | Peso del paquete inicial (gzip) contra el límite; correr después del build |
| `pnpm --filter @restaurante/app e2e`         | Playwright a 360 px contra la API real (ver el README de la raíz)          |

## "Pendiente de envío"

Las escrituras de la carta y de Disponibilidad no se pierden por un microcorte. `src/lib/envios.ts`
(`enviarSinPerder`) manda la escritura con **una** clave de idempotencia y, si la red no responde, sigue
esperando y reenvía con la misma clave (el servidor la aplica una sola vez). Mientras espera, la pantalla
dice **"Pendiente de envío"**, el cambio se ve como si ya estuviera hecho y el banner de "Sin conexión" lo
cuenta. Lo que la persona escribió sigue en su formulario. Reintenta unos 35 minutos y luego avisa del error.

Dos límites que conviene conocer:

- **La cola vive en memoria.** Si se recarga o se cierra la pestaña, los envíos que esperaban la red se
  pierden. Por eso la app pide confirmación al salir (`beforeunload`) mientras haya alguno pendiente, y la
  persona debe volver a hacer ese cambio.
- **Un envío pendiente pertenece a la sesión que lo pidió.** Guarda quién lo pidió (el token) y en qué
  sucursal. Si la sesión se cierra, entra otra persona (también con "Cambiar usuario") o cambia la sucursal
  mientras espera, el envío se cancela y **no** sale con la sesión nueva: la auditoría no debe atribuir un
  cambio a otra persona ni aplicarlo en otra sucursal. La pantalla (o, si ya no está, un aviso global
  hasta que se toca "Entendido") dice, por ejemplo, "No se envió: cambiaste de usuario".

## Ver las fotos de los productos en desarrollo

Las fotos de la carta las guarda y las sirve la API. En desarrollo, arranca la API con
`ARCHIVOS_DRIVER=disco` (es el valor por defecto con `NODE_ENV=development`): las guarda en la carpeta
`ARCHIVOS_DIRECTORIO` (por defecto `./archivos`, ignorada por git) y las sirve en
`http://localhost:3000/archivos/*` (`ARCHIVOS_URL_PUBLICA`). La PWA solo usa la dirección que le da la API
en cada producto (`fotoUrl`), de otro origen: la API ya manda las cabeceras CORS y CORP necesarias. Con
`ARCHIVOS_DRIVER=memoria` (pruebas) las fotos no se pueden ver; en producción son de Cloudflare R2.
