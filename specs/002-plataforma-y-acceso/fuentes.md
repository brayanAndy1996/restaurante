# Fuentes: Plataforma y acceso

- **Fecha de extracción:** 2026-10-27
- **Requerimientos e historias de usuario:** https://claude.ai/artifact/SfRCerAMxTQsFNL23bTuQq (rev. 11)
- **Documento de diseño:** https://claude.ai/artifact/1YzRwiYqDapgyVCBsHK2Gd

> Extracto literal para el especificador; ante discrepancia, mandan los documentos compartidos.

Notas de extracción (no forman parte de los documentos):

- El texto se copia tal cual. Los encabezados se bajaron un nivel para anidarlos aquí. Las fechas y menciones del original (chips) se muestran como texto: `2026-10-26`, `[@bryan]`, `[Software para restaurantes: documento de diseño]`.
- `[…]` marca texto omitido entre fragmentos de una misma sección.
- En el documento de requerimientos, las tablas RF-22 a RF-83 y las historias HU-19 a HU-39 están ubicadas físicamente después de la sección "Fuera del alcance del MVP", aunque pertenecen a "Requerimientos funcionales" e "Historias de usuario". Aquí se indica la sección lógica y el subtítulo en negrita de origen.
- Los diagramas del documento de diseño son imágenes interactivas; se transcriben sus rótulos donde son relevantes.

---

## Parte 1. Documento de requerimientos e historias de usuario

Título original: "Software para restaurantes: requerimientos e historias de usuario" · 2026-10-26 · [@bryan]

### Origen: sección "Introducción" (completa)

Este documento lista los requerimientos del MVP y sus historias de usuario. El diseño, las reglas de negocio completas y el modelo de datos están en [Software para restaurantes: documento de diseño].

- **RF-XX:** requerimiento funcional, agrupado por módulo.
- **RNF-XX:** requerimiento no funcional.
- **HU-XX:** historia de usuario, con el formato "Como [rol], quiero [acción], para [beneficio]" y sus criterios de aceptación.
- **Prioridad:** todo lo listado aquí entra en el MVP. Lo que queda para después está en la última sección.

### Origen: sección "Actores" (completa)

Seis roles de personas y tres sistemas interactúan con la aplicación.

| Actor | Qué hace |
| --- | --- |
| Mozo | Atiende las mesas: las abre, comanda, agrega adiciones e imprime la pre-cuenta |
| Cajero | Todo lo del mozo, y además cobra, emite comprobantes, maneja la caja y los pedidos web y telefónicos |
| Cocina / Barra | Recibe las comandas en impresora o KDS, marca platos listos, agotados y porciones del día |
| Supervisor | Autoriza acciones con su clave, ajusta stock y ve los reportes de su sucursal |
| Administrador | Configura la empresa, sucursales, carta, usuarios y equipos; ve todas las sucursales |
| Superadministrador | Personal de nuestra empresa: gestiona clientes, suscripciones y soporte |
| Cliente final | Pide desde la carta web y coordina con el restaurante por WhatsApp |
| PSE | Sistema externo que emite los comprobantes ante SUNAT |
| Puente de impresión | App Android del local que imprime en las impresoras de cocina, barra y caja |

### Origen: sección "Requerimientos funcionales" (párrafo inicial y tablas "Plataforma y suscripciones" y "Usuarios y seguridad", completas)

El MVP tiene 83 requerimientos funcionales en 11 módulos.

**Plataforma y suscripciones**

| ID | Requerimiento |
| --- | --- |
| RF-01 | Registrar empresas con uno o varios emisores (RUC) y sus sucursales |
| RF-02 | Configurar cada sucursal: emisor, código de establecimiento SUNAT, dirección, horario, número de WhatsApp y hora de corte del día operativo |
| RF-03 | Gestionar la suscripción de cada sucursal: plan, estado (activa, en gracia o suspendida), vencimiento y pagos registrados a mano |
| RF-04 | Activar los módulos que incluye el plan de cada sucursal |
| RF-05 | Controlar la cuota mensual de comprobantes y registrar el excedente sin bloquear la emisión |
| RF-06 | Suspender la sucursal al vencer la gracia, desde la siguiente apertura de caja, y permitir consultar y exportar sus datos |
| RF-07 | Permitir al superadministrador entrar a la cuenta de un cliente para darle soporte, con registro en la auditoría |

**Usuarios y seguridad**

| ID | Requerimiento |
| --- | --- |
| RF-08 | Crear usuarios con acceso a una o varias sucursales y un rol en cada una: Mozo, Cajero, Cocina/Barra, Supervisor o Administrador |
| RF-09 | Ingresar con PIN en los equipos vinculados a la sucursal, y con usuario y contraseña en cualquier otro |
| RF-10 | Vincular y desvincular equipos de una sucursal desde la administración |
| RF-11 | Cambiar rápido de usuario con PIN y cerrar la sesión por inactividad |
| RF-12 | Pedir la clave de un supervisor en las acciones protegidas y registrar quién pidió, quién autorizó y el motivo |
| RF-13 | Registrar en la auditoría las anulaciones, descuentos, cortesías, notas de crédito, ajustes de stock y cambios de configuración |

### Origen: sección "Requerimientos no funcionales" (completa)

El sistema debe estar disponible el 99.5 % del mes y llevar una comanda a cocina en menos de 5 segundos, con capacidad para 30 empresas en el primer año.

| ID | Categoría | Requerimiento |
| --- | --- | --- |
| RNF-01 | Disponibilidad | 99.5 % al mes, es decir, como máximo unas 3.5 horas de caída; los mantenimientos se hacen de madrugada |
| RNF-02 | Rendimiento | La comanda se imprime o aparece en el KDS en menos de 5 segundos desde que se pulsa "Enviar" |
| RNF-03 | Rendimiento | Las pantallas de operación responden en menos de 1 segundo |
| RNF-04 | Capacidad | Hasta 30 empresas el primer año, con varias sucursales cada una, y crecer sin cambiar la arquitectura |
| RNF-05 | Respaldos | Restaurar los datos de cualquier momento de los últimos 7 días; ante una falla grave se pierden como máximo unos minutos |
| RNF-06 | Seguridad | Aislamiento de los datos de cada empresa en la base de datos (RLS) |
| RNF-07 | Seguridad | HTTPS en todas las conexiones; contraseñas y PIN guardados con hash; credenciales del PSE cifradas |
| RNF-08 | Seguridad | Acceso del personal solo desde equipos vinculados, con cierre de sesión por inactividad |
| RNF-09 | Auditoría | Registro que no se puede modificar de las acciones protegidas: quién, qué, cuándo y quién autorizó |
| RNF-10 | Resiliencia | Reintento automático de operaciones ante microcortes, sin duplicados |
| RNF-11 | Compatibilidad | La PWA funciona en Chrome para Android y en Safari para iPhone y iPad, en versiones recientes |
| RNF-12 | Compatibilidad | El puente de impresión funciona en Android 10 o superior, con impresoras ESC/POS genéricas de 58 y 80 mm |
| RNF-13 | Usabilidad | Interfaz táctil para tablets y celulares, y carta web liviana para datos móviles |
| RNF-14 | Idioma y moneda | Solo español y soles |
| RNF-15 | Legal | Consentimiento y tratamiento de datos personales según la Ley 29733 |
| RNF-16 | Conservación | Los comprobantes y datos tributarios se conservan según lo que exija SUNAT y lo que fije el contrato |
| RNF-17 | Mantenibilidad | TypeScript en todo el sistema, código compartido para los cálculos y pruebas automáticas de montos e impuestos |
| RNF-18 | Costos | Sin servicios externos de pago en el plan base, salvo el PSE |
| RNF-19 | Monitoreo | Seguimiento de errores, de la conexión de los puentes y de los envíos al PSE, con alertas al equipo |

### Origen: sección "Historias de usuario" (párrafo inicial y épica "Plataforma y acceso", HU-01 a HU-04 completas)

El MVP tiene 39 historias de usuario en 9 épicas. Cada una incluye sus criterios de aceptación.

**Plataforma y acceso**

- **HU-01 Alta de empresa.** Como superadministrador, quiero registrar una empresa con sus RUC y sucursales, para que empiece a operar.
  - Una empresa puede tener uno o varios RUC.
  - Cada sucursal queda asociada a un RUC y a su código de establecimiento SUNAT.
  - La sucursal nace con suscripción activa y fecha de vencimiento.
- **HU-02 Ingreso con PIN.** Como mozo, quiero entrar con mi PIN en la tablet del local, para empezar a atender rápido.
  - El PIN solo funciona en equipos vinculados a la sucursal.
  - En un equipo no vinculado se piden usuario y contraseña.
  - La sesión se cierra sola tras el tiempo de inactividad configurado.
- **HU-03 Clave de supervisor.** Como cajero, quiero que un supervisor autorice con su PIN una acción protegida, sin tener que pasarle el equipo.
  - Aparece una ventana que pide el PIN de un supervisor y el motivo.
  - La auditoría guarda quién pidió, quién autorizó, el motivo y la hora.
- **HU-04 Suspensión por falta de pago.** Como superadministrador, quiero que una sucursal con pago vencido se suspenda tras la gracia, para controlar la cobranza sin cortar un servicio en curso.
  - Durante la gracia, el administrador ve avisos.
  - La suspensión impide abrir caja, pero no corta un turno abierto.
  - Suspendida, la sucursal puede consultar y exportar sus datos.

### Origen: sección "Fuera del alcance del MVP" (completa)

Estos puntos quedan para fases siguientes o planes premium, y no tienen requerimientos en este documento.

- Modo offline con un servidor en el local, para clientes grandes.
- Inventario por recetas e insumos, y transferencias entre sucursales.
- Delivery completo: repartidores, zonas con mapa y seguimiento en vivo.
- WhatsApp automático con la API oficial.
- Precios distintos por canal y ventas al crédito.
- Exportación contable y puente de impresión para Windows.
- Dominio propio para la carta web, reservas y cobro automático de suscripciones.

No están previstos: propinas, integración con Rappi o PedidosYa, puente de impresión en iPhone ni otras monedas distintas del sol.

### Otros requerimientos e historias del documento que mencionan los términos buscados

Términos buscados: suscripción, plan, módulo, pago, suspensión, PIN, supervisor, clave, autorizó, equipo, auditoría, rol, usuario, superadministrador. Se excluyen los ya copiados arriba. Entre corchetes, los términos que coinciden.

#### Sección "Requerimientos funcionales", tabla **Salón y pedidos**

| ID | Requerimiento |
| --- | --- |
| RF-29 | Editar o borrar sin clave los ítems no enviados; anular los enviados con clave, motivo y destino del stock, con un ticket de anulación en la estación |
| RF-33 | Aplicar descuentos (por ítem o por cuenta, en porcentaje o monto) y cortesías, con clave y motivo |
| RF-35 | Anular una orden abierta con clave de supervisor |

Coincidencias: RF-29 [clave], RF-33 [clave], RF-35 [clave de supervisor].

#### Sección "Requerimientos funcionales", tabla **Delivery y carta web**

| ID | Requerimiento |
| --- | --- |
| RF-42 | Permitir al cliente armar su pedido con modificadores y combos, e indicar nombre, teléfono, entrega o recojo, dirección con referencia, forma de pago, monto con que paga y, si quiere factura, su RUC |

Coincidencia: RF-42 [forma de pago].

#### Sección "Requerimientos funcionales", tabla **Caja**

| ID | Requerimiento |
| --- | --- |
| RF-51 | Cobrar con uno o varios medios de pago (efectivo, tarjeta de crédito o débito, Yape, Plin), calculando el vuelto y registrando el número de operación o voucher |
| RF-55 | Cerrar el turno con Z: conteo físico por medio de pago y motivo obligatorio para cada diferencia; impedir el cierre del último turno si hay mesas o pedidos abiertos |

Coincidencias: RF-51 [medios de pago], RF-55 [medio de pago].

#### Sección "Requerimientos funcionales", tabla **Facturación electrónica**

| ID | Requerimiento |
| --- | --- |
| RF-62 | Emitir notas de crédito (anulación, devolución o cambio de boleta por factura) con clave de supervisor |

Coincidencia: RF-62 [clave de supervisor].

#### Sección "Requerimientos funcionales", tabla **Reportes**

| ID | Requerimiento |
| --- | --- |
| RF-79 | Ventas por día, turno, producto, familia, mozo, medio de pago y sucursal, con el consolidado de la empresa |
| RF-80 | Anulaciones, descuentos y cortesías, con quién autorizó cada una |
| RF-82 | Estado de los comprobantes y consumo de la cuota del plan |

Coincidencias: RF-79 [medio de pago], RF-80 [autorizó], RF-82 [cuota del plan].

#### Sección "Historias de usuario", épica **Salón**

- **HU-10 Abrir mesa.** Como mozo, quiero abrir una mesa desde el mapa indicando los comensales, para empezar la atención.
  - La mesa pasa de verde a rojo en todos los equipos al instante.
  - Quedo registrado como mozo responsable.
- **HU-15 Anular ítem.** Como mozo, quiero anular un ítem ya enviado con la clave del supervisor, para corregir errores sin perder el control.
  - Antes de enviar, el ítem se borra sin clave.
  - Después de enviar, se piden clave, motivo y si el stock vuelve o es merma.
  - La estación recibe un ticket de anulación.

Coincidencias: HU-10 [equipos], HU-15 [clave del supervisor].

#### Sección "Historias de usuario", épica **Caja y facturación**

- **HU-26 Cobro.** Como cajero, quiero cobrar con varios medios de pago y calcular el vuelto, para liquidar la mesa.
  - Puedo combinar efectivo, tarjeta, Yape y Plin en un mismo cobro.
  - Con tarjeta o billetera digital registro el número de operación o del voucher.
  - Al cobrar todo, la mesa vuelve a verde.
- **HU-29 Nota de crédito.** Como cajero, quiero emitir una nota de crédito con la clave del supervisor, para anular un comprobante o cambiar una boleta por factura.
  - Si se devuelve dinero, se registra como egreso del turno.
- **HU-30 Arqueo y cierre Z.** Como cajero, quiero contar el dinero por medio de pago y cerrar el turno, para cuadrar la caja.
  - El reporte X se puede sacar en cualquier momento sin cerrar.
  - Toda diferencia exige un motivo.
  - El último turno no se puede cerrar si quedan mesas o pedidos abiertos.

Coincidencias: HU-26 [medios de pago], HU-29 [clave del supervisor], HU-30 [medio de pago].

#### Sección "Historias de usuario", épica **Inventario**

- **HU-33 Ajuste y merma.** Como supervisor, quiero ajustar el stock tras un conteo o registrar mermas, para que el sistema refleje la realidad.
  - Cada ajuste exige un motivo y queda en el kardex.

Coincidencia: HU-33 [Como supervisor].

#### Sección "Historias de usuario", épica **Reportes**

- **HU-35 Reportes de ventas.** Como dueño, quiero ver las ventas por día, producto, mozo, medio de pago y sucursal, para tomar decisiones.
  - El administrador ve todas sus sucursales y el consolidado.
- **HU-36 Reporte de control.** Como dueño, quiero ver las anulaciones, descuentos y cortesías con quién los autorizó, para detectar pérdidas.
  - Se puede filtrar por fecha, sucursal y usuario.

Coincidencias: HU-35 [medio de pago; el administrador ve todas sus sucursales], HU-36 [usuario; quién los autorizó].

---

## Parte 2. Documento de diseño

Título original: "Software para restaurantes: documento de diseño" · 2026-10-26 · [@bryan]

### Origen: sección "Resumen" (completa)

Un sistema en la nube para restaurantes pequeños del Perú, alquilado con una suscripción mensual por sucursal. Cubre salón, cocina y barra, caja, delivery por WhatsApp, inventario y facturación electrónica.

- **Clientes:** restaurantes pequeños, incluidos negocios con varias sucursales.
- **Cobro:** precio mensual por sucursal, con usuarios y dispositivos ilimitados y la facturación electrónica incluida.
- **Escala del primer año:** entre 20 y 30 negocios.
- **Costos:** el plan base no usa servicios externos de pago, salvo el proveedor de facturación electrónica (PSE), que contrata nuestra empresa.
- **Equipos:** la app del personal funciona en celulares y tablets como PWA. La impresión necesita un celular o tablet Android en el local.

### Origen: sección "Decisiones de arquitectura" (completa)

El sistema corre solo en la nube, sin modo offline. En el local solo hay navegadores y un Android que hace de puente de impresión.

[Diagrama incrustado: "arquitectura · local, nube y servicios externos". Rótulos transcritos: título "Todo corre en la nube; en el local solo hay navegadores y un Android que imprime". Zona "En el local y en el celular del cliente": "Impresoras térmicas — cocina, barra y caja"; "Celular del cliente — abre la carta web"; "Personal del local — tablets y celulares (PWA)"; "Android de caja — app puente de impresión" (conectado a las impresoras por "red o Bluetooth"). Zona "Nube": "Carta web — Next.js, una para todos"; "App del restaurante — React + Vite (PWA)"; "API · NestJS — REST, WebSockets, permisos y reglas de negocio" (el Android de caja se conecta a la API por "WebSocket"); "PostgreSQL — datos con RLS y colas"; "Worker — PSE y tareas programadas"; "PSE — genera, firma y envía"; "SUNAT — devuelve la constancia (CDR)".]

Los equipos del local solo usan el navegador, salvo el Android de caja, que recibe los tickets por WebSocket y los imprime. Todo lo demás, incluidas las colas de tareas, corre en la nube sobre PostgreSQL.

| Tema | Decisión | Motivo |
| --- | --- | --- |
| Despliegue | Solo nube, sin servidor en el local | Los negocios pequeños no quieren comprar ni mantener un equipo extra |
| Offline | Fuera del MVP. A futuro, un servidor local como plan premium para clientes grandes, con la misma aplicación | Cambia cómo se instala el sistema, no el código |
| Multitenancy | Una base PostgreSQL compartida, con seguridad a nivel de fila (RLS) por empresa | Barata de operar; el aislamiento entre empresas lo garantiza la base de datos |
| Backend | NestJS + Sequelize + PostgreSQL, en TypeScript | Estructura modular, permisos en un solo lugar, tiempo real y colas de tareas |
| App del restaurante | React + Vite, como PWA | App detrás de un login y en tiempo real; se publica como archivos estáticos |
| Carta web y web comercial | Next.js, una sola aplicación para todos los restaurantes | Vista previa del enlace en WhatsApp, carga rápida con datos móviles y posicionamiento en Google |
| Tiempo real | WebSockets | Mapa de mesas, KDS y bandeja de pedidos al instante |
| Impresión | App puente en un Android del local, impresoras genéricas de red o Bluetooth, y pantalla KDS como alternativa | Ni el navegador ni la nube pueden imprimir directo en la red del local |
| Facturación electrónica | PSE contratado por nuestra empresa, detrás de un conector intercambiable | Generar, firmar y enviar el XML es delicado; el conector evita depender de un proveedor |
| Código compartido | Paquete común con los cálculos de la cuenta, el IGV y los tipos de datos | La app y el servidor calculan exactamente lo mismo |

**Si falla internet:**

- **Microcortes:** la app guarda lo que no pudo enviar y lo reintenta. Las operaciones no se duplican si se repiten.
- **Caída de internet:** se comparten datos móviles desde un celular.
- **Caída larga:** comandas en papel y talonario de contingencia de SUNAT. Al volver la conexión, el cajero registra esas ventas.

**Para poder agregar el modo offline más adelante** sin reescribir la aplicación: identificadores UUID, cálculos en código compartido, operaciones que no se duplican al repetirse, e impresión y facturación detrás de conectores.

### Origen: sección "Alcance" (fragmentos)

El MVP cubre la operación completa de un restaurante: mesas, mostrador, para llevar y delivery por WhatsApp, con facturación electrónica e inventario sin recetas.

**Entra en el MVP:**

- **Plataforma:** empresas con uno o varios RUC, sucursales, usuarios, roles, PIN y suscripción por sucursal con cobro manual.
- […]

**Después del MVP (fases siguientes o planes premium):**

- Inventario por recetas e insumos, y transferencias entre sucursales.
- Delivery completo: repartidores, zonas con mapa y seguimiento en vivo.
- WhatsApp automático con la API oficial.
- Precios distintos por canal y ventas al crédito.
- Exportación contable y puente de impresión para Windows.
- Dominio propio para la carta web, reservas y cobro automático de suscripciones.
- Servidor local con modo offline para clientes grandes.

**Fuera de alcance:** propinas, integración con Rappi o PedidosYa, puente de impresión en iPhone y otras monedas distintas del sol.

### Origen: sección "Reglas de negocio" (fragmentos)

Todas las reglas de esta sección están confirmadas. Las que tocan temas tributarios se validarán con un contador (ver Pendientes).

**Ventas y precios**

- […]
- Las cortesías requieren clave de supervisor; descuentan stock y no se cobran. Su tratamiento tributario lo define el contador.
- Los descuentos pueden ser por ítem o por cuenta, siempre con clave de supervisor y motivo.

**Salón y pedidos**

- Antes de enviar a cocina, un ítem se corrige libremente. Después, anularlo exige clave de supervisor, un motivo y decidir si el stock vuelve o es merma.
- Cualquier mozo puede agregar pedidos a cualquier mesa. Las ventas se atribuyen al mozo que la abrió.
- […]

**Comprobantes y caja**

- […]
- Cambiar una boleta por factura o devolver dinero se hace con nota de crédito y clave de supervisor. La devolución se registra como egreso de la caja del turno.
- […]
- El último turno abierto de una sucursal no puede cerrarse si quedan mesas o pedidos abiertos.
- Cada sucursal tiene una hora de corte del día operativo, por ejemplo las 5 a. m. Las ventas de madrugada cuentan para el día anterior.

**Delivery**

- […]
- Los datos del cliente se guardan por teléfono, con su consentimiento según la Ley 29733. Nunca se comparten entre restaurantes.

**Seguridad**

- El personal entra con PIN solo desde equipos vinculados a la sucursal. En cualquier otro equipo se necesita usuario y contraseña.
- En equipos compartidos, la sesión se cierra sola después de un tiempo sin uso.
- Toda acción con clave queda en la auditoría: quién la pidió, quién la autorizó, el motivo y la hora.

### Origen: sección "Inventario" (fragmento)

**Reglas:**

- […]
- **Anulaciones:** si se anula un ítem ya enviado, el supervisor decide si el stock vuelve o es merma.
- […]

### Origen: sección "Facturación electrónica" (fragmentos)

Nuestra empresa contrata un PSE para todos los clientes y lo incluye en el precio por sucursal. El PSE genera el XML, lo firma y lo envía a SUNAT.

[…]

**Series:** una por caja y por tipo de comprobante; por ejemplo, B001 en la caja 1 y B002 en la caja 2. Cada sucursal emite con el RUC de su emisor y su código de establecimiento ante SUNAT.

**Emisor:** guarda su régimen tributario, que define qué comprobantes puede emitir (en el Nuevo RUS, solo boletas), y su tasa de IGV con fechas de vigencia.

[…]

**Alta de cada cliente:** cada RUC autoriza al PSE en SUNAT, con un trámite en línea que guía nuestro equipo.

### Origen: sección "Modelo de datos" (completa)

Cada registro pertenece a una empresa, y PostgreSQL filtra automáticamente los datos de cada cliente.

| Módulo | Entidades |
| --- | --- |
| Plataforma | Empresa, Emisor (RUC), Sucursal, Plan, Suscripción |
| Seguridad | Usuario, Acceso por sucursal (con su rol), Equipo vinculado, Auditoría |
| Carta | Familia, Producto, Ajuste del producto por sucursal, Grupo de modificadores, Modificador, Componente de combo, Estación de producción |
| Salón | Zona, Mesa |
| Pedidos | Orden, Mesas de la orden, Ítem, Comanda, Datos de entrega, Cliente |
| Caja | Caja, Turno, Movimiento de caja, Pago |
| Facturación | Serie, Comprobante, Detalle del comprobante, Registro de envíos al PSE |
| Inventario | Stock por sucursal, Movimiento de kardex, Ingreso de mercadería, Proveedor, Carga de porciones |
| Impresión | Puente, Impresora, Trabajo de impresión |
| Referencia | Padrón de RUC, compartido por todas las empresas |

**Decisiones clave:**

- **Identificadores UUID** en todas las tablas.
- **Las ventas guardan cómo eran al venderse:** el ítem guarda su precio y sus modificadores, y el comprobante, los datos del cliente. Un cambio de precio no altera las ventas pasadas.
- **Una orden puede tener varias mesas**, así se resuelve unir mesas. El estado de la mesa se calcula a partir de su orden abierta; no se guarda aparte.
- **Cada orden tiene un tipo** (mesa, mostrador, para llevar o delivery) **y un canal** (salón, web o teléfono). Los datos de entrega van en su propia tabla, para crecer al delivery completo sin tocar lo demás.
- **El pedido web es una orden más,** en estado pendiente.
- **Las estaciones se definen por empresa.** Cada sucursal asocia cada estación a una impresora o a una pantalla KDS.
- **Dividir la cuenta genera varios comprobantes** para la misma orden, cada uno con sus pagos.
- **Los montos se guardan con decimales exactos,** nunca como números de coma flotante.

### Origen: sección "Estados" (fragmento)

Cada objeto avanza por pocos estados y las excepciones quedan registradas. El control principal está en el ítem: desde que se envía a cocina, anularlo exige clave de supervisor.

### Origen: sección "Roles y permisos" (completa)

Cinco roles por sucursal, más un superadministrador de nuestra empresa. "Clave" significa que la acción procede si un supervisor escribe su PIN en ese momento, y queda registrado quién autorizó.

| Acción | Mozo | Cajero | Cocina/Barra | Supervisor | Administrador |
| --- | --- | --- | --- | --- | --- |
| Abrir mesa, comandar, adiciones y pre-cuenta | ✓ | ✓ | — | ✓ | ✓ |
| Mover y unir mesas | ✓ | ✓ | — | ✓ | ✓ |
| Anular ítem enviado, aplicar descuento o cortesía | clave | clave | — | ✓ | ✓ |
| Confirmar pedidos web y registrar pedidos por teléfono | — | ✓ | — | ✓ | ✓ |
| Cobrar, dividir la cuenta y emitir comprobantes | — | ✓ | — | ✓ | ✓ |
| Emitir nota de crédito | — | clave | — | ✓ | ✓ |
| Abrir y cerrar caja, reportes X y Z, ingresos y egresos | — | ✓ | — | ✓ | ✓ |
| Usar el KDS y marcar platos listos | — | — | ✓ | ✓ | ✓ |
| Marcar agotados (86) y cargar porciones del día | — | — | ✓ | ✓ | ✓ |
| Registrar ingresos de mercadería | — | ✓ | — | ✓ | ✓ |
| Ajustes de stock y mermas | — | — | — | ✓ | ✓ |
| Editar la carta y los precios | — | — | — | — | ✓ |
| Usuarios, sucursales, equipos y configuración | — | — | — | — | ✓ |
| Reportes | — | Su turno (X) | — | Su sucursal | Todas las sucursales |

- Un usuario puede tener un rol distinto en cada sucursal. En un negocio pequeño, una sola persona puede ser Administrador y hacerlo todo.
- El Cajero incluye todo lo que hace el Mozo.
- El superadministrador gestiona empresas, sucursales y suscripciones. Puede entrar a la cuenta de un cliente para darle soporte, siempre con registro en la auditoría.

### Origen: sección "Modelo comercial" (completa)

Cobramos una suscripción mensual por sucursal que incluye la facturación electrónica, con usuarios y dispositivos ilimitados.

- **Planes:** cada plan activa módulos; al inicio habrá un solo plan. El sistema queda preparado para planes premium, como el delivery completo.
- **Cuota de comprobantes:** cada plan incluye una cantidad de comprobantes al mes. Al superarla, la emisión nunca se bloquea: el excedente se cobra en la siguiente factura o se sugiere subir de plan.
- **Suscripción vencida:**
  - Primero hay unos días de gracia con avisos al administrador.
  - Luego viene la suspensión, que se aplica en la siguiente apertura de caja y nunca corta un turno abierto.
  - Aun suspendido, el cliente puede consultar y exportar sus datos.
- **Cobro de suscripciones:** manual en el MVP. Nuestro equipo registra el pago y el sistema controla los vencimientos.
- **Alta de clientes:** la hace nuestro equipo. Incluye la configuración, la autorización del PSE en SUNAT y la importación de la carta desde Excel.
- **Documentos legales:** términos y condiciones, contrato de servicio y política de privacidad. Según la Ley 29733, nuestra empresa trata los datos personales por encargo de cada restaurante.
- **Cancelación:** el cliente descarga sus datos y comprobantes. Los datos se eliminan cuando vence el plazo que fije el contrato.

### Origen: sección "Infraestructura y costos" (fragmento)

Producción corre en DigitalOcean con Cloudflare delante, por unos USD 28 a 40 al mes con menos de 10 clientes. Durante el desarrollo el costo de servidores es cero.

| Pieza | Servicio | Qué corre ahí |
| --- | --- | --- |
| Servidor de producción | VPS de DigitalOcean (2 o 4 GB) | API NestJS, worker y carta web Next.js, en Docker |
| Base de datos | PostgreSQL administrado de DigitalOcean | Datos y colas, con respaldos diarios y restauración a cualquier momento de los últimos 7 días |
| PWA del restaurante | Cloudflare Pages | Archivos estáticos con CDN |
| DNS, HTTPS y protección | Cloudflare (plan gratuito) | Certificados y protección contra ataques |
| Archivos | Cloudflare R2 | Fotos de la carta, PDF y XML de comprobantes, copias semanales de la base |
| Errores y caídas | Sentry y un monitor de disponibilidad (planes gratuitos) | Alertas al equipo |
| CI/CD | GitHub Actions | Pruebas en cada push y despliegue automático |

**Región:** Nueva York. DigitalOcean no tiene región en Sudamérica, y unos 100 ms de latencia desde Lima no afectan a esta app.

**Entornos:** local con Docker Compose; staging en un VPS pequeño con PostgreSQL propio, cuando haya clientes reales; y producción.

**Seguridad:** el servidor solo acepta tráfico que pasa por Cloudflare, SSH solo con llave, la base de datos solo es accesible desde la red privada y las claves viven como secretos de GitHub.

### Origen: sección "Pendientes de validar" (fragmentos)

El diseño está cerrado. Faltan estas validaciones y definiciones comerciales antes de salir a producción.

- […]
- [ ] Definir el precio por sucursal, la cuota de comprobantes de cada plan y el costo del excedente.
- [ ] Definir los días de gracia antes de suspender una sucursal.
- [ ] Definir en el contrato el plazo de conservación de datos tras una cancelación.
- […]
- [ ] Redactar los términos y condiciones, el contrato de servicio y la política de privacidad.
