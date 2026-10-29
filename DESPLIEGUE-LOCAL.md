# Cómo levantar el sistema en tu computadora

Esta guía deja funcionando en tu computadora la versión de la rama `main`. En `main` solo entran las
secciones ya aprobadas y cerradas. Hoy son:

- **Sección 1, Plataforma y acceso:** empresas, sucursales, usuarios por rol, ingreso con contraseña
  y con PIN, equipos recordados, horario de acceso, clave de supervisor y auditoría.
- **Sección 2, Carta:** estaciones, familias, productos, fotos, modificadores, combos, menú del día,
  precio y disponibilidad por sucursal, y agotados.

Las secciones siguientes (Salón y Cocina, Caja, etc.) se trabajan en otra rama y llegan a `main`
cuando se aprueban.

## 1. Lo que necesitas instalar

| Programa                                                          | Versión             | Para qué                                            |
| ----------------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| [Git](https://git-scm.com/downloads)                              | cualquiera reciente | Descargar el código                                 |
| [Node.js](https://nodejs.org/)                                    | 22 o superior       | Correr la API y la app                              |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | cualquiera reciente | La base de datos PostgreSQL 16, con un solo comando |

pnpm no hace falta instalarlo aparte: viene con Node y se activa con `corepack` (paso 2).

Si prefieres no usar Docker, mira la sección 6, "Sin Docker".

Comprueba lo instalado en una terminal (en Windows, PowerShell o Git Bash):

```bash
git --version
node --version     # debe decir v22.x o superior
docker --version
```

Docker Desktop tiene que estar **abierto** (en marcha) antes del paso 3.

## 2. Descargar el código e instalar dependencias

```bash
git clone https://github.com/brayanAndy1996/restaurante.git
cd restaurante
git checkout main
corepack enable                     # activa pnpm con la versión del proyecto
pnpm install --frozen-lockfile      # instala las dependencias (tarda unos minutos la primera vez)
```

Si `corepack enable` falla por permisos, en Windows abre la terminal "como administrador". En Mac o
Linux, antepón `sudo`.

## 3. Preparar la base de datos y los datos de demostración

```bash
pnpm local:preparar
```

Este comando hace todo por ti:

1. Crea el archivo `.env` a partir de `.env.example`, con las variables de desarrollo.
2. Levanta PostgreSQL 16 en Docker, en el **puerto 5433** para no chocar con otro PostgreSQL que
   tengas instalado.
3. Crea los roles y la base `restaurante`, y aplica las migraciones.
4. Carga los datos de demostración: un superadministrador y dos empresas con un usuario por rol.

Al final, **la terminal imprime los PIN** de los usuarios de demostración. Cópialos, porque solo se
muestran esta vez. Si los pierdes, mira la sección 7.

Puedes repetir el comando cuando quieras: no duplica nada.

## 4. Arrancar

```bash
pnpm dev
```

Arranca dos cosas:

- La **API** en http://localhost:3000. Para comprobarla, abre http://localhost:3000/health en el
  navegador; debe responder `ok`.
- La **app del personal** en http://localhost:5173.

Para detener todo, `Ctrl + C` en esa terminal. La base de datos sigue en Docker y conserva los datos.

## 5. Probarlo

Abre http://localhost:5173. Es una app pensada para celular: en la computadora puedes verla en la
vista de celular del navegador (en Chrome, `F12` y luego el ícono del celular, o `Ctrl + Shift + M`).

### Usuarios de demostración

Todos empiezan con la contraseña temporal `Temporal-Demo-1`, y la app te pide cambiarla la primera
vez.

| Usuario            | Empresa  | Rol                                                |
| ------------------ | -------- | -------------------------------------------------- |
| `fogon.admin`      | El Fogón | Administrador                                      |
| `fogon.supervisor` | El Fogón | Supervisor                                         |
| `fogon.cajero`     | El Fogón | Cajero                                             |
| `fogon.mozo`       | El Fogón | Mozo                                               |
| `fogon.cocina`     | El Fogón | Cocina/Barra (con un horario de acceso de ejemplo) |
| `marea.admin`      | La Marea | Administrador                                      |
| `marea.cajero`     | La Marea | Cajero                                             |
| `marea.mozo`       | La Marea | Mozo                                               |

El panel de nuestro equipo (superadministrador) está en http://localhost:5173/plataforma/ingreso,
con el usuario `superadmin` y la contraseña `Superadmin-Demo-1`.

### Un recorrido sugerido

1. **Ingreso y PIN.** Entra como `fogon.admin`, cambia la contraseña y acepta que el equipo te
   recuerde. Cierra la sesión: la próxima vez basta el PIN.
2. **Otra persona en el mismo equipo.** Desde la pantalla de PIN, agrega a `fogon.mozo`. Luego cambia
   de usuario con el PIN, sin escribir contraseñas.
3. **Usuarios y acceso.** Como Administrador, en _Usuarios_, crea un trabajador, dale un rol y un
   horario, y revisa sus equipos recordados. En _Acceso_, cambia los minutos de cierre por
   inactividad.
4. **Carta.** Como Administrador:
   - crea las estaciones (por ejemplo, Cocina y Barra), las familias y algunos productos con foto;
   - arma un grupo de modificadores ("Término de la carne") y un combo;
   - cambia el precio de un producto solo en una sucursal.

   La base empieza **sin carta**, así que esto es lo primero que tienes que crear.

5. **Menú del día y agotados.** Como `fogon.cocina` (dentro de su horario) o como Administrador:
   - en _Disponibilidad_, arma el menú de hoy;
   - marca un plato como agotado y comprueba que aparece agotado en la carta.
6. **Clave de supervisor.** Cuando una acción pide la clave, el PIN de `fogon.supervisor` la
   autoriza, y queda registrado quién pidió y quién autorizó.
7. **Aislamiento.** Entra como `marea.admin`: no debe ver nada de El Fogón.
8. **Plataforma.** Como `superadmin`, crea una empresa nueva (su primer Administrador recibe un PIN
   que se muestra una sola vez) y abre una sesión de soporte, que queda auditada.

Las fotos de la carta se guardan en la carpeta `archivos/` del proyecto.

### Probar desde tu celular (opcional)

Tu celular tiene que estar en la misma red Wi-Fi que la computadora.

1. Averigua la IP de tu computadora en la red. En Windows: `ipconfig`, línea "Dirección IPv4". En
   Mac: `ipconfig getifaddr en0`. Por ejemplo, `192.168.1.20`.
2. En el archivo `.env`, cambia (o agrega) estas dos líneas con tu IP:

   ```
   ORIGENES_PERMITIDOS=http://localhost:5173,http://192.168.1.20:5173
   VITE_API_URL=http://192.168.1.20:3000
   ```

3. Vuelve a arrancar con `pnpm dev` y abre `http://192.168.1.20:5173` en el celular.

Si el firewall de la computadora pregunta, permite las conexiones de Node en la red privada. Sin
HTTPS, el celular no instala la app como aplicación, pero sí la puedes usar desde el navegador.

## 6. Sin Docker (con un PostgreSQL 16 propio)

Necesitas un usuario administrador de PostgreSQL que pueda crear roles y bases (por ejemplo, el
usuario `postgres`).

1. Copia `.env.example` a `.env`.
2. En `.env`, cambia el puerto `5433` por el de tu PostgreSQL (normalmente `5432`) en todas las URL,
   y pon la contraseña de tu usuario administrador en `DATABASE_ADMIN_URL`.
3. Ejecuta:

   ```bash
   pnpm db:preparar     # roles y base `restaurante`
   pnpm db:migrar       # tablas
   pnpm db:semilla      # datos de demostración (imprime los PIN)
   pnpm dev
   ```

## 7. Problemas frecuentes

| Problema                                                              | Qué hacer                                                                                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `docker: command not found`, o `local:preparar` no conecta con Docker | Abre Docker Desktop y espera a que diga que está en marcha. Luego repite el comando                                                |
| El puerto 5433, 3000 o 5173 ya está en uso                            | Cierra el programa que lo usa, o cambia el puerto en `.env`: para la base, `DB_PUERTO_LOCAL` y las cuatro URL (ver `.env.example`) |
| `node --version` muestra una versión menor que 22                     | Instala Node 22 o superior                                                                                                         |
| La app dice "No hay conexión con el servidor"                         | Revisa que `pnpm dev` siga corriendo y que http://localhost:3000/health responda                                                   |
| Perdiste los PIN de demostración                                      | Borra la base y vuelve a crearla: `docker compose down -v` y luego `pnpm local:preparar`                                           |
| La app muestra "useSesion debe usarse dentro de SesionProvider"       | Pasa a veces tras recompilar los paquetes: detén `pnpm dev` y vuelve a arrancarlo                                                  |
| Una cuenta quedó bloqueada por 5 intentos fallidos                    | Espera 15 minutos o, si es el superadministrador, `pnpm plataforma:superadmin desbloquear superadmin`                              |

## 8. Empezar de cero

Para borrar la base de datos y los datos de demostración:

```bash
docker compose down -v
pnpm local:preparar
```

## 9. Comandos útiles

| Comando                              | Qué hace                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                           | Arranca la API y la app                                                                                                      |
| `pnpm local:preparar`                | Prepara la base en Docker con los datos de demostración                                                                      |
| `pnpm test`                          | Corre todas las pruebas automáticas; tarda varios minutos (ver la sección "Pruebas" del `README.md`)                         |
| `pnpm --filter @restaurante/app e2e` | Pruebas de punta a punta en el navegador (la primera vez: `pnpm --filter @restaurante/app exec playwright install chromium`) |
| `docker compose stop`                | Detiene PostgreSQL sin borrar los datos                                                                                      |
| `docker compose down -v`             | Detiene PostgreSQL y borra la base                                                                                           |

El `README.md` tiene los detalles técnicos: variables de entorno, producción, PostgreSQL
administrado y la arquitectura.
