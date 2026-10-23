# Contratos de diagnóstico — v0.1.0

Fecha: 2026-10-21. Solo diagnóstico técnico; no hay operaciones de negocio ni sesión implementada.

| Método y ruta | Resultado |
|---|---|
| GET /health/live | HTTP 200: `{ "service": "piscina-api", "status": "ok", "version": "0.1.0" }` |
| GET /health/ready | HTTP 200 con `status: "ready"`, o HTTP 503 con `status: "unavailable"`; conserva service/version y lleva Cache-Control: no-store. |

Readiness autentica PostgreSQL por Sequelize, sin crear tablas. Ni URL, contraseña, stack ni errores del driver se devuelven al cliente. La API limita CORS a los orígenes web configurados; CORS no sustituye autorización y no impide peticiones de aplicaciones nativas. Los futuros endpoints sensibles deberán exigir sesión/permisos/ámbito.

Web: API_URL solo en servidor Next.js. Móvil: EXPO_PUBLIC_API_URL es pública; jamás contiene secretos. El teléfono utiliza URL LAN del servidor en desarrollo, no su propio localhost. Fuera de desarrollo, el móvil rechaza HTTP.

SQLite móvil v1: tabla técnica diagnostic_cache con una entrada api, status ready/unavailable y checked_at. La fecha es de comprobación local; no es fecha de sincronización autorizada ni fuente de orden de conflictos. Reabrir la aplicación consulta esa caché y la identifica como dato guardado. Solo una respuesta reconocida actualiza el registro; un fallo de red mantiene el anterior.

Usuarios, permisos, empresa/local, autorización offline, dinero y cola operativa se definirán en contratos posteriores. No consumir el diagnóstico como autorización para escribir datos.
