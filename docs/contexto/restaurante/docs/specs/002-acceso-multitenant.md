# 002 — Acceso y aislamiento multitenant en nube

Estado: borrador; no lista para implementar hasta resolver las decisiones sensibles finales.  
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
- `audit_events`: identificador, tenant/local cuando proceda, actor o tipo de actor técnico, acción, entidad, fecha UTC, identificador de solicitud y resultado, con metadatos mínimos permitidos. Nunca contraseñas, tokens, hashes de contraseña ni cuerpos completos de solicitudes.
- Todas las tablas de ámbito tenant incluyen `tenant_id NOT NULL`; las relaciones incluyen claves foráneas compuestas `(tenant_id, entity_id)` y claves únicas compatibles. Las relaciones de local comprueban además su pertenencia al tenant. No basta con filtrar desde Sequelize.
- Migraciones versionadas y transaccionales cuando PostgreSQL lo admita; sin `sync({force:true})`, `alter` automático ni carga demo al iniciar. Datos iniciales técnicos idempotentes mediante migración/comando explícito. No existe administrador universal.

## Aislamiento y autorización obligatorios

1. Tras autenticar, el backend deriva `tenant_id` y usuario de la sesión validada. Rechaza o ignora identificadores tenant libres de URL/cuerpo/cabeceras; nunca los usa para ampliar el ámbito. No hay cambio de empresa dentro de una sesión.
2. Cada operación tenant verifica usuario/tenant activos y permiso explícito. Una operación de local verifica también local activo y pertenencia vigente. Denegar por defecto, incluso si la UI oculta la acción.
3. Cada transacción de negocio aplica RLS con contexto de tenant establecido por backend mediante configuración de alcance transaccional, sin concatenación SQL. `USING` y `WITH CHECK` cubren lectura/escritura; ausencia de contexto deniega todo acceso tenant.
4. La cuenta SQL del backend de negocio no es superusuario, propietaria de tablas ni `BYPASSRLS`; no puede modificar políticas, roles SQL ni desactivar RLS. Habilitar y forzar RLS en tablas tenant. Credencial de migración/bootstrap separada y ausente del proceso HTTP habitual.
5. Con pool de conexiones, contexto y cambios se realizan en la misma transacción/conexión. Un error/rollback o la devolución al pool no deja el tenant del solicitante anterior. No usar configuración de sesión persistente para elegir tenant.
6. El login y la validación inicial de una sesión necesitan un acceso técnico estrecho antes de establecer contexto: definir el mecanismo en las decisiones pendientes. No solucionar esta excepción haciendo propietaria a la cuenta web ni dejando todas las tablas sin RLS.
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

| Contrato propuesto | Resultado y permiso |
|---|---|
| `POST /api/auth/login` | Empresa/identificador/contraseña; crea cookie y contexto mínimo. Sin sesión previa. |
| `POST /api/auth/logout` | Revoca sesión; limpieza de cookie; comportamiento idempotente. |
| `GET /api/context` | Sustituye el rechazo permanente de 001: con sesión válida devuelve usuario, tenant, locales autorizados y permisos; sin ella, 401. |
| `POST /api/auth/password` | Cambia contraseña exigiendo la actual; revoca sesiones y requiere volver a entrar. |
| `/api/users`, `/api/roles`, `/api/user-sites` | Listado/alta/cambios de estado y asignaciones; permisos `usuarios.gestionar`, `roles.gestionar`, `locales.asignar` respectivamente. Métodos/DTOs finales antes de implementar. |
| `GET /api/audit` | Lectura paginada/filtros acotados; `auditoria.consultar`; siempre dentro del tenant. |

Errores estables: 400 `VALIDATION_ERROR`, 401 `AUTH_REQUIRED`/`INVALID_CREDENTIALS`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`. Consultar un recurso ajeno devuelve 404 sin confirmar su existencia; solicitar una acción sin permiso devuelve 403. Respuestas de autenticación/contexto con `Cache-Control: no-store`. No devolver hashes ni tokens en DTOs. Límites, paginación y campos editables se cierran con los DTOs antes de código.

UI mínima: entrar/salir, contexto y locales disponibles, listado/formulario de usuarios, roles/permisos/asignaciones, cambio de contraseña y consulta de auditoría según permisos. Maneja sesión vencida, errores y estados vacíos; no contiene controles de operación comercial.

## Demo opcional y comandos

`db:migrate`, `db:seed:demo` y bootstrap se documentan con sus comandos reales al implementar. Demo con dos empresas ficticias, al menos dos locales en una, administradores y usuarios limitados/desactivados. Identificadores deterministas, sin datos personales reales ni contacto con proveedores. La demo no autoriza acceso entre empresas.

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

## Decisiones sensibles pendientes antes de implementar

1. Mecanismo estrecho de login/búsqueda de sesión previo a RLS: funciones SQL limitadas o rol técnico separado, privilegios exactos y protección de `search_path`; sin bypass general para el servidor web.
2. Política exacta de contraseñas, parámetros Argon2id medidos, normalización de acceso/código de empresa y límites de tamaño; valores de vencimiento/inactividad y sesiones simultáneas.
3. Límite de intentos/almacén compartido y duración de bloqueo o espera, evitando bloqueo abusivo de usuarios y enumeración. No confiar solo en memoria de una instancia cloud.
4. Recuperación del administrador sin acceso: quién acredita la identidad, procedimiento técnico auditable y revocación de sesiones. No inventar preguntas de seguridad ni una clave maestra.
5. DTOs/métodos definitivos de administración, catálogo inicial completo, tratamiento del administrador inicial y alcance de auditoría/retención. Permitir consultas históricas sin facilitar eliminación de evidencia.
6. Provisionamiento de roles PostgreSQL y secretos para pruebas/despliegue, objetivo de readiness y transporte HTTPS. Si PostgreSQL no está disponible en el entorno, la integración pendiente bloquea cerrar la spec.

Licencia y política offline no se deciden aquí. Las dudas anteriores deben quedar resueltas en este documento antes de cambiar el estado a lista para implementar.

## Resultado de verificación

No implementado ni ejecutado. Ningún criterio se considera aprobado por estar enumerado.
