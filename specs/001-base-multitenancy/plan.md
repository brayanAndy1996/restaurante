# 001 · Plan técnico

## Módulos afectados

Todo es nuevo; el repositorio solo tiene configuración.

- Raíz: `package.json` (`packageManager: pnpm@10.x`, `engines.node >= 22`), `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.editorconfig`, `.env.example`, `docker-compose.yml`, `README.md`, `.github/workflows/ci.yml`, y entradas nuevas en `.gitignore` (`node_modules`, `dist`, `.turbo`, `.env`, `coverage`).
- `packages/config`: `tsconfig.base.json`, `eslint.config.js` base (ESLint 9 con configuración plana y typescript-eslint), `prettier.config.js`.
- `packages/dominio`: `src/ruc.ts`, `src/dia-operativo.ts`, `src/horario.ts`, `src/regimen.ts`, `src/index.ts` y sus pruebas unitarias.
- `packages/contratos`: `src/plataforma.ts` (empresa, emisor, sucursal), `src/salud.ts`, `src/errores.ts`, `src/comunes.ts` (hora, horario, whatsapp, ruc), `src/index.ts`.
- `apps/api`:
  - `src/main.ts`, `src/app.module.ts`
  - `src/config/entorno.ts`: validación con zod de las variables de entorno; falla al arrancar si algo falta o si `EMPRESA_POR_HEADER=habilitado` con `NODE_ENV=production`.
  - `src/nucleo/base-de-datos/`: las dos instancias de Sequelize (API y plataforma), el adaptador CLS sobre `AsyncLocalStorage`, el hook que bloquea consultas sin contexto, la verificación de roles al arrancar y el mapeo de errores de PostgreSQL.
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

1. Crea los roles que falten con `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`, les asigna las contraseñas de `DB_PASSWORD_*` y fija `idle_in_transaction_session_timeout = '30s'` en `restaurante_api`.
2. Crea la base (`restaurante`, o la que indique el argumento) con dueño `restaurante_migrador`, si no existe.
3. Revoca `CONNECT`, `CREATE` y `TEMPORARY` a `PUBLIC` sobre la base y concede `CONNECT` a `restaurante_api` y `restaurante_plataforma`.

Es la única fuente de verdad para los roles: la usan `pnpm local:preparar` (con Docker), el entorno en la nube (PostgreSQL nativo) y la preparación de las pruebas. En producción (PostgreSQL administrado de DigitalOcean), el README indica correr el mismo script con el usuario administrador del proveedor. Ningún rol del sistema necesita `BYPASSRLS` ni ser superusuario, lo que también evita depender de atributos que un PostgreSQL administrado podría no conceder.

Los nombres de los roles son fijos (las políticas los nombran). Desarrollo y pruebas comparten el clúster y las contraseñas, pero usan bases distintas (`restaurante` y `restaurante_test`).

### Migraciones

- `umzug` 3 con `SequelizeStorage` (tabla `migraciones`), conectado con `DATABASE_MIGRADOR_URL`. Comandos `pnpm db:migrar` y `pnpm db:revertir`.
- Archivos `src/migraciones/AAAAMMDDHHMM-descripcion.ts` con `up` y `down` escritos en SQL (RLS, políticas, triggers y privilegios no se expresan bien con `queryInterface`).
- Cada migración que crea una tabla de empresa hace, en la misma migración: `ENABLE` y `FORCE ROW LEVEL SECURITY`, la política `aislamiento_empresa`, la política de plataforma si corresponde, y los `GRANT` explícitos. Una función auxiliar `sqlTablaDeEmpresa(nombre, privilegiosApi)` genera ese bloque para no repetirlo ni olvidarlo.
- Primera migración: función `empresa_actual()` y tablas `empresa`, `emisor`, `sucursal`, `auditoria_plataforma`, con sus políticas, privilegios y triggers (ver `spec.md`, "Cambios al modelo de datos").
- Migraciones de datos futuras que deban recorrer todas las empresas: dentro de su transacción, `ALTER TABLE x NO FORCE ROW LEVEL SECURITY`, el cambio de datos y `ALTER TABLE x FORCE ROW LEVEL SECURITY`. El migrador es dueño de las tablas, así que sin `FORCE` no le aplica la RLS. Se documenta en el README.

### Dos conexiones a la base

- **API** (`DATABASE_URL`, `restaurante_api`): pool de `DB_POOL_MAX`. Usa transacciones gestionadas con CLS.
- **Plataforma** (`DATABASE_PLATAFORMA_URL`, `restaurante_plataforma`): pool chico (2). La provee solo `PlataformaModule` y no se exporta. Una regla de ESLint (`no-restricted-imports`) prohíbe importar su proveedor fuera de `src/modulos/plataforma/`.
- Sequelize 6 sin `sequelize-typescript` ni `@nestjs/sequelize`: las instancias se crean en proveedores propios para controlar los hooks, el CLS y los dos pools. Los modelos se definen con una función `definirModelos(sequelize)` que se aplica a cada instancia; cada instancia tiene su propio juego de modelos.

### Contexto de empresa

```
Petición HTTP
  → guards (en 002: autenticación, que deja el usuario en la petición)
  → ContextoEmpresaInterceptor
       ¿la ruta tiene @SinEmpresa()?  sí → controlador sin transacción
       no → empresaId = RESOLUTOR_EMPRESA.resolver(petición)
            null → 401 EMPRESA_NO_RESUELTA
            UUID → ContextoEmpresa.ejecutar(empresaId, () => lastValueFrom(next.handle()))
                     ├─ AsyncLocalStorage.run({ empresaId, transaccion })
                     ├─ sequelize.transaction(async (t) => {
                     │     SELECT set_config('app.empresa_id', $1, true)   ← primera sentencia, con parámetro
                     │     controlador → servicios → modelos (toman t del CLS)
                     │  })
                     └─ commit o rollback: el valor local desaparece con la transacción
```

- `ContextoEmpresa` es el único archivo que escribe `app.empresa_id` (regla de ESLint `no-restricted-syntax` sobre el literal, con excepción para ese archivo).
- **CLS de Sequelize:** `Sequelize.useCLS(espacio)` con un adaptador sobre `AsyncLocalStorage` que implementa `run`, `get`, `set` y `bind`, que es lo que Sequelize 6 exige. Así todos los modelos usan la transacción de la petición sin pasarla a mano. Si el adaptador diera problemas, la alternativa es `cls-hooked`; las pruebas de concurrencia (criterio 26) deciden.
- **Bloqueo en la API:** un hook `beforeQuery` en la instancia de la API rechaza con `ContextoEmpresaAusenteError` toda consulta que no tenga una transacción abierta por `ContextoEmpresa` de esa misma instancia. Las únicas excepciones son consultas marcadas con una opción interna (`{ sinEmpresa: 'salud' | 'verificacion-roles' }`), usadas por `/health` y por la verificación de arranque. Hay que comprobar al implementar que `beforeQuery` existe en la versión de Sequelize 6 instalada; si no, se envuelve `sequelize.query`, por donde pasan todas las consultas.
- **Plataforma sin CLS:** `useCLS` es global para la clase `Sequelize`, y una transacción gestionada de plataforma quedaría en el mismo espacio CLS que la API. Para que no se mezclen, `OperacionPlataforma` usa transacciones no gestionadas (`await sequelize.transaction()`, que no tocan el CLS) y pasa `{ transaction }` explícita. Un hook `beforeQuery` en la instancia de plataforma exige que toda consulta lleve una transacción abierta por `OperacionPlataforma`. Además, mientras corre una operación de plataforma, el `AsyncLocalStorage` marca `{ plataforma: true }` y `ContextoEmpresa.ejecutar` falla si se lo llama ahí (criterio 28).
- **Anidamiento:** `ContextoEmpresa.ejecutar` con la misma empresa reutiliza la transacción; con otra lanza `ContextoEmpresaConflictoError`.
- **Fuera de HTTP:** colas, WebSockets y tareas programadas de historias futuras llaman `ContextoEmpresa.ejecutar` explícitamente. Queda escrito en el README como regla.

### Resolutor de empresa (enganche para 002)

- El token `RESOLUTOR_EMPRESA` se registra en `ContextoEmpresaModule` según la configuración: `ResolutorEmpresaPorCabecera` si `NODE_ENV` es `development` o `test` y `EMPRESA_POR_HEADER=habilitado`; si no, `ResolutorEmpresaNulo`.
- La validación del entorno rechaza `EMPRESA_POR_HEADER=habilitado` con `NODE_ENV=production`, y además el proveedor vuelve a comprobar `NODE_ENV` al construirse (dos barreras).
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
- `pnpm local:preparar` = `docker compose up -d --wait` + `db:preparar` + `db:migrar` + `db:semilla`. Si falta `.env`, lo crea a partir de `.env.example`. Luego `pnpm dev`.
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
| Sequelize 6 con proveedores propios | `@nestjs/sequelize` + `sequelize-typescript` | Control directo de dos instancias, sus hooks y el CLS; menos magia en la parte más delicada |
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
- **Mezcla de transacciones entre las dos instancias de Sequelize por el CLS global.** Mitigación: plataforma sin CLS y con transacción explícita, hooks `beforeQuery` en ambas instancias y el criterio 28.
- **El adaptador CLS sobre `AsyncLocalStorage` pierde el contexto en algún caso** (por ejemplo, con `EventEmitter` o librerías con callbacks). Mitigación: criterio 26 con concurrencia real y esperas; alternativa `cls-hooked`.
- **Transacciones largas por petición agotan el pool** cuando lleguen operaciones lentas (PSE, impresión). Mitigación: la convención de `CLAUDE.md` ya manda ejecutar los efectos secundarios después de confirmar; además se fija `idle_in_transaction_session_timeout` en el rol de la API (30 s).
- **Fuga por mensajes de error:** las violaciones de unicidad o de llave foránea podrían revelar datos de otra empresa. Mitigación: el filtro de errores nunca devuelve el detalle de PostgreSQL; las respuestas 404 y 422 no distinguen entre inexistente y ajeno.
- **Rendimiento de la RLS** con la función en la política. Mitigación: initplan con `(SELECT empresa_actual())` e índice por `empresa_id`; a 30 empresas el costo es despreciable.
- **TDD sin código previo:** las pruebas protegidas no compilan si no existen los contratos. Mitigación: la fase A de `tasks.md` deja el monorepo, la preparación de la base de pruebas y las firmas públicas (que lanzan "no implementado") antes de que escriba el test-writer.
- **Unión de `auditoria_plataforma` con la auditoría general en 002.** Habrá que migrar las filas existentes y convertir el `actor` de texto libre al id del superadministrador, sin perder la inmutabilidad (los triggers impiden `UPDATE` y `DELETE`). Mitigación: 002 decide si copia las filas a la tabla nueva conservando el actor original como texto o si mantiene la tabla actual como histórico de solo lectura; en 001 no se hace nada que lo complique.
- **Diferencias entre el PostgreSQL de Docker, el nativo de la nube y el administrado de producción.** Mitigación: el mismo script de preparación en todos, y ningún atributo especial de rol.
