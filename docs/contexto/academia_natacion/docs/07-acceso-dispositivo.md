# Acceso, permisos y autorización Android — v0.2.0

Fecha: 2026-10-21. Implementación propia, sin CORE. Ver spec 002 y registro de verificación para distinguir código de validación nativa/de despliegue.

## Identidades y permisos

La academia es un tenant con slug. El login recibe academia, usuario y contraseña; los demás endpoints derivan el ámbito desde la sesión. El frontend no puede elegir tenant por parámetros adicionales. Relaciones SQL compuestas y filtros explícitos impiden referencias de otro tenant en estas operaciones. La cuenta de BD del API, separación de permisos de migración y RLS deben calificarse antes de un despliegue cloud productivo; esta entrega no afirma RLS implementado.

| Rol fijo | Permisos |
|---|---|
| ADMIN | users.read, users.manage, roles.read, devices.read, devices.manage, audit.read, offline.use |
| SECRETARIA | devices.read, offline.use |
| ENTRENADOR / ALUMNO | Perfil, contraseña y cierre de su sesión; sin permisos administrativos ni uso offline operativo. |

Roles personalizados y permisos del negocio aún no implementado se añaden por specs posteriores; esta API no permite editar arbitrariamente roles del sistema. Los nombres de rol no reemplazan los permisos verificados en backend.

Contraseñas del personal: 12–128 caracteres; scrypt con sal aleatoria de 16 bytes, N=65536/r=8/p=2 y salida de 32 bytes, comparación de tiempo constante. No se guardan claves en claro. Crear/resetear usuario exige cambio inicial; el propietario creado por CLI elige contraseña definitiva. La regla histórica DNI para alumnos no se usa para personal; se revisa al implementar cuentas de alumnos.

Sesiones aleatorias de 256 bits, hash SHA-256 en BD y vigencia online de 12 horas. Cambio de contraseña/rol/estado incrementa versión y revoca sesiones; logout elimina sesión. Cinco fallos bloquean cuenta 15 minutos; rate limit de login por IP. En varias réplicas el rate limit en memoria debe sustituirse por almacenamiento compartido antes del despliegue; el bloqueo por cuenta sí es transaccional en PostgreSQL.

Web: cookie HttpOnly/SameSite Strict y Secure en producción; token no llega al JavaScript ni localStorage. `WEB_ORIGIN` define el origen público exacto para comprobar CSRF en mutaciones; obligatorio en producción. Solo permite HTTP de loopback para smoke local; dominio productivo requiere HTTPS. El proxy filtra rutas y conserva autorización de backend.

Móvil: token, clave privada del equipo y permiso offline en SecureStore, no SQLite. No se persiste contraseña. Cambio de operador requiere login online; logout elimina sesión/permiso local. Desactivar usuario no alcanza instantáneamente a un móvil desconectado: su permiso anterior puede durar hasta su límite de 24 horas.

## Preparación explícita

1. Configurar `.env` con PostgreSQL de desarrollo. Ejecutar `npm run keys:generate`: crea `.env.keys` sin sobrescribir y muestra solo la clave pública. Respaldar la privada fuera del repositorio. Los scripts API/CLI leen `.env` y `.env.keys`.
2. Copiar la línea pública `EXPO_PUBLIC_OFFLINE_PUBLIC_KEY=...` a `apps/mobile/.env`, junto a la URL pública/de desarrollo de la API. Nunca copiar la privada al móvil.
3. `npm run db:migrate`: migración transaccional versionada; repetir conserva datos. No carga demos ni crea usuarios.
4. Completar BOOTSTRAP_ACADEMY, BOOTSTRAP_ACADEMY_NAME, BOOTSTRAP_USERNAME, BOOTSTRAP_NAME y BOOTSTRAP_PASSWORD con valores propios en `.env`; `npm run users:bootstrap`. No hay bootstrap HTTP ni usuario universal.
5. Retirar BOOTSTRAP_PASSWORD de `.env` tras usarla. Una academia existente no se vuelve a crear ni se sobrescribe por ese comando.

Para recuperación administrativa de mantenimiento, con acceso autorizado a la BD: configurar BOOTSTRAP_ACADEMY, BOOTSTRAP_USERNAME y BOOTSTRAP_PASSWORD propia, y ejecutar `npm run users:recover`. Solo recupera una cuenta ADMIN existente; activa, elimina bloqueo, revoca sesiones y audita el canal de mantenimiento. No libera anticipadamente la autorización del celular anterior. No requiere exponer un endpoint de recuperación sin autenticación.

## Demo opcional

Crear una BD dedicada cuyo nombre termine `_demo`, configurar API_DATABASE_URL para esa BD, migrar y ejecutar explícitamente `npm run db:seed:demo`. No usar la conexión operativa. Se exige sufijo demo, ausencia de tenants normales y ausencia de tablas ajenas. No se mezclan academias normales y demo en una misma BD.

Dos academias ficticias: `demo-azul` y `demo-verde`:

| Usuario | Contraseña solo demo | Estado |
|---|---|---|
| admin | DemoLocal2026! | ADMIN, acceso inicial definitivo de demo. |
| secretaria | RecepcionDemo2026! | SECRETARIA, cambio inicial obligatorio. |
| entrenador | EntrenadorDemo2026! | ENTRENADOR, cambio inicial obligatorio. |
| inactivo | InactivoDemo2026! | Inactivo; no puede entrar. |

Carga transaccional e idempotente. Repetir conserva las academias existentes y no restablece contraseñas ni cambios manuales. No hay reset destructivo. La demo no designa un celular ni emite permisos automáticamente y no contacta proveedores externos.

## Flujo del celular

1. Login online; cambiar contraseña temporal si corresponde.
2. Android crea clave Ed25519 aleatoria en SecureStore y registra el equipo con un desafío firmado, de un solo uso y dos minutos, ligado a tenant/usuario/clave/propósito.
3. ADMIN designa desde web o móvil. La petición incluye la designación esperada para detectar cambios concurrentes; la segunda incompatible queda rechazada/auditada.
4. En el equipo designado, un usuario con offline.use pulsa Sincronizar acceso: prueba posesión con otro desafío, servidor revalida sesión y permisos, y firma un permiso para ese usuario/tenant/dispositivo/clave/versión de hasta 24 horas.
5. El cliente verifica la firma con la clave pública de confianza configurada; no confía automáticamente en una clave recibida por red. Persiste permiso/ancla en SecureStore. Login y health no renuevan la vigencia.

Esta sincronización cubre únicamente acceso y permisos. No habilita cobros, alumnos, asistencia ni cola de negocio todavía. Al incorporar esos datos, la emisión del permiso debe depender de la sincronización completa y sus confirmaciones; no usar este botón como atajo para extender datos comerciales desactualizados.

La exclusividad se serializa bloqueando la academia en PostgreSQL. Si el celular actual tiene un permiso vigente, no puede designarse otro hasta vencer el último emitido, aunque se cierre sesión. Después puede reemplazarse online, con auditoría. No existe revocación inmediata a un teléfono sin conexión ni liberación automática por perderlo.

## Tiempo y build nativo

Módulo local `piscina-clock`: `SystemClock.elapsedRealtime()` incluye suspensión y `Settings.Global.BOOT_COUNT` identifica el arranque. La ancla se toma antes de la solicitud para que la latencia no extienda la vigencia. Reinicio, rollback o variación de reloj de más de cinco segundos obliga a reconectar; tras 24 horas se deniega autorización para nuevas operaciones offline. El módulo debe estar disponible y no se sustituye por Date.now ante fallos.

**Expo Go sirve para acceso online, pero no contiene este módulo propio.** El acceso offline requiere un build Android nativo del proyecto. Verificarlo en teléfono antes de certificarlo; las pruebas puras/bundle y autolinking no demuestran comportamiento real de SecureStore, suspensión o reloj. El control no pretende resistir un sistema rooteado o una aplicación modificada.

## Endpoints

Todas las rutas sensibles exigen Bearer válido, salvo login; web los consume por `/api/access/...` con cookie de mismo origen.

| Ruta | Uso |
|---|---|
| POST /auth/login | academia, usuario y contraseña; token solo para cliente nativo/BFF. |
| GET /auth/me | Perfil, permisos y cambio obligatorio pendiente. |
| POST /auth/logout | Revocar sesión. |
| POST /auth/password | currentPassword/newPassword; revoca todas las sesiones y requiere login. |
| GET /users; POST /users | Listar/crear dentro de la academia, con permisos. |
| PATCH /users/:id | displayName, role, active y version esperada; revoca sesiones y protege último ADMIN. |
| POST /users/:id/reset-password | Contraseña temporal; cambio obligatorio y revocación. |
| GET /roles | Catálogo fijo y permisos. |
| POST /devices/challenge | publicKey y purpose register/lease; devuelve id y mensaje a firmar. |
| POST /devices/register | challengeId, signature y nombre; requiere posesión. |
| GET /devices | Equipos del ámbito, designación y último vencimiento. |
| POST /devices/:id/designate | expectedDeviceId (id o null), solo administrador. |
| POST /devices/:id/access-sync | Desafío y firma de clave del equipo; devuelve payload/signature y clave pública informativa. |
| GET /audit | Últimos 100 eventos del ámbito; el historial completo se conserva. |

Errores: 400 entrada inválida, 401 sesión/credenciales, 403 permisos/cambio obligatorio/firma, 404 recurso no visible, 409 conflicto/último administrador/permiso anterior vigente y 429 límite de intentos. Auditoría registra identidad, acción, rechazo y cambios, sin contraseñas, tokens ni claves privadas.

## Pruebas aisladas

`API_TEST_DATABASE_URL` es obligatoria para integración y smoke de acceso: loopback y base con sufijo `_test`. Nunca toma API_DATABASE_URL como fallback. El rol de esa BD exclusivamente de pruebas necesita CREATE SCHEMA/CREATEDB para fixtures efímeros; no dar CREATEDB al rol productivo de la API. Los tests crean esquemas/bases de nombres aleatorios validados y eliminan solo esos fixtures.

Comandos: `npm run check`, `npm run test:postgres`, `npm run smoke`, `npm run smoke:access`. El último usa Edge instalado en Windows o Google Chrome en Linux, en perfil temporal headless; no tu navegador personal. Comprueba cookie HttpOnly/Secure, CSRF, login/alta/logout reales y recuperación CLI.

CI separa comprobaciones API/web/JS de compilación Kotlin Android. Compilar no certifica dispositivo físico ni firma/distribución comercial. Hosting, RLS/cuenta no propietaria, respaldo y gestión productiva de claves siguen pendientes de calificación antes del piloto.
