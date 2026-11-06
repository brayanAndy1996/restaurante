# 7. Carta web, QR de las mesas y pedidos desde la mesa

Necesitas la carta del capítulo 2 y el mapa de mesas del capítulo 3.

## Para qué sirve

El cliente escanea con su celular el QR pegado en su mesa y ve la carta del local, con fotos y precios,
sin instalar nada ni crear una cuenta. Desde ahí puede armar su pedido y **enviarlo al mozo**, **llamar
al mozo** o **pedir la cuenta**.

El mozo recibe el aviso en su app, revisa el pedido con el cliente y recién entonces lo manda a cocina.
**Nada llega a cocina sin que el mozo toque "Enviar".** Así se evitan pedidos falsos o equivocados, y
el mozo sigue siendo quien atiende la mesa.

La carta web es otra aplicación: corre en http://localhost:3001 y la arranca el mismo `pnpm dev`.

## 7.1 Publicar la carta web

Como `fogon.admin`, ve a **Ajustes › Carta web**.

**Bloque "Tu restaurante"**

- "Nombre que ven tus clientes": `El Fogón` (no la razón social, sino el nombre con el que te conocen)
- "Dirección de tu carta": `el-fogon`. Se propone sola a partir del nombre. Reglas: de 3 a 40
  caracteres, solo minúsculas, números y guiones entre palabras. Algunas palabras están reservadas,
  como `api`, `app` o `carta`.

**Bloque "Logo y color"**

- "Subir logo": una imagen JPEG, PNG o WebP de al menos 64 píxeles de lado, cuadrada o con fondo
  transparente. Primero hay que guardar el nombre y la dirección.
- "Color de tu marca": `#B23A1E`, un rojo ladrillo, o elígelo con el selector. La muestra de abajo
  indica si las letras se leerán bien sobre ese color ("Se lee bien").

**Bloque "Sucursales"**

- En **El Fogón · Miraflores**, "Dirección de El Fogón · Miraflores": `miraflores`.
- Enciende **"Publicada"**.

Toca **"Guardar"**. Debe aparecer "Cambios guardados. Tu carta ya tiene estos datos."

Toca **"Copiar enlace"** y ábrelo en el navegador: http://localhost:3001/el-fogon/miraflores. Es la
carta pública, la que puedes compartir en Instagram o Google Maps. Arriba se ve el logo, el nombre, la
sucursal y si el local está "Abierto ahora".

Un par de cosas a tener en cuenta:

- Si cambias la dirección más adelante, el enlace anterior deja de funcionar, pero los QR de las mesas
  siguen sirviendo.
- Una sucursal sin publicar muestra "Esta carta no está disponible", tanto en su enlace como en sus QR.

## 7.2 Crear e imprimir los QR de las mesas

1. Ve a **Ajustes › Mapa de mesas** y toca **"QR de las mesas"**.
2. Si las mesas se crearon antes de esta función, verás "Tus mesas todavía no tienen QR". Toca **"Crear
   los QR que faltan"**.
3. Cada mesa aparece con su QR pequeño y el estado "QR nuevo: imprímelo".
4. Toca **"Imprimir la hoja"**. Se abre el diálogo de impresión del navegador: son hojas A4 con seis
   tarjetas de 9 × 9 cm. Cada tarjeta lleva la sucursal, "Mesa 4", el QR y "Escanea para ver la carta y
   llamar al mozo". Para guardarlas en lugar de imprimirlas, elige "Guardar como PDF".

**Cambiar un QR:** si alguien se lleva o daña la tarjeta de la mesa 4, toca **"Cambiar QR"** en esa mesa
y confirma. El QR viejo deja de funcionar al instante; imprime la hoja otra vez y pega el nuevo.

**Para qué sirve cambiarlo:** si alguien fotografió el QR, podría mandar pedidos falsos desde su casa.
Con el cambio, ese código deja de servir.

## 7.3 Abrir la carta de una mesa en tu computadora

El QR lleva a una dirección como `http://localhost:3001/m/<código de 22 caracteres>`. La pantalla de QR
no la muestra en texto, y desde el celular `localhost` no funciona. Para probar en la computadora,
obtén las direcciones de todas las mesas con este comando, en la carpeta del proyecto:

```powershell
docker compose exec postgres psql -U postgres -d restaurante -c "SELECT s.nombre AS sucursal, m.nombre AS mesa, 'http://localhost:3001/m/' || q.codigo AS enlace FROM mesa_qr q JOIN mesa m ON m.id = q.mesa_id JOIN sucursal s ON s.id = q.sucursal_id ORDER BY 1, 2;"
```

Copia el enlace de **Mesa 4** de El Fogón · Miraflores y ábrelo en una **ventana privada**, en vista de
celular (`F12` y `Ctrl + Shift + M`). Así haces de cliente, sin sesión.

Este comando es solo para practicar en tu computadora. En un local real el cliente simplemente escanea
el QR. Para probar desde tu celular de verdad, mira «Probar desde tu celular» en `DESPLIEGUE-LOCAL.md`.

## 7.4 Hacer de cliente: armar y enviar un pedido

En la carta de la mesa 4, arriba dice "Mesa 4" y "Toca un plato para agregarlo a tu pedido."

1. Toca **Bife angosto 300 g**. En la hoja del plato:
   - "Término de la carne" (Obligatorio): **Término medio**
   - "Extras" (Opcional): **Palta**
   - "Cantidad": 1
   - "Indicaciones para la cocina (opcional)": `Bien caliente, por favor`
   - Toca **"Agregar al pedido"** (S/ 68.50).
2. Toca **Limonada frozen** y agrega 2.
3. Abajo aparece **"Ver tu pedido · 2 platos"**. Tócalo: en **"Tu pedido"** puedes "Editar" o "Quitar"
   cada línea. En "Nota para el mozo (opcional)" escribe `Somos 3, uno es vegetariano`.
4. Toca **"Enviar al mozo"**.

La pantalla muestra **"Avisamos al mozo"** ("Puedes seguir viendo la carta."). Mientras el mozo no lo
atienda no puedes enviar otro pedido ni volver a llamarlo; así nadie inunda al mozo de avisos.

**Llamar al mozo y pedir la cuenta:** en la barra de abajo están **"Llamar al mozo"** y **"Pedir la
cuenta"**. Cada uno pide confirmación ("¿Llamamos al mozo a tu mesa?") con "Sí, llamar al mozo" o
"Ahora no".

## 7.5 Hacer de mozo: atender el llamado

En la otra ventana, entra como `fogon.mozo` y ve a **Salón**. Con la app abierta:

- Aparece un aviso en cualquier pantalla: **"Mesa 4 · Pedido (2 platos)"**, con el botón **"Ver"**.
  También suena y vibra, si activaste **"Sonido de avisos"** (toca la pantalla una vez para activarlo).
- En el mapa, la mesa 4 muestra la etiqueta "Pedido".
- En **Salón**, el selector **"Mesas" / "Llamados (1)"** lleva a la lista, con las secciones
  "Pendientes", "En atención" y "Recientes".

Atiende:

1. En la lista, toca **"Atender"** en la mesa 4.
   - Si la mesa estaba **libre**, se abre "Atender la mesa 4": elige los "Comensales" (`3`) y toca
     **"Atender y abrir la mesa"**. Quedas como su mozo responsable.
2. En el detalle del llamado ves cada plato con sus opciones, "Indicaciones" y la nota del cliente ("El
   cliente escribió «Somos 3, uno es vegetariano»"). Puedes cambiar cantidades o "Quitar" algo después de
   hablar con el cliente.
3. Toca **"Pasar a la cuenta"**.
4. Se abre la cuenta de la mesa con el aviso **"Pedido pasado a la cuenta"**. Toca **"Revisar y
   enviar"**: el pedido está en **"Por enviar"**. Revísalo y toca **"Enviar"**. Ahora sí llega a cocina.

En el celular del cliente, en unos 10 segundos la pantalla cambia a **"El mozo tomó tu pedido"**.

**Descartar un llamado:** si es una broma o está repetido, en el detalle toca **"Descartar"** y elige el
motivo ("Pedido falso", "Ya lo pidió al mozo", "Repetido" o "Sin motivo"). El cliente verá "No pudimos
atender este pedido. Habla con el mozo."

**Los otros dos llamados:**

- **"Llama al mozo"**: al tocar "Atender" se marca como atendido ("El mozo viene a tu mesa", en el
  celular del cliente).
- **"Pide la cuenta"**: al atender, se abre la cuenta con el aviso "El cliente pidió la cuenta", lista
  para "Pedir pre-cuenta" y luego cobrar (capítulo 6).

## 7.6 Reglas que protegen al local

| Regla                                                                  | Para qué                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Nada llega a cocina hasta que el mozo toca "Enviar"                    | Ningún pedido falso o equivocado se cocina               |
| Un solo llamado pendiente por mesa                                     | El cliente no satura al mozo                             |
| Hasta 6 llamados por mesa cada 30 minutos                              | Frena el abuso desde una mesa                            |
| Hasta 20 llamados por conexión y sucursal cada 10 minutos              | Frena a quien prueba códigos o envía desde fuera         |
| El llamado vence a los 15 minutos                                      | El cliente ve "Nadie respondió a tiempo" y puede repetir |
| Fuera del horario del local, sin cuenta abierta, no se aceptan pedidos | No llegan pedidos con el local cerrado                   |
| Lo agotado desaparece de la carta en unos 15 segundos                  | Nadie pide lo que ya no hay                              |
| Pedido de hasta 30 platos distintos, 20 de cada uno                    | Evita pedidos absurdos                                   |

Si el cliente pierde la conexión, ve "Sin conexión. Lo enviaremos cuando vuelva. No cierres esta
página." El pedido se guarda en su navegador y sobrevive a una recarga.
