# Software para restaurantes (SaaS multitenant)

Sistema en la nube para restaurantes pequeños del Perú, alquilado por sucursal. Monorepo con pnpm y
Turborepo: `apps/api` (NestJS + Sequelize + PostgreSQL), `packages/dominio` (reglas puras),
`packages/contratos` (esquemas zod) y `packages/config`. La PWA del personal ya existe (`apps/app`); la carta web y el puente Android
llegan en historias posteriores. El diseño y los requerimientos viven en los documentos compartidos
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

La sección 3a de los requerimientos, «Salón y Cocina» (especificación 004, historias HU-10 a HU-17 y HU-19), está terminada en la rama de trabajo `claude/upbeat-wright-q09k0n`; todavía no está en `main`. Su especificación, plan y tareas están en [`specs/004-salon-cocina/`](specs/004-salon-cocina/). Incluye la revisión y tres rondas de ataque adversarial sobre las partes críticas (montos, envío de comandas, permisos y aislamiento). Lo construido:

- **Mapa de mesas** (RF-22): zonas y mesas diseñadas en Ajustes, con una cuadrícula. El salón las muestra por zona, en mapa o en lista, con su estado (libre, ocupada o en pre-cuenta).
- **Abrir mesa y tiempo real** (HU-10, RF-23, RF-24): comensales y mozo responsable. Los cambios llegan a los equipos de la sucursal por Socket.IO, con el adaptador de PostgreSQL; sin conexión, la pantalla se refresca cada 30 segundos.
- **Tomar pedido y enviar la comanda** (HU-11, HU-12, HU-14): comandero con la carta de la sucursal. Cada línea va a su estación (por ejemplo, cocina o barra), incluidas las partes de combos y modificadores. El envío es idempotente, y el borrador sobrevive a una recarga.
- **Marchar y adiciones** (HU-13): el segundo tiempo se marcha a la cocina, y una adición es un envío nuevo de la misma cuenta.
- **Anular y liberar** (HU-15, RF-29, RF-35): anular un ítem (en parte o entero) o la orden. Mozo y Cajero necesitan la clave de supervisor. Liberar una mesa sin consumo queda registrado.
- **Mover, unir y pre-cuenta** (HU-16, HU-17, RF-30 a RF-32): mover la cuenta, unir mesas y pedir la pre-cuenta con su total. La impresión llega en la 3b.
- **Pantalla de cocina y barra** (HU-19): comandas en orden de llegada, filtros por estación, tiempo transcurrido con avisos a los 10 y 20 minutos, y «Listo» con aviso al mozo.
- **Inactividad de Cocina/Barra** (RF-11, decisión 11): la sesión de Cocina/Barra se cierra a los 60 minutos sin actividad (configurable de 1 a 720). Los demás roles no cambian.
- **Permisos, trazabilidad y aislamiento**: quién abrió, comandó y autorizó queda registrado. Las tablas nuevas llevan RLS, y las pruebas protegidas comprueban que una empresa no ve nada de otra.

La siguiente es la 3b (Impresión básica): comandas y pre-cuentas en las impresoras del local, a través del puente vinculado por QR. La app Android del puente es la 3c.

## Requisitos

- Node 22 y pnpm 10 (`corepack enable` toma la versión de `packageManager`).
- PostgreSQL 16: con Docker (un comando) o uno propio con un usuario administrador.

```bash
pnpm install --frozen-lockfile
```

## Levantar en local con Docker (un comando)

```bash
pnpm local:preparar   # PostgreSQL 16 (puerto 5433), roles, base migrada y datos de demostración
pnpm dev              # API en http://localhost:3000 y la app del personal en http://localhost:5173
curl http://localhost:3000/health
```

`local:preparar` crea `.env` a partir de `.env.example` si falta (trae todas las variables que
necesita `pnpm dev`, incluida `NODE_ENV`), levanta `docker-compose.yml`, y ejecuta `db:preparar`,
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

| Comando                      | Qué hace                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `pnpm lint`                  | ESLint en todo el monorepo (incluye las reglas del criterio 37)               |
| `pnpm typecheck`             | Verificación de tipos                                                         |
| `pnpm build`                 | Compila los paquetes y la API                                                 |
| `pnpm test`                  | Todas las pruebas (la API necesita `DATABASE_ADMIN_URL`)                      |
| `pnpm format:check`          | Comprueba el formato con Prettier (`pnpm format` lo corrige)                  |
| `pnpm dev`                   | API (puerto 3000) y app del personal (puerto 5173) en modo desarrollo         |
| `pnpm build:compartidos`     | Compila `packages/dominio` y `packages/contratos` (`db:semilla` lo hace)      |
| `pnpm db:semilla`            | Superadministrador y dos empresas de demostración, con usuarios por rol       |
| `pnpm plataforma:superadmin` | Crea, desactiva o desbloquea un superadministrador (ver "Superadministrador") |

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

| Variable                                                                 | Uso                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | Conexión de la API (`restaurante_api`); su base es también la que usan por defecto `db:preparar` y `db:migrar`                                                                                                                                                                                                                                                    |
| `DATABASE_PLATAFORMA_URL`                                                | Conexión de plataforma (`restaurante_plataforma`)                                                                                                                                                                                                                                                                                                                 |
| `DATABASE_MIGRADOR_URL`                                                  | Migraciones (`restaurante_migrador`); si falta se deriva del admin                                                                                                                                                                                                                                                                                                |
| `DATABASE_TIEMPO_REAL_URL`                                               | Conexión del adaptador de Socket.IO, con el rol `restaurante_tiempo_real`; obligatoria con `TIEMPO_REAL=habilitado`                                                                                                                                                                                                                                               |
| `DATABASE_ADMIN_URL`                                                     | Solo `db:preparar` y las pruebas: administrador de PostgreSQL; su base es la de mantenimiento; `sslmode` en producción                                                                                                                                                                                                                                            |
| `DB_PASSWORD_MIGRADOR`, `DB_PASSWORD_API`, `DB_PASSWORD_PLATAFORMA`      | Contraseñas que `db:preparar` asigna a los roles; obligatorias salvo con `NODE_ENV` `development` o `test`                                                                                                                                                                                                                                                        |
| `DB_PASSWORD_TIEMPO_REAL`                                                | Contraseña que `db:preparar` asigna al rol `restaurante_tiempo_real`; obligatoria salvo con `NODE_ENV` `development` o `test`                                                                                                                                                                                                                                     |
| `DB_PROTECCION_CATALOGO`                                                 | Solo `db:preparar`. `omitir`: sin superusuario, omite las protecciones del catálogo y avisa (producción); otro valor es un error                                                                                                                                                                                                                                  |
| `DB_POOL_MAX`                                                            | Tamaño del pool de la API (por defecto 10)                                                                                                                                                                                                                                                                                                                        |
| `TIEMPO_REAL`                                                            | `habilitado` o `deshabilitado`: enciende o apaga el servidor de Socket.IO (`/tiempo-real`). Por defecto `habilitado`, salvo con `NODE_ENV=test`                                                                                                                                                                                                                   |
| `API_URL_PUBLICA`                                                        | URL pública de la API, sin barra final: va en el QR de vinculación del puente de impresión (`restaurante-puente://vincular?api=<URL>&t=<código>`). Con `development` y `test` vale `http://localhost:<PORT>` si falta; en producción hay que definirla o crear un código de vinculación falla                                                                     |
| `EMPRESA_POR_HEADER`                                                     | **Solo pruebas.** `habilitado` con `NODE_ENV=test` da un principal de prueba (Administrador, actor `prueba`) a las peticiones sin `Authorization` con `x-empresa-id`; la API se niega a arrancar con él en `development` y en `production`. No lo pongas en tu `.env`                                                                                             |
| `PIN_PEPPER`                                                             | Secreto (base64, 32 bytes o más) con el que se calcula la huella de los PIN. Obligatoria en producción; con `development` o `test` hay un valor local. **Cambiarla invalida todos los PIN** (y las claves de idempotencia de las últimas 24 horas, cuya huella también se calcula con HMAC y una clave derivada de ella); nunca va en la base ni en los respaldos |
| `ORIGENES_PERMITIDOS`                                                    | Orígenes de la PWA permitidos por CORS, separados por coma, sin ruta ni barra final. Obligatoria en producción (por defecto local: `http://localhost:5173`)                                                                                                                                                                                                       |
| `SUPERADMIN_CONTRASENA`                                                  | Solo para automatizar `pnpm plataforma:superadmin crear` y `db:semilla`: la contraseña del superadministrador (nunca como argumento)                                                                                                                                                                                                                              |
| `NODE_ENV`                                                               | Obligatoria, sin valor por defecto: `development`, `test` o `production`                                                                                                                                                                                                                                                                                          |
| `PORT`                                                                   | Puerto de la API (por defecto 3000)                                                                                                                                                                                                                                                                                                                               |
| `ARCHIVOS_DRIVER`                                                        | Dónde se guardan las fotos de la carta: `memoria` (pruebas), `disco` (solo `NODE_ENV=development`; la API sirve la carpeta en `/archivos/*`) o `r2` (Cloudflare R2). Por defecto `disco` en desarrollo y `memoria` en pruebas; **en producción es obligatorio `r2`**                                                                                              |
| `ARCHIVOS_DIRECTORIO`, `ARCHIVOS_URL_PUBLICA`                            | Carpeta del almacén en disco (por defecto `./archivos`, ignorada por git) y URL base pública de los archivos (con `disco`, por defecto `http://localhost:<PORT>/archivos`; con `r2`, el dominio público del bucket y obligatoria)                                                                                                                                 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Credenciales del bucket de R2; obligatorias con `ARCHIVOS_DRIVER=r2`. El token debe tener permiso solo sobre ese bucket                                                                                                                                                                                                                                           |

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
