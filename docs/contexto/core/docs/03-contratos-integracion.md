> **ARCHIVO HISTORICO — PROPUESTA DESCARTADA EL 2026-10-20.** El fundador decidio que cada software se construye desde cero con modulos propios. El texto anterior de esta propuesta, conservado debajo por trazabilidad, no es una instruccion vigente: no desarrollar, publicar ni consumir CORE ni esperar sus paquetes. Solo siguen vigentes la documentacion/metodologia global y las decisiones de cada producto. No hay implementacion CORE que deba migrarse.

# 03 — Contratos e integración

Estado: contratos conceptuales; no existen firmas ejecutables ni SDK publicado. El primer código definirá tipos/validadores a partir de specs. Ningún consumidor debe depender de métodos internos no publicados.

## Superficies públicas previstas

| Capacidad | Contrato esperado | Límite |
|---|---|---|
| Identidad | Crear usuario, autenticar, consultar/revocar sesión, desactivar y recuperar acceso | Credenciales verificadas en proceso confiable; nunca devolver hash/clave de recuperación |
| Autorización | Registrar permisos, asignar roles y exigir permiso/ámbito | Denegar desconocidos; evaluar permisos vigentes, no nombre del rol |
| Auditoría | Registrar evento con actor, acción, recurso, ámbito, instante y correlación | Sanitizar campos; integración transaccional cuando aplique |
| Contexto | Representar actor y ámbito validados | No aceptar pertenencia inventada por la UI |
| Licencias | Validar documento firmado y obtener capacidades vigentes | Sin claves privadas; comprobar identidad y revisión además de firma |
| Módulos | Resolver disponibilidad, dependencias y acceso | Un toggle visual no concede habilitación |

Errores estables y tipados para validación, ausencia de sesión, permiso/ámbito denegado, recurso inexistente, conflicto y licencia/módulo no habilitados. Cada consumidor adapta su transporte sin exponer detalles SQL, rutas privadas ni secretos.

IDs opacos como cadenas, instantes UTC ISO 8601 y fechas de negocio explícitas. Para dinero que se incorpore a caja, usar enteros en céntimos PEN en los contratos iniciales, con aritmética exacta y rangos validados. El panel define su calendario/contratos comerciales; CORE no aplica automáticamente sus reglas de suscripción a una venta o matrícula.

## Ejemplo de integración: comanda

1. Pollería recibe la solicitud mediante su backend/IPC autenticado.
2. Deriva contexto verificado de actor, empresa e instalación.
3. Usa el mecanismo común para exigir módulo y permiso de crear comandas.
4. Su caso de uso valida mesas/productos y crea la comanda en su BD.
5. Persiste auditoría coordinada con esa escritura y devuelve un DTO de pollería.

CORE desconoce cómo se calcula o se prepara una comanda. Si falla la autorización, no se escribe ni se dispara una operación de cocina.

## Panel y licencias

El panel consume identidad/permisos/auditoría para operar sus propios contratos. Su emisor crea licencias con las capacidades acordadas. El producto verifica firma y correspondencia de `tenantId`, `productId`, `subscriptionId`, `siteId`, `installationId`, revisión y fechas. Si un campo se usa como obligatorio se define así en la spec; no adivinar valores por RUC, nombre de archivo o ruta del disco.

El formato compartido debe estar versionado e identificar emisor/clave. El consumidor rechaza versiones incompatibles o capacidades desconocidas para la acción, sin conceder permisos por omisión. Los escenarios de expiración, reloj, downgrade, restauración y cambio de PC deben especificarse antes de construir el verificador. La política comercial de duración/gracia sigue pendiente.

## Registro de consumidores

Al publicar código, mantener por release una matriz de paquete/versión, consumidor, versión del esquema y verificación realizada. En esta etapa solo hay consumidores previstos: panel, pollería y natación. No marcar compatibilidad de un producto que todavía no existe.

No modificar la implementación interna desde cada aplicación. Si falta una extensión, proponer contrato/prueba en CORE o resolverla en el dominio particular cuando no sea compartida.
