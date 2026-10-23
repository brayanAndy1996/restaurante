# Verificación de acceso v0.2.0

Fecha: 2026-10-21. Alcance: spec 002; usuarios, permisos, sesiones, auditoría y autorización de un único Android offline. No constituye entrega de negocio ni despliegue cloud.

## Evidencia local

- Node 24.22.0 / npm 11.3.0; PostgreSQL real 17.5 temporal en loopback, sin usar instalaciones operativas.
- `npm run check`: lint, tipos API/web/móvil/scripts, 13 pruebas aprobadas sin omitidas, compilación API/Next y bundle Android Hermes (676 módulos).
- `npm run test:postgres`: 11 pruebas aprobadas sin omitidas, con esquemas/bases aleatorios propios. Migración repetida, bootstrap, hash/sesiones, permisos, tenant ajeno, contraseña temporal, bloqueo/expiración/revocación, protección concurrente del último administrador, conflictos auditados, firma/posesión/replay, expiración y exclusividad del equipo, demo protegida e idempotente.
- `npm run smoke`: API compilada + BD + web de producción y caída visible de API.
- `npm run smoke:access`: navegador Microsoft Edge headless real: login, alta de usuario y logout; BFF con cookie HttpOnly/Secure, token fuera de JS/localStorage y rechazo de origen CSRF. Recuperación por CLI probada, con revocación de sesión previa y auditoría.
- TDD observado: pruebas de hash/reemplazo y de evaluación offline fallaron inicialmente con implementaciones vacías/permisivas; luego pasaron con las reglas. Casos offline cubren firma alterada, ámbito ajeno, versión, permiso, límite exacto, ancla ajena, reinicio y alteración de reloj.
- Autolinking Expo detectó piscina-clock. Pruebas SQLite reales de diagnóstico se conservan.

Las pruebas usan `API_TEST_DATABASE_URL` explícita local con sufijo `_test`, sin fallback a conexión operativa. Fixtures se eliminan al terminar. No hay datos reales, claves privadas ni tokens en el repositorio.

## Revisión adversarial

Revisados aislamiento por sesión y FK compuestas; autorización duplicada tras adquirir bloqueo; dos administradores desactivándose; versión obsoleta; sustitución concurrente frente a emisión; prueba de posesión ligada a usuario/tenant/clave/propósito; auditoría sin secretos; clave pública fijada en móvil; origen web productivo explícito; restauración offline con reloj monotónico incluyendo suspensión. Las decisiones rechazadas quedan auditadas. La cola comercial aún no existe.

## Android nativo y límites

El workflow incluye compilación Kotlin del proyecto generado por Expo, separada del bundle JavaScript. [GitHub Actions de 09cf6c8](https://github.com/brayanAndy1996/piscina/actions/runs/39646450580) aprobó ambos jobs: API/web/JS/PostgreSQL/smokes y compilación Kotlin Android, incluido `:piscina-clock:compileDebugKotlin`. Este equipo no tiene SDK Android ni teléfono conectado: no se afirma instalación ni prueba física. SecureStore, suspensión, cierre/reapertura, reinicio y comportamiento de reloj deben verificarse en un build nativo sobre hardware antes del piloto; Expo Go no contiene el módulo propio.

La autorización firmada no permite revocación instantánea de un celular desconectado: vence en un máximo de 24 horas y la sustitución espera ese vencimiento. No hay cola durable, sincronización de alumnos/cobros, cámara ni datos operativos. RLS, cuenta de BD sin privilegios de migración, gestión productiva de claves, rate limit compartido entre réplicas, hosting y respaldo quedan como preparación del despliegue.

## Instalación limpia y dependencias

`npm ci` sobre un archivo ZIP de Git separado terminó correctamente (740 paquetes en Windows); también pasó desde cero en ambos jobs Linux. Generación de clave probada en carpeta aislada: crea una vez y rechaza sobrescritura sin alterar el archivo.

El audit inicial detectó dos avisos críticos asociados a shell-quote en herramientas de desarrollo. Se actualizaron concurrently a 9.2.5 y shell-quote a 1.12.0 dentro de rangos compatibles: ya no hay avisos críticos. Tras el parche quedan 23 entradas agregadas (15 altas, 8 moderadas, incluidas cadenas de dependencias; no equivalen a 23 fallos diferentes).

- [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv) y [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): sin versión corregida publicada según los avisos consultados. Están en herramientas Expo/Metro, no en la API; no exponer Metro/CLI a internet ni tratar certificados/patrones externos no confiables durante desarrollo. La firma de acceso usa Ed25519 de node:crypto/noble, sin node-forge. Su remediación sigue pendiente del proveedor o de una decisión de sustitución verificada antes de distribución.
- [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq) transitivo de Sequelize/xcode: el aviso afecta v3/v5/v6 con buffer externo, mientras estas dependencias usan v1/v4 y el módulo propio usa randomUUID de Node. La auditoría de producción del workspace API deja dos entradas moderadas (Sequelize/uuid), ninguna alta/crítica. No se fuerza una versión mayor transitiva ni se degrada Expo/Sequelize para silenciar avisos; revisar actualización compatible y alcance antes de despliegue.

Esta evaluación no equivale a auditoría de dependencias limpia ni a aprobación productiva. Las correcciones futuras deben repetir pruebas pertinentes.
