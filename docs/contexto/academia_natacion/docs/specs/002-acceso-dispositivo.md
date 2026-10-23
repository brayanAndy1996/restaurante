# 002 — Usuarios, permisos y único celular offline

Estado: implementada; verificación nativa física pendiente. Riesgo: alto. Fecha: 2026-10-21.

## Objetivo y alcance

Acceso propio por academia, usuarios/roles, sesiones, auditoría y designación exclusiva de Android, con pantallas mínimas web/móvil. Migración PostgreSQL versionada, alta inicial por CLI y demo opcional aislada. No incluye alumnos, caja, cobros ni cola/sincronización de negocio.

## Decisiones de acceso

- La academia es un tenant identificado por slug. Login con academia, usuario y contraseña; tenant y permisos de llamadas protegidas se derivan de sesión, no del body.
- Primer administrador mediante CLI con acceso a la BD y contraseña propia; sin bootstrap HTTP ni credenciales universales. Passwords de personal de 12–128 caracteres, hash scrypt salteado; no se usa DNI como contraseña del personal. La regla futura de alumnos se revisará al crear sus cuentas.
- Roles iniciales fijos ADMIN, SECRETARIA, ENTRENADOR y ALUMNO; permisos explícitos y denegación por defecto. ADMIN administra usuarios/dispositivo y consulta auditoría; SECRETARIA puede usar acceso offline; los demás no obtienen administración ni acceso offline operativo. Roles personalizados quedan fuera.
- Alta de usuario y reset administrativo crean contraseña temporal con cambio obligatorio. No puede administrar/emitir autorización offline hasta cambiarla. Cambiar contraseña, rol o estado revoca sesiones anteriores. Usuario desactivado no entra.
- Sesiones aleatorias de 256 bits, persistidas solo como hash en servidor, vigencia de 12 horas; logout revoca. Bloqueo de cuenta 15 minutos tras 5 fallos y límite de peticiones login por IP. Error genérico para academia/usuario/contraseña incorrectos.
- Proteger al último ADMIN activo con bloqueo transaccional por tenant; impedir desactivación/democión concurrente de todos. Recuperación de propietario por CLI de mantenimiento, auditada, no por endpoint público.
- Web usa proxy de mismo origen y cookie HttpOnly/SameSite Strict/Secure en producción; no guardar tokens en localStorage. Mutaciones del proxy validan Origin contra host propio. Android usa SecureStore, sin contraseña persistida.

## Dispositivo y autorización offline

- Cada Android crea una clave Ed25519 local protegida por SecureStore. Registro autenticado mediante desafío de un solo uso, de 2 minutos, ligado a usuario/tenant/clave/propósito; requiere prueba de posesión. No basta enviar un deviceId arbitrario.
- ADMIN designa un único dispositivo por academia. La nube serializa designación y emisión con bloqueo del tenant. Otro dispositivo solo puede designarse tras vencer la última autorización del anterior; no hay reemplazo inmediato durante un corte ni revocación offline instantánea.
- Una sincronización explícita de acceso, con sesión vigente, rol autorizado y prueba de la clave del dispositivo designado, obtiene un permiso firmado por servidor de hasta 24 horas. Login/health no renuevan ese plazo. Esta sincronización solo cubre acceso; los futuros datos de negocio deberán integrarse antes de habilitar operaciones reales.
- Permiso ligado a tenant/usuario/dispositivo/clave/versión de seguridad y permisos; firma Ed25519 verificada con clave pública confiable configurada en el móvil. Clave privada de servidor fuera del repositorio.
- Móvil conserva permiso y ancla de tiempo en SecureStore. Usa uptime nativo para el transcurso, detecta rollback/variación de reloj y reinicio incompatible; ante incertidumbre exige conexión. Sin permiso válido, clave correspondiente o tras 24 horas, no autoriza nuevas escrituras offline. Consulta técnica disponible.
- Desactivación o cambio de rol/clave se conoce inmediatamente online y al renovar acceso; un móvil desconectado puede conservar su permiso anterior hasta vencer. No prometer revocación remota inmediata. Logout elimina la autorización local del usuario; no libera al dispositivo para reemplazo anticipado en servidor.
- Una sola sesión offline local activa; cambio de operador requiere login y sincronización de acceso online. No cuentas compartidas ni fusión de cajas.

## Persistencia y auditoría

Migraciones explícitas con Sequelize/PostgreSQL y bloqueo de migración, no sync destructivo. Datos de academia, usuarios, permisos/roles técnicos, sesiones, dispositivos, desafíos, designación/última expiración y eventos de auditoría. Relaciones compuestas y filtros por tenant. Tokens/passwords/claves privadas nunca en auditoría/respuestas/listados.

Demo explícita solo en BD dedicada marcada demo y nombre de BD demo, rechaza BD normal/con datos reales; carga repetible, no sobrescribe registros. Dos tenants ficticios, roles y usuario inactivo para probar aislamiento. Sin reset destructivo ni llamadas externas.

## Criterios de aceptación

- CA-01: migrar desde vacío y repetir no destruye datos; bootstrap solo explícito y demo protegida/idempotente.
- CA-02: password hasheado/salteado, credenciales inválidas/bloqueadas fallan, token no está en claro en BD y expira/revoca correctamente.
- CA-03: permisos comprobados en API; SECRETARIA no administra, tenant ajeno no accesible; último ADMIN protegido incluso con concurrencia.
- CA-04: alta/edición/estado/reset/cambio de contraseña con validación y auditoría; contraseña temporal limita acceso.
- CA-05: registrar Android requiere desafío válido y firma; replays o claves ajenas fallan. Solo un equipo obtiene permiso por academia.
- CA-06: sustitución rechazada hasta expiración de permiso anterior, incluso concurrente; se permite tras expiración.
- CA-07: móvil verifica firma/ámbito/clave/24 horas y reloj; material sensible en SecureStore, no SQLite/localStorage. No se habilita offline en otro dispositivo por editar un id.
- CA-08: web y móvil permiten login/logout/perfil/cambio de contraseña; web administra usuarios/dispositivos/auditoría y móvil registra su clave y sincroniza acceso.
- CA-09: tests críticos con fallo inicial de comportamiento, integración PostgreSQL, casos adversariales, tipos/builds y smoke; documentar límites de Android físico no verificado.

## Verificación y límites

Pruebas de permisos, firma manipulada, replay, sesión revocada, ID de otro tenant, último administrador concurrente, exclusividad y expiración exacta. Verificar SQL real, transacciones, auditoría sin secretos y demo en BD aislada. Native SecureStore/uptime/instalación siguen requiriendo dispositivo; exportación Hermes no certifica hardware ni resiste un Android rooteado. No hay rutas de negocio en este alcance.

## Resultado

Implementado y verificado localmente: 13 pruebas unitarias, 11 de PostgreSQL, builds y smokes con navegador real. Evidencia y límites: [verificación de acceso](../08-verificacion-acceso.md). Compilación Kotlin remota aprobada; calificación física pendiente, no se ha probado teléfono Android.
