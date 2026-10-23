# 002 — Acceso, permisos y auditoría nativos del panel

Estado: terminada
Fecha: 2026-10-20
Cierre verificado: 2026-10-21
Proyecto: panel administrativo / identidad, autorización y auditoría propios
Riesgo: alto (acceso, recuperación, pérdida de administración y persistencia).

## Objetivo, autoridad y alcance

El fundador autorizó crear los módulos propios del panel. La decisión vigente descarta CORE: no desarrollar ni consumir paquetes compartidos, no copiar implementaciones de otro producto y no esperar dependencias internas externas. La base técnica verificada se conserva. Esta spec entrega acceso local completo, administración de usuarios y consulta autorizada de auditoría antes de los módulos comerciales.

Actores: primer propietario local; propietarios activos; usuarios internos de cobranza y consulta; persona que recupera al propietario mediante su clave. Las cuentas pertenecen únicamente al panel. No existen tenants operativos, usuarios de clientes ni suplantación de productos en este alcance.

Incluye bootstrap, contraseñas, recuperación offline, sesiones, throttling persistente, usuarios/roles fijos, permisos, auditoría, migración 2, demo de acceso y UI mínima integrada. Excluye backups/restauración, reset de contraseña por otro administrador, roles personalizados, licencias, módulos comerciales, nube, LAN, correo/SMS y facturación. Esos planes permanecen documentados y no se simulan con endpoints vacíos.

## Identidad y secretos

- `login`: trim y minúsculas ASCII; 3–64 caracteres de `[a-z0-9._-]`, unicidad persistente insensible a mayúsculas. `displayName`: trim, 1–120 caracteres Unicode. IDs UUID opacos; `version` entero positivo para concurrencia.
- Contraseña: 15–128 puntos de código Unicode; no trim, normalización, truncamiento ni reglas de composición. Permitir espacios, frases y pegado. No registrarla en logs, errores, auditoría ni fixtures persistentes fuera de la demo explícita.
- Hash Argon2id con salt aleatoria por secreto: mínimo inicial memoria 19456 KiB, iteraciones 2, paralelismo 1 y salida 32 bytes; almacenar formato codificado con parámetros. Son valores de partida, no mediciones del hardware mínimo. Comparar mediante verificador de la biblioteca. No habilitar parámetros débiles mediante entorno productivo. Consultados [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) y [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) el 2026-10-20.
- Clave de recuperación: 32 bytes criptográficamente aleatorios, codificados base64url (43 caracteres), guardar solo SHA-256 del valor aleatorio decodificado con comparación de tiempo constante. No es una contraseña elegida por el usuario; la entropía aleatoria permite este verificador. Rechazar formatos no canónicos. Mostrarla únicamente al generarla: bootstrap, recuperación o rotación autenticada. No incluirla en `me`, listados o auditoría.
- La UI exige confirmar que se guardó la clave antes de cerrar la vista de entrega, limpia el valor al continuar y recomienda custodia fuera del equipo. No se persiste un acuse ni se ofrece releer el secreto. No guardar contraseñas/claves en localStorage, sessionStorage, URL, mensajes de error o consola.

## Flujos y sesiones

1. `auth.status` devuelve solo `bootstrapRequired`. Bootstrap exige BD migrada y cero usuarios (incluidos inactivos); crea propietario activo y auditoría en una transacción SQLite IMMEDIATE. Dos peticiones concurrentes solo pueden crear un primer usuario. Devuelve usuario y clave de recuperación una vez; no crea sesión. No hay usuario/clave maestra.
2. Login recibe identificador y contraseña, siempre devuelve mensaje/código genérico ante usuario inexistente, inactivo o contraseña incorrecta. Hacer verificación Argon2 dummy para usuarios no autenticables; no afirmar tiempo constante total de toda la petición. Login correcto revoca la sesión anterior de esa ventana y crea una nueva.
3. Sesiones revocables persistidas con ID aleatorio opaco. El adaptador main conserva exclusivamente la asociación `webContents/frame principal -> sessionId`; el renderer jamás recibe el ID/token ni puede elegir actor, sesión, rol o permisos. Los DTO públicos contienen usuario, permisos actuales y expiraciones, sin token. Cerrar ventana o salir revoca/desasocia la sesión; reiniciar exige login, aunque queden registros históricos revocados en BD.
4. Máximo absoluto 8 h desde creación e inactividad 15 min; al alcanzar cualquiera (`now >= deadline`) revocar y devolver `UNAUTHENTICATED`. Retroceso del reloj anterior a creación/última actividad invalida la sesión; no prometer protección contra modificación del reloj/BD por el dueño del SO.
5. `auth.me` y diagnóstico/polling no renuevan actividad. `auth.touch` renueva solo la inactividad sin superar expiración absoluta, se llama desde eventos de usuario con throttle de 30 s. Operaciones autenticadas iniciadas por usuario también pueden registrar actividad; no mantener sesión con intervalos automáticos.
6. Logout es idempotente y revoca la sesión asociada. Cambiar la propia contraseña exige sesión y contraseña actual, actualiza hash, audita y revoca todas las sesiones del usuario, incluida la actual; obliga login. No rota la clave de recuperación por un cambio ordinario de contraseña.
7. Recuperación recibe `login`, `recoveryKey`, `newPassword`; solo sirve para propietario activo. Comprobar clave, actualizar contraseña, sustituir verificador por clave nueva, revocar sesiones y auditar en una transacción. La clave anterior no se reutiliza ni con peticiones concurrentes. No cambia roles ni reactiva usuarios y no inicia sesión automáticamente. Error genérico para identificador/clave incorrectos o usuario no elegible.
8. `auth.rotateRecoveryKey` requiere sesión de propietario activo y contraseña actual; sustituye el verificador y entrega la nueva clave una vez. Promover a propietario no entrega secretos a quien asigna el rol: el nuevo propietario inicia sesión y puede generar su propia clave con su contraseña. Quitar el rol propietario invalida su verificador y sus sesiones; una promoción posterior no revive la clave antigua.

### Retraso progresivo persistente

Dos buckets por operación sensible (login, recover, changePassword y rotateRecoveryKey): global y por principal, este último identificado mediante SHA-256 del login normalizado (derivado de la sesión en cambio/rotación). Se crean igual para logins desconocidos, sin almacenar el identificador arbitrario en claro. Fallas 1–4 sin demora adicional; tras la falla n≥5 fijar en cada bucket `nextAllowedAt = now + min(60000, 1000 * 2^(n-5))`. No dormir el proceso principal: devolver `RATE_LIMITED` mientras cualquiera no haya vencido y `retryAfterMs` como la mayor espera, sin extenderla por peticiones rechazadas. Tras la fecha se permite un intento. Incrementar ambos buckets en una transacción; un éxito reinicia solo el global y el principal autenticado, conservando fallas de otros identificadores. Así, conocer credenciales de consulta no permite alternar login válido con intentos contra el propietario para reiniciar su límite.

Persistir incremento/deadline atómicamente y conservarlos al reiniciar. No hay bloqueo permanente ni bypass reiniciando Electron. El bucket global evita evadir el límite alternando logins, a costa de que fallos de una persona retrasen hasta 60 s a otras. Validación de formato acotada precede al hash; los fallos de credenciales con formato válido son indistinguibles.

## Roles, permisos y último propietario

Roles iniciales fijos `owner` (Propietario), `collections` (Cobranza) y `viewer` (Consulta). No hay edición de catálogo de roles/permisos en esta spec. Cada usuario tiene al menos un rol conocido y sin duplicados. No autorizar por nombre mostrado: derivar el conjunto efectivo desde las asociaciones persistidas en cada petición.

| Operación | Permisos/regla |
|---|---|
| auth.status/bootstrap/login/recover | Ventana y origen autorizados; reglas especiales anteriores |
| auth.me/touch/changePassword | Sesión vigente propia; nunca `userId` para cambiar otro usuario |
| auth.logout | Ventana autorizada; idempotente sin sesión |
| auth.rotateRecoveryKey | Sesión vigente, propietario activo y contraseña actual |
| users.list, roles.list | `plataforma.usuarios.ver` |
| users.create | `plataforma.usuarios.gestionar` y `plataforma.roles.asignar` |
| users.update/disable | `plataforma.usuarios.gestionar` |
| roles.assign | `plataforma.roles.asignar` |
| audit.list | `plataforma.auditoria.ver` |

`owner` recibe los cuatro permisos indicados. Cobranza/Consulta reciben cero de esos cuatro en esta entrega: pueden iniciar/cerrar sesión y cambiar su propia contraseña, pero no ver usuarios/auditoría ni asignar roles. Sus permisos comerciales se incorporarán con las specs de negocio, sin introducir ahora acciones inexistentes.

Usuarios: crear con contraseña inicial y roles válidos; actualizar nombre/login/estado con `expectedVersion`; desactivar sin borrar; reactivar mediante update; asignar el conjunto completo de roles con versión esperada. La UI no cambia roles mediante users.update. Cada mutación incrementa versión; conflicto devuelve `CONFLICT`. Cambio de login, roles, estado o contraseña revoca sesiones del afectado. Los catálogos nunca eliminan usuarios/auditoría.

Toda desactivación o retirada de rol comprueba transaccionalmente que quede al menos un propietario activo. Usar IMMEDIATE/serialización real en SQLite para impedir que dos propietarios se quiten simultáneamente; repetir la comprobación dentro de la escritura, no antes del lock. Si se queda sin administrador, `LAST_ADMIN_REQUIRED`, sin mutación ni auditoría de éxito. La restricción es del backend aunque el formulario o canal se invoquen directamente.

## Contratos exactos y transporte

Fuente ejecutable: `src/contracts/access.ts`; extiende `window.panel` manteniendo `systemStatus()`. Grupos y métodos:

```text
auth.status(), bootstrap({login,displayName,password}), login({login,password}), logout(), me(), touch()
auth.changePassword({currentPassword,newPassword})
auth.recover({login,recoveryKey,newPassword})
auth.rotateRecoveryKey({currentPassword})
users.list({page?,pageSize?}?), create({login,displayName,password,roleCodes})
users.update({id,expectedVersion,login,displayName,active}), disable({id,expectedVersion})
roles.list(), assign({id,expectedVersion,roleCodes})
audit.list({page?,pageSize?,action?,actorId?}?)
```

Canales independientes enumerados `panel:` + operación (por ejemplo `panel:auth.login`), no un canal con nombre libre de operación suministrado por renderer. El preload publica objetos/métodos concretos y filtra argumentos inesperados en el backend; no confía en TypeScript como validación. Rechazar campos extra como actorId/sessionId/permissions/roleCodes en métodos que no los declaran. Mantener guard de webContents/frame/esquema/host y controles CSP/protocolo de la base.

`Result<T>` conserva requestId generado backend y error `{code,message,fields?,retryAfterMs?}`. Códigos: `VALIDATION_ERROR`, `UNAUTHENTICATED` (incluye login/recuperación inválidos), `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `LAST_ADMIN_REQUIRED`, `RATE_LIMITED`, `INTERNAL_ERROR`. Login inválido: «No se pudo iniciar sesión con las credenciales indicadas.»; recuperación inválida: «No se pudo recuperar el acceso con los datos indicados.». No devolver SQL, rutas, hashes, buffers, stack, token o razones internas de credenciales. Paginar desde 1, pageSize por defecto 20 y máximo 100; enteros positivos, filtros de strings acotados; rechazar valores inválidos. Orden estable de usuarios por login/id y auditoría por instante DESC/id DESC.

Retirar `core` del DTO SystemStatus y del estado/UI/tests actuales; no sustituirlo con un indicador que sugiera dependencia. La evidencia histórica de spec 001 y sus DTOs observados permanece intacta.

## Persistencia, auditoría y demo

Migración 2 aditiva/transaccional: usuarios y hash/version/estado; roles, permisos y asociaciones; sesiones; verificador de recuperación; buckets de limitación; eventos de auditoría. Respetar schema1 y su metadata, migrar desde vacío y desde una copia de prueba v1, repetir sin cambios. Nunca sync destructivo ni reconstrucción al fallar. Índices únicos/FKs/not-null y consultas parametrizadas.

Auditoría append-only a nivel aplicación y BD: ningún endpoint update/delete y triggers que rechacen actualización/eliminación directa de eventos. Evento público solo `id,occurredAt,actorId|null,action,targetId|null,outcome,requestId`. Nunca persistir payload de entrada ni secretos (tampoco hash de contraseña/recuperación/token). Auditar bootstrap, login correcto/incorrecto, logout, cambios/recuperación/rotación de contraseña/clave, crear/editar/desactivar usuario y asignar roles. Actor nulo para intentos no autenticados; no guardar login arbitrario fallido. Éxito sensible y evento se confirman juntos: fallo de auditoría revierte cambio. Intentos fallidos/rechazos pueden escribirse en su propia transacción sin convertirlos en éxito. Listado paginado requiere permiso y no renueva inactividad por polling.

Demo de acceso opcional en directorio dedicado fuera del repo, con nombre de BD reservado y marcador de demo creado únicamente al inicializar un destino vacío mediante comando explícito; nunca basta `NODE_ENV` o una variable sola. Rechazar ruta normal, BD sin marcador, usuarios ajenos al escenario o cambios incompatibles. Identificadores estables para propietario/cobranza/consulta/desactivado y contraseña demo publicada de al menos 15 caracteres; no definir una clave de recuperación fija. Repetición verifica escenario y no duplica ni sobrescribe ediciones. No borrar ni ofrecer reset genérico en este alcance. Fixtures de tests temporales separados de demo y BD normal. README deberá documentar los comandos reales, credenciales ficticias y cómo arrancar sin seed.

Implementación de demo acordada: destino absoluto con directorio final `panel-access-demo` y archivo `panel-access-demo.sqlite3`, ambos fuera del repositorio (validación léxica y ancestro canónico antes de crear carpetas). Solo un archivo inexistente creado exclusivamente por el comando puede inicializarse. Si ya existe, exige metadata `environment=demo`, escenario `access-v1`, esquema actual y huella de usuarios/roles/verificadores sin cambios; no migra ni repuebla destinos existentes. Un fallo inicial puede dejar la demo incompleta y se informa; no se borran archivos automáticamente ni se reconstruye silenciosamente al repetir. Logins `owner.demo`, `cobranza.demo`, `consulta.demo`, `inactivo.demo`, contraseña pública exclusiva `Demo-panel-2026-seguro`. No hay clientes, cobros ni otra demo comercial todavía.

La huella excluye sesiones, intentos y auditoría: usar normalmente el login/logout no invalida una demo. Cambios de perfil, estado, contraseña, rol o clave de recuperación sí producen conflicto y se preservan; no se restablece su valor inicial. Una demo parcial sin huella completa se rechaza al repetir. La CLI compilada debe comprobarse con un subprocess Node real que consulte la BD creada, no solo con imports de la función.

## Frontend mínimo

Pantalla inicial decide bootstrap/login mediante auth.status/me. Bootstrap y recuperación muestran la nueva clave una vez con confirmación local. Sesión autenticada muestra usuario, logout y cambio de contraseña; propietario también rotación de clave. Usuarios: listado paginado, crear, editar/activar/desactivar y asignar roles según permisos; confirmación para desactivar/cambiar roles propios. Auditoría: listado paginado y filtros. Carga, validación, conflictos/versiones, rate-limit con espera y sesión expirada se manejan sin datos falsos. No almacenar tokens ni sondear touch automáticamente. UI sencilla con estilos existentes, sin diseño visual adicional.

## Aceptación y pruebas requeridas

- CA-01: migración v1→v2 conserva metadata/datos, repetición idempotente y rollback real ante fallo.
- CA-02: bootstrap válido crea exactamente un propietario; carreras, repetición y BD con usuarios inactivos rechazan una segunda toma de posesión.
- CA-03: límite 15/128 Unicode, frases, salts distintos y hash/verificador protegidos; DTOs/errores/auditoría no exponen secretos.
- CA-04: login genérico en desconocido/inactivo/incorrecto; buckets global/principal persisten al reiniciar, no se eluden cambiando login ni intercalando login válido de otro usuario, espera no se prolonga por peticiones rechazadas y vuelve a permitir intento al vencer.
- CA-05: sesión sin token en renderer; otra ventana/frame/origen no la obtiene; 8 h, 15 min y retroceso de reloj la invalidan; polling no renueva; touch válido no excede máximo.
- CA-06: logout, desactivación, login/roles y cambio de contraseña revocan; backend usa permisos vigentes aunque el renderer omita controles.
- CA-07: recuperación incorrecta genérica, válida consume/rota clave y contraseña; replay y dos recuperaciones simultáneas solo permiten un éxito. Solo propietario activo; rotación requiere contraseña propia.
- CA-08: CRUD mínimo, paginación y expectedVersion funcionan; intentos de elevarse desde consulta/cobranza fallan y dos retiradas/desactivaciones concurrentes no eliminan al último propietario activo.
- CA-09: auditoría se lista solo autorizada, es append-only, contiene eventos útiles sin secretos y falla de auditoría revierte la escritura sensible.
- CA-10: demo repetida no duplica, rechaza BD real/no marcada sin modificarla y permite login con tres roles y desactivado; fixtures siguen aislados.
- CA-11: E2E Electron offline real bootstrap→guardar clave→login→crear usuario→asignar rol→logout/login restringido→cambio/recuperación→auditoría y estados de error. No afirmar toda la secuencia si solo se ejecuta parte: registrar los recorridos observados.
- CA-12: `core` desaparece de contrato/UI/tests actuales, evidencia001 se preserva; pasan lint/tipos/tests/build y humo empaquetado con Argon2id nativo contra Electron real.

TDD en reglas críticas antes de implementación, integración SQLite real, reloj/azar inyectables y revisión adversarial independiente. Casos prioritarios: carreras bootstrap/último dueño/recovery; payload con actor/token/roles falsos; saltar UI; replay de sesión o clave; límites de password/paginación; error transaccional de auditoría; BD demo apuntada por error a instalación normal. Registrar fallo esperado/observado y evidencia de cada caso ejecutado, sin confundir enumeración con prueba.

## Decisiones y verificación

Las elecciones rutinarias anteriores concretan el alcance autorizado; no hay una duda de producto que obligue a esperar CORE. La dependencia Argon2id de terceros y su empaquetado se fijarán/verificarán en el ADR antes de entregar; rendimiento de hardware mínimo e instalador firmado permanecen pendientes comerciales. El coste CPU/memoria de hashes obliga a acotar entradas y serializar intentos sensibles; no ejecutar trabajo síncrono pesado en renderer.

## Verificación y cierre

La funcionalidad se cierra el 2026-10-21 con el recorrido Electron/UI, checks completos y humo de Argon2id en el ejecutable empaquetado correctos. Esta evidencia corresponde a desarrollo y bases temporales reales, no a usuarios productivos. Versión actual de aplicación: 0.2.0; SystemStatus ya no incluye el campo `core`, y la evidencia histórica 001 permanece intacta. Las ejecuciones parciales siguientes se conservan como historial; la ejecución final reemplaza su estado pendiente.

- La demo se especificó y probó primero con un stub: se observaron dos fallos por ausencia de creación del escenario antes de implementar. Después se verificaron creación de cuatro IDs estables, login de los tres usuarios activos, rechazo del inactivo, repetición sin cambios incluso tras login/logout, conflicto por edición manual y preservación de bases normales/archivos ajenos. La CLI compilada se ejecutó por subprocess y se consultó su SQLite resultante; dos ejecuciones conservan cuatro usuarios y bytes de la BD.
- La suite independiente `tests/backend/access-adversarial.test.ts` ejecutó nueve casos correctos al 2026-10-20: carreras de dos propietarios entre conexiones SQLite distintas para desactivarse y quitarse rol; respuesta genérica y camino dummy real para desconocido/inactivo; invalidación de clave al perder/recuperar rol; cambio de contraseña con salt nueva y revocación de todas las sesiones; login canónico y límites Unicode; bridge con servicio real sin token público, rechazo de frame y payload falsos y cierre de sesión; rechazo de reemplazo de auditoría; resistencia a reinicio de rate-limit mediante login válido de consulta.
- Última ejecución acotada de revisión: `npx vitest run tests/backend/access-adversarial.test.ts tests/backend/demo.test.ts` terminó con 15 pruebas correctas y una omitida. La omitida intenta crear una junction temporal para verificar el ancestro canónico: este sandbox devuelve EPERM al crear el enlace; la defensa existe y fue revisada en código, pero no se cuenta como ejecutada en ese entorno.
- El implementador informó una ejecución nativa consolidada de 27 pruebas correctas y una omitida antes de pasar a checks/UI; no se presenta como resultado final de toda la aplicación. El coordinador midió aproximadamente 58 ms para hash+verificación Argon2id en la máquina actual, con memoria 19456 KiB, t=2 y p=1. Es una medición local puntual, no certifica el hardware mínimo ni latencia garantizada.

| Hallazgo observado en revisión independiente | Corrección y regresión |
|---|---|
| Login duplicado normalizado retornaba INTERNAL_ERROR en vez de CONFLICT | Mapeo de restricción única SQLite contempla sus campos array; test pasó y permitió ejecutar además los límites Unicode |
| INSERT OR REPLACE podía sobrescribir un evento pese a triggers UPDATE/DELETE | Trigger BEFORE INSERT rechaza IDs de auditoría existentes; test que reprodujo el reemplazo pasó después |
| Login válido de consulta limpiaba el límite global y permitía alternar ataques contra propietario | Buckets global y por principal, ambos transaccionales; el éxito limpia solo el principal actual y el global. Regresión reprodujo primero un login permitido indebidamente y luego RATE_LIMITED |

No se atribuye a esta pasada independiente la implementación de autenticación: el revisor solo implementó el seed/CLI y sus pruebas, y agregó las pruebas adversariales de los módulos desarrollados por otro agente. No se afirma ciclo TDD completo por cada regla sin evidencia individual.

### Evidencia final (2026-10-21)

- `npm ci --no-audit --no-fund`: código 0, 542 paquetes; `npm run desktop:install`: código 0, en Windows x64.
- `npm run check` desde esa instalación limpia: código 0. Lint, tipos, nueve archivos con **48 pruebas correctas y ninguna omitida**, incluidos el ancestro junction real, SQLite, CLI, acceso, concurrencia y regresiones adversariales. Build Next estático y Electron/backend correcto; seis rutas de aplicación.
- `npx playwright test --config=playwright.config.ts`: código 0, **2/2**. Electron real sin internet: bootstrap, entrega y descarte de clave, login incorrecto/correcto, recarga, crear/editar/desactivar/reactivar usuario, asignar roles, logout, cuenta restringida, navegación directa a usuarios, denegación IPC, listado de auditoría, cambio de contraseña, rotación, recuperación incorrecta/correcta y nuevo login. Sin errores de página/consola ni solicitudes HTTP(S). Arnés sin preload informa que requiere escritorio.
- Se corrigieron los fixtures del E2E: timeout según API instalada, locators de contraseña limitados a cada sección, clave incorrecta con formato canónico para llegar al backend y reingreso de campos que la UI borra tras errores. Se mantuvieron la validación cliente y el borrado de secretos; se comprobó navegación real, sin sustituirla por manipulación de history.
- El primer empaquetado intentó recompilar Argon2 y falló por falta de Visual Studio. Tras revisión independiente se configuró `npmRebuild: false` para addons Node-API de la instalación Windows x64; se repitieron instalación limpia, checks y empaquetado. Decisión y condiciones en [ADR 001](../decisiones/001-stack.md).
- `npx electron-builder --win --dir --x64`: código 0. `node dist/smoke-packaged-auth.cjs`: código 0 sobre `release/win-unpacked/Panel Administrativo.exe`, `isPackaged: true`, versión 0.2.0, Electron 44.9.0, Node integrado 24.22.0, Node-API 10, x64 y aplicación cargada de `resources/app.asar`; addons nativos presentes en `app.asar.unpacked`.
- El humo usa una SQLite temporal con esquema 1 y metadato centinela: migró a 2 y conservó el dato. Ejecutó bootstrap, hash Argon2id, rechazo de contraseña incorrecta, login correcto, creación/listado de dos usuarios, denegación al usuario consulta, recuperación y rechazo de replay de clave, auditoría, recarga y navegación directa offline. Renderer sin `require`. Cerrar la última ventana terminó la app; reabrir exigió login y la consulta posterior de SQLite confirmó todas las sesiones revocadas. Limpieza limitada a su directorio temporal.
- Capturas de inicio y usuarios del paquete revisadas: contenido legible, acciones visibles y sin claves de recuperación. Evidencia local regenerable bajo `test-results/`; el script puntual de humo y los artefactos están en directorios ignorados, no son dependencias del producto.

CA-01–CA-10 quedan cubiertos por la integración SQLite y las pruebas críticas/adversariales descritas; CA-11 por el recorrido Playwright completo y CA-12 por checks, eliminación del contrato legado y ejecutable real. La revisión independiente resolvió los tres defectos de la tabla anterior y validó la decisión de empaquetado condicionada al humo.

Límites: `Get-AuthenticodeSignature` informó **NotSigned**. No se verificaron instalación/actualización NSIS, hardware mínimo, otra plataforma ni CI remoto. Backups, módulos comerciales, licencias, nube y facturación siguen fuera del alcance. La auditoría de dependencias conserva los dos avisos moderados documentados en el ADR; no se declara auditoría limpia. El código fuente se versiona en la rama `main` del repositorio del panel; su publicación no constituye una release de distribución.
