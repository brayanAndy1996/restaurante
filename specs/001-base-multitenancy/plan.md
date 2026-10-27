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
   - **SQL desde texto y `pg_settings` (22d):** `REVOKE EXECUTE` sobre todas las firmas de `ts_rewrite` y de `ts_stat`, `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `cursor_to_xml` y `cursor_to_xmlschema` (firmas enumeradas desde `pg_proc` por nombre, no con una lista fija de firmas), y `REVOKE UPDATE ON pg_settings`, a `PUBLIC` y a los dos roles. `SELECT` sobre `pg_settings` y `EXECUTE` sobre `set_config` y `current_setting` se mantienen: son de `PUBLIC`, quitarlos no aporta desde el criterio 22e (la RLS no lee `app.empresa_id`) y `fijar_contexto_empresa` llama `set_config` como su dueña para dejar la copia de diagnóstico. Nueva función en `scripts/lib/preparar-bd.ts` con la misma estructura que las de 38b a 38d (aplicar, comprobar con `has_function_privilege`/`has_table_privilege` por rol, mensaje que nombra el criterio).
   - Cada bloque comprueba al final, con `has_function_privilege`/`has_table_privilege` por rol, que quedó aplicado; si falta algo, falla con un mensaje que nombra el criterio. Es repetible: `REVOKE` de algo ya revocado no falla.

#### Modo sin superusuario (criterio 38e)

Decisión del usuario: en producción PostgreSQL será administrado, sin superusuario (DigitalOcean Managed u otro similar). El aislamiento entre empresas no depende del paso 4: la RLS y la fijación única del contexto (22e) las crea la migración con `restaurante_migrador`. Por eso `db:preparar` tiene un modo explícito para correr sin el paso 4:

- **Paso 0, antes de tocar nada:** validar `DB_PROTECCION_CATALOGO` (sin definir, vacía u `omitir`; cualquier otro valor falla nombrando la variable) y decidir si el administrador puede aplicar el paso 4: `rolsuper` de `current_user`, o `pg_has_role(current_user, <dueño de los objetos afectados de pg_catalog>, 'USAGE')` (el dueño se lee del catálogo, por ejemplo `proowner` de `lo_get` y `relowner` de `pg_largeobject`; es el superusuario de arranque). Se hace en la base `postgres`, que comparte esos datos con las demás (roles y dueño de arranque son del clúster).
- **Puede:** todo como hasta ahora; `omitir` se ignora (como mucho, una línea de `registrar` que lo diga), sin aviso de omisión.
- **No puede y sin `omitir`:** falla en el paso 0, sin crear ni modificar roles ni bases, con un mensaje que nombra 38b, 38c, 38d y 22d y explica `DB_PROTECCION_CATALOGO=omitir`.
- **No puede y con `omitir`:** pasos 1 a 3 como siempre, sin el paso 4, y al final `avisar(...)` con un texto que nombra cada protección omitida (38b, 38c, 38d y la capa de base de 22d) y dice que quedan solo en la guarda de la API y la de plataforma. `avisar` es una opción nueva de `prepararBaseDeDatos` (por defecto `console.warn`); el script de `pnpm db:preparar` termina con código 0.
- **Paso 1 con un administrador no superusuario (PostgreSQL 16):** para modificar un rol existente necesita `ADMIN OPTION` sobre él (el administrador de un PostgreSQL administrado la tiene sobre los roles que creó), y `ALTER ROLE` rechaza nombrar `SUPERUSER`, `BYPASSRLS` o `REPLICATION` aunque sea para negarlos (`NOSUPERUSER`…) si no es superusuario; `CREATE ROLE … NOSUPERUSER` sí funciona. Comprobarlo contra PostgreSQL 16 real y, si es así, en ese modo omitir esas tres cláusulas en el `ALTER ROLE` y verificar en `pg_roles` que el rol no tiene esos atributos (si los tiene, fallar nombrando el rol y el atributo, porque no se pueden quitar sin superusuario). El paso que ya hace `GRANT restaurante_migrador TO CURRENT_USER` para crear la base sigue igual.
- Las membresías en `pg_read_all_stats`, `pg_monitor` y `pg_signal_backend` son parte de 38b y 38c: sin superusuario no se pueden quitar y se omiten con el resto (lo cubre el aviso y la nota de despliegue de `spec.md`).

Es la única fuente de verdad para los roles: la usan `pnpm local:preparar` (con Docker), el entorno en la nube (PostgreSQL nativo), producción (PostgreSQL administrado, con `DB_PROTECCION_CATALOGO=omitir`) y la preparación de las pruebas. Ningún rol del sistema necesita `BYPASSRLS` ni ser superusuario, lo que también evita depender de atributos que un PostgreSQL administrado podría no conceder.

Los nombres de los roles son fijos (las políticas los nombran). Desarrollo y pruebas comparten el clúster y las contraseñas, pero usan bases distintas (`restaurante` y `restaurante_test`).

### Migraciones

- `umzug` 3 con `SequelizeStorage` (tabla `migraciones`), conectado con `DATABASE_MIGRADOR_URL`. Comandos `pnpm db:migrar` y `pnpm db:revertir`.
- Archivos `src/migraciones/AAAAMMDDHHMM-descripcion.ts` con `up` y `down` escritos en SQL (RLS, políticas, triggers y privilegios no se expresan bien con `queryInterface`).
- Cada migración que crea una tabla de empresa hace, en la misma migración: `ENABLE` y `FORCE ROW LEVEL SECURITY`, la política `aislamiento_empresa`, la política de plataforma si corresponde, y los `GRANT` explícitos. Una función auxiliar `sqlTablaDeEmpresa(nombre, privilegiosApi)` genera ese bloque para no repetirlo ni olvidarlo.
- Primera migración: función `empresa_actual()` y tablas `empresa`, `emisor`, `sucursal`, `auditoria_plataforma`, con sus políticas, privilegios y triggers (ver `spec.md`, "Cambios al modelo de datos").
- Segunda migración (criterio 22e): esquema `contexto`, tabla `contexto.sesion_empresa`, función `fijar_contexto_empresa` y `empresa_actual()` redefinida (ver "Fijación única del contexto en la base").
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
                     ├─ SELECT fijar_contexto_empresa($1)   ← primera sentencia; la base la acepta una
                     │                                        sola vez por transacción (22e) y la guarda
                     │                                        autoriza t (solo aquí, 22c)
                     ├─ AsyncLocalStorage.run({ empresaId, transaccion: t }, fn)
                     │     controlador → servicios → modelos → sequelize.query (guarda: toma t del almacén)
                     ├─ confirmarPropia(t) o revertirPropia(t)   ← única vía para COMMIT/ROLLBACK (22b)
                     └─ el estado se marca terminado: el valor local muere con t y el almacén ya no da
                        contexto al código que siga vivo (27b)
```

- **Sin CLS de Sequelize ni `beforeQuery`.** `Sequelize.useCLS` es global para toda la clase `Sequelize` y mezclaría la instancia de la API con la de plataforma, y `beforeQuery` no permite decidir de forma fiable con qué transacción corre la consulta. En su lugar, cada instancia tiene su propia **guarda**, que reemplaza `sequelize.query` de esa instancia (por ahí pasan modelos, `queryInterface`, consultas crudas y las sentencias de transacción). El estado de la operación (`{ empresaId, transaccion }` o `{ plataforma: true }`) vive en un `AsyncLocalStorage` propio (`estado-operacion.ts`).
- **Guarda de la API (`guarda-api.ts`):**
  - Toma la transacción de `options.transaction` o, si no hay, del almacén. Sin transacción de esa instancia, lanza `ContextoEmpresaAusenteError` antes de pedir una conexión al pool (criterio 22).
  - **Autorización de la transacción:** una transacción queda autorizada cuando en ella se ejecuta con éxito el SQL exacto de `ContextoEmpresa` (`SQL_FIJAR_CONTEXTO`) con un UUID, y solo si esa fijación la hace `ContextoEmpresa.ejecutar` al abrir un contexto nuevo (no hay estado activo). Una fijación hecha desde dentro de un contexto, en otra transacción abierta por `fn` con cualquier empresa, no autoriza (criterio 22c): la guarda debe distinguir la llamada propia de `ejecutar` (por ejemplo, con una marca efímera como la del cierre propio, o registrando la transacción antes de fijar) y no fiarse del texto. Fijar dos veces en la misma transacción falla (en la guarda y, desde 22e, también en la base). Las consultas de una transacción no autorizada lanzan error. `SQL_FIJAR_CONTEXTO` pasa a ser `SELECT fijar_contexto_empresa($1)`.
  - **Control de transacción:** `START TRANSACTION` pasa solo antes de la autorización; ya autorizada, solo pasan el `COMMIT` y el `ROLLBACK` del cierre propio (`cierre-propio.ts`: marca efímera mientras `ejecutar` llama `commit()`/`rollback()`). Toda otra sentencia de control se rechaza con el analizador de `control-transaccion.ts`, que quita literales (`'…'`, `E'…'`, `$$…$$`, `$etiqueta$…$etiqueta$`, identificadores entre comillas) y comentarios (`--`, `/* */` anidados) y mira la primera palabra de cada sentencia separada por `;`; un literal o comentario sin cerrar se rechaza (criterio 22b).
  - **Sesión y contexto:** `set_config`, la mención de `app.empresa_id` o de `fijar_contexto_empresa` (criterio 22e; salvo la fijación propia de `ejecutar`, reconocida por su origen), y `SET`/`RESET`/`DISCARD`/`DO` como sentencia se rechazan, pero la decisión se toma sobre el texto ya limpio por el mismo analizador, para que un literal con esos textos o con `;` no se rechace (aclaración del criterio 22b).
  - **Lista blanca de sentencias (criterio 22d):** en una transacción autorizada, el analizador de `control-transaccion.ts` (texto sin literales ni comentarios, partido por `;`, ignorando sentencias vacías y paréntesis de apertura iniciales) exige que la primera palabra de cada sentencia sea `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`, `VALUES` o `TABLE`; si no, error antes de pedir la conexión. La lista negra de palabras de control (22b) queda como mensaje más específico, pero la decisión de dejar pasar la toma la lista blanca. La mención de `set_config` y `pg_settings` fuera de literales se sigue rechazando (también con `pg_catalog.` y entre comillas dobles, que el analizador ya conserva); conviene mantener los nombres de funciones de SQL desde texto que ya rechaza y agregar `ts_rewrite`, pero la barrera contra ellas es la revocación en la base, porque su SQL va dentro de un literal y la guarda no lo interpreta. Donde no hay superusuario (producción, 38e) esa revocación no existe y la barrera es el rechazo del nombre de la función, que sí está fuera del literal; desde 22e, además, ese SQL no puede cambiar la empresa que ve la RLS. Excepciones internas, identificadas por su origen y no por el texto: la fijación de `ContextoEmpresa` (`SQL_FIJAR_CONTEXTO`, ya autorizada por 22c) y las sentencias con las que Sequelize abre y cierra la transacción (`START TRANSACTION`, `SET TRANSACTION ISOLATION LEVEL …`, y `COMMIT`/`ROLLBACK` del cierre propio), que hoy reconoce `consultas-sin-empresa.ts`.
  - **Lista de nombres del criterio 38e:** ampliar `MENCION_DE_CONTEXTO` de `control-transaccion.ts` (o una lista hermana con el mismo analizador, aplicada sobre `conNombres`, que ya conserva los identificadores entre comillas y da `null` ante `U&"…"`) con los nombres completos `pg_stat_activity`, `pg_stat_get_activity`, `pg_cancel_backend`, `pg_terminate_backend`, `pg_signal_backend`, `pg_largeobject`, `pg_largeobject_metadata`, `loread`, `lowrite` (límite de identificador a ambos lados) y los prefijos `pg_stat_get_backend_`, `lo_`, `table_to_xml`, `schema_to_xml` y `database_to_xml` (límite solo a la izquierda, como hoy `query_to_xml` y `cursor_to_xml`). Mismo carácter de identificador que ya usa el analizador (`[A-Za-z0-9_$\u0080-￿]`). Se aplica en toda transacción autorizada, haya o no superusuario. Conviene exportar la lista como dato (por ejemplo `NOMBRES_PROHIBIDOS` y `PREFIJOS_PROHIBIDOS`) para que la guarda de plataforma use exactamente la misma. Comprobar que ninguna consulta que Sequelize genera para los modelos actuales usa identificadores con esos prefijos (hoy ninguna).
  - **Cola por transacción (`cola-por-transaccion.ts`):** las consultas de una misma transacción se encolan y se mandan una tras otra (una conexión de `pg` no admite consultas solapadas), así `Promise.all` dentro de un controlador funciona.
  - Excepciones explícitas: las dos consultas fijas marcadas `{ sinEmpresa: 'salud' | 'verificacion-roles' }` (`consultas-sin-empresa.ts`), que se comparan por texto exacto.
- **Fin del contexto (criterio 27b):** al cerrar su transacción, `ejecutar` deja el estado del almacén como terminado (por ejemplo, un objeto de estado mutable con una marca `terminado`, o una referencia que se anula). `empresaActual()`, la guarda y los controles de anidamiento ignoran un estado terminado: el código que siga vivo con ese almacén no tiene contexto, puede abrir un `ejecutar` nuevo con cualquier empresa y puede llamar `OperacionPlataforma`. Lo mismo hace `OperacionPlataforma` con su estado `{ plataforma: true }` al terminar.
- **Guarda de plataforma (`conexion-plataforma.ts`):** exige que toda consulta lleve en `options.transaction` una transacción abierta por `ConexionPlataforma.abrirTransaccion()` dentro de una operación de plataforma vigente; nunca toma una transacción del almacén. Usa el mismo analizador para rechazar el control de transacción y de sesión, la misma cola por transacción y su propio cierre (`confirmar`/`revertir` con marca efímera, criterio 32b). Desde el criterio 38e también rechaza, con el mismo analizador y la misma lista de nombres y prefijos que la guarda de la API (incluidos `set_config`, `pg_settings`, `ts_rewrite`, `ts_stat`, `query_to_xml*`, `cursor_to_xml*`, `app.empresa_id` y `fijar_contexto_empresa`, este sin excepción), toda consulta de una transacción autorizada que los mencione fuera de literales y comentarios, o que tenga un identificador `U&"…"`; el error no es `DatabaseError` y la operación se revierte entera. La guarda de plataforma no tiene la lista blanca de 22d, pero ya rechaza `DO`, `PREPARE` y `SET`, que son las vías para ejecutar SQL dinámico sin nombrarlo. `consultar` abre la transacción con `SET TRANSACTION READ ONLY` antes de autorizarla y siempre la revierte.
- **Plataforma y empresa no se mezclan:** mientras corre una operación de plataforma el almacén marca `{ plataforma: true }`, `ContextoEmpresa.ejecutar` falla ahí y la guarda de la API no encuentra transacción (criterio 28); `OperacionPlataforma` falla si hay un contexto de empresa vigente.
- **Lint:** `ContextoEmpresa` es el único archivo que escribe `app.empresa_id` o `fijar_contexto_empresa` (criterio 22e; misma regla y mismas formas calculadas, con las migraciones también exentas) (regla `no-restricted-syntax`, que también mira concatenaciones de literales, criterio 22c, y los textos armados con `.concat()` y `.join()` de literales, criterio 37c: el parser de `apps/api/herramientas/parser-textos-calculados.js` calcula también esas llamadas, cuando el objeto y todos los argumentos son literales o textos ya calculados, y las reemplaza por el literal resultante antes de aplicar la regla), y `SQL_FIJAR_CONTEXTO` no se puede importar fuera de `src/nucleo/` (regla de importaciones con las mismas formas del criterio 37b).
- **Anidamiento:** `ContextoEmpresa.ejecutar` con la misma empresa, dentro de un contexto vigente, reutiliza la transacción sin volver a fijar (desde 22e la base rechazaría la segunda fijación con `42501`); con otra lanza `ContextoEmpresaConflictoError`.
- **Fuera de HTTP:** colas, WebSockets, tareas programadas y efectos secundarios posteriores a la confirmación llaman `ContextoEmpresa.ejecutar` explícitamente. Queda escrito en el README como regla.

### Fijación única del contexto en la base (criterio 22e)

Hasta aquí, la RLS leía `app.empresa_id` y `restaurante_api` podía cambiarlo con `set_config`: la única barrera contra un segundo `set_config` dentro de una transacción autorizada era la guarda. Quitar `set_config` a `PUBLIC` exige superusuario, que un PostgreSQL administrado no da. Por eso la empresa pasa a vivir en una tabla que los roles de la aplicación no pueden tocar, escrita una sola vez por transacción por una función `SECURITY DEFINER`. Todo lo crea una migración nueva (`src/migraciones/202610270002-contexto-empresa-unico.ts`) con `restaurante_migrador`, que es dueño de la base y puede crear esquemas; no hace falta superusuario.

Esquema del `up` (el SQL definitivo lo escribe el backend):

```sql
CREATE SCHEMA contexto AUTHORIZATION restaurante_migrador;
REVOKE ALL ON SCHEMA contexto FROM PUBLIC;

CREATE UNLOGGED TABLE contexto.sesion_empresa (
  pid        integer PRIMARY KEY,
  xid        xid8    NOT NULL,
  empresa_id uuid    NOT NULL
);
REVOKE ALL ON contexto.sesion_empresa FROM PUBLIC;

CREATE FUNCTION public.fijar_contexto_empresa(p_empresa uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_empresa IS NULL THEN
    RAISE EXCEPTION 'contexto de empresa inválido' USING ERRCODE = '22004';
  END IF;
  INSERT INTO contexto.sesion_empresa AS s (pid, xid, empresa_id)
  VALUES (pg_backend_pid(), pg_current_xact_id(), p_empresa)
  ON CONFLICT (pid) DO UPDATE
    SET xid = EXCLUDED.xid, empresa_id = EXCLUDED.empresa_id
    WHERE s.xid <> EXCLUDED.xid;
  IF NOT FOUND THEN  -- ya había una fila de esta transacción
    RAISE EXCEPTION 'contexto de empresa ya fijado' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.empresa_id', p_empresa::text, true);  -- solo diagnóstico
END
$fn$;
REVOKE ALL ON FUNCTION public.fijar_contexto_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fijar_contexto_empresa(uuid) TO restaurante_api;

CREATE OR REPLACE FUNCTION public.empresa_actual() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v uuid;
BEGIN
  SELECT s.empresa_id INTO v FROM contexto.sesion_empresa s
   WHERE s.pid = pg_backend_pid() AND s.xid = pg_current_xact_id_if_assigned();
  IF v IS NULL THEN
    RAISE EXCEPTION 'contexto de empresa ausente' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END
$fn$;
-- Se mantienen REVOKE a PUBLIC y GRANT EXECUTE a restaurante_api sobre empresa_actual().
```

- **Por qué funciona.** La fila se identifica por la sesión (`pg_backend_pid()`) y la transacción (`pg_current_xact_id()`, que en una subtransacción devuelve la de nivel superior). `empresa_actual()` usa `pg_current_xact_id_if_assigned()`: si la transacción no fijó nada no tiene `xid` propia que coincida, y la fila de una transacción anterior tiene otra `xid`, así que da `ausente` (criterios 19, 20 y 22e d). Las `xid8` son de 64 bits y no se repiten, así que una fila vieja de un `pid` reutilizado no da contexto. Como la tabla está en un esquema sin `USAGE` para los roles de la aplicación, solo las dos funciones (que corren como su dueña) la tocan, y `fijar_contexto_empresa` rechaza una segunda fijación en la misma transacción. Ningún `set_config` cambia lo que ve la RLS.
- **`CREATE OR REPLACE` de `empresa_actual()`** conserva las dependencias de las políticas existentes; no hay que tocar `sqlTablaDeEmpresa` ni las políticas. El initplan `(SELECT empresa_actual())` se mantiene.
- **`fijar_contexto_empresa` no es `STRICT`**: con `STRICT`, un `NULL` devolvería sin ejecutar y no fijaría nada en silencio.
- **`set_config(…, true)` dentro de la función**: la cláusula `SET search_path` de la función solo restaura `search_path` al salir; `app.empresa_id` fijado como local sigue vivo hasta el fin de la transacción, como copia de diagnóstico.
- **`down`**: restaura `empresa_actual()` como `SECURITY INVOKER` leyendo `current_setting('app.empresa_id', true)` (la definición de la primera migración, sin `SET search_path`), y elimina `fijar_contexto_empresa`, la tabla y el esquema. Revertir la migración obliga a revertir también `SQL_FIJAR_CONTEXTO`; se documenta en el propio archivo.
- **API:** `SQL_FIJAR_CONTEXTO` pasa a ser `SELECT fijar_contexto_empresa($1)`; la guarda la sigue autorizando por su origen (22c) y además rechaza toda otra mención de `fijar_contexto_empresa` fuera de literales y comentarios (con `public.` o entre comillas dobles), con el mismo analizador. El lint trata ese texto igual que `app.empresa_id`.
- **Pruebas no protegidas** que fijan el contexto con `set_config` (por ejemplo `apps/api/test/guarda.spec.ts` o `analizador-sql.spec.ts`, si alguna llega a la base): las ajusta el backend. Las protegidas las actualiza test-writer (P15).

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

### Errores HTTP 4xx (criterio 40d)

- `FiltroGlobalErrores` (`src/nucleo/errores/filtro-global-errores.ts`) decide en este orden:
  1. `ErrorAplicacion`: su estado, su código y su mensaje, como hoy (`EMPRESA_NO_RESUELTA`, `EMISOR_INVALIDO`, `DATOS_INVALIDOS` con `campos`, `NO_ENCONTRADO`…).
  2. Cuerpo demasiado grande: 413 `CUERPO_DEMASIADO_GRANDE`, como hoy (40b).
  3. Cualquier otro error con estado 4xx: una `HttpException` (`getStatus()` entre 400 y 499) o un error del analizador de cuerpos con la forma de `http-errors` (`status` o `statusCode` entero entre 400 y 499; por ejemplo el 415 de tipo `charset.unsupported` o `encoding.unsupported`). Responde ese mismo estado con el código de la tabla y un mensaje fijo por código, sin el texto de la excepción.
  4. Todo lo demás: 500 `ERROR_INTERNO`, con el detalle solo en el registro.
- Tabla de códigos por estado: 400 `DATOS_INVALIDOS`, 401 `NO_AUTENTICADO`, 403 `PROHIBIDO`, 404 `NO_ENCONTRADO`, 405 `METODO_NO_PERMITIDO`, 409 `CONFLICTO`, 413 `CUERPO_DEMASIADO_GRANDE`, 415 `TIPO_NO_SOPORTADO`, 429 `DEMASIADAS_PETICIONES`, resto de 4xx `PETICION_INVALIDA`. Los mensajes fijos viven junto a la tabla; el de 404 no repite la ruta (`Cannot GET /x` de Nest no sale).
- El JSON mal formado (40c) sigue traduciéndose antes, en `traducirErrorDeCuerpo`.
- Los códigos nuevos se agregan a `CODIGOS_ERROR` en `packages/contratos/src/errores.ts`.
- Prueba: un controlador sonda en el módulo de prueba lanza `HttpException` con 401, 403, 405, 418 y 429; la ruta inexistente y el 415 del analizador se prueban con peticiones reales.

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
- El modo sin superusuario (38e) se prueba sin otro servidor: con el superusuario de las pruebas se crea un rol temporal `LOGIN CREATEROLE CREATEDB NOSUPERUSER` con `ADMIN OPTION` sobre los tres roles de la aplicación (en PostgreSQL 16: `GRANT … WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`), se llama `prepararBaseDeDatos` con su URL sobre una base temporal y se migra con el migrador. Al terminar, el superusuario borra la base temporal y el rol (con `REASSIGN OWNED`/`DROP OWNED` si quedara algo a su nombre). Las pruebas siguen necesitando un `DATABASE_ADMIN_URL` superusuario.

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
- El README explica las dos vías: con Docker (un comando) y con PostgreSQL nativo (entorno en la nube), más cómo correr las pruebas. Desde el criterio 38e también la de producción con PostgreSQL administrado sin superusuario: `DB_PROTECCION_CATALOGO=omitir`, qué protecciones se omiten (38b, 38c, 38d y la capa de base de 22d), que quedan solo en la guarda de la API y la de plataforma, y las condiciones de la nota de despliegue de `spec.md` (sin extensiones como `pg_stat_statements`, `dblink` o `postgres_fdw` en la base de la aplicación, y sin membresías de los roles de la aplicación en `pg_monitor`, `pg_read_all_stats` ni `pg_signal_backend`). El párrafo actual que dice que el administrador debe ser superusuario y que, si no lo es, hay que pedir al proveedor que quite permisos, se reemplaza por esto. `.env.example` lleva `DB_PROTECCION_CATALOGO` comentada, con una línea que explica cuándo usar `omitir`.

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
| Función `empresa_actual()` que lanza un error claro | `current_setting('app.empresa_id')::uuid` directo en la política | Tras una transacción con contexto, el parámetro queda en `''` en esa conexión; el cast fallaría con un mensaje confuso, y con `missing_ok` devolvería `NULL` y 0 filas en silencio. La función distingue los casos y da un SQLSTATE fijo para mapearlo. Desde 22e ya no lee el parámetro, sino `contexto.sesion_empresa` |
| La empresa de la transacción vive en `contexto.sesion_empresa` (`UNLOGGED`, esquema sin `USAGE` para la aplicación), escrita una sola vez por transacción por `fijar_contexto_empresa` (`SECURITY DEFINER`) y leída por `empresa_actual()` (`SECURITY DEFINER`); `app.empresa_id` queda solo para diagnóstico (22e) | Seguir con `set_config('app.empresa_id', …, true)` y confiar en la guarda | Con `set_config` de `PUBLIC`, cualquier sentencia que pasara la guarda (un fallo del analizador, una función de SQL desde texto no revocada) cambiaba la empresa que ve la RLS. Ahora la base misma lo impide |
| (misma) | Quitar `EXECUTE` sobre `set_config` a `PUBLIC` y a `restaurante_api` | Exige superusuario, que un PostgreSQL administrado no da. La tabla interna se crea con el migrador en una migración |
| (misma) | `SECURITY DEFINER` que fija `app.empresa_id` una sola vez y falla si ya está fijado | Seguiría leyendo un parámetro que cualquier `set_config` posterior puede pisar; la garantía tiene que estar en un lugar que la aplicación no pueda escribir |
| (misma) | Tabla normal (con WAL) o tabla temporal | El contexto no necesita sobrevivir a un reinicio y `UNLOGGED` evita escribir WAL en cada transacción; una tabla temporal exigiría `TEMPORARY` para la API (revocado, criterio 8) y viviría en un esquema que el rol de la sesión controla |
| Filtro global que mapea todos los 4xx (40d), con mensajes fijos por código | Mapear solo 401 y 403 en la historia 002 | Cualquier 4xx no previsto (405, 415 del analizador de cuerpos, 429) terminaba en 500, lo que confunde a los clientes y ensucia el registro de errores |
| `(SELECT empresa_actual())` en la política | Llamar la función por cada fila | Postgres la evalúa una vez por consulta (initplan) |
| Llaves foráneas compuestas con `empresa_id` | Llaves foráneas simples | Las verificaciones de llave foránea ignoran la RLS: con una llave simple, una sucursal de A podría apuntar al emisor de B |
| API con DML completo en las tablas de empresa; los permisos de negocio en la aplicación (002) | Privilegios mínimos por tabla según el caso de uso actual | La RLS ya limita a la propia empresa; las pruebas de aislamiento necesitan inserción y borrado reales; y es la convención que seguirán las tablas futuras. `TRUNCATE` nunca se concede porque ignora la RLS |
| Transacción por petición, también en lecturas | Fijar el contexto con `SET` de sesión al tomar la conexión del pool | La fijación queda atada a la `xid` de la transacción (22e) y muere con ella: una conexión devuelta al pool no puede llevar el contexto a otra petición |
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
| Lista blanca de sentencias en la guarda de la API dentro de un contexto, más revocación en la base de las funciones que ejecutan SQL desde texto (22d) | Seguir ampliando la lista negra de nombres sobre el texto sin literales | La lista negra no ve SQL escondido dentro de un literal que una función de `pg_catalog` ejecuta (`ts_rewrite`), y cada función nueva sería una falla nueva; la lista blanca cierra las sentencias no previstas y la revocación cierra las funciones aunque la guarda las deje pasar |
| Protecciones del catálogo (38b, 38c, 38d, y la parte de base de 22d) en `db:preparar`, comprobadas al final | En una migración | Tocan objetos de `pg_catalog` y membresías de roles predefinidos, que el migrador no puede cambiar; `db:preparar` ya corre con el administrador. En cambio, lo de 22e sí va en una migración: son objetos propios del migrador |
| Sin superusuario (producción, 38e), `db:preparar` omite las protecciones del catálogo solo con `DB_PROTECCION_CATALOGO=omitir` y avisa; sin la variable, falla antes de tocar nada | Omitirlas en silencio cuando el administrador no puede, o pedir al proveedor que haga los `REVOKE` | En silencio, un entorno de desarrollo mal configurado perdería las protecciones sin que nadie lo note; el proveedor administrado no da acceso a `pg_catalog`. La opción explícita deja constancia en la configuración de producción y en cada ejecución |
| (misma) | Fallar si el administrador no es superusuario aunque se pida `omitir` | Producción no tendrá superusuario (decisión del usuario) y el aislamiento entre empresas (RLS y 22e) no depende de esas protecciones |
| La guarda de la API y la de plataforma rechazan por nombre `pg_stat_activity`, `pg_stat_get_*`, señales, objetos grandes y `table_to_xml`/`schema_to_xml`/`database_to_xml`, en todos los entornos (38e) | Rechazarlos solo cuando no hay superusuario | Un solo comportamiento en desarrollo, pruebas y producción: las pruebas de la guarda corren igual en todos lados y no hay una configuración que cambie lo que la API deja pasar |
| `table_to_xml`, `schema_to_xml` y `database_to_xml` en la lista (agregados por el especificador) | Solo la lista pedida | Leen una relación nombrada dentro de un literal (`schema_to_xml('pg_catalog', …)` incluye `pg_stat_activity`); sin el `REVOKE` de 38b, esconderían un nombre de la lista donde la guarda no mira |
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
- `202610270002-contexto-empresa-unico.ts` (criterio 22e):
  - esquema `contexto` (dueño `restaurante_migrador`, `REVOKE ALL … FROM PUBLIC`, sin `GRANT` a los roles de la aplicación);
  - tabla `UNLOGGED` `contexto.sesion_empresa (pid integer PRIMARY KEY, xid xid8 NOT NULL, empresa_id uuid NOT NULL)`, sin privilegios para nadie salvo su dueño;
  - función `public.fijar_contexto_empresa(uuid)` (`SECURITY DEFINER`, `search_path` fijo), `EXECUTE` solo para `restaurante_api`;
  - `CREATE OR REPLACE` de `public.empresa_actual()` como `SECURITY DEFINER` con `search_path` fijo, leyendo la tabla;
  - `down`: restaura `empresa_actual()` de la primera migración y elimina la función, la tabla y el esquema.

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
- **Diferencias entre el PostgreSQL de Docker, el nativo de la nube y el administrado de producción.** Mitigación: el mismo script de preparación en todos, y ningún atributo especial en los roles de la aplicación. El aislamiento entre empresas (RLS y 22e) va en migraciones y no requiere superusuario. Las protecciones del catálogo (38b, 38c, 38d y la parte de base de 22d) exigen un administrador superusuario, que el PostgreSQL administrado de producción no da (decisión del usuario): ahí se omiten con `DB_PROTECCION_CATALOGO=omitir` (38e).
- **En producción, la lista de nombres de la guarda es la única barrera de 38b, 38c, 38d y de la capa de base de 22d.** Un fallo del analizador, una función de `pg_catalog` no inventariada que lea una relación o ejecute SQL recibido dentro de un literal, o una extensión instalada después (`pg_stat_statements`, `dblink`, `postgres_fdw`) dejarían ver el texto de consultas de otras sesiones del mismo rol, señalarlas o usar objetos grandes como canal entre empresas. Las tablas de empresa siguen protegidas por la RLS y 22e. Mitigación: lista blanca de sentencias (22d), rechazo de `U&"…"`, inventario de `pg_catalog` de la ronda 5 del adversarial, ataque de T45 sobre la lista, condiciones de la nota de despliegue de `spec.md`, y repetir el inventario al subir de versión de PostgreSQL o instalar extensiones.
- **Credenciales de `restaurante_api` fuera de la API.** Sin superusuario, alguien que se conecte directo con el rol de la API (sin guarda) puede usar esos objetos. Mitigación: las credenciales solo viven en el entorno de la API; la RLS y 22e siguen impidiendo ver tablas de otra empresa.
- **Prefijo `lo_` en nombres propios.** La guarda rechaza cualquier identificador que empiece con `lo_` (o `pg_stat_get_backend_`), también tablas, columnas o alias de la aplicación. Mitigación: convención escrita en el README; una tabla nueva con ese prefijo falla en sus propias pruebas de integración.
- **Administrador no superusuario y `ALTER ROLE` en PostgreSQL 16.** Puede rechazar `NOSUPERUSER`/`NOBYPASSRLS`/`NOREPLICATION` y exige `ADMIN OPTION` sobre roles existentes. Mitigación: T48 lo comprueba contra PostgreSQL 16 real y la prueba de 38e lo ejercita con un rol temporal.
- **Funciones de SQL desde texto no previstas.** La revocación de 22d cubre una lista conocida de funciones de `pg_catalog`; una versión nueva de PostgreSQL o una extensión instalada más adelante podría traer otra. Desde 22e, una función así ya no puede cambiar la empresa que ve la RLS (ni con `set_config` ni volviendo a fijar), pero podría servir para otras cosas (por ejemplo, ejecutar sentencias que la lista blanca de la guarda no deja pasar). Mitigación: la lista blanca de la guarda no depende de nombres de funciones; al subir de versión de PostgreSQL o instalar extensiones, revisar `pg_proc` y ampliar la revocación (y su prueba de catálogo).
- **Costo de la fijación (22e).** Cada transacción de la API asigna una `xid` (antes una transacción de solo lectura no la asignaba) y escribe una fila en `contexto.sesion_empresa` (un `UPDATE` de la fila de su sesión, normalmente HOT porque no cambian columnas indexadas, sin WAL por ser `UNLOGGED`). El costo es pequeño; el consumo de `xid` acerca un poco el `VACUUM` antienvoltura, que PostgreSQL hace solo. Mitigación: autovacuum por defecto; si algún día la carga lo exige, medir antes de cambiar.
- **Transacciones de solo lectura y réplicas.** Fijar el contexto escribe en una tabla, así que no funciona en una transacción `READ ONLY` ni en una réplica de solo lectura (hot standby), y una tabla `UNLOGGED` tampoco se replica. Hoy la API no usa ninguna de las dos. Mitigación: si una historia futura quiere leer desde una réplica o en transacciones `READ ONLY`, tiene que resolver antes cómo fijar el contexto ahí; no se relaja 22e.
- **`SAVEPOINT` y fijación.** Revertir a un `SAVEPOINT` tomado antes de fijar deshace la fijación y permite fijar otra empresa en la misma transacción (nunca dos a la vez). Por la API no es posible, porque `fn` no puede enviar `SAVEPOINT` (22b); queda como caso límite en `spec.md`.
- **La fila vieja de una sesión terminada queda en la tabla.** No da contexto a nadie (su `xid` no se repite) y la reemplaza la siguiente fijación del mismo `pid`; como mucho hay tantas filas como procesos de PostgreSQL han existido con `pid` distinto, y la tabla se vacía tras una caída (`UNLOGGED`). Mitigación: ninguna necesaria; si creciera, una limpieza de filas cuyo `pid` no está en `pg_stat_activity` la puede hacer el migrador.
- **Revertir la migración de 22e** deja la RLS leyendo otra vez `app.empresa_id`, con la debilidad anterior, y rompe `ContextoEmpresa` si no se revierte también `SQL_FIJAR_CONTEXTO`. Mitigación: aviso en el archivo de la migración; nunca revertirla en producción sin revertir el código.
- **El filtro de errores reconoce los errores de `http-errors` por su forma** (`status`/`statusCode` entre 400 y 499), no por su clase. Un error interno que tuviera por casualidad esa forma respondería un 4xx genérico en vez de 500. Mitigación: el mensaje siempre es fijo, así que no se filtra nada; el registro guarda el detalle.
- **La lista blanca puede rechazar sentencias internas de Sequelize** que hoy no se ven (por ejemplo, alguna consulta de metadatos enviada de forma diferida dentro de un contexto). Mitigación: identificarlas por su origen, como las de apertura y cierre, y no ampliar la lista blanca por texto; las pruebas de integración de los servicios lo detectan.
