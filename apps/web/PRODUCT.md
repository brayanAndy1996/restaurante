# Product

<!-- impeccable:product-schema 1 -->

> Estado: aprobado por el usuario el 2026-11-03 (historia 005, entrega 5b), con tres ajustes: presupuesto de 140 kB, color de la marca conservado con texto blanco o casi negro y familias en una fila fija. Hereda del `PRODUCT.md` de la raíz lo que no se repite aquí (español de Perú, soles, WCAG 2.2 AA, datos del negocio). Esta superficie es **otra** que la PWA del personal: la ve el cliente del restaurante, no quien lo atiende.

## Platform

web (Next.js, `apps/web`; servidor de Next con HTML renderizado en el servidor y pocas islas de cliente)

## Users

El **cliente del restaurante**, sentado a su mesa, con **su propio celular** (Android de gama media con Chrome, o iPhone con Safari) y **datos móviles**, a veces con señal débil dentro del local. Escaneó el código QR pegado en la mesa (modo mesa) o abrió el enlace de la carta que le mandaron o encontró (carta por sucursal). No instala nada ni crea una cuenta. Puede ser una persona mayor, alguien con poca experiencia digital o alguien que lee con prisa mientras conversa; usa una mano, con luz del salón o sol de terraza.

Quien lo atiende (Mozo, Cajero) usa la PWA de `apps/app`; esa superficie tiene su propio diseño ("Azulejo") y no se mezcla con esta.

## Product Purpose

Que el cliente vea **qué hay y a cuánto**, sin esperar a que le traigan la carta, y, en la mesa, que **arme su pedido y lo mande al mozo**, o que **llame al mozo** o **pida la cuenta**, con un toque. Nada se cobra aquí y nada llega a cocina solo: el pedido es un aviso que el Mozo revisa con el cliente (criterio 72 de la historia 005).

Éxito: en menos de 10 segundos desde que abre la carta el cliente encuentra un plato y su precio; en la mesa, manda un pedido de tres platos en menos de un minuto y sabe, con palabras, si el mozo ya lo vio. Una carta que carga rápido con datos móviles: la primera vista, de 400 kB como máximo (criterio 88).

## Positioning

La carta es **del restaurante**, no nuestra: lleva su logo, su nombre y su color, y lo demás se aparta. Rápida, sin cuenta, sin descargas, sin publicidad, sin pedirle datos al cliente.

## Tone and Voice

Español de Perú, **trato de tú**, frases cortas y directas, sin jerga técnica y sin exclamaciones. Los errores dicen qué pasó y qué hacer ("Ya avisamos al mozo", "Se agotó", "Habla con el mozo"); nunca un código ni "ocurrió un error". Se dice "mozo", "carta", "cuenta", "pedido", "mesa"; no "orden", "ticket" ni "checkout". Los montos, como `S/ 28.00`.

## Operating Context

- **Sin cuenta ni sesión.** El pedido vive en el navegador de ese cliente (`sessionStorage`, por código de mesa) y sobrevive a una recarga; nada de él se guarda en el servidor hasta que lo envía.
- **Conexión inestable.** Un envío que no llega se reintenta con el mismo `id`; la pantalla dice "Sin conexión. Lo enviaremos cuando vuelva". El mozo nunca recibe dos veces el mismo pedido.
- **Un solo aviso a la vez.** Con un llamado pendiente se apagan los envíos y la pantalla lo dice ("Ya avisamos al mozo"); el estado se consulta cada 10 s y se explica en palabras.
- **Los platos se agotan.** La carta oculta lo agotado sin recargarse; en el pedido, una línea agotada queda marcada "Se agotó" y no deja enviar hasta quitarla.
- **El código de la mesa es privado.** El modo mesa no se guarda, no se indexa y no sale en el `Referer`.

## Capabilities and Constraints

- Sin `packages/ui` ni fuentes web: el CSS y el JavaScript son propios y mínimos. Presupuesto de peso del criterio 88.
- Los montos y las reglas (`calcularLinea`, `totalOrden`, `validarSeleccion`, `colorDeMarcaAccesible`) salen de `packages/dominio`; la interfaz solo las muestra.
- La carta se lee completa **sin JavaScript**; el JavaScript solo añade disponibilidad en vivo y el modo mesa.
- Desde 320 px sin desplazamiento horizontal; controles táctiles de 48 px o más.
- Chrome para Android y Safari para iPhone recientes.

## Brand Commitments

La marca que se ve es la **del restaurante**: su logo, su nombre y su color principal (un `#RRGGBB` que elige el Administrador). El color se usa tal como lo eligió: pasa por `colorDeMarcaAccesible`, que no lo cambia y decide si el texto encima es blanco o casi negro (4.5:1), y por `colorDeMarcaSobreBlanco` para lo que va sobre fondo blanco (3:1). No hay marca de nuestro producto en la pantalla del cliente.

## Evidence on Hand

No hay logos, fotos ni textos reales de ningún restaurante. La muestra de diseño (`diseno/carta-web.html`) usa un restaurante inventado ("Sabor Norteño"), ilustraciones sencillas en lugar de fotos y precios de ejemplo; todo está rotulado como ejemplo y nada de eso se publica.

## Product Principles

1. **Mostrar, no persuadir.** El cliente ya decidió venir: lista, foto, nombre, precio y un botón. Nada compite con eso.
2. **El restaurante firma la pantalla.** Logo, nombre y color arriba; el resto es neutro para que cualquier color de marca funcione.
3. **El estado se dice con palabras.** Enviado, atendido, vencido, agotado, sin conexión: siempre con texto y un icono, nunca solo con color.
4. **Nada se pierde ni se duplica.** Lo armado se conserva, el reintento no repite, y la pantalla dice cuándo está esperando.
5. **Con una mano y poca señal.** Lo que se toca está abajo y grande; lo pesado (fotos, scripts) es lo mínimo.

## Accessibility & Inclusion

- WCAG 2.2 AA: contraste 4.5:1 en texto y 3:1 en controles; foco visible de 3 px; controles de 48 px o más; `lang="es-PE"`.
- El color de la marca se usa **de relleno** (cabecera, botón principal, "+") con texto blanco o casi negro encima, el que alcance 4.5:1; sobre fondo blanco solo como indicador (casilla, radio) si contrasta 3:1, y nunca como texto, para que cualquier color de restaurante cumpla el contraste sin cambiarlo.
- Los precios se leen completos ("28 soles"); los avisos y errores van en `aria-live`; las hojas son diálogos con el foco atrapado y devuelto.
- Texto al 200 % sin cortes; `prefers-reduced-motion` sin animaciones.

## Decisiones abiertas

- Si los llamados se seguirán consultando cada 10 s o si algún día convendrá un canal en vivo (decisión de 005: consulta cada 10 s).
