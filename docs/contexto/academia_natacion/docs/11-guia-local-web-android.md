# Ejecutar la web y Android en tu equipo

Versión del código: **0.4.0**. Guía para **Windows y PowerShell**, con datos ficticios. Ejecuta los comandos desde la raíz de `piscina`, salvo que se indique otra carpeta.

## 1. Estado de la primera entrega

La primera entrega acordada **todavía no está terminada**. Esta versión permite probar usuarios, alumnos, planes, clases, inscripciones/aprobaciones, cajas, cobros completos, carnet QR, asistencia, portal y sincronización del único Android offline, con incidencias y conciliación administrativa.

Falta completar el flujo privado para que el solicitante online adjunte su comprobante. Actualmente lo carga el personal desde su sesión. También faltan la validación en un Android real y la preparación productiva de hosting, HTTPS y respaldo automático. SUNAT y fotos/videos de rendimiento siguen para sus fases posteriores.

El commit funcional `10a59a4` pasó 22 pruebas unitarias, 30 integraciones PostgreSQL, recorridos de navegador y ensamblado Android en [GitHub Actions](https://github.com/brayanAndy1996/piscina/actions/runs/39695410696). El ensamblado en CI no equivale a una prueba en tu celular.

## 2. Qué se ejecuta en cada lugar

| Componente | En esta prueba local |
|---|---|
| PostgreSQL | Servicio en tu computadora; conserva los datos del servidor. |
| API Node.js | Tu computadora, puerto 4000; atiende a web y Android. |
| Web Next.js | Tu computadora, puerto 3000; abrir en su navegador. |
| Android React Native | Aplicación propia instalada en el teléfono o emulador. |
| Metro | Tu computadora, normalmente puerto 8081; entrega JavaScript al build Android de desarrollo. |

La computadora sustituye temporalmente al servidor cloud para esta prueba. El teléfono no instala Node.js, Sequelize ni PostgreSQL. Su copia operativa y cola usan SQLite SQLCipher.

## 3. Instalar requisitos y descargar

Para API y web:

- Node.js **24.22.0** y npm **11.x**. Revisar `.node-version` y `package.json`; Node 24.1 no sirve para este proyecto.
- PostgreSQL **17**, con el servicio iniciado. Anota la contraseña del usuario administrador `postgres` que elegiste al instalarlo.
- Git, si vas a clonar; también puedes descargar el ZIP sin Git.

Para compilar Android, además: **JDK 17**, [Android Studio](https://developer.android.com/studio), SDK y Platform-Tools. El JDK utilizado debe ser 17, aunque Android Studio incluya otro.

Descarga con Git:

```powershell
git clone --branch main https://github.com/brayanAndy1996/piscina.git
Set-Location piscina
node --version
npm --version
npm ci
```

Alternativa: en GitHub selecciona `main` → **Code → Download ZIP**, extrae la carpeta, abre PowerShell dentro y ejecuta las tres últimas líneas. No ejecutes `npm install` dentro de cada aplicación: los tres componentes se instalan desde la raíz con el lockfile.

## 4. Crear una base exclusiva de demostración

Abre SQL Shell/psql o Query Tool de pgAdmin como administrador PostgreSQL, conectado a la base `postgres`. En psql de Windows puedes usar, ajustando la ruta a tu instalación:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h 127.0.0.1 -U postgres -d postgres
```

Ejecuta estos comandos SQL **una sola vez**, sobre una instalación local de pruebas:

```sql
CREATE ROLE piscina WITH LOGIN PASSWORD 'piscina_local';
CREATE DATABASE piscina_demo OWNER piscina;
```

`piscina_local` es una contraseña ficticia para este ejemplo local. Si el rol o la base ya existen, revisa sus credenciales y utiliza lo existente o crea otros nombres; no borres una base para repetir la guía. En psql, `\q` permite salir.

## 5. Configurar archivos de entorno y claves

En PowerShell, desde la raíz del proyecto:

```powershell
if (!(Test-Path -LiteralPath '.env')) { Copy-Item .env.example .env }
if (!(Test-Path -LiteralPath 'apps/mobile/.env')) { Copy-Item apps/mobile/.env.example apps/mobile/.env }
```

Edita `.env` con estos valores para la demo:

```dotenv
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=4000
API_DATABASE_URL=postgres://piscina:piscina_local@127.0.0.1:5432/piscina_demo
API_DATABASE_SSL=disable
API_CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
API_URL=http://127.0.0.1:4000
WEB_ORIGIN=http://127.0.0.1:3000
```

Conserva los demás campos del ejemplo. Para los pasos por Wi-Fi de la sección 8 cambiarás `API_HOST`. Si usas otra contraseña PostgreSQL, codifica los caracteres especiales al incluirla en la URL.

Genera la clave una sola vez en esta instalación:

```powershell
npm run keys:generate
```

Se crea `.env.keys` y se imprime una línea `EXPO_PUBLIC_OFFLINE_PUBLIC_KEY=...`. Copia **esa línea pública** a `apps/mobile/.env`. La clave privada queda solo en `.env.keys`; no la copies al móvil ni a GitHub. Si el archivo ya existe, el comando no lo sobrescribe. Para volver a obtener su clave pública sin regenerar la privada:

```powershell
node --env-file=.env.keys --input-type=module -e "import {createPrivateKey,createPublicKey} from 'node:crypto'; const k=createPrivateKey({key:Buffer.from(process.env.API_OFFLINE_PRIVATE_KEY,'base64'),type:'pkcs8',format:'der'}); console.log('EXPO_PUBLIC_OFFLINE_PUBLIC_KEY='+createPublicKey(k).export({type:'spki',format:'der'}).subarray(-32).toString('hex'));"
```

Prepara la base y carga la demo:

```powershell
npm run db:check
npm run db:migrate
npm run db:seed:demo
```

La demo exige una base terminada en `_demo` y rechaza instalaciones con datos normales. No combines `users:bootstrap` con la demo. Repetir el seed conserva los registros y las contraseñas modificadas; no restablece todo.

## 6. Abrir y probar la web

Para poder detener solo la API al probar offline, usa **dos terminales**, ambas en la raíz del proyecto.

Terminal 1:

```powershell
npm run dev:api
```

Terminal 2:

```powershell
npm run dev:web
```

Abre **http://127.0.0.1:3000/acceso**. Usa exactamente ese origen, que coincide con `WEB_ORIGIN`; no cambies a `localhost` a mitad del recorrido.

| Campo | Acceso demo |
|---|---|
| Academia | `demo-azul` |
| Usuario | `admin` |
| Contraseña | `DemoLocal2026!` |

También existe `demo-verde`, con datos separados y el mismo acceso demo. Secretaría: `secretaria` / `RecepcionDemo2026!`, con cambio de contraseña obligatorio en el primer acceso. Estas claves son solo para datos ficticios.

Recorrido sugerido:

1. En `/academia`, revisa planes, entrenador, clases y alumnos. La demo usa inicialmente el mes **2026-10**; selecciona ese mes para ver las inscripciones precargadas.
2. Para asistencia de hoy, crea un horario del **día y hora actuales en Perú**, entre 08:00 y 19:00, y un alumno ficticio con inscripción del mes actual. Asigna un plan compatible y aprueba la inscripción con motivo.
3. En `/operacion`, abre tu caja y registra el **importe completo que muestra la inscripción**. Si eliges Yape/transferencia, adjunta JPG/PNG y verifica manualmente el abono antes de confirmarlo. No uses dinero real.
4. Descarga el recibo interno. Una vez consolidado el pago, el alumno puede entrar en `/acceso` con su DNI como usuario y contraseña temporal, cambiarla y abrir `/portal`.
5. Marca asistencia dentro del día/hora asignados. Se comprueban pago, aprobación, vigencia y clases restantes. Fuera del bloque horario será rechazada.

La web de esta versión necesita la API disponible. La operación sin API corresponde al Android designado.

## 7. Preparar Android Studio y el celular

En Android Studio, abre **SDK Manager** e instala Platform-Tools y Command-line Tools. Habilita la visualización de detalles para instalar el SDK, Build-Tools, NDK y CMake solicitados por el proyecto generado. Las versiones base fijadas por React Native están en `node_modules/react-native/gradle/libs.versions.toml`: compile SDK 37, Build-Tools 37.0.0 y NDK 27.1.12297006. Gradle/Expo indican cualquier componente adicional; acepta las licencias desde las herramientas de Android.

En la terminal que compilará Android configura las rutas reales; sustituye la primera por la carpeta de tu JDK 17:

```powershell
$env:JAVA_HOME='C:\RUTA\A\TU\JDK-17'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
java -version
adb version
```

Estas variables se aplican a esa terminal; configúralas de nuevo si abres otra. Si tu SDK está en otra carpeta, ajusta `ANDROID_HOME`.

En tu teléfono habilita **Opciones de desarrollador → Depuración USB**, conéctalo por USB y acepta su autorización:

```powershell
adb devices
```

Debe aparecer con estado `device`. Si dice `unauthorized`, desbloquea el teléfono y acepta el aviso; si no aparece, revisa cable de datos/controlador. También puedes iniciar un emulador en Android Studio. Al compilar, selecciona un solo destino.

## 8. Conectar Android a tu API local

### Teléfono físico por Wi-Fi

Conecta computadora y teléfono a la misma red de desarrollo. Ejecuta `ipconfig` y busca la IPv4 del adaptador activo; por ejemplo `192.168.1.10`.

En `.env` cambia:

```dotenv
API_HOST=0.0.0.0
```

En `apps/mobile/.env` configura:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000
EXPO_PUBLIC_OFFLINE_PUBLIC_KEY=PEGA_AQUI_LA_CLAVE_PUBLICA_GENERADA
```

Reemplaza IP y clave; no dejes el texto de ejemplo. Conserva `API_URL=http://127.0.0.1:4000` y `WEB_ORIGIN=http://127.0.0.1:3000` en la configuración de la web.

Reinicia la terminal de API. Desde el navegador del teléfono comprueba `http://192.168.1.10:4000/health/ready`: debe responder `ready`. Si Windows pide acceso de Node.js al firewall, permite únicamente la red privada de desarrollo. API 4000 y Metro 8081 deben ser accesibles desde ese teléfono; PostgreSQL 5432 no necesita abrirse a la LAN. No requiere abrir puertos en el router.

### Emulador Android estándar

Usa `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000` y `API_HOST=0.0.0.0`. Ese alias apunta a la computadora anfitriona. `127.0.0.1` dentro de Android apunta al propio Android, salvo redirección USB.

### Alternativa para acceder a la API por USB

Con el teléfono autorizado, puedes ejecutar `adb reverse tcp:4000 tcp:4000` y usar `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000`. Para Metro existe `adb reverse tcp:8081 tcp:8081`; si la aplicación busca otra dirección para el servidor de desarrollo, ajusta ese host en sus opciones de desarrollo. Las redirecciones deben renovarse después de desconectar/reconectar. La ruta por Wi-Fi anterior evita depender de esta configuración de Metro.

## 9. Compilar e instalar la aplicación Android propia

Con API y web iniciadas, abre una tercera terminal en la raíz, configura JDK/SDK como antes y ejecuta:

```powershell
npm run android --workspace @piscina/mobile -- --device
```

Expo genera el proyecto Android, compila, instala en el destino elegido y arranca Metro. La primera compilación descarga herramientas/dependencias y tarda más; necesita internet. Conserva abierta la terminal que sirve Metro. En siguientes sesiones puedes repetir el comando; para arrancar solo Metro existe `npm run dev:mobile`.

No pruebes offline con Expo Go: faltan el reloj propio y SQLCipher. Usa la aplicación **Academia de natación**, paquete `com.piscina.academia`, instalada con el comando anterior.

El APK de desarrollo queda normalmente en `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Si ya generaste el proyecto y quieres solo ensamblarlo:

```powershell
Push-Location apps/mobile/android
.\gradlew.bat :app:assembleDebug
Pop-Location
```

Ese APK **debug depende de Metro**; copiarlo a otro teléfono no lo convierte en una distribución autónoma. No subas el Android generado, los APK ni claves al repositorio. Si cambias `.env` del móvil, reinicia Metro/reconstruye según corresponda; si cambias módulos nativos, debes recompilar. No uses `prebuild --clean` para solucionar errores sin revisar antes cambios nativos propios.

## 10. Probar el funcionamiento offline y la conciliación

1. Entra online como administrador demo en el Android instalado. Registra este celular y pulsa **Designar este celular**.
2. Pulsa **Sincronizar datos y pendientes (24 horas)**. Debe completar subida/descarga y verificar el permiso con la clave pública configurada.
3. Como simulación local, detén **solo la API** con `Ctrl+C` en su terminal. Deja encendidos PostgreSQL, Metro y la conexión del teléfono a Metro. Así la API no está disponible y el build debug todavía puede cargar JavaScript.
4. En el mismo teléfono registra un alumno ficticio, su inscripción, aprobación, caja y cobro completo; luego marca asistencia en un bloque válido. Verifica la cola y el carnet/recibo local pendiente. Si la caja ya está abierta, úsala en lugar de abrir otra.
5. Puedes cerrar y reabrir la app manteniendo Metro accesible para comprobar la cola. Reencender el teléfono es un caso distinto: la autorización exige reconectar después de un reinicio del dispositivo.
6. Vuelve a ejecutar `npm run dev:api`; pulsa sincronizar en Android. Comprueba registros y pagos desde la web, y que la cola pendiente disminuya sin duplicar cobros/asistencias.
7. Revisa **Incidencias de sincronización**. Los cobros descartados con dinero recibido bloquean el cierre hasta que ADMIN registre la solución efectuada y confirme la conciliación. Después, el cobrador sincroniza y solicita un nuevo cierre. Resolver no crea ingresos ni devoluciones automáticamente.

La vigencia máxima es de 24 h desde una sincronización completa. Cerrar sesión conserva los pendientes, pero elimina la sesión/permiso: vuelve a entrar online con **el mismo operador** para recuperarlos. No borres datos de Android ni desinstales con cola pendiente.

La simulación con API detenida no certifica un APK autónomo sin Metro. Para probar modo avión con la app cerrada y sin acceso a la computadora se necesita un build con JavaScript incorporado. La compilación release exige una API **HTTPS**, porque el cliente distribuido rechaza HTTP. Una vez tengas ese endpoint de pruebas y lo configures en `apps/mobile/.env`, puedes compilar con `npm run android --workspace @piscina/mobile -- --variant release --device`. No desactives esa validación para usar HTTP ni confundas la firma de desarrollo con una firma de distribución comercial. La calificación de esa modalidad en teléfono sigue pendiente.

## 11. Ejecutar la web compilada y detener servicios

Opcionalmente, en lugar del modo `dev`, detén API/web y ejecuta:

```powershell
npm run build
```

Terminal de API: `npm run start:api`. Terminal de web: `npm run start:web`. Para la web compilada mantén `WEB_ORIGIN=http://127.0.0.1:3000`: se admite loopback HTTP local; no publiques esta configuración como un hosting productivo.

Para detener cada servidor usa `Ctrl+C` en su terminal. No borres PostgreSQL ni los datos Android para apagar el entorno. No cierres la app/desinstales esperando que el dinero pendiente se consolide automáticamente: sincroniza y revisa primero.

## 12. Problemas frecuentes y actualización

| Problema | Revisar |
|---|---|
| Instalación rechaza Node | `node --version` y `where.exe node`; usa Node 24.22.0 y npm 11. |
| Error de conexión PostgreSQL | Servicio iniciado, puerto/usuario/contraseña/base en `.env`; ejecuta `npm run db:check`. |
| Demo rechazada | La URL debe apuntar a `piscina_demo`; no mezclar datos normales ni bootstrap con demo. |
| No aparecen inscripciones demo | Selecciona mes `2026-10`; la fecha base es fija. |
| Web rechaza una operación por origen | Abre `127.0.0.1:3000`, igual a `WEB_ORIGIN`; reinicia tras cambiar `.env`. |
| Teléfono no alcanza la API | Prueba `/health/ready` en su navegador; revisa IP, `API_HOST`, Wi-Fi/firewall o `adb reverse`. |
| Compilación usa Java incorrecto | `java -version`, `JAVA_HOME`; seleccionar JDK 17. |
| No encuentra SDK/NDK | `ANDROID_HOME`, SDK Manager y licencias; instalar la versión que solicita Gradle. |
| Error de reloj/SQLCipher | Usar build propio, no Expo Go; recompilar módulos nativos. |
| Firma offline inválida | Clave pública del móvil correspondiente a `.env.keys`; reiniciar Metro después de configurarla. |
| Otro celular no puede designarse | Esperar vencimiento del permiso anterior; cerrar sesión no lo libera anticipadamente. |
| API caída pero no puede escribir | Verificar copia completa, mismo operador/equipo, permiso sin vencer y sincronización no interrumpida. |
| Caja no cierra | Revisar diferencias de efectivo e incidencias de cobros; ADMIN debe conciliar antes del nuevo cierre. |
| App debug no abre sin conexión a la computadora | Necesita Metro. Ver sección 10 para distinguir esa dependencia de la cola offline. |

Para actualizar una copia Git sin cambios propios pendientes:

```powershell
git pull --ff-only origin main
npm ci
npm run db:migrate
```

Detén servidores antes de actualizar, conserva `.env`, `.env.keys`, `.env.backup` y la BD. Recompila Android si hubo cambios nativos. Si descargaste ZIP, extrae la actualización en otra carpeta y configura conscientemente la misma BD/claves; no generes otra clave de firma sobre una instalación existente por accidente.

Los datos consolidados están en PostgreSQL; la cola nunca enviada está solo en el teléfono. Las instrucciones de respaldo cifrado están en [respaldo cifrado](09-operacion-online.md). No ejecutes tests destructivos contra la demo: `test:postgres` necesita otra BD dedicada `_test` y un rol de pruebas con CREATEDB.

Referencias oficiales consultadas: [compilación local Expo](https://docs.expo.dev/guides/local-app-development/) y [ejecución en un dispositivo Android](https://reactnative.dev/docs/running-on-device). Las versiones y comandos de este repositorio prevalecen sobre ejemplos genéricos de otras versiones.
