# 006 · Plan técnico

Entregas 6a (caja, cobro y comprobante sin PSE) y 6b (facturación electrónica), pendientes de la aprobación del usuario. Los números entre paréntesis son criterios de `spec.md`; "pregunta N" remite a "Preguntas abiertas". Se ejecuta 6a completa y después 6b; la parte de 6b de este plan se precisa antes de empezarla.

## Módulos afectados

### Entrega 6a

- `packages/dominio`:
  - `src/caja/montos.ts` (ruta crítica P1): `desglosar`, `calcularCuenta`, `validarDescuento`, prorrateo por mayor resto (interno, exportado para sus pruebas como `repartirPorMayorResto`) (9, 11 a 16).
  - `src/caja/vigencias.ts` (P1): `tasaIgvVigente`, `montoIcbperVigente`, `MONTOS_ICBPER` (10).
  - `src/caja/partes.ts` (P1): `calcularParte`, `cambioDeCuentaPermitido` (17 a 20).
  - `src/caja/pagos.ts` (P1): `validarPagos`, `redondeoEfectivo` (21).
  - `src/caja/turno.ts` (P1): `esperadoDelTurno`, `diferenciasDelArqueo` (22).
  - `src/caja/letras.ts` (no crítico): `montoEnLetras` (23).
  - `src/caja/catalogos.ts`: medios, tipos, formatos, documentos, modos, estados y límites.
  - `src/regimen.ts`: `tiposDeComprobantePermitidos`.
  - Entrada propia `@restaurante/dominio/caja` en `package.json` (`exports`), como la de llamados de 005, para que la PWA la cargue bajo demanda.
  - Pruebas protegidas en `test/caja/`.
- `packages/contratos`: `src/caja.ts`, `src/comprobantes.ts`; cambios en `src/autorizaciones.ts` (`objetivo`), `src/impresion.ts` (tipos de trabajo y bloques `qr` y `gaveta`), `src/salon.ts` (campos opcionales de la pre-cuenta y del KDS), `src/errores.ts`.
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
  emision.service.ts             emitir(datos): número, filas, cuota, ticket
  facturado.ts                   facturadoDeOrden(ordenId): las partes anteriores

apps/api/src/modulos/pedidos/ (cambia)
  cuentas-de-pedidos.ts          cuentaParaCobrar, registrarCobro, abrirYEnviarMostrador (exportado)
  descuentos.controller.ts       /cuentas/:ordenId/descuentos…
  cortesias.controller.ts        /cuentas/:ordenId/cortesias…
  descuentos.service.ts, cortesias.service.ts
  cobros/cobros.puerto.ts        COBROS (validarCambio); registro al arrancar, falla cerrado
  llamados-mostrador.ts          contador_llamado
```

Dependencias: caja → pedidos (`CuentasDePedidos`), facturación (`EmisionService`, `facturadoDeOrden`), plataforma (`SuscripcionService`, `EmisoresService`, `SucursalesConsultaService`), impresión (`ImpresionPuerto`), seguridad. Facturación → plataforma, impresión. Pedidos no depende de caja: define `COBROS` y caja se registra al arrancar (como `UsoDeMesas` de salón); si nadie se registró, toda orden con `cobros > 0` rechaza el cambio (falla cerrado). Ningún módulo lee tablas de otro.

### Flujo del cobro (47 a 63; ruta crítica P2)

Una transacción por petición (`ContextoEmpresa`), con este orden fijo de bloqueos para no cruzarse con los envíos de 004 ni con el cierre: **orden → turno → serie → consumo de la cuota**.

1. Interceptores: 401, rol `COBRAR`, sucursal, módulo `CAJA`, forma (zod), IK (réplica guardada). Sin clave.
2. **Réplica por id:** busca `cobro` por `(empresa_id, id)`; si existe, compara la huella de la entrada normalizada (orden, parte, comprobante, pagos) y devuelve `cobro.respuesta` (201) o 422. Se hace antes de mirar el turno o la cuenta (55).
3. **Cuenta:** `CuentasDePedidos.cuentaParaCobrar(ordenId, { bloquear: true })` toma la orden con `FOR UPDATE` (el mismo bloqueo que los envíos, `bloqueos-orden.ts`); 404, 409 `ORDEN_NO_ABIERTA` (con la principal si está `UNIDA`). Compara `version` (409 `CUENTA_CAMBIO`).
4. **Turno:** `SELECT … FROM turno WHERE id = $1 AND sucursal_id = $2 FOR SHARE`: 404, 409 `TURNO_CERRADO`, 409 `TURNO_AJENO` (responsable o rol Supervisor o Administrador). `FOR SHARE` deja cobrar en paralelo en el mismo turno y espera al cierre, que toma `FOR UPDATE` (59).
5. **Parámetros:** emisor y régimen de la sucursal (`datosParaComprobante`), tasa vigente en la fecha de emisión (Lima, del reloj de la API) e ICBPER vigente; 409 `TASA_IGV_NO_CONFIGURADA`; 422 `COMPROBANTE_NO_PERMITIDO` en Nuevo RUS.
6. **Cálculo:** `calcularCuenta`, las partes anteriores con `facturadoDeOrden` (los `detalle_parte` de los cobros de la orden), `calcularParte`. Compara `total` (409 `CUENTA_CAMBIO`). Valida cliente (422 `CLIENTE_REQUERIDO`), pagos y redondeo (`validarPagos`, `redondeoEfectivo`; 422 `PAGOS_NO_CUADRAN`), topes (422 `MONTO_FUERA_DE_RANGO`). Todo esto antes de numerar, para que el bloqueo de la serie dure lo mínimo.
7. **Emisión:** `EmisionService.emitir` hace `UPDATE serie SET ultimo_numero = ultimo_numero + 1 WHERE caja_id = $1 AND tipo = $2 AND activa AND emisor_id = $3 RETURNING id, serie, ultimo_numero` (0 filas: 409 `SIN_SERIE`; `CHECK` de máximo: 409 `SERIE_AGOTADA`); inserta `comprobante` y `comprobante_linea`; llama a `registrarComprobanteEmitido`; arma el documento del ticket y lo encola con `ImpresionPuerto.encolar` (tipo `COMPROBANTE`, con el bloque `gaveta` al inicio si hay efectivo).
8. **Cobro y pagos:** inserta `cobro` (con `detalle_parte` y `respuesta`) y `pago`.
9. **Pedidos:** `CuentasDePedidos.registrarCobro` suma `item.cantidad_facturada`, `orden.monto_cobrado`, `orden.cobros`, fija `modo_cobro`, sube `orden.version` y, si `cierraLaCuenta`, deja la orden `CERRADA`, cierra `orden_mesa` y registra `salon.cambio` y `orden.cambio` con `alConfirmar`.
10. `alConfirmar`: `turno.cambio` y, desde impresión, `trabajo.nuevo` al puente.

Si cualquier paso lanza, la transacción se revierte entera: el número de la serie, el consumo de la cuota, el trabajo de impresión y los cambios de la orden (71, 73, 76). Las réplicas concurrentes con el mismo `id` chocan en la clave primaria de `cobro`: la segunda recibe 409 `CONFLICTO` por la traducción de 003 o, si llegó después del `COMMIT`, la réplica del paso 2 (56).

**Por qué el número no deja huecos:** la serie es una fila que se actualiza en la misma transacción; una reversión deshace el incremento. Las secuencias de PostgreSQL no sirven porque no se revierten. Dos cajas usan filas distintas (sus series), así que no compiten; dos cobros en la misma caja se turnan en esa fila hasta el `COMMIT`. El consumo de la cuota (`consumo_comprobantes`, una fila por sucursal y mes) también se turna, siempre después de la serie: el orden fijo evita interbloqueos.

### Partes y cambios después de cobrar (17 a 20, 64 a 68, 86 a 89)

- La API guarda en `cobro.detalle_parte` el resultado de `calcularParte`. `facturadoDeOrden` devuelve esos detalles en orden de creación y `calcularParte` calcula "lo que falta" restándolos de la cuenta actual. No hay otra fuente de verdad para lo cobrado.
- `orden.monto_cobrado`, `orden.cobros`, `orden.modo_cobro` e `item.cantidad_facturada` son copias que pedidos guarda para sus propias reglas sin leer tablas de caja: saber si una orden tiene cobros (unir, anular, descuentos) y mostrarlo en la cuenta.
- **Puerto `COBROS`:** antes de confirmar un envío, una anulación de ítem o una unión de una orden con `cobros > 0`, pedidos arma la cuenta que quedaría y llama a `COBROS.validarCambio(ordenId, cuentaNueva)`; caja lee las partes con `facturadoDeOrden` y aplica `cambioDeCuentaPermitido`; si no, 409 `CUENTA_COBRADA_EN_PARTE` y la transacción se revierte (la autorización de la anulación también). Unir y anular una orden con cobros se rechazan antes, sin llamar al puerto (409 `CUENTA_EN_COBRO`).
- En el mostrador no hay partes: la venta es un cobro `TOTAL`.

### Turno y cierre (24 a 35; ruta crítica P3)

- **Apertura:** `exigirAperturaDeCaja` primero; la caja con `FOR UPDATE` (turna las aperturas de una caja); los índices únicos parciales de `turno` son la red (409 `TURNO_YA_ABIERTO` traducido del `23505`). Réplica por `id` como el cobro.
- **Movimientos:** turno `FOR SHARE`, como el cobro.
- **Cierre:** bloquea con `FOR UPDATE` todos los turnos `ABIERTO` de la sucursal, en orden de id (así dos cierres simultáneos se turnan y el segundo ve que ya no hay otro abierto); si el suyo es el único y `PedidosConsultaService.hayOrdenesAbiertas` es `true`, 409 `CIERRE_BLOQUEADO` con `ordenesAbiertas(…).length`. Calcula el esperado con los cobros y movimientos del turno (`esperadoDelTurno`), valida los motivos (422 con las diferencias, sin el esperado), inserta `turno_conteo`, cierra el turno, deja la fila `cerrar_turno` y encola el `REPORTE_Z`.
- El X y el Z se arman con `reportes-caja.ts` con un número fijo de consultas (sumas agrupadas por medio y por tipo en SQL, montos en `NUMERIC`; el esperado y las diferencias, con `packages/dominio`).

### Descuentos y cortesías con clave atada (38 a 46; ruta crítica P5)

- Rutas con `@ClaveDespuesDeValidar({ cuerpo, uuids: ['ordenId'] })`, `@IdempotenteObligatoria()`, `@RequiereModulo('SALON')` y `@Permiso('APLICAR_DESCUENTO' | 'APLICAR_CORTESIA')`, en ese orden (004, plan "Anular un ítem").
- `POST /autorizaciones` guarda `objetivo` normalizado (ids en minúsculas, `valor` con 2 decimales). El servicio de descuentos, después de bloquear la orden, compara `SesionActual.autorizacionConsumida().objetivo` con el objetivo del cuerpo usando `exigirObjetivo`; distinto o ausente → 403 `AUTORIZACION_INVALIDA`, y la reversión devuelve la autorización (como 004, criterio 36). Para el Supervisor y el Administrador no hay autorización que comparar.
- El descuento y la cortesía se validan con `calcularCuenta` y `validarDescuento` sobre la cuenta bloqueada; suben `orden.version` e invalidan la pre-cuenta con la misma función que las anulaciones (`precuenta-invalidacion.ts`).

### Venta de mostrador (79 a 85)

Una transacción: réplica por `id` (es el id de la orden); turno `FOR SHARE`; `CuentasDePedidos.abrirYEnviarMostrador` (pedidos: crea la orden `MOSTRADOR`, toma el número de llamado con `UPDATE contador_llamado … RETURNING` o lo crea con `INSERT … ON CONFLICT`, y corre el envío de 004 con sus validaciones, su puerto de inventario y sus comandas con el número de llamado en el documento); el mismo paso 5 a 9 del cobro con `parte: TOTAL`. Si los pagos o el total fallan, se revierte también el envío: ninguna comanda sale a cocina sin cobro (las comandas y sus trabajos de impresión se publican con `alConfirmar`).

### Impresión y gaveta (90 a 96)

- Documentos nuevos en `escpos/plantillas/`: `comprobante.ts` (con el QR y "SON: …"), `reporte-caja.ts` (X y Z) y `gaveta.ts` (solo el bloque `gaveta`, sin avance ni corte).
- Bloque `gaveta`: el renderizador emite `ESC p 0 25 250` solo si la impresora tiene `gaveta: true`, el trabajo no es una reimpresión, es su primera entrega (`entregado_en` nulo) y han pasado menos de `SEGUNDOS_PULSO_GAVETA` desde `creado_en` (reloj de la API). Se marca `entregado_en` en la misma consulta que entrega el lote. El pulso nunca sale de un texto: es un bloque estructural, como las marcas de 3b.
- Bloque `qr`: texto de hasta 300 caracteres; `GS ( k` modelo 2. El emulador lo decodifica como `[QR] <texto>`.
- La impresora de cada trabajo de caja es `caja.impresora_id` o, si es nula, `impresion_sucursal.impresora_caja_id` (`impresoraDeLaCaja`).

### Tiempo real (97)

`turno.cambio` y los de 004 con `PublicadorEventos` y `alConfirmar`; la PWA invalida las consultas de la caja y de "Por cobrar".

### PWA (108 a 119)

- Todo `src/modulos/caja/` con `lazy()`; `@restaurante/dominio/caja` y `decimal.js` solo en esos bloques. En el paquete inicial entran solo el destino de la navegación y la ruta.
- **Presupuesto:** T1 midió la línea de base el 2026-11-04 (HEAD `6ec7f79`, `pnpm --filter @restaurante/app build && pnpm --filter @restaurante/app presupuesto`): el paquete inicial pesa **156.2 kB gzip** (límite 170 kB; kB de 1024, como los mide `scripts/presupuesto.mjs`): `index-*.js` 111.0 kB, `identidad-*.js` 41.9 kB, `salon-*.js` 2.1 kB, `preload-helper-*.js` 0.8 kB y `rolldown-runtime-*.js` 0.4 kB, con 92 bloques bajo demanda. **El margen real es de 13.8 kB**, no casi nulo como se estimó con un registro viejo (174.08 kB según Vite, que mide en kB de 1000 bytes). Lo nuevo del paquete inicial es solo el destino "Caja" de la navegación, su ruta y el aviso de la guía de primeros pasos; el resto (`@restaurante/dominio/caja` y `decimal.js` incluidos) va bajo demanda. Si no cupiera, el revisor propone subir el límite con su motivo y el orquestador lo decide.
- Los cobros usan la cola de "Pendiente de envío" de 003 con el `id` del cobro conservado hasta una respuesta final (como el envío de 004).
- Las partes pendientes y la caja elegida se guardan en el almacenamiento del equipo por persona.

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
| `version` y `total` del cliente comparados en el servidor | Confiar en el total del cliente; no comparar | El servidor recalcula siempre; la comparación evita cobrar un monto que la persona no vio. |
| Puerto `COBROS` registrado por caja en pedidos | Que pedidos lea `cobro` | Cada módulo es dueño de sus tablas; falla cerrado si caja no se registró. |
| Comparar el objetivo de la autorización en las rutas de descuentos | Cambiar `AutorizacionService.consumir` | Las pruebas protegidas de 002 consumen `APLICAR_DESCUENTO` sin objetivo; así no cambian. |
| Turno `FOR SHARE` en cobros y `FOR UPDATE` en el cierre | Bloqueo consultivo por turno | Usa filas que ya existen; los cobros de un turno no se turnan entre sí. |
| Cierre que bloquea los turnos abiertos de la sucursal en orden de id | Contar sin bloquear | Dos cierres simultáneos dejarían la sucursal sin turno con mesas abiertas. |
| Pulso de gaveta como bloque del ticket con ventana de 120 s | Trabajo aparte siempre | Un trabajo aparte sale en un orden no garantizado frente al ticket; dentro del ticket va primero y no se repite en reimpresiones. |
| Entrada `@restaurante/dominio/caja` | Importar desde el índice | La PWA no tiene margen en el paquete inicial. |

## Migraciones

En este orden (6a); `down` de cada una deshace solo lo suyo. Ninguna escribe datos.

1. `202611040001-tasa-igv.ts` (plataforma): `emisor_tasa_igv`.
2. `202611040002-caja.ts` (caja): `caja`, `turno`, `turno_conteo`, `movimiento_caja`.
3. `202611040003-facturacion.ts` (facturación): `serie`, `comprobante`, `comprobante_linea`; privilegio de `UPDATE` de `comprobante` solo en `estado` y `actualizado_*`.
4. `202611040004-cobros.ts` (caja): `cobro`, `pago`.
5. `202611040005-cuentas-pedidos.ts` (pedidos): `descuento`, `cortesia`, `contador_llamado`; columnas nuevas de `orden` e `item` con sus `CHECK`.
6. `202611040006-autorizacion-objetivo.ts` (seguridad): `autorizacion.objetivo`.
7. `202611040007-impresion-caja.ts` (impresión): `CHECK` de `trabajo_impresion.tipo` con los cuatro tipos nuevos, `comprobante_id`, `turno_id` y sus índices únicos parciales.

6b agrega las suyas (envíos, resultados, notas de crédito, padrón y el esquema de pg-boss con su rol en `db:preparar`).

## Riesgos

- **Validación del contador** (B.19): cortesías, por consumo, 700, tasa, Nuevo RUS, redondeo, ICBPER. Mitigación: todo en funciones puras con pruebas; un cambio del contador es un cambio acotado.
- **Presupuesto de la PWA** con un margen de 13.8 kB (156.2 de 170 kB; ver "PWA"): alcanza para la navegación y las rutas bajo demanda, no para sumar dependencias al paquete inicial.
- **Contención de la serie y de la cuota** en horas punta: cada cobro mantiene el bloqueo de su serie y de `consumo_comprobantes` desde que numera hasta el `COMMIT` (milisegundos). Prueba de carga del tester: 50 cobros concurrentes en una sucursal en menos de 5 segundos.
- **Complejidad de las partes iguales con bolsas y afectaciones mixtas:** cubierta por ejemplos exactos en P1 y por `cambioDeCuentaPermitido`; el ataque debe buscar descuadres de céntimos.
- **Cambio de emisor de una sucursal con series:** cubierto por el criterio 5 (las series del emisor anterior no emiten).
- **6b:** primer uso de pg-boss y del worker (roles, RLS, despliegue), tamaño del padrón (cientos de MB) en la base administrada, y la elección del PSE.
