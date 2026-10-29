# Módulo 3. Node.js, pnpm y el monorepo con Turborepo

## Node.js

### Qué es

JavaScript nació para correr dentro del navegador. **Node.js** permite correrlo también fuera, en una
computadora o servidor. Con Node se escribe la API del proyecto y se ejecutan las herramientas de
desarrollo (Vite, las pruebas, los scripts).

### Para qué sirve aquí

- Ejecuta la API (`apps/api`).
- Ejecuta las herramientas que compilan y sirven la app del personal (`apps/app`).
- Permite usar un solo lenguaje, TypeScript, en todo el sistema (módulo 4).

El proyecto exige Node 22 o superior (lo dicen `.nvmrc` y el campo `engines` de `package.json`).

## npm y pnpm: los gestores de paquetes

### Qué son

Un **paquete** (o librería, o dependencia) es código que otros publicaron para reutilizarlo: NestJS,
React, zod… Un **gestor de paquetes** los descarga e instala en la carpeta `node_modules`.

**npm** viene con Node. Este proyecto usa **pnpm**, que hace lo mismo pero más rápido y ocupando
mucho menos disco, y que maneja muy bien los monorepos (abajo). **corepack** es la herramienta de
Node que instala pnpm en la versión exacta que pide el proyecto (`"packageManager": "pnpm@10.28.0"`).

### Los archivos clave

| Archivo               | Qué es                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `package.json`        | La ficha de un proyecto: su nombre, sus dependencias y sus **scripts** (comandos con nombre) |
| `pnpm-lock.yaml`      | Registra la versión exacta de cada dependencia instalada, para que todos tengan las mismas   |
| `pnpm-workspace.yaml` | Le dice a pnpm qué carpetas son proyectos del monorepo: `apps/*` y `packages/*`              |

### Los scripts

En el `package.json` de la raíz, la sección `scripts` le pone nombre a comandos largos. Cuando
escribes `pnpm dev`, pnpm busca el script `dev` y ejecuta lo que dice:

```json
"scripts": {
  "dev": "turbo run dev --filter=@restaurante/api --filter=@restaurante/app",
  "test": "turbo run test",
  "local:preparar": "node scripts/local-preparar.mjs"
}
```

## El monorepo

### Qué es

Un **monorepo** es un solo repositorio que contiene varios proyectos relacionados. Aquí hay seis:

| Proyecto                 | Carpeta              | Qué es                         |
| ------------------------ | -------------------- | ------------------------------ |
| `@restaurante/api`       | `apps/api`           | La API                         |
| `@restaurante/app`       | `apps/app`           | La app del personal            |
| `@restaurante/dominio`   | `packages/dominio`   | Reglas de negocio compartidas  |
| `@restaurante/contratos` | `packages/contratos` | Contratos de datos compartidos |
| `@restaurante/ui`        | `packages/ui`        | Estilos y componentes          |
| `@restaurante/config`    | `packages/config`    | Configuración común            |

### Para qué sirve

La app y la API usan el mismo código de `packages/`. En `apps/api/package.json` verás
`"@restaurante/dominio": "workspace:*"`: significa "usa la versión que está en este mismo
repositorio", no una descargada de internet. Un cambio en una regla de negocio llega a la app y a la
API a la vez.

## Turborepo

### Qué es

**Turborepo** (el comando `turbo`) coordina las tareas de todos los proyectos del monorepo: sabe en qué
orden ejecutarlas y evita repetir trabajo que ya hizo.

### Cómo se usa aquí

`turbo.json` define las tareas (`build`, `dev`, `test`, `lint`, `typecheck`). La clave es
`"dependsOn": ["^build"]`: antes de correr una tarea en un proyecto, compila primero los paquetes de
los que depende. Por eso, al hacer `pnpm dev`, Turborepo compila `dominio`, `contratos` y `ui` antes de
arrancar la API y la app.

Además guarda en caché los resultados: si un paquete no cambió, no lo vuelve a compilar.

## Comandos que usarás

| Comando                                   | Qué hace                                                    |
| ----------------------------------------- | ----------------------------------------------------------- |
| `pnpm install`                            | Instala o actualiza las dependencias de todos los proyectos |
| `pnpm dev`                                | Arranca la API y la app en modo desarrollo                  |
| `pnpm build`                              | Compila todos los proyectos                                 |
| `pnpm --filter @restaurante/api <script>` | Ejecuta un script en un solo proyecto                       |

## Práctica (5 minutos)

1. Abre `package.json` en la raíz y busca el script `local:preparar`. Abre el archivo al que apunta
   (`scripts/local-preparar.mjs`) y lee sus 20 líneas: ahora sabes exactamente qué hizo ese comando.
2. Abre `apps/api/package.json` y encuentra `"dev": "nest start --watch"`. El `--watch` reinicia la API
   sola cada vez que guardas un archivo.

## Para profundizar

- [Introducción a Node.js](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)
- [pnpm: motivación y workspaces](https://pnpm.io/workspaces)
- [Turborepo: conceptos](https://turborepo.com/docs)
