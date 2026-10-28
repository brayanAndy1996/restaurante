# 003 · Plan técnico

## Módulos afectados

- `packages/dominio`:
  - `src/permisos.ts` (ruta crítica, decisión 5): una sola celda cambia en `MATRIZ`: `EDITAR_CARTA: [X, X, X, X, P]` pasa a `EDITAR_CARTA: [X, P, X, X, P]` (Mozo, Cajero, Cocina/Barra, Supervisor, Administrador). No se agregan acciones ni funciones; `largoPin` no cambia (el Cajero ya tiene PIN de 6). La cambia backend en la fase C (T6b), después de que test-writer ajusta las pruebas protegidas de 002 que afirman la celda anterior (P0 de `tasks.md`).
  - `src/carta/catalogos.ts`: tipos de producto, tipos de control de stock, afectaciones, selección, `HASTA_AGOTADO`, `ORIGENES_AGOTADO`, motivos de no vendible, errores de selección y límites (`CANTIDAD_MAXIMA_LINEA`, `CANTIDAD_MAXIMA_COMPONENTE`).
  - `src/carta/precios.ts` (ruta crítica): `precioEfectivo`, `validarSeleccion`, `calcularLinea`, con `decimal.js` (dependencia nueva del paquete, la misma versión fija que usa `apps/app`).
  - `src/carta/disponibilidad.ts`: `agotadoVigente`, `vendibilidad`.
  - Pruebas unitarias en `test/carta/`.
- `packages/contratos`: `src/carta.ts` (esquemas de la sección "Contrato" de `spec.md`, con `tipo?` y `confirmarPerdida?` en `productoModificarEntrada`, `editable` en `ajusteSucursalRespuesta`, y `usadoEn` y `seQuita`), `montoNoNegativoSchema` en `src/comunes.ts`, códigos nuevos en `src/errores.ts` (incluido `CONFIRMACION_REQUERIDA`) y los campos opcionales `usadoEn` y `seQuita` en `errorRespuestaSchema`.
- `apps/api`:
  - `src/modulos/carta/` (nuevo): dueño de `estacion`, `familia`, `producto`, `producto_sucursal`, `producto_agotado`, `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo` y `menu_del_dia_opcion`. Ver "Estructura del módulo".
  - `src/nucleo/eventos/` (nuevo): `PUBLICADOR_EVENTOS`, interfaz `PublicadorEventos`, `PublicadorNulo`, `PublicadorEnMemoria`.
  - `src/nucleo/archivos/` (nuevo): `ALMACEN_ARCHIVOS`, interfaz `AlmacenArchivos`, `AlmacenEnMemoria`, `AlmacenEnDisco`, `AlmacenR2`, `crearAlmacenDeEntorno`, `leerImagen(buffer)` (formato y dimensiones por los primeros bytes) y `cuerpo-binario.ts` (`analizadorBinarioDeFoto`, `LIMITE_FOTO_BYTES`: el analizador de cuerpo binario de 1 MB, solo para `PUT /carta/productos/:id/foto`; ver "Fotos").
  - `src/nucleo/errores/`: `ErrorAplicacion` gana el parámetro opcional `detalle` (`DetalleDeError`: `usadoEn` o `seQuita`), y `FiltroGlobalErrores` copia `detalle.usadoEn` y `detalle.seQuita` al cuerpo de la respuesta, como ya hacía con `reintentarEnSegundos` (criterios 10b y 10c).
  - `src/modulos/plataforma/sucursales-consulta.service.ts`: método `horaCorte(sucursalId, transaccion?)`.
  - `src/modulos/seguridad/`: sin cambios; `CartaModule` importa `SeguridadModule` para usar `SesionesService.sucursalesElegibles(usuarioId, esAdministrador)` (ya exportado), que da el rol de la persona en cada sucursal (criterio 19b).
  - `src/aplicacion.ts`: opciones `publicadorEventos` y `almacenArchivos` de `crearAplicacion`; `analizadorBinarioDeFoto()` montado antes de los analizadores de JSON; CORS con `If-None-Match` y `ETag`; servidor estático de `/archivos` (Express, fuera del enrutador de Nest) solo con `NODE_ENV=development`, `ARCHIVOS_DRIVER=disco` y sin un almacén inyectado por `crearAplicacion`.
  - `src/config/entorno.ts`: `ARCHIVOS_DRIVER`, `ARCHIVOS_DIRECTORIO`, `ARCHIVOS_URL_PUBLICA`, `R2_*`.
  - `src/migraciones/`: cinco migraciones (ver "Migraciones").
  - `src/app.module.ts`: `CartaModule`.
  - `test/carta/`: pruebas no protegidas del desarrollador; las protegidas van en `test/carta-critica/` (ver `tasks.md`).
- `apps/app`:
  - `src/modulos/carta/` (Administrador y Cajero): `CartaPagina` y `MarcoDeCarta` (título, segmentos por `?ver=` y acción principal de cada sección), `ListaDeCatalogo` (lista común de familias y estaciones: alta, edición, desactivar y ordenar en la misma pantalla), `ProductosLista`, `ProductoFormularioPagina` (con `SelectorDeTipo`, `GruposDelProducto`, `ComponentesDelCombo` y `VistaPreviaDeCombo`, que calcula "Precio con estas opciones" con `calcularLinea`), `PrecioPorSucursal`, `FotoDeProducto`, `FamiliasLista`, `EstacionesLista`, `GruposLista`, `GrupoFormularioPagina` y `GrupoFormulario`, los ayudantes de formulario (`producto-form.ts`, `grupo-form.ts`, `sucursales-form.ts`, `useFormularioDeGrupo.ts`, `tipos.ts`) y `carta.ts` (consultas y mutaciones de TanStack Query).
  - `src/modulos/disponibilidad/` (Cocina/Barra, Supervisor, Administrador): `DisponibilidadPagina` con segmentos "Agotados" (`AgotadosSeccion`, `agotados.ts`) y "Menú del día" (`MenuDelDiaSeccion`, `menu-del-dia.ts`); `disponibilidad.ts` (claves de consulta, llamadas a la API y hora de corte con `GET /sucursales/:id`) y `useVistaDeSucursal.ts` (la vista de la sucursal con `ETag` y refresco cada 15 s, compartida por los dos segmentos).
  - `src/lib/api.ts`: cuerpo binario (`Blob` con su `Content-Type`), `consultarSiCambio` (`If-None-Match` y respuesta 304) e `Idempotency-Key` reutilizable entre intentos.
  - `src/lib/envios.ts`: `enviarSinPerder` y `useEnvioPendiente`, la cola en memoria de "Pendiente de envío" (ver "PWA").
  - `src/componentes/PendienteDeEnvio.tsx`: `EtiquetaPendiente`, `PendienteDeEnvio` y `AvisoPendiente`, el mismo texto "Pendiente de envío" en filas y formularios.
  - `src/lib/imagen.ts`: reducir una foto en el navegador.
  - `src/App.tsx` y `src/componentes/AppLayout.tsx`: rutas `/carta…` y `/disponibilidad` y sus destinos, según `permisos` (el Cajero ve "Carta"; el segmento "Estaciones", solo con `ADMINISTRAR`).
- `packages/ui`: componentes nuevos con la skill `impeccable`: `CampoMonto` (teclado decimal, `S/` delante, cifras tabulares), `FilaOrdenable` (subir y bajar de 48 px), `Casilla` grande y `SelectorDeFoto`. No hay un `AvisoDeshacer`: el aviso "… está agotado · Deshacer" lo dibuja `AgotadosSeccion` en la PWA. Se reutilizan `Interruptor`, `Segmentos`, `Hoja`, `Lista`, `Estados`, `Aviso`, `EtiquetaDeEstado`.
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
  cargador-carta.ts                                       (las seis consultas fijas de la vista; ver abajo)
  armador-carta.ts                                        (arma productoDeVenta y la vista con lo cargado; puro, sin consultas)
  disponibilidad-carta.ts                                 (la única regla de "disponible como parte": vista y menú del día)
  etag-carta.ts                                           (JSON canónico, ETag fuerte e If-None-Match)
  util-carta.ts                                           (diferencias para la auditoría, sinCambioDeOrden, sumarDias, aIso)
  referencias.ts                                          (validación de ids de la empresa y su tipo)
  permisos-carta.ts                                       (clase inyectable PermisosCarta: rol en la sucursal ajustada)
  cambio-tipo.ts                                          (qué se quita y dónde se usa al cambiar el tipo; criterios 10b y 10c)
  eventos-carta.ts                                        (clase EventosCarta: arma y registra los eventos con alConfirmar)
  errores-carta.ts                                        (errores del módulo, incluidos ErrorProductoNoVendible y ErrorSeleccionInvalida)
```

Fuera del módulo, `nucleo/archivos/cuerpo-binario.ts` lee el cuerpo de la foto y `aplicacion.ts` monta el servidor estático de `/archivos` solo en desarrollo (ver "Fotos").

- Todo corre dentro del contexto de empresa que abre el interceptor global (002), con el actor de la sesión; los servicios usan la transacción del contexto. Ningún servicio consulta tablas de otros módulos: las sucursales se leen con `SucursalesConsultaService` (`existen`, `listar`, `horaCorte`) y la auditoría se escribe con `AuditoriaService.registrar`.
- `CartaModule` exporta `CartaVentaService` y `CartaDisponibilidadService`; nada más.
- Los controladores aplican `@Permiso('EDITAR_CARTA')`, `@Permiso('ADMINISTRAR')` (solo `POST` y `PATCH` de estaciones) o `@Permiso('GESTIONAR_DISPONIBILIDAD')` + `@RequiereSucursal()` según la tabla de endpoints; `GET /carta/sucursal` solo `@RequiereSucursal()`. Los `POST` llevan `@Idempotente()`. `PUT /carta/productos/:id/foto` es además `@SinEmpresa()`: el interceptor no abre la transacción de la petición y el servicio abre las suyas (ver "Fotos"); `@Permiso('EDITAR_CARTA')` se evalúa igual. `PermisoInterceptor` (002) evalúa la acción con el rol de la sucursal activa y responde 409 `SUCURSAL_NO_ELEGIDA` si no hay rol (un Cajero sin sucursal activa); el Administrador tiene rol sin sucursal activa.

### Permiso por sucursal ajustada (criterio 19b, ruta crítica)

- `permisos-carta.ts` define `PermisosCarta`, una clase `@Injectable()` (proveedor de `CartaModule`) que recibe `SesionActual` y `SesionesService`. Sus métodos:
  - `sucursalesAjustables()`: `'todas'` si el principal es `esAdministrador` (incluidos el soporte y el principal de prueba); si no, el conjunto de ids (en minúsculas) de las sucursales donde `requisitoPermiso(rol, 'EDITAR_CARTA') === 'permitido'`, con el rol leído por `SesionesService.sucursalesElegibles(usuarioId, false)` dentro de la transacción de la petición. Sin usuario, conjunto vacío. Es una sola lectura de los roles.
  - `puedeAjustarSucursal(sucursalId)`: `true` si la sucursal está en ese conjunto (o son `'todas'`). Compara en minúsculas.
  - `exigirAjustarSucursal(sucursalId)`: 403 `PROHIBIDO` con el mensaje del criterio 19b si no puede.
  - `exigirAjustarSucursales(sucursalIds)`: lo mismo para una lista, con una sola lectura de los roles (`noDisponibleEn` del alta).
  La regla sale de la matriz: no hay una lista aparte de roles que ajustan precios.
- La usan: `PUT /carta/productos/:id/sucursales/:sucursalId` (`exigirAjustarSucursal`, después de comprobar que el producto y la sucursal existen en la empresa, para que un id de B responda 404 igual que uno inexistente, y antes de leer o escribir `producto_sucursal`); `POST /carta/productos` (`exigirAjustarSucursales` con `noDisponibleEn`, después de validar las referencias, 422); y `GET /carta/productos/:id/sucursales` (`sucursalesAjustables`, para calcular `editable` con una sola lectura de los roles).
- Se lee en cada petición, así que un cambio de rol hecho por el Administrador vale desde la siguiente (criterio 6 de 002).

### Escrituras de configuración

1. El `PipeZod` valida la forma (400).
2. El servicio valida las referencias con `referencias.ts`: una sola consulta por tipo de entidad (`SELECT id, tipo, activo FROM producto WHERE id = ANY($1)`), bajo RLS, así que un id de B no aparece y se trata igual que uno inexistente (422 `REFERENCIA_INVALIDA` con `campos`). Comprueba también el tipo (componente y producto ligado `SIMPLE`) y que estén activos. Los productos referidos como componente o producto ligado se leen con `FOR SHARE`, para serializarse con un cambio de tipo concurrente (ver "Cambio de tipo").
3. Lee la fila actual con `FOR UPDATE` (para el antes de la auditoría y para el no-op), aplica el cambio, y si no cambió nada responde sin auditar.
4. Registra la auditoría con el antes y el después (los montos como texto), y el evento `carta.actualizada` con `alConfirmar`.
5. Las violaciones de unicidad (`23505` sobre `lower(nombre)`) se traducen a 409 `CONFLICTO`; las de llave foránea que escapen a la validación previa (carreras con una desactivación), a 422 `REFERENCIA_INVALIDA`.

- **Listas que se reemplazan** (`gruposModificadores`, `componentes`, `modificadores` del grupo): se calcula la diferencia con lo guardado; en `producto_grupo` y `componente_combo` se borran las filas que salen y se insertan o actualizan las demás con su orden; en `modificador` los que salen pasan a `activo = false`.
- **`EN_USO`:** antes de desactivar una estación, una familia o un grupo, se cuentan los productos activos que los usan, con la fila bloqueada `FOR UPDATE`, para que una creación concurrente no se cuele (la creación de un producto lee la familia y la estación con `FOR SHARE`).
- **Orden:** `PUT …/orden` bloquea las filas de la empresa (familias) o de la familia (productos) con `FOR UPDATE`, comprueba que `ids` sea exactamente ese conjunto y reescribe `orden` = posición. Un producto o una familia nuevos toman `max(orden) + 1` con la misma fila de la familia bloqueada.
- **Reglas sobre el resultado:** las reglas del criterio 7 se comprueban sobre el resultado de mezclar lo guardado con lo enviado, en el orden de rechazos del criterio 10.
- **Orden de bloqueo:** familia, estación, grupos, producto y, al final, componentes. Dos transacciones que toman las mismas filas en el mismo orden se esperan pero no se bloquean mutuamente (un abrazo mortal lo corta PostgreSQL abortando una de las dos, que respondería 500). Cada paso del orden sale de quién bloquea qué:
  - **Familia antes que producto:** `ordenarDeFamilia` bloquea la familia `FOR UPDATE` y después sus productos; el alta y el cambio de familia toman la familia `FOR UPDATE` para calcular `max(orden) + 1`.
  - **Estación antes que producto:** desactivar una estación la bloquea `FOR UPDATE` y cuenta los productos activos sin bloquearlos; el alta lee la estación `FOR SHARE` antes de insertar. En el `PATCH` la estación se lee `FOR SHARE` después del producto, lo que no forma un ciclo porque quien tiene una estación bloqueada nunca espera a un producto.
  - **Grupos antes que producto:** `GruposService.modificar` bloquea el grupo y sus modificadores `FOR UPDATE` y después lee sus productos ligados `FOR SHARE`. Si el `PATCH` de un producto tomara primero el producto `FOR UPDATE` y después el grupo `FOR SHARE`, un producto que es el ligado de un grupo que se le asigna formaría un ciclo. Por eso `ProductosService.bloquearEnOrden` toma, antes de leer el producto, la familia de destino (si cambia o se reactiva) y los grupos del cuerpo (y los guardados, si se reactiva), ordenados por id.
  - **Componentes después del producto:** el `PATCH` de un combo bloquea el combo `FOR UPDATE` y después lee sus componentes `FOR SHARE` (`referencias.ts`). Un componente es `SIMPLE`, así que no bloquea nada más. La excepción es un cambio de tipo cruzado (X pasa a combo con Y como componente mientras Y pasa a combo con X): cada uno tiene su producto y espera al otro. Es una falla de la ronda 1 de T30 y está en corrección.
- **Bloqueos que no frenan las llaves foráneas:** el ajuste por sucursal y el armado del menú del día bloquean el producto `FOR NO KEY UPDATE` y no `FOR UPDATE`. Así se serializan entre sí (el antes de la auditoría es exacto) y con un `PATCH` o un cambio de tipo (`FOR UPDATE`), pero no frenan las inserciones de filas hijas que solo comprueban la llave foránea del producto (`FOR KEY SHARE`), como otro ajuste en otra sucursal o un agotado.

### Cambio de tipo (criterios 10b a 10d)

1. `PATCH /carta/productos/:id` bloquea el producto con `FOR UPDATE`. Si `tipo` viene y es distinto del guardado, es un cambio de tipo.
2. Mezcla lo guardado con lo enviado: a `COMBO` o `MENU_DEL_DIA`, `estacion_id = null` y `se_vende_solo = true`; a `SIMPLE`, exige `estacionId` en la entrada (400 si falta) y deja `componentes` vacío. Valida el criterio 7 sobre el resultado (400).
3. A `COMBO` o `MENU_DEL_DIA`: `cambio-tipo.ts` busca dónde se usa el producto con dos consultas (`componente_combo` por `producto_id`, con el nombre del combo; `modificador` activo por `producto_id`, con su grupo). Si hay alguna fila, 409 `EN_USO` con `usadoEn` y el mensaje armado con los nombres.
4. Si queda `seVendeSolo: false` y hay filas de `producto_sucursal` con `precio` no nulo, 409 `CONFLICTO` (criterio 10d).
5. Calcula `seQuita`: la estación guardada (si pasa a combo o menú y tenía), los componentes guardados (si pasa a simple) y las opciones del día (si deja de ser menú), agrupadas por sucursal y día, solo las de un día igual o posterior al día operativo actual de cada sucursal (`diaOperativo(reloj.ahora(), horaCorte)` con `SucursalesConsultaService.horaCorte`). Si no está vacío y no viene `confirmarPerdida: true`, 409 `CONFIRMACION_REQUERIDA` con `seQuita`, sin escribir nada.
6. Aplica: `UPDATE producto` (tipo, estación, `se_vende_solo` y lo demás enviado), `DELETE FROM componente_combo WHERE combo_id = $1` si pasa a simple, `DELETE FROM menu_del_dia_opcion WHERE producto_id = $1` si deja de ser menú (todas las filas, también las de días pasados). Una sola fila de auditoría `modificar_producto` con `tipo` antes y después y `quitado` (lo realmente borrado, que puede incluir filas que no estaban en `seQuita` si alguien las agregó entre los dos pedidos). Un solo `carta.actualizada` de empresa con `alConfirmar`.
- **Carreras con referencias nuevas:** quien agrega un componente o un producto ligado lee el producto referido con `FOR SHARE` (`referencias.ts`), y el cambio de tipo lo tiene con `FOR UPDATE`; así se serializan. Con `READ COMMITTED`, la segunda operación vuelve a leer la fila o las referencias después del bloqueo y ve el estado nuevo: un componente que ya no es simple da 422 y un producto que ya se usa da 409 `EN_USO`.
- **Reactivaciones:** `PATCH` de un grupo que reactiva el grupo o un modificador vuelve a validar el producto ligado con `referencias.ts` (criterio 27), así un modificador inactivo que apunta a un producto que pasó a combo no vuelve a ofrecerse.

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

`producto_sucursal` guarda solo lo que difiere: `PUT` hace `INSERT … ON CONFLICT (producto_id, sucursal_id) DO UPDATE` y, si el resultado es el valor por defecto (`precio` nulo y `disponible`), deja la fila igual (no la borra, para no perder la trazabilidad del último cambio). `noDisponibleEn` del alta inserta filas con `disponible = false`. La sucursal se valida con `SucursalesConsultaService.existen` (404 si no es de la empresa) y después con `exigirAjustarSucursal` (403 para el Cajero en una sucursal donde no es Cajero, criterio 19b), antes de cualquier lectura con bloqueo o escritura.

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

- **Rutas:** `/carta` (segmento por parámetro `?ver=productos|familias|modificadores|estaciones`), `/carta/productos/nuevo`, `/carta/productos/:id`, `/carta/modificadores/nuevo`, `/carta/modificadores/:id`, `/disponibilidad` (`?ver=agotados|menu`). Cargadas bajo demanda, como la administración de 002. Guardas: `permisos.EDITAR_CARTA === 'permitido'` para `/carta` (Administrador y Cajero); `permisos.ADMINISTRAR === 'permitido'` para el segmento "Estaciones"; `permisos.GESTIONAR_DISPONIBILIDAD === 'permitido'` para `/disponibilidad`. Las guardas solo ordenan la interfaz: la API decide.
- **Precio por sucursal:** cada fila usa `editable` de la respuesta; las no editables se muestran solo para leer. En el alta, las casillas de "Disponible en" de las sucursales no editables quedan marcadas y bloqueadas (la PWA las calcula con `sucursales` de `GET /sesion`: editables son las de rol con `EDITAR_CARTA` permitido).
- **Cambio de tipo:** el selector de tipo está también en la edición. Guardar manda el `PATCH` sin `confirmarPerdida`; con 409 `CONFIRMACION_REQUERIDA` abre una hoja con `seQuita` en palabras y, si se confirma, repite el mismo `PATCH` con `confirmarPerdida: true`; con 409 `EN_USO` muestra `usadoEn` con enlaces a esos combos y grupos.
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
| Puerto `PublicadorEventos` sin transporte; Socket.IO en la sección 3 | Socket.IO mínimo ahora | Decisión 2; el comandero y la carta web todavía no existen; el aislamiento de Socket.IO se ataca una sola vez con todos sus consumidores |
| Vista con `ETag` y refresco cada 15 s | Pedir la vista completa cada vez | Respuestas 304 de pocos bytes por datos móviles; funciona igual cuando llegue Socket.IO (el evento solo dispara el refresco) |
| Fotos en R2 con conector y claves nuevas por foto | `bytea` en PostgreSQL | Decisión 1; lo decide el documento de diseño; la base y sus respaldos no crecen; caché inmutable en Cloudflare |
| Reducir la foto en el navegador; validar formato y tamaño en la API sin procesar la imagen | Procesar con `sharp` en la API | `sharp` es una dependencia nativa (002 las evita en el VPS y en CI); la reducción en el celular ahorra datos móviles |
| `aws4fetch` para R2 | `@aws-sdk/client-s3` | JavaScript puro y liviano; solo hacen falta `PUT` y `DELETE` |
| Ruta binaria con su propio límite de 1 MB | Subir la foto en base64 dentro de JSON | El límite global de 100 KB de 001 queda igual para todo lo demás; un tercio menos de bytes |
| `@Permiso` con las acciones existentes en todas las rutas | `@SoloAdministrador` en la administración de la carta | La matriz de `packages/dominio` es la única fuente; cuando el usuario dio la carta al Cajero (decisión 5) cambió una sola celda |
| Restricción del Cajero por sucursal calculada con la matriz sobre el rol en la sucursal ajustada | Una acción nueva `AJUSTAR_PRECIO_SUCURSAL`; exigir que la sucursal ajustada sea la activa | Sin acción nueva, la matriz no crece y el documento de diseño solo cambia una celda; exigir la sucursal activa le quitaría al Administrador ajustar cualquier sucursal sin elegirla (criterios 18 a 22) y obligaría al Cajero de dos sucursales a cambiar de sucursal para cada ajuste |
| Escrituras de estaciones con `ADMINISTRAR` | Dejarlas con `EDITAR_CARTA` (el Cajero también); una acción nueva | Decisión del usuario (las define solo el Administrador); `ADMINISTRAR` ya cubre la configuración y tiene la misma fila que tenía `EDITAR_CARTA` |
| Cambio de tipo que borra lo que deja de aplicar, con confirmación por 409 | Conservarlo desactivado; un endpoint aparte de vista previa | Las ventas guardan su copia; no hay datos ocultos que reaparezcan; la auditoría guarda lo borrado; el 409 con `seQuita` es la vista previa sin otra ruta |
| Dejar de venderse solo con precios de sucursal responde 409 | Borrar esos precios de paso | El Cajero no puede borrar el precio de una sucursal donde no es Cajero por un camino indirecto |
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

- **Pruebas que pasan por la razón equivocada** (como en 002). Una prueba de RLS que olvide fijar el actor falla con `42501` igual que un rechazo de la política. Mitigación: las pruebas del criterio 65 fijan un actor de A y comprueban el mensaje de la política. Lo mismo con el Cajero: un 403 en S2 debe venir de la regla del criterio 19b y no de una sesión sin sucursal activa o con S2 activa; las pruebas de P2 usan al Cajero con S1 activa y comprueban que la misma sesión sí ajusta S1.
- **Pruebas protegidas de 002 que cambian.** Tres archivos protegidos de 002 afirman que el Cajero no tiene `EDITAR_CARTA` (`spec.md`, "Impacto en especificaciones anteriores"). Los ajusta test-writer en la fase B (P0), por la decisión del usuario; quien implementa no los toca. El orquestador, al revisar con `git diff`, acepta solo esos cambios en esos archivos y en la fase B.
- **El Cajero cambia lo que es de toda la empresa.** El precio de la empresa, desactivar un producto o cambiar su tipo afectan también a las sucursales donde no es Cajero (decisión 5: "toda la carta"). Mitigación: auditoría con el autor y la sucursal activa, y el precio propio de cada sucursal protegido por el criterio 19b.
- **Confirmación desactualizada.** Entre el 409 `CONFIRMACION_REQUERIDA` y el `PATCH` confirmado, otro usuario puede agregar componentes u opciones del día; el `PATCH` confirmado borra también esas. Se acepta: la auditoría guarda exactamente lo borrado. Si molesta, se puede exigir que `confirmarPerdida` traiga la huella de `seQuita`.
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
