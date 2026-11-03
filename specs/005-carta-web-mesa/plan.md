# 005 · Plan técnico

Entregas 5a (API, llamados en la PWA y QR) y 5b (carta web, `apps/web`), en ese orden. Los números entre paréntesis son criterios de `spec.md`; "decisión N" remite a las decisiones del usuario de `fuentes.md` y "pregunta N" a "Preguntas abiertas" de `spec.md`.

## Módulos afectados

### Entrega 5a

- `packages/dominio`:
  - `src/llamados/` (ruta crítica P2): `catalogos.ts` (tipos, estados, límites, `MINUTOS_VENCIMIENTO_LLAMADO`), `estados.ts` (`venceEnLlamado`, `estadoVigenteLlamado`, `siguienteEstadoLlamado`), `limites.ts` (`decidirLimite`), `reglas.ts` (`aceptaLlamados`, `destinatariosDeLlamado`) (56). Pruebas en `test/llamados/`.
  - `src/carta-web/` (no crítico): `SLUGS_RESERVADOS`, `esSlugValido`, `propuestaDeSlug`, `colorDeMarcaAccesible`.
- `packages/contratos`: `src/carta-web.ts`, `src/llamados.ts`, `src/errores.ts` (códigos nuevos, `atendidoPor` y `estado`).
- `apps/api`:
  - `src/modulos/carta-web/` (nuevo, dueño de `carta_web` y `carta_web_sucursal`): ver "Estructura de los módulos nuevos".
  - `src/modulos/llamados/` (nuevo, dueño de `llamado`): ver "Estructura de los módulos nuevos".
  - `src/modulos/salon/`: `codigos-mesa.service.ts` (nuevo, dueño de `mesa_qr`; exportado), `qr-mesas.controller.ts` (nuevo), `mesas.service.ts` (crear el código al crear la mesa, 6).
  - `src/modulos/pedidos/`: `apertura-de-mesas.service.ts` (nuevo, exportado: envuelve `OrdenesService.abrir` con un `mozoId` explícito) y `PedidosConsultaService.ordenesVigentesDeMesas`.
  - `src/modulos/carta/`: `CartaVentaService.prepararLineas` (un cargador para varios productos; `cargador-carta.ts` acepta una lista de productos).
  - `src/modulos/plataforma/`: `SucursalesConsultaService.datosPublicos`.
  - `src/nucleo/base-de-datos/consultas-sin-empresa.ts`, `control-transaccion.ts` y `src/nucleo/fijar-contexto.ts`: motivos `carta-publica` y `codigo-mesa`, sus consultas fijas, `buscarEmpresaDeCarta`, `buscarEmpresaDeCodigoMesa` y los dos nombres en `NOMBRES_PROHIBIDOS` (12, 13).
  - `src/nucleo/http/ip-cliente.ts` (nuevo): la IP del cliente con `CABECERA_IP_CLIENTE` y su huella HMAC (33).
  - `src/aplicacion.ts`: CORS por ruta (16) y el límite de 16 KB de los `POST` públicos (17).
  - `src/config/entorno.ts`: `CARTA_WEB_URL` y `CABECERA_IP_CLIENTE`.
  - `src/migraciones/`: ver "Migraciones".
  - Pruebas no protegidas en `test/carta-web/` y `test/llamados/`; protegidas en `test/llamados-critica/` (fase B), más el ajuste de `test/acceso/fabrica-sesiones.ts` (P4).
- `apps/app`:
  - `src/modulos/salon/`: `LlamadosLista`, `LlamadoPagina` (detalle y revisión), `AtenderHoja`, `DescartarHoja`, `llamados.ts` (consultas y mutaciones), el segmento "Llamados" en `SalonPagina` y la etiqueta en la baldosa; `borrador.ts` gana `llamadoId?` y `agregarLineasDeLlamado` (sin duplicar).
  - `src/componentes/AvisosDeLlamados.tsx` y `src/lib/avisos-de-llamados.ts` (banner, sonido, vibración y silencio por equipo), como `AvisosDeListo` de 004.
  - `src/lib/tiempo-real.ts`: `llamado.nuevo` y `llamado.cambio` invalidan `GET /llamados`.
  - `src/modulos/ajustes/carta-web/` (formulario, logo, sucursales) y `src/modulos/ajustes/mapa/qr/` (lista, cambio de QR y hoja para imprimir).
- `packages/ui` (skill `impeccable`): `EtiquetaDeLlamado` y, si hace falta, `TarjetaQr` para la hoja.

### Entrega 5b

- `apps/web` (nuevo, Next.js): ver "Carta web (5b)".
- `packages/config`: preset de ESLint y `tsconfig` para Next, si los de React no alcanzan.
- `turbo.json`, `pnpm-workspace.yaml` (ya incluye `apps/*`), `docker-compose`, `.env.example`, `DESPLIEGUE-LOCAL.md` y CI.

## Diseño

### Estructura de los módulos nuevos

```
apps/api/src/modulos/carta-web/
  carta-web.module.ts
  carta-web.controller.ts          GET/PUT /carta-web, PUT /carta-web/sucursales/:sucursalId
  logo-carta-web.controller.ts     PUT/DELETE /carta-web/logo (@SinEmpresa, como la foto de 003)
  carta-publica.controller.ts      GET /publico/cartas/:empresaSlug[/:sucursalSlug[/disponibilidad]]
  carta-web.service.ts             configuración y auditoría
  logo-carta-web.service.ts
  carta-publica.service.ts         arma cartaPublica y disponibilidadPublica a partir de cartaDeSucursal
  carta-web-consulta.service.ts    exportado: resolverEmpresa, sucursalPublicada, sucursalPorSlug
  contexto-publico.ts              resuelve la empresa (fuera de contexto) y abre ContextoEmpresa con actor carta-web
  filtro-publico.ts                lista cerrada de claves que salen (21)

apps/api/src/modulos/llamados/
  llamados.module.ts
  mesa-publica.controller.ts       GET /publico/mesas/:codigo, POST …/llamados, GET …/llamados/:id
  llamados.controller.ts           GET /llamados, GET /llamados/:id, POST …/atencion, …/paso-a-cuenta, …/descarte
  creacion-llamados.service.ts     crear (ruta crítica P2)
  atencion-llamados.service.ts     atender y descartar (P2)
  paso-a-cuenta.service.ts         pasar a la cuenta (P3)
  vista-llamados.service.ts        lista y detalle con revisión
  limites-llamados.ts              conteos por mesa y por huella de IP con decidirLimite
  replica-llamado.ts               huella de la entrada normalizada
  eventos-llamados.ts              llamado.nuevo y llamado.cambio con alConfirmar
  errores-llamados.ts
```

- `CartaWebModule` importa `CartaModule` (`CartaVentaService`), `SucursalesConsultaModule`, `SuscripcionModule` (`modulosDeSucursal`), `ArchivosModule`, `AuditoriaModule` y `SeguridadModule`. No importa `SalonModule` ni `LlamadosModule`.
- `LlamadosModule` importa `SalonModule` (`CodigosMesaService`, `MesasConsultaService`), `CartaWebModule` (`CartaWebConsultaService`), `CartaModule`, `PedidosModule` (`PedidosConsultaService`, `AperturaDeMesasService`), `SucursalesConsultaModule` y `SeguridadModule`. Nadie importa `LlamadosModule`, así que no hay ciclos. `PedidosModule` no exporta el servicio de envíos, de modo que llamados no puede mandar nada a cocina (49).
- Ningún módulo consulta tablas ajenas: llamados lee la mesa por `CodigosMesaService`, la orden por `PedidosConsultaService`, la carta por `CartaVentaService` y el horario por `SucursalesConsultaService`.

### Resolución pública de la empresa (11 a 15; ruta crítica P1)

Flujo de toda ruta `/publico/*` (las rutas son `@Publica()`, que implica `@SinEmpresa()`: el interceptor global no abre transacción):

1. Forma de los parámetros (`:codigo` con `CODIGO_MESA_REGEX`, slugs con la forma del criterio 2): si no cumple, 404 sin consultar nada.
2. Fuera de toda transacción y contexto: `buscarEmpresaDeCodigoMesa(conexion, codigo)` o `buscarEmpresaDeCarta(conexion, slug.toLowerCase())`, con la consulta fija y el motivo `sinEmpresa` (como `buscarEmpresaDeUsuario` de 002). `null` → 404.
3. `ContextoEmpresa.ejecutar(empresaId, fn, { actor: { sistema: 'carta-web' } })`: una transacción, un `fijar_contexto_empresa`, un actor. Dentro, todo bajo la RLS:
   - Mesa: `CodigosMesaService.resolver(codigo)` lee `mesa_qr` unido a la mesa (activa) bajo la RLS. Si la función devolvió una empresa pero la fila no aparece (código reemplazado en otra transacción entre los pasos 2 y 3), 404.
   - Carta: `CartaWebConsultaService.sucursalPorSlug(slug)` (publicada).
   - Plan: `SuscripcionService.modulosDeSucursal(sucursalId)` incluye `PEDIDOS_WEB` (pregunta 8); si no, 404.
4. La respuesta pasa por el esquema estricto de `packages/contratos` antes de salir (21): una clave de más es un error del servidor, nunca una fuga.

- **Espejo:** los triggers `carta_publica.mantener_slug()` y `carta_publica.mantener_codigo_mesa()` son `SECURITY DEFINER` del migrador, como `autenticacion.mantener_nombre_usuario()` de 002. Toman la empresa de `NEW.empresa_id`, que la política `WITH CHECK` ya obligó a ser la del contexto (65). Un `slug` o un `codigo` repetidos fallan con `23505` en la llave primaria del espejo, dentro de la misma transacción: la API lo traduce a 409 `CONFLICTO` sin revelar de quién es.
- **Por qué no leer `mesa_qr` desde la función:** las tablas de `public` tienen RLS forzada y el migrador no tiene política, así que una función del migrador no las ve; el espejo vive fuera de `public` (como `autenticacion.nombre_usuario`).
- **Guarda:** `NOMBRES_PROHIBIDOS` rechaza las dos funciones dentro de un contexto; `esConsultaSinEmpresaValida` solo acepta el texto exacto de cada motivo, sin transacción, con un parámetro de texto. La regla de ESLint de 002 que limita dónde se escribe `empresa_de_usuario` cubre también los dos nombres nuevos (solo `fijar-contexto.ts`, `consultas-sin-empresa.ts` y las migraciones).
- **CORS (16):** `enableCors` pasa a una función de origen por petición: `ORIGENES_PERMITIDOS` en toda ruta, y además el origen de `CARTA_WEB_URL` cuando la ruta empieza por `/publico/`. Métodos y cabeceras como en "Contrato".
- **Tamaño (17):** un middleware antes del analizador de JSON rechaza con 413 un `POST /publico/*` cuyo `Content-Length` (o cuerpo leído) pasa de 16 KB.

### Carta pública (18 a 24)

- `CartaPublicaService.carta(sucursalId, ahora)` llama a `CartaVentaService.cartaDeSucursal` (seis consultas del cargador más la hora de corte) y a `SucursalesConsultaService.datosPublicos`, filtra lo no vendible (20), arma `cartaPublica` y calcula `abiertaAhora` con `dentroDeHorario`. Consultas fijas (22).
- `disponibilidad` reutiliza el mismo armado y devuelve solo ids. Las dos usan `etagDeVista` (movido a `nucleo/http/etag.ts` en 004) y `coincideConEtag`.
- Cabeceras: `Cache-Control` del criterio 22 o 23; nada se guarda en memoria del proceso (24), así que varias instancias responden lo mismo.

### Códigos QR (6 a 10)

- `CodigosMesaService.crearPara(mesaId)` inserta en `mesa_qr` un código de `randomBytes(16).toString('base64url')`; lo llaman `MesasService.crear` (misma transacción) y `crearFaltantes`. Si el espejo devuelve `23505` (prácticamente imposible), reintenta una vez con otro código y, si vuelve a fallar, 409.
- `cambiar(mesaId)`: bloquea la fila de `mesa_qr` de la mesa (`FOR UPDATE`), actualiza `codigo` y `generado_en`; el trigger borra el código viejo del espejo e inserta el nuevo en la misma transacción. Desde la confirmación, el paso 2 de la resolución ya no lo encuentra (9).
- La URL es `CARTA_WEB_URL/m/<código>`; sin `CARTA_WEB_URL`, las rutas de QR responden 503 antes de escribir (como `API_URL_PUBLICA` de 3b).

### Crear un llamado (26 a 37; ruta crítica P2)

Una sola transacción (la del contexto público):

1. Forma (`PipeZod` con `llamadoEntrada`) y tamaño: 400, 413.
2. Resolución del código (sección anterior): 404.
3. `pg_advisory_xact_lock` con una llave de 64 bits derivada de la huella de la IP y la sucursal (serializa el límite por conexión, 33). Después, `CodigosMesaService.bloquearPorCodigo(codigo)`: `FOR UPDATE` de la fila de `mesa_qr` (serializa los llamados de la misma mesa: réplicas, uno pendiente y límite por mesa). Siempre en ese orden.
4. **Réplica por id** (29): `SELECT … FROM llamado WHERE id = $1` (bajo la RLS). Si existe: misma mesa y misma `huella_entrada` → responde `respuesta_creacion` (201) sin efectos; si no, 422.
5. **Horario** (35): `aceptaLlamados({ horario, ahora, mesaConCuenta })`, con `PedidosConsultaService.ordenesVigentesDeMesas([mesaId])` y `SucursalesConsultaService.datosPublicos`.
6. **Pendiente** (30, 31): lee el pendiente de la mesa; si venció (`estadoVigenteLlamado`), lo guarda `VENCIDO` (`vencido_en = vence_en`); si sigue vigente, 409.
7. **Límites** (32, 33): `SELECT creado_en FROM llamado WHERE mesa_id = $1 AND creado_en > ahora − 30 min` y lo mismo por `(sucursal_id, huella_ip)` en 10 minutos; `decidirLimite` decide.
8. **Líneas** (27): `CartaVentaService.prepararLineas(sucursalId, lineas, ahora)`; rechazos por línea → 422 con todo revertido; topes con `excedeMontoMaximo`.
9. `INSERT llamado` con `vence_en = venceEnLlamado(ahora)`, las líneas preparadas, `huella_entrada`, `huella_ip`, `destinatario_mozo_id`, `orden_id` y `respuesta_creacion`. El índice único parcial es la red de seguridad del paso 6: un `23505` se traduce en 409 `LLAMADO_PENDIENTE` (o en réplica si el `id` es el mismo).
10. `llamado.nuevo` con `alConfirmar` (36).

- **Tope en el proceso:** antes del paso 2, un contador en memoria limita a 5 las creaciones en curso por código (429 de 1 segundo, sin tocar la base), como `TopeDeIntentos` de 002. Solo recorta ráfagas: los límites exactos son los de la base.
- **IP:** `ipCliente(peticion)` toma el primer valor de la cabecera `CABECERA_IP_CLIENTE` si la variable existe y, si no, `peticion.socket.remoteAddress`. `huellaIp = HMAC-SHA256(HKDF(PIN_PEPPER, 'llamado-ip'), ip)`.

### Atender, pasar y descartar (39 a 55; ruta crítica P2 y P3)

- **Bloqueo:** toda escritura de un llamado empieza con `SELECT … FROM llamado WHERE id = $1 AND sucursal_id = $2 FOR UPDATE` (404 si no). Dos atenciones o dos pasos simultáneos se turnan; el segundo ve el estado nuevo (43, 51).
- **Atender (41 a 45):** con el llamado bloqueado, `estadoVigenteLlamado` (vencido → lo guarda y 409); `siguienteEstadoLlamado(tipo, estado, 'ATENDER')`; si ya está `ATENDIDO` por la misma persona, devuelve el estado actual (réplica natural); por otra, 409 `LLAMADO_TOMADO`. Con la mesa libre y tipo `PEDIDO` o `LLAMAR_MOZO`: sin `comensales` u `ordenId`, 409 `MESA_LIBRE`; con ellos, `AperturaDeMesasService.abrir({ id: ordenId, mesaId, comensales, mozoId: usuario de la sesión })`, que aplica 004 (bloqueo de la mesa, `MESA_OCUPADA`, índice único, eventos `salon.cambio` y `orden.cambio`). Un `MESA_OCUPADA` se captura y se usa la orden que lo causó. Orden de bloqueos: llamado y después mesa; la creación bloquea `mesa_qr`, no `mesa`, así que no hay ciclo.
- **Revisión (40):** `prepararLineas` con el producto, los modificadores y la cantidad de cada línea guardada, en el instante de la lectura.
- **Paso a la cuenta (46 a 52):** con el llamado bloqueado: réplica natural (estado `PASADO_A_CUENTA` y `huella_paso` igual → `respuesta_paso`); `siguienteEstadoLlamado(…, 'PASAR_A_CUENTA')`; posiciones válidas; `ordenesVigentesDeMesas([mesaId])` (sin orden, 409 `MESA_SIN_CUENTA`); `prepararLineas` con la cantidad de la entrada y todo o nada; `UPDATE llamado` (estado, `orden_id`, `lineas_pasadas`, `cerrado_*`, `respuesta_paso`, `huella_paso`); `llamado.cambio`. No toca ninguna tabla de pedidos: la orden solo se lee.
- **Descartar (53):** `siguienteEstadoLlamado(…, 'DESCARTAR')`; `cerrado_*` y `motivo_descarte`; `llamado.cambio`.
- **Quién (60):** `atendido_por_usuario_id` y `atendido_por_equipo_id`, o `cerrado_*`, salen del principal de la sesión (persona y equipo); una sesión de soporte deja esas columnas nulas y queda en la trazabilidad con el superadministrador.

### Vencimiento (54)

- `estadoVigenteLlamado` se aplica en cada lectura (lista, detalle, estado público, mesa pública) con `reloj.ahora()`. La lista filtra los pendientes con `vence_en > ahora` en SQL (con el `ahora` de la API como parámetro, nunca `now()` de la base).
- Se persiste `VENCIDO` solo en una escritura que ya bloqueó el llamado o la mesa (pasos 6 de la creación, atender y descartar). No hay tarea del worker ni evento.

### Tiempo real (36, 45, 57)

- `EventosLlamados` registra los eventos con `alConfirmar` en la sala `{ tipo: 'sucursal', sucursalId }`, como `EventosPedidos`. Las salas y la autenticación de Socket.IO no cambian.
- PWA: `llamado.nuevo` invalida `GET /llamados` y, si la persona es destinataria (o `destinatarios` es `null` y tiene `ATENDER_MESA`), dispara el aviso; `llamado.cambio` invalida la lista y el detalle abierto.

### PWA (68 a 77)

- **Borrador:** `agregarLineasDeLlamado(clave, llamadoId, lineas)` agrega las líneas con `llamadoId` si el borrador no tiene ya líneas de ese llamado y no hay un envío en curso; el resto del borrador (editar, quitar, enviar) no cambia. Así una réplica del paso no duplica.
- **Aviso:** `AvisosDeLlamados` (global, cargado con el tiempo real) usa `AudioContext` después del primer toque y `navigator.vibrate` donde exista; el silencio se guarda en el equipo (`localStorage`).
- **Hoja de QR:** `@media print` con tarjetas de 9 × 9 cm en una cuadrícula de 2 × 3 por hoja A4; el QR con la dependencia de 3b (`qrcode-generator`), cargada bajo demanda; nivel de corrección M.
- **Presupuesto de la PWA:** todo lo nuevo (lista y detalle de llamados, Ajustes) va bajo demanda; el aviso global vive en el fragmento del tiempo real, que ya es diferido.

### Carta web (5b)

```
apps/web/
  next.config.ts                 output: 'standalone', images.remotePatterns (ARCHIVOS_URL_PUBLICA), cabeceras por ruta
  app/
    layout.tsx                   lang es-PE, metadatos base, fuentes del sistema
    [empresa]/page.tsx           sucursales publicadas (307 si hay una)
    [empresa]/[sucursal]/page.tsx       carta (Server Component), revalidate 30
    [empresa]/[sucursal]/opengraph-image.tsx   1200 × 630
    m/[codigo]/page.tsx          modo mesa (dinámico, no-store)
    not-found.tsx                "Esta carta no está disponible"
    robots.ts                    Disallow: /m/
  componentes/                   Carta, Familia, Producto (servidor); islas de cliente: Disponibilidad, HojaDeProducto, TuPedido, BotonesDeMesa, EstadoDelLlamado
  lib/api.ts                     fetch del servidor (API_URL_INTERNA) y del navegador (NEXT_PUBLIC_API_URL), con validación de contratos en el servidor
  lib/pedido.ts                  pedido en sessionStorage por código, id del llamado y reintento
  middleware.ts                  minúsculas (308)
  scripts/presupuesto.mjs        mide el JavaScript y el CSS del build (88)
  test/ y e2e/                   Vitest y Playwright
  Dockerfile
```

- **Servidor y cliente:** la carta es HTML del servidor; solo son de cliente la consulta de disponibilidad (en la carta) y, en el modo mesa, la hoja de producto, el pedido, los botones y el estado. `packages/contratos` (zod) se usa solo en el servidor para no sumar zod al navegador; en el cliente basta el tipo.
- **Caché:** `fetch(…, { next: { revalidate: 30, tags: ['carta:<empresa>:<sucursal>'] } })` para la carta, y `cache: 'no-store'` para la mesa. Las cabeceras de `next.config.ts` fijan `Cache-Control`, `X-Robots-Tag` y `Referrer-Policy` del criterio 80.
- **Disponibilidad:** la isla consulta la API desde el navegador con `If-None-Match`, cada 15 s con la página visible, al cargar y en `visibilitychange`; oculta con un atributo (`hidden`) los productos y modificadores que ya no están, sin volver a pintar la carta.
- **Modo mesa:** el pedido vive en `sessionStorage` (`pedido:<código>`); al pulsar "Enviar al mozo" se genera el `id` y se guarda con el pedido; un error de red reintenta con espera creciente (1, 2, 5, 10 s) y el mismo `id`; un 201 o un 4xx final lo borra. El estado se consulta cada 10 s mientras sea `PENDIENTE`.
- **Imágenes:** `next/image` con `sizes` al ancho real (96 px en la lista, 2x), `loading="lazy"` salvo las cuatro primeras, formatos AVIF y WebP. La optimización corre en el servidor de Next (`sharp` en la imagen de Docker), con caché.
- **Color:** `colorDeMarcaAccesible(colorPrincipal)` en el servidor da `--color-marca` y `--color-sobre-marca` como variables de CSS.
- **Diseño:** antes de las pantallas, el frontend escribe con `impeccable` `apps/web/PRODUCT.md` y `apps/web/DESIGN.md` (tipo "Operate", marca del restaurante, fuentes del sistema) y espera la aprobación del usuario por el orquestador (89).

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Dividir en 5a (API y PWA) y 5b (carta web) (pregunta 1) | Una sola entrega | La ruta crítica queda entera en 5a y se prueba por HTTP; 5b es otra aplicación con un brief propio |
| Funciones `SECURITY DEFINER` de búsqueda exacta sobre un espejo en un esquema sin acceso | Token con la empresa y firma en la URL; función que lea `mesa_qr` | Precedente de `empresa_de_usuario`; URL corta (QR legible impreso pequeño) y sin ids; la carta por dirección necesita la búsqueda global igual; el migrador no ve las tablas de `public` |
| Una sola `ContextoEmpresa.ejecutar` por petición pública, con actor `carta-web` | Abrir un contexto para buscar y otro para escribir | `fijar_contexto_empresa` es una sola vez por transacción; la búsqueda va fuera de toda transacción con su consulta fija |
| Código de 128 bits en base64url guardado tal cual | Guardar solo la huella | La hoja se reimprime cuando se quiera; el código está pegado en la mesa y no es la credencial de una persona |
| Módulo `llamados` nuevo, dueño de `llamado` | Meterlo en `pedidos` | `pedidos` ya es grande; `llamados` depende de `pedidos` y no al revés, y sin acceso a envíos no puede mandar nada a cocina |
| `mesa_qr` en el módulo `salon` | Columna en `mesa`; tabla en `llamados` | El QR es la identidad pública de la mesa; tabla propia para no tocar `mesaRespuesta` ni las pruebas de 004 |
| Líneas del llamado en `jsonb` | Tabla `llamado_linea` | Hasta 30, inmutables; se leen siempre juntas |
| Paso a la cuenta todo o nada | Pasar las válidas y avisar de las demás | Igual que el envío de 004; el detalle ya marca lo agotado antes de pasarlo |
| El paso devuelve las líneas para el borrador del equipo | Guardar ítems "por enviar" en la base | El borrador de 004 vive en el equipo; así "Enviar" sigue siendo la única puerta a cocina |
| Vencimiento calculado al leer con el reloj de la API | Tarea del worker que vence llamados | Sin colas todavía; regla pura y probada, como el vencimiento de los trabajos de impresión de 004 |
| Límites contando filas de `llamado`, serializados por la fila de `mesa_qr` y por `pg_advisory_xact_lock` de la huella | Redis; tabla de contadores | Solo PostgreSQL (`CLAUDE.md`); los rechazos no se guardan y la cuenta es exacta |
| HMAC de la IP, no la IP | Guardar la IP | Permite contar sin guardar datos personales |
| Eventos en la sala de la sucursal con `destinatarios` | Salas por rol | Mismo patrón que `cocina.listo`; el evento no lleva datos de más |
| El cliente consulta el estado cada 10 s | Socket.IO o SSE públicos | Sin conexiones públicas abiertas ni salas nuevas que aislar; la carta sigue liviana |
| Carta en caché de 30 s más disponibilidad de 5 s consultada cada 15 s | Carta sin caché; carta completa cada 15 s | Protege la base de picos de visitas y gasta pocos datos; el envío revalida todo |
| `apps/web` sin `packages/ui` y con fuentes del sistema | Reusar los componentes y la fuente de la PWA | Presupuesto de datos móviles y una identidad que es la del restaurante |
| Hoja de QR como página para imprimir | PDF en el servidor | Sin dependencias nuevas en la API; el navegador guarda el PDF |
| `ADMINISTRAR` para la carta web y los QR | Acción nueva; `EDITAR_CARTA` | Es configuración de la sucursal, como el mapa y la impresión de 004; la matriz no cambia |

## Migraciones

Con fecha posterior a `202610310005`. Tablas de `public` con `sqlTablaDeEmpresaTrazable(tabla, { privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'], privilegiosPlataforma: [], llaveDeEquipo: true })`. Ninguna escribe datos; `pnpm db:revertir` de cada una deja el esquema de la anterior.

- `202611020001-carta-web.ts` (C1): esquema `carta_publica` y `carta_publica.empresa_slug`; `carta_web` y `carta_web_sucursal`; trigger `carta_publica.mantener_slug()`; función `public.empresa_de_carta(text)` con sus `REVOKE` y `GRANT`.
- `202611020002-qr-mesas.ts` (C1): `mesa_qr`; `carta_publica.codigo_mesa`; trigger `carta_publica.mantener_codigo_mesa()`; función `public.empresa_de_codigo_mesa(text)`.
- `202611020003-llamados.ts` (C2): `llamado` con su clave primaria `(empresa_id, id)`, los `CHECK` de coherencia, el índice único parcial de pendientes y los índices de límites y de la lista.
- `202611030001-llamados-ataque-ronda1.ts` (ronda 1 del ataque, F6): `llamado.atendido_por_sesion_id` y `llamado.cerrado_por_sesion_id`, con llaves compuestas hacia `sesion (id, empresa_id)`, para distinguir dos sesiones de soporte (criterios 43 y 51).

Las mesas que ya existen no reciben código en la migración: lo crea `POST /sucursales/:sucursalId/qr-mesas` (8), porque el código lo genera la API.

## Riesgos

- **Una función `SECURITY DEFINER` es un hueco en la RLS a propósito.** Mitigación: devuelven solo un `uuid` por coincidencia exacta, el esquema no tiene `USAGE` para nadie, `EXECUTE` solo para la API, la guarda las rechaza dentro de un contexto, y P1 prueba cada una de esas propiedades (como el criterio 89 de 002).
- **Pruebas que pasan por la razón equivocada.** Un 404 público puede venir de un slug mal formado y no de la RLS; un 429, del tope en memoria y no del límite de la base. Mitigación: P1 y P2 usan datos bien formados y comprueban que el mismo caso sin la condición responde 201 o 200; el tope en memoria se prueba aparte.
- **Llamados falsos.** Quien tenga una foto del QR puede mandar llamados en horario. Mitigación: nada llega a cocina, uno pendiente por mesa, límites, vencimiento, descarte con motivo y cambio de QR. Si en el piloto aparecen bots, se puede sumar Cloudflare Turnstile en el `POST` público sin cambiar el contrato (fuera de alcance).
- **IP compartida.** Ver "Riesgos aceptados propuestos" de `spec.md`.
- **El aviso con el celular bloqueado.** Sin push, un mozo con la pantalla apagada no oye el aviso; lo ve al abrir la app. Se documenta en el README; push queda fuera de alcance.
- **Costo de `prepararLineas`.** Con 30 líneas, un solo cargador (siete consultas restringidas a los productos de las líneas) en lugar de 30; la revisión del detalle se calcula en cada lectura. Aceptable para RNF-03; si molesta, se guarda la revisión unos segundos en el cliente.
- **Línea de base de Next.** El App Router trae unos 100 kB gzip de JavaScript base; el presupuesto de 120 kB deja poco margen para la carta. Mitigación: la carta es casi toda HTML del servidor y la isla de disponibilidad es mínima; si no alcanza, el revisor propone el ajuste con su motivo (88).
- **Caché de la carta.** Hasta 30 s (más `stale-while-revalidate`) la carta puede mostrar un plato recién agotado o no mostrar uno reactivado. La disponibilidad lo oculta en segundos y el envío lo rechaza; lo reactivado aparece al recargar.
- **Fuga del código por `Referer`.** Las fotos se cargan desde el servidor de Next o desde R2; sin `Referrer-Policy: no-referrer`, el código iría en el `Referer`. Mitigación: la cabecera en el modo mesa (80) y una prueba del E2E que la revisa.
- **Réplica del paso perdida en el equipo.** Ver "Riesgos aceptados propuestos" de `spec.md`.
- **Tamaño de la PWA.** Quedan pocos kB de margen en el presupuesto de 170 kB (004). Todo lo nuevo va bajo demanda; si aun así no alcanza, el revisor propone subirlo con su motivo.
- **Ajuste de una prueba protegida de 002.** `RUTAS_PUBLICAS` debe ganar las seis rutas públicas; lo hace test-writer en la fase B y el orquestador lo excluye de la comprobación con `git diff` solo por ese cambio.
