# Verificación de base v0.1.0

Fecha: 2026-10-21. Alcance: spec 001, diagnóstico técnico, sin módulos operativos.

## Entorno

Windows x64; Node 24.22.0 local y npm 11.3.0. PostgreSQL 17.5 en cluster temporal exclusivo del proyecto, escuchando loopback en puerto de prueba. No se usaron ni modificaron bases de otros proyectos. Expo 58 / React Native 0.88 / React 19.3, con versiones exactas del lockfile.

## Evidencia ejecutada

| Comprobación | Resultado |
|---|---|
| Lint de código | Correcto, ESLint 10. |
| Tipos API, web y móvil | Correctos; tests Node del móvil usan configuración separada del cliente nativo. |
| Pruebas automáticas | 8/8: configuración inválida, TLS en producción, vida/readiness, CORS, error sin secretos, respuesta móvil coherente/HTTPS y SQL SQLite persistente. |
| SQLite real de prueba | Archivo temporal: crear esquema técnico, insertar, cerrar/reabrir y repetir inicialización conserva dato; restricciones rechazan valores inválidos. No equivale a ejecutar expo-sqlite en Android. |
| Integración PostgreSQL | Instancia real con Sequelize: disponibilidad positiva y rechazo real de conexión sin filtrar detalles. 2/2 correctas. |
| API compilada | TypeScript emite código servidor. |
| Web de producción | Next.js compila y sirve página; smoke verifica disponibilidad de API/BD y cambio visible al detener API. |
| Bundle Android | Metro/Hermes genera `.hbc`; sin APK ni ejecución en dispositivo. |
| Instalación independiente | Correcta desde copia independiente: `npm ci`, `npm run check` (8/8), `npm run test:postgres` (2/2) y `npm run smoke`. No depende de las otras carpetas de productos. |

La primera ejecución de Hermes y la inicialización PostgreSQL fallaron o no completaron bajo el sandbox. Se repitieron fuera de ese aislamiento y funcionaron. No se cambió la política de ejecución del producto para ocultar esos fallos.

## Revisión de límites

Revisión realizada por la misma sesión, no independiente: no exponer secretos de conexión, no crear usuarios/tablas comerciales al arrancar, no llamar sincronización a una caché de estado, no introducir CORE y no prometer Android nativo por exportar JavaScript. Se añadió prueba para rechazar una respuesta móvil HTTP 503 que afirmaba `ready`.

## Pendientes explícitos

- SDK/JDK Android, APK instalable, cámara y persistencia mediante expo-sqlite en celular real; aquí no hay SDK Android ni dispositivo conectado.
- Pruebas visuales/interactivas en navegador y Android; el smoke web comprueba HTML servido e integración, no sustituye esa validación.
- Usuarios, permisos, ámbitos, bootstrap, designación del dispositivo y límite offline operativo de 24 horas.
- Migraciones/seed de negocio, alumnos, cobros/cajas, asistencia y cola/sincronización operativa.
- Rendimiento con datos reales representativos, protección de SQLite, respaldo/recuperación y despliegue HTTPS.

El workflow CI verifica instalación, checks y PostgreSQL; no distribuye APK ni publica una nube. Su resultado remoto debe consultarse después del push; pruebas locales no equivalen a CI verde.
