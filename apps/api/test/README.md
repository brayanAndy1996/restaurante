# Pruebas de la API (historias 001 y 002)

Pruebas de integración contra **PostgreSQL real** (sin mocks de la base). Vitest + SWC.
Los archivos van en `apps/api/test/**/*.spec.ts`; las pruebas protegidas de la historia 001 van en
`apps/api/test/aislamiento/` y las de la historia 002 en `apps/api/test/acceso/` (las reglas puras, en
`packages/dominio/test/`). Lo que hay en `test/utilidades/`, `test/global-setup.ts`, `test/fixtures/`, los
`*.spec.ts` de la raíz de `test/` y las carpetas `test/nucleo/`, `test/seguridad/` y `test/suscripciones/`
lo mantiene el desarrollador backend (no están protegidos).

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
   `consumo_comprobantes`, y una suscripción `BASE` para cada sucursal existente). Las del grupo C2:
   `202610280005-equipos.ts` (`equipo`, `equipo_recordado`, `sucursal_acceso` y las llaves hacia `equipo` de
   `sesion`, `auditoria` y de `creado_por_equipo_id` / `actualizado_por_equipo_id` de toda tabla trazada).

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

Lo que dejó la fase A (T1 a T5 de `specs/002-plataforma-y-acceso/tasks.md`). Al terminarla todo compilaba;
casi toda la lógica de acceso **no existía todavía**: las firmas de la ruta crítica lanzaban
`Error('No implementado')` y las rutas nuevas respondían 500 `ERROR_INTERNO`. Las pruebas de la fase B debían
fallar por eso (o por tablas, columnas y funciones que aún no existían), no por errores de importación. Hoy
esas firmas y rutas están implementadas (grupos C0 a C4); esta sección describe lo que fijó la fase A.

Desde el grupo C0 (T6 a T11) ya están **registrados** el guard global de autenticación y el resolutor de
sesión: toda ruta exige sesión (`Authorization: Bearer se.<empresa>.<sesión>.<secreto>`) salvo las
`@Publica()`, y la cabecera `x-empresa-id` solo vale con `NODE_ENV=test` y `EMPRESA_POR_HEADER=habilitado`
(modo de prueba: sin `Authorization`, principal de prueba con permisos de Administrador y actor `prueba`).
Con `development` la API no arranca si la cabecera está habilitada. Desde el grupo C0 segunda parte (T12 a
T18) funcionan el ingreso con contraseña y la sesión, los usuarios, los emisores y sucursales, el
superadministrador, el soporte y la idempotencia (ver el final de este archivo); la clave de supervisor (T38) funciona desde el grupo C3. Los planes y las suscripciones (T28) funcionan
desde el grupo C1; los equipos recordados, el ingreso con PIN y el acceso de la sucursal (T33 y T34), desde
el grupo C2.

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
(`PIN_PEPPER_LOCAL`, `ORIGENES_PERMITIDOS_LOCAL` en `src/config/entorno.ts`); en producción son obligatorias
desde el grupo C0 (`exigirEntornoDeProduccion`). `Entorno.PIN_PEPPER` es `string | undefined` y
`Entorno.ORIGENES_PERMITIDOS` es `string[]`. La regla de `EMPRESA_POR_HEADER` (criterio 7) se aplica desde el
grupo C0: la cabecera solo vale con `NODE_ENV=test`, y con `development` la API no arranca.

### Rutas de import de los símbolos nuevos (desde `apps/api/test/<carpeta>/`)

| Símbolo                                                                                                                                                                                                                                                         | Import                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `RELOJ`, `RelojManual`, `RelojSistema`, tipo `Reloj`                                                                                                                                                                                                            | `src/nucleo/reloj`                                                                  |
| `crearAplicacion({ reloj })`, `AppModule.registrar({ reloj })`                                                                                                                                                                                                  | `src/aplicacion`, `src/app.module`                                                  |
| tipo `Principal` (`{ tipo, empresaId, sesionId, usuarioId, superadministradorId, sucursalId, rol, esAdministrador, equipoId, equipoRecordadoId }`)                                                                                                              | `src/nucleo/principal` (también `src/modulos/seguridad`)                            |
| `ContextoEmpresa.ejecutar(empresaId, fn, { actor? })`, `ContextoEmpresa.fijarActor(actor)`, tipos `ActorTransaccion` (`{ usuarioId, equipoId? } \| { superadministradorId } \| { sistema }`) y `OpcionesEjecucion`                                              | `src/nucleo/contexto-empresa`                                                       |
| `AuditoriaService.registrar(entrada)`, `insertarAuditoriaPlataforma(transaccion, entrada)`, `AuditoriaModule`, tipos `EntradaAuditoria`, `EntradaAuditoriaPlataforma`                                                                                           | `src/modulos/auditoria`                                                             |
| Decoradores `Publica`, `SoloAdministrador`, `RequiereSucursal`, `Permiso(accion)`, `RequiereModulo(modulo)`, `Idempotente` y sus constantes de metadatos `PUBLICA`, `SOLO_ADMINISTRADOR`, `REQUIERE_SUCURSAL`, `PERMISO`, `REQUIERE_MODULO`, `IDEMPOTENTE`      | `src/modulos/seguridad`                                                             |
| `AutenticacionGuard`, `ResolutorEmpresaSesion`, `SesionActual` (`principal(): Principal`), `AutorizacionService` (`consumir({ autorizacionId, accion, entidad?, entidadId?, detalle? }): Promise<{ solicitanteId, autorizadorId, motivo }>`), `SeguridadModule` | `src/modulos/seguridad`                                                             |
| `Superadministrador` (decorador), `SUPERADMINISTRADOR`, `SuperadministradorGuard`                                                                                                                                                                               | `src/modulos/plataforma`                                                            |
| `SuscripcionService` (`estadoDeSucursal(sucursalId)`, `exigirAperturaDeCaja(sucursalId)`, `registrarComprobanteEmitido(sucursalId, instante: Date): Promise<{ periodo, emitidos, cuota, excedente }>`), tipos `EstadoDeSucursal`, `ConsumoRegistrado`           | `src/modulos/plataforma`                                                            |
| `crearSuperadministrador({ usuario, nombre, contrasena }): Promise<{ id }>`, `desactivarSuperadministrador({ usuario }): Promise<void>`                                                                                                                         | `scripts/lib/superadministrador` (toman `DATABASE_PLATAFORMA_URL` de `process.env`) |
| `sqlTrazabilidad(tabla, { columnaEmpresa? })`, `sqlTablaDeEmpresaTrazable(tabla, opciones)`                                                                                                                                                                     | `src/migraciones/sql-tabla-de-empresa`                                              |
| `rutasRegistradas(app)`, `rutasDeNest(app)`, `PIN_PEPPER_DE_PRUEBA`, `ORIGENES_PERMITIDOS_DE_PRUEBA`                                                                                                                                                            | `../utilidades`                                                                     |

Nota sobre el árbol de módulos: `AppModule` importa ahora `AuditoriaModule` y `SeguridadModule`, y
`PlataformaModule` exporta también `SuscripcionService` y `SuperadministradorGuard`. Todos los
servicios se obtienen con `app.get(Clase)`.

### Rutas registradas en la fase A (hoy todas tienen su lógica)

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
inválida responde 400 `DATOS_INVALIDOS`; en la fase A, una válida respondía 500 hasta implementar la ruta.
Los cambios de estado que fija `@HttpCode`: 204 en las salidas, `PUT /sesion/contrasena`,
`POST /usuarios/:id/contrasena` y los `DELETE`; 200 en `POST /usuarios/:id/pin`. `POST /sesion/equipo`
responde 201 con un equipo nuevo y 200 con uno ya conocido (T33).

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
- Firmas que la fase A dejó con `Error('No implementado')` (ruta crítica; hoy implementadas): `requisitoPermiso(rol, accion)`,
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

## Historia 002 · pruebas protegidas de los grupos 1 y 2, de las rondas adversariales y del dominio

Completan la tabla del grupo 3. Todas llevan la cabecera `// spec: 002-plataforma-y-acceso (pruebas protegidas)`. Las de los grupos 1 y 2 y las del dominio las escribió `test-writer` antes de la implementación; cada una de las rondas adversariales nace de fallas reproducidas por el adversarial, y su cabecera indica el criterio de cada falla. `acceso/fabrica-sesiones.ts` y `acceso/fabrica-equipos.ts` son los ayudantes de estas pruebas: solo usan los contratos públicos y, para leer filas, un cliente administrador.

| Archivo                                                                                   | Qué prueba                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acceso/sesion-rutas.spec.ts` (P1)                                                        | Criterios 1 a 9: rutas sin sesión o con un token malo, la empresa sale de la sesión, tokens adulterados, concurrencia, cambio de rol y desactivación, cabecera solo en `test`                                                |
| `acceso/ingreso-contrasena.spec.ts` (P2)                                                  | Criterios 10 a 17: ingreso, fallos indistinguibles, bloqueo de 15 minutos, inactividad y duración, contraseña temporal, cambio de contraseña, sucursal activa y salida                                                       |
| `acceso/usuarios-permisos.spec.ts` y `packages/dominio/test/largo-pin.spec.ts` (P3)       | Criterios 18 a 21, 21b y 23 a 25: solo el Administrador, nombres de usuario, accesos, largo del PIN y su cambio, respuestas sin secretos                                                                                     |
| `acceso/equipos-recordados.spec.ts` (P4)                                                  | Criterios 27 a 32b: recordar, máximo de 5 personas con reemplazo, revocar, olvidar y revocaciones automáticas                                                                                                                |
| `acceso/pin.spec.ts` (P5)                                                                 | Criterios 33 a 42: ingreso con PIN, bloqueos por persona en el equipo, sesión atada al equipo, cambio rápido, inactividad y `GET /sesion`                                                                                    |
| `acceso/clave-supervisor.spec.ts` y `packages/dominio/test/permisos.spec.ts` (P6)         | Criterios 43 a 53: matriz de permisos celda por celda, autorizaciones, rechazos, bloqueos, consumo, concurrencia y soporte                                                                                                   |
| `acceso/horario-acceso.spec.ts` y `packages/dominio/test/dentro-de-horario.spec.ts` (P11) | Criterios 12b y 105 a 112: horario en el ingreso, en la autorización y en las sesiones abiertas                                                                                                                              |
| `acceso/lint-fijar-actor.spec.ts`                                                         | Lint de `fijar_contexto_actor`, con el mismo trato que `fijar_contexto_empresa` (criterios 37, 22c y 22e de 001)                                                                                                             |
| `acceso/ataque-ronda1.spec.ts`                                                            | Ronda 1: bloqueo de contraseña con peticiones concurrentes, permisos de la respuesta de soporte y sesión de soporte de un superadministrador inactivo                                                                        |
| `acceso/ataque-ronda2.spec.ts`                                                            | Ronda 2: huella de idempotencia de `POST /autorizaciones`, campos desconocidos en `PATCH /sucursales/:id`, concurrencia del PIN y del máximo de 5 personas por equipo                                                        |
| `acceso/ataque-ronda3.spec.ts`                                                            | Ronda 3: saturación del pool con un usuario desactivado, clave de idempotencia como oráculo del PIN, carrera entre ingreso y baja del superadministrador, bloqueo borrado por un ingreso concurrente, desbloqueo por consola |
| `acceso/ataque-ronda4.spec.ts`                                                            | Ronda 4: ráfagas repartidas entre nombres reales, ingresos correctos simultáneos, tope de scrypt falso como oráculo de existencia, memoria de 2 s fuera de la ráfaga                                                         |
| `acceso/ataque-ronda5.spec.ts`                                                            | Ronda 5: inundación de nombres inventados contra el ingreso del superadministrador, nombres reales de una empresa atacados, cambio de contraseña en bucle, exceso de cola como oráculo de pertenencia                        |

No protegida, del grupo C4 (T41): `test/suscripciones/suspension.spec.ts` prueba `avisoSuscripcion` en `GET /sesion`, `exigirAperturaDeCaja` con un controlador sonda y el reloj, la reactivación con un pago, las rutas que siguen funcionando con la sucursal suspendida y que nada más en `src` consulta el estado (criterios 80 a 84).

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
  empresa, más `exigirAperturaDeCaja` y `avisoDeEmpresa` del grupo C4; los demás métodos reciben la transacción
  de `OperacionPlataforma`, entre ellos `avisoPlataforma` para el soporte), `PlanesService` (plan por defecto, 409 y auditoría), `SuscripcionesPlataformaService` y
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

## Historia 002 · grupo C2 (T32 a T34): equipos recordados, ingreso con PIN e inactividad

- **Migración** `202610280005-equipos.ts`: `equipo` (nombre y huella SHA-256 del secreto del token `eq.…`),
  `equipo_recordado` (equipo, persona, último uso, última sucursal elegida y, si se revocó, `revocado_en` con su
  motivo: `REVOCADO`, `OLVIDADO`, `REEMPLAZADO`, `BLOQUEO`, `DESACTIVADO` o `CONTRASENA_RESTABLECIDA`; un
  índice único parcial deja una sola fila activa por equipo y persona) y `sucursal_acceso` (minutos de
  inactividad PIN de la sucursal), las tres con `sqlTablaDeEmpresaTrazable` y sin privilegios para
  `restaurante_plataforma`. Agrega las llaves compuestas hacia `equipo` de `sesion.equipo_id`,
  `sesion.equipo_recordado_id` (junto con el equipo y la persona), `auditoria.equipo_id` (`NOT VALID`: la
  auditoría es inmutable) y `creado_por_equipo_id` / `actualizado_por_equipo_id` de toda tabla trazada que
  exista. Una tabla trazada nueva debe pedir `llaveDeEquipo: true` a `sqlTablaDeEmpresaTrazable` /
  `sqlTrazabilidad`. `db:revertir` borra las sesiones PIN, deja sin equipo las demás referencias y borra las
  tres tablas.
- **Servicios** (`src/modulos/seguridad`): `EquiposService` (recordar, consultar, listar, revocar y olvidar),
  `IngresoPinService` (`POST /sesiones/pin`), `AccesoSucursalService` (`GET`/`PATCH /sucursales/:id/acceso`) y
  `constantes-acceso.ts` (5 minutos de inactividad PIN, 12 horas, bloqueo cada 5 fallos y olvido al 15.º).
  `BloqueosService.registrarFalloAcumulado` cuenta los fallos del PIN sin reiniciarlos al vencer un bloqueo.
  `UsuariosService` revoca los equipos al desactivar y al restablecer la contraseña.
- **Qué hace cada ruta** (`POST /sesiones/pin` devuelve el error después de confirmar su transacción, así los
  fallos, el bloqueo y el olvido quedan guardados): `POST /sesion/equipo` y `POST /sesiones/pin` son `@SinEmpresa()` (el
  servicio abre su `ContextoEmpresa.ejecutar` porque el actor lleva el equipo, que puede ser nuevo); `GET /equipo`
  es pública; `POST /sesiones/pin` bloquea la fila del equipo (`FOR UPDATE`) para atender de uno en uno los
  intentos del mismo equipo (nunca dos sesiones PIN abiertas, ningún intento evade el bloqueo ni el 15.º fallo).
- **El guard** valida cada petición de una sesión PIN con el `X-Equipo` del mismo equipo (secreto incluido) y
  el equipo recordado activo; su inactividad es la de la sucursal activa (5 minutos por defecto y sin sucursal);
  toda sesión asociada a un equipo recordado revocado se cierra (`EQUIPO_REVOCADO`).
- **`GET /sesion`** devuelve `equipo` y, con la matriz de `packages/dominio` (`permisosDeRol`), `permisos`: la
  matriz de la tarea T37 se implementó junto con C2 porque `pin.spec.ts` (criterio 42) la exige.
- **Pruebas del desarrollador** (`test/seguridad/`): `equipos-pin.spec.ts` (concurrencia del ingreso con PIN y
  del olvido, auditoría de recordar sin repetirse, actor del equipo nuevo, llave compuesta de la sesión y
  migración de equipos subiendo, bajando con datos y volviendo a subir). `sembrado.ts` gana `insertarEquipo`
  (las llaves exigen que el equipo exista). Las pruebas de la raíz `rutas-acceso.spec.ts` y
  `sql-tabla-trazable.spec.ts` se actualizaron para C2.

## Historia 002 · grupo C3 (T37 y T38): clave de supervisor

- **T37:** la matriz de permisos (`requisitoPermiso`, `puedeAutorizar`, `alcanceReportes`, `permisosDeRol`) y `permisos`
  en `GET /sesion` se implementaron junto con C2 (`pin.spec.ts` los exige); C3 solo los revisó.
- **Migración** `202610280006-autorizaciones.ts`: `autorizacion` (sesión, solicitante, autorizador distinto, sucursal,
  equipo de la sesión, acción, motivo, `expira_en`, `usada_en`), con `sqlTablaDeEmpresaTrazable(…, { llaveDeEquipo: true })`
  y solo `SELECT`, `INSERT` y `UPDATE` para `restaurante_api`. Agrega `sesion (id, empresa_id)` único y la llave
  `auditoria.autorizacion_id` → `autorizacion` (`NOT VALID`: la auditoría es inmutable y sus filas viejas pueden nombrar
  autorizaciones que `db:revertir` borró). `down` conserva las filas de auditoría.
- **`POST /autorizaciones`** (`ClaveSupervisorService`, `@SinEmpresa()`): valida primero el rol del solicitante (`prohibido`
  → 403, `permitido` → 409; soporte y prueba son Administrador), luego, en su propia transacción con el solicitante y su
  equipo como actor, bloquea la fila del solicitante y la del equipo (`FOR NO KEY UPDATE`, así los intentos
  concurrentes no evaden el quinto fallo), mira los bloqueos (`CLAVE_USUARIO` y `CLAVE_EQUIPO`, 5 fallos, 5 minutos),
  busca al supervisor por la huella de su PIN y lo rechaza con el mismo cuerpo `CLAVE_INVALIDA` en cada caso
  (el motivo interno `PIN_INEXISTENTE`, `USUARIO_INACTIVO`, `PROPIO_SOLICITANTE`, `SIN_ROL_AUTORIZADOR` o
  `FUERA_DE_HORARIO` solo va al detalle de la auditoría). El error se lanza después de confirmar, así la cuenta y la
  fila `autorizacion_rechazada` quedan guardadas. Un bloqueo nuevo se audita (`bloqueo_clave`) en una segunda transacción
  con el actor `autenticacion`. La `Idempotency-Key` se maneja dentro del servicio (la ruta es `@SinEmpresa()`).
- **`@Permiso(accion)`** aplica `PermisoInterceptor` (dentro de la transacción del controlador): `prohibido` → 403
  `PROHIBIDO`, `permitido` → sigue, `clave` → exige `X-Autorizacion` (403 `CLAVE_REQUERIDA`) y llama
  `AutorizacionService.consumir`, un `UPDATE` condicional (misma sesión, persona, acción y sucursal; sin usar y
  `expira_en > ahora`) que resuelve la concurrencia; si no actualiza ninguna fila, 403 `AUTORIZACION_INVALIDA`.
  `consumir` deja también la fila de auditoría de la acción (solicitante como actor, `autorizado_por_id`, motivo y
  `autorizacion_id`) en la misma transacción: si la acción falla, se revierten las dos.
- **Pruebas del desarrollador** (`test/seguridad/clave-supervisor-servicio.spec.ts`): idempotencia de la ruta, diez PIN
  malos simultáneos (cinco 403 y cinco 429, un solo bloqueo), el actor de cada fila de auditoría, la fila de la acción
  con el equipo, `X-Autorizacion` mal formada o vencida con el reloj, y la migración (subir, bajar con datos y volver a
  subir).

## Historia 002 · correcciones de la revisión T45

Pruebas del desarrollador (no protegidas) añadidas al corregir los hallazgos de la revisión; no tocan ninguna
prueba protegida.

| Archivo                                               | Qué prueba                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nucleo/al-confirmar.spec.ts`                         | `ContextoEmpresa.alConfirmar`: el efecto corre solo con el COMMIT exitoso (no con ROLLBACK ni con un COMMIT fallido por una restricción `UNIQUE DEFERRABLE`), cada efecto aislado y registrado en el log, contexto anidado |
| `nucleo/idempotencia-reserva.spec.ts`                 | `reservarClave`, `completarClave` y `liberarClave` (`src/nucleo/idempotencia`): claves nuevas, completadas, en curso, reutilizadas, por empresa, retención de 24 h y reservas simultáneas                                  |
| `nucleo/sucursales-y-auditoria-entre-modulos.spec.ts` | `SucursalesConsultaService.existen` y `listar` (plataforma) y `AuditoriaService.detalleDeAccionDeSesion`, bajo la RLS de la empresa del contexto                                                                           |
| `seguridad/tope-de-intentos.spec.ts`                  | `TopeDeIntentos` con temporizadores falsos: tope de 10 simultáneos, turno en orden de llegada, espera máxima de 5 s, liberación cuando `fn` lanza, memorias de ráfaga y `olvidar`                                          |
| `seguridad/cupo-scrypt.spec.ts`                       | `CupoScrypt` y `capacidadDeScrypt` (con `UV_THREADPOOL_SIZE` y núcleos simulados): liberación cuando `fn` lanza, espera máxima de 2 s, tope de 64 esperas por grupo y turno entre grupos                                   |
| `seguridad/reglas-de-bloqueo.spec.ts`                 | `decidirReserva` (tabla de casos), `resolverFalloEnFila` y los errores compartidos `credencialesInvalidas`, `bloqueoTemporal` y `errorDeReserva`                                                                           |
| `seguridad/usuarios-trazabilidad.spec.ts`             | Trazabilidad y auditoría de `POST /usuarios` y `POST /usuarios/:id/contrasena` (Administrador con y sin equipo, soporte) y criterio 87 (`Idempotency-Key` no guarda nada en esas rutas)                                    |

Símbolos nuevos entre módulos: `SucursalesConsultaService` (`src/modulos/plataforma`), `AuditoriaService.detalleDeAccionDeSesion`,
`reservarClave`/`completarClave`/`liberarClave` (`src/nucleo/idempotencia`), `decidirReserva`, `resolverFalloEnFila`,
`bloqueoTemporal`, `credencialesInvalidas`, `errorDeReserva` y `claveDeIngresoSuperadministrador` (`src/modulos/seguridad`).
`DatosAdministradorInicial` recibe `hashContrasena` (calculado antes de abrir la transacción) en lugar de la contraseña.

## Historia 003 · grupo C1 (T6 a T10): estaciones, familias, productos simples y fotos

Pruebas del desarrollador (no protegidas) en `apps/api/test/carta/` y `packages/dominio/test/`; no tocan ninguna
prueba protegida (`carta-critica/`, `acceso/`, `aislamiento/` ni `packages/dominio/test/carta/`). Usan solo la
fábrica de `carta-critica/fabrica-permisos-carta.ts` (aplicación con `RelojManual`, `PublicadorEnMemoria` y
`AlmacenEnMemoria`, dos empresas, sesiones de contraseña y de PIN) y sus ayudantes propios en `carta/ayudas.ts`
(`sembrarBase`, `productoSimple` e imágenes de muestra: `jpegValido`, `webpValido`, `webpConPerdida` y
`webpExtendido`; el PNG sale de la fábrica protegida).

| Archivo                                              | Qué prueba                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `carta/estaciones-familias.spec.ts`                  | Criterios 1 a 5, 2b y 13: alta, nombre único, `EN_USO`, orden, 403 del Cajero en `POST` y `PATCH` de estaciones, auditoría con el antes y el después, un evento por escritura real y la trazabilidad (criterio 63)              |
| `carta/productos.spec.ts`                            | Criterios 6 a 12: alta de productos simples y reglas del criterio 7, referencias (422 con el mismo cuerpo para B e inexistente), `PATCH` con mezcla, no-op sin auditoría ni evento, desactivar y reactivar, y los 400 de C3/C4  |
| `carta/fotos.spec.ts`                                | Criterios 14 a 17: JPEG, PNG y WebP válidos, truncados, firma que no coincide, 199 y 2049 px, 1 MB y 1 MB + 1, 415, reemplazo con borrado posterior a la confirmación, fallo antes del `COMMIT` y en el `COMMIT`                |
| `carta/archivos.spec.ts`                             | `leerImagen`, `AlmacenEnDisco`, `AlmacenR2` (con un `fetch` falso), `ARCHIVOS_DRIVER` y sus reglas por entorno y el servidor estático de `/archivos` (solo `development` con `disco`)                                           |
| `carta/rls-base.spec.ts`                             | Criterios 63 a 66 para `estacion`, `familia` y `producto`: RLS por tabla, llaves compuestas, `CHECK` y trazabilidad. El archivo protegido `carta-critica/rls-carta.spec.ts` siembra las diez tablas y solo corre al final de C5 |
| `packages/dominio/test/precios-casos-limite.spec.ts` | Casos límite de `precios.ts` que no cubre la prueba protegida (repetidos, orden de las comprobaciones, configuración global de `decimal.js`)                                                                                    |

`fijarEntornoDePrueba` da ahora `ARCHIVOS_DRIVER=r2` con credenciales falsas cuando `nodeEnv` es `production`
(la API exige `r2` para arrancar en producción; ninguna prueba sale a la red) y `memoria` en los demás casos.

Qué sigue en rojo de las pruebas protegidas de la historia 003 y por qué: `rls-carta.spec.ts` (la siembra inserta en
las diez tablas, y faltan siete hasta C5), `linea-preparada.spec.ts` (`prepararLinea`, C5), `referencias-carta.spec.ts`
(`sembrarCarta` necesita grupos, combos y menú, y la vista y los agotados son de C5) y, en `cajero-carta.spec.ts` y
`permisos-carta.spec.ts`, todo lo que usa `sembrarCarta` (C4) o toca ajustes por sucursal (C2), grupos (C3), menú del
día (C4) o agotados (C5).

## Pendientes menores

- `apps/api/test/infraestructura.spec.ts:79` fija la base auxiliar `restaurante_test_infra` sin usar `BASE_DE_PRUEBA` (la variable de entorno que elige la base de pruebas, `restaurante_test` por defecto). Por eso dos corridas simultáneas contra la misma instancia de PostgreSQL pueden pisarse: cada una recrea esa base con `prepararBaseDeDatos({ recrear: true })`. Pendiente menor: que cada corrida use su propio nombre de base auxiliar.
