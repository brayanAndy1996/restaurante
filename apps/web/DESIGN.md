---
name: Carta web del restaurante
description: Interfaz de operación sobria para el cliente sentado a la mesa. Neutra y legible, firmada por el logo, el nombre y el color del restaurante.
colors:
  marca: '#CB4D29'
  sobre-marca: '#FFFFFF'
  fondo: '#FFFFFF'
  hundido: '#F4F5F6'
  tinta: '#16191D'
  tinta-suave: '#4A5058'
  tinta-tenue: '#666C74'
  junta: '#E2E5E8'
  junta-fuerte: '#C3C8CD'
  borde-control: '#7A8088'
  inactivo: '#E7E9EB'
  exito: '#17653F'
  exito-suave: '#E5F3EB'
  exito-oscuro: '#0F4A2D'
  aviso-suave: '#FFF1D0'
  aviso-oscuro: '#7A4A00'
  error: '#B3261E'
  error-suave: '#FCE8E6'
  error-oscuro: '#7F1A14'
typography:
  nombre-restaurante:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1.375rem'
    fontWeight: 700
    lineHeight: '1.75rem'
    letterSpacing: '-0.005em'
  familia:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1.1875rem'
    fontWeight: 700
    lineHeight: '1.5rem'
  titulo-hoja:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: '1.625rem'
  producto:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 600
    lineHeight: '1.375rem'
  precio:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 700
    lineHeight: '1.375rem'
    fontFeature: 'tnum'
  cuerpo:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: '1.5rem'
  descripcion:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: '1.3125rem'
  ayuda:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '1.25rem'
  etiqueta:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 700
    lineHeight: '1.125rem'
  boton:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 600
    lineHeight: '1.5rem'
rounded:
  etiqueta: '4px'
  control: '8px'
  logo: '12px'
  hoja: '16px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
  xxl: '32px'
components:
  cabecera:
    backgroundColor: '{colors.marca}'
    textColor: '{colors.sobre-marca}'
    padding: '16px 16px 20px'
  boton-principal:
    backgroundColor: '{colors.marca}'
    textColor: '{colors.sobre-marca}'
    rounded: '{rounded.control}'
    padding: '0 16px'
    height: '56px'
    typography: '{typography.boton}'
  boton-secundario:
    backgroundColor: '{colors.fondo}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.control}'
    padding: '0 8px'
    height: '48px'
  boton-desactivado:
    backgroundColor: '{colors.inactivo}'
    textColor: '{colors.tinta-suave}'
    rounded: '{rounded.control}'
    height: '48px'
  enlace-de-familia:
    backgroundColor: '{colors.fondo}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.control}'
    padding: '0 14px'
    height: '48px'
  dato-de-cabecera:
    backgroundColor: '{colors.fondo}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.etiqueta}'
    padding: '4px 10px 4px 8px'
    height: '32px'
  fila-de-producto:
    backgroundColor: '{colors.fondo}'
    textColor: '{colors.tinta}'
    padding: '16px'
  hoja-inferior:
    backgroundColor: '{colors.fondo}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.hoja}'
    padding: '8px 16px 16px'
  aviso:
    textColor: '{colors.tinta}'
    rounded: '{rounded.control}'
    padding: '12px'
  campo:
    backgroundColor: '{colors.fondo}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.control}'
    padding: '12px'
    height: '72px'
---

<!-- Dirección propuesta por el frontend (historia 005, T21); pendiente de la aprobación del usuario. La muestra visual es `diseno/carta-web.html` (se abre directo en el navegador; ver su comentario inicial). Los valores de color son los de la muestra con la marca de ejemplo `#E4572E` ya pasada por `colorDeMarcaAccesible`; en la aplicación real salen de `packages/dominio`, nunca escritos a mano. -->

# Design System: Carta web del restaurante

## Overview

**Creative North Star: "La carta de la casa"**

La carta web es la carta del restaurante pasada al celular del cliente: el local pone su logo, su nombre y su color, y lo demás se aparta para que se lea. Es una superficie de tipo **Operate**: el cliente ya está sentado y viene a elegir y pedir rápido, con una mano y con señal débil, así que manda la claridad (lista, foto, precio, botón) y no la persuasión. No es la PWA del personal ("Azulejo", cobalto, Atkinson): esa es nuestra y esta es del restaurante, por eso no usa `packages/ui` ni sus tokens.

La marca entra por **tres sitios y solo esos**: una cabecera a todo el ancho en el color del restaurante con su logo y su nombre, el botón principal de cada pantalla y la selección (la cantidad elegida, la opción marcada). Todo lo demás es neutro: papel blanco, juntas finas y tinta casi negra con un matiz de la marca. Como el color del restaurante lo elige un Administrador y puede ser cualquiera, el sistema se construye para que **cualquier** color funcione: el color solo se usa de relleno con texto blanco encima (después de `colorDeMarcaAccesible`), nunca como texto sobre fondo claro.

Sobriedad: sin degradados, vidrio ni sombras decorativas (la única sombra es la de la hoja inferior), sin fuentes web (pila del sistema, para que la primera vista pese poco), un solo movimiento (la hoja sube en 220 ms). Hay **una sola cosa que se toca por fila**, y es toda la fila.

**Key Characteristics:**

- Cabecera con el color, el logo y el nombre del restaurante; neutro todo lo demás.
- Lista de filas: nombre, descripción de hasta dos líneas y precio a la izquierda; foto de 96 px a la derecha.
- Fuentes del sistema, cifras tabulares, precios siempre en negrita.
- Dos hojas inferiores (producto y "Tu pedido") y una barra fija abajo en el modo mesa.
- Estados dichos con palabras y un icono; el color solo los acompaña.

## Colors

Paleta neutra y fría, casi blanca, con un único color de marca que cambia de restaurante a restaurante. Los neutros llevan un matiz azul muy leve (tinta `#16191D`) y no cambian con la marca; los tonos suaves de la marca se calculan con `color-mix` sobre blanco, de modo que cada carta se siente de su dueño sin perder contraste.

### Primary

- **Color del restaurante** (`#CB4D29` en la muestra; es el `fondo` que devuelve `colorDeMarcaAccesible`): la cabecera, el botón principal, el "+" de cada producto y las opciones marcadas. Texto blanco encima, siempre, con 4.5:1 o más (si el color elegido no llega, se oscurece hasta llegar). **Marca suave** (8 % de la marca sobre blanco): fondo de la opción elegida y del aviso informativo. **Borde de marca** (30 %): borde del aviso informativo y de la etiqueta "en tu pedido". **Marca hundida** (80 % + negro): botón principal presionado.

### Secondary (estado)

- **Éxito** (`#17653F` sobre `#E5F3EB`, texto `#0F4A2D`): "El mozo viene a tu mesa", "El mozo tomó tu pedido".
- **Aviso** (texto `#7A4A00` sobre `#FFF1D0`): cerrado, vencido, sin conexión, precio cambiado.
- **Error** (`#B3261E`, texto `#7F1A14` sobre `#FCE8E6`): "No pudimos atender este pedido", "Se agotó", "Quitar".
  Estos tres tienen los mismos valores del sistema del personal, a propósito: el significado (verde bien, ámbar espera, rojo problema) es el mismo; la marca del restaurante nunca se usa para estado.

### Neutral

- **Fondo** (`#FFFFFF`): toda la pantalla y las hojas; a pleno sol el blanco puro lee mejor.
- **Hundido** (`#F4F5F6`): etiquetas neutras ("Obligatorio").
- **Junta** (`#E2E5E8`): divisor entre filas; **junta fuerte** (`#C3C8CD`): borde de los grupos de opciones y borde superior de la barra.
- **Borde de control** (`#7A8088`): borde de todo lo que se toca (3.9:1).
- **Tinta** (`#16191D`, 17:1): texto principal; **tinta suave** (`#4A5058`, 8:1): descripciones; **tinta tenue** (`#666C74`, 5.4:1): ejemplos en los campos. **Inactivo** (`#E7E9EB`): fondo de un botón apagado.

### Named Rules

**The Fill-Only Rule.** El color del restaurante es siempre un relleno con texto blanco encima (cabecera, botón, "+", selección). Nunca es el color de un texto sobre blanco: así cualquier color, claro u oscuro, cumple el contraste.
**The Not-Our-Brand Rule.** Ningún elemento lleva la marca de nuestro producto ni los colores de `apps/app`. El restaurante firma la pantalla.
**The Words Beside Color Rule.** Ningún estado se dice solo con color: va con texto y un icono ("Se agotó", "Cerrado ahora", "Ya avisamos al mozo"). Quitar el color no debe quitar información.

## Typography

**Familia única:** la pila del sistema, `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`. Sin fuentes web: ni un byte tipográfico en la primera carga. **Cifras:** siempre tabulares (`font-variant-numeric: tabular-nums`) en precios, cantidades y totales.

**Character:** la letra del propio celular del cliente, que ya le resulta familiar y legible a su tamaño. La personalidad no está en la letra sino en el peso: nombres en 600, precios en 700, y títulos en 700. Escala corta con paso de 1.125 a 1.2 (13, 14, 15, 16, 17, 19, 20, 22 px); no hay tamaños fluidos.

### Hierarchy

- **Nombre del restaurante** (700, 22/28): una vez, en la cabecera, es el `h1`. La sucursal va debajo en 600, 16/24.
- **Familia** (700, 19/24): `h2` de cada sección ("Entradas").
- **Título de hoja** (700, 20/26): nombre del producto o "Tu pedido".
- **Producto** (600, 17/22): nombre en la lista y en las líneas del pedido. **Precio** (700, 17/22, tabular).
- **Descripción** (400, 15/21, tinta suave): hasta dos líneas en la lista. **Cuerpo** (400, 16/24). **Ayuda** (400, 14/20).
- **Etiqueta** (700, 13/18): "Obligatorio", "Se agotó", "2 en tu pedido". Es el mínimo absoluto.
- **Botón** (600, 17/24; 15/22 en los dos de abajo). Campos a 16 px para que iPhone no haga zoom.

### Named Rules

**The Precio Entero Rule.** Un precio nunca se parte en dos líneas ni se abrevia: `S/ 28.00`, y para el lector de pantalla "28 soles".
**The Sin Mayúsculas Rule.** Nada en mayúsculas sostenidas ni con espaciado ancho; el énfasis se hace con peso.

## Layout

Móvil primero, una sola columna desde 320 px; se diseña a 360 × 740. Escala de 4, 8, 12, 16, 24, 32. Márgenes laterales de 16 px (24 desde 768 px); separación entre secciones de 24 px. Desde 768 px la carta se limita a una columna de lectura de 640 px centrada; la cabecera sigue a todo el ancho. Nunca hay desplazamiento horizontal.

- **Orden:** cabecera de la marca, familias, lista, y en el modo mesa una barra fija abajo. El "Ir a la carta" salta a la lista.
- **Cabecera:** logo de 56 px en una baldosa blanca (los logos con fondo transparente se leen igual), nombre y sucursal; debajo, la dirección y una etiqueta blanca con el horario ("Abierto ahora · hasta las 23:00"). En el modo mesa no se repite la dirección y se suma la etiqueta "Mesa 4".
- **Familias:** enlaces de 48 px que pasan a otra línea (no se desplazan de lado). Con muchas familias ocupan tres filas; es el precio de no esconder nada ni exigir un gesto fino.
- **Fila de producto:** nombre, descripción de hasta dos líneas y precio a la izquierda; foto de 96 × 96 a la derecha (solo si el producto tiene); divisor de 1 px. Sin foto, el texto ocupa todo el ancho. Combos y menú del día suman una línea "Incluye…" o la lista de sus partes.
- **Modo mesa:** cada fila entera es un botón (un `<button>` estirado sobre la fila, sin controles anidados) con un "+" de 44 px sobre la esquina de la foto; "N en tu pedido" aparece junto al precio.
- **Barra fija (modo mesa):** de abajo hacia arriba, "Llamar al mozo" y "Pedir la cuenta" (48 px, lado a lado) y encima "Ver tu pedido · 4 platos · S/ 132.00" (56 px) cuando hay pedido, o el estado del llamado cuando lo hay. Es la zona del pulgar y respeta `env(safe-area-inset-bottom)`.
- **Hojas inferiores:** suben desde abajo con asa de 40 × 4 px, esquinas superiores de 16 px y cortina de tinta al 45 %; alto máximo del 92 % de la pantalla, con el cuerpo desplazable y el pie (total y botón principal) siempre a la vista. Desde 768 px siguen siendo hojas de 560 px centradas.
- **Hoja de producto:** foto de 72 px, nombre y precio base; descripción; un grupo por cada grupo de modificadores (nombre, etiqueta "Obligatorio" u "Opcional" y la regla en palabras: "Elige 1", "Elige hasta 2"; opciones de 56 px con control nativo de 24 px y el extra a la derecha); cantidad de 1 a 20 con − y + de 48 px; indicaciones (hasta 140); pie con "Agregar al pedido" y el precio de la línea.
- **Hoja "Tu pedido":** una línea por plato ("2 × Lomo saltado", opciones, indicaciones, precio, "Editar" y "Quitar" de 48 px), nota para el mozo (hasta 140) y, en el pie, el total, la frase "El mozo revisará tu pedido contigo antes de mandarlo a cocina" y "Enviar al mozo".

## Elevation & Depth

Plano por defecto: la profundidad se dice con juntas y bordes. Hay tres capas: el papel, la barra fija (borde superior de 1 px, sin sombra) y la hoja.

### Shadow Vocabulary

- **Hoja** (`box-shadow: 0 -8px 24px rgba(22, 25, 29, 0.16)`): solo la hoja inferior; sobre una cortina de `rgba(22, 25, 29, 0.45)`. Nada más lleva sombra.

### Named Rules

**The Tres Capas Rule.** Papel, barra y hoja. Una cuarta capa es señal de que la pantalla está mal.
**The Sin Vidrio Rule.** Nada de desenfoque, transparencias decorativas ni degradados.

## Shapes

Esquinas cortas: 8 px en botones, enlaces, campos, grupos de opciones y fotos; 4 px en etiquetas; 12 px en la baldosa del logo; 16 px arriba de las hojas. Los iconos son de contorno (24 px, trazo de 1.75 px, esquinas redondeadas), siempre acompañados de texto salvo la X de cerrar y el + y − de la cantidad, que llevan `aria-label`. Sin emojis ni glifos de texto como iconos.

## Components

### Botón principal

Relleno del color del restaurante, texto blanco de 17 px peso 600, 56 px de alto, a todo el ancho de la columna. Dos zonas: la acción a la izquierda y el monto a la derecha ("Agregar al pedido · S/ 78.00"); "Enviar al mozo" va centrado. Presionado: marca hundida y 1 px hacia abajo. Apagado: relleno `inactivo`, texto de tinta suave y siempre una frase cerca que dice por qué ("Quita lo que se agotó para poder enviar"). Uno por pantalla u hoja.

### Botón secundario y de texto

Secundario: baldosa blanca, borde de control de 1 px, 48 px, texto de 15 px 600 e icono de 20 px ("Llamar al mozo", "Pedir la cuenta"). De texto: sin borde, subrayado fino, 48 px de alto ("Editar", "Quitar"; "Quitar" en rojo, con icono). Presionado: marca suave y borde de marca.

### Fila de producto

Ver Layout. Hover y presionado: un velo del 6 % de la marca sobre la fila. Foto con esquinas de 8 px; sin foto no se deja hueco ni se pone un marcador.

### Hoja y confirmación

Diálogo nativo (`<dialog>`) con foco atrapado y devuelto al cerrar; el foco inicial va al título, no al botón de cerrar. Se cierra con la X de 48 px, con `Escape` y tocando la cortina. "Llamar al mozo" y "Pedir la cuenta" abren una hoja corta: una pregunta en una línea, una frase que explica y dos botones apilados ("Sí, llamar al mozo" / "Ahora no").

### Avisos y estados del llamado

Baldosa de fondo suave, borde de 1 px, icono, título de 16 px en negrita y una frase. Sin borde lateral grueso. Los estados del llamado van en la barra de abajo, reemplazan a "Ver tu pedido" y apagan los tres envíos mientras esté pendiente:

- **Pendiente** (informativo, campana): "Avisamos al mozo" · "Puedes seguir viendo la carta."
- **Atendido** (éxito, check): "El mozo viene a tu mesa" · **Pasado a la cuenta** (éxito): "El mozo tomó tu pedido".
- **Descartado** (error, alerta): "No pudimos atender este pedido" · "Habla con el mozo."
- **Vencido** (aviso, reloj): "Nadie respondió a tiempo" · "Llama al mozo o vuelve a enviarlo."
  Los tres finales llevan "Entendido" (48 px); al cerrarlos vuelven los envíos. Los errores de envío van en un aviso arriba del contenido con `role="alert"`: cerrado ("El local está cerrado ahora"), ya pendiente ("Ya avisamos al mozo"), demasiados ("Enviaste varios avisos seguidos · Espera 2 minutos…"), una línea rechazada (etiqueta roja "Se agotó", "Ya no se vende", "Huevo frito ya no está disponible" sobre la línea; el botón "Enviar al mozo" apagado), sin red ("Sin conexión · Lo enviaremos cuando vuelva") y error del servidor ("Inténtalo otra vez en un momento. Si sigue igual, habla con el mozo"). Nunca un código ni "ocurrió un error".

### Campos

Área de texto blanca, borde de control, 8 px de radio, 16 px de letra, etiqueta siempre visible arriba y contador "0 de 140" abajo a la derecha. Foco: contorno de tinta de 3 px con 2 px de separación. Cursor y selección con la marca.

### Foco, selección y detalles del navegador

Foco visible de 3 px en tinta (en blanco sobre la cabecera y el botón principal). Los controles de opción son nativos (`radio`, `checkbox`) con el color del restaurante (`accent-color`); la fila entera es la zona táctil y la elegida lleva marca suave.

## Do's and Don'ts

### Do:

- **Do** pasar siempre el color del restaurante por `colorDeMarcaAccesible` y usarlo solo de relleno con texto blanco.
- **Do** dar a todo control táctil 48 px o más (el "+" de 44 px de la foto es decorativo: la zona táctil es la fila).
- **Do** decir cada estado con palabras y un icono, y cada error con el problema y la salida.
- **Do** mostrar montos como `S/ 28.00` con cifras tabulares, calculados por `packages/dominio`, y leerlos como "28 soles".
- **Do** probar a 320 px y a 200 % de texto, con `prefers-reduced-motion` sin animación y con lector de pantalla en español.
- **Do** que la carta se lea completa sin JavaScript y que la primera vista pese poco (criterio 88).

### Don't:

- **Don't** usar el color del restaurante como color de texto sobre blanco ni para un estado (éxito, aviso, error).
- **Don't** usar `packages/ui`, Atkinson ni los colores y componentes de `apps/app`: esta superficie no es el sistema del personal.
- **Don't** usar fuentes web, degradados, vidrio, sombras fuera de la hoja ni animaciones de adorno.
- **Don't** anidar controles dentro de la fila de producto ni abrir una hoja para lo que cabe en la pantalla.
- **Don't** dejar un botón apagado sin decir por qué, ni mostrar un código de error al cliente.
- **Don't** usar mayúsculas sostenidas, texto menor de 13 px ni campos de menos de 16 px.
- **Don't** inventar fotos: sin foto, la fila usa todo el ancho para el texto.
