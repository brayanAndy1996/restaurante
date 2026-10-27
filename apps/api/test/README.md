# Pruebas de la API (historias 001 y 002)

Pruebas de integración contra **PostgreSQL real** (sin mocks de la base). Vitest + SWC.
Los archivos van en `apps/api/test/**/*.spec.ts`; las pruebas protegidas de la historia 001 van en
`apps/api/test/aislamiento/`. Lo que hay en `test/utilidades/`, `test/global-setup.ts`,
`test/fixtures/` y los `*.spec.ts` de la raíz de `test/` lo mantiene el desarrollador backend (no
están protegidos).

## Cómo correr

```bash
# Necesita un PostgreSQL 16 y un usuario administrador:
export DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm test                                  # todo el monorepo, vía turbo
pnpm --filter @restaurante/api test        # solo la API
pnpm --filter @restaurante/api exec vitest run test/aislamiento/rls-sql.spec.ts
```

Sin `DATABASE_ADMIN_URL` las pruebas de la API **fallan** con un mensaje claro (no se saltan). Las
pruebas unitarias de `packages/dominio` y `packages/contratos` no usan base de datos y siempre corren.
Contraseñas de los roles: `DB_PASSWORD_MIGRADOR|API|PLATAFORMA`; si faltan, `migrador_local`,
`api_local` y `plataforma_local`.

## Preparación de la base (`test/global-setup.ts`, una vez por ejecución)

1. Crea los roles que falten, de forma idempotente (`restaurante_migrador`, `restaurante_api`,
   `restaurante_plataforma`: `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`;
   `idle_in_transaction_session_timeout = 30s` en el de la API). Misma lógica que `pnpm db:preparar`
   (`scripts/lib/preparar-bd.ts`). También quita a esos dos roles el acceso al texto de consultas
   ajenas en la base de destino (criterio 38b) y el poder cancelar, terminar o enumerar sesiones ajenas
   (`pg_cancel_backend`, `pg_terminate_backend`, `pg_stat_get_backend_*`, `pg_signal_backend`; criterio
   38c); por eso `DATABASE_ADMIN_URL` debe ser superusuario.
2. `DROP DATABASE IF EXISTS restaurante_test WITH (FORCE)` y la crea con dueño `restaurante_migrador`.
3. `REVOKE ALL ... FROM PUBLIC` sobre la base y `CONNECT` para `restaurante_api` y `restaurante_plataforma`.
4. Corre las migraciones como migrador (`src/migraciones/`, umzug): `202610270001-plataforma-base.ts`
   crea las tablas `empresa`, `emisor`, `sucursal` y `auditoria_plataforma` (que la migración
   `202610280003-auditoria-general.ts` de la historia 002 reemplaza por `auditoria`) con su RLS forzada,
   políticas y privilegios; `202610270002-contexto-empresa-unico.ts` (criterio 22e) crea el esquema
   interno `contexto`, la tabla `contexto.sesion_empresa` y las funciones `fijar_contexto_empresa(uuid)`
   y `empresa_actual()`, que la RLS lee. Las de la historia 002 (grupo C0): `202610280001-acceso-base.ts`
   (esquema `autenticacion`, `usuario`, `acceso_sucursal`, `sesion`, `bloqueo_intentos`, `idempotencia`,
   `superadministrador`, `sesion_superadministrador`, `idempotencia_plataforma` y `empresa_de_usuario`),
   `202610280002-trazabilidad.ts` (`contexto.sesion_actor`, `fijar_contexto_actor`, `trazabilidad()` y el
   trigger en `empresa`, `emisor`, `sucursal`, `usuario` y `acceso_sucursal`) y
   `202610280003-auditoria-general.ts` (`auditoria`, que copia y reemplaza a `auditoria_plataforma`). Las
   del grupo C1: `202610280004-suscripciones.ts` (`plan` con `BASE`, `suscripcion`, `pago_suscripcion` y
   `consumo_comprobantes`, y una suscripción `BASE` para cada sucursal existente).

Cada archivo de prueba corre en su propio proceso; no hay que limpiar tablas porque cada prueba
crea sus propias empresas con UUID aleatorios.

## Utilidades (`test/utilidades/`, import: `'../utilidades'` desde `test/aislamiento/`)

`bd.ts`

- `BASE_DE_PRUEBA = 'restaurante_test'`.
- `NOMBRES_DE_ROLES`: `{ migrador: 'restaurante_migrador', api: 'restaurante_api', plataforma: 'restaurante_plataforma' }`.
- `type RolDePrueba = 'admin' | 'migrador' | 'api' | 'plataforma'`. `admin` es el usuario de
  `DATABASE_ADMIN_URL` (superusuario en estas máquinas: **salta la RLS**; úsalo solo para inspeccionar el catálogo).
- `urlDeRol(rol, baseDeDatos = BASE_DE_PRUEBA): string`, `urlsDePrueba(): Record<RolDePrueba, string>`.
- `abrirCliente(rol): Promise<pg.Client>`: cliente `pg` ya conectado como ese rol. Hay que cerrarlo con `await cliente.end()`.
- `conCliente(rol, async (cliente) => ...)`: abre, ejecuta y cierra siempre.

`entorno-app.ts`

- `fijarEntornoDePrueba({ poolMax = 2, nodeEnv = 'test', empresaPorHeader = true, extra })`: fija en
  `process.env` `DATABASE_URL` (como `restaurante_api`), `DATABASE_PLATAFORMA_URL` (como
  `restaurante_plataforma`), `NODE_ENV`, `EMPRESA_POR_HEADER=habilitado` (o lo borra con
  `empresaPorHeader: false`), `DB_POOL_MAX`, `PIN_PEPPER` (`PIN_PEPPER_DE_PRUEBA`, base64 de 32 bytes) y
  `ORIGENES_PERMITIDOS` (`ORIGENES_PERMITIDOS_DE_PRUEBA`, `http://localhost:5173`); `extra` agrega o, con
  `undefined`, borra variables. Se puede llamar varias veces en el mismo proceso.
- `rutasRegistradas(app)` y `rutasDeNest(app)` (`test/utilidades/rutas.ts`): ver "Historia 002, fase A".

## La aplicación de prueba

```ts
import { crearAplicacion } from '../../src/aplicacion';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import {
  OperacionPlataforma,
  PlataformaEmpresasService,
  SucursalService,
} from '../../src/modulos/plataforma';
import { fijarEntornoDePrueba } from '../utilidades';
import request from 'supertest';

fijarEntornoDePrueba({ poolMax: 2 });
const app = await crearAplicacion({ controladoresExtra: [MiSonda] }); // inicializada, sin puerto
const contexto = app.get(ContextoEmpresa);
const operacion = app.get(OperacionPlataforma);
const plataforma = app.get(PlataformaEmpresasService);
const sucursales = app.get(SucursalService);
await request(app.getHttpServer()).get('/sucursales').set('x-empresa-id', empresaA);
await app.close(); // siempre, en afterAll
```

- `crearAplicacion(opciones?: { controladoresExtra?: Type[]; logger?: false | LogLevel[]; reloj?: Reloj })`
  (`src/aplicacion.ts`) lee `process.env` **en cada llamada**, valida el entorno y rechaza con
  `EntornoInvalidoError` (`src/config/entorno.ts`) `EMPRESA_POR_HEADER=habilitado` con
  `NODE_ENV=production`. Incluye el filtro global de errores y el interceptor global. Los
  controladores extra se registran en `AppModule` (`AppModule.registrar({ controladoresExtra })`,
  `src/app.module.ts`) y pueden inyectar por constructor `ContextoEmpresa`, `OperacionPlataforma`,
  `PlataformaEmpresasService` y `SucursalService`.
- Los módulos exportan esos cuatro servicios y `ContextoEmpresaModule` es global.
- `NODE_ENV=test` silencia el registro de Nest.
- Para el criterio 29 basta `fijarEntornoDePrueba({ nodeEnv: 'production' })` +
  `await expect(crearAplicacion()).rejects.toThrow(/prohibido en producción/)`.

## Símbolos públicos y rutas de import

Desde `apps/api/test/aislamiento/` (carpeta `src/` = `../../src/`). Cada carpeta tiene `index.ts`.

| Símbolo                                                                                                         | Import                             |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `ContextoEmpresa` (`ejecutar<T>(empresaId, fn)`, `empresaActual()`)                                             | `src/nucleo/contexto-empresa`      |
| `ContextoEmpresaAusenteError`, `ContextoEmpresaConflictoError`                                                  | `src/nucleo/contexto-empresa`      |
| `RESOLUTOR_EMPRESA`, `ResolutorEmpresa` (interfaz), `ResolutorEmpresaNulo`, `ResolutorEmpresaPorCabecera`       | `src/nucleo/contexto-empresa`      |
| `SinEmpresa`, `SIN_EMPRESA`, `ContextoEmpresaInterceptor`, `ContextoEmpresaModule`                              | `src/nucleo/contexto-empresa`      |
| `OperacionPlataforma` (`ejecutar<T>({ actor, motivo, operacion, empresaId? }, fn: (tx) => Promise<T>)`)         | `src/modulos/plataforma`           |
| `OperacionPlataformaAnidadaError`                                                                               | `src/modulos/plataforma`           |
| `PlataformaEmpresasService` (`registrarEmpresa`, `agregarEmisor`, `agregarSucursal`, `listarEmpresas`)          | `src/modulos/plataforma`           |
| `SucursalService` (`listar`, `obtener`, `configurar`), `SucursalesController`, `PlataformaModule`               | `src/modulos/plataforma`           |
| tipos `AuditoriaPlataformaEntrada`, `ResultadoRegistroEmpresa`, `EmpresaResumen`, `OpcionesOperacionPlataforma` | `src/modulos/plataforma`           |
| `SaludController`, `SaludModule`                                                                                | `src/modulos/salud`                |
| `CONEXION_API`, `ConsultaProhibidaError`, `RolPrivilegiadoError`, `comprobarConexion`                           | `src/nucleo/base-de-datos`         |
| `OperacionPlataforma.consultar(fn)`, `OperacionPlataforma.registrarDatosDeAuditoria(tx, datos)`                 | `src/modulos/plataforma`           |
| `ErrorAplicacion`, `FiltroGlobalErrores`, `PipeUuid`, `PipeZod`                                                 | `src/nucleo/errores`               |
| `cargarEntorno`, `EntornoInvalidoError`, `ENTORNO`, tipo `Entorno`                                              | `src/config/entorno`               |
| `crearAplicacion`, `AppModule`                                                                                  | `src/aplicacion`, `src/app.module` |

Firmas de las operaciones de plataforma (los tipos de entrada son los de `@restaurante/contratos`):

```ts
registrarEmpresa(datos: RegistrarEmpresaEntrada, auditoria: { actor: string; motivo: string })
  : Promise<{ empresaId: string; emisores: { id: string; ruc: string }[]; sucursales: { id: string; nombre: string }[] }>
agregarEmisor(empresaId: string, datos: EmisorEntrada, auditoria): Promise<{ id: string; ruc: string }>
agregarSucursal(empresaId: string, datos: SucursalEntrada, auditoria): Promise<{ id: string; nombre: string }>
listarEmpresas(): Promise<{ id: string; nombre: string }[]>
```

(El spec solo fija el resultado de `registrarEmpresa`; los de `agregarEmisor`, `agregarSucursal` y
`listarEmpresas` son decisión del desarrollador, siguiendo el mismo estilo.)

### Archivos que fijan el criterio 37 (lint)

- Conexión de plataforma, **prohibida fuera de `apps/api/src/modulos/plataforma/`**:
  `apps/api/src/nucleo/base-de-datos/conexion-plataforma.ts` (exporta el token `CONEXION_PLATAFORMA`).
  Un archivo que lo importe, por ejemplo `import { CONEXION_PLATAFORMA } from '../../nucleo/base-de-datos/conexion-plataforma'`,
  debe fallar el lint fuera de `modulos/plataforma/` (y no fallar dentro).
- El único archivo autorizado a escribir los textos `app.empresa_id` y `fijar_contexto_empresa` (junto con las migraciones, criterios 37 y 22e):
  `apps/api/src/nucleo/contexto-empresa/contexto-empresa.ts` (clase `ContextoEmpresa`).
- Prueba de lint: `new ESLint({ cwd: <apps/api> }).lintText(codigo, { filePath })` con `filePath`
  absoluto bajo `apps/api/src/...`. `apps/api/eslint.config.js` (configuración plana) extiende la base
  de `packages/config` y agrega las dos reglas del criterio 37 (y 37b), que se aplican a
  `src/**/*.{ts,tsx,mts,cts}` y detectan también `import()`, `require`, `import x = require()` y los
  reexportes (las migraciones quedan fuera de la segunda porque su SQL nombra el parámetro; las pruebas y los
  scripts no son código de la API). El parser `apps/api/herramientas/parser-textos-calculados.js`
  pliega antes de las reglas las concatenaciones con `+`, las plantillas, `.concat()` sobre literales
  y `.join()` sobre arreglos de literales, así que `'app.'.concat('empresa_id')` y
  `['app', 'empresa_id'].join('.')` también fallan (criterio 37c).

## Crear las empresas A y B en las pruebas

Las tablas son `empresa`, `emisor`, `sucursal` y, desde la historia 002, `auditoria` (las filas de
plataforma llevan `origen = 'plataforma'`, `accion` y `actor_sistema` en lugar de `operacion` y `actor`).
Desde la historia 002 toda escritura por SQL en una tabla trazada necesita un actor fijado en la misma
transacción con `SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba')` (ver `fijarActorDePrueba`,
`conActor` y `comenzar` más abajo); sin actor la base responde 42501 "contexto de actor ausente", el mismo
SQLSTATE que un rechazo de RLS, así que las pruebas de aislamiento fijan el actor y comprueban que el
mensaje del error es el de la política ("row-level security"). Se crean así:

- Por la API: `await app.get(PlataformaEmpresasService).registrarEmpresa(datos, { actor: 'prueba', motivo: 'prueba' })`
  con `datos` de `RegistrarEmpresaEntrada` (nombre, al menos un emisor con RUC válido y al menos
  dos sucursales). Devuelve `{ empresaId, emisores: [{ id, ruc }], sucursales: [{ id, nombre }] }`.
  Hay que generar RUC válidos y únicos por empresa y por prueba (`validarRuc` de `@restaurante/dominio`;
  el RUC es único en todo el sistema y las pruebas comparten la base).
- A nivel SQL: un cliente `abrirCliente('plataforma')` (rol `restaurante_plataforma`, con INSERT en
  las cuatro tablas y política `acceso_plataforma`) y `INSERT INTO empresa ... RETURNING id`, luego
  `emisor` y `sucursal`. Para fijar el contexto de una empresa en una conexión de `restaurante_api`
  (criterio 22e): `BEGIN; SELECT fijar_contexto_empresa($1); ...; COMMIT`. La empresa se fija **una sola
  vez por transacción**: una segunda llamada falla con `42501` `contexto de empresa ya fijado`.
  `set_config('app.empresa_id', ...)` ya no da contexto (la RLS lee `empresa_actual()`, no el parámetro):
  solo sirve para los intentos que deben fallar.

### Ayudantes de `test/aislamiento/fabrica.ts`

- `enTransaccion(cliente, empresaId | null, fn, { confirmar?, actor? })`: `BEGIN`, el actor de sistema
  `prueba` (o el de `opciones.actor`; `false` para no fijar ninguno), `SELECT fijar_contexto_empresa($1)`
  (si `empresaId` no es `null`), `fn`, y `ROLLBACK` o `COMMIT`.
- `ACTOR_DE_PRUEBA`, `fijarActorDePrueba(cliente, sistema?)`, `comenzar(cliente, sistema?)` (`BEGIN` más el
  actor), `conActor(cliente, fn, { sistema?, confirmar? })` (transacción propia con actor, para escrituras
  sueltas) y `sinEmpresaConActor(cliente, fn)` (transacción con actor que siempre se revierte, para las
  sentencias que deben fallar por falta de contexto de empresa). El actor se fija **una sola vez por
  transacción** y muere con ella.
- Con `ContextoEmpresa.ejecutar` las pruebas que escriben pasan `{ actor: { sistema: 'prueba' } }`.
- `enTransaccionConSetConfig(cliente, valor, fn, { confirmar? })`: igual pero la única "fijación" es
  `set_config('app.empresa_id', valor, true)`; no da contexto, para los intentos de los criterios 19, 21 y 22e (c).
- `sentenciasDelCriterio19(cliente, empresaId)` y `exigirContextoAusente(cliente, empresaId, { enTransaccionAbierta? })`:
  las diez sentencias del criterio 19 y la comprobación de que todas fallan con `42501` `contexto de empresa ausente`.
- `crearEmpresaSql` (corre en una transacción con el actor `prueba`), `datosDeEmpresa`, `rucAleatorio`,
  `textoUnico`, `errorDe`, `fotoDeFila`.
- `nombres-prohibidos.ts`: la lista de nombres de la guarda (criterio 38e) con sus variantes, compartida por
  `guarda-nombres-api.spec.ts` y `guarda-nombres-plataforma.spec.ts`.

## Pruebas existentes (no protegidas)

- `infraestructura.spec.ts`: roles, base, permisos de la base, idempotencia de `prepararBaseDeDatos`, umzug con una migración de ejemplo (`fixtures/migraciones/`).
- `entorno.spec.ts`: validación de entorno (criterio 29).
- `aplicacion.spec.ts`: la fábrica `crearAplicacion`, controladores extra y que las rutas existen.
- `salud.spec.ts`: `GET /health` (criterios 5 y 6): 200 con la base disponible; 503 sin detalles en
  menos de 3 s con la base inaccesible (rol sin acceso, credenciales inválidas, puerto cerrado).
- `guarda.spec.ts`: la guarda de consultas de la API (ver abajo): consultas crudas fuera y dentro de
  `ContextoEmpresa.ejecutar`, la marca `sinEmpresa` y los intentos de cambiar el contexto con SQL.

## Pruebas protegidas de la fase E (criterios 22e, 38e y 40d)

En `test/aislamiento/`, con la cabecera `// spec: 001-base-multitenancy (pruebas protegidas)`:

- `contexto-unico.spec.ts` (22e a-e): `restaurante_api` directo por SQL, sin la guarda: `set_config` no cambia el
  contexto, segunda fijación rechazada, `fijar_contexto_empresa(NULL)`, `set_config` sin fijación, la fijación
  muere con la transacción, dos conexiones simultáneas y el catálogo del esquema `contexto`.
- `contexto-unico-api.spec.ts` (22e f): ataques de las rondas 4 y final por la API, guarda de
  `fijar_contexto_empresa` y fijación propia de `ContextoEmpresa.ejecutar`.
- `lint-fijar-contexto.spec.ts` (22e f, lint): el texto `fijar_contexto_empresa` fuera del servicio de contexto y de las migraciones.
- `errores-4xx.spec.ts` (40d): sonda propia con `HttpException`, guard, pipe e interceptor, ruta inexistente y 415 del analizador.
- `guarda-nombres-api.spec.ts` y `guarda-nombres-plataforma.spec.ts` (38e d, e): guarda por nombre.
- `sin-superusuario.spec.ts` (38e a, b, c, e): `prepararBaseDeDatos` con un administrador `CREATEROLE CREATEDB NOSUPERUSER`
  (rol y bases temporales de nombre aleatorio; los roles `restaurante_*` no se borran) y con superusuario más `omitir`.
  La opción `avisar` de `prepararBaseDeDatos` recibe el aviso de protecciones omitidas.

## Formato de los errores HTTP

`{ codigo, mensaje, campos? }`; `campos` es una lista de `{ campo, mensaje }` (`campo` con puntos para
anidar, por ejemplo `sucursales.0.rucEmisor`). Códigos: `DATOS_INVALIDOS`, `EMPRESA_NO_RESUELTA`,
`NO_ENCONTRADO`, `CONFLICTO`, `EMISOR_INVALIDO`, `CUERPO_DEMASIADO_GRANDE`, `ERROR_INTERNO` y, desde el
criterio 40d, `NO_AUTENTICADO` (401), `PROHIBIDO` (403), `METODO_NO_PERMITIDO` (405), `TIPO_NO_SOPORTADO` (415),
`DEMASIADAS_PETICIONES` (429) y `PETICION_INVALIDA` (cualquier otro 4xx). Todo 4xx conserva su estado con un
mensaje genérico fijo por código (también la ruta inexistente y el 415 del analizador de cuerpos); solo los
errores no previstos responden 500 `ERROR_INTERNO` sin detalles.

## `CONEXION_API` y el bloqueo de consultas sin contexto (criterio 22)

`CONEXION_API` (`src/nucleo/base-de-datos`, también en `index.ts`) es el token de Nest de la instancia
de Sequelize de la API (`restaurante_api`). Las pruebas la obtienen con `app.get<Sequelize>(CONEXION_API)`.
Esa instancia tiene instalada una guarda sobre `sequelize.query`, por donde pasan todas las
consultas (modelos, `queryInterface`, consultas crudas y las sentencias de transacción):

- **Fuera de `ContextoEmpresa.ejecutar`** cualquier `sequelize.query(...)` lanza
  `ContextoEmpresaAusenteError` **antes** de pedir una conexión al pool, así que no llega a la base.
  Tampoco sirve una transacción abierta a mano con `sequelize.transaction()`.
- **Dentro de `ContextoEmpresa.ejecutar`** una consulta cruda funciona: la guarda le inyecta la
  transacción de la petición (no hace falta pasar `transaction`) y la RLS limita las filas a la empresa.
- Dentro del contexto se rechazan (`ConsultaProhibidaError`) las sentencias que cambian la sesión o el
  contexto: `set_config`, cualquier mención del parámetro de contexto, `SET`, `RESET`, `DISCARD` y `DO`.
  Fijar el contexto otra vez en la misma transacción lanza `ContextoEmpresaConflictoError`.
- Dentro del contexto también se rechazan (`ConsultaProhibidaError`) las sentencias de control de
  transacción (`COMMIT`, `ROLLBACK`, `END`, `ABORT`, `SAVEPOINT`, `RELEASE`, `ROLLBACK TO`, `BEGIN`,
  `START TRANSACTION`, `PREPARE TRANSACTION`, `COMMIT/ROLLBACK PREPARED`), solas, entre varias sentencias o
  tras comentarios (criterio 22b). Usa el analizador `control-transaccion.ts` (ignora literales y
  comentarios, así que `'COMMIT'` como valor funciona). Solo el `COMMIT`/`ROLLBACK` propio de
  `ejecutar` pasa (`cierre-propio.ts`). Efecto: `sequelize.transaction({ transaction })` anidado
  (usa `SAVEPOINT`) no está permitido dentro de un contexto.
- Lista blanca (criterio 22d): dentro del contexto, la primera palabra de cada sentencia (sin
  comentarios, aceptando paréntesis de apertura) debe ser `SELECT`, `INSERT`, `UPDATE`, `DELETE`,
  `WITH`, `VALUES` o `TABLE`; todo lo demás (`LISTEN`, `COPY`, `DECLARE`, `EXPLAIN`, `SHOW`, `CREATE`…)
  lanza `ConsultaProhibidaError` antes de la base (`contieneSentenciaNoPermitida`, en
  `control-transaccion.ts`). Las sentencias internas (abrir y cerrar la transacción de Sequelize y
  la fijación de `ContextoEmpresa`, `SELECT fijar_contexto_empresa($1)`) pasan por su origen. También se
  rechazan, fuera de literales y comentarios, `set_config`, `pg_settings`, `ts_rewrite`, `ts_stat`,
  `query_to_xml*`, `cursor_to_xml*`, `fijar_contexto_empresa` (salvo la fijación propia) y, desde el criterio
  38e, `pg_stat_activity`, `pg_stat_get_activity`, `pg_cancel_backend`, `pg_terminate_backend`,
  `pg_signal_backend`, `pg_largeobject*`, `loread`, `lowrite`, `table_to_xml*`, `schema_to_xml*`,
  `database_to_xml*` y los prefijos `pg_stat_get_backend_` y `lo_` (con los límites de identificador del
  criterio). La guarda de plataforma aplica la misma lista. Ya no son la única barrera: la RLS lee la
  empresa de `contexto.sesion_empresa` (criterio 22e) y las revocaciones de `db:preparar`
  (`protegerEjecucionDeSql` y las de 38b, 38c y 38d) son una defensa adicional donde hay superusuario.

### La excepción `sinEmpresa: 'salud' | 'verificacion-roles'`

Solo hay dos consultas que pueden correr sin contexto, y se marcan con la opción
`{ sinEmpresa: 'salud' }` (`SELECT 1 AS ok`, del `GET /health`) o `{ sinEmpresa: 'verificacion-roles' }`
(la consulta de roles del arranque). La marca **no es un permiso general**: cada motivo acepta
únicamente su texto SQL exacto (constantes en `consultas-sin-empresa.ts`), sin `bind` ni
`replacements`, sin transacción y fuera de cualquier contexto de empresa u operación de plataforma.
Cualquier otro SQL marcado `sinEmpresa` lanza `ContextoEmpresaAusenteError`, igual que sin marca.
Aun así las dos consultas son inofensivas: leen el catálogo de PostgreSQL o devuelven una constante.
La conexión de plataforma solo acepta `verificacion-roles`.

Qué no garantiza la guarda: es una barrera de la API, no de la base. Código dentro del mismo proceso
que replique a mano el SQL exacto de `ContextoEmpresa` sobre una transacción propia obtiene el mismo
contexto que `ContextoEmpresa.ejecutar(empresa, …)`; para eso hay que escribir el parámetro de
contexto, que la regla de ESLint del criterio 37 prohíbe fuera de `contexto-empresa.ts`. La garantía de
fondo sigue siendo la RLS, que ningún rol de la aplicación puede apagar (criterios 7 a 9).

## Historia 002 · fase A: contratos públicos para las pruebas de la fase B

Lo que dejó la fase A (T1 a T5 de `specs/002-plataforma-y-acceso/tasks.md`). Todo compila; casi toda
la lógica de acceso **no existía todavía**: las firmas de la ruta crítica lanzan `Error('No implementado')`
y las rutas nuevas responden 500 `ERROR_INTERNO`. Las pruebas de la fase B deben fallar por eso (o por
tablas, columnas y funciones que aún no existen), no por errores de importación.

Desde el grupo C0 (T6 a T11) ya están **registrados** el guard global de autenticación y el resolutor de
sesión: toda ruta exige sesión (`Authorization: Bearer se.<empresa>.<sesión>.<secreto>`) salvo las
`@Publica()`, y la cabecera `x-empresa-id` solo vale con `NODE_ENV=test` y `EMPRESA_POR_HEADER=habilitado`
(modo de prueba: sin `Authorization`, principal de prueba con permisos de Administrador y actor `prueba`).
Con `development` la API no arranca si la cabecera está habilitada. Desde el grupo C0 segunda parte (T12 a
T18) funcionan el ingreso con contraseña y la sesión, los usuarios, los emisores y sucursales, el
superadministrador, el soporte y la idempotencia (ver el final de este archivo); siguen sin lógica
(responden 500 `ERROR_INTERNO`) las rutas de equipos recordados y PIN (T33 y T34), la clave de supervisor
(T38) y el acceso de la sucursal (T34). Los planes y las suscripciones (T28) funcionan desde el grupo C1.

### Reloj de la API y `RelojManual`

```ts
import { RELOJ, RelojManual, RelojSistema, type Reloj } from '../../src/nucleo/reloj';
import { crearAplicacion } from '../../src/aplicacion';

const reloj = new RelojManual('2026-11-02T08:00:00-05:00'); // Date, texto ISO con zona o milisegundos
fijarEntornoDePrueba();
const app = await crearAplicacion({ reloj }); // instala `reloj` como proveedor RELOJ
app.get(RELOJ) === reloj; // true
reloj.avanzar(15 * 60 * 1000); // +15 minutos (milisegundos; negativo retrocede)
reloj.fijar('2026-11-03T00:00:00-05:00'); // salta a otro instante
reloj.ahora(); // Date nuevo cada vez
```

- `RelojManual` no avanza solo. Sin argumento empieza en la hora real al crearlo.
- `crearAplicacion()` sin `reloj` usa `RelojSistema` (hora real). Cada aplicación tiene su reloj.
- `Reloj` es `{ ahora(): Date }`. Toda regla de tiempo de la API (inactividad, bloqueos, vencimientos,
  horario, `ocurrido_en` de la auditoría) tomará la hora de `RELOJ`, nunca de `now()` de la base.

### Variables de entorno nuevas

`PIN_PEPPER` (base64, al menos 32 bytes) y `ORIGENES_PERMITIDOS` (orígenes separados por coma, sin ruta
ni barra final). Con `NODE_ENV` `development` o `test` tienen valor por defecto
(`PIN_PEPPER_LOCAL`, `ORIGENES_PERMITIDOS_LOCAL` en `src/config/entorno.ts`); en producción todavía
pueden faltar (la obligatoriedad llega con T10). `Entorno.PIN_PEPPER` es `string | undefined` y
`Entorno.ORIGENES_PERMITIDOS` es `string[]`. La regla de `EMPRESA_POR_HEADER` **no cambió** todavía
(sigue valiendo con `development`; el criterio 7 llega en la fase C).

### Rutas de import de los símbolos nuevos (desde `apps/api/test/<carpeta>/`)

| Símbolo                                                                                                                                                                                                                                                         | Import                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `RELOJ`, `RelojManual`, `RelojSistema`, tipo `Reloj`                                                                                                                                                                                                            | `src/nucleo/reloj`                                                                   |
| `crearAplicacion({ reloj })`, `AppModule.registrar({ reloj })`                                                                                                                                                                                                  | `src/aplicacion`, `src/app.module`                                                   |
| tipo `Principal` (`{ tipo, empresaId, sesionId, usuarioId, superadministradorId, sucursalId, rol, esAdministrador, equipoId, equipoRecordadoId }`)                                                                                                              | `src/nucleo/principal` (también `src/modulos/seguridad`)                             |
| `ContextoEmpresa.ejecutar(empresaId, fn, { actor? })`, `ContextoEmpresa.fijarActor(actor)`, tipos `ActorTransaccion` (`{ usuarioId, equipoId? } \| { superadministradorId } \| { sistema }`) y `OpcionesEjecucion`                                              | `src/nucleo/contexto-empresa` (`actor` y `fijarActor` se aceptan e ignoran hasta T7) |
| `AuditoriaService.registrar(entrada)`, `insertarAuditoriaPlataforma(transaccion, entrada)`, `AuditoriaModule`, tipos `EntradaAuditoria`, `EntradaAuditoriaPlataforma`                                                                                           | `src/modulos/auditoria`                                                              |
| Decoradores `Publica`, `SoloAdministrador`, `RequiereSucursal`, `Permiso(accion)`, `RequiereModulo(modulo)`, `Idempotente` y sus constantes de metadatos `PUBLICA`, `SOLO_ADMINISTRADOR`, `REQUIERE_SUCURSAL`, `PERMISO`, `REQUIERE_MODULO`, `IDEMPOTENTE`      | `src/modulos/seguridad`                                                              |
| `AutenticacionGuard`, `ResolutorEmpresaSesion`, `SesionActual` (`principal(): Principal`), `AutorizacionService` (`consumir({ autorizacionId, accion, entidad?, entidadId?, detalle? }): Promise<{ solicitanteId, autorizadorId, motivo }>`), `SeguridadModule` | `src/modulos/seguridad`                                                              |
| `Superadministrador` (decorador), `SUPERADMINISTRADOR`, `SuperadministradorGuard`                                                                                                                                                                               | `src/modulos/plataforma`                                                             |
| `SuscripcionService` (`estadoDeSucursal(sucursalId)`, `exigirAperturaDeCaja(sucursalId)`, `registrarComprobanteEmitido(sucursalId, instante: Date): Promise<{ periodo, emitidos, cuota, excedente }>`), tipos `EstadoDeSucursal`, `ConsumoRegistrado`           | `src/modulos/plataforma`                                                             |
| `crearSuperadministrador({ usuario, nombre, contrasena }): Promise<{ id }>`, `desactivarSuperadministrador({ usuario }): Promise<void>`                                                                                                                         | `scripts/lib/superadministrador` (toman `DATABASE_PLATAFORMA_URL` de `process.env`)  |
| `sqlTrazabilidad(tabla, { columnaEmpresa? })`, `sqlTablaDeEmpresaTrazable(tabla, opciones)`                                                                                                                                                                     | `src/migraciones/sql-tabla-de-empresa`                                               |
| `noImplementado()`                                                                                                                                                                                                                                              | `src/nucleo/errores`                                                                 |
| `rutasRegistradas(app)`, `rutasDeNest(app)`, `PIN_PEPPER_DE_PRUEBA`, `ORIGENES_PERMITIDOS_DE_PRUEBA`                                                                                                                                                            | `../utilidades`                                                                      |

Nota sobre el árbol de módulos: `AppModule` importa ahora `AuditoriaModule` y `SeguridadModule`, y
`PlataformaModule` exporta también `SuscripcionService` y `SuperadministradorGuard`. Todos los
servicios se obtienen con `app.get(Clase)`.

### Rutas registradas (todas con su lógica pendiente)

Metadatos (`Reflect.getMetadata(CONSTANTE, manejador | clase)`): públicas con `@Publica()` (que implica
`@SinEmpresa()`) son exactamente `GET /health`, `POST /sesiones/contrasena`, `POST /sesiones/pin`,
`GET /equipo` y `POST /plataforma/sesiones`; el resto de `/plataforma/*` lleva `@Superadministrador()`
(en la clase); `/usuarios/*` y `/sucursales/:id/acceso` llevan `@SoloAdministrador()` en la clase;
`POST /emisores`, `POST /sucursales` y `PATCH /sucursales/:id` llevan `@SoloAdministrador()` en el
método; `POST /autorizaciones` lleva `@SinEmpresa()`, `@RequiereSucursal()` e `@Idempotente()`;
`PUT /sesion/contrasena` lleva `@SinEmpresa()`.

| Ruta                                                                              | Cuerpo / consulta (esquema de `@restaurante/contratos`) | Respuesta                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST /sesiones/contrasena`                                                       | `ingresoContrasenaEntradaSchema`                        | `ingresoRespuestaSchema`                                             |
| `POST /sesiones/pin` (`X-Equipo`)                                                 | `ingresoPinEntradaSchema`                               | `ingresoRespuestaSchema`                                             |
| `GET /sesion`                                                                     |                                                         | `sesionRespuestaSchema`                                              |
| `PUT /sesion/sucursal`                                                            | `elegirSucursalEntradaSchema`                           | `sesionRespuestaSchema`                                              |
| `PUT /sesion/contrasena`                                                          | `cambiarContrasenaEntradaSchema`                        | 204                                                                  |
| `DELETE /sesion`                                                                  |                                                         | 204                                                                  |
| `POST /sesion/equipo`                                                             | `recordarEquipoEntradaSchema`                           | `recordarEquipoRespuestaSchema`                                      |
| `GET /sesion/equipos`                                                             |                                                         | `equipoRecordadoRespuestaSchema[]`                                   |
| `DELETE /sesion/equipos/:equipoRecordadoId`                                       |                                                         | 204                                                                  |
| `GET /equipo` (`X-Equipo`)                                                        |                                                         | `equipoActualRespuestaSchema`                                        |
| `GET /usuarios`, `GET /usuarios/:id`                                              |                                                         | `usuarioRespuestaSchema`                                             |
| `POST /usuarios`                                                                  | `usuarioCrearEntradaSchema`                             | `usuarioCreadoRespuestaSchema` (con `pin`)                           |
| `PATCH /usuarios/:id`                                                             | `usuarioModificarEntradaSchema`                         | `usuarioModificadoRespuestaSchema` (`pin?`)                          |
| `POST /usuarios/:id/pin`                                                          |                                                         | 200 `pinRespuestaSchema`                                             |
| `POST /usuarios/:id/contrasena`                                                   | `restablecerContrasenaEntradaSchema`                    | 204                                                                  |
| `GET /usuarios/:id/equipos`                                                       |                                                         | `equipoRecordadoRespuestaSchema[]`                                   |
| `DELETE /usuarios/:id/equipos/:equipoRecordadoId`, `DELETE /usuarios/:id/equipos` |                                                         | 204                                                                  |
| `POST /autorizaciones`                                                            | `autorizacionEntradaSchema`                             | `autorizacionRespuestaSchema`                                        |
| `GET /emisores`, `POST /emisores`                                                 | `emisorCrearEntradaSchema`                              | `emisorRespuestaSchema`                                              |
| `POST /sucursales`                                                                | `sucursalCrearEntradaSchema` (sin `suscripcion`)        | `sucursalRespuestaSchema`                                            |
| `PATCH /sucursales/:id`                                                           | como en 001                                             | como en 001                                                          |
| `GET`, `PATCH /sucursales/:id/acceso`                                             | `sucursalAccesoEntradaSchema`                           | `sucursalAccesoRespuestaSchema`                                      |
| `POST /plataforma/sesiones`                                                       | `ingresoSuperadministradorEntradaSchema`                | `ingresoSuperadministradorRespuestaSchema`                           |
| `DELETE /plataforma/sesion`                                                       |                                                         | 204                                                                  |
| `GET /plataforma/empresas`, `GET /plataforma/empresas/:id`                        |                                                         | `empresaPlataformaResumenSchema[]`, `empresaPlataformaDetalleSchema` |
| `POST /plataforma/empresas`                                                       | `altaEmpresaEntradaSchema`                              | `altaEmpresaRespuestaSchema`                                         |
| `POST /plataforma/empresas/:id/emisores`                                          | `emisorPlataformaEntradaSchema`                         | `emisorRespuestaSchema`                                              |
| `POST /plataforma/empresas/:id/sucursales`                                        | `sucursalPlataformaEntradaSchema`                       | `sucursalPlataformaRespuestaSchema`                                  |
| `POST /plataforma/empresas/:id/soporte`                                           | `soporteEntradaSchema`                                  | `ingresoRespuestaSchema`                                             |
| `GET`, `POST /plataforma/planes`, `PATCH /plataforma/planes/:id`                  | `planCrearEntradaSchema`, `planModificarEntradaSchema`  | `planRespuestaSchema`                                                |
| `GET /plataforma/suscripciones?estado=`                                           | `suscripcionesConsultaSchema`                           | `suscripcionResumenSchema[]`                                         |
| `PATCH /plataforma/suscripciones/:id`                                             | `suscripcionModificarEntradaSchema`                     | `suscripcionRespuestaSchema`                                         |
| `POST /plataforma/suscripciones/:id/pagos`                                        | `pagoEntradaSchema`                                     | `pagoRegistradoRespuestaSchema`                                      |

Todas validan cuerpo, consulta y parámetros con esos esquemas antes de llegar a la lógica: una entrada
inválida ya responde 400 `DATOS_INVALIDOS`; una válida responde 500 hasta que se implemente la ruta.
Los cambios de estado que fija `@HttpCode`: 204 en las salidas, `PUT /sesion/contrasena`,
`POST /usuarios/:id/contrasena` y los `DELETE`; 200 en `POST /usuarios/:id/pin`. `POST /sesion/equipo`
responde hoy el 201 por defecto (el 200 del equipo ya conocido llega con T33).

### `rutasRegistradas(app)` y `rutasDeNest(app)` (`test/utilidades/rutas.ts`)

- `rutasRegistradas(app): { metodo, ruta }[]`: las rutas que Express tiene registradas (incluidas las de
  los `controladoresExtra`), con la ruta como `/usuarios/:id`. Es lo que debe recorrer la prueba del
  criterio 1 (no una lista fija).
- `rutasDeNest(app): { metodo, ruta, controlador, manejador }[]`: lo mismo, con la clase del controlador y
  el nombre del método, para leer los metadatos:
  `Reflect.getMetadata(PUBLICA, r.controlador.prototype[r.manejador])` y
  `Reflect.getMetadata(SOLO_ADMINISTRADOR, r.controlador)` (los decoradores de clase están en la clase).

### Contratos de `@restaurante/contratos` fijados por esta fase

- `comunes`: `rolSchema`, `rolAccesoSchema` (sin `ADMINISTRADOR`), `accionSchema`, `requisitoPermisoSchema`,
  `moduloSchema`, `claveIdempotenciaSchema`, `nombreUsuarioSchema` (acepta mayúsculas ASCII y las guarda en
  minúsculas; `^[a-z0-9._-]{3,50}$`), `nombreUsuarioIngresoSchema`, `contrasenaSchema` (8 a 128 caracteres,
  sin NUL ni sustitutos sueltos, sin recortar), `contrasenaIngresoSchema` (1 a 128: un PIN como contraseña
  es una contraseña incorrecta, no un 400), `pinSchema` (`^(\d{4}|\d{6})$`), `pinAutorizacionSchema`
  (`^\d{6}$`), `fechaSchema`, `montoSchema`, `motivoSchema` (`textoSchema(300)`), `minusculasAscii`.
- `errores`: `CODIGOS_ERROR` con los 17 códigos nuevos y `reintentarEnSegundos` opcional en `errorRespuestaSchema`.
- Las entradas nuevas son estrictas (un campo desconocido, como `empresaId` o `creadoPor*`, es 400).
  `sucursalEntradaSchema` y `emisorEntradaSchema` de 001 siguen sin ser estrictas; sus variantes HTTP
  (`sucursalCrearEntradaSchema`, `emisorCrearEntradaSchema`, `altaEmpresaEntradaSchema`…) sí.
- `sucursalEntradaSchema` gana `suscripcion?: { planId?, vencimiento? }`. El Administrador no puede
  enviarla (`sucursalCrearEntradaSchema` la excluye).

### Contratos de `@restaurante/dominio` fijados por esta fase

- Implementado y probado: `estadoSuscripcion`, `sumarMeses`, `fechaLima`, `periodoLima` (`suscripcion.ts`),
  `MODULOS`, `MAXIMO_PERSONAS_POR_EQUIPO`, `ROLES`, `ROLES_DE_ACCESO`, `ACCIONES`.
  `estadoSuscripcion({ vencimiento, diasGracia }, instante)` devuelve `{ estado, suspensionDesde,
diasRestantesGracia }` (`diasRestantesGracia` solo en gracia, si no `null`). Lanzan `RangeError` ante
  fechas o instantes inválidos.
- Firmas que lanzan `Error('No implementado')` (ruta crítica): `requisitoPermiso(rol, accion)`,
  `puedeAutorizar(rol, accion)`, `alcanceReportes(rol)` (`'TURNO' | 'SUCURSAL' | 'EMPRESA' | null`),
  `permisosDeRol(rol)` (`Record<Accion, RequisitoPermiso>`), `largoPin({ esAdministrador, roles })`
  (`4 | 6`) y `dentroDeHorario(tramos | null, instante: Date)`.

## Historia 002 · fase B, grupo 3: auditoría, plataforma, soporte, catálogo y trazabilidad

Pruebas protegidas (`// spec: 002-plataforma-y-acceso (pruebas protegidas)`) en `test/acceso/`. Usan la API real con
`RelojManual`, sin `EMPRESA_POR_HEADER` (salvo la prueba del principal de prueba), el superadministrador creado con
`crearSuperadministrador`, las empresas dadas de alta con `POST /plataforma/empresas` y los usuarios creados con
`POST /usuarios`. Los títulos llevan `[C0]` a `[C3]` según el grupo de la fase C que crea lo que se prueba (C0:
transversal, C1: suscripciones, C2: equipos y PIN, C3: clave de supervisor).

| Archivo                         | Criterios                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auditoria.spec.ts`             | 54 a 60: inmutabilidad, aislamiento, migración de `auditoria_plataforma` (base aparte, revertir y volver), contenido de cada fila, una fila por acción, secretos, hora del reloj |
| `plataforma-http.spec.ts`       | 61 a 65: superadministradores, rutas `/plataforma/*`, alta de empresa, emisores y sucursales, consultas                                                                          |
| `soporte.spec.ts`               | 66 a 68 (y 61 y 62 en lo de soporte): sesión de soporte, aislamiento y mezcla de credenciales                                                                                    |
| `catalogo-acceso.spec.ts`       | 88 a 90: privilegios y políticas de las tablas nuevas, esquemas internos, `empresa_de_usuario`, unicidad global                                                                  |
| `rls-acceso.spec.ts`            | 91: lectura, actualización, borrado e inserción entre empresas en las 13 tablas nuevas, con actor fijado                                                                         |
| `catalogo-trazabilidad.spec.ts` | 113, 114, 115, 116 y 118: recorrido de `pg_catalog`, `fijar_contexto_actor`, SQL con y sin actor, migración de 001                                                               |
| `trazabilidad.spec.ts`          | 114, 115, 117, 119 y 120: actor según la vía, cuerpo de la petición, 500 sin actor, 100 escrituras concurrentes                                                                  |

Ayudantes en `test/acceso/fabrica-plataforma.ts` (import `./fabrica-plataforma`):

- `arrancar({ poolMax?, inicio?, controladoresExtra? })` → `{ app, reloj, http(), cerrar() }` (API real con `RelojManual`).
- `nuevoSuperadmin(ctx)`, `altaEmpresa(ctx, sa, { emisores?, sucursalesPorEmisor?, ajustar?, conSesion? })`
  (devuelve `{ empresaId, emisores, sucursales, suscripciones, admin: { id, usuario, contrasena, pin, token } }`),
  `crearUsuario`, `crearUsuarioConSesion`, `ingresar`, `ingresarOk`, `cambiarContrasena`, `elegirSucursal`,
  `recordarEquipo`, `partesDeToken`, `conEmpresa`, `bearer`, `exigirEstado`.
- `filasDeAuditoria(admin, condicion, parametros)`, `filaPorId(admin, tabla, id)`, `checkAcepta(admin, tabla, valores)`
  (comprueba el sentido de un `CHECK` con una copia temporal de la tabla).
- `crearBaseNueva(etiqueta)`, `migrarHasta(base, prefijo?)`, `revertirHasta(base, prefijo)`: bases temporales para probar
  migraciones con filas de 001 (`PREFIJO_*` de las migraciones nuevas).
- Las sondas de las pruebas de 001 son ahora `@Publica()` (las rutas están protegidas por defecto, criterio 1).

## Historia 002 · grupo C0, primera parte (T6 a T11): pruebas del desarrollador

En `test/seguridad/` (no protegidas; lo que las pruebas protegidas de `test/acceso/` no alcanzan mientras
falten T12 y siguientes). Siembran por SQL lo que el ingreso y el alta de usuarios crearán más adelante:

| Archivo                       | Qué prueba                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sembrado.ts`                 | Ayudantes: `insertarUsuario`, `insertarSesion` (devuelve el token en claro) e `insertarSuperadministrador`, más la instancia `credenciales`                                               |
| `credenciales.spec.ts`        | T9: scrypt de contraseñas, huella HMAC del PIN, generación del PIN único, secretos y huellas de tokens, comparación en tiempo constante y formato de los tokens                           |
| `autenticacion-guard.spec.ts` | T10: guard global (401 sin abrir contexto), principal, renovación e inactividad con el reloj, rol y acceso en cada petición, reglas de ruta, soporte, trazabilidad, CORS y modo de prueba |
| `contexto-actor.spec.ts`      | T7 y T9: `ContextoEmpresa.ejecutar(…, { actor })` y `fijarActor`, la guarda ante `fijar_contexto_actor` y la consulta fija `autenticacion` (`buscarEmpresaDeUsuario`)                     |
| `auditoria-servicio.spec.ts`  | T8: `AuditoriaService.registrar`, la auditoría de `OperacionPlataforma` (actor de texto o `{ superadministradorId }`, hora del reloj, todo o nada) y que el actor lo pone la base         |
| `horario-service.spec.ts`     | T11: `HorarioService` con el reloj de la API                                                                                                                                              |

Símbolos nuevos (desde `test/seguridad/`): `Credenciales`, `armarToken*`/`parsearToken*` (`src/modulos/seguridad`);
`HorarioService`; `buscarEmpresaDeUsuario` y `SQL_EMPRESA_DE_USUARIO` (`src/nucleo/base-de-datos/consultas-sin-empresa`);
`SQL_FIJAR_ACTOR` (`src/nucleo/fijar-contexto`, solo dentro de `src/nucleo/` por la regla de lint);
`ConexionPlataforma.fijarActor` (lo llama `OperacionPlataforma`); `PrincipalInterceptor` y `principalActual`
(`src/nucleo/principal`); `exigirEntornoDeProduccion` (`src/config/entorno`: en producción `PIN_PEPPER` y
`ORIGENES_PERMITIDOS` son obligatorias al crear la aplicación).

## Historia 002 · grupo C0, segunda parte (T12 a T18)

Lo que hay ahora además de lo anterior:

- **Rutas con lógica:** `POST /sesiones/contrasena`, `GET /sesion`, `PUT /sesion/sucursal`,
  `PUT /sesion/contrasena`, `DELETE /sesion`; `/usuarios` (lista, alta, edición, PIN, contraseña);
  `GET /emisores`, `POST /emisores`, `POST /sucursales` y `PATCH /sucursales/:id` (con su auditoría);
  `POST /plataforma/sesiones`, `DELETE /plataforma/sesion`, `GET /plataforma/empresas` (y `/:id`),
  `POST /plataforma/empresas` (con el primer Administrador y su PIN), `POST /plataforma/empresas/:id/emisores`,
  `/sucursales` y `/soporte`. La suscripción de cada sucursal (`suscripcion` en las respuestas, `PLAN_INVALIDO`,
  vencimientos) llegó con C1 (ver "grupo C1" al final).
- **Funciones y servicios nuevos** (desde `test/<carpeta>/`): `SesionesService`, `UsuariosService`,
  `BloqueosService` y las funciones `insertarAdministradorInicial`, `administradoresDeEmpresa`,
  `insertarSesionSoporte` y `cerrarSesionesDeSuperadministrador` (`src/modulos/seguridad`);
  `SuperadministradoresService`, `SoporteService`, `EmisoresService` y `SuperadministradorActual`
  (`src/modulos/plataforma`); `IdempotenciaInterceptor` y `leerClaveIdempotencia`
  (`src/nucleo/idempotencia`); `crearSuperadministrador` y `desactivarSuperadministrador`
  (`scripts/lib/superadministrador`, con el actor `cli:superadmin`, sobre `OperacionPlataforma` y la
  conexión de plataforma del entorno).
- **Opciones nuevas:** `OperacionPlataforma.ejecutar({ …, idempotencia: { clave, ruta, actor, cuerpo } })`
  guarda y devuelve la respuesta de una operación idempotente de plataforma; `ErrorAplicacion` acepta
  `reintentarEnSegundos` (el filtro lo agrega al cuerpo y a `Retry-After`).
- **Detalles que las pruebas deben conocer:** `idempotencia` e `idempotencia_plataforma` no dan `UPDATE`,
  así que la fila `en_curso` se reemplaza por la `completada` (DELETE + INSERT en la misma transacción);
  la API no puede leer `superadministrador`, así que el nombre de quien da soporte en `GET /sesion` sale
  de la fila `inicio_soporte` de la auditoría; un ingreso con contraseña fija el actor después de
  verificarla (el usuario si es correcta, `autenticacion` si no) y la respuesta de error se lanza después
  de confirmar la transacción, por eso los fallos y el bloqueo quedan guardados.
- **Pruebas del desarrollador nuevas** (`test/seguridad/`): `idempotencia.spec.ts` (T17: repetición, otro
  cuerpo, otra ruta, otro usuario, empresas A y B, errores no guardados, concurrencia, retención de 24 horas y
  la idempotencia de plataforma) y `sesiones-y-usuarios.spec.ts` (nombre del soporte, último Administrador
  con cambios concurrentes, desactivar y cambiar la propia contraseña).
- **Semilla:** `pnpm db:semilla` crea el superadministrador `superadmin` y las dos empresas de demostración
  con un usuario por rol (ver el README de la raíz).

## Historia 002 · grupo C1 (T25 a T29): suscripciones, planes, pagos, módulos y cuota

- **Migración** `202610280004-suscripciones.ts`: `plan` (global, sin `empresa_id`: `restaurante_api` solo lee, con
  la política `lectura_api`; un solo plan por defecto, siempre activo; la migración crea `BASE`), `suscripcion`,
  `pago_suscripcion` (inmutable: un trigger por sentencia rechaza `UPDATE`, `DELETE` y `TRUNCATE`, también al
  dueño) y `consumo_comprobantes`, las tres con `sqlTablaDeEmpresaTrazable`. Una suscripción `BASE` para cada sucursal
  existente (vencimiento un mes después de hoy en Lima, actor `migracion:suscripciones`). `sqlTablaDeEmpresa`
  acepta ahora `privilegiosApi: []` (tabla sin ningún privilegio para la API, como `pago_suscripcion`).
- **Servicios** (`src/modulos/plataforma`, desde `'../../src/modulos/plataforma'`): `SuscripcionService`
  (`estadoDeSucursal`, `registrarComprobanteEmitido`, `modulosDeSucursal` y `crearParaSucursal` con contexto de
  empresa; los demás métodos reciben la transacción de `OperacionPlataforma`; `exigirAperturaDeCaja` llega con
  C4), `PlanesService` (plan por defecto, 409 y auditoría), `SuscripcionesPlataformaService` y
  `SuscripcionModule` (global, sin dependencias: lo usan la sesión y `ModuloInterceptor`).
  `PlataformaEmpresasService.registrarEmpresa` y `agregarSucursal` siguen devolviendo `{ id, nombre }` y crean la
  suscripción; `registrarEmpresaConSuscripciones` y `agregarSucursalPorHttp` la devuelven (alta por HTTP).
  `SucursalService.crear` devuelve `{ sucursal, suscripcion }`.
- **Rutas:** `GET`, `POST` y `PATCH /plataforma/planes`; `GET /plataforma/suscripciones`;
  `PATCH /plataforma/suscripciones/:id`; `POST /plataforma/suscripciones/:id/pagos` (con `Idempotency-Key`). El alta
  por HTTP responde con `suscripcion` en cada sucursal; `PLAN_INVALIDO` (422) con un plan inexistente o inactivo y
  400 con un vencimiento anterior a hoy (el alta no admite vencimientos pasados: se ajustan con
  `PATCH /plataforma/suscripciones/:id`).
- **`@RequiereModulo(modulo)`** (`src/modulos/seguridad`): implica `@RequiereSucursal()` y aplica `ModuloInterceptor`
  (403 `MODULO_NO_INCLUIDO` si el plan vigente de la sucursal activa no lo incluye). `GET /sesion`, el ingreso con
  contraseña, `PUT /sesion/sucursal` y el soporte devuelven `modulos` (en el orden del catálogo; vacío sin
  sucursal activa). `SesionesService.armarRespuesta` es ahora asíncrono.
- **Pruebas del desarrollador** (`test/suscripciones/`, no protegidas; usan los ayudantes de
  `test/acceso/fabrica-plataforma.ts` y la API real con `RelojManual`):

| Archivo                            | Qué prueba                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planes.spec.ts`                   | T28 · criterio 75: lista, alta y cambios de planes, plan por defecto único y activo (409), módulos, auditoría sin empresa                                                                |
| `suscripciones-plataforma.spec.ts` | T28 · criterios 73, 74, 76, 79 y 83: lista por estado con el reloj, consumo del mes actual y anterior, cambio de plan y de vencimiento, pagos (validaciones, idempotencia, concurrencia) |
| `alta-con-suscripcion.spec.ts`     | T26 y T27 · criterios 63, 64, 69, 70 y 85: la suscripción en el alta por HTTP, por el servicio y por el Administrador, `PLAN_INVALIDO`, vencimientos, trazabilidad, idempotencia         |
| `suscripcion-servicio.spec.ts`     | T26 · criterios 71, 78 y 79: estado con el reloj, consumo por mes de Lima sin perder incrementos (pool de 2), módulos del plan                                                           |
| `modulos.spec.ts`                  | T29 · criterio 77: controlador sonda con `@RequiereModulo`, cambio de plan desde la siguiente petición, `modulos` en `GET /sesion`, el ingreso y el soporte                              |

Las pruebas que cambian el plan por defecto lo dejan siempre en `BASE` (la base de pruebas la comparten los demás archivos).
