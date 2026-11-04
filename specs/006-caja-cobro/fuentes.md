# Fuentes de la sección 006: caja y cobro

Textos copiados textualmente de los documentos compartidos el 2026-11-04 (requerimientos rev. 45, diseño rev. 29). Los documentos mandan; esto es una copia de trabajo para el especificador. Cada bloque lleva el documento, el id del bloque y el título del apartado. Las notas entre corchetes son del orquestador, no de los documentos.

- Requerimientos: documento `cfd1a4e3-9a1a-4c84-9802-31e44cac4ee6` (https://claude.ai/artifact/SfRCerAMxTQsFNL23bTuQq), cuerpo `04aabe24-8b34`.
- Diseño: documento `0477730b-f166-494f-b417-c2a2dd5373be` (https://claude.ai/artifact/1YzRwiYqDapgyVCBsHK2Gd), cuerpo `5fb0a18a-a931`.

---

## A. Documento de requerimientos

### A.1 Actores (en lo que toca a caja)

Requerimientos · apartado «Actores» · párrafo `mf796fv0n4v.569` y tabla `mf796fv0n4v.639` (filas de Mozo, Cajero, Supervisor, Administrador y PSE)

Seis roles de personas y tres sistemas interactúan con la aplicación.

| Actor | Qué hace |
|---|---|
| Mozo | Atiende las mesas: las abre, comanda, agrega adiciones e imprime la pre-cuenta |
| Cajero | Todo lo del mozo, y además cobra, emite comprobantes, maneja la caja y los pedidos web y telefónicos |
| Supervisor | Autoriza acciones con su clave, ajusta stock y ve los reportes de su sucursal |
| Administrador | Configura la empresa, sucursales, carta, usuarios y equipos; ve todas las sucursales |
| PSE | Sistema externo que emite los comprobantes ante SUNAT |
| Puente de impresión | App Android del local que imprime en las impresoras de cocina, barra y caja |

### A.2 Requerimientos funcionales: Caja (RF-50 a RF-56)

Requerimientos · apartado «Requerimientos funcionales» > **Caja** · tabla `mf796fv0n4v.6803`

| ID | Requerimiento |
|---|---|
| RF-50 | Abrir un turno de caja con fondo inicial |
| RF-51 | Cobrar con uno o varios medios de pago (efectivo, tarjeta de crédito o débito, Yape, Plin), calculando el vuelto y registrando el número de operación o voucher |
| RF-52 | Dividir la cuenta por ítems o en partes iguales, con un comprobante por parte |
| RF-53 | Registrar ingresos y egresos de caja con su motivo |
| RF-54 | Emitir el reporte X en cualquier momento del turno |
| RF-55 | Cerrar el turno con Z: conteo físico por medio de pago y motivo obligatorio para cada diferencia; impedir el cierre del último turno si hay mesas o pedidos abiertos |
| RF-56 | Abrir la gaveta de dinero al cobrar en efectivo |

### A.3 Requerimientos funcionales: Facturación electrónica (RF-57 a RF-66)

Requerimientos · apartado «Requerimientos funcionales» > **Facturación electrónica** · tabla `mf796fv0n4v.7505`

| ID | Requerimiento |
|---|---|
| RF-57 | Emitir boleta o factura, detallada o por consumo, a través del PSE |
| RF-58 | Autocompletar y validar el RUC con el padrón de SUNAT, actualizado a diario |
| RF-59 | Exigir nombre y DNI en las boletas de más de S/ 700 |
| RF-60 | Calcular base imponible, IGV por línea, ICBPER, descuentos y redondeos según la tasa vigente del emisor |
| RF-61 | Asignar serie y correlativo por caja y tipo de comprobante |
| RF-62 | Emitir notas de crédito (anulación, devolución o cambio de boleta por factura) con clave de supervisor |
| RF-63 | Reintentar los envíos fallidos y mostrar en un panel con alertas el estado de cada comprobante: por enviar, enviado, aceptado, rechazado o anulado |
| RF-64 | Imprimir el comprobante con su QR y compartir su PDF por WhatsApp |
| RF-65 | Limitar los comprobantes según el régimen del emisor (en el Nuevo RUS, solo boletas) |
| RF-66 | Ofrecer un simulador de PSE para pruebas, demos y capacitación |

### A.4 Requerimientos funcionales: Salón y pedidos (filas que limitan con la caja)

Requerimientos · apartado «Requerimientos funcionales» > **Salón y pedidos** · tabla `mf796fv0n4v.3957` (filas RF-23, RF-24, RF-29, RF-31, RF-32, RF-33, RF-34 y RF-35)

| ID | Requerimiento |
|---|---|
| RF-23 | Mostrar el estado de cada mesa en tiempo real: libre (verde), ocupada (rojo) o en pre-cuenta (amarillo) |
| RF-24 | Abrir una mesa con el número de comensales y el mozo responsable (por defecto, quien la abre; al abrir se puede elegir a otra persona que atienda mesas, y después no se cambia) |
| RF-29 | Editar o borrar sin clave los ítems no enviados; anular los enviados, en todo o en parte de su cantidad (por defecto, toda), con clave, motivo y destino del stock, con un ticket de anulación en la estación |
| RF-31 | Unir varias mesas en una sola cuenta |
| RF-32 | Imprimir la pre-cuenta, con la suma de los totales con IGV incluido, sin desglose, y la nota «No es un comprobante» (y «El ICBPER se suma al cobrar» si corresponde); si luego se agregan o anulan ítems, invalidarla y devolver la mesa a ocupada |
| RF-33 | Aplicar descuentos (por ítem o por cuenta, en porcentaje o monto) y cortesías, con clave y motivo |
| RF-34 | Registrar ventas rápidas en mostrador: cobro primero y número de llamado |
| RF-35 | Anular una orden abierta con clave de supervisor; una mesa abierta sin nada enviado se libera sin clave, con registro en la auditoría |

[No hay ninguna fila sobre propina: está fuera del alcance (ver A.12).]

### A.5 Requerimientos funcionales: Plataforma y Usuarios (filas que limitan con la caja)

Requerimientos · apartado «Requerimientos funcionales» > **Plataforma** · tabla `mf796fv0n4v.1608` (filas RF-01, RF-02, RF-05, RF-06)

| ID | Requerimiento |
|---|---|
| RF-01 | Registrar empresas con uno o varios emisores (RUC) y sus sucursales |
| RF-02 | Configurar cada sucursal: emisor, código de establecimiento SUNAT, dirección, horario, número de WhatsApp y hora de corte del día operativo |
| RF-05 | Controlar la cuota mensual de comprobantes y registrar el excedente sin bloquear la emisión |
| RF-06 | Suspender la sucursal al vencer la gracia, desde la siguiente apertura de caja, y permitir consultar y exportar sus datos |

Requerimientos · apartado «Requerimientos funcionales» > **Usuarios y …** · tabla `mf796fv0n4v.2434` (filas RF-08, RF-12, RF-13)

| ID | Requerimiento |
|---|---|
| RF-08 | Crear usuarios con acceso a una o varias sucursales y un rol en cada una: Mozo, Cajero, Cocina/Barra, Supervisor o Administrador, con PIN de 4 dígitos (Mozo, Cocina/Barra) o de 6 (Cajero, Supervisor, Administrador) y un horario de acceso opcional |
| RF-12 | Pedir la clave de un supervisor en las acciones protegidas y registrar quién pidió, quién autorizó y el motivo |
| RF-13 | Registrar en la auditoría las anulaciones, descuentos, cortesías, notas de crédito, ajustes de stock y cambios de configuración |

Requerimientos · apartado «Requerimientos funcionales» > **Carta** · tabla `mf796fv0n4v.3126` (fila RF-14)

| ID | Requerimiento |
|---|---|
| RF-14 | Gestionar familias y productos con foto, descripción, precio con IGV, afectación tributaria, estación de producción (o ninguna), tipo de control de stock y si se vende solo. El tipo de producto (simple, combo o menú del día) se puede cambiar |

### A.6 Requerimientos funcionales: Delivery, carta web y pedidos desde la mesa (filas que limitan con el cobro)

Requerimientos · apartado «Requerimientos funcionales» > **Delivery, carta web …** · tabla `mf796fv0n4v.5657` (filas RF-42, RF-46, RF-47 y RF-86)

| ID | Requerimiento |
|---|---|
| RF-42 | Permitir al cliente armar su pedido con modificadores y combos, e indicar nombre, teléfono, entrega o recojo, dirección con referencia, forma de pago, monto con que paga y, si quiere factura, su RUC |
| RF-46 | Mostrar los pedidos pendientes en la bandeja con alerta sonora, confirmarlos o rechazarlos, y vencerlos a los 30 minutos |
| RF-47 | Registrar pedidos telefónicos desde la bandeja |
| RF-86 | Ofrecer en la carta de mesa los botones «Llamar al mozo» y «Pedir la cuenta», que llegan al mozo como llamados sin pedido. «Pedir la cuenta» solo avisa al mozo; la pre-cuenta la pide el mozo |

### A.7 Requerimientos funcionales: Impresión (filas con ticket, comprobante o gaveta)

Requerimientos · apartado «Requerimientos funcionales» > **Impresión** · tabla `mf796fv0n4v.9343` (filas RF-76, RF-77 y RF-78)

| ID | Requerimiento |
|---|---|
| RF-76 | Configurar las impresoras de cada sucursal: conexión (red o Bluetooth), ancho de papel (58 u 80 mm), juego de caracteres y gaveta. La impresión por Bluetooth llega con la app puente (entrega 3c); la gaveta se usa al cobrar (Caja) |
| RF-77 | Encolar los trabajos de impresión y reenviarlos al reconectarse el puente; avisar en la app cuando una impresora o el puente están desconectados. Los trabajos que no se imprimieron vencen al terminar el día operativo de la sucursal |
| RF-78 | Imprimir una página de prueba y reimprimir tickets |

### A.8 Requerimientos funcionales: Reportes (RF-79 a RF-83)

Requerimientos · apartado «Requerimientos funcionales» > **Reportes** · tabla `mf796fv0n4v.9790` (todas las filas salvo RF-81, que es de stock)

| ID | Requerimiento |
|---|---|
| RF-79 | Ventas por día, turno, producto, familia, mozo, medio de pago y sucursal, con el consolidado de la empresa |
| RF-80 | Anulaciones, descuentos y cortesías, con quién autorizó cada una |
| RF-82 | Estado de los comprobantes y consumo de la cuota del plan |
| RF-83 | Exportar a Excel los comprobantes del mes para el contador |

[RF-81 «Stock, kardex y mermas» queda fuera de esta sección.]

### A.9 Requerimientos no funcionales relacionados

Requerimientos · apartado «Requerimientos no funcionales» · párrafo `mf796fv0n4v.10198` y tabla `mf796fv0n4v.10352` (filas seleccionadas)

El sistema debe estar disponible el 99.5 % del mes y llevar una comanda a cocina en menos de 5 segundos, con capacidad para 30 empresas en el primer año.

| ID | Categoría | Requerimiento |
|---|---|---|
| RNF-01 | Disponibilidad | 99.5 % al mes, es decir, como máximo unas 3.5 horas de caída; los mantenimientos se hacen de madrugada |
| RNF-02 | Rendimiento | La comanda se imprime o aparece en el KDS en menos de 5 segundos desde que se pulsa "Enviar" |
| RNF-03 | Rendimiento | Las pantallas de operación responden en menos de 1 segundo |
| RNF-06 | Seguridad | Aislamiento de los datos de cada empresa en la base de datos (RLS) |
| RNF-07 | Seguridad | HTTPS en todas las conexiones; contraseñas y PIN guardados con hash; credenciales del PSE cifradas |
| RNF-08 | Seguridad | Acceso del personal con usuario y contraseña la primera vez en cada equipo y, desde entonces, con PIN solo en los equipos donde ya entró con contraseña; el Administrador puede revocar esos equipos y cada persona puede olvidarlos; horario de acceso opcional por trabajador; cierre de sesión por inactividad, con un tiempo aparte y más largo para Cocina/Barra |
| RNF-09 | Auditoría | Registro que no se puede modificar de las acciones protegidas: quién, qué, cuándo y quién autorizó |
| RNF-10 | Resiliencia | Reintento automático de operaciones ante microcortes, sin duplicados |
| RNF-12 | Compatibilidad | El puente de impresión funciona en Android 10 o superior, con impresoras ESC/POS genéricas de 58 y 80 mm |
| RNF-14 | Idioma y moneda | Solo español y soles |
| RNF-16 | Conservación | Los comprobantes y datos tributarios se conservan según lo que exija SUNAT y lo que fije el contrato |
| RNF-17 | Mantenibilidad | TypeScript en todo el sistema, código compartido para los cálculos y pruebas automáticas de montos e impuestos |
| RNF-18 | Costos | Sin servicios externos de pago en el plan base, salvo el PSE |
| RNF-19 | Monitoreo | Seguimiento de errores, de la conexión de los puentes y de los envíos al PSE, con alertas al equipo |
| RNF-20 | Trazabilidad | Cada registro de datos de clientes guarda quién lo creó y quién lo modificó por última vez: usuario y equipo, superadministrador o proceso del sistema |

[No hay RNF propio de redondeo, IGV ni ICBPER: esos cálculos están en RF-60 y RNF-17. Tampoco hay RNF de «sin conexión»: lo más cercano es RNF-10; el modo offline está fuera del alcance (A.12 y B.1).]

### A.10 Historias de usuario: Caja y facturación (HU-25 a HU-31)

Requerimientos · apartado «Historias de usuario» > **Caja y facturación** · lista `mf796fv0n4v.18908`

- **HU-25 Apertura de caja.** Como cajero, quiero abrir mi turno con el fondo inicial, para empezar a cobrar.
  - No se puede cobrar sin un turno abierto.
- **HU-26 Cobro.** Como cajero, quiero cobrar con varios medios de pago y calcular el vuelto, para liquidar la mesa.
  - Puedo combinar efectivo, tarjeta, Yape y Plin en un mismo cobro.
  - Con tarjeta o billetera digital registro el número de operación o del voucher.
  - Al cobrar todo, la mesa vuelve a verde.
- **HU-27 Factura con RUC.** Como cajero, quiero escribir el RUC y que se autocompleten los datos, para emitir facturas sin errores.
  - Si el RUC no existe o no está activo, el sistema avisa.
- **HU-28 Dividir la cuenta.** Como cajero, quiero dividir la cuenta por ítems o en partes iguales, para cobrarle a cada comensal.
  - Cada parte genera su propio comprobante.
  - La mesa queda abierta hasta pagar todas las partes.
- **HU-29 Nota de crédito.** Como cajero, quiero emitir una nota de crédito con la clave del supervisor, para anular un comprobante o cambiar una boleta por factura.
  - Si se devuelve dinero, se registra como egreso del turno.
- **HU-30 Arqueo y cierre Z.** Como cajero, quiero contar el dinero por medio de pago y cerrar el turno, para cuadrar la caja.
  - El reporte X se puede sacar en cualquier momento sin cerrar.
  - Toda diferencia exige un motivo.
  - El último turno no se puede cerrar si quedan mesas o pedidos abiertos.
- **HU-31 Estado de comprobantes.** Como administrador, quiero ver los comprobantes pendientes o rechazados, para corregirlos a tiempo.
  - Los envíos fallidos se reintentan solos.
  - El sistema alerta cuando un comprobante sigue pendiente o es rechazado.

### A.11 Otras historias de usuario que limitan con la caja

Requerimientos · apartado «Historias de usuario» > **Plataforma** · lista `mf796fv0n4v.12591` (HU-03 y HU-04)

- **HU-03 Clave de supervisor.** Como cajero, quiero que un supervisor autorice con su PIN una acción protegida, sin tener que pasarle el equipo.
  - Aparece una ventana que pide el PIN de un supervisor y el motivo.
  - La auditoría guarda quién pidió, quién autorizó, el motivo y la hora.
- **HU-04 Suspensión por falta de pago.** Como superadministrador, quiero que una sucursal con pago vencido se suspenda tras la gracia, para controlar la cobranza sin cortar un servicio en curso.
  - Durante la gracia, el administrador ve avisos.
  - La suspensión impide abrir caja, pero no corta un turno abierto.
  - Suspendida, la sucursal puede consultar y exportar sus datos.

Requerimientos · apartado «Historias de usuario» > **Salón** · lista `mf796fv0n4v.15220` (HU-14, HU-16, HU-17 y HU-18)

- **HU-14 Adición.** Como mozo, quiero agregar ítems a una mesa abierta, para atender pedidos extra.
  - El ticket sale marcado como adición.
  - Si la mesa estaba en pre-cuenta, vuelve a ocupada.
- **HU-16 Mover y unir mesas.** Como mozo, quiero mover una cuenta a otra mesa o juntar mesas, para acomodar a los clientes.
  - Al mover, la mesa original queda libre.
  - Las mesas unidas comparten una sola cuenta y se ven como grupo en el mapa.
- **HU-17 Pre-cuenta.** Como mozo, quiero imprimir la pre-cuenta, para que el cliente revise su consumo.
  - La mesa pasa a amarillo.
- **HU-18 Venta en mostrador.** Como cajero, quiero cobrar primero y enviar el pedido con un número de llamado, para atender rápido en mostrador.
  - El ticket de cocina y el comprobante muestran el número de llamado.

Requerimientos · apartado «Historias de usuario» > **Delivery y pedidos …** · lista `mf796fv0n4v.17819` (HU-22 y HU-23)

- **HU-22 Bandeja de pedidos.** Como cajero, quiero ver los pedidos web con alerta sonora y confirmarlos con un clic, para no volver a escribirlos.
  - Al confirmarlo, el pedido pasa a cocina como una comanda marcada "DELIVERY".
  - Los pedidos sin confirmar vencen a los 30 minutos.
- **HU-23 Pedido por teléfono.** Como cajero, quiero registrar los pedidos que llegan por llamada, para que sigan el mismo circuito.
  - Si el teléfono ya existe, se cargan los datos y las direcciones del cliente.

Requerimientos · apartado «Historias de usuario» > **Reportes** · lista `mf796fv0n4v.21155` (HU-35 a HU-37)

- **HU-35 Reportes de ventas.** Como dueño, quiero ver las ventas por día, producto, mozo, medio de pago y sucursal, para tomar decisiones.
  - El administrador ve todas sus sucursales y el consolidado.
- **HU-36 Reporte de control.** Como dueño, quiero ver las anulaciones, descuentos y cortesías con quién los autorizó, para detectar pérdidas.
  - Se puede filtrar por fecha, sucursal y usuario.
- **HU-37 Exportación para el contador.** Como administrador, quiero exportar a Excel los comprobantes del mes, para enviárselos al contador.
  - El archivo incluye tipo, serie, número, fecha, cliente, montos y estado ante SUNAT.

Requerimientos · apartado «Historias de usuario» > **Impresión** · lista `mf796fv0n4v.21773` (HU-38 y HU-39)

- **HU-38 Vincular el puente.** Como administrador, quiero vincular el Android de caja como puente de impresión escaneando un QR, para imprimir en cocina, barra y caja.
  - Se configuran las impresoras de red o Bluetooth, el ancho de papel y la gaveta.
  - Se puede imprimir una página de prueba.
- **HU-39 Aviso de impresora desconectada.** Como mozo, quiero saber si una impresora o el puente están desconectados, para avisar a cocina.
  - Los tickets quedan en cola y se imprimen al reconectarse.

### A.12 Fuera del alcance del MVP

Requerimientos · apartado «Fuera del alcance del MVP» · párrafo `mf796fv0n4v.22283`, lista `mf796fv0n4v.22389` y párrafo `mf796fv0n4v.22828`

Estos puntos quedan para fases siguientes o planes premium, y no tienen requerimientos en este documento.

- Modo offline con un servidor en el local, para clientes grandes.
- Inventario por recetas e insumos, y transferencias entre sucursales.
- Delivery completo: repartidores, zonas con mapa y seguimiento en vivo.
- WhatsApp automático con la API oficial.
- Precios distintos por canal y ventas al crédito.
- Exportación contable y puente de impresión para Windows.
- Dominio propio para la carta web, reservas y cobro automático de suscripciones.

No están previstos: propinas, integración con Rappi o PedidosYa, puente de impresión en iPhone ni otras monedas distintas del sol.

---

## B. Documento de diseño

### B.1 Decisiones de arquitectura (lo que toca a facturación, cálculos y caídas)

Diseño · apartado «Decisiones…» · tabla `meeb5spez7t.954` (filas Offline, Facturación electrónica y Código compartido), párrafo `meeb5spez7t.2493`, lista `meeb5spez7t.2512` y párrafo `meeb5spez7t.2815`

| Tema | Decisión | Motivo |
|---|---|---|
| Offline | Fuera del MVP. A futuro, un servidor local como plan premium para clientes grandes, con la misma aplicación | Cambia cómo se instala el sistema, no el código |
| Facturación electrónica | PSE contratado por nuestra empresa, detrás de un conector intercambiable | Generar, firmar y enviar el XML es delicado; el conector evita depender de un proveedor |
| Código compartido | Paquete común con los cálculos de la cuenta, el IGV y los tipos de datos | La app y el servidor calculan exactamente lo mismo |

**Si falla internet:**

- **Microcortes:** la app guarda lo que no pudo enviar y lo reintenta. Las operaciones no se duplican si se repiten.
- **Caída de internet:** se comparten datos móviles desde un celular.
- **Caída larga:** comandas en papel y talonario de contingencia de SUNAT. Al volver la conexión, el cajero registra esas ventas.

**Para poder agregar el modo offline más adelante** sin reescribir la aplicación: identificadores UUID, cálculos en código compartido, operaciones que no se duplican al repetirse, e impresión y facturación detrás de conectores.

### B.2 Alcance (líneas de Salón, Mostrador, Cocina y barra, Caja, Facturación y Reportes; fuera de alcance)

Diseño · apartado «Alcance» · lista `meeb5spez7t.3227` (ítems seleccionados), lista `meeb5spez7t.4421` («Después de…», ítem de offline) y párrafo `meeb5spez7t.4850`

- **Salón:** mapa de mesas, apertura, comandas y adiciones, tiempos 1 y 2, pre-cuenta, mover y unir mesas, dividir la cuenta, y anulaciones, descuentos y cortesías con clave.
- **Mostrador:** venta rápida con cobro anticipado y número de llamado.
- **Cocina y barra:** impresión con el puente Android y pantalla KDS. Se entrega en tres partes: 3a Salón y Cocina con KDS; 3b impresión en la nube (impresoras de red de punta a punta, con simulador del puente); y 3c app Android del puente (Kotlin), que también trae Bluetooth. La venta en mostrador y los descuentos y cortesías se construyen con la caja.
- **Caja:** apertura con fondo inicial, cobro con varios medios de pago y vuelto, reportes X y Z, ingresos y egresos.
- **Facturación:** boleta, factura, nota de crédito, resumen diario y bajas, a través del PSE.
- **Reportes:** ventas, control de anulaciones, descuentos y cortesías, stock, estado de comprobantes y exportación a Excel para el contador.

De la lista «Después de…» (`meeb5spez7t.4421`): «Precios distintos por canal y ventas al crédito.», «Exportación contable y puente de impresión para Windows.», «Servidor local con modo offline para clientes grandes.»

**Fuera de alcance:** propinas, integración con Rappi o PedidosYa, puente de impresión en iPhone y otras monedas distintas del sol.

### B.3 Flujos de operación: Atención en mesa

Diseño · apartado «Flujos de operación» > **Atención en mesa** · lista ordenada `meeb5spez7t.5143`

1. El mozo abre la mesa en el mapa e indica los comensales. Queda como mozo responsable, y la mesa pasa de verde (libre) a rojo (ocupada).
2. Toma el pedido por familias, viendo cuánto stock queda de cada producto. Agrega modificadores, observaciones y el tiempo de servicio (1 o 2).
3. Al pulsar "Enviar", cada ítem va a la impresora o KDS de su estación: barra, cocina, parrilla o fríos. Los de segundo tiempo salen marcados "ESPERAR" hasta que el mozo pulsa "Marchar".
4. Las adiciones generan un ticket nuevo marcado como adición.
5. El mozo o el cajero imprime la pre-cuenta y la mesa pasa a amarillo. Si piden algo más o se anula algo, vuelve a rojo y se imprime una pre-cuenta nueva.
6. El cajero cobra: elige boleta o factura (detallada o por consumo), pide RUC o DNI cuando corresponde, registra los medios de pago y calcula el vuelto.
7. El comprobante se emite a través del PSE y la mesa vuelve a verde.

Diseño · mismo apartado · párrafo `meeb5spez7t.23763`

**Pedido desde la mesa con QR (RF-84 a RF-88).** Cada mesa tiene un QR que abre la carta web en modo mesa. El cliente arma su pedido y lo envía como un llamado: no va a cocina, le llega al mozo. El mozo va a la mesa, repite el pedido, lo ajusta y lo pasa a la cuenta como ítems sin enviar; desde ahí sigue el paso de enviar la comanda de siempre. Así el envío de comandas, los montos y la impresión no cambian, y un pedido falso nunca llega a cocina. El llamado es parte de la ruta crítica de pedidos web (confirmación, vencimiento y protección contra pedidos falsos).

### B.4 Flujos de operación: Venta rápida en mostrador

Diseño · apartado «Flujos de operación» > **Venta rápida en mostrador** · lista ordenada `meeb5spez7t.6055`

1. El cajero registra el pedido y cobra primero.
2. El pedido pasa a cocina con un número de llamado.

### B.5 Flujos de operación: Delivery (pasos que tocan el cobro)

Diseño · apartado «Flujos de operación» > **Delivery y…** · lista ordenada `meeb5spez7t.6196` (pasos 1, 3 y 4) y párrafo `meeb5spez7t.6887`

1. El cliente abre la carta web de la sucursal, elige sus productos y llena sus datos: nombre, teléfono, entrega o recojo, dirección con referencia, forma de pago y con cuánto paga si es en efectivo.
3. El pedido aparece en la bandeja del cajero con una alerta sonora. Coordinan por WhatsApp y el cajero lo confirma con un clic; pasa a cocina como cualquier comanda.
4. Al despachar, el cajero cobra y emite el comprobante. El repartidor sale con el ticket y el vuelto.

Los pedidos por teléfono los registra el cajero directamente en la bandeja.

### B.6 Flujos de operación: Rutina diaria

Diseño · apartado «Flujos de operación» > **Rutina diaria** · lista `meeb5spez7t.6977`

- **Apertura:** revisar que el puente y las impresoras estén conectados, abrir la caja con el fondo inicial, cargar las porciones del día y marcar los productos agotados.
- **Cierre:** comprobar que no queden mesas ni pedidos abiertos, hacer el arqueo con conteo físico por medio de pago, cerrar con Z y revisar los comprobantes pendientes o rechazados. El resumen diario de boletas lo envía el PSE, y el resumen de ventas queda en el panel de reportes.

### B.7 Reglas de negocio: Ventas y precios

Diseño · apartado «Reglas de negocio» · párrafo `meeb5spez7t.7440` y > **Ventas y precios** · lista `meeb5spez7t.7588`

Todas las reglas de esta sección están confirmadas. Las que tocan temas tributarios se validarán con un contador (ver Pendientes).

- Los precios de la carta incluyen IGV. El sistema calcula la base imponible y el IGV a partir de ellos.
- Solo se vende en soles.
- Un solo precio en todos los canales. En para llevar y delivery, el envase y el envío se cobran aparte.
- Los combos tienen precio fijo, y algunas opciones pueden sumar un monto. Cada componente va a su estación y descuenta su propio stock.
- El menú del día es un combo cuyas opciones cambian cada día y se controlan por porciones del día.
- Las cortesías requieren clave de supervisor; descuentan stock y no se cobran. Su tratamiento tributario lo define el contador.
- Los descuentos pueden ser por ítem o por cuenta, siempre con clave de supervisor y motivo.

### B.8 Reglas de negocio: Salón y pedidos (lo que toca a pre-cuenta y cuenta)

Diseño · apartado «Reglas de negocio» > **Salón y pedidos** · lista `meeb5spez7t.8293` (ítems 2 a 4)

- Cualquier mozo puede agregar pedidos a cualquier mesa. Las ventas se atribuyen al mozo que la abrió.
- Unir mesas crea una sola orden con varias mesas. Mover una cuenta es cambiar la mesa de su orden.
- Agregar o anular ítems después de la pre-cuenta la invalida, y la mesa vuelve a ocupada. Al unir mesas con cuentas abiertas, la cuenta de la mesa principal absorbe a las demás y la venta se atribuye a su mozo.

### B.9 Reglas de negocio: Comprobantes y caja

Diseño · apartado «Reglas de negocio» > **Comprobantes y caja** · lista `meeb5spez7t.8750`

- El cajero elige comprobante detallado o por consumo. Si la cuenta se divide en partes iguales, cada comprobante sale por consumo.
- Las boletas de más de S/ 700 exigen el nombre y el DNI del cliente.
- Solo hay ventas al contado.
- Cambiar una boleta por factura o devolver dinero se hace con nota de crédito y clave de supervisor. La devolución se registra como egreso de la caja del turno.
- Con tarjeta, Yape o Plin se registra el número de operación o del voucher, sin conexión con el POS del banco.
- La Z cuadra por separado el efectivo, los vouchers y las billeteras digitales. Toda diferencia exige un motivo.
- Una orden dividida queda abierta hasta que se paguen todas sus partes.
- El último turno abierto de una sucursal no puede cerrarse si quedan mesas o pedidos abiertos.
- Cada sucursal tiene una hora de corte del día operativo, por ejemplo las 5 a. m. Las ventas de madrugada cuentan para el día anterior.

### B.10 Reglas de negocio: Delivery (lo que toca a cobro y comprobante)

Diseño · apartado «Reglas de negocio» > **Delivery** · lista `meeb5spez7t.9677` (ítems 1 y 4)

- El costo de envío es fijo por sucursal, por distrito o "a coordinar". El pedido mínimo es opcional.
- El cliente puede pedir factura indicando su RUC.

### B.11 Reglas de negocio: Seguridad

Diseño · apartado «Reglas de negocio» > **Seguridad** · lista `meeb5spez7t.10086` (completa)

- El personal entra con usuario y contraseña la primera vez en cada equipo y, desde entonces, con PIN solo en los equipos donde ya entró con contraseña. El Administrador puede revocar esos equipos y cada persona puede olvidarlos. El horario de acceso por trabajador es opcional y la sesión se cierra por inactividad, con un tiempo aparte y más largo para Cocina/Barra.
- Cada registro guarda quién lo creó y quién lo cambió por última vez, y desde qué equipo.
- En equipos compartidos, la sesión se cierra sola después de un tiempo sin uso.
- Toda acción con clave queda en la auditoría: quién la pidió, quién la autorizó, el motivo y la hora.

### B.12 Inventario (reglas que limitan con el cobro)

Diseño · apartado «Inventario» > **Reglas:** · lista `meeb5spez7t.11129` (ítems 2 y 3)

- **Anulaciones:** si se anula un ítem ya enviado, el supervisor decide si el stock vuelve o es merma.
- **Combos y modificadores:** un combo descuenta sus componentes. Un modificador ligado a un producto descuenta ese producto; por ejemplo, elegir Inca Kola en el combo descuenta una Inca Kola.

### B.13 Facturación electrónica (apartado completo)

Diseño · apartado «Facturación electrónica» (encabezado `meeb5spez7t.12149`), bloques `meeb5spez7t.12173`, `.12320`, `.12460`, lista `.12486`, `.12758`, `.12864`, `.13051`, `.13204`, `.13415`, `.13579`, lista `.13609` y `.13955`, en ese orden

Nuestra empresa contrata un PSE para todos los clientes y lo incluye en el precio por sucursal. El PSE genera el XML, lo firma y lo envía a SUNAT.

**Qué hace el PSE:** genera y firma el XML, lo envía a SUNAT, devuelve la constancia (CDR) y gestiona el resumen diario de boletas y las bajas.

**Qué hace nuestro sistema:**

- Calcula los montos: IGV por línea, ICBPER, descuentos y redondeos. El PSE envía lo que le mandamos.
- Asigna series y correlativos.
- Reintenta los envíos fallidos y muestra el estado de cada comprobante en un panel.
- Imprime el ticket con el QR y guarda el PDF y el XML.

**Comprobantes del MVP:** boleta, factura, nota de crédito, resumen diario de boletas y comunicación de baja.

**Series:** una por caja y por tipo de comprobante; por ejemplo, B001 en la caja 1 y B002 en la caja 2. Cada sucursal emite con el RUC de su emisor y su código de establecimiento ante SUNAT.

**Emisor:** guarda su régimen tributario, que define qué comprobantes puede emitir (en el Nuevo RUS, solo boletas), y su tasa de IGV con fechas de vigencia.

**Conector:** una interfaz única con dos implementaciones, el simulador (para desarrollo, demos y capacitación) y el PSE elegido. Un OSE o el envío directo a SUNAT se podrían agregar sin tocar el resto del sistema.

**RUC y DNI:** el RUC se autocompleta con el padrón que SUNAT publica gratis, cargado en nuestra base y actualizado a diario. Para el DNI, el cajero escribe el nombre.

**Criterios para elegir el PSE:**

- API documentada y ambiente de pruebas gratuito.
- Una sola integración para muchos RUC, con precio por volumen.
- Cubre boletas, facturas, notas de crédito, resumen diario y bajas.
- Devuelve PDF, XML, CDR y los datos del QR.
- Figura en la lista de proveedores autorizados por SUNAT.
- Buen soporte, y un plan claro para cuando su servicio se cae.

**Alta de cada cliente:** cada RUC autoriza al PSE en SUNAT, con un trámite en línea que guía nuestro equipo.

### B.14 Modelo de datos (filas y decisiones que tocan pagos, turno, caja, comprobante, serie y montos)

Diseño · apartado «Modelo de datos» · párrafo `meeb5spez7t.14077` y tabla `meeb5spez7t.14179` (filas Plataforma, Pedidos, Caja, Facturación, Impresión y Referencia)

Cada registro pertenece a una empresa, y PostgreSQL filtra automáticamente los datos de cada cliente.

| Módulo | Entidades |
|---|---|
| Plataforma | Empresa, Emisor (RUC), Sucursal, Plan, Suscripción |
| Pedidos | Orden, Mesas de la orden, Ítem, Comanda, Datos de entrega, Cliente |
| Caja | Caja, Turno, Movimiento de caja, Pago |
| Facturación | Serie, Comprobante, Detalle del comprobante, Registro de envíos al PSE |
| Impresión | Puente, Impresora, Trabajo de impresión |
| Referencia | Padrón de RUC, compartido por todas las empresas |

Diseño · apartado «Modelo de datos» > **Decisiones…** · lista `meeb5spez7t.14965` (ítems seleccionados)

- **Identificadores UUID** en todas las tablas.
- **Las ventas guardan cómo eran al venderse:** el ítem guarda su precio y sus modificadores, y el comprobante, los datos del cliente. Un cambio de precio no altera las ventas pasadas.
- **Una orden puede tener varias mesas**, así se resuelve unir mesas. El estado de la mesa se calcula a partir de su orden abierta; no se guarda aparte.
- **Cada orden tiene un tipo** (mesa, mostrador, para llevar o delivery) **y un canal** (salón, web o teléfono). Los datos de entrega van en su propia tabla, para crecer al delivery completo sin tocar lo demás.
- **El pedido web es una orden más,** en estado pendiente.
- **Dividir la cuenta genera varios comprobantes** para la misma orden, cada uno con sus pagos.
- **Los montos se guardan con decimales exactos,** nunca como números de coma flotante.

### B.15 Estados

Diseño · apartado «Estados» · párrafo `meeb5spez7t.19765`, diagrama embebido `meeb5spez7t.19943` y párrafo `meeb5spez7t.19944`

Cada objeto avanza por pocos estados y las excepciones quedan registradas. El control principal está en el ítem: desde que se envía a cocina, anularlo exige clave de supervisor.

[Diagrama embebido `meeb5spez7t.19943`, leyenda «estados de mesa, orden, ítem, comprobante y turno», widget `node/4942d1c0-4705`. Es un dibujo SVG; se leyó su código y estas son sus etiquetas tal como aparecen, por carril (las flechas punteadas marcan excepciones):]

- Título: «Desde que un ítem se envía a cocina, anularlo exige clave de supervisor»
- **Mesa:** Libre → (abrir) → Ocupada → (pre-cuenta) → En pre-cuenta; En pre-cuenta → (adición) → Ocupada; En pre-cuenta / Ocupada → (cobro total) → Libre.
- **Orden:** Pendiente (web) → Abierta → En pre-cuenta → Cerrada; excepciones: «Rechazada o vencida» (desde Pendiente) y «Anulada (con clave)» (desde Abierta).
- **Ítem:** Por enviar → Enviado → En preparación → Listo; excepciones: «Se borra sin clave» (desde Por enviar) y «Anulado (clave, motivo, stock)» (desde Enviado). Nota: «Preparación y Listo: solo con KDS».
- **Comprobante:** Por enviar → Enviado → Aceptado → Anulado (nota: «con nota de crédito o baja»); excepción: «Rechazado: se corrige y se emite otro» (desde Enviado).
- **Turno de caja:** Abierto → Cerrado con Z. Nota: «X en cualquier momento; la Z es definitiva».

Los colores de la mesa son los del mapa: verde, rojo y amarillo. Una mesa en pre-cuenta vuelve a ocupada con una adición o con una anulación. Los bordes punteados marcan excepciones o pasos que solo existen con pantalla KDS. La pre-cuenta es opcional: una mesa ocupada también puede cobrarse directamente.

### B.16 Roles y permisos

Diseño · apartado «Roles y permisos» · párrafo `meeb5spez7t.15897`, tabla `meeb5spez7t.16092` (completa), párrafo `meeb5spez7t.22507` y lista `meeb5spez7t.16970`

Cinco roles por sucursal, más un superadministrador de nuestra empresa. "Clave" significa que la acción procede si un supervisor escribe su PIN en ese momento, y queda registrado quién autorizó.

| Acción | Mozo | Cajero | Cocina/Barra | Supervisor | Administrador |
|---|---|---|---|---|---|
| Abrir mesa, comandar, adiciones y pre-cuenta | ✓ | ✓ | — | ✓ | ✓ |
| Mover y unir mesas | ✓ | ✓ | — | ✓ | ✓ |
| Anular ítem enviado, aplicar descuento o cortesía | clave | clave | — | ✓ | ✓ |
| Confirmar pedidos web y registrar pedidos por teléfono | — | ✓ | — | ✓ | ✓ |
| Cobrar, dividir la cuenta y emitir comprobantes | — | ✓ | — | ✓ | ✓ |
| Emitir nota de crédito | — | clave | — | ✓ | ✓ |
| Abrir y cerrar caja, reportes X y Z, ingresos y egresos | — | ✓ | — | ✓ | ✓ |
| Usar el KDS y marcar platos listos | — | — | ✓ | ✓ | ✓ |
| Marcar agotados (86), cargar porciones del día y elegir las opciones del menú del día | — | — | ✓ | ✓ | ✓ |
| Registrar ingresos de mercadería | — | ✓ | — | ✓ | ✓ |
| Ajustes de stock y mermas | — | — | — | ✓ | ✓ |
| Editar la carta y los precios | — | ✓ (precio y disponibilidad por sucursal, solo donde es Cajero) | — | — | ✓ |
| Usuarios, sucursales, equipos y configuración | — | — | — | — | ✓ |
| Reportes | — | Su turno (X) | — | Su sucursal | Todas las sucursales |

Las estaciones de producción y su asociación a impresoras o KDS las define solo el Administrador.

- Un usuario puede tener un rol distinto en cada sucursal. En un negocio pequeño, una sola persona puede ser Administrador y hacerlo todo.
- El Cajero incluye todo lo que hace el Mozo.
- El superadministrador gestiona empresas, sucursales y suscripciones. Puede entrar a la cuenta de un cliente para darle soporte, siempre con registro en la auditoría.

### B.17 Modelo comercial (cuota de comprobantes y suspensión)

Diseño · apartado «Modelo com…» · lista `meeb5spez7t.17464` (ítems Cuota de comprobantes y Suscripción vencida)

- **Cuota de comprobantes:** cada plan incluye una cantidad de comprobantes al mes. Al superarla, la emisión nunca se bloquea: el excedente se cobra en la siguiente factura o se sugiere subir de plan.
- **Suscripción vencida:**
  - Primero hay unos días de gracia con avisos al administrador.
  - Luego viene la suspensión, que se aplica en la siguiente apertura de caja y nunca corta un turno abierto.
  - Aun suspendido, el cliente puede consultar y exportar sus datos.

### B.18 Infraestructura y costos (lo que menciona el PSE o los comprobantes)

Diseño · apartado «Infraestructura y costos» · tabla `meeb5spez7t.20363` (fila Archivos) y párrafo `meeb5spez7t.21806`

| Pieza | Servicio | Qué corre ahí |
|---|---|---|
| Archivos | Cloudflare R2 | Fotos de la carta, PDF y XML de comprobantes, copias semanales de la base |

El PSE es el costo variable más grande y va aparte. La cuenta de desarrollador de Google Play cuesta USD 25, una sola vez. Precios aproximados a 2026; se confirman al contratar.

### B.19 Pendientes de validar

Diseño · apartado «Pendientes de validar» · párrafo `meeb5spez7t.18654` y lista de casillas `meeb5spez7t.18760` (completa; ninguna está marcada)

El diseño está cerrado. Faltan estas validaciones y definiciones comerciales antes de salir a producción.

- [ ] Validar con un contador: cortesías, comprobante por consumo, boletas de más de S/ 700 con DNI, tasa de IGV aplicable y plazos de envío a SUNAT.
- [ ] Elegir el PSE comparando dos o tres proveedores con los criterios de la sección de facturación.
- [ ] Definir el precio por sucursal, la cuota de comprobantes de cada plan y el costo del excedente.
- [ ] Definir los días de gracia antes de suspender una sucursal.
- [ ] Definir en el contrato el plazo de conservación de datos tras una cancelación.
- [ ] Probar modelos de impresoras genéricas (58 y 80 mm, de red y Bluetooth) y armar la lista recomendada.
- [ ] Preparar la guía de configuración del puente por marca de Android, para evitar que el ahorro de batería lo cierre.
- [ ] Redactar los términos y condiciones, el contrato de servicio y la política de privacidad.

---

## C. Lo que ya existe en el código

Inventario de solo lectura del repositorio al 2026-11-04 (último commit `983526f`, la 5b ya en `main`).

### C.1 Módulos de la API

- `apps/api/src/modulos/` tiene: `auditoria`, `carta`, `carta-web`, `impresion`, `llamados`, `pedidos`, `plataforma`, `salon`, `salud`, `seguridad`. **No hay módulo de caja, pagos, comprobantes ni facturación**, ni migraciones de esas tablas (la última es `apps/api/src/migraciones/202611030001-llamados-ataque-ronda1.ts`).
- Ganchos que ya dejaron las secciones anteriores para la caja:
  - `PedidosConsultaService.hayOrdenesAbiertas(sucursalId, transaccion?)`, para impedir el cierre de caja con mesas o pedidos abiertos: `apps/api/src/modulos/pedidos/pedidos-consulta.service.ts:37` (comentario) y `:133`; también `ordenesAbiertas` en `:143`. Exportado para la sección 4 según `apps/api/src/modulos/pedidos/pedidos.module.ts:32`.
  - `SuscripcionService.exigirAperturaDeCaja(sucursalId)`: 403 `SUCURSAL_SUSPENDIDA` «La sucursal está suspendida por falta de pago: no se puede abrir caja»; «La llama solo la apertura de caja»: `apps/api/src/modulos/plataforma/suscripcion.service.ts:189-203`.
  - `SuscripcionService.registrarComprobanteEmitido(sucursalId, instante)`: suma 1 a la cuota del mes de Lima sin bloquear nunca; «La llama la emisión de cada comprobante, en su misma transacción»: `apps/api/src/modulos/plataforma/suscripcion.service.ts:231-240`.
  - Impresora de caja por sucursal (`impresion_sucursal.impresora_caja_id`): `apps/api/src/migraciones/202610310001-impresion.ts:100`; lectura en `apps/api/src/modulos/impresion/cola-impresion.service.ts:258` (`impresoraDeCaja`), puerto en `apps/api/src/modulos/pedidos/impresion/impresion.puerto.ts:74`; la usa la pre-cuenta en `apps/api/src/modulos/pedidos/precuentas.service.ts:208`.
  - Columna `impresora.gaveta boolean NOT NULL DEFAULT false`, guardada pero sin uso («Bluetooth y `gaveta` se guardan (decisión 12)»): `apps/api/src/migraciones/202610310001-impresion.ts:6` y `:38`; se lee en `apps/api/src/modulos/impresion/lectura-impresoras.ts:19,24,153`.
- Tabla `emisor` con `regimen` (`NUEVO_RUS`, `RER`, `MYPE_TRIBUTARIO`, `GENERAL`) y **sin tasa de IGV ni vigencias**: `apps/api/src/migraciones/202610270001-plataforma-base.ts:36-46`. La 001 dejó la tasa para esta historia: `specs/001-base-multitenancy/spec.md:350`.

### C.2 Permisos y clave de supervisor

- Acciones de la matriz ya definidas (sin rutas todavía): `APLICAR_DESCUENTO`, `APLICAR_CORTESIA`, `COBRAR`, `EMITIR_NOTA_CREDITO`, `OPERAR_CAJA` en `packages/dominio/src/permisos.ts:16-33`; celdas en `:60-77` (`APLICAR_DESCUENTO: [C, C, X, P, P]`, `APLICAR_CORTESIA: [C, C, X, P, P]`, `COBRAR: [X, P, X, P, P]`, `EMITIR_NOTA_CREDITO: [X, C, X, P, P]`, `OPERAR_CAJA: [X, P, X, P, P]`). Alcance de reportes: Cajero `TURNO`, Supervisor `SUCURSAL`, Administrador `EMPRESA` (`:88-95`). PIN de 6 dígitos para Cajero, Supervisor y Administrador (`:45-50`).
- Módulos del plan `CAJA` y `FACTURACION`: `packages/dominio/src/modulos.ts:5-13` (para `@RequiereModulo`).
- Clave de supervisor: `POST /autorizaciones` (`apps/api/src/modulos/seguridad/autorizaciones.controller.ts:15,24`), servicio `apps/api/src/modulos/seguridad/clave-supervisor.service.ts` (auditoría `autorizacion_otorgada` / `autorizacion_rechazada`, `:284`, `:335`), consumo diferido con `@ClaveDespuesDeValidar` (`apps/api/src/modulos/seguridad/decoradores.ts:67`, `apps/api/src/modulos/seguridad/clave-diferida.interceptor.ts:25-66`). Decoradores `@Permiso` (`decoradores.ts:47`), `@RequiereModulo` (`decoradores.ts:78`) e `@IdempotenteObligatoria` (`apps/api/src/nucleo/idempotencia/idempotente-obligatoria.decorator.ts:39`). PIN de supervisor de 6 dígitos en `packages/contratos/src/comunes.ts:179-182`.
- Aviso de la 004 para esta sección: la autorización «no se ata al ítem ni a la orden… Si la sección 4 usa la clave para descuentos o cortesías, debe decidir si la ata al monto o a la orden»: `specs/004-salon-cocina/spec.md:626`. Orden obligatorio de los interceptores en rutas con clave: `specs/004-salon-cocina/plan.md:299`.

### C.3 Reglas de montos en `packages/dominio`

- Solo existen totales con IGV incluido, sin desglose: `totalVigenteLinea`, `totalOrden`, `excedeMontoMaximo` y `MONTO_MAXIMO = '99999999.99'` en `packages/dominio/src/salon/montos.ts:30-71` («Sin redondeos y sin acotar», `:4`). Precios de línea en `packages/dominio/src/carta/precios.ts:89` (`precioEfectivo`), `:173` (`calcularLinea`). Todos usan `Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })` (`salon/montos.ts:15`, `carta/precios.ts:15`).
- Afectación tributaria `AFECTACIONES_IGV = ['GRAVADO', 'EXONERADO', 'INAFECTO']`: `packages/dominio/src/carta/catalogos.ts:15`; `aplicaIcbper` en los contratos de carta (`packages/contratos/src/carta.ts:167-168`).
- Régimen del emisor: `packages/dominio/src/regimen.ts:1-4`.
- Día operativo por hora de corte: `packages/dominio/src/dia-operativo.ts:17`.
- **No hay** cálculo de base imponible, IGV por línea, ICBPER, descuentos, cortesías, redondeos ni división de cuenta en `packages/dominio` (búsqueda de `igv|icbper|redonde|divid|descuent` sin resultados de lógica).

### C.4 Estados de orden e ítem, y la pre-cuenta

- Estados de orden `['ABIERTA', 'EN_PRECUENTA', 'ANULADA', 'UNIDA', 'CERRADA']`; «`CERRADA` la usa la sección 4 (cobro)»: `packages/dominio/src/salon/catalogos.ts:6-11`. Tipos `['MESA', 'MOSTRADOR', 'PARA_LLEVAR', 'DELIVERY']` («los demás valores los usan las secciones 4 y 5», `:13-15`) y canales `['SALON', 'WEB', 'TELEFONO']` (`:17-19`). Estados de mesa calculados `LIBRE`, `OCUPADA`, `EN_PRECUENTA` (`:21-23`; `estadoDeMesa` en `packages/dominio/src/salon/estados.ts:23`). Estados de ítem `['ENVIADO', 'ANULADO']` (`catalogos.ts:29-31`).
- Tabla `orden` con `cerrada_en` y `CHECK ((estado = 'CERRADA') = (cerrada_en IS NOT NULL))`, `version` para la pre-cuenta: `apps/api/src/migraciones/202610300002-pedidos.ts:28-62`. Ítem con `precio_unitario numeric(10,2)`, `total`, `afectacion_igv`, `aplica_icbper` y la línea vendida en `linea jsonb`: mismo archivo `:120-145`.
- Pre-cuenta: tabla `precuenta` (`apps/api/src/migraciones/202610300003-anulaciones-precuentas.ts:63-82`), `POST /ordenes/:id/precuentas` (`apps/api/src/modulos/pedidos/precuentas.controller.ts:16,25`) y `PrecuentasService` con las notas «Precios con IGV incluido. No es un comprobante de pago.» y «El ICBPER se suma al cobrar.» (`apps/api/src/modulos/pedidos/precuentas.service.ts:18-21`, comportamiento en `:58-64`). Contrato en `packages/contratos/src/salon.ts:445-449`. Rutas de orden existentes: crear, ver, mover, unir, anular, liberar (`apps/api/src/modulos/pedidos/ordenes.controller.ts:27-127`); no hay cobro ni cierre.
- La 004 previó que la pre-cuenta muestre descuentos e ICBPER cuando llegue esta sección: `specs/004-salon-cocina/spec.md:679` (decisión 5) y `:586`; «Hasta la sección 4 no hay cobro: una mesa solo vuelve a verde al anular o liberar su orden»: `:368`.
- Llamados de mesa `PEDIR_CUENTA` (solo avisa al mozo): `packages/dominio/src/llamados/catalogos.ts:8`, `packages/contratos/src/llamados.ts:76`.

### C.5 Impresión de tickets (3b)

- Tipos de documento ESC/POS: `COMANDA`, `ADICION`, `MARCHAR`, `ANULACION`, `PRECUENTA` y `PRUEBA` (`apps/api/src/modulos/impresion/escpos/index.ts:34`); plantillas en `apps/api/src/modulos/impresion/escpos/plantillas/` (`comanda.ts`, `precuenta.ts` con `documentoDePrecuenta` en `:114`, `prueba.ts`, `marcas.ts`, `presupuesto.ts`, `texto.ts`). **No hay plantilla de comprobante ni de reporte X/Z.**
- Pulso de gaveta: el plan de la 004 dice «El pulso de gaveta (`ESC p 0 25 250`) queda en el renderizador para la sección 4» (`specs/004-salon-cocina/plan.md:215`), pero **no se encontró** en `apps/api/src/modulos/impresion/escpos/` (búsqueda de `gaveta|pulso`): está por hacer.
- Cola de trabajos en la misma transacción y vencimiento al fin del día operativo: README.md:52; reimpresión con «REIMPRESIÓN»: README.md:53.

### C.6 README y specs que mencionan la caja

- README.md:18 — «Suscripciones por sucursal con vencimiento, días de gracia y suspensión (la suspensión solo impide abrir caja).»
- README.md:33 — «**Caja** (4) toma de esa línea `afectacionIgv` y `aplicaIcbper`» (la línea de `CartaVentaService.prepararLinea`).
- README.md:42 — pre-cuenta de la 3a; README.md:50 — «hay una impresora de caja para las pre-cuentas».
- `specs/004-salon-cocina/spec.md:6`, `:32`, `:410`, `:582`, `:657-658` y `:677-678` — mostrador (HU-18, RF-34) y descuentos y cortesías (RF-33) pasan a la sección 4; «Las acciones `APLICAR_DESCUENTO` y `APLICAR_CORTESIA` siguen en la matriz sin rutas; la pre-cuenta usa `totalOrden` de `packages/dominio`, que la sección 4 amplía» (`:32`).
- `specs/004-salon-cocina/spec.md:48` — `totalVigenteLinea`, `totalOrden`, `excedeMontoMaximo` son «la base de la sección 4».
- `specs/004-salon-cocina/spec.md:77` — «Impresora de caja: … donde salen las pre-cuentas (y, en la sección 4, los comprobantes)».
- `specs/004-salon-cocina/spec.md:269` y `:585-586`, `:686` — `gaveta` «la usa la sección 4»; desglose de IGV y base imponible en la pre-cuenta: sección 4.
- `specs/004-salon-cocina/spec.md:517` — `hayOrdenesAbiertas(sucursalId)` «(para la sección 4)».
- `specs/004-salon-cocina/spec.md:591` — comandas en papel y su registro posterior «(el diseño lo deja al cajero, sección 4)».
- `specs/004-salon-cocina/spec.md:629` — margen del presupuesto de la PWA (~2.9 kB gzip de 170 kB): la sección 4 debe cargar bajo demanda o proponer subirlo.
- `specs/003-carta/spec.md:280` — afectación `EXONERADO` con emisor del Nuevo RUS: «qué comprobante sale y cómo lo decide la sección 4»; `:288`, `:418` y `:495` — base imponible, IGV, ICBPER, descuentos, cortesías, redondeos y monto del ICBPER los define la sección 4.
- `specs/005-carta-web-mesa/spec.md:33` — los montos de la cuenta «No cambian», «004 y sección 4»; `:440` — mostrar la cuenta en la mesa sería otra función, con la caja.

[Nota de numeración: los specs y el README llaman «sección 4» a la caja; esta carpeta es la especificación 006.]
