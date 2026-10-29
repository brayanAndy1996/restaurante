# Glosario

Las palabras técnicas que aparecen en el proyecto, en una o dos líneas. El número indica el módulo
donde se explica con más detalle.

| Término                       | Qué significa                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| API                           | Programa que recibe pedidos por HTTP y responde con datos. Aquí, `apps/api` (6)                            |
| Auditoría                     | Registro que no se puede modificar de quién hizo qué y cuándo                                              |
| Backend / Frontend            | La parte que corre en el servidor (API y base) / la que ve y toca el usuario (la app)                      |
| Base de datos relacional      | Datos guardados en tablas relacionadas entre sí. Aquí, PostgreSQL (5)                                      |
| Build / compilar              | Convertir el código fuente en archivos listos para ejecutar o publicar (3, 4)                              |
| CI (integración continua)     | Revisión automática de cada cambio en GitHub: formato, tipos y pruebas (10)                                |
| Commit                        | Un cambio guardado en Git, con su mensaje (10)                                                             |
| Componente                    | Una pieza reutilizable de la interfaz en React (8)                                                         |
| Contenedor                    | Un programa ejecutándose aislado dentro de Docker, a partir de una imagen (2)                              |
| Contrato                      | La forma exacta de los datos que viajan entre la app y la API, descrita con zod (7)                        |
| CORS                          | Regla del navegador que limita qué páginas pueden llamar a una API. Se configura con `ORIGENES_PERMITIDOS` |
| Decorador                     | Etiqueta con `@` que da instrucciones al framework, como `@Get()` o `@Permiso(...)` (6)                    |
| Dependencia / paquete         | Código de terceros que usa el proyecto, instalado en `node_modules` (3)                                    |
| Docker Compose                | Archivo y comando para describir y levantar contenedores (`docker-compose.yml`) (2)                        |
| E2E (de punta a punta)        | Prueba que usa la app en un navegador real, contra la API y la base (9)                                    |
| Endpoint / ruta               | Una dirección de la API, como `GET /health` (6)                                                            |
| Especificación (spec)         | Documento en `specs/` que dice qué debe hacer una historia y cómo se comprueba (9)                         |
| `.env` / variables de entorno | Archivo con la configuración local: conexiones, puertos, secretos de desarrollo (11)                       |
| Guard                         | Pieza de NestJS que decide si una petición puede pasar (6)                                                 |
| Hash / huella                 | Transformación de un dato (como un PIN) que no se puede revertir. Se guarda la huella, nunca el PIN        |
| Healthcheck                   | Comprobación periódica de que un servicio está vivo. Ver `/health` y `docker-compose.yml` (2, 6)           |
| HTTP / HTTPS                  | El protocolo de la web. HTTPS es la versión cifrada (6, 11)                                                |
| Idempotencia                  | Repetir una operación no repite su efecto: dos clics en "Guardar" crean una sola cosa (6, 8)               |
| Imagen (Docker)               | Plantilla de solo lectura con un programa ya instalado, como `postgres:16` (2)                             |
| JSON                          | Formato de texto para intercambiar datos: `{"nombre": "Cocina"}` (6)                                       |
| Lint / ESLint                 | Revisión automática del código en busca de errores y malas prácticas (4)                                   |
| Migración                     | Archivo que cambia la estructura de la base de datos, aplicado en orden (5)                                |
| Monorepo                      | Un repositorio con varios proyectos relacionados (3)                                                       |
| Multitenant                   | Un solo sistema que atiende a muchas empresas, cada una con sus datos aislados (5)                         |
| Node.js                       | Programa que ejecuta JavaScript fuera del navegador (3)                                                    |
| ORM                           | Librería que conecta el código con la base de datos. Aquí, Sequelize (6)                                   |
| pnpm / corepack               | Gestor de paquetes del proyecto / herramienta que lo instala en la versión correcta (3)                    |
| Pool de conexiones            | Grupo de conexiones a la base que la API reutiliza entre peticiones                                        |
| Puerto                        | Número por el que se accede a un programa: 3000 la API, 5173 la app, 5433 la base (2)                      |
| PWA                           | Página web que se instala y funciona como una aplicación (8)                                               |
| Rama (branch)                 | Línea de trabajo paralela en Git. `main` tiene lo aprobado (10)                                            |
| RLS                           | Row Level Security: la base solo deja ver y cambiar las filas de la empresa de la sesión (5)               |
| Rol (de base de datos)        | Usuario de PostgreSQL con permisos acotados: migrador, API y plataforma (5)                                |
| Ruta crítica                  | Las funciones donde un error cuesta dinero, problemas legales o filtración de datos (9)                    |
| Script (de pnpm)              | Comando con nombre definido en `package.json`, como `pnpm dev` (3)                                         |
| Semilla (seed)                | Datos de demostración que se cargan en la base (`pnpm db:semilla`) (0)                                     |
| Service                       | Pieza de NestJS con la lógica de negocio de un módulo (6)                                                  |
| Service worker                | Programa que el navegador corre en segundo plano para que la PWA cargue rápido y se actualice (8)          |
| TDD                           | Escribir las pruebas antes que el código (9)                                                               |
| Transacción                   | Grupo de operaciones en la base que se guardan todas o ninguna (5)                                         |
| Turborepo                     | Coordina las tareas de todos los proyectos del monorepo, en orden y con caché (3)                          |
| TypeScript                    | JavaScript con tipos, revisados antes de ejecutar (4)                                                      |
| Vite                          | Servidor de desarrollo y empaquetador de la app del personal (8)                                           |
| Volumen                       | Carpeta de Docker que conserva los datos aunque se elimine el contenedor (2)                               |
| VPS                           | Servidor virtual alquilado en la nube (11)                                                                 |
| zod                           | Librería para describir y validar la forma de los datos (7)                                                |
