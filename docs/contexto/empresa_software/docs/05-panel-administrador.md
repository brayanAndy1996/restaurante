# 05 — Definición del panel administrativo

Actualizado: 2026-10-21. Aplicación interna independiente, con módulos propios construidos desde cero, sin CORE. Electron + SQLite local por ahora. Repositorio: [panel_administrativo_empresa](https://github.com/brayanAndy1996/panel_administrativo_empresa).

## Objetivo y recorrido del MVP

Saber **a qué empresa se alquila qué software, con qué módulos, a qué precio, qué debe/pagó y en qué instalaciones puede utilizarlo**.

Recorrido: alta de empresa/local → elegir software y plan base → seleccionar módulos compatibles → cotizar → crear suscripción → emitir cuota → registrar pago completo/parcial → registrar instalación → emitir/exportar licencia. Cada paso conserva historial y auditoría según riesgo.

Los negocios no utilizan este panel. Sus empleados, ventas, alumnos, mesas, inventario y ajustes visuales pertenecen a sus productos. El panel no contiene editor de colores, temas o logos de clientes.

## 1. Empresas clientes y locales

Ficha con `tenantId`, RUC, razón social, contacto, dirección en Perú, rubros y estado comercial. Listar todos los productos contratados por empresa. Un cambio de contacto no cambia su identidad ni reasigna datos.

Locales identificados y asociados a la empresa. Una empresa puede contratar pollería y natación; cada contrato se gestiona por separado. No confundir estado de empresa, estado de suscripción, deuda y licencia.

## 2. Catálogo de productos, módulos y planes

- Producto: código estable, nombre, descripción, estado comercial y versiones disponibles.
- Módulo: código por producto, descripción, precio de referencia, dependencias y disponibilidad (`planned`, `available`, `retired`). Solo contratar/activar módulos disponibles y compatibles con el producto/versión.
- Plan: plantilla con precio base, módulos incluidos y límites. La suscripción guarda la composición y precios realmente acordados, sin depender de futuros cambios de la plantilla.
- Los módulos técnicos indispensables no se pueden quitar; los módulos comerciales son configurables respetando dependencias. No editar los módulos efectivos desde una pantalla del negocio para eludir la contratación.
- Los precios de catálogo no reescriben contratos ni cuotas anteriores. Precios particulares y descuentos se registran explícitamente con motivo, autor y fecha; no aceptar un total arbitrario enviado por la UI.

## 3. Precios de ejemplo

**Ejemplos para diseñar y poblar demos, no tarifas comerciales finales.** Moneda PEN, mensuales, con IGV incluido. El precio de entrada es S/ 150. Cada plan del ejemplo incluye un local y una instalación principal; límites de usuarios/terminales se fijarán al validar capacidad y costos.

| Producto / componente | Ejemplo mensual | Alcance ilustrativo |
|---|---:|---|
| Pollería base | S/ 150 | Carta, POS, caja y reportes básicos |
| Mesas y comandas | + S/ 30 | Operación de salón/cocina |
| Delivery | + S/ 20 | Pedidos y seguimiento de reparto |
| Inventario | + S/ 30 | Existencias y movimientos |
| Facturación electrónica | + S/ 40 | **Solo referencia futura; no vendible/activable en el MVP** |
| Natación base | S/ 150 | Alumnos, programas, matrículas y mensualidades |
| Asistencia QR | + S/ 20 | Registro de asistencia |
| Aforo y horarios avanzados | + S/ 30 | Gestión avanzada de capacidad |

Pollería A con base + mesas/comandas: **S/ 180**. Pollería B con lo mismo + facturación, cuando esté implementada: **S/ 220**. Ambas usan el mismo producto y pueden tener configuraciones visuales distintas en su propia aplicación.

Fórmula: base acordada + adicionales no incluidos − descuentos explícitos = mensualidad acordada. No cobrar dos veces un módulo incluido en la base. Resolver dependencias antes de confirmar. Por ahora son importes finales con IGV incluido; el desglose fiscal y costos de proveedor se revisarán al implementar facturación, sin cobrar nuevamente IGV sobre estos totales.

Todos los módulos de rubro siguen siendo ejemplos de catálogo hasta que su producto los implemente y valide. Que un registro exista en el panel no demuestra que el módulo exista en un instalador.

## 4. Suscripciones y cambios

Un contrato vigente por empresa/producto en el MVP, con plan de origen, composición/versionado, importes, límites, fecha de inicio, ancla mensual, estado y vigencia de cambios. Estados contractuales: `trial`, `active`, `suspended`, `cancelled`; deuda y licencia se muestran aparte.

Decisiones confirmadas: cobro mensual desde fecha de alta, sin prorrateo automático; pagos parciales permitidos. Las altas de prueba requieren duración explícita; no se presupone prueba gratis de 15–30 días.

Cambios ordinarios de módulos y precios se programan para el siguiente periodo. Una activación inmediata, baja anticipada o ajuste requiere regla explícita antes de implementarse. Quitar un módulo no borra sus datos ni sus importes históricos. Si hay dependencias, rechazar una combinación inválida o programar conjuntamente sus cambios.

## 5. Cuotas y pagos manuales

Una cuota por suscripción y periodo, con detalle histórico, vencimiento, total, pagado y saldo. Generación idempotente al abrir el panel y bajo demanda: recuperar periodos pendientes sin duplicar. Un panel local cerrado no ejecuta tareas en segundo plano por sí solo.

Registrar Yape, Plin, transferencia o efectivo como **métodos manuales**, con fecha, referencia y actor. No son integraciones bancarias ni validación automática del pago. Un pago del MVP se aplica a una cuota; permite abonos positivos hasta el saldo. Correcciones mediante reversión auditada, no eliminación. Detalle en el [contrato frontend](07-contrato-frontend.md).

No incluir pasarelas, recordatorios por WhatsApp/correo, facturas propias ni cobro recurrente automático en este MVP. Las cuotas son registros de cobranza internos, no comprobantes tributarios.

## 6. Instalaciones, licencias y entrega

El alcance previsto es registrar empresa, software, contrato, local e instalación principal; mostrar módulos concedidos, límites, última versión informada y fecha; y emitir/exportar/importar manualmente una licencia firmada para la fase local. Estas operaciones comerciales y de licencia aún no están implementadas. Ver [vinculación y distribución](../../ARQUITECTURA_COMPARTIDA.md).

La licencia incluye identidad, módulos y límites; el producto los aplica en backend junto con los permisos del usuario. No basta ocultar botones. El panel no crea directamente usuarios en una BD remota: el administrador del negocio se crea en el primer arranque activado del producto.

La suspensión administrativa no se propaga instantáneamente a una instalación sin conexión. Antes de implementar, especificar vigencia, gracia, tratamiento del reloj, reinstalación y modo de solo lectura. No bloquear respaldo/exportación autenticados ni borrar datos por mora.

## 7. Usuarios internos, auditoría y operación

El acceso propio, bootstrap, usuarios, roles/permisos y auditoría de operaciones de acceso están implementados en v0.2.0 según la [spec 002](specs/002-acceso-nativo.md), terminada tras la verificación integrada del 2026-10-21. Pasaron lint, tipos, build, 48 pruebas, Playwright (2/2), empaquetado Electron Windows x64 y smoke Argon2id/SQLite contra el artefacto. La auditoría comercial de contratos, cambios de precios/módulos, pagos/reversiones, instalaciones y licencias se implementará con esos flujos. Backups y restauración siguen pendientes; ver [operación](08-acceso-operacion.md).

Respaldar el panel no respalda automáticamente las SQLite de los negocios. Cada producto tendrá su respaldo local; backup remoto/restauración centralizados quedan para después de diseñar nube y sincronización.

## Pantallas mínimas

Inicio con pendientes de cobro; empresas y ficha con locales/contratos; catálogo; cotización/composición de contrato; cuotas/pagos y saldo; instalaciones/licencias; usuarios; auditoría; backups. Formularios y tablas funcionales, sin trabajo de diseño visual a medida.

De esta lista, la interfaz de acceso v0.2.0 implementa bootstrap/login, gestión básica de usuarios, asignación de los roles fijos, sesiones y consulta de auditoría. Las pantallas comerciales y de backups siguen pendientes.

## Entidades iniciales

`Company`, `Site`, `Product`, `ProductModule`, `ModuleDependency`, `Plan`, `PlanModule`, `Subscription`, `SubscriptionRevision`, `SubscriptionModule`, `Charge`, `ChargeLine`, `Payment`, `PaymentReversal`, `Installation`, `LicenseIssue`, `AdminUser`, `Role`, `Permission`, `AuditEvent`.

Es un mapa conceptual, no un esquema ORM cerrado. Precisar claves, restricciones, transacciones e índices en cada spec. Los históricos no se borran al retirar un plan/módulo; las referencias a empresa/producto/local deben ser consistentes.

## Orden de construcción

1. Base del proyecto, contrato tipado, migraciones, primer propietario y recuperación, checks y seed reproducible: implementado y verificado en v0.2.0 según la spec 002 y el [README](../README.md).
2. Empresas y locales, con frontend mínimo.
3. Catálogo, planes, módulos/dependencias y cotización.
4. Suscripciones, revisiones de composición y calendario mensual.
5. Cuotas, pagos parciales y reversiones con TDD/integración/adversarial.
6. Instalaciones y emisión de licencias; verificación mediante fixture/cliente de prueba hasta que exista un producto consumidor. No afirmar activación real sin probarla en ese producto.
7. Completar auditoría comercial junto a cada operación sensible y definir/implementar backups; verificar restauración/instalador antes del piloto. No posponer la protección de datos al último paso.

Cada bloque se divide en funcionalidades/specs pequeñas y se termina de punta a punta. La base de acceso y auditoría propia ya está implementada; cada flujo comercial añadirá sus permisos y eventos específicos. No esperar ni construir un núcleo compartido con otros productos.

## Fuera del primer MVP

La futura administración de subdominios/hosts por empresa-producto se describe en [DOMINIOS.md](../../DOMINIOS.md); su esquema es una propuesta pendiente y no obliga a desplegar nube ahora.

Nube/sincronización, cobro automático, autoservicio, referidos, métricas avanzadas, soporte con suplantación de usuario, monitoreo remoto, actualizaciones automáticas y facturación electrónica. La facturación permanece en la última etapa. Las interfaces de los productos por rubro se desarrollan en sus propios repositorios.
