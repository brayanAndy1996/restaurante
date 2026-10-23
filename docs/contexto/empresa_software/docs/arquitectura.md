# Arquitectura ejecutable del panel

Actualizado: 2026-10-21. Estado: base técnica y acceso nativo 0.2.0 verificados. Complementa [02-arquitectura](02-arquitectura.md) con la composición ejecutable; no sustituye el alcance comercial del [panel](05-panel-administrador.md).

## Propósito y fronteras

El panel administra la empresa de software y tiene aplicación, repositorio, módulos y BD propios. No abre las bases de pollería/natación ni administra sus ventas, alumnos o configuración visual. Desde el 2026-10-20 CORE está descartado: el panel implementa desde cero identidad, autorización, auditoría y demás módulos internos que necesite, sin copiar código de otros productos.

La primera entrega permitió abrir Electron, inicializar una SQLite técnica y consultar su estado mediante una fachada tipada; la [spec 001](specs/001-base-ejecutable.md) conserva su evidencia histórica. La [spec 002](specs/002-acceso-nativo.md), terminada, agrega autenticación, permisos y auditoría nativos del panel en la versión 0.2.0. No habilita todavía clientes, cobros ni emisión de licencias. Las únicas operaciones sin sesión son diagnóstico no sensible y las entradas explícitas de acceso (estado inicial, bootstrap único, login, recuperación y logout idempotente), bajo el guard de ventana/origen.

## Composición local

```text
Renderer: React / Next.js exportado estáticamente
    -> API explícita del preload (sin ipcRenderer genérico)
    -> adaptador IPC del proceso principal Electron
    -> caso de uso Node.js del panel
    -> repositorio/adaptador Sequelize -> SQLite local
```

TypeScript define DTOs de transporte independientes de Sequelize. El proceso principal compone dependencias y ciclo de vida; el renderer no importa backend, ORM, driver SQLite ni módulos Node. El backend puede probarse sin crear ventanas. No se necesita servidor HTTP de negocio ni puerto LAN para esta entrega. Las futuras terminales de otros productos no justifican abrir un servicio del panel ahora.

Next.js se usa como generador de interfaz estática, servido por el protocolo propio `app://panel/` de Electron. El resolver de archivos limita las rutas al directorio de exportación y rechaza traversal y hosts ajenos. No hay API Routes, Server Actions ni SSR en ejecución. El artefacto debe cargar JS/CSS y resolver el preload sin conexión. La composición exacta, versiones y herramienta de empaquetado se registran en [ADR 001-stack](decisiones/001-stack.md); no considerar el servidor de desarrollo como prueba del artefacto de escritorio.

El protocolo atiende GET y HEAD, mantiene el MIME `text/plain` de los archivos `.txt` exportados y separa pathname de query/hash al resolver assets. Las consultas de navegación `_rsc` no cambian el origen autorizado. Los enlaces Next usan `prefetch={false}`: la precarga de segmentos puede pedir archivos que la exportación no genera; el clic y la navegación siguen conectados al frontend estático real. La CSP permite scripts propios y hashes SHA-256 calculados sobre los scripts inline del HTML exportado, sin `unsafe-inline` ni `unsafe-eval`.

## Seguridad de la frontera local

- Renderer con `nodeIntegration: false`, `contextIsolation: true`, sandbox y preload mínimo. API con métodos enumerados, sin exponer `ipcRenderer`, `invoke(channel)`, SQL, rutas o ejecución de comandos.
- Cada handler comprueba que el emisor sea el webContents y frame principal de la ventana prevista y que su URL sea la página local autorizada. Un iframe, otra ventana o navegación ajena no obtiene acceso por conocer el nombre del canal.
- Bloquear ventanas nuevas, navegación externa y permisos del navegador que no use la funcionalidad. Aplicar CSP compatible con los archivos estáticos; no cargar scripts, fuentes ni recursos remotos para funcionar.
- Validar entradas en el proceso confiable, incluso en métodos técnicos sin parámetros. Devolver errores estables y genéricos; no filtrar stack, SQL, rutas absolutas, identificadores de instalación ni secretos.
- El diagnóstico público no demuestra autorización. Las futuras operaciones de negocio permanecen ausentes hasta integrar identidad/permisos y probar denegación desde IPC directamente.

No se pretende impedir que el propietario del sistema operativo inspeccione o modifique sus archivos. El aislamiento del renderer limita el privilegio de la interfaz; no convierte SQLite en almacenamiento cifrado ni reemplaza autenticación.

## Persistencia y operación

Sequelize gestiona SQLite desde el backend. Migraciones explícitas y transaccionales registran el esquema técnico; nunca usar `sync({ force: true })` o `alter` para actualizar una BD persistente. La metadata técnica no crea identidades comerciales ni simula una instalación de producto de un cliente. Un fallo de migración no deja la aplicación disponible como si la BD estuviera sana.

Datos de ejecución fuera del repositorio: directorio de datos de usuario de Electron para uso normal, destino dedicado de desarrollo/demo y directorios temporales para pruebas. Configuración y scripts deben impedir que una demo termine en la BD normal. Documentar los destinos reales en README; no publicar rutas en el DTO de estado. Ignorar SQLite, WAL/SHM/journal, logs, respaldos, secretos y artefactos generados en Git.

La migración técnica inicial no necesitó seed. La spec 002 añade una demo de acceso opcional con cuatro usuarios ficticios en una BD dedicada marcada, fuera del repositorio y separada de la BD normal. Solo inicializa un archivo nuevo creado explícitamente por su CLI; repetir verifica escenario y huella sin sobrescribir cambios. No hay demo comercial ni reset destructivo. Los fixtures automatizados usan otras BD temporales. Política completa: [DATOS_PRUEBA](../../DATOS_PRUEBA.md).

## Mapa objetivo y dependencias

| Módulo | Responsabilidad del panel | Dependencia previa |
|---|---|---|
| Base técnica | Proceso de escritorio, contratos IPC, migraciones y estado | ADR del stack y prueba real del driver/artefacto |
| Acceso y operación | Bootstrap propietario, roles iniciales, recuperación, sesiones y backups según [08](08-acceso-operacion.md) | Módulos propios de identidad, autorización y auditoría; specs y pruebas de seguridad |
| Empresas/locales | Identidad comercial, fichas y asociaciones | Acceso y ámbito interno autorizados |
| Catálogo/cotización | Productos, módulos compatibles, planes y precios | Acceso, permisos y reglas comerciales especificadas |
| Suscripciones/cuotas | Historial contractual, periodos y deuda | Catálogo, calendario y transacciones probadas |
| Pagos/reversiones | Abonos manuales y saldos exactos | Autorización, auditoría transaccional y TDD de dinero |
| Instalaciones/licencias | Registro y emisión administrativa | Formato de integración versionado; implementación propia, política de vigencia/gracia y custodia de clave privada |

No esperar paquetes CORE ni usar su ausencia como bloqueo: especificar e implementar acceso, permisos y auditoría propios del panel antes del CRUD sensible. No habilitar operaciones comerciales mediante un administrador implícito. Cada producto conserva sus cuentas y BD. Los formatos de licencia se pueden acordar y probar entre implementaciones independientes.

La spec 002 retira el campo legado `core: 'pending'` del contrato y la UI actuales. La evidencia histórica de la spec 001 conserva el DTO observado entonces; no se reescriben sus resultados anteriores.

### Acceso interno del panel

Los módulos propios separan identidad/criptografía, autorización, auditoría, persistencia y transporte. `AccessService` recibe SQLite y contexto de sesión derivado del adaptador principal. La migración 2 es aditiva sobre el esquema 1; roles/permisos iniciales, relaciones, sesiones revocables, verificadores de recuperación y límites de intentos viven exclusivamente en la BD del panel. Ningún tipo de acceso requiere CORE.

Main guarda la asociación entre ventana autorizada y token interno, mientras SQLite almacena solo su verificador SHA-256; el preload no entrega token ni acepta actor/permisos del renderer. Cada petición vuelve a validar sesión, expiración, estado y permisos persistidos. La revocación y auditoría de cambios sensibles se coordinan en transacciones IMMEDIATE; el control del último propietario activo se comprueba dentro de la transacción. Auditoría no tiene mutaciones públicas y sus triggers rechazan UPDATE, DELETE y reemplazo por ID.

Contraseñas Argon2id y claves de recuperación aleatorias de 32 bytes tienen verificadores separados. El rate-limit global se combina con uno por principal normalizado para evitar que una cuenta de consulta reinicie las fallas contra otro usuario mediante un login válido. Las sesiones duran como máximo ocho horas y quince minutos de inactividad; el sondeo de estado no extiende su vigencia. Contratos, reglas exactas y verificación están en la spec 002.

Permanecen fuera de esta etapa: PostgreSQL/nube, sincronización, LAN, facturación, impresoras, caja, actualizaciones automáticas y temas/logos de clientes. No asignar soporte a motores o hardware no probado.

## Evidencia y siguientes puertas

La entrega 0.2.0 pasó instalación limpia desde lockfile, setup Electron y `npm run check`: lint, tipos, 48 pruebas sin omisiones y build estático/Electron. Los dos E2E cubren acceso offline completo, restricciones por rol, recarga/navegación directa y ausencia de preload. El paquete Windows x64 generado con `npmRebuild: false` conserva addons Node-API instalados en Windows x64, decisión revisada en el ADR. Su ejecutable pasó hash/verificación Argon2id, permisos, recuperación y replay, migración de SQLite v1 a v2 preservando metadatos, recarga offline, cierre y reapertura sin sesión. Runtime observado: Electron 44.9.0, Node 24.22.0, Node-API 10, x64. La firma actual es NotSigned; instalador, actualización y hardware permanecen pendientes. El detalle de los comandos y límites está en la spec 002. Las referencias siguientes a la primera base describen evidencia histórica 0.1.0.

La base se verifica con SQLite real temporal, migración desde vacío y repetida sin pérdida, DTO sin información sensible, rechazos de transporte y recorrido renderer-preload-backend real. Comprobar build estático, tipos y carga del artefacto Electron. Registrar comandos y resultados en la spec; pruebas simuladas de IPC no sustituyen el arranque real.

Se ejecutó el E2E de desarrollo con Electron real: recarga bajo modo offline, navegación a diagnóstico, estado obtenido por IPC/SQLite y frontend sin preload en un arnés separado. Tras reinstalar con `npm ci`, pasaron setup de Electron, lint, tipos, 18 tests, build y un nuevo E2E. También se generó un paquete Windows x64 sin instalador, se reconstruyó sqlite3 y se probó su ejecutable con `isPackaged: true`: recarga offline, navegación, estado real, ausencia de `require` en renderer y salida al cerrar la última ventana. Los comandos y límites están en la spec.

El ejecutable empaquetado no está firmado. La prueba del paquete no certifica instalación/actualización NSIS, firma, hardware mínimo ni preparación comercial; esos pasos siguen pendientes antes del piloto.

Antes de piloto: instalador Windows x64, dependencia SQLite nativa contra el ABI de Electron elegido, ejecución sin internet, actualización de esquema, restauración real y mediciones en hardware objetivo. La base técnica no certifica todavía instalador, rendimiento, compatibilidad con Windows ni recuperación de datos comerciales.
