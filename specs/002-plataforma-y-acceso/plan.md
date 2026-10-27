# 002 · Plan técnico

## Módulos afectados

- `packages/dominio`: `src/permisos.ts` (roles, acciones, matriz, `requisitoPermiso`, `puedeAutorizar`, `alcanceReportes`, `permisosDeRol`, `largoPin`), `src/horario.ts` (agrega `dentroDeHorario` junto a `validarHorario` de 001, reutilizando sus intervalos semanales), `src/suscripcion.ts` (`estadoSuscripcion`, `sumarMeses`, `fechaLima`, `periodoLima`), `src/modulos.ts` (`MODULOS`), `src/acceso.ts` (`MAXIMO_PERSONAS_POR_EQUIPO`), con pruebas unitarias.
- `packages/contratos`: `src/sesiones.ts`, `src/usuarios.ts` (con `horarioUsuarioSchema` sobre `horarioSchema` de 001), `src/equipos.ts`, `src/autorizaciones.ts`, `src/suscripciones.ts` (planes, pagos, alta por HTTP), `src/errores.ts` (códigos nuevos), `src/comunes.ts` (`fechaSchema`, `montoSchema`, `motivoSchema`, `pinSchema`, `pinAutorizacionSchema`), `src/plataforma.ts` (`suscripcion` opcional en `sucursalEntradaSchema`, `emisorRespuestaSchema`).
- `apps/api`:
  - `src/config/entorno.ts`: `PIN_PEPPER`, `ORIGENES_PERMITIDOS`; `EMPRESA_POR_HEADER=habilitado` solo con `NODE_ENV=test`.
  - `src/aplicacion.ts`: CORS, opción `reloj`.
  - `src/nucleo/reloj/`: `RELOJ`, `RelojSistema`, `RelojManual` (para las pruebas: `fijar`, `avanzar`).
  - `src/nucleo/principal/`: almacén del principal de la petición (`AsyncLocalStorage`) y su interceptor global.
  - `src/nucleo/fijar-contexto.ts`: agrega `SQL_FIJAR_ACTOR` (`SELECT fijar_contexto_actor($1, $2, $3, $4)`) y su nombre, con la misma regla de lint que `fijar_contexto_empresa`.
  - `src/nucleo/contexto-empresa/`: `ContextoEmpresa.ejecutar(empresaId, fn, { actor? })` y `fijarActor(actor)`; el interceptor toma el actor del principal (nuevo método `actor(peticion)` del resolutor) y lo pasa a `ejecutar`; registro de `ResolutorEmpresaSesion` en `RESOLUTOR_EMPRESA`; `ENTORNOS_CON_CABECERA` pasa a `['test']`.
  - `src/nucleo/base-de-datos/`: `guarda-api.ts` y `conexion-plataforma.ts` reconocen el texto exacto de `SQL_FIJAR_ACTOR` como reconocen el de la empresa; `consultas-sin-empresa.ts` gana la consulta fija `autenticacion` (`SELECT empresa_de_usuario($1) AS empresa_id`).
  - `src/nucleo/idempotencia/`: tabla `idempotencia`, `IdempotenciaInterceptor`, `@Idempotente()`.
  - `src/modulos/auditoria/` (nuevo): dueño de `auditoria`; `AuditoriaService`, `insertarAuditoriaPlataforma`.
  - `src/modulos/seguridad/` (nuevo): dueño de `usuario`, `acceso_sucursal`, `sucursal_acceso`, `equipo`, `equipo_recordado`, `sesion`, `autorizacion`, `bloqueo_intentos` y del esquema `autenticacion`. `AutenticacionGuard` (global), `ResolutorEmpresaSesion`, `SesionActual`, decoradores, `PermisoInterceptor`, `ModuloInterceptor`, servicios (`SesionesService`, `UsuariosService`, `EquiposService`, `HorarioService`, `AutorizacionService`, `BloqueosService`, `Credenciales`) y controladores (`sesiones`, `sesion`, `sesion/equipo(s)`, `equipo`, `usuarios`, `usuarios/:id/equipos`, `autorizaciones`, `sucursales/:id/acceso`).
  - `src/modulos/plataforma/`: dueño además de `superadministrador`, `sesion_superadministrador`, `plan`, `suscripcion`, `pago_suscripcion`, `consumo_comprobantes`, `idempotencia_plataforma`. `SuperadministradorGuard` y `@Superadministrador()`, `SuperadministradoresService`, `PlanesService`, `SuscripcionService`, `SoporteService`; controladores `/plataforma/*`, `EmisoresController` (`GET`/`POST /emisores`) y `POST /sucursales` en `SucursalesController`. `OperacionPlataforma` fija el actor de la transacción, escribe en `auditoria` y acepta el actor superadministrador.
  - `src/migraciones/`: seis migraciones nuevas, repartidas por grupo de tareas (ver "Migraciones"), y `sqlTrazabilidad` / `sqlTablaDeEmpresaTrazable` en `sql-tabla-de-empresa.ts`.
  - `scripts/superadministrador.ts` (`pnpm plataforma:superadmin`), `scripts/lib/superadministrador.ts`, `scripts/semilla.ts` (superadministrador y usuarios de demostración, con actor `semilla`).
  - `eslint.config.js`: `empresa_de_usuario` y `fijar_contexto_actor` tratados como `fijar_contexto_empresa` (solo en `fijar-contexto.ts`, `consultas-sin-empresa.ts` y migraciones).
- `apps/app` (nuevo): PWA React + Vite, móvil primero.
- `packages/ui` (nuevo): componentes base compartidos (también para `apps/web` más adelante).
- `.github/workflows/ci.yml`: `apps/app` en lint, tipos, pruebas y build; E2E de Playwright en un job aparte.
- `README.md`, `.env.example`: variables nuevas, `EMPRESA_POR_HEADER` fuera de `development`, cómo crear el superadministrador, la convención de trazabilidad para tablas nuevas.

## Diseño

### Camino de una petición

```
Petición HTTP
 → AutenticacionGuard (APP_GUARD, seguridad)
     @Publica()                         → pasa sin principal
     @Superadministrador()              → lo resuelve SuperadministradorGuard (ruta), no este guard
     NODE_ENV=test + EMPRESA_POR_HEADER + sin Authorization
                                        → principal PRUEBA (Administrador, actor 'prueba') con la empresa de x-empresa-id
     si no:
       token = Bearer se.<empresaId>.<sesionId>.<secreto>     (mal formado → 401 NO_AUTENTICADO)
       r = ContextoEmpresa.ejecutar(empresaId, validarYRenovar, { actor: actor de la sesión })
                                                              ← transacción propia, se confirma
       r.error → lanzar después de confirmar (SESION_EXPIRADA cierra la sesión y se guarda el cierre)
       peticion.principal = r.principal
     reglas de ruta con el principal: @SoloAdministrador, @RequiereSucursal, contraseña temporal → 403/409
 → PrincipalInterceptor (APP_INTERCEPTOR, registrado antes que el de contexto): corre el resto dentro de
   principalActual.run(principal, …)
 → ContextoEmpresaInterceptor (001, un cambio): RESOLUTOR_EMPRESA = ResolutorEmpresaSesion
     (lee peticion.principal.empresaId y el actor del principal)
     → ContextoEmpresa.ejecutar(empresaId, handler, { actor })
 → interceptores de ruta, dentro de la transacción: IdempotenciaInterceptor, ModuloInterceptor, PermisoInterceptor
 → controlador → servicios → AuditoriaService.registrar (misma transacción; el actor lo pone la base)
```

- **Dos transacciones por petición autenticada:** la del guard (validar y renovar la sesión) y la del controlador. Así la renovación y el cierre por expiración quedan guardados aunque el controlador falle (criterio 27b de 001: después de `ejecutar` se puede abrir otro).
- **Único cambio al interceptor de 001:** pasar el actor. `ResolutorEmpresa` gana un método opcional `actor(peticion)`; el resolutor por cabecera de 001 devuelve `{ sistema: 'prueba' }` y el nulo, `null`. Sin actor, la transacción puede leer y no escribir en tablas trazadas (criterio 115): las pruebas de lectura de 001 siguen igual.
- **`validarYRenovar`:** busca la sesión por id bajo RLS (con la empresa del token, si es ajena no aparece: criterio 3), compara la huella con `timingSafeEqual`, comprueba `cerrada_en`, el máximo absoluto y la inactividad con el reloj de la API, y según el tipo: PIN exige `X-Equipo` del mismo equipo y el equipo recordado activo (criterio 37); toda sesión con `equipo_recordado_id` exige que siga activo (criterio 30); usuario activo y acceso a la sucursal activa (criterio 6; si no, cierra); soporte, que no esté cerrada. **No** comprueba el horario (criterio 108). Si la petición no trae `X-Actividad: segundo-plano`, actualiza `ultima_actividad_en`. Calcula el rol: Administrador si `es_administrador` (o soporte, o prueba), si no el de `acceso_sucursal` para la sucursal activa.
- **Rutas de plataforma:** `@Superadministrador()` compone `@SinEmpresa()`, la marca de metadatos y `UseGuards(SuperadministradorGuard)`. El guard valida `sa.<sesionId>.<secreto>` con `OperacionPlataforma.consultar` (solo lectura) y deja `peticion.superadministrador`. Si una ruta `/plataforma/*` olvidara el decorador, `AutenticacionGuard` la trataría como ruta de empresa y un token `sa.` daría 401: la falla es cerrada.
- **Rutas públicas:** `@Publica()` implica `@SinEmpresa()`. La prueba del criterio 1 compara la lista de rutas públicas con la permitida.
- **`ResolutorEmpresaPorCabecera`:** queda, usado solo por el modo de prueba del guard. `cabeceraHabilitada` exige `NODE_ENV=test`, y `cargarEntorno` rechaza `EMPRESA_POR_HEADER=habilitado` con `development` o `production`.

### Trazabilidad (criterios 113 a 120)

**Mecanismo elegido: en la base, con un contexto de actor hermano del de empresa y un trigger estándar por tabla.**

- `contexto.sesion_actor` (`UNLOGGED`, una fila por `pid` con la `xid8` de la transacción, como `contexto.sesion_empresa`) guarda el actor de la transacción.
- `fijar_contexto_actor(p_usuario, p_equipo, p_superadministrador, p_sistema)` (`SECURITY DEFINER`, dueña `restaurante_migrador`, `search_path = pg_catalog, pg_temp`) valida exactamente un actor, equipo solo con usuario, sistema de 1 a 100 sin NUL, y escribe la fila; una segunda llamada en la misma transacción falla con `42501`, como `fijar_contexto_empresa`. Es función aparte (no un parámetro más de `fijar_contexto_empresa`) porque la plataforma escribe sin empresa y necesita actor igual, y porque cambiar la firma de 001 rompería sus pruebas protegidas y la guarda de texto exacto.
- `trazabilidad()` (`SECURITY DEFINER`, `search_path` fijo) es la función de un trigger `BEFORE INSERT OR UPDATE FOR EACH ROW`: lee el actor de `(pg_backend_pid(), pg_current_xact_id_if_assigned())`; si no hay, lanza `42501` "contexto de actor ausente"; en `INSERT` pone los dos grupos; en `UPDATE` pone `actualizado_por_*` y copia `creado_por_*` de `OLD`. Lo que traiga la fila en esas columnas se pisa. La validez del usuario y del equipo frente a la empresa la dan las llaves foráneas compuestas (un usuario de B con el contexto de A no pasa).
- El trigger de `auditoria` (`BEFORE INSERT`) usa el mismo actor para `actor_*` y `equipo_id` (criterio 119).
- **Quién fija el actor:** `ContextoEmpresa.ejecutar(empresaId, fn, { actor })` llama `fijar_contexto_empresa` y, si hay actor, `fijar_contexto_actor` en la misma transacción. En los ingresos (`POST /sesiones/contrasena`, `POST /sesiones/pin`, `PUT /sesion/contrasena`) el servicio abre la transacción sin actor, lee y verifica, y llama `fijarActor` antes de la primera escritura: el usuario si las credenciales son correctas, `{ sistema: 'autenticacion' }` si no. `OperacionPlataforma.ejecutar` fija el actor de su `auditoria.actor` (texto → sistema; `{ superadministradorId }` → superadministrador). Las migraciones que escriben datos lo fijan con `migracion:<nombre>` y la semilla con `semilla`.
- **Ayudante de migraciones:** `sqlTrazabilidad(tabla, { columnaEmpresa? })` agrega columnas, restricciones, llaves y trigger; `sqlTablaDeEmpresaTrazable(tabla, opciones)` = `sqlTablaDeEmpresa` + `sqlTrazabilidad`. `sqlTablaDeEmpresa` **no cambia**: las migraciones de 001 ya aplicadas lo usan, y si su salida cambiara, una base nueva crearía las columnas dos veces. Las excepciones usan `sqlTablaDeEmpresa` a secas y la prueba de catálogo tiene la lista cerrada.
- **Llaves hacia `equipo`:** la tabla `equipo` llega en C2; hasta entonces `*_equipo_id` queda sin llave (siempre nulo, porque no hay equipos). La migración de C2 agrega esas llaves a todas las tablas trazadas que existan.

| Opción | A favor | En contra |
| --- | --- | --- |
| **Base: contexto de actor + trigger (elegida)** | Imposible de olvidar: sin actor la escritura falla; vale para SQL crudo, Sequelize, la plataforma, la semilla y las migraciones; el cuerpo de la petición no puede tocar las columnas; una prueba de catálogo lo verifica tabla por tabla; mismo patrón ya probado y atacado para la empresa (22e de 001) | Una llamada más por transacción y un trigger por fila (despreciable a esta escala); las pruebas que escriben por SQL deben fijar un actor (P10); el actor de los ingresos se fija tarde |
| API: hooks de Sequelize o repositorios que completen las columnas | Sin SQL nuevo; el actor está a mano en el principal | Se saltea con SQL crudo, `bulkCreate` sin hooks o un servicio nuevo; depende de que nadie copie campos del cuerpo; no se puede verificar en el catálogo; la plataforma y la semilla necesitan su propio camino |

### Tokens, contraseñas y PIN

- **Secretos de sesión y de equipo:** `randomBytes(32)` en base64url; en la base solo `sha256(secreto)` (`bytea`). Como el secreto es aleatorio de 256 bits, SHA-256 basta. El token lleva la empresa para que el guard abra el contexto sin buscar entre empresas.
- **Contraseñas:** `crypto.scrypt` de Node (sin dependencias nativas; RNF-18), N = 2^15, r = 8, p = 1, sal de 16 bytes, clave de 32 bytes, `maxmem` de 64 MB. Formato `scrypt$15$8$1$<sal>$<hash>` en base64. Comparación con `timingSafeEqual`. Para un usuario inexistente se calcula igual un scrypt contra un hash fijo (mismo tiempo de respuesta, criterio 11). Todo usuario tiene contraseña (`hash_contrasena NOT NULL`).
- **PIN:** `huella_pin = HMAC-SHA256(PIN_PEPPER, empresaId + ':' + pin)`. Hash con clave (RNF-07): con solo la base no se pueden probar los PIN, hace falta también el secreto del entorno. El índice único `(empresa_id, huella_pin)` permite identificar al supervisor solo por su PIN (criterio 44). Generación: `largoPin(roles)` dígitos con `randomInt`, relleno con ceros; antes de guardar se comprueba que la huella no exista en la empresa y se reintenta (hasta 20 veces); una carrera entre dos altas simultáneas termina en violación de unicidad y la API responde 409 `CONFLICTO` (rara). Un PIN de 4 y uno de 6 nunca colisionan (`0123` ≠ `000123`). `usuario.largo_pin` guarda el largo para detectar el cambio del criterio 21b dentro de la misma transacción que cambia los accesos.
- **Nada secreto se registra:** el filtro de errores y el registro de Nest no imprimen cuerpos de petición ni las cabeceras `Authorization` y `X-Equipo`; las entradas con `pin`, `contrasena`, `actual`, `nueva` y `contrasenaTemporal` se excluyen de cualquier registro de depuración.

### Ingreso con contraseña (búsqueda entre empresas)

1. `POST /sesiones/contrasena` es `@Publica()`. El servicio normaliza el nombre y llama `SELECT empresa_de_usuario($1) AS empresa_id` sin contexto, como consulta fija marcada `{ sinEmpresa: 'autenticacion' }` (igual que la de salud de 001).
2. `empresa_de_usuario` es `SECURITY DEFINER` (dueña `restaurante_migrador`, `search_path` fijo) y lee `autenticacion.nombre_usuario` por igualdad exacta. El esquema no tiene `USAGE` para los roles de la aplicación, así que no se puede enumerar.
3. Con la empresa, `ContextoEmpresa.ejecutar(empresa, …)` (sin actor) lee el usuario bajo RLS, revisa el bloqueo, verifica la contraseña, fija el actor (criterio 117), revisa el horario con `dentroDeHorario` y el reloj, actualiza `bloqueo_intentos`, audita si corresponde y crea la sesión. Devuelve un resultado (`ok` o el error a lanzar); el controlador lanza **después** de que la transacción se confirmó, así los fallos, el bloqueo y el rechazo por horario quedan guardados.
4. `autenticacion.nombre_usuario` la mantiene un trigger `AFTER INSERT OR UPDATE OF nombre_usuario OR DELETE` sobre `usuario`, `SECURITY DEFINER` y dueño el migrador. Un nombre repetido en otra empresa falla con `23505` sobre la llave de esa tabla; la API lo traduce a 409 sin detalle (criterio 90).

Las tablas de `public` tienen RLS forzada sin política para el migrador, así que las funciones `SECURITY DEFINER` no pueden leer `usuario`: por eso la relación vive en una tabla propia fuera de `public`, sin RLS, como `contexto.sesion_empresa` en 001.

### Fallos que se guardan aunque la respuesta sea un error

Las transacciones del controlador se revierten si se lanza un error, y con ellas se perdería la cuenta de fallos y la auditoría del rechazo. Por eso las rutas que cuentan fallos o auditan rechazos (`POST /sesiones/contrasena`, `POST /sesiones/pin`, `PUT /sesion/contrasena`, `POST /autorizaciones`, `POST /plataforma/sesiones`) son `@SinEmpresa()`: su servicio abre su propio `ContextoEmpresa.ejecutar` (u `OperacionPlataforma.ejecutar`), devuelve un resultado con el error a lanzar y el controlador lo lanza después de confirmar. `POST /autorizaciones` sigue autenticada (el guard deja el principal y fija el actor de la sesión), solo que sin la transacción del interceptor; su idempotencia se maneja dentro del servicio.

### Equipos recordados e ingreso con PIN

- **Modelo:** `equipo` es el navegador dentro de una empresa (token `eq.`); `equipo_recordado` es (equipo, persona). Se eligió un equipo con identidad en el servidor, compartido por las personas que recuerda, en lugar de un token por persona, porque así el servidor puede aplicar el máximo de 5 personas, una sola sesión PIN por equipo (cambio rápido, criterio 38) y el bloqueo por equipo de la clave de supervisor, y el Administrador ve qué personas comparten un celular. El equipo es por empresa para que la API nunca busque un token fuera de la empresa de la petición: si el navegador tiene personas de dos empresas, guarda dos tokens.
- **`POST /sesion/equipo`** (sesión `CONTRASENA`, contraseña no temporal): si `X-Equipo` es de la empresa de la sesión y su huella coincide, usa ese equipo; si no (falta, mal formado, otra empresa, adulterado), crea uno nuevo y devuelve el token. Luego, con `SELECT … FOR UPDATE` sobre la fila de `equipo` (serializa los recordatorios concurrentes, criterio 29): si (equipo, usuario) está activo, actualiza `ultimo_uso_en`; si no y ya hay 5 activos, revoca el de `ultimo_uso_en` más antiguo (`REEMPLAZADO`) y cierra sus sesiones; inserta el nuevo. Guarda `equipo_id` y `equipo_recordado_id` en la sesión. Si la sesión ya tenía otro equipo, 409.
- **`GET /equipo`** y **`POST /sesiones/pin`** son públicas: parsean `eq.<empresaId>.<equipoId>.<secreto>`, abren `ContextoEmpresa.ejecutar(empresaId)` y validan el equipo. En `POST /sesiones/pin`: busca (equipo, `usuarioId`) activo (si no existe, 401 sin contar); revisa el bloqueo de ese equipo recordado; calcula la huella del PIN y la compara con la del usuario (no busca por huella: la persona ya está elegida); exige usuario activo y contraseña no temporal; fija el actor; comprueba el horario; cierra la sesión PIN abierta del equipo (índice único parcial) y crea la nueva con la sucursal del criterio 33; actualiza `ultimo_uso_en` de equipo y equipo recordado.
- **Bloqueo por persona en el equipo:** `bloqueo_intentos` con ámbito `PIN_EQUIPO_RECORDADO` y objetivo el id del equipo recordado. `fallos_seguidos` solo se reinicia con un PIN correcto (o un rechazo por horario, que implica PIN correcto); al llegar a 5 y a 10 fija `bloqueado_hasta = ahora + 5 min`; al llegar a 15 revoca el equipo recordado (`BLOQUEO`) y cierra sus sesiones, todo en la transacción del fallo con actor `autenticacion`.
- **Revocar:** marca `revocado_en` y `motivo_revocacion` y cierra en la misma transacción todas las sesiones con ese `equipo_recordado_id` (cualquier tipo). Desactivar y restablecer la contraseña llaman a la misma función para todos los equipos del usuario.

### Horario de acceso

- `usuario.horario jsonb null`. La API valida con `horarioUsuarioSchema` (que usa `validarHorario` de 001) y la base asegura que no sea un arreglo vacío ni conviva con `es_administrador`.
- `dentroDeHorario(tramos, instante)` en `packages/dominio`: minutos desde el lunes 00:00 de Lima (`instante` − 5 h, sin depender de `Intl` ni de la zona del proceso) y los mismos intervalos semanales circulares que `validarHorario` (el tramo que cruza la medianoche del domingo sigue el lunes). Intervalo `[desde, hasta)`.
- Se comprueba en tres lugares, siempre después de las credenciales: ingreso con contraseña, ingreso con PIN y PIN del autorizador en `POST /autorizaciones`. Nunca en `validarYRenovar` ni en `PUT /sesion/sucursal` (criterio 108).

### Autorizaciones y `@Permiso`

- `POST /autorizaciones`: valida la entrada (PIN de 6 dígitos); con el rol del solicitante en la sucursal activa calcula `requisitoPermiso` (`prohibido` → 403, `permitido` → 409, sin sucursal → 409); revisa los bloqueos del solicitante y del equipo de la sesión (si tiene); busca al autorizador por `(empresa_id, huella_pin)`, exige activo, distinto del solicitante, con acceso a la sucursal, `puedeAutorizar(rol, accion)` y `dentroDeHorario`; crea la fila `autorizacion` (sesión, solicitante, autorizador, sucursal, equipo, acción, motivo, `expira_en = ahora + 2 min`) y audita. En el rechazo: cuenta fallo, audita `autorizacion_rechazada` con el motivo interno y, al quinto, el bloqueo.
- `@Permiso(accion)` = metadatos + `PermisoInterceptor` de ruta, que corre dentro de la transacción del controlador: `prohibido` → 403; `permitido` → sigue; `clave` → exige `X-Autorizacion` y llama `AutorizacionService.consumir`, que hace `UPDATE autorizacion SET usada_en = ahora WHERE id = $1 AND sesion_id = $2 AND accion = $3 AND sucursal_id = $4 AND usada_en IS NULL AND expira_en > ahora RETURNING …`. Si no actualiza ninguna fila, 403 `AUTORIZACION_INVALIDA`. El `UPDATE` con condición resuelve la concurrencia (criterio 50). Después del controlador, el interceptor escribe la auditoría de la acción con el autorizador, el motivo y el `autorizacionId` (el solicitante es el actor de la transacción).

### Auditoría general y unión con `auditoria_plataforma`

- Módulo propio `modulos/auditoria`, sin dependencias de otros módulos. `AuditoriaService.registrar(entrada)` toma la empresa del contexto, la sesión y la sucursal activa del principal (o la sucursal de la entidad que se le pase); el actor y el equipo los pone el trigger.
- `insertarAuditoriaPlataforma(transaccion, fila)` inserta con SQL explícito usando la transacción recibida (la de plataforma, que ya fijó su actor). `OperacionPlataforma` la llama en lugar de crear el modelo `AuditoriaPlataforma`.
- `OperacionPlataforma.ejecutar`: `actor` pasa a `string | { superadministradorId: string }` y se fija como actor de la transacción al empezar. Las validaciones de 001 (vacío, NUL, sustitutos) siguen sobre el texto.
- La auditoría se escribe con la hora del reloj de la API.

### Superadministrador y soporte

- Superadministradores en `plataforma`. El script `pnpm plataforma:superadmin crear|desactivar` usa `crearSuperadministrador` / `desactivarSuperadministrador` sobre `OperacionPlataforma` con actor `cli:superadmin`. La contraseña se pide por la entrada estándar o por `SUPERADMIN_CONTRASENA` (solo para automatizar), nunca como argumento.
- Ingreso: `OperacionPlataforma.consultar` para leer al superadministrador y verificar; `OperacionPlataforma.ejecutar` para crear la sesión (auditoría `ingreso_superadministrador`) o para contar el fallo (auditoría `ingreso_superadministrador_fallido`, y `bloqueo_superadministrador` al quinto).
- Sin inactividad en el servidor para el superadministrador: renovarla exigiría una escritura por petición y, con ella, una fila de auditoría por petición. La sesión dura 8 horas y la PWA la cierra tras 30 minutos sin uso.
- Soporte: `OperacionPlataforma.ejecutar` comprueba la empresa (y la sucursal, si viene), inserta la sesión `SOPORTE` con `insertarSesionSoporte(transaccion, datos)` del módulo de seguridad y audita `inicio_soporte` con la empresa. Desactivar un superadministrador cierra con `cerrarSesionesDeSuperadministrador(transaccion, id)` sus sesiones de soporte en todas las empresas (política `acceso_plataforma` sobre `sesion`). En las peticiones de soporte el actor es `{ superadministradorId }`.
- El alta por HTTP crea al primer Administrador con `insertarAdministradorInicial(transaccion, datos)` del módulo de seguridad (PIN de 6 dígitos, huellas, el trigger mantiene `autenticacion.nombre_usuario`).

Las funciones que reciben la transacción de plataforma son funciones exportadas, no proveedores, para evitar dependencias circulares entre módulos de Nest.

### Suscripciones

- `SuscripcionService` (plataforma) es el único que lee y escribe `plan`, `suscripcion`, `pago_suscripcion` y `consumo_comprobantes`. Expone `estadoDeSucursal`, `estadosDeEmpresa` (avisos), `modulosDeSucursal`, `exigirAperturaDeCaja`, `registrarComprobanteEmitido` y `crearParaSucursal`.
- El estado no se guarda: se calcula con `estadoSuscripcion` de `packages/dominio` y el reloj de la API.
- `registrarComprobanteEmitido`: `INSERT … ON CONFLICT (sucursal_id, periodo) DO UPDATE SET emitidos = consumo_comprobantes.emitidos + 1 RETURNING emitidos`, y la cuota se lee del plan actual.
- Pagos: `vencimientoNuevo > vencimiento` se valida con `SELECT … FOR UPDATE` de la suscripción dentro de la operación; el pago guarda el vencimiento anterior y el nuevo.
- Montos con `NUMERIC` y como texto en el contrato; si algún cálculo los suma (no en esta sección), con `decimal.js`.

### Idempotencia

- `@Idempotente()` + `IdempotenciaInterceptor` dentro de la transacción del controlador: `INSERT INTO idempotencia (… estado 'en_curso') ON CONFLICT DO NOTHING`. Si insertó, ejecuta el controlador y guarda estado y respuesta en la misma fila. Si no, espera a la otra transacción, lee la fila y, si la huella de la entrada (ruta + actor + cuerpo canónico) coincide, devuelve la respuesta guardada; si no, 422. Las respuestas de error no se guardan porque la transacción se revierte.
- `idempotencia_plataforma`: lo mismo dentro de `OperacionPlataforma.ejecutar`.
- Retención: 24 horas; la limpieza borra filas viejas al pasar.

### Reloj

`RELOJ` (`{ ahora(): Date }`) se inyecta en todos los servicios con reglas de tiempo. Las consultas reciben la hora como parámetro en lugar de usar `now()`. `RelojManual` (exportado) permite a las pruebas fijar y avanzar la hora; `crearAplicacion({ reloj })` lo instala.

### Configuración

- `PIN_PEPPER`: obligatoria fuera de `development` y `test`; se valida que decodificada tenga al menos 32 bytes.
- CORS: `app.enableCors` con `ORIGENES_PERMITIDOS`, cabeceras permitidas `Authorization`, `Content-Type`, `X-Equipo`, `X-Actividad`, `X-Autorizacion`, `Idempotency-Key`, y expuesta `Retry-After`. Sin cookies.

### PWA (`apps/app`) y `packages/ui`

- React 19 + Vite + TypeScript, `vite-plugin-pwa` (manifiesto y caché solo de archivos estáticos; nunca de la API), React Router y TanStack Query. Pruebas con Vitest y Testing Library; flujos E2E con Playwright en viewport de celular.
- **Móvil primero:** cada pantalla se diseña a 360 px de ancho y se amplía a tablet y computadora; controles de al menos 44 × 44 px; teclado numérico propio para PIN (sin abrir el teclado del sistema); paquete inicial liviano con carga diferida de la administración y del panel de plataforma; estados de carga y de "sin conexión" visibles, sin perder lo escrito en los formularios.
- `src/lib/api.ts`: URL de `VITE_API_URL`; agrega `Authorization`, `X-Equipo` y, en consultas automáticas, `X-Actividad: segundo-plano`; genera una `Idempotency-Key` por escritura lógica y la reutiliza en los reintentos; reintenta con espera creciente ante cortes de red y 5xx; traduce los códigos de error a mensajes en español.
- Almacenamiento: tokens de equipo en `localStorage`, un mapa `empresaId → token` (debe sobrevivir a cierres); token de sesión de empresa y de superadministrador en `sessionStorage`.
- Después de cada ingreso con contraseña (o del cambio obligatorio), la PWA llama `POST /sesion/equipo` con el token de esa empresa, si lo tiene, y guarda el que vuelva. El nombre del equipo lo arma con el navegador y el sistema (por ejemplo "Chrome · Android").
- Inactividad: temporizador con los eventos de interacción y `expiraPorInactividadEn` del servidor; al vencer, `DELETE /sesion` (sin esperar) y vuelta a la pantalla de PIN o al ingreso.
- Estructura: `src/modulos/acceso/` (ingreso, PIN con elección de persona, cambio de contraseña, elegir sucursal, mis equipos), `src/modulos/administracion/` (usuarios con horario y equipos recordados, acceso de la sucursal), `src/modulos/plataforma/` (panel), `src/componentes/VentanaClaveSupervisor.tsx`, `src/lib/`.
- `packages/ui`: tokens de diseño y componentes base (botón, campo, teclado numérico, diálogo, aviso, tabla que se convierte en lista en celular, editor de horario). Si no existen `PRODUCT.md` y `DESIGN.md`, el frontend los crea con la skill `impeccable` antes de las pantallas y el orquestador se los muestra al usuario.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Token opaco con la empresa dentro (`se.<empresa>.<sesion>.<secreto>`), sesión guardada en la base | JWT firmado | Se puede revocar al instante (revocar equipos, desactivar, cambio rápido de usuario) y la inactividad vive en el servidor; con la empresa en el token el guard abre el contexto sin buscar entre empresas |
| Bearer en cabecera; token del equipo en `localStorage` | Cookies `httpOnly` | La PWA (Cloudflare Pages) y la API están en dominios distintos y Safari bloquea las cookies de terceros. Riesgo XSS mitigado con CSP y sin HTML de terceros |
| Validar la sesión en una transacción propia del guard | Validarla dentro de la transacción del controlador | La renovación y el cierre por expiración deben guardarse aunque el controlador falle |
| `autenticacion.nombre_usuario` fuera de `public` + `empresa_de_usuario` `SECURITY DEFINER` | Pedir la empresa en el formulario de ingreso | Peor experiencia y un dato más que recordar |
| (misma) | Tabla global en `public` legible por la API | Permitiría enumerar usuarios de todas las empresas; la función solo responde por un nombre exacto |
| Equipo con identidad en el servidor, por empresa, que recuerda a varias personas (`equipo` + `equipo_recordado`) | Un token por persona en el navegador, sin equipo en el servidor | El servidor puede aplicar el máximo por equipo, una sesión PIN por equipo y el bloqueo de clave por equipo; el Administrador ve los celulares compartidos |
| Recordar el equipo en un paso aparte (`POST /sesion/equipo`) | Recordarlo dentro de `POST /sesiones/contrasena` | La PWA no sabe de qué empresa es la persona antes de ingresar (no sabe qué token mandar); y así el equipo solo se recuerda con la contraseña ya no temporal |
| En el ingreso con PIN se elige la persona y el PIN se compara con el suyo | Buscar a la persona por la huella del PIN | El PIN solo vale para quien el equipo recuerda (decisión del usuario); el bloqueo por persona en el equipo acota la fuerza bruta a 15 intentos por persona |
| PIN con HMAC y secreto del entorno, único por empresa, generado por el sistema | scrypt por usuario, elegido por la persona | La ventana del supervisor pide solo el PIN, así que hay que buscar por PIN; elegirlo revelaría el PIN de otro al decir "ya está en uso" |
| Horario por usuario | Horario por acceso a sucursal | Ver "Decisiones del usuario", punto 2, en `spec.md` |
| Trazabilidad en la base (contexto de actor + trigger) | Completar las columnas en la API | Ver "Trazabilidad" arriba |
| `fijar_contexto_actor` aparte | Agregar el actor a `fijar_contexto_empresa` | La plataforma escribe sin empresa; no se rompe la firma ni la guarda de 001 |
| scrypt de `node:crypto` para contraseñas | argon2 (dependencia nativa) | Sin compilación nativa en el VPS ni en CI; parámetros recomendados por OWASP para scrypt |
| Autorización de supervisor de un solo uso, en dos pasos (`POST /autorizaciones` y `X-Autorizacion`) | PIN y motivo dentro de la misma petición de la acción | Los fallos y su auditoría deben guardarse aunque la acción no ocurra; la ventana es una sola para todas las acciones; el consumo con `UPDATE` condicional resuelve la concurrencia |
| Estado de la suscripción calculado al consultar | Columna de estado actualizada por una tarea diaria | Sin colas ni tareas programadas todavía; el cálculo es puro y probado en `packages/dominio` |
| Auditoría en un módulo propio y escrita con la transacción recibida | Que cada módulo tenga su tabla de auditoría | RNF-09 y HU-36 piden una vista única de quién hizo qué |
| Copiar `auditoria_plataforma` a `auditoria` y borrarla | Mantenerla como histórico de solo lectura | Una sola tabla para consultar; la copia conserva el actor original como `actor_sistema` |
| Rutas protegidas por defecto (guard global) con lista cerrada de rutas públicas | `@UseGuards` en cada controlador | Una ruta nueva sin decorador queda cerrada, no abierta |
| Administrador como marca del usuario, no como acceso por sucursal | Rol Administrador en `acceso_sucursal` | Decisión del usuario: el Administrador es de toda la empresa |
| Configuración de inactividad en `sucursal_acceso` (módulo de seguridad) | Columna nueva en `sucursal` | Cada módulo es dueño de sus tablas y no cambia `sucursalRespuesta` de 001 |
| Panel del superadministrador dentro de la PWA | Aplicación aparte | Una sola aplicación que construir y desplegar; el panel usa su propio token y sus rutas |

## Migraciones

Con fecha posterior a las de 001 (`202610270002`), una o dos por grupo de tareas para que cada commit deje la base coherente.

- `202610280001-acceso-base.ts` (C0):
  - esquema `autenticacion` (dueño `restaurante_migrador`, `REVOKE ALL … FROM PUBLIC`) y `autenticacion.nombre_usuario`;
  - `superadministrador`, `sesion_superadministrador`, `idempotencia_plataforma` (solo plataforma);
  - `usuario` (con `horario`, `largo_pin`, `hash_contrasena NOT NULL` y su trigger `SECURITY DEFINER`), `acceso_sucursal`, `sesion` (con `equipo_id` y `equipo_recordado_id` sin llave todavía), `bloqueo_intentos`, `idempotencia`;
  - `public.empresa_de_usuario(text)`;
  - políticas `acceso_plataforma` en `usuario`, `acceso_sucursal` (solo lectura) y `sesion`.
- `202610280002-trazabilidad.ts` (C0):
  - `contexto.sesion_actor`, `fijar_contexto_actor`, `trazabilidad()`;
  - columnas, restricciones, llaves (salvo las de equipo) y trigger en `empresa`, `emisor`, `sucursal` (filas existentes con `migracion:trazabilidad`), `usuario` y `acceso_sucursal`;
  - `down`: quita todo lo anterior. Revertirla exige revertir también el código que fija el actor; se anota en el archivo.
- `202610280003-auditoria-general.ts` (C0):
  - `auditoria` con restricciones (un solo actor), trigger de actor (criterio 119), triggers de inmutabilidad, políticas y privilegios; `equipo_id` y `autorizacion_id` sin llave todavía;
  - copia de `auditoria_plataforma` (con `NO FORCE` temporal en ambas tablas y el trigger de actor desactivado solo durante la copia, que conserva el actor original como `actor_sistema`) y `DROP TABLE auditoria_plataforma` y su función de trigger;
  - `down`: recrea `auditoria_plataforma` como en 001, copia de vuelta las filas de origen plataforma (`actor` = `actor_sistema` o el id del superadministrador como texto) y borra `auditoria`.
- `202610280004-suscripciones.ts` (C1):
  - `plan` con políticas `acceso_plataforma` y `lectura_api`, índice único parcial del plan por defecto, e inserción de `BASE`;
  - `suscripcion`, `pago_suscripcion` (con triggers de inmutabilidad), `consumo_comprobantes`, con `sqlTablaDeEmpresaTrazable`;
  - **datos:** una suscripción `BASE` para cada sucursal existente, con vencimiento un mes después de la fecha de la migración en Lima, con actor `migracion:suscripciones` (quitar y volver a poner `FORCE ROW LEVEL SECURITY` en `sucursal` y `suscripcion` dentro de la migración, como indica el plan de 001).
- `202610280005-equipos.ts` (C2): `equipo`, `equipo_recordado`, `sucursal_acceso` (trazables); llaves de `sesion.equipo_id`, `sesion.equipo_recordado_id`, `auditoria.equipo_id` y de `creado_por_equipo_id` / `actualizado_por_equipo_id` en todas las tablas trazadas existentes (compuestas con `empresa_id`).
- `202610280006-autorizaciones.ts` (C3): `autorizacion` (trazable) y la llave de `auditoria.autorizacion_id`.

Las tablas nuevas con datos de clientes usan `sqlTablaDeEmpresaTrazable` (salvo las cuatro excepciones, con `sqlTablaDeEmpresa`); `plan` necesita una variante con lectura para la API.

Mientras C1 no esté, `registrarEmpresa` y `agregarSucursal` no crean suscripción (como en 001); las pruebas de P8 que la esperan quedan en rojo hasta el cierre de C1.

## Riesgos

- **Pruebas protegidas de 001.** La unión de la auditoría, los cambios de los criterios 30 y 31 y la trazabilidad rompen pruebas protegidas de 001. Mitigación: las actualiza test-writer en la fase B (P10) sin quitar aserciones; el orquestador revisa con `git diff` que no se debilitó nada; la fase B empieza cuando cierre la fase E de 001.
- **Pruebas que pasan por la razón equivocada.** Sin actor, toda escritura falla con `42501`, el mismo SQLSTATE que un rechazo de RLS: una prueba de aislamiento que olvide fijar el actor pasaría sin probar la RLS. Mitigación: las pruebas de los criterios 91 y las de RLS de 001 fijan un actor válido y comprueban el mensaje del error (política RLS, no "contexto de actor ausente"); el revisor y el adversarial lo verifican.
- **Actor fijado tarde en los ingresos.** Si un servicio de ingreso escribe antes de fijar el actor, falla (falla cerrada, no silenciosa). Si fija el usuario antes de verificar la contraseña, un fallo quedaría a nombre de la persona. Mitigación: criterio 117 con pruebas de los dos caminos.
- **Dos transacciones por petición.** Más carga en el pool (dos `fijar_contexto_empresa` y dos `fijar_contexto_actor` por petición). A 30 empresas es despreciable; si molesta, la renovación de actividad puede espaciarse sin cambiar los criterios, salvo el borde exacto de la inactividad.
- **Fuerza bruta del PIN en un equipo robado.** Con el equipo en la mano, cada persona recordada admite 15 intentos antes de que el equipo la olvide: 0,15 % con 4 dígitos y 0,0015 % con 6; con 5 personas, como mucho 0,75 % de acertar con alguna de 4 dígitos. Además el Administrador o la persona pueden revocar el equipo, y las sesiones de contraseña abiertas en ese equipo se cierran con la revocación.
- **Fuerza bruta de la clave de supervisor.** Un Cajero con su propio PIN prueba PIN de 6 dígitos: con k autorizadores en la sucursal, cada intento acierta con probabilidad k / 1 000 000, y el bloqueo por solicitante y por equipo (5 cada 5 minutos) lo frena. Riesgo aceptado con auditoría de cada rechazo.
- **Sesión de contraseña robada.** Las sesiones de contraseña no exigen `X-Equipo` en cada petición (la contraseña ya probó a la persona); un token robado sirve hasta su inactividad o su máximo. Mitigación: tokens en `sessionStorage`, sesiones cortas, revocación del equipo cierra también esas sesiones.
- **Secreto `PIN_PEPPER`.** Si se pierde o se cambia, ningún PIN funciona; si se filtra junto con la base, los PIN se recuperan en segundos. Mitigación: secreto de GitHub y del entorno, nunca en la base ni en los respaldos.
- **Almacenamiento de iPhone y iPad.** Safari puede borrar el almacenamiento de un sitio no instalado tras días sin uso; el equipo olvidaría a todos y cada persona volvería a entrar con contraseña. Mitigación: sugerir instalar la PWA en la pantalla de inicio (las apps instaladas no sufren ese borrado). Los equipos que quedan huérfanos en el servidor no dan acceso a nadie.
- **XSS roba tokens.** Los tokens están en el almacenamiento del navegador. Mitigación: CSP estricta en Cloudflare Pages, sin HTML de terceros, React sin `dangerouslySetInnerHTML`, sesiones cortas y revocables.
- **Enumeración de nombres de usuario** (unicidad global y bloqueo solo de cuentas existentes). Aceptado: los nombres no son secretos (como el RUC en 001); la contraseña y el bloqueo protegen la cuenta.
- **Superadministrador sin doble factor.** Una contraseña filtrada da acceso a todas las empresas por soporte. Mitigación: bloqueo por intentos, sesión de 8 horas, todo auditado y visible para la empresa; doble factor fuera del MVP.
- **`SECURITY DEFINER` nuevas** (`empresa_de_usuario`, `fijar_contexto_actor`, `trazabilidad()` y el trigger de nombres). Un `search_path` mal fijado permitiría suplantar funciones. Mitigación: `SET search_path = pg_catalog, pg_temp` y nombres calificados, como en 001; los criterios 89 y 116 lo verifican en el catálogo; el adversarial lo ataca.
- **La guarda de la API y las consultas fijas nuevas.** `autenticacion` corre fuera de contexto, y `fijar_contexto_actor` es un texto exacto más que la guarda reconoce. Mitigación: comparación por texto exacto como la de salud de 001 y reglas de lint para los nombres de las funciones.
- **Reloj del servidor frente a `now()` de la base.** Mezclarlos daría resultados distintos en las pruebas. Mitigación: toda regla de tiempo usa el reloj de la API como parámetro; la revisión lo comprueba.
- **Tamaño de la sección.** Mucho alcance para una sola especificación. Mitigación: commits por grupo de tareas; el grupo de interfaz se puede separar sin tocar el resto.
