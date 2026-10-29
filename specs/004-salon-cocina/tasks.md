# 004 · Tareas

Cada tarea indica su rol y los criterios de `spec.md` que cubre. La sección se entrega en dos partes (pregunta 1): **3a · Salón y Cocina** y **3b · Impresión básica**, cada una con sus fases A, B, C y D. Si el usuario prefiere una sola entrega, se hacen igual, 3a y luego 3b, con una sola aprobación. La fase C se agrupa por historia: cada grupo termina con la suite en verde y un commit propio (lo hace el documentador), en el orden indicado, porque cada uno usa lo anterior.

**Qué lleva pruebas protegidas.** Solo lo que el orquestador clasifique como ruta crítica (`spec.md`, "Clasificación de ruta crítica"; propuesta: P1 a P4 en 3a, P5 y P6 en 3b). Las escribe test-writer en la fase B de cada entrega, antes de implementar, y nadie más las toca. Lo demás lleva las pruebas que decida quien implementa, marcadas como "pruebas no protegidas".

**Preguntas abiertas.** Las tareas siguen las recomendaciones del especificador. Antes de la fase B, el orquestador ajusta las tareas según las respuestas (en especial las preguntas 2, 6, 7, 9, 10 y 11, que cambian criterios críticos o pruebas protegidas de 002).

---

## Entrega 3a · Salón y Cocina

### Fase A · Armado mínimo y firmas públicas (backend)

Deja lo necesario para que las pruebas protegidas compilen y corran. No implementa reglas, permisos ni tablas.

- [ ] T1 · backend · `packages/contratos`: `src/salon.ts` con los esquemas de la sección "Contrato" (entradas estrictas, ids de cliente, límites: 50 líneas, 30 modificadores, cantidad 1 a 999, observación 140, comensales 1 a 99, motivo con `motivoSchema`); códigos nuevos en `CODIGOS_ERROR` y `ordenId` opcional en `errorRespuestaSchema`; esquemas de los eventos. Pruebas unitarias de los esquemas. (criterios 1, 3, 9, 15, 32, 35, 42, 45, 46, 50, 55 a 58; validación de datos)
- [ ] T2 · backend · `packages/dominio/src/salon/`: `catalogos.ts` y `estados.ts` implementados (estados, tipos, formas, destinos, límites, `estadoDeMesa`, `esOrdenAbierta`, `transicionKdsValida`); firmas de `comanda.ts` (`partesDeComanda`, `partesDeStock`, `partesDeStockDeEnvio`) y `montos.ts` (`totalVigenteLinea`, `totalOrden`, `excedeMontoMaximo`, `MONTO_MAXIMO` con su valor) que lanzan `Error('No implementado')`, exportadas desde el índice. (criterios 74 a 77, firma)
- [ ] T3 · backend · Infraestructura de pruebas: token `INVENTARIO` con `InventarioPuerto` e `InventarioNulo` implementados; opciones `inventario` y `tiempoReal` de `crearAplicacion`; `apps/api/test/soporte/`: `InventarioDePrueba` (registra llamadas y puede lanzar) y `ClienteTiempoReal` (`socket.io-client` con `esperarEvento` y `noRecibe`). El servidor de Socket.IO se monta en `/tiempo-real` pero rechaza toda conexión con `Error('No implementado')`. `SalaDeEvento` gana `puente`. (habilita la fase B)
- [ ] T4 · backend · Firmas que lanzan `Error('No implementado')`, en las rutas de archivo de `plan.md`: `SalonModule` y `PedidosModule` registrados en `AppModule`, con todos los controladores y rutas de la tabla de endpoints de 3a **sin** `@Permiso` ni `@RequiereModulo` (se agregan en la fase C, para que las pruebas de permisos fallen por la razón esperada); `MesasConsultaService`, `PedidosConsultaService`, `UsuariosConsultaService.puedenAtenderMesa`, `CartaConsultaService.estaciones`, `SesionActual.autorizacionConsumida`, `ValidadorDeSesion` y el puerto `IMPRESION` con `ImpresionSoloKds`. Sin migraciones.
- [ ] T5 · backend · Entorno y base: `TIEMPO_REAL`, `DATABASE_TIEMPO_REAL_URL` y `DB_PASSWORD_TIEMPO_REAL` en `entorno.ts`, `fijarEntornoDePrueba`, `.env.example` y CI; `db:preparar` crea el rol `restaurante_tiempo_real` (sin privilegios en `public`) en la base y en la de pruebas, idempotente. Dependencias `socket.io`, `@socket.io/postgres-adapter` y `socket.io-client` con versión fija.

### Fase B · Pruebas primero (ruta crítica)

Las escribe test-writer a partir de `spec.md` y de los contratos públicos, sin mirar la implementación. Todos los archivos llevan al inicio `// spec: 004-salon-cocina (pruebas protegidas)` y viven en `apps/api/test/salon-critica/` (salvo las de `packages/dominio`, en `packages/dominio/test/salon/`). Usan la app real con `RelojManual`, `PublicadorEnMemoria` (o el tiempo real habilitado en las de P4), `InventarioDePrueba`, la carta de ejemplo de `spec.md` creada por las rutas de 003, empresas por `POST /plataforma/empresas` y usuarios por `POST /usuarios`. Toda escritura por SQL fija antes un actor. Los nombres son sugeridos.

- [ ] P0 · test-writer · **Solo si se aprueba la pregunta 11:** ajustar las pruebas protegidas de 002 que afirman la inactividad de las sesiones PIN para el rol Cocina/Barra, agregando el caso nuevo sin debilitar los demás y con la línea `// Ajustado por 004-salon-cocina, pregunta 11 (fecha de la respuesta).` debajo de su cabecera. Ningún otro archivo de 002 cambia. (criterio 39 de 002)
- [ ] P1 · test-writer · Montos: `packages/dominio/test/salon/montos.spec.ts` con cada ejemplo del criterio 76 (incluidos los `RangeError` y el tope); `apps/api/test/salon-critica/montos-orden.spec.ts`: tope de una línea y del total de la orden al enviar (422 `MONTO_FUERA_DE_RANGO` sin nada guardado), total de la pre-cuenta y de `GET /ordenes/:id` igual a `totalOrden` con los mismos datos, antes y después de anular un combo, y la nota de ICBPER. (criterios 21, 51, 55 en el total, 76)
- [ ] P2 · test-writer · Enviar comanda:
  - `packages/dominio/test/salon/comanda.spec.ts`: cada ejemplo de los criterios 74 y 75, el orden de las partes y la suma por producto.
  - `enviar-comanda.spec.ts`: forma y límites; línea preparada guardada y un cambio posterior de precio, nombre, estación y tipo que no la altera; cada motivo de rechazo con `campos` por línea y todo o nada; el agotado entre elegir y enviar (componente, opción ligada, opción del menú quitada) y su reenvío al reactivarlo; producto o modificador de B como inexistente; el ejemplo de ruteo del criterio 22 (comandas por estación, partes, sin estación, ítem sin comanda); comanda y adición; ESPERAR; invalidación de la pre-cuenta al enviar; réplica con la misma clave; réplica con el mismo id y otra clave, también desde otra sesión después de un cambio de usuario y después de anular la orden o agotar el producto; mismo id con otras líneas u otra orden (422); 10 réplicas concurrentes (un solo envío, una sola llamada al inventario, sin eventos repetidos); dos envíos concurrentes (números 1 y 2); orden `UNIDA` con `ordenId`; eventos solo después de confirmar y ninguno en réplicas o rechazos.
  - `marchar.spec.ts`: los criterios 32 y 33 (todos o algunos, nada que marchar, réplica, segundo tiempo de una adición).
  - `inventario-enganche.spec.ts`: el puerto se llama una vez por envío, anulación y anulación de orden con las partes exactas; nunca en réplicas; si lanza, nada queda guardado ni publicado.
  (criterios 15 a 29, 31 en eventos, 32, 33, 39, 72, 74, 75)
- [ ] P3 · test-writer · Permisos, clave, auditoría y atribución:
  - `anulaciones.spec.ts`: anular parte y todo; clave para Mozo y Cajero (sin cabecera 403, con autorización válida 201 y consumida, autorización de otra acción o vencida 403), sin clave para Supervisor y Administrador, Cocina/Barra 403; consumo revertido si la anulación falla; réplica con la misma clave y la misma autorización sin anular ni consumir de nuevo; mismo id con otra clave; cantidad, estado e ítem inválidos; comandas `ANULACION` por estación con la cantidad de cada parte; una fila `anular_item` con autorizador y detalle exacto (y la de `ANULAR_ITEM_ENVIADO` de 002 solo con clave); anular la orden con una fila `anular_orden`, mesas libres y todos los ítems anulados; liberar sin consumo y su rechazo con consumo.
  - `permisos-salon.spec.ts`: clasificación de las rutas recorriendo las registradas en Nest; rechazos por rol con contraseña y PIN sin cambios, auditoría ni eventos; rol de la sucursal activa (Mozo en S1 y Cocina/Barra en S2); sin sucursal activa 409; módulo `SALON` y `COCINA` fuera del plan, 403 `MODULO_NO_INCLUIDO`; soporte trazado con el superadministrador.
  - `atribucion.spec.ts`: mozo responsable por defecto y elegido (válido e inválido, de B igual que inexistente, soporte sin `mozoId`); M1 abre, M2 y C agregan: la orden sigue a nombre de M1 y cada ítem dice quién lo comandó, con su equipo en la trazabilidad.
  (criterios 10, 30, 34 a 44, 78 a 81)
- [ ] P4 · test-writer · Aislamiento:
  - `rls-salon.spec.ts` y `referencias-salon.spec.ts`: lectura, actualización, borrado e inserción entre empresas en cada tabla nueva, con actor de A y el mensaje de la política; llaves compuestas ante cada referencia cruzada del criterio 84; por HTTP, ids de B en ruta (404) y cuerpo (422) con el mismo cuerpo que un inexistente, en cada ruta de 3a; ids de cliente repetidos en B que crean su propia fila; 100 peticiones concurrentes con pool de 2.
  - `tiempo-real-aislamiento.spec.ts`: conexión con cada tipo de token (válido, adulterado, cerrado, `sa.`, `eq.`, sesión PIN sin equipo o con otro); salas por empresa y sucursal, Administrador sin sucursal activa; eventos de A que no llegan a B ni a S2; evento con empresa A y sucursal de B que no llega a nadie; eventos emitidos por el cliente (`join`) sin efecto; desconexión al cerrar sesión, al cambiar de usuario y de sucursal, y al vencer (con `revisarAhora`); dos instancias de la API con el adaptador; tamaño de cada evento; guarda que rechaza `pg_notify`, `pg_listening_channels`, `pg_locks`, `pg_blocking_pids` y los cerrojos de sesión fuera de literales (y deja pasar `pg_advisory_xact_lock` y esos textos dentro de literales); atributos del rol `restaurante_tiempo_real` y sin acceso a `public`.
  (criterios 64 a 70, 82 a 86)
- [ ] P5 · tester · Confirmar que P1 a P4 (y P0 si aplica) fallan por la razón esperada ("No implementado", tablas inexistentes, rutas sin `@Permiso` que responden 500 en lugar de 403, conexiones de Socket.IO rechazadas por "No implementado") y no por importación, sintaxis, configuración o tiempo de espera; y que las pruebas de 001, 002 y 003 siguen en verde.

### Fase C · Implementación por historia

Las tareas de backend y frontend no modifican, borran ni debilitan las pruebas de la fase B. El frontend usa la skill `impeccable` y sigue `DESIGN.md` y `PRODUCT.md`.

#### C1 · RF-22: mapa de mesas

Commit propio.

- [ ] T6 · backend · Migración `202610300001-salon.ts` (`zona`, `mesa`); zonas y mesas con `@Permiso('ADMINISTRAR')`, sucursal en la ruta (404 de B y de otra sucursal), validaciones de cuadrícula y celda, nombres únicos, `EN_USO` y `CONFLICTO`, orden de zonas, auditoría; `MesasConsultaService` (listar y bloquear por id). Pruebas no protegidas. (criterios 1 a 6)
- [ ] T7 · frontend · "Ajustes" (agrupa Usuarios y Acceso de 002) y su sección "Mapa de mesas": zonas (alta, edición, orden, desactivar) y editor de cuadrícula (tocar celda para crear, seleccionar, mover con flechas de 48 px, formulario con nombre, capacidad y forma); componentes `CuadriculaDeMesas` y `BaldosaDeMesa` en `packages/ui`. Pruebas de componente. (criterios 87 en parte, 88 en el dibujo)
- [ ] T8 · tester · Suite completa, lint, tipos y build.

#### C2 · HU-10, RF-23, RF-24: estados, apertura y tiempo real

Commit propio.

- [ ] T9 · backend · Migraciones `202610300002-pedidos.ts` (todas las tablas de pedidos de 3a salvo `anulacion_item` y `precuenta`) y `202610300004-tiempo-real.ts`; `POST /ordenes` (réplica por id, bloqueo de la mesa, `MESA_OCUPADA` con `ordenId`, índice único), mozo responsable con `UsuariosConsultaService.puedenAtenderMesa`, `PATCH /ordenes/:id`, `GET /salon` con consultas fijas y `ETag` (mover `etag-carta.ts` a `nucleo/http/etag.ts`), `@Permiso('ATENDER_MESA')` y `@RequiereModulo('SALON')`, `salon.cambio` y `orden.cambio` con `alConfirmar`. Pruebas no protegidas: concurrencia de aperturas, conteo de consultas con 5 y 80 mesas. (criterios 7 a 14; deja en verde la parte de P3 del criterio 10)
- [ ] T10 · backend · Tiempo real según "Tiempo real" de `plan.md`: `ValidadorDeSesion` extraído sin cambiar el resolutor de HTTP; servidor Socket.IO con autenticación, salas, sin eventos del cliente, `PublicadorSocketIo` (reemplaza a `PublicadorNulo` cuando está habilitado), adaptador de PostgreSQL con su pool y rol, desconexión al cerrar sesión, cambio rápido, revocación y cambio de sucursal (`alConfirmar`), revisión periódica con `revisarAhora`; nombres nuevos en `NOMBRES_PROHIBIDOS`; `verificarRoles` del rol nuevo. Deja en verde `tiempo-real-aislamiento.spec.ts`. (criterios 64 a 70)
- [ ] T11 · frontend · Navegación por rol (criterio 87) con el destino inicial; `/salon` con el mapa por zona, la vista de lista, estados con color y texto, grupos de mesas y estados vacíos; hoja "Abrir mesa" con comensales y mozo responsable; `lib/tiempo-real.ts` (conexión por sesión, reconexión, invalidación, sondeo con `ETag` cada 30 s sin socket), cargado bajo demanda. Ajustar el E2E de 003 a la navegación nueva. Pruebas de componente. (criterios 87 a 89, 97)
- [ ] T12 · tester · Suite completa, lint, tipos y build; P4 en lo que toca a tiempo real y a las tablas de C2.

#### C3 · HU-11, HU-12, HU-13, HU-14: tomar pedido, enviar, adiciones y marchar

Commit propio. Es el corazón de la ruta crítica.

- [ ] T13 · backend · `packages/dominio`: `comanda.ts` y `montos.ts` hasta dejar en verde sus pruebas de P1 y P2. (criterios 74 a 76)
- [ ] T14 · backend · `POST /ordenes/:id/envios` según "Enviar" de `plan.md`: bloqueo de la orden, réplica por id con huella, estado, `prepararLinea` por línea con rechazos por línea y todo o nada, topes de monto, envío e ítems con la línea en `jsonb`, comandas y líneas con `partesDeComanda` y `IMPRESION.destinos`, `INVENTARIO.alEnviar`, invalidación de la pre-cuenta (con la columna `version`), eventos. `GET /ordenes/:id` con `vista-orden.ts` y `GET /salon/stock`. `PedidosConsultaService`. Deja en verde `enviar-comanda.spec.ts`, `inventario-enganche.spec.ts` (envío) y `montos-orden.spec.ts` (envío). (criterios 15 a 31, 55, 72, 73)
- [ ] T15 · backend · `POST /ordenes/:id/marchas` (criterios 32 y 33). Deja en verde `marchar.spec.ts`.
- [ ] T16 · frontend · Cuenta de la mesa (`OrdenPagina`), comandero (familias, búsqueda, baldosas de producto con precio y motivos de no vendible, hoja de producto con grupos, cantidad, observación, tiempo y para llevar, precio con `calcularLinea`), borrador por persona y orden en el equipo, "Enviar" por la cola de "Pendiente de envío" con el id del envío, "Reintentar el envío", líneas rechazadas marcadas, redirección con `ordenId`, "Marchar". Pruebas de componente: borrador que sobrevive a la recarga, reintento con el mismo id, rechazo por línea. (criterios 90 a 92)
- [ ] T17 · tester · Suite completa, lint, tipos y build; P1 y P2 en verde salvo lo de anulaciones.

#### C4 · HU-19: pantalla KDS

Commit propio.

- [ ] T18 · backend · `GET /cocina/comandas` con consultas fijas y `ETag`, `PUT /cocina/lineas/:id/estado`, `PUT /cocina/comandas/:id/listo` y `…/visto`, `@Permiso('USAR_KDS')` y `@RequiereModulo('COCINA')`, eventos `cocina.linea` y `cocina.listo` con destinatarios. Pruebas no protegidas: orden de llegada, pendientes y recientes, transiciones, aviso solo al pasar a listo, filtro por estación. (criterios 56 a 63)
- [ ] T19 · backend · **Solo si se aprueba la pregunta 11:** migración `202610300005-inactividad-cocina.ts`, inactividad aparte para Cocina/Barra en el cálculo de expiración de las sesiones PIN y en `GET` y `PATCH /sucursales/:id/acceso`, con auditoría. Deja en verde P0.
- [ ] T20 · frontend · `/cocina`: filtros de estación recordados, comandas en orden de llegada en una o varias columnas, tiempo transcurrido con umbrales, líneas con todo su detalle, "Preparando", "Listo", "Todo listo", "Enterado", sonido silenciable, recientes; avisos de "Listo" en el salón para los destinatarios con la lista "Avisos"; `Temporizador` y `TarjetaKds` en `packages/ui`. Pruebas de componente. (criterios 96, 98; 40 de 002 en la pantalla de Acceso si aplica la pregunta 11)
- [ ] T21 · tester · Suite completa, lint, tipos y build.

#### C5 · HU-15, RF-35: anular ítem y orden, liberar mesa

Commit propio.

- [ ] T22 · backend · Migración `202610300003-anulaciones-precuentas.ts`; `SesionActual.autorizacionConsumida()` guardada por `PermisoInterceptor`; orden de interceptores para que la réplica de la misma clave no consuma la autorización; `POST …/anulaciones` según "Anular un ítem" de `plan.md` (réplica por id, cantidad parcial, comandas `ANULACION`, líneas `ANULADO`, `INVENTARIO.alAnular`, invalidación de la pre-cuenta, auditoría `anular_item`); `POST …/anulacion` (anular la orden con una fila `anular_orden`); `POST …/liberacion`. Deja en verde `anulaciones.spec.ts`, el resto de `inventario-enganche.spec.ts` y de `permisos-salon.spec.ts`. (criterios 34 a 44, 78 a 81)
- [ ] T23 · frontend · "Anular" en un ítem y "Anular la orden" con cantidad, motivo con atajos y destino del stock, ventana de clave de supervisor de 002 (o confirmación con `permitido`), reintento con la misma clave y autorización, nueva clave si venció conservando lo elegido; "Liberar la mesa" sin consumo. Pruebas de componente. (criterio 93)
- [ ] T24 · tester · Suite completa, lint, tipos y build; P3 completa en verde.

#### C6 · HU-16, HU-17: mover, unir y pre-cuenta

Commit propio.

- [ ] T25 · backend · `POST …/movimiento` y `POST …/union` según "Mover y unir" de `plan.md` (bloqueo de órdenes y mesas por id, relectura, unión con otra orden, `UNIDA`, comensales, invalidación de pre-cuentas, auditoría `unir_ordenes`, eventos), `@Permiso('MOVER_UNIR_MESAS')`. Pruebas no protegidas: mover a libre y a ocupada, unir libres y ocupadas, envío concurrente con la unión sin perder ni duplicar ítems, uniones cruzadas, repetición. (criterios 45 a 49)
- [ ] T26 · backend · `POST …/precuentas` (réplica por id, vigente sin cambios, número siguiente, total con `totalOrden`, nota, `EN_PRECUENTA`). Deja en verde `montos-orden.spec.ts`. (criterios 50 a 54)
- [ ] T27 · frontend · "Mover" y "Unir" con el mapa en modo selección y la confirmación con el mozo; vista de pre-cuenta con cifras tabulares, total y nota. Pruebas de componente. (criterios 94, 95)
- [ ] T28 · frontend · E2E con Playwright en viewport de celular y dos contextos (Mozo y Cocina/Barra de S1, y un Supervisor): el Administrador diseña una zona con tres mesas; el Mozo abre la mesa 1 (el otro contexto la ve en rojo sin recargar), comanda un combo y un lomo con tiempo 2, envía; el KDS ve la comanda de Cocina con "Esperar"; el Mozo marcha; Cocina marca "Listo" y el Mozo recibe el aviso; el Mozo agrega una adición; pide la pre-cuenta (mesa en amarillo) y agrega otra adición (vuelve a rojo); anula un ítem con la clave del Supervisor y el KDS ve la anulación; une la mesa 2 y mueve la cuenta a la mesa 3; envío con la red cortada que queda "Pendiente de envío" y sale una sola vez al volver; 360 px y tableta. (criterios 87 a 98 en el flujo)
- [ ] T29 · tester · Suite completa, lint, tipos, build y E2E; P1 a P4 completas en verde.

### Fase D · Ataque, revisión, verificación y cierre (3a)

- [ ] T30 · adversarial · Ataque con `spec.md`, `plan.md` y el código, sin las notas de quien implementó. Áreas sugeridas:
  - **Enviar comanda:** duplicar un envío (réplicas concurrentes con claves e ids variados, cambio de usuario a mitad, recarga, misma clave con otro cuerpo, mismo id en otra orden o en B), comandar algo no vendible esquivando la validación (ids en mayúsculas, modificadores repetidos o de otro producto, opción del menú de otro día, agotado justo antes, producto de otra sucursal), un ruteo que pierda o duplique una parte (combos con ligados en la misma estación, sin estación, menú del día), un total que pase el tope o pierda precisión, el puerto de inventario llamado dos veces o fuera de la transacción, una pre-cuenta que no se invalide.
  - **Permisos:** anular sin clave por cualquier camino (réplica, id repetido con otra clave, autorización de otra acción, de otra sesión o de otra sucursal, anular la orden para anular ítems, liberar una orden con consumo), auditoría que falte, que registre otra cantidad o que se duplique, atribución falsa (mozo responsable de otra sucursal o Cocina/Barra, autor de ítems), rutas sin `@Permiso` o sin módulo.
  - **Aislamiento:** ids de B en todas las rutas y cuerpos, ids de cliente que choquen entre empresas, eventos que crucen empresas o sucursales (salas, varias instancias, sesiones cerradas o cambiadas de sucursal), un cliente que se una a una sala ajena, canales de PostgreSQL (`pg_notify` armado, `LISTEN` desde la API, cerrojos de sesión), concurrencia con el pool.
  Cada falla vuelve como prueba nueva (test-writer, con las reglas de la fase B) y a la fase C. (criterios 10, 15 a 44, 64 a 86)
- [ ] T31 · revisor · Comparar el cambio con `spec.md`, `plan.md` y `CLAUDE.md`: módulos dueños de sus tablas (pedidos no consulta `mesa`, `producto` ni `usuario`; usa sus servicios), montos solo con `packages/dominio` y `decimal.js`, tablas con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`, efectos y eventos solo con `alConfirmar`, reloj de la API en todo cálculo de tiempo, eventos chicos con la empresa en la sala, ninguna tarea de la fase C sobre los archivos de la fase B (el orquestador lo verifica además con `git diff`), y el presupuesto de tamaño de la PWA.
- [ ] T32 · tester · Suite completa, lint, tipos, build y E2E; `pnpm db:migrar`, `pnpm db:revertir` de las migraciones de 3a y otra vez `pnpm db:migrar`, con el esquema idéntico; `db:preparar` dos veces sin errores.
- [ ] T33 · documentador · Commit de cierre de 3a y documentación (README: variables de tiempo real, el rol nuevo, cómo probar el salón y el KDS con dos navegadores, el KDS en iPad en primer plano).

### Solo ruta crítica (3a)

- [ ] Pruebas escritas por test-writer y confirmadas en rojo (P0 si aplica, P1 a P5)
- [ ] Pruebas en verde tras la implementación (T12, T17, T24, T29)
- [ ] Ataque adversarial sin fallas abiertas (T30)
- [ ] El orquestador verifica con `git diff` que la fase C no tocó los archivos de la fase B

---

## Entrega 3b · Impresión básica

### Fase A · Armado mínimo y firmas públicas (backend)

- [ ] T34 · backend · `packages/contratos`: `src/impresion.ts` y `src/puente.ts` (protocolo versión 1, `documentoTicket`), códigos `VINCULACION_INVALIDA` y `SIN_IMPRESORA`; pruebas de los esquemas. (criterios 99 a 128, validación de datos)
- [ ] T35 · backend · Firmas que lanzan `Error('No implementado')`: `ImpresionModule` con sus controladores y rutas de la tabla de 3b **sin** `@Permiso`, `PuenteGuard` y `VinculacionGuard` que rechazan todo con "No implementado", el espacio `/puente` que rechaza toda conexión, `renderizarTicket`, y el puerto `IMPRESION` provisto por `ImpresionModule` con `destinos` que devuelve `KDS` y `encolar` que lanza "No implementado" solo si hay algún destino `IMPRESORA` (así 3a sigue en verde). Sin migraciones.
- [ ] T36 · backend · Infraestructura de pruebas, completa: `EmuladorEscPos` (servidor TCP, intérprete de los comandos del plan, tickets como texto con marcas, apagar y prender) y `SimuladorPuente` (el protocolo de `puente.ts` completo: vincular, socket, pedir trabajos al conectarse, al aviso y cada 30 s, imprimir por TCP en orden, reportar, recordar ids, latido, reintentos) en `apps/api/test/soporte/puente/`, con pruebas propias del emulador. (criterios 134 y 135; habilita la fase B)

### Fase B · Pruebas primero (ruta crítica)

Mismas reglas que la fase B de 3a; archivos en `apps/api/test/impresion-critica/` con `// spec: 004-salon-cocina (pruebas protegidas)`.

- [ ] P6 · test-writer · `impresion-comanda.spec.ts`: con Cocina a una impresora y Barra al KDS, un envío crea exactamente un trabajo para la comanda de Cocina y ninguno para Barra; marcha y anulación también; réplicas con la misma clave, con el mismo id y diez concurrentes no crean trabajos de más; un rechazo o un error del puerto de inventario no deja trabajos; el aviso `trabajo.nuevo` sale solo después de confirmar y solo a la sala del puente de esa sucursal; `GET /puente/trabajos` entrega en orden de creación y el emulador recibe el ticket de la comanda correcta en la impresora correcta. (criterios 101, 112, 113 y 116 en el orden)
- [ ] P7 · test-writer · `puente-credenciales.spec.ts` y `puente-aislamiento.spec.ts`: vinculación (solo el Administrador; token de un solo uso, vencido, adulterado, de otra vinculación, de B; dos usos simultáneos), revocación del anterior y su desconexión, token `pu.` fuera de `/puente/*` y otros tokens dentro, actor `puente:<id>` en la trazabilidad y en `vincular_puente`; un puente de S1 de A que no ve ni cambia trabajos, configuración ni impresoras de S2 ni de B (ids en la ruta y en el latido), salas de Socket.IO por puente, clasificación de las rutas de 3b sin rutas públicas nuevas, RLS y referencias cruzadas de las tablas nuevas, concurrencia de dos puentes con pool de 2. (criterios 106 a 111, 129 a 133)
- [ ] P8 · tester · Confirmar que P6 y P7 fallan por la razón esperada y que 3a, 001, 002 y 003 siguen en verde.

### Fase C · Implementación por historia

#### C7 · RF-76, RF-19: impresoras, destinos e impresora de caja

Commit propio.

- [ ] T37 · backend · Migración `202610310001-impresion.ts`; impresoras (alta, edición, `EN_USO`, listado con estado y pendientes), destinos de estación (sin fila = `KDS`) e impresora de caja con `@Permiso('ADMINISTRAR')` y auditoría; `IMPRESION.destinos` real; el KDS filtra por `destino = 'KDS'`. Pruebas no protegidas. (criterios 99, 100, 102 a 105; 61 en 3b)
- [ ] T38 · frontend · Ajustes › Impresión: impresoras (lista y formulario con red y Bluetooth, ancho, juego de caracteres, gaveta), "Dónde sale cada estación" e "Impresora de caja". Pruebas de componente. (criterios 136, 137 en parte)
- [ ] T39 · tester · Suite completa, lint, tipos y build.

#### C8 · HU-38, RF-75, RF-77: puente, cola y tickets

Commit propio.

- [ ] T40 · backend · Migración `202610310002-puente.ts`; vinculaciones y vinculación del puente, revocación, `PuenteGuard`, `VinculacionGuard` y `AutenticacionGuard` con `@Puente()` y `@VinculacionPuente()`, espacio `/puente` con su sala, `GET /puente/configuracion` y `puente.configuracion`, `IMPRESION.encolar` real (trabajos de comandas y pre-cuentas en la transacción, índice por comanda), `trabajo.nuevo`, `GET /puente/trabajos` con día operativo y vencimiento, `POST …/resultado`. Deja en verde P6 y P7. (criterios 101, 106 a 117, 129 a 133)
- [ ] T41 · backend · `escpos/`: `renderizarTicket`, tablas de codificación y transliteración, plantillas de comanda (los cuatro tipos), pre-cuenta y prueba, marca de retraso y de reimpresión; `POST …/prueba`, `GET /impresion/trabajos` y `POST …/reimpresion`. Pruebas no protegidas con el emulador: cada plantilla en 58 y 80 mm y en cada juego de caracteres, ajuste de líneas, montos alineados. (criterios 114, 118, 119, 123 a 128)
- [ ] T42 · frontend · "Vincular puente" con QR (dependencia bajo demanda), texto para copiar y cuenta regresiva; estado del puente y "Revocar"; "Trabajos de hoy" con "Reimprimir"; "Imprimir" en la pre-cuenta y "Reimprimir" en la cuenta. Pruebas de componente. (criterios 137 a 139)
- [ ] T43 · tester · Suite completa, lint, tipos y build; P6 y P7 en verde.

#### C9 · HU-39, RF-78: estado, avisos y validación de punta a punta

Commit propio.

- [ ] T44 · backend · `POST /puente/latido`, señal al conectar y desconectar, `impresion.estado` solo al cambiar, `GET /impresion/estado`. Pruebas no protegidas con el reloj: puente que deja de latir a los 60 s, impresora que no responde y vuelve. (criterios 120, 121)
- [ ] T45 · frontend · Banner de impresión en todas las pantallas de la sucursal (puente desconectado, impresora que no responde, con los pendientes), reevaluado cada 15 s y con el evento; estados en Ajustes y en el KDS. (criterios 122, 138, 140)
- [ ] T46 · backend · `pnpm puente:simular --qr "<texto>"` (`apps/api/scripts/puente-simular.ts`) con el simulador y, opcional, un emulador local; README con cómo probar la impresión sin Android.
- [ ] T47 · frontend · E2E con Playwright, la API, el emulador y el simulador: el Administrador crea una impresora (el emulador) y pone Cocina en ella, vincula el puente copiando el texto del QR al simulador, imprime la página de prueba; el Mozo comanda y el emulador recibe el ticket de Cocina en menos de 5 s mientras Barra sigue en el KDS; se apaga el emulador, aparece el banner "no responde" y la comanda siguiente queda en cola; al prenderlo, sale y el banner se va; se detiene el simulador y aparece "puente desconectado"; la pre-cuenta sale por la impresora de caja; un Mozo reimprime una comanda con la marca "REIMPRESIÓN". (criterios 116, 119, 122, 127, 128, 136 a 140 en el flujo)
- [ ] T48 · tester · Suite completa, lint, tipos, build y E2E.

### Fase D · Ataque, revisión, verificación y cierre (3b)

- [ ] T49 · adversarial · Ataque con `spec.md`, `plan.md`, `packages/contratos/src/puente.ts` y el código, sin las notas de quien implementó. Áreas sugeridas: vinculación (reutilizar, adivinar, carrera, código de B, código vencido por el reloj), credencial del puente (tokens mezclados, adulterados, revocados, en rutas de personas y al revés, por Socket.IO), salir de la sucursal o de la empresa por la cola (ids de trabajos y de impresoras ajenos en resultado y latido, configuración ajena), duplicar trabajos de una comanda (réplicas, reversiones, concurrencia), salas de Socket.IO del puente. Cada falla vuelve como prueba nueva y a la fase C. (criterios 101, 106 a 113, 129 a 133)
- [ ] T50 · revisor · Comparar con `spec.md`, `plan.md` y `CLAUDE.md`: `impresion` no consulta tablas de pedidos ni de la carta, el puerto `IMPRESION` es la única entrada desde pedidos, efectos con `alConfirmar`, reloj de la API en el día operativo, sin dependencias nativas, ninguna tarea de la fase C sobre los archivos de la fase B.
- [ ] T51 · tester · Suite completa, lint, tipos, build y E2E; migrar, revertir las dos migraciones de 3b y volver a migrar con el esquema idéntico.
- [ ] T52 · documentador · Commit de cierre de 3b; README (impresión, simulador, variables); estado de `spec.md`. El orquestador lleva los "Cambios propuestos a los documentos compartidos" que el usuario apruebe y abre la entrega 3c con las "Notas para otras secciones".

### Solo ruta crítica (3b)

- [ ] Pruebas escritas por test-writer y confirmadas en rojo (P6 a P8)
- [ ] Pruebas en verde tras la implementación (T43, T48)
- [ ] Ataque adversarial sin fallas abiertas (T49)
- [ ] El orquestador verifica con `git diff` que la fase C no tocó los archivos de la fase B
