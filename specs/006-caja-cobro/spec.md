# 006 · Caja, cobro y comprobantes

- **Historias y requerimientos:**
  - **Entrega 6a (caja, cobro y comprobante sin PSE):** HU-25, HU-26, HU-28 y HU-30 completas; HU-18 (venta en mostrador, que 004 dejó aquí); HU-03 en lo que toca a descuentos y cortesías; RF-50 a RF-56; RF-33 (descuentos y cortesías, que 004 dejó aquí) y RF-34 (mostrador); RF-57 sin el envío al PSE; RF-59, RF-60, RF-61, RF-65; RF-05 (cuota de comprobantes) y RF-06 (suspensión al abrir caja) por sus ganchos; RF-12 y RF-13 en descuentos, cortesías y configuración; RF-23 (la mesa vuelve a verde) y RF-32 (la pre-cuenta con descuentos); RF-64 en la impresión del ticket (sin el PDF). RNF que aplican: RNF-03, RNF-06, RNF-09, RNF-10, RNF-14, RNF-16, RNF-17 y RNF-20.
  - **Entrega 6b (facturación electrónica):** HU-27, HU-29 y HU-31; RF-57 (envío por el PSE), RF-58, RF-62, RF-63, RF-64 (PDF y WhatsApp) y RF-66. RNF que aplican: RNF-07 (credenciales del PSE cifradas), RNF-10, RNF-18 y RNF-19.
  - **Quedan para otras secciones:** RF-79 a RF-83 y HU-35 a HU-37 (reportes y exportación, sección de reportes: aquí solo quedan los datos); el registro posterior de las ventas hechas con el talonario de contingencia (pregunta 23); el cobro de pedidos de delivery (sección de delivery: el cobro de esta sección sirve igual para una orden `DELIVERY`).
  - Fuente de negocio: `fuentes.md` de esta carpeta (requerimientos rev. 45, diseño rev. 29) y las decisiones de 002 a 005 que siguen vigentes. Donde las fuentes no alcanzan, los criterios están escritos con la recomendación de cada pregunta de "Preguntas abiertas" y la citan como "pregunta N".
- **Ruta crítica:** sí, casi toda. Propuesta del especificador (la confirma el orquestador en el paso 3): P1 a P6 en 6a y P7 a P9 en 6b. Ver "Clasificación de ruta crítica".
- **Estado:** borrador (2026-11-04), pendiente de aprobación del usuario.

## Objetivo

Que el cajero abra su turno con un fondo, cobre cada mesa con uno o varios medios de pago (efectivo con vuelto, tarjeta, Yape o Plin con su número de operación), divida la cuenta por ítems o en partes iguales, aplique descuentos y cortesías con la clave del supervisor, venda en mostrador cobrando primero con un número de llamado, y cierre su turno con un arqueo por medio de pago donde toda diferencia lleva su motivo. Cada cobro genera su boleta o factura con su serie y correlativo, sin saltos ni duplicados aunque cobren dos cajas a la vez, con los montos calculados en código compartido (base imponible, IGV por línea, ICBPER, descuentos y redondeos) e impresos en la impresora de la caja, que abre la gaveta cuando entra efectivo. En la segunda entrega, esos comprobantes viajan a SUNAT por un PSE intercambiable (con un simulador), con reintentos, un panel de estados con alertas, la consulta del RUC y las notas de crédito. Todo idempotente ante microcortes y sin que una empresa vea nada de otra.

## Entregas: 6a y 6b

| Entrega | Qué entrega | Criterios | Por qué así |
| --- | --- | --- | --- |
| **6a · Caja, cobro y comprobante** | Cajas y series por sucursal, tasa de IGV del emisor, reglas puras de montos, turno de caja (apertura, ingresos y egresos, X, Z con arqueo y bloqueo del último turno), la cuenta con su desglose, descuentos y cortesías con clave, cobro con varios medios, vuelto y redondeo, división por ítems y en partes iguales, emisión del comprobante con serie y correlativo (queda "por enviar"), cuota del plan, venta de mostrador con número de llamado, ticket del comprobante, X y Z impresos, gaveta, pantallas de caja y E2E | 1 a 119 | Concentra casi toda la ruta crítica (montos, cobro y caja, series, permisos) y se prueba entera sin PSE: el comprobante queda completo y "por enviar". Así el cálculo y la numeración, que son lo delicado, se atacan antes de hablar con un sistema externo. |
| **6b · Facturación electrónica** | Conector del PSE con su simulador (RF-66), envío fuera de la transacción con reintentos y estados, panel de comprobantes con alertas (HU-31), consulta del RUC con el padrón de SUNAT (HU-27), notas de crédito con clave y devolución como egreso (HU-29), PDF y enlace para WhatsApp | 120 a 152 | Depende de un sistema externo que todavía no se elige (pendiente del diseño), usa por primera vez las colas de pg-boss y el worker, y trae una tabla de referencia grande (el padrón). Sus criterios se revisan antes de empezarla, con lo que deje 6a y con el PSE elegido. |

Se ejecutan en ese orden: 6a completa (fases A a D y su commit de cierre) y después 6b. **6a no se usa con clientes reales sin 6b:** sus comprobantes quedan "por enviar" hasta que exista el envío; en el piloto interno se prueba con datos de demostración.

Se evaluó dejar el comprobante con su serie entero para 6b (alternativa del orquestador). Se descarta: todo cobro emite un comprobante según las fuentes (no hay "nota de venta" ni venta sin comprobante), el reparto de montos entre las partes de una cuenta dividida es el detalle del comprobante, y los correlativos sin saltos dependen de numerar dentro de la misma transacción del cobro. Separarlos obligaría a cobrar sin comprobante en 6a y a migrar esos cobros después.

## Límites con otras secciones

| Tema | Entra aquí | Queda para | Lo que esta sección deja listo |
| --- | --- | --- | --- |
| Pre-cuenta (004) | Muestra descuentos, cortesías, lo ya cobrado y el saldo (criterios 44 y 89) | — | La nota del ICBPER no cambia (pregunta 11) |
| Anular, unir y enviar (004) | Las reglas nuevas cuando la cuenta ya tiene cobros (criterios 86 a 88) | — | El puerto `COBROS` de pedidos |
| Stock (sección 6) | Las cortesías descuentan stock porque ya se enviaron; el mostrador llama al puerto `INVENTARIO` como cualquier envío | Sección 6 | Nada nuevo |
| Pedidos de delivery y telefónicos | No | Sección de delivery | El cobro sirve para cualquier orden abierta; `hayOrdenesAbiertas` debe contar también sus estados pendientes cuando existan |
| Reportes (RF-79 a RF-83) | Solo el X y el Z del turno | Sección de reportes | Comprobantes, cobros, pagos, movimientos, descuentos y cortesías con autor y autorizador |
| Contingencia (papel y talonario) | No | Pregunta 23 | Nada |
| Propinas, ventas al crédito, otras monedas | No (fuera del alcance del MVP) | — | — |

## Clasificación de ruta crítica

Propuesta del especificador para el paso 3. `CLAUDE.md` pone en la ruta crítica el cálculo de montos (IGV, ICBPER, descuentos, redondeos y división de cuenta), el cobro y la caja (varios medios, vuelto, X y Z, bloqueo del cierre), los comprobantes (series y correlativos sin saltos ni duplicados también con dos cajas, reintentos con el PSE y notas de crédito), los permisos (clave de supervisor, trazabilidad y auditoría) y el aislamiento entre empresas.

| Parte | Entrega | Crítica | Motivo |
| --- | --- | --- | --- |
| P1 · Reglas puras de montos: desglose, tasa e ICBPER vigentes, cuenta con descuentos, prorrateo y cortesías, Nuevo RUS, partes por ítems e iguales, cambios permitidos, pagos, vuelto, redondeo del efectivo y esperado del turno (criterios 8 a 22) | 6a | sí | Cálculo de montos. |
| P2 · Cobro: recálculo en el servidor, pagos, comprobante elegido, cierre de la orden y mesa libre, cobro parcial, idempotencia, concurrencia (dos cajeros, mozo que agrega, turno que se cierra), división, mostrador, cambios después de cobrar, trabajo del ticket y pulso de gaveta una sola vez (criterios 47 a 68, 79 a 89, 92 a 94) | 6a | sí | Cobro y caja, división de cuenta y, en el mostrador, enviar comanda con idempotencia. |
| P3 · Turno y caja: apertura con fondo y suspensión, uno por caja y por persona, movimientos, X, Z con esperado, conteo y motivo, bloqueo del último turno también en concurrencia (criterios 24 a 35) | 6a | sí | Cobro y caja: reportes X y Z y bloqueo del cierre. |
| P4 · Comprobantes: series únicas por emisor, numeración sin saltos ni duplicados con dos cajas, reversiones y réplicas, datos guardados, reglas de tipo y cliente, cuota del plan (criterios 4, 5 y 69 a 78) | 6a | sí | Series y correlativos sin saltos ni duplicados. |
| P5 · Permisos y auditoría: descuentos y cortesías con clave atada a lo autorizado, clasificación de rutas, rechazos por rol, alcance del Cajero, auditoría y trazabilidad (criterios 38 a 46 y 98 a 102) | 6a | sí | Clave de supervisor, trazabilidad de autor y auditoría. |
| P6 · Aislamiento: RLS y referencias de las tablas nuevas, HTTP, concurrencia y eventos (criterios 103 a 107) | 6a | sí | Prueba obligatoria de aislamiento entre empresas. |
| Configuración de cajas, series y tasa en lo que no es unicidad (1 a 3, 6, 7), monto en letras (23), consultas de la cuenta (36, 37), contenido del ticket y reportes impresos (90, 91, 95, 96), eventos (97), interfaz (108 a 119) | 6a | no | Mantenimiento simple y pantallas; lo que tienen de crítico lo cubren P1 a P6. |
| P7 · Envío al PSE: fuera de la transacción, reintentos sin duplicar, estados, resultado guardado una vez (criterios 121 a 129) | 6b | sí | Reintentos con el PSE. |
| P8 · Notas de crédito: clave, serie propia sin saltos, montos, devolución como egreso, estado del original, concurrencia (criterios 134 a 143) | 6b | sí | Notas de crédito y permisos. |
| P9 · Aislamiento de 6b: el worker con contexto de empresa, el padrón compartido de solo lectura y los archivos (criterios 148 a 150) | 6b | sí | Aislamiento entre empresas en un proceso nuevo. |
| Consulta del RUC (130 a 133), baja y resumen por el PSE (144), PDF y WhatsApp (145 a 147), interfaz de 6b (151, 152) | 6b | no | Pantallas y una búsqueda en una tabla de referencia; lo crítico del padrón está en P9. |

## Glosario

- **Caja:** un punto de cobro de una sucursal ("Caja 1"), con sus series y, opcional, su impresora (con o sin gaveta). Una sucursal puede tener varias.
- **Turno:** el periodo en que una persona responde por una caja: se abre con un **fondo** en efectivo y se cierra con la **Z**. Estados: `ABIERTO` y `CERRADO`. El **responsable** es quien lo abrió.
- **Movimiento de caja:** un ingreso o un egreso de efectivo del turno, con su motivo.
- **Reporte X:** el estado del turno en cualquier momento, sin cerrarlo. **Reporte Z:** el cierre definitivo, con el conteo físico por medio de pago (arqueo).
- **Esperado, contado y diferencia:** lo que debería haber de cada medio según el sistema, lo que la persona contó y la resta (contado − esperado).
- **Cuenta:** la orden vista para cobrar: sus líneas con descuentos, cortesías, IGV e ICBPER, lo cobrado y el **saldo**.
- **Línea de la cuenta:** un ítem con cantidad vigente (004). Su **bruto** es precio unitario × cantidad cobrable (la vigente menos la cortesía); su **neto**, el bruto menos sus descuentos.
- **Descuento:** por ítem o por cuenta, en porcentaje o en monto, con motivo y clave. **Cortesía:** unidades de un ítem que no se cobran (operación gratuita).
- **Afectación:** `GRAVADO`, `EXONERADO` o `INAFECTO` (003). **Desglose:** base imponible e IGV de un monto con IGV incluido.
- **ICBPER:** impuesto por cada bolsa plástica; se suma al precio, no está incluido en él.
- **Cobro:** un pago de toda la cuenta o de una **parte**, con su comprobante y sus pagos. **Parte por ítems:** unidades elegidas de ciertas líneas. **Parte igual:** el saldo dividido entre las partes que faltan.
- **Pago:** un medio con su monto: `EFECTIVO` (con lo recibido y el vuelto), `TARJETA_CREDITO`, `TARJETA_DEBITO`, `YAPE` o `PLIN` (con número de operación o de voucher).
- **Redondeo:** lo que se deja de cobrar en efectivo para llegar a la décima de sol, a favor del cliente (pregunta 4).
- **Comprobante:** boleta o factura (en 6b también nota de crédito), **detallado** (una línea por ítem) o **por consumo** (una línea por afectación). Tiene **serie** (`B001`) y **correlativo** (1, 2, 3…). Estado en 6a: `POR_ENVIAR`.
- **Venta de mostrador:** orden de tipo `MOSTRADOR` que se cobra antes de enviarse a cocina y lleva un **número de llamado**.
- **Clave atada:** autorización de supervisor que lleva el objetivo aprobado (la cuenta, el ítem y el descuento o la cantidad de cortesía) y solo sirve para eso (pregunta 9).

## Criterios de aceptación

Rigen las convenciones de 004 y 005: empresas **A** y **B** dadas de alta por la vía de plataforma, cada una con dos sucursales (S1 y S2 en A) y usuarios de cada rol; "el Cajero" es una sesión de un usuario de A con rol `CAJERO` en S1 activa (igual los demás roles); horas con el reloj de la API, de Lima; errores `{ codigo, mensaje, campos? }` sin detalles de PostgreSQL (más `ordenId`, `turnoId` o `version` donde se indica); montos como texto con 2 decimales en `NUMERIC`, calculados con `packages/dominio`; ids UUID en minúsculas; entradas estrictas (un campo desconocido es 400 `DATOS_INVALIDOS`) que nunca aceptan `empresaId`, `creadoPor*` ni `actualizadoPor*`. "IK" es `Idempotency-Key` obligatoria. Las rutas de caja y cobro llevan `@RequiereModulo('CAJA')`; las de descuentos y cortesías, `@RequiereModulo('SALON')`; las de comprobantes, `@RequiereModulo('FACTURACION')`; las de configuración, ninguno (como la carta y la impresión).

**Datos de ejemplo.** La carta de ejemplo de 004 más dos productos `SIMPLE` sin estación y `SIN_CONTROL`: "Bolsa plástica" `"0.10"`, `GRAVADO`, `aplicaIcbper: true`, y "Mandarina" `"3.00"`, `EXONERADO`. El emisor E1 de A (régimen `GENERAL`, tasa de IGV `"18.00"` desde 2026-01-01) es el de S1; el emisor E2 de A (régimen `NUEVO_RUS`) es el de S2. En S1: "Caja 1" con series `B001` y `F001` y "Caja 2" con `B002` y `F002`; impresora de caja de la sucursal con gaveta, emulada (3b). ICBPER `"0.50"` por bolsa (pregunta 5). **Cuenta C:** una orden de la mesa 4 de S1 con Lomo saltado [3/4] × 2 (`"28.00"`), Gaseosa 1 L × 1 (`"9.00"`), Bolsa plástica × 2 (`"0.10"`) y Mandarina × 1 (`"3.00"`), todo enviado.

---

## Entrega 6a · Caja, cobro y comprobante

### Configuración: cajas, series y tasa de IGV (RF-61, RF-60; no crítica salvo 4 y 5, que son P4)

1. **Cajas.** `POST /sucursales/:sucursalId/cajas` con `{ nombre, impresoraId? }` (`nombre` de 1 a 40, único entre las cajas de la sucursal sin distinguir mayúsculas, 409 `CONFLICTO`) responde 201 `cajaRespuesta` `{ id, sucursalId, nombre, activa, impresora: { id, nombre, gaveta } | null, series: [{ tipo, serie, ultimoNumero, activa }], turnoAbierto: { id, responsable: { id, nombre }, abiertoEn } | null }`. `GET /sucursales/:sucursalId/cajas` las lista. `PATCH /sucursales/:sucursalId/cajas/:id` con `{ nombre?, impresoraId?, activa? }` (al menos uno). Una sucursal tiene hasta 10 cajas activas (409 `CONFLICTO` en la 11.ª). Desactivar una caja con turno abierto responde 409 `EN_USO`. Las cajas no se borran.
2. **Impresora de la caja.** `impresoraId` es una impresora activa de esa sucursal (si no, 422 `REFERENCIA_INVALIDA`) o `null`. Una caja sin impresora usa la impresora de caja de la sucursal (004, criterio 102) para su ticket, sus reportes y su gaveta; si tampoco hay, el cobro se hace igual sin imprimir (criterio 96).
3. **Series.** `PUT /sucursales/:sucursalId/cajas/:cajaId/series/:tipo` (`tipo`: `BOLETA` o `FACTURA` en 6a) con `{ serie, primerNumero? }` deja esa serie como la activa de ese tipo en la caja y responde 200 `cajaRespuesta`. `serie`: `^B[A-Z0-9]{3}$` para `BOLETA` y `^F[A-Z0-9]{3}$` para `FACTURA` (si no, 400 con `campos`). `primerNumero` (entero de 1 a 99999999, por defecto 1; pregunta 18) fija el primer correlativo de una serie nueva, para seguir una serie que el RUC ya usó en otro sistema. La serie anterior de ese tipo queda inactiva en esa caja y conserva sus números. Una caja sin serie activa de un tipo no emite ese tipo (criterio 70).
4. **Series únicas por emisor** (P4). Una serie pertenece al emisor de la sucursal de la caja en el momento de crearla. La misma serie y tipo no puede existir dos veces para un emisor, en ninguna caja ni sucursal, activa o inactiva (409 `CONFLICTO` con `campos.serie`): así dos sucursales del mismo RUC nunca numeran la misma serie. Otra empresa (otro RUC) sí puede usar `B001`. Dos `PUT` simultáneos con la misma serie en dos cajas del mismo emisor: uno responde 200 y el otro 409.
5. **Una serie usada no cambia** (P4). Reactivar una serie inactiva de la caja con `PUT` y la misma `serie` la vuelve a activar y sigue en su `ultimoNumero` (`primerNumero` se ignora; si viene distinto, 409 `CONFLICTO`). Una serie no se borra ni se edita su número. Si la sucursal cambia de emisor (002), las series del emisor anterior ya no emiten: el cobro responde 409 `SIN_SERIE` hasta configurar series del emisor nuevo.
6. **Tasa de IGV del emisor** (pregunta 6). `GET /emisores/:id/tasas-igv` responde `[{ desde, tasa }]` en orden de `desde`; `PUT /emisores/:id/tasas-igv/:desde` con `{ tasa }` (`desde`: fecha `AAAA-MM-DD`; `tasa`: de `"0.01"` a `"30.00"`, 2 decimales) la crea o la cambia. No se puede cambiar ni crear una tasa con `desde` igual o anterior a la fecha de Lima de un comprobante ya emitido por ese emisor (409 `CONFLICTO`): las ventas pasadas no se recalculan. Un emisor `NUEVO_RUS` no usa tasa (criterio 16).
7. **Quién y auditoría.** Las rutas de los criterios 1 a 6 llevan `@Permiso('ADMINISTRAR')`: los demás roles reciben 403 `PROHIBIDO` sin cambios ni auditoría. Una sucursal, caja, impresora o emisor de B o inexistente en la ruta responde 404 con el mismo cuerpo. `crear_caja`, `modificar_caja`, `configurar_serie` y `configurar_tasa_igv` dejan una fila de auditoría con el antes y el después; repetir sin cambios responde 200 sin fila.

### Reglas puras de montos (`packages/dominio/src/caja/`, ruta crítica P1)

Pruebas unitarias con cada ejemplo. Los montos de entrada siguen `^\d{1,8}(\.\d{1,2})?$` (los totales, hasta 12 enteros, como `totalOrden`) y se calculan con una copia propia de `Decimal` (`precision: 40`); salen con 2 decimales. "Redondear" es `ROUND_HALF_UP` a 2 decimales salvo donde se dice otra cosa. Una entrada mal formada lanza `RangeError`; una regla de negocio incumplida se devuelve como resultado con su código, no como excepción.

8. **Entradas.** Toda función rechaza con `RangeError`: montos que no son texto o no cumplen el formato, cantidades que no son enteros en su rango, tasas fuera de `"0.01"` a `"30.00"` y fechas que no son `AAAA-MM-DD`.
9. **`desglosar(neto, afectacion, tasaIgv)`.** `GRAVADO`: `base` = redondear(`neto` / (1 + `tasaIgv` / 100)) e `igv` = `neto` − `base`, así `base` + `igv` = `neto` siempre. `EXONERADO` e `INAFECTO`: `base` = `neto`, `igv` = `"0.00"`. `tasaIgv` `null` (Nuevo RUS): `base` = `neto`, `igv` = `"0.00"` en toda afectación. Ejemplos con `"18.00"`: `"56.00"` → `{ base: "47.46", igv: "8.54" }`; `"9.00"` → `{ "7.63", "1.37" }`; `"0.20"` → `{ "0.17", "0.03" }`; `"0.01"` → `{ "0.01", "0.00" }`; `"0.00"` → `{ "0.00", "0.00" }`; `"3.00"` `EXONERADO` → `{ "3.00", "0.00" }`.
10. **Valores vigentes.** `tasaIgvVigente(tasas, fecha)` devuelve la tasa con el mayor `desde` ≤ `fecha`, o `null` si no hay ninguna (el cobro responde 409 `TASA_IGV_NO_CONFIGURADA`, criterio 51). `montoIcbperVigente(fecha)` devuelve el monto por bolsa de la tabla `MONTOS_ICBPER` de `packages/dominio` (pregunta 5: `"0.50"` desde 2023-01-01); antes de la primera fecha, `RangeError`.
11. **`calcularCuenta({ lineas, descuentoCuenta, tasaIgv, montoIcbper })`** con `lineas: [{ itemId, precioUnitario, cantidad, cantidadCortesia, afectacion, aplicaIcbper, descuento }]` (`cantidad`: la vigente, de 1 a 999; `cantidadCortesia`: de 0 a `cantidad`; `descuento`: `null` o `{ tipo: 'PORCENTAJE' | 'MONTO', valor }`) devuelve por línea `{ itemId, cantidadCobrable, bruto, descuentoItem, descuentoCuenta, neto, base, igv, bolsas, icbper, gratuita }` y los totales `{ subtotal, descuentos, operaciones: { gravadas, exoneradas, inafectas, gratuitas } | null, igv, igvGratuitas, icbper, total }`. Reglas: `cantidadCobrable` = `cantidad` − `cantidadCortesia`; `bruto` = `precioUnitario` × `cantidadCobrable`; `neto` = `bruto` − `descuentoItem` − `descuentoCuenta`; `base` e `igv` = `desglosar(neto, …)`; `bolsas` = `cantidadCobrable` si `aplicaIcbper` (si no, 0) e `icbper` = `bolsas` × `montoIcbper`; `subtotal` = suma de `bruto`; `descuentos` = suma de los dos descuentos; `gravadas`, `exoneradas` e `inafectas` = suma de `base` por afectación; `igv` = suma de `igv`; `total` = suma de `neto` + suma de `icbper`. Con la cuenta C: líneas Lomo `{ bruto "56.00", neto "56.00", base "47.46", igv "8.54" }`, Gaseosa `{ "9.00", "9.00", "7.63", "1.37" }`, Bolsa `{ "0.20", "0.20", "0.17", "0.03", bolsas 2, icbper "1.00" }`, Mandarina `{ "3.00", "3.00", "3.00", "0.00" }`; totales `{ subtotal "68.20", descuentos "0.00", gravadas "55.26", exoneradas "3.00", inafectas "0.00", gratuitas "0.00", igv "9.94", icbper "1.00", total "69.20" }`.
12. **Descuento por ítem.** `PORCENTAJE`: `descuentoItem` = redondear(`bruto` × `valor` / 100); `MONTO`: `valor`. Se aplica antes que el de la cuenta. Cuenta C con 10 % en el Lomo: Lomo `{ descuentoItem "5.60", neto "50.40", base "42.71", igv "7.69" }`; totales `{ descuentos "5.60", gravadas "50.51", igv "9.09", total "63.60" }`.
13. **Descuento por cuenta y prorrateo.** El monto del descuento por cuenta (`PORCENTAJE`: redondear(Σ(`bruto` − `descuentoItem`) × `valor` / 100); `MONTO`: `valor`) se reparte entre las líneas con `bruto` > 0 en proporción a su `bruto` − `descuentoItem` (el ICBPER no entra): a cada línea le toca el valor truncado al céntimo y los céntimos que faltan van, de a uno, a las líneas con mayor resto, y entre restos iguales a la que va primero (método del mayor resto). La suma de `descuentoCuenta` es exactamente el monto. Cuenta C con S/ 5.00: Lomo `"4.11"`, Gaseosa `"0.66"`, Bolsa `"0.01"`, Mandarina `"0.22"`; netos `"51.89"`, `"8.34"`, `"0.19"`, `"2.78"`; Lomo `{ base "43.97", igv "7.92" }`, Gaseosa `{ "7.07", "1.27" }`, Bolsa `{ "0.16", "0.03" }`; totales `{ descuentos "5.00", gravadas "51.20", exoneradas "2.78", igv "9.22", icbper "1.00", total "64.20" }`. Con 10 % de la cuenta C: monto `"6.82"`.
14. **`validarDescuento(base, descuento)`** (pregunta 10) devuelve `{ valido: true, monto }` o `{ valido: false, codigo }`: `PORCENTAJE` de `"0.01"` a `"99.99"` y `MONTO` de `"0.01"` a menos que `base` (si no, `DESCUENTO_EXCESIVO`); un porcentaje cuyo monto redondea a `"0.00"` es `DESCUENTO_NULO`. Para no cobrar nada se usa la cortesía. `base` es el `bruto` de la línea (ítem) o Σ(`bruto` − `descuentoItem`) (cuenta). Ejemplos: 100 % → `DESCUENTO_EXCESIVO`; `"56.00"` sobre `"56.00"` → `DESCUENTO_EXCESIVO`; 0.01 % de `"9.00"` → `DESCUENTO_NULO`.
15. **Cortesías** (pregunta 8). Las unidades en cortesía no se cobran: `gratuita` = `null` o `{ cantidad, valorReferencial, base, igv }` con `valorReferencial` = `precioUnitario` × `cantidadCortesia` y `base` e `igv` = `desglosar(valorReferencial, …)`; `operaciones.gratuitas` = suma de esas `base` e `igvGratuitas` = suma de esos `igv`. No entran en `subtotal`, descuentos, `igv`, ICBPER ni `total`. Un producto con `aplicaIcbper` no admite cortesía (`RangeError` aquí; 422 en la API, criterio 43). Cuenta C con 1 Gaseosa en cortesía: Gaseosa `{ cantidadCobrable 0, bruto "0.00", gratuita { cantidad 1, valorReferencial "9.00", base "7.63", igv "1.37" } }`; totales `{ gravadas "47.63", gratuitas "7.63", igv "8.57", igvGratuitas "1.37", total "60.20" }`. Una línea toda en cortesía no recibe parte del descuento por cuenta.
16. **Nuevo RUS** (pregunta 7). Con `tasaIgv` `null`, toda línea tiene `igv` `"0.00"` y `base` = `neto`, `operaciones` es `null` e `igv` `"0.00"`; el ICBPER se suma igual. Cuenta C en S2: `total` `"69.20"`, `igv` `"0.00"`.
17. **`calcularParte(cuenta, partesAnteriores, parte, formato)`, por ítems.** `parte` = `{ tipo: 'ITEMS', items: [{ itemId, cantidad }] }` (o `{ tipo: 'TOTAL' }`, que es todo lo que falta). Lo que falta de una línea es su `cantidadCobrable` y su `neto` menos lo que ya tomaron las partes anteriores. Por cada ítem elegido con `q` unidades de las `n` que faltan: `neto` de la parte = el `neto` que falta si `q = n`, o redondear(`neto que falta` × `q` / `n`) si no; `bruto` = `precioUnitario` × `q`; descuento = `bruto` − `neto`; `bolsas` = `q` si tiene ICBPER. Las unidades en cortesía de toda la cuenta van en la primera parte que se cobra (criterio 67). Ejemplo: cuenta C con el descuento de S/ 5.00 (criterio 13), cobrar 1 de los 2 Lomos: `neto` `"25.95"` (51.89 / 2 = 25.945); la parte siguiente que toma el otro Lomo cobra `"25.94"`. Sin descuento: 1 Lomo = `"28.00"`. Devuelve el detalle de la parte (líneas del comprobante con `bruto`, `descuento`, `neto`, `base`, `igv`, `bolsas`, `icbper`, `gratuita`), sus totales con la misma forma del criterio 11, y `cierraLaCuenta` (no falta nada después de ella). Con `formato: 'CONSUMO'`, las líneas sin ICBPER se agrupan en una por afectación ("Por consumo", con la suma de sus `neto` y su desglose) y las de ICBPER siguen detalladas; las gratuitas, detalladas.
18. **`calcularParte`, en partes iguales.** `parte` = `{ tipo: 'IGUALES', partesRestantes: r }` (r de 1 a 50). `monto` = saldo si `r = 1`; si no, el saldo / `r` redondeado **hacia arriba** al céntimo. Las bolsas que faltan (`b`) se reparten enteras: la parte lleva ⌈`b` / `r`⌉, con su `neto` como en el criterio 17 y su ICBPER. El resto del monto ("consumo") se reparte entre las afectaciones en proporción a lo que falta de cada una, sin las líneas de ICBPER, con el método del mayor resto del criterio 13; la última parte toma exactamente lo que falta de cada afectación. Formato siempre `CONSUMO` (B.9). Ejemplos: saldo `"100.00"` todo gravado en 3 partes → `"33.34"`, `"33.33"`, `"33.33"` (`base` `"28.25"` en cada una; `igv` `"5.09"`, `"5.08"`, `"5.08"`). Cuenta C en 2 partes → cada una `"34.60"`: consumo gravado `"32.50"` (`base` `"27.54"`, `igv` `"4.96"`), consumo exonerado `"1.50"`, Bolsa × 1 `{ neto "0.10", base "0.08", igv "0.02", icbper "0.50" }`. La suma del IGV de las partes (`"9.96"`) puede diferir por céntimos de la cuenta sin dividir (`"9.94"`); el total cobrado siempre cuadra.
19. **Reglas de las partes.** `calcularParte` devuelve `{ valida: false, codigo }` (`PARTE_INVALIDA`) si: un ítem no existe en la cuenta, se repite o pide más unidades de las que faltan; hay un `IGUALES` en las partes anteriores y la nueva no lo es (primero por ítems, después iguales, nunca al revés; pregunta 12); `formato: 'DETALLADO'` en `IGUALES`; la selección queda vacía y no hay cortesías pendientes; el saldo es `"0.00"` y no quedan unidades ni cortesías (`NADA_QUE_COBRAR`); o el consumo de una parte igual sale negativo (las bolsas pesan más que la parte).
20. **`cambioDeCuentaPermitido(cuentaNueva, partesAnteriores)`** (criterios 86 a 88) devuelve `{ permitido: true }` o `{ permitido: false, codigo: 'CUENTA_COBRADA_EN_PARTE' }`. Es permitido si, con la cuenta nueva, para cada línea lo que falta en unidades y en dinero es ≥ 0 y uno es 0 solo si el otro también; lo que falta de cada afectación y de bolsas es ≥ 0; y lo ya cobrado no supera el total nuevo. Ejemplos: cuenta C sin descuento, cobrado 1 Lomo por ítems; enviar 1 Gaseosa más → permitido; anular el Lomo que falta → permitido; anular los 2 Lomos → no. Con el descuento por cuenta de S/ 5.00 y un Lomo cobrado, enviar cualquier ítem → no (el prorrateo de lo ya cobrado cambiaría).
21. **Pagos.** `validarPagos(total, pagos, redondeo)` con `pagos: [{ medio, monto, recibido? }]` devuelve `{ valido: true, vuelto }` o `{ valido: false, codigo }` (`PAGOS_NO_CUADRAN`): cada `monto` > 0; a lo más un `EFECTIVO`; `recibido` solo en `EFECTIVO` y ≥ su `monto` (si falta, vale el `monto`); Σ `monto` + `redondeo` = `total` exacto; `vuelto` = `recibido` − `monto` del efectivo (o `"0.00"`): solo el efectivo da vuelto (RF-51). `redondeoEfectivo(total, pagosNoEfectivo)` (pregunta 4): si hay efectivo, `efectivo` = `total` − Σ pagos no en efectivo y `redondeo` = `efectivo` − (`efectivo` truncado a la décima); si no, `"0.00"`. Ejemplos: total `"33.34"` todo en efectivo → redondeo `"0.04"`, efectivo `"33.30"`, recibido `"50.00"` → vuelto `"16.70"`; total `"34.60"` con Yape `"20.00"` → efectivo `"14.60"`, redondeo `"0.00"`; total `"69.20"` todo con tarjeta → `"0.00"`; Σ que no cuadra por un céntimo → `PAGOS_NO_CUADRAN`; vuelto con tarjeta (monto mayor) → `PAGOS_NO_CUADRAN`.
22. **`esperadoDelTurno({ fondo, pagos, movimientos })`** devuelve el esperado por medio (los cinco, en el orden de `MEDIOS_PAGO`): `EFECTIVO` = `fondo` + Σ `monto` de los pagos en efectivo (lo que quedó en la gaveta, sin el vuelto) + Σ ingresos − Σ egresos; cada otro medio = Σ de sus pagos. `diferenciasDelArqueo(esperado, contado)` devuelve por medio `contado − esperado`. Ejemplo: fondo `"200.00"`, pagos en efectivo `"33.30"` y `"50.00"`, Yape `"34.60"`, ingreso `"20.00"`, egreso `"15.50"` → `EFECTIVO "287.80"`, `YAPE "34.60"`, los demás `"0.00"`; contado efectivo `"287.00"` → diferencia `"-0.80"`.
23. **`montoEnLetras(monto)`** (no crítico): `"69.20"` → `"SESENTA Y NUEVE CON 20/100 SOLES"`; `"1.00"` → `"UNO CON 00/100 SOLES"`; `"0.50"` → `"CERO CON 50/100 SOLES"`; `"1000000.00"` → `"UN MILLÓN CON 00/100 SOLES"`. Pruebas del desarrollador.

### Turno de caja (HU-25, HU-30, RF-50, RF-53 a RF-55; ruta crítica P3)

24. **Abrir.** `POST /turnos` con IK y `{ id, cajaId, fondo }` (`OPERAR_CAJA`; `id` lo genera la PWA; `fondo` de `"0.00"` a `"99999999.99"`) responde 201 `turnoRespuesta` `{ id, caja: { id, nombre }, responsable: { id, nombre }, estado, abiertoEn, diaOperativo, fondo, cerradoEn, cerradoPor }`. La caja debe ser activa y de la sucursal activa (si no, 404; inactiva, 409 `CONFLICTO`). El responsable es quien abre (una sesión de soporte responde 422 `REFERENCIA_INVALIDA`: un turno es de una persona). Repetir el mismo `id` devuelve el turno sin crear otro; el mismo `id` con otra caja u otro fondo, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
25. **Suspensión** (RF-06, HU-04). Abrir llama a `SuscripcionService.exigirAperturaDeCaja(sucursalId)` antes de crear nada: con la sucursal `SUSPENDIDA`, 403 `SUCURSAL_SUSPENDIDA` sin cambios; `EN_GRACIA` abre igual. Un turno ya abierto sigue cobrando y se cierra aunque la sucursal pase a `SUSPENDIDA` (ninguna otra ruta de esta sección consulta la suscripción).
26. **Uno por caja y uno por persona** (pregunta 2). Abrir en una caja con un turno `ABIERTO` responde 409 `TURNO_YA_ABIERTO` con `turnoId`; abrir cuando la persona ya tiene un turno `ABIERTO` en otra caja de la sucursal, también (con el suyo). Dos aperturas simultáneas en la misma caja (ids distintos): una 201 y otra 409; nunca dos turnos abiertos en una caja ni dos de una persona en una sucursal (índices únicos en la base). Las demás cajas de la sucursal pueden tener su propio turno abierto a la vez.
27. **Consultar.** `GET /turnos/mio` (`OPERAR_CAJA`) responde el turno `ABIERTO` de la persona en la sucursal activa o 404. `GET /cajas` (`OPERAR_CAJA`) responde las cajas activas de la sucursal activa con `turnoAbierto` (responsable y desde, sin montos). `GET /turnos/:id` responde el turno con el alcance del criterio 100.
28. **Ingresos y egresos** (RF-53). `POST /turnos/:id/movimientos` con IK y `{ id, tipo: 'INGRESO' | 'EGRESO', monto, motivo }` (`monto` de `"0.01"` a `"99999999.99"`; `motivo`: `motivoSchema`, de 1 a 300; siempre en efectivo, decisión del especificador) responde 201 `{ id, tipo, monto, motivo, creadoEn, creadoPor }`. Solo en un turno `ABIERTO` (si no, 409 `TURNO_CERRADO`) y por su responsable o un Supervisor o Administrador de la sucursal (si no, 409 `TURNO_AJENO`). Sin clave (pregunta 17). Un egreso puede dejar el esperado en efectivo negativo: el Z lo mostrará como diferencia. Repetir el mismo `id` devuelve el movimiento sin otro.
29. **Reporte X** (RF-54, HU-30). `GET /turnos/:id/reporte` responde 200 `reporteCaja` `{ turno, generadoEn, fondo, ventas: { total, cantidad, porTipo: [{ tipo, cantidad, total }], porMedio: [{ medio, cantidad, monto }], descuentos, cortesias, igv, icbper, redondeos, vueltos }, movimientos: { ingresos, egresos, lista }, esperado: [{ medio, monto }] }` con los cobros y movimientos confirmados del turno; `esperado` sale de `esperadoDelTurno` (criterio 22). En cualquier momento del turno abierto, sin cerrarlo y sin cambiar nada. En un turno cerrado, el mismo reporte con lo que tenía al cerrar, más `cierre` (criterio 31).
30. **Imprimir el X.** `POST /turnos/:id/reporte-x/impresiones` con IK responde 201 `{ trabajoId | null, impresion }` y encola un trabajo `REPORTE_X` en la impresora de la caja (criterio 95).
31. **Cierre con Z** (RF-55, HU-30). `POST /turnos/:id/cierre` con IK y `{ conteo: [{ medio, contado, motivo? }] }` (`conteo`: los cinco medios, una vez cada uno; `contado` de `"0.00"` a `"99999999.99"`) cierra el turno: guarda por medio `esperado`, `contado`, `diferencia` y `motivo`, y responde 200 `reporteCaja` con `cierre: { cerradoEn, cerradoPor, conteo: [{ medio, esperado, contado, diferencia, motivo }] }`. Toda diferencia distinta de `"0.00"` exige `motivo` (1 a 300): si falta, 422 `DIFERENCIA_SIN_MOTIVO` con `campos` en `conteo.<i>.motivo` y la respuesta trae las diferencias de cada medio (criterio 32) sin cerrar. Un `motivo` con diferencia `"0.00"` se ignora. El esperado se calcula dentro de la transacción del cierre, con el turno bloqueado.
32. **Arqueo a ciegas** (pregunta 3). Mientras el turno está abierto, la pantalla de cierre no muestra el esperado: la persona escribe lo que contó; el primer `POST …/cierre` con alguna diferencia y sin motivo responde 422 con las diferencias (no el esperado), y la PWA pide el motivo de cada una. `GET /turnos/:id/reporte` sí trae el esperado (el X); quien quiera mirar antes de contar puede, y queda en la trazabilidad que pidió el X.
33. **Bloqueo del último turno** (RF-55, HU-30, B.9). Si el turno es el único `ABIERTO` de la sucursal y `PedidosConsultaService.hayOrdenesAbiertas(sucursalId)` es `true`, el cierre responde 409 `CIERRE_BLOQUEADO` con `ordenes` (cuántas) y nada cambia; si hay otro turno abierto en la sucursal, se cierra igual. Dos cierres simultáneos de los dos últimos turnos abiertos con una mesa abierta: exactamente uno se cierra y el otro responde 409 `CIERRE_BLOQUEADO` (los cierres de una sucursal se turnan bloqueando sus turnos abiertos en orden de id). Una orden abierta después de confirmado el último cierre no lo deshace (caso límite).
34. **La Z es definitiva.** Después del cierre, el turno no acepta cobros, movimientos ni otro cierre (409 `TURNO_CERRADO`), salvo la réplica con la misma clave, que devuelve lo guardado. El cierre encola un trabajo `REPORTE_Z` (criterio 95) y publica `turno.cambio`.
35. **Quién cierra** (pregunta 2). Cierra su responsable, o un Supervisor o el Administrador de la sucursal (por ejemplo, si el cajero se fue); otro Cajero recibe 409 `TURNO_AJENO`. `cerradoPor` es quien cerró.

### La cuenta (no crítica)

36. **Ver la cuenta.** `GET /cuentas/:ordenId` (`ATENDER_MESA` + `CAJA`) responde 200 `cuentaRespuesta` `{ ordenId, tipo, estado, mesas, mozo, numeroLlamado, version, lineas: [{ itemId, nombre, modificadores, precioUnitario, cantidad, cantidadCortesia, cantidadFacturada, afectacion, aplicaIcbper, bruto, descuento: descuentoRespuesta | null, descuentoCuenta, neto, icbper }], descuentoCuenta: descuentoRespuesta | null, cortesias: [cortesiaRespuesta], totales, cobrado, saldo, modo: null | 'ITEMS' | 'IGUALES', cobros: [{ id, comprobante: { id, tipo, numero }, total, cobradoEn, cobradoPor }], parametros: { tasaIgv, montoIcbper, regimen, tiposPermitidos } }`, con los montos de `calcularCuenta` (criterio 11). `version` cambia con todo lo que cambia la cuenta (envíos, anulaciones, uniones, descuentos, cortesías y cobros). Una orden de otra sucursal o de B, 404. La PWA calcula las partes con las mismas funciones de `packages/dominio`.
37. **Por cobrar.** `GET /cuentas` (`COBRAR` + `CAJA`) responde las órdenes abiertas de la sucursal activa con `{ ordenId, tipo, mesas, mozo, abiertaEn, estado, total, saldo, modo }`, de la más antigua a la más nueva, con `ETag` y 304.

### Descuentos y cortesías (RF-33, HU-03; ruta crítica P5, montos en P1)

38. **Descuento por ítem.** `POST /cuentas/:ordenId/descuentos` con IK, `@Permiso('APLICAR_DESCUENTO')` y `{ id, itemId, tipo, valor, motivo }` responde 201 `descuentoRespuesta` `{ id, itemId, tipo, valor, monto, motivo, autorizadoPor | null, creadoEn, creadoPor }` y la cuenta queda con ese descuento en ese ítem. Un ítem tiene a lo más un descuento vigente: con otro, 409 `CONFLICTO` (se quita y se aplica otro, criterio 42). Un ítem anulado o con toda su cantidad en cortesía responde 409 `CONFLICTO` con el motivo en el mensaje.
39. **Descuento por cuenta.** El mismo `POST` con `itemId: null` aplica el descuento a la cuenta (criterio 13); a lo más uno vigente por cuenta (409 `CONFLICTO`).
40. **Clave atada** (B.7, pregunta 9). El Mozo y el Cajero necesitan `X-Autorizacion` de una autorización de `APLICAR_DESCUENTO` cuyo `objetivo` sea exactamente `{ tipo: 'DESCUENTO', ordenId, itemId, descuento: { tipo, valor } }` del cuerpo (ids en minúsculas, `valor` normalizado a 2 decimales); sin ella, 403 `CLAVE_REQUERIDA`; con una de otra acción, de otro objetivo o sin objetivo, 403 `AUTORIZACION_INVALIDA` y nada cambia. El Supervisor y el Administrador aplican sin clave; Cocina/Barra, 403 `PROHIBIDO`. El motivo es obligatorio para todos (`motivoSchema`). La autorización se consume en la misma transacción (y se revierte si la acción falla después, como 004, criterio 36). `POST /autorizaciones` (002) acepta el `objetivo` opcional y lo devuelve; la ventana de clave muestra al supervisor "Descuento 10 % · Lomo saltado × 2 · Mesa 4".
41. **Validación.** El descuento se valida con `validarDescuento` (criterio 14) sobre la cuenta en ese momento: 422 `DESCUENTO_INVALIDO` con `campos.valor` y el código en el mensaje. Un ítem de otra orden o inexistente, 404.
42. **Quitar.** `DELETE /cuentas/:ordenId/descuentos/:id` (`ATENDER_MESA` + `SALON`, sin clave: sube el monto; decisión del especificador) responde 204, deja el descuento con `quitadoEn` y `quitadoPor` y cambia la `version`. Repetirlo, 204 sin efecto.
43. **Cortesía.** `POST /cuentas/:ordenId/cortesias` con IK, `@Permiso('APLICAR_CORTESIA')` y `{ id, itemId, cantidad, motivo }` (`cantidad` de 1 a la cantidad vigente del ítem) responde 201 `cortesiaRespuesta` `{ id, itemId, cantidad, valorReferencial, motivo, autorizadoPor | null, creadoEn, creadoPor }`. Clave como el criterio 40 con `objetivo: { tipo: 'CORTESIA', ordenId, itemId, cantidad }`. Un ítem tiene a lo más una cortesía vigente (409 `CONFLICTO`); un ítem con `aplicaIcbper`, 422 `CORTESIA_INVALIDA`; un ítem con descuento, 409 `CONFLICTO` (se quita primero). Las cortesías descuentan stock porque el ítem ya se envió (B.7; nada nuevo que llamar). `DELETE /cuentas/:ordenId/cortesias/:id` la quita como el criterio 42.
44. **Efectos en la cuenta.** Aplicar o quitar un descuento o una cortesía cambia `orden.version`; si la orden estaba `EN_PRECUENTA`, vuelve a `ABIERTA`, la pre-cuenta queda invalidada y la mesa vuelve a ocupada, como una anulación (004, criterio 40; decisión del especificador). La pre-cuenta siguiente muestra cada descuento y cortesía con su monto y el total con los descuentos aplicados, sin ICBPER y con la misma nota de 004 (pregunta 11). Publica `orden.cambio` y, si cambió la mesa, `salon.cambio`.
45. **Solo antes de cobrar** (pregunta 10). En una cuenta con algún cobro, aplicar o quitar descuentos o cortesías responde 409 `CUENTA_EN_COBRO`; en una orden que no está abierta, 409 `ORDEN_NO_ABIERTA` (con `ordenId` de la principal si está `UNIDA`, como 004).
46. **Auditoría.** `aplicar_descuento`, `quitar_descuento`, `aplicar_cortesia` y `quitar_cortesia` dejan exactamente una fila cada uno, con el motivo, el autorizador y la autorización si hubo clave, y en `detalle` `{ ordenId, itemId, nombre, tipo, valor, monto }` (o `{ ordenId, itemId, nombre, cantidad, valorReferencial }`); con clave queda además la fila de consumo de 002 (`APLICAR_DESCUENTO` o `APLICAR_CORTESIA`). La réplica no deja filas. El reporte de control (sección de reportes) sale de estas filas.

### Cobro (HU-26, RF-51, RF-57, RF-59, RF-65; ruta crítica P2)

47. **Cobrar.** `POST /cuentas/:ordenId/cobros` con IK, `@Permiso('COBRAR')` y `cobroEntrada` `{ id, turnoId, version, total, parte, comprobante: { tipo, formato, cliente? }, pagos: [{ medio, monto, recibido?, operacion? }], redondeo }` responde 201 `cobroRespuesta` `{ id, ordenId, turnoId, parte, total, redondeo, vuelto, pagos, comprobante: comprobanteRespuesta, cuenta: { estado, saldo, version }, impresion: 'EN_COLA' | 'SIN_IMPRESORA', trabajoId }`. `parte`: `{ tipo: 'TOTAL' }`, `{ tipo: 'ITEMS', items }` (de 1 a 200 ítems, `cantidad` de 1 a 999) o `{ tipo: 'IGUALES', partesRestantes }`. `pagos`: de 0 a 10. Mozo y Cocina/Barra, 403 `PROHIBIDO`.
48. **Turno abierto y propio** (HU-25, pregunta 2). `turnoId` debe ser un turno `ABIERTO` de la sucursal activa (de otra sucursal, de B o inexistente, 404; cerrado, 409 `TURNO_CERRADO`) cuyo responsable sea quien cobra, o quien cobra es Supervisor o Administrador de la sucursal (si no, 409 `TURNO_AJENO`). Sin turno abierto no se cobra: la PWA lleva a "Abrir caja".
49. **El servidor recalcula todo** (RF-60). Dentro de la transacción, con la orden bloqueada, la API lee la cuenta de la base y calcula la parte con `calcularParte` (criterios 17 a 19) y la tasa e ICBPER vigentes en la fecha de emisión; nunca usa montos del cliente. Si `version` no es la de la cuenta, 409 `CUENTA_CAMBIO` con `version` actual; si `total` no es el total calculado de la parte, también (la cuenta o los precios cambiaron). Una parte inválida, 422 `PARTE_INVALIDA` (o 409 `NADA_QUE_COBRAR`) con el código del dominio.
50. **Pagos** (RF-51, HU-26). `medio`: `EFECTIVO`, `TARJETA_CREDITO`, `TARJETA_DEBITO`, `YAPE` o `PLIN`; `monto` > 0; `recibido` solo en `EFECTIVO`; `operacion` (número de operación o de voucher, `^[A-Za-z0-9-]{1,30}$`) obligatoria en los demás medios (400 con `campos`) y prohibida en el efectivo. Se validan con `validarPagos` y `redondeo` debe ser exactamente `redondeoEfectivo(total, pagos no en efectivo)` (criterio 21); si no, 422 `PAGOS_NO_CUADRAN`. Una parte de total `"0.00"` (solo cortesías) se cobra con `pagos: []`. La respuesta trae el `vuelto`.
51. **El comprobante** (RF-57, RF-59, RF-65, HU-26). `comprobante.tipo`: `BOLETA` o `FACTURA`; `formato`: `DETALLADO` o `CONSUMO` (en `IGUALES`, solo `CONSUMO`: si no, 422 `COMPROBANTE_NO_PERMITIDO`). `cliente`: `{ tipoDocumento: 'DNI' | 'CE' | 'PASAPORTE' | 'RUC', numero, nombre, direccion? }` (pregunta 15): DNI de 8 dígitos, CE y pasaporte de 6 a 12 caracteres alfanuméricos, RUC válido con `validarRuc`; `nombre` de 1 a 200; `direccion` de 1 a 300. Reglas: una factura exige `cliente` con `RUC` y `direccion` (422 `CLIENTE_REQUERIDO`); una boleta acepta cliente sin `RUC` o ninguno, salvo que su total pase de `"700.00"`, que exige documento y nombre (422 `CLIENTE_REQUERIDO`, RF-59); un emisor `NUEVO_RUS` solo emite boletas (422 `COMPROBANTE_NO_PERMITIDO`, RF-65); un emisor `GENERAL`, `RER` o `MYPE_TRIBUTARIO` sin tasa vigente, 409 `TASA_IGV_NO_CONFIGURADA`; una caja sin serie activa del tipo (o con una de otro emisor), 409 `SIN_SERIE`. En 6a el RUC y la razón social se escriben a mano; 6b los autocompleta (criterio 130).
52. **Cobrar todo libera la mesa** (HU-26). Si después del cobro no falta nada (`cierraLaCuenta`), la orden queda `CERRADA` con `cerradaEn`, sus relaciones de `orden_mesa` se cierran y sus mesas quedan `LIBRE` (verde); la respuesta trae `cuenta.estado: 'CERRADA'` y `saldo` `"0.00"`.
53. **Cobro parcial** (HU-28). Si falta algo, la orden sigue en su estado (`ABIERTA` o `EN_PRECUENTA`, sin invalidar la pre-cuenta), su `version` cambia, la cuenta guarda lo cobrado y el modo (`ITEMS` o `IGUALES`) y la mesa sigue ocupada.
54. **Réplica con la misma clave** (RNF-10). La misma IK con el mismo cuerpo devuelve la misma respuesta sin cobrar, numerar, imprimir ni abrir la gaveta otra vez; con otro cuerpo, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
55. **El mismo cobro con otra clave.** Repetir el mismo `id` de cobro con otra IK o desde otra sesión de la empresa devuelve 201 con el cobro ya hecho (su respuesta original, aunque la orden ya esté cerrada o el turno cerrado), sin efectos. El mismo `id` con otra orden, otra parte, otro comprobante o otros pagos (huella de la entrada normalizada, sin `version` ni `total`), 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Se reconoce antes de validar el turno y la cuenta.
56. **Réplicas simultáneas.** Diez peticiones concurrentes con el mismo `id` de cobro dejan exactamente un cobro, un comprobante con un solo número, un trabajo de impresión y un pulso de gaveta; todas responden 201 con el mismo cuerpo, o alguna 409 `CONFLICTO` que, repetida, responde 201.
57. **Dos cajeros a la vez.** Dos cobros con ids distintos de la misma cuenta y la misma `version` al mismo tiempo (dos cajas): exactamente uno responde 201; el otro, 409 `CUENTA_CAMBIO` (o `ORDEN_NO_ABIERTA` si el primero la cerró). Nunca se cobra dos veces lo mismo ni quedan dos comprobantes por la misma parte.
58. **El mozo agrega mientras se cobra.** Un envío (004) y un cobro `TOTAL` de la misma orden al mismo tiempo: o el envío va primero y el cobro responde 409 `CUENTA_CAMBIO` (la PWA muestra la cuenta nueva), o el cobro va primero, la orden queda `CERRADA` y el envío responde 409 `ORDEN_NO_ABIERTA`. Nunca queda un ítem enviado sin cobrar en una orden cerrada. Lo mismo con una anulación.
59. **El turno se cierra en otra pestaña.** Un cobro con un turno ya cerrado responde 409 `TURNO_CERRADO` sin cambios. Un cobro y el cierre del mismo turno al mismo tiempo: o el cobro termina antes y entra en la Z, o responde 409 `TURNO_CERRADO`; nunca queda un cobro de un turno cerrado fuera de su Z (los cobros toman el turno con `FOR SHARE` y el cierre con `FOR UPDATE`).
60. **Ítems sin enviar.** El cobro solo cobra ítems enviados: el borrador de un equipo (004, criterio 91) no existe para la API. Si la persona que cobra tiene en su equipo un borrador de esa orden, la PWA avisa "Hay ítems sin enviar en este equipo" antes de cobrar.
61. **Orden que no se puede cobrar.** Una orden `ANULADA` o `CERRADA` responde 409 `ORDEN_NO_ABIERTA`; una `UNIDA`, lo mismo con `ordenId` de la principal; de otra sucursal o de B, 404. Una orden sin ítems vigentes ni cortesías, 409 `NADA_QUE_COBRAR`.
62. **Topes.** Un total, un pago o un `recibido` que pase de `"99999999.99"` responde 422 `MONTO_FUERA_DE_RANGO`.
63. **Eventos.** Después de confirmar, un cobro publica `orden.cambio`, `turno.cambio` `{ turnoId }` y, si liberó la mesa, `salon.cambio` (las mesas en verde en todos los equipos de la sucursal en menos de 1 segundo en la prueba). Una réplica, una reversión o un rechazo no publican nada.

### División de la cuenta (HU-28, RF-52; ruta crítica P2)

64. **Por ítems.** Con `parte: { tipo: 'ITEMS', items }` se cobran esas unidades (criterio 17), con un comprobante detallado o por consumo. Ejemplo: cuenta C; parte 1 = 1 Lomo + 1 Gaseosa (`"37.00"`); parte 2 = `TOTAL` (`"32.20"`: 1 Lomo, 2 Bolsas con su ICBPER y la Mandarina); la orden se cierra con la parte 2.
65. **En partes iguales.** Con `parte: { tipo: 'IGUALES', partesRestantes }` se cobra el saldo dividido (criterio 18), por consumo. Ejemplo: cuenta C en 2 partes iguales: `"34.60"` con `partesRestantes: 2` y `"34.60"` con `partesRestantes: 1`; la orden se cierra con la segunda. La PWA recuerda en cuántas partes se dividió y manda las que faltan; si la cuenta cambia entre partes (criterio 87), cada parte siguiente se recalcula sobre el saldo nuevo.
66. **Orden de los modos.** Se puede cobrar por ítems y después dividir el resto en partes iguales; después de una parte igual, solo partes iguales (422 `PARTE_INVALIDA`). `TOTAL` es todo lo que falta y solo vale sin partes iguales previas (después, `IGUALES` con `partesRestantes: 1`).
67. **Cortesías y bolsas en las partes.** Las unidades en cortesía salen como líneas gratuitas en el comprobante del primer cobro de la cuenta. Las bolsas salen enteras: en una parte por ítems, las elegidas; en partes iguales, ⌈bolsas que faltan / partes restantes⌉.
68. **La mesa queda abierta hasta pagar todas** (HU-28, B.9). Cada parte tiene su comprobante y sus pagos (B.14); la mesa vuelve a verde solo con la parte que cierra la cuenta. Cada parte puede ir en una caja distinta y con otro tipo de comprobante (una factura y dos boletas).

### Comprobante, series y correlativos (RF-57, RF-61; ruta crítica P4)

69. **Lo que guarda.** Cada comprobante guarda, tal como era al emitirse (B.14): tipo, serie, número, fecha de emisión, emisor (RUC, razón social, régimen), sucursal (nombre, dirección y código de establecimiento), caja, cliente, formato, moneda `PEN`, tasa de IGV, cada línea (descripción, cantidad, precio unitario con IGV, valor unitario sin IGV con 10 decimales, bruto, descuento, neto, base, IGV, bolsas, ICBPER, afectación, gratuita con su valor referencial), los totales del criterio 11, el monto en letras, la orden con sus mesas, su mozo o su número de llamado, el cobro y el turno. Un cambio posterior de la carta, del emisor, de la sucursal o de la tasa no lo altera.
70. **Numeración** (RF-61, B.13). El comprobante toma la serie activa de su tipo en la caja del turno y el número siguiente de esa serie: `ultimoNumero` + 1. Su texto es la serie y el número de 8 cifras (`B001-00000124`). Hasta `99999999` (después, 409 `SERIE_AGOTADA`).
71. **Sin saltos.** El número se asigna dentro de la transacción del cobro; si el cobro falla después (por ejemplo, un pago que no cuadra o un error en la impresión del documento), se revierte y el número no se pierde: el siguiente cobro confirmado lo usa. Prueba: un cobro que falla a propósito después de numerar y uno bueno dejan `B001` en 1, sin hueco.
72. **Sin duplicados, con dos cajas.** Cien cobros concurrentes de cuentas distintas repartidos entre la Caja 1 y la Caja 2 dejan `B001` y `B002` con números consecutivos desde su primero, sin repetidos ni huecos (índice único de serie y número en la base), y cada comprobante con la serie de su caja. Lo mismo con cobros concurrentes en la misma caja (un Supervisor que cobra en el turno del cajero).
73. **Réplicas y rechazos no numeran.** Ni una réplica (criterios 54 a 56) ni un cobro rechazado (400, 403, 404, 409, 422) consumen un número.
74. **Fecha de emisión y día operativo.** La fecha de emisión es la fecha de Lima del instante del cobro (SUNAT), y define la tasa y el ICBPER vigentes; el comprobante guarda además el día operativo de la sucursal (hora de corte, B.9) para los reportes. Un cobro a las 02:00 del 5 tiene fecha de emisión 5 y día operativo 4.
75. **Por enviar.** En 6a todo comprobante nace `POR_ENVIAR` y así se queda (6b lo envía). Ninguna ruta de 6a lo cambia ni lo borra.
76. **Cuota del plan** (RF-05). La emisión llama a `SuscripcionService.registrarComprobanteEmitido(sucursalId, instante)` una vez por comprobante, en la misma transacción: si el cobro se revierte, el conteo también; nunca bloquea por pasar la cuota. Diez cobros, diez en el consumo del mes de Lima.
77. **Consultar.** `GET /comprobantes/:id` (`COBRAR` + `FACTURACION`) responde `comprobanteRespuesta` (los datos del criterio 69, con `numero` en texto y `estado`); `GET /comprobantes?turnoId=&ordenId=` lista los de un turno o una orden (hasta 200, del más nuevo al más antiguo). Con el alcance del criterio 100.
78. **Inmutable.** `restaurante_api` no tiene `DELETE` sobre las tablas de comprobantes ni `UPDATE` sobre los montos (solo sobre el estado, en 6b): un `UPDATE` de un monto o un `DELETE` desde la API falla en la base.

### Venta de mostrador (HU-18, RF-34; ruta crítica P2)

79. **Vender.** `POST /ventas-mostrador` con IK, `@Permiso('COBRAR')` y `{ id, turnoId, lineas, total, comprobante, pagos, redondeo }` (`lineas` como en el envío de 004, criterio 15) responde 201 `{ venta: { id, ordenId, numeroLlamado }, cobro: cobroRespuesta, envio: envioRespuesta }`.
80. **Cobra primero, todo o nada** (B.4). En una sola transacción: crea la orden `MOSTRADOR`, canal `SALON`, sin mesa ni mozo, con 1 comensal; valida y guarda las líneas con el envío de 004 (`prepararLinea`, 422 por línea con todo o nada, puerto `INVENTARIO`); calcula la cuenta; valida el turno y los pagos y emite el comprobante como un cobro `TOTAL` (criterios 48 a 51); deja la orden `CERRADA`; y solo entonces quedan las comandas por estación. Si algo falla, no queda nada: ni orden, ni comanda, ni comprobante, ni número de llamado, ni trabajo de impresión.
81. **Número de llamado** (pregunta 13). Cada venta de mostrador recibe el número siguiente de su sucursal en su día operativo, desde 1 (se reinicia con la hora de corte). Sin saltos ni repetidos con ventas concurrentes; una venta revertida no lo consume.
82. **Lo muestran la comanda y el comprobante** (HU-18). La comanda de cada estación lleva "LLAMADO 23" en lugar de la mesa, en doble alto en el ticket y en el KDS ("Llamado 23"); `comandaKds.orden` gana `numeroLlamado`. El ticket del comprobante también lo lleva en grande.
83. **Réplicas.** La misma IK, o el mismo `id` de venta con otra IK, devuelve la misma venta sin otra orden, comanda, comprobante, número de llamado ni trabajo; el mismo `id` con otras líneas o pagos, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Diez concurrentes dejan una sola venta.
84. **Precio que cambió.** `total` es el total que vio el cajero; si el calculado con la carta vigente es otro, 409 `CUENTA_CAMBIO` con el total nuevo en `campos.total` y nada se guarda.
85. **Sin descuentos ni cortesías** (pregunta 14). La venta de mostrador no admite descuentos ni cortesías en 6a.

### Cambios en la cuenta después de cobrar una parte (ruta crítica P2)

86. **Anular lo ya cobrado.** Una anulación de ítem (004, criterio 35) de una cuenta con cobros se acepta solo si `cambioDeCuentaPermitido` (criterio 20) lo permite con la cuenta que quedaría; si no, 409 `CUENTA_COBRADA_EN_PARTE` sin anular ni consumir la clave. Lo cobrado se corrige con nota de crédito (6b).
87. **Agregar después de una parte.** Un envío a una cuenta con cobros se acepta si `cambioDeCuentaPermitido` lo permite (por ejemplo, el postre de los que se quedaron, con partes iguales o por ítems sin descuento por cuenta); si no, 409 `CUENTA_COBRADA_EN_PARTE`. Con la cuenta abierta, la mesa sigue ocupada y la parte siguiente se calcula sobre el saldo nuevo.
88. **Unir y anular la orden.** Unir una orden con cobros (la principal o una absorbida) y anular una orden con cobros (004, criterios 42 y 47) responden 409 `CUENTA_EN_COBRO` sin cambios. Mover una cuenta con cobros a otra mesa se permite.
89. **La pre-cuenta con cobros.** Una pre-cuenta de una cuenta con cobros muestra además "Pagado S/ x" y "Por pagar S/ y".

### Impresión y gaveta (RF-56, RF-64; no crítica salvo 92 a 94, que son P2)

90. **Ticket del comprobante.** Cada comprobante emitido encola, en la misma transacción, exactamente un trabajo `COMPROBANTE` en la impresora de su caja (criterio 2); la respuesta trae `trabajoId` e `impresion` como la pre-cuenta (004, criterio 102). `POST /comprobantes/:id/impresiones` con IK reimprime con la marca "REIMPRESIÓN" (o se usa la reimpresión de 004).
91. **Qué lleva el ticket.** Razón social y RUC del emisor, sucursal y dirección, "BOLETA DE VENTA ELECTRÓNICA" o "FACTURA ELECTRÓNICA", serie y número, fecha y hora de emisión, cliente (si hay), mesa y mozo o "LLAMADO 23", líneas (cantidad, descripción, importe), descuentos, cortesías ("Cortesía"), operaciones gravadas, exoneradas, inafectas y gratuitas, IGV con su tasa, ICBPER, total, "SON: …" (criterio 23), pagos, vuelto y redondeo, y el QR con los datos de SUNAT que ya se conocen (RUC, tipo, serie, número, IGV, total, fecha, documento del cliente). En 6a dice "Comprobante pendiente de envío a SUNAT"; 6b lo reemplaza (pregunta 21). El renderizador gana un bloque `qr` (`GS ( k`) que el emulador decodifica.
92. **Gaveta al cobrar en efectivo** (RF-56). Un cobro con un pago en efectivo abre la gaveta de la impresora de su caja si tiene `gaveta: true`: el documento del ticket empieza con el bloque estructural `gaveta` y el renderizador manda `ESC p 0 25 250` antes del texto. Sin efectivo, sin pulso. Sin impresora o sin gaveta, nada (el cobro sigue).
93. **Gaveta en la apertura y en los movimientos** (pregunta 16). Abrir un turno con fondo mayor que `"0.00"` y registrar un ingreso o un egreso encolan un trabajo `GAVETA` (solo el pulso, sin papel ni corte) en la impresora de la caja con gaveta.
94. **El pulso no se repite.** El pulso sale solo en la primera entrega del trabajo y solo si se entrega a menos de 120 segundos de creado: una reimpresión, una réplica del cobro o un trabajo entregado tarde (el puente estuvo desconectado) no abren la gaveta. El ticket entregado tarde sale con su marca de retraso (004, criterio 118).
95. **X y Z impresos.** El cierre encola un trabajo `REPORTE_Z` y `POST …/reporte-x/impresiones` un `REPORTE_X` con los datos del criterio 29 (y el conteo del 31 en la Z), en la impresora de la caja; nunca más de un `REPORTE_Z` por turno sin contar las reimpresiones (índice único parcial).
96. **Sin impresora.** Sin impresora de caja ni de la sucursal, el cobro, la apertura, los movimientos y el cierre se hacen igual con `impresion: 'SIN_IMPRESORA'` y `trabajoId: null`, y la PWA lo dice.

### Tiempo real (no crítico)

97. **Eventos.** `turno.cambio` `{ turnoId, cajaId }` en la sala de la sucursal al abrir, cerrar, cobrar o registrar un movimiento; `orden.cambio` y `salon.cambio` como en 004. Solo ids, menos de 4 KB, nunca en otra sucursal ni en B.

### Permisos, auditoría y trazabilidad (ruta crítica P5)

98. **Clasificación de las rutas.** Toda ruta de `/turnos`, `/cajas`, `/cuentas`, `/ventas-mostrador`, `/comprobantes`, `/sucursales/:sucursalId/cajas…` y `/emisores/:id/tasas-igv…` lleva exactamente la acción y el módulo de la tabla de endpoints; la prueba recorre las rutas registradas en Nest y falla si una no está clasificada. La matriz de `packages/dominio` no cambia. Ninguna ruta nueva cuelga de `/ordenes`, `/salon` ni `/cocina` (así la clasificación protegida de 004, criterio 78, no cambia).
99. **Rechazos por rol.** Para cada rol sin la acción (Mozo y Cocina/Barra en `COBRAR` y `OPERAR_CAJA`; Cocina/Barra en `APLICAR_*` y `ATENDER_MESA`; todos salvo el Administrador en `ADMINISTRAR`), con contraseña y con PIN, cada ruta responde 403 `PROHIBIDO` sin cambios, sin auditoría y sin eventos. El rol es el de la sucursal activa; sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`; sin el módulo, 403 `MODULO_NO_INCLUIDO`.
100. **Alcance del Cajero** (B.16, "Reportes: su turno (X)"). Un Cajero ve el reporte, los movimientos y los comprobantes de sus propios turnos; los de otro turno responden 403 `PROHIBIDO`. El Supervisor y el Administrador ven los de cualquier turno de la sucursal activa.
101. **Auditoría.** Cada acción de "Acciones auditadas en esta sección" deja exactamente una fila en la misma transacción, con el actor, la sucursal, el equipo, la sesión, la hora del reloj y, si hubo clave, el autorizador; ninguna en las réplicas ni en lo que no cambia nada.
102. **Trazabilidad** (RNF-20). Las tablas nuevas se crean con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`. Cada cobro, pago, comprobante, movimiento y turno queda con quién lo hizo y desde qué equipo; un cobro de un Supervisor en el turno de un Cajero queda con el Supervisor como autor y el Cajero como responsable del turno; una sesión de soporte queda trazada con el superadministrador.

### Aislamiento entre empresas (ruta crítica P6)

103. **Catálogo.** Las tablas nuevas cumplen el criterio 38 de 001 y el 88 de 002; las pruebas de catálogo existentes las recorren solas.
104. **Por tabla.** Para `caja`, `turno`, `turno_conteo`, `movimiento_caja`, `cobro`, `pago`, `serie`, `comprobante`, `comprobante_linea`, `emisor_tasa_igv`, `descuento`, `cortesia` y `contador_llamado`, con el contexto de A y un actor de A: no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, ni se insertan filas con `empresa_id` de B; el rechazo es de la política RLS.
105. **Referencias cruzadas.** Con el contexto de A, una fila de A que apunte a una de B (caja con sucursal o impresora de B, serie con caja o emisor de B, turno con caja de B, cobro con orden o turno de B, comprobante con serie o cobro de B, descuento con ítem de B) falla por la llave foránea compuesta, igual que con un id inexistente.
106. **Por HTTP.** En toda ruta de esta entrega, un id de B en la ruta responde 404 y en el cuerpo 422 (`REFERENCIA_INVALIDA` o el del criterio), con el mismo cuerpo que un id inexistente y sin cambios en B. Los ids de cliente (turno, movimiento, cobro, venta, descuento y cortesía) son únicos por empresa: el mismo id usado en B crea su propia fila. Las series de A y de B pueden ser iguales (`B001`) y cada una numera por su lado.
107. **Concurrencia.** Con un pool de 2 conexiones, 100 cobros concurrentes alternando A y B (cada una con su turno y su serie `B001`) dejan cada serie con sus números consecutivos, cada cobro en su empresa, y cada evento solo en su empresa.

### Interfaz (PWA, no crítica)

Las pantallas siguen `DESIGN.md` (tipo "Operate", móvil primero y también tablet, trato de tú) y `PRODUCT.md`; el rol frontend usa la skill `impeccable`. Todo lo de caja se carga bajo demanda.

108. **Navegación** (cambia el criterio 87 de 004). "Caja" aparece para quien tiene `COBRAR` u `OPERAR_CAJA` con el módulo `CAJA`: Cajero "Salón", "Caja" y "Carta"; Supervisor "Salón", "Caja", "Cocina" y "Disponibilidad"; Administrador "Salón", "Caja", "Cocina", "Carta" y "Ajustes", y "Disponibilidad" pasa a un acceso dentro de "Cocina" (máximo cinco destinos).
109. **Abrir caja.** `/caja` sin turno muestra las cajas de la sucursal (con su estado: "Libre" o "Abierta por Ana desde las 18:02") y "Abrir caja" con el fondo (teclado numérico, `S/`); la caja elegida se recuerda en el equipo. Si la sucursal está suspendida, lo dice con el texto de 002.
110. **Mi turno.** Con turno abierto, `/caja` muestra la caja, desde cuándo y los segmentos "Por cobrar" (las cuentas abiertas con su total y saldo, criterio 37), "Mostrador", "Movimientos" (ingreso o egreso con monto y motivo) y "Reporte X" (en pantalla e "Imprimir"); "Cerrar caja" separado por una junta.
111. **Cobrar.** Desde "Por cobrar" o desde la cuenta de la mesa ("Cobrar", para quien tiene `COBRAR`): el desglose con cifras tabulares (subtotal, descuentos, cortesías, IGV, ICBPER y total), "Descuento" y "Cortesía" por ítem o para la cuenta (con la ventana de clave cuando corresponde, que muestra lo que se autoriza), "Dividir", el comprobante (Boleta o Factura, Detallado o Por consumo; cliente con documento, nombre y dirección, con el aviso "Más de S/ 700: pide nombre y DNI"), los pagos y el botón "Cobrar S/ 69.20".
112. **Pagos y vuelto.** Botones grandes por medio; el efectivo con "Recibido" y atajos de billetes (S/ 10, 20, 50, 100, 200, "Exacto"), el vuelto en grande y el redondeo a la vista ("Redondeo a tu favor: S/ 0.04"); tarjeta, Yape y Plin piden el número de operación; "Agregar otro pago" para combinar; "Falta S/ x" hasta cuadrar. Los montos salen de `packages/dominio`.
113. **Dividir.** "Por ítems": elegir unidades de cada línea con − y + (la parte muestra su total al momento); "Partes iguales": cuántas partes (2 a 50, por defecto los comensales) y cuánto es cada una; la lista de partes con su estado ("Pagada · B001-00000124") y "Cobrar la parte 2 de 3". Las partes pendientes se recuerdan en el equipo por cuenta.
114. **Resultado.** Al cobrar: "Cobrado · B001-00000124", vuelto, "Imprimir otra vez" y, si la mesa quedó libre, "Mesa 4 libre". Con 409 `CUENTA_CAMBIO`: "La cuenta cambió" y la cuenta nueva, sin perder los pagos escritos. Con un cobro pendiente de respuesta (sin red), "Reintentar" con el mismo `id`.
115. **Mostrador.** El comandero de 004 en modo mostrador (sin mesa), el total, el comprobante y los pagos en la misma pantalla, y "Cobrar y enviar"; al terminar, "Llamado 23" en grande.
116. **Cerrar caja.** Conteo por medio sin mostrar el esperado (pregunta 3); si hay diferencias, cada una con su monto y su motivo obligatorio (atajos: "Faltó sencillo", "Error de vuelto", "Voucher sin registrar"); "Cerrar con Z" con confirmación. Con `CIERRE_BLOQUEADO`, "Quedan 2 cuentas abiertas" con la lista y el enlace a cada una.
117. **Ajustes › Cajas** (Administrador). Lista de cajas con su impresora y series; formulario con nombre, impresora, serie de boletas y de facturas (con "Primer número" solo al crear); y en Ajustes › Emisores, la tasa de IGV con "Desde".
118. **E2E críticos** (Playwright, contra la API y el emulador de impresora). Abrir turno con fondo; cobrar la cuenta C con efectivo y Yape, vuelto y mesa en verde en otro contexto; dividir por ítems y luego en partes iguales; descuento por ítem con la clave del supervisor; venta de mostrador con número de llamado en el KDS; cierre Z con una diferencia y su motivo; cierre bloqueado con una mesa abierta. Viewport de celular y de tablet.
119. **Peso y compatibilidad.** Las reglas del criterio 98 de 004; el paquete inicial de la PWA no pasa del presupuesto (plan, "Riesgos": hoy el margen es casi nulo).

---

## Entrega 6b · Facturación electrónica

Criterios de alcance; se revisan con el orquestador antes de empezar 6b, con el PSE elegido (pregunta 20) y lo que deje 6a.

### Conector y simulador (RF-57, RF-66)

120. **Conector.** `ConectorPse` (`apps/api/src/modulos/facturacion/pse/`) define `emitir(comprobante)`, `consultar(comprobante)` y `anular(comprobante, motivo)` con resultados `ACEPTADO`, `RECHAZADO` (con código y mensaje de SUNAT), `PENDIENTE` (el PSE lo recibió y responde después) o error de transporte (reintentable). `PSE_CONECTOR` elige la implementación: `simulador` (por defecto fuera de producción) o el PSE elegido.
121. **Simulador** (RF-66, ruta crítica P7 en su uso por las pruebas). `SimuladorPse` acepta todo salvo reglas configurables por prueba (rechazar un RUC, tardar, fallar N veces, responder `PENDIENTE`) y devuelve un PDF y un XML de ejemplo y los datos del QR. Se puede usar en demos y capacitación por sucursal (marca "simulado" en el panel y en el ticket).

### Envío con reintentos (RF-63, HU-31; ruta crítica P7)

122. **Fuera de la transacción.** El cobro registra el envío en su transacción (fila `envio_pse` `PENDIENTE`) y lo encola en pg-boss con `alConfirmar`; el worker lo procesa con `ContextoEmpresa.ejecutar` de su empresa y actor `worker:envio-pse`. Una caída entre el `COMMIT` y la cola no pierde el envío: un barrido periódico vuelve a encolar los `PENDIENTE` sin trabajo vivo.
123. **Estados** (B.15). `POR_ENVIAR` → `ENVIADO` (el PSE lo recibió) → `ACEPTADO` o `RECHAZADO`; `ANULADO` con nota de crédito o baja. Cada transición se guarda una vez con su hora; el comprobante no cambia de montos.
124. **Sin duplicados.** Reintentar nunca crea otro comprobante en el PSE: el envío lleva la serie y el número como identificador y, ante un error de transporte, primero se consulta (`consultar`) antes de volver a emitir. Dos workers con el mismo envío: uno lo procesa y el otro lo deja (bloqueo de la fila).
125. **Reintentos.** Errores reintentables con espera creciente (1, 2, 5, 15, 30 minutos y luego cada hora) hasta el plazo de SUNAT del tipo de comprobante; un `RECHAZADO` no se reintenta.
126. **Alertas** (HU-31, RNF-19). Un comprobante `RECHAZADO`, o `POR_ENVIAR`/`ENVIADO` por más de 30 minutos, genera un aviso en la PWA para el Administrador y el Supervisor de la sucursal (evento `comprobante.estado` y banner) y una alerta al equipo de soporte en el monitoreo.
127. **Resultado guardado.** El PDF y el XML se guardan en R2 (`ARCHIVOS`), el CDR y los datos del QR en el comprobante; una segunda respuesta igual no los duplica.
128. **Rechazado.** "Se corrige y se emite otro" (B.15): el rechazado queda con su motivo; el panel ofrece emitir uno nuevo con los mismos datos corregidos (cliente, tipo), con otro número. Qué pasa con el número rechazado lo decide la pregunta 22.
129. **Panel.** `GET /comprobantes?estado=&desde=&hasta=` (Administrador todas las sucursales, Supervisor la suya) con filtros y conteos por estado; `POST /comprobantes/:id/reintento` fuerza un reintento.

### RUC y DNI (RF-58, HU-27; no crítico salvo P9)

130. **Padrón.** El padrón reducido de SUNAT se carga cada día por el worker en el esquema `referencia` (compartido, sin datos de clientes), sin acceso directo de `restaurante_api`: la API lo lee con una función `SECURITY DEFINER` de búsqueda exacta por RUC.
131. **Autocompletar.** `GET /padron/ruc/:ruc` (`COBRAR`) responde `{ ruc, razonSocial, direccion, estado, condicion }` o 404; la PWA llena el cliente de la factura.
132. **Aviso.** Un RUC que no existe, no está `ACTIVO` o no está `HABIDO` muestra el aviso de HU-27; emitir igual o no lo decide la pregunta 24.
133. **DNI.** Sin consulta: el cajero escribe el nombre (B.13).

### Notas de crédito (RF-62, HU-29; ruta crítica P8)

134. **Tipos.** Anulación de la operación (total), devolución por ítems (parcial) y cambio de boleta por factura (anulación de la boleta y emisión de una factura nueva con los mismos montos).
135. **Clave.** `POST /comprobantes/:id/notas-credito` con IK y `@Permiso('EMITIR_NOTA_CREDITO')` (Cajero con clave atada al comprobante y al monto; Supervisor y Administrador sin clave) y motivo.
136. **Serie y número.** Serie propia de la caja para notas de crédito de boletas (`B…`) y de facturas (`F…`), con la misma numeración sin saltos ni duplicados de 6a.
137. **Montos.** Recalculados con `packages/dominio` sobre las líneas del original: nunca más que lo que queda sin acreditar de cada línea.
138. **Devolución como egreso** (HU-29, B.9). Si se devuelve dinero, se registra un egreso del turno abierto de quien emite, en el medio de la devolución, ligado a la nota, y entra en el esperado del Z. Sin turno abierto, solo se emite sin devolución.
139. **Estado del original.** Una anulación total deja el original `ANULADO` cuando la nota es aceptada; una parcial, con su saldo.
140. **Auditoría.** `emitir_nota_credito` con el autorizador, el original, los montos y la devolución.
141. **Cuota.** Cada nota cuenta en la cuota del plan si la pregunta 22 lo confirma.
142. **Concurrencia.** Dos notas simultáneas sobre el mismo original no acreditan más que el original.
143. **Sin borrar.** Ni la nota ni el original se borran ni cambian de montos.
144. **Baja.** La comunicación de baja y el resumen diario de boletas los gestiona el PSE (B.13); el conector los expone si el PSE lo pide.

### PDF y WhatsApp (RF-64; no crítico)

145. **PDF.** `GET /comprobantes/:id/pdf` devuelve el PDF del PSE (o 409 si aún no hay).
146. **WhatsApp.** "Compartir por WhatsApp" abre `wa.me` con el enlace público firmado y con vencimiento del PDF; no se usa la API de WhatsApp (fuera del MVP).
147. **Ticket definitivo.** El ticket impreso lleva el QR y la leyenda de representación impresa según la pregunta 21.

### Permisos y aislamiento de 6b (ruta crítica P9)

148. **Worker.** El worker no lee nada sin fijar la empresa del trabajo; un trabajo con el id de un comprobante de otra empresa no lo encuentra.
149. **Padrón.** El esquema `referencia` no tiene datos de clientes ni acceso de escritura de la API; la función de búsqueda no expone otra cosa que la fila pedida.
150. **Archivos.** Los PDF y XML viven bajo una ruta por empresa; el enlace público expira y no permite listar.

### Interfaz de 6b (no crítica)

151. **Panel de comprobantes** (HU-31). En Ajustes (Administrador) y en Caja (Supervisor): conteos por estado, lista con filtros, detalle con el motivo del rechazo, "Reintentar" y "Emitir otro".
152. **Nota de crédito.** Desde el comprobante: tipo, ítems y cantidades, motivo, devolución (medio y monto) y la ventana de clave.

---

## Acciones auditadas en esta sección

Cada fila lleva actor, empresa, sucursal, equipo, sesión y hora (criterio 57 de 002).

| Acción (`accion`) | Entidad | Cuándo |
| --- | --- | --- |
| `crear_caja`, `modificar_caja` | `caja` | Criterio 1 |
| `configurar_serie` | `serie` | Criterios 3 y 5 |
| `configurar_tasa_igv` | `emisor_tasa_igv` | Criterio 6 |
| `aplicar_descuento`, `quitar_descuento` | `descuento` | Criterios 38, 39 y 42 |
| `aplicar_cortesia`, `quitar_cortesia` | `cortesia` | Criterio 43 |
| `APLICAR_DESCUENTO`, `APLICAR_CORTESIA` (de 002: consumo de la autorización) | — | Criterios 40 y 43, solo con clave |
| `cerrar_turno` (con el conteo, las diferencias y sus motivos) | `turno` | Criterio 31 |
| `emitir_nota_credito` (6b) y `EMITIR_NOTA_CREDITO` (consumo) | `comprobante` | Criterios 135 y 140 |

No se auditan (quedan en la trazabilidad de sus filas): abrir turno, movimientos, cobros, pagos, comprobantes, ventas de mostrador, reportes X e impresiones.

## Casos límite

- Una cuenta toda en cortesía: se cobra con `pagos: []` y sale una boleta con total `"0.00"` y operaciones gratuitas (criterio 50).
- Un descuento que deja céntimos raros y se paga en efectivo: el redondeo a la décima va a favor del cliente y se ve en el ticket y en el X (criterio 21).
- Una boleta de S/ 700.00 exactos no exige documento; una de S/ 700.01 sí. Dividir una cuenta grande en partes de menos de S/ 700 es decisión del cliente.
- Dos cajeros abren la misma cuenta en dos tablets: el primero en cobrar gana; el otro ve "La cuenta cambió" (criterio 57).
- El cajero cobra mientras el mozo, en otro celular, todavía tiene ítems en el borrador: no se cobran porque no existen para la API; si después se envían, la orden ya está cerrada y el envío responde `ORDEN_NO_ABIERTA` (004); el mozo abre la mesa otra vez.
- Una mesa abierta justo después de confirmado el último cierre del día: queda abierta sin turno; la cobra el turno del día siguiente (criterio 33).
- Un turno abierto por más de un día: el X y el Z cubren todo; cada cobro guarda su propio día operativo.
- El cajero se olvida de cerrar y se va: el Supervisor cierra su turno (criterio 35).
- La sucursal se suspende con el turno abierto: sigue cobrando hasta la Z; la siguiente apertura responde `SUCURSAL_SUSPENDIDA` (criterio 25).
- Un egreso mayor que el efectivo esperado: se acepta; el Z mostrará la diferencia.
- Cambio de tasa de IGV a medianoche: un cobro a las 23:59 y otro a las 00:01 usan cada uno la tasa de su fecha de emisión (criterio 74).
- La impresora de la caja sin papel: el comprobante queda emitido y el trabajo pendiente; se reimprime al volver (004). La gaveta no se abre si el trabajo se entrega pasados 120 segundos (criterio 94): el cajero la abre con la llave.
- Dos sucursales del mismo RUC intentan usar `B001`: la segunda recibe 409 (criterio 4).
- Un comprobante con 600 líneas: el ticket sale completo o con el aviso de ticket incompleto de 004; el comprobante en la base está completo.
- El supervisor autoriza "10 % al Lomo" y el cajero intenta aplicar 20 %: 403 `AUTORIZACION_INVALIDA` (criterio 40).
- Una venta de mostrador con un producto que se agotó mientras el cajero cobraba: 422 por línea y nada se cobra (criterio 80).

## Reglas de negocio aplicables

Fuente: `fuentes.md`, las decisiones vigentes de 002 a 005 y las recomendaciones de "Preguntas abiertas", pendientes de la aprobación del usuario.

- No se puede cobrar sin un turno abierto, que se abre con un fondo inicial (HU-25, RF-50). La suspensión impide abrir caja pero no corta un turno abierto (HU-04, RF-06).
- Se cobra con uno o varios medios (efectivo, tarjeta de crédito o débito, Yape, Plin), con vuelto y con el número de operación o voucher en los no efectivos, sin conexión con el POS del banco (RF-51, HU-26, B.9). Solo al contado y en soles (B.7, B.9).
- Al cobrar todo, la mesa vuelve a verde (HU-26, Estados).
- La cuenta se divide por ítems o en partes iguales, con un comprobante por parte; en partes iguales, cada comprobante sale por consumo; la orden queda abierta hasta pagar todas (RF-52, HU-28, B.9, B.14).
- Ingresos y egresos con su motivo (RF-53); X en cualquier momento; Z con conteo físico por medio y motivo obligatorio para cada diferencia; la Z es definitiva; el último turno no se cierra con mesas o pedidos abiertos (RF-54, RF-55, HU-30, B.9, Estados).
- La gaveta se abre al cobrar en efectivo (RF-56).
- Boleta o factura, detallada o por consumo; boletas de más de S/ 700 con nombre y DNI; en el Nuevo RUS, solo boletas (RF-57, RF-59, RF-65, B.9, B.13).
- Los precios incluyen IGV; el sistema calcula base imponible, IGV por línea, ICBPER, descuentos y redondeos con la tasa vigente del emisor (B.7, RF-60, B.13); el ICBPER se suma al cobrar (RF-32).
- Una serie por caja y por tipo de comprobante (B001 en la caja 1, B002 en la caja 2); cada sucursal emite con el RUC de su emisor y su código de establecimiento (RF-61, B.13).
- Descuentos por ítem o por cuenta, en porcentaje o monto, y cortesías, siempre con clave de supervisor y motivo; las cortesías descuentan stock y no se cobran; su tratamiento tributario lo define el contador (RF-33, B.7). Toda acción con clave queda en la auditoría (HU-03, RF-12, RF-13, B.11).
- Venta rápida en mostrador: se cobra primero y el pedido pasa a cocina con un número de llamado, que muestran el ticket de cocina y el comprobante (RF-34, HU-18, B.4).
- Cada comprobante cuenta en la cuota del plan sin bloquear la emisión (RF-05, B.17).
- Las ventas guardan cómo eran al venderse (B.14). Cada sucursal tiene hora de corte del día operativo (B.9).
- 6b: el PSE genera, firma y envía el XML; nuestro sistema calcula, numera, reintenta y muestra el estado; el RUC se autocompleta con el padrón; el DNI se escribe; las notas de crédito llevan clave y la devolución es egreso del turno (B.13, RF-58, RF-62, RF-63, HU-27, HU-29, HU-31).
- Fuera de alcance: propinas, ventas al crédito, otras monedas (A.12, B.2).

## Contrato

### Endpoints (6a)

"Caja" = `@RequiereModulo('CAJA')`; "Salón" = `@RequiereModulo('SALON')`; "Fact." = `@RequiereModulo('FACTURACION')`; "Admin" = `@Permiso('ADMINISTRAR')` sin módulo; "Clave" = obligatoria para quien tiene la acción como `clave`, consumida con `@ClaveDespuesDeValidar` (orden de interceptores de 004). Todas las escrituras de operación llevan IK salvo `DELETE`.

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `GET`, `POST /sucursales/:sucursalId/cajas` | Admin | `cajaEntrada` | 200 / 201 `cajaRespuesta`; 400; 403; 404; 409; 422 |
| `PATCH /sucursales/:sucursalId/cajas/:id` | Admin | `cajaModificarEntrada` | 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO`; 422 |
| `PUT /sucursales/:sucursalId/cajas/:cajaId/series/:tipo` | Admin | `serieEntrada` | 200 `cajaRespuesta`; 400; 403; 404; 409 |
| `GET /emisores/:id/tasas-igv` | Admin | — | 200 `tasaIgvRespuesta[]` |
| `PUT /emisores/:id/tasas-igv/:desde` | Admin | `{ tasa }` | 200; 400; 403; 404; 409 |
| `GET /cajas` | `OPERAR_CAJA` + Caja | — | 200 `cajaRespuesta[]` (sin montos) |
| `POST /turnos` | `OPERAR_CAJA` + Caja; IK | `abrirTurnoEntrada` | 201 `turnoRespuesta`; 400; 403 `SUCURSAL_SUSPENDIDA`; 404; 409 `TURNO_YA_ABIERTO` / `CONFLICTO`; 422 |
| `GET /turnos/mio` | `OPERAR_CAJA` + Caja | — | 200 `turnoRespuesta`; 404 |
| `GET /turnos/:id` | `OPERAR_CAJA` + Caja | — | 200; 403; 404 |
| `POST /turnos/:id/movimientos` | `OPERAR_CAJA` + Caja; IK | `movimientoEntrada` | 201; 400; 403; 404; 409 `TURNO_CERRADO` / `TURNO_AJENO`; 422 |
| `GET /turnos/:id/reporte` | `OPERAR_CAJA` + Caja | — | 200 `reporteCaja`; 403; 404 |
| `POST /turnos/:id/reporte-x/impresiones` | `OPERAR_CAJA` + Caja; IK | — | 201 `{ trabajoId, impresion }`; 403; 404 |
| `POST /turnos/:id/cierre` | `OPERAR_CAJA` + Caja; IK | `cierreEntrada` | 200 `reporteCaja`; 400; 403; 404; 409 `TURNO_CERRADO` / `TURNO_AJENO` / `CIERRE_BLOQUEADO`; 422 `DIFERENCIA_SIN_MOTIVO` |
| `GET /cuentas` | `COBRAR` + Caja | `If-None-Match` | 200 `cuentaResumen[]`; 304 |
| `GET /cuentas/:ordenId` | `ATENDER_MESA` + Caja | — | 200 `cuentaRespuesta`; 404 |
| `POST /cuentas/:ordenId/descuentos` | `APLICAR_DESCUENTO` (Clave) + Salón; IK | `descuentoEntrada` | 201 `descuentoRespuesta`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` / `PROHIBIDO`; 404; 409 `CONFLICTO` / `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`; 422 `DESCUENTO_INVALIDO` |
| `DELETE /cuentas/:ordenId/descuentos/:id` | `ATENDER_MESA` + Salón | — | 204; 404; 409 |
| `POST /cuentas/:ordenId/cortesias` | `APLICAR_CORTESIA` (Clave) + Salón; IK | `cortesiaEntrada` | 201 `cortesiaRespuesta`; 400; 403; 404; 409; 422 `CORTESIA_INVALIDA` |
| `DELETE /cuentas/:ordenId/cortesias/:id` | `ATENDER_MESA` + Salón | — | 204; 404; 409 |
| `POST /cuentas/:ordenId/cobros` | `COBRAR` + Caja; IK | `cobroEntrada` | 201 `cobroRespuesta`; 400; 403; 404; 409 `TURNO_CERRADO` / `TURNO_AJENO` / `CUENTA_CAMBIO` / `ORDEN_NO_ABIERTA` / `NADA_QUE_COBRAR` / `SIN_SERIE` / `SERIE_AGOTADA` / `TASA_IGV_NO_CONFIGURADA`; 422 `PARTE_INVALIDA` / `PAGOS_NO_CUADRAN` / `COMPROBANTE_NO_PERMITIDO` / `CLIENTE_REQUERIDO` / `MONTO_FUERA_DE_RANGO` / `CLAVE_IDEMPOTENCIA_REUTILIZADA` |
| `POST /ventas-mostrador` | `COBRAR` + Caja; IK | `ventaMostradorEntrada` | 201; los del cobro y los del envío de 004 (`PRODUCTO_NO_VENDIBLE`, `SELECCION_INVALIDA`) |
| `GET /comprobantes/:id` | `COBRAR` + Fact. | — | 200 `comprobanteRespuesta`; 403; 404 |
| `GET /comprobantes` | `COBRAR` + Fact. | `?turnoId=&ordenId=` | 200 `comprobanteResumen[]`; 403 |
| `POST /comprobantes/:id/impresiones` | `COBRAR` + Fact.; IK | — | 201 `{ trabajoId, impresion }`; 404; 409 `SIN_IMPRESORA` |
| `POST /autorizaciones` (002, cambia) | como en 002 | gana `objetivo?` | como en 002; la respuesta gana `objetivo` |

Orden de rechazos de las escrituras (el de 004): 401, 403 de rol, 409 `SUCURSAL_NO_ELEGIDA`, 403 `MODULO_NO_INCLUIDO`, 400 de forma (incluida la falta de IK), réplica de la misma clave, 403 de clave, 404, réplica del mismo id de cliente, 409 de estado, 422.

### Endpoints (6b, a precisar antes de empezarla)

`GET /comprobantes?estado=&desde=&hasta=` (panel; Supervisor y Administrador), `POST /comprobantes/:id/reintento`, `POST /comprobantes/:id/notas-credito` (`EMITIR_NOTA_CREDITO`, Clave; IK), `GET /comprobantes/:id/pdf`, `GET /padron/ruc/:ruc` (`COBRAR`), `PUT /sucursales/:sucursalId/cajas/:cajaId/series/NOTA_CREDITO_BOLETA|NOTA_CREDITO_FACTURA` (Admin).

### Códigos de error nuevos (`CODIGOS_ERROR`)

409: `TURNO_YA_ABIERTO` (con `turnoId`), `TURNO_CERRADO`, `TURNO_AJENO`, `CIERRE_BLOQUEADO` (con `ordenes`), `CUENTA_CAMBIO` (con `version`), `CUENTA_EN_COBRO`, `CUENTA_COBRADA_EN_PARTE`, `NADA_QUE_COBRAR`, `SIN_SERIE`, `SERIE_AGOTADA`, `TASA_IGV_NO_CONFIGURADA`. 422: `DIFERENCIA_SIN_MOTIVO`, `DESCUENTO_INVALIDO`, `CORTESIA_INVALIDA`, `PARTE_INVALIDA`, `PAGOS_NO_CUADRAN`, `COMPROBANTE_NO_PERMITIDO`, `CLIENTE_REQUERIDO`. `errorRespuestaSchema` gana `turnoId`, `version` y `ordenes` opcionales. Se reutilizan los de 004 (`ORDEN_NO_ABIERTA`, `MONTO_FUERA_DE_RANGO`, `PRODUCTO_NO_VENDIBLE`, `SELECCION_INVALIDA`, `SIN_IMPRESORA`, `ITEM_NO_ANULABLE`), los de 002 (`CLAVE_REQUERIDA`, `AUTORIZACION_INVALIDA`, `SUCURSAL_SUSPENDIDA`, `MODULO_NO_INCLUIDO`, `SUCURSAL_NO_ELEGIDA`, `CLAVE_IDEMPOTENCIA_REUTILIZADA`) y los generales.

### Eventos en tiempo real

| Evento | Sala | Datos | Cuándo |
| --- | --- | --- | --- |
| `turno.cambio` | sucursal | `{ turnoId, cajaId }` | Criterios 24, 28, 31, 63 |
| `orden.cambio`, `salon.cambio` (004) | sucursal | los de 004 | Criterios 44, 52, 63, 80 |
| `cocina.comanda` (004) | sucursal | el de 004 | Venta de mostrador (criterio 80) |
| `comprobante.estado` (6b) | sucursal | `{ comprobanteId, estado }` | Criterio 126 |

### Paquetes compartidos

- `packages/dominio/src/caja/` (entrada propia `@restaurante/dominio/caja` para cargarla bajo demanda en la PWA):
  - Ruta crítica (P1): `desglosar`, `tasaIgvVigente`, `montoIcbperVigente`, `MONTOS_ICBPER`, `calcularCuenta`, `validarDescuento`, `repartirPorMayorResto`, `calcularParte`, `cambioDeCuentaPermitido`, `validarPagos`, `redondeoEfectivo`, `esperadoDelTurno`, `diferenciasDelArqueo`.
  - No crítica: `montoEnLetras`; catálogos `MEDIOS_PAGO`, `TIPOS_COMPROBANTE`, `FORMATOS_COMPROBANTE`, `TIPOS_DOCUMENTO_CLIENTE`, `TIPOS_DESCUENTO`, `MODOS_COBRO`, `ESTADOS_TURNO`, `ESTADOS_COMPROBANTE`; límites `MONTO_BOLETA_SIN_DOCUMENTO = '700.00'`, `MAXIMO_CAJAS_SUCURSAL = 10`, `MAXIMO_PAGOS_COBRO = 10`, `MAXIMO_PARTES_IGUALES = 50`, `SEGUNDOS_PULSO_GAVETA = 120`, `CORRELATIVO_MAXIMO = 99999999`.
  - `regimen.ts`: `tiposDeComprobantePermitidos(regimen)`.
- `packages/contratos`: `src/caja.ts` (cajas, series, turnos, movimientos, reporte, cierre, cuentas, descuentos, cortesías, cobros, venta de mostrador), `src/comprobantes.ts` (comprobante, líneas, resumen), `src/autorizaciones.ts` (`objetivo` opcional: unión por `tipo` `DESCUENTO` | `CORTESIA`), `src/impresion.ts` (`TIPOS_TRABAJO` gana `COMPROBANTE`, `REPORTE_X`, `REPORTE_Z`, `GAVETA`; bloques `qr` y `gaveta`), `src/salon.ts` (`comandaKds.orden.numeroLlamado` opcional; `precuentaRespuesta` gana `descuentos`, `cortesias`, `pagado` y `porPagar` opcionales), `src/errores.ts`.

### Interfaces de la API (contratos públicos para las pruebas y otras secciones)

- **Pedidos** (dueño de órdenes, ítems, descuentos, cortesías y número de llamado) exporta `CuentasDePedidos`: `cuentaParaCobrar(ordenId, { bloquear })` (las líneas, descuentos, cortesías, versión, estado, cobrado y modo), `registrarCobro({ ordenId, itemsFacturados, monto, modo, cierra })` (suma lo facturado, sube la versión y, si cierra, deja `CERRADA` y libera las mesas con sus eventos) y `abrirYEnviarMostrador({ id, lineas, numeroLlamado })`. Define el puerto `COBROS` (`validarCambio(ordenId, cuentaNueva)`) que implementa caja y que pedidos llama en envíos, anulaciones y uniones solo si la orden tiene cobros (registro al arrancar, como `UsoDeMesas`; falla cerrado).
- **Facturación** (dueño de series y comprobantes) exporta `EmisionService.emitir(datos)` (numera, guarda, llama la cuota y encola el ticket) y `facturadoDeOrden(ordenId)` (las partes anteriores para `calcularParte`), `SeriesService` (configuración).
- **Plataforma** exporta `EmisoresService.tasasIgv(emisorId)` y `datosParaComprobante(sucursalId)`.
- **Impresión**: `ImpresionPuerto.encolar` acepta los tipos nuevos y `impresoraDeCaja` gana `impresoraDeLaCaja(cajaId)`.
- **Seguridad**: `SesionActual.autorizacionConsumida()` devuelve también el `objetivo`.
- `crearAplicacion({ …, pse? })` (6b): reemplaza el conector.

### Variables de entorno nuevas

Ninguna en 6a. En 6b: `PSE_CONECTOR` (`simulador` o el código del PSE), `PSE_URL`, `PSE_TOKEN` (secreto), `CLAVE_CIFRADO_PSE` (para credenciales por emisor si el PSE las pide, RNF-07), `PADRON_RUC_URL`, `WORKER` (`habilitado`/`deshabilitado`) y `DATABASE_COLAS_URL` (rol propio de pg-boss).

### Permisos

- Los de la tabla de endpoints; la matriz de `packages/dominio` no cambia. Soporte = Administrador (un turno exige persona, criterio 24).
- Base de datos (`restaurante_plataforma` sin privilegios):

| Tabla | Módulo | `restaurante_api` |
| --- | --- | --- |
| `caja` | caja | SELECT, INSERT, UPDATE |
| `turno` | caja | SELECT, INSERT, UPDATE |
| `turno_conteo`, `movimiento_caja`, `cobro`, `pago` | caja | SELECT, INSERT |
| `serie` | facturación | SELECT, INSERT, UPDATE |
| `comprobante` | facturación | SELECT, INSERT, UPDATE (solo `estado` y columnas de 6b, con privilegio por columna) |
| `comprobante_linea` | facturación | SELECT, INSERT |
| `emisor_tasa_igv` | plataforma | SELECT, INSERT, UPDATE |
| `descuento`, `cortesia` | pedidos | SELECT, INSERT, UPDATE (para quitar) |
| `contador_llamado` | pedidos | SELECT, INSERT, UPDATE |

## Cambios al modelo de datos

Todas las tablas de `public` con `id uuid`, `empresa_id`, `creado_en`, `actualizado_en`, único `(id, empresa_id)`, índice por `empresa_id`, creadas con `sqlTablaDeEmpresaTrazable(tabla, { privilegiosApi, privilegiosPlataforma: [], llaveDeEquipo: true })`, llaves foráneas compuestas con `empresa_id`, `CHECK` de largo en los textos y montos `numeric(10,2)` (los totales de reportes, `numeric(14,2)`). Las tablas con id del cliente (`turno`, `movimiento_caja`, `cobro`, `descuento`, `cortesia`, y la venta de mostrador, que usa el id de la orden) tienen clave primaria `(empresa_id, id)`, como en 004.

**Entrega 6a**

- **`caja`** (caja): `sucursal_id`, `nombre` (1 a 40), `impresora_id null` (FK compuesta a `impresora`), `activa`. Único `(empresa_id, sucursal_id, lower(nombre))`.
- **`turno`** (caja): `caja_id`, `sucursal_id` (de la caja), `responsable_id` (FK a `usuario`), `estado` (`CHECK IN ('ABIERTO','CERRADO')`), `abierto_en`, `dia_operativo date`, `fondo`, `cerrado_en null`, `cerrado_por_id null`, `huella_entrada bytea`. Únicos parciales `(empresa_id, caja_id) WHERE estado = 'ABIERTO'` y `(empresa_id, sucursal_id, responsable_id) WHERE estado = 'ABIERTO'`. `CHECK` de coherencia entre `estado`, `cerrado_en` y `cerrado_por_id`.
- **`turno_conteo`** (caja): `turno_id`, `medio`, `esperado`, `contado`, `diferencia`, `motivo null`. Único `(turno_id, medio)`. `CHECK` `diferencia = contado - esperado` y `motivo` obligatorio si `diferencia <> 0`.
- **`movimiento_caja`** (caja): `turno_id`, `tipo` (`CHECK IN ('INGRESO','EGRESO')`), `medio` (`'EFECTIVO'` en 6a; 6b agrega los de la devolución), `monto` (> 0), `motivo`, `comprobante_id null` (6b: la nota de crédito).
- **`cobro`** (caja): `orden_id`, `turno_id`, `comprobante_id` (FK compuesta, único), `modo` (`CHECK IN ('TOTAL','ITEMS','IGUALES')`), `parte jsonb` (la entrada normalizada), `detalle_parte jsonb` (el resultado de `calcularParte`, para las partes siguientes), `total`, `redondeo` (0.00 a 0.09), `vuelto`, `huella_entrada bytea`, `respuesta jsonb` (la respuesta original, para la réplica del criterio 55). Índices `(orden_id)` y `(turno_id)`.
- **`pago`** (caja): `cobro_id`, `turno_id`, `medio` (`CHECK IN ('EFECTIVO','TARJETA_CREDITO','TARJETA_DEBITO','YAPE','PLIN')`), `monto` (> 0), `recibido null`, `operacion null`. `CHECK`: `recibido` solo y ≥ `monto` en efectivo; `operacion` obligatoria fuera del efectivo. Índice `(turno_id, medio)`.
- **`serie`** (facturación): `caja_id`, `emisor_id` (FK compuesta), `tipo` (`CHECK IN ('BOLETA','FACTURA','NOTA_CREDITO_BOLETA','NOTA_CREDITO_FACTURA')`), `serie` (`CHECK` de forma por tipo), `ultimo_numero integer` (≥ 0, ≤ 99999999), `activa`. Único `(empresa_id, emisor_id, tipo, serie)`; único parcial `(empresa_id, caja_id, tipo) WHERE activa`.
- **`comprobante`** (facturación): `sucursal_id`, `emisor_id`, `caja_id`, `serie_id`, `tipo`, `serie`, `numero integer`, `formato` (`CHECK IN ('DETALLADO','CONSUMO')`), `fecha_emision date`, `emitido_en`, `dia_operativo date`, `emisor jsonb` y `sucursal jsonb` (lo que eran), `cliente_tipo_documento null`, `cliente_numero null`, `cliente_nombre null`, `cliente_direccion null`, `moneda char(3) DEFAULT 'PEN'`, `tasa_igv numeric(5,2) null`, `subtotal`, `descuentos`, `op_gravadas`, `op_exoneradas`, `op_inafectas`, `op_gratuitas`, `igv`, `igv_gratuitas`, `icbper`, `total`, `monto_en_letras`, `orden_id null`, `mesas null`, `mozo_nombre null`, `numero_llamado null`, `estado` (`CHECK IN ('POR_ENVIAR','ENVIADO','ACEPTADO','RECHAZADO','ANULADO')`). Único `(empresa_id, serie_id, numero)`. Índices `(sucursal_id, estado)`, `(orden_id)`. `CHECK` de coherencia: `total = op_gravadas + op_exoneradas + op_inafectas + igv + icbper` (o `total = neto + icbper` con Nuevo RUS, `tasa_igv IS NULL`).
- **`comprobante_linea`** (facturación): `comprobante_id`, `posicion`, `item_id null`, `descripcion` (1 a 250), `cantidad integer`, `unidad` (`'NIU'` o `'ZZ'`), `precio_unitario`, `valor_unitario numeric(20,10)`, `bruto`, `descuento`, `neto`, `base`, `igv`, `bolsas`, `icbper`, `afectacion`, `gratuita boolean`, `valor_referencial null`. Único `(comprobante_id, posicion)`. `CHECK` `neto = bruto - descuento` y `base + igv = neto` (o `valor_referencial` en las gratuitas).
- **`emisor_tasa_igv`** (plataforma): `emisor_id`, `desde date`, `tasa numeric(5,2)` (`CHECK` de 0.01 a 30.00). Único `(empresa_id, emisor_id, desde)`.
- **`descuento`** (pedidos): `orden_id`, `item_id null`, `tipo` (`CHECK IN ('PORCENTAJE','MONTO')`), `valor`, `motivo`, `autorizado_por_id null`, `autorizacion_id null`, `quitado_en null`, `quitado_por_id null`, `huella_entrada bytea`. Únicos parciales `(empresa_id, item_id) WHERE quitado_en IS NULL AND item_id IS NOT NULL` y `(empresa_id, orden_id) WHERE quitado_en IS NULL AND item_id IS NULL`.
- **`cortesia`** (pedidos): `orden_id`, `item_id`, `cantidad integer`, `motivo`, `autorizado_por_id null`, `autorizacion_id null`, `quitada_en null`, `quitada_por_id null`, `huella_entrada bytea`. Único parcial `(empresa_id, item_id) WHERE quitada_en IS NULL`.
- **`contador_llamado`** (pedidos): `sucursal_id`, `dia_operativo date`, `ultimo integer`. Único `(empresa_id, sucursal_id, dia_operativo)`.
- **Cambios en tablas de 004** (pedidos): `orden.numero_llamado integer null` y `orden.dia_operativo_llamado date null` (los dos nulos o los dos con valor, solo en `MOSTRADOR`, `CHECK`; único parcial `(empresa_id, sucursal_id, dia_operativo_llamado, numero_llamado) WHERE numero_llamado IS NOT NULL` como red del contador), `orden.monto_cobrado numeric(10,2) NOT NULL DEFAULT 0`, `orden.cobros integer NOT NULL DEFAULT 0`, `orden.modo_cobro text null` (`CHECK IN ('ITEMS','IGUALES')`); `item.cantidad_facturada integer NOT NULL DEFAULT 0` (`CHECK` ≤ `cantidad - cantidad_anulada`).
- **Cambios en tablas de 002** (seguridad): `autorizacion.objetivo jsonb null`.
- **Cambios en tablas de 3b** (impresión): `trabajo_impresion.tipo` gana `COMPROBANTE`, `REPORTE_X`, `REPORTE_Z` y `GAVETA`; columnas `comprobante_id null` y `turno_id null`; únicos parciales `(empresa_id, comprobante_id) WHERE tipo = 'COMPROBANTE' AND reimpresion_de_id IS NULL` y `(empresa_id, turno_id) WHERE tipo = 'REPORTE_Z' AND reimpresion_de_id IS NULL`; `entregado_en` ya existe y sirve para el pulso de una sola vez (criterio 94).

**Entrega 6b** (a precisar): `envio_pse` (facturación: comprobante, intentos, último error, próximo intento, respuesta), columnas de resultado en `comprobante` (`aceptado_en`, `cdr`, `hash`, `qr`, `pdf_clave`, `xml_clave`, `motivo_rechazo`), `nota_credito_origen` (comprobante de origen, tipo y montos por línea), esquema `referencia` con `padron_ruc` (sin `empresa_id`, sin acceso de la API) y su función de búsqueda, y el esquema de pg-boss con su rol.

## Fuera de alcance

- Envío al PSE, estados después de `POR_ENVIAR`, notas de crédito, padrón de RUC, PDF y WhatsApp: entrega 6b.
- Reportes de ventas, de control, de comprobantes y exportación a Excel (RF-79 a RF-83): sección de reportes.
- Registro de las ventas hechas con el talonario de contingencia (pregunta 23).
- Propinas, ventas al crédito, otras monedas, integración con el POS del banco (fuentes).
- "Nota de venta" o venta sin comprobante: las fuentes no la prevén; todo cobro emite boleta o factura.
- Reabrir una orden cobrada o deshacer un cobro: solo con nota de crédito (6b).
- Descuentos y cortesías en la venta de mostrador (pregunta 14); descuentos después del primer cobro (pregunta 10).
- Abrir la gaveta a mano sin una operación (pregunta 16).
- Cobro desde la mesa por el cliente.

## Impacto en especificaciones anteriores

- **001 y 002, catálogo y guarda:** las pruebas de catálogo recorren las tablas nuevas solas; no cambia ninguna lista protegida. `pg_advisory_xact_lock` sigue permitido y no se usa (los bloqueos son de filas).
- **002, autorizaciones:** `autorizacionEntradaSchema` gana `objetivo` opcional (unión estricta por `tipo`), la respuesta lo devuelve y `autorizacion` gana la columna `objetivo`. `AutorizacionService.consumir` no cambia: la comparación con el objetivo la hacen las rutas de descuentos y cortesías, así las pruebas protegidas de 002 (incluida la sonda de `APLICAR_DESCUENTO` de `clave-supervisor.spec.ts`, que consume sin objetivo) siguen en verde. `SesionActual.autorizacionConsumida()` devuelve además el `objetivo`. La PWA: la ventana de clave muestra el objetivo.
- **002, suscripción:** se usan `exigirAperturaDeCaja` y `registrarComprobanteEmitido` tal como están.
- **003, carta:** nada; el cobro lee `afectacion_igv`, `aplica_icbper` y `precio_unitario` del ítem guardado.
- **004, pedidos:** columnas nuevas en `orden` e `item` y las tablas `descuento`, `cortesia` y `contador_llamado`; las anulaciones, los envíos y las uniones llaman al puerto `COBROS` cuando la orden tiene cobros (criterios 86 a 88), y anular una orden o unir con cobros responde 409 `CUENTA_EN_COBRO`; la pre-cuenta muestra descuentos, cortesías y lo pagado (criterios 44 y 89; `total` sigue siendo el de `totalOrden` cuando no hay descuentos ni cortesías, así `montos-orden.spec.ts` no cambia); el ticket de comanda y el KDS muestran el número de llamado; `estadoDeMesa` y `GET /salon` no cambian. Ninguna ruta nueva cuelga de `/ordenes` (criterio 98), así `salon-critica/permisos-salon.spec.ts` no cambia. Las pruebas protegidas de 004 no cambian; test-writer lo confirma en la fase B buscando en `salon-critica/` las que afirman la forma exacta de `precuentaRespuesta`, de `comandaKds` o el `CHECK` de `trabajo_impresion.tipo`.
- **004, impresión (3b):** tipos de trabajo nuevos, bloques `qr` y `gaveta` en el documento y el renderizador, la impresora por caja (la de la sucursal sigue siendo la de las pre-cuentas). `packages/contratos/test/impresion.spec.ts` (no protegida) afirma la lista exacta de `TIPOS_TRABAJO`: la ajusta quien implementa. El protocolo del puente no cambia de versión: el puente manda los bytes sin interpretarlos y `tipo` es informativo; la app 3c debe aceptar tipos desconocidos (nota para 3c).
- **004, PWA:** la navegación cambia (criterio 108); la cuenta de la mesa gana "Cobrar" y los descuentos y cortesías; el comandero gana el modo mostrador.
- **005:** nada; "Pedir la cuenta" sigue solo avisando.

## Notas para otras secciones

- **Sección de reportes:** ventas por día, turno, medio, mozo y sucursal salen de `comprobante`, `cobro` y `pago` (con `dia_operativo`); el control de descuentos y cortesías, de la auditoría (`aplicar_descuento`, `aplicar_cortesia` con autorizador); el consumo de la cuota, de `consumo_comprobantes`.
- **Sección de delivery:** cobrar una orden `DELIVERY` con el mismo `POST /cuentas/:ordenId/cobros` al despachar (B.5); `hayOrdenesAbiertas` debe contar sus estados pendientes para el bloqueo del Z.
- **Entrega 3c (app puente):** aceptar tipos de trabajo nuevos sin fallar; el pulso de gaveta viaja dentro de los bytes.
- **Sección 6 (inventario):** las cortesías ya descontaron stock al enviarse; nada que hacer al cobrar.

## Riesgos aceptados propuestos

Los decide el usuario con la aprobación; se revisan después del ataque.

- **Cálculos tributarios pendientes del contador.** Cortesías como operación gratuita, comprobante por consumo, boletas de más de S/ 700, tasa de IGV, Nuevo RUS sin IGV, redondeo del efectivo y monto del ICBPER (B.19 y preguntas 4 a 8). Si el contador dice otra cosa, cambia una función de `packages/dominio` y sus pruebas protegidas, no la estructura.
- **6a no sirve sola en producción.** Sus comprobantes quedan `POR_ENVIAR`; SUNAT tiene plazos de envío. 6a y 6b salen juntas a clientes reales.
- **El IGV de las partes no suma exactamente el de la cuenta entera.** Cada comprobante se redondea por su lado (criterio 18): puede diferir por céntimos; el total cobrado siempre cuadra.
- **Una cuenta con descuento por cuenta y una parte cobrada no admite cambios** (criterio 20): el prorrateo de lo ya cobrado cambiaría. La PWA lo explica; se cobra el resto y se abre la mesa otra vez.
- **Una mesa abierta después del último cierre queda sin turno** (criterio 33): se acepta; la cobra el turno siguiente.
- **El pulso de gaveta puede perderse** si el puente está desconectado más de 120 segundos (criterio 94): se prefiere a abrir la gaveta minutos después sin nadie delante.
- **El arqueo a ciegas se puede saltar mirando el X** (criterio 32): queda en la trazabilidad.

## Preguntas abiertas

Cada una con mi recomendación; los criterios ya están escritos con ella. Las 20 a 24 son de 6b y se pueden responder antes de empezarla.

1. **¿Dividimos la sección en 6a (caja, cobro y comprobante sin PSE) y 6b (facturación electrónica)?** **Recomiendo sí** ("Entregas"): 6a tiene casi toda la ruta crítica y se prueba sin un sistema externo; 6b depende del PSE, que aún no se elige. Las dos salen juntas a clientes reales.
2. **¿De quién es el turno y quién cobra en él?** Las fuentes dicen "abrir mi turno" y que el Cajero ve "su turno (X)". **Recomiendo:** un turno por caja a la vez y uno por persona en la sucursal; lo abre una persona (responsable) que cuadra esa gaveta; cobra en él su responsable, y un Supervisor o el Administrador pueden cobrar en cualquier turno abierto (para cubrir un descanso) y cerrarlo; otro Cajero abre su propia caja. Alternativa: un turno por caja compartido por todos los cajeros, con el cuadre de la gaveta a cargo de todos.
3. **¿El arqueo del Z es a ciegas?** **Recomiendo sí:** el cajero escribe lo que contó sin ver el esperado y recién después ve las diferencias y escribe sus motivos; evita "ajustar" el conteo. El X sigue mostrando el esperado a quien lo pida.
4. **"Redondeos" (RF-60) y el efectivo.** Ya casi no circulan monedas de 1 y 5 céntimos. Opciones: (a) cobrar y dar vuelto al céntimo; (b) redondear hacia abajo a la décima solo la parte en efectivo, a favor del cliente, visible en el ticket y en el X, sin cambiar el comprobante; (c) poner el redondeo dentro del comprobante. **Recomiendo (b)**, validándolo con el contador. Los demás redondeos son de cálculo: a 2 decimales, mitad hacia arriba (criterio 9).
5. **Monto del ICBPER.** Las fuentes no lo dan. **Recomiendo** una tabla por fecha en `packages/dominio` con S/ 0.50 por bolsa desde 2023 (lo vigente por ley), sin configuración por empresa; se cambia con una versión del sistema.
6. **Tasa de IGV del emisor.** **Recomiendo:** la configura el Administrador por emisor con su fecha "desde" (la que diga el contador: la general o la reducida para restaurantes), sin valor por defecto; sin tasa, no se cobra y la PWA lleva a configurarla. Alternativa: 18 % por defecto.
7. **Nuevo RUS.** **Recomiendo** boletas sin IGV: el total es el precio, sin desglose de base ni IGV, con el ICBPER igual. A validar con el contador.
8. **Cortesías en el comprobante** ("su tratamiento tributario lo define el contador"). **Recomiendo** que salgan como operación gratuita con su valor de carta como valor referencial, en el comprobante del primer cobro de la cuenta, y que no se puedan dar cortesías de bolsas (el ICBPER se cobra igual). Alternativa: dejarlas fuera del comprobante, solo en el registro interno.
9. **¿La clave del supervisor queda atada a lo que autoriza?** Hoy una autorización sirve para cualquier ítem u orden de la sucursal durante 2 minutos (riesgo aceptado en 004). **Recomiendo** que en descuentos y cortesías quede atada a la cuenta, al ítem y al porcentaje, monto o cantidad que vio el supervisor; si el cajero cambia algo, hay que pedirla otra vez.
10. **Límites de los descuentos.** **Recomiendo:** hasta 99.99 % o menos que el total (para no cobrar nada se usa la cortesía); uno vigente por ítem y uno por cuenta; se quitan sin clave; solo antes del primer cobro de la cuenta.
11. **La pre-cuenta con descuentos.** **Recomiendo** que muestre cada descuento y cortesía y el total con ellos, y que siga sin ICBPER con la nota "El ICBPER se suma al cobrar", como dice RF-32 hoy. Alternativa: sumar el ICBPER en la pre-cuenta y quitar la nota (cambia RF-32 y una prueba protegida de 004).
12. **División y cambios después de pagar una parte.** **Recomiendo:** primero por ítems y después partes iguales del resto (nunca al revés); en partes iguales, cada parte es el saldo entre las que faltan, redondeado hacia arriba al céntimo, y la última toma lo que queda; después de pagar una parte se puede seguir pidiendo y anular lo que no se cobró, siempre que lo cobrado siga cuadrando; lo cobrado solo se corrige con nota de crédito.
13. **Número de llamado del mostrador.** **Recomiendo** un correlativo por sucursal que empieza en 1 cada día operativo. Alternativa: de 1 a 99 y vuelta a empezar.
14. **¿Descuentos y cortesías en la venta de mostrador?** **Recomiendo no en 6a:** el mostrador es para ir rápido y la venta es una sola operación; si hace falta, se agrega después con la misma clave atada.
15. **Documento del cliente en la boleta.** Las fuentes dicen "nombre y DNI". **Recomiendo** aceptar DNI, carné de extranjería y pasaporte (turistas), además del RUC para quien quiera boleta con RUC; a validar con el contador.
16. **¿La gaveta se abre también fuera del cobro?** RF-56 solo habla del cobro en efectivo. **Recomiendo** abrirla también al abrir el turno con fondo y al registrar un ingreso o un egreso (hay que meter o sacar billetes), y no ofrecer un botón "Abrir gaveta" suelto.
17. **¿Egresos y diferencias del Z con clave?** Las fuentes y la matriz no la piden. **Recomiendo** sin clave, con motivo obligatorio y la Z auditada; si se quiere más control, una clave para egresos sobre un monto, más adelante.
18. **¿Se puede elegir el primer correlativo de una serie?** **Recomiendo sí**, solo al crearla, para el restaurante que ya emitía `B001` con otro sistema; después no se toca.
19. **Primeros pasos del restaurante.** **Recomiendo** que la PWA guíe al Administrador la primera vez que alguien quiere abrir caja sin cajas, series o tasa configuradas ("Para cobrar falta: crear una caja, sus series y la tasa de IGV").
20. **(6b) ¿Qué PSE?** Está pendiente en el diseño. **Recomiendo** que 6b entregue el conector, el simulador y todo lo que los usa, y que el adaptador del PSE real sea una tarea propia apenas se elija; sin él no se sale a producción.
21. **(6b) ¿El ticket espera la respuesta del PSE?** **Recomiendo** imprimir al cobrar sin esperar, con el QR de los datos ya conocidos, si el contador confirma que basta para la representación impresa; si exige el valor resumen que da el PSE, imprimir cuando llegue y avisar si tarda.
22. **(6b) Números rechazados y cuota.** **Recomiendo** que un comprobante rechazado conserve su número (no se reutiliza, para no tener dos documentos con el mismo número en nuestra base) y que las notas de crédito cuenten en la cuota del plan como cualquier comprobante. A validar con el contador y con el PSE.
23. **Ventas con el talonario de contingencia.** El diseño dice que el cajero las registra al volver la conexión. **Recomiendo** dejarlo para una entrega propia después de 6b, porque depende de cómo el PSE informa la contingencia.
24. **(6b) RUC no activo o no habido.** **Recomiendo** avisar y permitir emitir igual con la confirmación del cajero (el cliente puede estar regularizándose); alternativa: impedir la factura.

## Decisiones del especificador

No son reglas de negocio nuevas, sino cómo se concretan las de las fuentes. Pendientes de la aprobación del usuario junto con la especificación.

- **Rutas en `/cuentas`, `/turnos`, `/cajas`, `/ventas-mostrador` y `/comprobantes`**, nunca bajo `/ordenes`: la prueba protegida de 004 que clasifica las rutas de `/ordenes` no cambia, y "cuenta" es la palabra del negocio.
- **Tres módulos dueños:** caja (cajas, turnos, movimientos, cobros, pagos), facturación (series, comprobantes) y pedidos (descuentos, cortesías, número de llamado y lo facturado de cada ítem). Ninguno lee las tablas de otro.
- **El IGV de cada línea es la diferencia** entre su neto y su base redondeada: así la suma de las líneas es siempre lo que se cobra (los precios incluyen IGV).
- **El descuento por cuenta se prorratea entre las líneas** (método del mayor resto) para que la base de cada afectación sea la correcta.
- **Las partes se calculan sobre lo que falta**, no sobre la cuenta original: una cuenta que cambia entre partes se sigue cobrando sin descuadres, y `cambioDeCuentaPermitido` decide en un solo lugar si un cambio deja de cuadrar.
- **El cliente manda la versión y el total que vio** y el servidor recalcula: si no coinciden, 409 `CUENTA_CAMBIO`. Así el mozo que agrega algo nunca deja un cobro por un monto viejo.
- **La numeración es una fila por serie** que se incrementa en la transacción del cobro (`UPDATE … RETURNING`): sin Redis ni secuencias de PostgreSQL (que dejan huecos al revertir); dos cajas no compiten porque tienen series distintas.
- **El número de llamado es otra fila por sucursal y día**, con la misma técnica.
- **Ingresos y egresos manuales son en efectivo**: son los movimientos de la gaveta; las devoluciones de 6b pueden ser en otro medio.
- **Un descuento o una cortesía invalidan la pre-cuenta** como una anulación: lo impreso ya no es lo que se cobrará.
- **Quitar un descuento o una cortesía no pide clave** (sube el monto), pero se audita.
- **El pulso de gaveta va dentro del ticket** y solo en la primera entrega a tiempo; un trabajo `GAVETA` sin papel para la apertura y los movimientos.
- **Una caja puede tener su impresora**; sin ella, usa la de caja de la sucursal (la de las pre-cuentas).
- **La fecha de emisión es la fecha de Lima del cobro**, distinta del día operativo, que se guarda aparte para los reportes.

## Cambios propuestos a los documentos compartidos

Texto propuesto según las recomendaciones; se ajusta con las respuestas del usuario. El orquestador los lleva a los documentos compartidos en el paso 8.

**Requerimientos**

- **RF-33** (preguntas 9 y 10): "…con clave y motivo; la clave queda atada a lo autorizado; hasta 99.99 % o menos que el total, uno por ítem y uno por cuenta, antes del primer cobro".
- **RF-34** (pregunta 13): "…número de llamado correlativo por sucursal, desde 1 cada día operativo".
- **RF-50** (pregunta 2): "Abrir un turno de caja con fondo inicial: un turno por caja y por persona; varias cajas por sucursal".
- **RF-51** (pregunta 4): agregar "Con efectivo, el total se redondea hacia abajo a la décima a favor del cliente".
- **RF-52** (pregunta 12): "…primero por ítems y después en partes iguales del resto; cada parte igual es el saldo entre las partes que faltan, redondeado al céntimo hacia arriba".
- **RF-55** (pregunta 3): "…conteo físico a ciegas por medio de pago…".
- **RF-56** (pregunta 16): "Abrir la gaveta al cobrar en efectivo, al abrir el turno con fondo y al registrar ingresos o egresos".
- **RF-59** (pregunta 15): "Exigir nombre y documento (DNI, carné de extranjería o pasaporte) en las boletas de más de S/ 700".
- **RF-60** (preguntas 4 a 7): "…IGV por línea como diferencia entre el neto y la base redondeada a 2 decimales; el descuento por cuenta se reparte entre las líneas; ICBPER por bolsa según la tabla vigente; en el Nuevo RUS, sin IGV".
- **RF-61** (pregunta 18): "…una serie no se repite entre las cajas de un mismo emisor; al crearla se puede indicar su primer número".
- **HU-25** (pregunta 2): agregar "Un Supervisor puede cobrar en mi turno y cerrarlo".
- **HU-28** (pregunta 12): agregar "Después de pagar una parte se puede seguir pidiendo; lo ya cobrado solo se corrige con nota de crédito".

**Diseño**

- **"Alcance"** (pregunta 1): la caja y la facturación se entregan en dos partes: 6a caja, cobro y comprobante; 6b facturación electrónica con el PSE.
- **"Reglas de negocio · Ventas y precios"** (preguntas 8 y 10): "Las cortesías salen como operación gratuita con su valor de carta; no se dan cortesías de bolsas"; "Los descuentos llegan hasta 99.99 %".
- **"Reglas de negocio · Comprobantes y caja"** (preguntas 2, 3, 4 y 13): el turno de una persona en una caja; arqueo a ciegas; redondeo del efectivo; la fecha de emisión es la del cobro y el día operativo se guarda aparte.
- **"Modelo de datos"**: Caja con su impresora opcional; Descuento y Cortesía en Pedidos; Movimiento de caja en efectivo.
- **"Estados" (Orden)**: "Una orden con partes cobradas sigue abierta; se cierra con la última parte".
- **"Roles y permisos"** (pregunta 2): "Cobrar en el turno de otra persona: Supervisor y Administrador".
- **"Pendientes de validar"**: agregar al contador el redondeo del efectivo, el Nuevo RUS sin IGV, los documentos de la boleta y el monto del ICBPER.
