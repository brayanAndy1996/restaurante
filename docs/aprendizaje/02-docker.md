# Módulo 2. Docker

## Qué es

Docker es un programa que ejecuta otros programas dentro de **contenedores**: cajas aisladas que
traen todo lo que el programa necesita para funcionar (el programa, sus librerías y su
configuración), sin instalarlo en tu computadora.

Una analogía: en lugar de construir una cocina en tu casa para preparar un plato, recibes una cocina
portátil ya armada, con sus utensilios dentro. La usas, y si ya no la quieres, la retiras sin dejar
rastro en tu casa.

## Para qué sirve

- **Mismo entorno para todos.** Tu PostgreSQL es exactamente la versión 16, igual que el de los demás
  desarrolladores y el de la integración continua. Se acaba el "en mi máquina funciona".
- **Nada que instalar ni configurar a mano.** Instalar PostgreSQL en Windows implica asistentes,
  servicios y contraseñas. Con Docker es un comando.
- **Fácil de borrar y empezar de cero.** `docker compose down -v` deja todo como si nunca hubiera
  existido.
- **En producción**, el mismo concepto sirve para empaquetar la API y correrla igual en cualquier
  servidor.

## Los cuatro conceptos que necesitas

| Concepto       | Qué es                                                                                                                    | En este proyecto                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Imagen**     | La "plantilla" de solo lectura: el programa ya instalado y listo. Se descarga una vez                                     | `postgres:16`, la imagen oficial de PostgreSQL 16 |
| **Contenedor** | Una imagen en ejecución. Puede haber varios contenedores de la misma imagen                                               | `restaurante-postgres-1`                          |
| **Volumen**    | Una carpeta que guarda datos fuera del contenedor, para que no se pierdan al apagarlo                                     | `postgres_datos`, donde viven tus tablas y filas  |
| **Puerto**     | El "número de puerta" por donde se entra a un programa. Docker conecta un puerto de tu computadora con uno del contenedor | El `5433` de tu PC lleva al `5432` del contenedor |

## Cómo se usa en este proyecto

Hoy Docker se usa **solo para la base de datos en local**. La API y la app corren directamente con
Node (módulo 3).

La receta está en `docker-compose.yml`, en la raíz. Docker Compose sirve para describir uno o varios
contenedores en un archivo, en lugar de escribir comandos largos. Línea por línea:

```yaml
services: # los contenedores que forman el proyecto
  postgres: # un servicio llamado "postgres"
    image: postgres:16 # usa la imagen oficial de PostgreSQL 16
    restart: unless-stopped # arranca solo al abrir Docker, salvo que lo hayas detenido tú
    environment: # variables de configuración del contenedor
      POSTGRES_USER: postgres # usuario administrador de la base
      POSTGRES_PASSWORD: postgres # su contraseña (solo para desarrollo local)
    ports:
      - '5433:5432' # tu puerto 5433 → puerto 5432 del contenedor
    volumes:
      - postgres_datos:/var/lib/postgresql/data # guarda los datos en el volumen
    healthcheck: # cómo saber si PostgreSQL ya está listo
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s

volumes:
  postgres_datos: # declara el volumen
```

¿Por qué el puerto 5433 y no el habitual 5432? Para no chocar con un PostgreSQL que ya tengas
instalado en tu computadora.

`pnpm local:preparar` (archivo `scripts/local-preparar.mjs`) ejecuta `docker compose up -d --wait`:

- `up` crea y arranca los contenedores del archivo.
- `-d` los deja corriendo en segundo plano, para que la terminal quede libre.
- `--wait` espera a que el healthcheck diga que PostgreSQL está listo antes de seguir.

La integración continua de GitHub (módulo 10) hace lo mismo con su propio contenedor `postgres:16`,
para que las pruebas corran contra la misma base que usas tú.

## Comandos que usarás

Todos se ejecutan dentro de la carpeta del proyecto, donde está `docker-compose.yml`.

| Comando                                                        | Qué hace                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docker compose ps`                                            | Muestra los contenedores del proyecto y su estado                  |
| `docker compose stop`                                          | Detiene la base sin borrar nada                                    |
| `docker compose start`                                         | La vuelve a encender                                               |
| `docker compose logs postgres`                                 | Muestra los mensajes de PostgreSQL (útil si algo falla)            |
| `docker compose down`                                          | Elimina el contenedor, pero **conserva** el volumen con los datos  |
| `docker compose down -v`                                       | Elimina el contenedor **y el volumen**: borra la base por completo |
| `docker compose exec postgres psql -U postgres -d restaurante` | Abre una consola de SQL dentro del contenedor (módulo 5)           |

Todo esto también se puede hacer con clics en Docker Desktop: en **Containers** ves el grupo
`restaurante`, con botones para detener, iniciar, ver los registros (Logs) o abrir una terminal
(Exec). En **Volumes** ves `restaurante_postgres_datos` y cuánto pesa.

## Práctica (10 minutos)

1. Con el proyecto levantado, ejecuta `docker compose ps`. Fíjate en la columna `STATUS`: debe decir
   `healthy`.
2. Ejecuta `docker compose stop` y abre http://localhost:3000/health: la base aparece con `error`.
3. Ejecuta `docker compose start`, espera unos segundos y recarga: vuelve a `ok`. Tus datos siguen
   ahí, porque viven en el volumen.
4. En Docker Desktop, abre el contenedor y mira la pestaña **Logs**: son los mismos mensajes que
   `docker compose logs postgres`.

## Errores comunes

- **"Cannot connect to the Docker daemon"**: Docker Desktop no está abierto.
- **"port is already allocated"**: el puerto 5433 está ocupado por otro programa o contenedor.
- **Los datos "desaparecieron"**: probablemente se ejecutó `docker compose down -v`, que borra el
  volumen. Sin `-v`, los datos se conservan.

## Para profundizar

- [Qué es un contenedor (documentación oficial)](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/)
- [Docker Compose, primeros pasos](https://docs.docker.com/compose/gettingstarted/)
- [Imagen oficial de PostgreSQL en Docker Hub](https://hub.docker.com/_/postgres)
