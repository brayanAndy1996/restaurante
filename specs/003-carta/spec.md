# 003 · Carta

- **Historias y requerimientos:** HU-05, HU-06, HU-07, HU-08, HU-09; RF-14 a RF-20 (RF-19 solo en lo que toca a definir las estaciones; su asociación a una impresora o a un KDS va en la sección 3). RF-21 (importar desde Excel) queda para después (decisión 3). RF-13 en lo que toca a los cambios de configuración de la carta. RNF que aplican: RNF-03, RNF-06, RNF-09, RNF-10, RNF-11, RNF-13, RNF-14, RNF-17, RNF-18, RNF-20. Fuente de negocio: `fuentes.md` de esta carpeta (extracto de los documentos compartidos, rev. 18 y 17), "Decisiones del usuario" (que mandan sobre `fuentes.md` donde lo cambian: el Cajero edita la carta y el tipo de producto se puede cambiar) y, para el contexto general, `specs/002-plataforma-y-acceso/fuentes.md`.
- **Ruta crítica:** sí, en parte (decidida por el orquestador el 2026-10-28: P1 montos, P2 permisos y auditoría con el Cajero, P3 aislamiento; el resto no es crítico). Ver "Clasificación de ruta crítica".
- **Estado:** aprobada (2026-10-28)

## Objetivo

Que el Administrador arme la carta de su empresa (estaciones, familias, productos con foto, precio con IGV, afectación tributaria, estación y tipo de control de stock, grupos de modificadores, combos y menú del día) y la ajuste por sucursal (precio y disponibilidad); que el Cajero haga lo mismo con toda la carta salvo las estaciones, y ajuste el precio y la disponibilidad solo en las sucursales donde es Cajero (decisión 5); y que Cocina/Barra, el Supervisor o el Administrador marquen un plato como agotado (86) en su sucursal para que nadie lo venda. La sección deja además los contratos que van a consumir el comandero (sección 3), el inventario (sección 6) y la carta web (sección 5): la vista de la carta de cada sucursal con precios efectivos y disponibilidad, el armado de una línea de venta con sus modificadores y componentes, y los avisos de cambios.

## Límites con otras secciones

| Tema | Entra aquí | Queda para | Lo que esta sección deja listo |
| --- | --- | --- | --- |
| Estaciones (RF-19) | Definirlas por empresa (nombre, activa; solo el Administrador) y asignarlas a cada producto (Administrador o Cajero) | Sección 3: asociar cada estación, en cada sucursal, a una impresora o a un KDS, y el ruteo de la comanda | `estacionId` en cada producto, en cada componente y en cada producto ligado de la línea preparada (criterio 52) |
| Stock (RF-67 a RF-74) | El tipo de control de stock de cada producto (`UNIDADES`, `PORCIONES`, `SIN_CONTROL`) y el agotado manual (RF-20) | Sección 6: llevar y descontar stock, cargar porciones, bloquear la venta en cero, el agotado automático (RF-70), el cierre del día con sobrantes, kardex y stock mínimo | `tipoControlStock` en la línea preparada; `CartaDisponibilidadService.marcarAgotado` con origen `SIN_STOCK` para el agotado automático (criterio 53); columna `origen` del agotado |
| Comandero | Nada de la pantalla del mozo | Sección 3: elegir productos, modificadores y opciones, enviar la comanda y guardar la venta como era | `GET /carta/sucursal` (criterio 47) y `CartaVentaService.prepararLinea` (criterio 52), que valida la selección y calcula el precio con `packages/dominio` |
| Carta web (RF-40 a RF-42) | Nada público | Sección 5: la ruta pública por empresa y sucursal, ocultar lo agotado o no disponible (RF-41) y el pedido del cliente | `CartaVentaService.cartaDeSucursal` (la misma vista de `GET /carta/sucursal`, con `vendible` y `seVendeSolo` para filtrar), `fotoUrl` pública y el evento `carta.disponibilidad` |
| Tiempo real | El contrato de los eventos y un puerto para publicarlos después de confirmar; la PWA refresca la vista con `ETag` (decisión 2) | Sección 3: Socket.IO con el adaptador de PostgreSQL, autenticación del socket y salas | `PublicadorEventos` en `apps/api/src/nucleo/eventos/` y los eventos `carta.disponibilidad` y `carta.actualizada` (criterios 46 y 54) |
| Importar desde Excel (RF-21) | No (decisión 3) | Una sección corta antes del primer cliente, como herramienta de nuestro equipo | Los servicios de la carta, que la importación reutilizará |
| Montos | Precio con IGV del producto, precio por sucursal, precio extra del modificador (que es también el recargo de una opción de combo o del menú) y el precio de una línea con sus modificadores, en `packages/dominio` con `decimal.js` | Sección 4: base imponible, IGV por línea, ICBPER, descuentos, cortesías, redondeos y división de cuenta, con la tasa vigente del emisor | `afectacionIgv` y `aplicaIcbper` en cada producto y en la línea preparada |

## Clasificación de ruta crítica

Decidida por el orquestador el 2026-10-28 (paso 3), con la propuesta del especificador: P1 montos, P2 permisos y auditoría (ahora con el Cajero) y P3 aislamiento son críticos; el resto no. `CLAUDE.md` deja fuera de la ruta crítica el "mantenimiento simple de carta", y dentro el aislamiento entre empresas, el cálculo de montos y los permisos con su auditoría.

| Parte | Crítica | Motivo |
| --- | --- | --- |
| P1 · Reglas puras de montos de `packages/dominio`: precio efectivo por sucursal, validación de la selección de modificadores (mínimos, máximos, única o múltiple) y precio de una línea con sus modificadores y opciones (criterios 55 a 58) | sí | Cálculo de montos: es el precio que cobrará el comandero y que llegará al comprobante. |
| P2 · Quién edita la carta y los precios (Administrador y Cajero), quién define las estaciones, en qué sucursales cambia el Cajero el precio y la disponibilidad, quién marca agotados y arma el menú del día, y la auditoría con el autor de cada cambio de precio (criterios 19b, 60, 61, 61b y 62; también 42 y 43) | sí | Permisos y auditoría: un precio cambiado por quien no debe, en una sucursal ajena, o sin rastro, es dinero. |
| P3 · Aislamiento de las tablas nuevas y de las referencias entre empresas, incluidas las fotos y los eventos (criterios 64 a 69) | sí | Aislamiento entre empresas (RLS). |
| Trazabilidad de las tablas nuevas (criterio 63) | sí, ya cubierta | La prueba de catálogo del criterio 113 de 002 recorre `pg_catalog` y falla si una tabla nueva no la cumple; no hace falta una prueba protegida nueva. |
| CRUD de estaciones, familias, productos (incluido el cambio de tipo, criterios 10b a 10d), grupos, combos, menú del día, fotos y ajustes (criterios 1 a 38, salvo lo citado arriba) | no | Mantenimiento simple de carta. Pruebas de integración del desarrollador. Lo crítico del cambio de tipo (que un combo nunca contenga otro, para el ruteo y el descuento de stock) lo vuelve a comprobar la sección 3 en "Enviar comanda". |
| Agotado, vista de la sucursal, `prepararLinea`, eventos y disponibilidad (criterios 39 a 54, 59) | no | No está en la lista. Lo que sí es crítico de ellos (que un agotado no se pueda comandar, el descuento de stock de combos y modificadores) lo prueba la sección 3 en "Enviar comanda" (ver "Notas para otras secciones"). |
| Interfaz de la PWA (criterios 70 a 80) | no | Interfaz; la seguridad y los montos los impone la API con `packages/dominio`. |

## Glosario

- **Estación de producción:** lugar que prepara un producto (Cocina, Barra, Parrilla). Se define por empresa. En la sección 3, cada sucursal la asocia a una impresora o a un KDS.
- **Familia:** grupo de la carta (Entradas, Fondos, Bebidas). Cada producto pertenece a una sola (decisión 9). Tienen un orden manual, el mismo en todas las sucursales.
- **Producto:** lo que se vende o se prepara. Tipos: `SIMPLE`, `COMBO` y `MENU_DEL_DIA`. El tipo se elige al crearlo y se puede cambiar después (decisión del usuario; criterios 10b a 10d).
- **Se vende solo:** marca de un producto simple que aparece como ítem en el comandero y la carta web. Uno que no se vende solo (por ejemplo, el "Ají de gallina" que solo sale en el menú) no tiene precio y solo se usa como componente o producto ligado (decisión 12).
- **Precio:** precio de venta con IGV, en soles, con 2 decimales, de la empresa. **Precio de la sucursal:** el que lo reemplaza en una sucursal, si lo fijó el Administrador o un Cajero de esa sucursal. **Precio efectivo:** el de la sucursal si existe; si no, el de la empresa.
- **Disponible en la sucursal:** el Administrador, o un Cajero de esa sucursal, decide si un producto se ofrece en ella (RF-15). Es configuración y no vence.
- **Cajero de una sucursal:** usuario con el rol `CAJERO` en el acceso a esa sucursal (002). Una persona puede ser Cajero en S1 y Mozo en S2.
- **Agotado (86):** marca temporal en una sucursal, que pone Cocina/Barra, el Supervisor o el Administrador (RF-20). Dura hasta el fin del día operativo o hasta que alguien lo reactive (decisión 4). En la sección 6 también lo pondrá el sistema al llegar a cero porciones.
- **Grupo de modificadores:** conjunto de opciones que se eligen para un producto ("Término de la carne", "Bebida del combo"), con selección única o múltiple, mínimo y máximo; es obligatorio cuando el mínimo es 1 o más. Se define una vez y se asigna a varios productos (decisión 6).
- **Modificador:** una opción de un grupo ("3/4", "Inca Kola"), con precio extra opcional (0 o más) y, opcional, un **producto ligado**: el producto que se prepara en su estación y cuyo stock se descuenta al elegirlo.
- **Combo:** producto con precio fijo, **componentes** fijos (productos simples con cantidad) y **opciones**: las opciones de un combo son grupos de modificadores asignados al combo, cuyos modificadores suelen estar ligados a productos; su precio extra es el monto que "suma" la opción (HU-08). Así lo prevé el modelo de datos del documento de diseño, que no tiene una entidad aparte para las opciones.
- **Menú del día:** combo (tipo `MENU_DEL_DIA`) cuyos grupos son los tiempos (Entrada, Segundo) y cuyos modificadores son los platos candidatos, con su recargo. Cada día, en cada sucursal, se eligen cuáles de los candidatos se ofrecen: las **opciones del día** (decisión 5).
- **Día operativo:** la fecha de negocio de una sucursal según su hora de corte (`diaOperativo(instante, horaCorte)` de 001).
- **Vendible:** que un producto se puede comandar ahora en la sucursal: activo, disponible, no agotado, con sus componentes disponibles y con suficientes opciones disponibles en cada grupo obligatorio. Si no, lleva un **motivo**.
- **Vista de la sucursal:** la carta de una sucursal tal como la ven los que venden y Cocina: `GET /carta/sucursal`.
- **Línea preparada:** lo que devuelve `prepararLinea` para un producto, su selección y su cantidad: precios calculados y todo lo que la venta debe guardar como era (sección 3).

## Criterios de aceptación

Salvo que se diga otra cosa: hay dos empresas, **A** y **B**, dadas de alta por la vía de plataforma, cada una con al menos dos sucursales (S1 y S2 en A, y S3 donde se indica) y usuarios de cada rol (historia 002); "el Administrador" significa una sesión de un Administrador de A; "el Cajero" significa una sesión de un usuario de A con rol `CAJERO` en S1 y `MOZO` en S2, con S1 como sucursal activa; las horas se controlan con el reloj de la API y son de Lima; toda respuesta de error tiene la forma `{ codigo, mensaje, campos? }` (más `usadoEn` o `seQuita` donde se indica, criterios 10b y 10c) y nunca incluye detalles de PostgreSQL; los montos viajan como texto decimal con 2 decimales (`"28.00"`) y se guardan en `NUMERIC(10,2)`. Las rutas de administración de la carta usan `@Permiso('EDITAR_CARTA')` (Cajero y Administrador), salvo las escrituras de estaciones, que usan `@Permiso('ADMINISTRAR')` (solo Administrador) (criterio 60), y aceptan `Idempotency-Key` en los `POST` (criterio 85 de 002); un campo desconocido en una entrada responde 400 `DATOS_INVALIDOS`, y ninguna entrada acepta `empresaId`, `creadoPor*` ni `actualizadoPor*`.

### Estaciones (RF-19)

1. **Crear.** `POST /carta/estaciones` con `{ nombre }` responde 201 `estacionRespuesta` `{ id, nombre, activa, productosActivos, creadoEn, actualizadoEn }`. El nombre es un texto de 1 a 50 caracteres (`textoSchema`), único en la empresa sin distinguir mayúsculas: repetido responde 409 `CONFLICTO`; el mismo nombre en B no choca.
2. **Consultar y editar.** `GET /carta/estaciones` devuelve las estaciones de la empresa ordenadas por nombre, con `productosActivos` (cuántos productos activos la usan). `PATCH /carta/estaciones/:id` con `{ nombre?, activa? }` (al menos uno) responde 200. Desactivar una estación que usan productos activos responde 409 `EN_USO` con la cantidad en el mensaje y nada cambia. Una estación inactiva no se puede asignar (criterio 9). No se borran.
2b. **Quién define las estaciones** (decisión 5). `POST` y `PATCH /carta/estaciones…` las usa solo el Administrador (`@Permiso('ADMINISTRAR')`); el Cajero recibe 403 `PROHIBIDO` y nada cambia. `GET /carta/estaciones` usa `@Permiso('EDITAR_CARTA')`: el Cajero las lee para asignarlas a los productos que crea o edita.

### Familias (RF-14)

3. **Crear.** `POST /carta/familias` con `{ nombre }` (1 a 60, único en la empresa sin distinguir mayúsculas; 409 `CONFLICTO`) responde 201 `familiaRespuesta` `{ id, nombre, orden, activa, productos, creadoEn, actualizadoEn }`; queda la última del orden.
4. **Consultar y editar.** `GET /carta/familias` las devuelve en su orden, con `productos` (cuántos productos activos tiene). `PATCH /carta/familias/:id` con `{ nombre?, activa? }`. Desactivar una familia con productos activos responde 409 `EN_USO`. No se borran.
5. **Ordenar.** `PUT /carta/familias/orden` con `{ ids }` responde 200 con la lista en el orden nuevo. `ids` debe contener exactamente una vez cada familia de la empresa (activas e inactivas); con un id faltante, repetido, inexistente o de B responde 400 `DATOS_INVALIDOS` con el mismo cuerpo y nada cambia (decisión 9).

### Productos (HU-05, RF-14)

6. **Crear.** `POST /carta/productos` con `productoCrearEntrada` responde 201 `productoRespuesta`:
   `{ tipo, nombre, descripcion?, familiaId, precio?, seVendeSolo?, afectacionIgv?, aplicaIcbper?, estacionId?, tipoControlStock, gruposModificadores?, componentes?, noDisponibleEn? }`.
   - `tipo`: `SIMPLE`, `COMBO` o `MENU_DEL_DIA`.
   - `nombre`: 1 a 100, único en la empresa sin distinguir mayúsculas (409 `CONFLICTO`); `descripcion`: 1 a 500 o `null`.
   - `precio`: monto mayor que 0 (`montoSchema`), con IGV incluido.
   - `seVendeSolo`: por defecto `true`.
   - `afectacionIgv`: `GRAVADO` (por defecto), `EXONERADO` o `INAFECTO`; `aplicaIcbper`: por defecto `false` (decisión 10).
   - `estacionId`: la estación que lo prepara, o `null` si no va a ninguna (decisión 11).
   - `tipoControlStock`: `UNIDADES`, `PORCIONES` o `SIN_CONTROL`, obligatorio y sin valor por defecto, para que quien crea el producto lo elija (HU-05).
   - `gruposModificadores`: ids de grupos, en el orden en que se muestran (máximo 10).
   - `componentes`: `[{ productoId, cantidad }]` (cantidad entera de 1 a 99, máximo 20 componentes).
   - `noDisponibleEn`: ids de sucursales donde el producto nace no disponible (criterio 23). El Cajero solo puede incluir sucursales donde es Cajero (criterio 19b).
   Queda el último de su familia.
7. **Reglas por tipo** (400 `DATOS_INVALIDOS` con `campos` si no se cumplen):
   - `SIMPLE`: `estacionId` presente (id o `null`); `componentes` no se envía o va vacío; si `seVendeSolo` es `true`, `precio` es obligatorio; si es `false`, `precio` debe ser `null` o no enviarse.
   - `COMBO`: `seVendeSolo` es `true`; `precio` obligatorio; `estacionId` `null` o sin enviar (cada componente y cada producto ligado va a su propia estación); al menos un componente o un grupo.
   - `MENU_DEL_DIA`: como `COMBO`, con al menos un grupo.
   - `tipoControlStock` vale para los tres tipos (el menú del día puede llevar porciones, como dice la tabla de inventario del diseño); su uso es de la sección 6.
8. **Repeticiones.** Un grupo o un componente repetido en la misma entrada responde 400 `DATOS_INVALIDOS`.
9. **Referencias.** `familiaId`, `estacionId`, cada grupo, cada `productoId` de componente y cada sucursal de `noDisponibleEn` deben existir en la empresa y estar activos; si no (inexistente, de B o inactivo), responde 422 `REFERENCIA_INVALIDA` con `campos` señalando el campo, con el mismo cuerpo para un id de B y uno inexistente, y nada se crea. Un componente debe ser un producto `SIMPLE` (un combo no contiene combos ni menús, decisión 7): si no, 422 `REFERENCIA_INVALIDA`.
10. **Editar.** `PATCH /carta/productos/:id` con `productoModificarEntrada` (todos los campos del criterio 6 salvo `noDisponibleEn`, más `activo` y `confirmarPerdida`; al menos uno distinto de `confirmarPerdida`) responde 200. Las listas enviadas (`gruposModificadores`, `componentes`) reemplazan a las anteriores completas. Se validan los criterios 7 a 9 sobre el resultado de mezclar lo guardado con lo enviado. Un `PATCH` que no cambia nada responde 200 sin fila de auditoría. Un `tipo` igual al guardado no es un cambio de tipo. Orden de los rechazos: 400 de forma, 404, 422 `REFERENCIA_INVALIDA`, 400 de las reglas del criterio 7, 409 `EN_USO` (criterio 10c), 409 `CONFLICTO` (criterio 10d) y, al final, 409 `CONFIRMACION_REQUERIDA` (criterio 10b).
10b. **Cambiar el tipo** (decisión del usuario). Con un `tipo` distinto del guardado:
   - **Se conserva:** nombre, descripción, familia, foto, precio, afectación, ICBPER, tipo de control de stock, grupos asignados (los tres tipos los admiten), precios y disponibilidad por sucursal, agotados, orden y lo que lo usa.
   - **Deja de aplicar y se quita:**
     - `SIMPLE` → `COMBO` o `MENU_DEL_DIA`: la estación (`estacionId` pasa a `null`; enviar otro valor responde 400). `seVendeSolo` pasa a `true`; si el producto no tenía precio, `precio` es obligatorio en el mismo `PATCH` (si no, 400).
     - `COMBO` o `MENU_DEL_DIA` → `SIMPLE`: los componentes. `estacionId` es obligatorio en el mismo `PATCH` (un id o `null`, para que nadie quede sin estación por omisión; si falta, 400).
     - `MENU_DEL_DIA` → `COMBO` o `SIMPLE`: las opciones del día armadas en todas las sucursales.
     - `COMBO` → `MENU_DEL_DIA`: nada. El menú nace sin opciones del día, así que no es vendible (`MENU_SIN_ARMAR`, criterio 59) hasta que lo armen en cada sucursal.
   - **Confirmación.** Si algo se quita y el `PATCH` no trae `confirmarPerdida: true`, responde 409 `CONFIRMACION_REQUERIDA` con `seQuita` `{ estacion: { id, nombre } | null, componentes: [{ productoId, nombre, cantidad }], opcionesDelDia: [{ sucursalId, sucursalNombre, dia, opciones }] }` y nada cambia. En `opcionesDelDia` van, por sucursal y día, la cantidad de opciones armadas para el día operativo actual de esa sucursal o uno posterior; las de días anteriores también se borran y no se listan. Con `confirmarPerdida: true` el cambio se aplica, lo que se quita se borra (no se conserva desactivado) y la fila de auditoría `modificar_producto` lleva `tipo` antes y después y, en `quitado`, exactamente lo que se borró. Si no se quita nada, no hace falta confirmar y `confirmarPerdida` se ignora.
   - **Ejemplos.** "Combo hamburguesa" (criterio 30) a `SIMPLE` con `estacionId` de Cocina: sin confirmación, 409 con `seQuita.componentes` = `[{ Hamburguesa clásica, 1 }]`; con confirmación, 200: simple en Cocina, sin componentes, con los grupos Bebida y Acompañamiento. "Lomo saltado" (simple en Cocina, criterio 57) a `COMBO` con `componentes` `[{ Papas del combo, 1 }]`: 409 con `seQuita.estacion` = Cocina; con confirmación, 200: combo sin estación, con sus grupos y el componente. Un menú del día armado hoy en S1 y mañana en S2 a `COMBO`: 409 con las dos filas de `opcionesDelDia`.
   - **Ventas.** El cambio no altera las ventas ya hechas: guardan su línea preparada (criterio 52; sección 3). Desde la siguiente lectura, la vista y `prepararLinea` usan el tipo nuevo.
10c. **Tipo de un producto que se usa en otro** (decisión del usuario). Un producto que es componente de algún combo o menú (activo o no) o producto ligado de algún modificador activo (de un grupo activo o no) no puede pasar a `COMBO` ni a `MENU_DEL_DIA`, porque un combo no contiene combos (criterio 32): responde 409 `EN_USO` con `usadoEn` `{ combos: [{ id, nombre }], modificadores: [{ id, nombre, grupoId, grupoNombre }] }` (como en el criterio 12) y un mensaje que dice dónde se usa ("Se usa en: Combo hamburguesa; Bebida del combo › Inca Kola. Quítalo de ahí antes de convertirlo en combo"), y nada cambia, con o sin `confirmarPerdida`. Los modificadores inactivos no cuentan: si uno se reactiva y su producto ligado ya no es `SIMPLE`, la reactivación responde 422 (criterios 26 y 27).
10d. **Dejar de venderse solo.** Un `PATCH` que deja el producto con `seVendeSolo: false` (un simple que deja de venderse solo, o un combo que pasa a simple sin venderse solo) mientras tiene precio propio en alguna sucursal responde 409 `CONFLICTO` con `campos` en `seVendeSolo` y las sucursales en el mensaje, y nada cambia: primero se quitan esos precios con el criterio 19, con el permiso de cada sucursal (criterio 19b). Así un producto que no se vende solo nunca tiene precio de sucursal (criterio 19).
11. **Desactivar.** `PATCH { activo: false }` saca al producto de la vista de toda sucursal (criterio 48) y no deja asignarlo como componente ni como producto ligado (422); las referencias que ya tenía se conservan, y los combos que lo contienen dejan de ser vendibles con motivo `COMPONENTE_NO_DISPONIBLE` (criterio 59). Reactivarlo los devuelve. Los productos no se borran (las ventas de la sección 3 los referencian).
12. **Consultar.** `GET /carta/productos` devuelve `productoResumen[]` (`id`, `tipo`, `nombre`, `familiaId`, `precio`, `seVendeSolo`, `estacionId`, `tipoControlStock`, `fotoUrl`, `activo`, `orden`) de toda la empresa, ordenados por el orden de su familia y luego por el suyo. `GET /carta/productos/:id` devuelve `productoRespuesta`: todos los campos, los grupos asignados (`{ id, nombre }` en orden), los componentes (`{ productoId, nombre, cantidad }`) y `usadoEn` (`{ combos: [{ id, nombre }], modificadores: [{ id, nombre, grupoId, grupoNombre }] }`). Un id de B responde 404 `NO_ENCONTRADO` igual que uno inexistente.
13. **Ordenar productos.** `PUT /carta/familias/:id/productos/orden` con `{ ids }`, que debe contener exactamente una vez cada producto de esa familia, responde 200 con la lista ordenada; si no, 400 como el criterio 5. Un producto que cambia de familia queda el último de la nueva.

### Fotos de productos (RF-14)

Los límites son los de la decisión 1.

14. **Subir.** `PUT /carta/productos/:id/foto` con el archivo como cuerpo binario y `Content-Type` `image/jpeg`, `image/png` o `image/webp`, de hasta 1 MB (1 048 576 bytes), responde 200 `{ fotoUrl }`. La API comprueba el formato por el contenido (los primeros bytes), no solo por la cabecera, y lee el ancho y el alto: un archivo que no es una imagen de ese formato, o con algún lado menor de 200 o mayor de 2048 píxeles, responde 422 `FOTO_INVALIDA`; más de 1 MB, 413 `CUERPO_DEMASIADO_GRANDE`; otro `Content-Type`, 415 `TIPO_NO_SOPORTADO`. En ningún caso se guarda nada.
15. **Dónde se guarda.** La foto se guarda con el almacén de archivos (`AlmacenArchivos`, plan) bajo la clave `carta/<empresaId>/<productoId>/<uuid>.<ext>`, que arma la API con la empresa del contexto y un UUID nuevo (nunca con datos del cuerpo ni del nombre del archivo). `fotoUrl` es la URL pública de esa clave. Reemplazar la foto crea una clave nueva; la anterior se borra del almacén después de confirmar la transacción. Si la transacción no se confirma, el producto conserva su foto anterior y la anterior no se borra.
16. **Quitar.** `DELETE /carta/productos/:id/foto` responde 204 y borra el archivo después de confirmar; sin foto, 204 sin otro efecto ni auditoría.
17. **Otra empresa.** `PUT` o `DELETE` de la foto de un producto de B responde 404 igual que uno inexistente, y nada se guarda ni se borra en el almacén.

### Ajuste por sucursal (HU-06, RF-15)

18. **Consultar.** `GET /carta/productos/:id/sucursales` devuelve, para cada sucursal de la empresa (ordenadas por nombre), `{ sucursalId, nombre, precio, precioEfectivo, disponible, agotado, editable }`, donde `precio` es el de la sucursal o `null`, `agotado` dice si hay un agotado vigente (criterio 44) y `editable` dice si quien consulta puede ajustar esa sucursal (criterio 19b). El Cajero ve todas las sucursales de la empresa, con `editable: false` en las que no es Cajero.
19. **Ajustar.** `PUT /carta/productos/:id/sucursales/:sucursalId` con `{ precio, disponible }` (`precio`: monto mayor que 0 o `null` para usar el de la empresa) responde 200 con la fila del criterio 18. En un producto que no se vende solo, `precio` debe ser `null` (400). Repetir el mismo ajuste responde 200 sin auditoría nueva.
19b. **Quién ajusta cada sucursal** (decisión 5, ruta crítica). El precio y la disponibilidad de una sucursal van juntos (misma ruta, misma fila y misma auditoría `ajustar_producto_sucursal`) y los ajusta quien tiene `EDITAR_CARTA` como `permitido` con su rol **en la sucursal ajustada**, no en la activa: el Administrador (y el soporte), en todas; el Cajero, solo en las sucursales donde es Cajero. El rol en la sucursal ajustada se lee en cada petición (si el Administrador le quita el rol, la siguiente ya responde 403).
   - Dado el Cajero (Cajero en S1, Mozo en S2, S1 activa), cuando ajusta S1, entonces responde 200, cambia S1 y queda la auditoría con él como autor.
   - Cuando ajusta S2 (precio, disponibilidad o ambos), entonces responde 403 `PROHIBIDO` ("Solo puedes cambiar el precio y la disponibilidad en las sucursales donde eres Cajero"), S2 no cambia, no queda auditoría y no se publica evento. Igual con una tercera sucursal S3 de A donde no tiene acceso.
   - Una sucursal de B o inexistente responde 404 `NO_ENCONTRADO` (criterio 22), antes de mirar el rol, para que su cuerpo no se distinga del de un id inexistente.
   - Al crear un producto (criterio 6), el Cajero solo puede poner en `noDisponibleEn` sucursales donde es Cajero; con otra sucursal de A responde 403 `PROHIBIDO` y nada se crea (una de B o inexistente sigue siendo 422, criterio 9). El producto nuevo nace disponible, con el precio de la empresa, en todas las demás, también donde el Cajero no lo es (es la carta de la empresa).
   - Un usuario Cajero en S1 y S2 con S1 activa ajusta S1 y S2. Un Supervisor de S2 que es Cajero en S1, con S1 activa, ajusta S1 y no S2 (el Supervisor no edita la carta). Con S2 activa (Mozo o Supervisor), toda ruta con `EDITAR_CARTA` le responde 403 (criterio 61).
20. **Solo esa sucursal** (HU-06). Dado un producto con precio `"25.00"`, cuando el Administrador fija `"27.50"` y `disponible: false` en S1, entonces en S1 el precio efectivo es `"27.50"` y el producto no aparece en la vista de S1, y en S2 el precio efectivo sigue `"25.00"` y el producto sigue disponible.
21. **Cambio del precio de la empresa.** Dado ese estado, cuando el precio del producto pasa a `"26.00"`, entonces el precio efectivo de S2 pasa a `"26.00"` y el de S1 sigue `"27.50"`. Con `precio: null` en S1, el de S1 vuelve a ser el de la empresa.
22. **Sucursal de otra empresa.** Una `sucursalId` de B o inexistente responde 404 `NO_ENCONTRADO` con el mismo cuerpo, y nada cambia.
23. **Valores por defecto.** Un producto nuevo está disponible en todas las sucursales con el precio de la empresa, salvo en las de `noDisponibleEn`. Una sucursal nueva ofrece todos los productos activos con el precio de la empresa. Sin ajuste guardado, valen esos valores (no hace falta una fila por sucursal).

### Modificadores (HU-07, RF-16)

24. **Crear un grupo.** `POST /carta/grupos-modificadores` con `grupoEntrada` responde 201 `grupoRespuesta`:
    - `{ nombre, seleccion: 'UNICA', obligatorio, modificadores }`, o
    - `{ nombre, seleccion: 'MULTIPLE', minimo, maximo, modificadores }`.
    `nombre`: 1 a 60, único en la empresa sin distinguir mayúsculas (409). `modificadores`: de 1 a 50 elementos `{ id?, nombre, precioExtra?, productoId? }`, con `nombre` de 1 a 60, único dentro del grupo sin distinguir mayúsculas; `precioExtra` es un monto de 0 o más (`"0.00"` por defecto, sin negativos, decisión 8); `productoId` es el producto ligado, o `null`. La respuesta es `{ id, nombre, seleccion, minimo, maximo, obligatorio, activo, modificadores: [{ id, nombre, precioExtra, producto: { id, nombre } | null, orden }], productos: [{ id, nombre }] }`, con los modificadores activos en su orden y los productos que usan el grupo.
25. **Mínimo, máximo y obligatorio** (RF-16). Con `UNICA`: `maximo` = 1 y `minimo` = 1 si `obligatorio`, 0 si no. Con `MULTIPLE`: `minimo` y `maximo` enteros con 0 ≤ `minimo` ≤ `maximo`, 1 ≤ `maximo` ≤ 50, y `minimo` no mayor que la cantidad de modificadores. En la respuesta, `obligatorio` = `minimo` ≥ 1. Si no se cumple: 400 `DATOS_INVALIDOS` con `campos`.
26. **Producto ligado** (HU-07). `productoId` debe ser un producto `SIMPLE` activo de la empresa; si no (inexistente, de B, inactivo, combo o menú), 422 `REFERENCIA_INVALIDA`. Es el producto que va a su estación y cuyo stock se descuenta cuando se elige el modificador (secciones 3 y 6, criterio 52).
27. **Editar un grupo.** `PATCH /carta/grupos-modificadores/:id` con los mismos campos (al menos uno; `seleccion` con sus campos). Si trae `modificadores`, la lista es la nueva lista completa y su orden: un elemento con `id` actualiza ese modificador (debe ser de este grupo; si no, 422 `REFERENCIA_INVALIDA`), uno sin `id` crea uno nuevo, y los que no aparecen pasan a inactivos (no se borran: las ventas y el menú del día los referencian). Se validan los criterios 24 a 26 sobre el resultado, también para un modificador inactivo que vuelve a la lista (se reactiva) o un grupo que se reactiva: su producto ligado debe seguir siendo `SIMPLE` y activo (criterio 10c).
28. **Reutilizables** (decisión 6). Un grupo se asigna a varios productos (criterio 6, `gruposModificadores`); un cambio en el grupo vale para todos ellos desde la siguiente lectura.
29. **Desactivar.** `PATCH { activo: false }` en un grupo asignado a productos activos responde 409 `EN_USO`; sin productos activos, lo desactiva. Un grupo inactivo no se puede asignar (422). `GET /carta/grupos-modificadores` lista los grupos (ordenados por nombre) y `GET /carta/grupos-modificadores/:id` devuelve uno; de B, 404.

### Combos y menú del día (HU-08, RF-17, RF-18)

30. **Combo** (HU-08). Un producto `COMBO` tiene precio fijo (ajustable por sucursal como cualquier producto), componentes fijos con su cantidad y grupos de opciones; el precio extra de una opción es el monto que suma. Ejemplo de referencia (el mismo del criterio 57): "Combo hamburguesa", `"22.90"`, componente "Hamburguesa clásica" × 1, grupo "Bebida" (única, obligatoria: Chicha `"0.00"`, Inca Kola `"0.00"`, Cerveza `"4.50"`) y grupo "Acompañamiento" (única, obligatoria: Papas `"0.00"`, Ensalada `"1.00"`).
31. **Cada componente a su estación** (HU-08). La línea preparada de un combo (criterio 52) trae cada componente y cada producto ligado de las opciones elegidas con su propia `estacionId` y su `tipoControlStock`; el combo no tiene estación propia.
32. **Sin anidar** (decisión 7). Un componente o un producto ligado nunca es un `COMBO` ni un `MENU_DEL_DIA` (criterios 9 y 26), y un producto que se usa así no puede cambiar a esos tipos (criterio 10c), así que un combo no contiene otro combo ni se forma un ciclo.
33. **Menú del día: configuración** (RF-18, decisión 5). Un producto `MENU_DEL_DIA` lo configura el Administrador o el Cajero (`EDITAR_CARTA`), para toda la empresa, como un combo: precio, componentes fijos si los tiene (por ejemplo, el refresco) y grupos, uno por tiempo ("Entrada", "Segundo"), cuyos modificadores son los platos candidatos, normalmente ligados a productos por porciones, con su recargo como precio extra.
34. **Menú del día: consultar el día.** `GET /carta/sucursal/menu-del-dia?dia=AAAA-MM-DD` (sucursal activa) devuelve, por cada producto `MENU_DEL_DIA` activo y disponible en la sucursal, `{ productoId, nombre, precio (efectivo), dia, grupos: [{ id, nombre, minimo, maximo, opciones: [{ modificadorId, nombre, precioExtra, producto, elegida, disponible }] }] }`. `dia` es por defecto el día operativo actual de la sucursal (`diaOperativo` con su hora de corte); se aceptan el día anterior, el actual y el siguiente; otro día responde 400 `DATOS_INVALIDOS`.
35. **Menú del día: armar el día** (HU-08, "las opciones se cambian cada día"). `PUT /carta/sucursal/menu-del-dia/:productoId` con `{ dia?, opciones }` (`dia`: el actual por defecto, o el siguiente; `opciones`: ids de modificadores, sin repetir, puede ir vacía) reemplaza las opciones de ese día para ese menú en la sucursal activa y responde 200 con el elemento del criterio 34. Cada opción debe ser un modificador activo de un grupo activo asignado a ese menú; si no, 422 `REFERENCIA_INVALIDA`. Un producto que no es `MENU_DEL_DIA`, de B o inexistente responde 404. Repetir la misma lista responde 200 sin auditoría nueva.
36. **Cambio de día.** Dadas opciones elegidas para el día operativo D, cuando el reloj pasa la hora de corte de la sucursal, entonces el día operativo es D+1 y las opciones de D ya no valen: si D+1 no tiene opciones, el menú no es vendible con motivo `MENU_SIN_ARMAR` (criterio 59); si un grupo obligatorio no tiene opciones disponibles, con motivo `OPCIONES_INSUFICIENTES`. Las opciones armadas el día anterior para D+1 valen desde esa hora de corte. La PWA ofrece "Repetir las de ayer" (criterio 76).
37. **Por sucursal** (decisión 5). Armar el menú en S1 no cambia el de S2.
38. **Quién arma el día** (decisión 5). Las rutas de los criterios 34 y 35 usan `@Permiso('GESTIONAR_DISPONIBILIDAD')` y `@RequiereSucursal()`: Cocina/Barra, Supervisor y Administrador; Mozo y Cajero reciben 403 `PROHIBIDO` (la fila "Marcar agotados…" de la matriz no cambia). Los candidatos, el precio y los recargos los cambian el Administrador y el Cajero (criterio 33), no Cocina/Barra ni el Supervisor.

### Agotado (HU-09, RF-20)

39. **Marcar.** `PUT /carta/sucursal/agotados/:productoId` con `{ hasta }` (`FIN_DEL_DIA`, por defecto, o `REACTIVAR`; decisión 4) marca el producto como agotado en la sucursal activa y responde 200 `agotadoRespuesta` `{ productoId, sucursalId, desde, hasta, diaOperativo, origen: 'MANUAL' }`. Vale para cualquier producto de la empresa, de cualquier tipo. Un producto de B o inexistente responde 404.
40. **Repetir.** Repetirlo con el mismo `hasta` y el agotado vigente responde 200 con lo mismo, sin auditoría ni evento nuevos; con otro `hasta`, lo cambia (con auditoría y evento). Si el agotado anterior ya había vencido, marcarlo es un agotado nuevo.
41. **Reactivar.** `DELETE /carta/sucursal/agotados/:productoId` responde 204 y el producto deja de estar agotado en la sucursal activa; si no lo estaba (o ya había vencido), 204 sin auditoría ni evento.
42. **Solo en su sucursal.** Marcar o reactivar en S1 no cambia S2. La sucursal es siempre la activa de la sesión (002): un Cocina/Barra con acceso solo a S1 no puede marcar en S2, y uno que es Cocina/Barra en S1 y Mozo en S2 recibe 403 con S2 activa.
43. **Quién.** Las rutas de los criterios 39 y 41 usan `@Permiso('GESTIONAR_DISPONIBILIDAD')` y `@RequiereSucursal()`: Cocina/Barra, Supervisor y Administrador; Mozo y Cajero, 403 `PROHIBIDO`; sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`.
44. **Vigencia** (decisión 4). Un agotado `FIN_DEL_DIA` vale mientras el día operativo de la sucursal sea el del momento en que se marcó; uno `REACTIVAR` vale hasta el `DELETE`. Ejemplos con hora de corte `05:00`: marcado el `2026-11-03T21:00-05:00` (día operativo 3), sigue agotado a las `2026-11-04T04:59-05:00` y deja de estarlo a las `2026-11-04T05:00-05:00`; marcado el `2026-11-04T02:00-05:00` (día operativo 3), deja de estarlo a las `2026-11-04T05:00-05:00`. No hace falta ninguna tarea programada: la vigencia se calcula al leer (`agotadoVigente`, criterio 59).
45. **Efecto en la vista** (HU-09). Con el agotado vigente, en la vista de esa sucursal: el producto trae `agotado` y `vendible: false` con motivo `AGOTADO`; los combos que lo tienen como componente, motivo `COMPONENTE_NO_DISPONIBLE`; los modificadores ligados a él, `disponible: false`; y un producto con un grupo cuyas opciones disponibles quedan por debajo de su mínimo, motivo `OPCIONES_INSUFICIENTES`. `prepararLinea` rechaza ese producto (`PRODUCTO_NO_VENDIBLE`) o esa opción (`SELECCION_INVALIDA` con `MODIFICADOR_NO_DISPONIBLE`). El aviso "al instante" al comandero y a la carta web es el evento del criterio 46, que consumen las secciones 3 y 5.
46. **Evento.** Después de confirmar la transacción, marcar, cambiar o reactivar publica `carta.disponibilidad` en la sala de la sucursal con `{ sucursalId, productoId, agotado, hasta, origen }`. Si la transacción se revierte o la operación no cambia nada, no se publica. El evento lleva la empresa del contexto y nunca llega a otra empresa (criterio 68).

### Vista de la carta de la sucursal y contratos para otras secciones

47. **La vista.** `GET /carta/sucursal` (cualquier rol, con sucursal activa; sin ella, 409 `SUCURSAL_NO_ELEGIDA`) responde 200 `cartaSucursalRespuesta`: `{ sucursalId, diaOperativo, estaciones: [{ id, nombre }], familias: [{ id, nombre, productos: [productoDeVenta] }] }`, con las familias activas en su orden y solo las que tienen productos en la vista. Cada `productoDeVenta` es `{ id, tipo, nombre, descripcion, fotoUrl, precio (efectivo), seVendeSolo, afectacionIgv, aplicaIcbper, estacionId, tipoControlStock, agotado: { desde, hasta, origen } | null, vendible, motivo, grupos: [{ id, nombre, seleccion, minimo, maximo, obligatorio, modificadores: [{ id, nombre, precioExtra, productoId, disponible }] }], componentes: [{ productoId, nombre, cantidad, estacionId, disponible }] }`.
48. **Qué entra.** Entran los productos activos de familias activas que están disponibles en la sucursal, incluidos los que no se venden solos (Cocina los marca agotados; el comandero y la carta web los filtran con `seVendeSolo`), con sus grupos y modificadores activos en orden; en un `MENU_DEL_DIA`, solo las opciones del día operativo actual. No entran los productos inactivos ni los no disponibles en la sucursal. Los agotados sí entran, marcados (HU-09: "aparece agotado en el comandero").
49. **ETag.** La respuesta trae la cabecera `ETag` calculada sobre su contenido; con `If-None-Match` igual responde 304 sin cuerpo. Cualquier cambio que altere la vista (agotado, precio, disponibilidad, menú del día, cambio de día operativo) cambia el `ETag`.
50. **Sin consultas por producto.** La vista se arma con un número fijo de consultas, el mismo con 10 que con 300 productos (RNF-03). La prueba cuenta las consultas.
51. **Misma vista por servicio.** `CartaVentaService.cartaDeSucursal(sucursalId, instante)` devuelve lo mismo que `GET /carta/sucursal` dentro de un contexto de empresa, para cualquier sucursal de la empresa (la sección 5 la usará en su ruta pública).
52. **Línea preparada** (contrato para la sección 3). `CartaVentaService.prepararLinea({ sucursalId, productoId, modificadorIds, cantidad, instante })`, dentro de un contexto de empresa, devuelve `lineaPreparada` `{ productoId, nombre, tipo, cantidad, precioUnitario, total, afectacionIgv, aplicaIcbper, estacionId, tipoControlStock, modificadores: [{ id, nombre, grupoId, grupoNombre, precioExtra, productoLigado: { id, nombre, estacionId, tipoControlStock } | null }], componentes: [{ productoId, nombre, cantidad, estacionId, tipoControlStock }] }`, con `precioUnitario` y `total` calculados por `calcularLinea` de `packages/dominio` (criterio 57) sobre el precio efectivo de la sucursal. Si el producto no es vendible o no se vende solo, lanza 422 `PRODUCTO_NO_VENDIBLE` con el motivo; si la selección no es válida, 422 `SELECCION_INVALIDA` con los errores de `validarSeleccion`; un producto o un modificador de B, como uno inexistente. Es lo que la venta guardará "como era al venderse".
53. **Agotado del sistema** (contrato para la sección 6). `CartaDisponibilidadService.marcarAgotado({ sucursalId, productoId, hasta, origen })` y `reactivar({ sucursalId, productoId })`, dentro de un contexto de empresa con actor (de sistema o de persona), hacen lo mismo que los criterios 39 a 41 y 46, con `origen` `MANUAL` o `SIN_STOCK`. En esta sección solo se usa `MANUAL`.
54. **Aviso de cambios.** Después de confirmar, todo cambio de configuración que altera la vista publica `carta.actualizada`: con `{ sucursalId: null }` en la sala de la empresa si afecta a todas las sucursales (productos, familias, estaciones, grupos), o con `{ sucursalId }` en la sala de esa sucursal (ajuste por sucursal, menú del día). Quien lo recibe vuelve a pedir la vista con `If-None-Match`.

### Reglas puras de montos (`packages/dominio`, ruta crítica)

Todas reciben y devuelven montos como texto decimal (`"28.00"`), calculan con `decimal.js` y devuelven siempre 2 decimales. Un monto de entrada que no cumple `^\d{1,8}(\.\d{1,2})?$` lanza `RangeError`. Pruebas unitarias con cada ejemplo.

55. **Precio efectivo.** `precioEfectivo(precioEmpresa, precioSucursal)`: `("25.00", null)` → `"25.00"`; `("25.00", "27.50")` → `"27.50"`; `("25", "19.9")` → `"19.90"`; `(null, null)` → `null` (producto que no se vende solo).
56. **Validar la selección.** `validarSeleccion(grupos, elegidos)`, con `grupos: [{ id, minimo, maximo, modificadores: [{ id, precioExtra, disponible }] }]` y `elegidos` una lista de ids de modificadores, devuelve `{ valido: true }` o `{ valido: false, errores }`, donde cada error es uno de `MODIFICADOR_DESCONOCIDO { modificadorId }`, `MODIFICADOR_REPETIDO { modificadorId }`, `MODIFICADOR_NO_DISPONIBLE { modificadorId }`, `MENOS_DEL_MINIMO { grupoId, minimo, elegidos }`, `MAS_DEL_MAXIMO { grupoId, maximo, elegidos }`. Los errores salen en este orden: primero los de cada elegido en el orden recibido y luego los de cada grupo en el orden de `grupos`. Un modificador repetido cuenta una sola vez para los mínimos y máximos. Con el producto "Lomo saltado" del criterio 57:
    - `[3/4]` → válido; `[3/4, Huevo, Plátano]` → válido;
    - `[]` → `MENOS_DEL_MINIMO { Término, 1, 0 }`;
    - `[Jugoso, 3/4]` → `MAS_DEL_MAXIMO { Término, 1, 2 }`;
    - `[3/4, Huevo, Plátano, Queso]` → `MAS_DEL_MAXIMO { Extras, 2, 3 }`;
    - `[3/4, Huevo, Huevo]` → `MODIFICADOR_REPETIDO { Huevo }`;
    - `[3/4, X]` con X de otro producto → `MODIFICADOR_DESCONOCIDO { X }`;
    - `[3/4, Queso]` con Queso `disponible: false` → `MODIFICADOR_NO_DISPONIBLE { Queso }`;
    - un grupo sin modificadores con mínimo 0 y `[]` → válido.
57. **Precio de la línea.** `calcularLinea(producto, elegidos, cantidad)`, con `producto: { precio, grupos }` (precio efectivo), devuelve `{ valido: false, errores }` (los de `validarSeleccion`, o `PRODUCTO_SIN_PRECIO` si `precio` es `null`) o `{ valido: true, precioUnitario, total, modificadores: [{ id, precioExtra }] }`, con `precioUnitario` = precio + suma de los precios extra elegidos y `total` = `precioUnitario` × `cantidad`. `cantidad` es un entero de 1 a 999; otra lanza `RangeError`. Ejemplos:
    - **Lomo saltado** `"28.00"`; grupo Término (única, obligatoria: Jugoso, 3/4, Bien cocido, todos `"0.00"`); grupo Extras (múltiple, 0 a 2: Huevo `"2.50"`, Plátano `"3.00"`, Queso `"2.00"`). `[3/4, Huevo, Plátano]` × 2 → `precioUnitario "33.50"`, `total "67.00"`.
    - **Combo hamburguesa** del criterio 30: `[Cerveza, Ensalada]` × 3 → `"28.40"`, `"85.20"`; `[Chicha, Papas]` × 1 → `"22.90"`, `"22.90"`.
    - **Menú del día** `"12.00"`; Entrada (única, obligatoria: Papa a la huancaína `"0.00"`, Sopa `"0.00"`); Segundo (única, obligatoria: Ají de gallina `"0.00"`, Lomo saltado `"5.00"`). `[Sopa, Lomo saltado]` × 1 → `"17.00"`, `"17.00"`.
    - **Exactitud decimal:** producto `"0.10"` con un extra `"0.20"` × 3 → `"0.30"`, `"0.90"` (nunca `0.30000000000000004`); producto `"19.99"` con extras `"0.01"` y `"0.01"` × 999 → `"20.01"`, `"19989.99"`.
    - **Precio de sucursal:** el mismo Lomo saltado con precio efectivo `"30.00"` → `[3/4]` × 1 → `"30.00"`.
    - Selección inválida → `{ valido: false }` sin precios; `precio: null` → `PRODUCTO_SIN_PRECIO`; `cantidad` 0, −1, 1.5 o 1000 → `RangeError`.
58. **Un solo cálculo.** La API calcula todo precio de la carta con estas funciones (la vista del criterio 47 con `precioEfectivo`, `prepararLinea` con `calcularLinea`) y la PWA muestra los precios con ellas; ningún otro código suma montos de la carta. Una prueba de integración comprueba que `prepararLinea` devuelve exactamente lo que `calcularLinea` da con los mismos datos.

### Disponibilidad (`packages/dominio`, no crítica)

59. `agotadoVigente({ diaOperativo, hasta }, diaOperativoActual)` devuelve `true` si `hasta` es `REACTIVAR`, o si es `FIN_DEL_DIA` y los días coinciden. `vendibilidad(producto)` recibe `{ activo, disponibleEnSucursal, agotado, tipo, precio, componentes: [{ disponible }], grupos: [{ minimo, modificadores: [{ disponible }] }], opcionesDelDia }` y devuelve `{ vendible, motivo }`, con el primer motivo que aplique en este orden: `INACTIVO`, `NO_DISPONIBLE`, `AGOTADO`, `COMPONENTE_NO_DISPONIBLE`, `MENU_SIN_ARMAR` (solo `MENU_DEL_DIA` sin opciones del día), `OPCIONES_INSUFICIENTES` (algún grupo con menos modificadores disponibles que su mínimo). Un modificador está disponible si está activo, si su producto ligado (cuando lo tiene) está activo, disponible en la sucursal y no agotado, y, en un menú del día, si es opción del día. Un componente está disponible con las mismas condiciones. Pruebas unitarias del desarrollador.

### Permisos y auditoría (ruta crítica)

60. **Matriz con la fila de la carta cambiada** (decisión 5). En `packages/dominio`, la fila `EDITAR_CARTA` pasa de `[prohibido, prohibido, prohibido, prohibido, permitido]` a `[prohibido, permitido, prohibido, prohibido, permitido]` (columnas Mozo, Cajero, Cocina/Barra, Supervisor, Administrador), como la fila "Editar la carta y los precios" del documento de diseño actualizada ("Cambios propuestos a los documentos compartidos"). Ninguna otra celda cambia y no hay acciones nuevas; la restricción del precio por sucursal no es una celda sino una regla sobre la sucursal ajustada (criterio 19b). `GET /sesion` de un Cajero trae `EDITAR_CARTA: 'permitido'`. Toda ruta de `/carta` lleva `@Permiso` con una acción, en cuatro clases cerradas: `GESTIONAR_DISPONIBILIDAD` en `PUT` y `DELETE /carta/sucursal/agotados/:productoId`, `GET` y `PUT /carta/sucursal/menu-del-dia…`; `ADMINISTRAR` en `POST /carta/estaciones` y `PATCH /carta/estaciones/:id`; ninguna en `GET /carta/sucursal` (cualquier rol con sucursal activa); `EDITAR_CARTA` en todas las demás, incluidas sus lecturas y `GET /carta/estaciones`. La prueba recorre las rutas de `/carta` que Nest tiene registradas (no una lista fija) y falla si una ruta no está clasificada o tiene otra acción.
61. **Rechazos.** Dado cada rol sin el permiso (Mozo, Cocina/Barra y Supervisor para `EDITAR_CARTA`; Mozo, Cajero, Cocina/Barra y Supervisor para `ADMINISTRAR`; Mozo y Cajero para `GESTIONAR_DISPONIBILIDAD`), con sesión de contraseña y de PIN, cuando llama cada ruta, entonces responde 403 `PROHIBIDO`, y no cambia ninguna fila, no queda auditoría, no se guarda ni se borra ningún archivo y no se publica ningún evento. El rol es el de la sucursal activa (002): un usuario que es Cajero en S1 y Mozo en S2 recibe 403 en toda ruta de `EDITAR_CARTA` con S2 activa, y sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`. Las sesiones de soporte tienen permisos de Administrador, y lo que hacen queda trazado y auditado con el superadministrador (criterios 57 y 117 de 002). La carta funciona igual con la sucursal suspendida (criterio 82 de 002) y no se marca con `@RequiereModulo`: ningún módulo del catálogo la contiene.
61b. **Lo que el Cajero puede y lo que no** (decisión 5, ruta crítica). Dado el Cajero (Cajero en S1, Mozo en S2, S1 activa):
   - **Puede**, con 200 o 201 y la fila de auditoría con él como autor: crear, editar y ordenar familias; crear y editar productos de los tres tipos, incluidos el precio de la empresa, el cambio de tipo, la foto, el orden y desactivarlos; crear y editar grupos de modificadores con sus precios extra; configurar combos y el menú del día (precio, tiempos, candidatos y recargos); leer las estaciones; consultar los ajustes de todas las sucursales (criterio 18); y ajustar el precio y la disponibilidad de S1 (criterio 19b). Lo que es de toda la empresa vale en todas las sucursales, también en S2: si cambia el precio de la empresa, cambia el precio efectivo de S2 cuando S2 no tiene precio propio (criterio 21).
   - **No puede**, con 403 `PROHIBIDO`, sin cambiar filas, sin auditoría, sin archivos y sin eventos: ajustar el precio o la disponibilidad de S2 o de una sucursal de A sin acceso (criterio 19b); crear un producto con S2 en `noDisponibleEn` (criterio 19b); crear o modificar estaciones (criterio 2b); marcar o reactivar agotados ni armar el menú del día (criterios 38 y 43).
   - El Supervisor no cambia: 403 en toda ruta de `EDITAR_CARTA` y de `ADMINISTRAR`.
62. **Auditoría.** Cada escritura de la lista "Acciones auditadas en esta sección" deja exactamente una fila en `auditoria`, en la misma transacción que el cambio, con el autor (el Cajero o el Administrador que la hizo, o el superadministrador en soporte; criterio 57 de 002), la entidad, la sucursal cuando aplica y en `detalle` el antes y el después de los campos cambiados (en un cambio de tipo, también lo quitado, criterio 10b). Todo cambio de precio (precio del producto, precio de sucursal, precio extra de un modificador) guarda el antes y el después exactos como texto (`{ "precio": { "antes": "25.00", "despues": "26.00" } }`). Las escrituras que no cambian nada (criterios 10, 16, 19, 35, 40 y 41) no dejan fila.
63. **Trazabilidad.** Las tablas nuevas se crean con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`, así que la prueba de catálogo del criterio 113 de 002 las cubre sin cambios. Prueba de integración del desarrollador: un producto creado por el Administrador (o por el Cajero) desde el equipo E queda con `creado_por_usuario_id` = él y `creado_por_equipo_id` = E, y uno modificado después por el Cajero queda con `actualizado_por_usuario_id` = el Cajero; un agotado marcado por un Cocina/Barra queda con su usuario.

### Aislamiento entre empresas (ruta crítica)

64. **Catálogo.** Las tablas nuevas cumplen el criterio 38 de 001 y el 88 de 002 (RLS forzada, política `aislamiento_empresa`, política `acceso_plataforma` sin privilegios, llaves compuestas con `empresa_id`, sin `TRUNCATE`); las pruebas de catálogo existentes las recorren solas.
65. **Por tabla.** Para cada tabla nueva (`estacion`, `familia`, `producto`, `producto_sucursal`, `producto_agotado`, `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo`, `menu_del_dia_opcion`), con el contexto de A y un actor de A fijado: no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, y no se insertan filas con `empresa_id` de B (como el criterio 91 de 002). La prueba comprueba que el rechazo lo produce la política RLS y no la falta de actor.
66. **Referencias cruzadas en la base.** Con el contexto de A, insertar o actualizar una fila de A que apunte a una fila de B (producto con familia o estación de B; componente, producto ligado, asignación de grupo, ajuste, agotado u opción del día con un producto, grupo, modificador o sucursal de B) falla por la llave foránea compuesta, igual que con un id inexistente.
67. **Referencias cruzadas por HTTP.** En toda ruta de `/carta`, un id de B en la ruta responde 404 `NO_ENCONTRADO` y en el cuerpo 422 `REFERENCIA_INVALIDA` (o el 400 de los criterios 5 y 13), con el mismo cuerpo que un id inexistente, y nada de B cambia. Los listados y la vista solo traen datos de A.
68. **Archivos y eventos.** Las claves de las fotos de A empiezan con `carta/<id de A>/`; quitar o reemplazar la foto de un producto de A nunca borra un archivo de B. Todo evento publicado por una operación de A lleva la empresa A y su sala es de A (prueba con el publicador en memoria).
69. **Concurrencia.** Con un pool de la API de 2 conexiones, 100 peticiones concurrentes a `GET /carta/sucursal` y `PUT /carta/sucursal/agotados/:id` alternando sesiones de A y de B devuelven y cambian solo datos de su empresa (como el criterio 5 de 002).

### Interfaz (PWA, no crítica)

Las pantallas siguen `DESIGN.md` (Azulejo, tipo "Operate", móvil primero, trato de tú) y `PRODUCT.md`. El rol frontend usa la skill `impeccable`.

70. **Navegación.** El Administrador ve los destinos "Carta" (`/carta`) y "Disponibilidad" (`/disponibilidad`), además de los de 002 (máximo 5 en la barra inferior). El Cajero ve "Carta". Cocina/Barra y Supervisor ven "Disponibilidad". El Mozo no ve ninguno de los dos. La visibilidad sale de `permisos` de `GET /sesion` (rol en la sucursal activa: el Cajero con S2 activa no ve "Carta").
71. **Carta: productos.** `/carta` muestra segmentos "Productos", "Familias", "Modificadores" y "Estaciones"; "Estaciones" solo con `ADMINISTRAR` permitido (el Cajero no lo ve). En Productos: lista agrupada por familia en su orden, con miniatura, nombre, precio de la empresa y etiquetas de estado con texto ("Inactivo", "Combo", "Menú del día", "No se vende solo"); búsqueda por nombre; filtro activos o todos; botón principal fijo "Nuevo producto"; modo "Ordenar" con botones subir y bajar de 48 px (sin arrastrar).
72. **Formulario de producto.** Arriba se elige el tipo (Simple, Combo, Menú del día), al crear y también al editar. Al cambiarlo en la edición, el formulario muestra y oculta los campos del tipo nuevo (pide la estación al pasar a simple y el precio si no lo tenía) y, al guardar, si la API responde `CONFIRMACION_REQUERIDA`, una hoja de confirmación dice exactamente qué se quita con los nombres de `seQuita` ("Se quitarán los componentes: Hamburguesa clásica × 1", "Se quitará la estación Cocina", "Se borrarán las opciones del menú de hoy en Miraflores (4)") con "Cambiar a simple" y "Cancelar"; si responde `EN_USO`, explica dónde se usa con `usadoEn` y no ofrece continuar. Al pasar a menú del día avisa que no se podrá vender hasta armarlo en cada sucursal. Campos: nombre, descripción, familia, precio ("con IGV"), "Se vende solo" (solo en simple), estación (con "Ninguna"), tipo de control de stock (tres opciones con una línea de ayuda cada una), grupos de modificadores (elegir de los existentes, ordenar, quitar, crear uno nuevo sin salir), componentes con cantidad (combo y menú), "Datos tributarios" plegado con afectación e ICBPER, y "Disponible en" con una casilla por sucursal (marcadas por defecto; para el Cajero, solo las de sus sucursales se pueden desmarcar). En la edición se suman la foto, la sección "Precio por sucursal" (criterio 73), "Usado en" (combos y modificadores que lo usan) y "Desactivar" separado por una junta. Muestra los errores de la API en su campo.
73. **Precio por sucursal.** Dentro del producto, una fila por sucursal con el precio efectivo, un campo de precio propio (vacío = el de la empresa) y el interruptor "Disponible". Guarda cada fila por separado. Las filas con `editable: false` se muestran solo para leer, con la nota "Solo la cambia el Administrador o un Cajero de esta sucursal".
74. **Foto.** "Tomar o elegir foto" abre la cámara o la galería; la PWA reduce la imagen en el navegador (lado mayor de 1200 px, JPEG) antes de subirla, muestra la vista previa y el avance, y permite quitarla con confirmación. Si la red se corta, conserva la imagen y ofrece reintentar.
75. **Familias, estaciones y modificadores.** Familias: lista en orden con agregar, renombrar, desactivar y ordenar. Estaciones (solo el Administrador): lista con agregar, renombrar y desactivar. Modificadores: lista de grupos con su regla en palabras ("Elige 1, obligatorio", "Elige de 0 a 2") y cuántos productos lo usan; formulario con nombre, "Única" o "Varias", obligatorio o mínimo y máximo, y la lista de opciones (nombre, precio extra, producto ligado opcional, subir, bajar y quitar). `EN_USO` se explica con palabras ("Esta estación la usan 4 productos. Cámbialos de estación antes de desactivarla").
76. **Menú del día.** En "Disponibilidad", el segmento "Menú del día" muestra cada menú con "Hoy" y "Mañana"; por tiempo, los candidatos como casillas grandes con su recargo y su estado (agotado); "Repetir las de ayer" copia la selección del día anterior; "Guardar". Si hoy no está armado, lo dice arriba ("El menú de hoy no está armado: no se puede vender").
77. **Agotados.** En "Disponibilidad", el segmento "Agotados" muestra los productos de la vista de la sucursal activa agrupados por familia, con filtro por estación (recuerda la última elegida en ese equipo), búsqueda y el filtro "Solo agotados". Cada fila es una baldosa de 72 px con el nombre, la estación y un interruptor "Agotado" con texto. Al marcar se elige "Solo por hoy" (por defecto) o "Hasta que lo reactive" en una hoja inferior (decisión 4); al confirmar, la fila cambia al instante y aparece "Ceviche mixto está agotado · Deshacer" durante 5 segundos. Los productos no vendibles por un componente o un menú sin armar muestran el motivo con palabras.
78. **Estados de cada pantalla.** Carga: esqueleto con la forma de la lista. Vacío: frase y acción ("Aún no tienes productos. Crea tu primera familia y tu primer producto"; en Disponibilidad, "Esta sucursal no tiene productos en la carta"). Error de carga: aviso rocoto y "Reintentar". Sin conexión: cenefa y banner de 002; los cambios hechos quedan con la etiqueta "Pendiente de envío" y se reintentan sin duplicar; lo escrito en un formulario no se pierde.
79. **Compatibilidad y montos.** Desde 360 px sin desplazamiento horizontal; controles de 48 px o más; Chrome para Android y Safari para iPhone y iPad recientes; montos como `S/ 28.00` con cifras tabulares, y todo precio mostrado (incluida la vista previa "Precio con estas opciones" del formulario de combo) calculado con `packages/dominio`. Las pantallas de operación responden en menos de 1 segundo (RNF-03).
80. **Actualización.** La pantalla de Disponibilidad vuelve a pedir la vista cada 15 segundos en segundo plano (`X-Actividad: segundo-plano`, `If-None-Match`) y al volver a la pestaña; así dos equipos de cocina ven el mismo estado sin Socket.IO (decisión 2). Toda escritura usa el cliente de `lib/api.ts`, con `Idempotency-Key` en los `POST` y reintentos ante cortes (RNF-10).

## Acciones auditadas en esta sección

Cada fila lleva actor, empresa, sucursal si aplica, equipo si aplica, sesión y fecha (criterio 57 de 002). `detalle` con el antes y el después de los campos cambiados.

| Acción (`accion`) | Entidad | Cuándo |
| --- | --- | --- |
| `crear_estacion`, `modificar_estacion` | `estacion` | Criterios 1 y 2 |
| `crear_familia`, `modificar_familia`, `ordenar_familias` | `familia` | Criterios 3 a 5 |
| `crear_producto`, `modificar_producto` (con precio, grupos y componentes; en un cambio de tipo, el tipo antes y después y en `quitado` la estación, los componentes y las opciones del día borrados), `ordenar_productos` | `producto` | Criterios 6 a 13 (incluidos 10b a 10d) |
| `cambiar_foto_producto`, `quitar_foto_producto` | `producto` | Criterios 14 a 16 (sin el archivo; con las claves anterior y nueva) |
| `ajustar_producto_sucursal` | `producto` (con `sucursal_id`, la ajustada) | Criterios 19 y 19b |
| `crear_grupo_modificadores`, `modificar_grupo_modificadores` (con los modificadores creados, cambiados y desactivados, y sus precios extra) | `grupo_modificadores` | Criterios 24 a 29 |
| `armar_menu_del_dia` | `producto` (con `sucursal_id`, el día y las opciones antes y después) | Criterio 35 |
| `marcar_agotado`, `reactivar_agotado` | `producto` (con `sucursal_id`) | Criterios 39 a 41 y 53 |

## Casos límite

- Un producto agotado que también es componente de un combo y opción ligada del menú: el combo deja de ser vendible, la opción del menú queda no disponible, y si era la única de un tiempo obligatorio, el menú deja de ser vendible (criterio 45).
- Un agotado marcado a las 04:59 con hora de corte 05:00 dura un minuto si es "por hoy": es del día operativo anterior. La PWA lo advierte cuando faltan menos de 60 minutos para la hora de corte ("Se reactivará a las 5:00").
- Cambio de la hora de corte de una sucursal (001) con agotados "por hoy" vigentes: se recalcula el día operativo con la hora nueva; un agotado puede vencer antes o después de lo previsto. Se acepta.
- Dos cocineros marcan el mismo producto a la vez: los dos `PUT` terminan bien, gana el último `hasta`, y queda una fila de auditoría por cada cambio real.
- Un Administrador sin sucursal activa: puede editar toda la carta y ajustar cualquier sucursal (criterios 18 a 22), pero para marcar agotados o armar el menú elige una sucursal (criterio 43). Un Cajero, en cambio, necesita una sucursal activa donde sea Cajero para editar la carta (su permiso sale del rol en la sucursal activa, criterio 61).
- Un Cajero de S1 cambia el precio de la empresa de un producto: el precio efectivo cambia también en S2, donde no es Cajero, si S2 no tiene precio propio. Se acepta: el precio de la empresa es parte de "toda la carta" (decisión 5); lo que S2 decide por su cuenta es su precio propio, que el Cajero de S1 no toca.
- Un Cajero de S1 desactiva un producto o lo cambia de tipo: vale para todas las sucursales, también S2. Al pasar un menú del día a otro tipo se borran también las opciones del día de S2 (criterio 10b); queda en la auditoría con él como autor.
- Un Cajero pierde el rol de Cajero en S1 mientras edita: la siguiente petición ya usa el rol nuevo (criterio 6 de 002) y responde 403.
- Un combo que pasa a simple y vuelve a combo: los componentes no vuelven solos (se borraron, criterio 10b); se cargan de nuevo. La auditoría guarda cuáles eran.
- Un simple que pasa a combo mientras otro usuario lo agrega como componente de otro combo: las dos operaciones se serializan con el bloqueo del producto; la que llega segunda ve el estado nuevo y responde 409 `EN_USO` (cambio de tipo) o 422 `REFERENCIA_INVALIDA` (componente que ya no es simple).
- Un menú del día que pasa a combo: todos sus candidatos pasan a ser opciones del combo, sin elegir las del día.
- Un modificador desactivado que estaba elegido en el menú de hoy: deja de ofrecerse desde la siguiente lectura; la selección guardada se conserva pero no cuenta.
- Un producto que deja de estar disponible en una sucursal con un agotado vigente: el agotado se conserva y vuelve a contar si el producto vuelve a estar disponible ese mismo día.
- Un grupo obligatorio cuyas opciones ligadas están todas agotadas: el producto queda no vendible con `OPCIONES_INSUFICIENTES` aunque él mismo no esté agotado.
- Un producto `SIMPLE` que no se vende solo y no es componente ni producto ligado de nada: no aparece en el comandero ni en la carta web; la edición muestra "Usado en: nada" para que quien edita la carta lo note.
- Precio de sucursal igual al de la empresa: se guarda tal cual; si luego cambia el de la empresa, la sucursal conserva el suyo. Para volver a seguir el de la empresa se pone `null`.
- Dos productos con nombres que solo difieren en mayúsculas o espacios en los extremos: el segundo responde 409 (los textos se recortan).
- Foto subida y transacción que falla después: el archivo nuevo queda huérfano en el almacén (no lo apunta ningún producto); ver "Riesgos" del plan.
- Un combo con un componente que no se vende solo: válido (por ejemplo "Papas del combo"); su disponibilidad cuenta para el combo.
- Afectación `EXONERADO` en una empresa cuyo emisor es del Nuevo RUS: se guarda; qué comprobante sale y cómo lo decide la sección 4.
- Una cadena con sucursales en zonas con tratamiento tributario distinto (por ejemplo, la Amazonía): la afectación es por producto y no por sucursal (decisión 10).

## Reglas de negocio aplicables

Fuente: `fuentes.md` y "Decisiones del usuario" (2026-10-28), que mandan donde cambian `fuentes.md`.

- La carta tiene familias, productos, modificadores, combos, menú del día, estaciones de producción, ajustes por sucursal y agotados (86) (Alcance).
- Cada producto tiene foto, descripción, precio con IGV, afectación tributaria, estación de producción y tipo de control de stock (RF-14, HU-05). El precio incluye IGV; el sistema calcula la base imponible y el IGV a partir de él (Ventas y precios; lo hace la sección 4).
- Solo soles. Un solo precio en todos los canales; el envase y el envío se cobran aparte (Ventas y precios; "Precios distintos por canal" está fuera del MVP).
- Por sucursal se ajustan el precio, la disponibilidad y el agotado de cada producto, sin afectar a las demás sucursales (RF-15, HU-06).
- Grupos de modificadores con selección única o múltiple, mínimo, máximo y obligatorio; el modificador tiene precio extra y vínculo a un producto opcionales, para descontar su stock (RF-16, HU-07). Un modificador ligado a un producto descuenta ese producto (Inventario, "Combos y modificadores").
- Los combos tienen precio fijo, y algunas opciones pueden sumar un monto. Cada componente va a su estación y descuenta su propio stock (Ventas y precios, HU-08).
- El menú del día es un combo cuyas opciones cambian cada día y se controlan por porciones del día (Ventas y precios, RF-18).
- Las estaciones se definen por empresa; cada sucursal asocia cada estación a una impresora o a un KDS (Modelo de datos; la asociación es de la sección 3).
- Tipos de control de stock: por unidades, por porciones del día o sin control; por receta queda después del MVP (Inventario).
- Marcar agotados (86) y reactivarlos (RF-20); el producto agotado aparece agotado en el comandero y desaparece de la carta web (HU-09); la carta web oculta lo agotado (Inventario, "Stock visible"; RF-41).
- Permisos: "Editar la carta y los precios", Cajero y Administrador; el Cajero cambia el precio y la disponibilidad por sucursal solo en las sucursales donde es Cajero, y las estaciones las define solo el Administrador (decisión del usuario 5, que cambia la fila de "Roles y permisos": antes solo Administrador). "Marcar agotados (86) y cargar porciones del día", Cocina/Barra, Supervisor y Administrador, sin cambios (Roles y permisos). Un usuario tiene un rol por sucursal (002).
- El tipo de un producto (simple, combo o menú del día) se puede cambiar; lo que deja de aplicar se quita con confirmación, y un producto que se usa como componente u opción no puede pasar a combo ni a menú (decisión del usuario; criterios 10b y 10c).
- Las ventas guardan cómo eran al venderse: un cambio de precio no altera las ventas pasadas (Modelo de datos; lo cumple la sección 3 guardando la línea preparada).
- Identificadores UUID; montos con decimales exactos (Modelo de datos). Código compartido para los cálculos y pruebas automáticas de montos (RNF-17).
- Auditoría de los cambios de configuración (RF-13, RNF-09); trazabilidad de autor y equipo en toda tabla nueva (RNF-20).
- Sin servicios externos de pago salvo el PSE (RNF-18); fotos de la carta en Cloudflare R2 (Infraestructura y costos; decisión 1).
- La importación de la carta desde Excel es parte del alta de clientes que hace nuestro equipo (Modelo comercial; decisión 3).
- **Decisiones del usuario (2026-10-28):** grupos reutilizables (6); sin combos anidados (7); precio de sucursal libre, precio extra sin negativos, solo el precio del producto varía por sucursal, un modificador no se elige dos veces en la misma línea (8); una familia por producto y orden manual (9); afectación gravado, exonerado o inafecto más marca de ICBPER (10); productos sin estación (11); productos que no se venden solos (12); agotado por el día o hasta reactivar (4); menú del día por sucursal, armado por Cocina/Barra, Supervisor o Administrador y configurado por el Administrador o el Cajero (5).

## Contrato

### Endpoints

Todas con sesión de empresa (002). "Carta" = `@Permiso('EDITAR_CARTA')` (Cajero y Administrador, con el rol de la sucursal activa); "Administrar" = `@Permiso('ADMINISTRAR')` (solo Administrador); "Disponibilidad" = `@Permiso('GESTIONAR_DISPONIBILIDAD')` + `@RequiereSucursal()`.

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `GET /carta/estaciones` | Carta | — | 200 `estacionRespuesta[]` |
| `POST /carta/estaciones` | Administrar; `Idempotency-Key` opcional | `estacionEntrada` | 201 `estacionRespuesta`; 400; 403; 409 |
| `PATCH /carta/estaciones/:id` | Administrar | `estacionModificarEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO` |
| `GET /carta/familias` | Carta | — | 200 `familiaRespuesta[]` |
| `POST /carta/familias` | Carta; `Idempotency-Key` opcional | `familiaEntrada` | 201 `familiaRespuesta`; 400; 403; 409 |
| `PATCH /carta/familias/:id` | Carta | `familiaModificarEntrada` | 200; 400; 403; 404; 409 |
| `PUT /carta/familias/orden` | Carta | `ordenEntrada` (`{ ids }`) | 200 `familiaRespuesta[]`; 400; 403 |
| `PUT /carta/familias/:id/productos/orden` | Carta | `ordenEntrada` | 200 `productoResumen[]`; 400; 403; 404 |
| `GET /carta/productos` | Carta | — | 200 `productoResumen[]` |
| `GET /carta/productos/:id` | Carta | — | 200 `productoRespuesta`; 404 |
| `POST /carta/productos` | Carta (y `noDisponibleEn` con el criterio 19b); `Idempotency-Key` opcional | `productoCrearEntrada` | 201 `productoRespuesta`; 400; 403; 409; 422 `REFERENCIA_INVALIDA` |
| `PATCH /carta/productos/:id` | Carta | `productoModificarEntrada` (incluye `tipo?` y `confirmarPerdida?`) | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO` (con `usadoEn`) / `CONFIRMACION_REQUERIDA` (con `seQuita`); 422 |
| `PUT /carta/productos/:id/foto` | Carta | binario `image/jpeg`, `image/png` o `image/webp` (máx. 1 MB) | 200 `{ fotoUrl }`; 403; 404; 413; 415; 422 `FOTO_INVALIDA` |
| `DELETE /carta/productos/:id/foto` | Carta | — | 204; 403; 404 |
| `GET /carta/productos/:id/sucursales` | Carta | — | 200 `ajusteSucursalRespuesta[]` (con `editable`); 404 |
| `PUT /carta/productos/:id/sucursales/:sucursalId` | Carta y `EDITAR_CARTA` permitido con el rol en `:sucursalId` (criterio 19b) | `ajusteSucursalEntrada` (`{ precio, disponible }`) | 200 `ajusteSucursalRespuesta`; 400; 403; 404 |
| `GET /carta/grupos-modificadores` | Carta | — | 200 `grupoRespuesta[]` |
| `GET /carta/grupos-modificadores/:id` | Carta | — | 200 `grupoRespuesta`; 404 |
| `POST /carta/grupos-modificadores` | Carta; `Idempotency-Key` opcional | `grupoEntrada` | 201 `grupoRespuesta`; 400; 403; 409; 422 |
| `PATCH /carta/grupos-modificadores/:id` | Carta | `grupoModificarEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO`; 422 |
| `GET /carta/sucursal` | cualquier rol con sucursal activa | `If-None-Match` opcional | 200 `cartaSucursalRespuesta` con `ETag`; 304; 409 `SUCURSAL_NO_ELEGIDA` |
| `GET /carta/sucursal/menu-del-dia` | Disponibilidad | `?dia=AAAA-MM-DD` | 200 `menuDelDiaRespuesta[]`; 400; 403; 409 |
| `PUT /carta/sucursal/menu-del-dia/:productoId` | Disponibilidad | `menuDelDiaEntrada` (`{ dia?, opciones }`) | 200 `menuDelDiaRespuesta`; 400; 403; 404; 409; 422 |
| `PUT /carta/sucursal/agotados/:productoId` | Disponibilidad | `agotadoEntrada` (`{ hasta? }`) | 200 `agotadoRespuesta`; 400; 403; 404; 409 |
| `DELETE /carta/sucursal/agotados/:productoId` | Disponibilidad | — | 204; 403; 404; 409 |

- `PUT`, `PATCH` y `DELETE` asignan valores absolutos: repetirlos da el mismo resultado y no necesitan clave de idempotencia.
- `PUT /carta/productos/:id/foto` es la única ruta que acepta un cuerpo binario, con su propio límite de 1 MB; las demás siguen con el límite de 100 KB de 001.
- CORS: se agregan `If-None-Match` a las cabeceras permitidas y `ETag` a las expuestas.

### Códigos de error nuevos (`CODIGOS_ERROR`)

`REFERENCIA_INVALIDA` (422, con `campos`), `EN_USO` (409; en el cambio de tipo, con `usadoEn`, criterio 10c), `CONFIRMACION_REQUERIDA` (409, con `seQuita`, criterio 10b), `FOTO_INVALIDA` (422), `PRODUCTO_NO_VENDIBLE` (422, con el motivo; lo lanza `prepararLinea`), `SELECCION_INVALIDA` (422, con los errores; lo lanza `prepararLinea`). `errorRespuestaSchema` gana dos campos opcionales, como `reintentarEnSegundos` de 002: `usadoEn` (solo en `EN_USO` del criterio 10c) y `seQuita` (solo en `CONFIRMACION_REQUERIDA`). Se reutilizan `DATOS_INVALIDOS`, `NO_ENCONTRADO`, `CONFLICTO`, `PROHIBIDO`, `SUCURSAL_NO_ELEGIDA`, `CUERPO_DEMASIADO_GRANDE` y `TIPO_NO_SOPORTADO`.

### Paquetes compartidos

- `packages/dominio` (`src/carta/`):
  - Catálogos: `TIPOS_PRODUCTO` (`SIMPLE`, `COMBO`, `MENU_DEL_DIA`), `TIPOS_CONTROL_STOCK` (`UNIDADES`, `PORCIONES`, `SIN_CONTROL`), `AFECTACIONES_IGV` (`GRAVADO`, `EXONERADO`, `INAFECTO`), `SELECCIONES` (`UNICA`, `MULTIPLE`), `HASTA_AGOTADO` (`FIN_DEL_DIA`, `REACTIVAR`), `ORIGENES_AGOTADO` (`MANUAL`, `SIN_STOCK`), `MOTIVOS_NO_VENDIBLE`, `ERRORES_SELECCION`, y los límites `CANTIDAD_MAXIMA_LINEA = 999`, `CANTIDAD_MAXIMA_COMPONENTE = 99`.
  - Ruta crítica (`precios.ts`): `precioEfectivo(precioEmpresa, precioSucursal)`, `validarSeleccion(grupos, elegidos)`, `calcularLinea(producto, elegidos, cantidad)` (criterios 55 a 57). `decimal.js` pasa a ser dependencia de `packages/dominio`.
  - No crítica (`disponibilidad.ts`): `agotadoVigente`, `vendibilidad` (criterio 59).
- `packages/contratos` (`src/carta.ts`, zod): `montoNoNegativoSchema` (`^\d{1,8}(\.\d{1,2})?$`, admite `0`), `estacionEntrada`, `estacionModificarEntrada`, `estacionRespuesta`, `familiaEntrada`, `familiaModificarEntrada`, `familiaRespuesta`, `ordenEntrada`, `productoCrearEntrada`, `productoModificarEntrada` (con `tipo?` y `confirmarPerdida?`), `productoResumen`, `productoRespuesta`, `usadoEn`, `seQuita`, `ajusteSucursalEntrada`, `ajusteSucursalRespuesta` (con `editable`), `grupoEntrada` (unión discriminada por `seleccion`), `grupoModificarEntrada`, `grupoRespuesta`, `cartaSucursalRespuesta`, `productoDeVenta`, `menuDelDiaEntrada`, `menuDelDiaRespuesta`, `agotadoEntrada`, `agotadoRespuesta`, `lineaPreparada`; los eventos `eventoDisponibilidad` y `eventoCartaActualizada`. Entradas estrictas.

### Interfaces de la API (contratos públicos para las pruebas y para otras secciones)

- `crearAplicacion({ …, publicadorEventos?, almacenArchivos? })`: reemplazan a los proveedores `PUBLICADOR_EVENTOS` y `ALMACEN_ARCHIVOS`.
- `PublicadorEventos` (`apps/api/src/nucleo/eventos/`): `publicar(evento: { empresaId, sala: { tipo: 'empresa' } | { tipo: 'sucursal', sucursalId }, nombre, datos })`. Implementaciones: `PublicadorNulo` (por defecto, hasta la sección 3) y `PublicadorEnMemoria` (pruebas, con `eventos()` y `limpiar()`). Las operaciones lo llaman solo con `ContextoEmpresa.alConfirmar`.
- `AlmacenArchivos` (`apps/api/src/nucleo/archivos/`): `guardar(clave, contenido, tipo)`, `borrar(clave)`, `urlPublica(clave)`. Implementaciones: `AlmacenEnMemoria` (pruebas), `AlmacenEnDisco` (desarrollo) y `AlmacenR2` (producción, decisión 1).
- `CartaVentaService.cartaDeSucursal(sucursalId, instante)` y `CartaVentaService.prepararLinea(entrada)` (criterios 51 y 52).
- `CartaDisponibilidadService.marcarAgotado(entrada)` y `reactivar(entrada)` (criterio 53).
- `SucursalesConsultaService.horaCorte(sucursalId)` (nuevo, en plataforma): la hora de corte de una sucursal de la empresa del contexto, o `null` si no existe.

### Variables de entorno nuevas

| Variable | Uso |
| --- | --- |
| `ARCHIVOS_DRIVER` | `memoria`, `disco` o `r2`. Por defecto `disco` en `development` y `memoria` en `test`; obligatoria `r2` en producción |
| `ARCHIVOS_DIRECTORIO` | Carpeta del almacén en disco (desarrollo) |
| `ARCHIVOS_URL_PUBLICA` | URL base pública de los archivos (en desarrollo, la API los sirve en `/archivos/*`) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Credenciales del bucket de R2. Obligatorias con `ARCHIVOS_DRIVER=r2` |

### Eventos en tiempo real

Se publican por `PublicadorEventos` después de confirmar; en esta sección no hay transporte (decisión 2). Nombres y datos fijados aquí para las secciones 3 y 5:

| Evento | Sala | Datos | Cuándo |
| --- | --- | --- | --- |
| `carta.disponibilidad` | sucursal | `{ sucursalId, productoId, agotado, hasta, origen }` | Criterios 46 y 53 |
| `carta.actualizada` | empresa o sucursal | `{ sucursalId }` (`null` = todas) | Criterio 54 |

### Permisos

- Los de la tabla de endpoints. En la matriz de `packages/dominio` cambia una celda: `EDITAR_CARTA` pasa a `permitido` para el Cajero (criterio 60). El precio y la disponibilidad por sucursal exigen además `EDITAR_CARTA` permitido con el rol en la sucursal ajustada (criterio 19b). Soporte = Administrador. Principal de prueba = Administrador.
- Base de datos (todas con política `acceso_plataforma` sin privilegios para `restaurante_plataforma`):

| Tabla | `restaurante_api` |
| --- | --- |
| `estacion`, `familia`, `producto`, `producto_sucursal`, `grupo_modificadores`, `modificador` | SELECT, INSERT, UPDATE |
| `producto_grupo`, `componente_combo`, `menu_del_dia_opcion`, `producto_agotado` | SELECT, INSERT, UPDATE, DELETE |

## Cambios al modelo de datos

Todas las tablas con `id uuid` (`gen_random_uuid()`), `empresa_id` (FK a `empresa`), `creado_en`, `actualizado_en`, único `(id, empresa_id)` para las llaves compuestas, índice por `empresa_id`, y creadas con `sqlTablaDeEmpresaTrazable(tabla, { privilegiosApi, privilegiosPlataforma: [], llaveDeEquipo: true })`. Toda llave foránea entre tablas de empresa es compuesta con `empresa_id`. Los textos tienen `CHECK` de largo; los montos son `numeric(10,2)`.

- **`estacion`**: `nombre` (1 a 50), `activa boolean` (por defecto `true`). Único `(empresa_id, lower(nombre))`.
- **`familia`**: `nombre` (1 a 60), `orden integer`, `activa boolean`. Único `(empresa_id, lower(nombre))`.
- **`producto`**: `familia_id` (FK compuesta), `tipo` (`CHECK IN ('SIMPLE','COMBO','MENU_DEL_DIA')`), `nombre` (1 a 100), `descripcion null` (1 a 500), `precio numeric(10,2) null` (`CHECK > 0`), `se_vende_solo boolean`, `afectacion_igv` (`CHECK IN ('GRAVADO','EXONERADO','INAFECTO')`, por defecto `GRAVADO`), `aplica_icbper boolean` (por defecto `false`), `estacion_id null` (FK compuesta), `tipo_control_stock` (`CHECK IN ('UNIDADES','PORCIONES','SIN_CONTROL')`), `foto_clave text null`, `orden integer`, `activo boolean`. `CHECK`: `se_vende_solo = (precio IS NOT NULL)`; `tipo = 'SIMPLE' OR (se_vende_solo AND estacion_id IS NULL)`. Único `(empresa_id, lower(nombre))`. Índice `(empresa_id, familia_id, orden)`.
- **`producto_sucursal`** (ajuste): `producto_id`, `sucursal_id` (FK compuestas), `precio numeric(10,2) null` (`CHECK > 0`), `disponible boolean`. Único `(producto_id, sucursal_id)`. Sin fila = precio de la empresa y disponible.
- **`producto_agotado`**: `producto_id`, `sucursal_id` (FK compuestas), `desde timestamptz`, `dia_operativo date`, `hasta` (`CHECK IN ('FIN_DEL_DIA','REACTIVAR')`), `origen` (`CHECK IN ('MANUAL','SIN_STOCK')`). Único `(producto_id, sucursal_id)`. Reactivar borra la fila (queda en la auditoría); un agotado vencido puede quedar como fila sin efecto hasta el siguiente marcado.
- **`grupo_modificadores`**: `nombre` (1 a 60), `seleccion` (`CHECK IN ('UNICA','MULTIPLE')`), `minimo smallint`, `maximo smallint`, `activo boolean`. `CHECK (minimo >= 0 AND maximo BETWEEN 1 AND 50 AND minimo <= maximo AND (seleccion = 'MULTIPLE' OR maximo = 1))`. Único `(empresa_id, lower(nombre))`.
- **`modificador`**: `grupo_id` (FK compuesta), `nombre` (1 a 60), `precio_extra numeric(10,2)` (`CHECK >= 0`, por defecto 0), `producto_id null` (FK compuesta, producto ligado), `orden integer`, `activo boolean`. Único parcial `(grupo_id, lower(nombre)) WHERE activo`.
- **`producto_grupo`**: `producto_id`, `grupo_id` (FK compuestas), `orden integer`. Único `(producto_id, grupo_id)`.
- **`componente_combo`**: `combo_id` (FK compuesta a `producto`), `producto_id` (FK compuesta a `producto`), `cantidad smallint` (`CHECK BETWEEN 1 AND 99`), `orden integer`. Único `(combo_id, producto_id)`; `CHECK (combo_id <> producto_id)`.
- **`menu_del_dia_opcion`**: `sucursal_id`, `producto_id` (el menú), `modificador_id` (FK compuestas), `dia_operativo date`. Único `(sucursal_id, producto_id, dia_operativo, modificador_id)`. Índice `(sucursal_id, dia_operativo)`.

Las reglas entre tablas (que un componente o un producto ligado sea `SIMPLE`, que un producto usado así no cambie a combo o menú, que un `SIMPLE` no tenga componentes ni un no-menú opciones del día, que una opción del día sea de un grupo del menú, que la estación o la familia estén activas) las valida el servicio dentro de la transacción; la base garantiza la empresa con las llaves compuestas. `producto.tipo` se puede actualizar (criterio 10b): el mismo `UPDATE` deja `estacion_id` nulo si pasa a combo o menú (lo exige el `CHECK`), y en la misma transacción se borran las filas de `componente_combo` (si pasa a simple) y de `menu_del_dia_opcion` (si deja de ser menú). No hace falta ninguna columna ni migración nueva para esto.

## Fuera de alcance

- Asociar estaciones a impresoras o KDS por sucursal, el ruteo de la comanda, el comandero y el KDS (sección 3).
- Stock: cargar porciones, descontar, bloquear la venta en cero, el agotado automático, el cierre del día con sobrantes (merma o día siguiente, configurable por producto: la sección 6 agrega esa columna a `producto` por el módulo de carta), kardex y stock mínimo (sección 6).
- La carta web pública y su ruta sin sesión, colores, logo y vista previa (sección 5).
- Socket.IO, salas y autenticación del socket (sección 3; decisión 2).
- Importar la carta desde Excel (decisión 3).
- Que el Cajero marque agotados o arme el menú del día: la fila "Marcar agotados (86)…" de la matriz no cambia (decisión 5).
- Base imponible, IGV, ICBPER, descuentos, cortesías y redondeos (sección 4); la tasa de IGV del emisor.
- Precios distintos por canal (fuera del MVP), recetas e insumos (fuera del MVP).
- Horarios por producto (por ejemplo, desayunos solo de mañana): no está en los documentos.
- Borrar estaciones, familias, productos, grupos o modificadores: se desactivan.
- Limpieza periódica de fotos huérfanas en el almacén (riesgo anotado en el plan).
- Varias fotos por producto, recorte o edición de la foto.

## Impacto en especificaciones anteriores

- **002, criterio 113 y 001, criterio 38:** sus pruebas recorren el catálogo y cubren solas las tablas nuevas; no se tocan.
- **002, criterio 1:** la lista cerrada de rutas públicas no cambia (esta sección no agrega rutas públicas). En desarrollo, las fotos del almacén en disco se sirven en `/archivos/*` con un servidor estático de Express montado fuera del enrutador de Nest y solo con `ARCHIVOS_DRIVER=disco` y `NODE_ENV=development` (la API no arranca con `disco` en otro entorno), así que no es una ruta de Nest ni aparece en la prueba del criterio 1, que corre con `test`.
- **`crearAplicacion`:** gana dos opciones; las llamadas existentes no cambian.
- **`SucursalesConsultaService`:** gana `horaCorte`; los métodos existentes no cambian.
- **CORS (002):** se agrega `If-None-Match` a las cabeceras permitidas y `ETag` a las expuestas.
- **`packages/dominio`:** suma `decimal.js` como dependencia (ya la usa `apps/app`).
- **002, criterio 43 y tabla de la matriz en "Reglas de negocio" (decisión 5 de esta sección):** la fila `EDITAR_CARTA` pasa a `permitido` para el Cajero. Tres archivos de pruebas protegidas de 002 afirman la celda anterior y hay que ajustarlos; lo hace test-writer en la fase B (tarea P0), nunca quien implementa, y el orquestador los excluye de la comprobación con `git diff` solo por ese cambio:
  - `packages/dominio/test/permisos.spec.ts`: la fila `EDITAR_CARTA` de la tabla de la prueba pasa a `[x, p, x, x, p]`.
  - `apps/api/test/acceso/pin.spec.ts` (criterio 42 de 002, "un Cajero ve la matriz de su rol"): `EDITAR_CARTA: 'permitido'`.
  - `apps/api/test/acceso/clave-supervisor.spec.ts` (criterios 46 y 48 de 002): usa `EDITAR_CARTA` como "acción prohibida para el Cajero" en el controlador sonda (`@Permiso('EDITAR_CARTA')` de la ruta `prohibido`) y en `POST /autorizaciones`; pasa a `ADMINISTRAR`, que conserva la misma fila `[x, x, x, x, p]`, así que las pruebas siguen probando lo mismo.
  La tabla de 002 ("Reglas de negocio") queda desactualizada en esa celda; el orquestador decide si la anota (ver "Cambios propuestos a los documentos compartidos").
- **002, `SesionesService`:** la carta usa `sucursalesElegibles(usuarioId, esAdministrador)` (ya exportado) para conocer el rol en la sucursal ajustada (criterio 19b); no cambia.

## Notas para otras secciones

- **Sección 3 (Salón, Cocina e Impresión):**
  - Guardar en el ítem la `lineaPreparada` de `prepararLinea` (nombre, tipo, precios, modificadores con su precio extra, componentes, estaciones, afectación e ICBPER) para que un cambio de la carta, incluido un cambio de tipo (criterio 10b), no altere ventas pasadas ni comandas ya enviadas.
  - Rechazar al comandar un producto no vendible o una selección inválida, y probarlo en sus pruebas protegidas de "Enviar comanda" (incluido un producto que se agota entre que el mozo lo elige y lo envía).
  - Rutear cada componente y cada producto ligado a su propia estación (`estacionId` de la línea preparada); un producto sin estación no genera comanda.
  - Traer Socket.IO con el adaptador de PostgreSQL, implementar `PublicadorEventos` con salas por empresa y sucursal, y revisar la nota de 001 sobre `LISTEN`/`NOTIFY` como canal lateral entre empresas.
  - Asociar las estaciones de la empresa a impresoras o KDS de cada sucursal (RF-19, segunda parte).
- **Sección 5 (Pedidos web):** publicar la carta con `cartaDeSucursal`, ocultando `vendible: false` y `seVendeSolo: false` (RF-41); escuchar `carta.disponibilidad` o refrescar con `ETag`; volver a validar con `prepararLinea` al confirmar el pedido. Las fotos ya tienen URL pública.
- **Sección 6 (Inventario):** leer `tipoControlStock` de la carta; llamar `CartaDisponibilidadService.marcarAgotado` con `origen: 'SIN_STOCK'` al llegar a cero porciones (RF-70) y `reactivar` al cargar porciones; agregar a `producto`, por el módulo de carta, el destino de los sobrantes (merma o día siguiente, RF-73); descontar los componentes y los productos ligados de la línea preparada (RF-68).
- **Sección 4 (Caja y comprobantes):** usar `afectacionIgv` y `aplicaIcbper` de la línea guardada; el desglose de IGV y el ICBPER se calculan ahí con la tasa vigente del emisor.
- **Importación desde Excel (diferida, decisión 3):** reutilizar `EstacionesService`, `FamiliasService`, `ProductosService` y `GruposService` dentro de un contexto de empresa con actor de sistema `cli:importar-carta` o el superadministrador en soporte, para que la auditoría y la trazabilidad queden igual.

## Preguntas abiertas

Ninguna. Las doce preguntas del borrador se respondieron el 2026-10-28 (ver "Decisiones del usuario").

## Cambios propuestos a los documentos compartidos

El orquestador los lleva a los documentos compartidos (paso 8 del flujo). Texto propuesto, según las decisiones del 2026-10-28:

- **Documento de diseño, "Roles y permisos"** (decisión 5):
  - La fila "Editar la carta y los precios" cambia la celda del Cajero de "—" a "✓", con la nota "el Cajero cambia el precio y la disponibilidad por sucursal solo en las sucursales donde es Cajero". Queda: Mozo —, Cajero ✓ (con la nota), Cocina/Barra —, Supervisor —, Administrador ✓.
  - Agregar debajo de la tabla: "Las estaciones de producción y su asociación a impresoras o KDS las define solo el Administrador".
  - La fila "Marcar agotados (86) y cargar porciones del día" pasa a "Marcar agotados (86), cargar porciones del día y elegir las opciones del menú del día", con las mismas celdas (Cocina/Barra, Supervisor y Administrador).
- **HU-05 y HU-06:** "Como administrador…" pasa a "Como administrador o cajero…"; en HU-06 agregar el criterio "El cajero solo cambia el precio y la disponibilidad en las sucursales donde es cajero".
- **RF-15:** agregar "; el cajero, solo en las sucursales donde lo es".
- **RF-14** (decisiones 11 y 12, y tipo editable): "… estación de producción (o ninguna), tipo de control de stock y si se vende solo. El tipo de producto (simple, combo o menú del día) se puede cambiar".
- **Documento de diseño, "Modelo de datos", fila Carta:** agregar "Agotado por sucursal" y "Opción del menú del día (por sucursal y día)"; y en "Decisiones del modelo": "Las opciones de un combo y los platos del menú del día son modificadores ligados a productos" y "El tipo de un producto se puede cambiar: lo que deja de aplicar (componentes, estación, opciones del día) se quita con confirmación y queda en la auditoría; las ventas guardan su propia copia. Un producto usado como componente u opción de un combo no puede pasar a combo".
- **RF-20** (decisión 4): "Marcar productos como agotados (86) por el día o hasta reactivarlos, y reactivarlos".
- **RF-18** (decisión 5): "Armar el menú del día como un combo cuyas opciones se eligen cada día en cada sucursal".
- **RF-21** (decisión 3): sin cambio de texto; anotar en el documento que se hace como herramienta de nuestro equipo en una sección posterior.
- **`specs/002-plataforma-y-acceso/spec.md`** (no es un documento compartido; lo decide el orquestador): anotar en la tabla de la matriz de "Reglas de negocio" que la fila `EDITAR_CARTA` cambió para el Cajero con la decisión 5 de 003.

## Decisiones del usuario

No quedan preguntas abiertas. Respuestas del usuario a la versión en borrador (2026-10-28). Se conserva la numeración de las preguntas; los criterios las citan como "decisión N".

1. **Fotos (RF-14), aprobada la recomendación:** en Cloudflare R2, como dice el documento de diseño, detrás de un conector (disco en desarrollo, memoria en pruebas). Costo esperado S/ 0: R2 no cobra la salida de datos y su capa gratuita incluye 10 GB al mes; 30 empresas con unas 150 fotos de unos 200 KB son menos de 1 GB. La PWA reduce la foto en el celular a 1200 px de lado mayor en JPEG (unos 150 a 300 KB); la API acepta JPEG, PNG o WebP de hasta 1 MB y de 200 a 2048 px por lado; una foto por producto; URL pública (criterios 14 a 17 y 74).
2. **Tiempo real para el agotado (HU-09), aprobada la recomendación:** aquí solo el contrato de los eventos y un puerto que los publica después de confirmar, sin transporte, más la vista con `ETag` que Disponibilidad refresca cada 15 s; Socket.IO con el adaptador de PostgreSQL entra en la sección 3, donde se ataca su aislamiento entre empresas (criterios 46, 49, 54 y 80).
3. **Importar la carta desde Excel (RF-21), aprobada la recomendación:** se difiere a una sección corta antes del primer cliente, como herramienta de nuestro equipo (script o soporte) con una plantilla fija, sin pantalla para el Administrador.
4. **Cuánto dura un agotado (RF-20), aprobada la recomendación:** al marcarlo se elige "Solo por hoy" (por defecto; vuelve solo en la siguiente hora de corte de la sucursal) o "Hasta que lo reactive" (criterios 39 a 44 y 77).
5. **Menú del día y permisos de la carta (RF-18), aprobada la recomendación con un cambio en los permisos:**
   - Menú del día, como se recomendó: es por sucursal; cada día, en cada sucursal, Cocina/Barra, el Supervisor o el Administrador eligen cuáles candidatos se ofrecen; se puede armar desde la víspera; a la hora de corte empieza un día sin opciones y el menú no se vende hasta armarlo, con "Repetir las de ayer" (criterios 34 a 38 y 76).
   - **Cambio del usuario:** "No solo el administrador define los productos y precios. En realidad también puede hacerlo caja. Dale ese permiso." Alcance elegido: **"Toda la carta, precios solo de su sucursal"**:
     - El **Cajero** crea y edita productos (incluido el precio de la empresa, la foto, el tipo y desactivarlos), familias, grupos de modificadores, combos y la definición del menú del día (precio, tiempos, platos candidatos y recargos), para toda la empresa, igual que el Administrador (criterios 33 y 61b).
     - El **precio por sucursal y la disponibilidad por sucursal** los cambia el Cajero solo en las sucursales donde tiene el rol de Cajero; el Administrador, en todas (criterio 19b).
     - Las **estaciones** de producción las sigue definiendo solo el Administrador (criterio 2b).
     - Todo queda en la auditoría con el autor (criterio 62).
     - La fila "Editar la carta y los precios" de la matriz pasa de "—" a "✓" para el Cajero, con la restricción de precios por sucursal (criterio 60). El Supervisor no cambia: no edita la carta.
     - La fila "Marcar agotados (86)…" no cambia: el Cajero no marca agotados ni elige las opciones del día.
6. **Grupos de modificadores reutilizables (RF-16), aprobada la recomendación:** un grupo se define una vez y se asigna a varios productos; cambiarlo cambia todos (criterio 28).
7. **Combos dentro de combos (RF-17), aprobada la recomendación:** no; los componentes y los productos ligados son siempre productos simples, y las opciones de un combo son grupos de modificadores ligados a productos (criterios 9, 26, 32 y 10c).
8. **Reglas de precios, aprobada la recomendación:** (a) el precio de una sucursal es cualquier monto mayor que 0, sin límite respecto del de la empresa; (b) el precio extra de un modificador es 0 o más, sin negativos; (c) solo el precio del producto (también el del combo y el del menú) cambia por sucursal; los precios extra y los recargos son los mismos en todas; (d) un modificador se elige como máximo una vez por línea (criterios 19, 24, 56 y 57).
9. **Familias y orden, aprobada la recomendación:** una sola familia por producto; orden manual de familias y productos con subir y bajar, el mismo en todas las sucursales y en la carta web; lo ordenan el Administrador y el Cajero (criterios 3 a 5 y 13).
10. **Afectación tributaria (RF-14), aprobada la recomendación:** `GRAVADO` (por defecto), `EXONERADO` o `INAFECTO`, más la marca "Aplica ICBPER"; por producto, igual en todas las sucursales; la eligen el Administrador o el Cajero en "Datos tributarios", plegado. Las cortesías y el monto del ICBPER los define la sección 4 (criterios 6 y 72).
11. **Productos sin estación, aprobada la recomendación:** la estación se elige siempre, con la opción "Ninguna (no va a cocina ni a barra)"; esos productos no generan comanda (criterios 6, 7 y 72).
12. **Productos que no se venden solos, aprobada la recomendación:** la marca "Se vende solo" (sí por defecto); si no, el producto no lleva precio, no aparece en el comandero ni en la carta web, y sí en Disponibilidad y como componente u opción (criterios 6, 7, 10d y 48).

**Decisiones del especificador del borrador:** aprobadas por el usuario el 2026-10-28, salvo "el tipo de producto no cambia después de crearlo". El usuario: "yo creo que el tipo de producto sí se puede editar claramente". El tipo se puede cambiar (criterios 10b y 10c); el resto sigue:

- **Agotado separado de la disponibilidad:** "no disponible en la sucursal" es configuración del Administrador (o del Cajero de esa sucursal) y no vence; "agotado" es operación diaria de Cocina y vence (RF-15 y RF-20 los nombran por separado). Van en tablas distintas para que el permiso y la trazabilidad de cada uno no se mezclen.
- **Se auditan el agotado y el armado del menú del día**, además de los cambios de configuración de RF-13: permiten saber quién sacó un plato de la venta. Son pocos por día.
- **Nada se borra:** estaciones, familias, productos, grupos y modificadores se desactivan, porque las ventas y el menú los referencian. Desactivar una estación, una familia o un grupo en uso responde `EN_USO`; un producto se puede desactivar aunque sea componente, y sus combos dejan de venderse con motivo.
- **Límites de cordura:** 10 grupos por producto, 20 componentes por combo, 50 modificadores por grupo, cantidad de componente de 1 a 99 y de línea de 1 a 999. Evitan errores de tipeo y respuestas enormes; se pueden subir sin cambiar el modelo.
- **Precio solo con 2 decimales y mayor que 0** (`montoSchema` de 002); el precio extra admite 0.
- **Un producto nuevo nace disponible en todas las sucursales** salvo las que se desmarquen en el formulario; una sucursal nueva ofrece toda la carta activa.
- **La carta no depende de un módulo del plan** (`@RequiereModulo`): todo plan la necesita, y el catálogo de módulos de 002 no la incluye.
- **`GET /carta/sucursal` es una sola vista para todos los roles**, con `ETag`, en lugar de una por rol: el comandero, Cocina y la carta web filtran lo que necesitan.

Precisiones del especificador derivadas de estas decisiones (para revisión del usuario; no cambian sus decisiones):

- **Estaciones solo del Administrador, con `ADMINISTRAR`:** no son inseparables de los productos. Quien crea o edita un producto solo elige una estación de la lista (el Cajero la lee con `GET /carta/estaciones`); crear, renombrar o desactivar una estación es configuración de la producción, que en la sección 3 se asocia a impresoras y KDS, como el resto de la configuración que la matriz da al Administrador (`ADMINISTRAR`: "usuarios, sucursales, equipos y configuración"). Se usa esa acción existente en lugar de una nueva, así la matriz sigue siendo la única fuente (criterio 2b).
- **Precio y disponibilidad por sucursal van juntos:** comparten la ruta, la fila (`producto_sucursal`), la pantalla ("Precio por sucursal") y la auditoría, y los dos deciden qué vende cada local (RF-15 y HU-06 los nombran juntos). Separarlos obligaría a partir la ruta y la pantalla sin que el usuario lo pidiera; por eso la restricción del Cajero vale para los dos, y también para `noDisponibleEn` del alta, que es la disponibilidad inicial (criterio 19b).
- **La restricción se mira en la sucursal ajustada, no en la activa:** el permiso de la ruta sale del rol en la sucursal activa (002) y, además, el rol en la sucursal ajustada debe tener `EDITAR_CARTA` como `permitido`. Así la regla sale de la matriz (no hay una lista aparte de "roles que ajustan precios") y un Cajero de S1 y S2 ajusta las dos desde cualquiera de ellas (criterio 19b).
- **Precio de la empresa:** "toda la carta" incluye el precio de la empresa (sin él no se puede crear un producto, y la definición del menú del día incluye su precio). "Precios solo de su sucursal" se aplica al precio propio de cada sucursal (criterios 19b y 61b; caso límite del precio efectivo de S2).
- **Cambio de tipo: lo que deja de aplicar se borra con confirmación**, en lugar de conservarlo desactivado: es lo más simple y seguro porque las ventas guardan su propia copia (criterio 52), no deja datos ocultos que reaparezcan al volver al tipo anterior, y la auditoría guarda exactamente lo borrado. La confirmación es un `409 CONFIRMACION_REQUERIDA` con la lista exacta, y se repite el `PATCH` con `confirmarPerdida: true` (criterio 10b).
- **Al pasar a simple se exige elegir la estación** en el mismo cambio, para que un combo no quede como simple "sin estación" por omisión y deje de ir a cocina sin que nadie lo decida (criterio 10b).
- **Uso en otros combos:** se cuentan los componentes de combos activos e inactivos y los modificadores activos (de grupos activos o no); reactivar un modificador o un grupo vuelve a validar su producto ligado (criterios 10c y 27).
- **Dejar de venderse solo con precios de sucursal** responde 409 en lugar de borrarlos: así el Cajero no puede borrar de paso el precio de una sucursal donde no es Cajero, y nunca queda un precio de sucursal en un producto sin precio (criterio 10d).
