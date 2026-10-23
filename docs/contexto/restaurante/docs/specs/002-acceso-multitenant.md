# 002 — Acceso y aislamiento multitenant en nube

Estado: terminada; verificación integrada cerrada el 2026-10-22.  
Fecha: 2026-10-22  
Proyecto/módulo: restaurante / identidad, ámbitos, autorización y auditoría.  
Riesgo: alto. Metodología: SDD, TDD de invariantes e integración PostgreSQL real.

## Objetivo y actores

Permitir que el administrador de una empresa entre en la nube, administre su acceso y opere únicamente dentro de su empresa y locales autorizados. Actores: operador técnico que realiza el alta explícita mediante CLI, administrador de empresa, usuario con permisos limitados y usuario desactivado. El operador técnico no obtiene una sesión web de suplantación por ejecutar el alta.

## Alcance y exclusiones

Incluye migraciones PostgreSQL propias, tenants/locales, usuarios, roles/permisos, sesiones, auditoría, bootstrap por CLI, demo opcional reproducible y frontend funcional mínimo conectado al backend real. Código propio, sin copiar módulos del panel, natación ni CORE.

No incluye registro público, SSO entre productos, soporte que suplanta usuarios, licencias/activación comercial, recuperación por correo/SMS, ventas/caja, despliegue productivo ni identidad offline. El modo `local` seguirá sin acceso comercial habilitado. No se declara equivalencia con SQLite ni continuidad por crear modelos Sequelize. [ADR 002](../decisiones/002-continuidad.md) mantiene pendientes esas decisiones.

## Modelo de datos y restricciones

- `tenants`: identificador inmutable, código de acceso estable normalizado, nombre y estado. El código ayuda a seleccionar empresa al entrar; no concede permisos ni sustituye la identidad.
- `sites`: identificador, `tenant_id`, código/nombre y estado; unicidad del código dentro del tenant.
- `users`: identificador, `tenant_id`, identificador de acceso normalizado, hash de contraseña, estado y versión de autorización. Unicidad de acceso dentro del tenant; no existe cuenta global compartida.
- `roles`, `role_permissions`, `user_roles`: roles definidos dentro de cada tenant; claves de permiso pertenecen al catálogo técnico del producto. Un rol de A no se asigna a B. Ningún nombre de rol otorga permisos por sí solo.
- `user_sites`: pertenencias explícitas a locales del mismo tenant. Tener un rol no sustituye esta pertenencia. No hay acceso implícito a futuros locales.
- `sessions`: identificador interno, hash de token opaco, `tenant_id`, usuario, emisión, última actividad, expiración absoluta y revocación. Nunca guardar el token reutilizable en claro.
- `audit_events`: identificador, tenant/local cuando proceda, actor o tipo de actor técnico, acción, entidad, fecha UTC, identificador único del evento y resultado, con sin correlación requestId en esta entrega. Nunca contraseñas, tokens, hashes de contraseña ni cuerpos completos de solicitudes.
- Todas las tablas de ámbito tenant incluyen `tenant_id NOT NULL`; las relaciones incluyen claves foráneas compuestas `(tenant_id, entity_id)` y claves únicas compatibles. Las relaciones de local comprueban además su pertenencia al tenant. No basta con filtrar desde Sequelize.
- Migraciones versionadas y transaccionales cuando PostgreSQL lo admita; sin `sync({force:true})`, `alter` automático ni carga demo al iniciar. Datos iniciales técnicos idempotentes mediante migración/comando explícito. No existe administrador universal.

## Aislamiento y autorización obligatorios

1. Tras autenticar, el backend deriva `tenant_id` y usuario de la sesión validada. Rechaza o ignora identificadores tenant libres de URL/cuerpo/cabeceras; nunca los usa para ampliar el ámbito. No hay cambio de empresa dentro de una sesión.
2. Cada operación tenant verifica usuario/tenant activos y permiso explícito. Una operación de local verifica también local activo y pertenencia vigente. Denegar por defecto, incluso si la UI oculta la acción.
3. Cada transacción de negocio aplica RLS con contexto de tenant establecido por backend mediante configuración de alcance transaccional, sin concatenación SQL. `USING` y `WITH CHECK` cubren lectura/escritura; ausencia de contexto deniega todo acceso tenant.
4. La cuenta SQL del backend de negocio no es superusuario, propietaria de tablas ni `BYPASSRLS`; no puede modificar políticas, roles SQL ni desactivar RLS. Habilitar y forzar RLS en tablas tenant. Credencial de migración/bootstrap separada y ausente del proceso HTTP habitual.
5. Con pool de conexiones, contexto y cambios se realizan en la misma transacción/conexión. Un error/rollback o la devolución al pool no deja el tenant del solicitante anterior. No usar configuración de sesión persistente para elegir tenant.
6. El login y la validación inicial de una sesión utilizan funciones SQL estrechas bajo el rol auxiliar NOLOGIN, detalladas en el contrato definitivo. La cuenta web no es propietaria ni elude RLS.
7. Revocar rol/permiso, desactivar usuario/tenant o quitar pertenencia local tiene efecto en la siguiente solicitud comprobada; no confiar en permisos copiados indefinidamente en cookies. Ninguna acción sensible puede confirmar sin comprobar autorización vigente dentro de su límite transaccional.
8. Proteger al último administrador activo con los permisos de administración necesarios dentro del tenant contra desactivación o pérdida de acceso administrativo accidental, incluyendo modificaciones concurrentes.

## Credenciales, sesiones y recuperación

- Contraseñas con Argon2id y sal aleatoria independiente; parámetros y límites se fijan y se miden antes de implementar. Aceptar contraseñas largas sin truncarlas silenciosamente; fijar límites de bytes para evitar consumo ilimitado. No cifrado reversible ni contraseñas por defecto.
- Login con empresa + identificador + contraseña. Fallos por empresa inexistente, usuario inexistente/desactivado o clave incorrecta producen mensaje genérico y una respuesta que no revele la existencia de cuentas. Definir límites de intentos y tratamiento de tiempos antes de implementar.
- Token de sesión generado con fuente criptográfica, al menos 256 bits de entropía. Solo cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` en HTTPS; no almacenamiento en `localStorage` ni parámetros URL. Excepción HTTP solo en loopback de desarrollo explícito.
- Token nuevo tras autenticar; no aceptar un token elegido previamente por el cliente. Definir expiración absoluta/inactividad y sesiones simultáneas antes de implementar. El servidor impone vencimiento y logout revoca la sesión en BD.
- Cambiar o restablecer contraseña revoca todas las sesiones del usuario de forma atómica. No se ofrece recuperación pública sin un canal y un procedimiento de verificación definidos. El bootstrap no sirve como reseteo silencioso de una cuenta existente.
- Operaciones mutables exigen defensa CSRF por token vinculado a sesión y validación de origen; CORS no permite credenciales de orígenes arbitrarios. Las mutaciones nunca usan GET. Los fallos de acceso no filtran stack/SQL.
- Credenciales y sesión se transmiten por HTTPS fuera de loopback. La UI no promete acceso desde móviles/LAN hasta disponer de transporte seguro verificado.

## Bootstrap explícito y auditoría

CLI técnico propuesto `tenant:bootstrap`: crea atómicamente empresa, primer local, administrador, pertenencia local y rol inicial con permisos explícitos. Pide contraseña por entrada oculta; no argumento de línea de comandos, log, fixture ni archivo versionado. Exige destino y parámetros explícitos y no se ejecuta desde HTTP/arranque.

Tenant existente: error sin cambiar contraseña/roles. Un fallo intermedio revierte todo; repetir una ejecución exitosa no duplica ni sobrescribe datos. La creación no registra contratación ni afirma licencia. No se permite apuntar a SQLite mediante esta CLI.

Auditar alta técnica, acceso exitoso/fallido sin datos secretos, logout/revocación, cambio/restablecimiento de contraseña, cambios de usuarios/roles/permisos y pertenencias. Los cambios administrativos y su evento se confirman en la misma transacción; si falla auditoría, no confirmar el cambio. Para intentos sin tenant verificable, usar un registro técnico separado con datos mínimos, sin inventar un tenant.

## Contratos HTTP propuestos e interfaz mínima

`GET /api/health` conserva su significado de proceso vivo; la readiness de PostgreSQL tendrá señal independiente. No usar un 200 del diagnóstico como prueba de BD. Capacidades solo cambian cuando el recorrido esté implementado y verificado.

| Contrato | Resultado y permiso |
|---|---|
| `POST /api/auth/login` | Empresa/identificador/contraseña; crea cookie y contexto mínimo. Sin sesión previa. |
| `POST /api/auth/logout` | Revoca sesión; limpieza de cookie; comportamiento idempotente. |
| `GET /api/context` | Sustituye el rechazo permanente de 001: con sesión válida devuelve usuario, tenant, locales autorizados y permisos; sin ella, 401. |
| `POST /api/auth/password` | Cambia contraseña exigiendo la actual; revoca sesiones y requiere volver a entrar. |
| `/api/users`, `/api/roles`, `/api/sites` | Usuarios y sus asignaciones mediante POST/PATCH, roles mediante POST/PATCH y catálogo de locales mediante GET. Reglas y DTOs en contrato definitivo. |
| `GET /api/audit` | Lectura paginada/filtros acotados; `auditoria.consultar`; siempre dentro del tenant. |

Errores estables: 400 `VALIDATION_ERROR`, 401 `AUTH_REQUIRED`/`INVALID_CREDENTIALS`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`. Consultar un recurso ajeno devuelve 404 sin confirmar su existencia; solicitar una acción sin permiso devuelve 403. Respuestas de autenticación/contexto con `Cache-Control: no-store`. No devolver hashes ni tokens en DTOs. Límites, paginación y campos editables se cierran con los DTOs antes de código.

UI mínima: entrar/salir, contexto y locales disponibles, listado/formulario de usuarios, roles/permisos/asignaciones, cambio de contraseña y consulta de auditoría según permisos. Maneja sesión vencida, errores y estados vacíos; no contiene controles de operación comercial.

## Demo opcional y comandos

`db:migrate`, `db:seed:demo` y `tenant:bootstrap` se documentan con comandos reales en README. Demo con dos empresas ficticias, dos locales en una, administradores y usuarios limitados/desactivados. Identificadores deterministas, sin datos personales reales ni contacto con proveedores. La demo no autoriza acceso entre empresas.

Seed solo por comando explícito sobre BD dedicada marcada como demo; comprobar host/nombre y marca de BD, no solo `NODE_ENV`. Migrar antes; repetir sin duplicados; detectar cambios manuales y abortar antes de sobrescribirlos. No incluir reset destructivo en esta entrega. Pruebas usan otra BD temporal distinta de la demo. Documentar accesos ficticios exclusivamente de demo y cómo generar desde vacío.

## Criterios de aceptación y casos TDD/adversariales

- CA-01: migraciones desde PostgreSQL vacío crean restricciones y políticas; repetir no altera datos. La cuenta web real no es owner/superusuario/BYPASSRLS ni puede modificar políticas.
- CA-02: bootstrap exitoso crea un único ámbito coherente; fallo inyectado revierte todo; repetición rechaza sin sobrescribir. No existe registro web ni cuenta por defecto.
- CA-03: login/contexto/logout funcionan integrados; contraseña errónea/usuario desactivado/sesión vencida o revocada no dan acceso. Tokens no aparecen en almacenamiento/logs/respuestas.
- CA-04: con sesión A, manipular IDs/cabeceras/cuerpo para consultar o modificar B no revela ni cambia datos. RLS sin contexto niega lectura/escritura y las FKs impiden relaciones cruzadas, incluyendo SQL directo con la cuenta web.
- CA-05: alternar peticiones A/B concurrentes en un pool pequeño y forzar rollback no mezcla contextos. Ninguna consulta tenant se ejecuta fuera de su contexto transaccional.
- CA-06: permisos y locales se verifican desde backend; quitar acceso o desactivar bloquea siguiente operación. Dos cambios concurrentes no eliminan al último administrador activo.
- CA-07: cambiar/restablecer contraseña invalida sesiones; intento CSRF/origen ajeno/fijación de sesión se rechaza; límites de login funcionan sin revelar cuentas.
- CA-08: fallar persistencia de auditoría impide confirmar un cambio administrativo; eventos y DTOs no contienen secretos ni datos de otro tenant.
- CA-09: migrar, cargar demo dos veces y ejecutar UI desde otra instalación produce los mismos escenarios sin duplicar ni pisar cambios. Un destino no demo es rechazado sin mutar.
- CA-10: frontend real permite los recorridos; `local` sigue sin acceso comercial. README explica comandos, roles SQL/configuración sin secretos y limitaciones reales.

Primero observar fallos de reglas críticas por ausencia de comportamiento, luego implementar. Integración con PostgreSQL real y credencial web restringida, no solo mocks/SQLite. Registrar comando, escenario, esperado, observado y resolución de hallazgos. El smoke visual no reemplaza ataques directos a API/SQL.

## Decisiones sensibles cerradas

Las seis decisiones técnicas iniciales quedan resueltas por el contrato definitivo inferior: funciones SQL estrechas, política Argon2/sesiones/rate durable, recuperación pública excluida, administración con permisos explícitos y retención sin borrado, y roles PostgreSQL separados verificados con integración real. El bootstrap no es una recuperación. Licencia y política offline permanecen fuera de esta entrega.
## Resultado de verificación

Implementación e integración PostgreSQL17 real ejecutadas; evidencia al final. El despliegue/TLS externo, recuperación pública e identidad offline no forman parte de esta verificación.

## Contrato definitivo antes del código (2026-10-22)

Argon2id m=19456 KiB, t=2, p=1, sal aleatoria. Contraseñas entre 12 y 128 caracteres Unicode y máximo 512 bytes UTF-8, sin normalizar ni truncar. Código/usuario ASCII minúsculo de 3–48 caracteres [a-z0-9_-], trim y lowercase. Sesiones simultáneas permitidas, token opaco 32 bytes y SHA256 en BD, absoluto 12h e inactividad 30min. CSRF aleatorio 32 bytes ligado a sesión y Origin exacto en toda mutación incluido login (login exige Origin, sin CSRF previo). HTTP solo loopback, HTTPS obligatorio en otro origen; proxy no confiable y no se usa X-Forwarded-For.

Límite durable PostgreSQL por HMAC(empresa+usuario): 5 fallos o verificaciones en vuelo/15min, reservados atómicamente antes de Argon2 y liberados al acertar; por HMAC(IP socket): 100 solicitudes de login/15min, sin bloqueo permanente. HMAC secreto servidor de mínimo32 bytes. Usuario inexistente verifica hash Argon2 ficticio para reducir diferencias temporales. Resultado público siempre genérico. Auditoría técnica separada de intentos desconocidos; retención indefinida en esta entrega sin endpoint de borrado. Recuperación pública y soporte de suplantación quedan excluidos; un administrador autorizado puede restablecer clave de otro usuario, revocando sus sesiones; bootstrap nunca modifica tenants existentes.

SQL: schema restaurant, runtime fijo restaurante_runtime sin ownership/super/BYPASSRLS/CREATEROLE/CREATEDB ni membresía auxiliar. Rol restaurante_auth_lookup NOLOGIN solo recibe SELECT en identidades/sesiones y control técnico rate; políticas específicas de ese rol permiten búsquedas técnicas mediante funciones SECURITY DEFINER estrechas de argumento explícito, search_path pg_catalog,restaurant y REVOKE PUBLIC. Runtime solo EXECUTE esas funciones. Tablas tenant FORCE ROW LEVEL SECURITY, FKs compuestas. GUC restaurant.tenant_id solo SET LOCAL dentro de transacción Sequelize. Alta/migración requieren MIGRATION_DATABASE_URL fuera de HTTP. Sin URL runtime o modo local: diagnóstico sin auth; readiness503. Runtime verifica privilegios antes de habilitar auth y readiness consulta BD real.

Permisos iniciales: usuarios.gestionar, roles.gestionar, locales.asignar, auditoria.consultar. Administrador efectivo: usuario activo con todos esos permisos; mutex de fila tenant serializa cambios para conservar al menos uno. Roles no conceden privilegios por nombre. Cambio de roles/estado/password revoca sesiones afectadas; permisos se consultan en cada solicitud. Asignaciones requieren locales activos del tenant; sin asignación no existe acceso al local. No hay creación/borrado de locales por UI en esta entrega.

HTTP definitivo (todas las respuestas {error:{code,message}} en error, listas {items:[]}): login POST /api/auth/login {tenantCode,username,password}; contexto GET /api/context retorna {user:{id,username,active},tenant:{id,code,name},sites:[{id,code,name,active}],permissions:string[],csrfToken}. Cookie restaurant_session. POST logout {} revoca; POST auth/password {currentPassword,newPassword} revoca todas. GET users {id,username,active,roleIds,siteIds}; POST users {username,password,roleIds,siteIds}; PATCH users/:id {active?,roleIds?,siteIds?}; POST users/:id/password {password}. GET roles {id,name,permissions}; POST roles {name,permissions}; PATCH roles/:id {name?,permissions?}. GET sites {id,code,name,active}, con locales.asignar enumera catálogo activo del tenant para administrar asignaciones; sin ese permiso solo pertenencias. Context.sites siempre conserva pertenencias reales, sin acceso operativo implícito; GET permissions catálogo; GET audit?limit=50&offset=0 (máximo100) {items:[{id,action,entityId,actorId,createdAt,outcome}],limit,offset}. Asignaciones de site exigen locales.asignar además de usuarios.gestionar; roleIds exige además roles.gestionar. Cada rol asignado debe conceder únicamente permisos que posea el actor. Crear/editar roles tampoco concede permisos superiores al actor; editar un rol o cuenta cuyos permisos excedan los del actor se rechaza. El restablecimiento administrativo solo opera sobre otros usuarios; la propia clave exige la actual en auth/password. Todos los cambios salvo login requieren X-CSRF-Token. Campos desconocidos rechazados. Sin paginación de usuarios/roles, límite duro de1000 por tenant para esta entrega. Audit acepta action opcional y paginación acotada; sin cuerpos ni secretos.

Demo solo DB loopback restaurante_demo y marca restaurant.environment=demo, tests DB separada restaurante_test con marca test. Sin reset destructivo automático. Demo dos empresas demo-a/demo-b, clave ficticia RestauranteDemo2026! únicamente demo. Repetición compara snapshot de configuración y hashes antes de aceptar; cualquier modificación manual aborta sin escribir.

## Evidencia ejecutada 2026-10-22

- RED funcional HTTP: `npx tsx --test tests/auth-http.test.ts`: Origin falsificado esperaba403 y base001 respondió404. Tras implementar defensa, GREEN. El error inicial MODULE_NOT_FOUND de policy fue preparación, no se cuenta como RED funcional.
- `npm test`: 11/11 PASS sin omitidas (regresión 001 y políticas/HTTP). `npm run typecheck` incluyendo scripts PASS.
- `npm run test:db`: 1 prueba con 12 escenarios secuenciales explícitos PASS, sin omitidas. PostgreSQL 17 real; runtime restringido; marcador de migración incompleta, bootstrap fallo/repetición, ausencia de ámbito, FORCE RLS en 9 tablas, FKs cruzadas, pool con 24 transacciones y rollback, hash de tokens/CSRF, permisos, 12 solicitudes concurrentes con 5 INVALID y 7 RATE, fallo de auditoría con rollback, último administrador y revocación/expiración.
- Revisión adversarial independiente: RED logout repetido401 esperado200; corregido mediante migración incremental003 y función logout_proof (solo prueba coincidencia hash/CSRF, sin otorgar sesión). RED actor usuarios+roles podía asignarse rol administrativo existente: corregido comprobando subconjunto de permisos de cada rol antes de asignar. `node --env-file=.env.test --import tsx --test tests/adversarial-access.test.ts`:11 escenarios PASS. CSRF Unicode inválido devuelve403.
- Demo vacía migrada y seed ejecutado dos veces PASS. Credenciales únicamente ficticias demo-a/demo-b, usuarios admin/consulta/inactivo, clave RestauranteDemo2026!. Dos locales en demo-a. Huella de todas las tablas de configuración impide pisar cambios manuales; sesiones/auditoría no alteran esa huella. Sin reset automático.
- Argon2id0.45.1 nativo medido por coordinación:5 pares hash+verify con clave ficticia50,49,50,51,52ms. Mínimo19456KiB/t2/p1; no certifica hardware piloto.
- Las suites PostgreSQL se ejecutan secuencialmente. Cada suite usa fixtures propios y no utiliza la demo; fallan explícitamente si faltan URLs. No se usa DROP DATABASE/SCHEMA ni syncforce. Trigger audit de prueba limitado al tenant fixture.

Coordinación final: `npm run check:all` PASS tras formato del código con Prettier 3.9.10: tipos (frontend, backend, scripts y tests), lint, build, 11 pruebas unitarias/HTTP, 1 smoke del export y las 2 suites PostgreSQL anteriores (12 + 11 escenarios). Sin omitidas, canceladas ni hallazgos abiertos. La primera invocación al formateador mediante npm.ps1 imprimió código sin escribir; se corrigió la invocación con npm.cmd antes de los checks.

Regresión final de entrada: el patrón UUID inicial aceptaba 36 guiones; RED de política y corrección a segmentos hexadecimales 8-4-4-4-12. Cuerpo inválido produce VALIDATION_ERROR y ruta inválida no entra a SQL (404). UI oculta restablecimiento de clave propia; se utiliza cambio con clave actual. Tras estos cambios se repitió check:all completo y se reinició el artefacto: sesión válida recuperada y botón propio ausente comprobados en navegador. ESLint excluye `.local/`, datos y auxiliares privados de desarrollo.

QA navegador contra artefacto compilado: login de admin en demo A (dos locales), apertura/cancelación del formulario de asignaciones, logout, login de consulta (sin paneles usuarios/roles), rechazo genérico de inactivo y login de admin en demo B (un local y auditoría propia). Las mutaciones sensibles de permisos/contraseña se comprobaron mediante API/integración; no se declara haberlas operado manualmente todas en UI. Revisión visual básica de formulario y contexto; sin certificación de móviles físicos.

Smoke de CLI en TTY real: alta de empresa temporal exclusivamente en `restaurante_test`, contraseña y repetición no aparecieron en la salida; alta completada y fixture retirado mediante consulta parametrizada de ese tenant. Demo cargada nuevamente tras QA sin duplicados. Seed contra destino test/no demo rechazado antes de escribir. Revisión de huella de cambios manuales en código; no se modificó la demo para forzar ese rechazo. Export revisado sin URI runtime ni secreto HMAC incrustados; Git ignora los archivos privados de entorno y cluster.

No inferir operación comercial, despliegue nube, continuidad ni autenticación local de estos resultados. La recuperación pública y la correlación de auditoría por requestId quedan fuera de esta entrega.

RED/GREEN catálogo locales: administrador sin pertenencia obtenía[] en GETsites, esperado catálogo tenant; tras parche, catálogo disponible solo con locales.asignar y contexto permanece vacío. Auditoría utiliza id único por evento; requestId de correlación entre eventos no implementado y no se declara en el DTO final.
