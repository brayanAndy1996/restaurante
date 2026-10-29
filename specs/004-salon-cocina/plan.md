# 004 · Plan técnico

Entregas 3a (Salón y Cocina) y 3b (Impresión básica en la nube), aprobadas por el usuario el 2026-10-29; la app Android del puente es la entrega 3c, que se especifica aparte (decisiones 1 y 13). Los números entre paréntesis son criterios de `spec.md`; "decisión N" remite a "Decisiones del usuario (2026-10-29)" de `spec.md`. Se ejecuta 3a completa y después 3b.

## Módulos afectados

### Entrega 3a

- `packages/dominio`:
  - `src/salon/comanda.ts` (ruta crítica): `partesDeComanda`, `partesDeStock`, `partesDeStockDeEnvio` (74, 75). Reciben la `LineaPreparada` de `packages/contratos` (solo el tipo) y no conocen la base.
  - `src/salon/montos.ts` (ruta crítica): `totalVigenteLinea`, `totalOrden`, `excedeMontoMaximo`, `MONTO_MAXIMO` (76), con `decimal.js` y la misma validación de texto de `precios.ts` de 003.
  - `src/salon/estados.ts` y `src/salon/catalogos.ts`: estados, tipos, formas, destinos, límites, `estadoDeMesa`, `esOrdenAbierta`, `transicionKdsValida` (77).
  - Pruebas en `test/salon/`.
- `packages/contratos`: `src/salon.ts` (esquemas de 3a), `src/errores.ts` (códigos nuevos y `ordenId`), `src/usuarios.ts` (`sucursalAccesoEntradaSchema` con los dos campos opcionales y al menos uno; `sucursalAccesoRespuestaSchema` con `minutosInactividadCocina`).
- `apps/api`:
  - `src/modulos/salon/` (nuevo, dueño de `zona` y `mesa`): `zonas.controller.ts` / `zonas.service.ts`, `mesas.controller.ts` / `mesas.service.ts`, `mesas-consulta.service.ts` (exportado: mesas de una sucursal y bloqueo de mesas por id para pedidos).
  - `src/modulos/pedidos/` (nuevo, dueño de `orden`, `orden_mesa`, `envio`, `marcha`, `item`, `comanda`, `comanda_linea`, `anulacion_item`, `precuenta`): ver "Estructura del módulo `pedidos`".
  - `src/nucleo/tiempo-real/` (nuevo): servidor Socket.IO, adaptador, `PublicadorSocketIo`, revisión de sesiones; ver "Tiempo real".
  - `src/nucleo/eventos/publicador-eventos.ts`: `SalaDeEvento` gana `{ tipo: 'puente', puenteId }`.
  - `src/nucleo/base-de-datos/control-transaccion.ts`: nombres nuevos en `NOMBRES_PROHIBIDOS` (70).
  - `src/nucleo/base-de-datos/verificar-roles.ts` y `scripts/db-preparar`: rol `restaurante_tiempo_real` y esquema `tiempo_real` (70).
  - `src/modulos/seguridad/`: `ValidadorDeSesion` (extraído de `ResolutorEmpresaSesion`, mismo comportamiento), `UsuariosConsultaService.puedenAtenderMesa`, `SesionActual.autorizacionConsumida()` (y `PermisoInterceptor` la guarda), cierre de sockets al cerrar sesión (llamando al puerto de tiempo real con `alConfirmar`). Inactividad de Cocina/Barra (63b, 63c; decisión 11): `inactividad.ts` (nuevo, con `minutosDeInactividad`), `constantes-acceso.ts` (`MINUTOS_INACTIVIDAD_COCINA_POR_DEFECTO = 60`), `autenticacion.guard.ts`, `sesiones.service.ts`, `ingreso-pin.service.ts`, `acceso-sucursal.service.ts` y `acceso-sucursal.controller.ts`, y `ValidadorDeSesion`; sesiones de PIN y de contraseña; ver "Inactividad de Cocina/Barra".
  - `src/modulos/carta/`: `CartaConsultaService` exportado (estaciones activas).
  - `src/aplicacion.ts`: opciones `inventario` y `tiempoReal`; arranque del servidor de Socket.IO sobre el servidor HTTP de Nest.
  - `src/config/entorno.ts`: `TIEMPO_REAL`, `DATABASE_TIEMPO_REAL_URL`, `DB_PASSWORD_TIEMPO_REAL`.
  - `src/migraciones/`: ver "Migraciones".
  - Pruebas no protegidas en `test/salon/`, `test/pedidos/`, `test/cocina/`, `test/tiempo-real/`; protegidas en `test/salon-critica/` (fase B), más el ajuste de P0 en `test/acceso/pin.spec.ts` y `test/acceso/sesion-rutas.spec.ts` (protegidas de 002).
- `apps/app`:
  - `src/modulos/salon/`: `SalonPagina` (mapa y lista), `AbrirMesaHoja`, `OrdenPagina`, `ComanderoPagina`, `HojaDeProducto`, `Borrador` y `borrador.ts` (almacenamiento por persona y orden), `AnularItemHoja`, `AnularOrdenHoja`, `SeleccionDeMesas` (mover y unir), `PrecuentaVista`, `AvisosDeListo`, `salon.ts` y `ordenes.ts` (consultas y mutaciones).
  - `src/modulos/cocina/`: `CocinaPagina` (KDS), `TarjetaDeComanda`, `cocina.ts`.
  - `src/modulos/ajustes/`: `AjustesPagina` (agrupa lo de administración de 002) y `mapa/` (`EditorDeMapa`, `ZonaFormulario`, `MesaFormulario`); la pantalla "Acceso" de 002 gana el campo de Cocina y Barra (63c), y su prueba `apps/app/test/equipos.spec.tsx` (no protegida) actualiza el simulacro de la respuesta.
  - `src/lib/tiempo-real.ts`: cliente de Socket.IO, reconexión e invalidación de consultas.
  - `src/componentes/AppLayout.tsx` y `src/App.tsx`: navegación por rol (87) y rutas.
- `packages/ui` (skill `impeccable`): `BaldosaDeMesa`, `CuadriculaDeMesas`, `ContadorGrande` (− y + de 48 px), `Temporizador` (tiempo transcurrido con umbrales), `TarjetaKds`.

### Entrega 3b

- `packages/contratos`: `src/impresion.ts` y `src/puente.ts` (protocolo, versión 1).
- `apps/api`:
  - `src/modulos/impresion/` (nuevo, dueño de `impresora`, `estacion_destino`, `impresion_sucursal`, `vinculacion_puente`, `puente`, `trabajo_impresion`): ver "Impresión".
  - `src/modulos/impresion/escpos/`: `renderizarTicket`, tablas de codificación (`PC850`, `PC858`, `WPC1252`, `PC437`, transliteración `SIN_TILDES`), `plantillas/` (comanda, pre-cuenta, prueba).
  - `src/modulos/seguridad/autenticacion.guard.ts`: deja pasar las rutas `@Puente()` y `@VinculacionPuente()` a sus guards, como con `@Superadministrador()`.
  - `src/nucleo/tiempo-real/`: espacio `/puente`.
  - `test/soporte/puente/`: `SimuladorPuente`, `EmuladorEscPos`; `scripts/puente-simular.ts` (`pnpm puente:simular`).
  - Pruebas protegidas en `test/impresion-critica/`.
- `apps/app`: `src/modulos/ajustes/impresion/` (impresoras, destinos, impresora de caja, puente con QR, trabajos), banner de impresión (122) en `AppLayout`, "Imprimir" y "Reimprimir" en el salón. El QR se dibuja con una dependencia chica sin red (por ejemplo `qrcode-generator`, unos 20 KB) cargada bajo demanda.

## Diseño

### Estructura del módulo `pedidos`

```
apps/api/src/modulos/pedidos/
  pedidos.module.ts
  ordenes.controller.ts            POST /ordenes, GET/PATCH /ordenes/:id, movimiento, unión, liberación, anulación
  envios.controller.ts             POST /ordenes/:id/envios, /marchas
  anulaciones.controller.ts        POST /ordenes/:id/items/:itemId/anulaciones
  precuentas.controller.ts         POST /ordenes/:id/precuentas
  salon.controller.ts              GET /salon, GET /salon/stock
  cocina.controller.ts             GET /cocina/comandas, PUT /cocina/lineas/:id/estado, /comandas/:id/listo|visto
  ordenes.service.ts               abrir, consultar, comensales, mover, unir, liberar, anular orden
  envios.service.ts                envío y marcha (ruta crítica)
  anulaciones.service.ts           anular ítem (ruta crítica)
  precuentas.service.ts
  cocina.service.ts
  pedidos-consulta.service.ts      exportado (hayOrdenesAbiertas, ordenesAbiertas)
  comandas.ts                      arma comandas y líneas con partesDeComanda; las inserta en lote
  bloqueos-orden.ts                bloquea órdenes y mesas en orden de id (FOR UPDATE)
  replica.ts                       huella de la entrada normalizada y búsqueda de la réplica por id de cliente
  eventos-pedidos.ts               registra los eventos con alConfirmar (uno por sala y nombre por operación)
  vista-orden.ts                   arma ordenRespuesta con consultas fijas y totalOrden
  inventario/inventario.puerto.ts  INVENTARIO, InventarioPuerto, InventarioNulo
  impresion/impresion.puerto.ts    IMPRESION, ImpresionPuerto, ImpresionSoloKds
  errores-pedidos.ts
```

- `PedidosModule` importa `SalonModule` (`MesasConsultaService`), `CartaModule` (`CartaVentaService`), `SeguridadModule` (`UsuariosConsultaService`, `SesionActual`) y el módulo de plataforma (`SucursalesConsultaService.horaCorte`); no consulta tablas ajenas. `SalonModule` no importa `PedidosModule` (el mapa con estados vive en pedidos, así no hay ciclo).
- Todo corre en el contexto de empresa del interceptor global de 002, con el actor de la sesión.

### Abrir una mesa (9 a 12)

1. `@Idempotente()` resuelve la réplica de la misma clave.
2. Busca `orden` por `id` (bajo RLS). Si existe: misma mesa (en `orden_mesa` desde el inicio) → devuelve la orden (201); otra → 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
3. `MesasConsultaService.bloquear([mesaId], sucursalActiva)` (`FOR UPDATE`; 404 si no es de la sucursal activa; 409 si está inactiva).
4. Valida `mozoId` con `UsuariosConsultaService.puedenAtenderMesa` (matriz de `packages/dominio` sobre el rol de cada usuario en esa sucursal).
5. `INSERT orden` y `INSERT orden_mesa`. Si el índice único parcial de `orden_mesa` falla (`23505`, otra apertura ganó), relee la orden vigente y responde 409 `MESA_OCUPADA` con su `ordenId`; si el `INSERT orden` choca por `id` (réplica concurrente), vuelve al paso 2.
6. `salon.cambio` y `orden.cambio` con `alConfirmar`.

El bloqueo de la mesa del paso 3 serializa las aperturas de la misma mesa; el índice único es la red de seguridad.

### Enviar (15 a 31, ruta crítica)

Una sola transacción (la de la petición):

1. Forma (`PipeZod`): 400. `@Idempotente()`: réplica de la misma clave.
2. `bloquearOrden(id)`: `SELECT … FROM orden WHERE id = $1 AND sucursal_id = $2 FOR UPDATE` (404 si no). Serializa los envíos, marchas, anulaciones, uniones y pre-cuentas de la misma orden; el número del envío y "es adición" se calculan con la orden bloqueada (28).
3. **Réplica por id** (26): `SELECT … FROM envio WHERE id = $1` (bajo RLS). Si existe, compara su `huella_entrada` (SHA-256 de la entrada normalizada: ids en minúsculas, modificadores ordenados, valores por defecto) y su orden; igual → responde el envío guardado armado con `vista-orden.ts` (201), sin efectos; distinta → 422. Va antes del estado de la orden y de la validación de las líneas, para que una réplica después de un agotado o una anulación devuelva el éxito original. Réplicas concurrentes: la segunda espera el bloqueo de la orden del paso 2 y, al seguir, ya encuentra el envío (27).
4. Estado: `UNIDA` → 409 con `unidaA`; `ANULADA`/`CERRADA` → 409.
5. Para cada línea, `CartaVentaService.prepararLinea({ …, instante: reloj.ahora() })`; junta los rechazos de todas (17) y, si hay alguno, lanza 422 con `campos` por línea. Las líneas que comparten producto se preparan igual una por una (la carta ya cachea poco; con 50 líneas como máximo son ≤ 50 llamadas de 7 consultas: ver "Riesgos").
6. Montos: `excedeMontoMaximo(linea.total)` por línea y `excedeMontoMaximo(totalOrden(ítems vigentes + nuevos))` (21).
7. `INSERT envio` (con `numero`, `es_adicion`, `huella_entrada`), `INSERT item` en lote con la `linea` en `jsonb`.
8. `comandas.ts`: `partesDeComanda` por ítem; agrupa por estación en el orden de los ítems; pide `IMPRESION.destinos(sucursalId, estacionIds)` (en 3a, todo `KDS`); `INSERT comanda` y `INSERT comanda_linea` en lote (con `esperar = tiempo = 2`).
9. `INVENTARIO.alEnviar({ sucursalId, envioId, partes: partesDeStockDeEnvio(lineas) })` (72). Si lanza, la transacción se revierte.
10. `IMPRESION.encolar(trabajos)` (3b: crea los trabajos de las comandas con impresora; 3a: nada).
11. Si la orden estaba `EN_PRECUENTA`: `estado = 'ABIERTA'`, `precuenta.invalidada_en = ahora`. `orden.version += 1`.
12. Eventos con `alConfirmar` (31).

- **Por qué bloquear la orden y no solo confiar en `Idempotency-Key`:** la clave de 002 está atada al actor; la réplica por `envio.id` cubre el cambio de usuario (26) y el bloqueo de la orden hace que la búsqueda del paso 3 y el `INSERT` del paso 7 no se crucen con otra réplica.
- **Contención:** el bloqueo es por orden; dos mesas distintas no se esperan.

### Marchar (32, 33)

Bloquea la orden, busca la réplica por `marcha.id`, elige los ítems (`tiempo = 2`, `marchado_en IS NULL`, vigentes), crea `marcha`, una comanda `MARCHAR` por estación con líneas que copian las partes de esos ítems (con `cantidad` fija = vigente de la parte), pone `marchado_en` y `esperar = false` en las líneas originales. Pide destinos e imprime igual que el envío.

### Anular un ítem (34 a 41, ruta crítica)

Orden de los interceptores de la ruta: autenticación y rol, idempotencia (réplica de la misma clave: devuelve lo guardado sin pasar por `@Permiso`), permiso (consume la autorización y guarda en `SesionActual` la consumida), módulo, controlador. Si el orden por defecto de Nest no deja la idempotencia antes del permiso, se aplica `IdempotenciaInterceptor` de forma explícita antes en estas rutas (las rutas de 002 no combinan los dos con una acción `clave`, así que no cambian).

1. Bloquea la orden (404 si el ítem no es de esa orden de la sucursal activa).
2. Réplica por `anulacion_item.id` con `huella_entrada` (37).
3. Estado de la orden (409), ítem (`ITEM_NO_ANULABLE`), cantidad (422).
4. `UPDATE item SET cantidad_anulada = cantidad_anulada + $n, estado = CASE …`; `INSERT anulacion_item` con `autorizado_por_id` y `autorizacion_id` de `SesionActual.autorizacionConsumida()`.
5. Comandas `ANULACION`: para cada estación de las partes del ítem (recalculadas con `partesDeComanda` sobre la `linea` guardada), una comanda con líneas de `cantidad` fija = `cantidad_por_item × n`. Las líneas originales con vigente 0 pasan a `ANULADO`.
6. `INVENTARIO.alAnular({ partes: partesDeStock(linea, n), destino })`.
7. Pre-cuenta: invalidar si estaba `EN_PRECUENTA`, también en una anulación parcial (decisión 10). `orden.version += 1`.
8. `AuditoriaService.registrar({ accion: 'anular_item', entidad: 'item', … })` (41).
9. Eventos.

Anular la orden (42, 43) hace los pasos 4 a 6 para cada ítem vigente con la orden bloqueada, cierra `orden_mesa` y deja una sola fila `anular_orden`.

### Mover y unir (45 a 49)

- `bloqueos-orden.ts` toma, en una sola consulta ordenada por id, las órdenes involucradas (`FOR UPDATE`) y luego las mesas (`MesasConsultaService.bloquear`, también por id). Siempre órdenes antes que mesas; la apertura toma solo la mesa, y el envío solo la orden, así que no se forman ciclos. Lo que se escape responde 409 `CONFLICTO` (traducción de `40P01` de 003).
- Para saber qué órdenes ocupan las mesas pedidas se lee `orden_mesa` sin bloqueo, se bloquean esas órdenes y se vuelve a leer; si cambió, se repite una vez y luego 409 `CONFLICTO`.
- Unir con otra orden: `UPDATE item SET orden_id = principal WHERE orden_id = O2`; `UPDATE orden_mesa SET orden_id = principal WHERE orden_id = O2 AND hasta IS NULL` (cerrando y abriendo filas para conservar el historial); O2 `UNIDA`, `unida_a_orden_id`; comensales sumados; versiones e invalidación de pre-cuentas; auditoría `unir_ordenes`.
- Los envíos guardan su `orden_id` de origen (no cambia), así el número de envío y "es adición" de la orden absorbida se conservan en sus ítems; la vista de la orden agrupa por envío.

### Pre-cuenta (50 a 54)

Bloquea la orden, busca la réplica por id, comprueba la pre-cuenta vigente (`version_orden = orden.version` → la devuelve), si no inserta una nueva con `numero` siguiente, sus `lineas` y `total = totalOrden(...)` (con `excedeMontoMaximo`, que nunca debería fallar por el criterio 21), pone `EN_PRECUENTA`. En 3b, `IMPRESION.encolar` del trabajo `PRECUENTA` (también cuando devuelve la vigente, salvo réplica del mismo id o clave).

### Vista de la orden y del salón (7, 55)

- `vista-orden.ts` arma `ordenRespuesta` con consultas fijas: orden, mesas vigentes, ítems con su autor (nombre por `UsuariosConsultaService`), conteo de líneas por estado y por ítem, pre-cuenta vigente. `total` y `totalVigente` con `packages/dominio`.
- `GET /salon`: zonas y mesas (`MesasConsultaService`), órdenes abiertas de la sucursal con sus mesas vigentes y sus ítems vigentes (para `totalOrden`), y nombres de mozos: cinco consultas, sin importar cuántas mesas. `ETag` con el mismo ayudante de la carta (`etag-carta.ts` pasa a `nucleo/http/etag.ts` para compartirlo; la carta lo reexporta).

### KDS (56 a 63)

- `GET /cocina/comandas`: tres consultas fijas (comandas de la sucursal con líneas pendientes o no vistas, más las recientes; sus líneas; las órdenes con mesas y mozo). En 3b, solo `destino = 'KDS'`.
- `PUT /cocina/lineas/:id/estado`: bloquea la línea `FOR UPDATE`, valida con `transicionKdsValida`, actualiza `estado` y `estado_en`, y registra `cocina.linea` y, si pasa a `LISTO`, `cocina.listo` con los destinatarios (mozo de la orden vigente del ítem y `creado_por_usuario_id` del ítem).

### Inactividad de Cocina/Barra (63b, 63c; decisión 11)

- **Una sola regla:** `minutosDeInactividad({ tipo, rol, minutosSucursal, minutosCocina, minutosSesion })` en `apps/api/src/modulos/seguridad/inactividad.ts`, en este orden: sesión de soporte → `minutosSesion` (30, sin cambios); sesión de PIN o de contraseña con rol `COCINA_BARRA` en la sucursal activa → `minutosCocina ?? 60`; otra sesión PIN → `minutosSucursal ?? 5` (también sin sucursal activa); otra sesión de contraseña → `minutosSesion` (30, `MINUTOS_INACTIVIDAD_CONTRASENA`). La usan el guard (`autenticacion.guard.ts`, hoy líneas 226 a 229), `GET /sesion` (`sesiones.service.ts`, hoy líneas 505 a 509), el ingreso con contraseña (`sesiones.service.ts`, la expiración de la respuesta, hoy línea 457, con el rol de la sucursal inicial), el ingreso con PIN (`ingreso-pin.service.ts`, hoy líneas 238 a 243) y `ValidadorDeSesion` (Socket.IO), para que no haya dos cálculos. La columna `sesion.minutos_inactividad` no cambia (sigue guardando 30 en contraseña y soporte); el tiempo de Cocina/Barra se decide al validar, así un cambio de rol, de sucursal o de configuración rige desde la siguiente petición.
- **Orden en el guard:** hoy `autenticacion.guard.ts` calcula el vencimiento antes de resolver el rol. La consulta de la sesión agrega `sa.minutos_inactividad_cocina` y el rol de `acceso_sucursal` de la sucursal activa (un `LEFT JOIN` más en la misma consulta, sin otra ida a la base), para sesiones de PIN y de contraseña; el rol que se usa es el mismo que luego da los permisos de la petición. El Administrador no tiene fila en `acceso_sucursal` y queda con su tiempo de siempre.
- **Configuración:** `AccesoSucursalService` lee y escribe las dos columnas; el `PATCH` con un solo campo deja el otro igual; la fila de auditoría `configurar_acceso_sucursal` lleva el antes y el después de los campos cambiados.
- **Migración:** `ALTER TABLE sucursal_acceso ADD COLUMN minutos_inactividad_cocina smallint NOT NULL DEFAULT 60 CHECK (… BETWEEN 1 AND 720)`; el trigger de trazabilidad de 002 no cambia. `down` borra la columna.

### Tiempo real (64 a 71)

```
Cliente (PWA)  --wss /tiempo-real (espacio "/")-->  Socket.IO Server (API, cada instancia)
Puente (3b)    --wss /tiempo-real (espacio "/puente")-->        |
                                                                 | @socket.io/postgres-adapter
                                                                 v
                                             Pool propio (rol restaurante_tiempo_real)
                                             NOTIFY/LISTEN en el canal del adaptador
                                             tabla tiempo_real.socket_io_attachments
```

- **Servidor:** `socket.io` (sin `@nestjs/websockets`, para no saltarse las reglas de autenticación con otro sistema de guards) creado en `onApplicationBootstrap` sobre `HttpAdapterHost.httpAdapter.getHttpServer()`, `path: '/tiempo-real'`, `cors` con `ORIGENES_PERMITIDOS`, `serveClient: false`, `maxHttpBufferSize: 4096` (los clientes no mandan nada útil).
- **Autenticación (64):** middleware del espacio `/` que llama `ValidadorDeSesion.validar(token, equipo, { renovar: false })` (el mismo código que usa `ResolutorEmpresaSesion` en HTTP, dentro de `ContextoEmpresa.ejecutar` con la empresa del token). Si valida, guarda en `socket.data` `{ empresaId, sesionId, sucursalId }` y hace `socket.join('e:' + empresaId)` y, con sucursal, `socket.join('s:' + empresaId + ':' + sucursalId)`, además de `sesion:<sesionId>` (para cerrar). Si no, `next(new Error('NO_AUTENTICADO'))`.
- **Sin eventos del cliente (65):** no se registra ningún `socket.on` de aplicación; `socket.onAny` registra un aviso en el log y no hace nada.
- **Cierre (66):** `SesionesService.salir`, el cambio rápido, las revocaciones y `elegirSucursal` registran con `alConfirmar` `tiempoReal.desconectarSesion(sesionId)` (`io.in('sesion:' + id).disconnectSockets(true)`, que el adaptador reparte a todas las instancias). Además, cada 60 s cada instancia revisa sus conexiones locales agrupadas por empresa con `ValidadorDeSesion.siguenValidas(empresaId, sesionIds)` (una consulta por empresa, con el reloj de la API) y desconecta las que vencieron. La prueba usa `revisarAhora()`.
- **Publicación (67):** `PublicadorSocketIo.publicar({ empresaId, sala, nombre, datos })` traduce la sala a `e:<empresaId>`, `s:<empresaId>:<sucursalId>` o `p:<empresaId>:<puenteId>` y hace `io.of(espacio).to(sala).emit(nombre, datos)`. Nunca usa una sala que no lleve la empresa.
- **Adaptador (68, 70):** `@socket.io/postgres-adapter` con un `pg.Pool` propio (`DATABASE_TIEMPO_REAL_URL`, 2 conexiones), `tableName: 'tiempo_real.socket_io_attachments'`, `payloadThreshold` por defecto. Ese pool no pasa por la guarda de la API (no es la conexión de la API) y su rol no tiene privilegios sobre `public`: aunque alguien escuchara el canal, no podría leer tablas. Los eventos llevan solo ids, así el `NOTIFY` no transporta datos de negocio de más (69).
- **Guarda (70):** los nombres nuevos se agregan a `NOMBRES_PROHIBIDOS` (`control-transaccion.ts`), que ya busca fuera de literales y comentarios. `pg_advisory_xact_lock` no entra en la lista (la usa `ProductosService.bloquearEnOrden` de 003).
- **Arranque:** `verificarRoles` comprueba también el rol de `DATABASE_TIEMPO_REAL_URL` (no superusuario, sin `BYPASSRLS`, no dueño de tablas de `public`, sin membresías) cuando `TIEMPO_REAL=habilitado`.
- **Pruebas:** `crearAplicacion({ tiempoReal: { habilitado: true } })` y `app.listen(0)`; `ClienteTiempoReal` (`socket.io-client`) con helpers `esperarEvento(nombre, ms)` y `noRecibe(nombre, ms)`. La prueba de varias instancias levanta dos aplicaciones en el mismo proceso contra la misma base.
- **PWA:** `socket.io-client` (unos 15 KB gzip) cargado con la sesión. Reconecta con espera creciente (1, 2, 5, 10 s); al reconectar invalida todo lo del salón y la cocina. Si la sesión cambia (`alCambiarLaIdentidad` de 003), cierra y abre otra conexión.

### Inventario (72, 73)

`INVENTARIO` es un token de Nest en `PedidosModule` con `InventarioNulo` por defecto. La sección 6 lo reemplazará desde su módulo (`InventarioModule` provee el token y `PedidosModule` lo importa), sin cambiar el envío. Las pruebas usan un `InventarioDePrueba` que registra las llamadas y puede lanzar.

### Impresión (3b)

- **Puerto en pedidos:** `IMPRESION.destinos(sucursalId, estacionIds)` lee `estacion_destino` (sin fila = `KDS`) y `encolar(trabajos)` inserta en `trabajo_impresion` con su documento lógico, dentro de la transacción del envío; el índice único parcial por `comanda_id` impide un segundo trabajo de la misma comanda (101). `ImpresionModule` provee el token; `PedidosModule` lo importa. `impresion` no importa `pedidos`: el documento lo arma pedidos (`plantillas` de datos, no de bytes) con `documentoTicket`.
- **Credenciales (106 a 109):** tokens `vi.<empresaId>.<id>.<secreto>` y `pu.<empresaId>.<id>.<secreto>`, con el mismo formato y la misma comparación de huellas en tiempo constante que `eq.…` de 002. `PuenteGuard` y `VinculacionGuard` parsean el token, abren `ContextoEmpresa.ejecutar(empresaId, …, { actor: { sistema: 'puente:<id>' } })` (o `puente:vinculacion`) y verifican la fila bajo RLS. Un token de otro tipo en esas rutas, o uno de estos en las demás, responde 401 desde `AutenticacionGuard`.
- **Vincular:** `UPDATE vinculacion_puente SET usada_en = ahora WHERE id = $1 AND usada_en IS NULL AND invalidada_en IS NULL AND expira_en > ahora RETURNING …` (una sola gana); revoca el puente activo anterior (`activo = false`), inserta el nuevo y registra con `alConfirmar` la desconexión de la sala del anterior.
- **Entrega (113):** `SELECT … FROM trabajo_impresion WHERE sucursal_id = $puente AND estado = 'PENDIENTE' AND dia_operativo = $hoy ORDER BY creado_en, id LIMIT 50` (el día operativo con `horaCorte` y el reloj); marca `entregado_en`; renderiza con la configuración actual de cada impresora. Los `PENDIENTE` de días anteriores se informan como `VENCIDO` (117).
- **ESC/POS (123 a 126):** `renderizarTicket(documento, { anchoMm, juegoCaracteres })` devuelve un `Uint8Array`: `ESC @`; `ESC t n` (PC437 = 0, PC850 = 2, PC858 = 19, WPC1252 = 16; `SIN_TILDES` usa PC437 con texto transliterado); textos codificados con tablas propias (sin dependencias nativas); `ESC E` negrita, `GS !` tamaño, `ESC a` alineación; ajuste de línea por palabras a 32 o 48 columnas; `ESC d 4` y `GS V 66 0`. Las columnas de montos se alinean a la derecha con cifras de ancho fijo. El pulso de gaveta (`ESC p 0 25 250`) queda en el renderizador para la sección 4.
- **Estado (120 a 122):** el latido actualiza `puente.ultima_senal_en` y `estado_impresoras`; compara con lo anterior para decidir si publica `impresion.estado`. El espacio `/puente` actualiza la señal al conectarse y al desconectarse.
- **Simulador y emulador (134, 135):** `SimuladorPuente` usa `fetch` y `socket.io-client`, y `net.Socket` para la impresora; `EmuladorEscPos` es un `net.Server` con un intérprete de los comandos de arriba. El E2E de 3b levanta la API, la PWA, el emulador y el simulador.
- **Bluetooth y gaveta (decisión 12):** en 3b solo se configuran y se validan; el simulador imprime solo por red, y una impresora Bluetooth queda `DESCONOCIDO` con sus trabajos pendientes. El pulso de gaveta queda en el renderizador sin ningún trabajo que lo use.

### PWA

- **Borrador (91, 92):** `borrador.ts` guarda en `localStorage` bajo `borrador:<empresaId>:<usuarioId>:<ordenId>` las líneas y, cuando se pulsó "Enviar", `envioId` y `enviando: true`. Al terminar con 201, lo borra; con 422, quita el `envioId` y marca las líneas; con un corte o una cancelación de la cola, lo conserva y la orden muestra "Reintentar el envío". Lo escrito por otra persona en el mismo equipo no se ve (clave por usuario).
- **Precios del comandero:** `calcularLinea` y `totalOrden` de `packages/dominio`; nada se suma a mano.
- **Ventana de clave:** reutiliza `useClaveDeSupervisor` de 002 con el texto de la acción y el motivo ya escrito; reintentos con la misma `Idempotency-Key` y la misma `X-Autorizacion`.
- **KDS:** `CocinaPagina` en una o varias columnas según el ancho (en una tablet horizontal, una columna por estación filtrada); los temporizadores usan `ahora` del servidor más el reloj local transcurrido desde la respuesta (no el reloj del equipo); sonido con `AudioContext` después del primer toque (los navegadores bloquean el audio sin gesto).
- **Ajustes:** el editor de mapa es una cuadrícula de celdas de 48 px o más; tocar una celda vacía crea una mesa ahí, tocar una mesa la selecciona y la mueven las flechas de 48 px o el formulario.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Dividir en 3a, 3b y 3c (decisiones 1 y 13) | Una entrega de 142 criterios con la app Android | Commits y revisiones manejables; la app usa otra cadena de herramientas y pruebas manuales |
| Puerto de inventario en la transacción (decisión 2) | Descontar stock aquí; no dejar enganche | La sección 6 implementa sin tocar el envío; el envío ya prueba que llama una vez y que un error lo revierte todo |
| Borrador en la PWA | Ítems "por enviar" guardados en la API | Un envío = una operación idempotente; sin endpoints de borrador ni estados intermedios en la base |
| Id del cliente más `Idempotency-Key` | Solo `Idempotency-Key` | La clave de 002 está atada al actor; el id cubre el cambio rápido de usuario y la recarga. Prepara el modo offline (UUID) |
| Clave primaria `(empresa_id, id)` en las tablas con id del cliente | `id` sola como en 003 | Un UUID repetido en otra empresa no choca ni revela nada |
| Bloquear la orden en toda escritura de pedidos | Bloqueos optimistas con versión | Las escrituras de una orden son pocas y cortas; serializarlas simplifica numerar envíos, invalidar pre-cuentas y reconocer réplicas |
| Estados de cocina por línea de comanda | Por ítem | Un combo va a varias estaciones con tiempos distintos |
| Comandas con `destino` guardado al crearse | Calcular el destino al leer | Cambiar un destino no mueve comandas ya enviadas entre el KDS y la impresora |
| Socket.IO directo sobre el servidor HTTP | `@nestjs/websockets` | La autenticación es la misma función que en HTTP, sin un segundo sistema de guards; menos piezas |
| Rol y pool propios para el adaptador, esquema `tiempo_real` | Usar `restaurante_api` y una tabla en `public` | `LISTEN` está prohibido en la conexión de la API (001); la tabla en `public` exigiría RLS sin empresa; el rol propio no puede leer datos de clientes |
| Eventos con ids y refresco por HTTP con `ETag` | Eventos con la vista completa | Eventos chicos por el `NOTIFY` (límite de 8000 bytes), un solo camino de lectura con permisos, y el refresco por sondeo funciona igual sin socket |
| La nube arma los bytes ESC/POS | El puente arma el ticket | El formato se prueba en TypeScript; la app Android solo reenvía bytes y es más fácil de mantener |
| Documento lógico guardado, bytes al entregar | Bytes guardados al encolar | Un cambio de ancho o de juego de caracteres y las reimpresiones usan la configuración vigente |
| Entrega "al menos una vez" con ids recordados en el puente | "Exactamente una vez" | Sin confirmación de la impresora no se puede garantizar; recordar ids evita casi todos los duplicados |
| Vencimiento por día operativo calculado al leer | Tarea del worker que vence trabajos | Sin colas todavía; el cálculo es puro y probado, como el agotado de 003 |
| `ADMINISTRAR` para mapa, impresoras, destinos y puente | Una acción nueva `CONFIGURAR_SALON` | La fila "Usuarios, sucursales, equipos y configuración" ya lo cubre; la matriz no cambia |
| Inactividad de Cocina/Barra como columna de `sucursal_acceso` y campo de `GET`/`PATCH /sucursales/:id/acceso` (decisión 11) | Una ruta nueva solo para Cocina/Barra; un valor por usuario | Es la misma configuración de acceso de la sucursal, del mismo módulo y con la misma auditoría; el costo es ajustar la forma exacta de la respuesta en dos pruebas protegidas de 002 (P0) |
| Un solo cálculo de la inactividad (`minutosDeInactividad`) | Calcularla en cada lugar | El guard, `GET /sesion`, el ingreso con PIN o contraseña y Socket.IO deben dar el mismo vencimiento |
| T19 primero en C1 (decisión del orquestador, 2026-10-29) | Dejarla en C4, junto al KDS | P0 ajusta tres aserciones protegidas de 002; implementarlas en la primera tarea de la fase C evita que 002 quede en rojo entre commits |

## Migraciones

Con fecha posterior a `202610290005`. Todas las tablas de `public` con `sqlTablaDeEmpresaTrazable(tabla, { privilegiosApi, privilegiosPlataforma: [], llaveDeEquipo: true })`.

**3a**

- `202610300001-salon.ts` (C1): `zona`, `mesa`.
- `202610300002-pedidos.ts` (C2 y C3): `orden` (con `version`), `orden_mesa`, `envio`, `item`, `comanda`, `comanda_linea`, `marcha`. Clave primaria `(empresa_id, id)` en `orden`, `envio` y `marcha`.
- `202610300003-anulaciones-precuentas.ts` (C5 y C6): `anulacion_item`, `precuenta` (las dos con clave primaria `(empresa_id, id)`).
- `202610300004-tiempo-real.ts` (C2): esquema `tiempo_real` y `socket_io_attachments`, `GRANT` al rol `restaurante_tiempo_real` (que crea `db:preparar`, porque los roles no se crean en migraciones). `down` borra el esquema.
- `202610300005-inactividad-cocina.ts` (C1, primera migración que se aplica en la fase C aunque su número sea el último; decisión 11): columna `sucursal_acceso.minutos_inactividad_cocina` (1 a 720, por defecto 60). Es una tabla del módulo seguridad de 002; la migración solo agrega la columna.

**3b**

- `202610310001-impresion.ts` (C7): `impresora`, `estacion_destino`, `impresion_sucursal`.
- `202610310002-puente.ts` (C8): `vinculacion_puente`, `puente`, `trabajo_impresion`.

Ninguna migración escribe datos. `pnpm db:revertir` de cada una deja el esquema de la anterior.

## Riesgos

- **Pruebas que pasan por la razón equivocada.** Un 403 de clave puede venir de una sesión sin sucursal activa; un rechazo de RLS, de la falta de actor. Mitigación (como en 003): sesiones con S1 activa que sí anulan con clave justo antes y después, actor de A fijado en las pruebas de RLS y comprobación del mensaje de la política.
- **Doble envío por cambio de usuario.** Es el riesgo principal de RNF-10 y lo cubren el id del envío y el borrador por persona (26, 92). Queda un caso: el primer mozo nunca vuelve y otro reescribe el pedido a mano en su equipo con otro id. Mitigación: la cuenta muestra "Comanda enviada hace 1 min por Ana" y el KDS el autor.
- **Costo de `prepararLinea` por línea.** Cada llamada hace las siete consultas del cargador de 003 restringidas al producto; un envío de 50 líneas son 350 consultas pequeñas, del orden de 100 a 300 ms. Aceptable para RNF-02 (5 s); si molesta, `CartaVentaService` puede ganar `prepararLineas` (un solo cargador para varias), sin cambiar el contrato.
- **Bloqueo de la orden con transacciones largas.** El envío dentro de la transacción llama a la carta y al puerto de inventario; si la sección 6 lo hace lento, retiene la orden más tiempo. Mitigación: la sección 6 debe mantener `alEnviar` en consultas fijas por envío.
- **Interceptores en el orden correcto.** Que la réplica de la misma clave no vuelva a consumir la autorización depende del orden de `@Idempotente()` y `@Permiso()`. Lo prueba P3 (criterio 37) y lo revisa el adversarial.
- **Socket.IO y las sesiones.** Una conexión puede quedar viva hasta 60 s después de que la sesión vence por inactividad; solo recibe ids y estados de su sucursal. Se acepta; los cierres explícitos son inmediatos.
- **`NOTIFY` y su carga.** Todos los eventos de todas las empresas pasan por el mismo canal de PostgreSQL y cada instancia los recibe. Con pocas instancias y eventos chicos, el costo es bajo; el aislamiento depende de que las salas lleven la empresa (67) y de que nadie más escuche el canal (70). El adversarial debe intentarlo.
- **`pg_notify` en producción.** Sin superusuario no se puede quitar `EXECUTE` de `pg_notify` a `PUBLIC`; queda la guarda de la API como barrera, igual que con las funciones del criterio 38e de 001.
- **Navegadores que suspenden la PWA.** iOS cierra el socket con la pantalla apagada; el KDS en un iPad debe quedarse en primer plano. Al volver, la PWA reconecta y refresca. Se documenta en el README.
- **Inactividad de Cocina/Barra** (decisión 11). Toca el guard de autenticación de 002, que es ruta crítica: un error podría alargar las sesiones de otros roles. Mitigación: P0 prueba también, con PIN y con contraseña, que el Mozo, el Cajero, el Supervisor y el Administrador siguen con sus minutos (los de la sucursal con PIN, 30 con contraseña), que una sesión sin sucursal activa sigue con los suyos (5 o 30), que el soporte sigue con 30 y que un usuario Cocina/Barra en S1 y Mozo en S2 cambia de tiempo al cambiar de sucursal; el adversarial lo incluye en su ataque de permisos (T30).
- **Impresoras genéricas.** Las páginas de códigos varían entre marcas; por eso el juego de caracteres es configurable y hay página de prueba. La lista recomendada sale de las pruebas manuales de 3c.
- **Duplicados de impresión.** Con "al menos una vez", un corte entre la impresión y el reporte imprime dos veces; se acepta (el cocinero ve "REIMPRESIÓN" solo en las pedidas a mano; un duplicado automático es raro).
- **Tamaño de la sección.** Aun dividida, 3a tiene 100 criterios. Mitigación: commits por historia (C1 a C6), y los grupos C5 (anulaciones) y C6 (mover, unir y pre-cuenta) se pueden reordenar si hace falta.
- **Tamaño de la PWA.** Socket.IO cliente y el QR suman unos 35 KB; el QR va bajo demanda en Ajustes. El presupuesto de 170 KB gzip de 003 (160.6 KB usados) se excede con el cliente de Socket.IO en el paquete inicial: se carga bajo demanda al abrir Salón o Cocina, y si aun así no alcanza, el revisor propone subir el presupuesto con su motivo.
