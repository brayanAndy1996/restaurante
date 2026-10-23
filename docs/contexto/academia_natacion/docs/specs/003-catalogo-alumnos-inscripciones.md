# 003 — Configuración, planes, clases, alumnos e inscripciones

Estado: en verificación. Riesgo alto por identidad, salud, reservas y cotización. Fecha: 2026-10-21.

## Alcance y actores

ADMIN configura academia, planes, entrenadores y clases. ADMIN/SECRETARIA registran alumnos, consultan ficha y crean/aprueban/rechazan inscripciones; alumno no edita su horario. ENTRENADOR solo consulta alumnos asignados a sus clases. Web y Android tienen formularios funcionales mínimos, sin acabado visual adicional. Solicitud pública online separada de aprobación: enviar no reserva ni activa al alumno.

## Reglas y decisiones

- Tenant derivado de sesión; catálogos públicos solo muestran campos no personales. DNI de ocho dígitos único por academia, nacimiento válido, contacto/emergencia y consentimientos de datos/deslinde obligatorios; menor de 18 años requiere apoderado. No guardar salud en auditoría. Datos de identificación/salud editables por personal con versión y motivo auditado; no se cambia DNI tras crear ficha.
- Plan: precio PEN en céntimos enteros, frecuencia 1–7, clases mensuales 1–31, duración 60 minutos para bloques vigentes, niveles/días/horas permitidos, vigencia y estado. Clase semanal: día ISO 1–7, hora 08–19 (termina a las 20), nivel, entrenador activo y capacidad 20–50. Un entrenador no se asigna dos veces en el mismo bloque, tampoco a otro nivel.
- Inscripción por alumno/mes calendario, días distintos y cantidad igual a frecuencia, mismo nivel del alumno. Copia precio/condiciones para que editar un plan no cambie una cotización anterior. Inicio dentro del mes y vigencia del plan. Clases = mínimo del tope del plan y fechas restantes de esos días, incluido el inicio. Total = ceil(precioCentavos × clases / clasesPlan / 100) soles, sin añadir IGV; valorVenta = redondeo aritmético total/1.18 e IGV = diferencia. Aritmética entera, sin float monetario. No hay pago en este módulo ni matrícula adicional.
- Crear solicitud no reserva cupo. Aprobar exige aforo disponible en cada clase/mes y reserva hasta pago/rechazo; rechazar libera. El módulo de cobros liberará también al rechazar pago. Online no se permite sobrecupo por un parámetro del cliente; excepción offline se implementará en protocolo firmado posterior. Pago y aprobación siguen separados.
- Primer cambio válido aceptado en nube: tenant bloqueado transaccionalmente, versión esperada en ediciones; duplicados/versiones obsoletas auditados sin cambiar ganador. Idempotencia mediante operationId UUID y hash del contenido; reintentar devuelve resultado original, reutilizar id con contenido distinto rechaza.
- Cambio de horario por personal con motivo y versión; recalcula clases/total solo antes de pago. Tras pago necesita spec de cambio sin modificar importe histórico. Prioridad de renovación se muestra cuando existe inscripción anterior; no se inventa reserva automática ni plazo. ADMIN decide adjudicación cuando haya competencia, sin descartar inscripciones offline aceptadas.
- Parámetros: datos básicos academia, aviso de vencimiento 1–15 días; moneda PEN, zona America/Lima y 18% incluidos son fijos en esta entrega.

## Persistencia y contrato

Migración 002_academy, tablas propias `academy_*`, referencias compuestas por tenant, versiones y transacciones. Permisos ampliados por migración idempotente también para academias existentes; bootstrap usa mismo catálogo actualizado. API `/academy/{settings,plans,trainers,classes,students,enrollments}`; GET listados paginados (hasta 100), POST altas, POST comandos de edición, POST inscripción/:id/decision, POST inscripción/:id/schedule. Listado de inscripción incluye cotización, días, cupos y prioridad. Rutas públicas `/public/:academy/catalog` y `/public/:academy/applications`; respuestas sin datos médicos ni acceso a fichas. Solicitud pública devuelve solo id aleatorio, no cuenta ni QR.

## Aceptación y verificación

CA1 migración desde vacío/repetida y ampliación de permisos sin destruir usuarios. CA2 reglas de calendario/proporcional/IGV con TDD y casos de fin de mes/bisiesto. CA3 alta/edición y DNI único, menor/apoderado y consentimiento. CA4 doble asignación entrenador y capacidad. CA5 aprobación concurrente con último cupo: solo una online, otras auditadas; reservas/rechazo. CA6 separación tenant/rol, entrenador limitado y público sin PII. CA7 replay y conflictos atómicos. CA8 demo comercial explícita, repetible y protegida. CA9 recorrido web real y tipos/build Android. Cobros/carnet/asistencia/cola todavía se especifican después de esta base; no declarar primera entrega terminada por completar esta spec.

Evidencia y límites actuales: [operación online](../09-operacion-online.md). Verificación Android nativa de esta ampliación pendiente de CI/hardware.
