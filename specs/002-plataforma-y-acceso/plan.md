# 002 · Plan técnico

## Módulos afectados

- `packages/dominio`: `src/permisos.ts` (roles, acciones, matriz, `requisitoPermiso`, `puedeAutorizar`, `alcanceReportes`, `permisosDeRol`), `src/suscripcion.ts` (`estadoSuscripcion`, `sumarMeses`, `fechaLima`, `periodoLima`), `src/modulos.ts` (`MODULOS`), con pruebas unitarias.
- `packages/contratos`: `src/sesiones.ts`, `src/usuarios.ts`, `src/equipos.ts`, `src/autorizaciones.ts`, `src/suscripciones.ts` (planes, pagos, alta por HTTP), `src/errores.ts` (códigos nuevos), `src/comunes.ts` (`fechaSchema`, `montoSchema`, `motivoSchema`), `src/plataforma.ts` (`suscripcion` opcional en `sucursalEntradaSchema`, `emisorRespuestaSchema`).
- `apps/api`:
  - `src/config/entorno.ts`: `PIN_PEPPER`, `ORIGENES_PERMITIDOS`; `EMPRESA_POR_HEADER=habilitado` solo con `NODE_ENV=test`.
  - `src/aplicacion.ts`: CORS, opción `reloj`.
  - `src/nucleo/reloj/`: `RELOJ`, `RelojSistema`, `RelojManual` (para las pruebas: `fijar`, `avanzar`).
  - `src/nucleo/principal/`: almacén del principal de la petición (`AsyncLocalStorage`) y su interceptor global.
  - `src/nucleo/contexto-empresa/`: registro de `ResolutorEmpresaSesion` en `RESOLUTOR_EMPRESA`; `ENTORNOS_CON_CABECERA` pasa a `['test']`.
  - `src/nucleo/base-de-datos/consultas-sin-empresa.ts`: consulta fija `autenticacion` (`SELECT empresa_de_usuario($1) AS empresa_id`).
  - `src/nucleo/idempotencia/`: tabla `idempotencia`, `IdempotenciaInterceptor`, `@Idempotente()`.
  - `src/modulos/auditoria/` (nuevo): dueño de `auditoria`; `AuditoriaService`, `insertarAuditoriaPlataforma`.
  - `src/modulos/seguridad/` (nuevo): dueño de `usuario`, `acceso_sucursal`, `sucursal_acceso`, `equipo`, `sesion`, `autorizacion`, `bloqueo_intentos` y del esquema `autenticacion`. `AutenticacionGuard` (global), `ResolutorEmpresaSesion`, `SesionActual`, decoradores, `PermisoInterceptor`, `ModuloInterceptor`, servicios (`SesionesService`, `UsuariosService`, `EquiposService`, `AutorizacionService`, `BloqueosService`, `Credenciales`) y controladores (`sesiones`, `sesion`, `equipo(s)`, `usuarios`, `autorizaciones`, `sucursales/:id/acceso`).
  - `src/modulos/plataforma/`: dueño además de `superadministrador`, `sesion_superadministrador`, `plan`, `suscripcion`, `pago_suscripcion`, `consumo_comprobantes`, `idempotencia_plataforma`. `SuperadministradorGuard` y `@Superadministrador()`, `SuperadministradoresService`, `PlanesService`, `SuscripcionService`, `SoporteService`; controladores `/plataforma/*`, `EmisoresController` (`GET`/`POST /emisores`) y `POST /sucursales` en `SucursalesController`. `OperacionPlataforma` escribe en `auditoria` y acepta el actor superadministrador.
  - `src/migraciones/`: cinco migraciones nuevas, repartidas por grupo de tareas (ver "Migraciones").
  - `scripts/superadministrador.ts` (`pnpm plataforma:superadmin`), `scripts/lib/superadministrador.ts`, `scripts/semilla.ts` (superadministrador y usuarios de demostración).
  - `eslint.config.js`: `empresa_de_usuario` tratado como `fijar_contexto_empresa` (solo en `consultas-sin-empresa.ts` y migraciones).
- `apps/app` (nuevo): PWA React + Vite.
- `packages/ui` (nuevo): componentes base compartidos (también para `apps/web` más adelante).
- `.github/workflows/ci.yml`: `apps/app` en lint, tipos, pruebas y build; E2E de Playwright en un job aparte.
- `README.md`, `.env.example`: variables nuevas, `EMPRESA_POR_HEADER` fuera de `development`, cómo crear el superadministrador.

## Diseño

### Camino de una petición

```
Petición HTTP
 → AutenticacionGuard (APP_GUARD, seguridad)
     @Publica()                         → pasa sin principal
     @Superadministrador()              → lo resuelve SuperadministradorGuard (ruta), no este guard
     NODE_ENV=test + EMPRESA_POR_HEADER + sin Authorization
                                        → principal PRUEBA (Administrador) con la empresa de x-empresa-id (o sin empresa)
     si no:
       token = Bearer se.<empresaId>.<sesionId>.<secreto>     (mal formado → 401 NO_AUTENTICADO)
       r = ContextoEmpresa.ejecutar(empresaId, validarYRenovar)   ← transacción propia, se confirma
       r.error → lanzar después de confirmar (SESION_EXPIRADA cierra la sesión y se guarda el cierre)
       peticion.principal = r.principal
     reglas de ruta con el principal: @SoloAdministrador, @RequiereSucursal, contraseña temporal → 403/409
 → PrincipalInterceptor (APP_INTERCEPTOR, registrado antes que el de contexto): corre el resto dentro de
   principalActual.run(principal, …)
 → ContextoEmpresaInterceptor (001, sin cambios): RESOLUTOR_EMPRESA = ResolutorEmpresaSesion
     (lee peticion.principal.empresaId) → ContextoEmpresa.ejecutar(empresaId, handler)
 → interceptores de ruta, dentro de la transacción: IdempotenciaInterceptor, ModuloInterceptor, PermisoInterceptor
 → controlador → servicios → AuditoriaService.registrar (misma transacción)
```

- **Dos transacciones por petición autenticada:** la del guard (validar y renovar la sesión) y la del controlador. Así la renovación y el cierre por expiración quedan guardados aunque el controlador falle, y no se toca el interceptor de 001 (criterio 27b de 001: después de `ejecutar` se puede abrir otro).
- **`validarYRenovar`:** busca la sesión por id bajo RLS (con la empresa del token, si es ajena no aparece: criterio 3), compara la huella con `timingSafeEqual`, comprueba `cerrada_en`, el máximo absoluto y la inactividad con el reloj de la API, y según el tipo: PIN exige `X-Equipo` del mismo equipo y no desvinculado (criterio 37); usuario activo y acceso a la sucursal activa (criterio 6; si no, cierra); soporte, que no esté cerrada (la desactivación del superadministrador la cierra, criterio 61). Si la petición no trae `X-Actividad: segundo-plano`, actualiza `ultima_actividad_en`. Calcula el rol: Administrador si `es_administrador` (o soporte, o prueba), si no el de `acceso_sucursal` para la sucursal activa.
- **Rutas de plataforma:** `@Superadministrador()` compone `@SinEmpresa()`, la marca de metadatos y `UseGuards(SuperadministradorGuard)`. El guard valida `sa.<sesionId>.<secreto>` con `OperacionPlataforma.consultar` (solo lectura) y deja `peticion.superadministrador`. Si una ruta `/plataforma/*` olvidara el decorador, `AutenticacionGuard` la trataría como ruta de empresa y un token `sa.` daría 401: la falla es cerrada. El criterio 62 recorre las rutas `/plataforma/*`.
- **Rutas públicas:** `@Publica()` implica `@SinEmpresa()`. La prueba del criterio 1 compara la lista de rutas públicas con la permitida.
- **`ResolutorEmpresaPorCabecera`:** queda, usado solo por el modo de prueba del guard. `cabeceraHabilitada` exige `NODE_ENV=test`, y `cargarEntorno` rechaza `EMPRESA_POR_HEADER=habilitado` con `development` o `production`.

### Tokens, contraseñas y PIN

- **Secretos de sesión y de equipo:** `randomBytes(32)` en base64url; en la base solo `sha256(secreto)` (`bytea`). Como el secreto es aleatorio de 256 bits, SHA-256 basta (no hace falta un hash lento). El token lleva la empresa para que el guard abra el contexto sin buscar entre empresas.
- **Contraseñas:** `crypto.scrypt` de Node (sin dependencias nativas; RNF-18), N = 2^15, r = 8, p = 1, sal de 16 bytes, clave de 32 bytes, `maxmem` de 64 MB. Formato `scrypt$15$8$1$<sal>$<hash>` en base64, para poder subir el costo después. Comparación con `timingSafeEqual`. Para un usuario inexistente o sin contraseña se calcula igual un scrypt contra un hash fijo (mismo tiempo de respuesta, criterio 11).
- **PIN:** `huella_pin = HMAC-SHA256(PIN_PEPPER, empresaId + ':' + pin)`. Es un hash con clave (RNF-07): con solo la base no se pueden probar los 10 000 PIN, hace falta también el secreto del entorno. Permite buscar al usuario por su PIN con un índice único `(empresa_id, huella_pin)` (HU-03 pide solo el PIN). Generación: `randomInt(0, 10000)` con relleno a 4 dígitos; antes de guardar se comprueba que la huella no exista en la empresa y se reintenta (hasta 20 veces); una carrera entre dos altas simultáneas termina en violación de unicidad y la API responde 409 `CONFLICTO` (rara; el Administrador reintenta).
- **El PIN nunca se registra:** el filtro de errores y el registro de Nest no deben imprimir cuerpos de petición; las entradas con `pin`, `contrasena`, `actual`, `nueva` y `contrasenaTemporal` se excluyen de cualquier registro de depuración.

### Ingreso con contraseña (búsqueda entre empresas)

1. `POST /sesiones/contrasena` es `@Publica()`. El servicio normaliza el nombre y llama `SELECT empresa_de_usuario($1) AS empresa_id` sin contexto, como consulta fija marcada `{ sinEmpresa: 'autenticacion' }` (igual que la de salud de 001).
2. `empresa_de_usuario` es `SECURITY DEFINER` (dueña `restaurante_migrador`, `search_path` fijo) y lee `autenticacion.nombre_usuario` por igualdad exacta. El esquema no tiene `USAGE` para los roles de la aplicación, así que no se puede enumerar.
3. Con la empresa, `ContextoEmpresa.ejecutar(empresa, …)` lee el usuario bajo RLS, revisa el bloqueo, verifica la contraseña, actualiza `bloqueo_intentos` y crea la sesión. Devuelve un resultado (`ok` o el error a lanzar); el controlador lanza **después** de que la transacción se confirmó, así los fallos y el bloqueo quedan guardados (criterio 12).
4. `autenticacion.nombre_usuario` la mantiene un trigger `AFTER INSERT OR UPDATE OF nombre_usuario OR DELETE` sobre `usuario`, `SECURITY DEFINER` y dueño el migrador. Un nombre repetido en otra empresa falla con `23505` sobre la llave de esa tabla; la API lo traduce a 409 sin detalle (criterio 90).

Las tablas de `public` tienen RLS forzada sin política para el migrador, así que las funciones `SECURITY DEFINER` no pueden leer `usuario`: por eso la relación vive en una tabla propia fuera de `public`, sin RLS, como `contexto.sesion_empresa` en 001.

### Fallos que se guardan aunque la respuesta sea un error

Las transacciones del controlador se revierten si se lanza un error, y con ellas se perdería la cuenta de fallos y la auditoría del rechazo. Por eso las rutas que cuentan fallos (`POST /sesiones/contrasena`, `POST /sesiones/pin`, `PUT /sesion/contrasena`, `POST /autorizaciones`, `POST /plataforma/sesiones`) son `@SinEmpresa()`: su servicio abre su propio `ContextoEmpresa.ejecutar` (u `OperacionPlataforma.ejecutar`), devuelve un resultado con el error a lanzar y el controlador lo lanza después de confirmar. `POST /autorizaciones` sigue autenticada (el guard deja el principal), solo que sin la transacción del interceptor; su idempotencia se maneja dentro del servicio.

### Equipos e ingreso con PIN

- `POST /equipos` exige sesión `CONTRASENA` o `SOPORTE` de Administrador; crea la fila con la huella del secreto y devuelve el token una vez.
- `GET /equipo` y `POST /sesiones/pin` son públicas: parsean `eq.<empresaId>.<equipoId>.<secreto>`, abren `ContextoEmpresa.ejecutar(empresaId)` y validan el equipo. En `POST /sesiones/pin`: revisa el bloqueo del equipo, calcula la huella del PIN con la empresa del equipo, busca el usuario por `(empresa_id, huella_pin)`, exige que esté activo y tenga acceso a la sucursal del equipo (o sea Administrador), cierra la sesión PIN abierta del equipo (índice único parcial, criterio 38) y crea la nueva; actualiza `ultimo_uso_en`.
- Desvincular marca `desvinculado_en` y cierra las sesiones PIN abiertas del equipo en la misma transacción.

### Autorizaciones y `@Permiso`

- `POST /autorizaciones`: valida la entrada; con el rol del solicitante en la sucursal activa calcula `requisitoPermiso` (`prohibido` → 403, `permitido` → 409, sin sucursal → 409); revisa los bloqueos del solicitante y del equipo; busca al autorizador por la huella del PIN, exige activo, distinto del solicitante, con acceso a la sucursal y `puedeAutorizar(rol, accion)`; crea la fila `autorizacion` (sesión, solicitante, autorizador, sucursal, equipo, acción, motivo, `expira_en = ahora + 2 min`) y audita. En el rechazo: cuenta fallo, audita `autorizacion_rechazada` y, al quinto, el bloqueo.
- `@Permiso(accion)` = metadatos + `PermisoInterceptor` de ruta, que corre dentro de la transacción del controlador: `prohibido` → 403; `permitido` → sigue; `clave` → exige `X-Autorizacion` y llama `AutorizacionService.consumir`, que hace `UPDATE autorizacion SET usada_en = ahora WHERE id = $1 AND sesion_id = $2 AND accion = $3 AND sucursal_id = $4 AND usada_en IS NULL AND expira_en > ahora RETURNING …`. Si no actualiza ninguna fila, 403 `AUTORIZACION_INVALIDA`. El `UPDATE` con condición resuelve la concurrencia: la segunda transacción espera el bloqueo de la fila y, tras la confirmación de la primera, ya no cumple `usada_en IS NULL` (criterio 50). Después del controlador, el interceptor escribe la auditoría de la acción con el solicitante, el autorizador, el motivo y el `autorizacionId`, en la misma transacción.

### Auditoría general y unión con `auditoria_plataforma`

- Módulo propio `modulos/auditoria`, sin dependencias de otros módulos. `AuditoriaService.registrar(entrada)` toma la empresa del contexto y el actor del principal de la petición (usuario, superadministrador en soporte o `prueba`); fuera de una petición (semilla, tareas) recibe `actorSistema`.
- `insertarAuditoriaPlataforma(transaccion, fila)` inserta con SQL explícito usando la transacción recibida (la de plataforma). `OperacionPlataforma` la llama en lugar de crear el modelo `AuditoriaPlataforma`; así el módulo de auditoría sigue siendo dueño de la tabla sin importar la conexión de plataforma (regla de lint del criterio 37 de 001).
- `OperacionPlataforma.ejecutar`: `actor` pasa a `string | { superadministradorId: string }`. Un texto se guarda en `actor_sistema` (la semilla, los scripts y las pruebas de 001 siguen funcionando); el objeto, en `actor_superadministrador_id`. Las validaciones de 001 (vacío, NUL, sustitutos) siguen sobre el texto.
- La auditoría se escribe con la hora del reloj de la API.

### Superadministrador y soporte

- Superadministradores en `plataforma`. El script `pnpm plataforma:superadmin crear|desactivar` usa `crearSuperadministrador` / `desactivarSuperadministrador` sobre `OperacionPlataforma` con actor `cli:superadmin`. La contraseña se pide por la entrada estándar o por `SUPERADMIN_CONTRASENA` (solo para automatizar), nunca como argumento.
- Ingreso: `OperacionPlataforma.consultar` para leer al superadministrador y verificar; `OperacionPlataforma.ejecutar` para crear la sesión (auditoría `ingreso_superadministrador`) o para contar el fallo (auditoría `ingreso_superadministrador_fallido`, y `bloqueo_superadministrador` al quinto). Toda escritura de plataforma pasa por `ejecutar` y queda auditada; no se agrega una vía de escritura sin auditoría.
- Sin inactividad en el servidor para el superadministrador: renovarla exigiría una escritura por petición y, con ella, una fila de auditoría por petición. La sesión dura 8 horas y la PWA la cierra tras 30 minutos sin uso.
- Soporte: `OperacionPlataforma.ejecutar` comprueba la empresa (y la sucursal, si viene), inserta la sesión `SOPORTE` con `insertarSesionSoporte(transaccion, datos)` del módulo de seguridad (SQL con la transacción recibida, como la auditoría) y audita `inicio_soporte` con la empresa. Desactivar un superadministrador cierra con `cerrarSesionesDeSuperadministrador(transaccion, id)` sus sesiones de soporte en todas las empresas (política `acceso_plataforma` sobre `sesion`).
- El alta por HTTP crea al primer Administrador con `insertarAdministradorInicial(transaccion, datos)` del módulo de seguridad (genera el PIN, guarda las huellas, el trigger mantiene `autenticacion.nombre_usuario`).

Las funciones que reciben la transacción de plataforma son funciones exportadas, no proveedores, para evitar dependencias circulares entre módulos de Nest (seguridad usa servicios de plataforma: sucursales y suscripciones).

### Suscripciones

- `SuscripcionService` (plataforma) es el único que lee y escribe `plan`, `suscripcion`, `pago_suscripcion` y `consumo_comprobantes`. Expone a otros módulos `estadoDeSucursal`, `estadosDeEmpresa` (avisos), `modulosDeSucursal`, `exigirAperturaDeCaja`, `registrarComprobanteEmitido` y `crearParaSucursal` (lo usa `POST /sucursales`).
- El estado no se guarda: se calcula con `estadoSuscripcion` de `packages/dominio` y el reloj de la API. No hace falta una tarea programada, y el cambio de estado no depende de que algo corra a medianoche.
- `registrarComprobanteEmitido`: `INSERT … ON CONFLICT (sucursal_id, periodo) DO UPDATE SET emitidos = consumo_comprobantes.emitidos + 1 RETURNING emitidos` (atómico frente a la concurrencia), y la cuota se lee del plan actual.
- Pagos: `vencimientoNuevo > vencimiento` se valida con `SELECT … FOR UPDATE` de la suscripción dentro de la operación; el pago guarda el vencimiento anterior y el nuevo.
- Montos con `NUMERIC` y como texto en el contrato; si algún cálculo los suma (no en esta sección), con `decimal.js`.

### Idempotencia

- `@Idempotente()` + `IdempotenciaInterceptor` dentro de la transacción del controlador: `INSERT INTO idempotencia (… estado 'en_curso') ON CONFLICT DO NOTHING`. Si insertó, ejecuta el controlador y guarda estado y respuesta en la misma fila. Si no insertó, la fila ya existe: si la otra transacción sigue abierta, el `INSERT` espera su confirmación; luego se lee la fila y, si la huella de la entrada (ruta + actor + cuerpo canónico) coincide, se devuelve la respuesta guardada; si no, 422. Si la primera se revirtió, el `INSERT` de la segunda entra y ejecuta normalmente. Las respuestas de error no se guardan porque la transacción se revierte.
- `idempotencia_plataforma`: lo mismo dentro de `OperacionPlataforma.ejecutar` (ayudante en el módulo de plataforma).
- Retención: 24 horas; la limpieza borra filas viejas al pasar (sin tarea programada en esta sección).

### Reloj

`RELOJ` (`{ ahora(): Date }`) se inyecta en todos los servicios con reglas de tiempo. Las consultas reciben la hora como parámetro en lugar de usar `now()`. `RelojManual` (exportado) permite a las pruebas fijar y avanzar la hora; `crearAplicacion({ reloj })` lo instala.

### Configuración

- `PIN_PEPPER`: obligatoria fuera de `development` y `test` (mensaje que nombra la variable, como `DB_PASSWORD_*`); se valida que decodificada tenga al menos 32 bytes.
- CORS: `app.enableCors` con `ORIGENES_PERMITIDOS`, cabeceras permitidas `Authorization`, `Content-Type`, `X-Equipo`, `X-Actividad`, `X-Autorizacion`, `Idempotency-Key`, y expuesta `Retry-After`. Sin cookies.

### PWA (`apps/app`) y `packages/ui`

- React 19 + Vite + TypeScript, `vite-plugin-pwa` (manifiesto y caché solo de archivos estáticos; nunca de la API), React Router y TanStack Query. Pruebas con Vitest y Testing Library; un flujo E2E con Playwright (vincular equipo, ingresar con PIN, cambio de usuario, cierre por inactividad).
- `src/lib/api.ts`: URL de `VITE_API_URL`; agrega `Authorization`, `X-Equipo` y, en consultas automáticas, `X-Actividad: segundo-plano`; genera una `Idempotency-Key` por escritura lógica y la reutiliza en los reintentos; reintenta con espera creciente ante cortes de red y 5xx; traduce los códigos de error a mensajes en español.
- Almacenamiento: token del equipo en `localStorage` (debe sobrevivir a cierres); token de sesión de empresa y de superadministrador en `sessionStorage` (sobrevive a recargas, no a cerrar la pestaña).
- Inactividad: temporizador con los eventos de interacción y `expiraPorInactividadEn` del servidor; al vencer, `DELETE /sesion` (sin esperar) y vuelta a la pantalla de PIN o al ingreso.
- Estructura: `src/modulos/acceso/` (ingreso, PIN, vincular, cambio de contraseña, elegir sucursal), `src/modulos/administracion/` (usuarios, equipos, acceso de la sucursal), `src/modulos/plataforma/` (panel), `src/componentes/VentanaClaveSupervisor.tsx`, `src/lib/`.
- `packages/ui`: tokens de diseño y componentes base (botón, campo, teclado numérico, diálogo, aviso, tabla). Si no existen `PRODUCT.md` y `DESIGN.md`, el frontend los crea con la skill `impeccable` antes de las pantallas y el orquestador se los muestra al usuario.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Token opaco con la empresa dentro (`se.<empresa>.<sesion>.<secreto>`), sesión guardada en la base | JWT firmado | Se puede revocar al instante (desvincular, desactivar, cambio rápido de usuario) y la inactividad vive en el servidor; con la empresa en el token el guard abre el contexto sin buscar entre empresas, y si alguien la cambia, la sesión no aparece bajo RLS |
| Bearer en cabecera; token del equipo en `localStorage` | Cookies `httpOnly` | La PWA (Cloudflare Pages) y la API están en dominios distintos y Safari bloquea las cookies de terceros. Riesgo XSS mitigado con CSP y sin HTML de terceros |
| Validar la sesión en una transacción propia del guard | Validarla dentro de la transacción del controlador | La renovación y el cierre por expiración deben guardarse aunque el controlador falle, y así el interceptor de 001 no cambia |
| `autenticacion.nombre_usuario` fuera de `public` + `empresa_de_usuario` `SECURITY DEFINER` | Pedir la empresa en el formulario de ingreso | Peor experiencia y un dato más que recordar (pregunta 12) |
| (misma) | Tabla global en `public` legible por la API | Permitiría enumerar usuarios de todas las empresas; la función solo responde por un nombre exacto |
| PIN con HMAC y secreto del entorno, único por empresa, generado por el sistema | scrypt por usuario, elegido por la persona | HU-03 pide solo el PIN, así que hay que buscar por PIN: con scrypt por usuario habría que probar todos; elegirlo revelaría el PIN de otro al decir "ya está en uso" |
| scrypt de `node:crypto` para contraseñas | argon2 (dependencia nativa) | Sin compilación nativa en el VPS ni en CI; parámetros recomendados por OWASP para scrypt |
| Autorización de supervisor de un solo uso, en dos pasos (`POST /autorizaciones` y `X-Autorizacion`) | PIN y motivo dentro de la misma petición de la acción | Los fallos y su auditoría deben guardarse aunque la acción no ocurra; la ventana es una sola para todas las acciones; el consumo con `UPDATE` condicional resuelve la concurrencia |
| Estado de la suscripción calculado al consultar | Columna de estado actualizada por una tarea diaria | Sin colas ni tareas programadas todavía; el cálculo es puro y probado en `packages/dominio` |
| Auditoría en un módulo propio y escrita con la transacción recibida | Que cada módulo tenga su tabla de auditoría | RNF-09 y HU-36 piden una vista única de quién hizo qué; el usuario decidió unir `auditoria_plataforma` |
| Copiar `auditoria_plataforma` a `auditoria` y borrarla | Mantenerla como histórico de solo lectura | Una sola tabla para consultar; la copia conserva el actor original como `actor_sistema` |
| Rutas protegidas por defecto (guard global) con lista cerrada de rutas públicas | `@UseGuards` en cada controlador | Una ruta nueva sin decorador queda cerrada, no abierta |
| Administrador como marca del usuario, no como acceso por sucursal | Rol Administrador en `acceso_sucursal` | Pregunta 11; si el usuario decide lo contrario, cambia el cálculo del rol en el guard y la validación de accesos, no el resto |
| Configuración de inactividad en `sucursal_acceso` (módulo de seguridad) | Columna nueva en `sucursal` | Cada módulo es dueño de sus tablas y no cambia `sucursalRespuesta` de 001 (sus pruebas protegidas comparan respuestas completas) |
| Vincular desde el propio equipo con sesión de Administrador | Código de emparejamiento | Con un código, la tablet no sabe de qué empresa es y habría que buscar el código entre empresas; así no hace falta |
| Panel del superadministrador dentro de la PWA | Aplicación aparte | Una sola aplicación que construir y desplegar; el panel usa su propio token y sus rutas |

## Migraciones

Con fecha posterior a las de 001 (`202610270002`), una o dos por grupo de tareas para que cada commit deje la base coherente.

- `202610280001-acceso-base.ts` (C0):
  - esquema `autenticacion` (dueño `restaurante_migrador`, `REVOKE ALL … FROM PUBLIC`) y `autenticacion.nombre_usuario`;
  - `superadministrador`, `sesion_superadministrador`, `idempotencia_plataforma` (solo plataforma);
  - `usuario` (con su trigger `SECURITY DEFINER`), `acceso_sucursal`, `sesion` (con `equipo_id` sin llave todavía), `bloqueo_intentos`, `idempotencia`;
  - `public.empresa_de_usuario(text)`;
  - políticas `acceso_plataforma` en `usuario` y `sesion`.
- `202610280002-auditoria-general.ts` (C0):
  - `auditoria` con restricciones (un solo actor), triggers de inmutabilidad, políticas y privilegios; `equipo_id` y `autorizacion_id` sin llave todavía;
  - copia de `auditoria_plataforma` (con `NO FORCE` temporal en ambas tablas) y `DROP TABLE auditoria_plataforma` y su función de trigger;
  - `down`: recrea `auditoria_plataforma` como en 001, copia de vuelta las filas de origen plataforma (`actor` = `actor_sistema` o el id del superadministrador como texto) y borra `auditoria`. Revertirla exige revertir también el código de `OperacionPlataforma`; se anota en el archivo.
- `202610280003-suscripciones.ts` (C1):
  - `plan` con políticas `acceso_plataforma` y `lectura_api`, índice único parcial del plan por defecto, e inserción de `BASE`;
  - `suscripcion`, `pago_suscripcion` (con triggers de inmutabilidad), `consumo_comprobantes`;
  - **datos:** una suscripción `BASE` para cada sucursal existente, con vencimiento un mes después de la fecha de la migración en Lima (quitar y volver a poner `FORCE ROW LEVEL SECURITY` en `sucursal` y `suscripcion` dentro de la migración, como indica el plan de 001).
- `202610280004-equipos.ts` (C2): `equipo`, `sucursal_acceso`, y las llaves de `sesion.equipo_id` y `auditoria.equipo_id` (compuestas con `empresa_id`).
- `202610280005-autorizaciones.ts` (C3): `autorizacion` y la llave de `auditoria.autorizacion_id`.

Todas usan `sqlTablaDeEmpresa` y `sqlTablaDePlataforma` de 001; `plan` necesita una variante con lectura para la API (nueva opción del ayudante o SQL explícito).

Mientras C1 no esté, `registrarEmpresa` y `agregarSucursal` no crean suscripción (como en 001); las pruebas de P8 que la esperan quedan en rojo hasta T29.

## Riesgos

- **Pruebas protegidas de 001.** La unión de la auditoría y los cambios de los criterios 30 y 31 rompen pruebas protegidas de 001. Mitigación: las actualiza test-writer en la fase B (P10) sin quitar aserciones; el orquestador revisa con `git diff` que no se debilitó nada; la fase B empieza cuando cierre la fase E de 001.
- **Dos transacciones por petición.** Más carga en el pool (dos `fijar_contexto_empresa` por petición). A 30 empresas es despreciable; si molesta, la renovación de actividad puede espaciarse (por ejemplo, una escritura cada 30 segundos) sin cambiar los criterios, salvo el borde exacto de la inactividad.
- **Fuerza bruta del PIN.** 4 dígitos son 10 000 combinaciones; con 30 usuarios por empresa, cada intento acierta a alguien con probabilidad 0,3 %. El bloqueo por equipo (5 intentos cada 5 minutos) y la auditoría de los bloqueos lo frenan, pero alguien con tiempo en el local podría entrar en horas. Mitigación: pregunta 13 (6 dígitos), bloqueo escalonado si hiciera falta, y el equipo solo existe dentro del local.
- **Secreto `PIN_PEPPER`.** Si se pierde o se cambia, ningún PIN funciona (hay que regenerarlos todos); si se filtra junto con la base, los PIN se recuperan en segundos. Mitigación: secreto de GitHub y del entorno, nunca en la base ni en los respaldos; documentado en el README.
- **Almacenamiento de iPhone y iPad.** Safari puede borrar el almacenamiento de un sitio no instalado tras días sin uso; el equipo quedaría desvinculado. Mitigación: instalar la PWA en la pantalla de inicio (las apps instaladas no sufren ese borrado) e indicarlo en la pantalla de vinculación.
- **XSS roba tokens.** Los tokens están en el almacenamiento del navegador. Mitigación: CSP estricta en Cloudflare Pages, sin HTML de terceros, React sin `dangerouslySetInnerHTML`, sesiones cortas y revocables.
- **Enumeración de nombres de usuario** (unicidad global y bloqueo solo de cuentas existentes). Aceptado: los nombres no son secretos (como el RUC en 001); la contraseña y el bloqueo protegen la cuenta.
- **Superadministrador sin doble factor.** Una contraseña filtrada da acceso a todas las empresas por soporte. Mitigación en esta sección: bloqueo por intentos, sesión de 8 horas, todo auditado y visible para la empresa; doble factor queda fuera del MVP (anotado).
- **`SECURITY DEFINER` nuevas** (`empresa_de_usuario` y el trigger). Un `search_path` mal fijado permitiría suplantar funciones. Mitigación: `SET search_path = pg_catalog, pg_temp` y nombres calificados, como en 001; el criterio 89 lo verifica en el catálogo; el adversarial lo ataca.
- **La guarda de la API y la consulta fija nueva.** La consulta `autenticacion` corre fuera de contexto; si su texto se pudiera variar, abriría una vía sin contexto. Mitigación: comparación por texto exacto como la de salud de 001 y regla de lint para el nombre de la función.
- **Reloj del servidor frente a `now()` de la base.** Mezclarlos daría resultados distintos en las pruebas. Mitigación: toda regla de tiempo usa el reloj de la API como parámetro; la revisión lo comprueba.
- **Tamaño de la sección.** Mucho alcance para una sola especificación. Mitigación: commits por grupo de tareas; el grupo de interfaz se puede separar sin tocar el resto (ver "Decisión sobre la interfaz" en `spec.md`).
