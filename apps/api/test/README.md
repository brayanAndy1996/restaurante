# Pruebas de la API (historia 001)

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
   crea las tablas `empresa`, `emisor`, `sucursal` y `auditoria_plataforma` con su RLS forzada,
   políticas y privilegios; `202610270002-contexto-empresa-unico.ts` (criterio 22e) crea el esquema
   interno `contexto`, la tabla `contexto.sesion_empresa` y las funciones `fijar_contexto_empresa(uuid)`
   y `empresa_actual()`, que la RLS lee.

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
  `empresaPorHeader: false`) y `DB_POOL_MAX`; `extra` agrega o, con `undefined`, borra variables.
  Se puede llamar varias veces en el mismo proceso.

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

- `crearAplicacion(opciones?: { controladoresExtra?: Type[]; logger?: false | LogLevel[] })`
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

Las tablas son `empresa`, `emisor`, `sucursal` y `auditoria_plataforma`. Se crean así:

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

- `enTransaccion(cliente, empresaId | null, fn, { confirmar? })`: `BEGIN`, `SELECT fijar_contexto_empresa($1)`
  (si `empresaId` no es `null`), `fn`, y `ROLLBACK` o `COMMIT`.
- `enTransaccionConSetConfig(cliente, valor, fn, { confirmar? })`: igual pero la única "fijación" es
  `set_config('app.empresa_id', valor, true)`; no da contexto, para los intentos de los criterios 19, 21 y 22e (c).
- `sentenciasDelCriterio19(cliente, empresaId)` y `exigirContextoAusente(cliente, empresaId, { enTransaccionAbierta? })`:
  las diez sentencias del criterio 19 y la comprobación de que todas fallan con `42501` `contexto de empresa ausente`.
- `crearEmpresaSql`, `datosDeEmpresa`, `rucAleatorio`, `textoUnico`, `errorDe`, `fotoDeFila`.
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
