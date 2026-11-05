# 6. Caja, cobro y comprobantes

> **Estado:** este capítulo es de la caja (entrega 6a), que está en la rama `claude/upbeat-wright-q09k0n` y todavía no en `main`. Para seguirlo, cambia a esa rama (`git checkout claude/upbeat-wright-q09k0n`) y corre `pnpm local:preparar` y `pnpm dev`. Los comprobantes quedan «por enviar»: no salen a SUNAT hasta la entrega 6b.

## Para qué sirve

En un restaurante, quien cobra abre su turno con un fondo de efectivo, cobra cada mesa (en uno o varios medios), divide la cuenta si hace falta, aplica descuentos con la autorización del supervisor, vende en el mostrador y, al final, cierra el turno contando lo que hay en la caja.

Cada cobro emite su boleta o factura, con su número, y el ticket sale por la impresora de la caja, que abre la gaveta cuando entra efectivo. Los montos (el IGV de cada línea, el ICBPER de las bolsas, los descuentos y el redondeo) se calculan con las mismas reglas en la pantalla y en el servidor, así que lo que ves es lo que se cobra.

## 6.1 Configurar la tasa de IGV

La tasa la define el contador, no el sistema. Sin tasa, el emisor no cobra.

1. Como `fogon.admin`, ve a **Ajustes › Emisores**.
2. En el emisor **El Fogón Restaurante S.A.C.** (el de Miraflores, régimen General), toca **"Agregar tasa"**.
3. Escribe la fecha **"Desde"** (por ejemplo, `2026-01-01`: debe ser igual o anterior a hoy) y, en **"Tasa de IGV (%)"**, `18`.
4. Toca **"Guardar tasa"**.

La fecha «Desde» importa: una tasa no se crea ni se cambia para fechas en las que el emisor ya emitió comprobantes, porque las ventas pasadas no se recalculan. El emisor del Nuevo RUS («El Fogón · Kiosco Barranco») no usa tasa.

## 6.2 Crear la caja y sus series

Cada caja es un punto de cobro, con su impresora (opcional) y sus series de comprobantes.

1. En **Ajustes › Cajas**, toca **"Agregar caja"**.
2. En **"Nombre de la caja"**, escribe `Caja 1`.
3. En **"Impresora de la caja"**, elige una impresora de la 3b (capítulo 4). Si no tienes, déjala vacía: el cobro funciona y solo no imprime.
4. En **"Serie de boleta"**, escribe `B001`, y en **"Serie de factura"**, `F001`.
5. En **"Primer número"** deja `1`. Solo se elige al crear la serie.
6. Toca **"Crear caja"**.

Un comprobante lleva su serie y su correlativo: `B001-00000001`, `B001-00000002`… El número no se salta ni se repite, aunque dos cajas cobren a la vez, porque cada caja tiene sus propias series. Si tu restaurante ya emitía `B001` con otro sistema, escribe en **"Primer número"** el que sigue allí. Sin una serie de cada tipo, la caja no emite ese comprobante.

## 6.3 Abrir la caja

1. Entra como `fogon.cajero`, de la sucursal El Fogón · Miraflores.
2. Toca **Caja** en el menú.
3. Elige **"Caja 1"** en **"Caja que vas a abrir"**.
4. Escribe el **"Fondo inicial"**, por ejemplo `200.00`: lo que hay en efectivo en el cajón al empezar.
5. Toca **"Abrir caja"**. Si la impresora tiene gaveta, la gaveta se abre.

Con el turno abierto, la pantalla **Caja** muestra **Movimientos**, **Reporte X**, **Por cobrar** y el botón **Vender en el mostrador**, y aparte **Cerrar caja**.

Reglas del turno:

- Una caja tiene un solo turno abierto, y una persona, uno en la sucursal. Si `fogon.cajero` ya tiene un turno en otra caja, no puede abrir otro.
- Un ingreso o un egreso de efectivo (por ejemplo, para pagar a un proveedor) se registra en **Movimientos**, con su tipo, su monto y un motivo. Un egreso puede dejar el efectivo en negativo: el cierre lo muestra como diferencia.

## 6.4 Cobrar una mesa

1. Como `fogon.mozo`, abre una mesa y envía una comanda, como en el capítulo 3.
2. Como `fogon.cajero`, abre la cuenta de la mesa, o toca **Por cobrar** en **Caja**, y toca **"Cobrar"**.
3. Elige el comprobante: **Boleta** o **Factura**. La factura pide RUC y dirección del cliente. La boleta de más de S/ 700 pide nombre y documento (DNI, carné de extranjería o pasaporte).
4. Escribe los pagos:
   - En **Efectivo**, escribe lo que recibes en **"Recibido"**; la app calcula el **vuelto**. El total en efectivo se redondea a la décima hacia abajo, a favor del cliente, y el desglose muestra ese redondeo.
   - Con **"Agregar otro pago"** sumas otro medio: **Yape**, **Plin**, **Tarjeta de crédito** o **Tarjeta de débito**. Los medios que no son efectivo piden su número de operación.
5. Confirma el cobro.

El resultado muestra el comprobante y si el ticket se imprimió. **Imprimir otra vez** lo saca de nuevo, con la marca REIMPRESIÓN y sin abrir la gaveta. Si la cuenta quedó pagada, la mesa vuelve a estar libre; si se cobró solo una parte (ver 6.5), la mesa sigue ocupada hasta la última parte.

El cobro usa siempre el precio guardado y el total que viste. Si la cuenta cambió después (por ejemplo, el mozo agregó algo), la app no cobra el monto viejo: conserva los pagos que escribiste y te deja reintentar con la cuenta actualizada.

## 6.5 Dividir la cuenta, descuentos y cortesías

**Dividir.** En la pantalla de cobro, elige el modo:

- **Por ítems:** marca cuántas unidades de cada plato paga esta parte. Lo que falta queda para la siguiente.
- **Partes iguales:** reparte el saldo entre las partes que faltan; la última toma exactamente lo que falta.

Primero se cobran las partes por ítems y después, si hace falta, las partes iguales del resto. La mesa queda ocupada hasta la última parte.

**Descuento.** En la cuenta, usa **Descuento** junto al plato, o el de la cuenta completa. Escribe el monto o el porcentaje (hasta 99.99 %) y el motivo. La app pide la **clave de supervisor**: el Supervisor escribe su PIN, y esa autorización sirve solo para ese descuento, en esa cuenta y por ese monto.

**Cortesía.** Son unidades de un plato que no se cobran (por ejemplo, un postre de la casa). Salen en el comprobante como operación gratuita, con su valor de carta. No se dan cortesías de bolsas plásticas: el ICBPER se cobra igual.

Los descuentos y las cortesías se aplican **solo antes del primer cobro** de la cuenta: si ya se cobró una parte, la app no los deja (`CUENTA_EN_COBRO`). Quitar uno no pide clave, pero queda registrado.

## 6.6 Venta de mostrador

Para quien llega sin mesa:

1. En **Caja**, toca **Vender en el mostrador**.
2. Arma el pedido como en el comandero (carta y modificadores).
3. Toca **"Cobrar y enviar"**: primero se cobra y después la comanda va a cocina.
4. La comanda sale con **"Llamado N"** (N empieza en 1 cada día), y la pantalla de cocina muestra el mismo número para entregar el pedido.

En 6a, la venta de mostrador no lleva descuentos ni cortesías.

## 6.7 Reporte X y cierre Z

**Reporte X.** En **Caja**, toca **Reporte X**. Muestra las ventas del turno por medio de pago, los ingresos y egresos, y lo que debería haber en la caja. No cierra nada: se puede mirar cuantas veces haga falta.

**Cierre Z.**

1. Toca **Cerrar caja**.
2. Cuenta cada medio de pago y escribe lo que contaste. **No se ve lo esperado mientras cuentas**: el arqueo es a ciegas, a propósito.
3. Si algo no cuadra, la pantalla dice qué medios no cuadran, sin montos, y pide el **motivo** de cada uno (por ejemplo, en "Motivo de la diferencia en efectivo").
4. Toca **Cerrar con Z** y confirma. La Z sale impresa con la diferencia de cada medio.

Reglas del cierre:

- Cierra el responsable del turno, un Supervisor o el Administrador.
- Si es el último turno abierto de la sucursal y quedan cuentas abiertas o en pre-cuenta, el cierre se bloquea y la pantalla las lista: cóbralas o anúlalas antes.

## 6.8 Si algo no deja cobrar

| Mensaje                                                                                 | Qué hacer                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| «Falta la tasa de IGV de la empresa. El administrador la agrega en Ajustes › Emisores.» | Agrega la tasa del emisor, con su fecha «Desde» (6.1)                             |
| «Esta caja no tiene una serie activa para este comprobante…»                            | Pon la serie de ese tipo en la caja, en Ajustes › Cajas (6.2)                     |
| «La serie de esta caja llegó a su último número…»                                       | El Administrador crea otra serie en Ajustes › Cajas, por ejemplo `B002`           |
| «Aún quedan cuentas abiertas. Cóbralas o anúlalas antes de cerrar la caja.»             | Cobra o anula esas cuentas. El bloqueo solo aplica al último turno de la sucursal |
| «Este turno es de otra persona…»                                                        | Cobra en tu propio turno, o pide a un supervisor que cobre                        |
| «Los pagos no cuadran con el total…»                                                    | Revisa los montos y el redondeo del efectivo                                      |
| «Ese comprobante no se puede emitir aquí…»                                              | Elige el otro tipo: un emisor del Nuevo RUS no emite factura                      |
