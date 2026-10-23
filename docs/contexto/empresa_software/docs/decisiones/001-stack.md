# 001 — Stack de la base local del panel

Fecha: 2026-10-19; actualización de independencia del 2026-10-20. Estado: composición técnica comprobada en desarrollo y paquete Windows x64 sin instalador; instalación comercial pendiente de verificación. Alcance: [spec 001](../specs/001-base-ejecutable.md). Esta decisión concreta [STACK](../../../STACK.md) para el panel, sin imponer su implementación a otros productos; CORE está descartado.

## Requisitos y adecuación

Primera aplicación interna Windows x64, local y sin internet para operar; SQLite propia fuera del repositorio. No necesita LAN, HTTP, nube, periféricos ni procesamiento comercial en esta entrega. El hardware de [referencia](../../../HARDWARE.md) es un objetivo provisional; faltan mediciones y certificación de instalador. El equipo prefiere TypeScript, React/Next.js y backend Node.js, con esfuerzo visual mínimo.

| Capa | Decisión | Motivo y límite |
|---|---|---|
| Lenguaje | TypeScript | Contratos compartidos, separación de DTOs y backend; tipos no reemplazan validación en ejecución |
| Frontend | Next.js / React, exportación estática | Mantiene el stack preferido sin servidor de frontend en ejecución; no admite Server Actions/API Routes/SSR para esta aplicación |
| Escritorio | Electron | Runtime Node integrado y preload para fachada local; requiere validar seguridad, consumo y empaquetado |
| Transporte | IPC enumerado mediante preload | Una ventana local no justifica otro servidor HTTP ni abrir un puerto LAN |
| Backend | Casos de uso Node.js sin framework HTTP | Composición en proceso principal; lógica separada del adaptador Electron y de React |
| Persistencia | Sequelize 6 + driver sqlite3 | Conserva SQLite embebida offline; Sequelize con tipos TypeScript nativos, sin sequelize-typescript/decoradores adicionales |
| BD de servidor | PostgreSQL pospuesto | No se necesita servicio de BD en esta instalación; SQLite no prueba equivalencia de motores |
| Construcción | esbuild para main/preload; Next para renderer | Artefactos separados, resolución verificable de preload y recursos |
| Distribución | electron-builder | Preparar artefacto Windows x64; generación no equivale a instalación/actualización probadas |

El frontend se sirve mediante protocolo `app://panel/`, limitado a la exportación estática. El proceso principal abre la BD, migra y registra handlers. No se crea una segunda API de negocio en Next.js. El proceso renderer no posee acceso Node ni instancia Sequelize.

La integración concreta del export usa MIME de texto para `.txt`, GET/HEAD y resolución de ruta independiente de query/hash. Los enlaces usan `prefetch={false}` para evitar solicitudes de precarga de segmentos no generados por esta exportación. Se conserva la navegación Next al hacer clic. La CSP usa origen propio y hashes de los scripts inline del HTML; no requiere `unsafe-inline` ni `unsafe-eval`. Estas decisiones se comprobaron en el E2E Electron local de la spec; no atribuir ese resultado al instalador todavía.

Los tipos nativos de Sequelize evitan una integración adicional de decoradores y su compatibilidad de compilación. No sustituye validaciones ni pruebas con SQLite real. Actualización del 2026-10-20: el panel desarrolla sus módulos desde cero; no consumirá CORE ni dependencias de carpetas hermanas.

## Versiones fijadas y evidencia consultada

El coordinador verificó estas versiones en npm el 2026-10-19 antes de esta decisión. Se fijan versiones exactas y lockfile; la instalación de dependencias y el runtime integrado se comprobaron con los resultados registrados al cierre. El backend distribuido usa el Node integrado en Electron; el Node de herramientas no prueba por sí solo su compatibilidad.

| Herramienta/dependencia | Versión |
|---|---|
| Node.js de desarrollo | 24.1.0 |
| npm | 11.3.0 |
| Next.js | 16.4.2 |
| React / React DOM | 19.3.1 |
| Electron | 44.9.0 |
| Sequelize | 6.37.8 |
| sqlite3 | 6.0.1 |
| electron-builder | 26.15.3 |
| TypeScript | 5.9.3 |
| esbuild | 0.28.2 |
| Vitest | 5.0.5 |
| Playwright | 1.64.1 |
| ESLint | 10.13.0 |
| typescript-eslint | 8.72.0 |

TypeScript 5.9.3 mantiene el rango `<6.1` declarado por la integración typescript-eslint elegida. El coordinador comprobó mínimos declarados: Electron npm `>=22.12`, Next.js `>=20.9`, sqlite3 `>=20.17` y Playwright `>=20`; Node 24.1.0 los satisface numéricamente. Esto no certifica compatibilidad binaria del driver con el Node/ABI incluido en Electron.

Referencias primarias de adecuación consultadas por el coordinador: [Next.js instalación](https://nextjs.org/docs/app/getting-started/installation), [Next.js exportación estática](https://nextjs.org/docs/app/guides/static-exports), [Sequelize v6](https://sequelize.org/docs/v6/), [driver sqlite3](https://github.com/TryGhost/node-sqlite3), [Electron seguridad](https://raw.githubusercontent.com/electron/electron/main/docs/tutorial/security.md) y [Electron protocolo](https://raw.githubusercontent.com/electron/electron/main/docs/api/protocol.md). Las últimas respaldan aislamiento, sandbox, validación de emisor y protocolo propio. La composición ejecutable se comprobó con el humo registrado; la certificación Windows/hardware y la instalación comercial permanecen pendientes.

## Alternativas consideradas

- Servidor Next local: añadiría puertos, gestión de arranque y superficie de operación sin una necesidad de SSR. Se conserva exportación estática; revisar solo si un requisito nuevo requiere ejecución de Next en runtime.
- Servicio HTTP separado: no aporta valor al único renderer local y añade controles de red. IPC adapta los casos de uso y permite añadir un transporte futuro cuando exista una spec que lo necesite.
- PostgreSQL local: exige instalar/operar un servicio y cambia el alcance SQLite vigente. Pospuesto con la nube o un requisito medido de servidor.
- Cambiar ORM/driver: no hay evidencia que lo justifique. Primero verificar sqlite3 real en Node y en Electron; si falla, documentar la incompatibilidad y una corrección acotada antes de darla por resuelta.

## Prueba técnica y consecuencias

Para cerrar la spec se instaló desde lockfile y se ejecutaron tipos, lint, 18 pruebas, build y E2E Electron; las pruebas incluyen SQLite real, migración repetida, rollback, esquemas ajenos/inconsistentes, CLI y controles IPC/rutas. El E2E comprobó exportación estática offline, navegación y el DTO real obtenido del backend/BD. Los intentos negativos de IPC se probaron con el guard/handler reales y dobles de evento; no se presenta esa evidencia como una explotación real de cada contexto hostil.

Antes de certificar distribución: construir el artefacto Windows x64, comprobar carga del driver nativo contra Electron, instalar en un entorno limpio y probar inicio offline, persistencia tras reinicio y actualización. Registrar versión de SO, recursos y limitaciones; medir con hardware objetivo antes del piloto. Firma de código, actualización automática, ARM64 y otros sistemas no se consideran validados por esta entrega.

Para reproducir el runtime de escritorio se dispone de `npm run desktop:install`, que ejecuta el instalador de Electron de la dependencia fijada. El binario de Electron no se presume disponible por haber creado `node_modules`; la reinstalación por lockfile y el setup completo finalizaron correctamente. `npx electron-builder --win --dir --x64` generó el paquete y reconstruyó sqlite3 sin errores; el ejecutable con `isPackaged: true` pasó un humo offline, diagnóstico, IPC/SQLite real, renderer sin `require` y salida al cerrar ventana. No prueba instalación/actualización NSIS ni firma de código: `Get-AuthenticodeSignature` informó `NotSigned`. Evidencia detallada en la spec.

La entrega histórica 0.1.0 comprendía solo estado técnico sin autenticación ni datos comerciales. La spec 002 agrega identidad, permisos y auditoría propios en 0.2.0; no se espera CORE ni se elude el acceso con un administrador implícito. El instalador comercial sigue pendiente de verificación.

## Seguimiento de dependencias

### Binarios nativos Windows x64 (2026-10-21)

El empaquetado inicial de 0.2.0 intentó recompilar Argon2 mediante node-gyp y falló por ausencia de Visual Studio. Se fija `build.npmRebuild: false` para conservar los binarios de terceros instalados desde lockfile en Windows x64: Argon2 declara Node-API 8 e incluye su prebuild Windows x64; sqlite3 declara Node-API 3/6. La revisión independiente del código instalado confirmó el comportamiento del empaquetador, loader y extracción automática de addons `.node` fuera de ASAR. Referencias: [estabilidad ABI de Node-API](https://nodejs.org/api/n-api.html#implications-of-abi-stability) y [configuración de electron-builder](https://www.electron.build/configuration/).

La opción afecta a todas las dependencias nativas. Construir con dependencias instaladas en Windows x64; no asumir que copiar `node_modules` desde otro sistema permite empaquetar para Windows. Un addon futuro ligado al ABI tradicional puede requerir reconstrucción. Antes de aceptar cambios de Electron, addon o arquitectura, repetir instalación desde lockfile y humo del ejecutable con hash/verificación Argon2id, SQLite y migración reales. La estabilidad de Node-API no certifica librerías externas, instalador ni otra plataforma. Los resultados del artefacto vigente se registran en la spec 002.

Actualización para [spec 002](../specs/002-acceso-nativo.md), versión 0.2.0 terminada el 2026-10-21: el panel incorpora `argon2` 0.45.1 como dependencia de terceros para Argon2id propio del producto. Parámetros iniciales: memoria 19456 KiB (19 MiB), iteraciones 2, paralelismo 1 y salida 32 bytes, con salt aleatoria y formato PHC codificado. Se usan verificadores SHA-256 únicamente para secretos aleatorios de 32 bytes (sesión/recuperación), no para contraseñas humanas. El coordinador midió aproximadamente 58 ms para hash+verificación en su máquina actual; no certifica rendimiento en hardware mínimo ni latencia garantizada. Tras `npm ci` y setup Electron correctos, pasaron check (48 pruebas sin omisiones), build, dos E2E y humo del ejecutable empaquetado con hash/verificación Argon2id y SQLite reales. Runtime observado: Electron 44.9.0, Node 24.22.0, Node-API 10 y x64. El paquete conserva los addons Node-API; no se recompilan. Firma NotSigned, instalador NSIS y hardware mínimo pendientes. Detalle y alcance en la spec 002.

El 2026-10-19, `npm audit --omit=dev` informó dos avisos moderados vinculados a Sequelize y su dependencia `uuid` 8.3.2: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). El advisory afecta métodos UUID v3/v5/v6 cuando reciben un buffer de salida y no validan sus límites; no significa que todas las llamadas a UUID produzcan ese fallo.

La revisión independiente del código instalado encontró usos Sequelize de `uuid.v1()` y `uuid.v4()` sin buffers externos, y la base del panel genera correlaciones con `node:crypto.randomUUID()`. Por ello se infiere que la ruta vulnerable no es alcanzable en el recorrido técnico actual; el paquete afectado permanece en el inventario y la auditoría no está limpia. No se aplicó el downgrade automático propuesto a Sequelize 3 ni un override mayor de UUID sin compatibilidad probada.

Seguimiento obligatorio: revisar una actualización compatible de Sequelize/dependencia antes de publicar una release comercial; repetir `npm audit --omit=dev` y el análisis de usos al cambiar el lockfile, incorporar módulos o introducir generación UUID con buffers. Si el flujo pasa a usar un método afectado, resolverlo y verificar compatibilidad antes de entregar ese flujo. Mantener documentado el aviso mientras no haya actualización compatible probada; no convertir esta evaluación limitada en una afirmación de ausencia de vulnerabilidades.
