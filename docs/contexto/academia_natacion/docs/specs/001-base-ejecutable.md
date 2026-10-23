# 001 — Base ejecutable de backend, web y Android

Estado: terminada (base técnica; validación Android nativa pendiente fuera de este alcance).
Proyecto: academia de natación. Riesgo: medio (configuración, conectividad y persistencia técnica).

## Objetivo y actores

Permitir que los desarrolladores descarguen el repositorio, instalen versiones compatibles y ejecuten una API Node.js, una web Next.js y un cliente React Native Android independientes. No es una versión operativa de la academia.

## Alcance y exclusiones

- npm workspaces `apps/api`, `apps/web` y `apps/mobile`; TypeScript, lockfile, comprobaciones y configuración de ejemplo sin secretos.
- API Fastify: estado vivo y disponibilidad de PostgreSQL a través de Sequelize, cierre limpio y errores sin credenciales.
- Web mínima que consulta el estado real de la API, con manejo explícito de API no disponible.
- Android React Native con Expo, consulta de API y almacenamiento SQLite de la última comprobación técnica para mostrarla sin conexión. Esta caché no habilita operaciones del negocio offline.
- Sin usuarios, permisos, designación offline, alumnos, pagos, caja, cola operativa, sincronización de negocio, migraciones de negocio, seeds comerciales ni despliegue. Se especifican después. No crear usuarios predeterminados ni datos demo automáticamente.

## Reglas y contratos

- `GET /health/live`: 200 `{ service: "piscina-api", status: "ok", version: "0.1.0" }`; no depende de PostgreSQL.
- `GET /health/ready`: 200 con `status: "ready"` si PostgreSQL responde; 503 con `status: "unavailable"` si falla. Sin detalles de conexión en la respuesta.
- No hay operaciones de negocio públicas. Los dos endpoints de diagnóstico no requieren sesión.
- API solo escucha loopback por defecto; configuración explícita para pruebas desde Android por LAN. CORS limitado a orígenes configurados para la web; no reemplaza autenticación.
- Variables de servidor y URL de BD nunca se exponen en web/móvil. Configuración inválida impide iniciar. HTTPS para URLs remotas; HTTP únicamente en desarrollo local.
- Las tres aplicaciones conservan contratos compatibles, pero no comparten un CORE de implementación.
- SQLite móvil contiene solo comprobación técnica (estado/fecha). No guardar credenciales ni usar este diagnóstico como prueba de conectividad, sincronización o autorización offline.

## Criterios de aceptación

- CA-01: instalación con lockfile y scripts de tipos, lint, tests y builds reproducibles.
- CA-02: vida de API responde sin BD; readiness responde 200/503 según conexión real. Fallos no exponen contraseña/URL/stack.
- CA-03: web muestra respuesta real de API o indisponibilidad, sin simular alumnos ni operaciones.
- CA-04: aplicación Android tiene punto de entrada nativo y genera bundle Android; pantalla consulta API, maneja error y diferencia caché de dato recién obtenido.
- CA-05: SQLite técnica tiene inicialización versionada no destructiva; su SQL puede ejecutarse y repetirse sin perder registros. Verificar en SQLite real de prueba; la integración nativa se valida en dispositivo aparte.
- CA-06: instrucciones incluyen configuración PostgreSQL, direcciones para teléfono físico, requisitos Node/Android, comandos y límites de verificación. Sin dependencia de carpetas de otros proyectos.

## Verificación y escenarios negativos

Tests HTTP reales con Fastify inject; configuración inválida; BD disponible/no disponible; SQL SQLite real y repetición; build web, tipos móvil y bundle Android; smoke API y web en ejecución. Probar PostgreSQL contra instancia temporal local cuando sea posible, sin tocar BD ajenas. Cámara y APK/dispositivo no se declaran verificados sin SDK/equipo.

## Decisiones técnicas

Fastify limita complejidad de transporte para una API pequeña; Sequelize permanece en servidor. Expo prepara React Native Android y acceso SQLite sin crear una UI web compartida. Versiones exactas y fuentes en ADR 001 y lockfile. No usar CLI remota que publique proyectos ni servicios cloud pagados.

## Resultado de verificación

Verificado el 2026-10-21 desde copia independiente, con Node 24.22.0 y npm 11.3.0:

- `npm ci`: correcto, sin depender de carpetas de otros proyectos.
- `npm run check`: lint, tipos, 8/8 pruebas, API TypeScript, Next.js producción y bundle Android Hermes correctos.
- `npm run test:postgres`: 2/2 contra PostgreSQL 17.5 temporal (conexión real y rechazo real).
- `npm run smoke`: API compilada + PostgreSQL + web compilada; indisponibilidad visible al detener API.
- Revisión de código/contratos por la misma sesión; enlaces/documentación y contexto revisados.

CA-01 a CA-06 verificados dentro de sus límites declarados. SQL SQLite probado en archivo real de test, no en Android. Sin SDK Android ni dispositivo: no se generó APK ni se verificó almacenamiento/cámara nativos. No declara probado el MVP ni reglas de dinero/acceso/offline operativo. Ver [evidencia y pendientes](../06-verificacion-base.md).
