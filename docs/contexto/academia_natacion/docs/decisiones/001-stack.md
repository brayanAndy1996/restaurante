# ADR 001 — Web, Android y nube

Fecha: 2026-10-21. Estado: base ejecutable seleccionada y verificada a nivel de servidor/web y bundle Android. La compilación Kotlin Android pasó en CI; validación en dispositivo/APK sigue pendiente. No habilita funcionalidades sensibles sin spec.

## Requisitos y decisión

Personal exclusivamente con Android; online una persona registra asistencia y varias inscriben/cobran. Offline un único celular designado realiza toda la operación, hasta 24 horas: registro, aprobación, cobro, caja y asistencia, según permisos del usuario activo. Los otros celulares requieren conexión para registrar operaciones. Cámara QR y sincronización. Web y móvil independientes. No hay PC principal ni requisito de escritorio Electron. No hay CORE ni paquetes internos de otros productos.

| Capa | Elección | Encaje y límites |
|---|---|---|
| Lenguaje | TypeScript | Tipos y contratos documentados en los tres componentes. |
| Web | Next.js 16.4.2 / React 19.3.0 | Solicitudes, portal y administración online; no se empaqueta como móvil. |
| Móvil | React Native 0.88.0 / Expo 58.0.16 | Interfaz independiente; Expo facilita herramientas nativas y SQLite. Cámara y negocio pendientes. |
| Backend | Node.js 24.22.0 / Fastify 5.12.7 | Transporte HTTP y diagnóstico inicial; negocio/sync se implementan por specs. |
| ORM servidor | Sequelize 6.37.8 / pg 8.23.1 | Persistencia PostgreSQL; no se instala dentro de React Native. |
| BD nube | PostgreSQL | Transacciones, aislamiento y consolidación multiempresa por producto; verificar su diseño. |
| BD móvil | SQLite / expo-sqlite 58.0.13 | Inicialización y caché técnica; base operativa/cola y cifrado se especifican después. |

La dirección móvil es una excepción explícita al alcance Electron/PC de la documentación general; no modifica el panel. La nube/sincronización son parte de esta primera entrega de natación, aunque otros productos sigan locales.

## Alternativas y pendientes

React Native fue preferido por el fundador frente a Capacitor/PWA. Expo no sustituye React Native: aporta CLI, build y módulos nativos. Se conserva UI independiente respecto de Next.js. Fastify mantiene una API pequeña sin generar un segundo backend de negocio en Next.js.

Versiones exactas en manifiestos/lockfile, consultadas el 2026-10-21. Node mínimo de este proyecto: 24.13, rama 24 LTS; validado con 24.22.0 y npm 11.3.0. El Node 24.1 del equipo no cumple Expo, por lo que las verificaciones usan un runtime local ignorado por Git, sin modificar el global. TypeScript 6.0.3 coincide con el template oficial Expo SDK58. ESLint 10.13.0 evita iniciar con la rama 9 ya sin soporte. PostgreSQL 17.5 es el servidor local probado; no prescribe desplegar esa revisión antigua en producción.

Evidencia: `expo-template-blank-typescript@58.0.25` oficial declara React 19.3.0, RN 0.88.0, Expo ~58.0.16 y TS ~6.0.3; `expo install --check` encontró versiones coherentes con el SDK local, aunque advirtió que su validación offline es limitada. Se probaron tipos, SQL SQLite real, API/web compiladas, PostgreSQL real y bundle Hermes. La compilación Kotlin Android de acceso pasó en CI (ver registro v0.2.0); no se ha ejecutado en hardware.

Fuentes oficiales consultadas:

- [Next.js: instalación](https://nextjs.org/docs/app/getting-started/installation).
- [Expo SDK58](https://docs.expo.dev/versions/v58.0.0/) y [SQLite](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/).
- [Fastify: soporte](https://fastify.dev/docs/latest/Reference/LTS/).
- [Sequelize estable](https://sequelize.org/docs/v6/getting-started/).
- [Node.js: versiones](https://nodejs.org/en/about/previous-releases).

Acceso y migración servidor implementados mediante spec 002. Pendientes de siguientes specs: cifrado de datos comerciales locales, datos de negocio, archivos, hosting y distribución Android. No trasladar versiones o implementaciones de otros productos.

## Pruebas técnicas pendientes

- Build Android instalable y ejecución sin internet, persistencia tras cierre/reinicio y cámara QR en hardware real.
- Cola durable única, límite de 24 horas y sincronización al reabrir. Validar designación exclusiva, bloqueo de escrituras offline en otros equipos y sustitución controlada.
- Contratos/cálculos equivalentes entre móvil y backend, migración local y servidor, deduplicación y conflictos atómicos.
- Respaldo/recuperación, protección local, credenciales y pérdida del único dispositivo offline. Su fallo detiene la operación offline y la nube no recupera pendientes nunca enviados.
- Medir respuesta de asistencia (objetivo funcional existente: menos de 2 segundos), volumen representativo, batería/almacenamiento y concurrencia. Versiones mínimas Android y equipos soportados pendientes de medición.

La base ya tiene dependencias instaladas, lockfile y builds API/web/Android bundle. No hay benchmark de negocio, APK, cámara probada ni compatibilidad Android certificada. Véase la spec 001 y el registro de verificación para distinguir evidencia de trabajo pendiente.

## Ampliación de acceso v0.2.0 — 2026-10-21

Sesiones opacas y scrypt mediante node:crypto en backend; firmas Ed25519 con la misma biblioteca nativa y @noble/curves 2.4.0 en móvil. Sin JWT de sesión ni contraseña guardada en cliente. @fastify/rate-limit 11.2.1 limita login por IP; despliegue con varias réplicas necesita almacenamiento compartido. Expo SecureStore 58.0.2 conserva sesión/semilla/permiso, Expo Crypto 58.0.7 genera aleatoriedad nativa. No se almacenan esos secretos en SQLite.

El módulo Kotlin local piscina-clock usa elapsedRealtime (incluye suspensión) y BOOT_COUNT; no usar uptime que excluya suspensión ni reloj de pared como sustituto. Requiere compilación propia: Expo Go no incorpora este módulo. La autorización firmada se limita a 24 horas y bloquea sustitución del equipo hasta vencer el último permiso emitido. La cola y sincronización comerciales siguen pendientes. Playwright Core 1.64.1 verifica la UI mínima web con navegador instalado, sin distribuirlo con el producto.

Pruebas y limitaciones actuales: [verificación de acceso](../08-verificacion-acceso.md). La compilación Kotlin en CI es una verificación distinta de instalación y suspensión en teléfono real.
