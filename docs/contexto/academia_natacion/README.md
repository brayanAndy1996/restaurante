# Academia de natación

Operación y sincronización Android v0.4.0, 2026-10-21. Repositorio: [brayanAndy1996/piscina](https://github.com/brayanAndy1996/piscina).

**Para descargar y probar en tu computadora y Android: [guía paso a paso de instalación local](docs/11-guia-local-web-android.md).**

Backend Node.js/Fastify con Sequelize/PostgreSQL, web Next.js y aplicación Android React Native/Expo independientes. Incluye usuarios/roles, sesiones revocables, auditoría, pantallas web/Android y autorización firmada del único celular offline. Incluye configuración, planes, entrenadores, clases/aforo, alumnos/apoderados, solicitudes públicas, aprobación/renovación, cotización proporcional, cajas, cobros completos/verificación, PDFs internos, carnet QR, asistencia y portal del alumno. Incluye cola comercial cifrada, sincronización firmada, incidencias y bloqueo de cierre hasta conciliación administrativa. **La entrega productiva sigue pendiente de validación física Android, configuración del hosting y respaldo automático, además del flujo privado de adjuntos del solicitante online.** Ver [operación offline y conciliación](docs/10-offline-conciliacion.md).

## Requisitos

- Node.js **24.22.0** (rama 24, mínimo 24.13) y npm 11; versión de referencia en `.node-version` y `.nvmrc`. El instalador rechaza Node incompatible. No sustituir con Node 24.1.
- PostgreSQL 17 para comprobar conexión real. La base se verificó con instancia temporal 17.5; mantener el servidor actualizado antes de un despliegue.
- Desarrollo Android: Expo Go compatible con SDK 58 para exploración, o Android SDK/JDK compatibles con React Native para `expo run:android`. No se requiere SDK para tipos y bundle Hermes. No hay APK entregado ni dispositivo certificado todavía.

## Descargar e instalar

Clona el repositorio o descarga su ZIP y extrae todo en una carpeta. Desde esa raíz:

```powershell
node --version
npm --version
npm ci
Copy-Item .env.example .env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

No ejecutar las copias sobre configuraciones propias existentes. Editar `.env` con la conexión PostgreSQL local. Las variables de `apps/mobile/.env` son públicas: nunca incluir contraseñas ni conexiones PostgreSQL.

No depende de las carpetas de otros productos. `node_modules`, `.tools`, bases locales, `.env`, bundles y referencias internas de `docs/contexto/` no se publican.

## PostgreSQL de desarrollo

Usar una base dedicada, sin datos de clientes. Ejemplo manual en `psql` como administrador de tu instalación local (no ejecutar sobre producción):

```sql
CREATE ROLE piscina WITH LOGIN PASSWORD 'piscina_local';
CREATE DATABASE piscina_dev OWNER piscina;
```

Estos nombres coinciden con `.env.example`; no crean un usuario administrador de la aplicación. Cambiar la contraseña en instalaciones reales y no publicar `.env`. No ejecutar los comandos si ya existen rol/base: configura los existentes o crea otros dedicados.

```powershell
npm run db:check
```

Este comando solo comprueba conexión, no crea/modifica tablas. Existen migraciones y demo opcional de acceso y academia; incluyen el esquema comercial de esta versión. La aplicación no ejecuta `sequelize.sync`, no carga demos ni crea usuarios al arrancar. Las migraciones y demo de acceso se ejecutan explícitamente; ver preparación a continuación.

## Preparar acceso

Después de configurar `.env` y PostgreSQL:

```powershell
npm run keys:generate
npm run db:migrate
```

La clave privada queda en `.env.keys` (ignorada por Git y sin sobrescribir). Copia solo la clave pública mostrada a `EXPO_PUBLIC_OFFLINE_PUBLIC_KEY` en `apps/mobile/.env`. Configura `WEB_ORIGIN=http://127.0.0.1:3000` para desarrollo; en producción debe ser el origen HTTPS público exacto.

Completa los campos BOOTSTRAP_* de `.env` con la academia, usuario y contraseña propios; ejecuta `npm run users:bootstrap` y retira la contraseña de bootstrap del archivo. No hay administrador predeterminado. Para escenarios ficticios existe `npm run db:seed:demo`, únicamente tras migrar una BD dedicada `_demo`; no ejecutarlo sobre instalaciones reales.

[Guía completa de acceso, demo, recuperación y contratos](docs/07-acceso-dispositivo.md).

## Ejecutar API y web

```powershell
npm run dev
```

API en `http://127.0.0.1:4000`; web en `http://127.0.0.1:3000`. También pueden iniciarse en terminales separadas con `npm run dev:api` y `npm run dev:web`.

- `/health/live` comprueba que la API responde, aun sin BD.
- `/health/ready` devuelve 200 con PostgreSQL disponible, o 503 sin exponer credenciales.
- La web consulta la API desde su servidor y muestra disponibilidad o error real.
- `/acceso`: login, usuarios/roles, dispositivos y auditoría; cookie HttpOnly.
- `/academia`: configuración, planes, entrenadores, clases, alumnos e inscripciones.
- `/operacion`: cajas, cobros, imágenes privadas, verificación, recibos/cierres PDF y asistencia manual.
- `/inscripcion`: solicitud online pública, requiere aprobación y pago.
- `/portal`: cuenta del alumno, carnet QR, mensualidades, recibos y avisos.

Para ejecutar compilados: `npm run build`, después `npm run start:api` y `npm run start:web` en terminales separadas. Los scripts de raíz cargan `.env`; los servidores escuchan loopback por defecto. No hay despliegue público configurado.

## Ejecutar Android

En `apps/mobile/.env`, establecer `EXPO_PUBLIC_API_URL` según el dispositivo:

- Teléfono físico: IP LAN del equipo que ejecuta la API, por ejemplo `http://192.168.1.10:4000`. No usar `localhost`, que apuntaría al propio teléfono.
- Emulador Android estándar: `http://10.0.2.2:4000`.
- Distribución: URL HTTPS del backend; HTTP se permite solo en desarrollo local.

Para teléfono físico, poner `API_HOST=0.0.0.0` en `.env`, reiniciar API y usar una red local de desarrollo confiable. API y Metro deben ser accesibles desde el teléfono; no abrirlos a internet ni modificar el router como parte de estas instrucciones.

```powershell
npm run dev:mobile
```

Esto inicia Metro por LAN. La pantalla principal permite login, cambio de contraseña, usuarios para administrador, registro/designación del equipo, operaciones comerciales y sincronización completa de datos/pendientes. Diagnóstico conserva su pantalla separada. **La operación offline necesita el reloj propio, SQLCipher y un build Android nativo; Expo Go no los incluye.** Ver instrucciones de compilación y límites del APK debug en la [guía local](docs/11-guia-local-web-android.md).

Con SDK/JDK configurados, `npm run android --workspace @piscina/mobile` genera/ejecuta el proyecto Android local de desarrollo. El ensamblado del APK completo pasó en CI; su instalación/ejecución en Windows y teléfono físico no se han probado aquí. El APK debug necesita Metro. Para una prueba autónoma se requiere JavaScript incorporado y API HTTPS, como explica la guía; no confundir el bundle JavaScript con un APK de producción.

## Comprobaciones

```powershell
npm run check
npm run test:postgres
npm run smoke
npm run smoke:access
```

`check`: lint, tipos de los tres componentes, 22 pruebas automáticas, build API/web y exportación Android Hermes. No necesita BD conectada. `test:postgres`: 30 pruebas de PostgreSQL y acceso/sincronización con fixtures propios. Requiere API_TEST_DATABASE_URL local con BD `_test` y rol de pruebas con CREATEDB; crea/elimina únicamente esquemas/bases efímeros. No usa la conexión operativa como fallback. `smoke`: API compilada + PostgreSQL real + página web de producción; comprueba también la caída de API. Ejecutar después del build y con PostgreSQL disponible.

También existen `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` y `npm run build:mobile`. `build:mobile` genera un bundle en `apps/mobile/dist`, no un APK. `npm run smoke:access` verifica BFF y administración en navegador real headless con BD efímera; necesita Edge (Windows) o Chrome (Linux). El workflow ejecuta checks/integración/smokes y ensambla un APK debug Android completo; no despliega servicios.

Las pruebas SQLite usan archivos temporales aislados. La aplicación propia Android usa SQLCipher para la copia comercial y su cola; claves, sesión y permisos firmados se guardan en SecureStore. La web y los demás dispositivos operan online contra PostgreSQL. Ver [uso y límites offline](docs/10-offline-conciliacion.md). Resultados históricos de base: [v0.1.0](docs/06-verificacion-base.md); acceso: [v0.2.0](docs/08-verificacion-acceso.md).

## Documentación

- [Acuerdos y primera entrega](docs/01-acuerdos-entregas.md).
- [Operación offline y sincronización](docs/02-operacion-sincronizacion.md).
- [Documentación funcional](docs/03-documentacion-funcional.md).
- [Método de desarrollo](docs/04-metodo-desarrollo.md).
- [Contrato de diagnóstico](docs/05-contratos-base.md).
- [Stack y evidencia](docs/decisiones/001-stack.md).
- [Spec 001](docs/specs/001-base-ejecutable.md).
- [Acceso y dispositivo](docs/07-acceso-dispositivo.md) y [spec 002](docs/specs/002-acceso-dispositivo.md).

Las reglas de offline de negocio siguen siendo: un único celular designado hasta 24 horas; demás equipos online; conflictos según primera operación válida aceptada por nube. El control de autorización, las operaciones locales y la cola comercial están implementados; su validación en Android físico sigue pendiente.

## Siguiente funcionalidad

La operación online de specs 003/004 está implementada. La spec 005 incorpora cola/sincronización y conciliación. Continúan la validación física Android, el autoservicio privado de adjuntos online y la preparación del hosting/respaldo automático. La spec 002 implementa acceso/ámbito/permisos y autorización del dispositivo. Los detalles no resueltos se cierran en cada spec; no adelantar SUNAT, multimedia ni mensajería externa.

## Operación y sincronización Android v0.4.0

[Contratos, demo, evidencia y pendientes](docs/09-operacion-online.md). La demo comercial es opcional y usa fecha base fija `2026-10-01` (DEMO_BASE_DATE configurable antes de la primera carga). Dos academias con plan, entrenador, clases, dos alumnos y solicitudes aprobada/pendiente; repetir conserva cambios. DNI 90000001/90000002 ficticios, sin consulta externa. La demo de academia todavía no cobra ni crea cuentas de alumnos automáticamente: esos estados se obtienen recorriendo aprobación/cobro desde la UI.

Android incluye pantallas de operación online, cámara QR, galería/cámara para identificación/comprobantes y compartir PDFs. La compilación y los tipos no prueban permisos/cámara/compartición en un teléfono físico. Los nuevos módulos nativos deben instalarse en un build propio; no se promete funcionamiento de hardware por exportar Hermes.

Respaldo cifrado: `npm run backup:key`, `npm run backup:create` y `npm run backup:verify -- RUTA_DEL_ARCHIVO`; ver límites, claves y restauración aislada en docs/09.
