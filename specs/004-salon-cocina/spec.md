# 004 · Salón, Cocina e Impresión básica

- **Historias y requerimientos:**
  - **Entrega 3a (Salón y Cocina):** HU-10, HU-11 (sin la cantidad de stock, decisión 2), HU-12, HU-13, HU-14, HU-15, HU-16, HU-17 (la pre-cuenta en pantalla; el papel llega en 3b), HU-19; RF-22 a RF-32, RF-35, RF-36, RF-37; RF-19 segunda parte (en 3a toda estación va al KDS); RF-11 en lo que toca a la inactividad de Cocina/Barra (decisión 11). RNF que aplican: RNF-02, RNF-03, RNF-06, RNF-08 (decisión 11), RNF-09, RNF-10, RNF-11, RNF-13, RNF-17, RNF-20.
  - **Entrega 3b (Impresión básica):** HU-38, HU-39; RF-75 a RF-78 (Bluetooth y gaveta solo en la configuración, decisión 12); RF-19 segunda parte (estación a impresora); la pre-cuenta impresa de HU-17. RNF que aplican: RNF-02, RNF-06, RNF-10, RNF-12 (por el protocolo; el Android, en la app puente, decisión 13), RNF-19 (estado del puente).
  - **Se dejan para otras secciones** (decisiones 2 a 4 y 13): HU-18 y RF-34 (mostrador, sección 4), RF-33 (descuentos y cortesías, sección 4), HU-20, RF-38 y RF-67 a RF-70 (stock y porciones, sección 6; aquí queda el punto de enganche), la app Android del puente (entrega propia 3c).
  - Fuente de negocio: `fuentes.md` de esta carpeta (extracto literal, rev. 25 y 21), las decisiones del usuario de 002 y 003 y las "Decisiones del usuario (2026-10-29)" de esta especificación, que mandan donde completan o cambian `fuentes.md`. Los criterios las citan como "decisión N".
- **Ruta crítica:** sí, en parte (decidida por el orquestador el 2026-10-29, con la propuesta del especificador: P0 a P4 en 3a, P5 y P6 en 3b; el resto no es crítico). Ver "Clasificación de ruta crítica".
- **Estado:** aprobada (2026-10-29); en curso 3a.

## Objetivo

Que el mozo atienda el salón desde su celular: ve el mapa de mesas con su estado en tiempo real, abre una mesa, toma el pedido con la carta de su sucursal, lo envía y cada ítem (o cada componente de un combo) llega a la estación que lo prepara; agrega adiciones, marcha el segundo tiempo, imprime o muestra la pre-cuenta, mueve y une mesas, y corrige con la clave del supervisor lo que ya salió. Que cocina y barra vean sus comandas en orden de llegada en una pantalla KDS y avisen al mozo cuando un plato está listo. Y que, en la segunda entrega, las comandas y pre-cuentas salgan en impresoras ESC/POS del local a través de un puente vinculado por QR, con cola, reenvío y aviso cuando el puente o una impresora se desconectan. Todo con idempotencia ante microcortes (RNF-10), trazabilidad de quién abrió, quién comandó y quién autorizó, y sin que una empresa vea nada de otra.

## Entregas: 3a, 3b y 3c

La sección tiene 142 criterios: 100 en 3a (del 1 al 98, más 63b y 63c, que agrega la decisión 11) y 42 en 3b (del 99 al 140). Se divide en tres entregas (decisiones 1 y 13):

| Entrega | Qué entrega | Criterios | Por qué así |
| --- | --- | --- | --- |
| **3a · Salón y Cocina** | Mapa de mesas, apertura, comandero, enviar comanda con ruteo por estación, adiciones, tiempos 1 y 2, anulaciones con clave, mover y unir, pre-cuenta en pantalla, KDS con su propio tiempo de inactividad, tiempo real con Socket.IO y el punto de enganche del inventario | 1 a 98, 63b y 63c | Es un flujo completo y usable (el KDS en un celular de cocina reemplaza a la impresora) y concentra la ruta crítica de "Enviar comanda". |
| **3b · Impresión básica (nube)** | Impresoras por sucursal, estación a impresora o KDS, impresora de caja, vinculación del puente por QR, cola de trabajos con reenvío, estado y avisos, tickets ESC/POS, reimpresión y página de prueba, simulador del puente y emulador de impresora para las pruebas | 99 a 140 | Se apoya en las comandas de 3a sin cambiarlas: solo agrega un destino más para cada comanda. Se valida sin Android. |
| **3c · App puente Android (Kotlin)** | La app mínima que implementa el protocolo de 3b: escanear el QR, conectarse, imprimir ESC/POS por red y reportar | fuera de esta especificación ("Notas para otras secciones") | Otra cadena de herramientas (Gradle, SDK de Android), no se puede probar en este contenedor y exige pruebas manuales con impresoras reales ("Pendientes de validar" del diseño). |

Se ejecutan en ese orden: 3a completa (fases A a D y su commit de cierre) y después 3b (con sus propias fases B y D y su commit de cierre). La especificación de 3c se escribe aparte, a partir de "Notas para otras secciones".

## Límites con otras secciones

| Tema | Entra aquí | Queda para | Lo que esta sección deja listo |
| --- | --- | --- | --- |
| Mostrador (HU-18, RF-34) | No (decisión 3) | Sección 4: cobra primero y necesita caja y comprobante | `orden.tipo` y `orden.canal` con todos sus valores en el `CHECK`; `PedidosService` y el ruteo de comandas sirven igual para una orden de mostrador |
| Descuentos y cortesías (RF-33) | No (decisión 4) | Sección 4, con el cobro, el IGV y la división de cuenta | Las acciones `APLICAR_DESCUENTO` y `APLICAR_CORTESIA` siguen en la matriz sin rutas; la pre-cuenta usa `totalOrden` de `packages/dominio`, que la sección 4 amplía |
| Montos | Total vigente de cada línea y de la orden (suma de precios con IGV incluido), tope de `NUMERIC(10,2)` | Sección 4: base imponible, IGV, ICBPER, descuentos, cortesías, redondeos y división de cuenta | `item.precio_unitario`, `item.total`, `afectacion_igv`, `aplica_icbper` y la línea preparada completa en cada ítem |
| Stock (RF-67 a RF-70, RF-38, HU-20) | El punto de enganche: el envío y las anulaciones llaman a un puerto de inventario dentro de la transacción con las partes de stock ya calculadas; el destino del stock de cada anulación queda guardado (decisión 2) | Sección 6: llevar el stock, cargar porciones, descontar, bloquear en cero, el agotado automático y mostrar cuántos quedan (el comandero no muestra "quedan N" hasta entonces) | `INVENTARIO` (`alEnviar`, `alAnular`, `disponibles`), `partesDeStock` en `packages/dominio`, `anulacion_item.destino_stock`, `GET /salon/stock` y el hueco en el comandero para la cantidad |
| Cierre de caja (RF-55) | No | Sección 4: impedir el cierre con mesas o pedidos abiertos | `PedidosConsultaService.hayOrdenesAbiertas(sucursalId)` |
| Cobro (cierra la orden y libera la mesa) | No: en 3a una mesa solo se libera anulando la orden (o liberándola sin consumo, decisión 7) | Sección 4 | El estado `CERRADA` en el `CHECK` de `orden.estado` y `estadoDeMesa` que ya lo trata |
| Gaveta (RF-56) | Solo la marca "tiene gaveta" de cada impresora (3b) | Sección 4: abrir la gaveta al cobrar en efectivo | El comando ESC/POS de pulso en el renderizador y el campo `gaveta` |
| Pedidos web y por teléfono (sección 5) | No | Sección 5 | Los mismos servicios de órdenes, envío y ruteo; el canal `WEB` y `TELEFONO` en el `CHECK` |
| App Android | El protocolo del puente, su simulador y el emulador de impresora (3b) | Entrega 3c (decisión 13) | `packages/contratos/src/puente.ts` y `apps/api/test/soporte/puente/` como referencia ejecutable |

## Clasificación de ruta crítica

**Confirmada por el orquestador el 2026-10-29** (paso 3), tal como la propuso el especificador: P1 montos (criterios 21, 51 y 76), P2 enviar comanda (15 a 29, 32, 33, 72, 74 y 75), P3 permisos y auditoría (10, 30, 34 a 44 y 78 a 81) y P4 aislamiento (64 a 70 y 82 a 86) en 3a; P5 y P6 solo en 3b, con sus criterios. El criterio 48 (unir mesas) **no** es crítico. Con la decisión 11 entra además P0: el ajuste de las pruebas protegidas de 002 por la inactividad de Cocina/Barra (criterios 63b y 63c), que hace test-writer. `CLAUDE.md` pone en la ruta crítica "Enviar comanda: ruteo por estación, descuento de stock (combos, modificadores y porciones) e idempotencia", el cálculo de montos, los permisos con su auditoría y trazabilidad de autor, y el aislamiento entre empresas.

| Parte | Entrega | Crítica | Motivo |
| --- | --- | --- | --- |
| P0 · Inactividad de las sesiones PIN de Cocina/Barra y su configuración (criterios 63b y 63c), que cambian los criterios 39 y 40 de 002 | 3a | sí | Permisos: cambia una regla de sesión de 002 que es ruta crítica; sus pruebas protegidas se ajustan sin debilitarse (decisión 11). |
| P1 · Reglas puras de montos: `totalVigenteLinea`, `totalOrden`, `excedeMontoMaximo` (criterio 76) y su uso en el tope de la línea y de la orden al comandar y en la pre-cuenta (criterios 21 y 51) | 3a | sí | Cálculo de montos: es lo que verá el cliente en la pre-cuenta y la base de la sección 4. |
| P2 · Enviar comanda: `partesDeComanda` y `partesDeStock` (criterios 74 y 75), validación con `prepararLinea` y todo o nada (17 a 20), línea preparada guardada (16), ruteo por estación (22), adición y ESPERAR (23, 24), idempotencia con `Idempotency-Key` y el id del cliente (25 a 27), envíos concurrentes y orden que ya no está abierta (28, 29), puerto de inventario en la transacción (72), marchar una sola vez (32, 33) | 3a | sí | Es "Enviar comanda" completo: ruteo, combos y modificadores ligados, idempotencia y el enganche del descuento de stock. |
| P3 · Permisos, clave y auditoría: anular ítem (34 a 41) y anular orden (42, 43) con clave, motivo y destino del stock; réplica que no vuelve a anular; clasificación de rutas y rechazos por rol (78, 79); auditoría (80); atribución y trazabilidad de autor (10, 30, 81) | 3a | sí | Permisos: clave de supervisor, trazabilidad de autor y auditoría. |
| P4 · Aislamiento: RLS y referencias de las tablas nuevas (82 a 86), Socket.IO (autenticación, salas, varias instancias, cierre de sesión; 64 a 69) y el canal lateral de PostgreSQL (`pg_notify`, bloqueos, rol propio del adaptador; 70) | 3a | sí | Aislamiento entre empresas; el tiempo real es un canal nuevo entre procesos. |
| P5 · Impresión de la comanda: un trabajo por comanda con destino impresora, ni uno más con réplicas o reversiones, y a la impresora configurada (criterios 101, 112, 113) | 3b | sí | Es el ruteo por estación y la idempotencia de "Enviar comanda" llevados al papel. |
| P6 · Puente: credencial, vinculación de un solo uso, revocación y aislamiento (un puente nunca recibe trabajos ni configuración de otra sucursal ni de otra empresa) (criterios 106 a 111, 129 a 133) | 3b | sí | Aislamiento y permisos de un actor nuevo que no es una persona. |
| Mapa de mesas (1 a 6), estados y apertura (7 a 9, 11 a 14), mover y unir (45 a 49), pre-cuenta como estado (50, 52 a 55), KDS (56 a 63), interfaz (87 a 98) | 3a | no | No están en la lista. Lo crítico de ellos (montos, permisos) lo cubren P1 a P4. Mover y unir, incluido el criterio 48 (unir no pierde ni duplica ítems), llevan pruebas de integración del desarrollador sobre concurrencia, no protegidas (decisión del orquestador, 2026-10-29). |
| Impresoras, destinos, cola y reenvío, estado y avisos, tickets, reimpresión, simulador e interfaz (99, 100, 102 a 105, 114 a 128, 134 a 140) | 3b | no | No están en la lista ("reintentos" de la lista es del PSE). |

## Glosario

- **Zona:** sector del salón de una sucursal (Salón principal, Terraza), con una cuadrícula de columnas y filas donde se ubican sus mesas.
- **Mesa:** lugar de una zona con nombre ("12", "B3"), capacidad, forma y celda en la cuadrícula. Su **estado** (libre, ocupada, en pre-cuenta) no se guarda: se calcula de su orden abierta (modelo de datos).
- **Orden:** la cuenta. En esta sección, siempre de tipo `MESA` y canal `SALON`. Estados: `ABIERTA`, `EN_PRECUENTA`, `ANULADA`, `UNIDA` (absorbida por otra al unir mesas) y `CERRADA` (la usa la sección 4). Una orden **abierta** es una `ABIERTA` o `EN_PRECUENTA`.
- **Mozo responsable:** la persona a la que se atribuyen las ventas de la orden (`orden.mozo_id`). Por defecto, quien abre la mesa; al abrirla se puede elegir a otra persona que atienda mesas, y después no cambia (decisión 8).
- **Borrador:** los ítems que el mozo está armando en el comandero y todavía no envió ("por enviar"). Viven solo en la PWA de ese equipo; se editan y se borran sin clave.
- **Envío:** cada vez que alguien pulsa "Enviar" en una orden. Lleva un id que genera la PWA (`envio.id`). El primer envío de la orden es la **comanda**; los siguientes son **adiciones**.
- **Ítem:** una línea enviada: un producto con su selección, cantidad, observación, tiempo (1 o 2) y marca de para llevar, con su **línea preparada** (003, criterio 52) guardada tal como era. Estados: `ENVIADO` y `ANULADO`; su **cantidad vigente** es la enviada menos la anulada.
- **Parte de comanda:** lo que va a una estación por un ítem: el producto, un componente de combo o un producto ligado a un modificador, con su cantidad (`partesDeComanda`, criterio 74).
- **Comanda (de estación):** el ticket de una estación en un envío, una marcha o una anulación. Tipos: `COMANDA`, `ADICION`, `MARCHAR` y `ANULACION`. Sus **líneas** son las partes de comanda de esa estación; cada línea tiene su estado de cocina: `ENVIADO`, `EN_PREPARACION`, `LISTO` o `ANULADO` ("Preparación y Listo: solo con KDS").
- **ESPERAR y MARCHAR:** un ítem de segundo tiempo sale marcado "ESPERAR"; cuando el mozo pulsa "Marchar", la estación recibe una comanda `MARCHAR` con la mesa y esos ítems.
- **Destino de una estación:** en cada sucursal, `KDS` (la pantalla de cocina) o `IMPRESORA` (una impresora de esa sucursal). Sin configurar, `KDS` (3b).
- **KDS:** pantalla de cocina y barra en la PWA (`/cocina`), para `USAR_KDS`.
- **Parte de stock:** un producto con control de stock y la cantidad que una línea consume de él: el producto mismo, sus componentes y sus productos ligados (`partesDeStock`, criterio 75).
- **Puerto de inventario:** interfaz que el envío y las anulaciones llaman dentro de su transacción. En esta sección no hace nada; la sección 6 la implementa.
- **Pre-cuenta:** el detalle de la cuenta que revisa el cliente antes de pagar; no es un comprobante. Pone la orden `EN_PRECUENTA` (mesa en amarillo). Se **invalida** cuando la orden cambia.
- **Puente:** la app Android del local, vinculada a una sucursal, que recibe los trabajos de impresión y los manda a las impresoras (3b).
- **Vinculación:** credencial de un solo uso, de 10 minutos, que el Administrador muestra como QR para que el puente obtenga su propia credencial.
- **Trabajo de impresión:** un ticket en cola para una impresora: estado `PENDIENTE`, `IMPRESO` o `VENCIDO`.
- **Impresora de caja:** la impresora de una sucursal donde salen las pre-cuentas (y, en la sección 4, los comprobantes).
- **Sala:** grupo de conexiones de Socket.IO que reciben un evento: de la empresa, de una sucursal o de un puente.

## Criterios de aceptación

Salvo que se diga otra cosa: hay dos empresas, **A** y **B**, dadas de alta por la vía de plataforma, cada una con dos sucursales (S1 y S2 en A) y usuarios de cada rol (historia 002); "el Mozo" es una sesión de un usuario de A con rol `MOZO` en S1 y S1 activa (igual para los demás roles); las horas se controlan con el reloj de la API y son de Lima; toda respuesta de error tiene la forma `{ codigo, mensaje, campos? }` (más `ordenId` donde se indica) y nunca incluye detalles de PostgreSQL; los montos viajan como texto con 2 decimales y se guardan en `NUMERIC(10,2)`; los ids son UUID y la API los devuelve en minúsculas (`PipeUuid` de 003). Toda entrada es estricta (un campo desconocido es 400 `DATOS_INVALIDOS`) y ninguna acepta `empresaId`, `sucursalId` de la sesión, `creadoPor*` ni `actualizadoPor*`. Las rutas de operación del salón llevan `@RequiereModulo('SALON')` y las del KDS `@RequiereModulo('COCINA')` (implican sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`); las de configuración, no (como la carta).

**Carta de ejemplo** de los criterios: estaciones Cocina y Barra.
- "Lomo saltado", `SIMPLE`, `"28.00"`, Cocina, `SIN_CONTROL`; grupo Término (única, obligatoria: Jugoso, 3/4, Bien cocido, sin productos ligados); grupo Extras (múltiple, 0 a 2: Huevo `"2.50"` ligado a "Huevo frito" (Cocina, `UNIDADES`), Plátano `"3.00"` ligado a "Plátano frito" (Cocina, `SIN_CONTROL`), Queso `"2.00"` sin ligado).
- "Combo hamburguesa", `COMBO`, `"22.90"`, `SIN_CONTROL`; componente "Hamburguesa clásica" × 1 (Cocina, `PORCIONES`); grupo Bebida (única, obligatoria: Chicha `"0.00"` → "Chicha morada" (Barra, `PORCIONES`), Inca Kola `"0.00"` → "Inca Kola 500 ml" (sin estación, `UNIDADES`), Cerveza `"4.50"` → "Cerveza Pilsen" (Barra, `UNIDADES`)); grupo Acompañamiento (única, obligatoria: Papas `"0.00"` → "Papas fritas" (Cocina, `SIN_CONTROL`), Ensalada `"1.00"` sin ligado).
- "Menú del día", `MENU_DEL_DIA`, `"12.00"`, `PORCIONES`; componente "Refresco del día" × 1 (Barra, `PORCIONES`); Entrada (única, obligatoria: Sopa → "Sopa de casa" (Cocina, `PORCIONES`)); Segundo (única, obligatoria: Ají de gallina → "Ají de gallina" (Cocina, `PORCIONES`), Lomo saltado `"5.00"` → "Lomo saltado"), con Sopa, Ají de gallina y Lomo saltado elegidos hoy en S1.
- "Gaseosa 1 L", `SIMPLE`, `"9.00"`, sin estación, `UNIDADES`.

---

## Entrega 3a · Salón y Cocina

### Mapa de mesas (RF-22, no crítico)

1. **Zonas.** `POST /sucursales/:sucursalId/zonas` con `{ nombre, columnas, filas }` (`nombre` de 1 a 40, único entre las zonas de la sucursal sin distinguir mayúsculas, 409 `CONFLICTO`; `columnas` de 2 a 12; `filas` de 1 a 30) responde 201 `zonaRespuesta` `{ id, sucursalId, nombre, orden, columnas, filas, activa, mesas }`; queda la última del orden. `GET /sucursales/:sucursalId/zonas` devuelve las zonas en su orden con todas sus mesas (activas e inactivas). `PUT /sucursales/:sucursalId/zonas/orden` con `{ ids }` las ordena como el criterio 5 de 003.
2. **Editar zonas.** `PATCH /sucursales/:sucursalId/zonas/:id` con `{ nombre?, columnas?, filas?, activa? }` (al menos uno) responde 200. Achicar la cuadrícula dejando afuera una mesa activa responde 409 `CONFLICTO` con `campos` y las mesas en el mensaje; desactivar una zona con mesas activas, 409 `EN_USO`. Las zonas no se borran.
3. **Mesas.** `POST /sucursales/:sucursalId/zonas/:zonaId/mesas` con `{ nombre, capacidad, forma, columna, fila }` responde 201 `mesaRespuesta` `{ id, zonaId, nombre, capacidad, forma, columna, fila, activa }`. `nombre`: de 1 a 20, único entre las mesas activas de la sucursal sin distinguir mayúsculas (409 `CONFLICTO`). `capacidad`: de 1 a 50. `forma`: `CUADRADA`, `REDONDA` o `RECTANGULAR`. `columna` y `fila`: dentro de la cuadrícula de la zona (400 si no), en una celda sin otra mesa activa de la zona (409 `CONFLICTO` con `campos` en `columna` y `fila`).
4. **Editar mesas.** `PATCH /sucursales/:sucursalId/mesas/:id` con `{ nombre?, capacidad?, forma?, zonaId?, columna?, fila?, activa? }` (al menos uno) aplica las reglas del criterio 3 sobre el resultado. Se puede cambiar de celda o de zona una mesa con orden abierta (es solo el dibujo); desactivarla con orden abierta responde 409 `EN_USO`. Las mesas no se borran (las órdenes las referencian).
5. **Quién y dónde.** Las rutas de los criterios 1 a 4 llevan `@Permiso('ADMINISTRAR')`: Mozo, Cajero, Cocina/Barra y Supervisor reciben 403 `PROHIBIDO` sin cambios ni auditoría. El Administrador configura cualquier sucursal de su empresa, con o sin sucursal activa. Una sucursal de B o inexistente en la ruta responde 404 `NO_ENCONTRADO`; una zona o mesa de otra sucursal de A en la ruta de S1, también 404, y nada cambia.
6. **Auditoría.** `crear_zona`, `modificar_zona`, `ordenar_zonas`, `crear_mesa` y `modificar_mesa` dejan una fila cada una con la sucursal y el antes y el después de los campos cambiados; un `PATCH` que no cambia nada responde 200 sin fila.

### Salón: estados y apertura (HU-10, RF-23, RF-24)

7. **El mapa con estados.** `GET /salon` (con `@Permiso('ATENDER_MESA')`) responde 200 `salonRespuesta` `{ sucursalId, ahora, zonas: [{ id, nombre, columnas, filas, mesas: [{ id, nombre, capacidad, forma, columna, fila, estado, orden }] }] }` de la sucursal activa, con las zonas activas en su orden y sus mesas activas. `estado` es `LIBRE`, `OCUPADA` o `EN_PRECUENTA` y `orden` es `null` o `{ id, mozo: { id, nombre }, comensales, abiertaEn, total, mesas: [{ id, nombre }] }`. Una mesa inactiva con orden abierta (no debería existir, criterio 4) igual aparece. La respuesta trae `ETag` y responde 304 con `If-None-Match` igual, como la vista de la carta; se arma con un número fijo de consultas, el mismo con 5 que con 80 mesas (la prueba las cuenta).
8. **Estado calculado.** `estadoDeMesa(estadoOrden | null)` de `packages/dominio`: `LIBRE` sin orden abierta; `OCUPADA` con una orden `ABIERTA`; `EN_PRECUENTA` con una `EN_PRECUENTA`. No hay columna de estado en `mesa`: sale de la relación vigente en `orden_mesa` y del estado de la orden.
9. **Abrir una mesa.** `POST /ordenes` con `Idempotency-Key` (obligatoria: sin ella, 400 `DATOS_INVALIDOS` con `campos` en `Idempotency-Key`) y `{ id, mesaId, comensales, mozoId? }` (`id`: UUID que genera la PWA; `comensales`: de 1 a 99) responde 201 `ordenRespuesta` (criterio 55) con una orden `MESA`, `SALON`, `ABIERTA`, `abiertaEn` = ahora y la mesa `OCUPADA`. La mesa debe ser activa y de la sucursal activa: de otra sucursal, de B o inexistente responde 404; inactiva, 409 `CONFLICTO`.
10. **Mozo responsable** (decisión 8; ruta crítica P3). Sin `mozoId`, el mozo responsable es quien abre (`usuarioId` de la sesión). Con `mozoId`, debe ser un usuario activo de la empresa que sea Administrador o tenga `ATENDER_MESA` como `permitido` con su rol en la sucursal de la orden; si no (Cocina/Barra, sin acceso a S1, inactivo, de B o inexistente), 422 `REFERENCIA_INVALIDA` con `campos` en `mozoId`, el mismo cuerpo para uno de B y uno inexistente. Una sesión de soporte (sin usuario) tiene que enviar `mozoId` (si no, 422). El mozo responsable no cambia después: quien agrega ítems queda solo como autor de esos ítems (criterio 30).
11. **Mesa ocupada.** Abrir una mesa con una orden abierta responde 409 `MESA_OCUPADA` con `ordenId` de esa orden en el cuerpo. Dos aperturas simultáneas de la misma mesa (ids distintos): exactamente una responde 201 y la otra 409 `MESA_OCUPADA`; nunca quedan dos órdenes abiertas en una mesa (índice único en la base).
12. **Reintento de la apertura.** Repetir `POST /ordenes` con el mismo `id` (con la misma clave, con otra clave o desde otra sesión de la empresa) y la misma mesa devuelve 201 con la orden existente (su estado actual), sin crear otra ni repetir efectos. El mismo `id` con otra mesa responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
13. **Comensales.** `PATCH /ordenes/:id` con `{ comensales }` (`ATENDER_MESA`) responde 200 en una orden abierta; en otra, 409 `ORDEN_NO_ABIERTA`.
14. **Al instante en todos los equipos** (HU-10). Después de confirmar, abrir una mesa publica `salon.cambio` `{ mesaIds, ordenId }` en la sala de la sucursal; igual toda operación que cambie el estado o el grupo de una mesa (criterios 23, 40, 42, 44 a 47, 50 y 53). Un equipo conectado de S1 lo recibe en menos de 1 segundo en la prueba; uno de S2 o de B, nunca.

### Tomar pedido y enviar la comanda (HU-11, HU-12, HU-14, RF-25 a RF-27; ruta crítica P2)

15. **Enviar.** `POST /ordenes/:id/envios` con `Idempotency-Key` obligatoria y `envioEntrada` `{ id, lineas: [{ productoId, modificadorIds, cantidad, observacion?, tiempo?, paraLlevar? }] }` responde 201 `envioRespuesta` `{ id, ordenId, numero, esAdicion, items: [itemRespuesta], comandas: [{ id, estacionId, estacionNombre, tipo, destino }] }`. `lineas`: de 1 a 50; `modificadorIds`: hasta 30, sin repetir; `cantidad`: entero de 1 a 999; `observacion`: texto de 1 a 140 o ausente; `tiempo`: 1 (por defecto) o 2; `paraLlevar`: `false` por defecto. Los ítems se guardan en el orden de `lineas`.
16. **La línea se guarda como era.** Cada línea se valida y se arma con `CartaVentaService.prepararLinea({ sucursalId: la de la orden, productoId, modificadorIds, cantidad, instante: ahora })`, y el ítem guarda la `lineaPreparada` completa (nombre, tipo, precios, modificadores con su grupo y precio extra, productos ligados, componentes, estaciones, tipos de control de stock, afectación e ICBPER) además de sus columnas propias. Prueba: después del envío se cambia el precio del producto y de un modificador, se renombra el producto, se cambia de estación un componente y se pasa el combo a simple (003, criterio 10b); `GET /ordenes/:id`, el KDS y la pre-cuenta siguen mostrando exactamente lo enviado.
17. **Lo que no se vende se rechaza.** Una línea con un producto que no se vende solo, inactivo, no disponible en la sucursal, agotado, con un componente no disponible, con un menú sin armar o con opciones insuficientes responde 422 `PRODUCTO_NO_VENDIBLE`; una selección inválida (modificador desconocido, repetido, no disponible, de otro producto o de B; menos del mínimo; más del máximo), 422 `SELECCION_INVALIDA`. `campos` lleva una entrada por cada línea rechazada (`lineas.<i>`, con el motivo o el error de selección como mensaje) y el código de la respuesta es el de la primera.
18. **Todo o nada.** Si alguna línea se rechaza, nada se guarda: ni envío, ni ítems, ni comandas, ni llamada confirmada al puerto de inventario, ni eventos. La PWA marca las líneas rechazadas y el mozo reenvía el resto.
19. **Se agota entre que se elige y se envía** (nota de 003). Dado el comandero con "Combo hamburguesa" vendible, cuando antes del envío Cocina marca agotada la "Hamburguesa clásica" (o la "Cerveza Pilsen" elegida como opción, o se quita "Ají de gallina" de las opciones de hoy), entonces el envío con esa línea responde 422 (`PRODUCTO_NO_VENDIBLE` con `COMPONENTE_NO_DISPONIBLE`, o `SELECCION_INVALIDA` con `MODIFICADOR_NO_DISPONIBLE` o `MODIFICADOR_DESCONOCIDO`); al reactivarla, el mismo envío (nuevo `id`) responde 201.
20. **Producto o modificador de otra empresa.** Un `productoId` o un modificador de B en una línea se rechaza igual que uno inexistente (422 con el mismo cuerpo) y nada de B se lee ni cambia.
21. **Tope de monto** (nota de 003; ruta crítica P1). Si el `total` de una línea preparada, o el total de la orden después del envío (`totalOrden`, criterio 76), pasa de `99999999.99`, el envío responde 422 `MONTO_FUERA_DE_RANGO` con `campos` en la línea (o en `lineas` si es el total de la orden) y nada se guarda. Ejemplo: un producto de `"99999999.00"` × 2 se rechaza; × 1 se acepta.
22. **Ruteo por estación** (HU-12). El envío crea una comanda por cada estación con al menos una parte de comanda, con las partes de todas sus líneas en el orden de los ítems (`partesDeComanda`, criterio 74). Una parte sin estación no va a ninguna; un ítem sin partes se guarda y se cobra, pero no genera comanda. Ejemplo con un envío de `[Combo hamburguesa (Cerveza, Ensalada) × 3, Lomo saltado (3/4, Huevo) × 1, Gaseosa 1 L × 2]`: comanda de Cocina con "Hamburguesa clásica × 3 (Combo hamburguesa) · Ensalada" y "Lomo saltado × 1 · 3/4, Huevo"; comanda de Barra con "Cerveza Pilsen × 3 (Combo hamburguesa)"; la Gaseosa no va a ninguna. En 3a toda comanda tiene `destino: 'KDS'`.
23. **Comanda y adición** (HU-14). El primer envío de la orden tiene `numero` 1, `esAdicion: false` y sus comandas son de tipo `COMANDA`; cada envío siguiente tiene el número siguiente, `esAdicion: true`, comandas `ADICION` e ítems con `esAdicion: true`. Si la orden estaba `EN_PRECUENTA`, vuelve a `ABIERTA`, la pre-cuenta vigente queda invalidada y la mesa vuelve a `OCUPADA` (RF-32, HU-14).
24. **ESPERAR** (HU-12). Las partes de los ítems con `tiempo: 2` se guardan con `esperar: true` en las líneas de su comanda hasta que se marchan (criterio 32), y así las muestran el KDS y el ticket.
25. **Réplica con la misma clave** (RNF-10). Repetir la petición con la misma `Idempotency-Key` y el mismo cuerpo devuelve el mismo estado y cuerpo sin crear nada (criterio 85 de 002); la misma clave con otro cuerpo, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
26. **Réplica con el mismo envío y otra clave.** Repetir con el mismo `id` de envío y las mismas líneas, con otra `Idempotency-Key` o desde otra sesión de la empresa (por ejemplo, después de un cambio rápido de usuario en el mismo equipo), responde 201 con el envío ya guardado y no crea ítems, comandas, eventos ni llamadas al puerto de inventario. Se reconoce antes de validar el estado de la orden y las líneas: si entre medio la orden se anuló o el producto se agotó, igual devuelve el envío original. El mismo `id` con otras líneas o en otra orden responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. La comparación de líneas es sobre la entrada normalizada (ids en minúsculas, modificadores ordenados, valores por defecto aplicados).
27. **Réplicas simultáneas.** Diez peticiones concurrentes con el mismo `id` de envío (con claves distintas) dejan exactamente un envío, sus ítems y sus comandas, y todas responden 201 con el mismo cuerpo, o alguna 409 `CONFLICTO` de la traducción de bloqueos de 003 que, repetida, responde 201 con el mismo envío.
28. **Dos mozos a la vez.** Dos envíos con ids distintos a la misma orden, al mismo tiempo, terminan los dos en 201 con números 1 y 2: exactamente uno es la comanda y el otro la adición.
29. **Orden que ya no está abierta.** Un envío nuevo a una orden `ANULADA` o `CERRADA` responde 409 `ORDEN_NO_ABIERTA`; a una orden `UNIDA`, 409 `ORDEN_NO_ABIERTA` con `ordenId` de la orden a la que se unió (criterio 47), para que la PWA lleve al mozo ahí. Una orden de otra sucursal de A o de B responde 404.
30. **Quién comandó** (trazabilidad, decisión del usuario de 002). Cualquier persona con `ATENDER_MESA` en la sucursal activa puede enviar a cualquier orden abierta de esa sucursal. Cada ítem queda con `creado_por_usuario_id` (y equipo) de quien lo envió, y `itemRespuesta.comandadoPor` `{ id, nombre }` lo muestra; el mozo responsable de la orden no cambia. Prueba: el Mozo M1 abre, el Mozo M2 envía una adición, el Cajero C envía otra: la orden sigue con `mozo` = M1 y los ítems dicen M2 y C.
31. **Eventos.** Después de confirmar, un envío publica en la sala de la sucursal `cocina.comanda` `{ comandaId, estacionId, tipo }` por cada comanda, `orden.cambio` `{ ordenId }` y, si la mesa cambió de estado, `salon.cambio`. Una réplica, una reversión o un rechazo no publican nada. RNF-02: un cliente de la sala de la sucursal recibe `cocina.comanda` en menos de 1 segundo desde la respuesta en la prueba (el presupuesto del requerimiento es 5 segundos hasta la pantalla).

### Marchar el segundo tiempo (HU-13, RF-28; ruta crítica P2)

32. **Marchar.** `POST /ordenes/:id/marchas` con `Idempotency-Key` obligatoria y `{ id, itemIds? }` marcha los ítems de `tiempo: 2` enviados, sin marchar y con cantidad vigente, de la orden (todos, o solo los de `itemIds`, que deben cumplir eso; si alguno no, 422 `DATOS_INVALIDOS` con `campos`). Responde 201 `{ id, comandas }` con una comanda `MARCHAR` por estación de esos ítems, cuyas líneas son las partes de esos ítems en esa estación ("MARCHAR · Mesa 4 · Lomo saltado × 1"). Los ítems quedan con `marchadoEn` y sus líneas originales con `esperar: false`. Sin ítems por marchar, 409 `NADA_QUE_MARCHAR`. El mismo `id` repetido devuelve la misma marcha sin otra comanda (como el criterio 26). Publica `cocina.comanda` y `orden.cambio`.
33. **Segundo tiempo de una adición.** Un ítem de `tiempo: 2` enviado después de una marcha sale con "ESPERAR" y necesita otra marcha. Un ítem de `tiempo: 1` nunca se marcha.

### Anular un ítem enviado (HU-15, RF-29; ruta crítica P3)

34. **Antes de enviar, sin clave.** Los ítems del borrador (sin enviar) se editan y se quitan en la PWA sin clave ni llamada a la API (criterio 91): la API solo conoce ítems enviados.
35. **Anular.** `POST /ordenes/:id/items/:itemId/anulaciones` con `Idempotency-Key` obligatoria, `@Permiso('ANULAR_ITEM_ENVIADO')` y `{ id, cantidad, motivo, destinoStock }` (`cantidad`: de 1 a la cantidad vigente del ítem, decisión 6; la PWA propone toda la vigente, criterio 93; `motivo`: `motivoSchema`, de 1 a 300; `destinoStock`: `VUELVE` o `MERMA`) responde 201 `anulacionRespuesta` `{ id, itemId, cantidad, motivo, destinoStock, autorizadoPor: { id, nombre } | null, item: itemRespuesta, comandas }`. La cantidad anulada del ítem sube en `cantidad`; si la vigente llega a 0, el ítem pasa a `ANULADO`. Solo en una orden abierta (si no, 409 `ORDEN_NO_ABIERTA`); un ítem ya `ANULADO`, 409 `ITEM_NO_ANULABLE`; una `cantidad` mayor que la vigente, 422 `DATOS_INVALIDOS` con `campos` en `cantidad`; un ítem de otra orden, de otra sucursal o de B, 404.
36. **Clave.** El Mozo y el Cajero sin `X-Autorizacion` reciben 403 `CLAVE_REQUERIDA` y nada cambia; con una autorización válida de `ANULAR_ITEM_ENVIADO` de un Supervisor o Administrador de S1 (002, criterio 44), 201, y la autorización queda usada en la misma transacción. El Supervisor y el Administrador anulan sin clave. Cocina/Barra, 403 `PROHIBIDO`. Si la anulación falla después de consumir la autorización (por ejemplo, 409 o 422), el consumo se revierte y la autorización sigue disponible hasta que venza (002, criterio 50).
37. **Réplica.** La misma `Idempotency-Key` con el mismo cuerpo y la misma `X-Autorizacion` devuelve la respuesta guardada sin volver a anular ni a consumir la autorización (la réplica se reconoce antes de evaluar el permiso). El mismo `id` de anulación con otra clave devuelve la anulación existente sin anular de nuevo; si trae una autorización nueva, esa se consume (es una autorización nueva que alguien dio) y lo dice su fila de auditoría `ANULAR_ITEM_ENVIADO` de 002. El mismo `id` con otra cantidad, otro ítem u otro destino, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
38. **Ticket de anulación** (HU-15). La anulación crea una comanda `ANULACION` por cada estación de las partes del ítem, con la cantidad anulada de cada parte (para un componente, su cantidad × la anulada), el nombre, la mesa y el motivo. En el KDS, la línea original muestra la cantidad vigente y pasa a `ANULADO` cuando llega a 0 (criterio 62). Publica `cocina.comanda`, `orden.cambio` y, si la mesa cambió, `salon.cambio`.
39. **Destino del stock.** La anulación llama una vez a `INVENTARIO.alAnular` dentro de la transacción con las partes de stock del ítem por la cantidad anulada (`partesDeStock`, criterio 75) y el `destinoStock`; si el puerto lanza, nada se guarda. `anulacion_item.destino_stock` guarda la decisión para la sección 6.
40. **Totales y pre-cuenta.** El total vigente del ítem pasa a `precioUnitario × cantidad vigente` (`totalVigenteLinea`) y el de la orden se recalcula con `totalOrden`. Si la orden estaba `EN_PRECUENTA`, vuelve a `ABIERTA`, la pre-cuenta queda invalidada y la mesa vuelve a `OCUPADA` (decisión 10). Vale también para una anulación parcial.
41. **Auditoría.** Cada anulación deja exactamente una fila `anular_item` con `entidad: 'item'`, la sucursal, el `motivo` del cuerpo, `autorizado_por_id` y `autorizacion_id` cuando hubo clave, y en `detalle` `{ ordenId, productoId, nombre, cantidadAnulada, vigenteAntes, vigenteDespues, precioUnitario, totalAnulado, destinoStock }`; el actor es quien pidió (002, criterio 119). Con clave queda además la fila `ANULAR_ITEM_ENVIADO` del consumo de la autorización (002, criterio 48). La réplica no deja filas nuevas.

### Anular la orden y liberar la mesa (RF-35; ruta crítica P3)

42. **Anular la orden.** `POST /ordenes/:id/anulacion` con `Idempotency-Key` obligatoria, `@Permiso('ANULAR_ORDEN')` y `{ motivo, destinoStock }` en una orden abierta responde 200 `ordenRespuesta` con la orden `ANULADA`, `anuladaEn`, sus mesas libres (la relación de `orden_mesa` se cierra) y cada ítem con cantidad vigente anulado por esa cantidad, con el mismo motivo y destino (decisión del usuario de 002: "anular una orden abierta igual que anular un ítem enviado"). Crea las comandas `ANULACION` de esos ítems por estación, llama una vez a `INVENTARIO.alAnular` con todas sus partes, y publica `salon.cambio`, `orden.cambio` y `cocina.comanda`. La clave funciona como el criterio 36 (Mozo y Cajero con clave; Supervisor y Administrador sin ella; Cocina/Barra 403). Una orden que ya no está abierta responde 409 `ORDEN_NO_ABIERTA` (salvo la réplica con la misma clave).
43. **Auditoría de la orden.** Deja exactamente una fila `anular_orden` con `entidad: 'orden'`, el motivo, el autorizador si hubo clave, y en `detalle` `{ mesas, mozoId, items: [{ itemId, nombre, cantidadAnulada, totalAnulado }], totalAnulado, destinoStock }`. No deja filas `anular_item` por ítem.
44. **Liberar una mesa sin consumo** (decisión 7). `POST /ordenes/:id/liberacion` con `Idempotency-Key` obligatoria (`ATENDER_MESA`) en una orden abierta que nunca tuvo un envío responde 200 con la orden `ANULADA`, `sinConsumo: true` y la mesa libre, sin clave; deja la fila de auditoría `liberar_mesa` y publica `salon.cambio`. Si la orden tuvo algún envío (aunque todo esté anulado), 409 `ORDEN_CON_CONSUMO` y la PWA ofrece "Anular la orden".

### Mover y unir mesas (HU-16, RF-30, RF-31; no crítico)

45. **Mover.** `POST /ordenes/:id/movimiento` con `{ mesaOrigenId?, mesaDestinoId }` (`MOVER_UNIR_MESAS`) cambia la mesa de la orden: cierra la relación con la de origen (la única, o `mesaOrigenId` si la orden tiene varias; obligatoria en ese caso, 400) y abre una con la de destino, que debe ser activa, de la misma sucursal y estar libre (ocupada, 409 `MESA_OCUPADA` con su `ordenId`: para juntar dos cuentas se usa unir). Responde 200 `ordenRespuesta`; la mesa original queda libre (HU-16). El estado de la orden, sus ítems, su pre-cuenta y su mozo no cambian. Repetirlo cuando la orden ya está en la mesa de destino responde 200 sin otro efecto.
46. **Unir mesas libres.** `POST /ordenes/:id/union` con `{ mesaIds }` (de 1 a 19 mesas; la orden puede tener hasta 20) agrega a la orden las mesas libres de la lista. Las mesas unidas comparten la cuenta: `GET /salon` muestra en cada una la misma orden con todas sus mesas (`orden.mesas`) y la PWA las dibuja como grupo (HU-16).
47. **Unir mesas ocupadas** (decisión 9). Si una mesa de la lista tiene otra orden abierta O2, O2 se une a la orden principal (la de la ruta): sus ítems pasan a la principal (conservan su autor, su envío y sus comandas), sus mesas se suman, sus comensales se suman, y O2 queda `UNIDA` con `unidaA` = la principal. La venta se atribuye al mozo de la principal; la fila de auditoría `unir_ordenes` guarda el mozo y los ítems de O2. Si se agregaron ítems y la principal estaba `EN_PRECUENTA`, vuelve a `ABIERTA` y su pre-cuenta se invalida; la pre-cuenta de O2 también queda invalidada.
48. **Unir no pierde ni duplica ítems** (no crítico; pruebas del desarrollador). La unión bloquea las órdenes y las mesas involucradas en orden de id. Un envío a O2 que llega mientras se une termina antes (y sus ítems pasan a la principal) o después (409 `ORDEN_NO_ABIERTA` con `ordenId` de la principal, criterio 29); en ningún caso un ítem queda en una orden `UNIDA` sin pasar a la principal ni aparece dos veces. Dos uniones cruzadas (O1 une la mesa de O2 mientras O2 une la de O1) terminan con una sola orden abierta o con un 409 `CONFLICTO` que se puede repetir. Repetir una unión ya hecha responde 200 sin otro efecto.
49. **Reglas comunes.** Mover y unir usan `@Permiso('MOVER_UNIR_MESAS')` (Cocina/Barra 403) y solo órdenes abiertas (409 `ORDEN_NO_ABIERTA`); una mesa de otra sucursal, de B o inexistente responde 404 con el mismo cuerpo; una mesa que ya es de la orden se ignora. Publican `salon.cambio` con todas las mesas involucradas y `orden.cambio` de cada orden. Mover no se audita (queda en el historial de `orden_mesa` con su autor); unir con otra orden sí (`unir_ordenes`).

### Pre-cuenta y consulta de la orden (HU-17, RF-32)

50. **Pre-cuenta.** `POST /ordenes/:id/precuentas` con `Idempotency-Key` obligatoria y `{ id }` (`ATENDER_MESA`) en una orden abierta con al menos un ítem con cantidad vigente responde 201 `precuentaRespuesta` `{ id, numero, emitidaEn, orden: { id, mesas, mozo, comensales }, lineas: [{ itemId, nombre, modificadores, cantidad, precioUnitario, total }], total, nota }` y deja la orden `EN_PRECUENTA` (mesa en amarillo, HU-17). `lineas` son los ítems con cantidad vigente, con su cantidad vigente y su total vigente. Sin ítems vigentes, 409 `ORDEN_SIN_CONSUMO`; orden no abierta, 409 `ORDEN_NO_ABIERTA`. Publica `salon.cambio`.
51. **Total de la pre-cuenta** (ruta crítica P1; decisión 5). `total` = `totalOrden` de los ítems vigentes (precios con IGV incluido), exacto con `decimal.js`, sin desglose de IGV ni de base imponible (ni en la respuesta ni en la pantalla ni en el ticket); con la orden de ejemplo del criterio 76, `"169.20"`, y `"140.80"` después de anular un combo. `nota` dice "Precios con IGV incluido. No es un comprobante de pago."; si algún ítem vigente tiene `aplicaIcbper`, agrega "El ICBPER se suma al cobrar.". La pre-cuenta guarda sus líneas y su total tal como se emitieron.
52. **Repetir la pre-cuenta.** Si la orden ya está `EN_PRECUENTA` y no cambió desde la pre-cuenta vigente, `POST …/precuentas` con otro `id` devuelve la vigente (mismo `numero`) sin crear otra; en 3b, cada pedido imprime de nuevo (criterio 114). El mismo `id` repetido devuelve la misma.
53. **Invalidación** (RF-32). Un envío (criterio 23), una anulación de ítem (criterio 40) o una unión con ítems nuevos (criterio 47) sobre una orden `EN_PRECUENTA` la devuelven a `ABIERTA`, marcan la pre-cuenta vigente con `invalidadaEn` y la mesa vuelve a rojo. La siguiente pre-cuenta tiene el número siguiente. Mover no la invalida.
54. **Sin pre-cuenta también se cobra.** La pre-cuenta es opcional (estados del diseño): ninguna regla de esta sección exige pasar por ella.
55. **Consultar la orden.** `GET /ordenes/:id` (`ATENDER_MESA`) responde 200 `ordenRespuesta` `{ id, sucursalId, tipo, canal, estado, mesas: [{ id, nombre }], mozo: { id, nombre }, comensales, abiertaEn, anuladaEn, sinConsumo, unidaA, items: [itemRespuesta], total, precuentaVigente: { id, numero, total, emitidaEn } | null }`, con `itemRespuesta` `{ id, envioNumero, esAdicion, productoId, nombre, tipo, cantidad, cantidadAnulada, cantidadVigente, precioUnitario, totalVigente, modificadores: [{ nombre, precioExtra }], componentes: [{ nombre, cantidad }], observacion, tiempo, paraLlevar, marchadoEn, estado, cocina: { enviado, enPreparacion, listo, anulado }, comandadoPor: { id, nombre }, enviadoEn }`; `cocina` cuenta sus líneas de comanda por estado. `total` y `totalVigente` salen de `packages/dominio`. Una orden de otra sucursal de A o de B, 404 con el mismo cuerpo.

### Cocina: pantalla KDS (HU-19, RF-36, RF-37; no crítico)

56. **Comandas de mis estaciones.** `GET /cocina/comandas?estacionIds=…` (`@Permiso('USAR_KDS')`; sin `estacionIds`, todas las estaciones activas) responde 200 `{ ahora, pendientes: [comandaKds], recientes: [comandaKds] }` de la sucursal activa, en orden de llegada (`creadaEn`, luego `id`). `pendientes`: las comandas con alguna línea `ENVIADO` o `EN_PREPARACION`, y las `MARCHAR` y `ANULACION` todavía no vistas; `recientes`: las demás de los últimos 60 minutos, hasta 30. Trae `ETag` y 304, y un número fijo de consultas.
57. **Qué muestra cada comanda** (HU-19). `comandaKds` `{ id, tipo, creadaEn, vistaEn, estacion: { id, nombre }, orden: { id, mesas, mozo, comensales }, lineas: [{ id, itemId, rol, nombre, contexto, cantidad, modificadores, observacion, tiempo, esperar, paraLlevar, estado }] }`: el tiempo transcurrido se calcula en la PWA con `ahora` y `creadaEn`; `tiempo` y `esperar` dicen el tiempo de servicio y si espera la marcha; `modificadores` y `observacion` salen de lo guardado; `cantidad` es la vigente de la parte; `contexto` es el combo o el producto del que sale la parte ("Combo hamburguesa").
58. **Estados de una línea** (RF-37). `PUT /cocina/lineas/:id/estado` con `{ estado }` (`ENVIADO`, `EN_PREPARACION` o `LISTO`) responde 200 con la línea. Se puede ir de cualquiera de esos tres a otro (corregir un "Listo" puesto por error); repetir el mismo estado responde 200 sin evento. Una línea `ANULADO` responde 409 `TRANSICION_INVALIDA`. Publica `cocina.linea` `{ comandaId, lineaId, estado }` para los demás KDS.
59. **Todo listo y visto.** `PUT /cocina/comandas/:id/listo` pone en `LISTO` todas las líneas no anuladas de una comanda `COMANDA` o `ADICION`; `PUT /cocina/comandas/:id/visto` marca como vista una comanda `MARCHAR` o `ANULACION` (sale de pendientes). Ambas responden 200 y son idempotentes; con el tipo equivocado, 409 `TRANSICION_INVALIDA`.
60. **Aviso al mozo** (HU-19, RF-37; destinatarios por decisión del especificador, aprobada). Cuando una línea pasa a `LISTO` (por el criterio 58 o 59), se publica en la sala de la sucursal `cocina.listo` `{ ordenId, itemId, lineaId, mesas, nombre, cantidad, destinatarios }`, con `destinatarios` = el mozo responsable de la orden y quien comandó el ítem (sin repetir). Volver de `LISTO` a otro estado no avisa. La PWA lo muestra solo a esas personas (criterio 96).
61. **Qué estaciones ve el KDS.** Solo las líneas de las estaciones pedidas; en 3a, todas las comandas tienen destino `KDS`. En 3b, solo las comandas con destino `KDS` (criterio 100); una estación con impresora no aparece.
62. **Anulaciones en el KDS.** Una línea cuyo ítem se anula en parte muestra la cantidad vigente; anulado del todo, `ANULADO` (no cuenta como pendiente). La comanda `ANULACION` aparece como pendiente, arriba de su estación en la PWA, hasta que alguien la marca vista.
63. **Quién.** Las rutas de los criterios 56 a 59 usan `@Permiso('USAR_KDS')` y `@RequiereModulo('COCINA')`: Cocina/Barra, Supervisor y Administrador; Mozo y Cajero, 403 `PROHIBIDO`. Una comanda o línea de otra sucursal o de B, 404.

### Inactividad de las sesiones de Cocina/Barra (RF-11, RNF-08; decisión 11; ruta crítica P0)

Cambia los criterios 39 y 40 de 002 solo para el rol Cocina/Barra; lo demás de esos criterios sigue igual.

63b. **Su propio tiempo de inactividad.** Una sesión PIN cuyo rol en su sucursal activa es Cocina/Barra (el mismo rol que la petición usa para sus permisos) vale mientras no pasen los `minutosInactividadCocina` de esa sucursal (por defecto 60) desde su última actividad, en lugar de los `minutosInactividad` de 002. Siguen iguales: el máximo de 12 horas desde que se creó, `X-Actividad: segundo-plano` que valida sin renovar, el 401 `SESION_EXPIRADA` con la sesión cerrada y, al cambiar de sucursal activa, el tiempo que corresponde al rol en la sucursal nueva desde la siguiente petición. No cambian las sesiones PIN de los demás roles (Mozo, Cajero, Supervisor y Administrador, que siguen con `minutosInactividad`), las sesiones PIN sin sucursal activa (5 minutos) ni las de contraseña o de soporte (criterios 14 y 66 de 002). `GET /sesion` devuelve en `expiraPorInactividadEn` el vencimiento con el tiempo que rige, y la revisión periódica de Socket.IO (criterio 66) aplica la misma regla. Ejemplo con los valores por defecto: la sesión PIN de un usuario Cocina/Barra en S1 sigue válida a los 59 minutos sin uso y expira a los 60; la de un Mozo en S1, a los 5; un usuario Cocina/Barra en S1 y Mozo en S2 que cambia a S2 queda con 5 minutos desde la siguiente petición.

63c. **Configurarlo.** `GET /sucursales/:id/acceso` y `PATCH /sucursales/:id/acceso` (criterio 40 de 002, solo el Administrador; los demás roles 403 y una sucursal de B 404, como en 002) ganan `minutosInactividadCocina`: entero de 1 a 720, por defecto 60 (sin fila en `sucursal_acceso`, 60). La respuesta pasa a `{ sucursalId, minutosInactividad, minutosInactividadCocina }`. El `PATCH` acepta `{ minutosInactividad?, minutosInactividadCocina? }` con al menos uno (`{}` responde 400 `DATOS_INVALIDOS`); fuera de rango, decimal, texto o `null` responde 400 con `campos`; un campo desconocido, 400; `minutosInactividad` sigue de 1 a 120. El valor nuevo rige desde la siguiente petición de las sesiones PIN de Cocina/Barra abiertas con esa sucursal activa. El cambio se audita con la acción `configurar_acceso_sucursal` de 002, con el antes y el después de los campos cambiados. En la PWA, la pantalla "Acceso" de Ajustes muestra los dos valores con su rango: "Cierre por inactividad (minutos)" y "Cierre por inactividad de Cocina y Barra (minutos)".

### Tiempo real (Socket.IO con adaptador de PostgreSQL; aislamiento, ruta crítica P4)

64. **Conexión.** La API sirve Socket.IO en la ruta `/tiempo-real`, espacio `/`. El cliente se conecta con `auth: { token, equipo? }`: la sesión se valida con las mismas reglas que una petición HTTP (token `se.…` válido y no expirado, `equipo` obligatorio y del mismo equipo en una sesión PIN, contraseña no temporal); si pasa, la conexión entra a la sala de su empresa y, si tiene sucursal activa, a la de esa sucursal. Si no, el servidor rechaza la conexión con el error `NO_AUTENTICADO`, sin unirla a ninguna sala. Un token `sa.…`, `eq.…`, `pu.…` o `vi.…`, adulterado o de una sesión cerrada, se rechaza igual. La conexión no renueva la inactividad de la sesión (como `X-Actividad: segundo-plano`).
65. **El cliente no elige salas.** El servidor no atiende ningún evento del cliente salvo los de control de Socket.IO: emitir `join`, `subscribe` o cualquier otro nombre no cambia sus salas ni provoca respuesta. Las salas son `e:<empresaId>` y `s:<empresaId>:<sucursalId>` (y `p:<empresaId>:<puenteId>` en 3b), y solo el servidor las asigna.
66. **Cierre de la sesión.** Cuando la sesión se cierra (`DELETE /sesion`, cambio rápido de usuario, revocación del equipo, desactivación) o cambia de sucursal activa, el servidor desconecta sus conexiones después de confirmar; si la sesión vence por inactividad o duración, a más tardar en 60 segundos (revisión periódica con el reloj de la API). La PWA vuelve a conectarse con la sesión nueva.
67. **Publicación.** `PublicadorSocketIo` implementa `PublicadorEventos` de 003: un evento de sala empresa llega solo a las conexiones de esa empresa; uno de sala sucursal, solo a las de esa sucursal de esa empresa; uno con `empresaId` de A y una sucursal de B (un error de programación) no llega a nadie, porque la sala lleva las dos. Prueba con dos empresas, dos sucursales, Administrador sin sucursal activa y cada rol.
68. **Varias instancias.** Con dos instancias de la API conectadas a la misma base, un evento publicado por una llega a los clientes de la otra (adaptador de PostgreSQL), con las mismas reglas de sala; ninguno llega a otra empresa.
69. **Eventos chicos y sin datos de más.** Todo evento lleva solo ids, estados y los nombres que necesita el aviso; su JSON pesa menos de 4 KB (prueba por evento). Los eventos de la carta de 003 (`carta.disponibilidad`, `carta.actualizada`) pasan a llegar por este transporte sin cambiar su forma.
70. **Canal lateral de PostgreSQL** (nota de 001). El adaptador usa su propio pool con el rol `restaurante_tiempo_real` (sin privilegios sobre las tablas de `public`, sin `BYPASSRLS`, no superusuario, no dueño, sin membresías; lo comprueba el arranque como el criterio 10 de 001) y su tabla auxiliar vive en el esquema `tiempo_real`, sin acceso para `restaurante_api`. La guarda de la API rechaza antes de la base, fuera de literales y comentarios, las menciones de `pg_notify`, `pg_listening_channels`, `pg_locks`, `pg_blocking_pids`, `pg_safe_snapshot_blocking_pids` y de los cerrojos consultivos de sesión (`pg_advisory_lock`, `pg_advisory_lock_shared`, `pg_try_advisory_lock`, `pg_try_advisory_lock_shared`, `pg_advisory_unlock`, `pg_advisory_unlock_shared`, `pg_advisory_unlock_all`); `pg_advisory_xact_lock` (lo usa la carta) sigue permitido. `LISTEN`, `UNLISTEN` y `NOTIFY` ya estaban rechazados (001, criterio 22d).
71. **Si el tiempo real falla.** Sin conexión de Socket.IO, la PWA sigue funcionando por HTTP: el mapa, la orden y el KDS se refrescan con `ETag` cada 30 segundos en segundo plano y al reconectar (criterio 97).

### Inventario: punto de enganche (decisión 2; ruta crítica P2)

72. **El puerto.** `INVENTARIO` (`apps/api/src/modulos/pedidos/inventario/`) define `alEnviar({ sucursalId, envioId, partes })`, `alAnular({ sucursalId, anulacionId, partes, destino })` y `disponibles({ sucursalId, productoIds })` (devuelve un mapa de producto a cantidad, vacío si no hay datos). `InventarioNulo` (por defecto) no hace nada y `disponibles` devuelve vacío; `crearAplicacion({ inventario })` lo reemplaza. Con un puerto de prueba: el envío lo llama exactamente una vez por envío (nunca en una réplica), dentro de la transacción, con la suma de `partesDeStock` de sus líneas; una anulación o una anulación de orden, una vez, con las partes por la cantidad anulada y el destino; si el puerto lanza un `ErrorAplicacion` (por ejemplo 422 `STOCK_INSUFICIENTE` en la sección 6), la respuesta es ese error y nada queda guardado ni publicado.
73. **Stock en el comandero.** `GET /salon/stock?productoIds=…` (`ATENDER_MESA`) responde `{ productos: [{ productoId, disponible }] }` con lo que devuelve `disponibles`; en esta sección, `{ productos: [] }`, y el comandero no muestra "quedan N" ni ninguna cantidad (decisión 2; HU-11 se completa en la sección 6).

### Reglas puras (`packages/dominio`, ruta crítica P1 y P2)

Pruebas unitarias con cada ejemplo, sobre la carta de ejemplo. Los montos de entrada siguen `^\d{1,8}(\.\d{1,2})?$` (si no, `RangeError`) y se calculan con `decimal.js`.

74. **`partesDeComanda(linea, opciones)`**, con `linea` una `lineaPreparada` y `opciones` `{ observacion, tiempo, paraLlevar }`, devuelve las partes `{ estacionId, rol, productoId, nombre, cantidad, modificadores, contexto, observacion, tiempo, paraLlevar }` en este orden y con estas reglas:
    - `SIMPLE` con estación E: una parte `PRODUCTO` en E con la cantidad de la línea y todos los modificadores elegidos (nombres en orden); además, una parte `LIGADO` por cada modificador cuyo producto ligado tiene una estación distinta de E y no nula, con la cantidad de la línea, sin modificadores y con `contexto` = el producto.
    - `SIMPLE` sin estación: solo las partes `LIGADO` de sus productos ligados con estación.
    - `COMBO` y `MENU_DEL_DIA`: una parte `COMPONENTE` por cada componente con estación (cantidad = la del componente × la de la línea), con los modificadores elegidos que no tienen producto ligado; luego una parte `LIGADO` por cada producto ligado con estación (cantidad de la línea, sin modificadores). Si no hay partes `COMPONENTE`, los modificadores sin ligado van en cada parte `LIGADO`. `contexto` = el combo.
    - Observación, tiempo y para llevar se copian en todas las partes.
    Ejemplos: Lomo saltado `[3/4, Huevo]` × 2 → `[Cocina PRODUCTO "Lomo saltado" × 2 ["3/4", "Huevo"]]` (Huevo frito es de Cocina: no hay parte aparte); el mismo con Plátano frito en Barra y `[Jugoso, Plátano]` → Cocina `PRODUCTO` × 2 `["Jugoso", "Plátano"]` y Barra `LIGADO` "Plátano frito" × 2 (contexto "Lomo saltado"); Combo hamburguesa `[Cerveza, Ensalada]` × 3 → Cocina `COMPONENTE` "Hamburguesa clásica" × 3 `["Ensalada"]` y Barra `LIGADO` "Cerveza Pilsen" × 3; Combo hamburguesa `[Inca Kola, Papas]` × 1 → Cocina `COMPONENTE` "Hamburguesa clásica" × 1 `[]` y Cocina `LIGADO` "Papas fritas" × 1 (Inca Kola no tiene estación); Menú del día `[Sopa, Ají de gallina]` × 2 → Barra `COMPONENTE` "Refresco del día" × 2, Cocina `LIGADO` "Sopa de casa" × 2 y Cocina `LIGADO` "Ají de gallina" × 2; Gaseosa 1 L × 1 → `[]`.
75. **`partesDeStock(linea, cantidad?)`** devuelve `[{ productoId, nombre, cantidad, tipoControlStock }]` con el producto mismo, cada componente (su cantidad × la de la línea) y cada producto ligado elegido, omitiendo los `SIN_CONTROL` y sumando por producto; `cantidad` reemplaza la de la línea (anulaciones parciales). `partesDeStockDeEnvio(lineas)` suma las de varias líneas por producto. Ejemplos: Lomo saltado `[3/4, Huevo]` × 2 → `[Huevo frito 2 UNIDADES]`; Combo hamburguesa `[Cerveza, Ensalada]` × 3 → `[Hamburguesa clásica 3 PORCIONES, Cerveza Pilsen 3 UNIDADES]`; Menú del día `[Sopa, Ají de gallina]` × 2 → `[Menú del día 2, Refresco del día 2, Sopa de casa 2, Ají de gallina 2]` (todos `PORCIONES`); Combo `[Inca Kola, Papas]` × 1 y Combo `[Inca Kola, Ensalada]` × 2 en un envío → `[Hamburguesa clásica 3, Inca Kola 500 ml 3]`; Combo `[Cerveza, Ensalada]` × 3 con `cantidad` 1 → `[Hamburguesa clásica 1, Cerveza Pilsen 1]`; `cantidad` 0, negativa, decimal o mayor que la de la línea → `RangeError`.
76. **Montos de la orden.** `totalVigenteLinea(precioUnitario, cantidad, cantidadAnulada)` = `precioUnitario × (cantidad − cantidadAnulada)`; `totalOrden(items)` = suma de los totales vigentes; `excedeMontoMaximo(monto)` es `true` si pasa de `MONTO_MAXIMO = "99999999.99"`. Devuelven texto con 2 decimales, sin redondeos (con 2 decimales y cantidades enteras el resultado es exacto) y sin acotar (quien guarda compara con `excedeMontoMaximo`). Ejemplos: `("28.00", 3, 1)` → `"56.00"`; `("0.10", 3, 3)` → `"0.00"`; `("19.99", 999, 0)` → `"19970.01"`; orden con Lomo saltado `[3/4, Huevo, Plátano]` × 2 (`"33.50"`), Combo hamburguesa `[Cerveza, Ensalada]` × 3 (`"28.40"`) y Menú del día `[Sopa, Lomo saltado]` × 1 (`"17.00"`) → `"169.20"`; con un combo anulado → `"140.80"`; `("99999999.99", 2, 0)` → `"199999999.98"` y `excedeMontoMaximo` `true`; `excedeMontoMaximo("99999999.99")` `false`; `cantidadAnulada` mayor que `cantidad`, negativa o decimal, `cantidad` fuera de 1 a 999 o un precio mal formado → `RangeError`; orden sin ítems → `"0.00"`.
77. **Estados (no crítico).** `estadoDeMesa` (criterio 8), `transicionKdsValida(desde, hacia)` (criterio 58) y `esOrdenAbierta(estado)`; pruebas unitarias del desarrollador.

### Permisos, auditoría y atribución (ruta crítica P3)

78. **Clasificación de las rutas.** Toda ruta de `/salon`, `/ordenes`, `/cocina` y `/sucursales/:sucursalId/zonas…` o `/sucursales/:sucursalId/mesas…` lleva exactamente la acción de la tabla de endpoints (`ADMINISTRAR`, `ATENDER_MESA`, `MOVER_UNIR_MESAS`, `ANULAR_ITEM_ENVIADO`, `ANULAR_ORDEN` o `USAR_KDS`) y el módulo que corresponde; la prueba recorre las rutas registradas en Nest (no una lista fija) y falla si una no está clasificada o tiene otra acción. La matriz de `packages/dominio` no cambia.
79. **Rechazos por rol.** Para cada rol sin permiso (Cocina/Barra en `ATENDER_MESA`, `MOVER_UNIR_MESAS`, `ANULAR_*`; Mozo y Cajero en `USAR_KDS`; todos salvo el Administrador en `ADMINISTRAR`), con sesión de contraseña y de PIN, cada ruta responde 403 `PROHIBIDO` sin cambiar filas, sin auditoría y sin eventos. El rol es el de la sucursal activa: un usuario Mozo en S1 y Cocina/Barra en S2, con S2 activa, recibe 403 al enviar; sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`. Las sesiones de soporte son Administrador y quedan trazadas con el superadministrador.
80. **Auditoría.** Cada acción de "Acciones auditadas en esta sección" deja exactamente una fila en la misma transacción, con el actor, la sucursal, el equipo, la sesión, la hora del reloj y, cuando hubo clave, el autorizador; ninguna en las operaciones que no cambian nada ni en las réplicas.
81. **Trazabilidad.** Las tablas nuevas se crean con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true` (la prueba de catálogo de 002 las cubre). Prueba del desarrollador: la orden queda con `creado_por_usuario_id` = quien abrió y `mozo_id` = el responsable; cada ítem, con quien lo comandó y su equipo; una anulación hecha por el Cajero con clave del Supervisor queda con el Cajero como autor y el Supervisor como autorizador en la auditoría.

### Aislamiento entre empresas (ruta crítica P4)

82. **Catálogo.** Las tablas nuevas cumplen el criterio 38 de 001 y el 88 de 002; las pruebas de catálogo existentes las recorren solas.
83. **Por tabla.** Para `zona`, `mesa`, `orden`, `orden_mesa`, `envio`, `marcha`, `item`, `comanda`, `comanda_linea`, `anulacion_item` y `precuenta`, con el contexto de A y un actor de A fijado: no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, ni se insertan filas con `empresa_id` de B; el rechazo es de la política RLS.
84. **Referencias cruzadas en la base.** Con el contexto de A, una fila de A que apunte a una de B (mesa con zona de B, orden con sucursal o mozo de B, orden_mesa con mesa de B, ítem con producto de B, comanda con estación de B, línea con ítem de B) falla por la llave foránea compuesta, igual que con un id inexistente.
85. **Por HTTP.** En toda ruta de esta entrega, un id de B en la ruta responde 404 y en el cuerpo 422 (`REFERENCIA_INVALIDA`, `PRODUCTO_NO_VENDIBLE` o `SELECCION_INVALIDA`, según el criterio), con el mismo cuerpo que un id inexistente y sin cambios en B; `GET /salon`, `GET /ordenes/:id` y `GET /cocina/comandas` solo traen datos de A y de la sucursal activa. Los ids de cliente (`id` de orden, envío, marcha, anulación y pre-cuenta) son únicos por empresa: el mismo id usado en B crea su propia fila y nunca devuelve la de A.
86. **Concurrencia.** Con un pool de 2 conexiones, 100 peticiones concurrentes alternando A y B a `GET /salon`, `POST /ordenes/:id/envios` y `GET /cocina/comandas` devuelven y cambian solo datos de su empresa, y cada evento llega solo a los clientes de su empresa.

### Interfaz (PWA, no crítica)

Las pantallas siguen `DESIGN.md` (Azulejo, "Operate", móvil primero, trato de tú) y `PRODUCT.md`. El rol frontend usa la skill `impeccable`. En pantalla se escribe "Esperar" y "Marchar" con mayúscula inicial (regla "Sin mayúsculas"); el ticket impreso de 3b los lleva en mayúsculas.

87. **Navegación por rol** (máximo 5 destinos). Mozo: "Salón". Cajero: "Salón" y "Carta". Cocina/Barra: "Cocina" y "Disponibilidad". Supervisor: "Salón", "Cocina" y "Disponibilidad". Administrador: "Salón", "Cocina", "Carta", "Disponibilidad" y "Ajustes" (agrupa Usuarios, Acceso, Mapa de mesas y, en 3b, Impresión). El destino inicial es "Salón" para quien tiene `ATENDER_MESA` y "Cocina" para quien solo tiene `USAR_KDS`. Sale de `permisos` y `modulos` de `GET /sesion`.
88. **Mapa del salón.** `/salon` muestra la zona elegida (segmentos de zona, recuerda la última en el equipo) como cuadrícula de baldosas de mesa de 64 px o más: nombre, capacidad y estado con color y texto ("Libre", "Ocupada · 3 · 25 min", "Pre-cuenta"); las mesas unidas muestran "Grupo con 5, 6". Un interruptor "Lista" muestra las mesas como filas de 72 px (para pantallas angostas o lectores de pantalla). Sin zonas, el Administrador ve "Diseña tu salón" y los demás "Tu salón aún no tiene mesas".
89. **Abrir mesa.** Tocar una mesa libre abre una hoja con los comensales (botones − y + de 48 px y valor grande, por defecto la capacidad) y "Mozo responsable" (por defecto tú; cambiarlo despliega las personas con `ATENDER_MESA` de la sucursal) y "Abrir mesa". Si responde `MESA_OCUPADA`, avisa "Otra persona acaba de abrir esta mesa" y lleva a su orden.
90. **La cuenta de la mesa.** `/salon/ordenes/:id` muestra mesas, mozo, comensales, tiempo abierta, los ítems agrupados por envío ("Comanda", "Adición 2") con cantidad, nombre, modificadores, observación, "Para llevar", "Esperar"/"Marchado", su estado en cocina ("2 listos de 3") y quién lo comandó, y el total. Acción principal fija: "Agregar". Secundarias: "Marchar" (si hay ítems por marchar), "Pre-cuenta", "Mover", "Unir" y, separada por una junta y en rocoto, "Anular la orden" (o "Liberar la mesa" sin consumo). Tocar un ítem enviado ofrece "Anular".
91. **Comandero y borrador.** "Agregar" abre el comandero: familias como segmentos que pasan de fila, búsqueda por nombre, productos vendibles que se venden solos como baldosas con nombre y precio (calculado con `packages/dominio`); los agotados o no vendibles se ven apagados con el motivo en palabras y no se pueden elegir. Tocar un producto abre una hoja con sus grupos (con la regla en palabras y validación con `validarSeleccion`), cantidad, observación (140), tiempo "1" o "2" y "Para llevar", y el precio de la línea con `calcularLinea`. Lo elegido va al **borrador** ("Por enviar"), visible abajo con su total, donde cada línea se edita o se quita sin clave. El borrador se guarda en el almacenamiento del equipo por persona y orden, y sobrevive a una recarga.
92. **Enviar sin duplicar.** "Enviar" asigna al borrador un `id` de envío (que se conserva hasta que el envío termina) y manda el envío por la cola de "Pendiente de envío" de 003 con `Idempotency-Key`. Mientras espera, el borrador queda bloqueado con "Pendiente de envío"; si la cola se cancela por un cambio de usuario o se recarga la página, al volver la misma persona la PWA ofrece "Reintentar el envío" con el mismo `id` (criterio 26). Con 422, marca en rojo las líneas rechazadas con el motivo y deja el resto en el borrador; con 409 `ORDEN_NO_ABIERTA` con `ordenId`, lleva a esa orden con el borrador.
93. **Anular con clave.** "Anular" en un ítem abre una hoja con la cantidad a anular (− y +, por defecto toda), el motivo (atajos de un toque y texto) y "¿El stock vuelve o es merma?" (dos opciones grandes, sin valor por defecto). Si `permisos.ANULAR_ITEM_ENVIADO` es `clave`, sigue la ventana de clave de supervisor de 002 con "Anular ítem: Ceviche mixto × 1 · S/ 38.00" y el mismo motivo; con `permitido`, una confirmación. "Anular la orden" es igual, con el total de la orden.
94. **Mover y unir.** "Mover" y "Unir" abren el mapa en modo selección: mover deja elegir una mesa libre; unir, varias mesas (libres u ocupadas, con su mozo y total a la vista) y confirma "Unir 5 y 6 a la cuenta de la mesa 4: la venta queda a nombre de Ana".
95. **Pre-cuenta en pantalla.** "Pre-cuenta" muestra el detalle con cifras tabulares, el total y la nota, y la mesa pasa a amarillo. En 3a dice "La impresión llega con el puente de impresión"; en 3b, "Imprimir" (criterio 138).
96. **KDS.** `/cocina` muestra filtros de estación (recuerda la elección en el equipo) y las comandas pendientes como columnas o lista según el ancho, en orden de llegada, cada una con mesa, mozo, tipo ("Comanda", "Adición", "Marchar", "Anulación" con su color y texto), tiempo transcurrido que cambia a ají a los 10 minutos y a rocoto a los 20 (umbrales fijos, decisión del especificador aprobada por el usuario el 2026-10-29), y líneas con cantidad, nombre, contexto, modificadores, observación, "Esperar" y "Para llevar". Botones de 56 px "Preparando" y "Listo" por línea y "Todo listo" por comanda; "Enterado" en Marchar y Anulación. Un aviso sonoro corto y visible al llegar una comanda (se puede silenciar en el equipo). "Recientes" abajo.
97. **Tiempo real en la PWA.** `lib/tiempo-real.ts` mantiene una conexión por sesión, se reconecta con espera creciente, invalida las consultas de TanStack Query según el evento y, sin conexión de Socket.IO, refresca el mapa, la orden abierta y el KDS cada 30 segundos con `X-Actividad: segundo-plano` e `If-None-Match`. La cenefa y el banner de 002 dicen "Sin conexión" cuando no hay red.
98. **Avisos de "Listo" y compatibilidad.** Al recibir `cocina.listo` donde la persona está en `destinatarios`, la PWA muestra un aviso "Lomo saltado × 1 de la mesa 4 está listo" (con vibración donde el navegador la permite) y lo deja en una lista "Avisos" del salón hasta que se toca. Solo con la app abierta (sin notificaciones del sistema, fuera de alcance). Todas las pantallas: desde 360 px sin desplazamiento horizontal, controles de 48 px o más, Chrome para Android y Safari para iPhone y iPad recientes, montos `S/ 28.00` con cifras tabulares calculados con `packages/dominio`, y respuesta en menos de 1 segundo (RNF-03).

---

## Entrega 3b · Impresión básica

Además de lo de arriba: "el puente" es un puente de S1 vinculado y conectado con el simulador (criterio 134); las impresoras son emuladores ESC/POS por TCP (criterio 135).

### Destino de cada estación e impresora de caja (RF-19, segunda parte)

99. **Consultar los destinos.** `GET /sucursales/:sucursalId/estaciones-destino` (`ADMINISTRAR`) devuelve una fila por estación activa de la empresa: `{ estacionId, nombre, destino: 'KDS' | 'IMPRESORA', impresora: { id, nombre } | null }`. Sin configurar, `KDS` (decisión del especificador, aprobada).
100. **Configurar.** `PUT /sucursales/:sucursalId/estaciones-destino/:estacionId` con `{ destino: 'KDS' }` o `{ destino: 'IMPRESORA', impresoraId }` (impresora activa de esa sucursal; si no, 422 `REFERENCIA_INVALIDA`) responde 200; repetirlo no cambia nada ni audita. Una estación inactiva, de B o inexistente, 404. Desde el siguiente envío, las comandas de esa estación en esa sucursal salen por ese destino: con `IMPRESORA` no aparecen en el KDS (criterio 61). Las comandas ya creadas conservan su destino.
101. **Una comanda, un trabajo** (ruta crítica P5). Cada comanda (`COMANDA`, `ADICION`, `MARCHAR` o `ANULACION`) de una estación con destino `IMPRESORA` crea, en la misma transacción, exactamente un trabajo de impresión `PENDIENTE` para esa impresora, con `comandaId`. Una réplica (criterios 25 a 27), un rechazo o una reversión no crean trabajos; diez réplicas concurrentes dejan uno solo. La comanda queda con `destino: 'IMPRESORA'`.
102. **Impresora de caja.** `GET` y `PUT /sucursales/:sucursalId/impresion` con `{ impresoraCajaId: id | null }` (`ADMINISTRAR`). Cada `POST …/precuentas` con impresora de caja crea un trabajo `PRECUENTA` (criterio 114); sin ella, la pre-cuenta se emite igual y la respuesta trae `impresion: 'SIN_IMPRESORA'`.

### Impresoras (RF-76)

103. **Alta.** `POST /sucursales/:sucursalId/impresoras` con `{ nombre, conexion, anchoMm, juegoCaracteres, gaveta }` responde 201 `impresoraRespuesta` (más `estado`, `estadoDesde`, `activa`). `nombre`: de 1 a 40, único en la sucursal (409). `conexion`: `{ tipo: 'RED', host, puerto }` (`host`: IPv4 o nombre de hasta 253 caracteres; `puerto`: 1 a 65535, por defecto 9100) o `{ tipo: 'BLUETOOTH', mac }` (`AA:BB:CC:DD:EE:FF`). `anchoMm`: 58 u 80. `juegoCaracteres`: `PC850`, `PC858`, `WPC1252`, `PC437` o `SIN_TILDES` (por defecto `PC850`). `gaveta`: si tiene gaveta conectada (la usa la sección 4).
104. **Editar y desactivar.** `PATCH /sucursales/:sucursalId/impresoras/:id` (al menos un campo) responde 200. Desactivar una impresora que es destino de una estación o la impresora de caja responde 409 `EN_USO` con el uso en el mensaje. No se borran. Sus trabajos pendientes siguen en cola hasta que venzan (criterio 117).
105. **Listado.** `GET /sucursales/:sucursalId/impresoras` devuelve las impresoras de la sucursal con su estado (criterio 121) y cuántos trabajos pendientes tiene cada una.

### Vincular el puente (HU-38, RF-75; ruta crítica P6)

106. **Código de vinculación.** `POST /sucursales/:sucursalId/vinculaciones-puente` (`ADMINISTRAR`, `Idempotency-Key` opcional) responde 201 `{ token, qr, expiraEn }`: `token` es `vi.<empresaId>.<vinculacionId>.<secreto>` (secreto de 32 bytes aleatorios, solo se guarda su huella), `qr` es el texto que la PWA dibuja como QR (`restaurante-puente://vincular?api=<URL de la API>&t=<token>`) y `expiraEn` = ahora + 10 minutos. Crear otro invalida los pendientes de esa sucursal.
107. **Vincular.** `POST /puente/vinculacion` con `Authorization: Bearer vi.…` y `{ nombreEquipo?, modelo?, versionApp }` responde 201 `{ token, puente: { id, nombre }, sucursal: { id, nombre }, configuracion }`: `token` es `pu.<empresaId>.<puenteId>.<secreto>` (solo se guarda su huella) y `configuracion` es la del criterio 110. La vinculación queda usada en la misma transacción. Vencida, usada, de otra vinculación, adulterada (empresa, id o secreto cambiados) o inexistente: 401 `VINCULACION_INVALIDA` con el mismo cuerpo, sin crear nada. Dos usos simultáneos de la misma: exactamente uno responde 201.
108. **Un puente por sucursal** (decisión del especificador, aprobada). Al vincular, el puente activo anterior de esa sucursal queda revocado: su token responde 401 en la siguiente petición y su conexión de Socket.IO se cierra. `GET /sucursales/:sucursalId/puentes` lista los puentes (activos y revocados, con `ultimaSenalEn`, `versionApp`, `modelo`) y `DELETE /sucursales/:sucursalId/puentes/:id` revoca uno (204; repetirlo, 204 sin efecto). Vincular y revocar se auditan.
109. **Credencial del puente.** Las rutas `/puente/*` (salvo `POST /puente/vinculacion`) exigen `Authorization: Bearer pu.…` de un puente activo; el token `pu.…` no sirve en ninguna otra ruta (401 `NO_AUTENTICADO`, como los `sa.…` y `eq.…` del criterio 1 de 002) y un token `se.…`, `sa.…`, `eq.…` o `vi.…` en `/puente/*` responde 401. La petición corre con el contexto de la empresa del token, la sucursal del puente y el actor de sistema `puente:<puenteId>` (nota de 002). No hay bloqueo por intentos: el secreto tiene 256 bits.
110. **Configuración.** `GET /puente/configuracion` responde `{ puente, sucursal, impresoras: [{ id, nombre, conexion, anchoMm, juegoCaracteres, gaveta }] }` con las impresoras activas de su sucursal. Cuando el Administrador cambia una impresora, se publica `puente.configuracion` en la sala del puente y el puente la vuelve a pedir.
111. **Socket del puente.** El puente se conecta a `/tiempo-real`, espacio `/puente`, con `auth: { token: 'pu.…' }`; entra solo a la sala `p:<empresaId>:<puenteId>`. Con otro tipo de token, revocado o adulterado, se rechaza. Al conectarse y al desconectarse se actualiza su señal (criterio 120). Una sesión de persona no puede entrar al espacio `/puente` ni un puente al espacio `/`.

### Cola de trabajos y reenvío (RF-77)

112. **Aviso al puente** (ruta crítica P5). Después de confirmar, cada trabajo nuevo publica `trabajo.nuevo` `{ trabajoId }` en la sala del puente activo de su sucursal; sin puente o sin conexión, no se publica nada y el trabajo espera.
113. **Entrega.** `GET /puente/trabajos` responde hasta 50 trabajos `PENDIENTE` de las impresoras de su sucursal, ordenados por `creadoEn` e `id`, como `[{ id, impresoraId, tipo, creadoEn, bytes }]`, con `bytes` en base64 generados en ese momento con la configuración actual de la impresora (criterio 123). Nunca trae trabajos de otra sucursal ni de otra empresa (ruta crítica P6). El puente también lo llama al conectarse y cada 30 segundos, así un aviso perdido no deja trabajos sin imprimir.
114. **Qué se encola.** Comandas de estaciones con impresora (criterio 101); cada `POST …/precuentas` con impresora de caja, también cuando devuelve la vigente (criterio 52): un trabajo `PRECUENTA` (no en la réplica de la misma clave ni del mismo `id`); la página de prueba (criterio 127) y las reimpresiones (criterio 128).
115. **Resultado.** `POST /puente/trabajos/:id/resultado` con `{ resultado: 'IMPRESO' }` deja el trabajo `IMPRESO` con `impresoEn` (repetirlo responde 200 sin cambios); con `{ resultado: 'NO_IMPRESO', error }` (texto de hasta 200) suma un intento, guarda el error y lo deja `PENDIENTE` (el puente reintenta). Un trabajo de otra sucursal o de B responde 404; uno `VENCIDO`, 409 `TRANSICION_INVALIDA`.
116. **Reconexión** (HU-39). Dado el puente desconectado, cuando se envían tres comandas a Cocina (con impresora), entonces quedan `PENDIENTE`; al reconectarse el simulador, las imprime en el orden en que se crearon y quedan `IMPRESO`.
117. **Vencimiento** (decisión del especificador, aprobada por el usuario el 2026-10-29). Un trabajo que sigue `PENDIENTE` cuando el día operativo de su sucursal ya pasó (hora de corte de 001) es `VENCIDO`: no se entrega ni se imprime, y la lista de trabajos lo muestra así. Se calcula al leer con el reloj de la API, sin tareas programadas.
118. **Impresión con retraso.** Si un trabajo se entrega más de 2 minutos después de creado, el ticket lleva arriba "Impreso con retraso · enviado a las 20:15".
119. **Cinco segundos** (RNF-02). Con el puente conectado, desde la respuesta del envío hasta que el emulador recibe el ticket completo pasan menos de 2 segundos en la prueba (presupuesto del requerimiento: 5).

### Estado del puente y de las impresoras (HU-39, RF-77)

120. **Latido.** `POST /puente/latido` con `{ versionApp, impresoras: [{ id, estado: 'LISTA' | 'NO_RESPONDE', error? }] }` (el puente lo manda cada 20 segundos y al cambiar algo) guarda la señal del puente (`ultimaSenalEn` = ahora) y el estado de cada impresora con `estadoDesde`. Si cambia algún estado, o el puente vuelve después de más de 60 segundos sin señal, publica `impresion.estado` `{ sucursalId }` en la sala de la sucursal. Una impresora de otra sucursal en la lista se ignora.
121. **Consultar el estado.** `GET /impresion/estado` (cualquier rol con sucursal activa) responde `{ ahora, puente: { id, nombre, ultimaSenalEn, conectado } | null, impresoras: [{ id, nombre, estado, estadoDesde, pendientes }] }`. `conectado` = hubo señal en los últimos 60 segundos. `estado` de una impresora es `LISTA`, `NO_RESPONDE` o `DESCONOCIDO` (nunca reportada, o el puente desconectado).
122. **Aviso en la app** (HU-39). Toda persona con sesión en la sucursal ve, mientras dure, un banner ají con palabras: "El puente de impresión está desconectado. Los tickets quedan en cola (4)." o "La impresora Cocina no responde. Los tickets quedan en cola (2)."; se actualiza con `impresion.estado` y con la consulta cada 30 segundos, y la PWA lo reevalúa cada 15 segundos con `ultimaSenalEn` y `ahora`. No aparece si la sucursal no tiene impresoras.

### Tickets (ESC/POS)

123. **Renderizado.** `renderizarTicket(documento, impresora)` arma los bytes ESC/POS: `ESC @`, la página de códigos del juego de caracteres (`ESC t`), texto codificado en ese juego (con `SIN_TILDES`, transliterado: "Ají" → "Aji", "Ñ" → "N", "¿" → ""), 32 columnas en 58 mm y 48 en 80 mm (fuente A), negrita y doble alto para títulos, cortes de línea sin partir palabras, avance y corte parcial (`GS V`). Prueba: el emulador decodifica cada ticket de ejemplo y obtiene exactamente el texto esperado, línea por línea, en los dos anchos y en cada juego de caracteres, con "Ají de gallina", "Ñoquis" y "¿Sin ají?".
124. **Ticket de comanda.** Encabezado con la estación y el tipo en mayúsculas ("COCINA · COMANDA", "ADICIÓN", "MARCHAR", "ANULACIÓN"), mesa o mesas en doble alto, mozo, hora y número de envío; por cada línea: "3 × Hamburguesa clásica", el contexto ("(Combo hamburguesa)"), los modificadores con sangría, "Obs: sin cebolla", "PARA LLEVAR" y "ESPERAR" cuando corresponde; en una anulación, la cantidad anulada y el motivo; en una marcha, solo los ítems marchados.
125. **Ticket de pre-cuenta.** Nombre de la sucursal, "PRE-CUENTA N.º 2", mesas, mozo, comensales y hora; líneas con cantidad, nombre y total alineado a la derecha; "TOTAL S/ 169.20"; la nota del criterio 51. Los montos son los guardados en la pre-cuenta.
126. **Documento lógico.** El trabajo guarda un documento lógico (`documentoTicket` de `packages/contratos`: títulos, líneas, columnas y marcas), no bytes; así una reimpresión o un cambio de ancho o de juego de caracteres se aplican al imprimir.

### Reimpresión y página de prueba (RF-78)

127. **Página de prueba.** `POST /sucursales/:sucursalId/impresoras/:id/prueba` (`ADMINISTRAR`) crea un trabajo `PRUEBA` con el nombre de la impresora, el ancho, el juego de caracteres, una regla de 32 o 48 columnas y la muestra "áéíóú ÁÉÍÓÚ ñ Ñ ü ¿¡ S/ 1,234.50"; responde 201 `{ trabajoId }`. Funciona con la impresora inactiva (para probarla antes de activarla).
128. **Reimprimir.** `GET /impresion/trabajos?desde=` (`ATENDER_MESA`) lista los trabajos del día operativo de la sucursal activa (tipo, impresora, mesa, estado, creado, impreso). `POST /impresion/trabajos/:id/reimpresion` (`ATENDER_MESA`, `Idempotency-Key` obligatoria) crea un trabajo nuevo con el mismo documento, la marca "REIMPRESIÓN" y `reimpresionDe`, para la misma impresora (o la impresora actual de su estación si la original está inactiva; si no hay, 409 `SIN_IMPRESORA`). Responde 201 `{ trabajoId }`.

### Permisos, auditoría y aislamiento de la impresión (ruta crítica P6)

129. **Clasificación de las rutas.** Las rutas de `/sucursales/:sucursalId/impresoras…`, `…/estaciones-destino…`, `…/impresion`, `…/vinculaciones-puente` y `…/puentes…` llevan `ADMINISTRAR`; `GET /impresion/estado` solo `@RequiereSucursal()`; `GET /impresion/trabajos` y la reimpresión, `ATENDER_MESA`; las de `/puente/*`, la credencial del puente (o de vinculación). La prueba recorre las rutas registradas y falla si una no está clasificada. La lista cerrada de rutas públicas de 002 (criterio 1) no cambia: sin `Authorization`, toda ruta de `/puente/*` responde 401.
130. **Auditoría.** `crear_impresora`, `modificar_impresora`, `configurar_destino_estacion`, `configurar_impresion_sucursal`, `crear_vinculacion_puente`, `vincular_puente` (actor `puente:<id>`, con la vinculación y quién la creó en el detalle) y `revocar_puente` dejan una fila cada una. Las reimpresiones y las páginas de prueba quedan en la trazabilidad del trabajo (quién lo pidió), sin fila de auditoría.
131. **RLS de las tablas nuevas.** `impresora`, `estacion_destino`, `impresion_sucursal`, `vinculacion_puente`, `puente` y `trabajo_impresion` cumplen los criterios 82 a 84 (catálogo, por tabla y referencias cruzadas: un trabajo de A con impresora de B, un destino de A con estación o impresora de B, fallan por la llave compuesta).
132. **El puente no sale de su sucursal.** Un puente de S1 de A: no recibe en `GET /puente/trabajos` trabajos de S2 ni de B; `POST /puente/trabajos/:id/resultado` con un trabajo de S2 o de B responde 404 igual que uno inexistente y nada cambia; `GET /puente/configuracion` no trae impresoras de S2 ni de B; el latido con impresoras de S2 o de B no las cambia; y su sala de Socket.IO no recibe avisos de otro puente. Un token `pu.…` de A con la empresa cambiada a B responde 401.
133. **Concurrencia.** Con un pool de 2 conexiones, dos puentes (A y B) que piden trabajos y reportan resultados cien veces cada uno en paralelo solo ven y cambian los suyos.

### Validación sin Android

134. **Simulador del puente.** `SimuladorPuente` (TypeScript, en `apps/api/test/soporte/puente/`, también ejecutable con `pnpm puente:simular --qr "<texto del QR>"` contra una API de desarrollo) implementa el protocolo de `packages/contratos/src/puente.ts` igual que lo hará la app: vincula con el token del QR, guarda su token, se conecta al espacio `/puente`, pide trabajos al conectarse, al recibir `trabajo.nuevo` y cada 30 segundos, los manda por TCP a cada impresora en orden, reporta el resultado, recuerda los últimos 500 ids impresos para no imprimir dos veces un trabajo repetido, manda el latido y reintenta con espera creciente si la impresora no responde.
135. **Emulador de impresora.** `EmuladorEscPos` es un servidor TCP que acepta los bytes, interpreta los comandos usados (inicio, página de códigos, negrita, tamaño, alineación, corte, pulso de gaveta) y expone los tickets recibidos como texto decodificado con sus marcas; se puede apagar para simular una impresora que no responde. Las pruebas de 3b y el E2E lo usan; nunca se prueba con un Android real en CI.

### Interfaz de impresión (PWA, no crítica)

136. **Ajustes › Impresión** (Administrador). Lista de impresoras con su estado ("Lista", "No responde", "Sin datos") y pendientes; formulario con nombre, conexión (Red: IP y puerto; Bluetooth: dirección, con la nota "Requiere la app puente con Bluetooth"), ancho 58 u 80 mm, juego de caracteres con una línea de ayuda ("Si salen símbolos raros en las tildes, prueba otro") y "Tiene gaveta"; "Imprimir página de prueba".
137. **Destinos y puente.** En la misma sección: "Dónde sale cada estación" (una fila por estación con "Pantalla de cocina" o una impresora), "Impresora de caja", y "Puente de impresión" con su estado y última señal, "Vincular puente" (muestra el QR grande, el texto para copiar y la cuenta regresiva de 10 minutos; al vincularse, se cierra y dice "Puente vinculado") y "Revocar" con confirmación.
138. **En el salón.** La pre-cuenta tiene "Imprimir" (o dice "Sin impresora de caja"). La cuenta de la mesa ofrece "Reimprimir" en cada envío con impresora, y el KDS muestra qué estaciones salen por impresora. El banner del criterio 122 aparece en todas las pantallas de la sucursal.
139. **Lista de trabajos.** En Ajustes › Impresión, "Trabajos de hoy" con filtro por estado y "Reimprimir".
140. **Compatibilidad.** Las mismas reglas del criterio 98; el QR se lee bien a 30 cm en un celular de 360 px.

## Acciones auditadas en esta sección

Cada fila lleva actor, empresa, sucursal, equipo si aplica, sesión y fecha (criterio 57 de 002).

| Acción (`accion`) | Entidad | Cuándo |
| --- | --- | --- |
| `crear_zona`, `modificar_zona`, `ordenar_zonas` | `zona` | Criterios 1 y 2 |
| `crear_mesa`, `modificar_mesa` | `mesa` | Criterios 3 y 4 |
| `anular_item` (con autorizador si hubo clave) | `item` | Criterios 35 a 41 |
| `ANULAR_ITEM_ENVIADO`, `ANULAR_ORDEN` (de 002: consumo de la autorización) | — | Criterios 36 y 42, solo con clave |
| `anular_orden` | `orden` | Criterios 42 y 43 |
| `liberar_mesa` | `orden` | Criterio 44 |
| `unir_ordenes` (con el mozo y los ítems de la orden absorbida) | `orden` | Criterio 47 |
| `configurar_acceso_sucursal` (de 002; ahora también con `minutosInactividadCocina`) | `sucursal_acceso` | Criterio 63c |
| `crear_impresora`, `modificar_impresora` | `impresora` | Criterios 103 y 104 |
| `configurar_destino_estacion`, `configurar_impresion_sucursal` | `estacion_destino`, `impresion_sucursal` | Criterios 100 y 102 |
| `crear_vinculacion_puente`, `vincular_puente`, `revocar_puente` | `puente` | Criterios 106 a 108 |

No se auditan (quedan en la trazabilidad de sus filas): abrir, enviar, marchar, pre-cuenta, mover, estados del KDS, latidos, resultados de impresión, reimpresiones y páginas de prueba.

## Casos límite

- Una mesa abierta por error: sin envíos, se libera sin clave (criterio 44); con algo enviado, se anula con clave.
- Hasta la sección 4 no hay cobro: una mesa solo vuelve a verde al anular o liberar su orden. En el piloto interno se usa "Liberar" o "Anular".
- El mozo responsable sale de turno con mesas abiertas: otro mozo sigue agregando (criterio 30) y la venta sigue a su nombre; cambiar el responsable queda fuera de alcance.
- Un mozo pulsa "Enviar" con mala señal, el celular pierde la red y otra persona entra con PIN en el mismo equipo: la cola se cancela (003); si la primera petición llegó, al volver el primer mozo el reintento con el mismo `id` devuelve el envío ya hecho (criterio 26); si no llegó, lo envía. Nunca sale dos veces a cocina.
- Un combo cuyo único componente es de Cocina y su bebida sin estación: solo sale a Cocina; la bebida la sirve el mozo (criterio 74).
- Un producto sin estación con un modificador ligado a un producto de Barra: sale solo la parte de Barra.
- Una estación desactivada en la carta después de un envío: sus comandas siguen en el KDS hasta que se terminan; los envíos nuevos de productos de esa estación salen igual, porque la línea preparada trae la estación (003 no deja desactivar una estación en uso por productos activos).
- La anulación de una parte de un ítem de combo (2 de 3 combos): cada estación recibe la anulación de su parte por 2 (criterio 38).
- Anular un ítem que ya está "Listo" en el KDS: se anula igual (puede haberse servido); la línea pasa a `ANULADO` y el destino del stock lo decide el supervisor.
- Marchar con ítems de segundo tiempo de una orden unida: se marchan todos los de la orden principal, incluidos los que vinieron de la absorbida.
- Unir dos mesas en pre-cuenta: ambas pre-cuentas quedan invalidadas y la principal vuelve a ocupada.
- Mover una orden unida de 3 mesas: se indica cuál mesa se reemplaza; las otras siguen.
- Dos KDS de Cocina marcan la misma línea a la vez: gana el último `PUT`; los dos reciben `cocina.linea`.
- El reloj de la API pasa la hora de corte con una mesa abierta: la orden sigue abierta (las órdenes no vencen); el menú del día de la línea ya enviada no cambia; los trabajos de impresión pendientes del día anterior vencen (criterio 117).
- Una sesión de soporte abre una mesa: debe elegir un mozo responsable (criterio 10).
- El KDS de una cocina tranquila: con la sesión PIN de Cocina/Barra, la pantalla sigue abierta hasta 60 minutos sin toques (el refresco automático y el socket no cuentan como uso); si un Supervisor usa el KDS con su propia sesión PIN, rige su tiempo normal (criterio 63b). Ninguna sesión pasa de 12 horas.
- El Administrador baja `minutosInactividadCocina` de 60 a 10 con un KDS abierto hace 30 minutos sin uso: la siguiente petición de esa sesión responde 401 `SESION_EXPIRADA` (criterio 63c, como el criterio 40 de 002).
- La autorización de clave vence entre la ventana y el envío de la anulación (2 minutos): 403 `AUTORIZACION_INVALIDA`; la PWA vuelve a pedir la clave conservando la cantidad, el motivo y el destino.
- Una réplica de anulación con otra clave y otra autorización (criterio 37): la segunda autorización queda usada sin anular nada; se acepta porque solo pasa si alguien volvió a pedir la clave para lo mismo.
- Total de una orden con cientos de ítems caros que pasaría de `99999999.99`: el envío se rechaza con `MONTO_FUERA_DE_RANGO` (criterio 21); en la práctica no ocurre.
- El puente se queda sin batería a mitad de un ticket: el trabajo no se reportó `IMPRESO`, sigue `PENDIENTE` y se reimprime entero al volver (puede salir dos veces: entrega "al menos una vez"; el puente recuerda los ids impresos solo si alcanzó a guardarlo).
- Cambio del ancho de papel con trabajos en cola: se imprimen con el ancho nuevo (criterio 126).
- Se vincula un segundo Android en la misma sucursal: el primero queda revocado (criterio 108). Si el local quiere dos puentes, es una pregunta futura.
- Una impresora Bluetooth configurada sin la app 3c con Bluetooth: sus trabajos quedan pendientes y su estado `DESCONOCIDO`; el formulario lo advierte.

## Reglas de negocio aplicables

Fuente: `fuentes.md`, las decisiones del usuario de 002 y 003 y las "Decisiones del usuario (2026-10-29)" de esta especificación, que mandan donde completan o cambian `fuentes.md`.

- El mozo abre la mesa en el mapa indicando los comensales; queda como mozo responsable y la mesa pasa de verde a rojo en todos los equipos al instante (HU-10, RF-24, Flujos de operación). Al abrir se puede elegir como responsable a otra persona que atienda mesas; después no cambia (decisión 8).
- Estados de la mesa: libre (verde), ocupada (rojo) y en pre-cuenta (amarillo), calculados de su orden abierta, en tiempo real (RF-23, Modelo de datos, Estados).
- Se toma el pedido por familias; cada ítem lleva modificadores, observaciones libres, tiempo de servicio (1 o 2) y marca de para llevar (RF-25, RF-26, HU-11).
- Al enviar, cada ítem o componente de combo va a la impresora o KDS de su estación; las adiciones salen marcadas como adición; los de segundo tiempo salen "ESPERAR" hasta "Marchar", que avisa a la estación con la mesa y los ítems; el ticket sale en menos de 5 segundos (RF-27, RF-28, HU-12 a HU-14, RNF-02).
- Un modificador ligado a un producto descuenta ese producto; un combo descuenta sus componentes; cada componente va a su estación (Inventario, HU-08 de 003).
- Antes de enviar, un ítem se corrige libremente; después, anularlo exige clave de supervisor, motivo y decidir si el stock vuelve o es merma, con ticket de anulación en la estación (RF-29, HU-15, Reglas de Salón, Estados). Se puede anular parte de la cantidad; por defecto, toda (decisión 6).
- Anular una orden abierta con clave de supervisor, igual que anular un ítem enviado (RF-35; decisión del usuario de 002). Una mesa sin nada enviado se libera sin clave, con auditoría (decisión 7).
- Cualquier mozo puede agregar pedidos a cualquier mesa; las ventas se atribuyen al mozo que la abrió (Reglas de Salón); el sistema siempre sabe quién hizo cada acción (decisión del usuario de 002).
- Mover una cuenta es cambiar la mesa de su orden; unir mesas crea una sola orden con varias mesas, que se ven como grupo (RF-30, RF-31, HU-16, Reglas de Salón). Se pueden unir mesas que ya tienen cada una su cuenta: la principal absorbe a las demás y la venta queda a nombre de su mozo (decisión 9).
- La pre-cuenta pone la mesa en amarillo; agregar ítems después la invalida y la mesa vuelve a ocupada; es opcional (RF-32, HU-17, Estados). Anular un ítem después de la pre-cuenta también la invalida (decisión 10). Muestra la suma de los totales vigentes con IGV incluido, sin desglose, con la nota "No es un comprobante" y, si hay ICBPER, "El ICBPER se suma al cobrar" (decisión 5).
- Las sesiones PIN de Cocina/Barra tienen su propio tiempo de inactividad por sucursal: 60 minutos por defecto, configurable de 1 a 720 por el Administrador (decisión 11).
- El stock se descuenta en la sección 6; aquí solo el punto de enganche (decisión 2). Mostrador y descuentos y cortesías van en la sección 4 (decisiones 3 y 4).
- El KDS muestra las comandas de cada estación en orden de llegada con tiempo transcurrido, tiempo de servicio, modificadores y observaciones; se marcan en preparación y listos, con aviso al mozo (RF-36, RF-37, HU-19). Preparación y Listo existen solo con KDS (Estados).
- Las estaciones se definen por empresa; cada sucursal asocia cada estación a una impresora o a un KDS; lo define solo el Administrador (Modelo de datos, Roles y permisos).
- El puente Android se vincula a una sucursal con un QR; las impresoras son genéricas ESC/POS de red o Bluetooth, de 58 u 80 mm, con juego de caracteres y gaveta; los trabajos se encolan, se reenvían al reconectarse y la app avisa si una impresora o el puente están desconectados; hay página de prueba y reimpresión (RF-75 a RF-78, HU-38, HU-39, RNF-12). En 3b, las impresoras de red funcionan de punta a punta con su juego de caracteres; Bluetooth y la gaveta quedan solo en la configuración (decisión 12); la app Android es la entrega 3c (decisión 13).
- Solo nube, sin modo offline; ante microcortes la app guarda lo que no pudo enviar y lo reintenta sin duplicar; identificadores UUID e impresión detrás de un conector para un modo offline futuro (Si falla internet, RNF-10).
- Permisos (matriz de 002, sin cambios): `ATENDER_MESA` (Mozo, Cajero, Supervisor, Administrador), `MOVER_UNIR_MESAS` (igual), `ANULAR_ITEM_ENVIADO` y `ANULAR_ORDEN` (clave para Mozo y Cajero), `USAR_KDS` (Cocina/Barra, Supervisor, Administrador), `ADMINISTRAR` (mapa, impresoras, destinos y puente).
- Auditoría inmutable de las acciones protegidas y los cambios de configuración (RNF-09, RF-13); trazabilidad de autor en toda tabla (RNF-20).
- Montos con decimales exactos y código compartido (RNF-17, Modelo de datos).

## Contrato

### Endpoints

"Salón" = `@Permiso('ATENDER_MESA')` + `@RequiereModulo('SALON')`; "Cocina" = `@Permiso('USAR_KDS')` + `@RequiereModulo('COCINA')`; "Admin" = `@Permiso('ADMINISTRAR')`; "Clave" = obligatoria para quien tiene la acción como `clave`. "IK" = `Idempotency-Key` obligatoria (400 `DATOS_INVALIDOS` sin ella).

**Entrega 3a**

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `GET /sucursales/:sucursalId/zonas` | Admin | — | 200 `zonaRespuesta[]`; 404 |
| `POST /sucursales/:sucursalId/zonas` | Admin; IK opcional | `zonaEntrada` | 201; 400; 403; 404; 409 |
| `PATCH /sucursales/:sucursalId/zonas/:id` | Admin | `zonaModificarEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO` |
| `PUT /sucursales/:sucursalId/zonas/orden` | Admin | `ordenEntrada` | 200; 400; 403; 404 |
| `POST /sucursales/:sucursalId/zonas/:zonaId/mesas` | Admin; IK opcional | `mesaEntrada` | 201 `mesaRespuesta`; 400; 403; 404; 409 |
| `PATCH /sucursales/:sucursalId/mesas/:id` | Admin | `mesaModificarEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO` |
| `GET /salon` | Salón | `If-None-Match` | 200 `salonRespuesta` con `ETag`; 304 |
| `GET /salon/stock` | Salón | `?productoIds=` | 200 `stockSalonRespuesta` |
| `POST /ordenes` | Salón; IK | `abrirOrdenEntrada` | 201 `ordenRespuesta`; 400; 404; 409 `MESA_OCUPADA` / `CONFLICTO`; 422 |
| `GET /ordenes/:id` | Salón | — | 200 `ordenRespuesta`; 404 |
| `PATCH /ordenes/:id` | Salón | `{ comensales }` | 200; 400; 404; 409 |
| `POST /ordenes/:id/envios` | Salón; IK | `envioEntrada` | 201 `envioRespuesta`; 400; 404; 409 `ORDEN_NO_ABIERTA`; 422 `PRODUCTO_NO_VENDIBLE` / `SELECCION_INVALIDA` / `MONTO_FUERA_DE_RANGO` / `CLAVE_IDEMPOTENCIA_REUTILIZADA` |
| `POST /ordenes/:id/marchas` | Salón; IK | `marchaEntrada` | 201; 404; 409 `NADA_QUE_MARCHAR` / `ORDEN_NO_ABIERTA`; 422 |
| `POST /ordenes/:id/precuentas` | Salón; IK | `{ id }` | 201 `precuentaRespuesta`; 404; 409 `ORDEN_SIN_CONSUMO` / `ORDEN_NO_ABIERTA` |
| `POST /ordenes/:id/movimiento` | `MOVER_UNIR_MESAS` + SALON | `moverEntrada` | 200; 400; 404; 409 |
| `POST /ordenes/:id/union` | `MOVER_UNIR_MESAS` + SALON | `unirEntrada` | 200; 400; 404; 409 |
| `POST /ordenes/:id/items/:itemId/anulaciones` | `ANULAR_ITEM_ENVIADO` (Clave) + SALON; IK | `anularItemEntrada` | 201 `anulacionRespuesta`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` / `PROHIBIDO`; 404; 409 `ITEM_NO_ANULABLE` / `ORDEN_NO_ABIERTA`; 422 |
| `POST /ordenes/:id/anulacion` | `ANULAR_ORDEN` (Clave) + SALON; IK | `anularOrdenEntrada` | 200 `ordenRespuesta`; 400; 403; 404; 409 |
| `POST /ordenes/:id/liberacion` | Salón; IK | — | 200 `ordenRespuesta`; 404; 409 `ORDEN_CON_CONSUMO` / `ORDEN_NO_ABIERTA` |
| `GET /cocina/comandas` | Cocina | `?estacionIds=`, `If-None-Match` | 200 `cocinaRespuesta`; 304 |
| `PUT /cocina/lineas/:id/estado` | Cocina | `{ estado }` | 200; 400; 404; 409 `TRANSICION_INVALIDA` |
| `PUT /cocina/comandas/:id/listo` | Cocina | — | 200; 404; 409 |
| `PUT /cocina/comandas/:id/visto` | Cocina | — | 200; 404; 409 |
| `GET`, `PATCH /sucursales/:id/acceso` (de 002, cambia) | Administrador (como en 002) | `{ minutosInactividad?, minutosInactividadCocina? }`, al menos uno | 200 `{ sucursalId, minutosInactividad, minutosInactividadCocina }`; 400; 403; 404 |

**Entrega 3b**

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `GET`, `POST /sucursales/:sucursalId/impresoras` | Admin | `impresoraEntrada` | 200 / 201 `impresoraRespuesta`; 400; 403; 404; 409 |
| `PATCH /sucursales/:sucursalId/impresoras/:id` | Admin | `impresoraModificarEntrada` | 200; 400; 403; 404; 409 `EN_USO` / `CONFLICTO` |
| `POST /sucursales/:sucursalId/impresoras/:id/prueba` | Admin; IK | — | 201 `{ trabajoId }`; 403; 404 |
| `GET /sucursales/:sucursalId/estaciones-destino` | Admin | — | 200 `estacionDestinoRespuesta[]` |
| `PUT /sucursales/:sucursalId/estaciones-destino/:estacionId` | Admin | `estacionDestinoEntrada` | 200; 400; 403; 404; 422 |
| `GET`, `PUT /sucursales/:sucursalId/impresion` | Admin | `{ impresoraCajaId }` | 200; 400; 403; 404; 422 |
| `POST /sucursales/:sucursalId/vinculaciones-puente` | Admin; IK opcional | — | 201 `vinculacionRespuesta`; 403; 404 |
| `GET /sucursales/:sucursalId/puentes` | Admin | — | 200 `puenteRespuesta[]` |
| `DELETE /sucursales/:sucursalId/puentes/:id` | Admin | — | 204; 403; 404 |
| `GET /impresion/estado` | cualquier rol con sucursal activa | — | 200 `estadoImpresionRespuesta` |
| `GET /impresion/trabajos` | `ATENDER_MESA` | `?desde=&estado=` | 200 `trabajoResumen[]` |
| `POST /impresion/trabajos/:id/reimpresion` | `ATENDER_MESA`; IK | — | 201 `{ trabajoId }`; 404; 409 `SIN_IMPRESORA` |
| `POST /puente/vinculacion` | `Bearer vi.…` | `vincularPuenteEntrada` | 201 `vincularPuenteRespuesta`; 400; 401 `VINCULACION_INVALIDA` |
| `GET /puente/configuracion` | `Bearer pu.…` | — | 200 `configuracionPuente` |
| `GET /puente/trabajos` | `Bearer pu.…` | — | 200 `trabajoParaImprimir[]` |
| `POST /puente/trabajos/:id/resultado` | `Bearer pu.…` | `resultadoTrabajoEntrada` | 200; 400; 404; 409 |
| `POST /puente/latido` | `Bearer pu.…` | `latidoEntrada` | 204; 400 |

- El orden de rechazos de las escrituras de órdenes: 401, 403 de rol, 409 `SUCURSAL_NO_ELEGIDA`, 403 `MODULO_NO_INCLUIDO`, 400 de forma (incluida la falta de `Idempotency-Key`), réplica de la misma clave (devuelve lo guardado), 403 de clave (`CLAVE_REQUERIDA`, `AUTORIZACION_INVALIDA`), 404, réplica del mismo id de cliente (devuelve lo guardado), 409 de estado, 422.
- CORS: Socket.IO usa los mismos `ORIGENES_PERMITIDOS`.

### Códigos de error nuevos (`CODIGOS_ERROR`)

`MESA_OCUPADA` (409, con `ordenId`), `ORDEN_NO_ABIERTA` (409, con `ordenId` si la orden se unió a otra), `ORDEN_SIN_CONSUMO` (409), `ORDEN_CON_CONSUMO` (409), `NADA_QUE_MARCHAR` (409), `ITEM_NO_ANULABLE` (409), `TRANSICION_INVALIDA` (409), `MONTO_FUERA_DE_RANGO` (422); en 3b, `VINCULACION_INVALIDA` (401) y `SIN_IMPRESORA` (409). `errorRespuestaSchema` gana el campo opcional `ordenId`. Se reutilizan `DATOS_INVALIDOS`, `NO_ENCONTRADO`, `CONFLICTO`, `EN_USO`, `PROHIBIDO`, `REFERENCIA_INVALIDA`, `PRODUCTO_NO_VENDIBLE`, `SELECCION_INVALIDA`, `CLAVE_REQUERIDA`, `AUTORIZACION_INVALIDA`, `CLAVE_IDEMPOTENCIA_REUTILIZADA`, `SUCURSAL_NO_ELEGIDA`, `MODULO_NO_INCLUIDO` y `NO_AUTENTICADO`.

### Eventos en tiempo real

Transporte: Socket.IO en `/tiempo-real`; espacio `/` para la PWA y `/puente` para el puente. Todos se publican con `PublicadorEventos` y `ContextoEmpresa.alConfirmar`.

| Evento | Sala | Datos | Cuándo |
| --- | --- | --- | --- |
| `salon.cambio` | sucursal | `{ mesaIds, ordenId }` | Criterios 14, 23, 42, 44, 45 a 47, 50, 53 |
| `orden.cambio` | sucursal | `{ ordenId }` | Toda escritura de una orden |
| `cocina.comanda` | sucursal | `{ comandaId, estacionId, tipo }` | Criterios 31, 32, 38, 42 |
| `cocina.linea` | sucursal | `{ comandaId, lineaId, estado }` | Criterios 58, 59 |
| `cocina.listo` | sucursal | `{ ordenId, itemId, lineaId, mesas, nombre, cantidad, destinatarios }` | Criterio 60 |
| `carta.disponibilidad`, `carta.actualizada` | sucursal / empresa | los de 003 | 003, criterios 46 y 54 |
| `impresion.estado` (3b) | sucursal | `{ sucursalId }` | Criterio 120 |
| `trabajo.nuevo` (3b) | puente | `{ trabajoId }` | Criterio 112 |
| `puente.configuracion` (3b) | puente | `{}` | Criterio 110 |

`SalaDeEvento` de `PublicadorEventos` gana `{ tipo: 'puente', puenteId }`.

### Paquetes compartidos

- `packages/dominio` (`src/salon/`):
  - Ruta crítica: `partesDeComanda`, `partesDeStock`, `partesDeStockDeEnvio` (`comanda.ts`); `totalVigenteLinea`, `totalOrden`, `excedeMontoMaximo`, `MONTO_MAXIMO` (`montos.ts`).
  - No crítica: `ESTADOS_ORDEN`, `ESTADOS_MESA`, `ESTADOS_LINEA_KDS`, `TIPOS_COMANDA`, `DESTINOS_STOCK`, `FORMAS_MESA`, `estadoDeMesa`, `esOrdenAbierta`, `transicionKdsValida`; límites `MAXIMO_LINEAS_ENVIO = 50`, `MAXIMO_MESAS_ORDEN = 20`, `LARGO_OBSERVACION = 140`.
- `packages/contratos`:
  - `src/salon.ts`: `zonaEntrada`, `zonaModificarEntrada`, `zonaRespuesta`, `mesaEntrada`, `mesaModificarEntrada`, `mesaRespuesta`, `salonRespuesta`, `stockSalonRespuesta`, `abrirOrdenEntrada`, `ordenRespuesta`, `itemRespuesta`, `envioEntrada`, `envioRespuesta`, `marchaEntrada`, `anularItemEntrada`, `anulacionRespuesta`, `anularOrdenEntrada`, `moverEntrada`, `unirEntrada`, `precuentaRespuesta`, `cocinaRespuesta`, `comandaKds`, `estadoLineaEntrada`; y los eventos de la tabla.
  - `src/impresion.ts` (3b): `impresoraEntrada`, `impresoraModificarEntrada`, `impresoraRespuesta`, `estacionDestinoEntrada`, `estacionDestinoRespuesta`, `impresionSucursalEntrada`, `vinculacionRespuesta`, `puenteRespuesta`, `estadoImpresionRespuesta`, `trabajoResumen`, `documentoTicket`.
  - `src/puente.ts` (3b, el protocolo que implementan el simulador y la app 3c): `vincularPuenteEntrada`, `vincularPuenteRespuesta`, `configuracionPuente`, `trabajoParaImprimir`, `resultadoTrabajoEntrada`, `latidoEntrada`, los eventos `trabajo.nuevo` y `puente.configuracion`, y `VERSION_PROTOCOLO_PUENTE = 1` (cabecera `X-Puente-Protocolo`).
  - `src/errores.ts`: los códigos nuevos y `ordenId` en `errorRespuestaSchema`.
  - `src/usuarios.ts` (de 002, cambia en 3a): `sucursalAccesoEntradaSchema` pasa a `{ minutosInactividad?, minutosInactividadCocina? }` estricto con al menos uno, y `sucursalAccesoRespuestaSchema` gana `minutosInactividadCocina` (1 a 720).
### Interfaces de la API (contratos públicos para las pruebas y para otras secciones)

- `crearAplicacion({ …, inventario?, tiempoReal? })`: `inventario` reemplaza a `INVENTARIO`; `tiempoReal: { habilitado: boolean }` (por defecto deshabilitado en `test`, como el publicador en memoria; las pruebas de tiempo real lo habilitan y escuchan un puerto con `app.listen(0)`).
- `INVENTARIO` / `InventarioPuerto` (`alEnviar`, `alAnular`, `disponibles`) e `InventarioNulo`.
- `PedidosConsultaService.hayOrdenesAbiertas(sucursalId)` (para la sección 4) y `PedidosConsultaService.ordenesAbiertas(sucursalId)`.
- `IMPRESION` / `ImpresionPuerto` (`destinos(sucursalId, estacionIds)`, `encolar(trabajos)`): en 3a, `ImpresionSoloKds` (todo `KDS`, `encolar` no hace nada); en 3b, el de `ImpresionModule`.
- `MesasConsultaService` (salón), `UsuariosConsultaService.puedenAtenderMesa(sucursalId, usuarioIds)` (seguridad, nuevo), `CartaConsultaService.estaciones()` (carta, nuevo) y `SesionActual.autorizacionConsumida()` (seguridad, nuevo: la autorización que consumió `@Permiso` en la petición, para la fila de auditoría de la acción).
- `ValidadorDeSesion` (seguridad): la validación de un token de sesión que hoy hace el resolutor de HTTP, reutilizada por Socket.IO.
- Pruebas: `SimuladorPuente` y `EmuladorEscPos` (`apps/api/test/soporte/puente/`), `ClienteTiempoReal` (envoltorio de `socket.io-client` para las pruebas).

### Variables de entorno nuevas

| Variable | Uso |
| --- | --- |
| `TIEMPO_REAL` | `habilitado` o `deshabilitado`; por defecto `habilitado` salvo en `test` |
| `DATABASE_TIEMPO_REAL_URL` | Conexión del adaptador de Socket.IO con el rol `restaurante_tiempo_real`; obligatoria con `TIEMPO_REAL=habilitado` |
| `DB_PASSWORD_TIEMPO_REAL` | Contraseña del rol para `db:preparar` (como las `DB_PASSWORD_*` de 001) |
| `API_URL_PUBLICA` (3b) | URL de la API que va en el QR de vinculación |

### Permisos

- Los de la tabla de endpoints. La matriz de `packages/dominio` no cambia. Soporte = Administrador. Principal de prueba = Administrador.
- Base de datos (todas con `acceso_plataforma` sin privilegios para `restaurante_plataforma`):

| Tabla | `restaurante_api` |
| --- | --- |
| `zona`, `mesa`, `orden`, `orden_mesa`, `item`, `comanda`, `comanda_linea`, `precuenta` | SELECT, INSERT, UPDATE |
| `envio`, `marcha`, `anulacion_item` | SELECT, INSERT |
| `impresora`, `estacion_destino`, `impresion_sucursal`, `vinculacion_puente`, `puente`, `trabajo_impresion` (3b) | SELECT, INSERT, UPDATE |
| `tiempo_real.socket_io_attachments` | ninguno (solo `restaurante_tiempo_real`: SELECT, INSERT, DELETE) |

## Cambios al modelo de datos

Todas las tablas de `public` con `id uuid`, `empresa_id`, `creado_en`, `actualizado_en`, único `(id, empresa_id)`, índice por `empresa_id`, creadas con `sqlTablaDeEmpresaTrazable(tabla, { privilegiosApi, privilegiosPlataforma: [], llaveDeEquipo: true })`, llaves foráneas compuestas con `empresa_id`, `CHECK` de largo en los textos y montos `numeric(10,2)`. Los ids de las filas que crea la PWA (`orden.id`, `envio.id`, `anulacion_item.id`, `precuenta.id` y el id de marcha) vienen del cliente: en esas tablas la clave primaria es `(empresa_id, id)` (y no `id` solo, como en las tablas de 003), así el mismo UUID usado en otra empresa crea su propia fila sin chocar con la de A ni revelar que existe (criterio 85); la búsqueda de la réplica corre bajo RLS.

**Entrega 3a**

- **`zona`** (módulo salón): `sucursal_id` (FK compuesta), `nombre` (1 a 40), `orden integer`, `columnas smallint` (2 a 12), `filas smallint` (1 a 30), `activa`. Único `(sucursal_id, lower(nombre))`.
- **`mesa`** (salón): `sucursal_id`, `zona_id` (FK compuestas; la zona de la misma sucursal, `CHECK` vía llave `(zona_id, sucursal_id, empresa_id)`), `nombre` (1 a 20), `capacidad smallint` (1 a 50), `forma` (`CHECK IN ('CUADRADA','REDONDA','RECTANGULAR')`), `columna smallint`, `fila smallint`, `activa`. Únicos parciales `(sucursal_id, lower(nombre)) WHERE activa` y `(zona_id, columna, fila) WHERE activa`.
- **`orden`** (pedidos): `sucursal_id`, `tipo` (`CHECK IN ('MESA','MOSTRADOR','PARA_LLEVAR','DELIVERY')`), `canal` (`CHECK IN ('SALON','WEB','TELEFONO')`), `estado` (`CHECK IN ('ABIERTA','EN_PRECUENTA','ANULADA','UNIDA','CERRADA')`), `mozo_id` (FK compuesta a `usuario`, null solo si `tipo <> 'MESA'`), `comensales smallint` (1 a 99), `abierta_en`, `anulada_en null`, `motivo_anulacion null`, `sin_consumo boolean`, `unida_a_orden_id null` (FK compuesta a `orden`), `cerrada_en null`. Índice `(sucursal_id, estado)`.
- **`orden_mesa`** (pedidos): `orden_id`, `mesa_id` (FK compuestas), `desde`, `hasta null`. Único parcial `(mesa_id) WHERE hasta IS NULL` (una mesa, una orden abierta). Índice `(orden_id)`.
- **`envio`** (pedidos): `orden_id` (la orden donde se creó; no cambia al unir), `numero smallint`, `es_adicion boolean`, `huella_entrada bytea` (de las líneas normalizadas, para el criterio 26). Único `(orden_id, numero)`.
- **`item`** (pedidos): `orden_id` (la vigente; cambia al unir), `envio_id`, `producto_id` (FK compuestas), `nombre`, `tipo_producto`, `cantidad smallint` (1 a 999), `cantidad_anulada smallint` (0 a `cantidad`), `precio_unitario numeric(10,2)`, `total numeric(10,2)` (= precio × cantidad, `CHECK`), `afectacion_igv`, `aplica_icbper`, `linea jsonb` (la `lineaPreparada` completa), `observacion null` (1 a 140), `tiempo smallint` (`CHECK IN (1,2)`), `para_llevar`, `es_adicion`, `marchado_en null`, `estado` (`CHECK IN ('ENVIADO','ANULADO')`), `posicion smallint` (orden dentro del envío). Índice `(orden_id)`.
- **`comanda`** (pedidos): `sucursal_id` (copiada de la orden, para el KDS), `orden_id` (de origen), `estacion_id` (FK compuesta a `estacion`), `envio_id null`, `tipo` (`CHECK IN ('COMANDA','ADICION','MARCHAR','ANULACION')`), `destino` (`CHECK IN ('KDS','IMPRESORA')`), `origen_id null` (id de la marcha o de la anulación), `vista_en null`. Índice `(sucursal_id, creado_en)`.
- **`comanda_linea`** (pedidos): `comanda_id`, `item_id` (FK compuestas), `rol` (`CHECK IN ('PRODUCTO','COMPONENTE','LIGADO')`), `producto_id`, `nombre`, `contexto null`, `cantidad_por_item smallint` (1 para el producto y los ligados, la cantidad del componente para un componente; la cantidad vigente de la línea es `cantidad_por_item × cantidad vigente del ítem`, y en una comanda `MARCHAR` o `ANULACION` se guarda además `cantidad smallint` fija), `modificadores jsonb`, `observacion null`, `tiempo`, `para_llevar`, `esperar boolean`, `estado` (`CHECK IN ('ENVIADO','EN_PREPARACION','LISTO','ANULADO')`), `estado_en`.
- **`marcha`** (pedidos): `orden_id`, `huella_entrada bytea` (de los ítems pedidos, para reconocer la réplica del criterio 32).
- **`anulacion_item`** (pedidos): `item_id`, `orden_id`, `cantidad smallint`, `motivo` (1 a 300), `destino_stock` (`CHECK IN ('VUELVE','MERMA')`), `autorizado_por_id null`, `autorizacion_id null`, `de_orden boolean` (parte de una anulación de orden), `huella_entrada bytea`.
- **`precuenta`** (pedidos): `orden_id`, `numero smallint`, `lineas jsonb`, `total numeric(10,2)`, `emitida_en`, `invalidada_en null`, `version_orden integer` (para saber si la orden cambió). Único `(orden_id, numero)`; único parcial `(orden_id) WHERE invalidada_en IS NULL`.
- **`orden.version integer`**: sube con cada cambio de ítems o mesas; la pre-cuenta vigente es igual si `version_orden = orden.version`.
- **`sucursal_acceso.minutos_inactividad_cocina`** (módulo seguridad, tabla de 002; decisión 11): `smallint NOT NULL DEFAULT 60`, `CHECK` de 1 a 720. Las filas existentes quedan con 60; sin fila, vale 60.
- **Esquema `tiempo_real`** (dueño `restaurante_migrador`, `USAGE` solo para `restaurante_tiempo_real`): `socket_io_attachments (id bigserial, created_at timestamptz, payload bytea)`, la tabla que usa el adaptador para mensajes grandes. Rol `restaurante_tiempo_real` creado por `db:preparar` (`LOGIN`, sin `BYPASSRLS`, `CREATEROLE` ni `CREATEDB`, sin membresías).

**Entrega 3b** (módulo impresión)

- **`impresora`**: `sucursal_id`, `nombre` (1 a 40), `conexion_tipo` (`CHECK IN ('RED','BLUETOOTH')`), `host null`, `puerto integer null` (1 a 65535), `mac null`, `ancho_mm smallint` (`CHECK IN (58, 80)`), `juego_caracteres` (`CHECK IN (…)`), `gaveta`, `activa`. `CHECK` de que `RED` tiene `host` y `puerto` y `BLUETOOTH` tiene `mac`. Único `(sucursal_id, lower(nombre))`.
- **`estacion_destino`**: `sucursal_id`, `estacion_id`, `destino` (`CHECK IN ('KDS','IMPRESORA')`), `impresora_id null` (FK compuesta; `CHECK` de que `IMPRESORA` la tiene). Único `(sucursal_id, estacion_id)`.
- **`impresion_sucursal`**: `sucursal_id` (único), `impresora_caja_id null`.
- **`vinculacion_puente`**: `sucursal_id`, `huella_secreto bytea`, `expira_en`, `usada_en null`, `invalidada_en null`, `puente_id null`.
- **`puente`**: `sucursal_id`, `nombre` (1 a 60), `modelo null`, `version_app`, `huella_secreto bytea`, `activo`, `revocado_en null`, `ultima_senal_en null`, `estado_impresoras jsonb`. Único parcial `(sucursal_id) WHERE activo`.
- **`trabajo_impresion`**: `sucursal_id`, `impresora_id`, `tipo` (`CHECK IN ('COMANDA','ADICION','MARCHAR','ANULACION','PRECUENTA','PRUEBA')`), `documento jsonb`, `comanda_id null`, `precuenta_id null`, `reimpresion_de_id null`, `estado` (`CHECK IN ('PENDIENTE','IMPRESO')`; `VENCIDO` se calcula), `dia_operativo date`, `intentos smallint`, `ultimo_error null`, `entregado_en null`, `impreso_en null`. Único parcial `(comanda_id) WHERE comanda_id IS NOT NULL AND reimpresion_de_id IS NULL` (una comanda, un trabajo). Índice `(sucursal_id, estado, creado_en)`.

## Fuera de alcance

- Venta en mostrador y número de llamado (HU-18, RF-34), descuentos y cortesías (RF-33), cobro, división de cuenta, comprobantes y la gaveta en uso: sección 4 (decisiones 3 y 4).
- Llevar el stock, cargar porciones del día, descontar, bloquear en cero, el agotado automático y mostrar cuántos quedan (HU-20, RF-38, RF-67 a RF-70): sección 6, sobre el punto de enganche de esta (decisión 2).
- Pedidos web, por teléfono, para llevar y delivery: sección 5.
- La app Android del puente: entrega 3c (decisión 13). Bluetooth funcionando, solo con la app; la gaveta en uso, con la sección 4 (decisión 12).
- Desglose de IGV y base imponible en la pre-cuenta: sección 4 (decisión 5).
- Cambiar el tiempo de inactividad de las sesiones de contraseña o de soporte, o dar un tiempo aparte a otros roles (decisión 11: solo Cocina/Barra).
- Separar mesas unidas, mover ítems entre órdenes y cambiar el mozo responsable de una orden abierta (no están en las fuentes).
- Notificaciones del sistema (push) con la app cerrada.
- Varios puentes por sucursal; puente para Windows o iPhone (fuera del MVP o fuera de alcance según el diseño).
- Modo offline; comandas en papel y su registro posterior (el diseño lo deja al cajero, sección 4).
- Tiempo objetivo por plato configurable en el KDS (los umbrales de 10 y 20 minutos son fijos).
- Purgar trabajos de impresión, comandas y órdenes viejas.

## Impacto en especificaciones anteriores

- **001, nota sobre `LISTEN`/`NOTIFY` y cerrojos:** se resuelve con el criterio 70: rol propio del adaptador, esquema `tiempo_real` y nombres nuevos en la lista de la guarda de la API (`NOMBRES_PROHIBIDOS`). Agregar nombres a la lista no cambia ninguna prueba existente; el arranque comprueba el rol nuevo como el criterio 10 y 10b de 001. `db:preparar` crea el rol `restaurante_tiempo_real` y el esquema (también en la base de pruebas).
- **001, criterio 38 y 002, criterio 113:** las pruebas de catálogo cubren las tablas nuevas de `public`; el esquema `tiempo_real` queda fuera de su recorrido (no es `public`) y lo cubre el criterio 70.
- **002, criterio 1:** la lista cerrada de rutas públicas no cambia: `/puente/*` responde 401 sin `Authorization` (la credencial de vinculación viaja en `Authorization`). `AutenticacionGuard` deja pasar a su propio guard las rutas marcadas `@Puente()` y `@VinculacionPuente()`, como hace con `@Superadministrador()`. Las pruebas protegidas de 002 no se tocan por esto (las únicas que cambian son las de inactividad, más abajo).
- **002, `SesionActual`:** gana `autorizacionConsumida()`; `PermisoInterceptor` guarda ahí la autorización que consumió. El comportamiento de `@Permiso` no cambia.
- **002, orden de interceptores:** en las rutas con `@Idempotente()` y `@Permiso()` de esta sección, la réplica de la misma clave se resuelve antes de consumir la autorización (criterio 37). Si hace falta cambiar el orden de aplicación de los interceptores para eso, se hace sin cambiar el comportamiento de las rutas de 002 (ninguna combina los dos decoradores con una acción `clave`).
- **002, inactividad** (decisión 11): cambian los criterios 39 y 40 de 002 para el rol Cocina/Barra (criterios 63b y 63c de esta sección); `sucursal_acceso` gana `minutos_inactividad_cocina`, y `sucursalAccesoEntradaSchema` y `sucursalAccesoRespuestaSchema` de `packages/contratos/src/usuarios.ts` ganan `minutosInactividadCocina`. Las pruebas protegidas de 002 que afirman la forma exacta de `GET` y `PATCH /sucursales/:id/acceso` (`toEqual({ sucursalId, minutosInactividad })` en `apps/api/test/acceso/pin.spec.ts` y `apps/api/test/acceso/sesion-rutas.spec.ts`) las ajusta test-writer en la fase B de 3a (P0), sin debilitar ningún caso, con la línea `// Ajustado por 004-salon-cocina, decisión 11 (2026-10-29): inactividad aparte para Cocina/Barra.` debajo de su cabecera (como P0 de 003). Ninguna otra prueba protegida de 002 cambia; P0 confirma con una búsqueda en `apps/api/test/acceso/` y `apps/api/test/carta-critica/` que ninguna otra afirma la inactividad de una sesión PIN de Cocina/Barra.
- **003, `PublicadorEventos`:** gana la sala `puente`; `PublicadorNulo` sigue siendo el de las pruebas que no habilitan el tiempo real y `PublicadorEnMemoria` sigue igual. La Disponibilidad de 003 deja de depender solo del refresco de 15 s: también escucha `carta.disponibilidad`.
- **003, carta:** `CartaModule` exporta además `CartaConsultaService` (lista de estaciones activas, para los destinos de 3b). `prepararLinea` no cambia.
- **003, PWA:** la navegación cambia (criterio 87): "Inicio" se reemplaza por el destino inicial del rol y la administración se agrupa en "Ajustes". El E2E de 003 que recorre la navegación se ajusta (no es una prueba protegida).
- **002, seguridad:** `UsuariosConsultaService.puedenAtenderMesa` (nuevo) y `ValidadorDeSesion` (extraído del resolutor de HTTP sin cambiar su comportamiento).

## Notas para otras secciones

- **Sección 4 (Caja y comprobantes):**
  - Cerrar la orden al cobrar (`CERRADA`, `cerrada_en`, `orden_mesa.hasta`) y publicar `salon.cambio`; impedir la Z con `PedidosConsultaService.hayOrdenesAbiertas`.
  - Calcular el IGV, el ICBPER, los descuentos y las cortesías (RF-33) sobre los ítems guardados (`precio_unitario`, `cantidad` vigente, `afectacion_igv`, `aplica_icbper`, `linea`), ampliando `totalOrden` en `packages/dominio`; la pre-cuenta debe mostrarlos cuando existan.
  - Mostrador (HU-18): orden `MOSTRADOR` sin mesa, cobrada antes del envío, con número de llamado en la comanda (agregar el campo al documento del ticket) y en el comprobante; reutilizar el envío y el ruteo de esta sección.
  - Gaveta: usar `impresion_sucursal.impresora_caja_id` y `impresora.gaveta`, con un trabajo de pulso.
  - Imprimir comprobantes en la impresora de caja con un tipo de trabajo nuevo.
- **Sección 5 (Pedidos web y por teléfono):** el pedido web es una orden más en estado pendiente; agregar `PENDIENTE`, `RECHAZADA` y `VENCIDA` al `CHECK` de `orden.estado`; al confirmar, enviar sus líneas con el mismo servicio de envío (revalida con `prepararLinea`).
- **Sección 6 (Inventario):** implementar `INVENTARIO` (`alEnviar` con bloqueo en cero de las porciones y aviso o bloqueo de las unidades según la sucursal, `alAnular` con el destino, `disponibles` para el comandero) y sus pruebas protegidas sobre `POST /ordenes/:id/envios` y las anulaciones; cargar porciones (HU-20); marcar agotado con `origen: 'SIN_STOCK'`. La PWA ya tiene el hueco para la cantidad en el comandero.
- **Sección 7 (Reportes):** ventas por mozo con `orden.mozo_id`; anulaciones con `anulacion_item` y la auditoría (`anular_item`, `anular_orden`, con autorizador y motivo); tiempos de cocina con `comanda.creado_en` y `comanda_linea.estado_en`.
- **Entrega 3c (app puente Android):** implementar `packages/contratos/src/puente.ts` (versión 1) como el `SimuladorPuente`: Android 10 o superior; escanear el QR con la cámara; guardar el token en almacenamiento cifrado; servicio en primer plano para que el ahorro de batería no lo cierre; Socket.IO al espacio `/puente` y HTTP con OkHttp; imprimir por TCP (puerto 9100) los bytes recibidos, sin interpretarlos; Bluetooth SPP con los mismos bytes; reportar resultado y latido; no imprimir dos veces un id ya impreso; pantalla con el estado de cada impresora y "Imprimir prueba local". Validación: pruebas JVM del procesador de trabajos contra un emulador TCP y una lista de verificación manual con impresoras reales de 58 y 80 mm (red y Bluetooth), que alimenta la "lista recomendada" de los pendientes de validar del diseño.

## Preguntas abiertas

Ninguna. Las trece preguntas del borrador se respondieron el 2026-10-29 (ver "Decisiones del usuario (2026-10-29)").

## Decisiones del usuario (2026-10-29)

El usuario aprobó la especificación el 2026-10-29 y aceptó la recomendación del especificador en las trece preguntas. Se conserva su numeración; los criterios las citan como "decisión N".

1. **División de la sección:** se divide en **3a · Salón y Cocina**, **3b · Impresión en la nube** y **3c · app Kotlin del puente**, esta última como entrega propia ("Entregas: 3a, 3b y 3c"). Se ejecuta 3a y luego 3b, cada una con su commit de cierre.
2. **Stock:** se descuenta en la sección 6. Aquí queda solo el punto de enganche: el puerto `INVENTARIO` y `partesDeStock` (criterios 39, 72 y 75). El comandero no muestra "quedan N" hasta la sección 6 (criterio 73).
3. **Mostrador (HU-18, RF-34):** sección 4.
4. **Descuentos y cortesías (RF-33):** sección 4.
5. **Pre-cuenta:** la suma de los totales vigentes, con IGV incluido y sin desglose, con la nota "No es un comprobante" y, si hay ICBPER, "El ICBPER se suma al cobrar" (criterio 51; textos exactos en ese criterio).
6. **Anulación parcial:** se puede anular parte de la cantidad de un ítem; por defecto se anula toda (criterios 35, 38 y 93).
7. **Mesa sin nada enviado:** se libera sin clave, con auditoría (criterio 44).
8. **Mozo responsable:** por defecto, quien abre la mesa; al abrir se puede elegir a otra persona que atienda mesas; después no se cambia (criterios 10 y 89).
9. **Unir mesas con cuenta:** se pueden unir mesas que ya tienen cada una su cuenta; la principal absorbe a las demás y la venta queda a nombre de su mozo (criterios 47 y 94).
10. **Anular después de la pre-cuenta:** la invalida (criterios 40 y 53).
11. **Inactividad de Cocina/Barra:** tiene su propio tiempo de inactividad, 60 minutos por defecto, configurable de 1 a 720 por sucursal (criterios 63b y 63c). Entran P0 (test-writer ajusta las pruebas protegidas de 002 afectadas) y T19 (implementación). Alcance según la pregunta: las sesiones PIN, que son las que rige el criterio 39 de 002; las de contraseña y de soporte no cambian.
12. **Impresoras en 3b:** las de red, de punta a punta, con juego de caracteres; Bluetooth y la gaveta solo en la configuración (criterios 103, 123 y 136).
13. **App Kotlin del puente:** es la entrega 3c ("Notas para otras secciones").

**Decisiones del especificador:** aprobadas por el usuario el 2026-10-29, todas, incluidas: los trabajos de impresión vencen con el día operativo (criterio 117), los umbrales del KDS son 10 y 20 minutos (criterio 96) y el aviso de "Listo" va al mozo responsable y a quien comandó (criterio 60).

### Preguntas del borrador y su motivo

Texto de las preguntas tal como se presentaron; en todas, la recomendación es la que el usuario aceptó.

1. **¿Dividimos la sección en 3a (Salón y Cocina) y 3b (Impresión en la nube)?** Son 140 criterios. **Recomiendo sí**, con la tabla de "Entregas": 3a es un flujo completo con el KDS y concentra la ruta crítica; 3b agrega el papel sin tocar lo de 3a. Si prefieres una sola entrega, se hacen en ese orden con una sola aprobación.
2. **Stock al enviar la comanda: ¿lo descontamos aquí o dejamos el enganche y lo hace la sección 6?** **Recomiendo dejar el enganche** (criterios 39, 72, 73, 75): el envío y las anulaciones ya llaman a un puerto de inventario dentro de su transacción con las partes de stock calculadas (combos, componentes y modificadores ligados, criterio 75, que sí es ruta crítica aquí), y el destino "vuelve o merma" queda guardado. La sección 6 implementa el descuento, la carga de porciones (HU-20), el bloqueo en cero y el agotado automático, con sus propias pruebas protegidas sobre el mismo envío. Motivos: el stock por unidades necesita ingresos de mercadería y ajustes, que son de la 6; meterlo aquí agranda una sección que ya hay que partir; y mientras tanto Cocina usa el agotado manual de 003. Consecuencia: hasta la sección 6, el comandero no muestra cuántos quedan (HU-11 se completa allá). La alternativa es sumar a 3a la carga de porciones del día, su descuento, el bloqueo en cero y el agotado automático (unos 12 criterios más), dejando las unidades para la 6.
3. **Venta en mostrador (HU-18, RF-34): ¿la pasamos a la sección 4?** **Recomiendo sí**: cobra primero, así que necesita caja y comprobante. Aquí queda el tipo de orden y el ruteo listos para reutilizar.
4. **Descuentos y cortesías (RF-33): ¿aquí o en la sección 4?** **Recomiendo la sección 4**: cambian montos (ruta crítica) y se cruzan con el IGV, el ICBPER, el tratamiento tributario de la cortesía ("lo define el contador") y la división de cuenta, que son de la 4. Aquí la pre-cuenta no los muestra todavía.
5. **¿Qué total muestra la pre-cuenta mientras no exista el cálculo de la sección 4?** **Recomiendo** la suma de los totales vigentes de los ítems (precios con IGV incluido), sin desglose de IGV, con la nota "Precios con IGV incluido. No es un comprobante de pago." y, si hay un producto con ICBPER (bolsa), "El ICBPER se suma al cobrar." (criterio 51). Cuando llegue la sección 4, la pre-cuenta mostrará descuentos e ICBPER.
6. **¿Se puede anular solo una parte de la cantidad de un ítem (2 de 3 ceviches)?** **Recomiendo sí**: se elige la cantidad (por defecto toda); el ítem queda con su cantidad vigente y la estación recibe la anulación de esa cantidad (criterios 35 y 38). Si no, para anular uno de tres habría que anular los tres y volver a comandar dos.
7. **Mesa abierta por error: ¿se puede liberar sin clave si todavía no se envió nada?** **Recomiendo sí**, con auditoría (criterio 44): no hubo producción ni consumo, como un ítem que se corrige antes de enviar. Si ya se envió algo (aunque esté anulado), se anula la orden con clave (RF-35).
8. **Mozo responsable (RF-24): ¿se puede elegir otro al abrir la mesa?** RF-24 dice "abrir una mesa con … el mozo responsable" y las reglas dicen "las ventas se atribuyen al mozo que la abrió". **Recomiendo**: por defecto quien abre; al abrir se puede elegir a otra persona que atienda mesas en la sucursal (por ejemplo, el cajero abre para un mozo); después no se cambia (criterio 10).
9. **Unir mesas que ya tienen cada una su cuenta: ¿se permite y a quién se atribuye la venta?** **Recomiendo** permitirlo: la cuenta de la mesa elegida primero (la principal) absorbe a las demás y toda la venta queda a nombre de su mozo; la auditoría guarda de quién era cada parte (criterio 47). Si se prefiere no mezclar mozos, la alternativa es permitir unir solo mesas libres a una ocupada.
10. **¿Anular un ítem después de la pre-cuenta también la invalida?** Las fuentes solo lo dicen de agregar ítems. **Recomiendo sí** (criterio 40): la pre-cuenta impresa ya no coincide con lo que se cobrará; la mesa vuelve a rojo y se imprime otra.
11. **La pantalla KDS y el cierre por inactividad.** Hoy una sesión con PIN se cierra tras 5 minutos sin uso (configurable de 1 a 120 por sucursal, para todos los roles), y el refresco automático no cuenta como uso. Una cocina tranquila vería su KDS bloquearse varias veces por turno. **Recomiendo** un tiempo de inactividad aparte para las sesiones con rol Cocina/Barra en la sucursal, configurable por el Administrador (por defecto 60 minutos, de 1 a 720), sin cambiar el de los demás roles ni el máximo de 12 horas. Cambia el criterio 39 de 002 (ruta crítica de permisos): se ajustan sus pruebas en la fase B. Alternativa: dejarlo como está y que el Administrador suba los minutos de toda la sucursal.
12. **Impresión básica (3b): ¿qué tipos de impresora?** **Recomiendo** impresoras de red (TCP 9100) de punta a punta, juego de caracteres incluido (sin él las tildes y la ñ salen mal), y Bluetooth y la gaveta solo en la configuración: Bluetooth funcionará cuando la app Android lo implemente (3c) y la gaveta se usa al cobrar (sección 4). HU-38 queda cubierta en la configuración; la impresión por Bluetooth se acepta en 3c.
13. **App puente Android (Kotlin): ¿en una entrega propia (3c)?** **Recomiendo sí**: usa otra cadena de herramientas (Gradle, SDK de Android), no se puede probar en este contenedor ni en CI sin emulador de Android, y necesita pruebas manuales con impresoras reales. 3b deja el protocolo, un simulador que lo implementa y un emulador de impresora, así 3c se valida contra lo mismo.

## Decisiones del especificador

Aprobadas por el usuario el 2026-10-29. No son reglas de negocio nuevas, sino cómo se concretan las de las fuentes.

- **El borrador vive en el celular.** Los ítems "por enviar" no viajan a la API: se editan sin clave en la PWA (que los guarda en el equipo para que sobrevivan a una recarga) y cada "Enviar" manda todo junto. Así "Enviar" es una sola operación idempotente y no hace falta una API para editar borradores.
- **Ids que genera la PWA** en orden, envío, marcha, anulación y pre-cuenta, además de `Idempotency-Key`: la clave de 002 está atada a la persona, y un envío que llegó justo antes de un cambio de usuario no debe salir dos veces a cocina. También deja preparado un modo offline futuro (UUID generados en el local).
- **Todo o nada al enviar:** si una línea no se puede vender, no sale ninguna; la PWA marca cuál y el mozo reenvía el resto. Evita comandas a medias.
- **Primer envío = comanda; los demás = adición** (Flujos de operación, punto 4).
- **Ruteo de combos y ligados** (criterio 74): un producto ligado a la misma estación que el plato no imprime una línea aparte; los modificadores sin ligado de un combo acompañan a sus componentes.
- **Estados de cocina por parte, no por ítem:** el burger del combo puede estar listo en Cocina y la cerveza pendiente en Barra.
- **Estación sin destino configurado = KDS:** nada se pierde si el Administrador todavía no configura impresoras (3b).
- **Mapa en cuadrícula** de 2 a 12 columnas por zona, una mesa por celda, con forma y capacidad: se dibuja igual en un celular de 360 px y en una tablet, y se edita con toques y botones, sin arrastrar (`DESIGN.md`).
- **Anular desde pre-cuenta:** "anular una orden abierta" incluye la orden en pre-cuenta (no está cobrada).
- **Aviso de "Listo"** al mozo responsable y a quien comandó el ítem.
- **Umbrales del KDS:** el tiempo transcurrido cambia a ají a los 10 minutos y a rocoto a los 20, fijos por ahora.
- **Un puente activo por sucursal;** vincular otro revoca el anterior.
- **Los tickets no impresos vencen con el día operativo** (criterio 117): al volver la impresora a la mañana siguiente no salen las comandas de la noche anterior. Los que salen con más de 2 minutos de retraso lo dicen arriba.
- **La nube arma los bytes ESC/POS;** el puente solo los manda a la impresora. Así el formato de los tickets se prueba en TypeScript y la app Android queda mínima.

## Cambios propuestos a los documentos compartidos

El orquestador los lleva a los documentos compartidos (paso 8 del flujo). Texto propuesto según las decisiones del 2026-10-29; las citas son de `fuentes.md` (requerimientos rev. 25, diseño rev. 21):

**Documento de requerimientos e historias de usuario**

- **RF-11** (decisión 11): "Cambiar rápido de usuario con PIN y cerrar la sesión por inactividad" pasa a "Cambiar rápido de usuario con PIN y cerrar la sesión por inactividad; las sesiones de Cocina/Barra tienen un tiempo aparte, de 60 minutos por defecto y configurable de 1 a 720 por sucursal, para que la pantalla de cocina no se bloquee en los ratos tranquilos".
- **RNF-08** (decisión 11; texto vigente desde 002): al final, "…horario de acceso opcional por trabajador; cierre de sesión por inactividad" pasa a "…horario de acceso opcional por trabajador; cierre de sesión por inactividad, con un tiempo aparte y más largo para Cocina/Barra".
- **RF-24** (decisión 8): "Abrir una mesa con el número de comensales y el mozo responsable (por defecto, quien la abre; al abrir se puede elegir a otra persona que atienda mesas, y después no se cambia)".
- **RF-29 y HU-15** (decisión 6): "…anular los enviados, en todo o en parte de su cantidad (por defecto, toda), con clave, motivo y destino del stock, con un ticket de anulación en la estación".
- **RF-32** (decisiones 5 y 10): "Imprimir la pre-cuenta, con la suma de los totales con IGV incluido, sin desglose, y la nota «No es un comprobante» (y «El ICBPER se suma al cobrar» si corresponde); si luego se agregan o anulan ítems, invalidarla y devolver la mesa a ocupada".
- **RF-35** (decisión 7): "Anular una orden abierta con clave de supervisor; una mesa abierta sin nada enviado se libera sin clave, con registro en la auditoría".
- **RF-37** (decisión del especificador aprobada): "…con aviso en la app al mozo responsable de la mesa y a quien comandó el ítem".
- **RF-76** (decisión 12): anotar "La impresión por Bluetooth llega con la app puente (entrega 3c); la gaveta se usa al cobrar (Caja)".
- **RF-77** (decisión del especificador aprobada): agregar "Los trabajos que no se imprimieron vencen al terminar el día operativo de la sucursal".
- **HU-11** (decisión 2): anotar que "ver cuántos quedan" se cumple cuando exista el inventario (descuento de stock con la sección de inventario).

**Documento de diseño**

- **"Alcance"** (decisiones 1, 3, 4, 12 y 13): sin cambiar el alcance del MVP, anotar que la venta en mostrador y los descuentos y cortesías se construyen con la caja, y que "Cocina y barra: impresión con el puente Android y pantalla KDS" se entrega en tres partes: 3a Salón y Cocina con KDS, 3b impresión en la nube (impresoras de red de punta a punta, con simulador del puente) y 3c app Android del puente (Kotlin), que también trae Bluetooth.
- **"Flujos de operación · Atención en mesa"**, paso 5 (decisión 10): "Si piden algo más, vuelve a rojo…" pasa a "Si piden algo más o se anula algo, vuelve a rojo y se imprime una pre-cuenta nueva".
- **"Reglas de negocio · Salón y pedidos"** (decisiones 9 y 10): "Agregar ítems después de la pre-cuenta la invalida, y la mesa vuelve a ocupada" pasa a "Agregar o anular ítems después de la pre-cuenta la invalida, y la mesa vuelve a ocupada"; y agregar "Al unir mesas con cuentas abiertas, la cuenta de la mesa principal absorbe a las demás y la venta se atribuye a su mozo".
- **"Estados" (diagrama de la mesa)** (decisión 10): "De En pre-cuenta a Ocupada: (adición)" pasa a "(adición o anulación)".
- **"Reglas de negocio · Seguridad"** (decisión 11; texto de RNF-08 desde 002): el mismo cambio que RNF-08.
