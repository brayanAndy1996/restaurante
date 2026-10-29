# Módulo 1. El mapa del proyecto

Antes de ver cada tecnología, conviene saber qué hace cada pieza y cómo se hablan entre sí.

## Las piezas y cómo se comunican

```
  Celular o tablet del personal
  ┌──────────────────────────────┐
  │ App del personal (PWA)       │  React + Vite        apps/app
  └──────────────┬───────────────┘
                 │  peticiones HTTP (JSON)
                 ▼
  ┌──────────────────────────────┐
  │ API                          │  NestJS + Sequelize  apps/api
  └──────────────┬───────────────┘
                 │  consultas SQL
                 ▼
  ┌──────────────────────────────┐
  │ Base de datos                │  PostgreSQL 16       (en Docker, en local)
  └──────────────────────────────┘

  Código compartido por la app y la API:
  packages/dominio (reglas de negocio) · packages/contratos (formato de los datos)
  packages/ui (estilos y componentes) · packages/config (configuración común)
```

Una forma simple de entenderlo es un restaurante:

- La **app** es el mozo: atiende a la persona, toma lo que pide y lo lleva a cocina.
- La **API** es la cocina: recibe el pedido, revisa que sea válido (¿hay stock?, ¿este usuario puede
  hacer esto?) y lo prepara.
- La **base de datos** es la despensa y el libro de registros: guarda todo de forma ordenada y
  permanente.
- El **código compartido** es el recetario: el mozo y la cocina usan las mismas recetas, así nunca
  calculan distinto un precio.

## Qué hay en cada carpeta

| Carpeta                     | Qué contiene                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/api/`                 | La API. `src/modulos/` tiene un módulo por área del negocio (plataforma, seguridad, carta…) |
| `apps/api/src/migraciones/` | Los cambios a la estructura de la base de datos, en orden de fecha                          |
| `apps/api/test/`            | Las pruebas automáticas de la API                                                           |
| `apps/app/`                 | La app del personal. `src/modulos/` tiene una carpeta por pantalla o grupo de pantallas     |
| `apps/app/e2e/`             | Pruebas que abren un navegador de verdad y usan la app como lo haría una persona            |
| `packages/dominio/`         | Reglas de negocio puras: validar un RUC, calcular el día operativo, permisos…               |
| `packages/contratos/`       | La forma exacta de los datos que viajan entre la app y la API                               |
| `packages/ui/`              | Colores, tipografías y componentes visuales reutilizables                                   |
| `packages/config/`          | Configuración común de TypeScript, ESLint y Prettier                                        |
| `specs/`                    | Las especificaciones de cada historia: qué se pidió, cómo se hizo y sus tareas              |
| `.claude/agents/`           | Las instrucciones de cada rol de Claude (especificador, backend, tester…)                   |
| `.github/workflows/`        | La integración continua: lo que GitHub revisa en cada cambio                                |
| `docker-compose.yml`        | La receta para levantar PostgreSQL con Docker                                               |
| `prototipo/`, `diseno/`     | Prototipos visuales y alternativas de diseño de la interfaz                                 |
| `PRODUCT.md`, `DESIGN.md`   | Contexto del producto y sistema de diseño, que usa la skill de diseño de la interfaz        |

## Qué existe hoy y qué llegará

| Pieza                                       | Estado                                                |
| ------------------------------------------- | ----------------------------------------------------- |
| API, app del personal, base de datos        | Existe (secciones 1 y 2: plataforma, acceso y carta)  |
| Carta web pública y web comercial (Next.js) | Planeada (`apps/web`)                                 |
| Puente de impresión Android (Kotlin)        | Planeado (`apps/puente-android`)                      |
| Worker y colas de tareas (pg-boss)          | Planeados                                             |
| Tiempo real (WebSockets)                    | Planeado; hoy hay un publicador de eventos en memoria |
| Servidores en internet (DigitalOcean)       | Planeados; hoy todo corre en local                    |

## El viaje de una acción, de punta a punta

Tomemos "el Administrador crea una estación de producción llamada Cocina":

1. En la app, el Administrador llena el formulario y pulsa "Guardar".
2. La app envía una petición `POST /carta/estaciones` a la API, con los datos en formato JSON.
3. La API (`apps/api/src/modulos/carta/estaciones.controller.ts`) comprueba que:
   - la sesión sea válida y el usuario tenga el permiso `ADMINISTRAR`;
   - los datos tengan la forma correcta, usando el contrato de `packages/contratos`.
4. La API abre una transacción en PostgreSQL con la empresa del usuario fijada. La base de datos solo
   deja leer y escribir filas de esa empresa (es la "RLS", módulo 5).
5. Se guarda la estación y la API responde con los datos creados.
6. La app muestra la estación nueva en la lista.

Cada módulo del curso explica uno de estos pasos con más detalle.
