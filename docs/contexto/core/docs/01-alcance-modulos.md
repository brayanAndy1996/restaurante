> **ARCHIVO HISTORICO — PROPUESTA DESCARTADA EL 2026-10-20.** El fundador decidio que cada software se construye desde cero con modulos propios. El texto anterior de esta propuesta, conservado debajo por trazabilidad, no es una instruccion vigente: no desarrollar, publicar ni consumir CORE ni esperar sus paquetes. Solo siguen vigentes la documentacion/metodologia global y las decisiones de cada producto. No hay implementacion CORE que deba migrarse.

# 01 — Alcance y módulos

CORE evita duplicar mecanismos comunes. Las capacidades se incluyen según necesidad; pertenecer al núcleo no obliga a instalarlas en todos los productos. Todos los módulos de esta tabla están **sin implementar**.

| Capacidad | Responsabilidad común | Primer uso / etapa |
|---|---|---|
| Identidad | Usuarios, credenciales, estado, sesiones y mecanismos de recuperación | Panel: primera etapa |
| Roles y permisos | Registro de permisos, asignaciones, evaluación y denegación por defecto | Panel: primera etapa |
| Auditoría | Contrato/eventos, actor, ámbito y persistencia transaccional donde corresponda | Desde primeras operaciones sensibles |
| Empresa, local e instalación | IDs, contexto y validación de pertenencia | Cuando un consumidor requiera estos ámbitos |
| Licencias y habilitación de módulos | Formato público, firma verificada, identidad, vigencia y capacidades concedidas | Activación local |
| Caja | Apertura, movimientos, cierre y arqueo | Primer producto que la necesite |
| Impresión | Interfaz, trabajos y adaptadores de impresora | Primer flujo de impresión real |
| Clientes operativos | Datos comunes mínimos si varios consumidores los requieren | Opcional; no confundir con empresas suscriptoras del panel |
| Sincronización | Protocolo, colas y resolución definida de conflictos | Etapa futura de nube |
| Facturación | Contrato con adaptadores de proveedor | Última etapa |

## Fuera de CORE

- Empresas clientes comerciales, planes, precios, contratos, cuotas y pagos de suscripción: dominio del panel.
- Productos/ventas/mesas/comandas/delivery: dominio de pollería.
- Alumnos/matrículas/cupos/asistencia: dominio de natación.
- Tema, colores y logo: configuración del producto. No construir un editor de temas en CORE ni en el panel.
- Emisión de licencias y custodia de claves privadas: ámbito administrativo. El verificador público no las incorpora.
- Pantallas, navegación y framework frontend de cada producto.

La ficha operativa de empresa/local puede compartir identificadores o validaciones con el panel sin convertir sus tablas en la misma entidad persistida. El panel no necesita importar caja/impresión solo por usar identidad.

## CORE y módulos comerciales

Paquete de código, módulo comercial contratado y permiso de usuario son conceptos diferentes. Una capacidad comercial puede requerir varios paquetes; tener un paquete instalado no autoriza usarla. Identidad y seguridad técnica no son opcionales por contrato.

Cada producto declara módulos implementados y compatibles, dependencias y permisos. Para operar se comprueban disponibilidad real, habilitación contractual/licencia, pertenencia al ámbito y permiso. La suspensión de un módulo conserva sus datos; su spec define lectura/exportación y transiciones.

## Consumidores

| Consumidor | Reutilización prevista | Responsabilidad propia |
|---|---|---|
| Panel | Identidad, permisos, auditoría y contratos públicos de licencia cuando apliquen | Cobranza, contratación y emisor administrativo |
| Pollería | Identidad, permisos, auditoría, verificador, caja/impresión según alcance | Operaciones de restaurante |
| Natación | Identidad, permisos, auditoría, verificador y otras capacidades que necesite | Operaciones de academia |

No extraer una abstracción genérica basándose solo en nombres parecidos: describir el comportamiento compartido y el consumidor que la necesita en su spec.
