# Operación Android y conciliación — v0.4.0

Implementación del 2026-10-21, con validación física Android pendiente. Complementa las specs 002 y 005 y la [operación online](09-operacion-online.md). El servidor Node.js y PostgreSQL permanecen en la nube; Android ejecuta sus reglas locales y guarda una proyección y una cola firmada en SQLCipher.

## Preparación y operación

1. Migrar la base mediante `npm run db:migrate` (001 a 004). Configurar la API HTTPS y la clave pública de verificación en `apps/mobile/.env`, según README. La clave privada de firma solo pertenece al servidor.
2. Generar el build propio con `npm run android --workspace @piscina/mobile`, con JDK/SDK Android configurados. Requiere reconstruir tras habilitar SQLCipher, Expo Print, cámara o el módulo de reloj; Expo Go no ofrece operación comercial offline. La clave aleatoria local se conserva en SecureStore, vinculada al dispositivo y sin backup Android.
3. Iniciar sesión online con el operador que trabajará durante el corte, cambiar contraseña temporal si corresponde, registrar el celular y designarlo desde administración. Solo uno puede recibir autorización; sustituirlo exige esperar el vencimiento anterior.
4. Pulsar **Sincronizar datos y pendientes (24 horas)** antes de desconectarse. Sube y confirma toda la cola por orden, descarga una copia completa y obtiene permiso comercial firmado. Si falla cualquier fase, no renueva las 24 horas.
5. Registrar alumnos, inscripciones, decisiones, cambios de horario, fotos/comprobantes, apertura/movimientos/cierre de caja, cobros completos/verificaciones y asistencia en ese celular. Siempre se guardan primero en la cola, también con internet. La interfaz indica que falta sincronizar; la subida en esta versión es explícita mediante el botón, sin trabajador Android en segundo plano.
6. Pulsar sincronizar al recuperar conexión y antes de que se cumplan las 24 horas. Consultar la cola y las incidencias. Los demás celulares y la web operan directamente online; no se comunican por Bluetooth, LAN ni entre bases móviles.

El alumno recién aprobado y pagado puede marcar asistencia inmediatamente en ese mismo celular, con su horario y saldo local. El carnet y recibo internos pueden emitirse como PDF local; se identifican pendientes. La cuenta DNI/DNI temporal se activa en nube al consolidar el pago, con cambio obligatorio; no nacen nuevas credenciales offline. El recibo final conserva la referencia LOCAL del pago.

Configuración, planes, entrenadores, clases, cuentas, ajustes administrativos, avisos y reposición de credenciales/QR se administran online. En el equipo que usa la copia comercial, utilizar la web para esas tareas y sincronizar después. El portal del alumno consulta la nube y señala que las inasistencias pueden regularizarse con asistencia recibida tarde.

## Pendientes y recuperación

SQLite guarda la operación firmada y sus efectos en una única transacción `BEGIN IMMEDIATE`, con conexión descifrada antes del acceso. La cola sobrevive al cierre de la app. Nunca se borra al cerrar sesión o vencer el permiso. Los acuses conservan resultados, y una copia con confirmaciones recibidas exige terminar la descarga antes de admitir más cambios.

Al vencer 24 horas se bloquean nuevas operaciones y se conserva consulta local en el mismo arranque con reloj coherente. Reiniciar el teléfono o cambiar su reloj exige reconectar; no extiende el plazo. La suspensión se mide con el reloj monotónico Android que incluye tiempo dormido. Debe calificarse en el hardware real.

Una sesión cloud vencida requiere iniciar sesión online con el mismo operador y volver a sincronizar. **Enviar pendientes de mi operador (recuperación online)** permite enviar la cola conservada aun cuando cambiaron sus permisos; la nube descarta/audita las operaciones incompatibles con los permisos actuales. Ese botón no renueva el permiso. No cambiar de operador con cola sin confirmar: el nuevo usuario no puede atribuirse operaciones del anterior.

Reinstalar, borrar almacenamiento o perder el celular puede perder operaciones nunca enviadas y su clave local. El respaldo PostgreSQL incluye solo datos consolidados. Conservar el equipo hasta enviar/revisar su cola; una nueva instalación recupera la secuencia cloud pero no inventa pendientes perdidos. Ante corrupción de clave/base, el programa falla cerrado y conserva archivos; no los reemplaza silenciosamente.

## Conflictos y dinero

La nube conserva el primer cambio válido aceptado bajo bloqueo y transacción por academia. Cada secuencia/UUID tiene resultado durable; repetir tras timeout devuelve el mismo acuse sin cobrar o marcar asistencia dos veces. Cambiar el contenido de una secuencia ya recibida se rechaza. Los cambios de catálogo/versiones usados para cotizar también se comprueban.

Las operaciones incompatibles quedan como incidencias con actor, dispositivo, original, motivo y registro prevaleciente cuando se identifica. No se copian salud, tokens ni bytes de imágenes indiscriminadamente a auditoría. Las inscripciones distintas con sobrecupo se conservan por el canal offline verificado y generan advertencia de auditoría, para decisión administrativa.

**Decisión del fundador: bloquear cierre hasta conciliación del administrador.** Un cobro descartado que implicó dinero recibido abre incidencia y bloquea el cierre del cobrador. En **Incidencias de sincronización**, ADMIN consulta la evidencia, aplica la solución real y registra su descripción y confirmación de conciliación. El registro no crea ingresos, devoluciones ni pagos automáticamente. Si la solución requiere un movimiento, devolución o reasignación, debe quedar efectuada y justificada antes de confirmar.

Ejemplo: nube confirmó S/100, luego llega otro cobro offline de S/100 para la misma mensualidad. Se conserva un pago aplicado; el segundo cobro queda en auditoría y la caja no cierra. Tras devolver los S/100 duplicados y verificarlo, ADMIN registra esa solución. El cobrador sincroniza, revisa el efectivo real y solicita un nuevo cierre. Un cierre previamente rechazado no se ejecuta solo al resolver la incidencia.

## Contrato y límites de esta versión

- `POST /sync/push`: secuencia contigua, acción permitida, entrada, instante de captura, permiso comercial firmado por servidor, bases y firma Ed25519 del dispositivo. Captura dentro de su ventana de 24 h; subida tardía admitida con sesión actual. Acuse y efecto/incidencia en la misma transacción PostgreSQL con savepoint; fallos de almacenamiento revierten ambos.
- `GET /sync/head/:deviceId` consulta secuencia recibida dentro de la academia. `POST /sync/pull` exige posesión del dispositivo y cola confirmada; devuelve snapshot y nuevo permiso. El permiso antiguo de solo acceso no habilita negocio offline.
- `GET /sync/incidents` muestra las propias o todas a ADMIN. `POST /sync/reconcile` exige permiso administrativo, solución y confirmación explícita; deja auditoría y no altera el libro por inferencia.
- Copia máxima: 5.000 filas por tabla, 16 MB de imágenes saneadas, 32 MB de JSON. Se rechaza una copia demasiado grande; no se trunca ni se renueva permiso. Antes de usar con volúmenes mayores se debe ampliar el protocolo/paginación y calificar rendimiento. Imágenes de entrada: JPG/PNG hasta 5 MB, saneadas por servidor antes de servirlas. Cola cifrada conserva sus originales y acuses; no hay purga automática ni borrado de evidencia no confirmada.
- Sin garantía de sincronización con app cerrada. Un error de red mantiene la operación pendiente para reintentar. No se presume que un HTTP fallido signifique que el servidor no guardó el cambio.

## Verificación

Pruebas de reglas, firmas, plazo exacto, posesión/ámbito, SQLite real reabriendo archivos, rollback después de insertar cola y antes de actualizar proyección, acuses idempotentes y bloqueo hasta descargar. PostgreSQL real comprueba replay, DNI/asistencia/pago duplicados, cola sin confirmar, transacción efecto/acuse, conciliación administrativa, equivalencia local/nube con versiones/QR/importe y sobrecupo retenido. El respaldo cifrado se restaura en una base efímera con las cuatro migraciones.

Compilar JS/Hermes o ensamblar un APK no sustituye las pruebas con Android real. Antes de operar con dinero: calificar modo avión, suspensión y reinicio, permisos de cámara/galería, disco lleno, cierre forzado con pendientes, reintento tras pérdida de red, impresión/compartir PDF y recuperación. Hosting, HTTPS, destino/retención automática de respaldos y monitoreo también requieren preparación del entorno. No hay despliegue cloud productivo ni APK de producción configurado en este repositorio.

Evidencia local del hito: 22 pruebas unitarias y 30 integraciones PostgreSQL sin omitidas; lint/tipos/build API y Next, bundle Hermes Android de 749 módulos, smoke completo de navegador y backup/restore aislado con 004_sync correctos. El workflow Android ensambla el APK completo para comprobar también dependencias nativas; su resultado se consulta en GitHub. Las pruebas SQLite de escritorio califican persistencia/transacciones, no sustituyen una prueba de cifrado en el dispositivo.
