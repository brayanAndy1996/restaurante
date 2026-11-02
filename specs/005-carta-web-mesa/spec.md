# 005 · Carta web y pedido desde la mesa con QR

- **Historias y requerimientos:**
  - **Entrega 5a (API, llamados en la PWA y QR):** HU-40, HU-41 y HU-42 completas; RF-84 a RF-88; la parte de API de RF-40 (configuración de la carta web por empresa y sucursal, sin dominio propio) y RF-41 (ocultar lo agotado y lo no disponible); HU-09 en lo que toca a la carta web ("desaparece de la carta web al instante", del lado de la API). RNF que aplican: RNF-02 (aviso en tiempo real), RNF-03, RNF-09 y RNF-20 (auditoría y trazabilidad), RNF-10 (reintentos sin duplicar), RNF-17 (montos con `packages/dominio`).
  - **Entrega 5b (carta web, `apps/web`):** RF-40 en la parte visible (logo, colores, fotos, horario y vista previa al compartir), RF-41 y HU-09 del lado de la pantalla, y la interfaz del cliente de HU-40 (RF-85, RF-86). RNF: "Interfaz táctil para tablets y celulares, y carta web liviana para datos móviles" (en `fuentes.md`), RNF-11 (navegadores).
  - **Se dejan para la sección de delivery** (alcance propuesto por el orquestador): HU-21 salvo la carta base, RF-42 a RF-49 (pedido para llevar y delivery por WhatsApp, consentimiento, bandeja, pedidos telefónicos). Esta sección deja listos la carta pública, `apps/web`, la resolución pública de la empresa y la protección por mesa e IP para reutilizarlos ("Notas para otras secciones").
  - Fuente de negocio: `fuentes.md` de esta carpeta (requerimientos rev. 38, diseño rev. 27) con las seis "Decisiones del usuario (2026-11-02)", que los criterios citan como "decisión N", y las decisiones de 002, 003 y 004 que siguen vigentes.
- **Ruta crítica:** sí, en parte. Propuesta del especificador, pendiente de confirmación del orquestador (paso 3): P1 aislamiento de las rutas públicas, P2 llamados (confirmación, vencimiento y protección contra pedidos falsos), P3 paso a la cuenta sin llegar a cocina y P4 permisos y trazabilidad, todos en 5a; 5b no es crítica. Ver "Clasificación de ruta crítica".
- **Estado:** borrador (2026-11-02), con nueve preguntas abiertas para el usuario.

## Objetivo

Que el cliente sentado en una mesa escanee el QR de su mesa, vea la carta de la sucursal con fotos y precios (solo lo que se puede pedir en ese momento) y mande su pedido, o un "Llamar al mozo" o "Pedir la cuenta", sin instalar nada. Que eso llegue al celular del mozo como un **llamado**, con aviso en vivo y sonido, y que el mozo lo revise con el cliente, lo ajuste y lo pase a la cuenta como ítems sin enviar. Desde ahí sigue el "Enviar" de siempre (004), así que el envío de comandas, los montos y la impresión no cambian, y un pedido falso nunca llega a cocina. Que el Administrador imprima los QR de las mesas, cambie el de una mesa (el anterior deja de funcionar) y publique la carta de cada sucursal con su logo y su color, con una vista previa al compartir el enlace. Todo sin que una empresa vea nada de otra y sin Redis.

## Entregas: 5a y 5b

La sección tiene 93 criterios: 77 en 5a (1 a 77) y 16 en 5b (78 a 93).

| Entrega | Qué entrega | Criterios | Por qué así |
| --- | --- | --- | --- |
| **5a · API, llamados en la PWA y QR** | Configuración de la carta web (nombre, dirección, logo, color, publicación por sucursal), códigos QR por mesa con su hoja imprimible y el cambio de QR, las rutas públicas de la carta y de la mesa con la resolución de la empresa bajo RLS, los llamados (crear, límites, estado para el cliente, atender, pasar a la cuenta, descartar y vencer), el aviso en vivo en la PWA y la lista "Llamados" del salón | 1 a 77 | Concentra toda la ruta crítica (P1 a P4) y se prueba entera por HTTP y con la PWA, sin la carta web: el E2E crea llamados con la API pública como lo haría el navegador del cliente. |
| **5b · Carta web (`apps/web`)** | La aplicación Next.js nueva: carta por sucursal (logo, color, fotos, horario), vista previa al compartir, el modo mesa del cliente (armar el pedido, "Llamar al mozo", "Pedir la cuenta", estado del llamado), agotados que desaparecen sin recargar, presupuesto de peso, accesibilidad, Docker y el E2E de punta a punta | 78 a 93 | Es otra aplicación, con otra cadena (Next.js) y un brief de diseño propio que el usuario debe aprobar. Consume solo los contratos de 5a, sin tocarlos. No es ruta crítica: lo crítico lo garantiza la API. |

Se ejecutan en ese orden: 5a completa (fases A a D y su commit de cierre) y después 5b (sus fases A, C y D y su commit de cierre).

## Límites con otras secciones

| Tema | Entra aquí | Queda para | Lo que esta sección deja listo |
| --- | --- | --- | --- |
| Pedido de delivery o para llevar por WhatsApp (RF-42 a RF-46, HU-21) | No | Sección de delivery | La carta pública (`/publico/cartas/…`), `apps/web` con sus URL y su caché, la resolución pública de la empresa (`empresa_de_carta`), la validación de líneas con `prepararLinea`, el límite por IP con `huella_ip` y el patrón de pendiente con vencimiento calculado al leer |
| Pedidos telefónicos y clientes (RF-47 a RF-49) | No | Sección de delivery | Nada específico |
| Dominio propio de la carta | No (fuera del MVP, diseño) | — | La carta vive en `CARTA_WEB_URL/<restaurante>/<sucursal>` |
| Envío de la comanda, montos de la cuenta e impresión | No cambian | 004 y sección 4 | El llamado termina en el borrador de la cuenta; el envío es el de 004 y vuelve a validar y a calcular el precio |
| Pre-cuenta al pedir la cuenta | Solo el aviso al mozo (pregunta 4) | 004 (botón "Pre-cuenta") | El llamado `PEDIR_CUENTA` lleva al mozo a la cuenta de la mesa |
| Stock (sección 6) | La carta pública oculta lo `vendible: false`, sea agotado manual o, cuando exista, `SIN_STOCK` | Sección 6 | Nada que cambiar: la sección 6 marca agotado con `origen: 'SIN_STOCK'` y la carta lo oculta igual |
| Notificaciones con la app cerrada (push) | No | Fuera de alcance (como en 004) | El aviso funciona con la PWA abierta |

## Clasificación de ruta crítica

**Propuesta del especificador; la confirma el orquestador en el paso 3.** `CLAUDE.md` pone en la ruta crítica el aislamiento entre empresas, los permisos con su trazabilidad de autor y auditoría, y "Pedidos web: confirmación, vencimiento y protección contra pedidos falsos"; el diseño dice que "el llamado es parte de la ruta crítica de pedidos web".

| Parte | Entrega | Crítica | Motivo |
| --- | --- | --- | --- |
| P1 · Aislamiento de las rutas públicas: resolución de la empresa por código o dirección con funciones `SECURITY DEFINER` acotadas, una sola fijación de contexto, lista cerrada de datos que salen, mismo 404 para todo lo que no se ve, RLS y referencias de las tablas nuevas, espejo `carta_publica`, eventos solo en su sala, CORS y concurrencia (criterios 11 a 17, 21, 57, 62 a 67) | 5a | sí | Las rutas sin sesión son la puerta nueva entre empresas: si la resolución o los datos que salen fallan, una empresa ve datos de otra. |
| P2 · Llamados: crear con validación de la carta y todo o nada, idempotencia por id, nada a cocina al crear, uno pendiente por mesa, límites por mesa y por IP, tamaños, horario, código cambiado o mesa inactiva, aviso, estado para el cliente, atender (dos a la vez, réplica, apertura de la mesa), descartar, vencer con el reloj de la API, reglas puras (criterios 6, 9, 10, 25 a 45, 53 a 56) | 5a | sí | Es "pedidos web: confirmación, vencimiento y protección contra pedidos falsos". |
| P3 · Paso a la cuenta: precios y disponibilidad recalculados en el servidor, todo o nada, la cuenta vigente de la mesa, ningún envío, ítem, comanda, trabajo de impresión ni llamada al inventario, réplica, y el envío de 004 que sí manda las líneas a cocina (criterios 46 a 52) | 5a | sí | Es la garantía de la decisión 6: "el pedido de la mesa nunca va directo a cocina". |
| P4 · Permisos y trazabilidad: clasificación de las rutas, rechazos por rol, lista cerrada de rutas públicas, quién atendió, pasó o descartó cada llamado (RF-88) y auditoría de la configuración y de los QR (criterios 58 a 61) | 5a | sí | Permisos con trazabilidad de autor y auditoría. |
| Configuración de la carta web (1 a 5), hoja de QR (7, 8), carta pública en lo que no es aislamiento (18 a 20, 22 a 24), interfaz de la PWA (68 a 77) | 5a | no | Mantenimiento simple y pantallas. Lo crítico de ellas (qué sale al público, el cambio de QR) está en P1 y P2. |
| Toda la carta web, `apps/web` (78 a 93) | 5b | no | "Apariencia de la carta web" está fuera de la lista. El E2E (92) recorre de todos modos el flujo crítico de punta a punta. |

## Glosario

- **Carta web:** la carta pública de una sucursal en `CARTA_WEB_URL/<dirección de la empresa>/<dirección de la sucursal>`, de solo lectura, con los productos que se pueden pedir en ese momento.
- **Dirección (slug):** el texto de la URL que elige el Administrador para su empresa ("sabor-norteno") y para cada sucursal ("miraflores").
- **Carta publicada:** una sucursal cuya carta web está activa (la marca el Administrador). Sin publicar, sus rutas públicas responden 404.
- **Código de la mesa:** el texto de 22 caracteres que va en el QR de una mesa. Lo genera la API, no se puede adivinar (128 bits al azar) y abre la carta en **modo mesa** (`CARTA_WEB_URL/m/<código>`).
- **Modo mesa:** la carta web abierta desde el QR de una mesa, donde el cliente arma un pedido o pide al mozo o la cuenta.
- **Llamado:** lo que manda el cliente desde el modo mesa. Tipos: `PEDIDO` (con líneas), `LLAMAR_MOZO` y `PEDIR_CUENTA` (sin líneas). Estados: `PENDIENTE`, `ATENDIDO`, `PASADO_A_CUENTA`, `DESCARTADO` y `VENCIDO`.
- **Atender:** el mozo toma el llamado ("voy yo"). Si la mesa está libre, la abre y queda como responsable (decisión 1).
- **Pasar a la cuenta:** el mozo, después de revisarlo con el cliente, convierte las líneas del llamado en líneas del **borrador** de la cuenta de la mesa (004, criterio 91: ítems "por enviar" que viven en su equipo). No envía nada a cocina.
- **Vencido:** un llamado `PENDIENTE` al que nadie atendió en 15 minutos (decisión 4), calculado con el reloj de la API.
- **Destinatarios del aviso:** el mozo responsable de la orden abierta de la mesa o, si la mesa está libre, todas las personas que atienden mesas en la sucursal (`null`; decisión 1).
- **Huella de la IP:** HMAC-SHA256 de la dirección IP del cliente con un secreto de la API. Sirve para el límite por conexión y nunca se guarda la IP.
- **Espejo `carta_publica`:** esquema interno, sin acceso para la API, con la relación dirección → empresa y código → empresa, que solo leen dos funciones de búsqueda exacta.

## Criterios de aceptación

Salvo que se diga otra cosa, rigen las mismas convenciones de 004: empresas **A** y **B** dadas de alta por la vía de plataforma, cada una con dos sucursales (S1 y S2 en A) y usuarios de cada rol; "el Mozo" es una sesión de un usuario de A con rol `MOZO` en S1 activa (igual los demás roles); horas con el reloj de la API, de Lima; errores `{ codigo, mensaje, campos? }` sin detalles de PostgreSQL; montos como texto con 2 decimales calculados con `packages/dominio`; ids UUID en minúsculas; entradas estrictas (un campo desconocido es 400 `DATOS_INVALIDOS`). Las rutas de llamados de la PWA llevan `@Permiso('ATENDER_MESA')` y `@RequiereModulo('SALON')`; las de configuración, `@Permiso('ADMINISTRAR')` sin módulo (como la carta y el mapa de mesas). Las rutas públicas (`/publico/*`) no llevan sesión: ignoran `Authorization` y la cabecera `x-empresa-id` del modo de prueba.

**Datos de ejemplo:** la carta de ejemplo de 004 ("Lomo saltado", "Combo hamburguesa", "Menú del día", "Gaseosa 1 L") en S1; zona "Salón principal" de S1 con las mesas "4" (capacidad 4) y "12" (capacidad 2); carta web de A con nombre "Sabor Norteño", dirección `sabor-norteno` y color `#B3261E`, y S1 publicada con la dirección `miraflores`; horario de S1 de lunes a domingo de 12:00 a 23:00; plan de S1 con `SALON`, `COCINA` y `PEDIDOS_WEB`. "El cliente" es un navegador sin sesión que usa el código de la mesa 4 de S1, con la IP de prueba que fija la cabecera de `CABECERA_IP_CLIENTE`.

---

## Entrega 5a · API, llamados en la PWA y QR

### Carta web: configuración (RF-40, no crítico)

1. **Consultar.** `GET /carta-web` (Admin) responde 200 `cartaWebRespuesta` `{ configurada, nombre, slug, colorPrincipal, logoUrl, url, sucursales: [{ sucursalId, nombre, slug, publicada, url }] }`: `url` es `CARTA_WEB_URL/<slug>` (y `…/<slug>/<slug de la sucursal>` en cada sucursal) o `null` si falta la dirección o `CARTA_WEB_URL`. Sin configurar: `configurada: false`, `nombre`, `slug`, `logoUrl` en `null` y `colorPrincipal` `#1D4A9E`; las sucursales salen todas, con `slug: null` y `publicada: false`.
2. **Nombre, dirección y color.** `PUT /carta-web` con `{ nombre, slug, colorPrincipal }` crea o reemplaza la configuración de la empresa y responde 200. `nombre`: de 1 a 80, es el nombre que ve el cliente (no la razón social). `slug`: de 3 a 40, `^[a-z0-9]+(-[a-z0-9]+)*$` y fuera de `SLUGS_RESERVADOS` de `packages/dominio` (`api`, `app`, `www`, `publico`, `carta`, `cartas`, `admin`, `ayuda`, `static`, `robots`, `sitemap`, `favicon`); si no, 400 con `campos`. Una dirección que ya usa otra empresa responde 409 `CONFLICTO` ("Esa dirección ya la usa otro restaurante. Elige otra") sin decir cuál. `colorPrincipal`: `^#[0-9A-Fa-f]{6}$`, se guarda en mayúsculas. Al cambiar la dirección, la anterior responde 404 desde la siguiente petición. Auditoría `configurar_carta_web` con el antes y el después; un `PUT` sin cambios responde 200 sin fila.
3. **Logo.** `PUT /carta-web/logo` (cuerpo binario) y `DELETE /carta-web/logo` (Admin) siguen las reglas de la foto de un producto de 003 (criterios 14 a 17): JPEG, PNG o WebP reales, hasta 1 MB (413), de 64 a 2048 píxeles por lado (422 `FOTO_INVALIDA`), clave `carta-web/<empresa>/<uuid>.<ext>` que arma la API, dos transacciones cortas alrededor de la subida y borrado del archivo anterior después de confirmar. Sin configuración de la carta web, 409 `CARTA_WEB_SIN_CONFIGURAR`. Auditoría `cambiar_logo_carta_web` o `quitar_logo_carta_web`.
4. **Sucursal.** `PUT /carta-web/sucursales/:sucursalId` con `{ slug, publicada }` (Admin) responde 200 con la fila de la sucursal de `cartaWebRespuesta`. `slug`: las mismas reglas de forma del criterio 2, único entre las sucursales de la empresa (409 `CONFLICTO`). Sin la configuración de la empresa, 409 `CARTA_WEB_SIN_CONFIGURAR`. Una sucursal de B o inexistente, 404. Despublicar hace que todas las rutas públicas de la sucursal (carta, mesas, llamados nuevos y estado) respondan 404 desde la siguiente petición; los llamados ya creados siguen para el mozo. Auditoría `configurar_carta_web_sucursal`.
5. **Quién.** Las rutas de los criterios 1 a 4 llevan `@Permiso('ADMINISTRAR')`: los demás roles reciben 403 `PROHIBIDO` sin cambios ni auditoría. No exigen sucursal activa.

### QR de las mesas (RF-84, HU-42; P2 en 6, 9 y 10)

6. **Código de una mesa** (P2). Al crear una mesa (004, criterio 3) se crea su código en la misma transacción. El código son 16 bytes de `crypto.randomBytes` en base64url sin relleno (22 caracteres, `^[A-Za-z0-9_-]{22}$`). Lo genera solo la API: ninguna entrada lo acepta. Es único en todo el sistema (la llave del espejo `carta_publica.codigo_mesa`; con 128 bits no hay choques en la práctica, y uno respondería 409 `CONFLICTO` sin guardar nada). La respuesta de `POST …/mesas` de 004 no cambia.
7. **Hoja de QR.** `GET /sucursales/:sucursalId/qr-mesas` (Admin) responde 200 `{ sucursal: { id, nombre }, cartaPublicada, mesas: [{ mesaId, zona: { id, nombre }, nombre, codigo, url, generadoEn }] }` con las mesas activas de las zonas activas, en el orden del mapa; `url` es `CARTA_WEB_URL/m/<código>`; `codigo`, `url` y `generadoEn` son `null` en una mesa sin código. Sin `CARTA_WEB_URL` responde 503 `CONFIGURACION_INCOMPLETA`. Una sucursal de B, 404.
8. **Las mesas que no tienen código.** `POST /sucursales/:sucursalId/qr-mesas` (Admin) crea el código de cada mesa activa de la sucursal que no lo tenga (las creadas antes de esta sección) y responde 200 con la forma del criterio 7. Repetirlo no cambia ningún código. Deja una fila `generar_qr_mesas` con la cantidad creada, solo si creó alguno.
9. **Cambiar el QR de una mesa** (HU-42; P2). `POST /sucursales/:sucursalId/mesas/:mesaId/qr` (Admin, `Idempotency-Key` obligatoria) responde 201 `{ mesaId, codigo, url, generadoEn }` con un código nuevo. Desde que se confirma, el código anterior responde 404 en todas las rutas públicas: la mesa, un llamado nuevo y el estado de un llamado hecho con él. Los llamados ya creados siguen para el mozo. La misma clave repetida devuelve la misma respuesta; otra clave genera otro código. Una mesa inactiva responde 409 `CONFLICTO`; una mesa de otra sucursal, de B o inexistente, 404. Deja una fila `cambiar_qr_mesa` con la mesa y su nombre, sin los códigos.
10. **Mesa inactiva** (P2). Mientras una mesa está inactiva (004, criterio 4), su código responde 404 en las rutas públicas; al reactivarla, el mismo código vuelve a funcionar.

### Rutas públicas: resolución de la empresa y aislamiento (ruta crítica P1)

11. **Lista cerrada.** Las seis rutas de `/publico/*` de la tabla de endpoints son las únicas rutas `@Publica()` nuevas; la lista cerrada de 002 (criterio 1) se amplía con exactamente ellas. Ignoran `Authorization` (un token de sesión válido no cambia lo que responden) y la cabecera `x-empresa-id` del modo de prueba: la empresa sale solo de la dirección o del código.
12. **Búsqueda sin enumerar.** `public.empresa_de_carta(text)` y `public.empresa_de_codigo_mesa(text)` son funciones `SECURITY DEFINER` de `restaurante_migrador`, con `search_path = pg_catalog, pg_temp`, `EXECUTE` solo para `restaurante_api` (ni `restaurante_plataforma`, ni `restaurante_tiempo_real`, ni `PUBLIC`), que devuelven la empresa (`uuid`) de una coincidencia exacta o `null`: la dirección, en minúsculas (la API la pasa a minúsculas antes); el código, distinguiendo mayúsculas. No son `LIKE` (`%` y `_` no son comodines). Leen `carta_publica.empresa_slug` y `carta_publica.codigo_mesa`, que mantienen triggers `SECURITY DEFINER` sobre `carta_web` y `mesa_qr`; el esquema `carta_publica` no tiene `USAGE` para ningún rol de la aplicación, así que nadie puede listar direcciones ni códigos.
13. **Una sola fijación por petición.** La API llama a esas funciones fuera de toda transacción y de todo contexto, con su consulta fija (`consultas-sin-empresa.ts`, motivos nuevos `carta-publica` y `codigo-mesa`, un parámetro de texto), y después corre toda la petición en una sola `ContextoEmpresa.ejecutar(empresaId, …, { actor: { sistema: 'carta-web' } })`, con un solo `fijar_contexto_empresa`: lo demás se lee y se escribe bajo la RLS. Una consulta marcada con esos motivos y otro texto falla como sin contexto; dentro de un contexto, la guarda de la API rechaza cualquier mención de las dos funciones (`NOMBRES_PROHIBIDOS`).
14. **El mismo 404 para todo lo que no se ve.** Responden 404 `NO_ENCONTRADO` con el mismo cuerpo (`{ codigo: 'NO_ENCONTRADO', mensaje: 'La carta no está disponible' }`): un código desconocido, de una mesa inactiva o reemplazado; una dirección de empresa o de sucursal inexistente; una sucursal sin publicar o cuyo plan no incluye `PEDIDOS_WEB` (pregunta 8); un llamado de otra mesa. Un código con otra forma responde lo mismo sin consultar la base. Una suscripción suspendida no cambia nada ("la suspensión solo impide abrir caja", 002).
15. **Nada de otra empresa.** Con el código de una mesa de A, cada ruta pública lee y escribe solo filas de A y de la sucursal de esa mesa. Un `productoId` o un modificador de B, o de A que no se vende en esa sucursal, en un llamado responde 422 con el mismo cuerpo que uno inexistente. El `id` de un llamado de B usado con el código de A responde 404 en el estado y, en un `POST`, crea su propio llamado en A sin tocar ni revelar el de B (la llave es `(empresa_id, id)`).
16. **CORS.** Las rutas `/publico/*` aceptan además el origen de `CARTA_WEB_URL` (`GET`, `POST` y `OPTIONS`; cabeceras `Content-Type` e `If-None-Match`; expone `ETag` y `Retry-After`), sin credenciales. Las demás rutas siguen aceptando solo `ORIGENES_PERMITIDOS`: el origen de la carta web no recibe permiso de CORS en `/sesion`, `/llamados` ni ninguna otra.
17. **Tamaño.** Un `POST` público con más de 16 KB de cuerpo responde 413 `CUERPO_DEMASIADO_GRANDE` sin consultar la base.

### Carta pública (RF-40, RF-41; P1 en 21)

18. **La empresa.** `GET /publico/cartas/:empresaSlug` responde 200 `{ empresa: { nombre, logoUrl, colorPrincipal }, sucursales: [{ nombre, slug, direccion }] }` con las sucursales publicadas que tienen `PEDIDOS_WEB`, por nombre. Sin ninguna, 404 (criterio 14).
19. **La carta de la sucursal.** `GET /publico/cartas/:empresaSlug/:sucursalSlug` responde 200 `cartaPublica` `{ empresa: { nombre, logoUrl, colorPrincipal }, sucursal: { nombre, slug, direccion, horario: [{ dia, desde, hasta }], abiertaAhora }, familias: [{ id, nombre, productos: [productoPublico] }] }`, con `productoPublico` `{ id, tipo, nombre, descripcion, fotoUrl, precio, grupos: [{ id, nombre, seleccion, minimo, maximo, obligatorio, modificadores: [{ id, nombre, precioExtra }] }], componentes: [{ nombre, cantidad }] }`. Se arma con `CartaVentaService.cartaDeSucursal(sucursalId, reloj.ahora())` de 003 (precio efectivo en la sucursal, menú del día y agotados del día operativo). `abiertaAhora` es `dentroDeHorario(horario, ahora)` de `packages/dominio`, o `null` si la sucursal no tiene horario.
20. **Solo lo que se puede pedir** (RF-41). Se omiten los productos con `vendible: false` (agotado, no disponible en la sucursal, inactivo, con un componente no disponible, menú sin armar u opciones insuficientes), los que no se venden solos y los que no tienen precio; los modificadores con `disponible: false`; y las familias que se quedan sin productos. Ejemplo: Cocina marca agotada la "Hamburguesa clásica" y la siguiente respuesta ya no trae "Combo hamburguesa"; marca agotada la "Cerveza Pilsen" y el combo sigue, sin esa opción; al reactivarlas, vuelven.
21. **Lo que nunca sale** (P1). La respuesta tiene exactamente las claves del esquema (la prueba las compara con un esquema estricto): no trae `empresaId`, `sucursalId`, ids de mesas, de órdenes ni de usuarios, `estacionId`, `tipoControlStock`, `afectacionIgv`, `aplicaIcbper`, `agotado`, `vendible`, `motivo`, los `productoId` de modificadores y componentes, `diaOperativo`, la hora de corte, el código de establecimiento, el RUC, el emisor, el WhatsApp, costos ni cantidades de stock; ninguna fila de B ni de otra sucursal de A. La misma regla vale para las respuestas de los criterios 18, 23, 25, 26 y 38.
22. **Caché.** La respuesta lleva un `ETag` fuerte de su contenido y responde 304 con `If-None-Match` igual. Lleva `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=60`. Se arma con un número fijo de consultas, el mismo con 5 que con 150 productos (la prueba las cuenta).
23. **Disponibilidad.** `GET /publico/cartas/:empresaSlug/:sucursalSlug/disponibilidad` responde 200 `{ vendibles: [{ id, modificadoresNoDisponibles: [id] }] }`: los productos que el criterio 19 mostraría en ese instante y, de cada uno, los modificadores de sus grupos que no están disponibles. Lleva `ETag` y responde 304, con `Cache-Control: public, max-age=5, s-maxage=5`. Coincide con el criterio 19 calculado en el mismo instante.
24. **Agotado al instante** (HU-09). Un agotado o una reactivación confirmados se reflejan en la siguiente petición a los criterios 19 y 23: la API no guarda la carta pública en memoria. La carta web consulta la disponibilidad cada 15 segundos (criterio 82) y, aunque un cliente tenga la página abierta desde antes, un llamado con algo agotado se rechaza (criterio 27).

### La mesa (HU-40; P2)

25. **La mesa.** `GET /publico/mesas/:codigo` responde 200 `{ mesa: { nombre }, carta: { empresaSlug, sucursalSlug }, aceptaLlamados, motivoNoAcepta, llamadoPendiente }`: `aceptaLlamados` sale del criterio 35 (`motivoNoAcepta` es `'FUERA_DE_HORARIO'` o `null`), y `llamadoPendiente` es `{ tipo, venceEn }` del llamado pendiente vigente de la mesa o `null`. No dice si la mesa está ocupada, ni el mozo, la cuenta o lo consumido (pregunta 2). Lleva `Cache-Control: no-store`, `X-Robots-Tag: noindex` y `Referrer-Policy: no-referrer`.

### Enviar un llamado (RF-85, RF-86, RF-88; ruta crítica P2)

26. **Crear.** `POST /publico/mesas/:codigo/llamados` con `llamadoEntrada`, que según `tipo` es `{ id, tipo: 'PEDIDO', lineas: [{ productoId, modificadorIds, cantidad, observacion? }], nota? }`, `{ id, tipo: 'LLAMAR_MOZO' }` o `{ id, tipo: 'PEDIR_CUENTA' }`, responde 201 `llamadoPublico` `{ id, tipo, estado: 'PENDIENTE', creadoEn, venceEn, lineas: [{ nombre, modificadores: [nombre], cantidad, observacion, precioUnitario, total }], total }` (sin líneas y con `total: null` en los dos tipos sin pedido). `id`: UUID que genera el navegador. Límites (pregunta 6): de 1 a 30 líneas; `modificadorIds` hasta 30, sin repetir; `cantidad` entera de 1 a 20; `observacion` y `nota` de 1 a 140. `creadoEn` es la hora del reloj de la API y `venceEn` = `creadoEn` + 15 minutos (decisión 4). No pide nombre, teléfono ni pago (RF-85).
27. **Se valida con la carta, todo o nada.** Cada línea se arma con `CartaVentaService.prepararLinea({ sucursalId: la de la mesa, productoId, modificadorIds, cantidad, instante: ahora })` (o el lote equivalente, `prepararLineas`). Si alguna se rechaza, nada se guarda y la respuesta es 422 `PRODUCTO_NO_VENDIBLE` o `SELECCION_INVALIDA` con una entrada de `campos` por línea rechazada (`lineas.<i>`) y el código de la primera, como el envío de 004 (criterio 17). Si el `total` de una línea o del llamado pasa de `99999999.99`, 422 `MONTO_FUERA_DE_RANGO`. El llamado guarda cada línea preparada (nombre, modificadores, precios) tal como la vio el cliente; el `total` es `totalOrden` de sus líneas. Los precios se muestran, pero la cuenta usa los del sistema al pasarla y al enviarla (decisión 3).
28. **Crear no llega a cocina** (decisión 6). Crear un llamado no crea orden, envío, ítem, comanda ni trabajo de impresión, no llama al puerto de inventario, no publica `cocina.*`, `salon.cambio` ni `orden.cambio` y no cambia el estado de la mesa.
29. **Réplica por id** (RNF-10). Repetir el `POST` con el mismo `id`, la misma mesa y la misma entrada normalizada (ids en minúsculas, modificadores ordenados, textos sin espacios al borde) responde 201 con el cuerpo de la primera respuesta, aunque el llamado ya esté atendido, vencido o el producto se haya agotado, sin evento y sin contar para los límites. El mismo `id` con otra entrada o con otra mesa responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Diez peticiones simultáneas con el mismo `id` dejan exactamente un llamado y responden todas 201 con el mismo cuerpo (o alguna 409 `CONFLICTO` que, repetida, responde 201).
30. **Uno pendiente por mesa** (decisión 2). Si la mesa ya tiene un llamado `PENDIENTE` vigente, de cualquier tipo, otro con otro `id` responde 409 `LLAMADO_PENDIENTE` ("Ya avisamos al mozo. Cuando atienda tu mesa podrás enviar otro") y nada se guarda. Un llamado `ATENDIDO`, `PASADO_A_CUENTA`, `DESCARTADO` o `VENCIDO` no bloquea (HU-40: "puedo mandar otro pedido cuando atiendan el anterior"). Dos llamados simultáneos de la misma mesa con ids distintos: exactamente uno responde 201. La base lo asegura con un índice único parcial.
31. **Un vencido no bloquea.** Un llamado `PENDIENTE` cuyo `venceEn` ya pasó (reloj de la API) se guarda como `VENCIDO` en la misma transacción del llamado nuevo, que se acepta.
32. **Límite por mesa** (RF-88; pregunta 6). Si la mesa ya tiene 6 llamados creados en los últimos 30 minutos (cualquier tipo y estado; no cuentan las réplicas ni los rechazados), el siguiente responde 429 `DEMASIADOS_LLAMADOS` con `reintentarEnSegundos` (lo que falta para que el más antiguo de la ventana salga de ella) y la cabecera `Retry-After`, sin guardar nada.
33. **Límite por conexión** (pregunta 6). Si la misma IP de cliente ya creó 20 llamados en la misma sucursal en los últimos 10 minutos, el siguiente responde 429 `DEMASIADOS_LLAMADOS` igual. La IP sale de la cabecera `CABECERA_IP_CLIENTE` cuando la variable está definida (en producción, `cf-connecting-ip`) o de la conexión. El llamado guarda `huella_ip` (HMAC-SHA256 de la IP con un secreto derivado de `PIN_PEPPER`), nunca la IP. Diez llamados simultáneos desde la misma IP a mesas distintas no pasan del límite.
34. **Orden de los rechazos:** 413 y 400 de forma; 404 del código (criterio 14); réplica por `id` (criterio 29); 409 `FUERA_DE_HORARIO` (criterio 35); 409 `LLAMADO_PENDIENTE`; 429 por mesa y por conexión; 422 de las líneas. Lo barato va antes que validar la carta.
35. **Horario** (pregunta 5). La mesa acepta llamados si la hora del reloj de la API cae dentro del horario de la sucursal (`dentroDeHorario`), si la mesa tiene una cuenta abierta (los clientes que siguen después de la hora de cierre) o si la sucursal no tiene horario cargado. Si no, 409 `FUERA_DE_HORARIO` ("El local está cerrado. Habla con el personal"), sin guardar nada.
36. **Aviso al mozo** (RF-87). Después de confirmar, se publica `llamado.nuevo` `{ llamadoId, tipo, mesaId, mesaNombre, destinatarios }` en la sala de la sucursal de la mesa: `destinatarios` es `[mozo responsable]` si la mesa tiene una orden abierta (004, criterio 10) o `null` si está libre (decisión 1). Una réplica o un rechazo no publican nada. Un equipo de S1 conectado lo recibe en menos de 1 segundo en la prueba; uno de S2 o de B, nunca.
37. **Lo que queda guardado.** El llamado queda con su mesa, su sucursal, `huella_ip`, los destinatarios y la orden abierta de la mesa al crearlo (o ninguna), creado por el actor de sistema `carta-web` (trazabilidad de 002).

### Estado del llamado para el cliente (HU-40; P2)

38. **Ver el estado.** `GET /publico/mesas/:codigo/llamados/:id` responde 200 `{ id, tipo, estado, venceEn }` con el estado vigente (`VENCIDO` si está `PENDIENTE` y ya pasó `venceEn`), sin nombres de personas (pregunta 3). Un llamado de otra mesa (aunque sea de la misma sucursal), de B o inexistente, o un código reemplazado, responde 404 (criterio 14). Lleva `Cache-Control: no-store`.

### Llamados en la PWA (RF-87; P2)

39. **La lista.** `GET /llamados` (Salón) responde 200 `{ ahora, llamados: [llamadoResumen] }` de la sucursal activa: los `PENDIENTE` vigentes, los `PEDIDO` `ATENDIDO` sin cerrar del día operativo y los recientes (pasados, descartados o vencidos en los últimos 60 minutos, hasta 30), los pendientes primero y por antigüedad. `llamadoResumen` es `{ id, tipo, estado, mesa: { id, nombre }, creadoEn, venceEn, unidades, total, nota, destinatarios, atendidoPor, atendidoEn, cerradoPor, cerradoEn, ordenId }` (`atendidoPor` y `cerradoPor` como `{ id, nombre } | null`). Lleva `ETag` y responde 304; se arma con un número fijo de consultas.
40. **El detalle con la revisión.** `GET /llamados/:id` (Salón) responde 200 `llamadoDetalle`: lo de `llamadoResumen` más `lineas: [{ posicion, productoId, nombre, modificadores: [{ id, nombre, precioExtra }], cantidad, observacion, precioCliente, revision }]`, `totalCliente`, `totalActual`, `motivoDescarte` y `lineasPasadas`. `revision` se calcula con el reloj de la API y `prepararLinea`: `{ disponible: true, precioUnitario, total }` o `{ disponible: false, codigo, motivo }` (por ejemplo `COMPONENTE_NO_DISPONIBLE`); `totalActual` suma las disponibles con `totalOrden`. Un llamado de otra sucursal o de B, 404.

### Atender (HU-41; P2)

41. **Atender.** `POST /llamados/:id/atencion` (Salón, `Idempotency-Key` obligatoria) con `{ ordenId?, comensales? }` pasa un llamado `PENDIENTE` vigente a `ATENDIDO`, con `atendidoPor` = quien lo pide y `atendidoEn` = ahora, y responde 200 `{ llamado: llamadoDetalle, ordenId, mesaAbierta }`. Desde ese momento no vence y la mesa puede mandar otro llamado (decisión 2).
42. **Mesa libre** (decisión 1; HU-41). Si la mesa está libre y el llamado es `PEDIDO` o `LLAMAR_MOZO`, atender la abre en la misma transacción con las reglas de 004 (criterios 9 a 12): `ordenId` (UUID que genera la PWA) es el id de la orden y `comensales` (1 a 99) sus comensales, y quien atiende queda como mozo responsable; la respuesta trae `mesaAbierta: true` y se publican `salon.cambio` y `orden.cambio`. Sin `comensales` (o sin `ordenId`), 409 `MESA_LIBRE` sin cambiar nada, para que la PWA pida los comensales. Un `PEDIR_CUENTA` no abre la mesa. Con la mesa ocupada se usa su orden abierta y se ignoran `ordenId` y `comensales`; si otra persona la abre mientras tanto (`MESA_OCUPADA`), también se usa esa orden. Una sesión de soporte (sin usuario) con la mesa libre recibe 422 `REFERENCIA_INVALIDA` (004, criterio 10). Una mesa inactiva responde 409 `CONFLICTO` sin atender.
43. **Dos a la vez.** Dos atenciones simultáneas del mismo llamado por personas distintas: exactamente una responde 200; la otra, 409 `LLAMADO_TOMADO` con `atendidoPor: { id, nombre }`, sin abrir otra orden. La misma persona otra vez (con otra clave, después de un corte) recibe 200 con el estado actual y sin efectos; la misma clave, la respuesta guardada.
44. **Lo que no se atiende.** Un llamado vencido responde 409 `LLAMADO_VENCIDO` y queda guardado como `VENCIDO`; uno `PASADO_A_CUENTA` o `DESCARTADO`, 409 `LLAMADO_CERRADO` con su `estado`. Un llamado de otra sucursal de A o de B, 404.
45. **Evento.** Después de confirmar, atender publica `llamado.cambio` `{ llamadoId, mesaId, estado }` en la sala de la sucursal, para que los demás equipos lo marquen como tomado. Una réplica o un rechazo no publican nada.

### Pasar a la cuenta (HU-41, RF-87; ruta crítica P3)

46. **Pasar.** `POST /llamados/:id/paso-a-cuenta` (Salón, `Idempotency-Key` obligatoria) con `{ lineas: [{ posicion, cantidad }] }` responde 200 `{ llamado: llamadoDetalle, ordenId, lineas: [lineaParaBorrador] }`, con `lineaParaBorrador` `{ posicion, productoId, nombre, modificadores: [{ id, nombre, precioExtra }], cantidad, observacion, precioUnitario, total }`. `lineas`: de 1 a 30; `posicion`, una línea del llamado, sin repetir (las que faltan son las que el mozo quitó); `cantidad`, de 1 a 999 (el mozo puede cambiarla, HU-41). El producto, los modificadores y la observación salen del llamado: la entrada no los acepta. Solo un `PEDIDO` `ATENDIDO`: un `PENDIENTE`, o un `LLAMAR_MOZO` o `PEDIR_CUENTA`, responde 409 `TRANSICION_INVALIDA`; uno cerrado, 409 `LLAMADO_CERRADO`; una `posicion` fuera de rango o repetida, 422 `DATOS_INVALIDOS` con `campos`. Cualquier persona con `ATENDER_MESA` en la sucursal puede pasarlo (por ejemplo, si quien lo atendió se quedó sin batería).
47. **Precios y disponibilidad del sistema** (decisión 3). Cada línea se prepara de nuevo con `prepararLinea` (sucursal de la mesa, producto y modificadores del llamado, cantidad de la entrada, instante ahora): `precioUnitario` y `total` son los del sistema aunque difieran de los que vio el cliente. Si alguna se rechaza, nada cambia, el llamado sigue `ATENDIDO` y la respuesta es 422 con `campos` por línea (`lineas.<i>`, con la posición y el motivo), como el envío de 004. Ejemplo: el cliente pide "Combo hamburguesa (Cerveza, Ensalada) × 2" y Cocina agota la "Cerveza Pilsen" antes de que el mozo lo pase: el detalle (criterio 40) ya la muestra no disponible y el paso con esa línea responde 422 `SELECCION_INVALIDA`; sin ella, 200.
48. **La cuenta de la mesa.** Las líneas van a la orden abierta vigente de la mesa (la principal si la mesa se unió a otra, 004); `ordenId` es esa orden. Sin orden abierta (por ejemplo, la anularon después de atender), 409 `MESA_SIN_CUENTA` y nada cambia: la PWA ofrece abrir la mesa y volver a pasarlo. Al pasar, el llamado queda `PASADO_A_CUENTA` con `ordenId`, `lineasPasadas` (posición y cantidad), `cerradoPor` y `cerradoEn`.
49. **Nada llega a cocina** (decisión 6; P3). Pasar a la cuenta no crea envío, ítem, comanda, línea de comanda ni trabajo de impresión; no llama al puerto de inventario; no cambia `orden.version`, el estado de la orden ni su pre-cuenta (una mesa `EN_PRECUENTA` sigue en amarillo); y no publica `cocina.*`, `salon.cambio` ni `orden.cambio`. El módulo de llamados no usa el servicio de envíos de pedidos. Las líneas llegan a cocina solo cuando alguien pulsa "Enviar" en el borrador (`POST /ordenes/:id/envios` de 004), que vuelve a validarlas y a calcular su precio.
50. **De punta a punta** (P3). Con las `lineas` de la respuesta convertidas a `envioEntrada` (como `aLineaDeEnvio` de la PWA), `POST /ordenes/:ordenId/envios` responde 201 con las comandas por estación de 004 (criterio 22) y los ítems con los precios del sistema al enviar. Si entre el paso y el envío se agota algo, el envío lo rechaza (004, criterio 19).
51. **Réplica.** La misma clave devuelve la respuesta guardada. Otra clave sobre un llamado ya `PASADO_A_CUENTA` con las mismas líneas (también desde otra sesión) responde 200 con la respuesta del paso original (instantánea), sin cambios ni evento; con otras líneas, 409 `LLAMADO_CERRADO`. Dos pasos simultáneos del mismo llamado terminan en un solo paso.
52. **Evento.** Después de confirmar, `llamado.cambio` con `estado: 'PASADO_A_CUENTA'`.

### Descartar y vencer (RF-88; ruta crítica P2)

53. **Descartar.** `POST /llamados/:id/descarte` (Salón, `Idempotency-Key` obligatoria) con `{ motivo? }` (de 1 a 140) deja el llamado `DESCARTADO` con `cerradoPor`, `cerradoEn` y el motivo, y responde 200 `llamadoDetalle`. Se descarta un `PENDIENTE` vigente de cualquier tipo o un `PEDIDO` `ATENDIDO`. Repetirlo responde 200 sin cambios; sobre uno pasado, 409 `LLAMADO_CERRADO`; sobre uno vencido, 409 `LLAMADO_VENCIDO`. Publica `llamado.cambio`. Si la atención abrió la mesa y no hay nada enviado, la mesa sigue abierta: la PWA ofrece "Liberar la mesa" (004, criterio 44).
54. **Vencer** (decisión 4; HU-41). Un llamado `PENDIENTE` que nadie atendió en 15 minutos está `VENCIDO`: se calcula al leer con el reloj de la API (`estadoVigenteLlamado`), sin tareas programadas. A los 14:59 sigue pendiente; en el instante exacto de los 15:00 ya venció. Se guarda como `VENCIDO` cuando alguien lo toca (un llamado nuevo de la mesa, atender o descartar). Las listas, el detalle y el estado para el cliente lo muestran `VENCIDO`. Un llamado `ATENDIDO` no vence.
55. **Llamados sin pedido.** En un `LLAMAR_MOZO` o `PEDIR_CUENTA`, `ATENDIDO` es un estado final: descartarlo después responde 409 `LLAMADO_CERRADO` y pasarlo a la cuenta, 409 `TRANSICION_INVALIDA`. "Pedir la cuenta" solo avisa: no emite ni imprime la pre-cuenta (pregunta 4).

### Reglas puras (`packages/dominio`, ruta crítica P2)

56. **`src/llamados/`**, con pruebas unitarias de cada ejemplo:
    - `venceEnLlamado(creadoEn)` = `creadoEn` + `MINUTOS_VENCIMIENTO_LLAMADO` (15).
    - `estadoVigenteLlamado({ estado, venceEn }, ahora)`: `VENCIDO` si `estado` es `PENDIENTE` y `ahora >= venceEn`; si no, `estado`. Ejemplo: creado 20:00:00, a las 20:14:59.999 `PENDIENTE` y a las 20:15:00 `VENCIDO`; uno `ATENDIDO` sigue `ATENDIDO` a las 23:00.
    - `siguienteEstadoLlamado(tipo, estado, accion)` con `accion` `ATENDER`, `PASAR_A_CUENTA` o `DESCARTAR` devuelve el estado nuevo o `null` según la tabla: `PENDIENTE` + `ATENDER` → `ATENDIDO`; `PENDIENTE` + `DESCARTAR` → `DESCARTADO`; `ATENDIDO` + `PASAR_A_CUENTA` → `PASADO_A_CUENTA` solo en `PEDIDO`; `ATENDIDO` + `DESCARTAR` → `DESCARTADO` solo en `PEDIDO`; todo lo demás `null` (también desde `VENCIDO`, `PASADO_A_CUENTA` y `DESCARTADO`).
    - `decidirLimite(instantes, ahora, { maximo, ventanaMinutos })`: `{ permitido: true }` si hay menos de `maximo` instantes en `(ahora − ventana, ahora]`; si no, `{ permitido: false, reintentarEnSegundos }` con los segundos (redondeados hacia arriba, mínimo 1) hasta que el más antiguo de la ventana salga. Ejemplo con 6 en 30 minutos: seis llamados a las 20:00, 20:05, …, 20:25 y otro a las 20:29 → no permitido, reintentar en 60 s; a las 20:30:00 → permitido.
    - `aceptaLlamados({ horario, ahora, mesaConCuenta })`: `true` si `mesaConCuenta`, si `horario` está vacío o si `dentroDeHorario(horario, ahora)` (pregunta 5).
    - `destinatariosDeLlamado(mozoResponsableId | null)`: `[id]` o `null`.
    - Constantes: `TIPOS_LLAMADO`, `ESTADOS_LLAMADO`, `MAXIMO_LINEAS_LLAMADO = 30`, `CANTIDAD_MAXIMA_LLAMADO = 20`, `LARGO_NOTA_LLAMADO = 140`, `LIMITE_LLAMADOS_MESA = { maximo: 6, ventanaMinutos: 30 }`, `LIMITE_LLAMADOS_IP = { maximo: 20, ventanaMinutos: 10 }`, `SLUGS_RESERVADOS`.

### Tiempo real (ruta crítica P1)

57. **Eventos nuevos por el transporte de 004.** `llamado.nuevo` y `llamado.cambio` se publican con `PublicadorEventos` y `ContextoEmpresa.alConfirmar` en la sala `s:<empresa>:<sucursal>` de la mesa; nunca en otra sucursal ni empresa, también con dos instancias de la API (004, criterios 67 y 68). Llevan solo ids, tipo, estado, el nombre de la mesa y los destinatarios, y pesan menos de 4 KB. La carta web no se conecta a Socket.IO: no hay salas públicas.

### Permisos, auditoría y trazabilidad (ruta crítica P4)

58. **Clasificación de las rutas.** `/llamados…` lleva `ATENDER_MESA` y el módulo `SALON`; `/carta-web…`, `/sucursales/:sucursalId/qr-mesas` y `/sucursales/:sucursalId/mesas/:mesaId/qr`, `ADMINISTRAR`; `/publico/*`, `@Publica()`. La prueba recorre las rutas registradas en Nest y falla si una no está clasificada o tiene otra acción. La matriz de permisos de `packages/dominio` no cambia.
59. **Rechazos por rol.** Cocina/Barra recibe 403 `PROHIBIDO` en `/llamados…`; todos salvo el Administrador, en las rutas de configuración; con sesión de contraseña y de PIN, sin cambiar filas, sin auditoría y sin eventos. El rol es el de la sucursal activa (un usuario Mozo en S1 y Cocina/Barra en S2, con S2 activa, recibe 403 al atender). Sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`; sin `SALON` en el plan, 403 `MODULO_NO_INCLUIDO`.
60. **Quién atendió, pasó o descartó** (RF-88). `llamado.atendido_por_usuario_id` y `atendido_por_equipo_id`, y `cerrado_por_usuario_id` y `cerrado_por_equipo_id`, guardan quién lo atendió y quién lo pasó o descartó, con su equipo, en la misma transacción, con llaves compuestas hacia `usuario` y `equipo`; `llamadoDetalle` los muestra. La creación queda trazada con el actor `carta-web`; cada cambio, con la persona (trazabilidad de 002). Una sesión de soporte queda trazada con el superadministrador.
61. **Auditoría.** `configurar_carta_web`, `configurar_carta_web_sucursal`, `cambiar_logo_carta_web`, `quitar_logo_carta_web`, `generar_qr_mesas` y `cambiar_qr_mesa` dejan exactamente una fila cada una, en la misma transacción, con el actor, la sucursal cuando aplica y el antes y el después; ninguna en las operaciones sin cambios ni en las réplicas. Los llamados no dejan filas de auditoría: su registro es el del criterio 60.

### Aislamiento entre empresas (ruta crítica P1)

62. **Catálogo.** `carta_web`, `carta_web_sucursal`, `mesa_qr` y `llamado` se crean con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`; las pruebas de catálogo de 001 y 002 las recorren solas. El esquema `carta_publica` (fuera de `public`) no tiene `USAGE` para `restaurante_api`, `restaurante_plataforma` ni `restaurante_tiempo_real`.
63. **Por tabla.** En las cuatro tablas, con el contexto de A y un actor de A: no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, ni se insertan filas con `empresa_id` de B; el rechazo es de la política RLS.
64. **Referencias cruzadas.** Con el contexto de A, falla por la llave foránea compuesta, igual que con un id inexistente: un llamado con mesa, sucursal, orden o usuario de B; un `mesa_qr` con mesa de B; una `carta_web_sucursal` con sucursal de B.
65. **El espejo.** Insertar, cambiar o borrar en `carta_web` o `mesa_qr` de A cambia solo la fila del espejo de A. Con el rol de la API, leer o escribir `carta_publica.*` falla con `42501`. Una dirección que ya usa B, puesta por A, falla (409 en HTTP) sin cambiar la de B ni revelarla. El trigger toma la empresa de la fila nueva, que la RLS ya obligó a ser la del contexto.
66. **Por HTTP.** En toda ruta autenticada de esta sección, un id de B en la ruta responde 404 y en el cuerpo 422, con el mismo cuerpo que uno inexistente y sin cambios en B. Los ids de cliente (`llamado.id`, el `ordenId` de la atención) son únicos por empresa: el mismo UUID usado en B crea su propia fila.
67. **Concurrencia.** Con un pool de 2 conexiones, 100 peticiones simultáneas que alternan A y B entre `GET /publico/cartas/…`, `POST /publico/mesas/:codigo/llamados`, `GET /publico/mesas/:codigo/llamados/:id` y `GET /llamados` devuelven y cambian solo datos de su empresa, y cada evento llega solo a su sala.

### Interfaz (PWA, no crítica)

Las pantallas siguen `DESIGN.md` (Azulejo, "Operate", móvil primero, trato de tú) y `PRODUCT.md`; el rol frontend usa la skill `impeccable`. Lo nuevo se carga bajo demanda (presupuesto de 170 kB gzip de 003).

68. **Llamados en el salón.** La navegación no cambia (sigue en 5 destinos como máximo). `/salon` gana los segmentos "Mesas" y "Llamados (2)". En el mapa, la baldosa de una mesa con un llamado vigente lleva una etiqueta con icono y texto ("Pedido", "Llama al mozo", "Pide la cuenta").
69. **Aviso en vivo** (RF-87). Al recibir `llamado.nuevo`, la PWA de cada persona con `ATENDER_MESA` en la sucursal muestra, en cualquier pantalla, un banner "Mesa 4 · Pedido (3 platos)" con "Ver", suena un aviso corto y vibra donde el navegador lo permite, si la persona está en `destinatarios` o si es `null`. Las demás lo ven en la lista, sin sonido. El sonido se puede silenciar en el equipo y empieza después del primer toque en la app (los navegadores bloquean el audio sin un gesto). Solo con la app abierta (pregunta 9).
70. **Lista.** "Llamados" muestra filas de 72 px con la mesa, el tipo, hace cuánto llegó y cuánto falta para que venza ("vence en 12 min"), "Para ti" si la persona es destinataria, quién lo atiende y el botón "Atender"; abajo, "Recientes". Se refresca con `llamado.nuevo` y `llamado.cambio`, y sin socket cada 30 segundos con `ETag` (004, criterio 97). Un llamado vencido sale de pendientes cuando llega su hora, con `ahora` del servidor.
71. **Atender y revisar.** "Atender" con la mesa libre abre una hoja con los comensales (por defecto, la capacidad de la mesa) y "Atender y abrir la mesa"; con `LLAMADO_TOMADO` dice "Ana ya está atendiendo este llamado". El detalle (`/salon/llamados/:id`) muestra cada línea con − y + de 48 px, "Quitar", el precio del sistema y, si cambió, "El cliente vio S/ 28.00"; lo no disponible va en rocoto con el motivo en palabras y no se puede pasar hasta quitarlo. Acción principal: "Pasar a la cuenta"; separada por una junta, "Descartar" en rocoto, con atajos de motivo ("Pedido falso", "Ya lo pidió al mozo", "Repetido").
72. **Al pasar.** Las líneas de la respuesta van al borrador de esa cuenta en el equipo (004, criterio 91), marcadas con el id del llamado para no agregarlas dos veces (una réplica no las duplica), y la PWA lleva a la cuenta con el aviso "Revisa el pedido con el cliente y pulsa Enviar para mandarlo a cocina". Si ese borrador tiene un envío pendiente, "Pasar a la cuenta" queda desactivado y dice por qué. Con `MESA_SIN_CUENTA`, ofrece abrir la mesa y reintenta.
73. **Pedir la cuenta y llamar al mozo.** Al atender un `PEDIR_CUENTA`, la PWA lleva a la cuenta de la mesa con "Pre-cuenta" a la vista; un `LLAMAR_MOZO` atendido solo cierra el aviso.
74. **Ajustes › Carta web** (Administrador). Formulario con el nombre que ve el cliente, la dirección con su vista ("carta.ejemplo.pe/sabor-norteno"), una propuesta a partir del nombre de la empresa y el aviso "Si cambias la dirección, el enlace anterior deja de funcionar", el logo (subir, cambiar, quitar), el color con una muestra y el aviso de contraste del criterio 89, y por sucursal su dirección, "Publicada" y "Copiar enlace".
75. **Ajustes › Mapa de mesas › QR de las mesas** (Administrador; HU-42). La lista de mesas por zona con su QR pequeño, "Crear los QR que faltan" si hay mesas sin código, "Imprimir la hoja" y, en cada mesa, "Cambiar QR" con la confirmación "El QR impreso de la mesa 12 dejará de funcionar. Tendrás que imprimir y pegar el nuevo". La hoja es una página para imprimir (A4, `@media print`, seis tarjetas por hoja con el nombre de la sucursal, "Mesa 12" grande, el QR de 5 cm y "Escanea para ver la carta y llamar al mozo"); el PDF se obtiene con "Guardar como PDF" del navegador. El QR se dibuja en el equipo con la dependencia de 3b, cargada bajo demanda. Si la carta no está publicada, avisa que el QR mostrará "La carta no está disponible".
76. **Compatibilidad.** Las mismas reglas de 004 (criterio 98): desde 360 px sin desplazamiento horizontal, controles de 48 px o más, Chrome para Android y Safari para iPhone y iPad, montos con `packages/dominio` y cifras tabulares; el QR impreso se lee a 50 cm con un celular de gama media.
77. **E2E de 5a.** Playwright en viewport de celular: el Administrador publica la carta de S1 e imprime la hoja; un cliente simulado (peticiones a la API pública) manda un pedido de la mesa 4 libre; el Mozo y el Cajero reciben el aviso; el Mozo atiende (abre la mesa con 2 comensales), quita una línea, cambia una cantidad y lo pasa a la cuenta; el KDS no tiene ninguna comanda nueva; el Mozo pulsa "Enviar" y el KDS recibe la comanda; el cliente manda "Pedir la cuenta" y el Mozo lo atiende y pide la pre-cuenta; otro llamado se descarta; un llamado duplicado (mismo id) no aparece dos veces.

---

## Entrega 5b · Carta web (`apps/web`)

Además de lo anterior: "la carta web" es `apps/web` levantada contra la API de 5a; el rol frontend usa la skill `impeccable`.

78. **La aplicación.** `apps/web` es una app Next.js (App Router, TypeScript) del monorepo, con `output: 'standalone'` y su imagen de Docker. Lee la API pública en el servidor (`API_URL_INTERNA`) para la carta y la mesa, y desde el navegador (`NEXT_PUBLIC_API_URL`) para la disponibilidad, el envío del llamado y su estado. Usa `packages/contratos` (validación de las respuestas en el servidor) y `packages/dominio` (`calcularLinea`, `totalOrden`, `validarSeleccion`, `dentroDeHorario` y el color accesible del criterio 89); no usa `packages/ui`, para no cargar el sistema de la PWA.
79. **Direcciones.** `CARTA_WEB_URL/<empresa>` lista las sucursales publicadas (con una sola, redirige con 307 a la suya); `CARTA_WEB_URL/<empresa>/<sucursal>` es la carta; `CARTA_WEB_URL/m/<código>` es el modo mesa de esa mesa. Una dirección con mayúsculas redirige con 308 a la de minúsculas. Lo que la API responde con 404 muestra la página "Esta carta no está disponible" con estado HTTP 404.
80. **Caché.** La carta (`/<empresa>/<sucursal>`) se arma en el servidor con los datos de la API guardados hasta 30 segundos y responde `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`. El modo mesa se arma en cada petición, con `Cache-Control: private, no-store`, `X-Robots-Tag: noindex` y `Referrer-Policy: no-referrer` (el código no sale en el `Referer` de las fotos). `robots.txt` excluye `/m/`.
81. **La carta.** Encabezado con el logo, el nombre, la sucursal, la dirección y el horario ("Abierto ahora · hasta las 23:00", "Cerrado ahora · abre a las 12:00" o sin línea si no hay horario); las familias como enlaces a sus secciones, en filas que pasan de línea; cada producto con foto (si tiene), nombre, descripción y precio `S/ 28.00`; los combos y el menú del día con sus componentes y opciones. Sin JavaScript la carta se lee completa.
82. **Agotado sin recargar** (HU-09, RF-41). Con la página visible, la carta consulta la disponibilidad (criterio 23) al cargar, cada 15 segundos y al volver a la pestaña, con `If-None-Match`, y oculta los productos que ya no están en `vendibles` y los modificadores no disponibles. En el modo mesa, una línea del pedido que se agotó queda marcada "Se agotó" y "Enviar al mozo" se desactiva hasta quitarla. Prueba: el Cocina/Barra marca un plato agotado en la PWA y desaparece de una carta abierta en menos de 25 segundos sin recargar.
83. **Vista previa al compartir** (RF-40). La carta lleva `og:title` ("Sabor Norteño · Miraflores"), `og:description` (dirección y horario), `og:url`, `og:image` (1200 × 630, generada con el logo, el nombre y el color; con el nombre solo si no hay logo) y `twitter:card` `summary_large_image`. El modo mesa lleva una vista previa genérica sin el código.
84. **Armar el pedido** (HU-40, RF-85). En el modo mesa, tocar un producto abre una hoja con sus grupos (la regla en palabras y validación con `validarSeleccion`), la cantidad (1 a 20), la observación (140) y el precio de la línea con `calcularLinea`. "Tu pedido" muestra las líneas, que se editan o se quitan, el total con `totalOrden`, una nota (140) y "Enviar al mozo". El pedido se guarda en el navegador (`sessionStorage`, por código) y sobrevive a una recarga. Con 422, marca las líneas rechazadas con el motivo en palabras.
85. **Llamar al mozo y pedir la cuenta** (RF-86). Dos botones fijos abajo, "Llamar al mozo" y "Pedir la cuenta", con una confirmación corta. Con un llamado pendiente, los tres envíos quedan desactivados con "Ya avisamos al mozo".
86. **Estado del llamado** (HU-40; pregunta 3). Después de enviar, un banner dice "Avisamos al mozo. Puedes seguir viendo la carta"; la página consulta el estado (criterio 38) cada 10 segundos mientras esté pendiente y lo dice con palabras: "El mozo viene a tu mesa" (atendido), "El mozo tomó tu pedido" (pasado a la cuenta), "No pudimos atender este pedido. Habla con el mozo" (descartado), "Nadie respondió a tiempo. Llama al mozo o vuelve a enviarlo" (vencido). Al dejar de estar pendiente, se puede enviar otro. `FUERA_DE_HORARIO`, `LLAMADO_PENDIENTE` y `DEMASIADOS_LLAMADOS` (con el tiempo de espera) tienen su mensaje en palabras.
87. **Nada se pierde por un corte** (RNF-10). El `id` del llamado se genera al pulsar "Enviar" y se conserva hasta una respuesta final (201, 4xx); sin red, la página dice "Sin conexión. Lo enviaremos cuando vuelva" y reintenta con el mismo `id` (criterio 29), así el mozo no recibe dos veces el mismo pedido.
88. **Liviana para datos móviles** (presupuesto; decisión del especificador). Medido en el build con `pnpm --filter web presupuesto` (en CI) y en el E2E: JavaScript de la primera carga, gzip, hasta 120 kB en la carta y 150 kB en el modo mesa; HTML de la carta, gzip, hasta 60 kB con 150 productos; CSS hasta 20 kB; sin fuentes web (pila del sistema); fotos con optimización de imágenes de Next (WebP o AVIF, al doble del tamaño en pantalla), diferidas salvo las cuatro primeras, de hasta 25 kB cada una en la lista, y el logo hasta 15 kB; la primera vista a 360 × 740 transfiere hasta 400 kB en total. Si el revisor encuentra que un límite no se puede cumplir, propone otro con su motivo.
89. **Diseño.** Tipo "Operate" (decisión del especificador): el cliente ya está en el local y viene a elegir y pedir rápido, con una mano y con señal débil, así que manda la claridad (lista, foto, precio, botón), no la persuasión. La marca del restaurante entra por su logo, su nombre y su color; el color se usa en la acción principal y el encabezado solo con un contraste de 4.5:1 o más (si no lo alcanza, se oscurece con `colorDeMarcaAccesible` de `packages/dominio`). Antes de construir las pantallas, el frontend escribe con `impeccable` el brief y la dirección de la carta web (`apps/web/PRODUCT.md` y `apps/web/DESIGN.md`) y el orquestador los muestra al usuario para su aprobación.
90. **Accesibilidad.** WCAG 2.2 AA: `lang="es-PE"`, un `h1` y un `h2` por familia, enlace "Ir a la carta", foco visible de 3 px, hojas como diálogos con el foco atrapado y devuelto, controles de 48 px o más, `alt` con el nombre del producto, precios que el lector de pantalla lee completos ("28 soles"), avisos y errores con `aria-live`, texto al 200 % sin cortes, `prefers-reduced-motion`, ningún estado dicho solo con color, y trato de tú.
91. **Compatibilidad.** Desde 360 px sin desplazamiento horizontal (también a 320 px), Chrome para Android y Safari para iPhone recientes, buena lectura a pleno sol.
92. **Pruebas.** De componentes (Vitest y Testing Library) para la hoja de producto, el pedido, el reintento con el mismo `id`, el banner de estado y la disponibilidad. E2E con Playwright de punta a punta, con dos contextos (cliente a 360 px y Mozo en la PWA): escanear (abrir `/m/<código>`), ver solo lo disponible, agotar un plato desde la PWA y verlo desaparecer, armar y enviar un pedido, ver "Avisamos al mozo", que el Mozo lo atienda y lo pase a la cuenta, que el estado cambie en la página del cliente, que el KDS no reciba nada hasta "Enviar", y "Pedir la cuenta"; además, el presupuesto del criterio 88 y una revisión automática de accesibilidad (axe) sin fallas graves.
93. **Despliegue.** `apps/web` entra en Turborepo (`build`, `lint`, `typecheck`, `test`), en `docker-compose` y en `DESPLIEGUE-LOCAL.md` (puerto 3001), con sus variables en `.env.example`.

## Acciones auditadas en esta sección

| Acción (`accion`) | Entidad | Cuándo |
| --- | --- | --- |
| `configurar_carta_web` | `carta_web` | Criterio 2 |
| `cambiar_logo_carta_web`, `quitar_logo_carta_web` | `carta_web` | Criterio 3 |
| `configurar_carta_web_sucursal` | `carta_web_sucursal` | Criterio 4 |
| `generar_qr_mesas` | `mesa_qr` | Criterio 8, solo si creó alguno |
| `cambiar_qr_mesa` | `mesa_qr` | Criterio 9 |

No se auditan (quedan en la trazabilidad de su fila, criterio 60): crear, atender, pasar a la cuenta, descartar y vencer un llamado.

## Casos límite

- Un cliente toma una foto del QR y manda pedidos desde su casa: ninguno llega a cocina (decisión 6); fuera de horario y sin cuenta abierta se rechazan (criterio 35); dentro del horario, el mozo ve la mesa vacía y lo descarta con "Pedido falso"; los límites cortan la ráfaga (criterios 32 y 33); si se repite, el Administrador cambia el QR de esa mesa (criterio 9).
- Dos clientes de la misma mesa piden a la vez: el primero llega y el segundo ve "Ya avisamos al mozo" (criterio 30); el mozo agrega lo del segundo en la cuenta, de palabra.
- Una mesa con un pedido pendiente quiere además "Pedir la cuenta": espera a que atiendan el pedido o llama al mozo con la mano (uno pendiente a la vez, decisión 2).
- El cliente cierra la pestaña después de enviar: el llamado sigue; al volver con el QR ve "Ya avisamos al mozo" mientras siga pendiente (criterio 25).
- La mesa está libre y nadie atiende: a los 15 minutos el llamado vence, sale de la lista y el cliente lee "Nadie respondió a tiempo" (criterios 54 y 86).
- Dos mozos tocan "Atender" a la vez: uno gana; el otro ve quién lo atiende (criterio 43).
- El mozo atiende, abre la mesa y descubre que no hay nadie: descarta y libera la mesa sin clave (criterio 53; 004, criterio 44).
- Un plato se agota entre el pedido y la atención: el detalle lo marca en rojo y el paso con esa línea se rechaza (criterio 47); el mozo lo quita y ofrece otro desde el comandero.
- Un precio cambia entre el pedido y el paso: la cuenta usa el del sistema y el detalle muestra lo que vio el cliente (criterios 40 y 47; decisión 3).
- La mesa se une a otra antes del paso: las líneas van a la cuenta principal (criterio 48).
- Anulan la orden después de atender y antes de pasar: 409 `MESA_SIN_CUENTA`; el mozo abre la mesa otra vez y pasa el llamado (criterio 48).
- El celular del mozo se apaga justo después de pasar a la cuenta: el llamado ya está `PASADO_A_CUENTA` y sus líneas no llegaron a ningún borrador. Otra persona abre el detalle y usa "Agregar a mi borrador" (solo en el equipo, sin cambiar el llamado). Ver "Riesgos aceptados propuestos".
- El Administrador cambia el QR con un cliente sentado: la página abierta del cliente deja de funcionar ("Esta carta no está disponible") y un llamado ya enviado sigue para el mozo (criterio 9).
- Un llamado atendido que nadie pasó ni descartó antes de que termine el día operativo deja de aparecer en la lista (criterio 39); se puede abrir por su id y pasarlo con los precios de ese momento.
- Restaurante con wifi para clientes: todas las mesas salen con la misma IP; el límite de 20 en 10 minutos por sucursal alcanza para un servicio normal (pregunta 6).
- La sucursal deja de tener `PEDIDOS_WEB` en su plan o despublica la carta con llamados pendientes: los pendientes siguen para el mozo y vencen solos; la mesa ya no acepta nuevos.
- El reloj de la API pasa la hora de corte con un llamado pendiente: vence por sus 15 minutos, no por el día; la carta pública cambia el menú del día y los agotados del día anterior.
- La carta en caché (30 s) muestra un plato recién agotado: la consulta de disponibilidad lo oculta en la carga y el envío lo rechaza (criterios 24 y 82).
- La dirección de la sucursal pasa de `miraflores` a `miraflores-centro`: los enlaces compartidos antes dejan de funcionar (criterio 2); los QR no cambian, porque usan el código.

## Reglas de negocio aplicables

Fuente: `fuentes.md` (RF-40, RF-41, RF-84 a RF-88, HU-09, HU-21, HU-40 a HU-42, diseño) y sus "Decisiones del usuario (2026-11-02)". Las preguntas abiertas de abajo pueden cambiar las que dicen "pregunta N".

- Cada mesa tiene un QR imposible de adivinar que abre la carta web en modo mesa; se imprime la hoja con los QR de la sucursal y se puede cambiar el de una mesa, y el anterior deja de funcionar (RF-84, HU-42).
- En la carta de mesa se arma un pedido con modificadores, combos y notas, sin datos de contacto ni pago, y se envía como un llamado al mozo; los precios se muestran y la cuenta usa los del sistema (RF-85; decisión 3).
- "Llamar al mozo" y "Pedir la cuenta" llegan al mozo como llamados sin pedido (RF-86; decisión 5).
- El aviso llega en tiempo real y con sonido al mozo responsable de la mesa, o a todos los mozos si la mesa está libre; quien atiende una mesa libre la abre y queda como responsable (RF-87; decisión 1).
- El mozo revisa el llamado con el cliente, lo ajusta (cantidades, quitar platos) o lo descarta, y lo pasa a la cuenta como ítems sin enviar; nada llega a cocina hasta que el mozo envía la comanda (RF-87, HU-41; decisión 6).
- Uno pendiente a la vez por mesa; se puede mandar otro cuando atienden el anterior; límite de envíos por mesa; vence a los 15 minutos sin atender; se registra quién lo atendió o descartó (RF-88, HU-40, HU-41; decisiones 2 y 4).
- La carta web es por empresa y sucursal (dirección empresa/sucursal), con logo, colores, fotos, horario y vista previa al compartir; muestra solo lo disponible en la sucursal y oculta lo agotado al instante (RF-40, RF-41, HU-09, HU-21). Dominio propio, fuera del MVP (diseño).
- "La carta web solo acepta pedidos dentro del horario de la sucursal" (diseño; en el modo mesa, con la pregunta 5).
- Las reglas de 004 que se reutilizan sin cambio: abrir mesa (mozo responsable, comensales), el borrador por persona y orden, "Enviar" con validación y todo o nada, el ruteo y la impresión.
- La suspensión de la suscripción solo impide abrir caja (002).
- Solo nube, sin modo offline; ante microcortes se reintenta sin duplicar (RNF-10).

## Contrato

### Endpoints

"Salón" = `@Permiso('ATENDER_MESA')` + `@RequiereModulo('SALON')`; "Admin" = `@Permiso('ADMINISTRAR')`; "Pública" = `@Publica()` (sin sesión; la empresa sale de la dirección o del código). "IK" = `Idempotency-Key` obligatoria.

**Entrega 5a**

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `GET /carta-web` | Admin | — | 200 `cartaWebRespuesta` |
| `PUT /carta-web` | Admin | `cartaWebEntrada` | 200; 400; 403; 409 `CONFLICTO` |
| `PUT /carta-web/logo` | Admin (`@SinEmpresa`, dos transacciones cortas) | binario | 200 `{ logoUrl }`; 403; 409 `CARTA_WEB_SIN_CONFIGURAR`; 413; 415; 422 `FOTO_INVALIDA` |
| `DELETE /carta-web/logo` | Admin | — | 204; 403 |
| `PUT /carta-web/sucursales/:sucursalId` | Admin | `cartaWebSucursalEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `CARTA_WEB_SIN_CONFIGURAR` |
| `GET /sucursales/:sucursalId/qr-mesas` | Admin | — | 200 `qrMesasRespuesta`; 403; 404; 503 `CONFIGURACION_INCOMPLETA` |
| `POST /sucursales/:sucursalId/qr-mesas` | Admin | — | 200 `qrMesasRespuesta`; 403; 404; 503 |
| `POST /sucursales/:sucursalId/mesas/:mesaId/qr` | Admin; IK | — | 201 `qrMesaRespuesta`; 403; 404; 409 `CONFLICTO`; 503 |
| `GET /publico/cartas/:empresaSlug` | Pública | — | 200 `empresaPublica`; 404 |
| `GET /publico/cartas/:empresaSlug/:sucursalSlug` | Pública | `If-None-Match` | 200 `cartaPublica` con `ETag`; 304; 404 |
| `GET /publico/cartas/:empresaSlug/:sucursalSlug/disponibilidad` | Pública | `If-None-Match` | 200 `disponibilidadPublica` con `ETag`; 304; 404 |
| `GET /publico/mesas/:codigo` | Pública | — | 200 `mesaPublica`; 404 |
| `POST /publico/mesas/:codigo/llamados` | Pública (idempotente por `id`) | `llamadoEntrada` | 201 `llamadoPublico`; 400; 404; 409 `FUERA_DE_HORARIO` / `LLAMADO_PENDIENTE` / `CONFLICTO`; 413; 422 `PRODUCTO_NO_VENDIBLE` / `SELECCION_INVALIDA` / `MONTO_FUERA_DE_RANGO` / `CLAVE_IDEMPOTENCIA_REUTILIZADA`; 429 `DEMASIADOS_LLAMADOS` |
| `GET /publico/mesas/:codigo/llamados/:id` | Pública | — | 200 `estadoLlamadoPublico`; 404 |
| `GET /llamados` | Salón | `If-None-Match` | 200 `llamadosRespuesta` con `ETag`; 304 |
| `GET /llamados/:id` | Salón | — | 200 `llamadoDetalle`; 404 |
| `POST /llamados/:id/atencion` | Salón; IK | `atencionEntrada` | 200 `atencionRespuesta`; 400; 404; 409 `MESA_LIBRE` / `LLAMADO_TOMADO` / `LLAMADO_VENCIDO` / `LLAMADO_CERRADO` / `CONFLICTO`; 422 `REFERENCIA_INVALIDA` |
| `POST /llamados/:id/paso-a-cuenta` | Salón; IK | `pasoACuentaEntrada` | 200 `pasoACuentaRespuesta`; 400; 404; 409 `TRANSICION_INVALIDA` / `LLAMADO_CERRADO` / `MESA_SIN_CUENTA`; 422 `PRODUCTO_NO_VENDIBLE` / `SELECCION_INVALIDA` / `MONTO_FUERA_DE_RANGO` / `DATOS_INVALIDOS` |
| `POST /llamados/:id/descarte` | Salón; IK | `descarteEntrada` | 200 `llamadoDetalle`; 400; 404; 409 `LLAMADO_CERRADO` / `LLAMADO_VENCIDO` |

- Orden de rechazos de las escrituras de llamados de la PWA: 401, 403 de rol, 409 `SUCURSAL_NO_ELEGIDA`, 403 `MODULO_NO_INCLUIDO`, 400 de forma (incluida la falta de `Idempotency-Key`), réplica de la misma clave, 404, réplica natural del llamado (criterios 43 y 51), 409 de estado, 422.
- Orden de rechazos del `POST` público: el del criterio 34.
- `:codigo` que no cumple `^[A-Za-z0-9_-]{22}$` y `:empresaSlug` o `:sucursalSlug` fuera de forma responden 404 sin consultar la base.

**Entrega 5b:** ninguna ruta nueva de la API.

### Códigos de error nuevos (`CODIGOS_ERROR`)

`LLAMADO_PENDIENTE` (409), `FUERA_DE_HORARIO` (409), `DEMASIADOS_LLAMADOS` (429, con `reintentarEnSegundos` y `Retry-After`), `LLAMADO_TOMADO` (409, con `atendidoPor`), `LLAMADO_VENCIDO` (409), `LLAMADO_CERRADO` (409, con `estado`), `MESA_LIBRE` (409), `MESA_SIN_CUENTA` (409), `CARTA_WEB_SIN_CONFIGURAR` (409). `errorRespuestaSchema` gana los campos opcionales `atendidoPor` y `estado`. Se reutilizan `DATOS_INVALIDOS`, `NO_ENCONTRADO`, `CONFLICTO`, `PROHIBIDO`, `TRANSICION_INVALIDA`, `REFERENCIA_INVALIDA`, `PRODUCTO_NO_VENDIBLE`, `SELECCION_INVALIDA`, `MONTO_FUERA_DE_RANGO`, `CLAVE_IDEMPOTENCIA_REUTILIZADA`, `CONFIGURACION_INCOMPLETA`, `CUERPO_DEMASIADO_GRANDE`, `FOTO_INVALIDA`, `SUCURSAL_NO_ELEGIDA` y `MODULO_NO_INCLUIDO`.

### Eventos en tiempo real

Transporte de 004 (Socket.IO en `/tiempo-real`, espacio `/`, adaptador de PostgreSQL); sin salas nuevas.

| Evento | Sala | Datos | Cuándo |
| --- | --- | --- | --- |
| `llamado.nuevo` | sucursal | `{ llamadoId, tipo, mesaId, mesaNombre, destinatarios: uuid[] \| null }` | Criterio 36 |
| `llamado.cambio` | sucursal | `{ llamadoId, mesaId, estado }` | Criterios 45, 52 y 53 |
| `salon.cambio`, `orden.cambio` (de 004) | sucursal | los de 004 | Criterio 42, al abrir la mesa |

El vencimiento no publica nada: lo calcula cada lector con el reloj de la API (criterio 54).

### Paquetes compartidos

- `packages/dominio`:
  - `src/llamados/` (ruta crítica P2): lo del criterio 56.
  - `src/carta-web/` (no crítico): `SLUGS_RESERVADOS`, `esSlugValido`, `propuestaDeSlug(nombre)` (sin tildes, minúsculas, guiones) y `colorDeMarcaAccesible(hex)` (`{ fondo, texto }` con 4.5:1 o más).
- `packages/contratos`:
  - `src/carta-web.ts`: `cartaWebEntrada`, `cartaWebRespuesta`, `cartaWebSucursalEntrada`, `qrMesasRespuesta`, `qrMesaRespuesta`, `empresaPublica`, `cartaPublica`, `productoPublico`, `disponibilidadPublica`.
  - `src/llamados.ts`: `llamadoEntrada` (unión por `tipo`), `llamadoPublico`, `mesaPublica`, `estadoLlamadoPublico`, `llamadoResumen`, `llamadosRespuesta`, `llamadoDetalle`, `atencionEntrada`, `atencionRespuesta`, `pasoACuentaEntrada`, `pasoACuentaRespuesta`, `lineaParaBorrador`, `descarteEntrada`, `CODIGO_MESA_REGEX`, y los eventos `llamado.nuevo` y `llamado.cambio`.
  - `src/errores.ts`: los códigos nuevos y los campos `atendidoPor` y `estado`.

### Interfaces de la API (contratos públicos para las pruebas y para otras secciones)

- `CodigosMesaService` (salón, nuevo): `crearPara(mesaId)`, `crearFaltantes(sucursalId)`, `cambiar(mesaId)`, `resolver(codigo)` (fuera de contexto: la empresa; dentro: la mesa con su sucursal, su nombre y si está activa) y `bloquearPorCodigo(codigo)` (`FOR UPDATE` de la fila de `mesa_qr`).
- `CartaWebConsultaService` (carta web, nuevo): `resolverEmpresa(slug)`, `sucursalPublicada(sucursalId)` y `sucursalPorSlug(slug)`.
- `PedidosConsultaService.ordenesVigentesDeMesas(mesaIds)` (pedidos, nuevo): de cada mesa, su orden abierta vigente con su mozo responsable (la principal si se unió).
- `AperturaDeMesasService.abrir({ id, mesaId, comensales, mozoId })` (pedidos, nuevo): las reglas de `POST /ordenes` (004, criterios 9 a 12) para otro módulo, dentro de la transacción de la petición.
- `CartaVentaService.prepararLineas(sucursalId, lineas, instante)` (carta, nuevo): el resultado de `prepararLinea` de cada línea (la línea preparada o su error), con un solo cargador.
- `SucursalesConsultaService.datosPublicos(sucursalIds)` (plataforma, nuevo): nombre, dirección y horario.
- `buscarEmpresaDeCarta(conexion, slug)` y `buscarEmpresaDeCodigoMesa(conexion, codigo)` en `nucleo/base-de-datos/consultas-sin-empresa.ts`.
- Pruebas: `ClientePublico` (`apps/api/test/soporte/`): peticiones sin sesión con una IP elegida en `CABECERA_IP_CLIENTE`.

### Variables de entorno nuevas

| Variable | Dónde | Uso |
| --- | --- | --- |
| `CARTA_WEB_URL` | API y web | URL base pública de la carta (sin barra final): la de los QR, la de `cartaWebRespuesta`, el origen de CORS de `/publico/*` y la URL canónica de `apps/web`. En `development` y `test`, `http://localhost:3001`; en producción puede faltar: la API avisa al arrancar y las rutas de QR responden 503 |
| `CABECERA_IP_CLIENTE` | API | Nombre de la cabecera con la IP real del cliente (en producción, `cf-connecting-ip`). Sin ella, la IP de la conexión |
| `API_URL_INTERNA` | web | URL de la API desde el servidor de Next (red interna de Docker) |
| `NEXT_PUBLIC_API_URL` | web | URL pública de la API para el navegador |
| `ARCHIVOS_URL_PUBLICA` | web | Dominio de las fotos y logos, para la optimización de imágenes de Next |

### Permisos

- Los de la tabla de endpoints. La matriz de `packages/dominio` no cambia. Soporte = Administrador.
- Base de datos (todas con `acceso_plataforma` sin privilegios para `restaurante_plataforma`):

| Tabla | `restaurante_api` |
| --- | --- |
| `carta_web`, `carta_web_sucursal`, `mesa_qr`, `llamado` | SELECT, INSERT, UPDATE |
| `carta_publica.empresa_slug`, `carta_publica.codigo_mesa` | ninguno (solo las funciones y los triggers `SECURITY DEFINER` del migrador) |
| `public.empresa_de_carta(text)`, `public.empresa_de_codigo_mesa(text)` | EXECUTE (solo este rol) |

## Cambios al modelo de datos

Tablas de `public` con `id uuid`, `empresa_id`, `creado_en`, `actualizado_en`, único `(id, empresa_id)`, índice por `empresa_id`, creadas con `sqlTablaDeEmpresaTrazable(tabla, { privilegiosApi, privilegiosPlataforma: [], llaveDeEquipo: true })`, llaves foráneas compuestas con `empresa_id` y `CHECK` de largo en los textos.

- **`carta_web`** (módulo carta web): `nombre` (1 a 80), `slug` (3 a 40, forma del criterio 2), `color_principal char(7)` (`^#[0-9A-F]{6}$`), `logo_clave null`. Único `(empresa_id)` (una por empresa).
- **`carta_web_sucursal`** (carta web): `sucursal_id` (FK compuesta, único), `slug` (3 a 40), `publicada boolean NOT NULL DEFAULT false`. Único `(empresa_id, slug)`.
- **`mesa_qr`** (salón, dueño de las mesas): `mesa_id` (FK compuesta, único), `sucursal_id` (FK compuesta; la de la mesa, para listar), `codigo text` (`^[A-Za-z0-9_-]{22}$`), `generado_en timestamptz`. Único `(codigo)`.
- **`llamado`** (módulo llamados): clave primaria `(empresa_id, id)` (id del cliente, como en 004), `sucursal_id`, `mesa_id` (FK compuestas), `tipo` (`CHECK IN ('PEDIDO','LLAMAR_MOZO','PEDIR_CUENTA')`), `estado` (`CHECK IN ('PENDIENTE','ATENDIDO','PASADO_A_CUENTA','DESCARTADO','VENCIDO')`), `lineas jsonb` (las líneas preparadas al crear, con `productoId`, `modificadorIds` y la observación; `[]` sin pedido), `nota null` (1 a 140), `total numeric(10,2) null`, `huella_entrada bytea` (de la entrada normalizada), `huella_ip bytea`, `vence_en timestamptz`, `destinatario_mozo_id null` (FK compuesta a `usuario`), `orden_id null` (FK compuesta a `orden`: la vigente al crear, luego la de la atención o el paso), `respuesta_creacion jsonb` (el cuerpo de la primera respuesta, para la réplica del criterio 29), `atendido_por_usuario_id null`, `atendido_por_equipo_id null`, `atendido_en null`, `cerrado_por_usuario_id null`, `cerrado_por_equipo_id null`, `cerrado_en null`, `motivo_descarte null` (1 a 140), `lineas_pasadas jsonb null`, `respuesta_paso jsonb null` (para la réplica del criterio 51), `huella_paso bytea null`, `vencido_en null`. Índice único parcial `(empresa_id, mesa_id) WHERE estado = 'PENDIENTE'` (criterio 30). Índices `(empresa_id, mesa_id, creado_en)` (límite por mesa), `(empresa_id, sucursal_id, huella_ip, creado_en)` (límite por conexión) y `(empresa_id, sucursal_id, estado, creado_en)` (lista). `CHECK` de coherencia: `ATENDIDO`, `PASADO_A_CUENTA` y un `DESCARTADO` que venía de atención tienen `atendido_*`; `PASADO_A_CUENTA` y `DESCARTADO` tienen `cerrado_*`; `PASADO_A_CUENTA` tiene `orden_id`, `lineas_pasadas` y `tipo = 'PEDIDO'`; `VENCIDO` tiene `vencido_en`; `lineas` vacío si y solo si `tipo <> 'PEDIDO'`; `vence_en = creado_en + interval '15 minutes'`.
- **Esquema `carta_publica`** (dueño `restaurante_migrador`, `REVOKE ALL FROM PUBLIC`, RLS activada sin políticas como defensa, igual que `contexto.sesion_empresa` de 001):
  - `empresa_slug (slug text PRIMARY KEY, empresa_id uuid NOT NULL UNIQUE)`, mantenida por el trigger `SECURITY DEFINER` `carta_publica.mantener_slug()` sobre `carta_web` (insertar, cambiar el `slug`, borrar).
  - `codigo_mesa (codigo text PRIMARY KEY, empresa_id uuid NOT NULL)`, mantenida por `carta_publica.mantener_codigo_mesa()` sobre `mesa_qr`.
  - `public.empresa_de_carta(text) RETURNS uuid` y `public.empresa_de_codigo_mesa(text) RETURNS uuid`: `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO restaurante_api`.

## Fuera de alcance

- Pedido de delivery y para llevar, consentimiento, bandeja, pedidos telefónicos y mensajes de WhatsApp (RF-42 a RF-49): sección de delivery.
- Dominio propio para la carta web (fuera del MVP).
- Notificaciones del sistema (push) con la PWA cerrada; escalar el aviso a todos si el responsable no atiende (pregunta 9).
- Imprimir la pre-cuenta sola al pedir la cuenta (pregunta 4).
- Otros idiomas en la carta web (pregunta 7).
- Captcha u otra verificación del cliente (los límites, el horario y la confirmación del mozo bastan para el MVP; ver "Riesgos" de `plan.md`).
- Una opción para pausar los llamados de una sucursal sin despublicar la carta (no está en las fuentes).
- Redirigir una dirección vieja a la nueva al cambiarla.
- Cobro desde la mesa, división de la cuenta por el cliente y propinas.
- Purgar llamados viejos.

## Impacto en especificaciones anteriores

- **001, guarda de la API:** `NOMBRES_PROHIBIDOS` gana `empresa_de_carta` y `empresa_de_codigo_mesa`, y `consultas-sin-empresa.ts` gana los motivos `carta-publica` y `codigo-mesa`, cada uno con su consulta fija y un parámetro de texto (como `autenticacion` de 002). `fijar-contexto.ts` gana las constantes de los dos nombres (la regla de ESLint de 002 los trata como a `empresa_de_usuario`). Ninguna prueba existente cambia: amplían listas; test-writer lo confirma en la fase B.
- **002, criterio 1 (lista cerrada de rutas públicas):** `RUTAS_PUBLICAS` de `apps/api/test/acceso/fabrica-sesiones.ts` (protegida, la usa `sesion-rutas.spec.ts`) gana las seis rutas `/publico/*`. Lo ajusta test-writer en la fase B (P4), sin tocar nada más, con la línea `// Ajustado por 005-carta-web-mesa (2026-11-02): rutas públicas de la carta web y del modo mesa.` debajo de su cabecera. Antes de editar repite la búsqueda de otras pruebas protegidas que afirmen la lista de rutas públicas o la lista de motivos `sinEmpresa`; si encuentra otra, avisa al orquestador en lugar de cambiarla.
- **002, CORS:** el origen de `CARTA_WEB_URL` se acepta solo en `/publico/*` (criterio 16). `apps/api/test/seguridad/autenticacion-guard.spec.ts` (no protegida) afirma cabeceras de CORS; si hace falta, la ajusta quien implementa.
- **003, carta:** `CartaVentaService` gana `prepararLineas` (mismo resultado que `prepararLinea` por línea); `cartaDeSucursal` y `prepararLinea` no cambian.
- **004, salón:** crear una mesa crea su código (criterio 6) sin cambiar la respuesta; desactivar o reactivar una mesa no toca su código (criterio 10). `PedidosModule` exporta `AperturaDeMesasService` y `PedidosConsultaService.ordenesVigentesDeMesas`; las rutas y respuestas de 004 no cambian. Ninguna prueba protegida de 004 cambia.
- **004, PWA:** `/salon` gana el segmento "Llamados" y el borrador acepta líneas con la marca opcional del llamado de origen (`LineaBorrador.llamadoId`), sin cambiar cómo se envían.
- **003 y 004, plataforma:** `SucursalesConsultaService` gana `datosPublicos`.

## Notas para otras secciones

- **Sección de delivery (RF-42 a RF-49):** reutilizar `cartaPublica`, `apps/web` y sus URL; el pedido web puede ser un `llamado` de otro tipo o una tabla propia, pero con la misma resolución pública (`empresa_de_carta`), la misma validación (`prepararLineas`), el mismo límite por conexión (`huella_ip`, `decidirLimite`) y el mismo vencimiento calculado al leer (30 minutos según RF-46). El consentimiento (RF-43) aplica a sus datos personales; el modo mesa no pide ninguno. El horario de RF-45 ya tiene `aceptaLlamados` como modelo. Orden `canal = 'WEB'` (ya en el `CHECK` de 004).
- **Sección 4 (Caja):** si se decide que "Pedir la cuenta" imprima la pre-cuenta, hacerlo al atender el llamado, nunca al crearlo (un llamado falso imprimiría).
- **Sección 6 (Inventario):** la carta pública ya oculta lo que el inventario marque agotado (`SIN_STOCK`).
- **Sección 7 (Reportes):** llamados por mesa, tiempo de atención (`atendido_en − creado_en`), vencidos y descartados con su motivo y quién.

## Riesgos aceptados propuestos

Los decide el orquestador después del ataque; se anotan desde ahora porque el diseño los asume:

- **Un llamado pasado a la cuenta cuyas líneas no llegaron a ningún borrador.** Si el equipo se apaga entre la confirmación y la escritura local, el llamado queda `PASADO_A_CUENTA` sin líneas en ningún borrador. El detalle sigue mostrándolas y ofrece "Agregar a mi borrador", solo en el equipo. Dos personas podrían agregarlas en dos equipos y enviarlas dos veces; lo frena ver "Comanda enviada por Ana" en la cuenta (004).
- **Un límite por IP compartida.** Detrás del wifi del local o de un NAT del operador móvil, varias mesas comparten IP: el límite por conexión (20 en 10 minutos por sucursal) puede alcanzar a clientes reales en una noche muy llena. Mitigación: el límite por mesa es el que corta el abuso; los valores se ajustan con la pregunta 6.
- **Códigos que se pueden compartir.** Quien fotografía un QR puede mandar llamados mientras el código siga vigente. Lo contienen el horario, los límites, la confirmación del mozo y el cambio de QR.

## Preguntas abiertas

Para el usuario. Cada una tiene la recomendación del especificador; los criterios ya están escritos con ella.

1. **¿Dividimos la sección en 5a (API, llamados en la PWA y QR) y 5b (carta web)?** **Recomiendo sí** ("Entregas"): 5a tiene toda la ruta crítica y se prueba sin la carta web; 5b es otra aplicación con un brief de diseño que tú apruebas. Hasta terminar 5b, el modo mesa no se puede usar con clientes reales.
2. **¿Qué ve el cliente de su mesa?** **Recomiendo** el nombre de la mesa y de la sucursal, la carta con precios y si ya hay un llamado esperando; no el mozo, ni la cuenta, ni lo consumido, ni si la mesa está ocupada (criterio 25). Mostrar la cuenta en la mesa sería otra función (con la caja).
3. **¿El cliente ve el estado de su llamado?** **Recomiendo sí**, sin el nombre del mozo: "Avisamos al mozo", "El mozo viene a tu mesa", "El mozo tomó tu pedido", "No pudimos atender este pedido" y "Nadie respondió a tiempo" (criterios 38 y 86). HU-40 lo pide en parte ("veo que el mozo ya fue avisado; puedo mandar otro cuando atiendan el anterior").
4. **"Pedir la cuenta": ¿imprime la pre-cuenta sola o solo avisa?** **Recomiendo que solo avise** (criterio 55): el mozo la pide con el botón de siempre, que pone la mesa en amarillo. Imprimirla sola dejaría papel sin nadie que lo lleve, y un llamado falso imprimiría.
5. **¿El modo mesa respeta el horario de la sucursal?** El diseño dice que la carta web solo acepta pedidos dentro del horario. **Recomiendo** aceptar llamados dentro del horario, o a cualquier hora si la mesa ya tiene una cuenta abierta (los clientes que se quedan después del cierre), y a toda hora si la sucursal no cargó su horario (criterio 35). Fuera de eso: "El local está cerrado. Habla con el personal". La carta se puede ver siempre.
6. **Límites contra el abuso (RF-88 no da números).** **Recomiendo:** por mesa, 6 llamados en 30 minutos; por conexión, 20 en 10 minutos en la misma sucursal; un pedido de hasta 30 líneas, de 1 a 20 unidades por línea, con observación y nota de hasta 140 caracteres (criterios 26, 32 y 33). Si el local tiene wifi para clientes, todas las mesas comparten conexión: se puede subir el segundo límite.
7. **¿En qué idioma está la carta web?** **Recomiendo solo español de Perú**, como la app (`PRODUCT.md`). Los nombres de los platos los escribe cada restaurante.
8. **¿La carta web y el modo mesa dependen del plan?** El catálogo de módulos ya tiene "Pedidos web" (`PEDIDOS_WEB`). **Recomiendo** que la carta web y el modo mesa funcionen solo en sucursales cuyo plan lo incluya (criterio 14); hoy hay un solo plan, con todos los módulos, así que no cambia nada para los clientes actuales y deja listo el plan premium.
9. **¿A quién le suena el aviso?** **Recomiendo:** con la mesa ocupada, solo al mozo responsable; con la mesa libre, a todos los que atienden mesas (decisión 1). Todos ven todos los llamados en la lista, sin sonido, y cualquiera puede atender. Sin escalar el aviso a todos si el responsable no responde en unos minutos, y sin notificaciones con la app cerrada (eso necesita push, fuera de alcance como en 004).

## Decisiones del especificador

No son reglas de negocio nuevas, sino cómo se concretan las de las fuentes. Pendientes de la aprobación del usuario junto con la especificación.

- **La empresa se encuentra con dos funciones de búsqueda exacta**, como `empresa_de_usuario` de 002: un espejo en un esquema sin acceso y una sola fijación de contexto. Se descartó un token con la empresa y una firma en la URL: el QR quedaría con unos 120 caracteres (más denso y difícil de leer impreso pequeño), expondría ids internos, y la carta por dirección necesita la búsqueda global de todos modos.
- **El código del QR se guarda tal cual** (con RLS), no solo su huella, porque el Administrador debe poder reimprimir la hoja cuando quiera; no es la credencial de una persona: está pegado en la mesa. Lo protegen sus 128 bits y el cambio de QR.
- **Los ids de producto, grupo y modificador salen al público**: el navegador los necesita para armar el pedido y no dan acceso a nada sin el código de una mesa. No salen ids de empresa, sucursal, mesa, orden, usuario ni estación.
- **El llamado guarda sus líneas en `jsonb`** (hasta 30, nunca cambian) y no en una tabla de líneas.
- **El paso a la cuenta es todo o nada**, como el envío de 004: el detalle ya marca lo agotado antes de pasarlo, el mozo lo quita y el sistema no deja líneas a medias.
- **El paso a la cuenta toma producto, modificadores y observación del llamado** y solo acepta la cantidad y qué líneas pasan: así no se puede meter por el llamado algo que el cliente no pidió. Lo que se agrega de palabra se agrega en el comandero.
- **Atender es "voy yo"**: el mozo toma el llamado antes de ir, así otro no camina a la misma mesa. Abre la mesa en ese momento (decisión 1) en `PEDIDO` y `LLAMAR_MOZO`; un `PEDIR_CUENTA` con la mesa libre no la abre.
- **El borrador sigue en el celular** (004): pasar a la cuenta devuelve las líneas con los precios del sistema y la PWA las agrega al borrador de esa cuenta; nada nuevo se guarda en la base de la orden.
- **El vencimiento se calcula al leer** con el reloj de la API, sin tareas programadas, como los trabajos de impresión de 004; se guarda cuando alguien toca el llamado.
- **Los límites cuentan filas de `llamado`** en PostgreSQL. El de la mesa se serializa con el bloqueo de su fila de `mesa_qr`; el de la conexión, con `pg_advisory_xact_lock` de su huella (permitido por la guarda de 004). Las peticiones rechazadas no se guardan; las ráfagas las corta además Cloudflare por IP (como el ingreso de 002) y un tope de peticiones en curso por código en el proceso.
- **La IP no se guarda**: solo su HMAC con un secreto derivado de `PIN_PEPPER`, para contar sin tener datos personales.
- **Eventos en la sala de la sucursal con `destinatarios`**, como `cocina.listo` de 004, en lugar de salas por rol: la PWA decide a quién le suena; el evento lleva solo ids, el tipo y el nombre de la mesa.
- **El cliente no usa Socket.IO**: consulta el estado cada 10 segundos. Evita conexiones públicas abiertas y mantiene liviana la carta.
- **Carta en caché de 30 segundos más una consulta de disponibilidad chica cada 15**: la carta completa se sirve desde la caché y lo agotado se oculta sin bajarla otra vez; el envío vuelve a validar todo.
- **La carta web es "Operate"** con la marca del restaurante (criterio 89), con fuentes del sistema y sin `packages/ui`, por el presupuesto de datos móviles.
- **La hoja de QR es una página para imprimir**, no un PDF armado en el servidor: el navegador lo guarda como PDF y la API no suma dependencias.
- **El Administrador elige un nombre para la carta** (no se muestra la razón social) y un color; el contraste se corrige solo.
- **Las rutas de configuración usan `ADMINISTRAR`** (como el mapa y la impresión de 004); la matriz no cambia.

## Cambios propuestos a los documentos compartidos

Texto propuesto según las recomendaciones; se ajusta con las respuestas del usuario. El orquestador los lleva a los documentos compartidos en el paso 8.

**Requerimientos**

- **RF-40:** agregar "La dirección es `<restaurante>/<sucursal>`, la elige el Administrador y cambiarla deja de funcionar el enlace anterior; el Administrador publica la carta de cada sucursal".
- **RF-84:** agregar "Los QR se imprimen desde una página para imprimir (A4, seis por hoja)".
- **RF-85** (preguntas 5 y 6): "…hasta 30 líneas de 1 a 20 unidades, con observación y nota de hasta 140 caracteres; dentro del horario de la sucursal, o a cualquier hora si la mesa tiene una cuenta abierta".
- **RF-86** (pregunta 4): agregar "«Pedir la cuenta» solo avisa al mozo; la pre-cuenta la pide el mozo".
- **RF-87** (pregunta 9): agregar "El aviso suena con la app abierta; todos los mozos ven todos los llamados de la sucursal y cualquiera puede atenderlos".
- **RF-88** (pregunta 6): "…límite de 6 llamados por mesa en 30 minutos y de 20 por conexión en 10 minutos…".
- **HU-40** (preguntas 2 y 3): agregar el criterio "Veo si el mozo ya atendió mi llamado, sin ver la cuenta ni quién me atiende".

**Diseño**

- **"Infraestructura"** y **"Alcance":** la carta web en `CARTA_WEB_URL/<restaurante>/<sucursal>` y el modo mesa en `CARTA_WEB_URL/m/<código>`; la carta se entrega en dos partes (5a API y llamados, 5b carta web).
- **"Reglas de negocio":** "En el modo mesa, la carta acepta llamados dentro del horario o si la mesa tiene cuenta abierta" (pregunta 5); "La carta web y el modo mesa son parte del módulo Pedidos web del plan" (pregunta 8).
