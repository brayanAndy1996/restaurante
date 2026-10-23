# 005 — Archivos privados, operación Android offline y recuperación

Estado: implementación y verificación automatizada; calificación física Android pendiente. Riesgo alto. Fecha: 2026-10-21.

## Alcance autorizado

Foto de identificación y comprobantes JPG/PNG hasta 5 MB, acceso privado por ámbito/relación, sanitización de imagen y metadatos; sin galería de rendimiento. Cámara QR Android con permiso explícito. Respaldo PostgreSQL y restauración de prueba aislada; nunca restaurar sobre instalación existente automáticamente.

Un único dispositivo offline autorizado, mismo operador ya autenticado; cambio de usuario exige internet, sin credenciales locales nuevas ni caja compartida. SQLite cifrada en build nativo, clave aleatoria en SecureStore; snapshot/cola transaccionales, idempotencia, dependencias y reloj de spec 002. Expiración bloquea nuevas escrituras pero conserva cola y consulta. Sincronización debe subir/confirmar cola, descargar estado consistente y solo entonces renovar autorización; health y login no cuentan. Las operaciones con sobrecupo se conservan y señalan para resolver; otros conflictos se auditan completos sin aplicar, especialmente importe/método/caja/referencia de pagos rechazados. Reintentos no duplican efectos. Cierre local con conflictos no se considera cierre consolidado sin revisión administrativa de conciliación. No borrar evidencia móvil hasta confirmación durable.

## Archivos (subfuncionalidad lista para implementar)

API autenticada recibe base64 con límite de cuerpo equivalente a 5 MB, verifica PNG/JPEG y decodifica mediante sharp, limita píxeles a 20 millones, elimina metadatos y reescala. Guarda bytes saneados en PostgreSQL (incluidos en backup), sin archivos públicos/rutas suministradas por cliente. Solo personal de recepción/administración sube/verifica comprobantes; carga de comprobantes actualmente asistida por secretaría; autoservicio del estudiante y token privado del solicitante permanecen pendientes. Foto asociada a alumno: staff/propio alumno/entrenador asignado; comprobante: staff/propio alumno. Referencias cruzadas rechazadas. Datos externos nunca se evalúan como HTML/SVG. Límite y tipo verificados antes/después de procesar. No se aceptan documentos falsamente etiquetados ni un UUID de archivo ajeno como prueba.

## Protocolo concretado antes del código offline

El protocolo y la decisión de conciliación se concretaron en las secciones siguientes antes de implementar. Ver [resultado, uso y límites](../10-offline-conciliacion.md).

## Respaldo implementado y verificado

Comandos explícitos backup:key/create/verify; clave propia en .env.backup, AES-256-GCM con IV aleatorio, pg_dump custom sin owner/ACL y pg_restore en BD de prueba recién creada. Nunca sobre instalación existente. Límite 512 MB; temporales privados validados/limpiados. Cifrado/integridad y restauración PostgreSQL real comprobados. Retención/automatización/destino externo dependen del hosting, no se consideran configurados. Cola local no enviada queda fuera del respaldo nube.

## Decisión de conciliación confirmada por el fundador

Bloquear cierre hasta conciliación del administrador. Un cobro offline rechazado que implique dinero recibido crea incidencia con importe/método/referencia/caja/operación y motivo/ganador. ADMIN registra solución efectuada y confirma que el dinero quedó regularizado; no se presume ingreso ni devolución automática. Se audita original/resolución. Hasta resolver incidencias del cobrador no se permite su cierre. Un cierre local rechazado no se consolida automáticamente después: el cobrador revisa estado y realiza nuevo cierre por lo contado.

## Protocolo comercial y protección implementados

- En el equipo designado, tras sincronizar copia de negocio y permiso business=true, escrituras operativas pasan siempre por SQLite cifrada y cola, con o sin conexión. Configuración/catálogos/usuarios siguen online; no cambiar catálogo con cola pendiente. Otros dispositivos nunca abren modo comercial offline. Credenciales de alumno solo nacen en nube al consolidar; no se permiten nuevos inicios de sesión offline.
- SQLite SQLCipher habilitada en build propio, clave aleatoria en SecureStore; comprobar cipher_version y fallar cerrado en Expo Go/sin módulo. Snapshot y cola se actualizan en transacción exclusiva. Un solo usuario por copia; conservar cola al logout, bloquear cambio de operador mientras existan pendientes del anterior. No borrar copia al vencer permiso.
- Operación: UUID estable usado también como id de altas, secuencia contigua por equipo, acción, entrada, fecha derivada del ancla monotónica, permiso firmado, bases de versión/caja y firma Ed25519 del equipo sobre JSON canónico. Reutilizar secuencia/UUID con contenido distinto rechaza. Firmas/ámbito/posesión/ventana de captura se validan en nube, además de sesión/permisos actuales. Subida tardía puede recibirse después de vencer permiso si captura ocurrió dentro del plazo; no autoriza nuevas capturas.
- Nube procesa una operación por transacción con bloqueo de academia, savepoint para efecto y resultado/recibo/incidencia duraderos en la misma transacción. Reintento devuelve resultado previo incluso después de caída tras commit. Primer cambio compatible aceptado prevalece, no hora de móvil. Dependencia rechazada provoca rechazo/auditoría sin efecto parcial. Sobrecupo de inscripciones distintas se conserva solo por este canal probado, nunca por flag del cliente online.
- Datos de catálogo/importe que cambian antes de consolidar se detectan por bases de versión. IDs de alta son operationId; movimientos derivados de pago usan id de pago, QR provisional generado con aleatoriedad del equipo y confirmado por nube si no existía carnet. Ticket local identificado LOCAL-UUID y pendiente de consolidación; recibo final conserva relación con operación.
- Descargar snapshot consistente bajo bloqueo después de confirmar toda secuencia declarada. Solo esa descarga con cola confirmada emite permiso business=true y nuevo límite de 24 h. Login, diagnóstico y botón antiguo de acceso no lo renuevan. Guardar acuses/rechazos y sustituir vista por consolidado de nube; incidencias quedan visibles. No borrar evidencia ante rechazo o timeout.
- Snapshot privado para ADMIN/SECRETARIA con permisos offline: catálogos, alumnos, meses operativos, cajas propias/consultables, pagos, tarjetas y asistencia necesarios. Límite explícito antes de truncar; si excede capacidad soportada, exigir online y ajustar paginación por spec posterior. Datos sanitizados de imágenes viajan cifrados en reposo; no públicos.

## Verificación requerida

TDD en firmas/ventana/secuencia y reductor local; SQLite real en fixtures: rollback, reabrir con cola, reintentos, límite exacto y conservación al fallar red. PostgreSQL real: atomicidad efecto/acuse, dos DNI, duplicado asistencia/pago, sobrecupo retenido, revocación/tenant/firma manipulada, bloqueo de cierre y conciliación. Comparar resultado local/servidor en recorrido alumno→matrícula→aprobación→pago→asistencia. Verificar build SQLCipher/cámara; suspensión/reinicio/avión en teléfono físico siguen siendo calificación de hardware, sin afirmarlos por pruebas JS.
