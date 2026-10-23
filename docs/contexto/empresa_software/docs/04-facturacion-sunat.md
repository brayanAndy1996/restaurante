# 04 – Facturación electrónica SUNAT

## Prioridad actual (2026-10-19)

**Módulo pospuesto para la última etapa.** No forma parte del primer MVP. La cotización y elección del proveedor también se posponen. Los proveedores aquí mencionados sirven para procesar la facturación electrónica ante SUNAT; no son necesarios para desarrollar ni ejecutar el sistema en local.

Los precios y plazos siguientes son referencias históricas pendientes de verificación. El análisis con una suscripción de S/ 300 se conserva solo como referencia anterior; el precio de entrada vigente es **S/ 150/mes** y se deberá recalcular el costo cuando se aborde este módulo.

## Decisión

- **Al inicio:** usar un proveedor PSE/OSE por API. Módulo aparte, detrás de la interfaz `emitirComprobante()`.
- **Más adelante:** emisión propia (y trámite como PSE) cuando el costo por comprobante lo justifique.
- Ser OSE: descartado (certificaciones y garantías fuera de alcance).

## Precios publicados (consultados el 2026-10-17, sin confirmar vigencia)

| Proveedor | Modelo | Precio |
|---|---|---|
| Nubefact (plan normal) | Por empresa | S/ 70/mes o S/ 700/año por RUC. API gratis. |
| Nubefact (Reseller OSE) | Por consumo | Mínimo S/ 40/mes por la cuenta del revendedor. Precio por comprobante no publicado. |
| Factura Perú | Paquetes de envíos | ~S/ 0.034/envío (7,000 por S/ 236) a ~S/ 0.022 (70,000 por S/ 1,534) |
| Siscomer (Reseller PSE) | Por cupo | S/ 200 a S/ 900/mes + membresía S/ 500 (pago único) |

Fuentes: [Nubefact precios](https://www.nubefact.com/precios), [Nubefact revendedor](https://www.nubefact.com/revendedor), [Factura Perú OSE](https://facturaperu.com.pe/ose/), [Siscomer reseller](https://siscomerperu.com/resellerpse).

### Impacto en el negocio (a S/ 300 por cliente)

- Nubefact plan normal: S/ 70 de S/ 300 = **23 %** de cada suscripción. Demasiado.
- Por envío: una pollería con ~100 ventas/día emite ~3,000 boletas/mes → ~S/ 66–100/mes **si cada boleta es un envío**.
- **Clave:** las boletas pueden ir en un **resumen diario** (muchas en un envío). Si el proveedor cobra por envío, el costo baja mucho.

## Preguntas para cotizar

1. ¿Cobran por comprobante o por envío? ¿El resumen diario cuenta como un solo envío?
2. ¿Puedo manejar muchos RUC (mis clientes) desde una sola cuenta reseller?
3. ¿Incluyen certificado digital o cada cliente necesita el suyo?
4. ¿API REST con JSON? ¿Ambiente de pruebas (sandbox)?
5. ¿Ellos guardan XML y CDR, o los guardo yo? ¿Por cuánto tiempo?
6. ¿Qué pasa si su servicio se cae? ¿SLA?
7. ¿Cómo se maneja la anulación (comunicación de baja) y las notas de crédito por API?

## Plazos (fuentes no oficiales; confirmar con la norma vigente y un contador)

| Comprobante | Plazo |
|---|---|
| Factura | Enviar a SUNAT/OSE dentro de **3 días calendario**. Si llega tarde, pierde validez. |
| Boleta (individual) | Hasta el 5.º día. |
| Boleta (resumen diario) | Hasta el 7.º día. |

Consecuencia: un local no debería pasar más de ~2 días sin internet si emite facturas. El sistema debe alertar.

Fuentes: [Scrampi – plazos 2026](https://scrampi.com/blog/como-facturar-electronicamente-peru-sunat/), [Facturalaya – resumen diario](https://facturalaya.com/blog/resumen-diario-de-boletas-sunat/), [GitHub – envío individual de boletas](https://github.com/bacsystem/khipu/issues/290).

## Riesgos y cómo cubrirlos

Integrar la API de un proveedor es técnicamente sencillo. Lo que puede salir mal es **el contenido** del comprobante, no la conexión:

| Riesgo | Ejemplo | Cómo se cubre |
|---|---|---|
| Cálculo de IGV y redondeo | Total del comprobante difiere en S/ 0.01 del de los ítems | Lógica de montos en funciones puras con tests de casos reales |
| Códigos de catálogo SUNAT | Tipo de afectación de IGV equivocado (gravado vs exonerado) | Validación por un contador de cada tipo de venta del negocio |
| Comprobante que nunca llegó | Local sin internet, se vence el plazo | Cola de envío con reintentos y alertas visibles |
| Rechazos | Datos del cliente inválidos | Mostrar el motivo al usuario; flujo de corrección |
| Duplicados | Reintento envía dos veces el mismo número | Numeración controlada por el sistema e idempotencia |
| Anulaciones | Se anula una venta ya informada | Nota de crédito o comunicación de baja según el caso |

**Nadie puede garantizar 100 %.** Lo que da seguridad real:

1. Ambiente de pruebas del proveedor con todos los casos.
2. Un **contador** que revise los comprobantes de prueba de cada tipo de venta.
3. Un **negocio piloto** antes de vender en masa.
4. Monitoreo de comprobantes rechazados o pendientes desde el panel administrador.
