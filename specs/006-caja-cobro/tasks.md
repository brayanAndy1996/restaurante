# 006 · Tareas

Cada tarea indica su rol y los criterios de `spec.md` que cubre. Aprobado por el usuario el 2026-11-04, con la ruta crítica P1 a P9 confirmada por el orquestador.

**Orden de ejecución.** Primero **6a · Caja, cobro y comprobante** completa (fases A, B, C y D, y su commit de cierre en T27); después **6b · Facturación electrónica** (sus fases se precisan antes de empezar, con el PSE elegido). La fase C se agrupa por historia: cada grupo termina con un commit propio (lo hace el documentador), en el orden indicado. Cada grupo cierra con la suite en verde, salvo las pruebas protegidas de 006 que se ponen en verde en un grupo posterior (cada tarea del tester dice cuáles pueden seguir en rojo). Las pruebas protegidas de 001 a 005 nunca quedan en rojo en un commit.

**Qué lleva pruebas protegidas.** Lo clasificado como ruta crítica en `spec.md`: en 6a, P1 montos (8 a 22), P2 cobro (47 a 68, 79 a 89, 92 a 94), P3 turno y caja (24 a 35), P4 comprobantes (4, 5, 69 a 78), P5 permisos y auditoría (38 a 46, 98 a 102) y P6 aislamiento (103 a 107); en 6b, P7 a P9. Las escribe test-writer en la fase B, antes de implementar, y nadie más las toca. Lo demás lleva las pruebas que decida quien implementa.

**Nombres.** `T` son tareas de implementación, revisión y cierre; `P1` a `P9`, las pruebas protegidas (con el número de `spec.md`); `R1`, la confirmación en rojo del tester.

**Totales de 6a.** 119 criterios (1 a 119) y 34 tareas (T1 a T27, P1 a P6 y R1).

---

## Entrega 6a · Caja, cobro y comprobante

### Fase A · Armado mínimo y firmas públicas (backend)

Deja lo necesario para que las pruebas protegidas compilen y corran. No implementa reglas, permisos ni tablas.

- [x] T1 · backend · Línea de base: medir el presupuesto de la PWA (`pnpm --filter @restaurante/app build && pnpm --filter @restaurante/app presupuesto`) y anotar el margen real en `plan.md` ("PWA"). (criterio 119)
- [x] T2 · backend · `packages/contratos`: `src/caja.ts` y `src/comprobantes.ts` con los esquemas de "Contrato" (entradas estrictas; `parte` como unión por `tipo`; `cliente` con los cuatro documentos; pagos con `operacion` obligatoria fuera del efectivo; `conteo` con los cinco medios); `objetivo` opcional en `autorizacionEntradaSchema` y en la respuesta; `TIPOS_TRABAJO` con los cuatro tipos nuevos y los bloques `qr` y `gaveta` en `documentoTicket` (ajustar la prueba no protegida `packages/contratos/test/impresion.spec.ts`); campos opcionales de la pre-cuenta y de `comandaKds`; códigos nuevos y `turnoId`, `version` y `ordenes` en `errorRespuestaSchema`. Pruebas unitarias de los esquemas. (criterios 1, 3, 24, 28, 31, 36, 38, 43, 47, 50, 51, 79; validación de datos)
- [x] T3 · backend · `packages/dominio/src/caja/`: `catalogos.ts` implementado (medios, tipos, formatos, documentos, modos, estados, límites, `MONTOS_ICBPER`); firmas de `desglosar`, `tasaIgvVigente`, `montoIcbperVigente`, `calcularCuenta`, `validarDescuento`, `repartirPorMayorResto`, `calcularParte`, `cambioDeCuentaPermitido`, `validarPagos`, `redondeoEfectivo`, `esperadoDelTurno`, `diferenciasDelArqueo` y `montoEnLetras` que lanzan `Error('No implementado')`; `tiposDeComprobantePermitidos` en `regimen.ts`; la entrada `@restaurante/dominio/caja`. (criterios 8 a 23, firmas)
- [x] T4 · backend · Firmas que lanzan `Error('No implementado')`, en las rutas de archivo de `plan.md`: `CajaModule` y `FacturacionModule` registrados en `AppModule` con todos los controladores y rutas de la tabla de endpoints **sin** `@Permiso` ni `@RequiereModulo` (se agregan en la fase C); `DescuentosController` y `CortesiasController` en pedidos, igual; `CuentasDePedidos`, el puerto `COBROS`, `EmisionService`, `facturadoDeOrden`, `EmisoresService.tasasIgv` y `datosParaComprobante`, `ImpresionPuerto.impresoraDeLaCaja`; las rutas de `/emisores/:id/tasas-igv`. Sin migraciones.

### Fase B · Pruebas primero (ruta crítica: P1 a P6)

Las escribe test-writer a partir de `spec.md` y de los contratos públicos, sin mirar la implementación. Todos los archivos nuevos llevan al inicio `// spec: 006-caja-cobro (pruebas protegidas)` y viven en `apps/api/test/caja-critica/` (salvo las de `packages/dominio`, en `packages/dominio/test/caja/`). Usan la app real con `RelojManual`, `PublicadorEnMemoria` (o el tiempo real habilitado donde se prueban salas), `InventarioDePrueba`, el simulador del puente y el emulador de impresora de 3b donde se mira el papel o la gaveta, la carta de ejemplo de 004 más la Bolsa y la Mandarina creadas por las rutas de 003, empresas por `POST /plataforma/empresas` y usuarios por `POST /usuarios`. Cajas, series y tasas se configuran por sus rutas. Toda escritura por SQL fija antes un actor. Los nombres son sugeridos.

- [x] P1 · test-writer · Montos, en `packages/dominio/test/caja/`:
  - `desglose.spec.ts` y `vigencias.spec.ts`: cada ejemplo de los criterios 9 y 10, entradas inválidas del 8, bordes de vigencia (el día anterior y el mismo día del `desde`).
  - `cuenta.spec.ts`: la cuenta C exacta (11), con descuento por ítem (12), por cuenta en monto y porcentaje con su prorrateo (13; también empates de restos y una línea en cero), `validarDescuento` (14), cortesías (15; la línea toda en cortesía sin parte del descuento; `RangeError` con ICBPER), Nuevo RUS (16). En cada caso: Σ netos + ICBPER = total, base + IGV = neto por línea, Σ descuentos prorrateados = monto.
  - `partes.spec.ts`: por ítems (17; 25.95 y 25.94, sin descuento 28.00; consumo agrupado por afectación con bolsas detalladas), iguales (18; 100.00 en 3, cuenta C en 2 con todos sus montos, la última que toma lo que falta, redondeo hacia arriba), reglas y errores (19), `cambioDeCuentaPermitido` con cada ejemplo del 20; propiedad: para cuentas generadas al azar y divisiones al azar, la suma de las partes es el total y ninguna parte queda negativa.
  - `pagos-turno.spec.ts`: `validarPagos` y `redondeoEfectivo` con cada ejemplo del 21; `esperadoDelTurno` y `diferenciasDelArqueo` del 22.
  (criterios 8 a 22)
- [x] P2 · test-writer · Cobro:
  - `cobro.spec.ts`: forma de la entrada y de la respuesta (47); turno abierto y propio, cerrado, ajeno, de S2 o de B (48); recálculo en el servidor con precios cambiados en la carta después del envío (se cobra lo guardado) y `version` o `total` distintos (49); pagos con cada medio, `operacion`, un solo efectivo, vuelto, redondeo exacto, cuenta de cero con `pagos: []` (50); reglas del comprobante: factura con RUC y dirección, boleta de 700.00 y de 700.01, Nuevo RUS, sin tasa, sin serie (51); cobro total que cierra la orden y deja las mesas `LIBRE` en `GET /salon` (52); cobro parcial que no invalida la pre-cuenta (53); orden no cobrable (61); topes (62); eventos solo después de confirmar (63).
  - `cobro-idempotencia.spec.ts`: misma IK (54), mismo `id` con otra IK y desde otra sesión, también con la orden ya cerrada y el turno cerrado (55), diez concurrentes (56): un cobro, un número, un trabajo, un pulso.
  - `cobro-concurrencia.spec.ts`: dos cajeros a la vez (57), envío y cobro a la vez y anulación y cobro a la vez (58), cobro y cierre del mismo turno a la vez (59).
  - `division.spec.ts`: por ítems con el ejemplo del 64, iguales con el del 65, orden de los modos (66), cortesías en el primer comprobante y bolsas enteras (67), mesa ocupada hasta la última parte y partes en cajas y tipos distintos (68).
  - `mostrador.spec.ts`: venta completa con comandas por estación y número de llamado en la comanda, el KDS y el comprobante (79 a 82); todo o nada con una línea agotada, un pago que no cuadra y un turno cerrado (sin orden, comanda, comprobante, número de llamado, trabajo ni llamada confirmada al inventario) (80); números de llamado consecutivos con ventas concurrentes y reinicio con la hora de corte (81); réplicas (83); precio cambiado (84).
  - `cambios-despues-de-cobrar.spec.ts`: anulación, envío, unión y anulación de la orden con cobros, con cada ejemplo de los criterios 20 y 86 a 88; la pre-cuenta con "Pagado" y "Por pagar" (89).
  - `gaveta.spec.ts` (con el emulador): pulso antes del texto con efectivo y sin él con tarjeta (92); trabajo `GAVETA` en la apertura con fondo y en los movimientos (93); sin pulso en la reimpresión, en la réplica ni con el trabajo entregado a los 121 segundos (94).
  (criterios 47 a 68, 79 a 89, 92 a 94)
- [x] P3 · test-writer · Turno y caja, en `turno.spec.ts` y `cierre.spec.ts`: apertura y réplica por `id` (24); suspensión y gracia, y el turno abierto que sigue cobrando y cierra suspendido (25); uno por caja y uno por persona, también simultáneos (26); consultas (27); movimientos con sus reglas (28); X con montos exactos de un turno con cobros en los cinco medios, redondeos, vueltos, ingresos y egresos (29); cierre con esperado, conteo, diferencias y motivo, 422 con las diferencias sin el esperado (31, 32); bloqueo del último turno con una mesa abierta, el que no es el último, y dos cierres simultáneos (33); la Z definitiva y su réplica (34); quién cierra (35). (criterios 24 a 35)
- [x] P4 · test-writer · Comprobantes, en `series.spec.ts` y `comprobante.spec.ts`: series únicas por emisor entre sucursales y cajas, también simultáneas, y la misma serie en B (4); reactivar y cambio de emisor (5); lo que guarda el comprobante y que no cambia al cambiar la carta, el emisor, la sucursal o la tasa (69); numeración y texto (70); sin saltos con un cobro que falla después de numerar (71; con una falla inyectada en el puerto de impresión o en el inventario); cien cobros concurrentes en dos cajas y en la misma caja (72); réplicas y rechazos que no numeran (73); fecha de emisión y día operativo de madrugada (74); `POR_ENVIAR` (75); cuota del plan, también revertida (76); consultas con alcance (77); `UPDATE` de montos y `DELETE` rechazados por la base (78). (criterios 4, 5, 69 a 78)
- [x] P5 · test-writer · Permisos y auditoría:
  - `descuentos-cortesias.spec.ts`: descuento por ítem y por cuenta, cortesía, quitar (38, 39, 42, 43); clave atada: sin clave, de otra acción, de otro objetivo (otro valor, otro ítem, otra orden), sin objetivo, vencida, y la reversión que la devuelve si la acción falla (40); validación (41); efectos en la pre-cuenta, la versión y los eventos (44); con cobros y con la orden no abierta (45); auditoría con autorizador y consumo de 002 (46).
  - `permisos-caja.spec.ts`: clasificación de las rutas recorriendo las registradas en Nest (98; incluye que ninguna ruta nueva cuelgue de `/ordenes`, `/salon` ni `/cocina`); rechazos por rol con contraseña y con PIN sin cambios, auditoría ni eventos, rol de la sucursal activa, sin sucursal y sin módulo (99); alcance del Cajero (100); auditoría (101); trazabilidad, incluido el cobro de un Supervisor en el turno de un Cajero y la sesión de soporte (102).
  - Antes de escribir, buscar en `apps/api/test/acceso/`, `salon-critica/`, `impresion-critica/` y `llamados-critica/` pruebas protegidas que afirmen la forma exacta de `autorizacionRespuesta`, `precuentaRespuesta`, `comandaKds`, la lista de tipos de trabajo o la de rutas; si alguna cambia con esta sección, avisar al orquestador en lugar de tocarla.
  (criterios 38 a 46, 98 a 102)
- [x] P6 · test-writer · Aislamiento, en `rls-caja.spec.ts`, `referencias-caja.spec.ts` y `aislamiento-caja.spec.ts`: lectura, actualización, borrado e inserción entre empresas en cada tabla del criterio 104 con actor de A y el mensaje de la política; cada referencia cruzada del 105; ids de B en rutas y cuerpos, ids de cliente repetidos entre empresas y la misma serie en A y B (106); 100 cobros concurrentes alternando A y B con pool de 2 y eventos solo en su empresa (107). (criterios 103 a 107)
- [x] R1 · tester · Confirmar que P1 a P6 fallan por la razón esperada ("No implementado", tablas inexistentes, rutas sin `@Permiso` que no responden 403) y no por importación, sintaxis, configuración o tiempo de espera; y que las pruebas de 001 a 005 siguen en verde. La fase B se commitea entera.

### Fase C · Implementación por historia

Las tareas de backend y frontend no modifican, borran ni debilitan las pruebas de la fase B. El frontend usa la skill `impeccable` y sigue `DESIGN.md` y `PRODUCT.md`.

#### C1 · RF-60, RF-61: montos, cajas, series y tasa

Commit propio.

- [ ] T5 · backend · `packages/dominio/src/caja/` completo hasta dejar en verde P1 (y `montoEnLetras` con pruebas del desarrollador). (criterios 8 a 23)
- [ ] T6 · backend · Migraciones 1 a 3 de `plan.md`; cajas, series y tasa de IGV con sus rutas, `@Permiso('ADMINISTRAR')`, auditoría y la impresora de la caja; `SeriesService` y `EmisionService` sin el ticket (numeración, filas, cuota). Deja en verde la parte de series de P4 (4, 5) y la RLS de esas tablas de P6. (criterios 1 a 7, 4, 5, 103 a 105 en esas tablas)
- [ ] T7 · frontend · Ajustes › Cajas (lista, formulario, series con "Primer número" al crear) y la tasa de IGV en Emisores; la guía de primeros pasos de la pregunta 19. Pruebas de componente. (criterio 117)
- [ ] T8 · tester · Suite completa, lint, tipos, build y presupuesto. P1 en verde. Pueden seguir en rojo: P2, P3, P5, el resto de P4 y P6.

#### C2 · HU-25, HU-30, RF-50, RF-53 a RF-55: el turno

Commit propio.

- [ ] T9 · backend · Migración 2 (si no entró en T6) y lo que falte de `caja`; `TurnosService` según "Turno y cierre" de `plan.md`: apertura con `exigirAperturaDeCaja`, réplica por `id`, índices únicos, movimientos, X con `reportes-caja.ts`, cierre con los bloqueos, el arqueo a ciegas, `turno_conteo`, `cerrar_turno` en la auditoría y `turno.cambio`; rutas con `OPERAR_CAJA` y `CAJA`; agregar `modulos/caja/turnos.service.ts` a `PERMITIDOS` en `apps/api/test/suscripciones/suspension.spec.ts` (no protegida). Sin impresión todavía. Deja en verde P3 salvo lo que depende de cobros (el X con cobros y el cobro contra el cierre). (criterios 24 a 35, 97 en `turno.cambio`)
- [ ] T10 · frontend · `/caja` sin turno y con turno: cajas, "Abrir caja" con fondo, "Movimientos", "Reporte X" en pantalla y "Cerrar caja" con el conteo a ciegas, los motivos y `CIERRE_BLOQUEADO` con la lista; la navegación del criterio 108. Bajo demanda. Pruebas de componente. (criterios 108 a 110, 116)
- [ ] T11 · tester · Suite completa, lint, tipos, build y presupuesto. Pueden seguir en rojo: P2, P5, el resto de P3, P4 y P6.

#### C3 · RF-33, HU-03: descuentos y cortesías con clave atada

Commit propio.

- [ ] T12 · backend · Migraciones 5 (descuentos, cortesías, columnas de pedidos) y 6 (`autorizacion.objetivo`); `POST /autorizaciones` con `objetivo`; `SesionActual.autorizacionConsumida()` con el objetivo y `exigirObjetivo`; `DescuentosService` y `CortesiasService` según "Descuentos y cortesías con clave atada" de `plan.md`, con sus rutas, la auditoría, la invalidación de la pre-cuenta y `version`; la pre-cuenta con descuentos y cortesías (44); `GET /cuentas/:ordenId` (36) y `GET /cuentas` (37) con `CuentasDePedidos.cuentaParaCobrar`. Deja en verde `descuentos-cortesias.spec.ts`. (criterios 36 a 46)
- [ ] T13 · frontend · En la cuenta de la mesa y en la caja: "Descuento" y "Cortesía" por ítem y para la cuenta, la ventana de clave con el objetivo a la vista, quitar con confirmación, y el desglose con `@restaurante/dominio/caja` bajo demanda. Pruebas de componente: el objetivo que se manda es el que se muestra; un 403 `AUTORIZACION_INVALIDA` vuelve a pedir la clave sin perder lo escrito. (criterio 111 en descuentos)
- [ ] T14 · tester · Suite completa, lint, tipos, build y presupuesto. Pueden seguir en rojo: P2, el resto de P3, P4, P5 y P6.

#### C4 · HU-26, HU-28, RF-51, RF-52, RF-57, RF-59, RF-65: cobro, división y comprobante

Commit propio. Es el corazón de P2 y P4.

- [ ] T15 · backend · Migración 4 (cobros y pagos); `CobrosService` según "Flujo del cobro" de `plan.md` (orden de bloqueos, réplica por `id`, recálculo, parámetros, emisión, cobro, `registrarCobro`, eventos); `FacturadoService.facturadoDeOrden` (lee `comprobante.detalle_parte`, en facturación); el puerto `COBROS` registrado por caja y usado en envíos, anulaciones y uniones de pedidos, y los 409 `CUENTA_EN_COBRO` de unir y anular (86 a 88); la pre-cuenta con lo pagado (89); `GET /comprobantes` y `GET /comprobantes/:id` con su alcance; rutas con `COBRAR` y `CAJA` o `FACTURACION`. Deja en verde P2 salvo mostrador y gaveta, P4, el resto de P3 y P6. (criterios 47 a 78, 86 a 89, 97 a 107)
- [ ] T16 · frontend · Cobro: desde "Por cobrar" y desde la cuenta de la mesa; comprobante y cliente; pagos con vuelto y redondeo; dividir por ítems y en partes iguales con las partes recordadas en el equipo; resultado, `CUENTA_CAMBIO` sin perder los pagos y "Reintentar" con el mismo `id`; aviso de ítems sin enviar en este equipo (60). Pruebas de componente: el `id` del cobro se conserva hasta una respuesta final; los montos de la pantalla son los de `packages/dominio`. (criterios 60, 111 a 114)
- [ ] T17 · tester · Suite completa, lint, tipos, build y presupuesto. Pueden seguir en rojo: `mostrador.spec.ts` y `gaveta.spec.ts` de P2.

#### C5 · HU-18, RF-34: venta de mostrador

Commit propio.

- [ ] T18 · backend · `contador_llamado` y `CuentasDePedidos.abrirYEnviarMostrador` (orden `MOSTRADOR`, número de llamado, el envío de 004 con el número en las comandas y en `comandaKds`); `MostradorService` y `POST /ventas-mostrador` según "Venta de mostrador" de `plan.md`. Deja en verde `mostrador.spec.ts`. (criterios 79 a 85)
- [ ] T19 · frontend · Mostrador: el comandero en modo mostrador, el cobro en la misma pantalla, "Cobrar y enviar" y "Llamado 23"; el KDS con "Llamado 23". Pruebas de componente. (criterio 115)
- [ ] T20 · tester · Suite completa, lint, tipos, build y presupuesto. Puede seguir en rojo: `gaveta.spec.ts`.

#### C6 · RF-56, RF-64 (ticket): impresión y gaveta

Commit propio.

- [ ] T21 · backend · Migración 7; plantillas `comprobante.ts`, `reporte-caja.ts` y `gaveta.ts`; bloques `qr` y `gaveta` en el renderizador y en el emulador; la regla del pulso en la entrega; `impresoraDeLaCaja`; los trabajos de comprobante, X, Z y gaveta desde cobros, mostrador, apertura, movimientos y cierre; `POST /comprobantes/:id/impresiones` y `POST /turnos/:id/reporte-x/impresiones`. Pruebas no protegidas con el emulador: el contenido del ticket (91) en 58 y 80 mm y con `SIN_TILDES`, el X y la Z (95), sin impresora (96). Deja en verde `gaveta.spec.ts`. (criterios 90 a 96)
- [ ] T22 · frontend · "Imprimir" y "Imprimir otra vez" del comprobante y del X; "Sin impresora de caja" donde corresponde. (criterios 96, 110, 114 en la impresión)
- [ ] T23 · frontend · E2E de 6a con Playwright según el criterio 118 (contextos separados de Cajero, Mozo, Supervisor y Cocina/Barra; celular y tablet; emulador de impresora). (criterio 118)
- [ ] T24 · tester · Suite completa, lint, tipos, build, presupuesto y E2E; P1 a P6 completas en verde.

### Fase D · Ataque, revisión, verificación y cierre (6a)

- [ ] T25 · adversarial · Ataque con `spec.md`, `plan.md` y el código, sin las notas de quien implementó. Áreas sugeridas:
  - **Montos:** céntimos que se pierden o sobran en prorrateos, partes iguales con bolsas y afectaciones mixtas, partes por ítems con descuento, Nuevo RUS, cortesías; totales que no cuadran con Σ líneas; montos en el límite de `NUMERIC(10,2)`; cuentas que cambian entre partes.
  - **Cobro:** cobrar dos veces lo mismo (réplicas con cuerpos distintos, ids nuevos, dos cajas, dos pestañas), cobrar con un total o una versión viejos, vuelto con tarjeta, redondeo inventado, pagos que no cuadran por un céntimo, cobrar en un turno ajeno o cerrado, cobrar una orden unida o de otra sucursal, cobrar y enviar a la vez, cerrar una orden con ítems sin cobrar.
  - **Caja:** cerrar el último turno con mesas abiertas (concurrencia, dos turnos), dos turnos en una caja o de una persona, abrir suspendido, egresos y movimientos en un turno cerrado, un esperado que no es el de la base, ver el esperado de otro turno siendo Cajero.
  - **Comprobantes:** saltos y duplicados en la numeración con reversiones provocadas, réplicas y concurrencia; series de otro emisor o de otra empresa; factura sin RUC, boleta de más de S/ 700 sin documento, factura en Nuevo RUS; cambiar montos de un comprobante.
  - **Permisos:** usar una autorización de descuento para otro monto, ítem u orden; descuentos sin clave como Mozo o Cajero; quitar y volver a aplicar para saltarse la clave; auditoría que falte o mienta.
  - **Aislamiento:** ids y series de B, eventos que crucen salas.
  - **Gaveta e impresión:** abrir la gaveta dos veces, con un texto que imite el bloque, con una reimpresión o con un trabajo tardío.
  Cada falla vuelve como prueba nueva (test-writer, con las reglas de la fase B) y a la fase C. (criterios 4, 5, 8 a 22, 24 a 35, 38 a 107)
- [ ] T26 · revisor · Comparar el cambio con `spec.md`, `plan.md` y `CLAUDE.md`: módulos dueños de sus tablas (caja no lee `orden`, `item`, `serie` ni `comprobante`; facturación no lee `cobro`; pedidos no lee nada de caja y usa el puerto `COBROS`); montos solo con `packages/dominio` y `NUMERIC`; orden fijo de bloqueos; efectos y eventos con `alConfirmar`; reloj de la API en todo cálculo de fecha (nunca `now()` de la base para la fecha de emisión ni el día operativo); tablas con `sqlTablaDeEmpresaTrazable` y `llaveDeEquipo: true`; privilegios de `comprobante` por columna; ninguna tarea de la fase C sobre los archivos de la fase B (el orquestador lo verifica además con `git diff`); presupuesto de la PWA (si no se cumple, propone el ajuste con su motivo).
- [ ] T27 · tester y documentador · Tester: suite completa, lint, tipos, build, presupuesto y E2E; prueba de carga de 50 cobros concurrentes en una sucursal (plan, "Riesgos"); `pnpm db:migrar`, `pnpm db:revertir` de las siete migraciones y otra vez `pnpm db:migrar`, con el esquema idéntico; `db:preparar` dos veces sin errores. Documentador: commit de cierre de 6a y documentación (README: módulos caja y facturación, cómo configurar cajas, series y tasa, el orden de bloqueos, que 6a no se usa con clientes reales sin 6b); estado de `spec.md` a "6a terminada (fecha); 6b pendiente". El orquestador lleva a los documentos compartidos los "Cambios propuestos" que tocan a 6a.

### Solo ruta crítica (6a)

- [ ] Pruebas escritas por test-writer y confirmadas en rojo (P1 a P6, R1)
- [ ] Pruebas en verde tras la implementación (T8, T11, T14, T17, T20, T24)
- [ ] Ataque adversarial sin fallas abiertas (T25)
- [ ] El orquestador verifica con `git diff` que la fase C no tocó los archivos de la fase B

---

## Entrega 6b · Facturación electrónica (a precisar antes de empezarla)

Antes de la fase A de 6b, el especificador revisa los criterios 120 a 152 con el PSE elegido (pregunta 20), las respuestas a las preguntas 21, 22 y 24 y lo que dejó 6a, y el orquestador pide la aprobación del usuario de esa revisión.

### Fase A · Armado

- [ ] T28 · backend · Contratos de 6b; firmas de `ConectorPse`, `SimuladorPse`, envíos, notas de crédito y padrón que lanzan `Error('No implementado')`; `worker.ts` y `nucleo/colas/` con pg-boss y el rol `restaurante_colas` en `db:preparar` y en el arranque (comprobación como la de `restaurante_tiempo_real`). (criterios 120, 122)

### Fase B · Pruebas primero (P7 a P9)

- [ ] P7 · test-writer · Envío al PSE con el simulador: fuera de la transacción, barrido, estados, sin duplicados con errores de transporte y dos workers, reintentos con el reloj, rechazados, alertas, resultado guardado una vez. (criterios 121 a 129)
- [ ] P8 · test-writer · Notas de crédito: clave atada, serie propia sin saltos ni duplicados, montos que no pasan del original (también concurrentes), devolución como egreso en el esperado del Z, estado del original, auditoría, cuota. (criterios 134 a 143)
- [ ] P9 · test-writer · Aislamiento del worker, del padrón y de los archivos. (criterios 148 a 150)
- [ ] R2 · tester · Confirmar P7 a P9 en rojo por la razón esperada y 001 a 006a en verde.

### Fase C · Implementación

- [ ] T29 · backend · Envíos con reintentos, estados, alertas y panel. (criterios 120 a 129)
- [ ] T30 · backend · Padrón y `GET /padron/ruc/:ruc`. (criterios 130 a 133)
- [ ] T31 · backend · Notas de crédito y devolución como egreso. (criterios 134 a 144)
- [ ] T32 · backend · PDF, enlace público y ticket definitivo. (criterios 145 a 147)
- [ ] T33 · frontend · Panel de comprobantes, nota de crédito, autocompletar del RUC y compartir por WhatsApp. (criterios 131, 132, 146, 151, 152)
- [ ] T34 · backend · Adaptador del PSE elegido (cuando se elija; pregunta 20), con pruebas contra su ambiente de pruebas.
- [ ] T35 · tester · Suite completa, lint, tipos, build, presupuesto y E2E; P7 a P9 en verde.

### Fase D · Ataque, revisión y cierre (6b)

- [ ] T36 · adversarial · Duplicados en el PSE, reintentos que emiten dos veces, notas de crédito que acreditan de más, el worker que cruza empresas, el padrón como canal lateral, enlaces de PDF que se pueden adivinar.
- [ ] T37 · revisor · Comparar con `spec.md`, `plan.md` y `CLAUDE.md` (credenciales del PSE cifradas, RNF-07; ningún dato de clientes en `referencia`).
- [ ] T38 · tester y documentador · Verificación completa, migraciones de ida y vuelta, commit de cierre de 6b y documentación (README: worker, variables del PSE, cómo usar el simulador en demos).

### Solo ruta crítica (6b)

- [ ] Pruebas escritas por test-writer y confirmadas en rojo (P7 a P9, R2)
- [ ] Pruebas en verde tras la implementación (T35)
- [ ] Ataque adversarial sin fallas abiertas (T36)
- [ ] El orquestador verifica con `git diff` que la fase C no tocó los archivos de la fase B
