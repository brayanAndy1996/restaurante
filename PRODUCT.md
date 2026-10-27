# Product

<!-- impeccable:product-schema 1 -->

> Estado: aprobado por el usuario (2026-10-27). Los hechos salen de `CLAUDE.md`, de los documentos compartidos (extractos en `specs/002-plataforma-y-acceso/fuentes.md`) y del encargo del orquestador. Lo que sigue marcado con "(inferido)" no fue confirmado de forma directa; lo pendiente está en "Decisiones abiertas".

## Platform

web

## Stack

Ya decidido por el proyecto: `apps/app` es React + Vite instalada como PWA; `packages/ui` guarda los tokens y los componentes base compartidos con `apps/web` más adelante. La web comercial y la carta web (Next.js, `apps/web`) son otras superficies y tendrán su propio brief.

## Users

Personal de restaurantes pequeños del Perú que usa **su propio celular** (no hay tablets del local) durante el servicio:

- **Mozo:** abre mesas y comanda de pie, con una mano, entre mesas. Entra muchas veces al día con PIN de 4 dígitos.
- **Cajero:** cobra, emite comprobantes, maneja la caja. PIN de 6 dígitos. Pide la clave de un supervisor en acciones protegidas.
- **Cocina / Barra:** marca platos listos; mira la pantalla con las manos ocupadas o mojadas.
- **Supervisor:** autoriza con su PIN desde el celular de quien pide (sin recibir el equipo), ajusta stock, ve reportes de su sucursal.
- **Administrador (con frecuencia, el dueño):** configura usuarios, horarios, equipos y carta; ve todas las sucursales; recibe los avisos de suscripción. En un negocio pequeño puede ser también quien atiende.
- **Superadministrador:** personal de nuestra empresa. Da de alta clientes, registra pagos y entra a dar soporte. Trabaja en un panel, normalmente en computadora, pero la PWA es la misma.

Situación: de pie, con prisa, luz variable del local (salón con poca luz, cocina con vapor y luz fuerte), datos móviles o wifi inestable, una mano ocupada. Pantallas desde 360 px. Español de Perú, montos en soles (S/). (inferido: gama media de Android con Chrome; también iPhone con Safari, según RNF-11.)

## Product Purpose

Sistema en la nube, alquilado por sucursal, que cubre salón, cocina y barra, caja, delivery por WhatsApp, inventario y facturación electrónica. La app del personal (`apps/app`) es lo que cada trabajador abre en su celular para atender. Esta primera sección (002, "Plataforma y acceso") es la puerta: que cada persona entre rápido con su propio usuario, que el supervisor autorice acciones protegidas sin pasarse el equipo, que el administrador controle quién entra, cuándo y desde qué celulares, y que nuestro equipo gestione clientes y suscripciones.

Éxito: un mozo pasa de bloquear el celular a estar dentro de su mesa en menos de 5 segundos con su PIN; nadie entra a datos de otra empresa; ningún cobro o anulación ocurre sin saber quién la pidió y quién la autorizó.

## Positioning

Un sistema hecho para el celular propio del trabajador peruano, no para una tablet fija del local: el equipo "recuerda" a hasta 5 personas y se entra con PIN, y el supervisor autoriza con su PIN desde el celular de quien pide. Facturación electrónica incluida en el precio por sucursal, usuarios y dispositivos ilimitados.

## Operating Context

- **Acceso en dos pasos:** la primera vez en un celular, usuario y contraseña; desde entonces PIN, con elección de la persona entre las que el equipo recuerda (máximo 5). PIN de 4 dígitos (Mozo, Cocina/Barra) o 6 (Cajero, Supervisor, Administrador).
- **Seguridad visible:** bloqueos temporales con cuenta regresiva, sesión que se cierra por inactividad (por defecto 5 minutos con PIN, 30 con contraseña), horario de acceso por trabajador (hora de Lima), contraseña temporal que se cambia al primer ingreso.
- **Clave de supervisor:** ventana con PIN de 6 dígitos y motivo; la auditoría guarda quién pidió, quién autorizó, el motivo y la hora.
- **Suscripción:** estados activa, en gracia (7 días por defecto) y suspendida. La suspensión solo impide abrir caja; nunca corta un turno abierto ni la consulta y exportación de datos. El administrador ve avisos persistentes.
- **Soporte:** el superadministrador entra a la cuenta de un cliente con motivo, hasta 2 horas, y la app muestra en todo momento quién da soporte.
- **Conexión:** solo nube, sin modo offline. Ante microcortes la app guarda lo que no pudo enviar y reintenta sin duplicar (clave de idempotencia). Caída larga: comandas en papel.
- **Equipos compartidos:** celulares personales que a veces se prestan; por eso la PWA nunca guarda PIN ni contraseña.

## Capabilities and Constraints

- Idioma único: español de Perú. Moneda única: sol (S/), formato `S/ 1,234.50`. Hora y fechas de Lima.
- Toda cifra de monto la calcula `packages/dominio`; la interfaz solo la muestra.
- Cada rol ve solo lo que puede hacer; las acciones no permitidas no aparecen (no se muestran deshabilitadas sin explicación).
- Controles táctiles de al menos 44 x 44 px; pantallas desde 360 px; teclado numérico propio para PIN.
- Paquete inicial liviano; la administración y el panel de plataforma se cargan bajo demanda.
- Términos del negocio: Mozo, Cajero, Cocina/Barra, Supervisor, Administrador, Superadministrador, sucursal, equipo, PIN, clave de supervisor, comanda, sin prefijos ingleses.
- Navegadores: Chrome para Android y Safari para iPhone y iPad, versiones recientes (RNF-11).

## Brand Commitments

Ninguno confirmado. No hay nombre comercial, logotipo ni colores de marca definidos todavía (ver "Decisiones abiertas"). La web comercial (Persuade) es otra superficie.

## Evidence on Hand

- Documentos compartidos y `specs/002-plataforma-y-acceso/` con los criterios de interfaz 92 a 104.
- No hay capturas, logotipos, fotos de locales ni testimonios. Nada de eso se inventa: las pantallas de demostración usan datos sintéticos rotulados como tales.

## Product Principles

1. **Rapidez bajo presión.** Lo más frecuente (entrar con PIN, cambiar de persona) se hace con un toque o un teclado grande, sin leer. Cada pantalla tiene una sola acción principal.
2. **El estado nunca es ambiguo.** Bloqueado, sin conexión, sesión por vencer, sucursal suspendida, modo soporte: siempre dicho con palabras y con un lugar fijo, no solo con color.
3. **Confianza sin ruido.** Acciones que cuestan dinero o dejan rastro (anular, autorizar, olvidar un equipo) piden confirmación clara y dicen qué pasará; las demás no interrumpen.
4. **Nada se pierde por un corte.** Lo escrito se conserva, las escrituras se reintentan y la pantalla dice cuándo está esperando la red.
5. **Un celular compartido es un celular ajeno.** La interfaz nunca deja a la vista un secreto: PIN oculto, PIN nuevo mostrado una sola vez, sesiones que se cierran solas.

## Accessibility & Inclusion

- WCAG 2.2 AA como mínimo: contraste 4.5:1 en texto, 3:1 en controles y estados; foco visible; objetivos táctiles de 44 px o más (WCAG 2.5.8 exige 24 px; aquí se sube por el uso con prisa y con una mano).
- El color nunca es la única señal: todo estado lleva texto o icono.
- Uso al aire libre o con poca luz y con las manos sucias o mojadas: controles grandes y separados, sin gestos finos ni arrastres obligatorios.
- Respeto de `prefers-reduced-motion`; movimiento mínimo.
- Texto escalable hasta 200 % sin romper la pantalla; lectores de pantalla con etiquetas en español.
- Usuarios con poca experiencia digital (inferido): lenguaje directo, sin jerga técnica en los mensajes ("Tu usuario o contraseña no son correctos", no "401").

## Decisiones del usuario (2026-10-27)

- **Dirección de diseño "Azulejo"** (`DESIGN.md`, muestra en `diseno/direccion-azulejo.html`): aprobada para la app del restaurante.
- **Tema claro** por ahora. El tema oscuro queda para más adelante; los tokens de color son semánticos para sumarlo sin rehacer pantallas.
- **Tipografía:** Atkinson Hyperlegible Next, autoalojada (sin servidores de terceros: carga rápida con datos móviles y sin enviar datos a otros).
- **Trato de "tú"** en todo el texto de la interfaz ("Ingresa con tu usuario", "Tu contraseña no es correcta").
- **Extras incluidos en 002:** atajos de motivo en la ventana de clave de supervisor, cupos "3 de 5 personas" en la pantalla de PIN y aviso de "sesión por vencer" antes del cierre por inactividad.

## Decisiones abiertas

- Nombre comercial del producto y logotipo ("Restaurante" es solo el nombre de trabajo en las pantallas de muestra).
- Días de gracia y precios definitivos (pendientes de validar en el documento de diseño).
- Si el administrador quiere los avisos de suscripción también por WhatsApp (fuera del MVP: no hay WhatsApp automático).
