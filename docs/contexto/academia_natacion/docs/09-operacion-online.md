# Operación online v0.3.0

Fecha: 2026-10-21. Specs 003/004 y subfuncionalidad de archivos de 005. Producto independiente; no es todavía la primera entrega comercial completa.

## Recorrido disponible

ADMIN configura academia, planes, entrenador y clases. ADMIN/SECRETARIA registra ficha (DNI único, nacimiento, apoderado de menor, salud, emergencia y consentimientos) y solicitud mensual; también recibe solicitudes públicas de /inscripcion. Una solicitud no reserva cupo. Aprobar comprueba disponibilidad de todas las clases y reserva; rechazar libera. La prioridad de renovación se muestra por inscripción anterior, sin inventar reserva automática ni plazo; ADMIN decide. La API protege el último cupo con transacciones, versiones y auditoría.

Cotización en céntimos enteros: mes calendario, fechas restantes incluidas desde inicio, tope del plan, precio con IGV incluido y total redondeado hacia arriba al sol. Ejemplo 100/12×5 = S/42, valor S/35.59, IGV S/6.41. Editar plan no cambia cotización ya guardada; ADMIN ajusta importe/clases antes de pago con motivo. No hay matrícula adicional, descuento ni parcial. Horario pagado conserva importe/clases; alumno no lo edita.

Cada cobrador abre su caja. Efectivo confirma en el acto; Yape/transferencia requiere imagen privada, referencia única y confirmación humana con motivo. Inscripción aprobada y pago completo son necesarios para activar cuenta/carnet. No se confía solo en la imagen. Efectivo esperado no suma pagos digitales. Cierre con diferencia exige observación, conserva movimientos y genera PDF. ADMIN puede reabrir con motivo, sin otra caja abierta del mismo cobrador.

Cuenta del alumno: DNI y contraseña temporal DNI conforme al acuerdo; cambio obligatorio a 12–128 caracteres. Esta excepción de ocho dígitos no se permite para personal. Secretaría puede restablecer solo cuentas vinculadas ALUMNO; si se cambió su rol, usar administración de usuarios. Cuenta no vinculada con mismo DNI bloquea confirmación para resolver identidad, sin vincularla automáticamente. El QR aleatorio no contiene PII ni autentica acceso. Reemplazarlo invalida el anterior.

Asistencia manual y cámara QR Android: mismo horario/día, pago completo aprobado vigente, clases disponibles, una asistencia por alumno/día. Descuenta una sola vez; duplicado no modifica saldo y queda auditado. Fuera de horario y recuperaciones siguen fuera de este MVP. Portal solo del alumno vinculado: carnet, horarios, mensualidades/clases restantes, recibos, avisos e inasistencias derivadas anteriores a hoy. Se muestran actualización/provisionalidad para regularización al sincronizar. No WhatsApp ni otros envíos.

## Contratos

Bearer nativo; BFF Next /api/access con cookie HttpOnly/Origin para web. Tenant siempre derivado de sesión. Altas/ediciones comerciales son comandos POST: `{operationId: UUID, data: {...}, id?, version?, reason?}`. Editar usa id/versión esperada; no PATCH. Reintento idéntico devuelve el resultado anterior; reutilizar id con contenido distinto rechaza. Una corrección legítima usa nueva operación/versión. Errores 400 validación, 401 sesión, 403 permiso, 404 ámbito, 409 conflicto/regla.

- `/academy/settings`: GET/POST configuración (versión inicial 0).
- `/academy/plans`, `/trainers`, `/classes`, `/students`: GET/POST listados/guardar. Listados limit 1–100 y offset, month/search cuando corresponda. Ficha `/academy/students/:id`; entrenador solo asignados `/academy/assigned`.
- `/academy/enrollments`: GET/POST, datos studentId/planId/classIds/startDate. `/decision`: APPROVED/REJECTED con motivo y versión. `/schedule`: classIds/startDate, motivo/versión; después de pago conserva fecha original/importe/cuota.
- `/public/:academy/catalog`, `/applications`: catálogo sin PII y solicitud pública (límite IP); no activa cuenta ni confirma vacante.
- `/operations/cash/open`, `/movement`, `/close`, `/reopen`: fondo, ingresos/egresos, contado/observación y reapertura administrativa. `/operations/cashboxes?month=AAAA-MM`, `/cash/:id`, `/cash/:id/pdf` para consulta/detalle/cierre.
- `/operations/payments`: GET mensual/POST cobrar completo; method CASH/YAPE/TRANSFER, enrollmentId, amountCents, reference/proofId para digitales. `/payments/verify`: decisión CONFIRMED/REJECTED, versión y motivo. Rechazo libera reserva; confirmación única crea cuenta/carnet/recibo/movimiento atómicamente.
- `/operations/enrollments/adjust`, `/students/reset`, `/cards/rotate`, `/notices`, `/attendance`; campos en formularios mínimos y spec 004. `/operations/report?month=AAAA-MM` ingresos confirmados, solo ADMIN.
- `/operations/receipts/:id` y `/pdf`: staff autorizado/propio alumno, nunca público. Recibo interno, sin SUNAT. `/portal`: cuenta ALUMNO vinculada, sin acceso por DNI ajeno.
- `/operations/files`: POST studentId/purpose PHOTO o PROOF/base64 JPG/PNG hasta 5 MB. Decodificación/saneamiento a JPEG sin metadatos, máximo 20 MP, reescala 1280. GET `/files/:id` privado y `/students/:id/files` metadatos. Salud fuera de auditoría; imágenes no se sirven como SVG/HTML ni rutas de usuario.

La solicitud pública nueva no tiene cuenta aún: la imagen de pago se carga asistida por secretaría en esta versión, hasta cerrar el flujo privado de adjuntos del solicitante. No hay enlace público a salud/comprobante.

## Preparar y verificar

Instalación y clave/propietario como README. `npm run db:migrate` aplica 001_access, 002_academy, 003_operations y 004_sync, también amplía permisos de academias existentes. Arranque no migra ni siembra. `npm run db:seed:demo` solo en BD `_demo`, sin tenants normales ni tablas ajenas; después de migrar. Fecha base por defecto 2026-10-01. No repetir una fecha distinta esperando reemplazar datos: la carga conserva el escenario existente.

Evidencia local: TDD observado de calendario/proporcional/efectivo (fallos iniciales y posterior implementación), 17 unitarias; 23 pruebas con PostgreSQL real sin omitidas, incluidos último cupo y confirmación concurrentes, aislamiento, archivos saneados, parciales, caja/carnet/portal y PDFs. Tipos/lint, build Next/API y bundle Hermes de 713 módulos pasaron. Smoke en Edge headless pasó alta de alumno, solicitud, aprobación, caja, cobro, cambio obligatorio y portal QR; conserva pruebas BFF/CSRF/recuperación. PDFs de muestra renderizados e inspeccionados: una página legible sin recortes.

## Límites y siguiente bloque

Offline comercial, cola cifrada y conciliación implementados en v0.4.0: ver [guía y límites](10-offline-conciliacion.md). El fundador confirmó bloqueo de cierre hasta conciliación administrativa. La evidencia de 17/23 pruebas arriba corresponde al hito online v0.3.0; el nuevo bloque amplía la verificación. Respaldo cifrado y restauración de prueba aislada implementados; automatización/retención en hosting y hardware Android pendientes. Cámara/galería/compartir requieren validar permisos, reinicio, disco y red en teléfono físico. No afirmar entrega completa, despliegue cloud ni compatibilidad Android certificada.

## Respaldo cifrado y recuperación

`npm run backup:key` crea `.env.backup` sin sobrescribir; guardar esa clave fuera del servidor y del repositorio. `npm run backup:create` carga `.env`/`.env.backup`, ejecuta pg_dump y crea archivo nuevo AES-256-GCM autenticado en `.backups` (o BACKUP_DIRECTORY). PG_BIN indica carpeta de pg_dump/pg_restore, por ejemplo `C:/Program Files/PostgreSQL/17/bin`; usar cliente de versión compatible con servidor. Los binarios no se instalan dentro del móvil.

`npm run backup:verify -- RUTA_DEL_ARCHIVO` autentica/descifra y restaura en una BD `_test` nueva y aleatoria mediante API_TEST_DATABASE_URL local; comprueba migraciones/tablas y elimina únicamente ese fixture al terminar. Nunca sobrescribe instalación existente. Probado contra PostgreSQL 17.5 real con backup/restore completo del esquema y cifrado. Unitaria comprueba clave incorrecta/manipulación. Límite actual del comando 512 MB; para volúmenes superiores preparar pipeline de hosting antes de operar. Temporal de pg_dump con permisos privados y limpieza en finally; sin credenciales en argumentos/logs.

La copia incluye registros e imágenes ya enviados a PostgreSQL. No contiene la cola nunca enviada ni claves móviles. No hay cron, destino externo o retención configurados: se definen al elegir hosting, junto a prueba periódica de recuperación. Una copia sin su clave no puede recuperarse. La restauración real se hará con parada y procedimiento explícito; este comando solo califica en fixture aislado.
