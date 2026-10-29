# Módulo 6. La API: HTTP, NestJS y Sequelize

## Qué es una API

Una **API** es un programa que recibe pedidos y responde con datos. La app del personal no toca la
base de datos: le pide todo a la API, que decide si el pedido es válido y quién puede hacerlo.

Se comunican por **HTTP**, el mismo protocolo de las páginas web. Cada pedido tiene:

| Parte     | Ejemplo                          | Significado                                  |
| --------- | -------------------------------- | -------------------------------------------- |
| Método    | `GET`, `POST`, `PATCH`, `DELETE` | Leer, crear, modificar, borrar               |
| Ruta      | `/carta/estaciones`              | Sobre qué recurso                            |
| Cuerpo    | `{"nombre": "Cocina"}`           | Los datos que se envían, en formato **JSON** |
| Respuesta | `201` y los datos creados        | Un código de estado y, casi siempre, JSON    |

Códigos de estado que verás: `200` (bien), `201` (creado), `400` (datos inválidos), `401` (no has
iniciado sesión), `403` (no tienes permiso), `404` (no existe), `409` (conflicto, por ejemplo un nombre
repetido) y `503` (el servicio no está disponible).

## Qué es NestJS

**NestJS** es un framework para construir APIs con Node y TypeScript. Da una estructura fija, lo que
ayuda mucho en un sistema grande con muchos módulos: cada cosa tiene su lugar.

## Las piezas de NestJS

| Pieza                         | Qué hace                                                                     | Ejemplo en el proyecto                                        |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Módulo**                    | Agrupa todo lo de un área del negocio                                        | `apps/api/src/modulos/carta/carta.module.ts`                  |
| **Controller**                | Recibe las peticiones HTTP de unas rutas y devuelve la respuesta             | `estaciones.controller.ts` atiende `/carta/estaciones`        |
| **Service**                   | Contiene la lógica: validar, consultar la base, guardar                      | `estaciones.service.ts`                                       |
| **Decorador**                 | Una etiqueta con `@` que le da instrucciones a Nest                          | `@Get()`, `@Post()`, `@Permiso('ADMINISTRAR')`                |
| **Guard**                     | Decide si la petición puede pasar, antes de llegar al controller             | `modulos/seguridad/autenticacion.guard.ts` revisa la sesión   |
| **Interceptor**               | Envuelve la petición: hace algo antes y después                              | `nucleo/contexto-empresa/` abre la transacción con la empresa |
| **Pipe**                      | Valida y transforma los datos que llegan                                     | `PipeZod` valida el cuerpo con el contrato de zod (módulo 7)  |
| **Inyección de dependencias** | Nest crea los services y se los entrega a quien los pide en su `constructor` | El controller recibe `EstacionesService` sin crearlo a mano   |

Una versión simplificada de un controller real, `apps/api/src/modulos/carta/estaciones.controller.ts`:

```ts
@Controller('carta/estaciones') // atiende las rutas /carta/estaciones
export class EstacionesController {
  constructor(private readonly estaciones: EstacionesService) {} // Nest le entrega el service

  @Get() // GET /carta/estaciones
  @Permiso('EDITAR_CARTA') // solo quien tenga este permiso
  listar() {
    return this.estaciones.listar();
  }

  @Post() // POST /carta/estaciones
  @Idempotente() // si llega dos veces, no crea dos
  @Permiso('ADMINISTRAR')
  crear(@Body(new PipeZod(estacionEntradaSchema)) entrada: EstacionEntrada) {
    return this.estaciones.crear(entrada); // el cuerpo ya viene validado
  }
}
```

## El recorrido de una petición

```
Petición HTTP
  → Guard de autenticación: ¿hay una sesión válida? ¿la ruta es pública?
  → Interceptores: fijan quién es el usuario y abren la transacción con su empresa (RLS)
  → Permisos: ¿su rol tiene el permiso que pide @Permiso(...)?
  → Pipe: ¿el cuerpo cumple el contrato de zod?
  → Controller → Service → base de datos
  → Respuesta (y, si algo falló, el filtro global de errores la convierte en un error claro)
```

## Sequelize

**Sequelize** es una librería que conecta Node con PostgreSQL. En este proyecto se usa sobre todo para
manejar las conexiones y las transacciones, y para ejecutar SQL con parámetros. Los services suelen
escribir sus consultas en SQL directamente, como `estaciones.service.ts`.

Hay una conexión por rol de la base (módulo 5): la de la API (`CONEXION_API`) y la de plataforma, en
`apps/api/src/nucleo/base-de-datos/`.

## Otras carpetas de la API

| Carpeta        | Qué contiene                                                                        |
| -------------- | ----------------------------------------------------------------------------------- |
| `src/nucleo/`  | Lo transversal: base de datos, contexto de empresa, errores, idempotencia, archivos |
| `src/modulos/` | Un módulo por área: `plataforma`, `seguridad`, `auditoria`, `carta`, `salud`        |
| `src/config/`  | Lectura y validación de las variables del archivo `.env`                            |
| `scripts/`     | Los comandos `db:preparar`, `db:migrar`, `db:semilla` y del superadministrador      |

## Práctica (10 minutos)

1. Con `pnpm dev` corriendo, abre http://localhost:3000/health. Busca en el código qué lo responde:
   `apps/api/src/modulos/salud/salud.controller.ts`. Fíjate en `@Publica()`: es la única forma de que
   una ruta no exija sesión.
2. Abre http://localhost:3000/carta/estaciones directamente en el navegador. Responde `401`: no hay
   sesión. Esa respuesta la dio el guard de autenticación, sin llegar al controller.
3. En la app, entra como `fogon.admin` y crea una estación. Con `F12`, pestaña **Red** (Network),
   busca la petición `estaciones`: verás el método `POST`, el cuerpo enviado y la respuesta `201`.

## Para profundizar

- [Primeros pasos con NestJS](https://docs.nestjs.com/first-steps)
- [Controllers](https://docs.nestjs.com/controllers), [Guards](https://docs.nestjs.com/guards) e
  [Interceptors](https://docs.nestjs.com/interceptors) en la documentación oficial
- [Qué es HTTP (MDN)](https://developer.mozilla.org/es/docs/Web/HTTP/Overview)
