# 2. La carta

Todo este capítulo se hace como `fogon.admin`, en el menú **Carta**. Las pestañas son "Productos",
"Familias", "Modificadores" y "Estaciones" (esta última solo la ve el Administrador).

La carta es **de la empresa**: se arma una vez y la usan todas las sucursales. Cada sucursal puede
tener su propio precio o desactivar un producto (paso 2.7).

Orden: estaciones y familias primero, porque cada producto necesita una familia y, si se prepara,
una estación.

## 2.1 Estaciones de producción

**Para qué sirve:** una estación es el lugar donde se prepara algo. Cuando el mozo envía un pedido, el
sistema reparte cada plato a su estación: la limonada va a la barra y el lomo a la cocina, cada uno
por su pantalla o su impresora. Así nadie tiene que gritar ni pasar papelitos.

En **Carta › Estaciones**, toca **"Agregar estación"** y crea, una por una:

| "Nombre de la estación" | Qué prepara                |
| ----------------------- | -------------------------- |
| `Cocina`                | Entradas, fondos y postres |
| `Barra`                 | Bebidas, jugos y tragos    |
| `Parrilla`              | Carnes a la parrilla       |

Máximo 50 caracteres. Una estación no se borra: se desactiva, y solo si ningún producto activo la usa.

## 2.2 Familias

**Para qué sirve:** las familias agrupan la carta como la verá el mozo en el comandero (y el cliente
en la carta web): pestañas como Entradas o Bebidas para encontrar rápido lo que pide la mesa.

En **Carta › Familias**, toca **"Agregar familia"** y crea:

1. `Entradas`
2. `Fondos`
3. `Parrillas`
4. `Bebidas`
5. `Postres`

Luego toca **"Ordenar"**, deja el orden de arriba con las flechas y toca **"Guardar orden"**: así
aparecerán en todas las sucursales.

## 2.3 Productos simples

**Para qué sirve:** cada producto es lo que se vende, con su precio con IGV, su estación y cómo se
controla su stock.

En **Carta › Productos**, toca **"Nuevo producto"**. Crea estos, uno por uno. Para todos: "Tipo de
producto" **Simple**, "Se vende solo" encendido, "Datos tributarios" sin tocar ("Gravado con IGV").

| "Nombre"                  | "Familia" | "Precio con IGV" | "Estación" | "Control de stock" |
| ------------------------- | --------- | ---------------- | ---------- | ------------------ |
| `Papa a la huancaína`     | Entradas  | `18.00`          | Cocina     | Sin control        |
| `Causa limeña`            | Entradas  | `20.00`          | Cocina     | Sin control        |
| `Lomo saltado`            | Fondos    | `38.00`          | Cocina     | Por porciones      |
| `Ají de gallina`          | Fondos    | `32.00`          | Cocina     | Por porciones      |
| `Bife angosto 300 g`      | Parrillas | `65.00`          | Parrilla   | Por unidades       |
| `1/4 de pollo a la brasa` | Parrillas | `24.00`          | Parrilla   | Por porciones      |
| `Inca Kola 500 ml`        | Bebidas   | `6.00`           | Barra      | Por unidades       |
| `Coca-Cola 500 ml`        | Bebidas   | `6.00`           | Barra      | Por unidades       |
| `Limonada frozen`         | Bebidas   | `12.00`          | Barra      | Sin control        |
| `Suspiro a la limeña`     | Postres   | `14.00`          | Cocina     | Sin control        |

Ejemplo de "Descripción" (opcional, se verá en la carta web) para el lomo: `Trozos de lomo fino
salteados al wok con cebolla, tomate y papas fritas.`

El precio acepta `38`, `38.5` o `S/ 38.50`; se guarda como `38.50`. Es lo que paga el cliente, con el
IGV ya incluido.

**Qué tipo de control de stock elegir:**

| Opción          | Úsala para                                                           |
| --------------- | -------------------------------------------------------------------- |
| "Por unidades"  | Lo que se compra y se cuenta: gaseosas, cervezas, cortes de carne    |
| "Por porciones" | Lo que se prepara en cantidad cada día y se acaba: pollo, guisos     |
| "Sin control"   | Lo que no quieres contar; lo marcas "agotado" a mano cuando se acaba |

Hoy esta elección **solo se guarda**: el conteo de stock llegará con el módulo de inventario. Mientras
tanto, ningún producto se bloquea por stock; los agotados se marcan a mano (paso 2.8).

**Foto:** se agrega después de crear el producto. Abre el producto ("Guardar cambios" ya está hecho),
en la sección "Foto" toca **"Tomar o elegir foto"** y elige una imagen JPEG, PNG o WebP de al menos 200
píxeles de lado. La app la achica sola. Prueba con una foto del lomo.

**"Se vende solo" apagado** sirve para algo que solo existe dentro de un combo o un menú: no aparece
suelto en el comandero. Por ejemplo, un `Refresco del día` que solo viene con el menú.

Crea también estos dos, con "Se vende solo" **apagado**, para el menú del paso 2.6:

| "Nombre"           | "Familia" | "Precio con IGV" | "Estación" | "Control de stock" |
| ------------------ | --------- | ---------------- | ---------- | ------------------ |
| `Sopa de la casa`  | Entradas  | `8.00`           | Cocina     | Por porciones      |
| `Refresco del día` | Bebidas   | `4.00`           | Barra      | Por porciones      |

## 2.4 Grupos de modificadores

**Para qué sirve:** son las preguntas que el mozo hace al tomar el pedido ("¿término de la carne?",
"¿algún extra?"). Al estar definidas, el mozo toca en lugar de escribir, la cocina lee siempre lo
mismo y lo que cuesta más se cobra solo.

En **Carta › Modificadores**, toca **"Nuevo grupo"**.

### Grupo 1: término de la carne (una opción, obligatoria)

- "Nombre del grupo": `Término de la carne`
- "Cuántas se pueden elegir": **Una sola**, con **"Obligatorio"** encendido
- "Opciones" (toca "Agregar opción" para cada una; "Precio extra" vacío vale 0):
  1. `Jugoso`
  2. `Término medio`
  3. `Tres cuartos`
  4. `Bien cocido`

El resumen "Quien comanda verá" debe decir **"Elige 1, obligatorio"**. Guarda.

### Grupo 2: extras (varias, opcionales y con precio)

- "Nombre del grupo": `Extras`
- "Cuántas se pueden elegir": **Varias**, "Mínimo" `0`, "Máximo" `3`
- "Opciones":

| "Nombre"      | "Precio extra" |
| ------------- | -------------- |
| `Huevo frito` | `2.50`         |
| `Queso`       | `3.00`         |
| `Palta`       | `3.50`         |

Resumen esperado: **"Hasta 3, opcional"**. Guarda.

### Grupo 3: bebida del combo (ligada a productos)

- "Nombre del grupo": `Bebida del combo`
- "Cuántas se pueden elegir": **Una sola**, **"Obligatorio"** encendido
- "Opciones":

| "Nombre"           | "Precio extra" | "Producto ligado" |
| ------------------ | -------------- | ----------------- |
| `Inca Kola 500 ml` | `0`            | Inca Kola 500 ml  |
| `Coca-Cola 500 ml` | `0`            | Coca-Cola 500 ml  |
| `Limonada frozen`  | `4.00`         | Limonada frozen   |

**Para qué sirve el "Producto ligado":** cuando el cliente elige Inca Kola en el combo, el sistema
sabe que salió una Inca Kola de verdad: la manda a la **Barra** y, cuando exista el inventario,
descontará su stock.

### Asignar grupos a productos

Abre **`Bife angosto 300 g`** y, en la sección "Modificadores", toca **"Agregar un grupo"**: agrega
`Término de la carne` y `Extras`. Guarda. Haz lo mismo con `Lomo saltado`, solo con `Extras`.

## 2.5 Un combo

**Para qué sirve:** vender varios productos a un precio fijo, dejando que el cliente elija algunas
partes (la bebida, por ejemplo). Cada parte va a su estación: el pollo a la parrilla y la bebida a la
barra.

1. Crea `Papas fritas` como producto simple: Parrillas, `10.00`, estación Parrilla, Sin control.
2. Toca **"Nuevo producto"** con:
   - "Tipo de producto": **Combo**
   - "Nombre": `Combo pollero`
   - "Familia": Parrillas
   - "Precio base con IGV": `32.00`
   - "Control de stock": Sin control
3. Crea el producto y ábrelo. En **"Componentes"**, toca "Agregar un componente":
   - `1/4 de pollo a la brasa`, cantidad 1
   - `Papas fritas`, cantidad 1
4. En **"Grupos de opciones"**, agrega `Bebida del combo`.
5. En **"Vista previa del precio"** verás "Precio con estas opciones": S/ 32.00 con Inca Kola y S/ 36.00
   con Limonada frozen (los S/ 4.00 extra).

## 2.6 Menú del día

**Para qué sirve:** el clásico "entrada + segundo + refresco" a precio fijo, cuyas opciones cambian
cada día. La carta lo tiene una sola vez; lo que cambia cada mañana es qué platos entran.

1. Crea primero los grupos de "tiempos" en **Modificadores**, cada uno **Una sola** y **Obligatorio**:
   - `Entrada del menú`, opciones `Sopa de la casa` (ligada a Sopa de la casa) y `Papa a la huancaína`
     (ligada a Papa a la huancaína).
   - `Segundo del menú`, opciones `Ají de gallina` y `Lomo saltado`, cada una ligada a su producto.
   - `Bebida del menú`, opción `Refresco del día` (ligada).
2. Toca **"Nuevo producto"**: "Tipo de producto" **Menú del día**, "Nombre" `Menú ejecutivo`,
   "Familia" Fondos, "Precio base con IGV" `15.00`, Sin control.
3. Ábrelo y en **"Tiempos del menú"** agrega los tres grupos.
4. **Armar el menú de hoy:** ve a **Disponibilidad**, pestaña del menú del día (o el enlace "Armar el
   menú del día" dentro del producto). En "Día del menú" elige **Hoy**, marca qué platos entran hoy en
   cada tiempo (por ejemplo, Sopa de la casa y Ají de gallina) y toca **"Guardar el menú de hoy"**.

Mañana puedes usar **"Repetir las de ayer"**. Si un día no se arma, el menú no se puede vender: el
comandero lo muestra como "Menú sin armar". El Cajero puede crear el producto de menú, pero armarlo cada
día lo hacen Cocina/Barra, Supervisor o Administrador.

## 2.7 Precio y disponibilidad por sucursal

**Para qué sirve:** la sucursal de San Isidro está en una zona más cara, o el Kiosco de Barranco no
tiene parrilla. Se ajusta sin duplicar la carta.

1. Abre `Lomo saltado`. En **"Precio por sucursal"**, en **El Fogón · San Isidro**, escribe `42.00` en
   "Precio propio" y toca "Guardar".
2. Abre `Bife angosto 300 g`. En **El Fogón · Kiosco Barranco**, apaga **"Disponible"** y guarda.

Un "Precio propio" vacío significa "usa el precio de la empresa".

## 2.8 Agotados

**Para qué sirve:** cuando se acaba algo en pleno servicio, la cocina lo marca y al instante deja de
poder pedirse en el comandero (y en la carta web), sin que nadie tenga que avisar mesa por mesa.

1. Como `fogon.cocina` (de 11:00 a 23:00) o como Administrador, ve a **Disponibilidad**, pestaña de
   agotados.
2. Busca `Causa limeña` y enciende **"Agotado"**.
3. En "¿Hasta cuándo?" elige **"Solo por hoy"** (mañana vuelve sola) o **"Hasta que lo reactive"**.
   Toca **"Marcar como agotado"**.
4. Si fue un error, toca **"Deshacer"** en el aviso.

En el comandero del mozo, la causa aparecerá apagada con la etiqueta "Agotado".

## Resultado del capítulo

La carta de El Fogón tiene 3 estaciones, 5 familias, 13 productos simples, 6 grupos de modificadores,
un combo y un menú del día armado para hoy. Ya puedes atender mesas: sigue con
[03-salon-y-cocina.md](03-salon-y-cocina.md).
