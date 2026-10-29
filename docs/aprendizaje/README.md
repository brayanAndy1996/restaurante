# Aprendizaje: cómo funciona este proyecto

Esta carpeta es para entender el proyecto sin ser experto en cada tecnología. Tiene dos partes:

1. **Un tutorial** para levantar el sistema en tu computadora, paso a paso y sin saber Docker.
2. **Un curso corto** sobre las tecnologías principales: qué son, para qué sirven y dónde se usan en
   este repositorio, con ejemplos de archivos reales.

No reemplaza a la documentación técnica: `DESPLIEGUE-LOCAL.md` (en la raíz) sigue siendo la guía
oficial para levantar el sistema, y `README.md` tiene los detalles técnicos. Esta carpeta explica lo
que esas guías dan por sabido.

## Por dónde empezar

| Orden | Archivo                                                  | Qué aprendes                                                            | Tiempo   |
| ----- | -------------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| 1     | [00-levantar-el-proyecto.md](00-levantar-el-proyecto.md) | Dejar el sistema funcionando en tu computadora, paso a paso             | 45 min   |
| 2     | [01-mapa-del-proyecto.md](01-mapa-del-proyecto.md)       | Cómo encajan todas las piezas y qué hay en cada carpeta                 | 15 min   |
| 3     | [02-docker.md](02-docker.md)                             | Qué es Docker y por qué lo usamos                                       | 30 min   |
| 4     | [03-node-pnpm-turborepo.md](03-node-pnpm-turborepo.md)   | Node.js, pnpm y el monorepo                                             | 25 min   |
| 5     | [04-typescript.md](04-typescript.md)                     | El lenguaje en que está escrito casi todo                               | 25 min   |
| 6     | [05-postgresql.md](05-postgresql.md)                     | La base de datos, las migraciones y el aislamiento entre empresas (RLS) | 40 min   |
| 7     | [06-nestjs-api.md](06-nestjs-api.md)                     | El backend: la API, NestJS y Sequelize                                  | 35 min   |
| 8     | [07-codigo-compartido.md](07-codigo-compartido.md)       | Reglas de negocio y contratos compartidos (zod)                         | 15 min   |
| 9     | [08-react-vite-pwa.md](08-react-vite-pwa.md)             | La app del personal: React, Vite y PWA                                  | 35 min   |
| 10    | [09-pruebas.md](09-pruebas.md)                           | Pruebas automáticas, TDD y pruebas adversariales                        | 25 min   |
| 11    | [10-git-github-ci.md](10-git-github-ci.md)               | Git, ramas, GitHub y la integración continua                            | 25 min   |
| 12    | [11-produccion.md](11-produccion.md)                     | Cómo se verá el sistema en internet (planeado)                          | 15 min   |
| —     | [glosario.md](glosario.md)                               | Las palabras técnicas, explicadas en una línea                          | consulta |

Cada módulo del curso tiene la misma forma: **qué es**, **para qué sirve**, **cómo se usa en este
proyecto** (con archivos reales), **práctica** (algo que puedes hacer en 5 a 10 minutos) y **para
profundizar** (enlaces oficiales).

## Cómo leer el código sin perderte

- No necesitas entender cada línea. Busca los nombres en español: el dominio del negocio (`empresa`,
  `sucursal`, `carta`, `producto`) está en español a propósito, igual que en los documentos de diseño.
- Los comentarios al inicio de cada archivo suelen decir qué hace y qué criterio de la especificación
  cumple. Las especificaciones están en `specs/`.
- Si algo no queda claro, pregúntale a Claude en una conversación aparte: "explícame qué hace
  `apps/api/src/modulos/salud/salud.controller.ts`".
