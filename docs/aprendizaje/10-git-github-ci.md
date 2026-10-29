# Módulo 10. Git, GitHub y la integración continua

## Git

### Qué es

**Git** guarda la historia completa de los cambios del código. Cada cambio guardado es un **commit**:
una foto del proyecto en ese momento, con un mensaje que explica qué cambió y por qué. Con Git se puede
volver a cualquier versión anterior y trabajar en varias cosas a la vez sin mezclarlas.

### Conceptos clave

| Concepto    | Qué es                                                                        |
| ----------- | ----------------------------------------------------------------------------- |
| Repositorio | La carpeta del proyecto con toda su historia                                  |
| Commit      | Un cambio guardado, con mensaje, autor y fecha                                |
| Rama        | Una línea de trabajo paralela. Se trabaja en una rama sin afectar a las demás |
| `main`      | La rama principal. En este proyecto solo tiene lo **aprobado**                |
| Merge       | Unir los cambios de una rama en otra                                          |
| Pull / Push | Traer cambios desde GitHub / enviar tus cambios a GitHub                      |

### Cómo se usa aquí

- `main` solo recibe secciones aprobadas y cerradas. Es la que levantas en local.
- El orquestador trabaja cada sección en su propia rama (las que empiezan con `claude/`) y la lleva a
  `main` cuando la apruebas.
- Los commits están en español y explican la historia y la fase, por ejemplo "Sección 2 (003), C3:
  grupos de modificadores". Los que dicen "respaldo en curso" se hicieron para no perder trabajo si la
  sesión se cortaba.

### Comandos que usarás

| Comando                 | Qué hace                                  |
| ----------------------- | ----------------------------------------- |
| `git status`            | Qué archivos cambiaste                    |
| `git pull`              | Trae lo último de GitHub a tu rama actual |
| `git log --oneline -20` | Los últimos 20 commits, uno por línea     |
| `git checkout main`     | Cambia a la rama `main`                   |
| `git branch -a`         | Lista las ramas, locales y de GitHub      |

Si prefieres no usar la terminal, [GitHub Desktop](https://desktop.github.com/) hace todo esto con
clics.

## GitHub

**GitHub** guarda el repositorio en internet y añade herramientas para trabajar en equipo:

- **Pull requests:** una propuesta para unir una rama a otra. Muestra los cambios archivo por archivo
  y permite comentarlos antes de aprobarlos.
- **Actions:** ejecuta tareas automáticas en cada cambio (abajo).
- La pestaña **Commits** de cada rama muestra la historia, y cada commit muestra exactamente qué
  líneas cambiaron.

## La integración continua (CI)

### Qué es

La **integración continua** revisa automáticamente cada cambio que se sube a GitHub: instala el
proyecto en una máquina limpia, revisa el código y corre todas las pruebas. Si algo falla, el commit
queda marcado con una ✗ roja.

### Cómo se usa aquí

La receta está en `.github/workflows/ci.yml` y tiene dos trabajos que corren en máquinas de GitHub
con su propio PostgreSQL 16 en Docker:

**`verificar`**, en este orden:

1. Instala las dependencias.
2. Revisa el formato (Prettier) y el código (ESLint).
3. Verifica los tipos (TypeScript) y compila todo.
4. Comprueba que la app no pese de más.
5. Corre todas las pruebas.

**`e2e`:** prepara la base, carga los datos de demostración y corre las pruebas con navegador
(Playwright). Si fallan, guarda capturas y reportes para revisar qué pasó.

Ninguna sección llega a `main` con la CI en rojo.

## Práctica (5 minutos)

1. En GitHub, abre el repositorio y la pestaña **Actions**. Verás cada ejecución con su resultado.
2. Abre la última ejecución de `main` y luego el trabajo `verificar`: cada paso se puede desplegar para
   ver su salida, igual que en tu terminal.
3. En la terminal, ejecuta `git log --oneline -15` y compara con la pestaña **Commits** de GitHub.

## Para profundizar

- [Git en español (libro Pro Git)](https://git-scm.com/book/es/v2)
- [Qué son GitHub Actions](https://docs.github.com/es/actions/about-github-actions/understanding-github-actions)
