# Fuentes: Carta

- **Fecha de extracción:** 2026-10-28
- **Requerimientos e historias de usuario:** https://claude.ai/artifact/SfRCerAMxTQsFNL23bTuQq (rev. 18)
- **Documento de diseño:** https://claude.ai/artifact/1YzRwiYqDapgyVCBsHK2Gd (rev. 17)

> Extracto literal para el especificador; ante discrepancia, mandan los documentos compartidos.

Notas de extracción (no forman parte de los documentos):

- El texto se copia tal cual, solo de las partes que tocan a la Carta. El extracto completo de ambos documentos (a 2026-10-27) está en `specs/002-plataforma-y-acceso/fuentes.md`; desde entonces solo cambiaron RF-08, RF-09, RF-10, RNF-08, HU-02, la primera regla de "Seguridad" del diseño, la fila "Seguridad" del modelo de datos y se agregó RNF-20 (texto abajo).
- `[…]` marca texto omitido entre fragmentos de una misma sección.

---

## Parte 1. Documento de requerimientos e historias de usuario

### Origen: "Requerimientos funcionales" · **Carta**

| ID    | Requerimiento                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-14 | Gestionar familias y productos con foto, descripción, precio con IGV, afectación tributaria, estación de producción y tipo de control de stock      |
| RF-15 | Ajustar por sucursal el precio, la disponibilidad y el estado de agotado de cada producto                                                           |
| RF-16 | Gestionar grupos de modificadores (selección única o múltiple, mínimo, máximo, obligatorio), con precio extra y vínculo a un producto opcionales     |
| RF-17 | Gestionar combos con componentes y opciones a elegir que pueden cambiar el precio                                                                   |
| RF-18 | Armar el menú del día como un combo cuyas opciones se cambian cada día                                                                              |
| RF-19 | Definir estaciones de producción por empresa y asociarlas en cada sucursal a una impresora o una pantalla KDS                                       |
| RF-20 | Marcar productos como agotados (86) y reactivarlos                                                                                                  |
| RF-21 | Importar la carta desde Excel                                                                                                                       |

### Origen: "Historias de usuario" · **Carta**

- **HU-05 Crear producto.** Como administrador, quiero crear productos con foto, precio, familia, estación y tipo de control de stock, para venderlos en salón y en la carta web.
  - El precio incluye IGV.
  - Cada producto indica su estación de producción y su tipo de control de stock.
- **HU-06 Ajuste por sucursal.** Como administrador de una cadena, quiero cambiar el precio o la disponibilidad de un producto en una sola sucursal, para adaptar la carta a cada local.
  - El ajuste no afecta a las demás sucursales.
- **HU-07 Modificadores.** Como administrador, quiero definir grupos de modificadores como "Término de la carne", para que el mozo los elija sin escribir.
  - Se configura selección única o múltiple, mínimo, máximo y si es obligatorio.
  - Un modificador puede tener precio extra y estar ligado a un producto para descontar su stock.
- **HU-08 Combos y menú del día.** Como administrador, quiero armar combos y el menú del día con opciones a elegir, para vender promociones.
  - El combo tiene precio fijo, y una opción puede sumar un monto.
  - Cada componente va a su estación y descuenta su stock.
  - Las opciones del menú del día se cambian cada día.
- **HU-09 Agotado.** Como cocinero, quiero marcar un plato como agotado, para que nadie lo venda en salón ni en la carta web.
  - El producto aparece agotado en el comandero y desaparece de la carta web al instante.

### Origen: "Requerimientos funcionales" · otros módulos que dependen de la Carta (contexto, no son de esta sección)

| ID    | Requerimiento                                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-40 | Publicar una carta web por empresa y sucursal (dominio/empresa/sucursal) con logo, colores, fotos, horario y vista previa al compartir el enlace                                                     |
| RF-41 | Ocultar en la carta web los productos agotados o no disponibles en la sucursal                                                                                                                       |
| RF-42 | Permitir al cliente armar su pedido con modificadores y combos, e indicar nombre, teléfono, entrega o recojo, dirección con referencia, forma de pago, monto con que paga y, si quiere factura, su RUC |
| RF-67 | Llevar el stock por sucursal según el tipo de control de cada producto: por unidades, por porciones del día o sin control                                                                            |
| RF-68 | Descontar el stock al enviar a cocina, incluidos los componentes de combos y los modificadores ligados a productos                                                                                   |
| RF-69 | Bloquear la venta en cero para los productos por porciones; para los productos por unidades, avisar y permitir, o bloquear si la sucursal lo configura                                               |
| RF-70 | Marcar como agotado, automáticamente, un producto por porciones que llega a cero                                                                                                                    |
| RF-73 | Al cierre del día, pasar las porciones sobrantes a merma o al día siguiente, según cada producto                                                                                                     |
| RF-74 | Mostrar el kardex de cada producto y alertar cuando su stock baja del mínimo                                                                                                                        |
| RF-76 | Configurar las impresoras de cada sucursal: conexión (red o Bluetooth), ancho de papel (58 u 80 mm), juego de caracteres y gaveta                                                                    |
| —     | (Facturación) Calcular base imponible, IGV por línea, ICBPER, descuentos y redondeos según la tasa vigente del emisor                                                                                |
| RF-13 | Registrar en la auditoría las anulaciones, descuentos, cortesías, notas de crédito, ajustes de stock y cambios de configuración                                                                      |

### Origen: "Requerimientos no funcionales" (los que aplican)

| ID     | Categoría      | Requerimiento                                                                                                                                         |
| ------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-03 | Rendimiento    | Las pantallas de operación responden en menos de 1 segundo                                                                                            |
| RNF-06 | Seguridad      | Aislamiento de los datos de cada empresa en la base de datos (RLS)                                                                                    |
| RNF-09 | Auditoría      | Registro que no se puede modificar de las acciones protegidas: quién, qué, cuándo y quién autorizó                                                    |
| RNF-10 | Resiliencia    | Reintento automático de operaciones ante microcortes, sin duplicados                                                                                  |
| RNF-11 | Compatibilidad | La PWA funciona en Chrome para Android y en Safari para iPhone y iPad, en versiones recientes                                                         |
| RNF-13 | Usabilidad     | Interfaz táctil para tablets y celulares, y carta web liviana para datos móviles                                                                      |
| RNF-14 | Idioma y moneda | Solo español y soles                                                                                                                                 |
| RNF-17 | Mantenibilidad | TypeScript en todo el sistema, código compartido para los cálculos y pruebas automáticas de montos e impuestos                                       |
| RNF-18 | Costos         | Sin servicios externos de pago en el plan base, salvo el PSE                                                                                          |
| RNF-20 | Trazabilidad   | Cada registro de datos de clientes guarda quién lo creó y quién lo modificó por última vez: usuario y equipo, superadministrador o proceso del sistema |

### Origen: "Fuera del alcance del MVP" (lo que toca a la Carta)

- Inventario por recetas e insumos, y transferencias entre sucursales.
- Precios distintos por canal y ventas al crédito.

---

## Parte 2. Documento de diseño

### Origen: "Alcance" · **Entra en el MVP**

- **Carta:** familias, productos, modificadores, combos, menú del día, estaciones de producción, ajustes por sucursal y agotados (86).

### Origen: "Reglas de negocio" · **Ventas y precios**

- Los precios de la carta incluyen IGV. El sistema calcula la base imponible y el IGV a partir de ellos.
- Solo se vende en soles.
- Un solo precio en todos los canales. En para llevar y delivery, el envase y el envío se cobran aparte.
- Los combos tienen precio fijo, y algunas opciones pueden sumar un monto. Cada componente va a su estación y descuenta su propio stock.
- El menú del día es un combo cuyas opciones cambian cada día y se controlan por porciones del día.
- Las cortesías requieren clave de supervisor; descuentan stock y no se cobran. Su tratamiento tributario lo define el contador.
- Los descuentos pueden ser por ítem o por cuenta, siempre con clave de supervisor y motivo.

### Origen: "Inventario"

| Tipo de control             | Ejemplos                                                 | Cómo funciona                                                                                              |
| --------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Por unidades                | Gaseosas, cervezas, licores, agua, postres comprados     | Kardex: entra por compras, sale por ventas y se corrige con ajustes y mermas                               |
| Por porciones del día       | Ají de gallina, menú del día, pollo a la brasa           | Cocina carga las porciones preparadas; cada venta descuenta una, y en cero el plato se marca agotado solo |
| Sin control                 | Platos que el restaurante no quiere contar               | Se marca agotado a mano (86)                                                                               |
| Por receta (después del MVP) | Platos con control de cada insumo                       | Cada venta descuenta los insumos de su receta                                                              |

**Reglas:**

- **Sin stock:** en los productos por porciones, la venta se bloquea al llegar a cero. En los productos por unidades, el sistema avisa pero deja vender; cada sucursal puede configurarlo para bloquear.
- **Anulaciones:** si se anula un ítem ya enviado, el supervisor decide si el stock vuelve o es merma.
- **Combos y modificadores:** un combo descuenta sus componentes. Un modificador ligado a un producto descuenta ese producto; por ejemplo, elegir Inca Kola en el combo descuenta una Inca Kola.
- **Cierre del día:** las porciones que sobran se registran como merma o pasan al día siguiente, según lo configurado en cada producto.
- **Stock visible:** el comandero muestra cuántas unidades quedan, y la carta web oculta lo agotado.
- **Alertas:** el panel avisa cuando un producto baja de su stock mínimo.
- **Valorización:** al costo promedio.

### Origen: "Facturación" · **Qué hace nuestro sistema** […]

- Calcula los montos: IGV por línea, ICBPER, descuentos y redondeos. El PSE envía lo que le mandamos.

### Origen: "Modelo de datos"

| Módulo     | Entidades                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Carta      | Familia, Producto, Ajuste del producto por sucursal, Grupo de modificadores, Modificador, Componente de combo, Estación de producción |
| Inventario | Stock por sucursal, Movimiento de kardex, Ingreso de mercadería, Proveedor, Carga de porciones                                       |
| Impresión  | Puente, Impresora, Trabajo de impresión                                                                                            |

**Decisiones del modelo** […]

- **Identificadores UUID** en todas las tablas.
- **Las ventas guardan cómo eran al venderse:** el ítem guarda su precio y sus modificadores, y el comprobante, los datos del cliente. Un cambio de precio no altera las ventas pasadas.
- **Las estaciones se definen por empresa.** Cada sucursal asocia cada estación a una impresora o a una pantalla KDS.
- **Los montos se guardan con decimales exactos,** nunca como números de coma flotante.

### Origen: "Roles y permisos" (filas que tocan a la Carta)

| Acción                                          | Mozo | Cajero | Cocina/Barra | Supervisor | Administrador |
| ----------------------------------------------- | ---- | ------ | ------------ | ---------- | ------------- |
| Marcar agotados (86) y cargar porciones del día | —    | —      | ✓            | ✓          | ✓             |
| Editar la carta y los precios                   | —    | —      | —            | —          | ✓             |
