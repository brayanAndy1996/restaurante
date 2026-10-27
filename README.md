# Software para restaurantes (SaaS multitenant)

Sistema en la nube para restaurantes pequeños del Perú, alquilado por sucursal. Monorepo con pnpm y
Turborepo: `apps/api` (NestJS + Sequelize + PostgreSQL), `packages/dominio` (reglas puras),
`packages/contratos` (esquemas zod) y `packages/config`. La PWA, la carta web y el puente Android
llegan en historias posteriores. El diseño y los requerimientos viven en los documentos compartidos
que enlaza `CLAUDE.md`; las historias, en `specs/NNN-nombre/`.

## Estado

Historia 001 (base del monorepo, multitenancy y aislamiento entre empresas) terminada, con la fase E incluida (fijación única del contexto, errores 4xx y modo sin superusuario para PostgreSQL administrado). Su especificación, plan y tareas están en [`specs/001-base-multitenancy/`](specs/001-base-multitenancy/). La sección 1 de los requerimientos, «Plataforma y acceso», tiene su especificación en borrador en [`specs/002-plataforma-y-acceso/`](specs/002-plataforma-y-acceso/), pendiente de aprobación.

Hasta la historia 002 (autenticación) las rutas de empresa responden 401 `EMPRESA_NO_RESUELTA`, salvo con el resolutor por cabecera de desarrollo y pruebas (`EMPRESA_POR_HEADER=habilitado`): todavía no hay forma de saber la empresa de una petición real.

## Requisitos

- Node 22 y pnpm 10 (`corepack enable` toma la versión de `packageManager`).
- PostgreSQL 16: con Docker (un comando) o uno propio con un usuario administrador.

```bash
pnpm install --frozen-lockfile
```

## Levantar en local con Docker (un comando)

```bash
pnpm local:preparar   # PostgreSQL 16 (puerto 5433), roles, base migrada y datos de demostración
pnpm dev              # API en http://localhost:3000
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
export EMPRESA_POR_HEADER=habilitado   # opcional: resolutor por cabecera x-empresa-id (solo desarrollo y pruebas)
pnpm install --frozen-lockfile
pnpm db:preparar   # roles restaurante_migrador / _api / _plataforma, la base `restaurante` y las protecciones del catálogo (idempotente; sin superusuario ver más abajo)
pnpm db:migrar     # aplica las migraciones pendientes (idempotente); sin DATABASE_MIGRADOR_URL la deriva del admin y de la base de DATABASE_URL
pnpm db:semilla    # compila los paquetes compartidos y crea dos empresas de demostración, actor `semilla` (idempotente)
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

| Comando                  | Qué hace                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `pnpm lint`              | ESLint en todo el monorepo (incluye las reglas del criterio 37)          |
| `pnpm typecheck`         | Verificación de tipos                                                    |
| `pnpm build`             | Compila los paquetes y la API                                            |
| `pnpm test`              | Todas las pruebas (la API necesita `DATABASE_ADMIN_URL`)                 |
| `pnpm format:check`      | Comprueba el formato con Prettier (`pnpm format` lo corrige)             |
| `pnpm dev`               | API en modo desarrollo                                                   |
| `pnpm build:compartidos` | Compila `packages/dominio` y `packages/contratos` (`db:semilla` lo hace) |

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

| Variable                                                            | Uso                                                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                      | Conexión de la API (`restaurante_api`); su base es también la que usan por defecto `db:preparar` y `db:migrar`                   |
| `DATABASE_PLATAFORMA_URL`                                           | Conexión de plataforma (`restaurante_plataforma`)                                                                                |
| `DATABASE_MIGRADOR_URL`                                             | Migraciones (`restaurante_migrador`); si falta se deriva del admin                                                               |
| `DATABASE_ADMIN_URL`                                                | Solo `db:preparar` y las pruebas: administrador de PostgreSQL; su base es la de mantenimiento; `sslmode` en producción           |
| `DB_PASSWORD_MIGRADOR`, `DB_PASSWORD_API`, `DB_PASSWORD_PLATAFORMA` | Contraseñas que `db:preparar` asigna a los roles; obligatorias salvo con `NODE_ENV` `development` o `test`                       |
| `DB_PROTECCION_CATALOGO`                                            | Solo `db:preparar`. `omitir`: sin superusuario, omite las protecciones del catálogo y avisa (producción); otro valor es un error |
| `DB_POOL_MAX`                                                       | Tamaño del pool de la API (por defecto 10)                                                                                       |
| `EMPRESA_POR_HEADER`                                                | `habilitado` activa el resolutor por cabecera `x-empresa-id`; la API se niega a arrancar con él en producción                    |
| `NODE_ENV`                                                          | Obligatoria, sin valor por defecto: `development`, `test` o `production`                                                         |
| `PORT`                                                              | Puerto de la API (por defecto 3000)                                                                                              |

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
  Corren con `restaurante_plataforma`, dejan una fila inmutable en `auditoria_plataforma` en la misma
  transacción y no pueden anidarse con un contexto de empresa. Solo `src/modulos/plataforma/` puede
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
- **Quién resuelve la empresa de la petición.** El token `RESOLUTOR_EMPRESA`: en producción es el
  resolutor nulo (siempre 401 `EMPRESA_NO_RESUELTA`) hasta que la historia 002 instale el de sesión; en
  desarrollo y pruebas, con `EMPRESA_POR_HEADER=habilitado`, lee `x-empresa-id`. Una ruta que no
  pertenece a ninguna empresa se marca `@SinEmpresa()` (por ejemplo `GET /health`).

### Convención para una tabla nueva con datos de clientes

Cada migración que crea una tabla de empresa debe, en la misma migración:

1. Llevar `empresa_id uuid NOT NULL REFERENCES empresa (id)` y un índice por `empresa_id`.
2. Llamar a `sqlTablaDeEmpresa(nombre, { privilegiosApi, privilegiosPlataforma? })`
   (`apps/api/src/migraciones/sql-tabla-de-empresa.ts`): activa **y fuerza** la RLS, crea la política
   `aislamiento_empresa` con `empresa_actual()` en `USING` y `WITH CHECK`, y concede los privilegios
   explícitos. Nunca `TRUNCATE`, `REFERENCES` ni `TRIGGER` (`TRUNCATE` ignora la RLS).
3. Si otra tabla de empresa la referencia, usar llaves foráneas **compuestas** que incluyan
   `empresa_id` (con un `UNIQUE (id, empresa_id)` en la tabla referenciada): las comprobaciones de
   llave foránea ignoran la RLS.

La prueba de catálogo (`apps/api/test/aislamiento/catalogo.spec.ts`) recorre las tablas de `public`
en cada ejecución: una tabla nueva sin RLS, sin política o con privilegios de más hace fallar la suite.

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
