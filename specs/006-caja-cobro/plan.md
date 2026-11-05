# 006 · Plan técnico

Entregas 6a (caja, cobro y comprobante sin PSE) y 6b (facturación electrónica), pendientes de la aprobación del usuario. Los números entre paréntesis son criterios de `spec.md`; "pregunta N" remite a "Preguntas abiertas". Se ejecuta 6a completa y después 6b; la parte de 6b de este plan se precisa antes de empezarla.

## Módulos afectados

### Entrega 6a

- `packages/dominio`:
  - `src/caja/montos.ts` (ruta crítica P1): `desglosar`, `calcularCuenta`, `validarDescuento`, prorrateo por mayor resto (exportado para sus pruebas como `repartirPorMayorResto(monto, pesos: string[]): string[]`) (9, 11 a 16). `CuentaEntrada` es la entrada de `calcularCuenta` y también la de las partes.
  - `src/caja/vigencias.ts` (P1): `tasaIgvVigente`, `montoIcbperVigente` (10); lee `MONTOS_ICBPER` de `catalogos.ts`.
  - `src/caja/partes.ts` (P1): `calcularParte(cuenta: CuentaEntrada, partesAnteriores: ParteCalculada[], parte, formato)` y `cambioDeCuentaPermitido(cuentaNueva: CuentaEntrada, partesAnteriores)`, que llaman a `calcularCuenta` por dentro; `ParteCalculada` con `porItem` (criterio 17) (17 a 20).
  - `src/caja/pagos.ts` (P1): `validarPagos`, `redondeoEfectivo` (21).
  - `src/caja/turno.ts` (P1): `esperadoDelTurno`, `diferenciasDelArqueo` (22).
  - `src/caja/letras.ts` (no crítico): `montoEnLetras` (23).
  - `src/caja/catalogos.ts`: medios, tipos, formatos, documentos, modos, estados, límites y la tabla `MONTOS_ICBPER` (pregunta 5).
  - `src/regimen.ts`: `tiposDeComprobantePermitidos` (reexportado por la entrada `caja`).
  - Entrada propia `@restaurante/dominio/caja` en `package.json` (`exports`), como la de llamados de 005, para que la PWA la cargue bajo demanda. En la PWA hace falta además un alias propio en `apps/app/vite.config.ts` (ver "PWA").
  - Pruebas protegidas en `test/caja/`.
- `packages/contratos`: `src/caja.ts`, `src/comprobantes.ts`; cambios en `src/autorizaciones.ts` (`objetivo`), `src/impresion.ts` (tipos de trabajo y bloques `qr` y `gaveta`), `src/salon.ts` (campos opcionales de la pre-cuenta y del KDS; `ordenRespuestaSchema.mozo` y `comandaKdsSchema.orden.mozo` nulos para el mostrador, criterio 82), `src/errores.ts`.
- `apps/api`:
  - `src/modulos/caja/` (nuevo, dueño de `caja`, `turno`, `turno_conteo`, `movimiento_caja`, `cobro`, `pago`): ver "Estructura".
  - `src/modulos/facturacion/` (nuevo, dueño de `serie`, `comprobante`, `comprobante_linea`).
  - `src/modulos/pedidos/`: `descuento`, `cortesia`, `contador_llamado` y las columnas nuevas de `orden` e `item`; `CuentasDePedidos` (exportado); `descuentos.controller.ts` y `cortesias.controller.ts` (rutas `/cuentas/:ordenId/descuentos|cortesias`); el puerto `COBROS` y su uso en `envios.service.ts`, `anulaciones.service.ts`, `movimientos.service.ts` (unión) y `ordenes.service.ts` (anular); `precuentas.service.ts` con descuentos, cortesías y lo pagado; la plantilla de comanda y `comandaKds` con el número de llamado.
  - `src/modulos/plataforma/`: `emisor_tasa_igv`, rutas `/emisores/:id/tasas-igv`, `EmisoresService.tasasIgv` y `datosParaComprobante`.
  - `src/modulos/seguridad/`: `autorizacion.objetivo`, `POST /autorizaciones` con `objetivo`, `SesionActual.autorizacionConsumida()` con el objetivo, y el ayudante `exigirObjetivo(consumida, esperado)` que usan las rutas de descuentos y cortesías.
  - `src/modulos/impresion/`: tipos de trabajo nuevos, `comprobante_id` y `turno_id`, regla del pulso a tiempo en la entrega, `impresoraDeLaCaja`, plantillas `comprobante.ts`, `reporte-caja.ts` y `gaveta.ts`; el renderizador con los bloques `qr` (`GS ( k`, modelo 2, corrección M) y `gaveta` (`ESC p 0 25 250`); el emulador decodifica los dos.
  - `src/migraciones/`: ver "Migraciones".
  - Pruebas no protegidas en `test/caja/`, `test/facturacion/`; protegidas en `test/caja-critica/` (fase B).
- `apps/app`:
  - `src/modulos/caja/` (nuevo, todo bajo demanda): `CajaPagina` (sin turno y con turno), `AbrirCajaHoja`, `PorCobrarLista`, `CobroPagina` (desglose, comprobante, pagos, división), `PagosPanel`, `DividirHoja`, `DescuentoHoja`, `CortesiaHoja`, `MovimientoHoja`, `ReporteX`, `CierrePagina`, `MostradorPagina` (reutiliza el comandero de 004 en modo mostrador), `caja.ts` y `cobros.ts` (consultas y mutaciones con `Idempotency-Key` y el `id` del cliente), `partes.ts` (las partes pendientes por cuenta en el equipo).
  - `src/modulos/administracion/cajas/`: `CajasPagina`, `CajaFormulario`; en emisores, la tasa de IGV.
  - `src/modulos/salon/OrdenPagina.tsx`: "Cobrar", "Descuento" y "Cortesía".
  - `src/modulos/acceso/navegacion.ts`: el destino "Caja" y "Disponibilidad" dentro de "Cocina" para quien pasa de cinco (108).
  - La ventana de clave de 002 acepta y muestra el `objetivo`.
- `packages/ui` (skill `impeccable`): `TecladoDeMonto`, `CifraGrande` (vuelto y total), `FilaDeDesglose`.

### Entrega 6b (a precisar)

- `apps/api/src/modulos/facturacion/pse/`: `ConectorPse`, `SimuladorPse`, el adaptador del PSE elegido; `envios-pse.service.ts`, el trabajo del worker y el barrido; `notas-credito.service.ts`; `padron/` (carga diaria y búsqueda).
- `apps/api/src/worker.ts` (nuevo punto de entrada) y `src/nucleo/colas/` (pg-boss con su rol `restaurante_colas`, como el de tiempo real de 004).
- `apps/app`: panel de comprobantes, nota de crédito, autocompletar del RUC, compartir por WhatsApp.

## Diseño

### Estructura

```
apps/api/src/modulos/caja/
  caja.module.ts
  cajas.controller.ts            /sucursales/:sucursalId/cajas…, /cajas
  turnos.controller.ts           /turnos, /turnos/mio, /turnos/:id, movimientos, reporte, reporte-x, cierre
  cuentas.controller.ts          GET /cuentas, GET /cuentas/:ordenId, POST /cuentas/:ordenId/cobros
  mostrador.controller.ts        POST /ventas-mostrador
  turnos.service.ts              apertura, movimientos, X y Z (con bloqueos)
  cobros.service.ts              el cobro (ver "Flujo del cobro")
  mostrador.service.ts
  cobros-de-pedidos.ts           implementa el puerto COBROS de pedidos
  reportes-caja.ts               arma reporteCaja con esperadoDelTurno
  tickets-de-caja.ts             documentos de X, Z y gaveta

apps/api/src/modulos/facturacion/
  facturacion.module.ts
  comprobantes.controller.ts     GET /comprobantes, /comprobantes/:id, impresiones
  series.service.ts              configuración y numeración
  emision.service.ts             emitir(datos): número, filas (con detalle_parte), cuota, ticket
  facturado.ts                   FacturadoService.facturadoDeOrden(ordenId): ParteCalculada[] (lee solo comprobante)
  comprobantes.service.ts        consultas con alcance, reimpresión, resumen tributario del turno para el X y el Z

apps/api/src/modulos/pedidos/ (cambia)
  cuentas-de-pedidos.ts          cuentaParaCobrar, cuentasAbiertas, registrarCobro, abrirYEnviarMostrador({ id, lineas }) (exportado)
  descuentos.controller.ts       /cuentas/:ordenId/descuentos…
  cortesias.controller.ts        /cuentas/:ordenId/cortesias…
  descuentos.service.ts, cortesias.service.ts
  cobros/cobros.puerto.ts        COBROS (validarCambio); registro al arrancar, falla cerrado
  llamados-mostrador.ts          contador_llamado
```

Dependencias: caja → pedidos (`CuentasDePedidos`), facturación (`EmisionService`, `FacturadoService`, `SeriesService`, el resumen tributario del turno), plataforma (`SuscripcionService`, `EmisoresService`, `SucursalesConsultaService`), impresión (`ImpresionPuerto`), seguridad. Facturación → plataforma, impresión. Pedidos no depende de caja: define `COBROS` y caja se registra al arrancar (como `UsoDeMesas` de salón); si nadie se registró, toda orden con `cobros > 0` rechaza el cambio (falla cerrado). Ningún módulo lee tablas de otro. Donde la dependencia iría al revés se usa el mismo patrón de puerto registrado al arrancar, que falla cerrado:

- **Facturación → caja (reimpresión, criterio 90):** facturación define un puerto con la impresora de una caja; caja lo registra (lee `caja.impresora_id` y llama a `ImpresionPuerto.impresoraDeLaCaja`). En la emisión no hace falta: el cobro le pasa la impresora ya resuelta en `DatosDeEmision`.
- **Plataforma → facturación (criterio 6):** plataforma define un puerto con la última fecha de emisión de un emisor; facturación lo registra (`max(fecha_emision)` de `comprobante`). Sin registro, el cambio de tasa responde 409 `CONFLICTO`.
- **Alcance del Cajero en comprobantes (criterio 100):** el comprobante copia `turno_responsable_id` al emitir (el responsable de un turno no cambia), así facturación filtra sin leer `turno`.
- **Impresión no lee `caja`:** `impresoraDeLaCaja(sucursalId, impresoraId | null)` recibe la impresora propia de la caja que caja leyó de su tabla.

### Flujo del cobro (47 a 63; ruta crítica P2)

Una transacción por petición (`ContextoEmpresa`), con este orden fijo de cerrojos para no cruzarse con los envíos de 004 ni con el cierre: **cerrojo consultivo por el id del cliente → orden → turno (`FOR SHARE`) → emisor (`FOR SHARE`, al leer la tasa) → serie → consumo de la cuota** (ver "Orden de los cerrojos").

#### Orden de los cerrojos (revisión T26, 2026-11-05; coincide con el código)

Primero, si la operación lleva un id del cliente, un cerrojo consultivo de la transacción (`pg_advisory_xact_lock(hashtextextended(clave, 0))`) por ese id (la clave lleva la empresa: `<empresaId>:<clave>`, ver abajo), para que las réplicas simultáneas se turnen y la segunda vea lo ya confirmado en lugar de chocar con la clave primaria; después, los bloqueos de filas, siempre en el mismo orden:

| Operación | Orden |
| --- | --- |
| Cobro (`CobrosService.cobrar`) | consultivo `cobro-id:<id>` → orden (`FOR UPDATE`, `cuentaParaCobrar`) → turno (`FOR SHARE`) → emisor (`FOR SHARE`, `tasasIgvParaEmitir`) → serie (`UPDATE … RETURNING`) → cuota (`consumo_comprobantes`) |
| Venta de mostrador (`MostradorService.vender`) | consultivo `cobro-id:<id>` (el id de la venta) → turno (`FOR SHARE`) → emisor (`FOR SHARE`) → contador de llamado (`contador_llamado`, dentro de `abrirYEnviarMostrador`, con el envío de 004 sobre una orden nueva que nadie más ve) → serie → cuota |
| Apertura (`TurnosService.abrir`) | consultivo `turno-id:<id>` → caja (`FOR NO KEY UPDATE`) → consultivo por la persona `turno-persona:<sucursal>:<persona>` → inserción (los índices únicos parciales son la red) |
| Reporte X de un turno abierto (`ReportesCaja.armar`) | turno (`FOR NO KEY UPDATE`) antes de leer nada; un turno cerrado no se bloquea |
| Movimiento (`registrarMovimiento`) | lectura sin bloqueo del turno (404) → consultivo `movimiento-id:<id>` → turno (`FOR SHARE`) |
| Cierre (`cerrar`) | todos los turnos `ABIERTO` de la sucursal (`FOR UPDATE`, en orden de id); sin consultivo |
| Cambio de serie (`PUT …/series/:tipo`) | caja (`FOR NO KEY UPDATE`) → serie (`FOR UPDATE` de la existente y `UPDATE` de la activa) |
| Cambio de tasa (`configurarTasaIgv`) | solo el emisor (`FOR NO KEY UPDATE SKIP LOCKED`, reintentado cada 25 ms hasta 3 s; después 409 `CONFLICTO`) |
| Alta o reactivación de caja (`CajasService`) | consultivo `cajas:<sucursal>` (tope de 10 cajas activas) y la caja |

Ninguna operación toma estos cerrojos en otro orden, así que no hay ciclos: el consultivo va siempre primero y es propio de cada id; el cierre solo toma turnos; el cambio de tasa solo el emisor y sin esperar sin límite; el reporte X toma solo el turno.

**La clave del consultivo lleva la empresa** (corregido en el código, `CobrosService.turnarPor`): la clave real es `<empresaId>:<clave>`, por ejemplo `<empresaId>:cobro-id:<id>`. El espacio de cerrojos consultivos es de toda la base: sin la empresa, dos empresas con el mismo id de cliente se turnarían entre sí. No filtraba datos (cada una lee con su RLS), pero una podía hacer esperar a la otra. Las claves de la tabla de arriba se escriben sin la empresa por brevedad.

**El reporte X de un turno abierto toma la fila del turno con `FOR NO KEY UPDATE` antes de leer** (revisión M10): choca con el `FOR SHARE` de los cobros y los movimientos, así que espera a los cobros en curso y los que llegan después esperan a que termine el reporte; todos los totales (esperado, por medio, por tipo) salen del mismo instante. Después de tomarla se vuelve a leer el turno, porque pudo cerrarse mientras se esperaba. No cruza con el cierre (que toma `FOR UPDATE` de los turnos y nada más) ni con los demás cerrojos.

1. Interceptores: 401, rol `COBRAR`, sucursal, módulo `CAJA`, forma (zod), IK (réplica guardada). Sin clave.
2. **Réplica por id:** toma el cerrojo consultivo `cobro-id:<id>` y busca `cobro` por `(empresa_id, id)`; si existe, compara la huella de la entrada normalizada (orden, parte, comprobante, pagos) y devuelve `cobro.respuesta` (201) o 422. Se hace antes de mirar el turno o la cuenta (55).
3. **Cuenta:** `CuentasDePedidos.cuentaParaCobrar(ordenId, { bloquear: true })` toma la orden con `FOR UPDATE` (el mismo bloqueo que los envíos, `bloqueos-orden.ts`); 404, 409 `ORDEN_NO_ABIERTA` (con la principal si está `UNIDA`). Compara `version` (409 `CUENTA_CAMBIO`).
4. **Turno:** `SELECT … FROM turno WHERE id = $1 AND sucursal_id = $2 FOR SHARE`: 404, 409 `TURNO_CERRADO`, 409 `TURNO_AJENO` (responsable o rol Supervisor o Administrador). `FOR SHARE` deja cobrar en paralelo en el mismo turno y espera al cierre, que toma `FOR UPDATE` (59).
5. **Parámetros:** emisor y régimen de la sucursal (`datosParaComprobante`), tasa vigente en la fecha de emisión (Lima, del reloj de la API) e ICBPER vigente; el cobro guarda esa fecha (`fechaDeParametros`). La tasa se lee con `SELECT … FROM emisor WHERE id = $1 FOR SHARE` (`EmisoresService.tasasIgvParaEmitir`), que se mantiene hasta el final de la transacción: choca con el `FOR NO KEY UPDATE` de `configurarTasaIgv`, así que el cambio de tasa espera a los cobros en curso del emisor y después ve sus comprobantes (409 si son de la fecha o posteriores), y dos cobros del mismo emisor no se esperan entre sí. Va entre el turno y la serie (**consultivo por id → orden → turno (`FOR SHARE`) → emisor (`FOR SHARE`) → serie → cuota**); el cambio de tasa no toma ningún otro, así que no hay ciclo. **Espera acotada (ronda 2, criterio 90):** los cobros nuevos toman el `FOR SHARE` sin hacer fila detrás del `FOR NO KEY UPDATE` que espera, así que con cobros sin pausa el cambio de tasa podría esperar para siempre; `configurarTasaIgv` intenta el `FOR NO KEY UPDATE … SKIP LOCKED` cada 25 ms durante 3 s como máximo (la guarda de la API no admite `SET lock_timeout`) y, pasado el plazo, responde 409 `CONFLICTO` «Hay cobros en curso; inténtalo de nuevo» sin guardar nada. La venta de mostrador lo toma después del turno y antes de crear la orden; 409 `TASA_IGV_NO_CONFIGURADA`; 422 `COMPROBANTE_NO_PERMITIDO` en Nuevo RUS.
6. **Cálculo:** la `CuentaEntrada` armada con la cuenta de pedidos, la tasa y el ICBPER; `calcularCuenta`; las partes anteriores con `FacturadoService.facturadoDeOrden` (los `comprobante.detalle_parte` de la orden, en orden de `numero_parte`: con la orden bloqueada no hay otra parte en vuelo); `calcularParte` con la misma `CuentaEntrada`. Compara `total` (409 `CUENTA_CAMBIO`). Valida cliente (422 `CLIENTE_REQUERIDO`), pagos y redondeo (`validarPagos`, `redondeoEfectivo`; 422 `PAGOS_NO_CUADRAN`), topes (422 `MONTO_FUERA_DE_RANGO`). Todo esto antes de numerar, para que el bloqueo de la serie dure lo mínimo.
7. **Emisión:** caja resuelve la impresora de la caja (`caja.impresora_id` y `ImpresionPuerto.impresoraDeLaCaja`) y llama a `EmisionService.emitir(datos)` con la `ParteCalculada`, `numero_parte` = `cobros` de la cuenta + 1, el turno con su responsable, el `id` del cobro y la impresora. **La fecha de emisión se toma después de numerar** (con la serie ya bloqueada, para que la fecha crezca junto con el número). Si cae en otro día de Lima que la fecha con que se eligieron la tasa y el ICBPER (el cobro cruzó la medianoche entre el paso 5 y la numeración), `EmisionService.emitir` responde 409 `CONFLICTO` «Cambió el día mientras se cobraba; inténtalo de nuevo»; como es una excepción, la transacción se revierte entera y no se consume ningún número. Facturación hace `UPDATE serie SET ultimo_numero = ultimo_numero + 1 WHERE caja_id = $1 AND tipo = $2 AND activa AND emisor_id = $3 RETURNING id, serie, ultimo_numero` (0 filas: se repite la sentencia hasta 5 veces dentro de la misma transacción, porque un cambio de serie de la caja que coincide con el cobro deja el `UPDATE` reevaluando la fila vieja ya inactiva mientras la serie nueva no entra en su instantánea de READ COMMITTED; si tras eso sigue sin haber serie activa: 409 `SIN_SERIE`; `CHECK` de máximo: 409 `SERIE_AGOTADA`). El orden de bloqueos no cambia; inserta `comprobante` (con `detalle_parte`, `numero_parte`, `turno_id`, `turno_responsable_id` y `cobro_id`) y `comprobante_linea`; llama a `registrarComprobanteEmitido`; arma el documento del ticket y lo encola con `ImpresionPuerto.encolar` (tipo `COMPROBANTE`, con el bloque `gaveta` al inicio si hay efectivo y la impresora tiene gaveta).
8. **Cobro y pagos:** inserta `cobro` (con `comprobante_id`, la `parte` de entrada normalizada y `respuesta`) y `pago`. El detalle de la parte no se copia en `cobro`.
9. **Pedidos:** `CuentasDePedidos.registrarCobro` (con `itemsFacturados` = el `porItem` de la parte, `monto` = su total e `icbper` = su `totales.icbper`) suma `item.cantidad_facturada`, `orden.monto_cobrado`, `orden.icbper_cobrado`, `orden.cobros`, fija `modo_cobro`, sube `orden.version` y, si `cierraLaCuenta`, deja la orden `CERRADA`, cierra `orden_mesa` y registra `salon.cambio` y `orden.cambio` con `alConfirmar`.
10. `alConfirmar`: `turno.cambio` y, desde impresión, `trabajo.nuevo` al puente.

Si cualquier paso lanza, la transacción se revierte entera: el número de la serie, el consumo de la cuota, el trabajo de impresión y los cambios de la orden (71, 73, 76). Las réplicas concurrentes con el mismo `id` se turnan en el cerrojo consultivo del paso 2: la segunda espera al `COMMIT` (o a la reversión) de la primera y después encuentra el cobro y devuelve la réplica (o, si la primera se revirtió, cobra ella) (56). La clave primaria de `cobro` queda como red: si chocara, la traducción de 003 responde 409 `CONFLICTO`.

**Un saldo negativo nunca responde 500** (revisión de la sección 6a, criterio 45a): `restarMontos` de `packages/dominio` lanza `RangeError` si el resultado es negativo (así el dominio detecta el dato malo), y la API lo convierte en un 409 con el detalle en el log (`conMontosConsistentes`, en `nucleo/errores`). En el cobro es 409 `CUENTA_CAMBIO` (el cálculo de la parte, la emisión y el saldo posterior; se revierte todo, sin número ni cobro); en la lectura de la cuenta (`GET /cuentas/:ordenId`, `GET /cuentas`), la pre-cuenta y su "Pagado / Por pagar" es 409 `CONFLICTO`. Lo cubre `test/caja/saldo-negativo.spec.ts`.

**Por qué el número no deja huecos:** la serie es una fila que se actualiza en la misma transacción; una reversión deshace el incremento. Las secuencias de PostgreSQL no sirven porque no se revierten. Dos cajas usan filas distintas (sus series), así que no compiten; dos cobros en la misma caja se turnan en esa fila hasta el `COMMIT`. El consumo de la cuota (`consumo_comprobantes`, una fila por sucursal y mes) también se turna, siempre después de la serie: el orden fijo evita interbloqueos.

### Partes y cambios después de cobrar (17 a 20, 64 a 68, 86 a 89)

- Facturación guarda en `comprobante.detalle_parte` el resultado de `calcularParte` (la `ParteCalculada`, con `porItem`) y en `comprobante.numero_parte` su lugar en la orden. `FacturadoService.facturadoDeOrden(ordenId)` devuelve esos detalles en orden de `numero_parte`, leyendo solo `comprobante`, y `calcularParte` calcula "lo que falta" restándolos de la cuenta actual. No hay otra fuente de verdad para lo cobrado; `cobro` (caja) guarda solo la referencia al comprobante y los pagos. En 6b, si una nota de crédito anula partes, `facturadoDeOrden` es el único lugar que cambia.
- `orden.monto_cobrado`, `orden.cobros`, `orden.modo_cobro` e `item.cantidad_facturada` son copias que pedidos guarda para sus propias reglas sin leer tablas de caja: saber si una orden tiene cobros (unir, anular, descuentos) y mostrarlo en la cuenta.
- **Puerto `COBROS`:** antes de confirmar un envío, una anulación de ítem o una unión de una orden con `cobros > 0`, pedidos arma la cuenta que quedaría y llama a `COBROS.validarCambio(ordenId, cuentaNueva)`; caja lee las partes con `facturadoDeOrden` y aplica `cambioDeCuentaPermitido` (que rechaza todo cambio si la cuenta tiene descuento por cuenta y alguna parte cobrada, criterio 20); si no, 409 `CUENTA_COBRADA_EN_PARTE` y la transacción se revierte (la autorización de la anulación también). Cuando el cambio es permitido, el puerto devuelve además `cierraLaCuenta` (caja lo calcula con `cuentaSinNadaQueFaltar` del dominio, la misma definición de "no falta nada" de `cierraLaCuenta`: saldo 0.00, sin bolsas ni cortesías pendientes); si es `true`, pedidos deja la orden `CERRADA` en esa misma transacción (versión, `cerrada_en`, `orden_mesa.hasta`, pre-cuenta invalidada, sin otro comprobante) y publica `orden.cambio` y `salon.cambio` después de confirmar (ronda 2, criterio 90). Unir y anular una orden con cobros se rechazan antes, sin llamar al puerto (409 `CUENTA_EN_COBRO`).
- En el mostrador no hay partes: la venta es un cobro `TOTAL`.

### Turno y cierre (24 a 35; ruta crítica P3)

- **Apertura:** cerrojo consultivo por el `id` del turno y réplica por `id` como el cobro; después `exigirAperturaDeCaja`; la caja con `FOR NO KEY UPDATE` (turna las aperturas de una caja); un cerrojo consultivo por la persona en la sucursal (turna las aperturas de una persona en dos cajas); los índices únicos parciales de `turno` son la red (409 `TURNO_YA_ABIERTO` traducido del `23505`). Con fondo mayor que `"0.00"`, encola el trabajo `GAVETA` y guarda `apertura_impresion` y `apertura_trabajo_id` (migración 8) para que la réplica devuelva el mismo `impresion`.
- **Movimientos:** cerrojo consultivo por el `id` del movimiento y réplica (que devuelve el `impresion` y el `trabajoId` guardados en `movimiento_caja`, migración 8); después el turno `FOR SHARE`, como el cobro.
- **Cierre:** bloquea con `FOR UPDATE` todos los turnos `ABIERTO` de la sucursal, en orden de id (así dos cierres simultáneos se turnan y el segundo ve que ya no hay otro abierto); si el suyo es el único y `PedidosConsultaService.hayOrdenesAbiertas` es `true`, 409 `CIERRE_BLOQUEADO` con `ordenesAbiertas(…).length`. Calcula el esperado con los cobros y movimientos del turno (`esperadoDelTurno`), valida los motivos (422 con las diferencias, sin el esperado), inserta `turno_conteo`, cierra el turno, deja la fila `cerrar_turno` y encola el `REPORTE_Z`.
- El X y el Z se arman con `reportes-caja.ts` con un número fijo de consultas (sumas agrupadas por medio en SQL, montos en `NUMERIC`; el esperado y las diferencias, con `packages/dominio`). Caja suma sus propias tablas (cobros, pagos, redondeos, vueltos y movimientos); lo que está en los comprobantes (cantidad y total por tipo, descuentos, cortesías, IGV e ICBPER) lo da facturación con su resumen del turno (`comprobante.turno_id`), en una consulta.
- **El 422 `DIFERENCIA_SIN_MOTIVO`** lleva `diferencias: [{ medio }]` solo de los medios que no cuadran, en el orden de `MEDIOS_PAGO`, sin `esperado`, `contado` ni `diferencia` (decisión del usuario del 2026-11-05; criterios 31 y 32). `diferenciaDeArqueoSchema` y `errorRespuestaSchema.diferencias` cambian a esa forma; la PWA dice «no cuadra» y pide el motivo sin mostrar montos.
- **Prueba del desarrollador de 002:** al llamar a `exigirAperturaDeCaja`, agregar `modulos/caja/turnos.service.ts` a `PERMITIDOS` en `apps/api/test/suscripciones/suspension.spec.ts` (no protegida; ver "Impacto en especificaciones anteriores" de `spec.md`).

### Descuentos y cortesías con clave atada (38 a 46; ruta crítica P5)

- Rutas con `@ClaveDespuesDeValidar({ cuerpo, uuids: ['ordenId'] })`, `@IdempotenteObligatoria()`, `@RequiereModulo('SALON')` y `@Permiso('APLICAR_DESCUENTO' | 'APLICAR_CORTESIA')`, en ese orden (004, plan "Anular un ítem").
- `POST /autorizaciones` guarda `objetivo` normalizado (ids en minúsculas, `valor` con 2 decimales). El servicio de descuentos, después de bloquear la orden, compara `SesionActual.autorizacionConsumida().objetivo` con el objetivo del cuerpo usando `exigirObjetivo`; distinto o ausente → 403 `AUTORIZACION_INVALIDA`, y la reversión devuelve la autorización (como 004, criterio 36). Para el Supervisor y el Administrador no hay autorización que comparar.
- El descuento y la cortesía se validan con `calcularCuenta` y `validarDescuento` sobre la cuenta bloqueada; suben `orden.version` e invalidan la pre-cuenta con la misma función que las anulaciones (`precuenta-invalidacion.ts`).

### Venta de mostrador (79 a 85)

Una transacción: cerrojo consultivo `cobro-id:<id>` y réplica por `id` (es el id de la orden); turno `FOR SHARE`; emisor `FOR SHARE` (parámetros); `CuentasDePedidos.abrirYEnviarMostrador({ id, lineas })` (pedidos: crea la orden `MOSTRADOR`, toma el número de llamado de su propio contador con `UPDATE contador_llamado … RETURNING` o lo crea con `INSERT … ON CONFLICT` y lo devuelve en `{ ordenId, numeroLlamado, envio }`; caja no lo calcula ni lo pasa, y corre el envío de 004 con sus validaciones, su puerto de inventario y sus comandas con el número de llamado en el documento); el mismo paso 5 a 9 del cobro con `parte: TOTAL`. Si los pagos o el total fallan, se revierte también el envío: ninguna comanda sale a cocina sin cobro (las comandas y sus trabajos de impresión se publican con `alConfirmar`).

### Impresión y gaveta (90 a 96)

- Documentos nuevos en `escpos/plantillas/`: `comprobante.ts` (con el QR y "SON: …"), `reporte-caja.ts` (X y Z) y `gaveta.ts` (solo el bloque `gaveta`, sin avance ni corte).
- Bloque `gaveta`: el renderizador emite `ESC p 0 25 250` solo si la impresora tiene `gaveta: true`, el trabajo no es una reimpresión, es su primera entrega (`entregado_en` nulo) y han pasado menos de `SEGUNDOS_PULSO_GAVETA` desde `creado_en` (reloj de la API). Se marca `entregado_en` en la misma consulta que entrega el lote. El pulso nunca sale de un texto: es un bloque estructural, como las marcas de 3b.
- Bloque `qr`: texto de hasta 300 caracteres; `GS ( k` modelo 2. El emulador lo decodifica como `[QR] <texto>`.
- La impresora de cada trabajo de caja es `caja.impresora_id` o, si es nula (o la impresora ya no está activa), `impresion_sucursal.impresora_caja_id`. Caja lee `caja.impresora_id` y llama a `ImpresionPuerto.impresoraDeLaCaja(sucursalId, impresoraId | null)`, que devuelve `{ id, gaveta } | null` leyendo solo tablas de impresión. La firma de la fase A (`impresoraDeLaCaja(cajaId)`) obligaría a impresión a leer `caja`: se cambia.
- **Reimpresión de 004 con el módulo del plan** (revisión T26, criterio 90): `POST /impresion/trabajos/:id/reimpresion` de un trabajo `COMPROBANTE` exige además el módulo `FACTURACION`, y de un `REPORTE_X` o `REPORTE_Z` el módulo `CAJA` (403 `MODULO_NO_INCLUIDO`), como `POST /comprobantes/:id/impresiones` y `GET /turnos/:id/reporte`. Como la ruta de 004 no lleva `@RequiereModulo` (sirve también para comandas y pre-cuentas), la comprobación va en el servicio según el tipo del trabajo. La comprobación del módulo va antes que la del permiso de reimpresión del turno (sin el plan, 403 `MODULO_NO_INCLUIDO` aunque la persona no pueda reimprimir). Corregido en el código.
- **`GET /puente/trabajos` no reserva trabajos** (riesgo de 3b, aceptado en `spec.md`): un reintento del puente puede recibir el mismo ticket dos veces; el pulso de gaveta sale una sola vez porque `entregado_en` se marca en la primera entrega.

### Tiempo real (97)

`turno.cambio` y los de 004 con `PublicadorEventos` y `alConfirmar`; la PWA invalida las consultas de la caja y de "Por cobrar".

### PWA (108 a 119)

- Todo `src/modulos/caja/` con `lazy()`; `@restaurante/dominio/caja` y `decimal.js` solo en esos bloques. En el paquete inicial entran solo el destino de la navegación y la ruta.
- **Alias en `apps/app/vite.config.ts`:** hoy `resolve.alias` lleva `@restaurante/dominio` a `packages/dominio/src/index.ts`, así que `@restaurante/dominio/caja` se resolvería como `…/src/index.ts/caja` y no carga. Hace falta un alias propio `@restaurante/dominio/caja` → `packages/dominio/src/caja/index.ts`, declarado antes del general (o el general como expresión regular exacta, `^@restaurante/dominio$`), para que la PWA lea el código fuente de esa entrada y la reparta en los bloques bajo demanda. Lo mismo en la configuración de Vitest de la PWA si no hereda los alias.
- **Presupuesto:** T1 midió la línea de base el 2026-11-04 (HEAD `6ec7f79`, `pnpm --filter @restaurante/app build && pnpm --filter @restaurante/app presupuesto`): el paquete inicial pesa **156.2 kB gzip** (límite 170 kB; kB de 1024, como los mide `scripts/presupuesto.mjs`): `index-*.js` 111.0 kB, `identidad-*.js` 41.9 kB, `salon-*.js` 2.1 kB, `preload-helper-*.js` 0.8 kB y `rolldown-runtime-*.js` 0.4 kB, con 92 bloques bajo demanda. **El margen real es de 13.8 kB**, no casi nulo como se estimó con un registro viejo (174.08 kB según Vite, que mide en kB de 1000 bytes). Después de la fase A (commit `92fb085`) pesa **156.6 kB**. Lo nuevo del paquete inicial es solo el destino "Caja" de la navegación, su ruta y el aviso de la guía de primeros pasos; el resto (`@restaurante/dominio/caja` y `decimal.js` incluidos) va bajo demanda. Si no cupiera, el revisor propone subir el límite con su motivo y el orquestador lo decide.
- **Cómo medir:** `pnpm build --force` (sin la caché de Turborepo, que puede devolver un build viejo) y después `pnpm --filter @restaurante/app presupuesto`. Nunca con `NODE_ENV=test` en el entorno: las cifras salen falsas. El tester mide así en cada tarea de cierre de fase.
- Los cobros usan la cola de "Pendiente de envío" de 003 con el `id` del cobro conservado hasta una respuesta final (como el envío de 004).
- Las partes pendientes y la caja elegida se guardan en el almacenamiento del equipo por persona.
- **Partes iguales entre equipos** (revisión T26, criterios 65 y 113): `partes.ts` guarda por cuenta el total de partes elegido; las partes cobradas y su detalle vienen de `cuentaRespuesta.cobros[].detalleParte`, con lo que `calcularParte` corre igual en cualquier equipo. Si el equipo no tiene el total (la cuenta se sigue desde otro), la PWA propone las partes que faltan según lo cobrado y lo muestra, editable, antes de cobrar.
- **Mostrador** (revisión T26, criterio 115): ofrece solo los tipos de comprobante permitidos por el régimen del emisor y usa la tasa de IGV y el ICBPER que da la API, nunca una tasa ni una lista de tipos propias (hoy `MostradorPagina` tiene `TIPOS = ['BOLETA', 'FACTURA']` fijo). La ruta que expone esos parámetros sin una orden está pendiente ("Preguntas abiertas" de `spec.md`).

### Entrega 6b (bosquejo)

- **Colas:** pg-boss en su esquema, con el rol `restaurante_colas` (sin privilegios en `public`, como `restaurante_tiempo_real`); la API encola con `alConfirmar` solo `{ empresaId, comprobanteId }`; el worker abre `ContextoEmpresa.ejecutar(empresaId, …, { actor: { sistema: 'worker:envio-pse' } })`. Barrido cada minuto de `envio_pse` vencidos.
- **Idempotencia con el PSE:** serie y número como identificador; ante error de transporte, `consultar` antes de reintentar.
- **Padrón:** carga diaria a una tabla nueva y cambio atómico de nombre; función `SECURITY DEFINER` de búsqueda exacta (patrón de 005).
- **Notas de crédito:** la misma numeración de `EmisionService`; los montos con `calcularParte` sobre las líneas del original; el egreso en el turno abierto de quien emite.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Rutas en `/cuentas`, `/turnos`, `/cajas`, `/ventas-mostrador`, `/comprobantes` | `/ordenes/:id/cobros` | La prueba protegida de 004 (criterio 78) exige que toda ruta de `/ordenes` sea de 3a; además "cuenta" es la palabra del negocio. |
| Serie como fila con `UPDATE … RETURNING` en la transacción del cobro | Secuencia de PostgreSQL; numerar después de confirmar; Redis | La secuencia deja huecos al revertir; numerar después separa el cobro de su comprobante; Redis está fuera de la arquitectura. |
| Partes calculadas sobre lo que falta, con `detalle_parte` guardado | Guardar la división completa al empezar | Permite seguir pidiendo después de una parte y recalcular sin migraciones de estado; un solo lugar decide si un cambio cuadra. |
| `detalle_parte` en `comprobante` (facturación) | En `cobro` (caja) | Es el detalle del comprobante; así `facturadoDeOrden` vive en facturación y lee solo sus tablas, y caja guarda solo la referencia y los pagos. |
| `version` y `total` del cliente comparados en el servidor | Confiar en el total del cliente; no comparar | El servidor recalcula siempre; la comparación evita cobrar un monto que la persona no vio. |
| Puerto `COBROS` registrado por caja en pedidos | Que pedidos lea `cobro` | Cada módulo es dueño de sus tablas; falla cerrado si caja no se registró. |
| Comparar el objetivo de la autorización en las rutas de descuentos | Cambiar `AutorizacionService.consumir` | Las pruebas protegidas de 002 consumen `APLICAR_DESCUENTO` sin objetivo; así no cambian. |
| Turno `FOR SHARE` en cobros y movimientos y `FOR UPDATE` en el cierre | Bloqueo consultivo por turno | Usa filas que ya existen; los cobros de un turno no se turnan entre sí. |
| Cerrojo consultivo por el id del cliente (y por la persona en la apertura) antes de buscar la réplica, con la empresa en la clave | Dejar que las réplicas simultáneas choquen en la clave primaria y responder 409 | La segunda réplica espera y devuelve la misma respuesta que la primera (criterios 24, 28, 55, 56 y 83); el consultivo es por id, no por turno, así que no turna cobros distintos. La empresa en la clave evita que dos empresas se hagan esperar (revisión T26). |
| Cierre que bloquea los turnos abiertos de la sucursal en orden de id | Contar sin bloquear | Dos cierres simultáneos dejarían la sucursal sin turno con mesas abiertas. |
| Pulso de gaveta como bloque del ticket con ventana de 120 s | Trabajo aparte siempre | Un trabajo aparte sale en un orden no garantizado frente al ticket; dentro del ticket va primero y no se repite en reimpresiones. |
| Entrada `@restaurante/dominio/caja` con su alias en Vite | Importar desde el índice | El margen del paquete inicial es de 13.8 kB y las reglas de caja con `decimal.js` no deben entrar en él. |
| Puertos registrados al arrancar donde la dependencia iría al revés (impresora de la caja para reimprimir, última emisión de un emisor) y `turno_responsable_id` copiado en el comprobante | Leer `caja`, `turno` o `comprobante` desde otro módulo | Cada módulo es dueño de sus tablas y no hay ciclos entre módulos. |

## Migraciones

En este orden (6a); `down` de cada una deshace solo lo suyo. Ninguna escribe datos.

1. `202611040001-tasa-igv.ts` (plataforma): `emisor_tasa_igv`.
2. `202611040002-caja.ts` (caja): `caja`, `turno`, `turno_conteo`, `movimiento_caja`.
3. `202611040003-facturacion.ts` (facturación): `serie` (con `primer_numero`), `comprobante` (con `turno_id` hacia la `turno` de la migración 2, `turno_responsable_id`, `cobro_id` sin llave foránea, `numero_parte` y `detalle_parte`), `comprobante_linea`; privilegio de `UPDATE` de `comprobante` solo en `estado` y `actualizado_*` (nunca en montos ni en `detalle_parte`).
4. `202611040004-cobros.ts` (caja): `cobro` (con `comprobante_id` hacia la migración 3, sin `detalle_parte`), `pago`.
5. `202611040005-cuentas-pedidos.ts` (pedidos): `descuento`, `cortesia`, `contador_llamado`; columnas nuevas de `orden` (incluida `icbper_cobrado`) e `item` con sus `CHECK`.
6. `202611040006-autorizacion-objetivo.ts` (seguridad): `autorizacion.objetivo`.
7. `202611040007-impresion-caja.ts` (impresión): `CHECK` de `trabajo_impresion.tipo` con los cuatro tipos nuevos, `comprobante_id`, `turno_id` y sus índices únicos parciales.
8. `202611040008-impresion-de-operaciones-de-caja.ts` (caja, grupo C6): `turno.apertura_impresion` y `turno.apertura_trabajo_id`, y `movimiento_caja.impresion` y `movimiento_caja.trabajo_impresion_id` (`EN_COLA` o `SIN_IMPRESORA`; FK compuesta con `empresa_id` a `trabajo_impresion`; `CHECK` de que `EN_COLA` va si y solo si hay trabajo), para que la réplica por `id` de la apertura y del movimiento devuelva el mismo `impresion` y `trabajoId` (criterio 96). No cambia la RLS ni los privilegios.

6b agrega las suyas (envíos, resultados, notas de crédito, padrón y el esquema de pg-boss con su rol en `db:preparar`).

## Riesgos

- **Validación del contador** (B.19): cortesías, por consumo, 700, tasa, Nuevo RUS, redondeo, ICBPER. Mitigación: todo en funciones puras con pruebas; un cambio del contador es un cambio acotado.
- **Presupuesto de la PWA** con un margen de 13.8 kB (156.2 de 170 kB; 156.6 kB tras la fase A; ver "PWA"): alcanza para la navegación y las rutas bajo demanda, no para sumar dependencias al paquete inicial. Una medición con `NODE_ENV=test` o con la caché de Turborepo puede engañar: medir con `pnpm build --force`.
- **Contención de la serie y de la cuota** en horas punta: cada cobro mantiene el bloqueo de su serie y de `consumo_comprobantes` desde que numera hasta el `COMMIT` (milisegundos). Prueba de carga del tester: 50 cobros concurrentes en una sucursal en menos de 5 segundos.
- **Complejidad de las partes iguales con bolsas y afectaciones mixtas:** cubierta por ejemplos exactos en P1 y por `cambioDeCuentaPermitido`; el ataque debe buscar descuadres de céntimos.
- **Cambio de emisor de una sucursal con series:** cubierto por el criterio 5 (las series del emisor anterior no emiten).
- **Riesgos aceptados tras la revisión T26** (detalle en `spec.md`, "Riesgos aceptados propuestos"): el 422 `DIFERENCIA_SIN_MOTIVO` con todo en cero revela el esperado sin rastro (para revisar con el usuario); los montos de S/ 0.01 a 0.09 no se pagan en efectivo; el puente puede imprimir dos veces un ticket (3b).
- **Correcciones de código que esta documentación describe:** la empresa en la clave del cerrojo consultivo (hecha); el módulo del plan en la reimpresión de 004 (hecho, y se comprueba antes que el permiso); el 422 de la tasa en un emisor `NUEVO_RUS` (criterio 6); los tipos y parámetros del mostrador en la PWA (criterio 115); el total de partes en el equipo (criterios 65 y 113).
- **6b:** primer uso de pg-boss y del worker (roles, RLS, despliegue), tamaño del padrón (cientos de MB) en la base administrada, y la elección del PSE.
