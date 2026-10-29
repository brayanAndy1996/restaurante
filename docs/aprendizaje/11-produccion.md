# Módulo 11. Producción: cómo se verá el sistema en internet

Todo lo de este módulo está **planeado**, no construido todavía. Hoy el sistema corre solo en local.
El detalle y los costos están en la sección "Infraestructura y costos" del documento de diseño.

## Local frente a producción

| Pieza             | En tu computadora (hoy)              | En producción (planeado)                                  |
| ----------------- | ------------------------------------ | --------------------------------------------------------- |
| Base de datos     | PostgreSQL en Docker                 | PostgreSQL administrado de DigitalOcean, con respaldos    |
| API               | `pnpm dev`, con Node                 | Contenedor de Docker en un servidor (VPS) de DigitalOcean |
| App del personal  | Vite en http://localhost:5173        | Archivos estáticos en Cloudflare Pages                    |
| Fotos de la carta | Carpeta `archivos/` del proyecto     | Cloudflare R2                                             |
| Dirección         | `localhost`                          | Un dominio propio, con HTTPS                              |
| Configuración     | Archivo `.env` con valores de prueba | Secretos guardados en GitHub y en el servidor             |

## Los servicios y qué hace cada uno

- **VPS (servidor privado virtual):** una computadora en la nube, alquilada por mes. Corre la API en
  Docker. Aquí Docker sí empaqueta la API: el mismo contenedor que se prueba es el que se publica.
- **PostgreSQL administrado:** la base de datos la mantiene el proveedor: actualizaciones, respaldos
  diarios y la posibilidad de volver a cualquier momento de los últimos 7 días.
- **Cloudflare:** se pone delante del servidor. Da el HTTPS (necesario para instalar la PWA), acelera
  la carga desde cualquier lugar y protege contra ataques.
- **Cloudflare R2:** guarda archivos, como las fotos de la carta y los comprobantes. El código ya está
  preparado: `ARCHIVOS_DRIVER=r2` en producción (`apps/api/src/nucleo/archivos/almacen-r2.ts`).
- **GitHub Actions:** además de las pruebas, publicará la nueva versión automáticamente cuando un
  cambio llegue a `main` con la CI en verde.

## Lo que cambia en la configuración

Varias variables del `.env` tienen valores de desarrollo que en producción son obligatorias y
secretas. Por ejemplo:

- `NODE_ENV=production`.
- `PIN_PEPPER`: un secreto propio para calcular las huellas de los PIN. Si cambia, todos los PIN
  dejan de valer.
- Las contraseñas de los tres roles de la base.
- `ORIGENES_PERMITIDOS`: el dominio real de la app.

La API se niega a arrancar en producción si falta alguna de ellas o si queda activada una opción
que solo es para pruebas. Es una protección a propósito.

## Lo que harás tú cuando llegue el momento

Claude prepara Docker, el servidor y el despliegue automático. Lo que requiere tu identidad o tu
tarjeta lo harás tú, con una guía paso a paso:

1. Crear las cuentas de DigitalOcean y Cloudflare, y comprar el dominio.
2. Crear los tokens de acceso y guardarlos como secretos en GitHub.

## Para profundizar

- [Qué es un VPS (DigitalOcean)](https://www.digitalocean.com/resources/articles/what-is-vps)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
