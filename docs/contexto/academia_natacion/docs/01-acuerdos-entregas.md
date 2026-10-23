# Acuerdos y alcance de entrega

Fecha: 2026-10-21. Fuente: decisiones del fundador en la conversación de planificación. Estado: alcance acordado; acceso, operación online y sincronización comercial v0.4.0 implementados; validación física Android y preparación productiva pendientes. Complementa el [documento funcional v2.1](03-documentacion-funcional.md).

## Producto y operación

- Web en Next.js y aplicación Android en React Native, con interfaces y desarrollo independientes dentro del producto de natación. Backend Node.js con Sequelize; sin CORE ni implementación tomada de otros productos.
- Servicio en nube y operación local Android hasta 24 horas desde la última sincronización exitosa. Sin PCs, servidor LAN ni comunicación directa entre celulares.
- Online: una persona registra asistencia y varias pueden gestionar inscripciones y cobros. Offline: un único celular designado concentra registro, aprobación, cobros, caja y asistencia; los demás requieren conexión para registrar operaciones.
- Admin o secretaría aprueba inscripciones, incluidas las solicitudes online. Enviar una solicitud no confirma una vacante.
- En el único celular offline se pueden registrar alumnos, aprobar inscripciones, cobrar y registrar asistencia, según los permisos del usuario activo. Se admite sobrecupo que se detecta al consolidar; conservar las inscripciones e informar al administrador. La academia acuerda soluciones con clientes y explica esta condición en capacitación.
- Un alumno inscrito, aprobado y con pago completo confirmado en el celular offline queda disponible allí mismo para registrar asistencia inmediatamente. Ya no se necesita regularizar por estar en otro celular offline. La nube y los demás dispositivos lo conocerán al sincronizar.

## Mensualidad y dinero

- PEN, dos decimales y fechas de negocio `America/Lima`.
- Mensualidad por mes calendario; no hay cobro adicional de inscripción.
- Alta a mitad de mes: proporcional a clases restantes según días elegidos y tope del plan.
- Precio con IGV incluido; no volver a añadir 18 %. Redondear el total hacia arriba al sol entero cuando tenga céntimos. El comprobante interno desglosa total y componentes.
- Pago completo obligatorio: no se permiten pagos parciales ni saldos de mensualidad.
- Efectivo confirmado al cobrar. Yape y transferencia requieren comprobación humana; personal autorizado puede confirmarlos sin internet y sincronizarlos después. Una captura sola no acredita el abono.
- Varias cajas: una por persona que cobra, con apertura/cierre y movimientos propios. El administrador consulta todas. El efectivo esperado no suma Yape ni transferencias. El dispositivo offline no fusiona cajas ni identidades: cobra en la caja del usuario activo. La gestión de sesiones y un posible relevo de operador en ese mismo celular se especificarán antes de implementar.
- Alumno actual con prioridad para renovar su horario; decisión final del administrador. No inventar un plazo fijo de reserva todavía no especificado.

## Primera entrega acordada

| Módulo | Alcance mínimo |
|---|---|
| Usuarios, roles y permisos | Acceso propio, separación de funciones y control de ámbito. |
| Configuración | Datos de academia y parámetros básicos. |
| Alumnos y apoderados | Ficha, identificación, salud, emergencias y consentimientos. |
| Planes y precios | Frecuencia, clases, duración, nivel y precio. |
| Entrenadores | Registro y asignaciones básicas, sin evaluación avanzada. |
| Clases, horarios y aforo | Organización, disponibilidad y revisión de sobrecupos. |
| Solicitudes e inscripciones | Solicitud online/presencial y aprobación administrativa. |
| Mensualidades y renovaciones | Mes calendario, proporcional, vigencia y prioridad de renovación. |
| Cobros y verificación | Pagos completos, efectivo/Yape/transferencia y verificación humana. |
| Cajas | Caja por cobrador, apertura, movimientos, cierre y diferencias. |
| Comprobantes internos | Recibos de cobros confirmados, consulta y descarga/compartición. |
| Carnet y QR | Credencial y reemplazo de QR. |
| Asistencia | QR y manual, controles y descuento de clases. |
| Portal del alumno | Carnet, horario, mensualidad, clases restantes, avisos e inasistencias. |
| Offline y sincronización | Un celular autorizado, persistencia y cola local única, plazo de 24 horas, consolidación y conflictos con nube. |
| Auditoría | Operaciones sensibles e intentos que no prevalecieron. |
| Respaldo y recuperación | Respaldo nube y procedimiento para datos móviles, con límites explícitos. |
| Consultas operativas | Ingresos, cajas y mensualidades; sin dashboard avanzado ni exportaciones completas. |

Recorrido esencial: solicitud → aprobación → pago completo confirmado → comprobante/carnet → asistencia → sincronización y consulta consolidada. Aprobación y pago son controles separados: ninguno se presume cumplido por el otro.

Web: solicitudes online, portal y administración básica. Android: operación online del personal y operación sin conexión exclusivamente desde el celular designado. El alcance por pantalla/rol se detallará en specs.

## Avisos y módulos posteriores

- Sin integración WhatsApp, SMS ni otros envíos externos. Los avisos e inasistencias se consultan en el portal. La nube calcula tras recibir asistencias, muestra actualización y regulariza datos tardíos.
- Fotos y videos de rendimiento quedan para después. La foto de identificación y las imágenes de comprobantes de pago permanecen en la primera entrega.
- Posteriores: descuentos, particulares, recuperaciones/cierres, asistencia fuera de horario, rendimiento, multimedia privada, asistencia y pagos a entrenadores, reportes completos y dashboard avanzado. Orden aún por priorizar.
- Certificados y QR dinámico son opcionales.
- SUNAT en la última fase; no en fase 2 ni en el MVP. La integración tributaria se evaluará entonces.
- Contratación/activación con el panel se especifica por separado; no forma parte del recorrido operativo inicial ni supone compartir su código.

## Impacto del único celular offline

- Un solo origen de cambios offline y una sola cola a conciliar; se elimina la concurrencia entre varios celulares desconectados.
- Inscripción y asistencia usan la misma base local, por lo que el alumno nuevo puede asistir inmediatamente tras aprobación y pago confirmado.
- Se mantienen posibles conflictos con usuarios que continúen online en la nube, reintentos, datos desactualizados y sobrecupos; conserva vigencia la regla de primero aceptado en nube y auditoría.
- Si el celular designado se pierde, se queda sin batería o falla, no hay otro dispositivo autorizado para continuar offline automáticamente. Es el punto único de operación durante el corte; datos aún no sincronizados no están respaldados por la nube.
- El plazo de 24 horas, los permisos, pagos completos y cajas por cobrador siguen vigentes. Un solo equipo no otorga permisos de administrador a su operador.
- Designación/reemplazo requieren un procedimiento controlado, con conexión y tratamiento explícito de pendientes. No habilitar un segundo equipo offline durante el corte por simple cambio de configuración.

## Estado y próximos pasos

Existe acceso v0.2.0 con usuarios/permisos, auditoría y autorización del único equipo offline, además del diagnóstico API/web/Android y SQLite técnica; versiones/lockfile en ADR. Ver [acceso](07-acceso-dispositivo.md). No hay esquema definitivo de negocio ni protocolo de sincronización operativa. Definir progresivamente specs y criterios de aceptación, migraciones, contratos, casos de conflicto y pruebas. No confundir alcance acordado con funcionalidad terminada.

## Conciliación de cobros descartados — decisión confirmada

Bloquear el cierre del cobrador hasta que ADMIN registre la solución ya aplicada y confirme la conciliación del dinero. No presumir ingreso ni devolución. El rechazo y la resolución quedan en auditoría; después de sincronizar el cobrador revisa y solicita un nuevo cierre. Ver [protocolo y límites implementados](10-offline-conciliacion.md).
