---
name: App del restaurante (Azulejo)
description: Interfaz de operación para celulares personales del personal de restaurantes peruanos. Baldosa blanca, junta fina y cobalto de cevichería.
colors:
  pared: '#F4F7F9'
  baldosa: '#FFFFFF'
  junta: '#D3DBE1'
  junta-teclado: '#B7C3CC'
  borde-control: '#6F808C'
  tinta: '#14222E'
  tinta-suave: '#475965'
  tinta-tenue: '#5E6F7B'
  inactivo: '#E6ECF0'
  cobalto: '#1D4A9E'
  cobalto-hundido: '#143A80'
  cobalto-suave: '#E4ECFA'
  huacatay: '#17653F'
  huacatay-suave: '#E3F3EA'
  aji: '#F2A900'
  aji-texto: '#7A4A00'
  aji-suave: '#FFF0CC'
  rocoto: '#B3261E'
  rocoto-suave: '#FCE6E3'
  rocoto-borde: '#E7B3AE'
  rocoto-oscuro: '#7F1A14'
  huacatay-borde: '#A9D6BC'
  huacatay-oscuro: '#0F4A2D'
  aji-borde: '#E8C877'
  cobalto-borde: '#B4C8EE'
  cobalto-oscuro: '#102F66'
typography:
  cifras:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '2.5rem'
    fontWeight: 700
    lineHeight: '2.75rem'
    letterSpacing: '0em'
    fontFeature: 'tnum'
  cifras-pin:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '2.75rem'
    fontWeight: 700
    lineHeight: '3.25rem'
    letterSpacing: '0.18em'
    fontFeature: 'tnum'
  titulo:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 700
    lineHeight: '1.875rem'
    letterSpacing: '-0.01em'
  subtitulo:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: '1.5rem'
  cuerpo:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: '1.5rem'
  ayuda:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '1.25rem'
  etiqueta:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 700
    lineHeight: '1.125rem'
  cuerpo-grande:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 600
    lineHeight: '1.5rem'
  aviso:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: '1.375rem'
  titulo-hoja:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: '1.625rem'
  tecla:
    fontFamily: 'Atkinson Hyperlegible Next, system-ui, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 600
    lineHeight: '2rem'
    fontFeature: 'tnum'
rounded:
  etiqueta: '4px'
  baldosa: '6px'
  pared: '10px'
  hoja: '16px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
  xxl: '32px'
  xxxl: '48px'
components:
  boton-principal:
    backgroundColor: '{colors.cobalto}'
    textColor: '{colors.baldosa}'
    rounded: '{rounded.baldosa}'
    padding: '0 16px'
    height: '56px'
    typography: '{typography.cuerpo-grande}'
  boton-principal-hundido:
    backgroundColor: '{colors.cobalto-hundido}'
  boton-secundario:
    backgroundColor: '{colors.baldosa}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.baldosa}'
    padding: '0 16px'
    height: '48px'
  boton-peligro:
    backgroundColor: '{colors.baldosa}'
    textColor: '{colors.rocoto}'
    rounded: '{rounded.baldosa}'
    padding: '0 16px'
    height: '48px'
  boton-desactivado:
    backgroundColor: '{colors.inactivo}'
    textColor: '{colors.tinta-tenue}'
    rounded: '{rounded.baldosa}'
    height: '48px'
  campo:
    backgroundColor: '{colors.baldosa}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.baldosa}'
    padding: '12px'
    height: '52px'
  tecla:
    backgroundColor: '{colors.baldosa}'
    textColor: '{colors.tinta}'
    typography: '{typography.tecla}'
    height: '64px'
  tecla-hundida:
    backgroundColor: '{colors.cobalto-suave}'
    textColor: '{colors.cobalto}'
  baldosa-persona:
    backgroundColor: '{colors.baldosa}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.baldosa}'
    padding: '12px'
    height: '72px'
  etiqueta-estado:
    rounded: '{rounded.etiqueta}'
    padding: '0 8px'
    height: '24px'
    typography: '{typography.etiqueta}'
  hoja-inferior:
    backgroundColor: '{colors.baldosa}'
    rounded: '{rounded.hoja}'
    padding: '12px 16px 16px'
---

<!-- Dirección aprobada por el usuario (2026-10-27). Los tokens son los de la muestra `diseno/direccion-azulejo.html` y viven en `packages/ui/src/tokens.css`. Volver a ejecutar `/impeccable document` cuando las pantallas se estabilicen, para generar `.impeccable/design.json`. -->

# Design System: App del restaurante (Azulejo)

## Overview

**Creative North Star: "La pared de azulejos"**

La app es una pared de azulejos de cocina: baldosas blancas, juntas finas y un solo azul de cevichería para la acción. Se lee de un vistazo, aguanta que la limpien con prisa y no necesita adornos. Cada elemento que se toca es una baldosa con borde nítido; lo que informa es una junta o una cenefa. El mundo del azulejo aporta cuatro cosas y solo esas: la paleta (blanco, cobalto, ají, rocoto, huacatay), la densidad en módulos de 8 px, una tipografía muy legible, y un gesto firma, la **cenefa de estado**. No aporta la estructura de las pantallas ni los controles, que son los habituales de una app móvil.

La escena física que fuerza el diseño: un mozo de pie en un salón con luz de ventana al mediodía o en penumbra de noche, con el celular en una mano y la otra ocupada, y un cajero o dueño que mira el mismo celular sentado. Por eso el tema por defecto es **claro** (contraste alto a pleno sol, lectura inmediata) y los tokens son semánticos para sumar un tema nocturno sin rehacer nada.

La sobriedad es la norma. No hay degradados, vidrio, sombras decorativas ni animaciones de adorno. La personalidad vive en el detalle: el teclado numérico es literalmente un muro de baldosas con juntas de 2 px, los cupos del celular son cinco baldosas de las que se llenan tres, y la franja de la parte superior cambia de color y de texto cuando algo importante cambia.

**Key Characteristics:**

- Claro por defecto; cobalto único para acción y selección; ají, rocoto y huacatay solo para estado, siempre con texto.
- Baldosas de 6 px de radio con borde de 1 px; juntas, no sombras, para separar.
- Módulo de 8 px: toda medida es múltiplo de 4 y todo control táctil mide 48 px o más.
- Una sola familia tipográfica, Atkinson Hyperlegible Next, con cifras tabulares.
- Una firma: la cenefa de estado, siempre arriba, siempre acompañada de un banner con palabras.

## Colors

Paleta de pared limpia con un cobalto profundo; los tres colores de estado salen de la cocina peruana (ají amarillo, rocoto, huacatay). Contrastes calculados sobre los valores de la tabla.

### Primary

- **Cobalto de cevichería** (#1D4A9E): la acción principal de cada pantalla, el foco, la selección y la cenefa en estado normal. Texto blanco encima: 8.3:1. Sobre pared como texto o icono: 7.7:1.
- **Cobalto hundido** (#143A80): botón principal presionado.
- **Cobalto suave** (#E4ECFA): fondo de selección, tecla presionada, iniciales de persona y aviso informativo.

### Secondary (estado)

- **Ají amarillo** (#F2A900): cenefa y banner de advertencia (sin conexión, suscripción en gracia); texto de tinta encima (9:1). Nunca como texto.
- **Texto de ají** (#7A4A00) sobre **Ají suave** (#FFF0CC): etiquetas y avisos en línea de advertencia, 6.6:1.
- **Rocoto** (#B3261E): error, bloqueo, suspensión y acción destructiva; blanco encima 6.5:1, y como texto sobre baldosa 7.5:1. **Rocoto suave** (#FCE6E3) para su aviso en línea.
- **Huacatay** (#17653F) sobre **Huacatay suave** (#E3F3EA): confirmación y "Activa", 6.2:1.

### Avisos en línea

Cada aviso usa su color suave de fondo, su borde (`rocoto-borde`, `huacatay-borde`, `aji-borde`, `cobalto-borde`) y su texto oscuro (`rocoto-oscuro` #7F1A14, `huacatay-oscuro` #0F4A2D, `aji-texto` #7A4A00, `cobalto-oscuro` #102F66), todos con 6:1 o más sobre su fondo.

### Neutral

- **Pared** (#F4F7F9): fondo de toda pantalla.
- **Baldosa** (#FFFFFF): superficie de todo lo tocable y de las filas.
- **Junta** (#D3DBE1): divisores y bordes que no son controles. **Junta de teclado** (#B7C3CC) separa las teclas.
- **Borde de control** (#6F808C): borde de cualquier control (campo, botón secundario, baldosa de persona): 3.3:1 sobre pared, mínimo exigido para componentes.
- **Tinta** (#14222E): texto principal (15:1), barra de plataforma y banner de soporte. **Tinta suave** (#475965): texto secundario (6.8:1). **Tinta tenue** (#5E6F7B): marcadores de posición (5.2:1). **Inactivo** (#E6ECF0): relleno de lo desactivado.

### Named Rules

**The One Blue Rule.** El cobalto es el único color de acción. Si algo es azul, se puede tocar o está seleccionado; si es ají, rocoto o huacatay, informa y nunca es un botón (salvo el destructivo con contorno rocoto).
**The Words Beside Color Rule.** Ningún estado se dice solo con color: va con texto y, cuando cabe, con un icono. Quitar el color no debe quitar información.
**The Soporte Is Ink Rule.** El modo soporte y el panel de plataforma usan tinta oscura, color que ninguna sucursal usa, para que nadie los confunda con una sucursal.

Tema nocturno (previsto por el usuario para más adelante; no se construye en 002, pero los tokens ya son semánticos): fondo #0E1923, baldosa #16242F, texto #E8EEF3, texto suave #A9B8C4, acción #8FB1F2 con tinta encima (8.2:1), borde #6C7E8C, rocoto #FF9C93, ají #F5B94A, huacatay #6FD09A; todos sobre baldosa con 7.3:1 o más.

## Typography

**Familia única:** Atkinson Hyperlegible Next (variable, 400 a 700, subconjunto latino de unos 34 KB, autoalojada, con `system-ui` como respaldo ajustado).
**Cifras:** siempre tabulares (`font-variant-numeric: tabular-nums`) en PIN, cuentas regresivas, montos y fechas.

**Character:** Atkinson fue diseñada para que ningún carácter se confunda con otro: la "I" mayúscula, la "l" y el "1" son distintos y el cero lleva marca. Es la mejor apuesta para PIN, nombres de usuario y montos en un celular barato, con mala luz y con prisa. El cero marcado es intencional y se conserva también en montos.

### Hierarchy

- **Cifras** (700, 40/44): cuenta regresiva del bloqueo, PIN mostrado una vez (44/52 con 0.18em de espacio entre dígitos), cifras grandes.
- **Título** (700, 24/30, -0.01em): título de cada pantalla. Una por pantalla.
- **Titulo de hoja** (700, 20/26): título de hojas y diálogos. **Título compacto** (700, 22/28): título dentro de un detalle o de un panel.
- **Subtítulo** (700, 18/24): nombre de persona en una baldosa.
- **Cuerpo grande** (600, 17/24): texto de campos, del botón principal y de la fila de lista.
- **Aviso** (400, 15/22): texto de avisos, banners y etiquetas de campo (en 600).
- **Cuerpo** (400, 16/24): texto corrido y campos. Nunca menos de 16 px en campos, para que iPhone no haga zoom. Medida máxima 65 ch.
- **Ayuda** (400, 14/20, tinta suave): descripciones, segunda línea de filas.
- **Etiqueta** (700, 13/18): etiquetas de estado. Es el mínimo absoluto de la app.
- **Tecla** (600, 28/32; 24/28 en la hoja): dígitos del teclado.

### Named Rules

**The Ceros Marcados Rule.** No se desactiva el cero marcado de la fuente ni se cambia por otra fuente en montos: distinguir 0 de O en un PIN o un monto vale más que la estética.
**The Sin Mayúsculas Rule.** No se escribe en mayúsculas sostenidas ni con espaciado ancho; el énfasis se hace con peso.

## Layout

Móvil primero, columna única desde 320 px de ancho; las pantallas se diseñan a 360 px. Módulo de 8 px (escala 4, 8, 12, 16, 24, 32, 48). Márgenes laterales de 16 px; separación entre grupos de 24 px; dentro de un grupo, 8 a 12 px. Más aire arriba de un título que debajo.

- **Zona del pulgar:** la acción principal y el teclado van abajo; el título y la información, arriba. El botón principal de una lista se fija sobre la barra de navegación.
- **Estructura del celular:** cenefa (8 px), banner de estado si lo hay, barra superior (56 px), contenido, acción fija, navegación inferior (64 px, máximo 5 destinos, etiquetas siempre visibles). Respeta las zonas seguras (`env(safe-area-inset-*)`).
- **Tablet (desde 768 px):** la navegación pasa a un riel izquierdo de 72 px con etiquetas; el contenido se limita a 720 px de columna o se divide en lista y detalle.
- **Escritorio (desde 1024 px):** las listas pasan a tablas con encabezados, cifras alineadas a la derecha y acciones en la última columna; ancho máximo del contenido de 1120 px. El panel de plataforma se usa aquí sobre todo.
- **Objetivos táctiles:** 48 x 48 px como mínimo (WCAG exige 24), 56 px el botón principal, 64 px las teclas, 72 px las baldosas de persona. Separación mínima entre objetivos de 8 px (en el teclado, 2 px de junta porque las teclas son de 64 px).
- **Tabla que se vuelve lista:** en celular cada fila es una baldosa de 72 px con nombre, segunda línea de ayuda y un estado a la derecha; no hay desplazamiento horizontal nunca.

## Elevation & Depth

Plano por defecto: la profundidad se dice con juntas y bordes, no con sombras. Hay exactamente tres niveles: la pared, la baldosa (borde de 1 px) y la hoja (la única superficie con sombra), que se asienta sobre una cortina de tinta al 45 %.

### Shadow Vocabulary

- **Hoja** (`box-shadow: 0 -8px 24px rgba(20, 34, 46, 0.16)`): solo la hoja inferior y el diálogo de confirmación. Nada más lleva sombra.

### Named Rules

**The Tres Capas Rule.** Pared, baldosa y hoja. Si un elemento necesita una cuarta capa, el diseño de la pantalla está mal.
**The Sin Vidrio Rule.** Nada de desenfoque, vidrio ni transparencias decorativas.

## Shapes

Baldosas de esquina corta: 6 px en botones, campos y filas tocables; 4 px en etiquetas de estado; 10 px solo en el muro del teclado; 16 px en la parte superior de las hojas. No hay píldoras ni círculos, salvo los puntos del PIN. Los iconos son de contorno (Lucide, 24 px, trazo de 1.75 px), siempre con texto cuando el significado no es universal, y nunca emojis ni glifos de texto como icono.

**La junta:** el borde de 1 px en `junta` separa filas y bloques; el borde de control (`borde-control`) rodea todo lo que se toca. Una baldosa tocable y un panel informativo se distinguen por ese borde más oscuro.

## Components

Los componentes base de `packages/ui` (T20): Botón, Campo, TecladoNumerico, PuntosPin, BaldosaPersona, CuposDelEquipo, Aviso, Cenefa con BannerDeEstado, BarraDeSesion, HojaInferior y Dialogo, EtiquetaDeEstado, FilaDeLista con Tabla, EditorDeHorario, PinUnaVez, Esqueleto y EstadoVacio.

### Buttons

- **Shape:** baldosa de 6 px, 48 px de alto; el principal de pantalla, 56 px.
- **Principal:** fondo cobalto, texto blanco de 17 px peso 600, ancho completo en celular; presionado, cobalto hundido y 1 px hacia abajo (120 ms). Uno por pantalla.
- **Secundario:** baldosa blanca con borde de control y texto de tinta. **Texto:** sin borde, cobalto, para volver o salidas ("Cambiar de persona").
- **Destructivo:** contorno y texto rocoto; el relleno rocoto solo en la confirmación final. Va siempre separado de "Guardar" por 24 px y una junta, y nunca es la acción por defecto de un diálogo.
- **Desactivado:** relleno `inactivo` y texto tenue; explica por qué (por ejemplo, error de horario visible arriba).
- **Cargando:** el botón conserva su ancho, muestra "Ingresando…" con un indicador y se desactiva; no hay pantalla bloqueada.

### Inputs / Fields

- **Style:** baldosa blanca, borde de control de 1 px, 52 px de alto, etiqueta siempre visible arriba (nunca solo el marcador), texto de 17 px.
- **Focus:** contorno cobalto de 3 px con 2 px de separación.
- **Error:** borde rocoto de 2 px y mensaje debajo con icono y texto ("Escribe tu usuario"); el error general va en un aviso arriba del formulario.
- **Interruptor:** pastilla de 52 x 32 px dentro de un área tocable de 56 x 48 px, con la etiqueta a la izquierda (toda la fila responde al toque); el estado se dice con la posición del pulgar, no solo con el color.
- **Contraseña:** botón de ojo de 48 px dentro del campo; `autocomplete` correcto (`username`, `current-password`, `new-password`) para los administradores de contraseñas.

### Teclado numérico (firma táctil)

Muro de baldosas: 3 columnas por 4 filas, juntas de 2 px (#B7C3CC), borde exterior de control y esquinas de 10 px. Teclas blancas de 64 px (52 px en la hoja), dígitos de 28 px, tecla presionada en cobalto suave con dígito cobalto. La fila inferior: espacio, 0 y borrar. Los dígitos nunca se muestran en pantalla: solo los puntos (20 px, vacíos con borde, llenos con tinta; rocoto en error; apagados en bloqueo). Los puntos son un `status` con texto oculto "2 de 4 dígitos". El envío es automático al llegar al largo del PIN (4 o 6), con el teclado del sistema nunca abierto.

### Baldosa de persona y cupos del equipo

Fila de 72 px: inicial de 48 px en cobalto suave, nombre (18, 700), "PIN de 4 dígitos" debajo, flecha a la derecha. Bloqueada: relleno `inactivo`, candado y "Bloqueado: vuelve en 4:32" en rocoto. Debajo, **cupos**: cinco baldosas pequeñas, las llenas en cobalto, con "Este celular recuerda a 3 de 5 personas".

### Aviso en línea

Baldosa con fondo suave del color de estado, borde de 1 px más oscuro, icono y título en negrita ("No pudimos ingresarte") seguido de una frase que nombra la solución. Tipos: error, advertencia, éxito, información. Nunca un borde izquierdo grueso.

### Navigation

Celular: barra inferior de 64 px con 3 a 5 destinos, icono de 24 px y etiqueta de 13 px siempre visibles; el activo en cobalto con una marca de 3 px arriba. Barra superior de 56 px con el nombre de la pantalla o el botón de volver, y a la derecha el selector de sucursal (baldosa de 48 px con el nombre y un chevrón).

### Barra de la sesión

Muestra persona, rol y sucursal, y abre una hoja con "Cambiar usuario" (botón principal, la primera de la lista), "Cambiar de sucursal", "Mis equipos", y, separadas por una junta, las acciones con contorno rocoto: "Olvidar este equipo" (con confirmación) y "Salir". En la interfaz se dice "equipo" (como en la especificación 002), no "celular". "Cambiar usuario" y "Olvidar este equipo" solo aparecen si el equipo recuerda a la persona (no en soporte).

### Cenefa de estado (firma de marca)

Banda de 8 px en lo más alto, hecha con módulos de 14 px separados por una junta de 2 px, a la manera de una cenefa de cocina. Su color dice la situación y un banner con texto la explica. Estados y prioridad: **sin conexión** (ají, "Sin conexión. Lo que escribas se guardará y se enviará al volver. 2 cambios por enviar."), **modo soporte** (tinta con módulos ají, "Soporte en Inversiones Sol del Norte · Ana Torres" y botón Terminar), **sucursal suspendida** (rocoto, "No se puede abrir caja. Puedes consultar y exportar tus datos."), **suscripción en gracia** (ají, solo administrador, "Quedan 5 días de gracia. Se suspenderá el 18 de noviembre de 2026."), y **normal** (cobalto, sin banner). El cambio de color llena la banda módulo a módulo de izquierda a derecha en 240 ms; con `prefers-reduced-motion` cambia al instante. Es el único movimiento de adorno de la app.

### Hoja inferior y diálogo (clave de supervisor, confirmaciones)

En celular, hoja que sube desde abajo con asa de 40 x 4 px, esquinas superiores de 16 px, sombra de hoja y cortina de tinta al 45 %; en tablet y escritorio, diálogo centrado de 480 px. Altura máxima de 92 % de la pantalla con desplazamiento interno. Enfoque atrapado y devuelto al cerrar; `Escape` y el botón de cerrar de 48 px la cierran. **Clave de supervisor:** dice qué se autoriza ("Anular ítem: Ceviche mixto x1 · S/ 38.00"), pide el motivo con tres atajos de un toque, luego 6 puntos y el teclado compacto; con clave inválida, un aviso rocoto nombra el problema y los intentos que quedan, y los puntos se vacían.

### Lista de usuarios, tabla y editor de horario

Filas de 72 px (inicial, nombre en 17 px, ayuda en 14 px, etiqueta de estado a la derecha: "Con horario", "Inactivo"), divididas por juntas. Desde 768 px se convierten en tabla con encabezados de 13 px, cifras a la derecha y botones de 48 px. **Editor de horario:** un bloque por día de 7, con el nombre del día a la izquierda, un botón de tramo de 48 px por cada tramo ("18:00 – 02:00" con X de 44 px), un botón de agregar tramo de 44 px con contorno punteado, y los errores de tramo en rocoto debajo del día afectado; la hora se elige con el selector nativo. Los tramos que cruzan la medianoche se escriben tal cual.

### PIN mostrado una vez

Baldosa con borde de tinta de 2 px, el PIN en cifras de 44 px con espacio entre dígitos, la frase "Se muestra una sola vez", un aviso de advertencia, "Copiar PIN" y el botón principal "Ya lo anoté". No se puede volver a ver; la pantalla se vacía al salir.

### Pantalla de PIN (arranque de la app)

Sin sesión, la app pregunta a la API qué personas recuerda cada equipo guardado. Con varias, primero la lista de nombres (baldosas de persona y cupos "N de 5"); con una sola, va directo al teclado. En el teclado: título, la persona elegida en una baldosa informativa, los puntos y el mensaje (su sitio está reservado para que el teclado no salte), el muro de teclas (64 px; 56 px bajo los 740 px de alto; 48 px bajo los 680) y las salidas abajo ("Cambiar de persona" y "Ingresar con usuario y contraseña", esta última pasa a principal cuando el PIN está bloqueado o el equipo olvidó a la persona). Desde 768 px el bloque se centra en la pantalla. Se puede escribir también con un teclado físico.

### Segmentos (filtros de una sola opción)

Cuadrícula de baldosas de 48 px que pasa a otra fila en vez de desplazarse de lado; la elegida lleva marca (check), fondo cobalto suave y borde cobalto, y se anuncia como presionada. Se usa en la lista de suscripciones del panel de plataforma (Todas, Activas, En gracia, Suspendidas).

### Panel de plataforma

Barra y cenefa de tinta. Navegación de tres destinos (Empresas, Suscripciones, Planes) abajo en celular y en un riel de 96 px (no 72: "Suscripciones" no cabe) desde 768 px. Las acciones que dejan rastro piden un motivo (queda en la auditoría); el registro de pago anticipa con las reglas de `packages/dominio` cómo quedará la sucursal con el vencimiento elegido.

### Estados de carga, vacío y error

- **Carga:** esqueleto con la forma exacta de la lista (iniciales y dos líneas), brillo suave de 1.4 s que se detiene con `prefers-reduced-motion`; pasados 8 s, el texto "Esto tarda más de lo normal. Seguimos intentando." Nunca una pantalla en blanco ni un indicador solo.
- **Vacío:** icono de 32 px, una frase que dice qué falta y la acción para crearlo ("Aún no hay usuarios. Agrega a tu primer trabajador…").
- **Error de carga:** aviso rocoto que nombra el problema y botón "Reintentar" en la misma pantalla.
- **Sin conexión:** cenefa y banner; las escrituras quedan en cola con la etiqueta "Pendiente de envío" y se reintentan sin duplicar.
- **Bloqueo:** aviso rocoto con candado, cuenta regresiva de 40 px, teclado apagado y la salida "Ingresar con usuario y contraseña" siempre activa y principal.

## Decisiones del usuario (2026-10-27)

- **Dirección "Azulejo" aprobada**, con la muestra `diseno/direccion-azulejo.html` como referencia visual.
- **Tema claro por ahora; el oscuro, más adelante.** Todo color de componente se pide por nombre semántico (`--color-fondo`, `--color-baldosa`, `--color-accion`, …) y nunca por valor, para que el tema oscuro solo cambie los valores de los tokens.
- **Atkinson Hyperlegible Next, autoalojada** (archivo variable en el paquete, sin Google Fonts).
- **Trato de "tú"** en etiquetas, avisos y errores.
- **Extras incluidos:** atajos de motivo (un toque) en la ventana de clave de supervisor; cupos "3 de 5 personas" en la pantalla de PIN; aviso de "sesión por vencer" antes del cierre por inactividad.

## Do's and Don'ts

### Do:

- **Do** diseñar cada pantalla primero a 360 px y probar a 320 px sin desplazamiento horizontal ni texto cortado.
- **Do** poner la acción principal y el teclado en la mitad inferior de la pantalla, al alcance del pulgar.
- **Do** dar a todo control táctil 48 px o más, con 8 px de separación, y 56 px al botón principal.
- **Do** acompañar cada color de estado con una palabra y, si cabe, un icono.
- **Do** escribir los errores con el problema y la salida: "Tu usuario o contraseña no son correctos. Revisa y vuelve a intentar."
- **Do** tratar `prefers-reduced-motion`: sin brillo de carga ni llenado de cenefa.
- **Do** usar cifras tabulares y el cero marcado en PIN, cuentas regresivas y montos; montos como `S/ 1,284.50`, siempre calculados por `packages/dominio`.
- **Do** separar las acciones destructivas por 24 px y una junta, con contorno rocoto y confirmación que diga qué pasará.
- **Do** probar a 200 % de texto y con lector de pantalla (etiquetas en español, `aria-live` para errores, foco visible de 3 px).

### Don't:

- **Don't** usar cobalto para algo que no se pueda tocar ni seleccionar, ni ají, rocoto o huacatay para botones (salvo el contorno destructivo).
- **Don't** mostrar los dígitos de un PIN en pantalla, guardarlos ni dejarlos en un campo de texto del sistema; no pasar PIN por la URL.
- **Don't** usar sombras fuera de la hoja, ni desenfoque, vidrio, degradados ni texto con degradado.
- **Don't** usar bordes laterales de color de más de 1 px en filas, avisos o tarjetas, ni baldosas anidadas dentro de baldosas.
- **Don't** usar una cuadrícula de tarjetas iguales con icono, título y texto como estructura de pantalla; la estructura es lista, formulario o teclado.
- **Don't** usar emojis ni glifos de texto como iconos; iconos de contorno de un mismo trazo.
- **Don't** abrir un diálogo para lo que se puede resolver en la pantalla; las hojas son para claves y confirmaciones.
- **Don't** usar mayúsculas sostenidas, texto menor de 13 px ni campos de menos de 16 px.
- **Don't** pedir al usuario que repita un dato que ya escribió ni perder lo escrito en un formulario por un corte de conexión.
