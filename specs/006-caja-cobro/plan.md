# 006 · Plan técnico

Entregas 6a (caja, cobro y comprobante sin PSE) y 6b (facturación electrónica), pendientes de la aprobación del usuario. Los números entre paréntesis son criterios de `spec.md`; "pregunta N" remite a "Preguntas abiertas". Se ejecuta 6a completa y después 6b. 6a está terminada (`c1de966`); la parte de 6b se precisó el 2026-11-06 sin PSE elegido (simulador detrás de `ConectorPse`; el adaptador real es T34) y espera la aprobación del usuario.

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

### Entrega 6b (precisada el 2026-11-06, pendiente de aprobación)

- `packages/dominio/src/caja/`: `notas-credito.ts` (P8: `calcularNotaCredito`), `envios.ts` (P7: esperas, plazos, alertas, transiciones), `sunat.ts` (códigos), `turno.ts` (`medio` opcional en los movimientos de `esperadoDelTurno`), catálogos nuevos en `catalogos.ts`. Pruebas protegidas en `packages/dominio/test/caja/` (archivos nuevos de la fase B de 6b).
- `packages/contratos`: `src/facturacion.ts` (nuevo) y los cambios de `comprobantes.ts` (ensanchar), `autorizaciones.ts` (objetivo `NOTA_CREDITO`), `caja.ts` (`reporteCaja.notasCredito`, `movimientos.lista[].medio`), eventos y `errores.ts`.
- `apps/api`:
  - `src/modulos/facturacion/pse/`: `conector-pse.ts` (interfaz y tipos), `documento-pse.ts` (`armarDocumentoPse`), `simulador-pse.ts`, `registro-de-conectores.ts` (modo del emisor → conector), `adaptadores/` (vacía en 6b; T34 agrega el del PSE elegido).
  - `src/modulos/facturacion/envios/`: `envios.service.ts` (registrar el envío en la emisión), `procesador-envios.ts` (los tres pasos del worker), `barrido-envios.ts`, `alertas.ts`, `resultado-pse.ts` (aplicar un resultado: estados, columnas, archivos, intentos).
  - `src/modulos/facturacion/`: `panel.controller.ts` (rutas `/facturacion/…`), `panel.service.ts`, `reemision.service.ts`, `pdf/pdf-comprobantes.ts` (pdfkit y qrcode), `enlaces.ts` (sello del enlace), `publico-comprobantes.controller.ts` (`/publico/comprobantes/:sello`), `almacen-comprobantes.ts` (puerto) y cambios en `emision.service.ts` (registro del envío, `simulado`, `emitirNotaCredito`, `reemitir`), `series.service.ts` (`TIPOS_SERIE`), `comprobantes.service.ts` (nulos, filtro de cobros en el resumen, resumen de notas), `facturado.ts` (filtro de cobros), `lectura-comprobante.ts` (campos de 6b).
  - `src/modulos/facturacion/padron/`: `carga-padron.ts` (descarga, descompresión en flujo, `INSERT` en lotes, cambio de tabla), `padron.service.ts` (búsqueda), `padron.controller.ts` (`/padron/ruc/:ruc`).
  - `src/modulos/caja/`: `notas-credito.controller.ts` (`/notas-credito`), `notas-credito.service.ts` (dueño de `nota_credito`), cambios en `reportes-caja.ts` (medio de los movimientos, notas del turno).
  - `src/modulos/plataforma/`: `configuracion-pse.service.ts` y su controlador (`/plataforma/empresas/:empresaId/emisores/:emisorId/pse`), `EmisoresService.configuracionPse`, `empresas-consulta.ts` (ids para el barrido), `facturacion-plataforma.controller.ts` (`/plataforma/facturacion/alertas`, `/plataforma/padron`, `/plataforma/padron/carga`).
  - `src/modulos/seguridad/`: `exigirObjetivo` con la variante `NOTA_CREDITO`.
  - `src/modulos/impresion/escpos/plantillas/comprobante.ts`: la leyenda de 6b, la marca de simulado y la variante de nota de crédito (documento que modifica, motivo, devolución).
  - `src/nucleo/cifrado/` (nuevo), `src/nucleo/colas/` (nuevo: `ColaPse`, `ColaPgBoss`, `ColaEnMemoria`), `src/nucleo/archivos/` (almacén privado: memoria, disco y R2 con `R2_BUCKET_COMPROBANTES`), `src/nucleo/tiempo-real/emisor-worker.ts` (emisor de `@socket.io/postgres-emitter`).
  - `src/worker.ts` (nuevo punto de entrada) y `src/crear-worker.ts`; `src/aplicacion.ts` (`pse`, `colaPse`, `almacenComprobantes`; `WORKER=habilitado`); `src/config/entorno.ts` (variables de 6b).
  - `scripts/` (`db:preparar`): roles `restaurante_colas` y `restaurante_referencia`, esquema `colas` con dueño `restaurante_colas`; `scripts/lib/roles.ts`.
  - `datos/ubigeo.csv` (catálogo del INEI) y `test/soporte/padron-ejemplo.zip` (padrón pequeño para las pruebas).
  - `src/migraciones/`: 9 a 13 (ver "Migraciones").
  - Pruebas protegidas en `test/facturacion-critica/` (fase B de 6b); no protegidas en `test/facturacion/`.
- `apps/app`:
  - `src/modulos/facturacion/` (nuevo, bajo demanda): `PanelComprobantesPagina`, `ComprobanteDetalle`, `NotaCreditoHoja`, `ReemisionHoja`, `AvisoDeAlertas`, `EstadoComprobante` (chip en vivo), `CompartirComprobante`, `facturacion.ts` (consultas y mutaciones con IK e `id`).
  - `src/modulos/caja/`: el cliente de la factura con el padrón (`ClienteFactura`), el estado en vivo en el resultado, "Comprobantes" en Caja.
  - `src/modulos/administracion/cajas/`: las series de notas de crédito; Ajustes › Comprobantes.
  - La ventana de clave muestra el objetivo `NOTA_CREDITO`.
- Dependencias nuevas (todas de código abierto, sin servicios externos): `pg-boss` (12.38.0, solo ESM, cargado con `import()`), `pdfkit`, `qrcode`, una biblioteca de descompresión en flujo (`yauzl` o `unzipper`) y `pg-copy-streams`.

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
| Nota de crédito (6b, `NotasCreditoService.emitir`) | consultivo `nota-credito-id:<id>` → comprobante original (`FOR UPDATE`) → turno de la devolución (`FOR SHARE`, si la hay) → emisor (`FOR SHARE`) → serie de la nota (`UPDATE … RETURNING`) → serie de la factura (solo en un cambio) → cuota |
| Reemisión (6b, `EmisionService.reemitir`) | comprobante rechazado (`FOR UPDATE`) → emisor (`FOR SHARE`) → serie → cuota (el índice único de `reemplaza_a_id` es la red) |
| Worker, paso 1 y paso 3 (6b) | `envio_pse` (`FOR UPDATE SKIP LOCKED` en el paso 1, `FOR UPDATE` en el 3) → comprobante del envío (`UPDATE` de estado) → original de la nota (`UPDATE` a `ANULADO`, solo con una anulación aceptada) |
| Barrido (6b) | lectura sin bloqueo de `envio_pse` y `UPDATE … WHERE estado = … AND (en_curso_hasta IS NULL OR en_curso_hasta < $ahora)` (detener por plazo, marcar alertas); no bloquea comprobantes |

Ninguna operación toma estos cerrojos en otro orden, así que no hay ciclos: el consultivo va siempre primero y es propio de cada id; el cierre solo toma turnos; el cambio de tasa solo el emisor y sin esperar sin límite; el reporte X toma solo el turno. En 6b: nadie toma un turno antes que un comprobante, ni un comprobante antes que su `envio_pse` (el worker va de envío a comprobante; la nota de crédito y la reemisión bloquean el comprobante pero no su envío, que solo insertan para el documento nuevo); un cobro nunca toma una serie de notas de crédito, y la nota toma su serie antes que la de la factura.

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

- Facturación guarda en `comprobante.detalle_parte` el resultado de `calcularParte` (la `ParteCalculada`, con `porItem`) y en `comprobante.numero_parte` su lugar en la orden. `FacturadoService.facturadoDeOrden(ordenId)` devuelve esos detalles en orden de `numero_parte`, leyendo solo `comprobante`, y `calcularParte` calcula "lo que falta" restándolos de la cuenta actual. No hay otra fuente de verdad para lo cobrado; `cobro` (caja) guarda solo la referencia al comprobante y los pagos. En 6b una nota de crédito no cambia lo cobrado de la orden (criterio 156): `facturadoDeOrden` solo agrega el filtro `cobro_id IS NOT NULL`.
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

### Entrega 6b (precisada el 2026-11-06)

Los números entre paréntesis son criterios de `spec.md` (120 a 181). Sin PSE elegido: todo corre con `SimuladorPse`; el adaptador real es T34.

#### Estructura de 6b

```
apps/api/src/modulos/facturacion/
  pse/conector-pse.ts            ConectorPse, DocumentoPse, IdDocumentoPse, ResultadoPse, CredencialPse (120)
  pse/documento-pse.ts           armarDocumentoPse(comprobante) (pura; códigos de dominio/caja/sunat.ts)
  pse/simulador-pse.ts           SimuladorPse con reglas, recibidos() y llamadas() (121)
  pse/registro-de-conectores.ts  para(emisorId): { conector, credencial, modo } según configuracion_pse (122)
  envios/envios.service.ts       registrar(comprobanteId, tipo, fechaEmision) en la transacción de la emisión (124)
  envios/procesador-envios.ts    procesar(empresaId, comprobanteId): tomar, llamar, guardar (125, 128)
  envios/resultado-pse.ts        aplicar(resultado): estados, columnas, archivos, intentos, eventos (127, 131)
  envios/barrido-envios.ts       barrerAhora(): reencolar, detener por plazo, alertas (126, 130, 133)
  envios/alertas.ts              conteos de alertas por alcance (133)
  panel.controller.ts            /facturacion/comprobantes…, /facturacion/alertas (132, 134, 135, 159, 160)
  panel.service.ts, reemision.service.ts
  pdf/pdf-comprobantes.ts        armar(comprobante): Buffer (159)
  enlaces.ts                     sellar / abrir (160)
  publico-comprobantes.controller.ts   GET /publico/comprobantes/:sello
  padron/carga-padron.ts, padron/padron.service.ts, padron/padron.controller.ts (138 a 142)

apps/api/src/modulos/caja/
  notas-credito.controller.ts    POST /notas-credito (144)
  notas-credito.service.ts       réplica, turno, devolución, egresos, respuesta (144 a 157)

apps/api/src/modulos/plataforma/
  configuracion-pse.service.ts   modo y credencial cifrada (122, 123)
  empresas-consulta.ts           ids() para el barrido (126)
  facturacion-plataforma.controller.ts  alertas y padrón del superadministrador (133, 138)

apps/api/src/nucleo/
  cifrado/cifrado.ts             sellar / abrir con AES-256-GCM y HKDF (123, 160)
  colas/                         ColaPse, ColaPgBoss (restaurante_colas), ColaEnMemoria (124, 137)
  archivos/almacen-comprobantes-*.ts   memoria, disco (./archivos-privados) y R2 privado (131)
  tiempo-real/emisor-worker.ts   formato del clúster de socket.io-adapter por pg_notify con restaurante_tiempo_real (172; sin @socket.io/postgres-emitter, cuyos mensajes sin nsp descarta el adaptador 0.5.0)

apps/api/src/worker.ts, crear-worker.ts
```

Dependencias entre módulos (6b): caja → facturación (`EmisionService.prepararNotaCredito` y `numerarNotaCredito`); facturación → plataforma (`EmisoresService.configuracionPse`, `EmpresasConsulta`), impresión, núcleo. Facturación no lee `turno`, `movimiento_caja` ni `nota_credito`; caja no lee `comprobante` ni `envio_pse`; plataforma no lee `comprobante` (para la regla "de `SIMULADO` a `REAL` solo sin comprobantes" usa el puerto de última emisión que facturación ya registra al arrancar, criterio 6 de 6a). La reemisión necesita los pagos del cobro solo para rearmar un ticket viejo: usa el puerto `RegistroPagosDeCobro` que ya existe.

#### Flujo del envío (124 a 131; ruta crítica P7)

1. **En la emisión** (dentro de la transacción del cobro, del mostrador, de la nota, del cambio o de la reemisión): `EmisionService` resuelve el modo del emisor (`configuracion_pse`, lectura sin bloqueo) para copiar `simulado`, inserta el comprobante, sus líneas, el `envio_pse` (`PENDIENTE`, `plazo_hasta` = `plazoDeEnvio(tipo, fechaEmision)`, `proximo_intento_en` = `emitido_en`), cuenta la cuota y encola el ticket; registra `alConfirmar(() => colaPse.encolar({ empresaId, comprobanteId }))`. El orden de cerrojos del cobro no cambia (el `INSERT` de `envio_pse` no espera a nadie).
2. **Cola:** `ColaPgBoss.encolar` hace `boss.send('envio-pse', datos, { singletonKey: comprobanteId, startAfter? , retryLimit: 0 })` (los reintentos los decide `envio_pse`, no pg-boss). Si falla, se registra un `warn` y el barrido lo recoge.
3. **Worker:** `boss.work('envio-pse', { batchSize: 5 }, …)` llama a `ProcesadorEnviosPse.procesar(empresaId, comprobanteId)`:
   - Paso 1 (transacción): toma la fila con `FOR UPDATE SKIP LOCKED`, comprueba estado, `proximo_intento_en` y arriendo; fija `en_curso_hasta` = ahora + 2 min e `intento_en_curso`; suma `intentos`; lee el comprobante con `leerComprobante` y arma el `DocumentoPse`; pide a `RegistroDeConectores` el conector y la credencial descifrada.
   - Paso 2 (sin transacción): `intentos = 1` → `emitir`; si no → `consultar` y, con `NO_EXISTE`, `emitir`. Cada llamada con `PSE_TIMEOUT_MS`. Con `ACEPTADO`, guarda `xml` y `cdr` en `AlmacenComprobantes` (clave fija por comprobante: repetir sobrescribe lo mismo).
   - Paso 3 (transacción): vuelve a tomar la fila; si `intento_en_curso` es de otro worker o el envío ya está `TERMINADO`, termina sin escribir; si el arriendo quedó libre porque el barrido detuvo el envío por plazo mientras la llamada seguía en curso, un resultado final (`ACEPTADO` o `RECHAZADO`) se aplica igual y uno no final se descarta (ataque ronda 1, F8); si no, `resultado-pse.ts` aplica la tabla del criterio 127 con un `UPDATE comprobante … WHERE id = $1 AND estado IN (…)` (el disparador de transiciones es la red), inserta los `intento_pse`, calcula `proximo_intento_en` con `proximoIntento` de `packages/dominio` o deja `TERMINADO`, suelta el arriendo y registra con `alConfirmar` el evento `comprobante.estado`, el siguiente `encolar` con `startAfter` y, con un rechazo, la alerta.
   - Con una nota `ANULACION` (o la de un cambio) aceptada, en el mismo paso 3 pasa el original a `ANULADO` (criterio 152).
   - Con `ACEPTADO`, en el mismo trabajo y después del paso 3 arma el PDF (criterio 159) y lo guarda con `pdf_clave` en una transacción corta aparte; si falla, el barrido lo reintenta (comprobantes `ACEPTADO` sin `pdf_clave`).
4. **Barrido** (`setInterval` de 60 s en el worker, `unref`, como la revisión de puentes de 3b; las pruebas llaman a `barrerAhora()`): pide `EmpresasConsulta.ids()` y por cada empresa abre `ContextoEmpresa.ejecutar` con el actor `worker:envio-pse` y: (a) selecciona hasta 500 envíos `PENDIENTE` o `ESPERANDO_RESPUESTA` con `proximo_intento_en` ≤ ahora y sin arriendo vigente y los encola después de confirmar; (b) pasa a `DETENIDO` los que llegaron a `plazo_hasta` sin terminar y sin la marca `reintento_manual_en` (F1, abajo); (c) marca las alertas nuevas con `alertaDe` (`alertado_en`, `alerta`, `alertas_previas`) y las publica; la consulta ya excluye los comprobantes cuyo motivo actual se publicó antes, así que los ya tratados no ocupan el cupo de 1000 (F5 y F7, abajo); (d) reencola el PDF de los `ACEPTADO` sin `pdf_clave`, hasta 20 por vuelta: primero los nunca intentados, después los de intento más antiguo, sin los intentados hace menos de 10 minutos (`pdf_intentado_en`; F7 y H3, abajo). Con varias instancias del worker, los `UPDATE` condicionados y `singletonKey` evitan dobles efectos.
5. **Por qué no hay duplicados:** el identificador ante el PSE es fijo; el segundo intento siempre consulta; un solo worker trabaja un envío a la vez (fila + arriendo); un resultado tardío de un arriendo vencido se descarta; un trabajo de un envío `TERMINADO` no hace nada.

**Ataque adversarial, ronda 1 (mecanismos elegidos):**

- **F1, reintento manual de un `DETENIDO` (criterios 130 y 132).** Columna `envio_pse.reintento_manual_en timestamptz` (migración 15): `EnviosService.reintentar` la fija con el reloj de la API junto con `proximo_intento_en` y el paso a `PENDIENTE`; `detenerVencidos` del barrido no toca un envío que la tenga (`reintento_manual_en IS NULL` en su `WHERE`); el paso 1 del procesador la limpia al tomar el envío. Si ese intento falla pasado el plazo, `resultado-pse.ts` ya lo deja `DETENIDO` sin `proximo_intento_en` (no se reintenta solo). El barrido sigue reencolando el envío con la marca, así que no queda huérfano.
- **F5, una alerta por comprobante y motivo (criterio 133).** Columna `envio_pse.alertas_previas text[] NOT NULL DEFAULT '{}'` con `CHECK` de los cuatro motivos (migración 15): `alerta` sigue siendo el último motivo publicado (y `alertado_en` su instante); `alertas_previas` guarda los anteriores. Los motivos ya publicados son `alertas_previas` más `alerta`; una alerta se publica solo si su motivo no está ahí, y al publicarla el `alerta` anterior pasa a `alertas_previas`. Lo usan igual el paso 3 del procesador y el barrido (`UPDATE … WHERE NOT ($motivo = ANY (alertas_previas || alerta))` evita el doble aviso con dos workers).
- **F7, cupos del barrido (criterios 133 y 159).** Alertas: la consulta de `alertar()` calcula el motivo con `sqlAlerta` y excluye los ya publicados antes del `LIMIT 1000`. PDF: la ronda 1 recordaba en memoria los fallos del barrido; la ronda 2 (H3, abajo) lo reemplazó por `comprobante.pdf_intentado_en`.
- **F6, `pdf_clave` ajena (criterios 165 y 167).** `PanelService.archivoDelPdf` solo entrega una clave que empiece con `comprobantes/<empresaId>/<comprobanteId>/` (la ronda 2, H2, la endureció a igualdad exacta); si no, 409 `PDF_NO_DISPONIBLE` (también en `…/enlace`), como ya hacía la ruta pública. No se agregó un `CHECK` en la base: la prueba protegida del ataque pone a propósito la clave de otra empresa con el rol de la API para comprobar que la ruta no la sirve, y un `CHECK` la haría imposible.
- **F2, F3 y F4.** `lineaNotaEntradaSchema.posicion` es entero de 1 a 9999 (`POSICION_MAXIMA_LINEA`); `decodificarCursor` exige un instante real (no mes 13 ni 30 de febrero); el reintento manual valida su cuerpo con `reintentoEntradaSchema` (`z.strictObject({}).optional()`): sin cuerpo o `{}` es 202, cualquier otro es 400 `DATOS_INVALIDOS`.
- **Entorno (desarrollo).** `ARCHIVOS_COMPROBANTES_DIRECTORIO` no puede ser `ARCHIVOS_DIRECTORIO` ni quedar dentro (la API sirve esa carpeta en `/archivos`), validado en `entorno.ts` con el almacén en disco, igual que en R2 los buckets deben ser distintos.

**Ataque adversarial, ronda 2 (mecanismos elegidos):**

- **H2, `pdf_clave` con `..` y almacén R2 (criterios 131, 165 y 167).** Las rutas `GET /facturacion/comprobantes/:id/pdf`, `…/enlace` y la pública `GET /publico/comprobantes/:sello` solo sirven el PDF si `pdf_clave` es **igual** (no prefijo) a `comprobantes/<empresaId>/<comprobanteId>/representacion.pdf` (`esClaveDelPdfDe`); si no, 409 `PDF_NO_DISPONIBLE` (404 en la pública). Un `..` no se pasa por un prefijo porque un bucket R2 resuelve la URL a la carpeta de otra empresa. Además, el patrón de claves válidas que tenía el almacén en disco pasó a `nucleo/archivos/almacen-comprobantes.ts` (`esClaveValidaDeComprobante` / `exigirClaveValidaDeComprobante`: segmentos `[A-Za-z0-9_-]+` separados por una barra, extensión opcional al final, máximo 300) y lo exigen igual el almacén en disco, el de memoria y `AlmacenComprobantesR2`: `leer` y `guardar` lanzan `RangeError` ante `..`, `.`, segmentos vacíos, barra inicial o final, `\`, espacios, `?`, `#`, `%` o la clave vacía, antes de firmar ni pedir nada al bucket.
- **H3, el barrido de PDF no se bloquea (criterio 159).** Reemplaza el recuerdo en memoria de la ronda 1 (F7). Columna `comprobante.pdf_intentado_en timestamptz` (migración 16) con `GRANT UPDATE` por columna a `restaurante_api` solo para ella. `ArchivadorDePdf.pendientes()` **reclama** el lote en una sola sentencia: `UPDATE comprobante SET pdf_intentado_en = ahora WHERE id IN (SELECT id … WHERE estado IN ('ACEPTADO','ANULADO') AND pdf_clave IS NULL AND (pdf_intentado_en IS NULL OR pdf_intentado_en <= ahora − 10 min) ORDER BY pdf_intentado_en NULLS FIRST, emitido_en DESC, id LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id`. Primero van los nunca intentados (los aceptados nuevos, los más recientes antes), después los de intento más antiguo; ningún fallo se excluye para siempre, se turnan cada 10 minutos como mínimo. `FOR UPDATE SKIP LOCKED` evita que dos workers tomen el mismo lote y un worker que muere a medias no deja nada bloqueado (su marca vence a los 10 minutos). El PDF sigue siendo idempotente (clave fija). Índice parcial `comprobante_sin_pdf_idx`. `recordarFallo` desaparece. Un PDF que falla en el propio worker al aceptarse queda con `pdf_intentado_en` nulo, así que el barrido lo ofrece en la vuelta siguiente.
- **S1, arriendo frente a `PSE_TIMEOUT_MS` (criterio 125).** El arriendo del envío ya no es una constante: `arriendoDelEnvioMs(PSE_TIMEOUT_MS) = max(2 min, 2 × PSE_TIMEOUT_MS + 30 s)` (con el valor por defecto de 30 s sigue siendo 2 minutos; con el máximo de 120 s son 270 s). El entorno acepta cualquier `PSE_TIMEOUT_MS` de 1 s a 120 s.

**Orden de los tiempos:** arriendo = `max(2 min, 2 × PSE_TIMEOUT_MS + 30 s)` (función `arriendoDelEnvioMs`), siempre mayor que las dos llamadas al PSE (consultar y emitir) con su tiempo máximo más guardar archivos.

#### Conector, simulador y modo (120 a 123)

- `RegistroDeConectores.para(emisorId)`: sin fila en `configuracion_pse` → `{ modo: null }` y el paso 2 no llama a nadie: resultado `ERROR_CONFIGURACION` («facturación no activada»); `SIMULADO` → la instancia de `SimuladorPse` del proceso; `REAL` → el adaptador registrado con el código `PSE_CONECTOR` (en 6b no hay ninguno: el `PUT` que pide `REAL` responde 409 `PSE_NO_CONFIGURADO`). `crearAplicacion({ pse })` y `crearWorker({ pse })` devuelven esa instancia para cualquier modo (las pruebas configuran los emisores en `SIMULADO` o `REAL` y siempre hablan con el simulador inyectado).
- `armarDocumentoPse` es pura y se prueba sin red (pruebas del desarrollador): mismo comprobante → mismo documento, byte a byte.
- **Cifrado** (`nucleo/cifrado/cifrado.ts`): `sellar(texto, { proposito, datosAsociados })` = `version (1 byte) ‖ claveId (1 byte) ‖ iv (12) ‖ etiqueta (16) ‖ cifrado`, con la clave `HKDF-SHA256(CLAVE_CIFRADO, sal fija del sistema, info = proposito)`; `abrir` prueba la clave del `claveId` (actual o anterior) y falla con un error propio sin detalles. Los propósitos son `credencial-pse` (datos asociados `credencial-pse:<empresaId>:<emisorId>`) y `enlace-comprobante` (sin datos asociados: el sello lleva la empresa adentro). `CLAVE_CIFRADO` falta en producción → la API y el worker no arrancan (`exigirEntornoDeProduccion`).
- **Configuración PSE** (plataforma): el `PUT` del superadministrador corre en una operación de plataforma (conexión `restaurante_plataforma`, que tiene `INSERT` y `UPDATE` en `configuracion_pse`), cifra la credencial antes de escribirla y deja la fila de `auditoria` (`origen` `plataforma`) sin valores. `EmisoresService.configuracionPse(emisorId)` la lee con la conexión de la API (con el contexto de la empresa) y descifra; la usan solo `RegistroDeConectores` y el worker. Ningún esquema de respuesta tiene un campo para el valor.

#### Panel, alertas y reemisión (132 a 136)

- `GET /facturacion/comprobantes`: una consulta con los filtros y otra de conteos (`GROUP BY estado`), sobre el índice `(empresa_id, estado, emitido_en)`; paginación por cursor opaco (`emitido_en`, `id`) en base64url. El alcance (criterio 169) se resuelve como en 6a: el Cajero filtra por `turno_responsable_id`; el Supervisor por la sucursal activa; el Administrador por la lista de sucursales donde la sesión tiene rol Administrador (la da seguridad, sin leer otra tabla de facturación).
- `alertaDe` (pura) decide la alerta de cada fila; la consulta de `GET /facturacion/alertas` hace el mismo cálculo en SQL (los dos se prueban con los mismos casos).
- La reemisión copia las líneas con un `INSERT … SELECT` del rechazado (montos idénticos, sin recalcular) y llama a `SeriesService.tomarNumero` con el tipo nuevo; el cliente y el tipo se validan con las mismas funciones del cobro (criterio 51).
- **X y Z:** `ComprobantesService.resumenDeTurno` agrega `AND c.cobro_id IS NOT NULL` y devuelve además `notasCredito` (Σ de las notas con ese `turno_id`); `reportes-caja.ts` suma los egresos por medio (`SELECT medio, tipo, monto FROM movimiento_caja WHERE turno_id = $1`) y llama a `esperadoDelTurno` con el `medio` de cada movimiento.

#### Notas de crédito (143 a 157; ruta crítica P8)

Orquesta caja (`NotasCreditoService`, como el cobro); facturación calcula, numera y guarda. Una transacción:

1. Interceptores: 401, rol `EMITIR_NOTA_CREDITO`, sucursal, módulo `FACTURACION`, forma, IK, clave diferida (`@ClaveDespuesDeValidar({ cuerpo, uuids: ['comprobanteId'] })`, orden de 004).
2. Consultivo `<empresa>:nota-credito-id:<id>` y réplica por `id` en `nota_credito` (huella sin `total` ni `motivo`): 201 con `respuesta` o 422.
3. `EmisionService.prepararNotaCredito` (facturación): toma el original `FOR UPDATE` (404 / 403 alcance / 409 / 422 del criterio 146), lee las notas que cuentan y sus líneas (las de `comprobante_linea` con `posicion_origen` de las notas cuyo `afecta_a_id` es el original y que no tienen reemisión), arma la entrada y llama a `calcularNotaCredito`; compara `total` (409 `NOTA_CREDITO_CAMBIO`) y el objetivo de la autorización del Cajero (`exigirObjetivo`, 403 `AUTORIZACION_INVALIDA`).
4. Caja, si hay devolución, valida el turno y lo toma `FOR SHARE` (404, 409 `TURNO_CERRADO` / `TURNO_AJENO`), valida los pagos con `validarPagos` (422 `DEVOLUCION_INVALIDA`) y resuelve la caja de la operación y su impresora; sin devolución, la caja del original. El turno va **después** del original y **antes** del emisor, como en la tabla de cerrojos: por eso la emisión se divide en dos llamadas.
5. `EmisionService.numerarNotaCredito` (facturación): toma el emisor `FOR SHARE`; numera con la serie de la nota de la caja de la operación y el emisor del original (y en un cambio, después, la serie `FACTURA`); inserta la nota (y la factura) con sus líneas (`posicion_origen`), sus `envio_pse`, la cuota y los tickets (la gaveta si hay devolución en efectivo).
6. Caja inserta los `movimiento_caja` `EGRESO` (uno por pago, con `medio`, `operacion` y `comprobante_id`), el registro `nota_credito` con su respuesta, la auditoría `emitir_nota_credito` y registra `turno.cambio` con `alConfirmar`.

Si algo falla después de numerar, la transacción se revierte entera (número, cuota, egresos, tickets, envíos, autorización). Las réplicas simultáneas se turnan en el consultivo; dos notas distintas sobre el mismo original, en la fila del original.

#### Padrón (138 a 142)

- `CargaPadron.cargar()` corre en el worker (trabajo programado `padron-ruc` con `boss.schedule('padron-ruc', '0 4 * * *', null, { tz: 'America/Lima' })` y trabajo a pedido desde la ruta del superadministrador; política de cola de uno a la vez) con su propio pool de `pg` (`DATABASE_REFERENCIA_URL`, 1 conexión, sin la guarda de la API, como el adaptador de tiempo real), verificado al arrancar.
- Flujo: leer `padron_estado` → elegir la tabla inactiva → `TRUNCATE` → descargar con `fetch` en flujo → descomprimir en flujo → decodificar ISO-8859-1 → partir por líneas y por `|` → transformar → `INSERT … SELECT … FROM json_to_recordset($1)` en lotes de 5 000 filas (no `COPY`: PostgreSQL rechaza `COPY FROM` en una tabla con RLS para un rol que no es su dueño, y la RLS de `referencia` es obligatoria; sin `pg-copy-streams`; ver la medición más abajo) → contar (las inserciones con `ON CONFLICT (ruc) DO NOTHING`) → si filas ≥ 90 % de la carga anterior (o es la primera), `UPDATE padron_estado SET tabla_activa = …` en una transacción; si no, `ultimo_error`. Se registran tiempos y filas, nunca contenidos.
- `ubigeo.csv` se carga en `referencia.ubigeo` si la tabla está vacía o su `version` es otra que la del archivo.
- `PadronService.buscar(ruc)`: `SELECT * FROM padron_buscar_ruc($1)` con la conexión de la API dentro del contexto de la petición (la función no lee ni escribe tablas de clientes).
- Sin ninguna carga, `padron_buscar_ruc` falla con el estado `RF503` y el servicio responde 503 `PADRON_NO_DISPONIBLE`. La descompresión en flujo usa `unzipper` (analiza el ZIP según llega, sin guardar el archivo). Solo una carga a la vez aunque haya dos procesos: cerrojo consultivo en la conexión de la carga.
- `GET /plataforma/padron` lee el estado por `public.padron_estado()` (`SECURITY DEFINER`, `STABLE`, cinco columnas, `EXECUTE` solo para `restaurante_plataforma`): plataforma no tiene `USAGE` en `referencia` y la API no necesita `DATABASE_REFERENCIA_URL`. `POST /plataforma/padron/carga` deja `cargar_padron` en `auditoria` y, después de confirmarla, hace `boss.send('padron-ruc')` en una cola de política `exclusive` (una carga esperando o en curso a la vez); el worker la procesa con `boss.work` y programa `boss.schedule('padron-ruc', '0 4 * * *', …, { tz: 'America/Lima' })` al iniciar.
- `apps/api/datos/ubigeo.csv`: los 1 892 distritos del catálogo del INEI (`codigo,departamento,provincia,distrito`); su versión es el comienzo de su SHA-256.
- **Medición con el archivo real (pregunta 36, 2026-11-06, T36).** `CargaPadron` con la dirección por defecto (`https://www2.sunat.gob.pe/padron_reducido_ruc.zip`) en una base nueva de PostgreSQL 16.15 local (4 CPU, 16 GB de memoria, disco local), desde el entorno de pruebas del agente: el ZIP pesa 394 763 859 bytes (376 MiB) y trae **18 513 202 filas** de RUC (de 11 dígitos; se cargan todas, opción (a)). Tiempo de punta a punta: **217 s** leyendo el ZIP de un archivo local y **206 s** descargándolo por la red del entorno (la descarga corre en flujo a la vez que se inserta; la base es el límite, unas 90 000 filas por segundo). Memoria del proceso: unos **275 a 285 MB** de RSS en el punto más alto, con el archivo sin guardar entero (el proceso de la medición incluye `tsx` y las bibliotecas). Cada tabla ocupa **1 797 MB** de datos y **2 539 MB** con el índice de la clave primaria, así que las dos tablas alternas juntas son de unos **5 GB** (más el WAL de la carga). Una búsqueda de `padron_buscar_ruc` tarda de 0.3 a 2 ms con las 18.5 millones de filas. De cada 100 filas, unas 85 no tienen ubigeo ni dirección (personas naturales, bajas): así viene el archivo, y la dirección es `null` en esos casos. Esto sale del entorno de pruebas; **pendiente antes de producción**: repetirlo en la base administrada del plan elegido (espacio de 5 GB y más el WAL, tiempo con su disco y su red). Si no cabe, el plan B es no cargar las bajas definitivas (1.1 millones de filas) o las bajas de oficio (2.9 millones), con el aviso «no figura» en lugar de «baja».
- **Decisiones de T36 fuera del texto de la especificación** (para el orquestador): (1) `INSERT … json_to_recordset` en lugar de `COPY` y sin `pg-copy-streams` (la RLS de `referencia`, que la prueba protegida exige, impide `COPY FROM` a `restaurante_referencia`); (2) `public.padron_estado()` para `GET /plataforma/padron`; (3) el 503 sale del estado `RF503` de la función de búsqueda; (4) `padronAl` es el instante de la carga (ISO 8601), no solo la fecha.

#### PDF y enlace (159 a 161)

- `PdfComprobantes.armar(comprobante, { urlConsulta })` usa `pdfkit` (fuentes estándar Helvetica, que cubren las tildes) y `qrcode` (QR como imagen PNG en memoria). Se prueba con pruebas del desarrollador que extraen el texto del PDF.
- `EnlacesComprobante.sellar({ empresaId, comprobanteId, expiraEn })` y `abrir(sello)` con `Cifrado` (propósito `enlace-comprobante`). La ruta pública: abre el sello (falla → 404), `ContextoEmpresa.ejecutar(empresaId, …, { actor: { sistema: 'publico:comprobante' } })` de solo lectura, lee `pdf_clave` del comprobante, lo lee del almacén privado y lo responde. Ninguna consulta sin empresa nueva.

#### Ticket definitivo (162)

- `documentoDeComprobante` recibe `{ leyenda: { tipoTexto, urlConsulta, simulado } }`; la emisión la arma con el conector del emisor (`RegistroDeConectores.para(emisorId).conector.urlConsulta()`; sin configuración, `null`).
- **Plan B** (si el contador exige el `hash`, fuera de 6b): la emisión encola un trabajo `GAVETA` (con `turno_id`) cuando hay efectivo y no el ticket; el paso 3 del worker encola el ticket con el `hash` al aceptar; la PWA dice "El ticket se imprimirá cuando SUNAT acepte" y alerta si tarda más de 2 minutos.

#### PWA de 6b (173 a 181)

- Todo `src/modulos/facturacion/` con `lazy()`; nada de 6b entra en el paquete inicial (solo el destino "Comprobantes" dentro de Caja y Ajustes, que ya están).
- `comprobante.estado` invalida la consulta del comprobante y del panel; `facturacion.alerta` invalida `GET /facturacion/alertas`.
- La nota de crédito usa `calcularNotaCredito`, `validarPagos` y `redondeoEfectivo` de `@restaurante/dominio/caja` con lo que trae `GET /comprobantes/:id` (`lineas`, `acreditado`), y conserva el `id` hasta una respuesta final (como el cobro).
- `ClienteFactura` consulta el padrón al completar 11 dígitos válidos (con un pequeño retardo) y guarda la marca "Emitir igual" solo en el formulario.

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
| (6b) `envio_pse` en la transacción + pg-boss con `alConfirmar` + barrido | Insertar el trabajo de pg-boss en la transacción del cobro; sondear `envio_pse` sin cola | Lo primero exige privilegios de `restaurante_api` sobre un esquema sin RLS; lo segundo deja a pg-boss sin uso (CLAUDE.md pide colas con pg-boss) y obliga a sondear todas las empresas cada pocos segundos. |
| (6b) Arriendo de 2 minutos y tres pasos | Una transacción abierta durante la llamada al PSE | No retiene filas ni conexiones durante 30 s; un worker caído no bloquea el envío para siempre. |
| (6b) Consultar antes de emitir desde el segundo intento | Confiar en que el PSE rechace los repetidos | Cada PSE trata distinto un documento repetido; consultar no depende de eso. |
| (6b) Barrido por empresa con la lista de plataforma | Una función `SECURITY DEFINER` que liste envíos vencidos de todas las empresas | No abre otro canal entre empresas; con 30 empresas basta (riesgo aceptado si crece). |
| (6b) Rutas en `/facturacion`, `/notas-credito`, `/padron` | Bajo `/comprobantes` | La prueba protegida del criterio 98 falla con cualquier ruta nueva bajo `/comprobantes`. |
| (6b) Nota de crédito orquestada por caja, en dos llamadas a facturación | Todo en facturación | La devolución toca el turno y `movimiento_caja` (de caja), y el turno debe bloquearse entre el original y el emisor. |
| (6b) Montos de la nota con una función propia (`calcularNotaCredito`) | Reusar `calcularParte` | Las notas parten de las líneas del comprobante (no de la cuenta), admiten la anulación con gratuitas y deben llevar `posicionOrigen`; la regla proporcional es la misma del criterio 17. |
| (6b) PDF propio en el worker | El PDF del PSE | Igual para cualquier PSE y para el simulador; sin servicios externos (RNF-18). |
| (6b) Sello cifrado como enlace público | Fila de enlace con un token buscado por una función entre empresas | Sin función ni motivo `sinEmpresa` nuevos; el costo es no poder revocarlo. |
| (6b) Padrón en dos tablas alternas con un rol propio | Una tabla con `DELETE` + `COPY` en una transacción; renombrar tablas | El rol de la carga no necesita DDL; las búsquedas nunca esperan ni ven una carga a medias. |
| (6b) Credencial con AES-256-GCM en la aplicación y HKDF | `pgcrypto` | La clave nunca viaja a la base ni a sus registros de consultas. |

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

6b, en este orden (cada `down` deshace solo lo suyo; ninguna escribe datos de clientes; los roles `restaurante_colas` y `restaurante_referencia` y el esquema `colas` los crea `db:preparar`, no una migración):

9. `202611060001-facturacion-electronica.ts` (facturación y caja): en `comprobante`, `cobro_id`, `turno_id` y `detalle_parte` admiten nulo; `tipo` con las notas; las columnas nuevas y los `CHECK` del modelo de datos (escritos para la prueba de catálogo de 002); el disparador `comprobante_transicion`; el índice único de `reemplaza_a_id`; el `GRANT UPDATE (…)` de las columnas de respuesta; `comprobante_linea.posicion_origen`; `serie.tipo` y `serie_forma_ck` con las notas; `movimiento_caja.operacion` y sus `CHECK`. Su `down` vuelve a poner los `NOT NULL` y los `CHECK` de 6a y **falla si ya hay notas, reemisiones o facturas de cambio** (por diseño, como la migración 7).
10. `202611060002-envios-pse.ts` (facturación): `envio_pse` e `intento_pse` con `sqlTablaDeEmpresaTrazable`.
11. `202611060003-configuracion-pse.ts` (plataforma): `configuracion_pse` (`privilegiosApi: ['SELECT']`, `privilegiosPlataforma: ['SELECT', 'INSERT', 'UPDATE']`).
12. `202611060004-padron.ts` (facturación): esquema `referencia` (dueño el migrador; `USAGE` solo para `restaurante_referencia`), `padron_ruc_a`, `padron_ruc_b`, `padron_estado` (sin filas: la primera carga crea la única con `INSERT … ON CONFLICT`), `ubigeo`, sus políticas y privilegios, y `public.padron_buscar_ruc(text)`.
13. `202611060005-notas-credito.ts` (caja): `nota_credito` con `sqlTablaDeEmpresaTrazable`.
14. `202611060006-padron-cargado-en.ts` (facturación): `public.padron_cargado_en()`.
15. `202611060007-ataque-6b-ronda1.ts` (facturación): `envio_pse.reintento_manual_en` y `envio_pse.alertas_previas` (ver «Ataque adversarial, ronda 1»).
16. `202611060008-ataque-6b-ronda2.ts` (facturación): `comprobante.pdf_intentado_en` con `GRANT UPDATE` por columna y el índice parcial `comprobante_sin_pdf_idx` (ver «Ataque adversarial, ronda 2»).

`db:migrar` y `db:revertir` de las cinco y otra vez `db:migrar` en una base sin datos dan el mismo esquema (lo verifica el tester en T49). `db:preparar` crea los dos roles nuevos con contraseña (`DB_PASSWORD_COLAS`, `DB_PASSWORD_REFERENCIA`, con valor de desarrollo en `development` y `test`) y el esquema `colas` con dueño `restaurante_colas`; corre dos veces sin errores.

## Riesgos

- **Validación del contador** (B.19): cortesías, por consumo, 700, tasa, Nuevo RUS, redondeo, ICBPER. Mitigación: todo en funciones puras con pruebas; un cambio del contador es un cambio acotado.
- **Presupuesto de la PWA** con un margen de 13.8 kB (156.2 de 170 kB; 156.6 kB tras la fase A; ver "PWA"): alcanza para la navegación y las rutas bajo demanda, no para sumar dependencias al paquete inicial. Una medición con `NODE_ENV=test` o con la caché de Turborepo puede engañar: medir con `pnpm build --force`.
- **Contención de la serie y de la cuota** en horas punta: cada cobro mantiene el bloqueo de su serie y de `consumo_comprobantes` desde que numera hasta el `COMMIT` (milisegundos). Prueba de carga del tester: 50 cobros concurrentes en una sucursal en menos de 5 segundos.
- **Complejidad de las partes iguales con bolsas y afectaciones mixtas:** cubierta por ejemplos exactos en P1 y por `cambioDeCuentaPermitido`; el ataque debe buscar descuadres de céntimos.
- **Cambio de emisor de una sucursal con series:** cubierto por el criterio 5 (las series del emisor anterior no emiten).
- **Riesgos aceptados tras la revisión T26** (detalle en `spec.md`, "Riesgos aceptados propuestos"): el 422 `DIFERENCIA_SIN_MOTIVO` con todo en cero revela el esperado sin rastro (para revisar con el usuario); los montos de S/ 0.01 a 0.09 no se pagan en efectivo; el puente puede imprimir dos veces un ticket (3b).
- **Correcciones de código que esta documentación describe:** la empresa en la clave del cerrojo consultivo (hecha); el módulo del plan en la reimpresión de 004 (hecho, y se comprueba antes que el permiso); el 422 de la tasa en un emisor `NUEVO_RUS` (criterio 6); los tipos y parámetros del mostrador en la PWA (criterio 115); el total de partes en el equipo (criterios 65 y 113).
- **6b, primer uso de pg-boss y del worker:** roles, esquema propio, despliegue (un proceso aparte o `WORKER=habilitado` en el mismo contenedor). Mitigación: la cola solo despierta; la verdad está en `envio_pse` y el barrido la repara. En el despliegue, el worker y la API usan la misma imagen.
- **6b, padrón:** del orden de gigabytes y millones de filas, el doble durante la carga, en una base administrada (pregunta 36). Mitigación: solo las columnas necesarias, dos tablas alternas con `TRUNCATE` antes de llenar, medir en el entorno de pruebas antes de producción; plan B: no cargar las bajas definitivas. El formato del archivo de SUNAT puede cambiar: la carga valida y no cambia de tabla si algo no cuadra.
- **6b, PSE sin elegir:** el simulador cubre el contrato, no las rarezas de un PSE real (demoras, boletas que se aceptan en el resumen, errores de validación propios). T34 trae pruebas contra su ambiente de pruebas y revisa los tiempos (preguntas 27, 34 y 39).
- **6b, cálculo de notas de crédito con descuentos y partes:** cubierto por ejemplos exactos en P8 y por la regla proporcional del criterio 17; el ataque debe buscar céntimos que sobren al devolver en varias notas.
- **6b, efectos fuera de la transacción:** el ticket, el evento y el encolado siguen con `alConfirmar`; el PDF y los archivos se escriben fuera de la transacción del worker y sus claves fijas los hacen idempotentes.
- **6b, presupuesto de la PWA:** todo bajo demanda; se mide en cada cierre de fase.
- **Aviso operativo:** el contenedor de desarrollo se reinicia a menudo; las tareas de 6b se cierran por tramos con commit (`tasks.md`).
