> **ARCHIVO HISTORICO — PROPUESTA DESCARTADA EL 2026-10-20.** El fundador decidio que cada software se construye desde cero con modulos propios. El texto anterior de esta propuesta, conservado debajo por trazabilidad, no es una instruccion vigente: no desarrollar, publicar ni consumir CORE ni esperar sus paquetes. Solo siguen vigentes la documentacion/metodologia global y las decisiones de cada producto. No hay implementacion CORE que deba migrarse.

# 04 — Persistencia, migraciones y versiones

## Propiedad de datos

CORE no tiene una BD central productiva propia. Las cuentas y auditoría se guardan en la BD del consumidor. Dos empresas usando el mismo paquete conservan usuarios, sesiones y datos separados. Los tests de CORE usan BDs temporales; una demo usa un almacén descartable identificado.

El adaptador define tablas/índices que necesita cada capacidad y las claves de ámbito; el consumidor controla conexión, ubicación, respaldo y ejecución de migraciones. No crear tablas al importar un paquete ni utilizar sincronización destructiva del ORM para actualizar una instalación.

## Migraciones coordinadas

- CORE entrega migraciones identificadas y ordenadas de las capacidades que aporta, con requisitos y notas de compatibilidad.
- El consumidor registra las migraciones ya aplicadas y compone su orden con las del dominio. Los identificadores deben evitar colisiones entre paquetes; su formato y ejecutor se definen al crear el código.
- Antes de modificar datos persistentes, verificar versión y realizar backup según el plan del consumidor. Probar tanto una BD vacía como actualización desde la versión anterior soportada.
- Cambios de datos y auditoría relacionados se coordinan con transacciones locales. SQLite y PostgreSQL requieren verificación propia; no asumir que el mismo ORM elimina diferencias.
- Un downgrade del paquete puede ser incompatible con el esquema actualizado. No ejecutar migraciones inversas destructivas automáticamente ni prometer rollback universal; documentar restauración/versiones compatibles.

## Versionado y publicación

Un repositorio, paquetes por capacidad y una versión de entrega coordinada inicialmente para reducir combinaciones. Nombres y registro privado quedan pendientes. Los ejemplos `1.1.0` y `1.2.0` son ilustrativos.

- Versión mayor: rompe un contrato público o una compatibilidad anunciada.
- Menor: incorpora capacidad compatible con consumidores soportados; declarar cualquier migración necesaria.
- Parche: corrige comportamiento sin romper el contrato publicado. Una corrección sensible requiere revisar sus consumidores aun siendo parche.

La compatibilidad se demuestra con pruebas y notas de versión, no solo con el número. Cada consumidor fija versiones exactas y lockfile al principio; actualizar mediante cambio revisable con pruebas, no descargar automáticamente el último CORE al arrancar.

La entrega registra paquetes, dependencias, esquemas compatibles, migraciones, cambios públicos y consumidores comprobados. No publicar dependencias privadas, claves o credenciales en artefactos destinados al cliente.

## Flujo de actualización

1. Spec de CORE describe cambio, riesgo y consumidores afectados.
2. Implementar y verificar según metodología; documentar compatibilidad/migración.
3. Preparar una versión candidata y probar integración en consumidores disponibles, sin afirmar que todos fueron validados.
4. Publicar paquete privado cuando exista infraestructura/autorización y actualizar cada consumidor mediante PR independiente.
5. Cada producto genera su instalador/release y lo distribuye según su proceso. Editar CORE no modifica instalaciones ya entregadas.

Cuando exista una corrección de seguridad relevante, identificar versiones afectadas y coordinar actualización; no ocultar que un consumidor sigue en una versión anterior.
