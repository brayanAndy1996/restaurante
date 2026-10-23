# 003 — Carta y salón por local

Fecha: 2026-10-23. Estado: terminada. Riesgo alto. Contrato escrito antes del código y comunicado al equipo. Producto independiente; conserva ADR001/002. Solo nube técnica con PostgreSQL; modo local conserva diagnóstico. Sin comandas, cobros, consumo/reserva automática, impresión, KDS ni continuidad.

PEN/IGV incluido: priceCents entero 0..100000000 (hasta S/ 1000000), sin reglas de pago. Cantidad entera 0..1000000, inicialmente 0; available inicialmente false. effectiveAvailable = producto activo AND familia activa AND available AND quantity>0. Carta, precios y cantidades independientes por local.

## Contrato HTTP definitivo

Rutas bajo `/api/operations/sites/:siteId`. Sesión, Origin y CSRF como spec002; tenant derivado de sesión. Local activo y pertenencia explícita incluso administrador. UUID en identificadores. Listas `{items:[]}`, mutaciones devuelven entidad completa. Error `{error:{code,message}}`: 400 VALIDATION_ERROR, 401 AUTH_REQUIRED, 403 FORBIDDEN, 404 NOT_FOUND (ámbito ajeno), 409 CONFLICT (versión/ocupación/idempotencia), 405 METHOD_NOT_ALLOWED. Campos desconocidos rechazados.

| Método/ruta relativa | Entrada | Permiso |
|---|---|---|
| GET /families | — | carta.consultar |
| POST /families | code,name | carta.gestionar |
| PATCH /families/:id | version,code?,name?,active? | carta.gestionar |
| GET /products | — | carta.consultar |
| POST /products | code,name,familyId,priceCents | carta.gestionar |
| PATCH /products/:id | version,code?,name?,familyId?,priceCents?,active?,available? | carta.gestionar |
| POST /products/:id/quantity | version,quantity,reason | stock.ajustar |
| GET /sectors | — | carta.consultar o mesas.operar o salon.gestionar |
| POST /sectors | code,name | salon.gestionar |
| PATCH /sectors/:id | version,code?,name?,active? | salon.gestionar |
| GET /tables | — | carta.consultar o mesas.operar o salon.gestionar |
| POST /tables | code,sectorId,capacity,x?,y? | salon.gestionar |
| PATCH /tables/:id | version,code?,sectorId?,capacity?,x?,y?,active? | salon.gestionar |
| GET /waiters | — | mesas.operar |
| POST /attentions | requestId,tableId,waiterId,guests | mesas.operar |
| POST /attentions/:id/cancel | reason | mesas.operar |

Code: trim/minúsculas ASCII `[a-z0-9_-]{1,32}`, único por tipo/local. Name trim 1..80; motivo trim 1..240. Booleanos estrictos. version entero positivo (API 1..2147483646). Capacidad 1..100; guests 1..capacidad. Coordenadas opcionales null o enteros 0..10000. No borrado físico. Familia inactiva vuelve indisponibles sus productos. Sector inactivo conserva mesas y bloquea aperturas. Cualquier cambio de sector/mesa con atención activa se rechaza conservadoramente.

DTO familia/sector `{id,code,name,active,version}`. Producto `{id,code,name,familyId,priceCents,active,available,quantity,effectiveAvailable,version}`. Mesa `{id,code,sectorId,capacity,x,y,active,version,state:'free'|'occupied',attention:null|Attention}`. Attention `{id,tableId,waiterId,waiterName,guests,requestId,status:'active'|'cancelled',openedAt,cancelledAt,cancelReason}`. Waiter `{id,username}`. waiterName es snapshot del username verificado por backend. Waiters lista usuarios activos con pertenencia vigente al local y permiso explícito mesas.operar. GET /tables se agrupa con GET /sectors; no hay importe/cuenta económica.

Apertura requestId UUID único por tenant/local. Mismo body canónico(tableId,waiterId,guests) devuelve original incluso cancelada; body distinto: 409. La sesión vigente conserva obligación de permiso/pertenencia. Una sola atención activa por mesa por índice único parcial y transacción. Cancelar atención vacía con motivo libera mesa sin borrar historial. Esta versión no genera consumos; consumption_count=0 y condición explícita impiden cancelar si futuras comandas registran consumos. Esas comandas deberán actualizar el contador en su transacción antes de habilitarse.

## Persistencia, actualización y demo

Tablas families,products,sectors,dining_tables,attentions,quantity_adjustments,operation_events con tenant/site, FORCE RLS y FK compuestas. Todas las mutaciones insertan operation_events (incluye local y detalles necesarios) y audit_events en la misma transacción. Fallo de auditoría revierte. Mutex tenant vigente serializa autorización/mutaciones con administración. Ajuste de cantidad exige versión/motivo y conserva anterior/nuevo/versión/actor. Sin recetas/insumos/compras.

ADMIN_PERMISSIONS conserva cuatro originales; PERMISSIONS agrega carta.consultar,carta.gestionar,stock.ajustar,salon.gestionar,mesas.operar. Último administrador depende de cuatro originales, independientemente del total de permisos. Migración 004 amplía CHECK y crea rol operativo privado solo para cada administrador efectivo activo previo (unión de roles con los cuatro originales), sin ampliar roles compartidos/Consulta/inactivos. Revoca sesiones afectadas y audita una vez. Bootstrap nuevo usa catálogo completo. Readiness exige patch 004; servidor anterior debe reiniciarse tras migrar para no conservar catálogo antiguo.

Seed opcional solo en BD loopback restaurante_demo marcada demo. Migración comprueba fingerprint base previo antes de ampliarlo exclusivamente por su cambio esperado. Extensión de datos requiere demo base intacta y tablas operativas vacías; luego fingerprint operativo rechaza ediciones manuales sin sobrescribirlas. Dos locales A y uno B, menú con cantidades 12, 3 y 5 respectivamente y sectores/mesas propios. Usuario mozo por empresa con carta.consultar+mesas.operar, solo local principal. Consulta anterior conserva auditoria.consultar. No sembrar al arranque.

## Criterios de aceptación

- CA-01: sesión/permisos/local activo y pertenencia vigente; administrador sin pertenencia recibe 404.
- CA-02: carta/precios/stock por local; RLS/FK directas impiden cruce tenant/local.
- CA-03: céntimos/límites/defaults enteros y disponibilidad efectiva, incluida familia inactiva.
- CA-04: stock con versión/motivo; dos escritores concurrentes confirman solo uno; auditoría/historial atómicos.
- CA-05: estados/coordenadas/capacidad y bloqueo de cambios en mesa/sector ocupado; historial preservado.
- CA-06: apertura exige comensales<=capacidad y mozo activo/asignado/con permiso; nombre desde identidad.
- CA-07: una atención activa por mesa; reintento exacto conserva original y body cambiado: 409 incluso cancelada.
- CA-08: cancelación vacía con motivo libera mesa; consumo>0 impide cancelar; siguiente apertura usa requestId nuevo.
- CA-09: upgrade 002 amplía solo admin efectivo activo sin elevar roles compartidos/inactivos; revoca/audita una vez; bootstrap con nueve permisos y último administrador con cuatro permisos originales.
- CA-10: demo reproducible propia por local, repetición sin duplicados y rechazo de ediciones manuales.
- CA-11: frontend mínimo integrado y regresiones de acceso/check; local diagnóstico sin continuidad.

## Evidencia backend 2026-10-23

RED funcional real: `node --env-file-if-exists=.env.test --import tsx --test tests/operations.integration.test.ts` esperaba `{items:[]}` en GET /families y recibió NOT_FOUND 404 antes de implementar. EACCES inicial de sandbox no se cuenta como RED.

GREEN integración propia: 1/1: límites/defaults/estado efectivo, cantidades optimistas concurrentes, apertura/reintento/cancelación, cruce tenant/local, RLS/FK SQL directas, fallo de auditoría con rollback y LAST_ADMIN. Comando anterior tras implementar.

GREEN upgrade: 1/1: `node --env-file-if-exists=.env.test --import tsx --test tests/operations-upgrade.integration.test.ts`. Fixture temporal nueva `restaurante_test_upgrade_a5377c2137524328931f6ac6311e45e0`, owner restaurante_dev_admin, loopback 55432. Upgrade 002 a 004 repetido: admin con unión de dos roles recibe nueve permisos, rol compartido/limitado conserva un permiso, inactivo conserva cuatro permisos, sesión del administrador revocada, sesión limitada conservada, evento de auditoría único. Bootstrap nuevo con nueve permisos y protección LAST_ADMIN con cuatro permisos originales pasan. Conexiones cerradas y exclusivamente fixture creada eliminada; ninguna BD existente reutilizada/eliminada.

Revisión adversarial independiente: 1/1 con diez escenarios PostgreSQL/HTTP pasó: límites/trim, permisos/locales/mozo, consumo/idempotencia, revocación durante la espera del mutex observado, rollback de auditoría, RLS/FK/índice SQL. Normalización trim antes de longitud ajustada por hallazgo y verificada. Tipos y lint pasan. Demo, UI y verificaciones finales completadas.

Verificación adicional de CA10: suite `operations-upgrade.integration.test.ts` ahora 2/2. Segundo caso usa fixture nueva `restaurante_test_upgrade_e7279f5e3c104cb590da053b8fce918b`, crea esquema completo desde vacío, marca demo explícita y ejecuta la misma función transaccional interna de seed dos veces. Resultado: dos empresas, ocho usuarios, tres productos, tres mesas y cantidades 3/5/12. Edición manual cantidad provoca rechazo y conserva cantidad editada; restauración exacta de fixture permite repetir; edición manual nombre tenant provoca rechazo y conserva edición. CLI pública rechaza URL de la fixture por no ser restaurante_demo; su guarda no se amplía. Fixture creada eliminada tras cerrar conexiones y comprobar owner. Demo real marcada migrada con 004 y seed repetido con huellas base/operativas válidas. Sin datos reales ni mensajes externos.

## Cierre integrado

Tipos, lint, build, once pruebas HTTP/políticas y smoke del artefacto aprobados. Se corrigió la expectativa antigua de cuatro permisos del administrador para comparar exactamente el catálogo de nueve; las doce comprobaciones de integración de acceso y once adversariales anteriores pasaron sin debilitar la protección del último administrador. Las tres suites operativas pasaron: integración 1/1, adversarial 1/1 (diez escenarios) y upgrade/demo 2/2, sin omitidos.

QA de navegador con tenant temporal exclusivo de restaurante_test: selección explícita de local, familia, producto a S/ 18.25, disponibilidad manual con cantidad cero, ajuste a siete unidades que habilita disponibilidad efectiva, sector, mesa de capacidad cuatro, atención de dos comensales, bloqueo de edición mientras está ocupada, cancelación con motivo y retorno a libre; logout limpia la operación. Fixture propia eliminada después del recorrido. La demo real conserva sus datos reproducibles.

Roles efectivos: Sol medium para spec, backend y revisión adversarial independiente; Luna max para interfaz mínima. No se habilitan ventas, comandas, consumo automático, impresión ni continuidad por completar esta spec.
