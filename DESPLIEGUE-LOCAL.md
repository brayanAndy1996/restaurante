# Cómo levantar el sistema en tu computadora

Esta guía deja funcionando en tu computadora la versión de la rama `main`. En `main` solo entran las
secciones ya aprobadas y cerradas. Hoy son:

- **Sección 1, Plataforma y acceso:** empresas, sucursales, usuarios por rol, ingreso con contraseña
  y con PIN, equipos recordados, horario de acceso, clave de supervisor y auditoría.
- **Sección 2, Carta:** estaciones, familias, productos, fotos, modificadores, combos, menú del día,
  precio y disponibilidad por sucursal, y agotados.
- **Sección 3a, Salón y Cocina:** mapa de mesas, abrir mesa, comandero, envío a cocina por estación,
  tiempos 1 y 2, pantalla de cocina (KDS) con avisos de "Listo", anulaciones con clave, mover y unir
  mesas, y pre-cuenta en pantalla, todo en tiempo real.

Las secciones siguientes (impresión, caja, etc.) se trabajan en otra rama y llegan a `main` cuando se
aprueban.

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
   inactividad, también el de Cocina y Barra.
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

#### Salón y cocina (sección 3a)

Hazlo después del paso 4, porque la comanda necesita productos y estaciones.

1. **Mapa de mesas.** Como `fogon.admin`, en _Ajustes › Mapa de mesas_, crea una zona (por ejemplo, Salón) y tres mesas: toca una celda para crear una mesa y dale nombre, capacidad y forma.
2. **Abrir una mesa.** Entra como `fogon.mozo`. Si te pide la sucursal, elige _El Fogón · Miraflores_. En _Salón_, toca una mesa libre y ábrela con sus comensales.
3. **Comandar.** En la mesa, agrega un combo y un lomo en segundo tiempo, y pulsa _Enviar_.
4. **Ver la comanda en la cocina.** Abre otra ventana (otro navegador o una ventana privada) y entra a `/cocina` como `fogon.cocina`, o como otro usuario de Cocina/Barra. El horario de `fogon.cocina` es de ejemplo: de 11:00 a 23:00, hora de Lima; fuera de él no puede ingresar. La comanda aparece sin recargar.
5. **Marchar.** Vuelve al celular del mozo y pulsa _Marchar_ para mandar el segundo tiempo a la cocina.
6. **Marcar listo.** En la cocina, pasa cada línea a _Preparando_ y luego a _Listo_, o usa _Todo listo_. El mozo recibe el aviso en el salón.
7. **Pre-cuenta.** Pide la pre-cuenta: la mesa pasa a _Pre-cuenta_. Si después agregas otra adición, la pre-cuenta deja de valer y hay que pedir otra.
8. **Anular con la clave del supervisor.** Anula un ítem, o una parte de él (1 de 2 unidades). La app pide la clave de supervisor: ingresa el PIN de `fogon.supervisor`. Queda registrado quién pidió la anulación y quién la autorizó, y la cocina la ve.
9. **Mover y unir.** En la cuenta, usa _Mover la cuenta_ para llevarla a otra mesa libre, o _Unir mesas_ para juntar otra mesa a la cuenta.

Las fotos de la carta se guardan en la carpeta `archivos/` del proyecto.

#### Impresión sin un Android (sección 3b)

La app del puente (Android) llega en la entrega 3c. Mientras tanto puedes probar la impresión con un puente de mentira que corre en tu computadora y una impresora falsa que muestra los tickets en la consola.

1. **Crea la impresora apuntando al emulador.** Como `fogon.admin`, en _Ajustes › Impresión_, crea una impresora de red con host `127.0.0.1` y puerto `9100`. Elígela como destino de la estación Cocina (y, si quieres, como impresora de caja).
2. **Copia el texto del QR.** En _Ajustes › Impresión_, pulsa _Vincular puente_ y copia el texto del código (empieza con `restaurante-puente://vincular?…`). Sirve una sola vez y dura 10 minutos.
3. **Vincula el simulador.** En una terminal nueva, dentro de la carpeta del proyecto, pega el texto entre comillas:

   ```
   pnpm puente:simular --emulador --qr "restaurante-puente://vincular?api=…&t=vi.…"
   ```

   La consola dice que el puente está conectado y que espera trabajos. Déjala abierta.

4. **Ver los tickets.** Pide la _página de prueba_ de la impresora, o comanda como `fogon.mozo` (paso 3 del recorrido de arriba): el ticket aparece en la consola como texto, tal como saldría en el papel. Ctrl+C detiene el puente; para volver a conectarlo sin pedir otro código, corre `pnpm puente:simular --emulador`.

Si el texto del QR trae una dirección que tu computadora no alcanza, agrega `--api http://localhost:3000`. Más opciones: `pnpm puente:simular --ayuda`.

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

| Problema                                                                                | Qué hacer                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker: command not found`, o `local:preparar` no conecta con Docker                   | Abre Docker Desktop y espera a que diga que está en marcha. Luego repite el comando                                                                                                                                              |
| El puerto 5433, 3000 o 5173 ya está en uso                                              | Cierra el programa que lo usa, o cambia el puerto en `.env`: para la base, `DB_PUERTO_LOCAL` y las URL (ver `.env.example`)                                                                                                      |
| `node --version` muestra una versión menor que 22                                       | Instala Node 22 o superior                                                                                                                                                                                                       |
| La app dice "No hay conexión con el servidor"                                           | Revisa que `pnpm dev` siga corriendo y que http://localhost:3000/health responda                                                                                                                                                 |
| Perdiste los PIN de demostración                                                        | Borra la base y vuelve a crearla: `docker compose down -v` y luego `pnpm local:preparar`                                                                                                                                         |
| La app muestra "useSesion debe usarse dentro de SesionProvider"                         | Pasa a veces tras recompilar los paquetes: detén `pnpm dev` y vuelve a arrancarlo                                                                                                                                                |
| La API no arranca: «DATABASE_TIEMPO_REAL_URL es obligatoria con TIEMPO_REAL=habilitado» | Tu `.env` es anterior a la sección 3a. Copia desde `.env.example` `DB_PASSWORD_TIEMPO_REAL`, `DATABASE_TIEMPO_REAL_URL` y `TIEMPO_REAL=habilitado`, y luego ejecuta `pnpm local:preparar` (crea el rol y aplica las migraciones) |
| El KDS o el salón no se actualizan solos                                                | Deja la pantalla en primer plano: en un iPad o una tableta, el navegador en segundo plano corta la conexión. Sin conexión, la pantalla se refresca cada 30 segundos                                                              |
| Una cuenta quedó bloqueada por 5 intentos fallidos                                      | Espera 15 minutos o, si es el superadministrador, `pnpm plataforma:superadmin desbloquear superadmin`                                                                                                                            |

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
| `pnpm puente:simular --qr "…"`       | Puente de impresión de mentira para probar la impresión sin Android (ver «Impresión sin un Android»)                         |
| `pnpm test`                          | Corre todas las pruebas automáticas; tarda varios minutos (ver la sección "Pruebas" del `README.md`)                         |
| `pnpm --filter @restaurante/app e2e` | Pruebas de punta a punta en el navegador (la primera vez: `pnpm --filter @restaurante/app exec playwright install chromium`) |
| `docker compose stop`                | Detiene PostgreSQL sin borrar los datos                                                                                      |
| `docker compose down -v`             | Detiene PostgreSQL y borra la base                                                                                           |

El `README.md` tiene los detalles técnicos: variables de entorno, producción, PostgreSQL
administrado y la arquitectura.
