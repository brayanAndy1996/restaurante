# ADR 002 — Autoridad de escritura y continuidad por local

Fecha: 2026-10-22  
Estado: requisitos aceptados; protocolo de conmutación en borrador. No habilita escrituras offline ni failover automático.

## Contexto y decisiones aceptadas

Operación habitual en nube PostgreSQL multitenant; servidor local SQLite como contingencia y terminales web móviles/tablets. Una sola autoridad acepta cambios para cada pareja `tenantId/siteId`; otros locales pueden continuar en modos diferentes. Durante nube disponible puede sustituirse la PC usada como interfaz de caja. Si fallan simultáneamente internet y el servidor local no se promete continuidad.

La vuelta a nube requiere conciliar primero. No se permite que nube y SQLite reciban cambios independientes sobre las mismas mesas, cuentas o caja. El archivo SQLite pertenece al servicio local, no a las terminales. Impresoras de red y KDS deben seguir a la autoridad del local.

## Límite que el protocolo debe resolver

Un servidor local que no alcanza nube no puede distinguir un corte total de internet de una partición donde otros clientes siguen llegando a nube. Un timeout no demuestra que nube dejó de escribir. Una selección de modo en la UI, un DNS cambiado o una instrucción al personal tampoco invalidan escritores antiguos. Por ello, se prioriza integridad: ante autoridad incierta se bloquean cambios y se explica el motivo.

Un contador de época enviado por el cliente tampoco basta: ambos motores deben verificar autorización vigente antes de confirmar, y todos los escritores y trabajos en segundo plano deben atravesar el control. El protocolo debe impedir que una copia restaurada/reiniciada o un reloj atrasado reactive una autoridad vieja. No se basa seguridad únicamente en el reloj del navegador/PC ni en que el operador recuerde cerrar otra terminal.

## Estrategia propuesta, pendiente de prueba y decisión

Registrar en un coordinador durable por local la autoridad (`CLOUD`, `LOCAL`, `QUIESCING`, `RECONCILING`, `BLOCKED`), identidad de instalación, época monotónica y puntos confirmados de réplica. Solo un mecanismo de adquisición especificado puede emitir autorización de escritura; no exponer un botón que cambie metadatos sin cercar al escritor anterior.

Dos vías deben evaluarse en una prueba técnica antes de construir conmutación:

1. **Traspaso coordinado:** pausar nuevas operaciones, drenar transacciones, confirmar checkpoint y revocar/cercar la autoridad anterior; solo entonces habilitar la siguiente época y escritor. Es la base más clara para cambios planificados. Por sí sola no permite activar SQLite tras una pérdida abrupta de comunicación.
2. **Derecho de contingencia previamente reservado y excluyente:** nube debe dejar de aceptar cambios durante todo intervalo que pueda ser usado autónomamente por la instalación local. Especificar cómo se acuerdan intervalos, expiración, desfase de reloj permitido, persistencia al reiniciar y margen de seguridad; nunca habilitar local mientras pueda existir un permiso cloud válido. Reservar este derecho sacrifica disponibilidad cloud o exige coordinación/renovación constante. Un lease entregado a SQLite sin cercar nube no sirve. Su viabilidad y límites siguen sin aceptar.

No se promete continuidad offline abrupta sin pausa hasta escoger y comprobar una vía de exclusión real. Si el protocolo necesita un testigo externo alcanzable para adquirir autoridad, la ausencia de ese testigo debe bloquear la transición; no llamarlo funcionamiento sin internet. Si no puede satisfacerse la disponibilidad esperada con el modelo elegido, resolver el requisito con el usuario antes del piloto, manteniendo la protección de datos.

## Contrato operativo que debe especificarse

- Instalar una única identidad de servidor de contingencia por local; reemplazo/restauración debe revocar la anterior. Una PC de caja sustituta en nube no adquiere autoridad local por abrir la web.
- Definir ventana de réplica, confirmación de durabilidad y pérdida máxima admisible. No se puede afirmar pérdida cero si una operación cloud confirmada aún no llegó a la contingencia. Definir cómo bloquear o acotar esa ventana antes de aceptar caja.
- Cambios del servidor local se registran atómicamente junto a un outbox durable con identificador de operación, ámbito, época, secuencia y versión de entidad. La recepción deduplica de forma transaccional y conserva resultado de reintentos. Un modelo de outbox no resuelve por sí solo split brain.
- Durante `RECONCILING` no se abren cambios de negocio en ninguno de los lados del local. Replicar/deduplicar, comprobar cantidades, cuentas, caja y checkpoints; registrar incidencias. La discrepancia bloquea el retorno automático y exige resolución auditada. Publicar nueva época solo después de confirmación durable del cierre anterior.
- Separar datos replicados de sesiones y secretos. Especificar autenticación local, permisos vigentes, revocaciones no recibidas y exposición HTTPS/LAN antes de habilitar terminales offline.
- El agente de impresión consume trabajos solo de la autoridad válida. Identificadores de trabajo, estado durable y reimpresiones auditadas reducen duplicados; la impresora puede haber impreso aunque se pierda el acuse. KDS conserva eventos y estados confirmados, detecta épocas antiguas y se recupera mediante snapshot/checkpoint.
- Especificar qué sucede con una solicitud en vuelo cuyo resultado se desconoce durante transición: consultar/reintentar su mismo identificador; no recrearla con otro identificador por defecto.

## Riesgos y pruebas obligatorias antes de ofrecer continuidad

| Escenario | Resultado de seguridad requerido |
|---|---|
| Local pierde internet, un móvil conserva datos móviles | No hay dos escritores; la transición no depende de que el móvil cambie de red voluntariamente. |
| Pausa del proceso, reloj cambiado, reinicio o snapshot antiguo | La autoridad vencida no reaparece como válida. |
| Cloud confirma un cobro y se pierde respuesta/réplica | Se determina su resultado antes de permitir una segunda imputación; no se inventa un pago. |
| Caída entre guardado comercial y outbox/acuse | Transacción durable sin medias operaciones; reenvío idempotente. |
| Corte durante conciliación o réplica duplicada/desordenada | Reanudación desde checkpoint; nube permanece bloqueada hasta conciliar. |
| Instalación local clonada o reemplazada | No pueden activarse dos instalaciones para la misma época/local. |
| Impresión realizada sin acuse o KDS desconectado | Estado incierto visible y recuperación controlada; sin garantía falsa de entrega única. |
| Caída de PC con nube disponible | Caja en otro equipo; impresión requiere agente alcanzable. Con internet también caído no hay continuidad. |

La integración debe ejecutarse con PostgreSQL y SQLite reales, fallos controlados y pruebas adversariales del protocolo; usar Sequelize en ambos no demuestra equivalencia de transacciones/migraciones. Hardware, impresoras y móviles requieren prueba real por separado.

## Consecuencias y pendientes

Las invariantes aceptadas orientan identificadores, límites transaccionales y contratos desde el inicio. Quedan bloqueadas únicamente las funcionalidades que dependan del protocolo no resuelto; el diagnóstico 001 puede implementarse sin simular autoridad ni persistencia. Antes de operaciones replicadas: elegir mecanismo de exclusión, disponibilidad durante partición, RPO/RTO, ventana offline, identidad/revocación, reemplazo y topología del agente de impresión. Cada decisión quedará cerrada en su spec y pruebas antes de programar cambios sensibles.
