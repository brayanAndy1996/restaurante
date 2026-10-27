# Software para restaurantes (SaaS multitenant)

Sistema en la nube para restaurantes pequeños del Perú, alquilado por sucursal. Monorepo con pnpm y
Turborepo: `apps/api` (NestJS + Sequelize + PostgreSQL), `packages/dominio` (reglas puras),
`packages/contratos` (esquemas zod) y `packages/config`. La PWA, la carta web y el puente Android
llegan en historias posteriores. El diseño y los requerimientos viven en los documentos compartidos
que enlaza `CLAUDE.md`; las historias, en `specs/NNN-nombre/`.

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

Necesitas un usuario administrador (`DATABASE_ADMIN_URL`) que pueda crear roles y bases y que sea
**superusuario** (o dueño de los objetos de `pg_catalog`): `db:preparar` también protege, en la base de
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
  el `UPDATE` sobre `pg_settings`, que permitirían cambiar `app.empresa_id` a mitad de transacción
  (criterio 22d). `restaurante_api` conserva `set_config`.

Si el administrador no puede aplicarlo **falla con un mensaje que lo dice** en vez de dejar la base sin
esa protección. En PostgreSQL gestionado sin superusuario, pide al proveedor que quite esos permisos de
`pg_catalog` (`REVOKE ... FROM PUBLIC` sobre esas funciones, esa vista y esas tablas) o usa un usuario
con permiso sobre `pg_catalog`. Los permisos de señal quedan para `pg_signal_backend` y
`restaurante_migrador`; los de estadísticas, para `pg_read_all_stats`.

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
pnpm db:preparar   # roles restaurante_migrador / _api / _plataforma, la base `restaurante` y las protecciones del catálogo (idempotente)
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

En producción se corre el mismo `db:preparar` con el usuario administrador
del proveedor de PostgreSQL, `NODE_ENV=production` y las tres `DB_PASSWORD_*` definidas.

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

| Variable                                                            | Uso                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                      | Conexión de la API (`restaurante_api`); su base es también la que usan por defecto `db:preparar` y `db:migrar` |
| `DATABASE_PLATAFORMA_URL`                                           | Conexión de plataforma (`restaurante_plataforma`)                                                              |
| `DATABASE_MIGRADOR_URL`                                             | Migraciones (`restaurante_migrador`); si falta se deriva del admin                                             |
| `DATABASE_ADMIN_URL`                                                | Solo `db:preparar` y las pruebas: administrador de PostgreSQL                                                  |
| `DB_PASSWORD_MIGRADOR`, `DB_PASSWORD_API`, `DB_PASSWORD_PLATAFORMA` | Contraseñas que `db:preparar` asigna a los roles; obligatorias salvo con `NODE_ENV` `development` o `test`     |
| `DB_POOL_MAX`                                                       | Tamaño del pool de la API (por defecto 10)                                                                     |
| `EMPRESA_POR_HEADER`                                                | `habilitado` activa el resolutor por cabecera `x-empresa-id`; la API se niega a arrancar con él en producción  |
| `NODE_ENV`                                                          | Obligatoria, sin valor por defecto: `development`, `test` o `production`                                       |
| `PORT`                                                              | Puerto de la API (por defecto 3000)                                                                            |

## Aislamiento entre empresas: reglas para quien programa

Una empresa nunca ve datos de otra. La garantía la da PostgreSQL (RLS) y la refuerza la API.

- **Tres roles de base de datos**, ninguno superusuario ni con `BYPASSRLS`: `restaurante_migrador`
  (dueño de las tablas, solo migraciones), `restaurante_api` (la API, sujeta a RLS) y
  `restaurante_plataforma` (operaciones de plataforma, con sus propias políticas). La API se niega
  a arrancar si su conexión usa un rol superusuario, con `BYPASSRLS` o dueño de tablas, o que sea
  miembro (directo o transitivo, con `INHERIT` o `NOINHERIT`) de `restaurante_migrador`, del dueño de
  una tabla o de un rol así; el error nombra el rol de conexión y la membresía que lo impide.
- **Contexto de empresa.** Cada petición con empresa corre en una transacción con
  `set_config('app.empresa_id', …, true)`. El servicio `ContextoEmpresa`
  (`apps/api/src/nucleo/contexto-empresa/contexto-empresa.ts`) es el único archivo que escribe ese
  parámetro (regla de ESLint). Sin contexto, cualquier consulta de la API, incluso cruda, lanza
  `ContextoEmpresaAusenteError` antes de llegar a la base. Dentro de `ContextoEmpresa.ejecutar`, `fn`
  no puede controlar la transacción por SQL: `COMMIT`, `ROLLBACK`, `END`, `ABORT`, `SAVEPOINT`,
  `RELEASE`, `BEGIN`, `START TRANSACTION`, `PREPARE TRANSACTION` y similares (también entre varias
  sentencias o tras comentarios) lanzan `ConsultaProhibidaError` antes de llegar a la base; un literal con
  ese texto (o con `set_config`, `SET`, `;`…) en un valor sí se guarda, porque el rechazo se decide sobre
  el texto sin literales ni comentarios. Tampoco sirven las transacciones anidadas de Sequelize (usan
  `SAVEPOINT`): `ejecutar` confirma o revierte todo al terminar `fn`. Solo la transacción que abre
  `ejecutar` cuando no hay contexto vigente queda autorizada: otra transacción de la API abierta desde
  `fn` (`sequelize.transaction()`), aunque fije una empresa a mano, lanza error en cada consulta
  (criterio 22c). El texto SQL que fija la empresa (`SQL_FIJAR_CONTEXTO`) y el registro de transacciones
  por autorizar no se pueden usar fuera de `apps/api/src/nucleo/` (regla de ESLint). Además, dentro
  del contexto solo pasan sentencias cuya primera palabra (en cada sentencia de un texto con varias,
  tras quitar comentarios) es `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`, `VALUES` o `TABLE`: `LISTEN`,
  `COPY`, `DECLARE`, `EXPLAIN`, `SHOW`, `CREATE`… lanzan `ConsultaProhibidaError` antes de la base
  (lista blanca, criterio 22d; no depende de nombres de funciones).
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

Una migración de datos que deba recorrer todas las empresas necesita, dentro de su propia
transacción, `ALTER TABLE x NO FORCE ROW LEVEL SECURITY`, el cambio de datos y
`ALTER TABLE x FORCE ROW LEVEL SECURITY` (el migrador es dueño de las tablas; sin `FORCE` no le
aplica la RLS).

## CI

`.github/workflows/ci.yml` corre en cada push y pull request, contra un servicio PostgreSQL 16:
`pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `build` y `test`.
