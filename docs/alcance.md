# Alcance de restaurante

Actualizado: 2026-10-23. Producto independiente, desarrollado desde cero en su [repositorio propio](https://github.com/brayanAndy1996/restaurante). Prioridad: backend y arquitectura con frontend funcional mínimo. Las reglas comunes se consultan en [el contexto](contexto/CONTEXTO_GENERAL.md), [metodología](contexto/METODOLOGIA.md) y [arquitectura](contexto/ARQUITECTURA_COMPARTIDA.md); no se comparte implementación ni se utiliza CORE.

## Acuerdos particulares

- Producto multitenant: nube habitual con PostgreSQL y aislamiento por empresa y local. El ámbito se deriva de autenticación y autorización comprobadas por backend, nunca de identificadores libres del navegador.
- Un servidor local con SQLite por instalación mantiene la operación del local durante cortes de internet. Los móviles y tablets son terminales web, sin bases de escritura independientes. No se comparte el archivo SQLite por red.
- Con nube disponible, otra PC puede asumir la interfaz de caja. El fallo simultáneo de internet y la PC local impide continuar; el usuario acepta esta limitación. Perder LAN también impide que las terminales alcancen el servidor local.
- Las impresoras son de red. El envío desde nube necesita un agente local o un canal seguro hacia la LAN; sustituir el navegador de caja no sustituye automáticamente dicho agente. Se especificará su independencia de la PC principal antes del piloto. Cada modelo/ruta debe verificarse físicamente.
- Comandas impresas y KDS están contemplados en nube y contingencia local. El transporte, confirmaciones y recuperación de impresión/KDS se implementan progresivamente.
- Inventario limitado a disponibilidad y cantidades de productos: sin recetas, despiece ni consumo de insumos por receta.
- Primera versión comercial sin facturación electrónica, consultas RUC/SUNAT ni notas de crédito fiscales. Los tickets/precuentas son documentos internos; nunca se presentan como comprobantes fiscales. La referencia original `restaurante.txt` es un insumo y se interpreta con estas exclusiones acordadas.
- Moneda PEN, importes con dos decimales, precios con IGV incluido y fecha de negocio `America/Lima`. Cálculos, redondeos y distribución de cuentas se especifican antes de cobrar.

Este producto adelanta nube y contingencia por decisión particular del usuario; las referencias globales a nube pospuesta no aplazan este alcance. La nube objetivo no implica que exista un despliegue público. El aislamiento multitenant sí está implementado y verificado en PostgreSQL de desarrollo.

## Mapa de módulos propios y entregas

| Entrega progresiva | Recorrido y dependencias |
|---|---|
| 001: base técnica | API de diagnóstico y página real, configuración y checks; sin BD/acceso comercial. [Spec ejecutable](specs/001-base-tecnica.md). |
| 002: acceso y ámbitos (terminada) | Usuarios, credenciales, sesiones, roles/permisos, tenants/locales y auditoría; persistencia/migraciones y demo opcional segura. Base para cualquier operación sensible. |
| 003: carta y salón (terminada) | Familias/productos, cantidades y disponibilidad, sectores/mesas, apertura con comensales/mozo y estados; concurrencia dentro del mismo local. |
| Comandas y producción | Órdenes, observaciones/modificadores y tiempos de servicio, adiciones, ruteo por estación, impresoras de red y KDS, confirmaciones y reintentos visibles. |
| Servicio y cuentas | Precuenta, mover mesas, unir mesas/cuentas, división por ítems o partes iguales; anulaciones y descuentos autorizados y auditados. |
| Caja | Apertura/fondo, cobros parciales y múltiples medios (efectivo, tarjeta, Yape/Plin como registro), vuelto, cierre de cuenta/mesa, arqueo y cierre de turno, reportes/exportación. Sin procesar pagos externos hasta una integración especificada. |
| Continuidad validada | Autoridad única por local, réplica, conmutación segura y conciliación, autenticación local, recuperación de impresión y KDS; obligatoria antes de ofrecer operación sin internet. |
| Preparación comercial | Instalación/agente local, respaldos/restauración, licencia/contrato, distribución, rendimiento y matriz de periféricos comprobados. |
| Etapa posterior | Facturación electrónica y otros alcances comerciales acordados por spec. |

El orden presenta dependencias, no un compromiso de terminar todo en la primera sesión. Continuidad se diseña antes de fijar el esquema operativo y se valida por recorridos completos; no se añade como copia posterior de tablas. Las specs se crean justo antes de implementar cada entrega. El cierre comercial exige el flujo acordado, incluida continuidad, no solo el diagnóstico 001.

## Reglas que deben concretarse antes de operaciones comerciales

Permisos explícitos y auditoría para anulaciones/descuentos, sin clave universal compartida de supervisor. Transacciones y control de versiones para mover/unir/dividir cuentas y evitar dobles cobros. Autoridad única por local y claves idempotentes con ámbito; reintentar una solicitud no debe duplicar una operación. Las impresiones físicas tienen resultado incierto si se pierde confirmación: reimpresión identificada, historial y resolución visible; no prometer exactamente una impresión.

El stock debe definir reservas, descuento/devolución al anular, concurrencia y límites antes de implementarse. Los cierres deben definir saldos/mesas pendientes y restricciones de conciliación. No eliminar historial para resolver conflictos. Identidad offline, vencimiento, cambios de permiso/revocación y recuperación requieren reglas propias. Los riesgos de autoridad se registran en [ADR 002](decisiones/002-continuidad.md).

## Estado de la entrega

v0.3.0 incluye base técnica, acceso multitenant PostgreSQL y carta/salón por local, verificados con integración real y revisión adversarial. Las atenciones solo se abren y cancelan vacías; las cantidades se ajustan manualmente con auditoría, sin consumo automático. Ver [spec 002](specs/002-acceso-multitenant.md) y [spec 003](specs/003-carta-salon.md). Comandas, cobros, continuidad, impresión y KDS siguen pendientes; no hay operación comercial ni despliegue público. Los comandos reales y resultados se mantienen en README y en cada spec; el hardware publicado sigue provisional hasta probar el producto empaquetado.
