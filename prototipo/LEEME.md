# Prototipo navegable

Un recorrido con datos de ejemplo para entender cómo funciona el sistema y mostrárselo a otra persona.
**No es el producto real**: no se conecta a ninguna API, no guarda nada y todo lo que ves (empresas, RUC, personas, montos) es inventado.

Muestra la primera parte del sistema, "Plataforma y acceso": cómo entra cada trabajador desde su celular (usuario y contraseña la primera vez, PIN después), la clave de supervisor, cómo el administrador controla quién entra y cuándo, y el panel de nuestro equipo para atender clientes y suscripciones. Usa la dirección de diseño "Azulejo" (`DESIGN.md`).

El prototipo está publicado como página privada en https://claude.ai/artifact/JR9w18cpJHYFQZ18v2iM7F: solo lo abren su dueño y las personas con quienes se comparta. Esa versión muestra la sección 1 (Plataforma y acceso).

## Cómo abrirlo

Haz doble clic en `prototipo/index.html`. Se abre en tu navegador, sin internet y sin instalar nada.

- En computadora, el celular se ve centrado, con el ancho de un celular de unos 390 px. Las pantallas de administración y de plataforma aprovechan todo el ancho.
- En un celular real, se ve a pantalla completa.
- Arriba, la franja "Prototipo con datos de ejemplo" y el botón **Presentación**.

## Cómo recorrerlo

1. Empieza en la portada y elige un recorrido, o toca **Presentación**.
2. El panel de presentación permite:
   - **Saltar a cualquier escena** (hay más de 50, agrupadas por tema). Al saltar, los datos de ejemplo y las simulaciones vuelven a su estado inicial para que se vea lo que dice el nombre.
   - **Cambiar de rol**: Mozo, Cajero, Supervisor, Administrador y Superadministrador.
   - **Simular**: sin conexión, sucursal en gracia, sucursal suspendida y trabajador fuera de horario.
   - Elegir el tema (automático, claro u oscuro), mostrar u ocultar las pistas y reiniciar todo.
3. Cuando falte un dato, hay una **pista** (nota punteada) con el dato de ejemplo y, a veces, un botón para rellenarlo.

Datos de ejemplo útiles:

| Para                                       | Dato                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Ingresar con contraseña (es temporal)      | usuario `rquispe`, contraseña `Temporal-26`                         |
| Ingresar con contraseña (sin cambio)       | `lparedes` / `Caja-2026`, `jramos` / `Admin-2026`                   |
| PIN en el celular que ya recuerda gente    | Rosa `4821` (4 dígitos), Luis `305917` y Jorge `724019` (6 dígitos) |
| Clave de supervisor (6 dígitos)            | Carmen `482913` o Jorge `724019`                                    |
| Panel de plataforma                        | usuario `atorres`, contraseña `Plataforma-26`                       |
| Un RUC válido para dar de alta una empresa | `20609182734`                                                       |

## Cómo regenerarlo

`prototipo/prototipo.html` es el archivo principal: un solo fragmento con todo el CSS y el JavaScript en línea y la fuente Atkinson Hyperlegible Next incrustada. Se puede pegar tal cual como página compartible.

`prototipo/index.html` se genera a partir de él (le agrega `<!doctype>`, `<html>`, `<head>` y `<body>`) para poder abrirlo con doble clic. Después de editar `prototipo.html`, regéneralo con:

```
node prototipo/armar.mjs
```

No necesita instalar dependencias (solo Node 22 o más reciente).

## Qué contiene

- Todo vive en memoria: al recargar la página, el prototipo vuelve a empezar.
- Navegación con `#nombre` (por ejemplo `index.html#usuarios` salta a esa pantalla con datos de ejemplo).
- Tokens de color de `packages/ui` en claro y en oscuro; el prototipo no importa nada del repositorio.
- Controles táctiles de 44 px o más, foco visible y respeto de `prefers-reduced-motion`.
