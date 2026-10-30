# 3. Salón y cocina

Necesitas la carta del capítulo 2. Vas a diseñar el salón y atender la **mesa 4** de principio a fin,
viendo a la vez lo que pasa en la cocina.

## 3.1 Diseñar el mapa de mesas

**Para qué sirve:** el mapa reproduce el salón real. El mozo ve de un vistazo qué mesas están libres
(verde), ocupadas (rojo) o esperando la cuenta (ámbar), sin recorrer el local.

Como `fogon.admin`, con la sucursal **El Fogón · Miraflores**, ve a **Ajustes › Mapa de mesas**.

1. Toca **"Agregar zona"**:
   - "Nombre de la zona": `Salón principal`
   - "Columnas": `6`, "Filas": `5` (la cuadrícula del dibujo; columnas de 2 a 12, filas de 1 a 30)
   - Toca **"Crear zona"**.
2. Toca una celda libre de la cuadrícula. Se abre **"Nueva mesa"** con su "Columna X, fila Y". Crea:

| Celda             | "Nombre de la mesa" | "Capacidad (personas)" | "Forma"     |
| ----------------- | ------------------- | ---------------------- | ----------- |
| Columna 1, fila 1 | `1`                 | `2`                    | Redonda     |
| Columna 3, fila 1 | `2`                 | `4`                    | Cuadrada    |
| Columna 5, fila 1 | `3`                 | `4`                    | Cuadrada    |
| Columna 1, fila 3 | `4`                 | `4`                    | Cuadrada    |
| Columna 3, fila 3 | `5`                 | `6`                    | Rectangular |
| Columna 5, fila 3 | `6`                 | `8`                    | Rectangular |

3. Crea una segunda zona, `Terraza`, de 4 columnas y 2 filas, con las mesas `T1` y `T2` de 2 personas,
   redondas.

El nombre de la mesa admite hasta 20 caracteres y no se repite en la sucursal. Para cambiar una mesa
de lugar, tócala y usa **"Mover en la cuadrícula"**. Una mesa con cuenta abierta no se puede
desactivar.

Ahora ve a **Salón**: verás las dos zonas como pestañas y todas las mesas en verde, "Libre".

## 3.2 Preparar las dos pantallas

Para ver el circuito completo, usa dos ventanas:

- **Ventana 1, el mozo:** `fogon.mozo`, menú **Salón**. Si pregunta la sucursal, elige **El Fogón ·
  Miraflores**.
- **Ventana 2, la cocina:** en una ventana privada, `fogon.cocina` (de 11:00 a 23:00) o
  `fogon.supervisor`, menú **Cocina**.

En la cocina, enciende el interruptor **"Sonido"** y toca la pantalla una vez: sonará al llegar cada
comanda.

## 3.3 Abrir la mesa 4

**Para qué sirve:** abrir la mesa registra cuándo llegaron los clientes, cuántos son y quién los
atiende. Las ventas quedan a nombre de ese mozo.

En la ventana del mozo, toca la **mesa 4**. En la hoja **"Abrir mesa 4"**:

- "Comensales": `3` (con − / +)
- "Mozo responsable": **Tú**
- Toca **"Abrir mesa"**.

La mesa pasa a rojo, **"Ocupada"**, en todas las pantallas, sin recargar.

## 3.4 Tomar el pedido y enviarlo

**Para qué sirve:** el pedido llega completo y legible a cada estación al tocar un botón, con el
término de la carne y las observaciones, y en el orden en que hay que servir.

Dentro de la cuenta de la mesa 4, toca **"Agregar"**. Se abre el comandero **"Agregar a Mesa 4"**.
Agrega:

| Producto              | Qué eliges en la hoja del producto                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `Papa a la huancaína` | "Cantidad" 2, "Tiempo 1"                                                                             |
| `Bife angosto 300 g`  | "Término de la carne": Tres cuartos; "Extras": Huevo frito; **"Tiempo 2"**; "Observación": `Sin sal` |
| `Combo pollero`       | "Bebida del combo": Limonada frozen; "Tiempo 2"                                                      |
| `Inca Kola 500 ml`    | "Cantidad" 2, "Tiempo 1"                                                                             |

Usa **"Buscar un producto"** (por ejemplo, escribe `bife`) o las pestañas de familia. El botón de cada
hoja dice **"Agregar · S/ …"** con el total de esa línea: el bife con huevo suma S/ 67.50.

Revisa el panel **"Por enviar"** y toca **"Enviar"**.

**Qué es el "Tiempo 2":** son los platos de fondo que no deben salir junto con las entradas. La cocina
los recibe marcados **"Esperar"** y no los prepara hasta que el mozo los "marcha" (paso 3.6).

## 3.5 Lo que ve la cocina

En la ventana de la cocina aparece al instante una tarjeta **"Comanda"** de la mesa 4, con el mozo, los
comensales y un temporizador (a los 10 minutos dice "Demora" y a los 20 "Atrasada").

- Con los filtros de estación ("Todas", "Cocina", "Barra", "Parrilla") cada estación ve solo lo suyo:
  las Inca Kola en **Barra**, las papas a la huancaína en **Cocina**, el bife y el combo en
  **Parrilla**, y la limonada del combo en **Barra**.
- El bife y el combo llevan la etiqueta **"Esperar"**.
- Para cada línea, toca **"Preparando"** y luego **"Listo"**. **"Todo listo"** marca de una vez lo que
  no espera la marcha.

Al marcar las papas como listas, el mozo recibe el aviso "Papa a la huancaína × 2 de la mesa 4 está
listo".

## 3.6 Marchar el segundo tiempo

Cuando la mesa termina las entradas, en la cuenta de la mesa 4 aparece **"Esperan la marcha"** con
"2 ítems de segundo tiempo". Toca **"Marchar"**.

En la cocina llega una tarjeta **"Marchar"** ("Marchar: sacar ahora el segundo tiempo."). La cocina toca
**"Enterado"** y prepara el bife y el combo.

**Para qué sirve:** el fondo sale caliente justo cuando corresponde, no 15 minutos antes.

## 3.7 Una adición

La mesa pide postre. Toca **"Agregar"**, elige `Suspiro a la limeña` (Tiempo 1) y **"Enviar"**. En la
cuenta aparece como **"Adición 2"**, y la cocina recibe una tarjeta "Adición".

## 3.8 Anular un ítem con la clave del supervisor

**Para qué sirve:** lo que ya se envió a cocina no se puede borrar sin control, porque es la forma más
común de perder dinero. El mozo pide la anulación, un supervisor la autoriza con su PIN y queda
registrado quién pidió, quién autorizó y por qué.

1. En la cuenta, toca **"Anular"** junto a `Inca Kola 500 ml` (son 2).
2. En **"Cuántos anulas"** elige `1`.
3. En "Motivos frecuentes" toca **"El cliente lo pidió"**.
4. En **"¿El stock vuelve o es merma?"** elige **"Vuelve al stock"** (la botella no se abrió).
5. Toca **"Pedir clave de supervisor"**. En la hoja **"Clave de supervisor"**, escribe el **PIN de
   `fogon.supervisor`** (6 dígitos) y toca **"Autorizar"**.

Resultado: "Anulaste 1 × Inca Kola 500 ml." La barra recibe una tarjeta **"Anulación"** ("No lo
prepares.") con el motivo.

La autorización vale 2 minutos. Si eres Supervisor o Administrador, no se pide clave: confirmas con
"Sí, anular ítem".

## 3.9 Mover y unir mesas

**Mover:** los clientes de la mesa 4 se pasan a la 5, más grande. En la cuenta, toca **"Mover"**, luego
la **mesa 5** y **"Sí, mover"**. "La cuenta pasó a la mesa 5. La mesa 4 quedó libre." Los ítems y la
pre-cuenta no cambian.

**Unir:** llegan amigos a la mesa 6 y quieren una sola cuenta. Abre la mesa 6 con 2 comensales. Desde la
cuenta de la mesa 5, toca **"Unir"**, elige la **mesa 6** y **"Sí, unir"**. Ahora es una sola cuenta
"Mesas 5 y 6", y en el salón ambas muestran el ícono de unidas.

Una vez unidas no se pueden separar.

## 3.10 Pedir la pre-cuenta

**Para qué sirve:** el cliente revisa lo que consumió antes de pagar. Mientras está pedida, la mesa
aparece en ámbar, así el cajero sabe que esa mesa está por pagar.

En la cuenta, toca **"Pedir pre-cuenta"**. La hoja **"Pre-cuenta 1"** muestra cada línea, sus
modificadores y el **"Total"** con "IGV incluido". La mesa pasa a **"Pre-cuenta"**.

- Si hay impresora de caja (capítulo 4), la pre-cuenta **se imprime sola** al pedirla; "Imprimir otra
  vez" saca una copia.
- Si después agregas o anulas algo, la pre-cuenta "ya no vale" y hay que pedir otra.

El cobro y la emisión de boletas y facturas llegan con la sección de Caja; por ahora la atención
termina en la pre-cuenta.

## 3.11 Otros casos útiles

- **Abrieron una mesa por error:** si no se envió nada, toca **"Liberar la mesa"**. No pide clave.
- **Anular toda la cuenta:** **"Anular la orden"**, con el mismo flujo de clave de supervisor.
- **Productos que no se pueden pedir** aparecen apagados en el comandero con el motivo: "Agotado",
  "Menú sin armar", "No disponible"…
- **Sin conexión en vivo:** el salón y la cocina se actualizan cada 30 segundos hasta que vuelve.
