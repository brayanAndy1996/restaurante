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

## E2E de la carta

`e2e/carta.spec.ts` tiene siete pruebas, en serie, que recorren la carta y la disponibilidad con cuatro personas de una empresa nueva (Administrador, Cocina/Barra, Cajero y Mozo) en un celular de 360 px: el Administrador arma la carta con una foto, un combo y un menú del día; Cocina/Barra arma el menú de hoy y marca un plato agotado solo por hoy; un Cajero cambia un precio y ve la sucursal 2 solo para leer; el Administrador convierte el combo en simple; y un Mozo no ve ni la Carta ni la Disponibilidad. Otras dos miran el diseño: a 360 px no hay desplazamiento lateral y los controles miden 44 px o más, y en una tableta la lista pasa a tabla. La API que levanta Playwright corre con `NODE_ENV=development`, así que las fotos de prueba se guardan en disco (`ARCHIVOS_DRIVER=disco`; la CI lo fija).

## E2E del salón y la cocina

`e2e/salon-cocina.spec.ts` tiene diez pruebas, en serie, con el tiempo real encendido (la API de Playwright lo trae por defecto en desarrollo y necesita `DATABASE_TIEMPO_REAL_URL`, como en la CI). Tres celulares de 360 px de la misma empresa se ven en vivo: un Mozo, Cocina/Barra y un Supervisor que mira el mapa y da la clave para anular. El Administrador diseña una zona con tres mesas; el Mozo abre la mesa 1, comanda un combo y un lomo en segundo tiempo, marcha, agrega adiciones, pide pre-cuentas, anula 1 de 2 con la clave del Supervisor, une la mesa 2 y mueve la cuenta a la mesa 3; un envío con `context.setOffline` queda «Pendiente de envío» y sale una sola vez al volver la red. Dos pruebas miran el diseño a 360 px y en una tableta. La carta, los usuarios y la empresa se crean por la API (`e2e/ayudas-salon.ts`); todo lo demás se hace desde la PWA y se comprueba con lo que la PWA mandó (cada escritura lleva su `Idempotency-Key`). No es una prueba protegida: las de 004 que protegen la API y el dominio están en `apps/api/test/salon-critica/` y `packages/dominio/test/salon/`.

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

## Salón y tiempo real

El destino inicial sale del rol y del plan (`modulos/acceso/navegacion.ts`): "Salón" para quien atiende mesas,
"Cocina" para quien solo usa la cocina. `lib/tiempo-real.ts` abre una conexión de Socket.IO por sesión
(`socket.io-client` se carga bajo demanda, no cuenta en el paquete inicial), invalida las consultas de
TanStack Query con cada evento y se reconecta a 1, 2, 5 y 10 s. Sin conexión, las pantallas en vivo se
refrescan cada 30 s con `ETag` y `X-Actividad: segundo-plano` (`useIntervaloDeSondeo`). Se cierra al salir,
al cambiar de usuario y al cambiar de sucursal. En las pruebas, `test/preparar.ts` instala sockets de mentira.

La pantalla de cocina y barra es `/cocina` (`modulos/cocina`): comandas en orden de llegada, filtros de estación que se recuerdan, tiempo transcurrido con avisos a los 10 y 20 minutos, «Preparando», «Listo», «Todo listo» y «Enterado», sonido que se puede silenciar (`sonido.ts`) y comandas recientes. Cada «Listo» avisa en el salón a quien comandó y al mozo responsable (lista «Avisos»). En un iPad o una tableta conviene dejarla en primer plano: en segundo plano, el navegador corta la conexión, y al volver la pantalla se pone al día.

## Ver las fotos de los productos en desarrollo

Las fotos de la carta las guarda y las sirve la API. En desarrollo, arranca la API con
`ARCHIVOS_DRIVER=disco` (es el valor por defecto con `NODE_ENV=development`): las guarda en la carpeta
`ARCHIVOS_DIRECTORIO` (por defecto `./archivos`, ignorada por git) y las sirve en
`http://localhost:3000/archivos/*` (`ARCHIVOS_URL_PUBLICA`). La PWA solo usa la dirección que le da la API
en cada producto (`fotoUrl`), de otro origen: la API ya manda las cabeceras CORS y CORP necesarias. Con
`ARCHIVOS_DRIVER=memoria` (pruebas) las fotos no se pueden ver; en producción son de Cloudflare R2.
