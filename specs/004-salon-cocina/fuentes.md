# Fuentes: Salón, Cocina e Impresión básica

- **Fecha de extracción:** 2026-10-28
- **Requerimientos e historias de usuario:** https://claude.ai/artifact/SfRCerAMxTQsFNL23bTuQq (rev. 25)
- **Documento de diseño:** https://claude.ai/artifact/1YzRwiYqDapgyVCBsHK2Gd (rev. 21)

> Extracto literal para el especificador; ante discrepancia, mandan los documentos compartidos.

Notas de extracción (no forman parte de los documentos):

- El texto se copia tal cual, solo de las partes que tocan al Salón, a Cocina y barra y a la Impresión. Las comillas rectas (`"Enviar"`, `"ESPERAR"`, `"MARCHAR"`, `"Listo"`, `"Clave"`) están así en los documentos.
- `[…]` marca texto omitido entre fragmentos de una misma sección.
- Todos los bloques pedidos se encontraron. En "Infraestructura" no hay nada sobre el puente ni sobre WebSocket (se revisaron la tabla y los párrafos de la sección), así que no se copia nada de ella.
- RF-33 y RF-34 están en la tabla "Salón y pedidos" del documento de requerimientos, no en "Caja", "Delivery y carta web" ni "Inventario". Se copian en su tabla y se repiten en la tabla de contexto.
- Se añadieron, además de lo pedido, fragmentos del diseño que mencionan el puente, WebSocket o el modo offline: los dos párrafos que rodean la tabla de "Decisiones de arquitectura", el párrafo "Para poder agregar el modo offline más adelante", la viñeta del puente para Windows de "Después del MVP" y el párrafo "Fuera de alcance" de "Alcance", la frase de entrada de "Flujos de operación" y el párrafo de entrada de "Roles y permisos" (define "Clave").
- La sección "Decisiones de arquitectura" incluye un diagrama (widget, "arquitectura · local, nube y servicios externos") que no se copia. El diagrama de "Estados" es otro widget: su contenido no se exporta con el texto del documento; se copia el texto que lo rodea y, aparte y marcada como transcripción, la lista de etiquetas que dibuja (leída del código del widget).
- En el modelo de datos, la fila "Carta" cambió respecto de `specs/003-carta/fuentes.md` (rev. 17): ahora termina en ", Agotado por sucursal, Opción del menú del día (por sucursal y día)". El encabezado de la lista del modelo se llama "Decisiones clave:" (003 lo citó como "Decisiones del modelo").

---

## Parte 1. Documento de requerimientos e historias de usuario

### Origen: "Actores" (los que tocan a esta sección)

| Actor               | Qué hace                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Mozo                | Atiende las mesas: las abre, comanda, agrega adiciones e imprime la pre-cuenta            |
| Cocina / Barra      | Recibe las comandas en impresora o KDS, marca platos listos, agotados y porciones del día |
| Puente de impresión | App Android del local que imprime en las impresoras de cocina, barra y caja               |

### Origen: "Requerimientos funcionales" · **Salón y pedidos**

| ID    | Requerimiento                                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-22 | Diseñar el mapa de mesas por zonas: posición, forma y capacidad                                                                                       |
| RF-23 | Mostrar el estado de cada mesa en tiempo real: libre (verde), ocupada (rojo) o en pre-cuenta (amarillo)                                               |
| RF-24 | Abrir una mesa con el número de comensales y el mozo responsable                                                                                      |
| RF-25 | Tomar pedidos buscando por familia y mostrando el stock disponible de cada producto                                                                   |
| RF-26 | Agregar a cada ítem modificadores, observaciones libres, tiempo de servicio (1 o 2) y marca de para llevar                                            |
| RF-27 | Enviar la comanda: cada ítem, o componente de combo, va a la estación de su producto; las adiciones salen marcadas como adición                       |
| RF-28 | "Marchar" los ítems de segundo tiempo, con aviso a la estación                                                                                        |
| RF-29 | Editar o borrar sin clave los ítems no enviados; anular los enviados con clave, motivo y destino del stock, con un ticket de anulación en la estación |
| RF-30 | Mover la cuenta de una mesa a otra                                                                                                                    |
| RF-31 | Unir varias mesas en una sola cuenta                                                                                                                  |
| RF-32 | Imprimir la pre-cuenta; si luego se agregan ítems, invalidarla y devolver la mesa a ocupada                                                           |
| RF-33 | Aplicar descuentos (por ítem o por cuenta, en porcentaje o monto) y cortesías, con clave y motivo                                                     |
| RF-34 | Registrar ventas rápidas en mostrador: cobro primero y número de llamado                                                                              |
| RF-35 | Anular una orden abierta con clave de supervisor                                                                                                      |

### Origen: "Requerimientos funcionales" · **Cocina y barra**

| ID    | Requerimiento                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| RF-36 | Mostrar en el KDS las comandas de cada estación en orden de llegada, con tiempo transcurrido, tiempo de servicio y observaciones |
| RF-37 | Marcar ítems en preparación y listos desde el KDS, con aviso al mozo en la app                                                   |
| RF-38 | Cargar las porciones del día de cada plato                                                                                       |
| RF-39 | Reportar quiebres de stock marcando productos como agotados                                                                      |

### Origen: "Requerimientos funcionales" · **Impresión**

| ID    | Requerimiento                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-75 | Vincular la app puente a una sucursal escaneando un QR                                                                                           |
| RF-76 | Configurar las impresoras de cada sucursal: conexión (red o Bluetooth), ancho de papel (58 u 80 mm), juego de caracteres y gaveta                |
| RF-77 | Encolar los trabajos de impresión y reenviarlos al reconectarse el puente; avisar en la app cuando una impresora o el puente están desconectados |
| RF-78 | Imprimir una página de prueba y reimprimir tickets                                                                                               |

### Origen: "Historias de usuario" · **Salón**

- **HU-10 Abrir mesa.** Como mozo, quiero abrir una mesa desde el mapa indicando los comensales, para empezar la atención.
  - La mesa pasa de verde a rojo en todos los equipos al instante.
  - Quedo registrado como mozo responsable.
- **HU-11 Tomar pedido.** Como mozo, quiero buscar productos por familia y ver cuántos quedan, para no ofrecer lo que no hay.
  - Cada producto con control de stock muestra su cantidad disponible.
  - Puedo agregar modificadores, observaciones, tiempo (1 o 2) y marca de para llevar.
- **HU-12 Enviar comanda.** Como mozo, quiero enviar el pedido y que cada ítem llegue a su estación, para que barra y cocina trabajen en paralelo.
  - Las bebidas van a barra y los platos a cocina, según la estación de cada producto.
  - El ticket sale en menos de 5 segundos.
  - Los ítems de segundo tiempo salen marcados "ESPERAR".
- **HU-13 Marchar segundo tiempo.** Como mozo, quiero marchar los platos de fondo cuando la mesa termina la entrada, para que salgan a tiempo.
  - La estación recibe un aviso "MARCHAR" con la mesa y los ítems.
- **HU-14 Adición.** Como mozo, quiero agregar ítems a una mesa abierta, para atender pedidos extra.
  - El ticket sale marcado como adición.
  - Si la mesa estaba en pre-cuenta, vuelve a ocupada.
- **HU-15 Anular ítem.** Como mozo, quiero anular un ítem ya enviado con la clave del supervisor, para corregir errores sin perder el control.
  - Antes de enviar, el ítem se borra sin clave.
  - Después de enviar, se piden clave, motivo y si el stock vuelve o es merma.
  - La estación recibe un ticket de anulación.
- **HU-16 Mover y unir mesas.** Como mozo, quiero mover una cuenta a otra mesa o juntar mesas, para acomodar a los clientes.
  - Al mover, la mesa original queda libre.
  - Las mesas unidas comparten una sola cuenta y se ven como grupo en el mapa.
- **HU-17 Pre-cuenta.** Como mozo, quiero imprimir la pre-cuenta, para que el cliente revise su consumo.
  - La mesa pasa a amarillo.
- **HU-18 Venta en mostrador.** Como cajero, quiero cobrar primero y enviar el pedido con un número de llamado, para atender rápido en mostrador.
  - El ticket de cocina y el comprobante muestran el número de llamado.

### Origen: "Historias de usuario" · **Cocina y barra**

- **HU-19 Pantalla KDS.** Como cocinero, quiero ver las comandas de mi estación en orden de llegada con su tiempo de espera, para preparar en orden.
  - Se ven el tiempo de servicio, los modificadores y las observaciones.
  - Al marcar "Listo", el mozo recibe un aviso en la app.
- **HU-20 Porciones del día.** Como cocinero, quiero cargar cuántas porciones preparé, para que el sistema avise y bloquee la venta al agotarse.
  - Cada venta descuenta una porción; en cero, el plato se marca agotado.

### Origen: "Historias de usuario" · **Impresión**

- **HU-38 Vincular el puente.** Como administrador, quiero vincular el Android de caja como puente de impresión escaneando un QR, para imprimir en cocina, barra y caja.
  - Se configuran las impresoras de red o Bluetooth, el ancho de papel y la gaveta.
  - Se puede imprimir una página de prueba.
- **HU-39 Aviso de impresora desconectada.** Como mozo, quiero saber si una impresora o el puente están desconectados, para avisar a cocina.
  - Los tickets quedan en cola y se imprimen al reconectarse.

### Origen: "Requerimientos funcionales" · otros módulos que dependen del Salón (contexto, no son de esta sección)

| ID    | Requerimiento                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-33 | Aplicar descuentos (por ítem o por cuenta, en porcentaje o monto) y cortesías, con clave y motivo                                                                    |
| RF-34 | Registrar ventas rápidas en mostrador: cobro primero y número de llamado                                                                                             |
| RF-46 | Mostrar los pedidos pendientes en la bandeja con alerta sonora, confirmarlos o rechazarlos, y vencerlos a los 30 minutos                                             |
| RF-47 | Registrar pedidos telefónicos desde la bandeja                                                                                                                       |
| RF-51 | Cobrar con uno o varios medios de pago (efectivo, tarjeta de crédito o débito, Yape, Plin), calculando el vuelto y registrando el número de operación o voucher      |
| RF-52 | Dividir la cuenta por ítems o en partes iguales, con un comprobante por parte                                                                                        |
| RF-55 | Cerrar el turno con Z: conteo físico por medio de pago y motivo obligatorio para cada diferencia; impedir el cierre del último turno si hay mesas o pedidos abiertos |
| RF-56 | Abrir la gaveta de dinero al cobrar en efectivo                                                                                                                      |
| RF-67 | Llevar el stock por sucursal según el tipo de control de cada producto: por unidades, por porciones del día o sin control                                            |
| RF-68 | Descontar el stock al enviar a cocina, incluidos los componentes de combos y los modificadores ligados a productos                                                   |
| RF-69 | Bloquear la venta en cero para los productos por porciones; para los productos por unidades, avisar y permitir, o bloquear si la sucursal lo configura               |
| RF-70 | Marcar como agotado, automáticamente, un producto por porciones que llega a cero                                                                                     |

### Origen: "Requerimientos no funcionales" (los que aplican)

| ID     | Categoría      | Requerimiento                                                                                                                                          |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RNF-01 | Disponibilidad | 99.5 % al mes, es decir, como máximo unas 3.5 horas de caída; los mantenimientos se hacen de madrugada                                                 |
| RNF-02 | Rendimiento    | La comanda se imprime o aparece en el KDS en menos de 5 segundos desde que se pulsa "Enviar"                                                           |
| RNF-03 | Rendimiento    | Las pantallas de operación responden en menos de 1 segundo                                                                                             |
| RNF-06 | Seguridad      | Aislamiento de los datos de cada empresa en la base de datos (RLS)                                                                                     |
| RNF-09 | Auditoría      | Registro que no se puede modificar de las acciones protegidas: quién, qué, cuándo y quién autorizó                                                     |
| RNF-10 | Resiliencia    | Reintento automático de operaciones ante microcortes, sin duplicados                                                                                   |
| RNF-11 | Compatibilidad | La PWA funciona en Chrome para Android y en Safari para iPhone y iPad, en versiones recientes                                                          |
| RNF-12 | Compatibilidad | El puente de impresión funciona en Android 10 o superior, con impresoras ESC/POS genéricas de 58 y 80 mm                                               |
| RNF-13 | Usabilidad     | Interfaz táctil para tablets y celulares, y carta web liviana para datos móviles                                                                       |
| RNF-17 | Mantenibilidad | TypeScript en todo el sistema, código compartido para los cálculos y pruebas automáticas de montos e impuestos                                         |
| RNF-19 | Monitoreo      | Seguimiento de errores, de la conexión de los puentes y de los envíos al PSE, con alertas al equipo                                                    |
| RNF-20 | Trazabilidad   | Cada registro de datos de clientes guarda quién lo creó y quién lo modificó por última vez: usuario y equipo, superadministrador o proceso del sistema |

### Origen: "Fuera del alcance del MVP" (lo que toca al Salón, la impresión o el modo offline)

- Modo offline con un servidor en el local, para clientes grandes.

[…]

- Exportación contable y puente de impresión para Windows.

---

## Parte 2. Documento de diseño

### Origen: "Decisiones de arquitectura"

El sistema corre solo en la nube, sin modo offline. En el local solo hay navegadores y un Android que hace de puente de impresión.

[…] (diagrama "arquitectura · local, nube y servicios externos", no se copia)

Los equipos del local solo usan el navegador, salvo el Android de caja, que recibe los tickets por WebSocket y los imprime. Todo lo demás, incluidas las colas de tareas, corre en la nube sobre PostgreSQL.

| Tema        | Decisión                                                                                                     | Motivo                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| […]         |                                                                                                              |                                                                        |
| Tiempo real | WebSockets                                                                                                   | Mapa de mesas, KDS y bandeja de pedidos al instante                    |
| Impresión   | App puente en un Android del local, impresoras genéricas de red o Bluetooth, y pantalla KDS como alternativa | Ni el navegador ni la nube pueden imprimir directo en la red del local |
| […]         |                                                                                                              |                                                                        |

**Si falla internet:**

- **Microcortes:** la app guarda lo que no pudo enviar y lo reintenta. Las operaciones no se duplican si se repiten.
- **Caída de internet:** se comparten datos móviles desde un celular.
- **Caída larga:** comandas en papel y talonario de contingencia de SUNAT. Al volver la conexión, el cajero registra esas ventas.

**Para poder agregar el modo offline más adelante** sin reescribir la aplicación: identificadores UUID, cálculos en código compartido, operaciones que no se duplican al repetirse, e impresión y facturación detrás de conectores.

### Origen: "Alcance"

**Entra en el MVP:**

[…]

- **Salón:** mapa de mesas, apertura, comandas y adiciones, tiempos 1 y 2, pre-cuenta, mover y unir mesas, dividir la cuenta, y anulaciones, descuentos y cortesías con clave.
- **Mostrador:** venta rápida con cobro anticipado y número de llamado.
- **Cocina y barra:** impresión con el puente Android y pantalla KDS.

[…]

**Después del MVP (fases siguientes o planes premium):**

[…]

- Exportación contable y puente de impresión para Windows.

[…]

**Fuera de alcance:** propinas, integración con Rappi o PedidosYa, puente de impresión en iPhone y otras monedas distintas del sol.

### Origen: "Flujos de operación"

Todos los pedidos (mesa, mostrador, para llevar y delivery) pasan por el mismo circuito: comanda, cocina o barra, caja y SUNAT.

**Atención en mesa**

1. El mozo abre la mesa en el mapa e indica los comensales. Queda como mozo responsable, y la mesa pasa de verde (libre) a rojo (ocupada).
2. Toma el pedido por familias, viendo cuánto stock queda de cada producto. Agrega modificadores, observaciones y el tiempo de servicio (1 o 2).
3. Al pulsar "Enviar", cada ítem va a la impresora o KDS de su estación: barra, cocina, parrilla o fríos. Los de segundo tiempo salen marcados "ESPERAR" hasta que el mozo pulsa "Marchar".
4. Las adiciones generan un ticket nuevo marcado como adición.
5. El mozo o el cajero imprime la pre-cuenta y la mesa pasa a amarillo. Si piden algo más, vuelve a rojo y se imprime una pre-cuenta nueva.
6. El cajero cobra: elige boleta o factura (detallada o por consumo), pide RUC o DNI cuando corresponde, registra los medios de pago y calcula el vuelto.
7. El comprobante se emite a través del PSE y la mesa vuelve a verde.

**Venta rápida en mostrador**

1. El cajero registra el pedido y cobra primero.
2. El pedido pasa a cocina con un número de llamado.

[…]

**Rutina diaria**

- **Apertura:** revisar que el puente y las impresoras estén conectados, abrir la caja con el fondo inicial, cargar las porciones del día y marcar los productos agotados.
- **Cierre:** comprobar que no queden mesas ni pedidos abiertos, hacer el arqueo con conteo físico por medio de pago, cerrar con Z y revisar los comprobantes pendientes o rechazados. El resumen diario de boletas lo envía el PSE, y el resumen de ventas queda en el panel de reportes.

### Origen: "Reglas de negocio" · **Ventas y precios** […]

- Las cortesías requieren clave de supervisor; descuentan stock y no se cobran. Su tratamiento tributario lo define el contador.
- Los descuentos pueden ser por ítem o por cuenta, siempre con clave de supervisor y motivo.

### Origen: "Reglas de negocio" · **Salón y pedidos**

- Antes de enviar a cocina, un ítem se corrige libremente. Después, anularlo exige clave de supervisor, un motivo y decidir si el stock vuelve o es merma.
- Cualquier mozo puede agregar pedidos a cualquier mesa. Las ventas se atribuyen al mozo que la abrió.
- Unir mesas crea una sola orden con varias mesas. Mover una cuenta es cambiar la mesa de su orden.
- Agregar ítems después de la pre-cuenta la invalida, y la mesa vuelve a ocupada.

### Origen: "Inventario" · **Reglas:** […]

- **Anulaciones:** si se anula un ítem ya enviado, el supervisor decide si el stock vuelve o es merma.
- **Combos y modificadores:** un combo descuenta sus componentes. Un modificador ligado a un producto descuenta ese producto; por ejemplo, elegir Inca Kola en el combo descuenta una Inca Kola.
- **Stock visible:** el comandero muestra cuántas unidades quedan, y la carta web oculta lo agotado.

### Origen: "Modelo de datos"

| Módulo    | Entidades                                                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| […]       |                                                                                                                                                                                                           |
| Carta     | Familia, Producto, Ajuste del producto por sucursal, Grupo de modificadores, Modificador, Componente de combo, Estación de producción, Agotado por sucursal, Opción del menú del día (por sucursal y día) |
| Salón     | Zona, Mesa                                                                                                                                                                                                |
| Pedidos   | Orden, Mesas de la orden, Ítem, Comanda, Datos de entrega, Cliente                                                                                                                                        |
| […]       |                                                                                                                                                                                                           |
| Impresión | Puente, Impresora, Trabajo de impresión                                                                                                                                                                   |
| […]       |                                                                                                                                                                                                           |

**Decisiones clave:**

- **Identificadores UUID** en todas las tablas.
- **Las ventas guardan cómo eran al venderse:** el ítem guarda su precio y sus modificadores, y el comprobante, los datos del cliente. Un cambio de precio no altera las ventas pasadas.
- **Opciones como modificadores:** las opciones de un combo y los platos del menú del día son modificadores ligados a productos.
- **El tipo de un producto se puede cambiar:** lo que deja de aplicar (componentes, estación, opciones del día) se quita con confirmación y queda en la auditoría; las ventas guardan su propia copia. Un producto usado como componente u opción de un combo no puede pasar a combo.
- **Una orden puede tener varias mesas**, así se resuelve unir mesas. El estado de la mesa se calcula a partir de su orden abierta; no se guarda aparte.
- **Cada orden tiene un tipo** (mesa, mostrador, para llevar o delivery) **y un canal** (salón, web o teléfono). Los datos de entrega van en su propia tabla, para crecer al delivery completo sin tocar lo demás.
- **El pedido web es una orden más,** en estado pendiente.
- **Las estaciones se definen por empresa.** Cada sucursal asocia cada estación a una impresora o a una pantalla KDS.
- **Dividir la cuenta genera varios comprobantes** para la misma orden, cada uno con sus pagos.
- **Los montos se guardan con decimales exactos,** nunca como números de coma flotante.

### Origen: "Estados"

Cada objeto avanza por pocos estados y las excepciones quedan registradas. El control principal está en el ítem: desde que se envía a cocina, anularlo exige clave de supervisor.

[Diagrama (widget) "estados de mesa, orden, ítem, comprobante y turno": su contenido no se exporta con el texto del documento.]

Los colores de la mesa son los del mapa: verde, rojo y amarillo. Los bordes punteados marcan excepciones o pasos que solo existen con pantalla KDS. La pre-cuenta es opcional: una mesa ocupada también puede cobrarse directamente.

> **Transcripción de las etiquetas del diagrama** (nota de extracción, no es texto del documento; leída del código del widget: las etiquetas son literales, las flechas se describen según cómo están dibujadas).
>
> - Título: "Desde que un ítem se envía a cocina, anularlo exige clave de supervisor".
> - **Mesa:** Libre → (abrir) → Ocupada → (pre-cuenta) → En pre-cuenta. De En pre-cuenta a Ocupada: (adición). De En pre-cuenta y de Ocupada a Libre: (cobro total). Libre, Ocupada y En pre-cuenta van en verde, rojo y amarillo.
> - **Orden:** Pendiente (web) → Abierta → En pre-cuenta → Cerrada. Con borde punteado: de Pendiente (web) a "Rechazada o vencida"; de Abierta a "Anulada (con clave)".
> - **Ítem:** Por enviar → Enviado → En preparación → Listo. En preparación y Listo van con borde punteado, con la nota "Preparación y Listo: solo con KDS". Con borde punteado: de Por enviar a "Se borra sin clave"; de Enviado a "Anulado (clave, motivo, stock)" (resaltado).
> - **Comprobante:** Por enviar → Enviado → Aceptado → Anulado, con la nota "con nota de crédito o baja". Con borde punteado: de Enviado a "Rechazado: se corrige y se emite otro".
> - **Turno de caja:** Abierto → Cerrado con Z, con la nota "X en cualquier momento; la Z es definitiva".

### Origen: "Roles y permisos"

Cinco roles por sucursal, más un superadministrador de nuestra empresa. "Clave" significa que la acción procede si un supervisor escribe su PIN en ese momento, y queda registrado quién autorizó.

| Acción                                                                                | Mozo  | Cajero                                                         | Cocina/Barra | Supervisor  | Administrador        |
| ------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------- | ------------ | ----------- | -------------------- |
| Abrir mesa, comandar, adiciones y pre-cuenta                                          | ✓     | ✓                                                              | —            | ✓           | ✓                    |
| Mover y unir mesas                                                                    | ✓     | ✓                                                              | —            | ✓           | ✓                    |
| Anular ítem enviado, aplicar descuento o cortesía                                     | clave | clave                                                          | —            | ✓           | ✓                    |
| Confirmar pedidos web y registrar pedidos por teléfono                                | —     | ✓                                                              | —            | ✓           | ✓                    |
| Cobrar, dividir la cuenta y emitir comprobantes                                       | —     | ✓                                                              | —            | ✓           | ✓                    |
| Emitir nota de crédito                                                                | —     | clave                                                          | —            | ✓           | ✓                    |
| Abrir y cerrar caja, reportes X y Z, ingresos y egresos                               | —     | ✓                                                              | —            | ✓           | ✓                    |
| Usar el KDS y marcar platos listos                                                    | —     | —                                                              | ✓            | ✓           | ✓                    |
| Marcar agotados (86), cargar porciones del día y elegir las opciones del menú del día | —     | —                                                              | ✓            | ✓           | ✓                    |
| Registrar ingresos de mercadería                                                      | —     | ✓                                                              | —            | ✓           | ✓                    |
| Ajustes de stock y mermas                                                             | —     | —                                                              | —            | ✓           | ✓                    |
| Editar la carta y los precios                                                         | —     | ✓ (precio y disponibilidad por sucursal, solo donde es Cajero) | —            | —           | ✓                    |
| Usuarios, sucursales, equipos y configuración                                         | —     | —                                                              | —            | —           | ✓                    |
| Reportes                                                                              | —     | Su turno (X)                                                   | —            | Su sucursal | Todas las sucursales |

Las estaciones de producción y su asociación a impresoras o KDS las define solo el Administrador.

- Un usuario puede tener un rol distinto en cada sucursal. En un negocio pequeño, una sola persona puede ser Administrador y hacerlo todo.
- El Cajero incluye todo lo que hace el Mozo.
- El superadministrador gestiona empresas, sucursales y suscripciones. Puede entrar a la cuenta de un cliente para darle soporte, siempre con registro en la auditoría.

### Origen: "Pendientes de validar" (lo que toca a impresoras y al puente)

El diseño está cerrado. Faltan estas validaciones y definiciones comerciales antes de salir a producción.

[…]

- [ ] Probar modelos de impresoras genéricas (58 y 80 mm, de red y Bluetooth) y armar la lista recomendada.
- [ ] Preparar la guía de configuración del puente por marca de Android, para evitar que el ahorro de batería lo cierre.

[…]
