# 003 · Plan técnico

## Módulos afectados

- `packages/dominio`:
  - `src/carta/catalogos.ts`: tipos de producto, tipos de control de stock, afectaciones, selección, `HASTA_AGOTADO`, `ORIGENES_AGOTADO`, motivos de no vendible, errores de selección y límites (`CANTIDAD_MAXIMA_LINEA`, `CANTIDAD_MAXIMA_COMPONENTE`).
  - `src/carta/precios.ts` (ruta crítica): `precioEfectivo`, `validarSeleccion`, `calcularLinea`, con `decimal.js` (dependencia nueva del paquete, la misma versión fija que usa `apps/app`).
  - `src/carta/disponibilidad.ts`: `agotadoVigente`, `vendibilidad`.
  - Pruebas unitarias en `test/carta/`.
- `packages/contratos`: `src/carta.ts` (esquemas de la sección "Contrato" de `spec.md`), `montoNoNegativoSchema` en `src/comunes.ts`, códigos nuevos en `src/errores.ts`.
- `apps/api`:
  - `src/modulos/carta/` (nuevo): dueño de `estacion`, `familia`, `producto`, `producto_sucursal`, `producto_agotado`, `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo` y `menu_del_dia_opcion`. Ver "Estructura del módulo".
  - `src/nucleo/eventos/` (nuevo): `PUBLICADOR_EVENTOS`, interfaz `PublicadorEventos`, `PublicadorNulo`, `PublicadorEnMemoria`.
  - `src/nucleo/archivos/` (nuevo): `ALMACEN_ARCHIVOS`, interfaz `AlmacenArchivos`, `AlmacenEnMemoria`, `AlmacenEnDisco`, `AlmacenR2`, y `leerImagen(buffer)` (formato y dimensiones por los primeros bytes).
  - `src/modulos/plataforma/sucursales-consulta.service.ts`: método `horaCorte(sucursalId, transaccion?)`.
  - `src/aplicacion.ts`: opciones `publicadorEventos` y `almacenArchivos` de `crearAplicacion`; analizador de cuerpo binario solo para `PUT /carta/productos/:id/foto`; CORS con `If-None-Match` y `ETag`; servidor estático de `/archivos` solo en desarrollo con el almacén en disco.
  - `src/config/entorno.ts`: `ARCHIVOS_DRIVER`, `ARCHIVOS_DIRECTORIO`, `ARCHIVOS_URL_PUBLICA`, `R2_*`.
  - `src/migraciones/`: cinco migraciones (ver "Migraciones").
  - `src/app.module.ts`: `CartaModule`.
  - `test/carta/`: pruebas no protegidas del desarrollador; las protegidas van en `test/carta-critica/` (ver `tasks.md`).
- `apps/app`:
  - `src/modulos/carta/` (Administrador): `CartaPagina` con segmentos, `ProductosLista`, `ProductoFormularioPagina`, `PrecioPorSucursal`, `FotoDeProducto`, `FamiliasLista`, `EstacionesLista`, `GruposLista`, `GrupoFormularioPagina`, `carta.ts` (consultas y mutaciones de TanStack Query).
  - `src/modulos/disponibilidad/` (Cocina/Barra, Supervisor, Administrador): `DisponibilidadPagina` con segmentos "Agotados" y "Menú del día", `vista-sucursal.ts` (consulta con `ETag` y refresco cada 15 s).
  - `src/lib/api.ts`: cuerpo binario (`Blob` con su `Content-Type`), `If-None-Match` y respuesta 304.
  - `src/lib/imagen.ts`: reducir una foto en el navegador.
  - `src/App.tsx` y `src/componentes/AppLayout.tsx`: rutas `/carta…` y `/disponibilidad` y sus destinos, según `permisos`.
- `packages/ui`: componentes nuevos si hacen falta, con la skill `impeccable`: `CampoMonto` (teclado decimal, `S/` delante, cifras tabulares), `FilaOrdenable` (subir y bajar de 48 px), `Casilla` grande, `SelectorDeFoto`, `AvisoDeshacer`. Se reutilizan `Interruptor`, `Segmentos`, `Hoja`, `Lista`, `Estados`, `Aviso`, `EtiquetaDeEstado`.
- `.env.example`, `README.md`: variables nuevas y cómo ver las fotos en desarrollo.

## Diseño

### Estructura del módulo `carta`

```
apps/api/src/modulos/carta/
  carta.module.ts
  estaciones.controller.ts / estaciones.service.ts
  familias.controller.ts / familias.service.ts            (incluye el orden de familias y de productos)
  productos.controller.ts / productos.service.ts          (tipos, grupos asignados, componentes, noDisponibleEn)
  fotos-producto.controller.ts / fotos-producto.service.ts
  ajustes-sucursal.controller.ts / ajustes-sucursal.service.ts
  grupos.controller.ts / grupos.service.ts                (grupos y modificadores)
  menu-del-dia.controller.ts / menu-del-dia.service.ts
  disponibilidad.controller.ts / carta-disponibilidad.service.ts   (agotados; exportado para la sección 6)
  vista-sucursal.controller.ts / carta-venta.service.ts   (vista, ETag y prepararLinea; exportado para 3 y 5)
  cargador-carta.ts                                       (consultas fijas de la vista; ver abajo)
  referencias.ts                                          (validación de ids de la empresa y su tipo)
  eventos-carta.ts                                        (arma y registra los eventos con alConfirmar)
  errores-carta.ts
```

- Todo corre dentro del contexto de empresa que abre el interceptor global (002), con el actor de la sesión; los servicios usan la transacción del contexto. Ningún servicio consulta tablas de otros módulos: las sucursales se leen con `SucursalesConsultaService` (`existen`, `listar`, `horaCorte`) y la auditoría se escribe con `AuditoriaService.registrar`.
- `CartaModule` exporta `CartaVentaService` y `CartaDisponibilidadService`; nada más.
- Los controladores aplican `@Permiso('EDITAR_CARTA')` o `@Permiso('GESTIONAR_DISPONIBILIDAD')` + `@RequiereSucursal()` según la tabla de endpoints; `GET /carta/sucursal` solo `@RequiereSucursal()`. Los `POST` llevan `@Idempotente()`.

### Escrituras de configuración

1. El `PipeZod` valida la forma (400).
2. El servicio valida las referencias con `referencias.ts`: una sola consulta por tipo de entidad (`SELECT id, tipo, activo FROM producto WHERE id = ANY($1)`), bajo RLS, así que un id de B no aparece y se trata igual que uno inexistente (422 `REFERENCIA_INVALIDA` con `campos`). Comprueba también el tipo (componente y producto ligado `SIMPLE`) y que estén activos.
3. Lee la fila actual con `FOR UPDATE` (para el antes de la auditoría y para el no-op), aplica el cambio, y si no cambió nada responde sin auditar.
4. Registra la auditoría con el antes y el después (los montos como texto), y el evento `carta.actualizada` con `alConfirmar`.
5. Las violaciones de unicidad (`23505` sobre `lower(nombre)`) se traducen a 409 `CONFLICTO`; las de llave foránea que escapen a la validación previa (carreras con una desactivación), a 422 `REFERENCIA_INVALIDA`.

- **Listas que se reemplazan** (`gruposModificadores`, `componentes`, `modificadores` del grupo): se calcula la diferencia con lo guardado; en `producto_grupo` y `componente_combo` se borran las filas que salen y se insertan o actualizan las demás con su orden; en `modificador` los que salen pasan a `activo = false`.
- **`EN_USO`:** antes de desactivar una estación, una familia o un grupo, se cuentan los productos activos que los usan, con la fila bloqueada `FOR UPDATE`, para que una creación concurrente no se cuele (la creación de un producto lee la familia y la estación con `FOR SHARE`).
- **Orden:** `PUT …/orden` bloquea las filas de la empresa (familias) o de la familia (productos) con `FOR UPDATE`, comprueba que `ids` sea exactamente ese conjunto y reescribe `orden` = posición. Un producto o una familia nuevos toman `max(orden) + 1` con la misma fila de la familia bloqueada.
- **Tipo inmutable:** `productoModificarEntrada` no tiene `tipo`; las reglas del criterio 7 se comprueban sobre el resultado de mezclar lo guardado con lo enviado.

### Fotos

```
PUT /carta/productos/:id/foto  (Content-Type image/*, cuerpo binario ≤ 1 MB)
 → analizador binario propio de esta ruta (413 si excede; 415 si el tipo no es jpeg, png o webp)
 → leerImagen(buffer): formato por firma (FF D8 FF; 89 50 4E 47; RIFF....WEBP) y dimensiones
   (SOF de JPEG, IHDR de PNG, VP8/VP8L/VP8X de WebP); sin dependencias nativas → 422 FOTO_INVALIDA
 → producto bajo RLS con FOR UPDATE (404 si no existe en la empresa)
 → clave = carta/<empresaActual>/<productoId>/<uuid>.<ext>; AlmacenArchivos.guardar(clave, buffer, tipo)
 → UPDATE producto SET foto_clave = clave; auditoría cambiar_foto_producto
 → alConfirmar: borrar la clave anterior (si había) y publicar carta.actualizada
```

- La subida al almacén ocurre dentro de la petición y antes de confirmar: si la transacción falla después, el archivo nuevo queda huérfano (riesgo aceptado, ver "Riesgos"). El servicio intenta borrar el archivo nuevo si la operación lanza antes de devolver; un `COMMIT` fallido no tiene ese aviso.
- `AlmacenR2` usa la API compatible con S3 de R2 con firmas SigV4 (`aws4fetch`, JavaScript puro y sin dependencias nativas; se descartó `@aws-sdk/client-s3` por su tamaño). Guarda con `Cache-Control: public, max-age=31536000, immutable`: cada foto tiene una clave nueva, así que nunca hay que invalidar caché.
- La URL pública es `ARCHIVOS_URL_PUBLICA` + clave (un dominio propio del bucket detrás de Cloudflare). El token de R2 tiene permiso solo sobre ese bucket.
- `AlmacenEnDisco` escribe en `ARCHIVOS_DIRECTORIO` y la API lo sirve con `express.static` en `/archivos`, montado fuera de Nest, solo en `development`. `cargarEntorno` rechaza `ARCHIVOS_DRIVER=disco` fuera de `development` y exige `r2` en `production`.
- `AlmacenEnMemoria` (pruebas) guarda en un `Map` y expone `claves()` para comprobar lo guardado y lo borrado.
- La PWA reduce la imagen antes de subirla (`createImageBitmap` con `imageOrientation: 'from-image'`, un `canvas` de 1200 px de lado mayor y `toBlob('image/jpeg', 0.82)`), así pesa unos 150 a 300 KB por datos móviles. Si el navegador no puede decodificarla, sube el archivo original y la API decide.

### Ajustes por sucursal

`producto_sucursal` guarda solo lo que difiere: `PUT` hace `INSERT … ON CONFLICT (producto_id, sucursal_id) DO UPDATE` y, si el resultado es el valor por defecto (`precio` nulo y `disponible`), deja la fila igual (no la borra, para no perder la trazabilidad del último cambio). `noDisponibleEn` del alta inserta filas con `disponible = false`. La sucursal se valida con `SucursalesConsultaService.existen` (404 si no es de la empresa).

### Agotados

- `PUT /carta/sucursal/agotados/:productoId`: con la sucursal activa del principal, lee el agotado actual `FOR UPDATE` y calcula si está vigente con `agotadoVigente` (día operativo actual = `diaOperativo(reloj.ahora(), horaCorte)`). Si está vigente con el mismo `hasta`, responde lo guardado sin escribir. Si no, `INSERT … ON CONFLICT DO UPDATE` con `desde = ahora`, `dia_operativo` actual, `hasta` y `origen`; audita y registra `carta.disponibilidad` con `alConfirmar`.
- `DELETE`: si hay un agotado vigente, borra la fila, audita y publica; si no hay o venció, borra la fila vencida (si existe) sin auditar ni publicar.
- `CartaDisponibilidadService` es el mismo código que usan los controladores, con `sucursalId` y `origen` explícitos, para la sección 6.
- La vigencia se calcula siempre al leer: no hay tareas programadas ni filas que haya que limpiar.

### Menú del día

- `GET`: valida `dia` contra el día operativo actual (anterior, actual o siguiente), carga los productos `MENU_DEL_DIA` activos y disponibles con sus grupos y modificadores activos (`cargador-carta.ts`) y las filas de `menu_del_dia_opcion` de ese día.
- `PUT`: bloquea el producto `FOR SHARE`, valida cada opción contra los modificadores activos de los grupos activos asignados al menú, compara con las opciones guardadas para ese día (no-op si son iguales), borra las que salen e inserta las nuevas, audita con el antes y el después, y publica `carta.actualizada` para la sucursal.

### Vista de la sucursal y `prepararLinea`

`cargador-carta.ts` arma la carta de una sucursal con seis consultas fijas, sin importar cuántos productos haya (criterio 50):

1. productos activos de familias activas, con `LEFT JOIN` a `producto_sucursal` y `producto_agotado` de la sucursal;
2. familias activas en orden;
3. estaciones activas;
4. grupos asignados a esos productos con sus modificadores activos (`producto_grupo` + `grupo_modificadores` + `modificador`), en orden;
5. componentes de los combos y menús;
6. opciones del día de `menu_del_dia_opcion` para el día operativo actual.

Los productos ligados y los componentes inactivos o no disponibles también se cargan en la consulta 1 (sin el filtro de familia activa) para calcular su disponibilidad. Con eso, `CartaVentaService` calcula `precioEfectivo`, `agotadoVigente` y `vendibilidad` de `packages/dominio` y arma `cartaSucursalRespuesta`.

- **ETag:** SHA-256 del JSON canónico de la respuesta (claves ordenadas), en base64url, como `ETag` fuerte. Con `If-None-Match` igual, 304 sin cuerpo. El día operativo forma parte de la respuesta, así que cambia al pasar la hora de corte.
- **`prepararLinea`:** usa el mismo cargador restringido al producto pedido y a sus productos ligados y componentes, arma `grupos` para `validarSeleccion` (con `disponible` de cada modificador) y llama `calcularLinea`; con el resultado arma `lineaPreparada`. No escribe nada.
- **Prueba de consultas:** el cargador recibe un contador de consultas (gancho `logging` de Sequelize en la prueba) y la prueba compara 10 y 300 productos.

### Montos (`packages/dominio`, ruta crítica)

- Entradas como texto con `^\d{1,8}(\.\d{1,2})?$`; cualquier otra (incluidos números de JavaScript, negativos, exponentes y espacios) lanza `RangeError`. Se convierten con `new Decimal(texto)`, se suman y multiplican con `decimal.js`, y se devuelven con `toFixed(2)`. Sin redondeos: con 2 decimales en las entradas y una cantidad entera, el resultado es exacto.
- `validarSeleccion` no depende del orden de los grupos para el resultado (sí para el orden de los errores, criterio 56) y usa un `Map` de modificador a grupo; un modificador pertenece a un solo grupo dentro de un producto (un grupo se asigna una vez por producto).
- La PWA importa las mismas funciones para la vista previa del precio del combo y para mostrar precios; no suma montos por su cuenta.

### Eventos

- `PublicadorEventos.publicar` no tiene contexto (corre después de confirmar, criterio 27b de 001): el evento lleva su `empresaId`, que el servicio toma de `empresaActual()` al registrarlo.
- `eventos-carta.ts` agrupa en una sola publicación los cambios de una petición (por ejemplo, un `PATCH` de producto publica un solo `carta.actualizada`).
- `PublicadorNulo` es el proveedor por defecto: los eventos no van a ningún lado hasta la sección 3. Las pruebas instalan `PublicadorEnMemoria` con `crearAplicacion({ publicadorEventos })`.

### PWA

- **Rutas:** `/carta` (segmento por parámetro `?ver=productos|familias|modificadores|estaciones`), `/carta/productos/nuevo`, `/carta/productos/:id`, `/carta/modificadores/nuevo`, `/carta/modificadores/:id`, `/disponibilidad` (`?ver=agotados|menu`). Cargadas bajo demanda, como la administración de 002. Guardas: `permisos.EDITAR_CARTA === 'permitido'` para `/carta`; `permisos.GESTIONAR_DISPONIBILIDAD === 'permitido'` para `/disponibilidad`.
- **Vista de la sucursal:** una consulta de TanStack Query con clave por sucursal activa; `api.ts` guarda el último `ETag` por URL y manda `If-None-Match`; un 304 conserva los datos. Refresco cada 15 s con `segundoPlano: true` y al volver el foco (criterio 80).
- **Agotados optimistas:** el interruptor cambia al instante, la escritura sale con reintentos y, si falla con un 4xx, vuelve atrás con un aviso; sin conexión, la fila muestra "Pendiente de envío". "Deshacer" manda la escritura contraria.
- **Montos:** campos de monto con `inputmode="decimal"`, validación con `montoSchema` / `montoNoNegativoSchema` y formato con el ayudante de 002 (`lib/formato.ts`).
- **Formularios largos** (producto, grupo): un solo formulario por pantalla, secciones con título, acción principal fija abajo; los borradores se conservan en memoria de la pantalla ante un corte (criterio 78).

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Opciones de combo y platos del menú como modificadores ligados a productos | Entidad "Opción de combo" aparte | Es lo que prevé el modelo de datos del diseño (no lista una entidad de opciones); un solo mecanismo de selección, de validación y de descuento de stock |
| Agotado en su propia tabla (`producto_agotado`) | Columnas en `producto_sucursal` | Permisos distintos (Cocina frente a Administrador) y trazabilidad separada: el último que tocó el precio no se pisa con el que marcó el 86 |
| Vigencia del agotado calculada al leer con el día operativo | Tarea programada que reactiva a la hora de corte | Sin colas ni cron todavía; el cálculo es puro y probado; no hay estados intermedios si el proceso cae |
| Ajuste por sucursal solo con lo que difiere | Una fila por producto y sucursal siempre | Una sucursal nueva y un producto nuevo funcionan sin crear filas; menos datos que mantener |
| Puerto `PublicadorEventos` sin transporte; Socket.IO en la sección 3 | Socket.IO mínimo ahora | Pregunta 2; el comandero y la carta web todavía no existen; el aislamiento de Socket.IO se ataca una sola vez con todos sus consumidores |
| Vista con `ETag` y refresco cada 15 s | Pedir la vista completa cada vez | Respuestas 304 de pocos bytes por datos móviles; funciona igual cuando llegue Socket.IO (el evento solo dispara el refresco) |
| Fotos en R2 con conector y claves nuevas por foto | `bytea` en PostgreSQL | Pregunta 1; lo decide el documento de diseño; la base y sus respaldos no crecen; caché inmutable en Cloudflare |
| Reducir la foto en el navegador; validar formato y tamaño en la API sin procesar la imagen | Procesar con `sharp` en la API | `sharp` es una dependencia nativa (002 las evita en el VPS y en CI); la reducción en el celular ahorra datos móviles |
| `aws4fetch` para R2 | `@aws-sdk/client-s3` | JavaScript puro y liviano; solo hacen falta `PUT` y `DELETE` |
| Ruta binaria con su propio límite de 1 MB | Subir la foto en base64 dentro de JSON | El límite global de 100 KB de 001 queda igual para todo lo demás; un tercio menos de bytes |
| `@Permiso` con las acciones existentes en todas las rutas | `@SoloAdministrador` en la administración de la carta | La matriz de `packages/dominio` es la única fuente; si mañana cambia quién edita la carta, cambia una celda |
| Vista única para todos los roles | Una vista por rol (mozo, cocina, web) | Una sola consulta que optimizar y probar; cada consumidor filtra con `vendible` y `seVendeSolo` |
| Nada se borra; se desactiva | Borrado físico con comprobación de uso | Las ventas (sección 3) y el menú del día los referencian; el historial de la auditoría sigue apuntando a algo |

## Migraciones

Con fecha posterior a la última de 002 (`202610280008`); la fecha del prefijo es indicativa, lo que importa es que ordenen después. Una por grupo de tareas para que cada commit deje la base coherente. Todas las tablas con `sqlTablaDeEmpresaTrazable(tabla, { privilegiosApi, privilegiosPlataforma: [], llaveDeEquipo: true })`.

- `202610290001-carta-base.ts` (C1): `estacion`, `familia`, `producto` (con sus `CHECK`, únicos por `lower(nombre)` e índices). `down`: las borra en orden inverso.
- `202610290002-carta-sucursal.ts` (C2): `producto_sucursal`.
- `202610290003-carta-modificadores.ts` (C3): `grupo_modificadores`, `modificador`, `producto_grupo`.
- `202610290004-carta-combos.ts` (C4): `componente_combo`, `menu_del_dia_opcion`.
- `202610290005-carta-agotados.ts` (C5): `producto_agotado`.

Privilegios de `restaurante_api`: SELECT, INSERT, UPDATE en `estacion`, `familia`, `producto`, `producto_sucursal`, `grupo_modificadores` y `modificador`; además DELETE en `producto_grupo`, `componente_combo`, `menu_del_dia_opcion` y `producto_agotado`. Ninguna migración escribe datos.

## Riesgos

- **Pruebas que pasan por la razón equivocada** (como en 002). Una prueba de RLS que olvide fijar el actor falla con `42501` igual que un rechazo de la política. Mitigación: las pruebas del criterio 65 fijan un actor de A y comprueban el mensaje de la política.
- **Fotos huérfanas.** Si la transacción falla después de subir la foto (o el `COMMIT` falla), el archivo queda en R2 sin producto. Con fotos de unos 200 KB y fallas raras, el costo es despreciable. Remedio futuro: una tarea del worker que compare las claves del bucket con `producto.foto_clave` (fuera de alcance).
- **Foto borrada que sigue en caché.** Al quitar o reemplazar una foto, Cloudflare puede seguir sirviendo la anterior hasta que expire su caché. Es una imagen pública de la carta; se acepta.
- **Fotos de iPhone.** Safari entrega HEIC o JPEG según la versión; la reducción en el navegador convierte a JPEG si puede decodificarla y corrige la orientación. Si un navegador no puede, la API recibe el original y lo rechaza si no es JPEG, PNG o WebP (422 con un mensaje que pide otra foto). Verificar en la prueba manual con un iPhone real.
- **Credenciales de R2.** Si se filtran, alguien podría reemplazar o borrar fotos de la carta. Mitigación: token de R2 limitado a un bucket, secreto de GitHub y del entorno, y las claves no se derivan de datos del cliente.
- **Hora de corte y reloj.** Todo cálculo del día operativo usa el reloj de la API y `diaOperativo` de 001, nunca `now()` de la base; mezclar ambos daría agotados que vencen distinto en las pruebas. La revisión lo comprueba.
- **Carreras en la configuración.** Dos administradores que editan el mismo grupo a la vez: gana el último `PATCH` y cada uno deja su auditoría. Dos que ordenan a la vez: el bloqueo `FOR UPDATE` los serializa. Se acepta sin control de versión optimista.
- **Tamaño de la vista.** Con 300 productos y sus grupos, la respuesta puede pasar de 100 KB sin comprimir; con gzip de Cloudflare y el 304 del `ETag`, el refresco cada 15 s cuesta casi nada. Si crece, se puede paginar por familia sin cambiar los criterios.
- **Costo del `ETag`.** Se calcula armando la vista completa: el 304 ahorra red, no base de datos. Con 30 empresas y pocos equipos de cocina por local (un refresco cada 15 s), son unas pocas consultas por segundo. Si molesta, la sección 3 puede reemplazar el refresco por el evento de Socket.IO.
- **`decimal.js` en `packages/dominio`.** Suma unos 30 KB al paquete de la PWA, que ya lo incluye (`apps/app`); se usa la misma versión fija para no duplicarlo.
- **Tamaño de la sección.** Cinco historias con pantallas. Mitigación: commits por historia; la vista y `prepararLinea` (C5) se pueden adelantar si la sección 3 los necesita antes.
