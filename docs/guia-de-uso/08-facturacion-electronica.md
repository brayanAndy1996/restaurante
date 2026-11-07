# 8. Facturación electrónica (modo simulado)

Necesitas el capítulo 6: una caja abierta con sus series y una mesa con comanda.

## Para qué sirve

En el Perú, cada boleta y factura debe llegar a SUNAT. El sistema lo hace solo: al cobrar, el
comprobante se envía en segundo plano a un **PSE** (el proveedor que lo firma y lo manda a SUNAT). Si
SUNAT no responde, el sistema reintenta. Si rechaza el comprobante, avisa para emitir otro. Además, la
facturación electrónica incluye:

- **Padrón de RUC:** al escribir un RUC, se completan la razón social y la dirección, y el sistema avisa
  si el RUC está de baja o no habido.
- **Notas de crédito:** sirven para anular un comprobante, devolver ítems o cambiar una boleta por
  factura, siempre con control.
- **PDF y enlace:** el cliente recibe su comprobante por WhatsApp.

**Importante:** todavía no hay contrato con un PSE real, así que todo funciona con un **PSE simulado**.
Los comprobantes simulados **no tienen valor tributario**: en pantalla llevan la marca "Simulado" y en
el ticket y el PDF dicen "SIMULADO · SIN VALOR TRIBUTARIO". Sirve para probar y hacer demostraciones,
pero no para clientes reales.

## 8.1 Preparar tu computadora (una sola vez)

Por defecto, en desarrollo los comprobantes se quedan "Por enviar", porque nadie los procesa. Para
verlos enviarse y aceptarse hacen falta tres cosas: el **worker** (el proceso que envía), el **modo
simulado** de cada RUC y el **padrón de ejemplo**.

**1. Agrega estas líneas a tu `.env`.** Usa tu puerto de base de datos: si definiste
`DB_PUERTO_LOCAL=5434`, cambia `5433` por `5434`.

```
DB_PASSWORD_COLAS=colas_local
DB_PASSWORD_REFERENCIA=referencia_local
DATABASE_COLAS_URL=postgres://restaurante_colas:colas_local@localhost:5433/restaurante
DATABASE_REFERENCIA_URL=postgres://restaurante_referencia:referencia_local@localhost:5433/restaurante
WORKER=habilitado
PADRON_RUC_URL=file:///C:/Users/braya/Desktop/proyectos-claude/restaurante/apps/api/test/soporte/padron-ejemplo.zip
```

En `PADRON_RUC_URL` va la ruta completa de tu carpeta del proyecto, con barras `/`. Es un padrón de
ejemplo con 7 RUC; el real de SUNAT pesa unos 5 GB y no hace falta para practicar.

**2. Crea los usuarios nuevos de la base y arranca:**

```powershell
pnpm local:preparar
pnpm dev
```

**3. Activa el modo simulado y carga el padrón.** El modo de cada RUC lo cambia solo nuestro equipo
(el superadministrador), y todavía no tiene pantalla. Con `pnpm dev` corriendo, abre **otra** ventana de
PowerShell y pega este bloque completo:

```powershell
$api = "http://localhost:3000"
$sesion = Invoke-RestMethod -Method Post -Uri "$api/plataforma/sesiones" -ContentType "application/json" -Body '{"usuario":"superadmin","contrasena":"Superadmin-Demo-1"}'
$h = @{ Authorization = "Bearer $($sesion.token)" }
foreach ($empresa in (Invoke-RestMethod -Uri "$api/plataforma/empresas" -Headers $h)) {
  $detalle = Invoke-RestMethod -Uri "$api/plataforma/empresas/$($empresa.id)" -Headers $h
  foreach ($emisor in $detalle.emisores) {
    Invoke-RestMethod -Method Put -Uri "$api/plataforma/empresas/$($empresa.id)/emisores/$($emisor.id)/pse" -Headers $h -ContentType "application/json" -Body '{"modo":"SIMULADO"}' | Out-Null
    Write-Output "$($empresa.nombre) · $($emisor.razonSocial): SIMULADO"
  }
}
Invoke-RestMethod -Method Post -Uri "$api/plataforma/padron/carga" -Headers $h
Write-Output "Padrón de ejemplo pedido: se carga en unos segundos."
```

Deberías ver tres líneas con "SIMULADO", una por cada RUC de demostración. Si cambiaste la contraseña
del superadministrador, cámbiala también en el bloque.

El modo y el padrón quedan guardados en la base: no hace falta repetir el paso 3, salvo que borres la
base (`docker compose down -v`).

## 8.2 Cobrar y ver el envío a SUNAT

1. Como `fogon.cajero`, cobra una mesa con **Boleta**, como en el capítulo 6.
2. En el resultado del cobro, debajo del número y del vuelto, aparece el estado en vivo:
   - **"Enviando a SUNAT…"**
   - en unos segundos, **"Aceptado por SUNAT"**, con la marca **"Simulado: sin valor tributario"**.
3. El ticket sale al instante, sin esperar a SUNAT. Dice "Representación impresa de la BOLETA DE VENTA
   ELECTRÓNICA" y, por ser simulado, "SIMULADO · SIN VALOR TRIBUTARIO".

Como `fogon.supervisor` o `fogon.admin` verás además en Caja y en Ajustes el aviso **"Facturación en modo
simulado"**: "Los comprobantes no van a SUNAT."

## 8.3 Factura con el padrón de RUC

**Para qué sirve:** la factura exige el RUC, la razón social y la dirección exactas. El padrón las
completa y evita emitir a un RUC dado de baja, que el cliente luego no podría usar.

Cobra otra mesa con **Factura** y prueba estos RUC del padrón de ejemplo:

| RUC           | Qué pasa                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------ |
| `20100070970` | Se llena "SUPERMERCADOS PERUANOS SOCIEDAD ANONIMA 'A'" y su dirección. Puedes emitir       |
| `20601234565` | "PANADERÍA EL PIÑÓN S.A.C.": activo, pero sin dirección completa: "Escríbela"              |
| `20512345671` | Aviso: "Este RUC figura como BAJA DE OFICIO / NO HABIDO en el padrón de SUNAT…"            |
| `20498765433` | Aviso: "…SUSPENSION TEMPORAL / HABIDO…"                                                    |
| `20123456786` | Aviso: "Este RUC no figura en el padrón de SUNAT…" (es válido, pero no está en el ejemplo) |

Con cualquier aviso, el cobro se detiene hasta que revises el RUC con el cliente o marques **"Emitir
igual"**. Lo que corrijas a mano en la razón social o la dirección no se vuelve a pisar. El DNI de las
boletas no se consulta.

## 8.4 El panel de comprobantes

**Para qué sirve:** ver de un vistazo qué se envió, qué falta y qué falló, y corregirlo a tiempo.
SUNAT da un plazo para enviar cada comprobante (hoy configurado en 3 días, pendiente de confirmar con el
contador).

- **Caja › "Comprobantes"**: el Cajero ve los de sus turnos; el Supervisor y el Administrador, los de la
  sucursal.
- **Ajustes › "Comprobantes"**: solo el Administrador, con filtro por sucursal.

Qué tiene el panel:

- **Filtros por estado:** "Todos", "Por enviar", "Enviado", "Aceptado", "Rechazado" y "Anulado".
- **"Buscar por número o documento":** por ejemplo `B001-1` o un RUC.
- **"Más filtros":** tipo, fechas (sin fechas muestra los últimos 7 días) y **"Solo con alerta"**.

Toca un comprobante para ver su detalle:

| Bloque                  | Qué muestra                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| "Copia para el cliente" | "Imprimir otra vez", "Ver PDF" y "Compartir por WhatsApp"            |
| "Datos"                 | Emisión, total, cliente y sucursal                                   |
| "Respuesta de SUNAT"    | Código, mensaje y observaciones                                      |
| "Envío"                 | Estado del envío, intentos, próximo intento, plazo y último problema |
| "Relacionados"          | Notas de crédito y comprobantes que lo corrigen o reemplazan         |

**Si algo falla:**

| Lo que ves                                    | Qué significa                                      | Qué haces                                                                                  |
| --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "Por enviar" con la alerta "Demorado"         | Más de 30 minutos sin respuesta                    | Esperar: el sistema reintenta a los 1, 2, 5, 15, 30 y 60 minutos. O "Reintentar el envío"  |
| Alerta "Envío detenido"                       | Pasó el plazo sin respuesta y ya no reintenta solo | **"Reintentar el envío"**                                                                  |
| "Rechazado" con la alerta "Falta emitir otro" | SUNAT lo rechazó (por ejemplo, un dato mal)        | **"Emitir otro"**: corrige los datos y sale con otro número; el rechazado conserva el suyo |
| "Todavía no se envía a SUNAT"                 | Ese RUC no tiene la facturación activada           | Pedir a soporte que la active (en local, el paso 3 de 8.1)                                 |

El Supervisor y el Administrador ven un aviso arriba, en Caja y en Ajustes, por ejemplo "1 comprobante
rechazado · 1 envío detenido", con el botón **"Ver comprobantes"**.

## 8.5 Notas de crédito

**Para qué sirve:** un comprobante aceptado por SUNAT no se borra ni se edita. Si hay que anularlo,
devolver algo o cambiar una boleta por factura, se emite una **nota de crédito**. Así queda registro de
quién lo hizo, cuánto se devolvió y por qué.

Solo se puede sobre un comprobante **"Aceptado"**. Una devolución del mismo día espera a que SUNAT lo
acepte.

**Ejemplo: el cliente devuelve una Inca Kola que no abrió.**

1. Como `fogon.cajero`, en **Caja › Comprobantes**, abre la boleta y toca **"Nota de crédito"**.
2. En "Qué quieres hacer", elige **"Devolver ítems"**. Sube a 1 la línea de Inca Kola 500 ml.
3. En "Motivos frecuentes", toca **"El cliente lo devolvió"**.
4. En "Devolución del dinero", elige **"Devolver el dinero"** en **Efectivo**: sale S/ 6.00 de tu caja.
5. Toca **"Pedir clave de supervisor"**. La ventana muestra exactamente lo que se autoriza ("Nota de
   crédito · Devolución · B001-… · S/ 6.00 · devuelve S/ 6.00 en efectivo"). Escribe el PIN de
   `fogon.supervisor` y toca **"Autorizar"**.
6. Aparece **"Nota de crédito emitida"**, con su número, su estado en vivo, "Ver PDF" y "Compartir por
   WhatsApp".

Los S/ 6.00 salen de tu turno: el cierre Z ya los descuenta de lo esperado en efectivo.

**Los tres tipos:**

| Tipo                | Cuándo                                           | Qué pasa                                                                      |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| "Anular"            | Cobro duplicado, error al cobrar                 | Anula todo el comprobante. Al aceptarse la nota, el original pasa a "Anulado" |
| "Devolver ítems"    | El cliente devuelve algo, producto en mal estado | Devuelve las unidades que elijas. Puede haber varias devoluciones             |
| "Cambiar a factura" | El cliente pagó con boleta y luego pide factura  | Anula la boleta y emite una factura nueva por lo mismo; no se devuelve dinero |

El Supervisor y el Administrador emiten notas sin clave y pueden elegir de qué turno abierto sale el
dinero. Para emitir notas, la caja necesita sus series de notas de crédito: en **Ajustes › Cajas**,
abre la caja y llena el plegable **"Notas de crédito"** (por ejemplo, `BC01` para las de boletas y `FC01`
para las de facturas).

## 8.6 PDF y WhatsApp

Cuando SUNAT acepta el comprobante, el sistema arma su PDF.

- **"Ver PDF"** lo abre en otra pestaña.
- **"Compartir por WhatsApp"** pide, opcionalmente, el "Celular del cliente" (por ejemplo `987 654 321`;
  no se guarda). Al tocar "Abrir WhatsApp", sale el mensaje "Tu BOLETA B001-… de El Fogón Restaurante
  S.A.C. por S/ …: <enlace>".

El enlace abre el PDF sin pedir sesión y **vence a los 30 días**. No se puede anular antes, así que solo
compártelo con el cliente.

Si el comprobante aún no está aceptado, verás "El PDF estará listo cuando SUNAT acepte el comprobante".

## 8.7 Antes de usarlo con clientes reales

Falta lo que no depende del código:

- **Elegir y contratar el PSE.** Con eso se construye su conector (la tarea pendiente T34). Hasta
  entonces, nada sale realmente a SUNAT.
- **Validar con el contador** los plazos de envío, el ticket sin el código hash, el redondeo de las
  devoluciones en efectivo y los códigos de las cortesías. Están listados en el `README.md`, sección
  "Para el contador (6b)".
