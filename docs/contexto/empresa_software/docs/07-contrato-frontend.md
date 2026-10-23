# 07 — Contrato backend/frontend comercial del panel, v1 de diseño

Estado: este documento conserva el **contrato de diseño para módulos comerciales**, cuyas operaciones aún no están implementadas. El acceso nativo, usuarios/roles, permisos y auditoría de la versión 0.2.0 sí cuentan con contrato ejecutable; su fuente vigente es la [spec 002](specs/002-acceso-nativo.md). La tabla de operaciones y los DTOs de este documento no describen la API disponible para esos módulos comerciales. El transporte propuesto es una fachada tipada consumible mediante preload/IPC de Electron; sus handlers llamarían casos de uso del backend. Una futura API HTTP puede adaptar esos mismos casos, sin trasladar reglas a la UI. Las terminales LAN de otros productos requerirán su transporte propio.

## Convenciones

- IDs opacos UUID como cadenas. Entradas/salidas públicas independientes de modelos Sequelize; no exponer instancias ORM, rutas internas, hashes o secretos.
- País de venta: Perú. Moneda única inicial `PEN`; importes enteros en céntimos (`15000` = S/ 150.00), con operaciones aritméticas exactas y validación de rango. Precios **incluyen IGV**; no añadir IGV nuevamente. La tasa/desglose fiscal no se presupone y se especificará al abordar facturación.
- Mostrar `es-PE` y `America/Lima`. Instantes como ISO 8601 UTC; fechas de negocio como `YYYY-MM-DD`. Evitar convertir una fecha de vencimiento en un instante UTC ambiguo.
- Ciclo mensual desde fecha de alta, sin prorrateo automático. Conservar día ancla original; si no existe en un mes, usar su último día, recuperando el ancla en el mes siguiente. Ejemplo: 31 de enero → último día de febrero → 31 de marzo.
- Periodos `[inicio, fin)`; vencimiento propuesto al inicio del periodo. La spec de cobranza detallará la hora de corte y días de gracia antes de automatizar mora.
- Cambios ordinarios de módulos/precios aplican al siguiente ciclo; registrar desde cuándo. La cuota emitida conserva sus importes y líneas históricas. Un ajuste inmediato necesita un flujo explícito, no prorrateo implícito.
- Listados con `page` (desde 1), `pageSize` (por defecto 20, máximo 100), filtros y orden permitido. Respuesta: `items`, `page`, `pageSize`, `total`.
- Mutaciones con `requestId` para trazabilidad; operaciones monetarias y emisión de cuotas/licencias además con clave de idempotencia persistida. Repetir la misma clave/payload devuelve el resultado original; otra carga con la misma clave produce conflicto.
- Ediciones usan `expectedVersion` para detectar cambios concurrentes. Todos los contratos incluyen validación en backend. La UI puede reflejar validaciones para mejorar uso.

## Respuestas y errores

```ts
type Result<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: {
      code: string; message: string;
      fields?: Record<string, string[]>;
    }; requestId: string };

type Money = { currency: 'PEN'; amountMinor: number };
```

Estos tipos son ilustrativos; no son un SDK ejecutable. Códigos estables: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `DEPENDENCY_REQUIRED`, `MODULE_UNAVAILABLE`, `INSUFFICIENT_ENTITLEMENT`, `PAYMENT_EXCEEDS_BALANCE`, `LAST_ADMIN_REQUIRED`, `INTERNAL_ERROR`. No devolver stack traces ni SQL. El backend deriva actor/sesión; un `actorId` enviado por la UI no autoriza nada.

## Entidades públicas mínimas

| DTO | Campos relevantes |
|---|---|
| Company | id/tenantId, RUC como texto, razón social, contacto, dirección, estado comercial, version |
| Site | id, tenantId, nombre, dirección, estado, version |
| Product | id, code, nombre, estado comercial |
| Module | id, productId, code, nombre, dependencias, estado de disponibilidad, precio de referencia |
| Plan | id, productId, nombre, basePriceMinor, módulos incluidos, límites, estado, version |
| Subscription | id, tenantId, productId, planId, estado contractual, fechas, día ancla, módulos/precios acordados, límites, total mensual, version |
| Quote | composición base + adicionales, moneda, total mensual y advertencias de disponibilidad/dependencias |
| Charge | id, subscriptionId, periodo, vencimiento, líneas/precios históricos, totalMinor, paidMinor, balanceMinor, estado derivado |
| Payment | id, chargeId, amountMinor, método manual, fecha de operación, referencia, estado, auditoría de reversión |
| Installation | id, subscriptionId, tenantId, productId, siteId, estado, última versión informada y fecha |
| LicenseSummary | id, installationId, revisión, módulos/límites concedidos, vigencia, estado de emisión; sin clave privada |

RUC y contacto comercial no reemplazan `tenantId`. No hay campos de tema/logo en Company del panel. El estado contractual, la deuda y la validez de una licencia son dimensiones distintas.

## Operaciones de la fachada

| Grupo | Operaciones y entradas principales | Permiso requerido |
|---|---|---|
| Acceso | El contrato implementado de `auth.*` está definido en la [spec 002](specs/002-acceso-nativo.md); no usar esta tabla de diseño como catálogo ejecutable. | Reglas propias en spec 002 |
| Usuarios internos | `users.list/create/update/disable`, `roles.list/assign` | `plataforma.usuarios.ver/gestionar`, `plataforma.roles.asignar` |
| Empresas/locales | `companies.list/get/create/update`, `sites.list/create/update` | `plataforma.empresas.ver/gestionar` |
| Catálogo | `products.list`, `modules.list`, `plans.list/create/update` | `plataforma.catalogo.ver/gestionar` |
| Cotización | `subscriptions.quote({productId, planId, moduleIds, limits})` | `plataforma.contratos.ver` |
| Contratos | `subscriptions.list/get/create/scheduleChange/cancel` | `plataforma.contratos.ver/gestionar` |
| Cuotas | `charges.list/get`, `charges.generateDue({asOfDate, idempotencyKey})` | `plataforma.cobranza.ver/generar` |
| Pagos | `payments.record({chargeId, amountMinor, method, paidOn, reference, idempotencyKey})`, `payments.reverse({paymentId, reason, expectedVersion, idempotencyKey})` | `plataforma.pagos.registrar/revertir` |
| Instalaciones | `installations.list/register/deactivate` | `plataforma.instalaciones.gestionar` |
| Licencias | `licenses.preview/issue/export` con instalación, vigencia y revisión | `plataforma.licencias.ver/emitir/exportar` |
| Auditoría | `audit.list` con filtros permitidos | `plataforma.auditoria.ver` |
| Operación | `backups.create/list/verify`, `backups.restore` | `plataforma.backups.crear/ver/restaurar`; restauración exige reautenticación |

Los nombres separados por `/` en permisos representan claves concretas diferentes, no un permiso comodín. Las operaciones y DTOs se detallan funcionalidad por funcionalidad en sus specs antes de generar código. Se permitirán solo canales IPC enumerados, no ejecución arbitraria de comandos ni acceso directo al sistema de archivos desde renderer.

## Reglas monetarias mínimas

Un pago manual se asigna a una cuota del MVP; puede ser parcial. Monto positivo, entero, no mayor que el saldo. Las cuotas derivan pendiente/parcial/pagada de sus pagos vigentes; el vencimiento determina atraso por separado. No marcar manualmente una cuota como pagada.

Registro/asignación/saldo/auditoría se confirman atómicamente; dos pagos concurrentes no pueden exceder el saldo. Una reversión conserva el pago original, autor, fecha y motivo, y recalcula el saldo una sola vez. No borrar movimientos monetarios. Saldos a favor, devoluciones y pagos repartidos entre varias cuotas quedan fuera del MVP hasta su spec.

No generar nuevas licencias de operación por el solo hecho de recibir un pago parcial: evaluar saldo y política comercial completa. Revertir un pago no revoca a distancia una licencia ya entregada offline; mostrar y auditar esa discrepancia.

## Entrega mínima al frontend de módulos comerciales

Cuando se implementen los módulos comerciales, README con setup, migraciones, seed demo, ejecución y build; fachada/types versionados, errores y matriz de permisos; y demo con dos empresas del mismo producto con módulos distintos, cuotas pendientes/parciales/pagadas y cuentas de roles diferentes. El frontend de acceso v0.2.0 implementa los flujos definidos en su spec y se presenta de forma sencilla; lint, tipos, build, 48 pruebas, Playwright (2/2) y smoke del paquete Electron x64 pasaron. La UI comercial prevista es empresa → contratos → composición de precio → cuotas/pagos → instalaciones/licencias.

No se requiere diseño visual a medida ni acabado adicional sin petición expresa. Estados de carga/error, navegación y validaciones básicas sí son parte de la integridad técnica de cada flujo. El frontend no recalcula por su cuenta el importe contractual autoritativo; usa `quote` y los totales del backend.
