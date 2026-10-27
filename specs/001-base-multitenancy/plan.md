# 001 · Plan técnico

## Módulos afectados

Todo es nuevo; el repositorio solo tiene configuración.

- Raíz: `package.json` (`packageManager: pnpm@10.x`, `engines.node >= 22`), `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.editorconfig`, `.env.example`, `docker-compose.yml`, `README.md`, `.github/workflows/ci.yml`, y entradas nuevas en `.gitignore` (`node_modules`, `dist`, `.turbo`, `.env`, `coverage`).
- `packages/config`: `tsconfig.base.json`, `eslint.config.js` base (ESLint 9 con configuración plana y typescript-eslint), `prettier.config.js`.
- `packages/dominio`: `src/ruc.ts`, `src/dia-operativo.ts`, `src/horario.ts`, `src/regimen.ts`, `src/index.ts` y sus pruebas unitarias.
- `packages/contratos`: `src/plataforma.ts` (empresa, emisor, sucursal), `src/salud.ts`, `src/errores.ts`, `src/comunes.ts` (hora, horario, whatsapp, ruc), `src/index.ts`.
- `apps/api`:
  - `src/main.ts`, `src/app.module.ts`
  - `src/config/entorno.ts`: validación con zod de las variables de entorno; falla al arrancar si algo falta, si `NODE_ENV` no está definido o no es válido (criterio 29b) o si `EMPRESA_POR_HEADER=habilitado` con `NODE_ENV=production`.
  - `src/nucleo/base-de-datos/`: las dos instancias de Sequelize (API y plataforma, `crear-sequelize.ts`), el estado de la operación sobre `AsyncLocalStorage` (`estado-operacion.ts`), las guardas que envuelven `sequelize.query` (`guarda-api.ts` y la de `conexion-plataforma.ts`), la cola por transacción (`cola-por-transaccion.ts`), el analizador de control de transacción (`control-transaccion.ts`), el cierre propio (`cierre-propio.ts`), las consultas fijas sin empresa (`consultas-sin-empresa.ts`), la verificación de roles al arrancar y el mapeo de errores de PostgreSQL.
  - `src/nucleo/contexto-empresa/`: `ContextoEmpresa`, `ContextoEmpresaInterceptor`, `RESOLUTOR_EMPRESA`, `ResolutorEmpresaNulo`, `ResolutorEmpresaPorCabecera`, el decorador `@SinEmpresa()` y los errores.
  - `src/nucleo/errores/`: filtro global de excepciones que responde `{ codigo, mensaje, campos? }`.
  - `src/modulos/salud/`: `SaludController` (`GET /health`).
  - `src/modulos/plataforma/`: modelos `Empresa`, `Emisor`, `Sucursal`, `AuditoriaPlataforma`; `OperacionPlataforma`; `PlataformaEmpresasService`; `SucursalService`; `SucursalesController`.
  - `src/migraciones/`: migraciones en TypeScript con SQL explícito.
  - `scripts/`: `preparar-bd.ts`, `migrar.ts`, `semilla.ts`.
  - `test/`: configuración de Vitest, preparación de la base de pruebas y utilidades (clientes `pg` por rol, fábrica de empresas A y B).

## Diseño

### Roles y preparación de la base

`scripts/preparar-bd.ts` (`pnpm db:preparar`) se conecta con `DATABASE_ADMIN_URL` y, de forma idempotente:

1. Crea los roles que falten con `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`, les asigna las contraseñas de `DB_PASSWORD_*` y fija `idle_in_transaction_session_timeout = '30s'` en `restaurante_api`. Las contraseñas por defecto (`*_local`) solo se usan con `NODE_ENV` `development` o `test` explícito; en otro caso, si falta una `DB_PASSWORD_*`, falla antes de tocar nada nombrando la variable (criterio 29b).
2. Crea la base (`restaurante`, o la que indique el argumento) con dueño `restaurante_migrador`, si no existe.
3. Revoca `CONNECT`, `CREATE` y `TEMPORARY` a `PUBLIC` sobre la base y concede `CONNECT` a `restaurante_api` y `restaurante_plataforma`.
4. Protecciones del catálogo en cada base preparada (`restaurante` y la de pruebas), porque todas las conexiones de la API comparten rol y estos objetos no tienen RLS:
   - **Texto de consultas ajenas (38b):** `REVOKE` sobre `pg_stat_activity`, `pg_stat_get_activity` y `pg_stat_get_backend_activity` a `PUBLIC` y a los dos roles (se devuelve `SELECT` sobre la vista a `pg_read_all_stats`), y se quita la membresía en `pg_read_all_stats`/`pg_monitor` si la hubiera.
   - **Señales y enumeración de sesiones (38c):** `REVOKE EXECUTE` sobre `pg_cancel_backend`, `pg_terminate_backend` (todas las firmas) y toda `pg_stat_get_backend_*`, y se quita la membresía en `pg_signal_backend`.
   - **Objetos grandes (38d):** `REVOKE EXECUTE` sobre toda función de `pg_catalog` llamada `lo_*`, `loread` o `lowrite` (todas las firmas, enumeradas desde `pg_proc`, no con una lista fija) y `REVOKE SELECT` sobre `pg_largeobject` y `pg_largeobject_metadata`, a `PUBLIC` y a los dos roles.
   - Cada bloque comprueba al final, con `has_function_privilege`/`has_table_privilege` por rol, que quedó aplicado; si falta algo, o si el administrador no es superusuario (o dueño de los objetos de `pg_catalog`), falla con un mensaje que nombra el criterio. Es repetible: `REVOKE` de algo ya revocado no falla.

Es la única fuente de verdad para los roles: la usan `pnpm local:preparar` (con Docker), el entorno en la nube (PostgreSQL nativo) y la preparación de las pruebas. En producción (PostgreSQL administrado de DigitalOcean) el usuario administrador del proveedor no es superusuario, así que el paso 4 fallaría con su mensaje: cómo aplicar 38b, 38c y 38d allí queda pendiente de decisión antes del despliegue (ver "Notas para otras historias" en `spec.md`). Ningún rol del sistema necesita `BYPASSRLS` ni ser superusuario, lo que también evita depender de atributos que un PostgreSQL administrado podría no conceder.

Los nombres de los roles son fijos (las políticas los nombran). Desarrollo y pruebas comparten el clúster y las contraseñas, pero usan bases distintas (`restaurante` y `restaurante_test`).

### Migraciones

- `umzug` 3 con `SequelizeStorage` (tabla `migraciones`), conectado con `DATABASE_MIGRADOR_URL`. Comandos `pnpm db:migrar` y `pnpm db:revertir`.
- Archivos `src/migraciones/AAAAMMDDHHMM-descripcion.ts` con `up` y `down` escritos en SQL (RLS, políticas, triggers y privilegios no se expresan bien con `queryInterface`).
- Cada migración que crea una tabla de empresa hace, en la misma migración: `ENABLE` y `FORCE ROW LEVEL SECURITY`, la política `aislamiento_empresa`, la política de plataforma si corresponde, y los `GRANT` explícitos. Una función auxiliar `sqlTablaDeEmpresa(nombre, privilegiosApi)` genera ese bloque para no repetirlo ni olvidarlo.
- Primera migración: función `empresa_actual()` y tablas `empresa`, `emisor`, `sucursal`, `auditoria_plataforma`, con sus políticas, privilegios y triggers (ver `spec.md`, "Cambios al modelo de datos").
- Migraciones de datos futuras que deban recorrer todas las empresas: dentro de su transacción, `ALTER TABLE x NO FORCE ROW LEVEL SECURITY`, el cambio de datos y `ALTER TABLE x FORCE ROW LEVEL SECURITY`. El migrador es dueño de las tablas, así que sin `FORCE` no le aplica la RLS. Se documenta en el README.

### Dos conexiones a la base

- **API** (`DATABASE_URL`, `restaurante_api`): pool de `DB_POOL_MAX`. Transacciones no gestionadas abiertas solo por `ContextoEmpresa.ejecutar`; los modelos toman la transacción del `AsyncLocalStorage` a través de la guarda (sin CLS de Sequelize).
- **Plataforma** (`DATABASE_PLATAFORMA_URL`, `restaurante_plataforma`): pool chico (2). La provee solo `PlataformaModule` y no se exporta. Una regla de ESLint (`no-restricted-imports`) prohíbe importar su proveedor fuera de `src/modulos/plataforma/`.
- Sequelize 6 sin `sequelize-typescript` ni `@nestjs/sequelize`: las instancias se crean en proveedores propios para controlar las guardas y los dos pools. Los modelos se definen con una función `definirModelos(sequelize)` que se aplica a cada instancia; cada instancia tiene su propio juego de modelos.

### Contexto de empresa

```
Petición HTTP
  → guards (en 002: autenticación, que deja el usuario en la petición)
  → ContextoEmpresaInterceptor
       ¿la ruta tiene @SinEmpresa()?  sí → controlador sin transacción
       no → empresaId = RESOLUTOR_EMPRESA.resolver(petición)
            null → 401 EMPRESA_NO_RESUELTA
            UUID → ContextoEmpresa.ejecutar(empresaId, () => lastValueFrom(next.handle()))
                     ├─ ¿hay estado activo y vigente?  misma empresa → corre fn en la transacción existente
                     │                                 otra empresa o plataforma → error (27, 28)
                     ├─ t = await sequelize.transaction()        ← no gestionada; sin CLS de Sequelize
                     ├─ SELECT set_config('app.empresa_id', $1, true)   ← primera sentencia; la guarda
                     │                                                    autoriza t (solo aquí, 22c)
                     ├─ AsyncLocalStorage.run({ empresaId, transaccion: t }, fn)
                     │     controlador → servicios → modelos → sequelize.query (guarda: toma t del almacén)
                     ├─ confirmarPropia(t) o revertirPropia(t)   ← única vía para COMMIT/ROLLBACK (22b)
                     └─ el estado se marca terminado: el valor local muere con t y el almacén ya no da
                        contexto al código que siga vivo (27b)
```

- **Sin CLS de Sequelize ni `beforeQuery`.** `Sequelize.useCLS` es global para toda la clase `Sequelize` y mezclaría la instancia de la API con la de plataforma, y `beforeQuery` no permite decidir de forma fiable con qué transacción corre la consulta. En su lugar, cada instancia tiene su propia **guarda**, que reemplaza `sequelize.query` de esa instancia (por ahí pasan modelos, `queryInterface`, consultas crudas y las sentencias de transacción). El estado de la operación (`{ empresaId, transaccion }` o `{ plataforma: true }`) vive en un `AsyncLocalStorage` propio (`estado-operacion.ts`).
- **Guarda de la API (`guarda-api.ts`):**
  - Toma la transacción de `options.transaction` o, si no hay, del almacén. Sin transacción de esa instancia, lanza `ContextoEmpresaAusenteError` antes de pedir una conexión al pool (criterio 22).
  - **Autorización de la transacción:** una transacción queda autorizada cuando en ella se ejecuta con éxito el SQL exacto de `ContextoEmpresa` (`SQL_FIJAR_CONTEXTO`) con un UUID, y solo si esa fijación la hace `ContextoEmpresa.ejecutar` al abrir un contexto nuevo (no hay estado activo). Una fijación hecha desde dentro de un contexto, en otra transacción abierta por `fn` con cualquier empresa, no autoriza (criterio 22c): la guarda debe distinguir la llamada propia de `ejecutar` (por ejemplo, con una marca efímera como la del cierre propio, o registrando la transacción antes de fijar) y no fiarse del texto. Fijar dos veces en la misma transacción falla. Las consultas de una transacción no autorizada lanzan error.
  - **Control de transacción:** `START TRANSACTION` pasa solo antes de la autorización; ya autorizada, solo pasan el `COMMIT` y el `ROLLBACK` del cierre propio (`cierre-propio.ts`: marca efímera mientras `ejecutar` llama `commit()`/`rollback()`). Toda otra sentencia de control se rechaza con el analizador de `control-transaccion.ts`, que quita literales (`'…'`, `E'…'`, `$$…$$`, `$etiqueta$…$etiqueta$`, identificadores entre comillas) y comentarios (`--`, `/* */` anidados) y mira la primera palabra de cada sentencia separada por `;`; un literal o comentario sin cerrar se rechaza (criterio 22b).
  - **Sesión y contexto:** `set_config`, la mención de `app.empresa_id`, y `SET`/`RESET`/`DISCARD`/`DO` como sentencia se rechazan, pero la decisión se toma sobre el texto ya limpio por el mismo analizador, para que un literal con esos textos o con `;` no se rechace (aclaración del criterio 22b).
  - **Cola por transacción (`cola-por-transaccion.ts`):** las consultas de una misma transacción se encolan y se mandan una tras otra (una conexión de `pg` no admite consultas solapadas), así `Promise.all` dentro de un controlador funciona.
  - Excepciones explícitas: las dos consultas fijas marcadas `{ sinEmpresa: 'salud' | 'verificacion-roles' }` (`consultas-sin-empresa.ts`), que se comparan por texto exacto.
- **Fin del contexto (criterio 27b):** al cerrar su transacción, `ejecutar` deja el estado del almacén como terminado (por ejemplo, un objeto de estado mutable con una marca `terminado`, o una referencia que se anula). `empresaActual()`, la guarda y los controles de anidamiento ignoran un estado terminado: el código que siga vivo con ese almacén no tiene contexto, puede abrir un `ejecutar` nuevo con cualquier empresa y puede llamar `OperacionPlataforma`. Lo mismo hace `OperacionPlataforma` con su estado `{ plataforma: true }` al terminar.
- **Guarda de plataforma (`conexion-plataforma.ts`):** exige que toda consulta lleve en `options.transaction` una transacción abierta por `ConexionPlataforma.abrirTransaccion()` dentro de una operación de plataforma vigente; nunca toma una transacción del almacén. Usa el mismo analizador para rechazar el control de transacción y de sesión, la misma cola por transacción y su propio cierre (`confirmar`/`revertir` con marca efímera, criterio 32b). `consultar` abre la transacción con `SET TRANSACTION READ ONLY` antes de autorizarla y siempre la revierte.
- **Plataforma y empresa no se mezclan:** mientras corre una operación de plataforma el almacén marca `{ plataforma: true }`, `ContextoEmpresa.ejecutar` falla ahí y la guarda de la API no encuentra transacción (criterio 28); `OperacionPlataforma` falla si hay un contexto de empresa vigente.
- **Lint:** `ContextoEmpresa` es el único archivo que escribe `app.empresa_id` (regla `no-restricted-syntax`, que también mira concatenaciones de literales, criterio 22c), y `SQL_FIJAR_CONTEXTO` no se puede importar fuera de `src/nucleo/` (regla de importaciones con las mismas formas del criterio 37b).
- **Anidamiento:** `ContextoEmpresa.ejecutar` con la misma empresa, dentro de un contexto vigente, reutiliza la transacción; con otra lanza `ContextoEmpresaConflictoError`.
- **Fuera de HTTP:** colas, WebSockets, tareas programadas y efectos secundarios posteriores a la confirmación llaman `ContextoEmpresa.ejecutar` explícitamente. Queda escrito en el README como regla.

### Resolutor de empresa (enganche para 002)

- El token `RESOLUTOR_EMPRESA` se registra en `ContextoEmpresaModule` según la configuración: `ResolutorEmpresaPorCabecera` si `NODE_ENV` es `development` o `test` y `EMPRESA_POR_HEADER=habilitado`; si no, `ResolutorEmpresaNulo`.
- La validación del entorno rechaza `EMPRESA_POR_HEADER=habilitado` con `NODE_ENV=production`, y además el proveedor vuelve a comprobar `NODE_ENV` al construirse (dos barreras).
- `NODE_ENV` es obligatorio y sin valor por defecto (criterio 29b): si falta o está vacío, `entorno.ts` falla con un mensaje que nombra la variable y sus valores válidos. `.env.example` lleva `NODE_ENV=development`, las pruebas fijan `test` (Vitest ya lo hace si no está) y el workflow de CI lo define explícitamente.
- La historia 002 agrega `ResolutorEmpresaSesion`, que lee la empresa que su guard de autenticación dejó en la petición, y lo registra en el mismo token. Nada más cambia en el interceptor ni en los servicios. Por decisión del usuario, desde 002 `ResolutorEmpresaPorCabecera` queda solo para las pruebas automáticas: la condición de registro pasa a ser únicamente `NODE_ENV=test`.

### Operaciones de plataforma

`OperacionPlataforma.ejecutar({ actor, motivo, operacion, empresaId? }, fn)`:

1. Valida que `actor`, `motivo` y `operacion` no estén vacíos (tras quitar espacios) y que no haya un contexto de empresa activo.
2. Abre una transacción no gestionada en la conexión de plataforma.
3. Corre `fn(tx)`. Si la operación crea la empresa, `fn` devuelve el `empresaId` para la auditoría.
4. Inserta la fila de `auditoria_plataforma` con actor, operación, motivo, `empresa_id` y el detalle que devolvió `fn`.
5. Confirma. Si algo falla, revierte todo, incluida la auditoría.

Así la auditoría y el cambio son atómicos: no hay cambio sin auditoría ni auditoría de un cambio que no ocurrió. Escribirla al final permite registrar el `empresa_id` recién creado.

`PlataformaEmpresasService.registrarEmpresa` valida la entrada con `registrarEmpresaEntradaSchema` antes de abrir la transacción, inserta empresa, emisores y sucursales con la transacción explícita, y traduce las violaciones de unicidad (RUC ya registrado, código repetido) a errores de validación con el campo. `agregarSucursal` valida con `sucursalEntradaSchema` de la misma forma. Ninguno de los dos crea la suscripción (llega con RF-03).

El `actor` de la auditoría es texto libre (`semilla`, `cli:<nombre>`) hasta que 002 cree el superadministrador.

### Sucursales (contexto de empresa)

- `SucursalService.obtener(id)` usa `findByPk`: con RLS, una sucursal de otra empresa no aparece y se trata igual que una inexistente.
- `configurar(id, cambios)`: valida con `sucursalConfigurarEntradaSchema`; si trae `emisorId`, comprueba que el emisor se vea en el contexto actual (si no, `EMISOR_INVALIDO`); actualiza; traduce `23505` (unicidad) a 409 `CONFLICTO` y `23503` (llave foránea compuesta) a 422 `EMISOR_INVALIDO`.
- Textos de entrada (criterios 40b y 40c): los esquemas de texto de `packages/contratos` y de las entradas de plataforma (incluidos `actor` y `motivo`) rechazan el NUL y los sustitutos UTF-16 sin pareja (por ejemplo con `String.prototype.isWellFormed()` de Node 22, o una expresión regular equivalente), indicando el campo. Un par de sustitutos válido pasa.
- JSON mal formado (criterio 40c): el filtro global reconoce el error del analizador de cuerpos (`entity.parse.failed`) y responde 400 `DATOS_INVALIDOS` con un mensaje fijo, sin el texto de la excepción.
- `horaCorte` se guarda como `time` y se devuelve como `HH:MM`. En el alta es opcional: `sucursalEntradaSchema` aplica `.default('05:00')`, y la columna `hora_corte` lleva `DEFAULT '05:00'` para que también la cubra una inserción por SQL sin la columna (criterio 35b). En `PATCH` sigue siendo opcional sin valor por defecto: si no viene, no cambia; no acepta `null`.
- El cambio de `emisorId` por `PATCH` se permite sin condiciones en esta historia; la historia de facturación agregará el bloqueo cuando la sucursal ya haya emitido comprobantes (consultando al módulo de facturación por su servicio, no sus tablas).

### Salud y verificación de arranque

- `GET /health` ejecuta `SELECT 1` por la conexión de la API, marcado como `sinEmpresa: 'salud'`, con un tiempo límite de 2 segundos (`statement_timeout` y `Promise.race` para la conexión). Responde 200 o 503 sin detalles.
- Al arrancar, la API consulta `pg_roles` y `pg_class` con cada conexión y se niega a arrancar si el rol es superusuario, tiene `BYPASSRLS` o es dueño de alguna tabla de `public` (criterio 10).

### Pruebas

- Vitest en todos los paquetes. En `apps/api`, con `unplugin-swc` para la metadata de decoradores de Nest (receta oficial de NestJS).
- Las pruebas de integración necesitan `DATABASE_ADMIN_URL`. La preparación global: corre la lógica de `preparar-bd` (roles y contraseñas), borra y crea `restaurante_test` (`DROP DATABASE ... WITH (FORCE)`), corre las migraciones como migrador y publica las URL de cada rol para las pruebas.
- Cada prueba crea sus propias empresas con UUID aleatorios, así que los archivos pueden correr en paralelo sin limpiar tablas.
- Las pruebas a nivel SQL usan `pg` directamente con cada rol; no dependen de la implementación de la API, lo que sirve al test-writer (TDD sin mirar el código).
- Las pruebas HTTP levantan la app de Nest con `NODE_ENV=test`, `EMPRESA_POR_HEADER=habilitado` y `DB_POOL_MAX=2`, y usan `supertest`. Para el criterio 26 (concurrencia), las pruebas registran un controlador sonda propio en el módulo de prueba, que hace dos consultas separadas por una espera y devuelve `empresaActual()`.
- Las reglas de ESLint del criterio 37 se prueban con `ESLint.lintText` sobre fragmentos de código.

### CI

`.github/workflows/ci.yml`, en `push` y `pull_request`:

- servicio `postgres:16` con `POSTGRES_PASSWORD` y health check;
- `pnpm/action-setup` (toma la versión de `packageManager`), `actions/setup-node` con Node 22 y caché de pnpm;
- `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` y `pnpm test`, con `DATABASE_ADMIN_URL` y las contraseñas de prueba como variables del job.

### Entorno local

- `docker-compose.yml` con `postgres:16`, volumen con nombre, puerto del equipo `5433` (para no chocar con un PostgreSQL instalado) y health check.
- `pnpm local:preparar` = `docker compose up -d --wait` + compilar los paquetes compartidos (`turbo run build --filter` de `dominio` y `contratos`) + `db:preparar` + `db:migrar` + `db:semilla`. Si falta `.env`, lo crea a partir de `.env.example`. Luego `pnpm dev`. Sin la compilación, la semilla falla en un clon limpio porque `contratos` y `dominio` exportan desde `dist/` (criterios 2 y 3).
- La secuencia nativa del README incluye la misma compilación antes de `db:semilla` (o `db:semilla` la dispara por su cuenta), y el README lista todas las variables que necesitan `db:preparar`, `db:migrar`, `db:semilla` y `pnpm dev`, incluido `NODE_ENV`.
- `pnpm db:semilla` registra dos empresas de demostración por `PlataformaEmpresasService` (actor `semilla`); si ya existen (mismo RUC), no hace nada.
- El README explica las dos vías: con Docker (un comando) y con PostgreSQL nativo (entorno en la nube), más cómo correr las pruebas.

### Paquetes compartidos

- `dominio` y `contratos` se compilan con `tsup` a ESM y CommonJS con tipos, para que los use la API (CommonJS) y más adelante la PWA con Vite (ESM). Turborepo: `build` depende de `^build`; `typecheck`, `lint` y `test` dependen de `^build`.
- `contratos` depende de `dominio` (los esquemas usan `validarRuc` y `validarHorario`). `dominio` no depende de nada salvo, en historias futuras, `decimal.js`.
- `diaOperativo` usa `Intl.DateTimeFormat` con `America/Lima` (Perú no tiene horario de verano), sin librerías de fechas.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Operaciones de plataforma con un rol propio (`restaurante_plataforma`) y políticas explícitas solo en las tablas de plataforma, por una conexión separada, con auditoría en la misma transacción | Rol con `BYPASSRLS` | `BYPASSRLS` abre todas las tablas, también las de operación futuras (órdenes, comprobantes); con políticas explícitas, el rol de plataforma solo ve lo que se le concede tabla por tabla. Además, un PostgreSQL administrado puede no permitir crear roles con `BYPASSRLS` |
| (misma) | Funciones `SECURITY DEFINER` por cada operación | Cada operación de plataforma sería una función SQL; mucho código en SQL, difícil de probar y de mantener junto con los modelos |
| (misma) | Un parámetro tipo `app.plataforma = 'si'` que la política acepte | Cualquier código de la API puede fijar un parámetro con `set_config`: un error o una inyección SQL abriría todo. Un rol distinto no se puede cambiar desde la conexión de la API |
| RLS forzada (`FORCE`) en todas las tablas, ningún rol con `BYPASSRLS` | Solo `ENABLE` y confiar en que el dueño nunca se conecta desde la API | Si por error la API se conecta con el rol migrador, igual no ve datos. La verificación de arranque es la segunda barrera |
| Función `empresa_actual()` que lanza un error claro | `current_setting('app.empresa_id')::uuid` directo en la política | Tras una transacción con contexto, el parámetro queda en `''` en esa conexión; el cast fallaría con un mensaje confuso, y con `missing_ok` devolvería `NULL` y 0 filas en silencio. La función distingue los casos y da un SQLSTATE fijo para mapearlo |
| `(SELECT empresa_actual())` en la política | Llamar la función por cada fila | Postgres la evalúa una vez por consulta (initplan) |
| Llaves foráneas compuestas con `empresa_id` | Llaves foráneas simples | Las verificaciones de llave foránea ignoran la RLS: con una llave simple, una sucursal de A podría apuntar al emisor de B |
| API con DML completo en las tablas de empresa; los permisos de negocio en la aplicación (002) | Privilegios mínimos por tabla según el caso de uso actual | La RLS ya limita a la propia empresa; las pruebas de aislamiento necesitan inserción y borrado reales; y es la convención que seguirán las tablas futuras. `TRUNCATE` nunca se concede porque ignora la RLS |
| Transacción por petición, también en lecturas | Fijar el contexto con `SET` de sesión al tomar la conexión del pool | `set_config(..., true)` muere con la transacción: una conexión devuelta al pool no puede llevar el contexto a otra petición |
| La tasa de IGV con vigencia va en la historia de cálculo de montos y facturación | Crear ahora `emisor_tasa_igv` | Nada la usa aquí; elegir la tasa de una fecha es cálculo de montos (ruta crítica, con sus propias pruebas primero); la tasa aplicable está pendiente con el contador; agregarla luego es una tabla nueva sin reescribir datos |
| Sin endpoints HTTP de plataforma en 001; servicio + semilla | Endpoints de alta de empresa sin autenticación | Un endpoint de alta sin superadministrador autenticado sería una puerta abierta. Llegan con 002 |
| `restaurante_api` puede insertar emisores y sucursales de su propia empresa (criterio 16b), sin endpoint HTTP de creación en 001 | Reservar la creación al rol de plataforma | Decisión del usuario: el Administrador también creará emisores y sucursales de su empresa desde 002; la base ya lo permite bajo RLS y la regla de rol se aplica en la API |
| Hora de corte por defecto `05:00` en el esquema zod del alta y en la columna | Hora de corte obligatoria sin valor por defecto | Decisión del usuario; el `DEFAULT` en la columna mantiene la regla también fuera de la API (semilla, SQL directo) |
| `auditoria_plataforma` como tabla propia en 001 | Crear ya la auditoría general | La auditoría general nace con el módulo de seguridad en 002; por decisión del usuario, ahí se unirá `auditoria_plataforma` |
| Endpoints de sucursal reales, cerrados en producción por el resolutor nulo | Solo controladores de prueba | Prueban el camino completo (interceptor, CLS, pool) con código de producción, y en producción responden 401 hasta 002 |
| Sequelize 6 con proveedores propios | `@nestjs/sequelize` + `sequelize-typescript` | Control directo de dos instancias y sus guardas; menos magia en la parte más delicada |
| Guarda que envuelve `sequelize.query` en cada instancia, con el estado en un `AsyncLocalStorage` propio | `Sequelize.useCLS` con un adaptador (o `cls-hooked`) y hooks `beforeQuery` | `useCLS` es global a la clase y mezclaría la API con la plataforma; `beforeQuery` no ve con certeza la transacción efectiva. Por `sequelize.query` pasa todo (modelos, `queryInterface`, crudas y control de transacción), así que la guarda es un solo punto de control |
| Transacciones no gestionadas abiertas por `ContextoEmpresa.ejecutar` y `OperacionPlataforma`, con cierre propio (marca efímera durante `commit()`/`rollback()`) | Transacciones gestionadas `sequelize.transaction(async (t) => …)` | El cierre lo hace siempre quien abrió; la guarda puede distinguir el `COMMIT`/`ROLLBACK` propio de uno enviado por `fn` (criterios 22b y 32b) |
| La transacción se autoriza al fijar el contexto, y solo cuando lo hace `ejecutar` sin contexto vigente | Autorizar toda transacción que ejecute el texto de `SQL_FIJAR_CONTEXTO` | Con el texto como única prueba, `fn` podía abrir otra transacción y fijar otra empresa (criterio 22c) |
| Cola de consultas por transacción | Dejar que `pg` reciba consultas solapadas | `pg` no admite consultas concurrentes en una conexión; `Promise.all` dentro de un contexto es un caso normal |
| Rechazo del control de transacción y de sesión con un analizador que ignora literales y comentarios | Expresiones regulares sobre el texto crudo, o un analizador SQL completo | Las expresiones sobre el texto crudo rechazan valores legítimos (`'x; set y'`) o se esquivan con comentarios; un analizador SQL completo es una dependencia grande para decidir solo la primera palabra de cada sentencia. Ante literales o comentarios sin cerrar, se rechaza |
| El estado del almacén se marca terminado al cerrar `ejecutar` u `OperacionPlataforma` | Confiar en que el almacén desaparece al salir de `AsyncLocalStorage.run` | Las continuaciones asíncronas creadas dentro de `fn` (efectos posteriores, temporizadores) heredan el almacén aunque la transacción ya cerró (criterio 27b) |
| Protecciones del catálogo (38b, 38c, 38d) en `db:preparar`, comprobadas al final | En una migración | Tocan objetos de `pg_catalog` y membresías de roles predefinidos, que el migrador no puede cambiar; `db:preparar` ya corre con el administrador |
| `NODE_ENV` obligatorio y contraseñas por defecto solo en `development`/`test` explícitos | `NODE_ENV` con valor por defecto `development` | Un despliegue que olvide la variable quedaría con el resolutor por cabecera y contraseñas conocidas (criterio 29b) |
| Migraciones con umzug y SQL explícito | `sequelize-cli` y `queryInterface` | La CLI de Sequelize está pensada para JavaScript; RLS, políticas y privilegios necesitan SQL de todos modos |
| Vitest con SWC | Jest con ts-jest | Más rápido, una sola herramienta para paquetes y API; NestJS documenta la receta |
| `tsup` a ESM y CommonJS para los paquetes | Paquetes solo en TypeScript fuente | La API compila a CommonJS con `tsc` y la PWA usará ESM con Vite; los paquetes compilados sirven a ambos |
| Un solo script de preparación para Docker, la nube, CI y pruebas | Script de inicio de Docker aparte | Una sola fuente de verdad para roles y privilegios |

## Migraciones

- `202610270001-plataforma-base.ts`:
  - función `empresa_actual()` y `GRANT EXECUTE` a `restaurante_api`;
  - tablas `empresa`, `emisor`, `sucursal`, `auditoria_plataforma` con sus restricciones, índices y llaves compuestas (incluido `sucursal.hora_corte` con `DEFAULT '05:00'`);
  - `ENABLE` y `FORCE ROW LEVEL SECURITY` en las cuatro;
  - políticas `aislamiento_empresa` (`TO restaurante_api`) y `acceso_plataforma` (`TO restaurante_plataforma`);
  - privilegios de la tabla de permisos de `spec.md`;
  - función y triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE` en `auditoria_plataforma`;
  - `REVOKE ALL ON SCHEMA public FROM PUBLIC` y `GRANT USAGE` a los dos roles.
- `down`: elimina todo en orden inverso.

## Riesgos

- **Una tabla futura sin RLS o con privilegios de más.** Mitigación: el criterio 38 recorre el catálogo en cada ejecución de la suite; la función auxiliar de migraciones genera el bloque estándar.
- **Mezcla de transacciones entre las dos instancias de Sequelize.** Mitigación: sin `useCLS`; cada instancia con su guarda, la de plataforma solo con transacción explícita, y el criterio 28.
- **El `AsyncLocalStorage` pierde el contexto en algún caso** (por ejemplo, con `EventEmitter` o librerías con callbacks). Mitigación: criterio 26 con concurrencia real y esperas; sin contexto la consulta falla, nunca usa otra empresa.
- **El contexto sobrevive a su transacción en continuaciones asíncronas.** Mitigación: estado marcado como terminado al cerrar (criterio 27b).
- **La guarda depende de detalles internos de Sequelize 6** (`transaction.finished`, `transaction.sequelize`, que `commit()`/`rollback()` manden la sentencia de forma síncrona). Mitigación: las pruebas protegidas de 22b, 22c, 27b y 32b fallan si una actualización de Sequelize cambia ese comportamiento; fijar la versión menor en `package.json`.
- **Pruebas no protegidas que asumen `NODE_ENV=development` por defecto** (por ejemplo `apps/api/test/entorno.spec.ts`). Al implementar 29b, el backend las ajusta; no son pruebas de `test-writer`.
- **Transacciones largas por petición agotan el pool** cuando lleguen operaciones lentas (PSE, impresión). Mitigación: la convención de `CLAUDE.md` ya manda ejecutar los efectos secundarios después de confirmar; además se fija `idle_in_transaction_session_timeout` en el rol de la API (30 s).
- **Fuga por mensajes de error:** las violaciones de unicidad o de llave foránea podrían revelar datos de otra empresa. Mitigación: el filtro de errores nunca devuelve el detalle de PostgreSQL; las respuestas 404 y 422 no distinguen entre inexistente y ajeno.
- **Rendimiento de la RLS** con la función en la política. Mitigación: initplan con `(SELECT empresa_actual())` e índice por `empresa_id`; a 30 empresas el costo es despreciable.
- **TDD sin código previo:** las pruebas protegidas no compilan si no existen los contratos. Mitigación: la fase A de `tasks.md` deja el monorepo, la preparación de la base de pruebas y las firmas públicas (que lanzan "no implementado") antes de que escriba el test-writer.
- **Unión de `auditoria_plataforma` con la auditoría general en 002.** Habrá que migrar las filas existentes y convertir el `actor` de texto libre al id del superadministrador, sin perder la inmutabilidad (los triggers impiden `UPDATE` y `DELETE`). Mitigación: 002 decide si copia las filas a la tabla nueva conservando el actor original como texto o si mantiene la tabla actual como histórico de solo lectura; en 001 no se hace nada que lo complique.
- **Diferencias entre el PostgreSQL de Docker, el nativo de la nube y el administrado de producción.** Mitigación: el mismo script de preparación en todos, y ningún atributo especial en los roles de la aplicación. Riesgo abierto: las protecciones del catálogo (38b, 38c, 38d) exigen hoy un administrador superusuario, que el PostgreSQL administrado no da; hay que decidirlo antes del despliegue.
