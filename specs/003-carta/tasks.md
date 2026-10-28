# 003 · Tareas

Cada tarea indica su rol y los criterios de `spec.md` que cubre. La fase C se agrupa por historia: cada grupo termina con la suite en verde y un commit propio (lo hace el documentador), en el orden C1, C2, C3, C4, C5, porque cada uno usa lo anterior.

**Qué lleva pruebas protegidas.** Solo lo propuesto como ruta crítica en `spec.md` ("Clasificación de ruta crítica"): las reglas puras de montos (criterios 55 a 58), los permisos y la auditoría de la carta (60 a 62) y el aislamiento entre empresas (64 a 69). Esas pruebas las escribe test-writer en la fase B, antes de implementar, y nadie más las toca. Todo lo demás (CRUD, fotos, agotados, menú del día, vista, eventos, interfaz) lleva las pruebas que decida quien implementa, marcadas abajo como "pruebas no protegidas". La trazabilidad de las tablas nuevas (criterio 63) ya la cubre la prueba de catálogo protegida de 002.

Si el usuario cambia alguna respuesta de las "Preguntas abiertas", el especificador ajusta los criterios y estas tareas antes de la fase B.

## Fase A · Armado mínimo y firmas públicas (backend)

Deja lo necesario para que las pruebas protegidas compilen y corran. No implementa reglas de montos, permisos ni tablas.

- [ ] T1 · backend · `packages/contratos`: `src/carta.ts` con los esquemas de la sección "Contrato" (entradas estrictas, unión discriminada de `grupoEntrada`, eventos), `montoNoNegativoSchema` en `comunes.ts`, y `REFERENCIA_INVALIDA`, `EN_USO`, `FOTO_INVALIDA`, `PRODUCTO_NO_VENDIBLE` y `SELECCION_INVALIDA` en `CODIGOS_ERROR`; pruebas unitarias de los esquemas (largos, montos con y sin 0, tipos, `UNICA` frente a `MULTIPLE`, campos desconocidos, sin `empresaId` ni `creadoPor*`). (criterios 1, 3, 6, 7, 14, 19, 24, 25, 35, 39; validación de datos)
- [ ] T2 · backend · `packages/dominio`: `decimal.js` como dependencia (versión fija igual a la de `apps/app`); `src/carta/catalogos.ts` implementado; firmas de `precios.ts` (`precioEfectivo`, `validarSeleccion`, `calcularLinea`) y de `disponibilidad.ts` (`agotadoVigente`, `vendibilidad`) que lanzan `Error('No implementado')`, con sus tipos exportados desde el índice. (criterios 55 a 57 y 59, firma)
- [ ] T3 · backend · Núcleo: `src/nucleo/eventos/` (`PUBLICADOR_EVENTOS`, `PublicadorEventos`, `PublicadorNulo`, `PublicadorEnMemoria` con `eventos()` y `limpiar()`) y `src/nucleo/archivos/` (`ALMACEN_ARCHIVOS`, `AlmacenArchivos`, `AlmacenEnMemoria` con `claves()`), implementados completos (son infraestructura de pruebas); opciones `publicadorEventos` y `almacenArchivos` de `crearAplicacion`. (habilita la fase B)
- [ ] T4 · backend · Firmas que lanzan `Error('No implementado')`, en las rutas de archivo de `plan.md`: `CartaModule` registrado en `AppModule`; todos los controladores con sus rutas de la tabla de endpoints **sin** `@Permiso` ni `@RequiereSucursal` (se agregan en la fase C con cada ruta, para que las pruebas de permisos fallen por la razón esperada); `CartaVentaService` (`cartaDeSucursal`, `prepararLinea`), `CartaDisponibilidadService` (`marcarAgotado`, `reactivar`) y `SucursalesConsultaService.horaCorte`. Sin lógica ni migraciones.
- [ ] T5 · backend · Entorno: `ARCHIVOS_DRIVER` (con `memoria` por defecto en `test`), `ARCHIVOS_DIRECTORIO`, `ARCHIVOS_URL_PUBLICA` y `R2_*` en `entorno.ts`, `fijarEntornoDePrueba`, `.env.example` y el workflow de CI, sin comportamiento todavía.

## Fase B · Pruebas primero (ruta crítica)

Las escribe test-writer a partir de `spec.md` y de los contratos públicos, sin mirar la implementación. Todos los archivos llevan al inicio `// spec: 003-carta (pruebas protegidas)` y viven en `apps/api/test/carta-critica/` (salvo las de `packages/dominio`). Usan la app real con `RelojManual`, `PublicadorEnMemoria` y `AlmacenEnMemoria`, empresas creadas por `POST /plataforma/empresas` y usuarios por `POST /usuarios`, como en 002. Toda escritura por SQL fija antes un actor con `fijar_contexto_actor`. Los nombres son sugeridos.

- [ ] P1 · test-writer · `packages/dominio/test/carta/precios.spec.ts`: cada ejemplo de los criterios 55, 56 y 57 (incluidos el orden de los errores, la exactitud decimal, el precio de sucursal, `PRODUCTO_SIN_PRECIO` y los `RangeError` de montos y cantidades inválidos: números de JavaScript, negativos, exponentes, más de 2 decimales, más de 8 enteros, cantidad 0, −1, 1.5 y 1000). Y `apps/api/test/carta-critica/linea-preparada.spec.ts`: `prepararLinea` devuelve exactamente lo que da `calcularLinea` con los mismos datos, con precio de empresa y con precio de sucursal, para un simple con modificadores, un combo y un menú del día; producto o modificador de B igual que inexistente. (criterios 55 a 58)
- [ ] P2 · test-writer · `permisos-carta.spec.ts`: recorrido de las rutas de `/carta` registradas en Nest con la clasificación del criterio 60 (falla si aparece una ruta sin clasificar); para cada rol sin permiso, con sesión de contraseña y de PIN, cada ruta responde 403 `PROHIBIDO` sin cambiar filas, sin auditoría, sin archivos guardados o borrados en el almacén y sin eventos; Cocina/Barra, Supervisor y Administrador sí marcan agotados y arman el menú en su sucursal activa, sin sucursal activa 409, y con un rol distinto en otra sucursal reciben 403 con esa sucursal activa (criterio 42); `GET /carta/sucursal` para todos los roles con sucursal activa; el Administrador edita la carta sin sucursal activa; soporte con trazabilidad y auditoría del superadministrador; una fila de auditoría por escritura con el antes y el después exactos de cada cambio de precio (precio del producto, de sucursal y precio extra), y ninguna en las escrituras que no cambian nada. (criterios 42, 43, 60 a 62)
- [ ] P3 · test-writer · `rls-carta.spec.ts` y `referencias-carta.spec.ts`: lectura, actualización, borrado e inserción entre empresas en cada tabla nueva, con un actor de A fijado y comprobando que el rechazo es de la política RLS; llaves compuestas ante cada referencia cruzada del criterio 66; por HTTP, ids de B en la ruta (404) y en el cuerpo (422 `REFERENCIA_INVALIDA` o 400 en el orden) con el mismo cuerpo que un id inexistente y sin cambios en B, en cada ruta de `/carta`; listados y vista solo con datos de A; claves de fotos bajo el prefijo de A y nunca un borrado de un archivo de B; eventos con la empresa A; 100 peticiones concurrentes con pool de 2 a la vista y al agotado alternando A y B. (criterios 64 a 69)
- [ ] P4 · tester · Confirmar que P1 a P3 fallan por la razón esperada ("No implementado", tablas inexistentes, rutas sin `@Permiso` que responden 500 en lugar de 403) y no por errores de importación, sintaxis o configuración; y que las pruebas de 001 y 002 siguen en verde.

## Fase C · Implementación por historia

Las tareas de backend y frontend no modifican, borran ni debilitan las pruebas de la fase B. El frontend usa la skill `impeccable` y sigue `DESIGN.md` y `PRODUCT.md`.

### C1 · HU-05: estaciones, familias, productos y fotos

Commit propio. HU-05, RF-14, RF-19 (definir estaciones).

- [ ] T6 · backend · Reglas puras de montos en `packages/dominio/src/carta/precios.ts` (`precioEfectivo`, `validarSeleccion`, `calcularLinea`) con `decimal.js`, hasta dejar P1 (dominio) en verde. (criterios 55 a 57)
- [ ] T7 · backend · Migración `202610290001-carta-base.ts` (`estacion`, `familia`, `producto`) con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`. (criterios 64, 65 en parte)
- [ ] T8 · backend · Estaciones y familias: `GET`, `POST`, `PATCH`, `EN_USO`, orden de familias y de productos, con `@Permiso('EDITAR_CARTA')`, `@Idempotente()` en los `POST`, `referencias.ts` y auditoría. Pruebas de integración no protegidas. (criterios 1 a 5, 13)
- [ ] T9 · backend · Productos simples: `GET /carta/productos`, `GET /carta/productos/:id` (con `usadoEn`), `POST`, `PATCH` (incluido desactivar), con las reglas del criterio 7 para `SIMPLE` y "se vende solo", referencias de familia y estación, nombres únicos y auditoría con el antes y el después del precio. Los tipos `COMBO` y `MENU_DEL_DIA`, los grupos y los componentes llegan en C3 y C4; mientras tanto responden 400. Pruebas no protegidas. (criterios 6 a 12)
- [ ] T10 · backend · Fotos: `leerImagen`, `AlmacenEnDisco` (con el servidor estático de `/archivos` solo en desarrollo), `AlmacenR2` con `aws4fetch`, analizador binario de 1 MB solo para la ruta de la foto, `PUT` y `DELETE /carta/productos/:id/foto` con borrado de la anterior en `alConfirmar`, reglas de `ARCHIVOS_DRIVER` por entorno, README. Pruebas no protegidas con imágenes de muestra (JPEG, PNG y WebP válidos, archivo truncado, firma que no coincide con el `Content-Type`, 199 y 2049 px, 1 MB + 1 byte, transacción revertida que conserva la foto anterior). (criterios 14 a 17)
- [ ] T11 · frontend · Destino "Carta" en la navegación según `permisos`; `/carta` con segmentos; listas de productos (agrupada por familia, búsqueda, filtro, modo ordenar), familias y estaciones; formulario de producto simple (tipo, datos tributarios plegados, estación con "Ninguna" si se aprueba la pregunta 11, tipo de control de stock con ayuda, "Se vende solo", "Disponible en"); foto con reducción en el navegador, vista previa, avance y reintento; `api.ts` con cuerpo binario; componentes `CampoMonto`, `FilaOrdenable` y `SelectorDeFoto` en `packages/ui`; estados de carga, vacío, error y sin conexión. Pruebas de componente. (criterios 70 a 72, 74, 75 en parte, 78, 79)
- [ ] T12 · tester · Suite completa, lint, tipos y build; P1 (dominio) en verde; las partes de P2 y P3 que tocan estaciones, familias, productos y fotos en verde.

### C2 · HU-06: ajuste por sucursal

Commit propio. HU-06, RF-15 (precio y disponibilidad).

- [ ] T13 · backend · Migración `202610290002-carta-sucursal.ts` (`producto_sucursal`); `GET` y `PUT /carta/productos/:id/sucursales/:sucursalId` con `SucursalesConsultaService`, `noDisponibleEn` en el alta, precio efectivo con `precioEfectivo`, auditoría `ajustar_producto_sucursal` con el antes y el después. Pruebas no protegidas de los ejemplos de los criterios 20 y 21 y de una sucursal nueva. (criterios 18 a 23)
- [ ] T14 · frontend · Sección "Precio por sucursal" dentro del producto (precio efectivo, campo propio que vacío usa el de la empresa, interruptor "Disponible", guardado por fila). (criterio 73)
- [ ] T15 · tester · Suite completa, lint, tipos y build.

### C3 · HU-07: modificadores

Commit propio. HU-07, RF-16.

- [ ] T16 · backend · Migración `202610290003-carta-modificadores.ts` (`grupo_modificadores`, `modificador`, `producto_grupo`); `GET`, `POST` y `PATCH /carta/grupos-modificadores` con la regla de mínimo, máximo y obligatorio, el reemplazo de la lista de modificadores (crear, actualizar, desactivar), el producto ligado `SIMPLE` y activo, `EN_USO`; asignación de grupos en el alta y la edición de productos (orden, repetidos, inactivos); auditoría con los precios extra antes y después. Pruebas no protegidas. (criterios 24 a 29; 6, 8, 9 y 10 en lo que toca a grupos)
- [ ] T17 · frontend · Segmento "Modificadores": lista con la regla en palabras y cuántos productos usan cada grupo; formulario de grupo (única o varias, obligatorio o mínimo y máximo, opciones con precio extra y producto ligado, ordenar y quitar); en el producto, elegir, ordenar y quitar grupos, y crear uno sin salir. (criterios 72 en parte, 75)
- [ ] T18 · tester · Suite completa, lint, tipos y build.

### C4 · HU-08: combos y menú del día

Commit propio. HU-08, RF-17, RF-18.

- [ ] T19 · backend · Migración `202610290004-carta-combos.ts` (`componente_combo`, `menu_del_dia_opcion`); tipos `COMBO` y `MENU_DEL_DIA` en el alta y la edición (reglas del criterio 7, componentes `SIMPLE` con cantidad, sin anidar, `usadoEn`). Pruebas no protegidas. (criterios 6 a 12 en lo que toca a combos, 30 a 33)
- [ ] T20 · backend · `SucursalesConsultaService.horaCorte`; `GET` y `PUT /carta/sucursal/menu-del-dia…` con `@Permiso('GESTIONAR_DISPONIBILIDAD')` y `@RequiereSucursal()` (según la respuesta a la pregunta 5), días permitidos según el día operativo de la sucursal con el reloj, reemplazo de las opciones del día, no-op sin auditoría, auditoría `armar_menu_del_dia`. Pruebas no protegidas con el reloj (cambio de día a la hora de corte, armado de la víspera, otra sucursal sin cambios). (criterios 34 a 38)
- [ ] T21 · frontend · Formulario de combo y menú (componentes con cantidad, grupos de opciones, vista previa "Precio con estas opciones" con `calcularLinea`); destino "Disponibilidad" con el segmento "Menú del día" (Hoy y Mañana, casillas por tiempo con recargo y estado, "Repetir las de ayer", aviso de menú sin armar). (criterios 70, 72 en parte, 76, 79)
- [ ] T22 · tester · Suite completa, lint, tipos y build.

### C5 · HU-09: agotados, vista de la sucursal y contratos para otras secciones

Commit propio. HU-09, RF-20, RF-15 (agotado), y los contratos para las secciones 3, 5 y 6.

- [ ] T23 · backend · `agotadoVigente` y `vendibilidad` en `packages/dominio` con pruebas unitarias no protegidas (cada motivo y su prioridad, menú sin armar, opciones insuficientes, modificador con producto ligado agotado). (criterio 59)
- [ ] T24 · backend · Migración `202610290005-carta-agotados.ts` (`producto_agotado`); `PUT` y `DELETE /carta/sucursal/agotados/:productoId` con `@Permiso('GESTIONAR_DISPONIBILIDAD')` y `@RequiereSucursal()`; `CartaDisponibilidadService` con `origen`; vigencia por día operativo con el reloj; no-op sin auditoría ni evento. Pruebas no protegidas con los ejemplos del criterio 44. (criterios 39 a 44, 53)
- [ ] T25 · backend · `cargador-carta.ts` con sus seis consultas fijas, `CartaVentaService.cartaDeSucursal` y `prepararLinea`, `GET /carta/sucursal` con `ETag` y 304, CORS con `If-None-Match` y `ETag`. Pruebas no protegidas: contenido de la vista (qué entra y qué no), efectos de un agotado en combos, modificadores y menú, `ETag` que cambia con cada tipo de cambio y con la hora de corte, conteo de consultas con 10 y 300 productos, errores de `prepararLinea`. Deja P1 (`linea-preparada.spec.ts`) en verde. (criterios 45, 47 a 52, 58)
- [ ] T26 · backend · `eventos-carta.ts`: `carta.disponibilidad` y `carta.actualizada` registrados con `alConfirmar` en todas las escrituras de C1 a C5 (uno por petición), sin publicar en reversiones ni en no-ops. Pruebas no protegidas con `PublicadorEnMemoria`. (criterios 46, 54)
- [ ] T27 · frontend · Segmento "Agotados" de Disponibilidad: lista por familia de la vista de la sucursal, filtro por estación recordado en el equipo, búsqueda, "Solo agotados", interruptor con hoja "Solo por hoy" o "Hasta que lo reactive", cambio optimista con "Deshacer", motivos de no vendible con palabras, aviso cerca de la hora de corte; consulta con `ETag` en `api.ts`, refresco cada 15 s en segundo plano y al volver a la pestaña. Pruebas de componente. (criterios 77, 78, 80)
- [ ] T28 · frontend · E2E con Playwright en viewport de celular: el Administrador crea una estación, una familia y un producto con foto, le pone otro precio en S1 y lo deja no disponible en S2; arma un combo y un menú del día; un Cocina/Barra de S1 arma el menú de hoy, marca un plato agotado "solo por hoy" y lo ve marcado, y el combo que lo contiene aparece no vendible; un Mozo no ve "Carta" ni "Disponibilidad".
- [ ] T29 · tester · Suite completa, lint, tipos, build y E2E; P1, P2 y P3 completas en verde.

## Fase D · Ataque adversarial (solo lo crítico), revisión, verificación y cierre

- [ ] T30 · adversarial · Ataque con `spec.md`, `plan.md` y el código, sin las notas de quien implementó, sobre las partes críticas. Áreas sugeridas:
  - **Montos:** entradas que esquiven la validación de texto (espacios, `+`, exponentes, `"1e2"`, `"0x10"`, números de JavaScript, `"-0"`, ceros a la izquierda, más de 2 decimales, más de 8 enteros), sumas que pierdan precisión, cantidades límite, una selección que el validador acepte y el cálculo no (o al revés), modificadores repetidos o de otro producto, un precio de sucursal ignorado o aplicado a otra sucursal, `prepararLinea` que use otro precio que la vista.
  - **Permisos:** rutas de `/carta` sin `@Permiso` o con la acción equivocada, cambios de precio por un Supervisor o un Cocina/Barra (también por `PATCH` de grupos, ajustes por sucursal o el menú del día), agotados en una sucursal sin acceso o con otro rol, sesiones de soporte sin rastro, auditoría que falte, que se pueda evitar con un no-op falso o que registre un antes o un después distinto del real.
  - **Aislamiento:** ids de B en rutas y cuerpos (familias, estaciones, grupos, modificadores, componentes, productos ligados, sucursales, opciones del menú), mensajes o tiempos que distingan un id de B de uno inexistente, claves de fotos manipulables, borrar o pisar una foto de otra empresa, eventos que salgan con otra empresa, `ETag` o 304 que filtren algo de otra empresa, concurrencia con el pool.
  Cada falla vuelve como prueba nueva (test-writer, con las reglas de la fase B) y a la fase C. (criterios 55 a 58, 60 a 62, 64 a 69)
- [ ] T31 · revisor · Comparar el cambio con `spec.md`, `plan.md` y `CLAUDE.md`: módulo dueño de sus tablas (sin consultas a tablas de otros módulos), montos solo con `packages/dominio` y `decimal.js` (en la API y en la PWA), toda tabla nueva con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`, efectos solo con `alConfirmar`, reloj de la API en todo cálculo del día operativo, y que ninguna tarea de la fase C tocó los archivos de la fase B (el orquestador lo verifica además con `git diff`).
- [ ] T32 · tester · Suite completa, lint, tipos, build y E2E; `pnpm db:migrar`, `pnpm db:revertir` de las cinco migraciones nuevas y otra vez `pnpm db:migrar`, sin errores y con el esquema idéntico; presupuesto de tamaño de la PWA.
- [ ] T33 · documentador · Commit de cierre y documentación del repositorio (README: variables de archivos, cómo ver las fotos en desarrollo, contratos para las secciones 3, 5 y 6). El orquestador lleva los "Cambios propuestos a los documentos compartidos" que el usuario apruebe.

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo (P1 a P4)
- [ ] Pruebas en verde tras la implementación (T12, T29)
- [ ] Ataque adversarial sin fallas abiertas (T30)
- [ ] El orquestador verifica con `git diff` que la fase C no tocó los archivos de la fase B
