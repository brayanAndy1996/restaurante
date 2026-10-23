# Operación móvil y sincronización

Fecha: 2026-10-21. Estado: protocolo comercial v0.4.0 implementado según specs 002/005; calificación física pendiente.

## Responsabilidades

- Next.js consume API HTTPS del backend Node.js en nube. La web no tiene offline aprobado en esta entrega.
- React Native mantiene pantallas y lógica; un único celular designado dispone de SQLite operativa y cola persistente para todas las operaciones offline. El backend Node.js y Sequelize no se instalan en el celular.
- PostgreSQL contiene el estado consolidado. El celular designado mantiene la copia autorizada y operaciones aún no enviadas. Los demás celulares operan contra la nube y no admiten nuevas escrituras sin conexión; posibles cachés de consulta no los habilitan para trabajar offline. No conectarse directamente a la BD desde clientes.
- Ambos clientes usan la misma API. Los celulares intercambian cambios mediante nube, no Bluetooth, Wi-Fi local ni servidor PC.
- Cálculos y reglas offline deben ser equivalentes a las reglas del backend, con versiones y pruebas de contrato. Interfaces independientes no justifican importes distintos.

## Exclusividad y continuidad

Un único celular concentra todas las escrituras offline de la academia. Los otros no pueden aprobar, cobrar, inscribir ni registrar asistencia sin conexión. Si conservan datos para consulta, no confundir esa caché con autorización offline.

La designación es por dispositivo, no por nombre de usuario. Dentro del equipo se aplican permisos y caja del usuario activo; no se convierte en una cuenta compartida ni en una caja común. El relevo de usuarios y sus credenciales offline necesita spec propia.

No se necesita sincronización entre varios escritores offline; sí sincronización de la cola única con nube. La nube puede seguir recibiendo operaciones online de otros usuarios durante el corte del celular, por lo que siguen vigentes conflictos y sobrecupos aceptados.

Antes de implementar, especificar autorización exclusiva, identificación de equipo, reinstalación, sustitución, revocación y pendientes. La designación no se transfiere automáticamente a otro celular durante un corte. Un reemplazo debe evitar que el equipo anterior siga autorizado y preservar/revisar su cola. La spec 002 implementa exclusividad de autorización y espera al vencimiento del permiso anterior antes de reemplazar; cola comercial implementada según [operación offline](10-offline-conciliacion.md). Ver [acceso](07-acceso-dispositivo.md).

El fallo o pérdida del único celular interrumpe la operación offline; el respaldo en nube no contiene operaciones todavía pendientes. Documentar recuperación y medidas de continuidad sin prometer recuperación de datos nunca enviados.

## Ciclo propuesto

1. Se designa el único celular offline mediante un proceso online controlado; un usuario autorizado inicia sesión y descarga datos/permisos para su ámbito. Detallar alta, exclusividad y autorización del dispositivo en spec.
2. Guarda cada operación y sus efectos locales de forma transaccional junto con una entrada de cola persistente.
3. Con conexión, envía operaciones y sus dependencias; el servidor verifica identidad, permisos y reglas.
4. Recibe confirmación durable, resultado o conflicto. Solo entonces marca el resultado local correspondiente; no borrar evidencia ante fallos.
5. Descarga novedades y reconcilia el estado local, incluidos conflictos y regularizaciones. Expone última sincronización y pendientes.

La cola sobrevive al cierre y reinicio. Reintentar no duplica efectos: usar identificador único por operación, deduplicación y transacciones del servidor. La cola implementada reside en SQLite SQLCipher; PostgreSQL conserva acuses e incidencias transaccionales. No requiere Redis/BullMQ. No se promete sincronización inmediata con la aplicación cerrada; su comportamiento Android se validará.

## Límite offline

El único celular designado puede operar hasta 24 horas desde su última sincronización exitosa. Al vencer: consultar datos locales, conservar pendientes y permitir reconexión/sincronización, pero bloquear nuevas operaciones hasta sincronizar. Una simple conexión de red o un intento fallido no reinicia el plazo. Definir en spec cómo medirlo ante reinicio o cambio de reloj y qué constituye una sincronización exitosa; no ampliar el plazo por editar la hora.

## Conflictos: primero aceptado por la nube

Se aplica a operaciones incompatibles sobre un mismo dato o clave de negocio, no a todas las operaciones de la academia. No se usa la hora del celular para elegir ganador.

- El primer cambio válido aceptado por el servidor permanece. El otro no se aplica al estado operativo y va a auditoría completa, visible al administrador.
- El orden debe fijarse de forma atómica al aceptar la operación; la llegada de una petición inválida no reserva prioridad. Versiones base y claves de conflicto se detallan por entidad en la spec.
- Dos cambios sucesivos legítimos sobre versiones actualizadas no son un conflicto; se permiten ambos en secuencia.
- Un reintento de la misma operación devuelve su resultado previo; no crea un segundo cobro o asistencia.
- No hay dos escritores offline. Todavía puede haber una operación online incompatible con una operación del celular desconectado, o duplicados por error del operador. En altas del mismo DNI o asistencias del mismo alumno/día prevalece la primera válida aceptada; el otro intento queda auditado. Se conservan validaciones locales y la responsabilidad establecida en capacitación.
- Dos inscripciones de alumnos diferentes que generan sobrecupo se conservan. Es una excepción comercial autorizada y no debe resolverse descartando una inscripción.
- Un cobro no aplicado por conflicto conserva importe, método, actor, caja, referencia, comprobante y relación con la operación prevaleciente en auditoría. No convertirlo en ingreso aplicado ni borrar evidencia. El administrador revisa y registra la conciliación. El cierre del cobrador queda bloqueado hasta esa resolución; no se infieren ingresos ni devoluciones.

Auditar operación original y descartada, entidad, datos propuestos, actor/dispositivo/ámbito, recepción del servidor, motivo y operación prevaleciente. No registrar contraseñas, tokens de sesión ni secretos. No guardar indiscriminadamente datos médicos en eventos si no son necesarios.

## Asistencia e inasistencias

Offline, inscripción, aprobación, cobro y asistencia ocurren en el mismo celular y base local. Tras aprobación y pago completo, el alumno está disponible inmediatamente para registrar asistencia allí. Se elimina la regularización motivada por inscribir en un celular y marcar en otro durante el corte. No hay comunicación directa entre dispositivos.

La nube calcula inasistencias con datos recibidos y el portal muestra actualización. Un dispositivo pendiente puede aportar asistencia tardía; debe corregirse la falta y conservar auditoría. La política de cuándo una falta pasa de pendiente a consolidada se detallará en spec.

## Verificación requerida al implementar

TDD en reglas críticas, integración con PostgreSQL y SQLite reales de prueba y escenarios adversariales: cierre de app con pendientes, pérdida de conexión después del commit servidor, reintentos, conflicto entre celular offline y usuario online, orden de dependencias alumno/matrícula/pago/caja, sobrecupo conservado, pagos no aplicados auditados, límite exacto de 24 horas, permisos revocados y aislamiento entre empresas/locales. Añadir casos de bloqueo de escrituras offline en los demás celulares, exclusividad/sustitución del equipo, inscripción y asistencia inmediata en la misma base, y permisos/caja por usuario en ese celular. Probar cámara QR y persistencia/reinicio en Android real. Las pruebas de acceso, firma, límite temporal y exclusividad constan en [verificación v0.2.0](08-verificacion-acceso.md). Pruebas de cola/negocio con SQLite y PostgreSQL reales implementadas; la cámara y el ciclo offline se califican todavía en Android físico. Ver [verificación y límites](10-offline-conciliacion.md).
