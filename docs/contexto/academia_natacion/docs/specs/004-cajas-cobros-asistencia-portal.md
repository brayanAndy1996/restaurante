# 004 — Cajas, cobros, carnet, asistencia y portal

Estado: en verificación. Riesgo alto. Fecha: 2026-10-21. Depende de 003.

## Reglas

- Caja por cobrador y día Lima, una abierta por usuario; abrir exige fondo inicial no negativo. Solo propietario registra/cierra su caja. ADMIN consulta todas y puede reabrir con motivo si no tiene otra abierta ese usuario; cierre conserva revisiones en auditoría. Efectivo esperado = fondo + cobros efectivo + ingresos manuales − egresos; Yape/transferencia separados. Diferencia contado−esperado exige observación cuando no es cero; no borrar movimientos ni modificar cobros al cerrar. No aceptar efectivo esperado negativo.
- Cobro completo exacto según cotización vigente; parciales y exceso rechazados. Inscripción debe estar aprobada para confirmar. Efectivo se confirma al crear; Yape/transferencia nacen pendientes, referencia única por método/academia e imagen de comprobante obligatoria al registrar (archivo privado en spec 005). Solo personal verifica manualmente; se requiere motivo de comprobación. Pago rechazado no genera ingreso, libera reserva; no hay devolución/anulación de confirmados sin spec posterior.
- Confirmación transaccional única por inscripción, movimiento único por pago, caja del verificador abierta ese día. Dos verificaciones concurrentes no duplican. Genera comprobante interno numerado por academia bajo bloqueo y captura nombre de academia/alumno, precio, total y desglose IGV; nunca SUNAT. PDF de recibo y cierre, consulta autorizada. Cuenta de alumno DNI/contraseña temporal DNI, excepción explícita de 8 dígitos solo al crear/restablecer alumno conforme HU04/HU05; nueva contraseña sigue política de 12–128. Nunca enviar esa contraseña por red ni auditoría; el personal informa cómo ingresar. Colisión con usuario existente no vinculado bloquea activación, sin asumir identidad. Perfil ALUMNO vinculado por FK al alumno.
- Carnet con identificador aleatorio de 256 bits sin PII; no sirve para autenticarse. Regenerar invalida anterior y audita. Solo inscripción aprobada/pagada habilita carnet/asistencia. Copia del QR puede mostrarse en portal; comprobación de identidad por foto en spec 005.
- Asistencia online para fecha/hora actual de Lima, clase elegida dentro de bloque de 60 min, mismo día/horario elegido, mensualidad aprobada/pagada no vencida y clases disponibles. Manual/QR mismas reglas; una por alumno/día, primera válida aceptada gana y duplicado auditado. No autoriza fuera de horario ni recuperaciones (posteriores). No se descuenta por inasistencia. Pago/horario pasados conservan historial.
- Cambiar horario de matrícula pagada por ADMIN/SECRETARIA exige motivo; respeta aforo/nivel/frecuencia y conserva importe/clases originales (sin recotizar). Ajustar importe/clases antes de pago solo ADMIN, motivo obligatorio y auditoría.
- Portal ALUMNO muestra solo su ficha, carnet, mensualidades, horario, saldo de clases, recibos, avisos internos e inasistencias calculadas de fechas esperadas anteriores a hoy, regularizadas al recibir asistencia tardía. Mostrar fecha de actualización y provisionalidad mientras pueda haber pendientes offline. No mensajes externos. ADMIN crea avisos por alumno o academia.
- Consultas de ingresos/caja/mensualidades por mes, permisos: ADMIN consulta todo, SECRETARIA su caja/pagos y operación; ENTRENADOR solo asignados. Datos médicos no se incorporan a recibos, avisos ni reportes financieros.

## Datos y transporte

Migración 003_operations, tablas academy_cashboxes/movements/payments/receipts/cards/attendance/notices; referencias compuestas por tenant y restricciones de unicidad. Operaciones pasan por command/operationId de 003 y bloqueo transaccional academia. Permisos migrados para usuarios existentes. APIs bajo /operations y /portal; PDF con autenticación, no URL pública de archivos.

## Aceptación

CA1 TDD efectivo/métodos/cierre/redondeo. CA2 caja ajena/cerrada/otro día y doble apertura. CA3 parcial/referencia duplicada/doble confirmación/inscripción sin aprobar rechazados sin efectos. CA4 confirmación crea una cuenta/carnet/recibo/movimiento y replay no duplica. CA5 DNI temporal restringido al alumno, cambio obligatorio y sin secretos auditados. CA6 asistencia elegible una vez y descuenta exactamente una; negativa fuera de horario/vencida/sin saldo. CA7 portal aislado y recibo/cierre PDF sin PII médica. CA8 flujos web/Android integrados mínimos y SQL real. Archivos/cámara/cola/protección/respaldo se implementan en spec 005; no declarar completado el alcance por acabar la operación online.

Evidencia y límites actuales: [operación online](../09-operacion-online.md). Verificación Android nativa de esta ampliación pendiente de CI/hardware.
