# Fuentes de la sección 005: carta web y pedido desde la mesa con QR

Textos copiados por el orquestador de los documentos compartidos el 2026-11-02 (requerimientos rev. 38, diseño rev. 27). Los documentos mandan; esto es una copia de trabajo para el especificador.

## Requerimientos funcionales

**Delivery, carta web y pedidos desde la mesa**

| ID | Requerimiento |
|---|---|
| RF-40 | Publicar una carta web por empresa y sucursal (dominio/empresa/sucursal) con logo, colores, fotos, horario y vista previa al compartir el enlace |
| RF-41 | Ocultar en la carta web los productos agotados o no disponibles en la sucursal |
| RF-42 | Permitir al cliente armar su pedido con modificadores y combos, e indicar nombre, teléfono, entrega o recojo, dirección con referencia, forma de pago, monto con que paga y, si quiere factura, su RUC |
| RF-43 | Pedir el consentimiento para el tratamiento de datos personales |
| RF-44 | Guardar el pedido como pendiente con un código y abrir WhatsApp hacia el número de la sucursal con el resumen |
| RF-45 | Aceptar pedidos solo dentro del horario de la sucursal, aplicando el pedido mínimo y el costo de envío configurados |
| RF-46 | Mostrar los pedidos pendientes en la bandeja con alerta sonora, confirmarlos o rechazarlos, y vencerlos a los 30 minutos |
| RF-47 a RF-49 | Pedidos telefónicos, reconocer al cliente por teléfono, mensajes predefinidos por WhatsApp |
| RF-84 | Generar un QR por mesa, imposible de adivinar, que abre la carta web en modo mesa; imprimir la hoja con los QR de la sucursal y cambiar el código de una mesa (el anterior deja de funcionar) |
| RF-85 | En la carta de mesa, armar un pedido con modificadores, combos y notas, sin datos de contacto ni pago, y enviarlo como un llamado al mozo; los precios se muestran y la cuenta usa los del sistema |
| RF-86 | Ofrecer en la carta de mesa los botones «Llamar al mozo» y «Pedir la cuenta», que llegan al mozo como llamados sin pedido |
| RF-87 | Avisar del llamado en tiempo real y con sonido al mozo responsable de la mesa, o a todos los mozos si la mesa está libre; el mozo lo revisa con el cliente, lo ajusta y lo pasa a la cuenta como ítems sin enviar. Nada llega a cocina hasta que el mozo envía la comanda |
| RF-88 | Proteger los llamados de mesa contra abusos: uno pendiente a la vez por mesa, límite de envíos por mesa, vencimiento a los 15 minutos sin atender y registro de quién lo atendió o descartó |

RNF relevante: "Interfaz táctil para tablets y celulares, y carta web liviana para datos móviles".

## Historias de usuario

- **HU-09 Agotado.** Como cocinero, quiero marcar un plato como agotado, para que nadie lo venda en salón ni en la carta web. El producto aparece agotado en el comandero y desaparece de la carta web al instante.
- **HU-21 Pedido desde la carta web.** (delivery, por WhatsApp; fuera de esta sección salvo la carta base) La carta muestra solo los productos disponibles en la sucursal.
- **HU-40 Pedir desde la mesa.** Como cliente sentado en una mesa, quiero escanear el QR, elegir mis platos y llamar al mozo con mi pedido, sin instalar nada.
  - La carta muestra solo los productos disponibles en la sucursal.
  - Al enviar, veo que el mozo ya fue avisado; puedo mandar otro pedido cuando atiendan el anterior.
  - Nada pasa a cocina sin que el mozo lo confirme.
- **HU-41 Atender un llamado de mesa.** Como mozo, quiero recibir en mi celular el pedido de la mesa, repetírselo al cliente y pasarlo a la cuenta, para enviarlo a cocina con el botón de siempre.
  - Si la mesa está libre, al atender el llamado la abro y quedo como responsable.
  - Puedo cambiar cantidades, quitar platos o descartar el llamado.
  - Un llamado sin atender vence a los 15 minutos.
- **HU-42 QR de las mesas.** Como administrador, quiero imprimir el QR de cada mesa y cambiar el de una mesa, para que el cliente llegue a la carta de su mesa.
  - Al cambiar el QR de una mesa, el anterior deja de funcionar.

## Documento de diseño

- Alcance: "Para llevar y delivery: carta web por sucursal, pedido enviado por WhatsApp, bandeja de pedidos y pedidos por teléfono." Fuera del MVP: "Dominio propio para la carta web, reservas y cobro automático de suscripciones."
- Flujo de atención en mesa, párrafo nuevo: "**Pedido desde la mesa con QR (RF-84 a RF-88).** Cada mesa tiene un QR que abre la carta web en modo mesa. El cliente arma su pedido y lo envía como un llamado: no va a cocina, le llega al mozo. El mozo va a la mesa, repite el pedido, lo ajusta y lo pasa a la cuenta como ítems sin enviar; desde ahí sigue el paso de enviar la comanda de siempre. Así el envío de comandas, los montos y la impresión no cambian, y un pedido falso nunca llega a cocina. El llamado es parte de la ruta crítica de pedidos web (confirmación, vencimiento y protección contra pedidos falsos)."
- Reglas: "La carta web solo acepta pedidos dentro del horario de la sucursal." "Stock visible: el comandero muestra cuántas unidades quedan, y la carta web oculta lo agotado."
- Infraestructura: "API NestJS, worker y carta web Next.js, en Docker". La carta web vive en `apps/web` (Next.js), que aún no existe.

## Decisiones del usuario (2026-11-02)

El usuario aceptó estos valores por defecto ("ok, entonces sigue con el desarrollo") y eligió esta sección como la siguiente:

1. Una mesa libre puede llamar: el aviso va a todos los mozos de la sucursal; quien atiende abre la mesa y queda como responsable.
2. El cliente puede mandar otro pedido cuando atiendan el anterior (uno pendiente a la vez por mesa).
3. La carta de mesa muestra precios; la cuenta usa los precios del sistema.
4. Un llamado sin atender vence a los 15 minutos.
5. Se incluyen los botones «Llamar al mozo» y «Pedir la cuenta».
6. El mozo confirma: el pedido de la mesa nunca va directo a cocina.
