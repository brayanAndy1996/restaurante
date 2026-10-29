# Tutorial: levantar el proyecto en tu computadora, paso a paso

Al terminar tendrás el sistema funcionando en tu navegador, con datos de demostración. No necesitas
saber Docker: aquí está cada clic y cada comando, con lo que deberías ver en pantalla.

Esta guía amplía `DESPLIEGUE-LOCAL.md` (en la raíz del repositorio). Cuando tengas dudas sobre los
usuarios de demostración o el recorrido para probar el sistema, esa guía es la referencia.

Los ejemplos son para **Windows**. Donde Mac cambia algo, lo indico.

## Qué vas a hacer, en una imagen

```
Tu computadora
├── Docker Desktop ──► un "contenedor" con PostgreSQL 16 (la base de datos)
├── Terminal 1: pnpm dev ──► la API (http://localhost:3000) y la app (http://localhost:5173)
└── Navegador ──► abres la app y la usas
```

Hoy Docker solo corre la base de datos. La API y la app corren directamente con Node.

## Paso 0. Abrir una terminal

La terminal es una ventana donde escribes comandos en lugar de hacer clic.

- **Windows:** busca "PowerShell" en el menú Inicio y ábrelo. También sirve "Git Bash", que se
  instala junto con Git.
- **Mac:** abre "Terminal" (Cmd + Espacio, escribe "Terminal").

Para ejecutar un comando, lo escribes (o lo pegas) y presionas Enter. En esta guía los comandos van en
cajas grises. Las líneas que empiezan con `#` son comentarios: no las escribas.

## Paso 1. Comprobar lo instalado

Necesitas tres programas: Git, Node.js 22 o superior y Docker Desktop. Escribe en la terminal:

```bash
git --version
node --version
docker --version
```

Deberías ver algo como `git version 2.x`, `v22.x.x` (o mayor) y `Docker version 2x.x`. Si alguno dice
"no se reconoce como un comando", instálalo desde los enlaces de `DESPLIEGUE-LOCAL.md` y **cierra y
vuelve a abrir la terminal**.

## Paso 2. Poner Docker Desktop en marcha

Tener Docker instalado no basta: el programa tiene que estar **abierto**, porque es el que ejecuta los
contenedores.

1. Abre **Docker Desktop** desde el menú Inicio (en Mac, desde Aplicaciones).
2. La primera vez te pedirá aceptar los términos y quizás iniciar sesión. Puedes elegir
   "Continue without signing in" (continuar sin iniciar sesión).
3. **Solo en Windows:** Docker usa algo llamado WSL 2. Si aparece un aviso de que falta o está
   desactualizado, abre PowerShell **como administrador** (clic derecho, "Ejecutar como
   administrador") y escribe `wsl --update`. Luego reinicia la computadora.
4. Espera a que la esquina inferior izquierda de Docker Desktop diga **"Engine running"** (motor en
   marcha) con un indicador verde.

Comprueba que Docker funciona de verdad con un contenedor de prueba:

```bash
docker run hello-world
```

Si ves un mensaje que empieza con **"Hello from Docker!"**, Docker está listo. Este comando descargó
una "imagen" mínima y la ejecutó en un contenedor; en el módulo [02-docker.md](02-docker.md) se
explica qué significa eso.

## Paso 3. Descargar el código

Elige dónde guardar el proyecto, por ejemplo tu carpeta de usuario, y ejecuta:

```bash
cd ~
git clone https://github.com/brayanAndy1996/restaurante.git
cd restaurante
git checkout main
```

- `cd` significa "entrar a una carpeta". `~` es tu carpeta de usuario.
- `git clone` descarga el repositorio completo a una carpeta nueva llamada `restaurante`.
- `git checkout main` se asegura de que estás en la rama `main`, que tiene lo aprobado.

Si GitHub te pide usuario y contraseña, usa tu cuenta. Como contraseña, GitHub pide un "token" (no tu
contraseña normal); otra opción más simple es instalar [GitHub Desktop](https://desktop.github.com/)
y clonar desde ahí.

## Paso 4. Instalar las dependencias

Las "dependencias" son las librerías de terceros que usa el proyecto (NestJS, React, etc.). Se
instalan con **pnpm**, que viene incluido con Node a través de **corepack**:

```bash
corepack enable
pnpm install --frozen-lockfile
```

- `corepack enable` activa pnpm en la versión exacta que pide el proyecto. Si falla por permisos, abre
  la terminal como administrador (en Mac, escribe `sudo corepack enable` y tu contraseña).
- `pnpm install` descarga todo a carpetas `node_modules`. Tarda unos minutos la primera vez. Verás
  barras de progreso y al final algo como `Done in 1m 20s`.
- `--frozen-lockfile` instala exactamente las versiones registradas en `pnpm-lock.yaml`, las mismas
  que usa el equipo y la integración continua.

## Paso 5. Preparar la base de datos (aquí entra Docker)

Con Docker Desktop abierto, ejecuta:

```bash
pnpm local:preparar
```

Este único comando hace cinco cosas. No tienes que hacerlas tú, pero así sabes qué está pasando:

| Lo que verás en la terminal                  | Qué está pasando                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Se creó .env a partir de .env.example`      | Crea el archivo de configuración local `.env` (solo la primera vez)                               |
| `Container restaurante-postgres-1 Healthy`   | Docker descarga la imagen de PostgreSQL 16 (solo la primera vez) y arranca un contenedor con ella |
| Mensajes de roles y de la base `restaurante` | Crea los tres usuarios de la base de datos y la base del proyecto                                 |
| Nombres de migraciones aplicadas             | Crea las tablas (empresas, sucursales, usuarios, carta…)                                          |
| Una tabla con usuarios y **PIN**             | Carga los datos de demostración: dos empresas de ejemplo y un usuario por rol                     |

**Copia los PIN que aparecen al final** y guárdalos en un archivo de texto: solo se muestran esta vez.

Ahora mira Docker Desktop, en la sección **Containers**: verás un grupo llamado `restaurante` con un
contenedor `postgres-1` en verde. Esa es tu base de datos, corriendo dentro de Docker.

## Paso 6. Arrancar la API y la app

```bash
pnpm dev
```

Esta terminal queda ocupada mostrando mensajes mientras el sistema corre; es normal. Cuando veas que
la API escucha en el puerto 3000 y que Vite muestra `Local: http://localhost:5173/`, abre en el
navegador:

- http://localhost:3000/health — debe responder algo como `{"estado":"ok","baseDeDatos":"ok"}`. Si
  dice `ok` en los dos, la API habla con la base de datos dentro de Docker.
- http://localhost:5173 — la app del personal.

La app está pensada para celular. En Chrome, presiona `F12` y luego `Ctrl + Shift + M` para verla en
tamaño de celular.

Entra con `fogon.admin` y la contraseña temporal `Temporal-Demo-1`. A partir de aquí sigue el
"recorrido sugerido" de `DESPLIEGUE-LOCAL.md`, sección 5.

## Paso 7. Tu rutina diaria

| Quieres…                                | Haz esto                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Empezar a trabajar                      | Abre Docker Desktop, espera "Engine running", y en la carpeta del proyecto: `pnpm dev` |
| Traer lo último que se aprobó en `main` | Detén `pnpm dev` y ejecuta `git pull`, `pnpm install` y `pnpm db:migrar`               |
| Detener la API y la app                 | `Ctrl + C` en la terminal donde corre `pnpm dev`                                       |
| Detener también la base de datos        | `docker compose stop` (los datos se conservan)                                         |
| Borrar la base y empezar de cero        | `docker compose down -v` y luego `pnpm local:preparar`                                 |

No hace falta volver a ejecutar `pnpm local:preparar` cada día. El contenedor de PostgreSQL arranca
solo cuando abres Docker Desktop (está configurado con `restart: unless-stopped`), salvo que lo hayas
detenido con `docker compose stop`; en ese caso, `docker compose start` lo vuelve a encender.

## Si algo falla

| Mensaje o síntoma                                                           | Causa probable y solución                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error during connect` o `Cannot connect to the Docker daemon`              | Docker Desktop no está abierto o aún no dice "Engine running". Ábrelo, espera y repite el comando                                                                                                                                                   |
| Docker Desktop no arranca en Windows y menciona WSL o virtualización        | Ejecuta `wsl --update` en PowerShell como administrador y reinicia. Si habla de "virtualization", hay que activarla en la BIOS de la PC (busca el modelo de tu PC + "activar virtualización")                                                       |
| `port is already allocated` o `5433 ... in use`                             | Otro programa usa ese puerto. Cierra otros PostgreSQL o contenedores; o en `.env` define `DB_PUERTO_LOCAL=5434` y usa `5434` en las cuatro URL de la base                                                                                           |
| `la autentificación password falló para el usuario «postgres»` (en español) | Hay un PostgreSQL instalado en Windows escuchando en el mismo puerto. Detén su servicio (`postgresql-x64-…` en "Servicios") o usa otro puerto con `DB_PUERTO_LOCAL`, como en la fila anterior; luego `docker compose up -d` y `pnpm local:preparar` |
| `corepack: command not found` o no existe                                   | En versiones muy nuevas de Node puede no venir incluido. Instálalo con `npm install -g corepack` y repite `corepack enable`                                                                                                                         |
| En PowerShell: "la ejecución de scripts está deshabilitada en este sistema" | Ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y responde "S"                                                                                                                                                                |
| `/health` responde `baseDeDatos: error`                                     | El contenedor está detenido. Mira Docker Desktop; si no está en verde, `docker compose start`                                                                                                                                                       |
| La app dice "No hay conexión con el servidor"                               | `pnpm dev` no está corriendo o se detuvo con un error: revisa esa terminal                                                                                                                                                                          |
| Perdiste los PIN                                                            | `docker compose down -v` y `pnpm local:preparar` (vuelve a crear todo e imprime PIN nuevos)                                                                                                                                                         |

Si el error no está en la tabla, copia el mensaje completo de la terminal y pégaselo a Claude: suele
bastar para saber qué pasa.

## Siguiente paso

Cuando lo tengas corriendo, sigue con [01-mapa-del-proyecto.md](01-mapa-del-proyecto.md) para
entender qué estás viendo.
