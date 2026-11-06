# Software para restaurantes (SaaS multitenant)

Sistema en la nube para restaurantes pequeños del Perú, alquilado por sucursal. Monorepo con pnpm y
Turborepo: `apps/api` (NestJS + Sequelize + PostgreSQL), `packages/dominio` (reglas puras),
`packages/contratos` (esquemas zod) y `packages/config`. La PWA del personal (`apps/app`) y la carta web de los clientes (`apps/web`) ya existen; el puente Android
llega en historias posteriores. En `apps/api/src/modulos/` están además los módulos `carta-web` (configuración de la carta y carta pública) y `llamados` (llamados desde la mesa, dueño de la tabla `llamado`) y, desde la 6a, `caja` y `facturacion` (ver «Caja, cobro y comprobante (6a)»), y desde la 6b, en `facturacion`, las partes `pse`, `padron` y `envios`, y la configuración del PSE en `plataforma` (ver «Facturación electrónica (6b)»); los QR de las mesas viven en `salon`. El diseño y los requerimientos viven en los documentos compartidos
que enlaza `CLAUDE.md`; las historias, en `specs/NNN-nombre/`.

## Estado

Historia 001 (base del monorepo, multitenancy y aislamiento entre empresas) terminada, con la fase E incluida (fijación única del contexto, errores 4xx y modo sin superusuario para PostgreSQL administrado). Su especificación, plan y tareas están en [`specs/001-base-multitenancy/`](specs/001-base-multitenancy/).

La sección 1 de los requerimientos, «Plataforma y acceso» (historia 002), está terminada: su especificación, plan y tareas están en [`specs/002-plataforma-y-acceso/`](specs/002-plataforma-y-acceso/). Incluye la revisión y cinco rondas de ataque adversarial. Lo construido:

- **Ingreso con usuario y contraseña** desde cualquier celular, con bloqueo por intentos y horario de acceso por trabajador (el Administrador no tiene horario).
- **PIN de 4 o 6 dígitos** en los celulares que ya recuerdan a la persona (hasta 5 personas por equipo), con cambio rápido de usuario y cierre por inactividad.
- **Clave de supervisor** para las acciones protegidas, con la matriz de permisos por rol; **trazabilidad de autor** (quién creó y quién cambió cada fila) y **auditoría general** inmutable.
- **Suscripciones por sucursal** con vencimiento, días de gracia y suspensión (la suspensión solo impide abrir caja).
- **Panel del superadministrador** (`/plataforma`) con alta de empresas por HTTP y modo soporte auditado.
- **La PWA del personal** (`apps/app`) con la dirección de diseño Azulejo, pensada primero para el celular.

**Toda ruta exige sesión** (`Authorization: Bearer se.<empresa>.<sesión>.<secreto>`) salvo las `@Publica()` (`GET /health`, `POST /sesiones/contrasena`, `POST /sesiones/pin`, `GET /equipo` y `POST /plataforma/sesiones`): la empresa y la persona de cada petición salen de la sesión, nunca de una cabecera.

La sección 2 de los requerimientos, «Carta» (especificación 003, historias HU-05 a HU-09), está terminada: su especificación, plan y tareas están en [`specs/003-carta/`](specs/003-carta/). Incluye la revisión y dos rondas de ataque adversarial sobre las partes críticas (montos, permisos y aislamiento). Lo construido:

- **Estaciones, familias y productos** (RF-14 y RF-19): alta, edición y orden manual de familias y productos; productos simples, combos y menús del día. El tipo de un producto se puede cambiar, y lo que deja de aplicar se quita solo con confirmación. Afectación tributaria, estación (o ninguna), tipo de control de stock y «se vende solo».
- **Fotos de producto**: JPEG, PNG o WebP de hasta 1 MB, comprobadas por su contenido, en el almacén que elige `ARCHIVOS_DRIVER` (disco en desarrollo, Cloudflare R2 en producción).
- **Precio y disponibilidad por sucursal** (RF-15): el Administrador los cambia en todas las sucursales y el Cajero, solo donde es Cajero. El Administrador y el Cajero editan el resto de la carta; las estaciones siguen siendo solo del Administrador.
- **Grupos de modificadores** (RF-16), reutilizables, con mínimo, máximo y producto ligado; **combos** (RF-17), con componentes y opciones; y **menú del día** (RF-18), cuyas opciones se eligen cada día en cada sucursal.
- **Agotado (86)** (RF-20) hasta el fin del día operativo o hasta reactivarlo. La vista de la sucursal lleva `ETag`, y Disponibilidad la refresca cada 15 segundos y al volver a la pestaña.
- **Auditoría**: cada cambio de precio queda con quién lo hizo. Los eventos `carta.disponibilidad` y `carta.actualizada` se registran al confirmar; el transporte en tiempo real llega en la sección 3.

Lo que la Carta deja a las secciones siguientes: **Salón** (3) muestra la carta con `GET /carta/sucursal` y arma cada línea de venta con `CartaVentaService.prepararLinea` (precio, modificadores, componentes y estaciones); **Caja** (4) toma de esa línea `afectacionIgv` y `aplicaIcbper`; **Pedidos web** (5) publica la misma vista con `cartaDeSucursal` y vuelve a validar con `prepararLinea` al confirmar; **Inventario** (6) lee el `tipoControlStock` de cada producto y marca agotados con origen `SIN_STOCK`.

La sección 3a de los requerimientos, «Salón y Cocina» (especificación 004, historias HU-10 a HU-17 y HU-19), está terminada y ya está en `main`. Su especificación, plan y tareas están en [`specs/004-salon-cocina/`](specs/004-salon-cocina/). Incluye la revisión y tres rondas de ataque adversarial sobre las partes críticas (montos, envío de comandas, permisos y aislamiento). Lo construido:

- **Mapa de mesas** (RF-22): zonas y mesas diseñadas en Ajustes, con una cuadrícula. El salón las muestra por zona, en mapa o en lista, con su estado (libre, ocupada o en pre-cuenta).
- **Abrir mesa y tiempo real** (HU-10, RF-23, RF-24): comensales y mozo responsable. Los cambios llegan a los equipos de la sucursal por Socket.IO, con el adaptador de PostgreSQL; sin conexión, la pantalla se refresca cada 30 segundos.
- **Tomar pedido y enviar la comanda** (HU-11, HU-12, HU-14): comandero con la carta de la sucursal. Cada línea va a su estación (por ejemplo, cocina o barra), incluidas las partes de combos y modificadores. El envío es idempotente, y el borrador sobrevive a una recarga.
- **Marchar y adiciones** (HU-13): el segundo tiempo se marcha a la cocina, y una adición es un envío nuevo de la misma cuenta.
- **Anular y liberar** (HU-15, RF-29, RF-35): anular un ítem (en parte o entero) o la orden. Mozo y Cajero necesitan la clave de supervisor. Liberar una mesa sin consumo queda registrado.
- **Mover, unir y pre-cuenta** (HU-16, HU-17, RF-30 a RF-32): mover la cuenta, unir mesas y pedir la pre-cuenta con su total. La impresión llega en la 3b.
- **Pantalla de cocina y barra** (HU-19): comandas en orden de llegada, filtros por estación, tiempo transcurrido con avisos a los 10 y 20 minutos, y «Listo» con aviso al mozo.
- **Inactividad de Cocina/Barra** (RF-11, decisión 11): la sesión de Cocina/Barra se cierra a los 60 minutos sin actividad (configurable de 1 a 720). Los demás roles no cambian.
- **Permisos, trazabilidad y aislamiento**: quién abrió, comandó y autorizó queda registrado. Las tablas nuevas llevan RLS, y las pruebas protegidas comprueban que una empresa no ve nada de otra.

La sección 3b de los requerimientos, «Impresión básica» (especificación 004, historias HU-38 y HU-39), está terminada y ya está en `main`. Incluye la revisión y cuatro rondas de ataque adversarial sobre la impresión. Lo construido:

- **Impresoras de red** (RF-76): alta, edición y desactivación en Ajustes › Impresión, con ancho de 58 u 80 mm, juego de caracteres y marca de gaveta. Hasta 50 activas por sucursal. Bluetooth se configura, pero solo se imprime con la app del puente (entrega 3c).
- **Destino por estación** (RF-19): cada estación sale a la pantalla de cocina o a una impresora, y hay una impresora de caja para las pre-cuentas.
- **Puente de impresión** (RF-75): se vincula con un código QR de un solo uso, que dura 10 minutos. Hay un puente activo por sucursal; vincular otro revoca el anterior.
- **Cola de trabajos y reenvío** (RF-77): cada comanda y cada pre-cuenta crean su trabajo en la misma transacción que el envío. Si el puente o la impresora no responden, los tickets esperan en cola y salen al volver. Los que no salieron vencen al terminar el día operativo.
- **Tickets ESC/POS** (HU-38): comanda, adición, marcha y anulación; pre-cuenta sin desglose de IGV; página de prueba y reimpresión con la marca «REIMPRESIÓN».
- **Estado y avisos** (HU-39, RF-77): el puente y cada impresora se ven en Ajustes › Impresión, y un aviso en todas las pantallas de la sucursal cuando el puente se desconecta o una impresora no responde.
- **Simulador del puente:** `pnpm puente:simular` implementa el protocolo que usará la app Android y puede levantar una impresora falsa, para probar la impresión sin Android (ver «Impresión (3b)» más abajo).

La siguiente es la 3c: la app Android del puente (Kotlin), que se especifica aparte.

La entrega 5a de la especificación 005, «Carta web y pedido desde la mesa con QR» (HU-40 a HU-42 completas; HU-09, RF-40 y RF-41 en su parte de API), está terminada y ya está en `main`. Su especificación, plan y tareas están en [`specs/005-carta-web-mesa/`](specs/005-carta-web-mesa/). Incluye la revisión y una ronda de ataque adversarial sobre las rutas públicas y los llamados. Lo construido:

- **Carta web por sucursal** (RF-40): nombre, dirección, color, logo y publicación de cada sucursal, en Ajustes › Carta web. La carta pública solo muestra lo que se puede pedir en ese momento (RF-41).
- **QR de las mesas** (RF-84, HU-42): cada mesa tiene su código, que abre `CARTA_WEB_URL/m/<código>`. La hoja se imprime desde Ajustes › Mapa de mesas, y cambiar el QR de una mesa deja sin efecto el anterior.
- **Llamados desde la mesa** (RF-85 a RF-88, HU-40 y HU-41): la API recibe el pedido de la mesa, «Llamar al mozo» y «Pedir la cuenta», y los muestra en Salón › Llamados con aviso en vivo. El mozo atiende (si la mesa está libre, la abre), revisa el pedido con el cliente, lo pasa a la cuenta o lo descarta. Nada llega a cocina hasta que alguien pulsa «Enviar». Un llamado pendiente vence a los 15 minutos, cada mesa tiene uno pendiente a la vez y hay límites por mesa y por conexión.

La entrega 5b de la especificación 005, «Carta web y pedido desde la mesa» (`apps/web`, Next.js), está terminada y ya está en `main`. Lo construido:

- **Carta por sucursal** (RF-40, RF-41): `CARTA_WEB_URL/<empresa>/<sucursal>`, con logo, color, fotos, horario y solo lo que se puede pedir ahora. Se actualiza sola cuando se agota algo y tiene vista previa al compartir.
- **Modo mesa** (HU-40, RF-85, RF-86): el QR de cada mesa abre `CARTA_WEB_URL/m/<código>`. El cliente arma su pedido y lo manda al mozo, llama al mozo o pide la cuenta, y ve con palabras el estado de su llamado. Nada se cobra y nada llega a cocina hasta que el mozo pulsa «Enviar».

Ver «Carta web y pedido desde la mesa (5b)» más abajo.

La entrega 6a de la especificación 006, «Caja, cobro y comprobante sin PSE» (HU-25, HU-26, HU-28 y HU-30 completas; HU-18 y HU-03 en lo que toca a venta de mostrador, descuentos y cortesías), está terminada en la rama `claude/upbeat-wright-q09k0n` y todavía no está en `main`. Su especificación, plan y tareas están en [`specs/006-caja-cobro/`](specs/006-caja-cobro/). Incluye la revisión y tres rondas de ataque adversarial sobre la ruta crítica (montos, cobro, caja, comprobantes, permisos y aislamiento). Ver «Caja, cobro y comprobante (6a)» más abajo.

La entrega 6b de la especificación 006, «Facturación electrónica» (HU-27, HU-29 y HU-31; RF-57 en el envío, RF-58, RF-62 a RF-64 y RF-66), está terminada el 2026-11-06 **salvo la tarea T34**: el adaptador del PSE real, que se hace cuando se elija el PSE. Está en la rama `claude/upbeat-wright-q09k0n`, todavía no en `main`. Hasta que haya adaptador real, todo corre con un PSE simulado. Incluye la revisión, nueve rondas de ataque adversarial sobre la ruta crítica (envío al PSE, notas de crédito, aislamiento y secretos, permisos) y la verificación de la suite, el lint, los tipos, el build, el presupuesto de la PWA y las E2E. Ver «Facturación electrónica (6b)» más abajo.

**Sin T34 no se sale a producción:** sin adaptador real, los emisores solo pueden facturar en modo `SIMULADO`, y sus comprobantes no tienen valor tributario.

## Requisitos

- Node 22 y pnpm 10 (`corepack enable` toma la versión de `packageManager`).
- PostgreSQL 16: con Docker (un comando) o uno propio con un usuario administrador.

```bash
pnpm install --frozen-lockfile
```

## Levantar en local con Docker (un comando)

```bash
pnpm local:preparar   # PostgreSQL 16 (puerto 5433), roles, base migrada y datos de demostración
pnpm dev              # API en http://localhost:3000, app del personal en http://localhost:5173 y carta web en http://localhost:3001
curl http://localhost:3000/health
```

`local:preparar` crea `.env` a partir de `.env.example` si falta (trae todas las variables que
necesita `pnpm dev`, incluida `NODE_ENV`), crea `apps/web/.env.local` a partir de `apps/web/.env.example` si falta, levanta `docker-compose.yml` y ejecuta `db:preparar`,
`db:migrar`, la compilación de los paquetes compartidos (`packages/dominio` y `packages/contratos`) y
`db:semilla`. Funciona en un clon recién instalado, sin compilar nada antes: los paquetes compartidos
se exportan desde `dist/`, que no se versiona. Se puede repetir sin duplicar nada.

## Levantar con un PostgreSQL propio (sin Docker)

Necesitas un usuario administrador (`DATABASE_ADMIN_URL`) que pueda crear roles y bases. Si es
**superusuario** (o dueño de los objetos de `pg_catalog`), `db:preparar` también protege, en la base de
destino, lo que comparten todas las conexiones de `restaurante_api` y `restaurante_plataforma` (mismo
rol para todas las empresas) y no tiene RLS:

- el texto de las consultas de otras sesiones (`pg_stat_activity`, `pg_stat_get_activity`,
  `pg_stat_get_backend_activity`; criterio 38b);
- cancelar o terminar sesiones ajenas (`pg_cancel_backend`, `pg_terminate_backend`), enumerarlas
  (`pg_stat_get_backend_*`) y ser miembro de `pg_signal_backend` (criterio 38c);
- los objetos grandes: todas las funciones `lo_*`, `loread` y `lowrite` de `pg_catalog` (todas sus
  firmas, descubiertas en `pg_proc`) y `SELECT` sobre `pg_largeobject` y `pg_largeobject_metadata`
  (criterio 38d);
- las funciones que ejecutan SQL recibido como texto o por nombre de cursor (todas las firmas de
  `ts_rewrite`, `ts_stat`, `query_to_xml`, `query_to_xmlschema`,
  `query_to_xml_and_xmlschema`, `cursor_to_xml` y `cursor_to_xmlschema`, descubiertas en `pg_proc`) y
  el `UPDATE` sobre `pg_settings` (criterio 22d, capa de base). `restaurante_api` conserva `set_config`.

Los permisos de señal quedan para `pg_signal_backend` y `restaurante_migrador`; los de estadísticas,
para `pg_read_all_stats`. `db:preparar` comprueba **antes de crear o modificar nada** si el
administrador puede aplicar todo eso, y si no puede **falla con un mensaje que lo dice** en vez de dejar
la base sin esa protección en silencio.

### PostgreSQL administrado sin superusuario (producción)

En producción PostgreSQL será administrado y no dará superusuario (DigitalOcean Managed u otro
similar). El aislamiento entre empresas **no depende** de esas protecciones del catálogo: lo dan la RLS
y la fijación única del contexto (`fijar_contexto_empresa`, criterio 22e), que crean las migraciones
con `restaurante_migrador`. Para ese caso, `db:preparar` tiene un modo explícito:

```bash
DB_PROTECCION_CATALOGO=omitir NODE_ENV=production pnpm db:preparar
```

- Sin `DB_PROTECCION_CATALOGO` y con un administrador que no puede tocar `pg_catalog`, `db:preparar`
  falla antes de crear nada y explica `DB_PROTECCION_CATALOGO=omitir`. Cualquier otro valor
  (`omitirr`, `OMITIR`…) también es un error.
- Con `omitir` crea roles, base y privilegios de base como siempre, **omite** las protecciones del
  catálogo y escribe un aviso por la salida de error que nombra cada una: 38b (texto de consultas
  ajenas), 38c (cancelar, terminar o enumerar sesiones), 38d (objetos grandes) y la capa de base de
  22d (SQL desde texto, `pg_settings`). Termina con código 0 y se puede repetir. Con superusuario,
  `omitir` no cambia nada y no hay aviso.
- Esos objetos quedan cubiertos **solo por la guarda de la API y la de plataforma**, que rechazan por
  nombre (fuera de literales y comentarios, con o sin esquema o comillas dobles) `set_config`,
  `pg_settings`, `ts_rewrite`, `ts_stat`, `fijar_contexto_empresa`, `pg_stat_activity`,
  `pg_stat_get_activity`, `pg_cancel_backend`, `pg_terminate_backend`, `pg_signal_backend`,
  `pg_largeobject`, `pg_largeobject_metadata`, `loread`, `lowrite` y todo identificador que empiece con
  `lo_`, `pg_stat_get_backend_`, `query_to_xml`, `cursor_to_xml`, `table_to_xml`, `schema_to_xml` o
  `database_to_xml` (criterio 38e). **Convención:** ninguna tabla, columna ni alias de la aplicación
  empieza con `lo_`.
- Por el canal lateral de la historia 004 (criterio 70) rechazan además `pg_notify`,
  `pg_listening_channels`, `pg_locks`, `pg_lock_status`, `pg_blocking_pids`,
  `pg_safe_snapshot_blocking_pids`, `pg_isolation_test_session_is_blocked`,
  `pg_notification_queue_usage`, `pg_prepared_xacts`, `pg_prepared_xact` y los cerrojos de sesión
  `pg_advisory_lock*`, `pg_try_advisory_lock*` y `pg_advisory_unlock*` (los `*_xact_lock` siguen
  permitidos); las vistas que enumeran sesiones por dentro (`pg_stat_ssl`, `pg_stat_gssapi`,
  `pg_stat_replication`, `pg_stat_get_progress_info` y todo `pg_stat_progress_*`); el estado de las
  transacciones de otras empresas (`pg_current_snapshot`, `txid_current_snapshot`, `pg_xact_status`,
  `txid_status`, `pg_current_xact_id`, `pg_current_xact_id_if_assigned`, `txid_current`,
  `txid_current_if_assigned`, `pg_snapshot_xmin`, `pg_snapshot_xmax`, `pg_snapshot_xip`,
  `pg_visible_in_snapshot`, `txid_visible_in_snapshot` y todo `txid_snapshot_*`); y los contadores de la
  base entera (`pg_stat_database`, `pg_stat_database_conflicts` y todo `pg_stat_get_db_*`).
- Condiciones de despliegue: no instalar en la base de la aplicación extensiones como
  `pg_stat_statements`, `dblink` o `postgres_fdw` (o agregar sus nombres a la lista de la guarda), no
  dar a los roles de la aplicación membresías en `pg_monitor`, `pg_read_all_stats` ni
  `pg_signal_backend` (sin superusuario `db:preparar` no puede quitarlas) y mantener las credenciales
  de `restaurante_api` solo en el entorno de la API.
- El administrador que no es superusuario necesita `CREATEROLE` y `CREATEDB`, y `ADMIN OPTION` sobre los
  tres roles `restaurante_*` (la tiene si los creó él). En PostgreSQL 16, `ALTER ROLE` no deja nombrar
  `SUPERUSER`, `BYPASSRLS` ni `REPLICATION` a quien no es superusuario, así que en ese modo `db:preparar`
  los omite de `ALTER ROLE` (sí los pone en `CREATE ROLE`) y comprueba que el rol no los tiene.

#### TLS y conexión directa (producción administrada)

- **TLS.** Los proveedores administrados exigen conexión cifrada: agrega `sslmode` a **todas** las URL
  (`DATABASE_ADMIN_URL`, `DATABASE_URL`, `DATABASE_PLATAFORMA_URL`, `DATABASE_MIGRADOR_URL`). Lo toman
  la API (Sequelize) y los scripts (`pg`) de la propia URL, sin configuración aparte; las URL de los
  roles que `db:preparar`, `db:migrar` y `db:semilla` derivan del administrador conservan sus
  parámetros (`apps/api/test/ssl-url.spec.ts` lo comprueba). Sin `sslmode` no hay TLS. Con `pg` 8,
  `sslmode=require` (y `prefer`, `verify-ca`) **verifica el certificado** igual que `verify-full`, y
  la CA privada de un proveedor como DigitalOcean no está entre las de Node, así que hay dos formas
  de configurarlo:
  - Recomendada: `?sslmode=verify-full&sslrootcert=/ruta/ca-certificate.crt` (la CA que descargas
    del panel del proveedor; el archivo debe existir en la máquina que corre la API y los scripts).
  - Cifrar sin verificar el servidor: `?sslmode=require&uselibpqcompat=true` (semántica de libpq;
    no protege de un intermediario).
- **Base de mantenimiento.** `db:preparar` se conecta con `DATABASE_ADMIN_URL` tal cual para crear
  roles y la base, así que en DigitalOcean (`.../defaultdb?sslmode=...`) usa `defaultdb`. Si la URL
  no nombra base, o nombra la que se va a preparar, usa `postgres`, como en local.
- **Conexión directa, no un pooler en modo transacción.** `db:preparar` usa un bloqueo asesor de
  sesión (`pg_advisory_lock`) y `SET`/`RESET` de sesión, y las migraciones corren DDL dentro de una
  transacción por migración y crean roles y esquemas con el rol migrador; un
  pooler en modo transacción (PgBouncer, el «connection pool» del panel de DigitalOcean) reparte
  esas sentencias entre conexiones distintas y las rompe. Apunta `DATABASE_ADMIN_URL` y
  `DATABASE_MIGRADOR_URL` al puerto directo del clúster (en DigitalOcean, el de la base, no el del
  pool de conexiones). La API en ejecución no tiene esta restricción.
- **Bloqueo de `db:preparar`.** Si otra ejecución sigue en curso, espera hasta 60 s por el bloqueo y
  falla con un mensaje claro en vez de colgarse.

`NODE_ENV` es obligatoria (`development`, `test` o `production`; sin valor por defecto): sin ella la API
no arranca, y `db:preparar` solo usa las contraseñas por defecto de los roles (`*_local`) con
`NODE_ENV=development` o `NODE_ENV=test` escrito de forma explícita; en otro caso falla nombrando la
`DB_PASSWORD_*` que falta, antes de conectarse. La secuencia completa, desde un clon recién instalado,
con las variables que necesitan los comandos y `pnpm dev` (ajusta el puerto y las contraseñas; las URL
de los roles deben usar las mismas contraseñas que `db:preparar` les asigna):

```bash
export NODE_ENV=development
export DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
export DATABASE_URL=postgres://restaurante_api:api_local@localhost:5432/restaurante
export DATABASE_PLATAFORMA_URL=postgres://restaurante_plataforma:plataforma_local@localhost:5432/restaurante
pnpm install --frozen-lockfile
pnpm db:preparar   # roles restaurante_migrador / _api / _plataforma, la base `restaurante` y las protecciones del catálogo (idempotente; sin superusuario ver más abajo)
pnpm db:migrar     # aplica las migraciones pendientes (idempotente); sin DATABASE_MIGRADOR_URL la deriva del admin y de la base de DATABASE_URL
pnpm db:semilla    # compila los paquetes compartidos y crea un superadministrador y dos empresas de demostración con usuarios por rol, actor `semilla` (idempotente; imprime sus PIN)
pnpm dev           # API en http://localhost:3000
curl http://localhost:3000/health
```

En vez de exportar las variables puedes copiar `.env.example` a `.env` (la API y los scripts lo leen de
la raíz) y cambiar el puerto `5433` por el de tu PostgreSQL. `pnpm db:semilla` compila por su cuenta
los paquetes compartidos (`pnpm build:compartidos`); `pnpm dev` también los compila antes de arrancar.
Si no defines `DATABASE_URL` ni `DATABASE_PLATAFORMA_URL`, `db:semilla` las deriva de
`DATABASE_ADMIN_URL`; la API (`pnpm dev`) sí las necesita en el entorno o en `.env`. `pnpm db:revertir`
deshace la última migración.

`db:preparar` acepta el nombre de la base como argumento (`pnpm db:preparar mi_base`); sin argumento usa
la base de `DATABASE_URL` si está definida (y `restaurante` si no). `db:migrar` y `db:revertir` usan
`DATABASE_MIGRADOR_URL` tal cual; sin ella derivan la URL del administrador con el rol migrador y esa
misma base (la de `DATABASE_URL`, o `restaurante`). Así, con `DATABASE_URL` apuntando a otra base, los
tres comandos trabajan sobre ella. El nombre de base solo admite minúsculas, dígitos y guion bajo.

En producción se corre el mismo `db:preparar` con el usuario administrador del proveedor de
PostgreSQL, `NODE_ENV=production`, las tres `DB_PASSWORD_*` definidas y, si el proveedor no da
superusuario, `DB_PROTECCION_CATALOGO=omitir` (ver arriba).

## Comandos

| Comando                                 | Qué hace                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                             | ESLint en todo el monorepo (incluye las reglas del criterio 37)                                                                                                      |
| `pnpm typecheck`                        | Verificación de tipos                                                                                                                                                |
| `pnpm build`                            | Compila los paquetes y la API                                                                                                                                        |
| `pnpm test`                             | Todas las pruebas (la API necesita `DATABASE_ADMIN_URL`)                                                                                                             |
| `pnpm format:check`                     | Comprueba el formato con Prettier (`pnpm format` lo corrige)                                                                                                         |
| `pnpm dev`                              | API (puerto 3000) y app del personal (puerto 5173) en modo desarrollo                                                                                                |
| `pnpm build:compartidos`                | Compila `packages/dominio` y `packages/contratos` (`db:semilla` lo hace)                                                                                             |
| `pnpm db:semilla`                       | Superadministrador y dos empresas de demostración, con usuarios por rol                                                                                              |
| `pnpm plataforma:superadmin`            | Crea, desactiva o desbloquea un superadministrador (ver "Superadministrador")                                                                                        |
| `pnpm puente:simular`                   | Puente de impresión de mentira, para probar la impresión sin un Android (ver "Impresión")                                                                            |
| `pnpm --filter @restaurante/api worker` | Worker de envíos al PSE y de la carga del padrón, como proceso aparte (compila antes con `pnpm --filter @restaurante/api build`; ver "Facturación electrónica (6b)") |

## La app del personal (`apps/app`) y `packages/ui`

PWA de React + Vite, móvil primero (se diseña a 360 px y se adapta a tablet y escritorio). Usa
`packages/ui` (tokens de la dirección "Azulejo" de `DESIGN.md` y componentes base, consumido desde su
código fuente), `packages/contratos` para hablar con la API y `packages/dominio` para las reglas.

- `pnpm dev` la sirve en `http://localhost:5173` junto con la API; llama a `VITE_API_URL` (por defecto
  `http://localhost:3000`, que ya está en `ORIGENES_PERMITIDOS`). Con la semilla puedes ingresar con
  `fogon.admin` y la contraseña temporal `Temporal-Demo-1` (la app te pide cambiarla); el panel del
  superadministrador está en `/plataforma/ingreso` (`superadmin` / `Superadmin-Demo-1`).
- Pruebas: `pnpm --filter @restaurante/app test` y `pnpm --filter @restaurante/ui test` (Vitest con
  Testing Library; no necesitan base de datos). `pnpm build` genera `apps/app/dist` con el service
  worker (solo guarda archivos estáticos: nunca la API).
- Los tokens de sesión viven en `sessionStorage` y los de equipo en `localStorage`; la app nunca guarda
  un PIN ni una contraseña.
- **E2E (Playwright, viewport de celular de 360 px):** `pnpm --filter @restaurante/app e2e` recorre el
  acceso con equipos recordados contra la API real: ingreso con contraseña y equipo recordado, ingreso
  con PIN, segunda persona en el mismo celular y cambio de usuario, cierre por inactividad (espera
  1 minuto de verdad) y revocación desde la administración. Otro archivo (`clave-supervisor.spec.ts`)
  ejercita la ventana de clave de supervisor con una pantalla de demostración que solo existe en el
  servidor de desarrollo (por eso la E2E usa `vite dev`, no el `build`) y los avisos de gracia y
  suspensión del Administrador. Necesita la base preparada, migrada y con la
  semilla (el superadministrador de demostración; cambia `E2E_SUPERADMIN_USUARIO` y
  `E2E_SUPERADMIN_CONTRASENA` si usas otro) y las variables de la API. Si ya corren la API (3000) y la PWA
  (5173) con `pnpm dev`, las reutiliza; si no, las levanta. Cada corrida crea su propia empresa con
  nombres únicos. `e2e/carta.spec.ts` recorre la carta y la disponibilidad con cuatro personas de una empresa nueva (Administrador, Cocina/Barra, Cajero y Mozo; a 360 px, y en una tableta). La primera vez: `pnpm --filter @restaurante/app exec playwright install chromium`.
  Mientras otra persona recompila `packages/*`, el servidor de desarrollo de Vite puede recargar módulos
  a medio camino y la app falla con "useSesion debe usarse dentro de SesionProvider"; si pasa, reinicia
  `pnpm dev` (o sirve el `build` con `pnpm --filter @restaurante/app preview`).

## Salón y cocina (3a): cómo probarlo

Con la rama de trabajo `claude/upbeat-wright-q09k0n`, `pnpm local:preparar` y `pnpm dev` (ver arriba). Los usuarios de demostración están en [`DESPLIEGUE-LOCAL.md`](DESPLIEGUE-LOCAL.md).

- **Diseñar el mapa.** Como `fogon.admin`, en Ajustes › Mapa de mesas, crea una zona y sus mesas.
- **Dos navegadores.** En uno, entra como `fogon.mozo` (El Fogón · Miraflores). En el otro, o en una ventana privada, entra como `fogon.cocina` y abre `/cocina`. Lo que hace el mozo (abrir la mesa, enviar, marchar, pedir la pre-cuenta) aparece en el KDS sin recargar, y el «Listo» de la cocina llega al salón.
- **Horario de Cocina/Barra.** `fogon.cocina` tiene un horario de acceso de ejemplo, de 11:00 a 23:00 hora de Lima. Fuera de ese horario no puede ingresar.
- **KDS en un iPad o una tableta.** Deja `/cocina` en primer plano y con la pantalla encendida. Si el navegador pasa a segundo plano o la pantalla se apaga, la conexión en vivo se corta; al volver, la pantalla se pone al día sola, y sin conexión se refresca cada 30 segundos.
- **Inactividad de Cocina/Barra.** Una sesión de Cocina/Barra, con PIN o con contraseña, se cierra tras 60 minutos sin actividad. Los demás roles siguen con su tiempo: por defecto, 5 minutos con PIN y 30 con contraseña. El de Cocina y Barra se cambia en Ajustes › Acceso, «Cierre por inactividad de Cocina y Barra (minutos)», de 1 a 720; rige desde la siguiente petición.
- **Pruebas automáticas.** `e2e/salon-cocina.spec.ts` recorre el salón y la cocina con tres celulares de 360 px (`pnpm --filter @restaurante/app e2e`). Ver [`apps/app/README.md`](apps/app/README.md).

## Impresión (3b): el puente y cómo probarla sin un Android

El **puente** es el programa que corre en el local, vinculado a una sucursal. Recibe de la API los trabajos de impresión (los tickets de comandas y pre-cuentas, la página de prueba y las reimpresiones), los manda por TCP a las impresoras de red, por defecto al puerto 9100, y reporta cada resultado. La app Android del puente es la entrega 3c. Mientras tanto, `pnpm puente:simular` corre el mismo `SimuladorPuente` de las pruebas (`apps/api/test/soporte/puente/`) contra tu API local: vincula con el texto del QR, se conecta al espacio `/puente`, manda los tickets a las impresoras de red y reporta el resultado y el latido. Con `--emulador` levanta además una impresora ESC/POS falsa y escribe en la consola cada ticket que recibe, como texto.

1. **Arranca** la API y la app (`pnpm local:preparar` y `pnpm dev`; ver arriba). El puerto de la API es el 3000 y `API_URL_PUBLICA` vale `http://localhost:3000` en desarrollo.
2. **Crea la impresora apuntando al emulador.** Como `fogon.admin`, en Ajustes › Impresión, crea una impresora de red con host `127.0.0.1` y puerto `9100` (el puerto por defecto del emulador; cambia con `--emulador-puerto`). Elígela como destino de la estación Cocina, o como impresora de caja para las pre-cuentas.
3. **Pide el código de vinculación.** En Ajustes › Impresión, «Vincular puente» muestra el texto del QR (`restaurante-puente://vincular?api=…&t=vi.…`) con un botón para copiarlo. El código sirve una vez y dura 10 minutos; pedir otro invalida el anterior.
4. **Vincula el simulador.** En otra terminal, desde la raíz del repositorio y con el texto entre comillas:

   ```bash
   pnpm puente:simular --emulador --qr "restaurante-puente://vincular?api=http%3A%2F%2Flocalhost%3A3000&t=vi...."
   ```

   Verás en la consola la vinculación, la sucursal, las impresoras que trae la configuración y «Esperando trabajos de impresión». En la app, el aviso de «puente desconectado» desaparece.

5. **Imprime.** Pide la «página de prueba» de la impresora, o abre una mesa como `fogon.mozo`, comanda y envía: el ticket sale en la consola, entre `┌─ Ticket N` y `└─ fin del ticket N`, con las tildes y los anchos del papel de la impresora (`--ancho 58|80` define las columnas del emulador). Con `--marcas` también muestra la transcripción con marcas (`[B]` negrita, `[CORTE]`…).

Opciones: `--api <url>` (si el QR trae una URL pública que tu máquina no alcanza), `--emulador-host`, `--emulador-puerto`, `--ancho`, `--marcas`, `--nombre-equipo` y `--token-archivo` (ver `pnpm puente:simular --ayuda`). El código del QR es de un solo uso, así que el comando guarda la credencial del puente en `.puente-simulador.json` (carpeta desde la que corres el comando; está en `.gitignore`) y, sin `--qr`, la reutiliza: `pnpm puente:simular --emulador` vuelve a conectar sin pedir otro código. Si vinculas otro puente en la sucursal, el anterior queda revocado y el simulador se detiene. Termina con Ctrl+C.

Para ver los estados: detén el simulador (Ctrl+C) y espera hasta un minuto y medio: la app muestra «El puente de impresión está desconectado» y los tickets nuevos quedan en cola. O crea una impresora en otro puerto donde nadie escucha: en unos segundos la app muestra «La impresora … no responde» y los tickets quedan en cola. El simulador solo imprime en impresoras de red: una Bluetooth queda con estado «Sin datos» y sus trabajos, pendientes (llegan con la app 3c).

### Variables de la impresión

- `API_URL_PUBLICA`: la dirección de la API que va en el QR, sin barra final. Con `development` y `test`, si falta, vale `http://localhost:<PORT>`. En producción hay que definirla; sin ella, crear un código de vinculación responde 503 `CONFIGURACION_INCOMPLETA`. Si el QR trae una dirección que tu máquina no alcanza, usa `--api` en el simulador.
- `TIEMPO_REAL`, `DATABASE_TIEMPO_REAL_URL` y `DB_PASSWORD_TIEMPO_REAL`: el puente recibe por Socket.IO (espacio `/puente`) el aviso `trabajo.nuevo` de cada trabajo nuevo. Con `TIEMPO_REAL=deshabilitado` ese aviso no sale, y el puente trae sus trabajos en el sondeo de cada 30 segundos.

### Límites

- **256 KB por ticket** (`MAXIMO_BYTES_TICKET`, 262 144 bytes ESC/POS). Un ticket que no cabe sale cortado con «... Ticket incompleto: faltan N líneas. Revisa la cuenta en la app.»; el trabajo queda como «Incompleto» en «Trabajos de hoy», y el simulador lo marca como `INCOMPLETO` en el encabezado. Un ticket normal pesa muy por debajo.
- **1 MB por respuesta** (`MAXIMO_BYTES_RESPUESTA_TRABAJOS`, 1 000 000 bytes). `GET /puente/trabajos` trae hasta 20 trabajos por impresora y, como mínimo, uno de cada impresora que tenga pendientes, aunque por sí solo pase el tope. Lo que no entra sale en la siguiente llamada, y la respuesta lo avisa con la cabecera `X-Puente-Hay-Mas: 1`. Por eso, con muchas impresoras (hasta 50 activas por sucursal), una respuesta puede pasar de 1 MB.
- **La regla de «Hay más».** El puente vuelve a pedir enseguida cuando la respuesta trae `X-Puente-Hay-Mas: 1` (o una impresora llenó sus 20 trabajos), pero solo si el lote anterior avanzó: si la API aceptó (2xx) el resultado `IMPRESO` de al menos un trabajo. Si no, espera el intervalo de 30 segundos o el aviso `trabajo.nuevo`. Así, una API que rechaza los resultados no hace que el puente entre en bucle.

## Carta web y llamados desde la mesa (5a)

La 5a incluye la API, la PWA del personal y los QR. La pantalla del cliente (la carta pública y el modo mesa) está en la 5b, en `apps/web` (ver «Carta web y pedido desde la mesa (5b)» más abajo). Los llamados también se pueden probar con `curl` contra la API pública (abajo).

### Variables `CARTA_WEB_URL` y `CABECERA_IP_CLIENTE`

- **`CARTA_WEB_URL`**: URL base pública de la carta, sin barra final (por ejemplo `https://carta.ejemplo.pe`). Es la que llevan los QR (`CARTA_WEB_URL/m/<código>`) y la de los enlaces de Ajustes › Carta web. CORS acepta además su origen en `/publico/*`, junto con los de `ORIGENES_PERMITIDOS`. Si no es una URL `http` o `https` válida, la API no arranca. Con `development` y `test`, si falta, vale `http://localhost:3001`. En producción hay que definirla: sin ella, la API avisa al arrancar y las rutas de QR responden 503 `CONFIGURACION_INCOMPLETA`.
- **`CABECERA_IP_CLIENTE`**: nombre de la cabecera que trae la IP real del cliente, sin distinguir mayúsculas. La API la usa para el límite de llamados por conexión; la IP nunca se guarda, solo su huella. Detrás de Cloudflare, `cf-connecting-ip`. Si la cabecera falta o no trae una IP válida, la API usa la IP de la conexión, que detrás de un proxy es la del proxy: todos los clientes compartirían un solo límite.
- **Cuándo configurarla:** solo con un proxy de confianza delante que reemplace esa cabecera. Sin ese proxy no la definas: cualquiera podría escribirla y elegir la IP que quisiera. En producción, la API debe ser alcanzable solo a través del proxy. En `.env.example` viene comentada.
- **Cloudflare:** en producción conviene un límite de peticiones para `/publico/*`, como el que ya cubre el ingreso (002), para cortar las ráfagas antes de que lleguen a la API.

### Imprimir la hoja de QR de las mesas

Como Administrador, en la PWA:

1. En **Ajustes › Carta web**, pon el nombre y la dirección de la empresa, y en cada sucursal su dirección y marca **Publicada**. Si la carta no está publicada, la hoja avisa de que el QR mostrará «La carta no está disponible».
2. Ve a **Ajustes › Mapa de mesas** y pulsa **QR de las mesas**. Cada mesa muestra su QR y su enlace. Si hay mesas sin código (las creadas antes de la 5a), un aviso ofrece **Crear los QR que faltan**: pulsa ese botón antes de imprimir.
3. Pulsa **Imprimir la hoja** cuando terminen de dibujarse los QR. Se abre el diálogo de impresión del navegador: la hoja A4 trae seis tarjetas de 9 × 9 cm. Para guardarla como PDF, elige «Guardar como PDF».
4. **Cambiar QR**, en una mesa, pide confirmación: el impreso de esa mesa deja de funcionar, así que hay que imprimir y pegar el nuevo. Los llamados que ya llegaron con el código anterior siguen para el mozo.

### Probar un llamado con `curl`

Hace falta una sucursal con la carta publicada y una mesa con su código. El código es lo que va después de `/m/` en el enlace de la mesa, que se ve en la hoja de QR de la PWA (o el campo `codigo` de `GET /sucursales/<sucursalId>/qr-mesas`, con sesión de Administrador). Los ejemplos usan `jq`.

```bash
API=http://localhost:3000
CODIGO=<código de la mesa>

# La mesa: su nombre, su carta (empresaSlug y sucursalSlug) y si acepta llamados ahora
curl -s "$API/publico/mesas/$CODIGO" | jq

# Un llamado para el mozo, sin líneas: responde 201 con estado PENDIENTE
ID=$(node -e 'console.log(require("node:crypto").randomUUID())')
curl -s -w '\n%{http_code}\n' -X POST "$API/publico/mesas/$CODIGO/llamados" \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"tipo\":\"LLAMAR_MOZO\"}"

# Repetir el mismo id devuelve la misma respuesta (201) y no crea otro llamado
curl -s -w '\n%{http_code}\n' -X POST "$API/publico/mesas/$CODIGO/llamados" \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"tipo\":\"LLAMAR_MOZO\"}"

# Estado del llamado para el cliente
curl -s "$API/publico/mesas/$CODIGO/llamados/$ID" | jq
```

Un pedido lleva líneas. Los `id` de los productos están en la carta pública, en `familias[].productos[]`:

```bash
curl -s "$API/publico/cartas/<empresaSlug>/<sucursalSlug>" | jq '.familias[].productos[] | {id, nombre}'
```

`modificadorIds` es obligatorio: usa `[]` si el producto no tiene grupos obligatorios. Si los tiene, elige modificadores de sus grupos (`grupos[].modificadores[].id`); si no cumples la selección, la respuesta es 422 `SELECCION_INVALIDA`. Con la mesa sin un llamado pendiente:

```bash
PRODUCTO=<id de un producto de la carta>
ID2=$(node -e 'console.log(require("node:crypto").randomUUID())')
curl -s -w '\n%{http_code}\n' -X POST "$API/publico/mesas/$CODIGO/llamados" \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$ID2\",\"tipo\":\"PEDIDO\",\"lineas\":[{\"productoId\":\"$PRODUCTO\",\"modificadorIds\":[],\"cantidad\":2,\"observacion\":\"sin cebolla\"}],\"nota\":\"Pedido de prueba\"}"
```

Un llamado pendiente bloquea el siguiente de la mesa hasta que el mozo lo atienda o lo descarte, o hasta que venza a los 15 minutos. Para seguir probando, atiéndelo o descártalo en **Salón › Llamados** de la PWA, con un usuario que tenga `ATENDER_MESA` (por ejemplo `fogon.mozo`). El estado que ve el cliente puede ser `PENDIENTE`, `ATENDIDO`, `PASADO_A_CUENTA`, `DESCARTADO` o `VENCIDO`.

Respuestas de error que vas a ver:

- `404 NO_ENCONTRADO`: código desconocido, de una mesa inactiva o reemplazado por un cambio de QR; también si la sucursal no está publicada o su plan no incluye `PEDIDOS_WEB`.
- `409 FUERA_DE_HORARIO`: la sucursal tiene horario cargado y es hora de cerrar (hora de Lima), salvo que la mesa tenga una cuenta abierta. Sin horario cargado, acepta a cualquier hora.
- `409 LLAMADO_PENDIENTE`: la mesa ya tiene un llamado pendiente.
- `422 PRODUCTO_NO_VENDIBLE` o `SELECCION_INVALIDA`: alguna línea no se puede pedir ahora. `campos` trae `lineas.<i>` con cada línea rechazada, y nada se guarda.
- `429 DEMASIADOS_LLAMADOS`: la mesa tiene 6 llamados en 30 minutos, o la conexión 20 en 10 minutos en la misma sucursal. La cabecera `Retry-After` dice cuánto esperar.
- `413 CUERPO_DEMASIADO_GRANDE`: el cuerpo pasa de 16 KB.

En local, sin `CABECERA_IP_CLIENTE`, todos los `curl` cuentan como una sola conexión, y los límites se aplican igual en las pruebas. Para simular otros clientes, pon `CABECERA_IP_CLIENTE=cf-connecting-ip` en `.env`, reinicia `pnpm dev` y añade `-H 'cf-connecting-ip: 203.0.113.10'` (o cualquier otra IP). Es solo para pruebas en tu máquina.

### El aviso solo llega con la app abierta

El aviso de un llamado (banner, sonido y vibración) llega solo mientras la PWA está abierta en el equipo del mozo. No hay notificaciones push: con la pantalla apagada, la app en segundo plano o cerrada, el mozo se entera al volver a abrirla, cuando la lista de **Salón › Llamados** muestra los pendientes. Las notificaciones push quedan fuera de alcance, como en 004. Sin conexión en tiempo real, la lista se refresca cada 30 segundos. El sonido necesita un toque en la app (lo exigen los navegadores) y se silencia en el equipo con **Sonido de avisos**, en esa misma lista.

## Carta web y pedido desde la mesa (5b)

La carta para el cliente es `apps/web` (Next.js, puerto 3001). Se configura en Ajustes › Carta web y en Ajustes › Mapa de mesas, y tiene dos partes:

- **La carta de la sucursal**, en `CARTA_WEB_URL/<empresa>/<sucursal>`: la página para compartir, con su vista previa.
- **El modo mesa**, en `CARTA_WEB_URL/m/<código>`: lo que abre el QR de cada mesa. El cliente arma su pedido y lo manda al mozo, llama al mozo o pide la cuenta. Nada se cobra, y nada llega a cocina hasta que el mozo pulsa «Enviar» (ver «Carta web y llamados desde la mesa (5a)»).

**Cómo levantarla.** `pnpm dev` la levanta junto con la API (3000) y la PWA (5173). Lee `apps/web/.env.local`, que `pnpm local:preparar` crea a partir de `apps/web/.env.example`; sin ese archivo, las páginas fallan con «Falta la variable API_URL_INTERNA». `CARTA_WEB_URL` debe ser la misma en `.env` (la API la usa para los QR y para el CORS de `/publico/*`) y en `apps/web/.env.local`. Para ver las fotos en local, `IMAGENES_PERMITIR_IP_LOCAL=1` (que pone `pnpm local:preparar`) solo vale con direcciones `localhost`: la carta web no construye ni arranca si sus direcciones públicas son otras. El celular y Docker están en [`DESPLIEGUE-LOCAL.md`](DESPLIEGUE-LOCAL.md).

**Pruebas y E2E.** Con la API falsa de `apps/web/e2e/api-falsa.mjs` (puerto 3100), que no necesita base de datos:

```bash
pnpm --filter @restaurante/web test                              # Vitest: componentes, horario, pedido y reglas
pnpm build:compartidos                                           # si no corriste local:preparar: los paquetes compartidos
pnpm --filter @restaurante/web build                             # la carta, como en producción
pnpm --filter @restaurante/web presupuesto                       # peso de la carta, después de build (criterio 88)
pnpm --filter @restaurante/web exec playwright install chromium  # la primera vez
pnpm --filter @restaurante/web e2e                               # carta, modo mesa, peso, accesibilidad y compatibilidad
```

La E2E construye la carta y la sirve como en producción, y levanta la API falsa si no está corriendo.

Para el punta a punta (criterio 92), con la API real, la PWA del Mozo y la carta web: prepara la base (`pnpm db:preparar && pnpm db:migrar && pnpm db:semilla`), agrega `http://localhost:5174` a `ORIGENES_PERMITIDOS` en `.env` y corre:

```bash
E2E_API_URL=http://localhost:3000 pnpm --filter @restaurante/web e2e
```

Con `E2E_API_URL`, Playwright levanta la API y la PWA del personal (puerto 5174) si no están corriendo, y solo corre `punta-a-punta.spec.ts`.

Documentos de la carta: [`apps/web/README.md`](apps/web/README.md) (scripts, variables, rutas y regla de peso), [`apps/web/PRODUCT.md`](apps/web/PRODUCT.md) y [`apps/web/DESIGN.md`](apps/web/DESIGN.md) (producto y diseño, aprobados el 2026-11-03), y [`DESPLIEGUE-LOCAL.md`](DESPLIEGUE-LOCAL.md) (cómo probarla paso a paso).

## Caja, cobro y comprobante (6a)

La 6a incluye la API, la pantalla **Caja** de la PWA (con la venta de mostrador), Ajustes › Cajas y Ajustes › Emisores, y el ticket. Mientras no esté la 6b, el comprobante queda «por enviar»: **esta sección no se usa con clientes reales sin la 6b**. Para probarla en local, sigue el capítulo 6 de [`docs/guia-de-uso/`](docs/guia-de-uso/06-caja-y-cobro.md) o la sección 5 de [`DESPLIEGUE-LOCAL.md`](DESPLIEGUE-LOCAL.md).

### Qué hace

- **Turno de caja** (HU-25, RF-50, RF-53 a RF-55): se abre con un fondo en efectivo. Una caja tiene un solo turno abierto, y una persona, uno en la sucursal. Los ingresos y egresos de efectivo llevan motivo. El **reporte X** muestra el turno en cualquier momento, sin cerrarlo.
- **Cierre Z a ciegas** (RF-55, HU-30): quien cierra cuenta cada medio de pago sin ver el esperado. Si algún medio no cuadra, el aviso dice solo cuál, sin montos, y pide el motivo de cada uno; la diferencia exacta se ve en la Z ya cerrada. El último turno de la sucursal no se cierra con cuentas abiertas o en pre-cuenta (409 `CIERRE_BLOQUEADO`).
- **Cobro con varios medios** (HU-26, RF-51): efectivo, tarjeta de crédito o débito, Yape y Plin, con su número de operación fuera del efectivo. El efectivo da vuelto, y su total se redondea hacia abajo a la décima a favor del cliente. El servidor recalcula la cuenta con los precios guardados: si cambió desde que el cajero la vio, responde `CUENTA_CAMBIO` y no cobra nada.
- **División de la cuenta** (HU-28, RF-52): por ítems y, después, en partes iguales del saldo. El equipo recuerda en cuántas partes se dividió; desde otro equipo se pide confirmarlo antes de cobrar.
- **Descuentos y cortesías** (HU-03, RF-33): por ítem o por cuenta, en porcentaje (hasta 99.99 %) o en monto. Cada uno pide la clave del supervisor, atada a esa cuenta, ese ítem y ese monto. Las cortesías salen como operación gratuita, con su valor de carta.
- **Venta de mostrador** (HU-18, RF-34): se cobra antes de enviarse a cocina. La comanda lleva un número de llamado («Llamado N»), que empieza en 1 cada día operativo.
- **Comprobante** (HU-26, RF-59, RF-60, RF-61): boleta o factura, detallada o por consumo, con serie y correlativo sin saltos ni duplicados, también con dos cajas cobrando a la vez. El IGV por línea, el ICBPER, los descuentos y los redondeos se calculan en `packages/dominio`. La cuota de comprobantes del plan (RF-05) se consume al emitir.
- **Ticket e impresión** (RF-56, RF-64): el ticket del comprobante lleva un QR. La gaveta se abre al cobrar en efectivo, al abrir el turno con fondo y en cada ingreso o egreso, si la impresora de la caja tiene gaveta. El X y la Z salen en esa impresora. **Imprimir otra vez** saca una copia marcada REIMPRESIÓN, sin abrir la gaveta.

### Configurar una sucursal para cobrar

1. **Tasa de IGV** (Ajustes › Emisores): para cada emisor, la tasa con su fecha «Desde». La da el contador (la general o la reducida que corresponda); no hay valor por defecto. Sin tasa, la caja avisa de que falta y no cobra. No se crea ni se cambia una tasa con una fecha «desde» igual o anterior a la de un comprobante ya emitido por ese emisor. Un emisor del Nuevo RUS no usa tasa.
2. **Cajas y series** (Ajustes › Cajas): crea cada caja con su nombre y, si la tiene, su impresora. Si no tiene, usa la impresora de caja de la sucursal, y si tampoco hay, cobra sin imprimir. Cada caja necesita una serie de boleta (`B` y tres caracteres, por ejemplo `B001`) y otra de factura (`F001`). El primer número se elige solo al crear la serie, para seguir una serie que el RUC ya usó en otro sistema; después, la serie no cambia de número. Una serie no se repite para el mismo emisor, ni en otra caja ni en otra sucursal. Una sucursal tiene hasta 10 cajas activas.
3. **Primeros pasos.** Si falta algo para cobrar, la pantalla Caja lo dice, con una acción por cada paso que falta.
4. **Quién cobra.** El Cajero (con `COBRAR` y `OPERAR_CAJA`), el Supervisor y el Administrador. El Supervisor y el Administrador también cobran en el turno de otra persona; el Cajero, no.

### Orden de los cerrojos

El cobro toma sus cerrojos siempre en el mismo orden, para no cruzarse con los envíos de comanda ni con el cierre (`specs/006-caja-cobro/plan.md`, «Orden de los cerrojos»):

1. Un cerrojo consultivo por el `id` del cobro (la clave lleva la empresa), para que las réplicas simultáneas se turnen.
2. La orden de la cuenta (`FOR UPDATE`).
3. El turno (`FOR SHARE`).
4. El emisor (`FOR SHARE`), al leer su tasa.
5. La serie (`UPDATE … RETURNING`). El número se toma dentro de la misma transacción: una reversión no deja huecos.
6. El consumo de la cuota del plan.

El cierre del turno toma los turnos abiertos de la sucursal con `FOR UPDATE`, en orden de id, y no usa cerrojo consultivo. El cambio de tasa espera a los cobros en curso del emisor hasta 3 segundos y, si no puede, responde 409 `CONFLICTO` sin guardar nada.

### Módulos, tablas y puertos

- **`caja`** es dueño de `caja`, `turno`, `turno_conteo`, `movimiento_caja`, `cobro` y `pago`: cajas, turnos, cobros, reporte X y Z. No lee `orden`, `item`, `serie` ni `comprobante`.
- **`facturacion`** es dueño de `serie`, `comprobante` y `comprobante_linea`: series, numeración y comprobantes. Cada comprobante guarda el detalle calculado de su parte (`detalle_parte`) y no admite cambios de montos. No lee `cobro`.
- **`pedidos`** cambia: `descuento`, `cortesia` y `contador_llamado`, y columnas nuevas en `orden` (lo cobrado) e `item` (lo facturado). No lee nada de caja.
- Además, `plataforma` tiene `emisor_tasa_igv`, `seguridad` tiene la columna `autorizacion.objetivo` e `impresion` suma los tipos de trabajo `COMPROBANTE`, `REPORTE_X`, `REPORTE_Z` y `GAVETA`.

Ningún módulo lee las tablas de otro. Lo que necesita viaja por un servicio o por un puerto:

- **`COBROS`** (definido por `pedidos`, implementado por `caja`): antes de enviar, anular o unir una orden con cobros, `pedidos` pregunta si la cuenta resultante puede seguir cobrándose. Si no, responde 409 `CUENTA_COBRADA_EN_PARTE`.
- **`RegistroImpresoraDeCaja`, `RegistroPagosDeCobro` y `RegistroAlcanceDeTurnos`** (definidos por `facturacion`, registrados por `caja` al arrancar): la impresora de una caja, los pagos de un cobro y el responsable de un turno, para reimprimir y filtrar comprobantes sin leer `caja`.
- **Fecha del último comprobante de un emisor** (puerto de `plataforma`, registrado por `facturacion`): para que cambiar una tasa no toque ventas ya emitidas.

Si un puerto no está registrado, falla cerrado: el cambio se rechaza.

### Para el contador

Estos puntos están en «Preguntas abiertas» de [`specs/006-caja-cobro/spec.md`](specs/006-caja-cobro/spec.md). Si el contador responde otra cosa, cambia una función de `packages/dominio` y sus pruebas protegidas, no la estructura.

- **Pregunta 4, redondeo del efectivo:** el total en efectivo se trunca a la décima a favor del cliente, y los céntimos del resto no se cobran.
- **Pregunta 5, ICBPER:** S/ 0.50 por bolsa desde 2023, en la tabla por fecha de `packages/dominio`.
- **Pregunta 6, tasa de IGV:** la fecha «desde» y el porcentaje los confirma el contador por emisor.
- **Pregunta 7, Nuevo RUS:** boletas sin IGV: el total es el precio, con el ICBPER igual.
- **Pregunta 8, cortesías:** operación gratuita con su valor de carta, en el primer comprobante de la cuenta. No hay cortesías de bolsas.
- **Pregunta 21 (6b):** si el ticket puede salir con el QR antes de que llegue la respuesta del PSE.

La spec también deja al contador el comprobante por consumo y las boletas de más de S/ 700, que piden nombre y documento.

### Límites conocidos

- Un saldo de S/ 0.01 a 0.09 no se puede cobrar en efectivo (en efectivo solo se cobran décimas enteras): se cobra con tarjeta, Yape o Plin.
- Una cuenta con descuento por cuenta y una parte ya cobrada no admite cambios: se cobra el resto y la mesa se abre otra vez.
- El pulso de la gaveta se pierde si el puente está desconectado más de 120 segundos.
- La migración `202611040007-impresion-caja.ts` no se revierte si ya hay trabajos de impresión de caja (`COMPROBANTE`, `GAVETA`, `REPORTE_X` o `REPORTE_Z`): revertir la 6a solo es posible en una base sin esos datos.

### Pruebas

- **Protegidas:** `apps/api/test/caja-critica/` (la API contra PostgreSQL real, con el emulador de impresora donde se mira el papel o la gaveta) y `packages/dominio/test/caja/` (montos). Las de desarrollo están en `apps/api/test/caja/` y `packages/dominio/test/caja-desarrollo/`.
- **E2E:** `apps/app/e2e/caja.spec.ts` recorre el turno, el cobro con dos medios, la división, el descuento con clave, el mostrador, el X y la Z. Corre en dos proyectos de Playwright: `celular` (360 × 740) y `tablet` (768 × 1024). Necesita la base preparada y con la semilla, como las demás E2E de la PWA.

```bash
pnpm --filter @restaurante/dominio test                              # reglas puras de caja
pnpm --filter @restaurante/api exec vitest run test/caja-critica     # pruebas protegidas de caja (necesitan DATABASE_ADMIN_URL)
pnpm --filter @restaurante/app e2e caja.spec.ts                      # E2E de caja, en celular y en tableta
```

## Facturación electrónica (6b)

La 6b envía los comprobantes al PSE por un worker, con sus estados, sus reintentos y su panel; consulta el RUC en el padrón de SUNAT; emite notas de crédito con clave; y guarda el PDF con su enlace. **Todo corre con un PSE simulado (`SimuladorPse`): sus comprobantes no tienen valor tributario hasta que exista el adaptador del PSE real (tarea T34), y sin T34 no se sale a producción.** Para probarla en local, sigue «Modo simulado para demos» más abajo.

### Qué hace

- **Envío al PSE** (RF-57, HU-31): al cobrar, al vender en el mostrador, al emitir una nota de crédito o al «Emitir otro», el envío se registra en la misma transacción que el comprobante y se encola al confirmarla. El worker lo manda en tres pasos: el primero y el último en transacciones cortas, y la llamada al PSE sin ninguna transacción abierta. Un error de transporte o de configuración no es un rechazo: el envío queda pendiente y se reintenta con esperas de 1, 2, 5, 15, 30 y 60 minutos, sin pasar de su plazo. Un rechazo de SUNAT o del PSE es final y nunca se reintenta.
- **Plazo y envíos detenidos**: un envío que llega a su plazo sin respuesta final queda `DETENIDO` y no se reintenta solo; «Reintentar» lo reactiva. El plazo es de 3 días calendario para todos los tipos (valor provisional, pregunta 27).
- **Alertas**: los rechazos, los envíos pendientes más de 30 minutos, los detenidos y los emisores sin configuración de PSE aparecen en `GET /facturacion/alertas` (el superadministrador las ve en `GET /plataforma/facturacion/alertas`), y cada una deja un registro `pse.alerta`. El Supervisor y el Administrador ven un aviso en Caja y en Ajustes.
- **Estado en vivo**: el resultado del cobro muestra «Enviando a SUNAT…», «Aceptado por SUNAT» o «Rechazado: …», y se actualiza con el evento `comprobante.estado`.
- **Panel de comprobantes** (Ajustes › Comprobantes y Caja › Comprobantes): filtros, detalle con sus intentos, «Reintentar» y «Emitir otro». Un rechazado se reemplaza por un comprobante nuevo, con otro número y los datos corregidos; el rechazado conserva su número.
- **Notas de crédito** (HU-29): anulación, devolución de unidades y cambio de boleta por factura, con la clave del supervisor atada a ese comprobante y a ese monto. Solo se acredita un comprobante `ACEPTADO`. La devolución es un egreso del turno, en el medio que se elija, con el redondeo del efectivo, y descuenta del esperado de ese medio en la Z.
- **Padrón de RUC** (HU-27): al cobrar una factura, el RUC se completa con el padrón de SUNAT. Si no está activo, no habido o no existe, lo avisa y deja «Emitir igual».
- **PDF y enlace** (RF-64): cuando SUNAT acepta, el worker arma el PDF y lo guarda en el almacén privado. Se puede ver, compartir por WhatsApp o abrir con un enlace público que vence a los 30 días.
- **Ticket definitivo**: sale al cobrar, sin esperar al PSE, con el QR de los datos que ya se conocen. Un comprobante simulado lleva la leyenda «SIMULADO · SIN VALOR TRIBUTARIO».

### El worker

El worker hace el trabajo lento de la 6b: manda los envíos al PSE, arma los PDF, barre los envíos vencidos o a medias, publica las alertas y carga el padrón cada día. Puede correr de dos formas:

- **Dentro de la API**, con `WORKER=habilitado` en el `.env` de la raíz. La API lo arranca y lo detiene con ella. Es lo más simple en local.
- **Como proceso aparte**, con el mismo código y el mismo `.env`:

  ```bash
  pnpm build:compartidos && pnpm --filter @restaurante/api build   # compila apps/api/dist
  node apps/api/dist/worker.js                                       # desde la raíz; o: pnpm --filter @restaurante/api worker
  ```

  El proceso lee el `.env` de la raíz sin pisar las variables que ya trae el entorno. Exige `DATABASE_COLAS_URL`, `DATABASE_REFERENCIA_URL` y `DATABASE_TIEMPO_REAL_URL`: esta última es la conexión con la que publica sus avisos en vivo, porque no sirve Socket.IO. Se detiene con Ctrl+C.

Cada 60 segundos, el barrido reencola los envíos pendientes cuya espera venció y los PDF que faltan, detiene los que pasaron su plazo y marca las alertas nuevas. La carga del padrón corre todos los días a las 04:00, hora de Lima (`0 4 * * *`). Sin worker no se envía nada: los envíos quedan pendientes en la tabla `envio_pse` y, cuando arranca, el barrido los recoge.

- **En desarrollo, sin `DATABASE_COLAS_URL` la cola es en memoria y nadie la procesa**: los comprobantes se quedan pendientes. Para ver un envío aceptado en local, define `DATABASE_COLAS_URL`, `DATABASE_REFERENCIA_URL` y `WORKER=habilitado`, o arranca el proceso aparte. `.env.example` trae esas líneas comentadas.
- **`pnpm local:preparar` no actualiza un `.env` anterior a la 6b**: solo crea el archivo si falta. Copia desde `.env.example` las variables de 6b que necesites y corre `pnpm db:preparar`, que crea los roles y esquemas nuevos y se puede repetir.

### pg-boss y sus roles

La cola de los envíos y la carga del padrón es **pg-boss**, sobre PostgreSQL (sin Redis). Sus tablas viven en el esquema `colas`, que es de su propio rol, y el padrón vive en `referencia`, de otro:

- **`restaurante_colas`** (`DATABASE_COLAS_URL`; contraseña en `DB_PASSWORD_COLAS`): dueño del esquema `colas` y de nada más. No ve las tablas de `public`. Las colas son `envio-pse` (a lo más un trabajo esperando por comprobante; pg-boss no reintenta por su cuenta, lo deciden los registros de `envio_pse`) y `padron-ruc` (una carga a la vez).
- **`restaurante_referencia`** (`DATABASE_REFERENCIA_URL`; contraseña en `DB_PASSWORD_REFERENCIA`): solo tiene privilegios sobre el esquema `referencia`, donde están el padrón (dos tablas que se alternan, `padron_ruc_a` y `padron_ruc_b`), `padron_estado` y el ubigeo. Solo la usa el worker, para cargar el padrón. La API no la recibe, y el worker comprueba al arrancar que ese rol no pueda saltarse la RLS.

`db:preparar` crea los dos roles y el esquema `colas`. Las contraseñas de desarrollo por defecto valen solo con `NODE_ENV` `development` o `test`.

### Modo de facturación y configuración del PSE

Cada emisor (RUC) tiene un modo de facturación, `SIMULADO` o `REAL` (RF-66). Solo el superadministrador lo configura, con `GET` y `PUT /plataforma/empresas/:empresaId/emisores/:emisorId/pse`, con un cuerpo `{ "modo": "SIMULADO" }` o `{ "modo": "REAL", "credencial": { … } }`. Un emisor sin configuración no envía nada: sus comprobantes quedan en «facturación no activada» (`ERROR_CONFIGURACION`).

- `REAL` exige un `PSE_CONECTOR` distinto de `simulador` (409 `PSE_NO_CONFIGURADO`). De `SIMULADO` a `REAL` solo se pasa si el emisor no ha emitido comprobantes (409 `MODO_PSE_INVALIDO`), y de `REAL` nunca se vuelve a `SIMULADO`.
- Repetir la configuración que ya existe no cambia nada y no deja auditoría. Cada cambio queda en `auditoria` con el modo antes y después y los nombres de los campos de la credencial, nunca sus valores.
- **Credenciales cifradas** (RNF-07): la credencial son de 1 a 5 pares `nombre: valor`, porque cada PSE pide algo distinto. Se guarda cifrada con AES-256-GCM y `CLAVE_CIFRADO`, atada a su empresa y a su emisor: copiada a otro emisor no se puede abrir. Ninguna respuesta, evento, auditoría ni registro la muestra. `credencial: null` la borra; no enviar el campo la conserva. Si una credencial guardada no se puede abrir, sus envíos terminan en `ERROR_CONFIGURACION`.
- **Rotar `CLAVE_CIFRADO`**: pon la clave nueva en `CLAVE_CIFRADO` y la anterior en `CLAVE_CIFRADO_ANTERIOR`. Lo cifrado con la anterior se sigue abriendo, y lo que se guarde desde entonces va con la nueva. No hay una herramienta que recifre todo de una vez: cada credencial pasa a la clave nueva cuando el superadministrador la vuelve a guardar, así que `CLAVE_CIFRADO_ANTERIOR` debe quedarse mientras quede alguna. Para generar una clave: `openssl rand -base64 32`.

### Modo simulado para demos

La semilla (`pnpm db:semilla`) **no** configura el PSE de sus empresas de demostración: hay que pasar cada emisor a `SIMULADO`. Con la API en marcha, como superadministrador:

```bash
# 1. Ingreso del superadministrador de la semilla (el token sa.… vale 8 horas)
curl -s -X POST http://localhost:3000/plataforma/sesiones \
  -H 'Content-Type: application/json' \
  -d '{"usuario":"superadmin","contrasena":"Superadmin-Demo-1"}'

# 2. Pasa un emisor a SIMULADO (el id del emisor está en "emisores" de GET /plataforma/empresas/:empresaId)
curl -s -X PUT "http://localhost:3000/plataforma/empresas/$EMPRESA_ID/emisores/$EMISOR_ID/pse" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"modo":"SIMULADO"}'
```

La respuesta trae `modo`, `conector` (vacío en `SIMULADO`), `credencialConfigurada` y `camposCredencial`, nunca los valores. Los comprobantes emitidos en modo simulado llevan la marca `simulado` para siempre, y la PWA avisa de que la sucursal factura en modo simulado. `Superadmin-Demo-1` es la contraseña de la base de desarrollo; en otra base, usa la que pusiste con `pnpm plataforma:superadmin`.

### Padrón de RUC

- **Consulta:** `GET /padron/ruc/:ruc` (permiso `COBRAR` y módulo `FACTURACION`). La PWA la usa al cobrar una factura y al cambiar una boleta por factura.
- **Carga:** cada día a las 04:00 (hora de Lima) y a pedido con `POST /plataforma/padron/carga`, que responde 202 y encola la carga (una a la vez). `GET /plataforma/padron` dice cuándo se cargó, cuántas filas tiene, la fecha del archivo y el último error.
- **Cómo:** el worker baja el ZIP de `PADRON_RUC_URL` en flujo, lo descomprime sin guardarlo entero y lo inserta en la tabla que no está activa. Al terminar, cambia la tabla activa solo si tiene al menos el 90 % de las filas de la carga anterior; si no, conserva la anterior y deja el error. El catálogo de ubigeo sale de `apps/api/datos/ubigeo.csv` (INEI).
- **Medición** (`specs/006-caja-cobro/plan.md`, pregunta 36): con el archivo real (376 MiB, 18 513 202 filas) y PostgreSQL 16 local, la carga tardó unos **3.5 minutos** (217 s desde el ZIP en disco y 206 s descargándolo). Las dos tablas juntas ocupan unos **5 GB** (1 797 MB de datos y 2 539 MB con el índice cada una), más el WAL de la carga. **Esta medición es de una base local: hay que repetirla en la base administrada del plan elegido** (espacio, tiempo y red) antes de producción. Si no cabe, el plan B es no cargar las bajas definitivas o las de oficio, con el aviso «no figura» en lugar de «baja».
- **Demos y E2E:** `PADRON_RUC_URL=file:///<ruta absoluta>/apps/api/test/soporte/padron-ejemplo.zip`, con 7 RUC de ejemplo, entre ellos uno de baja de oficio y no habido.

### Almacén privado de comprobantes y enlace público

Los XML, los CDR y los PDF de los comprobantes van a un almacén **privado**, aparte del de las fotos:

- `ARCHIVOS_DRIVER` elige el almacén: `memoria` (pruebas); `disco` (solo con `NODE_ENV=development`, en `ARCHIVOS_COMPROBANTES_DIRECTORIO`, por defecto `./archivos-privados`, que la API nunca sirve y que no puede estar dentro de `ARCHIVOS_DIRECTORIO`); o `r2` (producción, en `R2_BUCKET_COMPROBANTES`, un bucket distinto de `R2_BUCKET`, el de las fotos, y privado). Las claves son fijas por comprobante, así que reintentar un guardado no duplica nada.
- El PDF se descarga con `GET /facturacion/comprobantes/:id/pdf`. El enlace para compartir es `GET /facturacion/comprobantes/:id/enlace`, que responde `{ url, expiraEn }` con `url` = `<API_URL_PUBLICA>/publico/comprobantes/<sello>`. Sin PDF (el comprobante no está aceptado), responde 409 `PDF_NO_DISPONIBLE`.
- El **sello** lleva el `empresaId`, el `comprobanteId` y la fecha de vencimiento, cifrados con `CLAVE_CIFRADO` (AES-256-GCM, en base64url): no se puede adivinar ni fabricar, y no deja ver los ids. Vence a los 30 días. **No se guarda, así que no se revoca antes de vencer.** `GET /publico/comprobantes/:sello` no pide sesión; un sello alterado, vencido o de un comprobante sin PDF responde 404 igual, y no hay listado.

### E2E y simulador

`apps/app/e2e/facturacion.spec.ts` recorre la facturación de punta a punta, en celular y en tableta, contra una API distinta a la de `pnpm dev`: la de `apps/app/e2e/soporte/api-con-simulador.cjs`, que es la API compilada con un `SimuladorPse` cuyas reglas se mueven por el puerto de control (`E2E_PSE_CONTROL_PUERTO`, 3100 por defecto). Necesita en el `.env` `DATABASE_COLAS_URL`, `DATABASE_REFERENCIA_URL`, `WORKER=habilitado`, `CLAVE_CIFRADO`, `PADRON_RUC_URL` (el padrón de ejemplo) y `API_URL_PUBLICA` igual a la de la API de la prueba. Si ya hay una API en el puerto 3000 (por ejemplo, con `pnpm dev`), Playwright la reutiliza y la prueba no sirve: párala antes. Detalles en [`apps/app/README.md`](apps/app/README.md).

### Límites conocidos (6b)

- **Sin T34 no se sale a producción.** Sin adaptador real, los emisores solo facturan en `SIMULADO`, y el `PUT` a `REAL` responde 409 `PSE_NO_CONFIGURADO` mientras `PSE_CONECTOR` sea `simulador`.
- **No definas `PSE_CONECTOR` con otro valor hasta T34.** La API no comprueba que exista un adaptador con ese código: el `PUT` a `REAL` lo acepta y el envío sigue llamando al simulador, que responde como si fuera SUNAT. T34 debe separar el conector por modo (`RegistroDeConectores.para`).
- **Sin comunicación de baja ni resumen diario.** Un comprobante aceptado se anula con nota de crédito. Si el PSE elegido exige bajas o resúmenes, se agregan con T34 (pregunta 33).
- **Las notas de crédito solo acreditan comprobantes `ACEPTADO`** (pregunta 28): una devolución el mismo día de la venta espera a que SUNAT la acepte.
- **Las alertas son registros y el panel.** No hay correo ni monitoreo (pregunta 37): alguien tiene que mirarlos.
- **El enlace público no se revoca** antes de vencer (30 días).
- **El padrón ocupa unos 5 GB** y su carga no está medida en la base administrada (ver «Padrón de RUC»).

### Para el contador (6b)

Las preguntas siguen en «Preguntas abiertas» de [`specs/006-caja-cobro/spec.md`](specs/006-caja-cobro/spec.md):

- **Pregunta 21:** el ticket sale al cobrar, sin esperar al PSE, con el QR de los datos conocidos. Si el contador exige el `hash` en la representación impresa, se cambia a imprimir al aceptar (plan aparte).
- **Pregunta 27:** plazos de envío por tipo de documento. Hoy, 3 días calendario para todos (valor provisional en `PLAZOS_ENVIO_DIAS`, `packages/dominio/src/caja/envios.ts`).
- **Pregunta 29:** devolución en efectivo: se trunca a la décima, como el cobro, y la diferencia (hasta S/ 0.09) queda a la vista como redondeo.
- **Pregunta 38:** códigos de afectación de las cortesías en el documento al PSE: `15` (gravado), `21` (exonerado) y `31` (inafecto), en `packages/dominio/src/caja/sunat.ts`.

Las preguntas 27 y 38 son las marcadas para el contador; la 21 y la 29 también se validan con él. Si cambian, se toca `packages/dominio` y sus pruebas protegidas, no la estructura.

### Pruebas (6b)

- **Protegidas:** `apps/api/test/facturacion-critica/` (la API contra PostgreSQL real, con el simulador y el envío llamado a mano), `packages/dominio/test/caja/envios.spec.ts` y `notas-credito.spec.ts` (reglas puras), y `apps/app/test/nota-credito-ataque*.spec.tsx` (la hoja de la nota de crédito, rondas 2 a 9). El detalle, con los criterios de cada una, está en [`apps/api/test/README.md`](apps/api/test/README.md).
- **E2E:** `apps/app/e2e/facturacion.spec.ts`, en celular y tableta (ver «E2E y simulador»).

```bash
pnpm --filter @restaurante/dominio test                                   # reglas puras de caja, también de 6b
pnpm --filter @restaurante/api exec vitest run test/facturacion-critica   # pruebas protegidas de 6b (necesitan DATABASE_ADMIN_URL)
pnpm --filter @restaurante/app test nota-credito-ataque                    # hoja de la nota de crédito, rondas 2 a 9
pnpm --filter @restaurante/app e2e facturacion.spec.ts                     # E2E de facturación, en celular y en tableta
```

## Pruebas

Las pruebas de la API son de integración contra PostgreSQL real, sin mocks de la base. Necesitan
`DATABASE_ADMIN_URL`; sin ella **fallan** con un mensaje claro (no se saltan):

```bash
export DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm test
pnpm --filter @restaurante/api exec vitest run test/aislamiento/rls-sql.spec.ts   # un archivo
```

Con la vía Docker (`pnpm local:preparar`, PostgreSQL en el puerto 5433) el administrador es
`DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5433/postgres`, el mismo valor que trae
`.env.example`; el puerto 5432 del ejemplo de arriba es el de un PostgreSQL instalado aparte.

Cada ejecución recrea la base `restaurante_test` y le aplica las migraciones (no toca `restaurante`).
Las pruebas protegidas de aislamiento viven en `apps/api/test/aislamiento/`; los detalles de las
utilidades están en `apps/api/test/README.md`. Las pruebas de `packages/*` no usan base de datos.

## Variables de entorno

| Variable                                                                 | Uso                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | Conexión de la API (`restaurante_api`); su base es también la que usan por defecto `db:preparar` y `db:migrar`                                                                                                                                                                                                                                                                                                   |
| `DATABASE_PLATAFORMA_URL`                                                | Conexión de plataforma (`restaurante_plataforma`)                                                                                                                                                                                                                                                                                                                                                                |
| `DATABASE_MIGRADOR_URL`                                                  | Migraciones (`restaurante_migrador`); si falta se deriva del admin                                                                                                                                                                                                                                                                                                                                               |
| `DATABASE_TIEMPO_REAL_URL`                                               | Conexión del adaptador de Socket.IO, con el rol `restaurante_tiempo_real`; obligatoria con `TIEMPO_REAL=habilitado`                                                                                                                                                                                                                                                                                              |
| `DATABASE_ADMIN_URL`                                                     | Solo `db:preparar` y las pruebas: administrador de PostgreSQL; su base es la de mantenimiento; `sslmode` en producción                                                                                                                                                                                                                                                                                           |
| `DB_PASSWORD_MIGRADOR`, `DB_PASSWORD_API`, `DB_PASSWORD_PLATAFORMA`      | Contraseñas que `db:preparar` asigna a los roles; obligatorias salvo con `NODE_ENV` `development` o `test`                                                                                                                                                                                                                                                                                                       |
| `DB_PASSWORD_TIEMPO_REAL`                                                | Contraseña que `db:preparar` asigna al rol `restaurante_tiempo_real`; obligatoria salvo con `NODE_ENV` `development` o `test`                                                                                                                                                                                                                                                                                    |
| `DB_PROTECCION_CATALOGO`                                                 | Solo `db:preparar`. `omitir`: sin superusuario, omite las protecciones del catálogo y avisa (producción); otro valor es un error                                                                                                                                                                                                                                                                                 |
| `DB_POOL_MAX`                                                            | Tamaño del pool de la API (por defecto 10)                                                                                                                                                                                                                                                                                                                                                                       |
| `TIEMPO_REAL`                                                            | `habilitado` o `deshabilitado`: enciende o apaga el servidor de Socket.IO (`/tiempo-real`). Por defecto `habilitado`, salvo con `NODE_ENV=test`                                                                                                                                                                                                                                                                  |
| `API_URL_PUBLICA`                                                        | URL pública de la API, sin barra final: va en el QR de vinculación del puente de impresión (`restaurante-puente://vincular?api=<URL>&t=<código>`). Con `development` y `test` vale `http://localhost:<PORT>` si falta; en producción hay que definirla; sin ella, crear un código de vinculación responde 503 `CONFIGURACION_INCOMPLETA`. También es la base del enlace público del PDF de cada comprobante (6b) |
| `CARTA_WEB_URL`                                                          | URL base de la carta web (`apps/web`), sin barra final: la de los QR (`<CARTA_WEB_URL>/m/<código>`). Con `development` y `test` vale `http://localhost:3001`; en producción hay que definirla (ver «Carta web y llamados (5a)»)                                                                                                                                                                                  |
| `CABECERA_IP_CLIENTE`                                                    | Cabecera con la IP real del cliente para el límite de llamados por conexión (la IP nunca se guarda). Detrás de Cloudflare, `cf-connecting-ip`; sin un proxy de confianza delante, no la definas (ver «Carta web y llamados (5a)»)                                                                                                                                                                                |
| `IMAGENES_PERMITIR_IP_LOCAL`                                             | Solo para `apps/web` (desarrollo, E2E y la imagen de Docker de la carta, que la toma de este `.env`): `1` deja que Next optimice fotos de `localhost`. Con `CARTA_WEB_URL` o `ARCHIVOS_URL_PUBLICA` que no sean `localhost`, la carta web no construye (ver «Carta web y pedido desde la mesa (5b)»)                                                                                                             |
| `EMPRESA_POR_HEADER`                                                     | **Solo pruebas.** `habilitado` con `NODE_ENV=test` da un principal de prueba (Administrador, actor `prueba`) a las peticiones sin `Authorization` con `x-empresa-id`; la API se niega a arrancar con él en `development` y en `production`. No lo pongas en tu `.env`                                                                                                                                            |
| `PIN_PEPPER`                                                             | Secreto (base64, 32 bytes o más) con el que se calcula la huella de los PIN. Obligatoria en producción; con `development` o `test` hay un valor local. **Cambiarla invalida todos los PIN** (y las claves de idempotencia de las últimas 24 horas, cuya huella también se calcula con HMAC y una clave derivada de ella); nunca va en la base ni en los respaldos                                                |
| `ORIGENES_PERMITIDOS`                                                    | Orígenes de la PWA permitidos por CORS, separados por coma, sin ruta ni barra final. Obligatoria en producción (por defecto local: `http://localhost:5173`)                                                                                                                                                                                                                                                      |
| `SUPERADMIN_CONTRASENA`                                                  | Solo para automatizar `pnpm plataforma:superadmin crear` y `db:semilla`: la contraseña del superadministrador (nunca como argumento)                                                                                                                                                                                                                                                                             |
| `NODE_ENV`                                                               | Obligatoria, sin valor por defecto: `development`, `test` o `production`                                                                                                                                                                                                                                                                                                                                         |
| `PORT`                                                                   | Puerto de la API (por defecto 3000)                                                                                                                                                                                                                                                                                                                                                                              |
| `ARCHIVOS_DRIVER`                                                        | Dónde se guardan las fotos de la carta (y, con 6b, el almacén privado de los comprobantes; ver «Facturación electrónica (6b)»): `memoria` (pruebas), `disco` (solo `NODE_ENV=development`; la API sirve la carpeta en `/archivos/*`) o `r2` (Cloudflare R2). Por defecto `disco` en desarrollo y `memoria` en pruebas; **en producción es obligatorio `r2`**                                                     |
| `ARCHIVOS_DIRECTORIO`, `ARCHIVOS_URL_PUBLICA`                            | Carpeta del almacén en disco (por defecto `./archivos`, ignorada por git) y URL base pública de los archivos (con `disco`, por defecto `http://localhost:<PORT>/archivos`; con `r2`, el dominio público del bucket y obligatoria)                                                                                                                                                                                |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Credenciales del bucket de R2; obligatorias con `ARCHIVOS_DRIVER=r2`. El token debe tener permiso solo sobre ese bucket                                                                                                                                                                                                                                                                                          |
| `PSE_CONECTOR`                                                           | `simulador` (por defecto fuera de producción) o el código del adaptador del PSE real (T34); obligatoria en producción. **Déjala en `simulador` hasta T34** (ver «Límites conocidos (6b)»)                                                                                                                                                                                                                        |
| `PSE_TIMEOUT_MS`                                                         | Tiempo máximo de cada llamada al PSE, en milisegundos (por defecto 30000; de 1000 a 120000). De él sale el arriendo de cada envío: el tiempo que un worker lo tiene tomado mientras llama al PSE y guarda el resultado                                                                                                                                                                                           |
| `CLAVE_CIFRADO`                                                          | Clave maestra (base64, 32 bytes o más; `openssl rand -base64 32`) de las credenciales del PSE y de los enlaces de los comprobantes. Con `development` y `test` hay una fija; en producción es obligatoria                                                                                                                                                                                                        |
| `CLAVE_CIFRADO_ANTERIOR`                                                 | La clave anterior, solo para abrir lo cifrado mientras se rota `CLAVE_CIFRADO`. Nunca cifra                                                                                                                                                                                                                                                                                                                      |
| `DATABASE_COLAS_URL`                                                     | Conexión de la cola pg-boss, con el rol `restaurante_colas` (esquema `colas`). Obligatoria en producción y para el worker; sin ella, la cola es en memoria y nadie la procesa                                                                                                                                                                                                                                    |
| `DATABASE_REFERENCIA_URL`                                                | Conexión de la carga del padrón de RUC, con el rol `restaurante_referencia` (esquema `referencia`). La usa solo el worker                                                                                                                                                                                                                                                                                        |
| `DB_PASSWORD_COLAS`, `DB_PASSWORD_REFERENCIA`                            | Contraseñas que `db:preparar` asigna a esos dos roles; obligatorias salvo con `NODE_ENV` `development` o `test`                                                                                                                                                                                                                                                                                                  |
| `WORKER`                                                                 | `habilitado` arranca el worker de envíos dentro de la API; `deshabilitado` por defecto, y siempre así con `NODE_ENV=test`. El worker también corre como proceso aparte (`node apps/api/dist/worker.js`)                                                                                                                                                                                                          |
| `PADRON_RUC_URL`                                                         | Dirección del padrón reducido de RUC de SUNAT (`https://…`, o `file://…` con una ruta absoluta para las demos). Por defecto, la pública de SUNAT                                                                                                                                                                                                                                                                 |
| `R2_BUCKET_COMPROBANTES`                                                 | Bucket **privado** de los XML, CDR y PDF de los comprobantes, con `ARCHIVOS_DRIVER=r2`; distinto de `R2_BUCKET`                                                                                                                                                                                                                                                                                                  |
| `ARCHIVOS_COMPROBANTES_DIRECTORIO`                                       | Carpeta del almacén privado de comprobantes con `disco` (solo desarrollo; por defecto `./archivos-privados`). La API nunca la sirve                                                                                                                                                                                                                                                                              |

El tiempo real tiene su propio rol de PostgreSQL, `restaurante_tiempo_real`, sin privilegios sobre las tablas de `public`, sin `BYPASSRLS` y sin membresías. Su tabla auxiliar de Socket.IO vive en el esquema `tiempo_real`, al que solo ese rol tiene acceso, y `db:preparar` lo crea de forma idempotente. Si tu `.env` es anterior a la 3a, `pnpm local:preparar` no lo reescribe: copia desde `.env.example` las tres variables de tiempo real. Sin `DATABASE_TIEMPO_REAL_URL`, la API no arranca con el tiempo real habilitado.

### Ver las fotos de la carta en desarrollo

Con `NODE_ENV=development` (el valor de `.env.example`), `ARCHIVOS_DRIVER` vale `disco` por defecto: la API guarda las fotos en `ARCHIVOS_DIRECTORIO` (`./archivos`, dentro de `apps/api`, que git ignora) y las sirve en `http://localhost:3000/archivos/*`, en la dirección de `ARCHIVOS_URL_PUBLICA`. La PWA usa la URL que la API da en cada producto (`fotoUrl`), así que con `pnpm dev` basta para verlas. Con `memoria` (pruebas) no se ven, y en producción las fotos van a Cloudflare R2. Detalles en [`apps/app/README.md`](apps/app/README.md#ver-las-fotos-de-los-productos-en-desarrollo).

## Aislamiento entre empresas: reglas para quien programa

Una empresa nunca ve datos de otra. La garantía la da PostgreSQL (RLS) y la refuerza la API.

- **Tres roles de base de datos**, ninguno superusuario ni con `BYPASSRLS`: `restaurante_migrador`
  (dueño de las tablas, solo migraciones), `restaurante_api` (la API, sujeta a RLS) y
  `restaurante_plataforma` (operaciones de plataforma, con sus propias políticas). La API se niega
  a arrancar si su conexión usa un rol superusuario, con `BYPASSRLS` o dueño de tablas, o que sea
  miembro (directo o transitivo, con `INHERIT` o `NOINHERIT`) de `restaurante_migrador`, del dueño de
  una tabla o de un rol así; el error nombra el rol de conexión y la membresía que lo impide.
- **Contexto de empresa.** Cada petición con empresa corre en una transacción cuya primera sentencia
  es `SELECT fijar_contexto_empresa($1)`. Esa función de la base escribe la empresa en
  `contexto.sesion_empresa` (esquema interno, sin acceso para los roles de la aplicación), atada a la
  sesión y a la transacción, **una sola vez por transacción**: una segunda fijación falla con `42501`
  `contexto de empresa ya fijado`, aunque sea la misma empresa. La RLS lee la empresa con
  `empresa_actual()` desde esa tabla; `app.empresa_id` queda solo como copia para diagnóstico y ningún
  `set_config` cambia lo que ve la RLS (criterio 22e; lo crea una migración y no requiere
  superusuario). El servicio `ContextoEmpresa`
  (`apps/api/src/nucleo/contexto-empresa/contexto-empresa.ts`) y `apps/api/src/nucleo/fijar-contexto.ts`
  (que define el nombre de la función y `SQL_FIJAR_CONTEXTO`, sin dependencias de Nest) son los únicos
  archivos que escriben `fijar_contexto_empresa` y `app.empresa_id` (regla de ESLint, también si el texto se arma con `+`,
  plantillas, `.concat()` o `.join()` de literales; las migraciones están exentas). Sin contexto,
  cualquier consulta de la API, incluso cruda, lanza `ContextoEmpresaAusenteError` antes de llegar a la
  base. Dentro de `ContextoEmpresa.ejecutar`, `fn` no puede controlar la transacción por SQL: `COMMIT`,
  `ROLLBACK`, `END`, `ABORT`, `SAVEPOINT`, `RELEASE`, `BEGIN`, `START TRANSACTION`,
  `PREPARE TRANSACTION` y similares (también entre varias sentencias o tras comentarios) lanzan
  `ConsultaProhibidaError` antes de llegar a la base; un literal con ese texto (o con `set_config`,
  `SET`, `;`…) en un valor sí se guarda, porque el rechazo se decide sobre el texto sin literales ni
  comentarios. Tampoco sirven las transacciones anidadas de Sequelize (usan `SAVEPOINT`): `ejecutar`
  confirma o revierte todo al terminar `fn`. Solo la transacción que abre `ejecutar` cuando no hay
  contexto vigente queda autorizada: otra transacción de la API abierta desde `fn`
  (`sequelize.transaction()`), aunque fije una empresa a mano, lanza error en cada consulta
  (criterio 22c). El texto SQL que fija la empresa (`SQL_FIJAR_CONTEXTO`, de `nucleo/fijar-contexto.ts`) y el registro de
  transacciones por autorizar no se pueden usar fuera de `apps/api/src/nucleo/` (regla de ESLint).
  Además, dentro del contexto solo pasan sentencias cuya primera palabra (en cada sentencia de un
  texto con varias, tras quitar comentarios) es `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`,
  `VALUES` o `TABLE`: `LISTEN`, `COPY`, `DECLARE`, `EXPLAIN`, `SHOW`, `CREATE`… lanzan
  `ConsultaProhibidaError` antes de la base (lista blanca, criterio 22d), y se rechaza toda mención,
  fuera de literales y comentarios, de los nombres y prefijos de la lista del criterio 38e (`set_config`,
  `fijar_contexto_empresa`, `pg_stat_activity`, `lo_*`…; ver la sección de producción sin superusuario).
- **Después de `ejecutar` no queda contexto.** Un efecto secundario lanzado desde `fn` (imprimir, PSE,
  avisos en tiempo real) corre después de confirmar y hereda el almacén asíncrono de la petición, pero
  ya sin contexto: `empresaActual()` y los servicios de empresa lanzan `ContextoEmpresaAusenteError`.
  Si necesita leer o escribir datos de la empresa, abre su propio `ContextoEmpresa.ejecutar(empresaId,
…)` (con la misma empresa o con otra); y puede llamar `OperacionPlataforma`. Lo mismo vale tras una
  `OperacionPlataforma.ejecutar` o `consultar` terminada (criterio 27b).
- **Fuera de HTTP** (colas pg-boss, WebSockets, tareas programadas): envuelve siempre el trabajo en
  `ContextoEmpresa.ejecutar(empresaId, async () => { … })`. Sin eso, los servicios y modelos de
  empresa fallan. No lances efectos secundarios (imprimir, PSE, avisos) dentro de esa transacción: se
  registran dentro y se ejecutan después de confirmar.
- **Operaciones de plataforma** (alta de empresas, solo el superadministrador): únicamente por
  `OperacionPlataforma.ejecutar({ actor, motivo, operacion }, fn)` o `PlataformaEmpresasService`.
  Corren con `restaurante_plataforma`, dejan una fila inmutable en `auditoria` (con `origen = 'plataforma'`; la
  tabla `auditoria_plataforma` de la historia 001 se unió a `auditoria`) en la misma
  transacción, fijan su actor (un texto de sistema como `semilla` o `cli:superadmin`, o
  `{ superadministradorId }` en las rutas HTTP) y no pueden anidarse con un contexto de empresa. Solo `src/modulos/plataforma/` puede
  importar la conexión de plataforma (regla de ESLint, que también ve `import()`, `require`,
  `import x = require()` y los reexportes, en archivos `.ts`, `.tsx`, `.mts` y `.cts`). `fn` no puede
  confirmar ni revertir la transacción (`commit()`, `rollback()` o SQL `COMMIT`/`ROLLBACK`/`END`/
  `ABORT`/`SAVEPOINT`…): la operación falla y no queda nada; `consultar` es de solo lectura.
- **Entradas.** Los textos de `packages/contratos` (`textoSchema`, y `actor`/`motivo` de plataforma)
  rechazan el carácter NUL (U+0000) y los sustitutos UTF-16 sin pareja (un par válido, como un emoji, se
  acepta); cualquier cuerpo de petición de más de 100 KB responde 413 `CUERPO_DEMASIADO_GRANDE`, y un
  JSON mal formado responde 400 `DATOS_INVALIDOS` con un mensaje fijo, sin el texto del analizador.
- **Errores 4xx.** Todo error HTTP 4xx (de un guard, pipe, interceptor, controlador, de la ruta
  inexistente o del analizador de cuerpos, como el 415 por un charset o `Content-Encoding` no
  soportado) conserva su estado y responde `{ codigo, mensaje }` con un mensaje fijo por código que no
  repite la ruta, el método ni el texto de la excepción: 401 `NO_AUTENTICADO`, 403 `PROHIBIDO`, 404
  `NO_ENCONTRADO`, 405 `METODO_NO_PERMITIDO`, 415 `TIPO_NO_SOPORTADO`, 429 `DEMASIADAS_PETICIONES` y los
  demás `PETICION_INVALIDA`. Los errores propios (`EMPRESA_NO_RESUELTA`, `EMISOR_INVALIDO`…), 400, 409
  y 413 siguen igual; solo lo no controlado responde 500 `ERROR_INTERNO`. Los códigos están en
  `CODIGOS_ERROR` de `packages/contratos`.
- **Quién resuelve la empresa de la petición.** La sesión: `AutenticacionGuard` (global) valida el token
  `se.<empresa>.<sesión>.<secreto>`, y el resolutor `ResolutorEmpresaSesion` (token `RESOLUTOR_EMPRESA`)
  toma de ella la empresa y el actor. Una ruta sin `@Publica()` ni `@Superadministrador()` exige sesión
  (una ruta nueva sin decorador queda cerrada). La cabecera `x-empresa-id` ya no cuenta: solo con
  `NODE_ENV=test` y `EMPRESA_POR_HEADER=habilitado` y sin `Authorization`, para las pruebas. Una ruta que
  no pertenece a ninguna empresa se marca `@SinEmpresa()` (por ejemplo `@Publica()` la implica).

## Sesión, superadministrador y datos de demostración

- **Ingreso.** `POST /sesiones/contrasena` con `{ usuario, contrasena }` devuelve `{ token, sesion }`; el
  token va en `Authorization: Bearer …`. El nombre de usuario es único en todo el sistema (no se pide la
  empresa). 5 fallos seguidos bloquean la cuenta 15 minutos (429 `BLOQUEO_TEMPORAL`); la sesión se cierra
  a los 30 minutos sin peticiones y a las 12 horas. Los usuarios nuevos tienen una contraseña temporal
  y deben cambiarla (`PUT /sesion/contrasena`) antes de usar el resto de rutas.
- **Superadministrador** (nuestro personal; entra a todas las empresas por `/plataforma/*` y da soporte).
  Solo se crea, se desactiva y se desbloquea con el script, no hay ruta HTTP:

  ```bash
  pnpm plataforma:superadmin crear <usuario> "<nombre>"   # pide la contraseña por la entrada estándar
  pnpm plataforma:superadmin desactivar <usuario>         # cierra sus sesiones y las de soporte
  pnpm plataforma:superadmin desbloquear <usuario>        # levanta el bloqueo de 15 minutos por 5 fallos seguidos
  ```

  La contraseña nunca va como argumento: se escribe cuando el script la pide, o se pasa por
  `SUPERADMIN_CONTRASENA` (para automatizar). Entra con `POST /plataforma/sesiones` (token `sa.…`, 8
  horas) y da de alta empresas con `POST /plataforma/empresas`, que crea también a su primer
  Administrador (el PIN se muestra una sola vez). `POST /plataforma/empresas/:id/soporte` abre una sesión
  de soporte (permisos de Administrador, 2 horas, siempre auditada). `desbloquear` deja la fila de
  auditoría `desbloquear_superadministrador` (actor `cli:superadmin`, sin empresa).

- **`pnpm db:semilla`** crea el superadministrador `superadmin` (contraseña `Superadmin-Demo-1` o la de
  `SUPERADMIN_CONTRASENA`) y dos empresas de demostración con un usuario por rol (`fogon.admin`,
  `fogon.supervisor`, `fogon.cajero`, `fogon.mozo`, `fogon.cocina` con un horario de ejemplo,
  `marea.admin`, `marea.cajero`, `marea.mozo`), todos con la contraseña temporal `Temporal-Demo-1`;
  imprime sus PIN, que solo se conocen al crearlos. Es idempotente y se niega a correr con
  `NODE_ENV=production`: son datos y contraseñas públicas de demostración.
  ```bash
  curl -s -X POST localhost:3000/sesiones/contrasena -H 'content-type: application/json' \
    -d '{"usuario":"fogon.cajero","contrasena":"Temporal-Demo-1"}'
  curl -s localhost:3000/sesion -H "Authorization: Bearer <token>"
  ```
- **Secretos.** Las contraseñas se guardan con scrypt, los PIN con HMAC-SHA256 y `PIN_PEPPER`, y los
  secretos de sesión con SHA-256: nada secreto está en claro en la base, en la auditoría ni en el registro.
- **Concurrencia del scrypt.** Todo scrypt de ingreso del proceso pasa por `CupoScrypt` (reparto justo
  entre empresas; lo que no entra a tiempo responde 429 de 1 s). Su capacidad es
  `max(1, min(UV_THREADPOOL_SIZE - 1, núcleos - 1))`, con `UV_THREADPOOL_SIZE` en 4 si no está definida:
  con 4 hilos y 4 núcleos son 3 cupos, y **con 2 núcleos o menos baja a 1** (sirve un ingreso a la vez por
  proceso). Al dimensionar un servidor, sube los dos (`UV_THREADPOOL_SIZE` debe fijarse antes de arrancar
  Node) y recuerda que cada réplica de la API lleva su propio cupo.
- **Idempotencia.** Las escrituras marcadas `@Idempotente()` (`POST /emisores`, `POST /sucursales`, `POST /plataforma/empresas`, las de
  `/plataforma/empresas/:id/emisores` y `/sucursales`, los pagos de suscripción y `POST /autorizaciones`) aceptan la
  cabecera `Idempotency-Key` (un UUID): repetir la petición con la misma clave y el mismo cuerpo devuelve la
  misma respuesta sin repetir el efecto; la misma clave con otro cuerpo, ruta o usuario responde 422
  `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Las claves se guardan 24 horas, por empresa.

### Convención para una tabla nueva con datos de clientes

Cada migración que crea una tabla de empresa debe, en la misma migración:

1. Llevar `empresa_id uuid NOT NULL REFERENCES empresa (id)` y un índice por `empresa_id`.
2. Llamar a `sqlTablaDeEmpresaTrazable(nombre, opciones)`
   (`apps/api/src/migraciones/sql-tabla-de-empresa.ts`; ver "Convención de trazabilidad" más abajo): es
   `sqlTablaDeEmpresa(nombre, { privilegiosApi, privilegiosPlataforma? })` más las columnas de autor. Activa **y fuerza** la RLS, crea la política
   `aislamiento_empresa` con `empresa_actual()` en `USING` y `WITH CHECK`, y concede los privilegios
   explícitos. Nunca `TRUNCATE`, `REFERENCES` ni `TRIGGER` (`TRUNCATE` ignora la RLS).
3. Si otra tabla de empresa la referencia, usar llaves foráneas **compuestas** que incluyan
   `empresa_id` (con un `UNIQUE (id, empresa_id)` en la tabla referenciada): las comprobaciones de
   llave foránea ignoran la RLS.

La prueba de catálogo (`apps/api/test/aislamiento/catalogo.spec.ts`) recorre las tablas de `public`
en cada ejecución: una tabla nueva sin RLS, sin política o con privilegios de más hace fallar la suite.

### Convención de trazabilidad (historia 002, criterios 113 a 120)

Toda tabla con datos de clientes guarda **quién la creó y quién la cambió por última vez** (usuario y
equipo, superadministrador o actor de sistema). Lo llena la base, nunca el cuerpo de la petición:

- La migración que crea la tabla usa `sqlTablaDeEmpresaTrazable(nombre, opciones)` en lugar de
  `sqlTablaDeEmpresa`: es lo mismo más las columnas `creado_por_*` y `actualizado_por_*`, sus `CHECK`, las
  llaves compuestas hacia `usuario` y `equipo` (estas últimas con `llaveDeEquipo: true`, obligatorio en toda
  tabla creada después de la migración de equipos) y el trigger `trazabilidad`. Las únicas excepciones son
  `auditoria`, `sesion`, `bloqueo_intentos` e `idempotencia`; la prueba de catálogo
  (`apps/api/test/acceso/catalogo-trazabilidad.spec.ts`) falla si una tabla nueva no cumple.
- Toda escritura corre con un **actor fijado** en la transacción (`fijar_contexto_actor`, una sola vez, como
  la empresa): sin actor, la escritura falla con `42501` "contexto de actor ausente". En las peticiones lo
  fija el interceptor de contexto con el actor de la sesión; en un script, la semilla o una tarea del worker
  hay que pasarlo: `ContextoEmpresa.ejecutar(empresaId, fn, { actor: { sistema: 'worker:mi-tarea' } })` u
  `OperacionPlataforma.ejecutar({ actor: 'cli:mi-script', … })`. Los ingresos lo fijan con
  `ContextoEmpresa.fijarActor` después de verificar las credenciales. Una migración que escribe datos lo
  fija con `migracion:<nombre>`.
- Los esquemas de entrada de `packages/contratos` nunca aceptan `empresaId`, `creadoPor*` ni
  `actualizadoPor*`.

Revertir la migración `202610270002-contexto-empresa-unico.ts` (`pnpm db:revertir`) deja la RLS
leyendo otra vez `app.empresa_id` y rompe `ContextoEmpresa`: nunca se revierte sin revertir también el
código.

Una migración de datos que deba recorrer todas las empresas necesita, dentro de su propia
transacción, `ALTER TABLE x NO FORCE ROW LEVEL SECURITY`, el cambio de datos y
`ALTER TABLE x FORCE ROW LEVEL SECURITY` (el migrador es dueño de las tablas; sin `FORCE` no le
aplica la RLS).

## CI

`.github/workflows/ci.yml` corre en cada push y pull request, contra un servicio PostgreSQL 16:
`pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `build` y `test`.
Un segundo trabajo, `e2e`, prepara la base, corre la semilla y ejecuta las pruebas E2E de la app
(Playwright con Chromium, viewport de celular).
