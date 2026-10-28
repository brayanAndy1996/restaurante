# 003 · Carta

- **Historias y requerimientos:** HU-05, HU-06, HU-07, HU-08, HU-09; RF-14 a RF-20 (RF-19 solo en lo que toca a definir las estaciones; su asociación a una impresora o a un KDS va en la sección 3). RF-21 (importar desde Excel) se propone para después (pregunta 3). RF-13 en lo que toca a los cambios de configuración de la carta. RNF que aplican: RNF-03, RNF-06, RNF-09, RNF-10, RNF-11, RNF-13, RNF-14, RNF-17, RNF-18, RNF-20. Fuente de negocio: `fuentes.md` de esta carpeta (extracto de los documentos compartidos, rev. 18 y 17) y, para el contexto general, `specs/002-plataforma-y-acceso/fuentes.md`.
- **Ruta crítica:** sí, en parte (propuesta del especificador; la confirma el orquestador en el paso 3). Ver "Clasificación de ruta crítica".
- **Estado:** borrador (2026-10-28). Tiene preguntas abiertas: los criterios que dependen de una respuesta están escritos con la recomendación y lo dicen.

## Objetivo

Que el Administrador arme la carta de su empresa (estaciones, familias, productos con foto, precio con IGV, afectación tributaria, estación y tipo de control de stock, grupos de modificadores, combos y menú del día) y la ajuste por sucursal (precio y disponibilidad), y que Cocina/Barra, el Supervisor o el Administrador marquen un plato como agotado (86) en su sucursal para que nadie lo venda. La sección deja además los contratos que van a consumir el comandero (sección 3), el inventario (sección 6) y la carta web (sección 5): la vista de la carta de cada sucursal con precios efectivos y disponibilidad, el armado de una línea de venta con sus modificadores y componentes, y los avisos de cambios.

## Límites con otras secciones

| Tema | Entra aquí | Queda para | Lo que esta sección deja listo |
| --- | --- | --- | --- |
| Estaciones (RF-19) | Definirlas por empresa (nombre, activa) y asignarlas a cada producto | Sección 3: asociar cada estación, en cada sucursal, a una impresora o a un KDS, y el ruteo de la comanda | `estacionId` en cada producto, en cada componente y en cada producto ligado de la línea preparada (criterio 52) |
| Stock (RF-67 a RF-74) | El tipo de control de stock de cada producto (`UNIDADES`, `PORCIONES`, `SIN_CONTROL`) y el agotado manual (RF-20) | Sección 6: llevar y descontar stock, cargar porciones, bloquear la venta en cero, el agotado automático (RF-70), el cierre del día con sobrantes, kardex y stock mínimo | `tipoControlStock` en la línea preparada; `CartaDisponibilidadService.marcarAgotado` con origen `SIN_STOCK` para el agotado automático (criterio 53); columna `origen` del agotado |
| Comandero | Nada de la pantalla del mozo | Sección 3: elegir productos, modificadores y opciones, enviar la comanda y guardar la venta como era | `GET /carta/sucursal` (criterio 47) y `CartaVentaService.prepararLinea` (criterio 52), que valida la selección y calcula el precio con `packages/dominio` |
| Carta web (RF-40 a RF-42) | Nada público | Sección 5: la ruta pública por empresa y sucursal, ocultar lo agotado o no disponible (RF-41) y el pedido del cliente | `CartaVentaService.cartaDeSucursal` (la misma vista de `GET /carta/sucursal`, con `vendible` y `seVendeSolo` para filtrar), `fotoUrl` pública y el evento `carta.disponibilidad` |
| Tiempo real | El contrato de los eventos y un puerto para publicarlos después de confirmar; la PWA refresca la vista con `ETag` (recomendación, pregunta 2) | Sección 3: Socket.IO con el adaptador de PostgreSQL, autenticación del socket y salas | `PublicadorEventos` en `apps/api/src/nucleo/eventos/` y los eventos `carta.disponibilidad` y `carta.actualizada` (criterios 46 y 54) |
| Importar desde Excel (RF-21) | No (recomendación, pregunta 3) | Una sección corta antes del primer cliente, como herramienta de nuestro equipo | Los servicios de la carta, que la importación reutilizará |
| Montos | Precio con IGV del producto, precio por sucursal, precio extra del modificador (que es también el recargo de una opción de combo o del menú) y el precio de una línea con sus modificadores, en `packages/dominio` con `decimal.js` | Sección 4: base imponible, IGV por línea, ICBPER, descuentos, cortesías, redondeos y división de cuenta, con la tasa vigente del emisor | `afectacionIgv` y `aplicaIcbper` en cada producto y en la línea preparada |

## Clasificación de ruta crítica

Propuesta del especificador. `CLAUDE.md` deja fuera de la ruta crítica el "mantenimiento simple de carta", y dentro el aislamiento entre empresas, el cálculo de montos y los permisos con su auditoría.

| Parte | Crítica | Motivo |
| --- | --- | --- |
| Reglas puras de montos de `packages/dominio`: precio efectivo por sucursal, validación de la selección de modificadores (mínimos, máximos, única o múltiple) y precio de una línea con sus modificadores y opciones (criterios 55 a 58) | sí | Cálculo de montos: es el precio que cobrará el comandero y que llegará al comprobante. |
| Aislamiento de las tablas nuevas y de las referencias entre empresas, incluidas las fotos y los eventos (criterios 64 a 69) | sí | Aislamiento entre empresas (RLS). |
| Quién edita la carta y los precios, quién marca agotados y arma el menú del día, en qué sucursal, y la auditoría de los cambios de precio (criterios 60 a 62) | sí | Permisos y auditoría: un precio cambiado por quien no debe, o sin rastro, es dinero. |
| Trazabilidad de las tablas nuevas (criterio 63) | sí, ya cubierta | La prueba de catálogo del criterio 113 de 002 recorre `pg_catalog` y falla si una tabla nueva no la cumple; no hace falta una prueba protegida nueva. |
| CRUD de estaciones, familias, productos, grupos, combos, menú del día, fotos y ajustes (criterios 1 a 38, salvo lo citado arriba) | no | Mantenimiento simple de carta. Pruebas de integración del desarrollador. |
| Agotado, vista de la sucursal, `prepararLinea`, eventos y disponibilidad (criterios 39 a 54, 59) | no | No está en la lista. Lo que sí es crítico de ellos (que un agotado no se pueda comandar, el descuento de stock de combos y modificadores) lo prueba la sección 3 en "Enviar comanda" (ver "Notas para otras secciones"). |
| Interfaz de la PWA (criterios 70 a 80) | no | Interfaz; la seguridad y los montos los impone la API con `packages/dominio`. |

## Glosario

- **Estación de producción:** lugar que prepara un producto (Cocina, Barra, Parrilla). Se define por empresa. En la sección 3, cada sucursal la asocia a una impresora o a un KDS.
- **Familia:** grupo de la carta (Entradas, Fondos, Bebidas). Cada producto pertenece a una sola (pregunta 9). Tienen un orden manual, el mismo en todas las sucursales.
- **Producto:** lo que se vende o se prepara. Tipos: `SIMPLE`, `COMBO` y `MENU_DEL_DIA`. El tipo se elige al crearlo y no cambia.
- **Se vende solo:** marca de un producto simple que aparece como ítem en el comandero y la carta web. Uno que no se vende solo (por ejemplo, el "Ají de gallina" que solo sale en el menú) no tiene precio y solo se usa como componente o producto ligado (pregunta 12).
- **Precio:** precio de venta con IGV, en soles, con 2 decimales, de la empresa. **Precio de la sucursal:** el que lo reemplaza en una sucursal, si el Administrador lo fijó. **Precio efectivo:** el de la sucursal si existe; si no, el de la empresa.
- **Disponible en la sucursal:** el Administrador decide si un producto se ofrece en cada sucursal (RF-15). Es configuración y no vence.
- **Agotado (86):** marca temporal en una sucursal, que pone Cocina/Barra, el Supervisor o el Administrador (RF-20). Dura hasta el fin del día operativo o hasta que alguien lo reactive (pregunta 4). En la sección 6 también lo pondrá el sistema al llegar a cero porciones.
- **Grupo de modificadores:** conjunto de opciones que se eligen para un producto ("Término de la carne", "Bebida del combo"), con selección única o múltiple, mínimo y máximo; es obligatorio cuando el mínimo es 1 o más. Se define una vez y se asigna a varios productos (pregunta 6).
- **Modificador:** una opción de un grupo ("3/4", "Inca Kola"), con precio extra opcional (0 o más) y, opcional, un **producto ligado**: el producto que se prepara en su estación y cuyo stock se descuenta al elegirlo.
- **Combo:** producto con precio fijo, **componentes** fijos (productos simples con cantidad) y **opciones**: las opciones de un combo son grupos de modificadores asignados al combo, cuyos modificadores suelen estar ligados a productos; su precio extra es el monto que "suma" la opción (HU-08). Así lo prevé el modelo de datos del documento de diseño, que no tiene una entidad aparte para las opciones.
- **Menú del día:** combo (tipo `MENU_DEL_DIA`) cuyos grupos son los tiempos (Entrada, Segundo) y cuyos modificadores son los platos candidatos, con su recargo. Cada día, en cada sucursal, se eligen cuáles de los candidatos se ofrecen: las **opciones del día** (pregunta 5).
- **Día operativo:** la fecha de negocio de una sucursal según su hora de corte (`diaOperativo(instante, horaCorte)` de 001).
- **Vendible:** que un producto se puede comandar ahora en la sucursal: activo, disponible, no agotado, con sus componentes disponibles y con suficientes opciones disponibles en cada grupo obligatorio. Si no, lleva un **motivo**.
- **Vista de la sucursal:** la carta de una sucursal tal como la ven los que venden y Cocina: `GET /carta/sucursal`.
- **Línea preparada:** lo que devuelve `prepararLinea` para un producto, su selección y su cantidad: precios calculados y todo lo que la venta debe guardar como era (sección 3).

## Criterios de aceptación

Salvo que se diga otra cosa: hay dos empresas, **A** y **B**, dadas de alta por la vía de plataforma, cada una con al menos dos sucursales (S1 y S2 en A) y usuarios de cada rol (historia 002); "el Administrador" significa una sesión de un Administrador de A; las horas se controlan con el reloj de la API y son de Lima; toda respuesta de error tiene la forma `{ codigo, mensaje, campos? }` y nunca incluye detalles de PostgreSQL; los montos viajan como texto decimal con 2 decimales (`"28.00"`) y se guardan en `NUMERIC(10,2)`. Las rutas de administración usan `@Permiso('EDITAR_CARTA')` (criterio 60) y aceptan `Idempotency-Key` en los `POST` (criterio 85 de 002); un campo desconocido en una entrada responde 400 `DATOS_INVALIDOS`, y ninguna entrada acepta `empresaId`, `creadoPor*` ni `actualizadoPor*`.

### Estaciones (RF-19)

1. **Crear.** `POST /carta/estaciones` con `{ nombre }` responde 201 `estacionRespuesta` `{ id, nombre, activa, productosActivos, creadoEn, actualizadoEn }`. El nombre es un texto de 1 a 50 caracteres (`textoSchema`), único en la empresa sin distinguir mayúsculas: repetido responde 409 `CONFLICTO`; el mismo nombre en B no choca.
2. **Consultar y editar.** `GET /carta/estaciones` devuelve las estaciones de la empresa ordenadas por nombre, con `productosActivos` (cuántos productos activos la usan). `PATCH /carta/estaciones/:id` con `{ nombre?, activa? }` (al menos uno) responde 200. Desactivar una estación que usan productos activos responde 409 `EN_USO` con la cantidad en el mensaje y nada cambia. Una estación inactiva no se puede asignar (criterio 9). No se borran.

### Familias (RF-14)

3. **Crear.** `POST /carta/familias` con `{ nombre }` (1 a 60, único en la empresa sin distinguir mayúsculas; 409 `CONFLICTO`) responde 201 `familiaRespuesta` `{ id, nombre, orden, activa, productos, creadoEn, actualizadoEn }`; queda la última del orden.
4. **Consultar y editar.** `GET /carta/familias` las devuelve en su orden, con `productos` (cuántos productos activos tiene). `PATCH /carta/familias/:id` con `{ nombre?, activa? }`. Desactivar una familia con productos activos responde 409 `EN_USO`. No se borran.
5. **Ordenar.** `PUT /carta/familias/orden` con `{ ids }` responde 200 con la lista en el orden nuevo. `ids` debe contener exactamente una vez cada familia de la empresa (activas e inactivas); con un id faltante, repetido, inexistente o de B responde 400 `DATOS_INVALIDOS` con el mismo cuerpo y nada cambia (pregunta 9).

### Productos (HU-05, RF-14)

6. **Crear.** `POST /carta/productos` con `productoCrearEntrada` responde 201 `productoRespuesta`:
   `{ tipo, nombre, descripcion?, familiaId, precio?, seVendeSolo?, afectacionIgv?, aplicaIcbper?, estacionId?, tipoControlStock, gruposModificadores?, componentes?, noDisponibleEn? }`.
   - `tipo`: `SIMPLE`, `COMBO` o `MENU_DEL_DIA`.
   - `nombre`: 1 a 100, único en la empresa sin distinguir mayúsculas (409 `CONFLICTO`); `descripcion`: 1 a 500 o `null`.
   - `precio`: monto mayor que 0 (`montoSchema`), con IGV incluido.
   - `seVendeSolo`: por defecto `true`.
   - `afectacionIgv`: `GRAVADO` (por defecto), `EXONERADO` o `INAFECTO`; `aplicaIcbper`: por defecto `false` (pregunta 10).
   - `estacionId`: la estación que lo prepara, o `null` si no va a ninguna (pregunta 11).
   - `tipoControlStock`: `UNIDADES`, `PORCIONES` o `SIN_CONTROL`, obligatorio y sin valor por defecto, para que el Administrador lo elija (HU-05).
   - `gruposModificadores`: ids de grupos, en el orden en que se muestran (máximo 10).
   - `componentes`: `[{ productoId, cantidad }]` (cantidad entera de 1 a 99, máximo 20 componentes).
   - `noDisponibleEn`: ids de sucursales donde el producto nace no disponible (criterio 23).
   Queda el último de su familia.
7. **Reglas por tipo** (400 `DATOS_INVALIDOS` con `campos` si no se cumplen):
   - `SIMPLE`: `estacionId` presente (id o `null`); `componentes` no se envía o va vacío; si `seVendeSolo` es `true`, `precio` es obligatorio; si es `false`, `precio` debe ser `null` o no enviarse.
   - `COMBO`: `seVendeSolo` es `true`; `precio` obligatorio; `estacionId` `null` o sin enviar (cada componente y cada producto ligado va a su propia estación); al menos un componente o un grupo.
   - `MENU_DEL_DIA`: como `COMBO`, con al menos un grupo.
   - `tipoControlStock` vale para los tres tipos (el menú del día puede llevar porciones, como dice la tabla de inventario del diseño); su uso es de la sección 6.
8. **Repeticiones.** Un grupo o un componente repetido en la misma entrada responde 400 `DATOS_INVALIDOS`.
9. **Referencias.** `familiaId`, `estacionId`, cada grupo, cada `productoId` de componente y cada sucursal de `noDisponibleEn` deben existir en la empresa y estar activos; si no (inexistente, de B o inactivo), responde 422 `REFERENCIA_INVALIDA` con `campos` señalando el campo, con el mismo cuerpo para un id de B y uno inexistente, y nada se crea. Un componente debe ser un producto `SIMPLE` (un combo no contiene combos ni menús, pregunta 7): si no, 422 `REFERENCIA_INVALIDA`.
10. **Editar.** `PATCH /carta/productos/:id` con `productoModificarEntrada` (todos los campos del criterio 6 salvo `tipo` y `noDisponibleEn`, más `activo`; al menos uno) responde 200. Las listas enviadas (`gruposModificadores`, `componentes`) reemplazan a las anteriores completas. Enviar `tipo` responde 400. Se validan los criterios 7 a 9 sobre el resultado. Un `PATCH` que no cambia nada responde 200 sin fila de auditoría.
11. **Desactivar.** `PATCH { activo: false }` saca al producto de la vista de toda sucursal (criterio 48) y no deja asignarlo como componente ni como producto ligado (422); las referencias que ya tenía se conservan, y los combos que lo contienen dejan de ser vendibles con motivo `COMPONENTE_NO_DISPONIBLE` (criterio 59). Reactivarlo los devuelve. Los productos no se borran (las ventas de la sección 3 los referencian).
12. **Consultar.** `GET /carta/productos` devuelve `productoResumen[]` (`id`, `tipo`, `nombre`, `familiaId`, `precio`, `seVendeSolo`, `estacionId`, `tipoControlStock`, `fotoUrl`, `activo`, `orden`) de toda la empresa, ordenados por el orden de su familia y luego por el suyo. `GET /carta/productos/:id` devuelve `productoRespuesta`: todos los campos, los grupos asignados (`{ id, nombre }` en orden), los componentes (`{ productoId, nombre, cantidad }`) y `usadoEn` (`{ combos: [{ id, nombre }], modificadores: [{ id, nombre, grupoId, grupoNombre }] }`). Un id de B responde 404 `NO_ENCONTRADO` igual que uno inexistente.
13. **Ordenar productos.** `PUT /carta/familias/:id/productos/orden` con `{ ids }`, que debe contener exactamente una vez cada producto de esa familia, responde 200 con la lista ordenada; si no, 400 como el criterio 5. Un producto que cambia de familia queda el último de la nueva.

### Fotos de productos (RF-14)

Los límites dependen de la pregunta 1; los criterios usan la recomendación.

14. **Subir.** `PUT /carta/productos/:id/foto` con el archivo como cuerpo binario y `Content-Type` `image/jpeg`, `image/png` o `image/webp`, de hasta 1 MB (1 048 576 bytes), responde 200 `{ fotoUrl }`. La API comprueba el formato por el contenido (los primeros bytes), no solo por la cabecera, y lee el ancho y el alto: un archivo que no es una imagen de ese formato, o con algún lado menor de 200 o mayor de 2048 píxeles, responde 422 `FOTO_INVALIDA`; más de 1 MB, 413 `CUERPO_DEMASIADO_GRANDE`; otro `Content-Type`, 415 `TIPO_NO_SOPORTADO`. En ningún caso se guarda nada.
15. **Dónde se guarda.** La foto se guarda con el almacén de archivos (`AlmacenArchivos`, plan) bajo la clave `carta/<empresaId>/<productoId>/<uuid>.<ext>`, que arma la API con la empresa del contexto y un UUID nuevo (nunca con datos del cuerpo ni del nombre del archivo). `fotoUrl` es la URL pública de esa clave. Reemplazar la foto crea una clave nueva; la anterior se borra del almacén después de confirmar la transacción. Si la transacción no se confirma, el producto conserva su foto anterior y la anterior no se borra.
16. **Quitar.** `DELETE /carta/productos/:id/foto` responde 204 y borra el archivo después de confirmar; sin foto, 204 sin otro efecto ni auditoría.
17. **Otra empresa.** `PUT` o `DELETE` de la foto de un producto de B responde 404 igual que uno inexistente, y nada se guarda ni se borra en el almacén.

### Ajuste por sucursal (HU-06, RF-15)

18. **Consultar.** `GET /carta/productos/:id/sucursales` devuelve, para cada sucursal de la empresa (ordenadas por nombre), `{ sucursalId, nombre, precio, precioEfectivo, disponible, agotado }`, donde `precio` es el de la sucursal o `null`, y `agotado` dice si hay un agotado vigente (criterio 44).
19. **Ajustar.** `PUT /carta/productos/:id/sucursales/:sucursalId` con `{ precio, disponible }` (`precio`: monto mayor que 0 o `null` para usar el de la empresa) responde 200 con la fila del criterio 18. En un producto que no se vende solo, `precio` debe ser `null` (400). Repetir el mismo ajuste responde 200 sin auditoría nueva.
20. **Solo esa sucursal** (HU-06). Dado un producto con precio `"25.00"`, cuando el Administrador fija `"27.50"` y `disponible: false` en S1, entonces en S1 el precio efectivo es `"27.50"` y el producto no aparece en la vista de S1, y en S2 el precio efectivo sigue `"25.00"` y el producto sigue disponible.
21. **Cambio del precio de la empresa.** Dado ese estado, cuando el precio del producto pasa a `"26.00"`, entonces el precio efectivo de S2 pasa a `"26.00"` y el de S1 sigue `"27.50"`. Con `precio: null` en S1, el de S1 vuelve a ser el de la empresa.
22. **Sucursal de otra empresa.** Una `sucursalId` de B o inexistente responde 404 `NO_ENCONTRADO` con el mismo cuerpo, y nada cambia.
23. **Valores por defecto.** Un producto nuevo está disponible en todas las sucursales con el precio de la empresa, salvo en las de `noDisponibleEn`. Una sucursal nueva ofrece todos los productos activos con el precio de la empresa. Sin ajuste guardado, valen esos valores (no hace falta una fila por sucursal).

### Modificadores (HU-07, RF-16)

24. **Crear un grupo.** `POST /carta/grupos-modificadores` con `grupoEntrada` responde 201 `grupoRespuesta`:
    - `{ nombre, seleccion: 'UNICA', obligatorio, modificadores }`, o
    - `{ nombre, seleccion: 'MULTIPLE', minimo, maximo, modificadores }`.
    `nombre`: 1 a 60, único en la empresa sin distinguir mayúsculas (409). `modificadores`: de 1 a 50 elementos `{ id?, nombre, precioExtra?, productoId? }`, con `nombre` de 1 a 60, único dentro del grupo sin distinguir mayúsculas; `precioExtra` es un monto de 0 o más (`"0.00"` por defecto, sin negativos, pregunta 8); `productoId` es el producto ligado, o `null`. La respuesta es `{ id, nombre, seleccion, minimo, maximo, obligatorio, activo, modificadores: [{ id, nombre, precioExtra, producto: { id, nombre } | null, orden }], productos: [{ id, nombre }] }`, con los modificadores activos en su orden y los productos que usan el grupo.
25. **Mínimo, máximo y obligatorio** (RF-16). Con `UNICA`: `maximo` = 1 y `minimo` = 1 si `obligatorio`, 0 si no. Con `MULTIPLE`: `minimo` y `maximo` enteros con 0 ≤ `minimo` ≤ `maximo`, 1 ≤ `maximo` ≤ 50, y `minimo` no mayor que la cantidad de modificadores. En la respuesta, `obligatorio` = `minimo` ≥ 1. Si no se cumple: 400 `DATOS_INVALIDOS` con `campos`.
26. **Producto ligado** (HU-07). `productoId` debe ser un producto `SIMPLE` activo de la empresa; si no (inexistente, de B, inactivo, combo o menú), 422 `REFERENCIA_INVALIDA`. Es el producto que va a su estación y cuyo stock se descuenta cuando se elige el modificador (secciones 3 y 6, criterio 52).
27. **Editar un grupo.** `PATCH /carta/grupos-modificadores/:id` con los mismos campos (al menos uno; `seleccion` con sus campos). Si trae `modificadores`, la lista es la nueva lista completa y su orden: un elemento con `id` actualiza ese modificador (debe ser de este grupo; si no, 422 `REFERENCIA_INVALIDA`), uno sin `id` crea uno nuevo, y los que no aparecen pasan a inactivos (no se borran: las ventas y el menú del día los referencian). Se validan los criterios 24 a 26 sobre el resultado.
28. **Reutilizables** (pregunta 6). Un grupo se asigna a varios productos (criterio 6, `gruposModificadores`); un cambio en el grupo vale para todos ellos desde la siguiente lectura.
29. **Desactivar.** `PATCH { activo: false }` en un grupo asignado a productos activos responde 409 `EN_USO`; sin productos activos, lo desactiva. Un grupo inactivo no se puede asignar (422). `GET /carta/grupos-modificadores` lista los grupos (ordenados por nombre) y `GET /carta/grupos-modificadores/:id` devuelve uno; de B, 404.

### Combos y menú del día (HU-08, RF-17, RF-18)

30. **Combo** (HU-08). Un producto `COMBO` tiene precio fijo (ajustable por sucursal como cualquier producto), componentes fijos con su cantidad y grupos de opciones; el precio extra de una opción es el monto que suma. Ejemplo de referencia (el mismo del criterio 57): "Combo hamburguesa", `"22.90"`, componente "Hamburguesa clásica" × 1, grupo "Bebida" (única, obligatoria: Chicha `"0.00"`, Inca Kola `"0.00"`, Cerveza `"4.50"`) y grupo "Acompañamiento" (única, obligatoria: Papas `"0.00"`, Ensalada `"1.00"`).
31. **Cada componente a su estación** (HU-08). La línea preparada de un combo (criterio 52) trae cada componente y cada producto ligado de las opciones elegidas con su propia `estacionId` y su `tipoControlStock`; el combo no tiene estación propia.
32. **Sin anidar** (pregunta 7). Un componente o un producto ligado nunca es un `COMBO` ni un `MENU_DEL_DIA` (criterios 9 y 26), así que un combo no contiene otro combo ni se forma un ciclo.
33. **Menú del día: configuración** (RF-18). Un producto `MENU_DEL_DIA` lo configura el Administrador como un combo: precio, componentes fijos si los tiene (por ejemplo, el refresco) y grupos, uno por tiempo ("Entrada", "Segundo"), cuyos modificadores son los platos candidatos, normalmente ligados a productos por porciones, con su recargo como precio extra.
34. **Menú del día: consultar el día.** `GET /carta/sucursal/menu-del-dia?dia=AAAA-MM-DD` (sucursal activa) devuelve, por cada producto `MENU_DEL_DIA` activo y disponible en la sucursal, `{ productoId, nombre, precio (efectivo), dia, grupos: [{ id, nombre, minimo, maximo, opciones: [{ modificadorId, nombre, precioExtra, producto, elegida, disponible }] }] }`. `dia` es por defecto el día operativo actual de la sucursal (`diaOperativo` con su hora de corte); se aceptan el día anterior, el actual y el siguiente; otro día responde 400 `DATOS_INVALIDOS`.
35. **Menú del día: armar el día** (HU-08, "las opciones se cambian cada día"). `PUT /carta/sucursal/menu-del-dia/:productoId` con `{ dia?, opciones }` (`dia`: el actual por defecto, o el siguiente; `opciones`: ids de modificadores, sin repetir, puede ir vacía) reemplaza las opciones de ese día para ese menú en la sucursal activa y responde 200 con el elemento del criterio 34. Cada opción debe ser un modificador activo de un grupo activo asignado a ese menú; si no, 422 `REFERENCIA_INVALIDA`. Un producto que no es `MENU_DEL_DIA`, de B o inexistente responde 404. Repetir la misma lista responde 200 sin auditoría nueva.
36. **Cambio de día.** Dadas opciones elegidas para el día operativo D, cuando el reloj pasa la hora de corte de la sucursal, entonces el día operativo es D+1 y las opciones de D ya no valen: si D+1 no tiene opciones, el menú no es vendible con motivo `MENU_SIN_ARMAR` (criterio 59); si un grupo obligatorio no tiene opciones disponibles, con motivo `OPCIONES_INSUFICIENTES`. Las opciones armadas el día anterior para D+1 valen desde esa hora de corte. La PWA ofrece "Repetir las de ayer" (criterio 76).
37. **Por sucursal** (pregunta 5). Armar el menú en S1 no cambia el de S2.
38. **Quién arma el día** (pregunta 5, recomendación). Las rutas de los criterios 34 y 35 usan `@Permiso('GESTIONAR_DISPONIBILIDAD')` y `@RequiereSucursal()`: Cocina/Barra, Supervisor y Administrador; Mozo y Cajero reciben 403 `PROHIBIDO`. Los candidatos, el precio y los recargos solo los cambia el Administrador (criterio 33).

### Agotado (HU-09, RF-20)

39. **Marcar.** `PUT /carta/sucursal/agotados/:productoId` con `{ hasta }` (`FIN_DEL_DIA`, por defecto, o `REACTIVAR`; pregunta 4) marca el producto como agotado en la sucursal activa y responde 200 `agotadoRespuesta` `{ productoId, sucursalId, desde, hasta, diaOperativo, origen: 'MANUAL' }`. Vale para cualquier producto de la empresa, de cualquier tipo. Un producto de B o inexistente responde 404.
40. **Repetir.** Repetirlo con el mismo `hasta` y el agotado vigente responde 200 con lo mismo, sin auditoría ni evento nuevos; con otro `hasta`, lo cambia (con auditoría y evento). Si el agotado anterior ya había vencido, marcarlo es un agotado nuevo.
41. **Reactivar.** `DELETE /carta/sucursal/agotados/:productoId` responde 204 y el producto deja de estar agotado en la sucursal activa; si no lo estaba (o ya había vencido), 204 sin auditoría ni evento.
42. **Solo en su sucursal.** Marcar o reactivar en S1 no cambia S2. La sucursal es siempre la activa de la sesión (002): un Cocina/Barra con acceso solo a S1 no puede marcar en S2, y uno que es Cocina/Barra en S1 y Mozo en S2 recibe 403 con S2 activa.
43. **Quién.** Las rutas de los criterios 39 y 41 usan `@Permiso('GESTIONAR_DISPONIBILIDAD')` y `@RequiereSucursal()`: Cocina/Barra, Supervisor y Administrador; Mozo y Cajero, 403 `PROHIBIDO`; sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`.
44. **Vigencia** (pregunta 4, recomendación). Un agotado `FIN_DEL_DIA` vale mientras el día operativo de la sucursal sea el del momento en que se marcó; uno `REACTIVAR` vale hasta el `DELETE`. Ejemplos con hora de corte `05:00`: marcado el `2026-11-03T21:00-05:00` (día operativo 3), sigue agotado a las `2026-11-04T04:59-05:00` y deja de estarlo a las `2026-11-04T05:00-05:00`; marcado el `2026-11-04T02:00-05:00` (día operativo 3), deja de estarlo a las `2026-11-04T05:00-05:00`. No hace falta ninguna tarea programada: la vigencia se calcula al leer (`agotadoVigente`, criterio 59).
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

60. **Matriz sin cambios de filas.** Se usan las acciones que ya tiene `packages/dominio`: `EDITAR_CARTA` (solo Administrador) y `GESTIONAR_DISPONIBILIDAD` (Cocina/Barra, Supervisor y Administrador). Toda ruta de `/carta` lleva `@Permiso` con una de ellas: `GESTIONAR_DISPONIBILIDAD` en la lista cerrada `PUT` y `DELETE /carta/sucursal/agotados/:productoId`, `GET` y `PUT /carta/sucursal/menu-del-dia…`; ninguna en `GET /carta/sucursal` (cualquier rol con sucursal activa); `EDITAR_CARTA` en todas las demás, incluidas sus lecturas. La prueba recorre las rutas de `/carta` que Nest tiene registradas (no una lista fija) y falla si una ruta no está clasificada.
61. **Rechazos.** Dado cada rol sin el permiso (Mozo, Cajero, Cocina/Barra y Supervisor para `EDITAR_CARTA`; Mozo y Cajero para `GESTIONAR_DISPONIBILIDAD`), con sesión de contraseña y de PIN, cuando llama cada ruta, entonces responde 403 `PROHIBIDO`, y no cambia ninguna fila, no queda auditoría, no se guarda ni se borra ningún archivo y no se publica ningún evento. Las sesiones de soporte tienen permisos de Administrador, y lo que hacen queda trazado y auditado con el superadministrador (criterios 57 y 117 de 002). La carta funciona igual con la sucursal suspendida (criterio 82 de 002) y no se marca con `@RequiereModulo`: ningún módulo del catálogo la contiene.
62. **Auditoría.** Cada escritura de la lista "Acciones auditadas en esta sección" deja exactamente una fila en `auditoria`, en la misma transacción que el cambio, con la entidad, la sucursal cuando aplica y en `detalle` el antes y el después de los campos cambiados. Todo cambio de precio (precio del producto, precio de sucursal, precio extra de un modificador) guarda el antes y el después exactos como texto (`{ "precio": { "antes": "25.00", "despues": "26.00" } }`). Las escrituras que no cambian nada (criterios 10, 16, 19, 35, 40 y 41) no dejan fila.
63. **Trazabilidad.** Las tablas nuevas se crean con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`, así que la prueba de catálogo del criterio 113 de 002 las cubre sin cambios. Prueba de integración del desarrollador: un producto creado por el Administrador desde el equipo E queda con `creado_por_usuario_id` = él y `creado_por_equipo_id` = E; un agotado marcado por un Cocina/Barra queda con su usuario.

### Aislamiento entre empresas (ruta crítica)

64. **Catálogo.** Las tablas nuevas cumplen el criterio 38 de 001 y el 88 de 002 (RLS forzada, política `aislamiento_empresa`, política `acceso_plataforma` sin privilegios, llaves compuestas con `empresa_id`, sin `TRUNCATE`); las pruebas de catálogo existentes las recorren solas.
65. **Por tabla.** Para cada tabla nueva (`estacion`, `familia`, `producto`, `producto_sucursal`, `producto_agotado`, `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo`, `menu_del_dia_opcion`), con el contexto de A y un actor de A fijado: no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, y no se insertan filas con `empresa_id` de B (como el criterio 91 de 002). La prueba comprueba que el rechazo lo produce la política RLS y no la falta de actor.
66. **Referencias cruzadas en la base.** Con el contexto de A, insertar o actualizar una fila de A que apunte a una fila de B (producto con familia o estación de B; componente, producto ligado, asignación de grupo, ajuste, agotado u opción del día con un producto, grupo, modificador o sucursal de B) falla por la llave foránea compuesta, igual que con un id inexistente.
67. **Referencias cruzadas por HTTP.** En toda ruta de `/carta`, un id de B en la ruta responde 404 `NO_ENCONTRADO` y en el cuerpo 422 `REFERENCIA_INVALIDA` (o el 400 de los criterios 5 y 13), con el mismo cuerpo que un id inexistente, y nada de B cambia. Los listados y la vista solo traen datos de A.
68. **Archivos y eventos.** Las claves de las fotos de A empiezan con `carta/<id de A>/`; quitar o reemplazar la foto de un producto de A nunca borra un archivo de B. Todo evento publicado por una operación de A lleva la empresa A y su sala es de A (prueba con el publicador en memoria).
69. **Concurrencia.** Con un pool de la API de 2 conexiones, 100 peticiones concurrentes a `GET /carta/sucursal` y `PUT /carta/sucursal/agotados/:id` alternando sesiones de A y de B devuelven y cambian solo datos de su empresa (como el criterio 5 de 002).

### Interfaz (PWA, no crítica)

Las pantallas siguen `DESIGN.md` (Azulejo, tipo "Operate", móvil primero, trato de tú) y `PRODUCT.md`. El rol frontend usa la skill `impeccable`.

70. **Navegación.** El Administrador ve los destinos "Carta" (`/carta`) y "Disponibilidad" (`/disponibilidad`), además de los de 002 (máximo 5 en la barra inferior). Cocina/Barra y Supervisor ven "Disponibilidad". Mozo y Cajero no ven ninguno de los dos. La visibilidad sale de `permisos` de `GET /sesion`.
71. **Carta: productos.** `/carta` muestra segmentos "Productos", "Familias", "Modificadores" y "Estaciones". En Productos: lista agrupada por familia en su orden, con miniatura, nombre, precio de la empresa y etiquetas de estado con texto ("Inactivo", "Combo", "Menú del día", "No se vende solo"); búsqueda por nombre; filtro activos o todos; botón principal fijo "Nuevo producto"; modo "Ordenar" con botones subir y bajar de 48 px (sin arrastrar).
72. **Formulario de producto.** Al crear se elige el tipo (Simple, Combo, Menú del día) y no se cambia después. Campos: nombre, descripción, familia, precio ("con IGV"), "Se vende solo" (solo en simple), estación (con "Ninguna" si se aprueba la pregunta 11), tipo de control de stock (tres opciones con una línea de ayuda cada una), grupos de modificadores (elegir de los existentes, ordenar, quitar, crear uno nuevo sin salir), componentes con cantidad (combo y menú), "Datos tributarios" plegado con afectación e ICBPER, y "Disponible en" con una casilla por sucursal (marcadas por defecto). En la edición se suman la foto, la sección "Precio por sucursal" (criterio 73), "Usado en" (combos y modificadores que lo usan) y "Desactivar" separado por una junta. Muestra los errores de la API en su campo.
73. **Precio por sucursal.** Dentro del producto, una fila por sucursal con el precio efectivo, un campo de precio propio (vacío = el de la empresa) y el interruptor "Disponible". Guarda cada fila por separado.
74. **Foto.** "Tomar o elegir foto" abre la cámara o la galería; la PWA reduce la imagen en el navegador (lado mayor de 1200 px, JPEG) antes de subirla, muestra la vista previa y el avance, y permite quitarla con confirmación. Si la red se corta, conserva la imagen y ofrece reintentar.
75. **Familias, estaciones y modificadores.** Familias: lista en orden con agregar, renombrar, desactivar y ordenar. Estaciones: lista con agregar, renombrar y desactivar. Modificadores: lista de grupos con su regla en palabras ("Elige 1, obligatorio", "Elige de 0 a 2") y cuántos productos lo usan; formulario con nombre, "Única" o "Varias", obligatorio o mínimo y máximo, y la lista de opciones (nombre, precio extra, producto ligado opcional, subir, bajar y quitar). `EN_USO` se explica con palabras ("Esta estación la usan 4 productos. Cámbialos de estación antes de desactivarla").
76. **Menú del día.** En "Disponibilidad", el segmento "Menú del día" muestra cada menú con "Hoy" y "Mañana"; por tiempo, los candidatos como casillas grandes con su recargo y su estado (agotado); "Repetir las de ayer" copia la selección del día anterior; "Guardar". Si hoy no está armado, lo dice arriba ("El menú de hoy no está armado: no se puede vender").
77. **Agotados.** En "Disponibilidad", el segmento "Agotados" muestra los productos de la vista de la sucursal activa agrupados por familia, con filtro por estación (recuerda la última elegida en ese equipo), búsqueda y el filtro "Solo agotados". Cada fila es una baldosa de 72 px con el nombre, la estación y un interruptor "Agotado" con texto. Al marcar se elige "Solo por hoy" (por defecto) o "Hasta que lo reactive" en una hoja inferior (pregunta 4); al confirmar, la fila cambia al instante y aparece "Ceviche mixto está agotado · Deshacer" durante 5 segundos. Los productos no vendibles por un componente o un menú sin armar muestran el motivo con palabras.
78. **Estados de cada pantalla.** Carga: esqueleto con la forma de la lista. Vacío: frase y acción ("Aún no tienes productos. Crea tu primera familia y tu primer producto"; en Disponibilidad, "Esta sucursal no tiene productos en la carta"). Error de carga: aviso rocoto y "Reintentar". Sin conexión: cenefa y banner de 002; los cambios hechos quedan con la etiqueta "Pendiente de envío" y se reintentan sin duplicar; lo escrito en un formulario no se pierde.
79. **Compatibilidad y montos.** Desde 360 px sin desplazamiento horizontal; controles de 48 px o más; Chrome para Android y Safari para iPhone y iPad recientes; montos como `S/ 28.00` con cifras tabulares, y todo precio mostrado (incluida la vista previa "Precio con estas opciones" del formulario de combo) calculado con `packages/dominio`. Las pantallas de operación responden en menos de 1 segundo (RNF-03).
80. **Actualización.** La pantalla de Disponibilidad vuelve a pedir la vista cada 15 segundos en segundo plano (`X-Actividad: segundo-plano`, `If-None-Match`) y al volver a la pestaña; así dos equipos de cocina ven el mismo estado sin Socket.IO (pregunta 2). Toda escritura usa el cliente de `lib/api.ts`, con `Idempotency-Key` en los `POST` y reintentos ante cortes (RNF-10).

## Acciones auditadas en esta sección

Cada fila lleva actor, empresa, sucursal si aplica, equipo si aplica, sesión y fecha (criterio 57 de 002). `detalle` con el antes y el después de los campos cambiados.

| Acción (`accion`) | Entidad | Cuándo |
| --- | --- | --- |
| `crear_estacion`, `modificar_estacion` | `estacion` | Criterios 1 y 2 |
| `crear_familia`, `modificar_familia`, `ordenar_familias` | `familia` | Criterios 3 a 5 |
| `crear_producto`, `modificar_producto` (con precio, grupos y componentes), `ordenar_productos` | `producto` | Criterios 6 a 13 |
| `cambiar_foto_producto`, `quitar_foto_producto` | `producto` | Criterios 14 a 16 (sin el archivo; con las claves anterior y nueva) |
| `ajustar_producto_sucursal` | `producto` (con `sucursal_id`) | Criterio 19 |
| `crear_grupo_modificadores`, `modificar_grupo_modificadores` (con los modificadores creados, cambiados y desactivados, y sus precios extra) | `grupo_modificadores` | Criterios 24 a 29 |
| `armar_menu_del_dia` | `producto` (con `sucursal_id`, el día y las opciones antes y después) | Criterio 35 |
| `marcar_agotado`, `reactivar_agotado` | `producto` (con `sucursal_id`) | Criterios 39 a 41 y 53 |

## Casos límite

- Un producto agotado que también es componente de un combo y opción ligada del menú: el combo deja de ser vendible, la opción del menú queda no disponible, y si era la única de un tiempo obligatorio, el menú deja de ser vendible (criterio 45).
- Un agotado marcado a las 04:59 con hora de corte 05:00 dura un minuto si es "por hoy": es del día operativo anterior. La PWA lo advierte cuando faltan menos de 60 minutos para la hora de corte ("Se reactivará a las 5:00").
- Cambio de la hora de corte de una sucursal (001) con agotados "por hoy" vigentes: se recalcula el día operativo con la hora nueva; un agotado puede vencer antes o después de lo previsto. Se acepta.
- Dos cocineros marcan el mismo producto a la vez: los dos `PUT` terminan bien, gana el último `hasta`, y queda una fila de auditoría por cada cambio real.
- Un Administrador sin sucursal activa: puede editar toda la carta y ajustar cualquier sucursal (criterios 18 a 22), pero para marcar agotados o armar el menú elige una sucursal (criterio 43).
- Un modificador desactivado que estaba elegido en el menú de hoy: deja de ofrecerse desde la siguiente lectura; la selección guardada se conserva pero no cuenta.
- Un producto que deja de estar disponible en una sucursal con un agotado vigente: el agotado se conserva y vuelve a contar si el producto vuelve a estar disponible ese mismo día.
- Un grupo obligatorio cuyas opciones ligadas están todas agotadas: el producto queda no vendible con `OPCIONES_INSUFICIENTES` aunque él mismo no esté agotado.
- Un producto `SIMPLE` que no se vende solo y no es componente ni producto ligado de nada: no aparece en el comandero ni en la carta web; la edición muestra "Usado en: nada" para que el Administrador lo note.
- Precio de sucursal igual al de la empresa: se guarda tal cual; si luego cambia el de la empresa, la sucursal conserva el suyo. Para volver a seguir el de la empresa se pone `null`.
- Dos productos con nombres que solo difieren en mayúsculas o espacios en los extremos: el segundo responde 409 (los textos se recortan).
- Foto subida y transacción que falla después: el archivo nuevo queda huérfano en el almacén (no lo apunta ningún producto); ver "Riesgos" del plan.
- Un combo con un componente que no se vende solo: válido (por ejemplo "Papas del combo"); su disponibilidad cuenta para el combo.
- Afectación `EXONERADO` en una empresa cuyo emisor es del Nuevo RUS: se guarda; qué comprobante sale y cómo lo decide la sección 4.
- Una cadena con sucursales en zonas con tratamiento tributario distinto (por ejemplo, la Amazonía): la afectación es por producto y no por sucursal (pregunta 10).

## Reglas de negocio aplicables

Fuente: `fuentes.md`, salvo lo marcado como recomendación del especificador (pendiente en "Preguntas abiertas").

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
- Permisos: "Editar la carta y los precios", solo Administrador; "Marcar agotados (86) y cargar porciones del día", Cocina/Barra, Supervisor y Administrador (Roles y permisos). Un usuario tiene un rol por sucursal (002).
- Las ventas guardan cómo eran al venderse: un cambio de precio no altera las ventas pasadas (Modelo de datos; lo cumple la sección 3 guardando la línea preparada).
- Identificadores UUID; montos con decimales exactos (Modelo de datos). Código compartido para los cálculos y pruebas automáticas de montos (RNF-17).
- Auditoría de los cambios de configuración (RF-13, RNF-09); trazabilidad de autor y equipo en toda tabla nueva (RNF-20).
- Sin servicios externos de pago salvo el PSE (RNF-18); fotos de la carta en Cloudflare R2 (Infraestructura y costos; pregunta 1).
- La importación de la carta desde Excel es parte del alta de clientes que hace nuestro equipo (Modelo comercial; pregunta 3).
- **Recomendaciones del especificador, pendientes de las preguntas:** grupos reutilizables (6); sin combos anidados (7); precio de sucursal libre, precio extra sin negativos, solo el precio del producto varía por sucursal, un modificador no se elige dos veces en la misma línea (8); una familia por producto y orden manual (9); afectación gravado, exonerado o inafecto más marca de ICBPER (10); productos sin estación (11); productos que no se venden solos (12); agotado por el día o hasta reactivar (4); menú del día por sucursal y armado por Cocina/Barra, Supervisor o Administrador (5).

## Contrato

### Endpoints

Todas con sesión de empresa (002). "Admin" = `@Permiso('EDITAR_CARTA')`; "Disponibilidad" = `@Permiso('GESTIONAR_DISPONIBILIDAD')` + `@RequiereSucursal()`.

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `GET /carta/estaciones` | Admin | — | 200 `estacionRespuesta[]` |
| `POST /carta/estaciones` | Admin; `Idempotency-Key` opcional | `estacionEntrada` | 201 `estacionRespuesta`; 400; 403; 409 |
| `PATCH /carta/estaciones/:id` | Admin | `estacionModificarEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO` |
| `GET /carta/familias` | Admin | — | 200 `familiaRespuesta[]` |
| `POST /carta/familias` | Admin; `Idempotency-Key` opcional | `familiaEntrada` | 201 `familiaRespuesta`; 400; 403; 409 |
| `PATCH /carta/familias/:id` | Admin | `familiaModificarEntrada` | 200; 400; 403; 404; 409 |
| `PUT /carta/familias/orden` | Admin | `ordenEntrada` (`{ ids }`) | 200 `familiaRespuesta[]`; 400; 403 |
| `PUT /carta/familias/:id/productos/orden` | Admin | `ordenEntrada` | 200 `productoResumen[]`; 400; 403; 404 |
| `GET /carta/productos` | Admin | — | 200 `productoResumen[]` |
| `GET /carta/productos/:id` | Admin | — | 200 `productoRespuesta`; 404 |
| `POST /carta/productos` | Admin; `Idempotency-Key` opcional | `productoCrearEntrada` | 201 `productoRespuesta`; 400; 403; 409; 422 `REFERENCIA_INVALIDA` |
| `PATCH /carta/productos/:id` | Admin | `productoModificarEntrada` | 200; 400; 403; 404; 409; 422 |
| `PUT /carta/productos/:id/foto` | Admin | binario `image/jpeg`, `image/png` o `image/webp` (máx. 1 MB) | 200 `{ fotoUrl }`; 403; 404; 413; 415; 422 `FOTO_INVALIDA` |
| `DELETE /carta/productos/:id/foto` | Admin | — | 204; 403; 404 |
| `GET /carta/productos/:id/sucursales` | Admin | — | 200 `ajusteSucursalRespuesta[]`; 404 |
| `PUT /carta/productos/:id/sucursales/:sucursalId` | Admin | `ajusteSucursalEntrada` (`{ precio, disponible }`) | 200 `ajusteSucursalRespuesta`; 400; 403; 404 |
| `GET /carta/grupos-modificadores` | Admin | — | 200 `grupoRespuesta[]` |
| `GET /carta/grupos-modificadores/:id` | Admin | — | 200 `grupoRespuesta`; 404 |
| `POST /carta/grupos-modificadores` | Admin; `Idempotency-Key` opcional | `grupoEntrada` | 201 `grupoRespuesta`; 400; 403; 409; 422 |
| `PATCH /carta/grupos-modificadores/:id` | Admin | `grupoModificarEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO`; 422 |
| `GET /carta/sucursal` | cualquier rol con sucursal activa | `If-None-Match` opcional | 200 `cartaSucursalRespuesta` con `ETag`; 304; 409 `SUCURSAL_NO_ELEGIDA` |
| `GET /carta/sucursal/menu-del-dia` | Disponibilidad | `?dia=AAAA-MM-DD` | 200 `menuDelDiaRespuesta[]`; 400; 403; 409 |
| `PUT /carta/sucursal/menu-del-dia/:productoId` | Disponibilidad | `menuDelDiaEntrada` (`{ dia?, opciones }`) | 200 `menuDelDiaRespuesta`; 400; 403; 404; 409; 422 |
| `PUT /carta/sucursal/agotados/:productoId` | Disponibilidad | `agotadoEntrada` (`{ hasta? }`) | 200 `agotadoRespuesta`; 400; 403; 404; 409 |
| `DELETE /carta/sucursal/agotados/:productoId` | Disponibilidad | — | 204; 403; 404; 409 |

- `PUT`, `PATCH` y `DELETE` asignan valores absolutos: repetirlos da el mismo resultado y no necesitan clave de idempotencia.
- `PUT /carta/productos/:id/foto` es la única ruta que acepta un cuerpo binario, con su propio límite de 1 MB; las demás siguen con el límite de 100 KB de 001.
- CORS: se agregan `If-None-Match` a las cabeceras permitidas y `ETag` a las expuestas.

### Códigos de error nuevos (`CODIGOS_ERROR`)

`REFERENCIA_INVALIDA` (422, con `campos`), `EN_USO` (409), `FOTO_INVALIDA` (422), `PRODUCTO_NO_VENDIBLE` (422, con el motivo; lo lanza `prepararLinea`), `SELECCION_INVALIDA` (422, con los errores; lo lanza `prepararLinea`). Se reutilizan `DATOS_INVALIDOS`, `NO_ENCONTRADO`, `CONFLICTO`, `PROHIBIDO`, `SUCURSAL_NO_ELEGIDA`, `CUERPO_DEMASIADO_GRANDE` y `TIPO_NO_SOPORTADO`.

### Paquetes compartidos

- `packages/dominio` (`src/carta/`):
  - Catálogos: `TIPOS_PRODUCTO` (`SIMPLE`, `COMBO`, `MENU_DEL_DIA`), `TIPOS_CONTROL_STOCK` (`UNIDADES`, `PORCIONES`, `SIN_CONTROL`), `AFECTACIONES_IGV` (`GRAVADO`, `EXONERADO`, `INAFECTO`), `SELECCIONES` (`UNICA`, `MULTIPLE`), `HASTA_AGOTADO` (`FIN_DEL_DIA`, `REACTIVAR`), `ORIGENES_AGOTADO` (`MANUAL`, `SIN_STOCK`), `MOTIVOS_NO_VENDIBLE`, `ERRORES_SELECCION`, y los límites `CANTIDAD_MAXIMA_LINEA = 999`, `CANTIDAD_MAXIMA_COMPONENTE = 99`.
  - Ruta crítica (`precios.ts`): `precioEfectivo(precioEmpresa, precioSucursal)`, `validarSeleccion(grupos, elegidos)`, `calcularLinea(producto, elegidos, cantidad)` (criterios 55 a 57). `decimal.js` pasa a ser dependencia de `packages/dominio`.
  - No crítica (`disponibilidad.ts`): `agotadoVigente`, `vendibilidad` (criterio 59).
- `packages/contratos` (`src/carta.ts`, zod): `montoNoNegativoSchema` (`^\d{1,8}(\.\d{1,2})?$`, admite `0`), `estacionEntrada`, `estacionModificarEntrada`, `estacionRespuesta`, `familiaEntrada`, `familiaModificarEntrada`, `familiaRespuesta`, `ordenEntrada`, `productoCrearEntrada`, `productoModificarEntrada`, `productoResumen`, `productoRespuesta`, `ajusteSucursalEntrada`, `ajusteSucursalRespuesta`, `grupoEntrada` (unión discriminada por `seleccion`), `grupoModificarEntrada`, `grupoRespuesta`, `cartaSucursalRespuesta`, `productoDeVenta`, `menuDelDiaEntrada`, `menuDelDiaRespuesta`, `agotadoEntrada`, `agotadoRespuesta`, `lineaPreparada`; los eventos `eventoDisponibilidad` y `eventoCartaActualizada`. Entradas estrictas.

### Interfaces de la API (contratos públicos para las pruebas y para otras secciones)

- `crearAplicacion({ …, publicadorEventos?, almacenArchivos? })`: reemplazan a los proveedores `PUBLICADOR_EVENTOS` y `ALMACEN_ARCHIVOS`.
- `PublicadorEventos` (`apps/api/src/nucleo/eventos/`): `publicar(evento: { empresaId, sala: { tipo: 'empresa' } | { tipo: 'sucursal', sucursalId }, nombre, datos })`. Implementaciones: `PublicadorNulo` (por defecto, hasta la sección 3) y `PublicadorEnMemoria` (pruebas, con `eventos()` y `limpiar()`). Las operaciones lo llaman solo con `ContextoEmpresa.alConfirmar`.
- `AlmacenArchivos` (`apps/api/src/nucleo/archivos/`): `guardar(clave, contenido, tipo)`, `borrar(clave)`, `urlPublica(clave)`. Implementaciones: `AlmacenEnMemoria` (pruebas), `AlmacenEnDisco` (desarrollo) y `AlmacenR2` (producción, pregunta 1).
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

Se publican por `PublicadorEventos` después de confirmar; en esta sección no hay transporte (pregunta 2). Nombres y datos fijados aquí para las secciones 3 y 5:

| Evento | Sala | Datos | Cuándo |
| --- | --- | --- | --- |
| `carta.disponibilidad` | sucursal | `{ sucursalId, productoId, agotado, hasta, origen }` | Criterios 46 y 53 |
| `carta.actualizada` | empresa o sucursal | `{ sucursalId }` (`null` = todas) | Criterio 54 |

### Permisos

- Los de la tabla de endpoints. La matriz de `packages/dominio` no cambia (criterio 60). Soporte = Administrador. Principal de prueba = Administrador.
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

Las reglas entre tablas (que un componente o un producto ligado sea `SIMPLE`, que una opción del día sea de un grupo del menú, que la estación o la familia estén activas) las valida el servicio dentro de la transacción; la base garantiza la empresa con las llaves compuestas.

## Fuera de alcance

- Asociar estaciones a impresoras o KDS por sucursal, el ruteo de la comanda, el comandero y el KDS (sección 3).
- Stock: cargar porciones, descontar, bloquear la venta en cero, el agotado automático, el cierre del día con sobrantes (merma o día siguiente, configurable por producto: la sección 6 agrega esa columna a `producto` por el módulo de carta), kardex y stock mínimo (sección 6).
- La carta web pública y su ruta sin sesión, colores, logo y vista previa (sección 5).
- Socket.IO, salas y autenticación del socket (sección 3; pregunta 2).
- Importar la carta desde Excel (pregunta 3).
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

## Notas para otras secciones

- **Sección 3 (Salón, Cocina e Impresión):**
  - Guardar en el ítem la `lineaPreparada` de `prepararLinea` (nombre, precios, modificadores con su precio extra, componentes, estaciones, afectación e ICBPER) para que un cambio de la carta no altere ventas pasadas.
  - Rechazar al comandar un producto no vendible o una selección inválida, y probarlo en sus pruebas protegidas de "Enviar comanda" (incluido un producto que se agota entre que el mozo lo elige y lo envía).
  - Rutear cada componente y cada producto ligado a su propia estación (`estacionId` de la línea preparada); un producto sin estación no genera comanda.
  - Traer Socket.IO con el adaptador de PostgreSQL, implementar `PublicadorEventos` con salas por empresa y sucursal, y revisar la nota de 001 sobre `LISTEN`/`NOTIFY` como canal lateral entre empresas.
  - Asociar las estaciones de la empresa a impresoras o KDS de cada sucursal (RF-19, segunda parte).
- **Sección 5 (Pedidos web):** publicar la carta con `cartaDeSucursal`, ocultando `vendible: false` y `seVendeSolo: false` (RF-41); escuchar `carta.disponibilidad` o refrescar con `ETag`; volver a validar con `prepararLinea` al confirmar el pedido. Las fotos ya tienen URL pública.
- **Sección 6 (Inventario):** leer `tipoControlStock` de la carta; llamar `CartaDisponibilidadService.marcarAgotado` con `origen: 'SIN_STOCK'` al llegar a cero porciones (RF-70) y `reactivar` al cargar porciones; agregar a `producto`, por el módulo de carta, el destino de los sobrantes (merma o día siguiente, RF-73); descontar los componentes y los productos ligados de la línea preparada (RF-68).
- **Sección 4 (Caja y comprobantes):** usar `afectacionIgv` y `aplicaIcbper` de la línea guardada; el desglose de IGV y el ICBPER se calculan ahí con la tasa vigente del emisor.
- **Importación desde Excel (si se aprueba diferirla):** reutilizar `EstacionesService`, `FamiliasService`, `ProductosService` y `GruposService` dentro de un contexto de empresa con actor de sistema `cli:importar-carta` o el superadministrador en soporte, para que la auditoría y la trazabilidad queden igual.

## Preguntas abiertas

Cada una con la recomendación del especificador. Los criterios marcados con el número de la pregunta están escritos con la recomendación.

1. **Fotos: dónde y de qué tamaño (RF-14).** El documento de diseño ya pone las fotos de la carta en Cloudflare R2 ("Infraestructura y costos"). Costo: R2 no cobra la salida de datos y su capa gratuita incluye 10 GB al mes; con 30 empresas, unas 150 fotos por empresa y unos 200 KB por foto son menos de 1 GB, así que el costo esperado es S/ 0 (pasado el límite, unos USD 0.015 por GB al mes). **Recomendación:** R2, detrás de un conector (disco en desarrollo, memoria en pruebas); la PWA reduce la foto en el celular a 1200 px de lado mayor en JPEG (unos 150 a 300 KB) antes de subirla; la API acepta JPEG, PNG o WebP de hasta 1 MB y de 200 a 2048 px por lado; una foto por producto; URL pública (la carta web es pública). Alternativas: (a) guardarlas en PostgreSQL (`bytea`): sin otro servicio, pero agranda la base y los respaldos y la API tendría que servir las imágenes; (b) dejar las fotos para la sección 5, junto a la carta web, que es donde más importan.
2. **Tiempo real para el agotado (HU-09, "al instante").** El comandero (sección 3) y la carta web (sección 5) todavía no existen, así que "aparece agotado en el comandero" y "desaparece de la carta web" solo se pueden aceptar en esas secciones. **Recomendación:** aquí solo el contrato de los eventos y un puerto que los publica después de confirmar (sin transporte), más la vista con `ETag` que la pantalla de Disponibilidad refresca cada 15 s; Socket.IO con el adaptador de PostgreSQL entra en la sección 3, donde lo necesitan el mapa de mesas, el KDS y el comandero, y donde se ataca su aislamiento entre empresas. Alternativa: traer ya un Socket.IO mínimo (autenticación con la sesión, sala por sucursal y estos dos eventos), lo que agranda esta sección y suma una pieza crítica para el aislamiento.
3. **Importar la carta desde Excel (RF-21).** El documento de diseño la ubica en el alta de clientes que hace nuestro equipo. **Recomendación:** diferirla a una sección corta antes del primer cliente, como herramienta de nuestro equipo (script o soporte) con una plantilla fija (familias, productos, precios, estaciones, tipo de control de stock y afectación), sin pantalla para el Administrador; así la plantilla sigue un modelo de carta ya estable y no frena esta sección. Alternativa: incluirla aquí como pantalla del Administrador para subir el archivo, con vista previa de errores.
4. **Cuánto dura un agotado (RF-20).** **Recomendación:** al marcarlo se elige "Solo por hoy" (por defecto: vuelve solo en la siguiente hora de corte de la sucursal, sin que nadie se acuerde de reactivarlo) o "Hasta que lo reactive" (para un plato que faltará varios días). Alternativas: (a) siempre hasta reactivarlo a mano; (b) siempre solo por hoy.
5. **Menú del día: por sucursal o por empresa, quién lo arma y qué pasa al cambiar de día (RF-18).** **Recomendación:** el Administrador configura el menú (precio, tiempos, platos candidatos y sus recargos), como el resto de la carta; cada día, en cada sucursal, Cocina/Barra, el Supervisor o el Administrador eligen cuáles candidatos se ofrecen (es una tarea diaria, como cargar porciones, y no cambia precios); el menú de un día se puede armar desde la víspera; a la hora de corte empieza un día sin opciones y el menú no se vende hasta armarlo, con un botón "Repetir las de ayer". Implica ampliar la fila de la matriz a "Marcar agotados (86), cargar porciones del día y elegir las opciones del menú del día" (ver "Cambios propuestos"). Alternativas: (a) solo el Administrador elige las opciones del día; (b) un solo menú del día para toda la empresa; (c) que el menú de ayer siga valiendo hasta que alguien lo cambie.
6. **Grupos de modificadores reutilizables (RF-16).** **Recomendación:** un grupo se define una vez ("Término de la carne", "Bebida del combo") y se asigna a varios productos; cambiarlo cambia todos. Alternativa: cada producto tiene sus propios grupos (más simple de entender, pero hay que repetir y mantener cada copia).
7. **Combos dentro de combos (RF-17).** **Recomendación:** no; los componentes y los productos ligados de las opciones son siempre productos simples, y las opciones de un combo son grupos de modificadores ligados a productos (como prevé el modelo de datos del diseño, sin una entidad aparte). Alternativa: permitir combos anidados (más casos para el stock y la comanda, sin un uso claro en restaurantes pequeños).
8. **Reglas de precios.** **Recomendación:** (a) el precio de una sucursal puede ser cualquier monto mayor que 0, mayor o menor que el de la empresa, sin límite; (b) el precio extra de un modificador es 0 o más, sin negativos (un "sin papas" no descuenta: los descuentos van con clave de supervisor, sección 4); (c) solo el precio del producto (incluido el del combo y el del menú) cambia por sucursal; los precios extra y los recargos son los mismos en todas; (d) un modificador se elige como máximo una vez por línea (para "doble queso" se crea la opción "Doble queso"). Alternativas: permitir descuentos negativos en modificadores, precios extra por sucursal o elegir un modificador varias veces con cantidad.
9. **Familias y orden.** **Recomendación:** cada producto pertenece a una sola familia (los reportes de ventas por familia, RF-79, no cuentan dos veces); el Administrador ordena familias y productos a mano con botones subir y bajar, y el orden es el mismo en todas las sucursales y en la carta web. Alternativas: un producto en varias familias (por ejemplo "Promociones" y "Bebidas"); orden alfabético.
10. **Afectación tributaria (RF-14).** **Recomendación:** tres valores, `GRAVADO` (por defecto), `EXONERADO` e `INAFECTO`, más una marca aparte "Aplica ICBPER" para las bolsas plásticas (el ICBPER no es una afectación: es un impuesto por unidad que se suma al IGV). La elige el Administrador en "Datos tributarios", plegado en el formulario. Es por producto, igual en todas las sucursales. Las operaciones gratuitas (cortesías) y el monto del ICBPER los define la sección 4 con el contador. Alternativa: que la afectación también se ajuste por sucursal (cadenas con locales en zonas exoneradas, como la Amazonía).
11. **Productos sin estación.** HU-05 dice que cada producto indica su estación. Hay productos que nadie prepara (el envase de para llevar, la bolsa). **Recomendación:** la estación es obligatoria de elegir, con una opción "Ninguna (no va a cocina ni a barra)"; esos productos no generan comanda. Alternativa: estación siempre obligatoria (el envase iría, por ejemplo, a Barra, y saldría en su comanda).
12. **Productos que no se venden solos.** Los platos del menú del día y algunos componentes ("Papas del combo") no se venden como ítem aparte, pero Cocina necesita marcarlos agotados y el stock los cuenta. **Recomendación:** una marca "Se vende solo" (sí por defecto); si no, el producto no lleva precio, no aparece en el comandero ni en la carta web, y sí en Disponibilidad y como componente u opción. Alternativa: que todo producto tenga precio y aparezca para la venta.

## Decisiones del especificador (para revisión del usuario)

No cambian reglas de los documentos; el usuario puede objetarlas al aprobar.

- **Agotado separado de la disponibilidad:** "no disponible en la sucursal" es configuración del Administrador y no vence; "agotado" es operación diaria de Cocina y vence (RF-15 y RF-20 los nombran por separado). Van en tablas distintas para que el permiso y la trazabilidad de cada uno no se mezclen.
- **Se auditan el agotado y el armado del menú del día**, además de los cambios de configuración de RF-13: permiten saber quién sacó un plato de la venta. Son pocos por día.
- **El tipo de producto no cambia** después de crearlo (un combo no pasa a simple): evita componentes huérfanos y ventas inconsistentes.
- **Nada se borra:** estaciones, familias, productos, grupos y modificadores se desactivan, porque las ventas y el menú los referencian. Desactivar una estación, una familia o un grupo en uso responde `EN_USO`; un producto se puede desactivar aunque sea componente, y sus combos dejan de venderse con motivo.
- **Límites de cordura:** 10 grupos por producto, 20 componentes por combo, 50 modificadores por grupo, cantidad de componente de 1 a 99 y de línea de 1 a 999. Evitan errores de tipeo y respuestas enormes; se pueden subir sin cambiar el modelo.
- **Precio solo con 2 decimales y mayor que 0** (`montoSchema` de 002); el precio extra admite 0.
- **Un producto nuevo nace disponible en todas las sucursales** salvo las que se desmarquen en el formulario; una sucursal nueva ofrece toda la carta activa.
- **La carta no depende de un módulo del plan** (`@RequiereModulo`): todo plan la necesita, y el catálogo de módulos de 002 no la incluye.
- **`GET /carta/sucursal` es una sola vista para todos los roles**, con `ETag`, en lugar de una por rol: el comandero, Cocina y la carta web filtran lo que necesitan.

## Cambios propuestos a los documentos compartidos

El orquestador los lleva a los documentos compartidos (paso 8), según las respuestas:

- **Documento de diseño, "Roles y permisos"** (si se aprueba la pregunta 5): la fila "Marcar agotados (86) y cargar porciones del día" pasa a "Marcar agotados (86), cargar porciones del día y elegir las opciones del menú del día".
- **Documento de diseño, "Modelo de datos", fila Carta:** agregar "Agotado por sucursal" y "Opción del menú del día (por sucursal y día)"; y en "Decisiones del modelo": "Las opciones de un combo y los platos del menú del día son modificadores ligados a productos".
- **RF-20** (si se aprueba la pregunta 4): "Marcar productos como agotados (86) por el día o hasta reactivarlos, y reactivarlos".
- **RF-18** (si se aprueba la pregunta 5): "Armar el menú del día como un combo cuyas opciones se eligen cada día en cada sucursal".
- **RF-14** (si se aprueban las preguntas 11 y 12): "… estación de producción (o ninguna), tipo de control de stock y si se vende solo".
- **RF-21** (si se aprueba la pregunta 3): sin cambio de texto; anotar en el documento que se hace como herramienta de nuestro equipo en una sección posterior.
