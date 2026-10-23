# 001 — Base técnica y diagnóstico

Estado: terminada  
Fecha: 2026-10-22  
Proyecto/módulo: restaurante / arranque y transporte  
Riesgo: medio; el límite de acceso exige comprobaciones negativas explícitas.

## Objetivo y actores

Entregar al desarrollador un proyecto independiente que arranque API Node.js y frontend Next.js mínimo, permita diagnosticar el proceso real y haga visible que el acceso y la operación comercial siguen pendientes. Actores: desarrolladores y operador de la demostración técnica.

## Alcance y exclusiones

Incluye TypeScript, exportación estática de Next.js servida por el backend HTTP Node.js del mismo producto, configuración validada y pruebas reproducibles. La selección técnica se registra antes del código en [ADR 001](../decisiones/001-stack.md).

Esta entrega no abre conexiones PostgreSQL/SQLite, no crea migraciones, usuarios, sesiones, tenants, locales ni datos demo. No implementa caja, mesas, impresión, sincronización, licencia o failover. Su arranque no demuestra readiness comercial ni conectividad de BD. Los seeds opcionales y repetibles son obligatorios con las primeras migraciones, según [la política de datos](../../../DATOS_PRUEBA.md).

## Reglas, permisos y ámbito

- `RESTAURANTE_MODE` admite únicamente `cloud` o `local`; si falta, se adopta `cloud` y se documenta. Un valor explícito inválido impide arrancar. El modo describe configuración del proceso, no autoridad de escritura, conexión de BD ni cambio de modo seguro.
- El diagnóstico es público y no devuelve rutas de disco, variables de entorno, credenciales, direcciones de BD, datos de negocio ni datos personales.
- No existe identidad autenticada en esta versión. No se acepta `tenantId`, `siteId`, un rol, una cabecera o una cookie como prueba de acceso. No hay bypass de desarrollo para abrir funciones de negocio.
- El contexto permanece denegado incluso si el solicitante fabrica `Authorization`, cookies o identificadores de ámbito. Las rutas comerciales aún no existen.
- El proceso sirve API y frontend en el mismo origen. Un puerto inválido debe fallar explícitamente; se documentan dirección y puerto reales de ejecución en el README. Exposición LAN, TLS y acceso móvil seguro requieren una spec posterior.

## Flujo, datos y contratos

1. Validar configuración al arrancar; construir frontend antes de servir su exportación. No realizar instalaciones, seeds ni migraciones automáticamente.
2. `GET /api/health` responde HTTP 200, JSON y `Cache-Control: no-store`. Contrato mínimo:

   ```json
   {
     "service": "restaurante",
     "status": "ok",
     "mode": "cloud",
     "capabilities": {
       "authentication": false,
       "persistence": false,
       "businessOperations": false,
       "continuity": false
     }
   }
   ```

   `status: ok` significa exclusivamente que el proceso HTTP responde. `mode` refleja la configuración validada. Se permiten metadatos técnicos no sensibles adicionales documentados, sin alterar esta semántica.
3. `GET /api/context` responde siempre HTTP 401 con `{"error":{"code":"AUTH_REQUIRED","message":"Autenticación pendiente de implementación."}}`, JSON y `Cache-Control: no-store`. No devuelve usuario ni ámbito ficticios.
4. Ruta API inexistente: HTTP 404 con error JSON estable `NOT_FOUND`. Métodos distintos de GET en las dos rutas definidas: HTTP 405, cabecera `Allow: GET` y error JSON `METHOD_NOT_ALLOWED`. No hacer fallback a HTML para rutas `/api/` desconocidas.
5. La página inicial consulta la API real del mismo origen, muestra carga, diagnóstico, modo y capacidades pendientes; permite repetir el diagnóstico. Muestra error legible si la API no responde o devuelve error/datos inválidos. No sustituye fallos por un estado verde simulado.
6. La UI indica que acceso, BD y operación comercial no están disponibles. No pide contraseñas ni muestra botones operativos para caja/mesas. Un 401 del contexto se presenta como acceso pendiente, sin bucles de reintento.

No hay persistencia existente ni compatibilidad de esquema que migrar. Los contratos HTTP son propios del producto; no importan módulos de otro proyecto. Servir archivos estáticos no debe permitir salir del directorio exportado ni exponer fuentes/configuración.

## Criterios de aceptación

- CA-01: desde instalación con lockfile, los comandos documentados compilan TypeScript/Next.js y arrancan API y página integradas.
- CA-02: health cumple el contrato en modos `cloud` y `local`; declara capacidades falsas y nunca comprueba o afirma una BD inexistente.
- CA-03: contexto devuelve 401 sin datos de ámbito, también ante credenciales/cabeceras inventadas.
- CA-04: configuración de modo/puerto inválida falla con mensaje útil sin secretos; no inicia silenciosamente otro modo.
- CA-05: rutas/métodos API incorrectos producen los errores definidos; el servidor no expone archivos externos al export.
- CA-06: el recorrido web integrado permite obtener y repetir diagnóstico real; tiene carga/error y anuncia funciones pendientes.
- CA-07: README contiene instalación, configuración, comandos efectivamente disponibles, versión de runtime y limitaciones; ninguna credencial de producción ni demo se genera al arrancar.

## Verificación y escenarios negativos

Automatizar contratos HTTP, modos y configuración inválida, denegación de contexto con ámbitos fabricados, método/ruta incorrectos y acceso a archivos fuera del export. Revisar que las respuestas no filtren configuración. Ejecutar tipos, lint, tests y build; realizar humo de la UI integrada y registrar resultados observados. No se exige una batería de UI decorativa.

## Dudas y decisiones

No quedan dudas que bloqueen esta base de diagnóstico. Las decisiones de autoridad offline, autenticación y datos son requisitos de sus futuras specs y no se resuelven mediante valores simulados. [ADR 002](../decisiones/002-continuidad.md) delimita el trabajo sensible previo a operaciones comerciales.

## Resultado de verificación

Verificado el 2026-10-22 en Windows, Node 24.1.0 y npm 11.3.0.

- RED: antes de implementar, `npm test` con loopback autorizado dio 1/6 aprobadas y 5 fallos de comportamiento: configuración inválida aceptada, health/context sin sus estados, errores sin no-store y raíz estática ausente. El primer intento en sandbox falló por conexión bloqueada; no se contó como RED funcional.
- GREEN: `npm ci` desde lockfile y `npm run check` pasaron tipos (incluye tests), ESLint, build Next estático/backend, 7/7 contratos y 1/1 smoke HTTP del export real. Sin pruebas omitidas.
- Revisión independiente Sol medium: reprodujo acceso a configuración por NTFS `::$DATA` y junction interno hacia carpeta oculta. Se corrigieron rechazo de `:` y validación de segmentos canónicos tras realpath. Ambas reproducciones originales volvieron a ejecutarse y devolvieron 404 sin secretos. Regresiones cubren además junction externo; sin hallazgos materiales pendientes.
- Tras el check se actualizó únicamente tooling a ESLint 10.10.0/@eslint/js 10.0.1, compatible con typescript-eslint 8.69.0 y TS 6.0.3, al detectar fin de soporte de la versión inicial de lint. Su regla preserve-caught-error motivó conservar cause en el error de carga .env; la salida pública sigue siendo genérica. Se ejecutaron nuevamente lint, typecheck y build:server, todos aprobados. No cambió el export ni los contratos.
- QA en navegador contra `npm start`: carga real y modo Nube, cuatro capacidades pendientes, contexto denegado, reintento exitoso, backend detenido con error visible y recuperación tras reinicio. Revisada legibilidad de la página y ausencia de controles comerciales; carga y errores también revisados en código.
- `.env` opcional se carga mediante Node; las variables del proceso tienen precedencia. Configuración invalidada por contrato no expone valores introducidos.

CA-01 a CA-07 comprobados dentro del alcance técnico descrito. No se probaron móviles físicos, periféricos, BD, instalación, TLS, despliegue nube ni continuidad: no están implementados en 001. `cloud`/`local` son configuración, sin autoridad comercial.
