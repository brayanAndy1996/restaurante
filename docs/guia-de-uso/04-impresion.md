# 4. Impresión

## Para qué sirve

Muchas cocinas prefieren el ticket en papel a una pantalla. El sistema imprime cada comanda en la
impresora de su estación y la pre-cuenta en la de caja.

El navegador no puede hablar directamente con una impresora de la red del local. Por eso existe el
**puente**: una app en un celular Android del local que recibe los tickets desde la nube y los manda a
cada impresora. Si el puente se desconecta, los tickets esperan en cola y salen al reconectarse.

La app Android llegará después. Mientras tanto, para probar en tu computadora hay un **simulador del
puente** con una **impresora falsa** que muestra los tickets en la terminal, tal como saldrían en el
papel.

## 4.1 Arrancar la impresora falsa y crear la impresora

1. Con `pnpm dev` corriendo, como `fogon.admin` (sucursal Miraflores), ve a **Ajustes › Impresión**.
2. Toca **"Agregar impresora"** y crea la de cocina:
   - "Nombre de la impresora": `Cocina`
   - "Cómo se conecta": **Red**
   - "Dirección de la impresora": `127.0.0.1` (en un local real, la IP fija de la impresora, por
     ejemplo `192.168.1.50`)
   - "Puerto": `9100`
   - "Ancho del papel": **80 mm** (48 columnas; las pequeñas de 58 mm tienen 32)
   - "Juego de caracteres": **PC850 · Latino (el más común)**, para que salgan bien la ñ y las tildes
   - "Tiene gaveta": apagado
   - Toca **"Crear impresora"**.
3. Crea la de caja igual, con "Nombre" `Caja` y **"Tiene gaveta"** encendido. (Con el simulador, las dos
   apuntan a la misma impresora falsa; en un local real cada una tendría su IP.)

## 4.2 Decidir dónde sale cada estación

En el bloque **"Dónde sale cada estación"**:

| Estación | Destino                | Por qué                          |
| -------- | ---------------------- | -------------------------------- |
| Cocina   | Impresora `Cocina`     | El cocinero prefiere papel       |
| Parrilla | Impresora `Cocina`     | Comparte impresora con la cocina |
| Barra    | **Pantalla de cocina** | El barman usa la pantalla (KDS)  |

En **"Impresora de caja"**, elige `Caja` en "Impresora de la pre-cuenta".

El cambio rige desde el siguiente envío; lo ya enviado no se mueve. Las estaciones que salen por
impresora ya no aparecen como filtro en la pantalla de Cocina.

## 4.3 Vincular el simulador del puente

1. En el bloque **"Puente de impresión"**, toca **"Vincular puente"**. Aparece un código QR con "Vence en
   10:00". Debajo, en "Si no puedes escanear, copia este texto", toca **"Copiar texto"**. Empieza con
   `restaurante-puente://vincular?…`.
2. Abre una **terminal nueva** en la carpeta del proyecto (deja `pnpm dev` corriendo en la otra) y
   pega el texto entre comillas:

   ```powershell
   pnpm puente:simular --emulador --qr "restaurante-puente://vincular?api=…&t=vi.…"
   ```

3. La terminal muestra:
   - "Emulador de impresora de 80 mm escuchando en 127.0.0.1:9100…"
   - "Puente conectado a la sucursal El Fogón · Miraflores… Impresoras configuradas: 2."
   - "Esperando trabajos de impresión. Ctrl+C para terminar."
4. En la app, el bloque del puente pasa a **"Conectado"**.

El código sirve una sola vez. Para reconectar más tarde sin pedir otro, basta
`pnpm puente:simular --emulador`. Si el QR trae una dirección que tu computadora no alcanza, agrega
`--api http://localhost:3000`.

## 4.4 Imprimir

- **Página de prueba:** en **Ajustes › Impresión**, toca **"Ver y editar"** en la impresora `Cocina` y
  luego **"Imprimir página de prueba"**. En la terminal aparece un ticket entre "┌─ Ticket 1" y "└─ fin
  del ticket 1".
- **Una comanda real:** como `fogon.mozo`, abre una mesa y envía `Lomo saltado` y `Limonada frozen`. En
  la terminal sale el ticket de Cocina con el lomo; la limonada no se imprime, porque la Barra va por
  pantalla: aparece en **Cocina** con el filtro Barra.
- **La pre-cuenta:** pide la pre-cuenta de esa mesa. Sale sola por la impresora `Caja`.

Agrega `--marcas` al simulador para ver también las marcas de formato ([B] negrita, [CENTRADO],
[CORTE]).

## 4.5 Cuando algo no sale

**Prueba el corte:** detén el simulador con `Ctrl + C` y envía otra comanda.

- En todas las pantallas aparece el aviso **"El puente de impresión está desconectado"**, con "Los
  tickets quedan en cola (1)".
- En la cocina, la línea de estado dice "Impresión: sin puente · 1 en cola".
- Vuelve a correr `pnpm puente:simular --emulador`: el ticket sale solo.

**Reimprimir:** en **Ajustes › Impresión › "Trabajos de hoy"** (filtros "Todos", "Pendientes",
"Impresos") toca **"Reimprimir"** en un ticket. El mozo también puede hacerlo desde la cuenta de la
mesa, en **"Tickets impresos"**. La copia lleva la etiqueta "Reimpresión".

**Para qué sirve:** si el papel se acabó o el ticket se mojó, la cocina pide otra copia sin que el mozo
vuelva a comandar ni se dupliquen platos.

## 4.6 Problemas frecuentes

| Mensaje                                       | Qué hacer                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| «El código del QR no sirve»                   | Venció (10 minutos) o ya se usó. Pide otro con "Vincular puente"                             |
| «La API no reconoce la credencial del puente» | Se vinculó otro puente o se revocó. Borra `.puente-simulador.json` y vincula de nuevo        |
| «La impresora Cocina no responde»             | El simulador no está corriendo con `--emulador`, o la impresora no apunta a `127.0.0.1:9100` |
