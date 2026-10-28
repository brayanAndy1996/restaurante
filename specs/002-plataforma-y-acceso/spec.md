# 002 · Plataforma y acceso

- **Historias y requerimientos:** HU-01 (lo que faltaba: la suscripción de la sucursal en el alta y el alta por HTTP), HU-02, HU-03, HU-04; RF-03 a RF-13; RF-01 y RF-02 por HTTP (regla de rol, endpoints de plataforma). RNF que aplican: RNF-03, RNF-06, RNF-07, RNF-08 (con el texto nuevo propuesto en "Cambios propuestos a los documentos compartidos"), RNF-09, RNF-10, RNF-11, RNF-13, RNF-14, RNF-18. Requisito transversal de trazabilidad pedido por el usuario (criterios 113 a 120). Fuente de negocio: `fuentes.md` de esta carpeta y "Decisiones del usuario".
- **Ruta crítica:** sí, en parte. Ver "Clasificación de ruta crítica".
- **Estado:** aprobada (2026-10-27)

## Objetivo

Que cada persona entre al sistema con su propio usuario, desde su celular o desde cualquier equipo, y solo vea y haga lo que su rol le permite: la primera vez en cada equipo con usuario y contraseña, y desde entonces con su PIN en ese equipo, dentro de su horario si lo tiene; y que el supervisor autorice acciones protegidas con su PIN desde el equipo de quien pide, todo con auditoría inmutable y con cada registro marcado con quién lo creó y quién lo cambió. Además, que nuestro equipo (superadministrador) dé de alta empresas por HTTP con la suscripción de cada sucursal, registre pagos, controle vencimientos y entre a dar soporte con registro. La sesión autenticada pasa a ser la única fuente de la empresa y de la persona de cada petición, reemplazando el punto de enganche que dejó la historia 001.

## Clasificación de ruta crítica

| Parte | Crítica | Motivo |
| --- | --- | --- |
| Sesión, resolutor de empresa por sesión, rutas protegidas por defecto, cabecera `x-empresa-id` solo en pruebas (criterios 1 a 9) | sí | Decide la empresa de cada petición: es el aislamiento entre empresas (RLS) llevado a la autenticación. |
| Ingreso con usuario y contraseña, bloqueo por intentos (10 a 17) | sí | Es la puerta de los permisos; una falla da acceso a una empresa ajena o a otro usuario. |
| Quién puede administrar usuarios y accesos (25), largo y unicidad del PIN (21, 21b) | sí | Permisos. El resto del mantenimiento de usuarios (18 a 20, 22 a 24, 26) no: "mantenimiento simple de usuarios" está fuera de la lista de `CLAUDE.md`; sus pruebas las decide el desarrollador. |
| Equipos recordados e ingreso con PIN (27 a 42) | sí | Permisos: equipos (reemplazan a los "equipos vinculados" de la lista de `CLAUDE.md`). |
| Clave de supervisor y matriz de permisos (43 a 53) | sí | Permisos: clave de supervisor. |
| Auditoría general y unión con `auditoria_plataforma` (54 a 60) | sí | Permisos: auditoría (RNF-09). |
| Superadministrador por HTTP y soporte (61 a 68) | sí | El soporte cruza empresas y debe quedar auditado; un error rompe el aislamiento. |
| Catálogo y RLS de las tablas nuevas (88 a 91) | sí | Aislamiento entre empresas. |
| Horario de acceso por trabajador (105 a 112) | sí | Permisos: decide si una persona puede entrar o autorizar (decisión del usuario). |
| Trazabilidad: quién creó y quién cambió cada registro (113 a 120) | sí | Auditoría (decisión del usuario). |
| Suscripción, planes, módulos, cuota y suspensión (69 a 84) | no | No están en la lista. La suspensión solo se consulta al abrir caja, y la historia de caja (crítica) la probará en su flujo. El aislamiento y la trazabilidad de sus tablas sí quedan cubiertos por los criterios 88 a 91 y 113. |
| Idempotencia genérica (85 a 87) | no | Infraestructura; se ataca cuando la use "Enviar comanda" (crítica). |
| Interfaz de la PWA y panel del superadministrador (92 a 104) | no | Interfaz; la seguridad la impone la API. |

## Decisión sobre la interfaz

Esta sección **incluye pantallas** en `apps/app` (PWA nueva, React + Vite), y el rol `frontend` usa la skill `impeccable` en modo "Operate". El diseño es **móvil primero**: la PWA se usa sobre todo en celulares, en pantallas chicas y con conexión variable (decisión del usuario). Motivos para incluirlas:

1. Los criterios de HU-02, HU-03 y HU-04 son de interfaz ("en un equipo que no la recuerda se piden usuario y contraseña", "aparece una ventana que pide el PIN", "el administrador ve avisos"): sin pantallas no se pueden aceptar.
2. La PWA, su cliente HTTP (con clave de idempotencia y reintentos), el guardado del token del equipo y el cierre por inactividad son la base de todas las secciones siguientes; armarlos con el acceso evita rehacerlos.
3. Sin un panel mínimo, el alta de clientes y el registro de pagos (HU-01, RF-03) exigirían llamar la API a mano.

El panel del superadministrador vive en la misma PWA bajo `/plataforma`, con su propio ingreso. Es mínimo: formularios y tablas, sin pulido extra.

## Glosario

- **Sesión de empresa:** credencial temporal de una persona dentro de una empresa. Tipos: `CONTRASENA` (usuario y contraseña, cualquier equipo), `PIN` (solo en un equipo que recuerda a la persona), `SOPORTE` (superadministrador dentro de una empresa). Token `se.<empresaId>.<sesionId>.<secreto>`.
- **Sesión de superadministrador:** credencial del personal de nuestra empresa para las rutas `/plataforma/*`. Token `sa.<sesionId>.<secreto>`. No da acceso a datos de ninguna empresa por sí sola.
- **Equipo:** el navegador de un celular, tablet o computadora en el que alguien de una empresa entró con contraseña. La API lo identifica con un token de equipo `eq.<empresaId>.<equipoId>.<secreto>` que la PWA guarda en el navegador y manda en la cabecera `X-Equipo`. Pertenece a una empresa y a ninguna sucursal. Si en el mismo navegador entran personas de dos empresas, la PWA guarda un token por empresa.
- **Equipo recordado:** la relación entre un equipo y una persona que entró en él con contraseña (tabla `equipo_recordado`). Solo mientras está activa sirve el PIN de esa persona en ese equipo. Un equipo recuerda como máximo a 5 personas.
- **Horario de acceso:** tramos semanales (como el horario de la sucursal de 001) en los que un trabajador puede iniciar sesión o autorizar como supervisor. Opcional; el Administrador nunca tiene.
- **Actor:** quién hace un cambio: exactamente uno entre un usuario de la empresa (con el equipo, si la sesión tiene uno), un superadministrador o un actor de sistema (`semilla`, `cli:<script>`, `migracion:<nombre>`, `autenticacion`, `prueba`).
- **Contexto de actor:** el actor de la transacción, fijado una sola vez con `fijar_contexto_actor`, igual que la empresa con `fijar_contexto_empresa`. Lo leen los triggers de trazabilidad y de auditoría.
- **Principal:** quién hace la petición, calculado en cada petición por la API: tipo de sesión, empresa, usuario o superadministrador, sucursal activa, rol en ella, equipo y equipo recordado.
- **Sucursal activa:** la sucursal en la que trabaja la sesión; la elige la persona entre las que tiene acceso (criterios 10, 17 y 33).
- **Acción protegida:** acción que para algunos roles exige clave de supervisor (matriz de "Roles y permisos" del documento de diseño).
- **Autorización:** permiso de un solo uso que crea un supervisor con su PIN para una acción protegida de otra persona, válido por poco tiempo.
- **Reloj de la API:** proveedor `RELOJ` del que la API toma la hora para toda regla de tiempo (inactividad, vencimientos, bloqueos, horario, auditoría). Las pruebas lo reemplazan.

## Criterios de aceptación

Salvo que se diga otra cosa: hay dos empresas, **A** y **B**, dadas de alta con la vía de plataforma, cada una con al menos dos sucursales y usuarios de cada rol; "con sesión de X" significa con `Authorization: Bearer <token>` de una sesión válida de X; las horas se controlan con el reloj de la API y son de Lima; toda respuesta de error tiene la forma `{ codigo, mensaje, campos? }` de la historia 001 (criterio 40d) y nunca incluye detalles de PostgreSQL. Los números se conservan de la versión en borrador; los criterios nuevos llevan letra (12b) o van del 105 en adelante.

### Sesión, resolutor y rutas protegidas (ruta crítica)

1. **Rutas protegidas por defecto.** Dada la API sin el resolutor por cabecera (criterio 7) y cualquier ruta registrada en la aplicación que no esté marcada `@Publica()` ni sea de `/plataforma/*`, cuando llega sin `Authorization`, con un token mal formado, con un token de una sesión cerrada, con el token de un superadministrador (`sa.…`) o con un token de equipo (`eq.…`) como `Authorization`, entonces responde 401 `NO_AUTENTICADO` (o `SESION_EXPIRADA`, criterios 14 y 39), el controlador no se ejecuta y no se abre ningún contexto de empresa. La prueba recorre todas las rutas que Nest tiene registradas (no una lista fija). Las únicas rutas públicas permitidas son `GET /health`, `POST /sesiones/contrasena`, `POST /sesiones/pin`, `GET /equipo` y `POST /plataforma/sesiones`; una ruta pública que no esté en esa lista hace fallar la prueba.
2. **La empresa sale de la sesión.** Dado un usuario de A con sesión válida, cuando llama cualquier ruta de empresa, entonces corre con el contexto de A, y ninguna cabecera, parámetro ni cuerpo cambia la empresa: con `x-empresa-id` = B, `GET /sucursales` devuelve solo sucursales de A (en `NODE_ENV` `test`, `development` y `production`).
3. **Token adulterado.** Dado un token válido de una sesión de A, cuando se reemplaza la parte de empresa por el id de B, la parte de sesión por el id de una sesión de B (con el secreto de A), o el secreto por otro, entonces cada intento responde 401 `NO_AUTENTICADO` con el mismo cuerpo, sin datos de B; y la sesión de B sigue válida y su `ultimaActividadEn` no cambia.
4. **Secretos no guardados.** Dada una sesión, un equipo o una sesión de superadministrador recién creados, cuando se inspeccionan sus filas en la base, entonces ninguna columna contiene el token ni su secreto en claro: solo su huella SHA-256.
5. **Concurrencia.** Dado un pool de la API de 2 conexiones, cuando llegan 100 peticiones concurrentes alternando sesiones de A y de B, entonces cada respuesta contiene solo datos de su empresa (equivalente al criterio 26 de 001, ahora con sesiones).
6. **Rol y acceso en cada petición.** Dada una sesión abierta, cuando el Administrador cambia el rol del usuario en la sucursal activa, entonces la siguiente petición de esa sesión ya usa el rol nuevo; cuando lo desactiva o le quita el acceso a la sucursal activa de esa sesión, entonces la sesión queda cerrada y su siguiente petición responde 401 `NO_AUTENTICADO`.
7. **Cabecera de empresa solo en pruebas.** Dado `NODE_ENV=development` con `EMPRESA_POR_HEADER=habilitado`, cuando arranca la API, entonces no arranca y el registro explica que la opción solo vale con `NODE_ENV=test` (con `production` sigue igual que en 001). Dado `NODE_ENV=test` con la opción habilitada: una petición **sin** `Authorization` corre con la empresa de `x-empresa-id` como en la historia 001, con un principal de prueba con permisos de Administrador en todas las sucursales de esa empresa y actor de sistema `prueba` (y sin cabecera, o con una inválida, responde 401 `EMPRESA_NO_RESUELTA` como en 001); una petición **con** `Authorization` ignora la cabecera. Sin la opción, la cabecera se ignora siempre.
8. **Producción sin sesión.** Dado `NODE_ENV=production`, cuando llega `GET /sucursales` con `x-empresa-id` de una empresa real y sin `Authorization`, entonces responde 401 `NO_AUTENTICADO` (reemplaza el `EMPRESA_NO_RESUELTA` del criterio 30 de 001).
9. **Regla de rol en emisores y sucursales** (notas de 001). `GET /sucursales`, `GET /sucursales/:id` y `GET /emisores`: cualquier rol con sesión en la empresa. `POST /emisores`, `POST /sucursales`, `PATCH /sucursales/:id`, `GET` y `PATCH /sucursales/:id/acceso`: solo Administrador (y sesión de soporte). Dado cualquier otro rol (con sesión de contraseña o de PIN), cuando llama esas rutas de escritura, entonces responde 403 `PROHIBIDO` y nada cambia. Los criterios 18, 39 y 40 de 001 siguen valiendo con sesión de Administrador.

### Ingreso con usuario y contraseña (ruta crítica)

10. **Ingreso correcto.** Dado un usuario activo, dentro de su horario (criterio 107), cuando llama `POST /sesiones/contrasena` con `{ usuario, contrasena }` correctos (el nombre de usuario sin distinguir mayúsculas), desde cualquier equipo, entonces responde 201 `{ token, sesion }` con una sesión `CONTRASENA`; la sucursal activa es la única a la que tiene acceso, o `null` si tiene varias (el Administrador tiene acceso a todas). El ingreso no exige ni crea un equipo: el equipo se recuerda después (criterio 27).
11. **Fallo sin pistas.** Dada una contraseña incorrecta, un usuario inexistente o un usuario inactivo, cuando intenta ingresar, entonces responde 401 `CREDENCIALES_INVALIDAS` con el mismo cuerpo en todos los casos y no se crea sesión. Los ingresos simultáneos que exceden los topes por proceso del plan ("Ingreso con contraseña en tres tiempos": por nombre y del semáforo de scrypt) responden 429 `BLOQUEO_TEMPORAL` con `reintentarEnSegundos: 1`, sin evaluar la contraseña ni contar como fallo, exista o no el nombre, así que el exceso tampoco da pistas (igual en `POST /plataforma/sesiones`, criterio 61).
12. **Bloqueo por intentos.** Dados 5 fallos seguidos con el mismo nombre de usuario existente, cuando intenta de nuevo durante los 15 minutos siguientes al quinto fallo, entonces responde 429 `BLOQUEO_TEMPORAL` con `reintentarEnSegundos`, aunque la contraseña sea correcta, sin evaluarla; pasados los 15 minutos, la contraseña correcta funciona. Un ingreso correcto antes del quinto fallo reinicia la cuenta. Solo cuentan los fallos ya evaluados: un intento simultáneo que llega cuando los fallos seguidos más las evaluaciones en curso de la cuenta ya suman 5 responde 429 `BLOQUEO_TEMPORAL` con `reintentarEnSegundos: 1`, sin evaluar, sin contar como fallo y sin bloquear (varios ingresos correctos simultáneos nunca bloquean la cuenta). Los fallos quedan registrados aunque la respuesta sea un error, y el bloqueo deja una fila de auditoría. El bloqueo de un usuario no afecta a otros usuarios de A ni de B.
12b. **Fuera de horario con contraseña.** Dado un usuario con horario y la contraseña correcta, cuando ingresa fuera de su horario, entonces responde 403 `FUERA_DE_HORARIO` y no se crea sesión (detalle en el criterio 107). Con la contraseña incorrecta, la respuesta es la del criterio 11 o 12, sin revelar el horario.
13. **Contraseña.** Todo usuario de empresa tiene contraseña (decisión del usuario). Una contraseña tiene de 8 a 128 caracteres, sin NUL ni sustitutos UTF-16 sueltos (criterios 40b y 40c de 001). Se guarda con scrypt (formato del plan), nunca en claro, y ninguna respuesta, fila de auditoría ni registro la contiene.
14. **Inactividad y duración.** Dada una sesión `CONTRASENA`, cuando pasan 30 minutos sin peticiones, o 12 horas desde que se creó, entonces la siguiente petición responde 401 `SESION_EXPIRADA` y la sesión queda cerrada. Toda petición autenticada renueva la actividad, salvo las que llevan `X-Actividad: segundo-plano`, que se validan pero no renuevan.
15. **Cambio de contraseña obligatorio.** Dado un usuario con contraseña temporal (alta o restablecimiento), cuando ingresa, entonces la sesión trae `debeCambiarContrasena: true` y toda ruta, salvo `GET /sesion`, `PUT /sesion/contrasena` y `DELETE /sesion`, responde 403 `CAMBIO_CONTRASENA_REQUERIDO` (incluida `POST /sesion/equipo`: el equipo no se recuerda hasta que la contraseña deja de ser temporal); después de cambiarla, todo funciona según su rol.
16. **Cambiar la propia contraseña.** `PUT /sesion/contrasena` con `{ actual, nueva }`, solo en sesiones `CONTRASENA`: con `actual` incorrecta responde 401 `CREDENCIALES_INVALIDAS` y cuenta para el bloqueo del criterio 12; con `nueva` inválida o igual a la actual, 400 `DATOS_INVALIDOS`; si es correcta, 204, se cierran las demás sesiones del usuario y la actual sigue; los equipos recordados se conservan. En una sesión PIN o de soporte responde 403 `PROHIBIDO`.
17. **Sucursal activa y salida.** `PUT /sesion/sucursal` con `{ sucursalId }`, en sesiones `CONTRASENA`, `PIN` y `SOPORTE`: si el usuario tiene acceso, responde 200 con la sesión y el rol de esa sucursal (en una sesión PIN, además queda como la última sucursal de esa persona en ese equipo, criterio 33); si no tiene acceso, la sucursal es de B o no existe, 404 `NO_ENCONTRADO` idéntico. Cambiar de sucursal no comprueba el horario (criterio 108). Una ruta que necesita sucursal activa, con la sesión sin sucursal elegida, responde 409 `SUCURSAL_NO_ELEGIDA`. `DELETE /sesion` responde 204 y el token deja de valer.

### Usuarios y accesos (RF-08)

18. **Alta de usuario.** Dado un Administrador, cuando llama `POST /usuarios` con `{ nombre, nombreUsuario, esAdministrador, accesos: [{ sucursalId, rol }], contrasenaTemporal, horario? }`, entonces responde 201 con el usuario y un `pin` del largo que le corresponde (criterio 21) que solo se muestra en esa respuesta. `contrasenaTemporal` es obligatoria para todos (decisión del usuario). Un Administrador no lleva ninguna fila en `accesos` ni horario; los demás llevan al menos un acceso y, si se envía, un horario (criterio 106).
19. **Nombre de usuario.** De 3 a 50 caracteres `a-z`, `0-9`, `.`, `_` o `-`, guardado en minúsculas, único en todo el sistema. Si ya existe (en A o en B), responde 409 `CONFLICTO` con el mismo mensaje en ambos casos, sin decir de qué empresa es.
20. **Accesos.** Un acceso con una sucursal de B o inexistente responde 422 `SUCURSAL_INVALIDA` idéntico; un rol fuera de `MOZO`, `CAJERO`, `COCINA_BARRA` o `SUPERVISOR`, o la misma sucursal dos veces, 400 `DATOS_INVALIDOS`.
21. **PIN** (ruta crítica). El largo del PIN lo dan los roles (`largoPin` de `packages/dominio`): 6 dígitos si el usuario es Administrador o tiene `CAJERO` o `SUPERVISOR` en alguna sucursal; 4 dígitos si todos sus accesos son `MOZO` o `COCINA_BARRA`. Ejemplos: Mozo en S1 → 4; Mozo en S1 y Cocina/Barra en S2 → 4; Mozo en S1 y Cajero en S2 → 6; Administrador → 6. El PIN lo genera la API al azar (generador criptográfico), es único entre los usuarios de la empresa y puede repetirse en otra empresa. `POST /usuarios/:id/pin` genera uno nuevo del largo vigente (se muestra una vez), el anterior deja de funcionar y se cierran las sesiones PIN del usuario; los equipos recordados se conservan.
21b. **Cambio de largo** (ruta crítica). Dado un usuario, cuando `PATCH /usuarios/:id` cambia sus accesos o `esAdministrador` de modo que el largo de su PIN cambia (de 4 a 6 o de 6 a 4), entonces en la misma transacción se genera un PIN nuevo del largo nuevo, la respuesta 200 lo incluye como `pin` (única vez que se muestra), el anterior deja de funcionar y se cierran sus sesiones PIN; si el largo no cambia, la respuesta no trae `pin` y el PIN sigue igual. Nunca queda un usuario con un PIN de largo distinto del que dan sus roles.
22. **Edición.** `PATCH /usuarios/:id` con `{ nombre?, esAdministrador?, accesos?, activo?, horario? }` reemplaza lo enviado (los accesos, completos). Desactivar cierra todas las sesiones del usuario y revoca todos sus equipos recordados (reactivarlo no los recupera). Si el cambio dejaría a la empresa sin ningún Administrador activo, responde 409 `ULTIMO_ADMINISTRADOR` y nada cambia.
23. **Restablecer contraseña.** `POST /usuarios/:id/contrasena` con `{ contrasenaTemporal }` (obligatoria; `null` responde 400) deja la contraseña como temporal (criterio 15), cierra las sesiones del usuario y revoca todos sus equipos recordados, así que la persona vuelve a entrar con la contraseña temporal en cada equipo.
24. **Consulta.** `GET /usuarios` y `GET /usuarios/:id` devuelven nombre, nombre de usuario, `esAdministrador`, accesos, `activo`, `horario`, `largoPin`, `contrasenaTemporal`, la cantidad de equipos recordados activos y fechas; nunca hashes, huellas ni PIN. Un usuario de B responde 404 `NO_ENCONTRADO` igual que uno inexistente.
25. **Solo el Administrador** (ruta crítica). Dado cualquier rol distinto de Administrador (sesión de contraseña o de PIN), cuando llama cualquier ruta de `/usuarios` (incluidas `/usuarios/:id/equipos`), entonces responde 403 `PROHIBIDO` y nada cambia ni se crea.
26. **Auditoría.** Crear, editar (incluido el horario), regenerar PIN (a pedido o por cambio de largo) y restablecer contraseña dejan una fila de auditoría con el actor y el antes y después de los campos cambiados, sin secretos (criterio 59).

### Equipos recordados (RF-09, RF-10, RNF-08 reescrito; ruta crítica)

27. **Recordar el equipo.** Dado un usuario con sesión `CONTRASENA` y contraseña no temporal, cuando llama `POST /sesion/equipo` con `{ nombre? }` (1 a 60; por defecto `Equipo sin nombre`):
    - sin `X-Equipo`, con uno mal formado, adulterado o de otra empresa (la API no lo busca fuera de la empresa de la sesión), entonces crea un equipo nuevo de la empresa y responde 201 `{ equipo: { id, nombre }, tokenEquipo }`; el token solo se muestra en esa respuesta;
    - con el `X-Equipo` válido de un equipo de la empresa de la sesión, responde 200 `{ equipo }` sin token;
    - en ambos casos queda activo el equipo recordado (ese equipo, ese usuario) —si ya lo estaba, solo se actualiza su último uso— y la sesión queda asociada a él (criterio 30).
    Repetirlo en la misma sesión con el mismo equipo responde 200 sin otro efecto; con otro equipo, 409 `CONFLICTO`. En una sesión `PIN`, `SOPORTE` o de prueba responde 403 `PROHIBIDO`; con contraseña temporal, 403 `CAMBIO_CONTRASENA_REQUERIDO`.
28. **Consultar el equipo.** `GET /equipo` (pública) con `X-Equipo` válido responde 200 `{ equipo: { id, nombre }, personas: [{ usuarioId, nombre, largoPin, bloqueadoHastaEn }] }` con las personas activas que el equipo recuerda, de la usada más recientemente a la más antigua (lista vacía si no recuerda a nadie). Sin la cabecera, mal formada o adulterada (empresa cambiada a B, id de un equipo de B, otro secreto), responde 401 `EQUIPO_NO_RECONOCIDO` con el mismo cuerpo.
29. **Máximo 5 personas por equipo.** Dado un equipo que recuerda a 5 personas, cuando una sexta lo hace recordarla (criterio 27), entonces el equipo deja de recordar a la persona con el último uso más antiguo (a igualdad, a la recordada primero), con motivo `REEMPLAZADO`; se cierran las sesiones de esa persona asociadas a ese equipo y queda una fila de auditoría. Dos recordatorios concurrentes en el mismo equipo nunca dejan más de 5 personas activas.
30. **Revocar (Administrador).** `GET /usuarios/:id/equipos` devuelve los equipos recordados activos del usuario: `[{ id, equipo: { id, nombre }, recordadoEn, ultimoUsoEn }]`. `DELETE /usuarios/:id/equipos/:equipoRecordadoId` revoca uno y `DELETE /usuarios/:id/equipos` revoca todos; responden 204. Desde la siguiente petición, el PIN de esa persona no sirve en esos equipos (criterio 34) y todas las sesiones de esa persona asociadas a ellos (PIN o contraseña) quedan cerradas (401 `NO_AUTENTICADO`); las demás personas de esos equipos no se ven afectadas. Repetirlo responde 204 sin otro efecto ni otra auditoría. Un usuario de B, o un equipo recordado de otro usuario, responde 404.
31. **Olvidar (la propia persona).** En una sesión `CONTRASENA` o `PIN`, `GET /sesion/equipos` devuelve los equipos recordados activos de la propia persona (como el criterio 30), marcando cuál es el de la sesión actual, y `DELETE /sesion/equipos/:equipoRecordadoId` deja de recordar ese equipo (204), con los mismos efectos del criterio 30; si es el de la sesión actual, la sesión actual también se cierra. Un equipo recordado de otra persona o de B responde 404. En una sesión de soporte, 403 `PROHIBIDO`.
32. **Auditoría.** Recordar, olvidar, revocar, reemplazar y olvidar por bloqueo (criterio 36) dejan su fila de auditoría con el equipo y la persona, sin el token.
32b. **Revocaciones automáticas.** Desactivar a un usuario (criterio 22) o restablecer su contraseña (criterio 23) revoca todos sus equipos recordados en la misma transacción, con motivo `DESACTIVADO` o `CONTRASENA_RESTABLECIDA`.

### Ingreso con PIN, cambio rápido e inactividad (HU-02, RF-09, RF-11, ruta crítica)

33. **Ingreso con PIN.** Dado un equipo E que recuerda a la persona U (activa, con contraseña no temporal), cuando llama `POST /sesiones/pin` con el `X-Equipo` de E y `{ usuarioId: U, pin }` con su PIN, dentro de su horario, entonces responde 201 `{ token, sesion }` con una sesión `PIN` asociada al equipo recordado (E, U). La sucursal activa es la única a la que U tiene acceso; si tiene varias (o es Administrador), la última que U eligió en E si todavía tiene acceso, y si no, `null` (elige con el criterio 17). El rol es el de U en esa sucursal. Se actualiza el último uso de (E, U).
34. **Solo donde entró con contraseña.** Sin `X-Equipo` válido, `POST /sesiones/pin` responde 401 `EQUIPO_NO_RECONOCIDO` sin evaluar el PIN ni contar intentos. Con un `X-Equipo` válido y un `usuarioId` que E no recuerda (nunca entró con contraseña en E, o fue revocado, olvidado o reemplazado, o es un usuario de B o inexistente), responde 401 `CREDENCIALES_INVALIDAS`, con el mismo cuerpo del criterio 35, sin evaluar el PIN ni contar intentos. `POST /sesiones/pin` no acepta usuario ni contraseña (400), y un PIN usado como contraseña en `POST /sesiones/contrasena` es solo una contraseña incorrecta.
35. **PIN rechazado.** Con E que recuerda a U, un PIN que no es el de U (incluido uno de otro largo o el PIN de otra persona de E) responde 401 `CREDENCIALES_INVALIDAS` con el mismo cuerpo y cuenta un fallo para (E, U). Como defensa en profundidad, si U estuviera inactivo o con contraseña temporal y (E, U) siguiera activo (lo que el criterio 32b impide), el PIN correcto también responde 401 `CREDENCIALES_INVALIDAS` sin crear sesión.
36. **Bloqueo por persona en el equipo.** Los fallos se cuentan por (E, U) y se reinician con un PIN correcto. Al 5.º y al 10.º fallo seguido, (E, U) queda bloqueado 5 minutos: un intento en ese lapso responde 429 `BLOQUEO_TEMPORAL` sin evaluar el PIN. Al 15.º fallo seguido, E deja de recordar a U (motivo `BLOQUEO`), se cierran las sesiones de U asociadas a E, y el siguiente intento responde como el criterio 34 (U tiene que volver a entrar con contraseña en E). Los bloqueos de (E, U) no afectan a las demás personas de E, ni a U en otros equipos, ni el ingreso con contraseña. Los fallos quedan registrados aunque la respuesta sea un error, y cada bloqueo y el olvido dejan una fila de auditoría.
37. **Sesión atada al equipo.** Cada petición de una sesión PIN debe traer el `X-Equipo` del mismo equipo, y (E, U) debe seguir activo; sin la cabecera, con la de otro equipo (aunque sea válido y recuerde a U) o con (E, U) revocado, responde 401 `NO_AUTENTICADO`. Una sesión `CONTRASENA` asociada a un equipo recordado no exige la cabecera, pero se cierra cuando ese equipo recordado se revoca (criterio 30).
38. **Cambio rápido de usuario.** Dada una sesión PIN abierta en un equipo, cuando otra persona (o la misma) ingresa con PIN en ese equipo, entonces la sesión anterior queda cerrada y su token responde 401 `NO_AUTENTICADO`. Un equipo tiene como máximo una sesión PIN abierta; las sesiones de contraseña no cuentan. `DELETE /sesion` cierra la sesión y el equipo sigue recordando a la persona.
39. **Inactividad.** Una sesión PIN vale mientras no pasen los minutos de inactividad de su sucursal activa (por defecto 5; sin sucursal activa, 5) desde su última actividad, ni 12 horas desde que se creó; después, la siguiente petición responde 401 `SESION_EXPIRADA` y la sesión queda cerrada. Al cambiar de sucursal activa, rigen los minutos de la nueva desde la siguiente petición. `X-Actividad: segundo-plano` valida sin renovar (criterio 14).
40. **Configurar la inactividad.** `GET /sucursales/:id/acceso` y `PATCH /sucursales/:id/acceso` con `{ minutosInactividad }` (entero de 1 a 120), solo Administrador. El valor nuevo se aplica desde la siguiente petición de las sesiones PIN abiertas con esa sucursal activa y el cambio se audita. Una sucursal de B responde 404.
41. **Límites de la sesión PIN.** Una sesión PIN no puede cambiar la contraseña (criterio 16) ni recordar equipos (criterio 27): 403 `PROHIBIDO`. Sí puede cambiar de sucursal activa (criterio 17) y olvidar equipos propios (criterio 31).
42. **Sesión actual.** `GET /sesion` devuelve `{ tipo, empresaId, usuario, superadministrador, rol, esAdministrador, sucursal, sucursales, equipo, permisos, modulos, avisoSuscripcion, debeCambiarContrasena, expiraPorInactividadEn }` según `sesionRespuestaSchema`. `equipo` es `{ id, nombre, equipoRecordadoId }` del equipo recordado asociado a la sesión, o `null`. `permisos` es el requisito de cada acción para el rol en la sucursal activa (criterio 43); `sucursales`, las que puede elegir.

### Clave de supervisor (HU-03, RF-12, ruta crítica)

43. **Matriz de permisos.** `requisitoPermiso(rol, accion)` de `packages/dominio` devuelve `permitido`, `clave` o `prohibido` exactamente como la tabla "Roles y permisos" del documento de diseño, celda por celda (tabla en "Reglas de negocio"); `alcanceReportes(rol)` devuelve `TURNO` (Cajero), `SUCURSAL` (Supervisor), `EMPRESA` (Administrador) o `null`. Prueba unitaria por cada celda.
44. **Autorizar.** Dada una sesión de un Cajero en S, cuando llama `POST /autorizaciones` con `{ accion, motivo, pin }`, donde la acción exige clave para su rol y el PIN (6 dígitos) es de un usuario activo, distinto del solicitante, dentro de su horario, cuyo rol en S tiene esa acción como `permitido` (Supervisor o Administrador), entonces responde 201 `{ autorizacionId, accion, autorizadoPor: { id, nombre }, expiraEn }`, con `expiraEn` = ahora + 2 minutos, y queda una fila de auditoría `autorizacion_otorgada` con quién pidió, quién autorizó, el motivo, la acción, la sucursal, el equipo y la hora. El supervisor se identifica solo por su PIN (criterio 21: es único en la empresa) y no necesita que el equipo lo recuerde.
45. **PIN rechazado.** Un PIN de 6 dígitos inexistente, de un usuario sin rol autorizador en S (Cajero, o Supervisor de otra sucursal), inactivo, fuera de su horario (criterio 110), de B, o del propio solicitante, responde 403 `CLAVE_INVALIDA` con el mismo cuerpo, no crea autorización, cuenta un fallo y deja una fila de auditoría `autorizacion_rechazada` (solicitante, acción, motivo, y en el detalle el motivo del rechazo sin el PIN), que queda guardada aunque la respuesta sea un error.
46. **Validaciones previas (no cuentan fallo).** Acción desconocida; PIN que no tiene exactamente 6 dígitos; motivo vacío o solo con espacios, de más de 300 caracteres, con NUL o con sustitutos sueltos: 400 `DATOS_INVALIDOS`. Acción `prohibido` para el rol del solicitante: 403 `PROHIBIDO`. Acción `permitido` para su rol: 409 `CLAVE_INNECESARIA`. Sesión sin sucursal activa: 409 `SUCURSAL_NO_ELEGIDA`.
47. **Bloqueo.** Dados 5 fallos seguidos del mismo solicitante (en cualquier equipo), o 5 fallos seguidos en el mismo equipo (de cualquier solicitante, cuando la sesión tiene equipo), cuando se intenta otra autorización durante los 5 minutos siguientes, entonces responde 429 `BLOQUEO_TEMPORAL` sin evaluar el PIN, y el bloqueo deja una fila de auditoría. Una autorización correcta reinicia ambas cuentas. Con el bloqueo vigente, cualquier intento con `Idempotency-Key`, incluida la réplica exacta de uno anterior, responde el mismo 429 `BLOQUEO_TEMPORAL` que un intento sin clave; al vencer el bloqueo, la réplica vuelve a devolver lo guardado (criterio 85).
48. **Consumo en la acción.** Dada una ruta marcada `@Permiso(accion)`: si la acción es `prohibido` para el rol, 403 `PROHIBIDO`; si es `permitido`, se ejecuta sin autorización; si es `clave` y la petición no trae `X-Autorizacion`, 403 `CLAVE_REQUERIDA`; si trae una autorización válida, se ejecuta, la autorización queda usada en la misma transacción y queda una fila de auditoría de la acción con quién pidió, quién autorizó, el motivo, la hora y el `autorizacionId`. (Se prueba con un controlador sonda; las acciones reales llegan con sus historias.)
49. **Autorización inválida.** Una autorización ya usada, vencida (ahora ≥ `expiraEn`), de otra acción, creada por otra sesión (también del mismo usuario en otro equipo), de otra sucursal, de B o inexistente responde 403 `AUTORIZACION_INVALIDA` con el mismo cuerpo, y la acción no se ejecuta.
50. **Atomicidad y concurrencia.** Si la acción falla después de consumir la autorización, se revierten el consumo y la fila de auditoría de la acción, y la autorización sigue disponible hasta que venza. Dos peticiones concurrentes con la misma autorización: exactamente una se ejecuta y la otra responde 403 `AUTORIZACION_INVALIDA`.
51. **Cambio de usuario.** Al cerrarse una sesión (cambio rápido de usuario, salida, inactividad, revocación del equipo), sus autorizaciones sin usar ya no sirven (criterio 49).
52. **Soporte.** Una sesión de soporte tiene permisos de Administrador: las acciones protegidas son `permitido` y `POST /autorizaciones` responde 409 `CLAVE_INNECESARIA`.
53. **El PIN no se guarda.** Ni el PIN del supervisor ni su huella aparecen en respuestas, filas de auditoría, autorizaciones ni registros de la API.

### Auditoría (RF-13, RNF-09, ruta crítica)

54. **Inmutable.** Dada la tabla `auditoria`, cuando `restaurante_api`, `restaurante_plataforma` o `restaurante_migrador` intentan `UPDATE`, `DELETE` o `TRUNCATE`, entonces cada intento falla y las filas no cambian.
55. **Aislada.** Con el contexto de A, `restaurante_api` solo ve filas de A; las filas sin empresa (operaciones solo de plataforma, como crear un plan o el ingreso de un superadministrador) no las ve nunca; `restaurante_api` no puede insertar filas de B ni sin empresa. `restaurante_plataforma` ve todas.
56. **Unión con `auditoria_plataforma`.** Dada una base con filas en `auditoria_plataforma` (de la historia 001), cuando se aplica la migración, entonces cada fila queda en `auditoria` con `origen = 'plataforma'`, `accion` = su `operacion`, `actor_sistema` = su `actor`, y el mismo `motivo`, `empresa_id`, `detalle` y `ocurrido_en`; `auditoria_plataforma` deja de existir; y los criterios 32, 32b, 33, 34, 35, 36, 40b, 40c y el inciso de plataforma de 38e de la historia 001 se cumplen sobre `auditoria` (filas con `origen = 'plataforma'`). Revertir la migración devuelve las filas de origen plataforma a `auditoria_plataforma`.
57. **Contenido de cada fila.** Cada fila registra el actor (exactamente uno de `actor_usuario_id`, `actor_superadministrador_id` o `actor_sistema`, con restricción en la base), la empresa (salvo las operaciones solo de plataforma), la sucursal si la acción es de una sucursal (la de la entidad afectada, o la sucursal activa de la sesión), el equipo si la sesión tiene uno, la sesión y la fecha (`ocurrido_en`, criterio 60). El actor y el equipo los pone la base a partir del contexto de actor de la transacción (criterio 119), no la API: las operaciones de plataforma por HTTP llevan el id del superadministrador; la semilla y los scripts, `actor_sistema` (`semilla`, `cli:<script>`); las acciones hechas en una sesión de soporte, el id del superadministrador y el `sesion_id` de soporte.
58. **Eventos auditados.** Las acciones de la lista "Acciones auditadas en esta sección" dejan exactamente una fila cada una, en la misma transacción que el cambio (no hay cambio sin fila ni fila sin cambio). Los rechazos y bloqueos (criterios 12, 36, 45, 47 y 107) se guardan en su propia transacción, aunque la petición responda un error.
59. **Sin secretos.** Dados secretos conocidos usados en las pruebas (contraseñas, PIN, tokens de sesión y de equipo), cuando se buscan en el texto de todas las filas de `auditoria`, entonces no aparecen, ni sus huellas o hashes.
60. **Hora.** `ocurrido_en` es la hora del reloj de la API en el momento de la acción.

### Superadministrador, plataforma por HTTP y soporte (RF-01, RF-07, ruta crítica)

61. **Superadministradores.** Solo se crean, se desactivan y se desbloquean con `pnpm plataforma:superadmin` (`crear`, `desactivar` y `desbloquear <usuario>`; funciones `crearSuperadministrador`, `desactivarSuperadministrador` y `desbloquearSuperadministrador`), con auditoría `actor_sistema = 'cli:superadmin'`; desactivar cierra sus sesiones y sus sesiones de soporte abiertas en cualquier empresa; su nombre de usuario es único entre los superadministradores, independiente de los usuarios de empresa. `POST /plataforma/sesiones` con `{ usuario, contrasena }` correctos responde 201 `{ token, superadministrador: { id, nombre } }`; con datos incorrectos, de uno inactivo o inexistente, 401 `CREDENCIALES_INVALIDAS` idéntico; 5 fallos seguidos lo bloquean 15 minutos (429 `BLOQUEO_TEMPORAL`); un ingreso correcto nunca levanta un bloqueo vigente, y antes de que venza solo lo levanta `pnpm plataforma:superadmin desbloquear <usuario>`, que pone en cero la cuenta de fallos y audita `desbloquear_superadministrador` sin empresa ni datos sensibles (a uno inactivo también lo limpia, pero sigue sin poder entrar). La sesión vale 8 horas desde que se crea; `DELETE /plataforma/sesion` la cierra. Intentos de ingreso, ingresos (correctos y fallidos), salidas, bloqueos y desbloqueos se auditan sin empresa; los intentos, los fallos y el bloqueo quedan guardados aunque la respuesta sea un error.
62. **Rutas de plataforma.** Toda ruta `/plataforma/*` salvo `POST /plataforma/sesiones` exige una sesión de superadministrador válida: sin ella, con un token de empresa (incluido uno de soporte) o con uno de equipo, responde 401 `NO_AUTENTICADO` y no se ejecuta. Un token `sa.…` en una ruta de empresa también responde 401 (criterio 1). Al desactivar un superadministrador, sus sesiones y sus sesiones de soporte dejan de valer.
63. **Alta de empresa por HTTP.** `POST /plataforma/empresas` con los datos del alta de 001, más `suscripcion` opcional por sucursal (`{ planId?, vencimiento? }`), `administrador` (`{ nombre, nombreUsuario, contrasenaTemporal }`) y `motivo`, responde 201 `{ empresaId, emisores, sucursales (con su suscripción), administrador: { id, pin } }` (PIN de 6 dígitos). Todo o nada: con cualquier error no queda nada creado ni auditado. Errores: los del criterio 34 de 001; nombre de usuario no disponible, 409 `CONFLICTO`; plan inexistente o inactivo, 422 `PLAN_INVALIDO`; vencimiento anterior a hoy, 400. Auditoría `registrar_empresa` con el id del superadministrador.
64. **Emisores y sucursales.** `POST /plataforma/empresas/:id/emisores` y `POST /plataforma/empresas/:id/sucursales` (con `suscripcion` opcional) y `motivo`: como `agregarEmisor` y `agregarSucursal` de 001, ahora por HTTP y con suscripción; empresa inexistente, 404.
65. **Consulta.** `GET /plataforma/empresas` lista las empresas con sus sucursales y el estado de cada suscripción; `GET /plataforma/empresas/:id` devuelve emisores, sucursales, suscripciones y administradores (nombre, nombre de usuario, activo).
66. **Soporte.** `POST /plataforma/empresas/:id/soporte` con `{ motivo, sucursalId? }` responde 201 `{ token, sesion }` con una sesión `SOPORTE` de esa empresa: permisos de Administrador en todas sus sucursales, sin horario, inactividad de 30 minutos y duración máxima de 2 horas. En la misma transacción queda la fila `inicio_soporte` (origen plataforma, con `empresa_id`, así el Administrador de la empresa la puede ver). Toda acción hecha con esa sesión se audita y se traza con el id del superadministrador y el `sesion_id` (criterios 57 y 117). `DELETE /sesion` la cierra y audita `fin_soporte`.
67. **Soporte aislado.** El token de soporte de A, adulterado con la empresa B, responde 401; una empresa inexistente responde 404; un motivo vacío, 400 sin crear nada.
68. **Sin mezcla de credenciales.** Una sesión de soporte no sirve en `/plataforma/*`, no puede crear sesiones PIN, autorizaciones (criterio 52) ni recordar equipos (criterio 27), y no cuenta como usuario de la empresa.

### Suscripción, planes, módulos y cuota (HU-01, RF-03 a RF-05)

69. **La sucursal nace con suscripción.** Dada un alta de empresa o de sucursal por la vía de plataforma (HTTP, semilla o servicio), cuando se crea cada sucursal, entonces queda con exactamente una suscripción, en el plan indicado o en el plan por defecto, con el vencimiento indicado o, si no se indica, `sumarMeses(hoy, 1)` (hoy en Lima), y su estado es `ACTIVA`.
70. **Sucursal creada por el Administrador.** `POST /sucursales` crea la sucursal (como `agregarSucursal` de 001) con suscripción en el plan por defecto y vencimiento = hoy; se audita. `POST /emisores` crea el emisor como `agregarEmisor`. Ambas solo para Administrador (criterio 9).
71. **Estado.** `estadoSuscripcion({ vencimiento, diasGracia }, instante)` de `packages/dominio`, con hoy = fecha de Lima de `instante`: `ACTIVA` si hoy ≤ vencimiento; `EN_GRACIA` si vencimiento < hoy ≤ vencimiento + `diasGracia`; `SUSPENDIDA` si hoy > vencimiento + `diasGracia`. Devuelve también `suspensionDesde` (vencimiento + `diasGracia` + 1) y `diasRestantesGracia` en gracia. Ejemplos con vencimiento `2026-11-10` y 7 días: `2026-11-10T23:59-05:00` → `ACTIVA`; `2026-11-11T00:00-05:00` → `EN_GRACIA` (7 días restantes); `2026-11-17T12:00-05:00` → `EN_GRACIA` (1); `2026-11-18T00:00-05:00` → `SUSPENDIDA`; con 0 días, `2026-11-11T00:00-05:00` → `SUSPENDIDA`.
72. **Sumar meses.** `sumarMeses(fecha, n)`: `2026-01-31` + 1 = `2026-02-28`; `2028-01-31` + 1 = `2028-02-29`; `2026-12-15` + 1 = `2027-01-15`; `2026-03-31` + 1 = `2026-04-30`.
73. **Registrar un pago.** `POST /plataforma/suscripciones/:id/pagos` con `{ monto, fechaPago, medio, referencia?, vencimientoNuevo, motivo }` y `Idempotency-Key`: responde 201 con el pago y la suscripción; el vencimiento pasa a `vencimientoNuevo`. `monto` es un texto decimal mayor que 0 con hasta 2 decimales (se guarda en `NUMERIC`); `fechaPago` no puede ser posterior a hoy; `vencimientoNuevo` debe ser posterior al vencimiento actual (si no, 400). El pago no se edita ni se borra, y se audita.
74. **Cambiar plan o ajustar el vencimiento.** `PATCH /plataforma/suscripciones/:id` con `{ planId?, vencimiento?, motivo }` cambia el plan o fija el vencimiento a cualquier fecha (sirve para corregir un pago mal registrado); se audita con el antes y el después.
75. **Planes.** `GET`, `POST` y `PATCH /plataforma/planes` con `{ codigo, nombre, precioMensual?, cuotaComprobantesMes?, precioExcedente?, diasGracia (0 a 60), modulos, porDefecto, activo }`. Siempre hay exactamente un plan por defecto activo: marcar otro como por defecto quita la marca al anterior; desactivar el plan por defecto o quitarle la marca sin dar otro responde 409 `CONFLICTO`. Un módulo fuera del catálogo responde 400. Una migración crea el plan `BASE` (por defecto, todos los módulos, 7 días de gracia, precios y cuota sin definir).
76. **Suscripciones.** `GET /plataforma/suscripciones?estado=ACTIVA|EN_GRACIA|SUSPENDIDA` lista empresa, sucursal, plan, vencimiento, estado calculado, `suspensionDesde` y el consumo de comprobantes del mes actual y del anterior con su excedente.
77. **Módulos.** Una ruta marcada `@RequiereModulo(modulo)` responde 403 `MODULO_NO_INCLUIDO` si el plan de la suscripción de la sucursal activa no incluye ese módulo; el cambio de plan se aplica desde la siguiente petición. `GET /sesion` incluye `modulos`. (Se prueba con un controlador sonda; las rutas de cada módulo llegan con sus historias.)
78. **Cuota sin bloqueo.** `SuscripcionService.registrarComprobanteEmitido(sucursalId, instante)`, dentro de un contexto de empresa, suma 1 al consumo del periodo (mes de Lima de `instante`) y devuelve `{ periodo, emitidos, cuota, excedente }`, con `excedente = max(0, emitidos − cuota)`; nunca lanza por superar la cuota; con cuota sin definir, el excedente es 0. Dos llamadas concurrentes no pierden incrementos.
79. **Cuota del plan vigente.** El excedente se calcula con la cuota del plan que tiene la suscripción en el momento de cada consulta.

### Suspensión por falta de pago (HU-04, RF-06)

80. **Avisos.** Dada una empresa con alguna sucursal `EN_GRACIA` o `SUSPENDIDA`, cuando un Administrador (o una sesión de soporte) llama `GET /sesion`, tenga o no sucursal activa, entonces `avisoSuscripcion` trae `{ sucursales: [{ sucursalId, nombre, estado, vencimiento, suspensionDesde, diasRestantesGracia }] }` con cada sucursal de la empresa en esos estados; con todas `ACTIVA`, es `null`; para los demás roles, siempre `null`.
81. **La suspensión impide abrir caja.** `SuscripcionService.exigirAperturaDeCaja(sucursalId)` no lanza si la sucursal está `ACTIVA` o `EN_GRACIA` y lanza 403 `SUCURSAL_SUSPENDIDA` si está `SUSPENDIDA`, evaluado con el reloj de la API en ese momento. (Se prueba con un controlador sonda; la apertura de caja la llama en su historia.)
82. **No corta nada más.** Con la sucursal `SUSPENDIDA`, el ingreso con contraseña y con PIN, `GET /sesion`, las consultas, la configuración, los usuarios y los equipos recordados siguen funcionando.
83. **Reactivación.** Un pago con `vencimientoNuevo` ≥ hoy deja la sucursal `ACTIVA` desde la siguiente petición, y `exigirAperturaDeCaja` deja de lanzar.
84. **Turno abierto.** La suspensión solo se comprueba al abrir caja: ninguna otra operación consulta el estado de la suscripción. Un turno abierto antes de la suspensión sigue hasta su cierre (lo verificará la historia de caja).

### Idempotencia (RNF-10)

85. **Repetición.** En las rutas que la aceptan (`POST /plataforma/suscripciones/:id/pagos`, `POST /autorizaciones`, `POST /emisores`, `POST /sucursales`, `POST /plataforma/empresas/:id/emisores`, `POST /plataforma/empresas/:id/sucursales`), una petición con `Idempotency-Key` (UUID) igual y el mismo cuerpo que una anterior con respuesta 2xx devuelve el mismo estado y cuerpo sin repetir el efecto (un solo pago, una sola autorización, una sola fila de auditoría), salvo lo del criterio 47. Las respuestas de error no se guardan.
86. **Reutilización.** La misma clave con otro cuerpo, otra ruta u otro usuario responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Las claves de A y de B no se mezclan: la misma clave usada en B ejecuta normalmente y nunca devuelve una respuesta de A.
87. **Rutas con secretos.** Las rutas cuya respuesta puede contener un secreto (`POST /usuarios`, `PATCH /usuarios/:id`, `POST /usuarios/:id/pin`, `POST /sesion/equipo`, `POST /plataforma/empresas`, ingresos) no guardan respuestas; las protege la unicidad natural (nombre de usuario, RUC, un equipo recordado activo por equipo y persona) o crean una credencial nueva en cada llamada.

### Catálogo y aislamiento de las tablas nuevas (ruta crítica)

88. **Convención.** El criterio 38 de la historia 001 se cumple con todas las tablas nuevas de `public` (RLS forzada, política `aislamiento_empresa` en las que tienen `empresa_id`, llaves foráneas compuestas, sin `TRUNCATE`), con estos ajustes: `plan` (sin `empresa_id`) tiene una política de solo lectura para `restaurante_api`; `superadministrador`, `sesion_superadministrador` e `idempotencia_plataforma` no dan ningún privilegio a `restaurante_api`; `auditoria` reemplaza a `auditoria_plataforma` en la lista del criterio 38 con los privilegios de la tabla de "Permisos". Los esquemas `autenticacion` y `contexto` no dan `USAGE` a los roles de la aplicación.
89. **Búsqueda del usuario al ingresar.** La relación nombre de usuario → empresa vive fuera de `public`, en el esquema `autenticacion` (dueño `restaurante_migrador`, sin `USAGE` para los roles de la aplicación ni `PUBLIC`). `public.empresa_de_usuario(text)` es `SECURITY DEFINER`, con `search_path` fijo y `EXECUTE` solo para `restaurante_api`; devuelve la empresa solo para un nombre exacto (sin distinguir mayúsculas) de un usuario existente y `NULL` en otro caso; `%`, `_` y textos parecidos no coinciden con nada.
90. **Unicidad global.** Con el contexto de A, insertar o renombrar un usuario con un nombre ya usado en B falla con unicidad (409 por la API) y no revela nada más de B. Renombrar o desactivar actualiza la relación del criterio 89 en la misma transacción.
91. **Prueba de aislamiento por tabla.** Para cada tabla nueva con `empresa_id` (`usuario`, `acceso_sucursal`, `equipo`, `equipo_recordado`, `sesion`, `autorizacion`, `bloqueo_intentos`, `sucursal_acceso`, `suscripcion`, `pago_suscripcion`, `consumo_comprobantes`, `idempotencia`, `auditoria`), con el contexto de A (y un actor de A fijado, criterio 116): no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, y no se insertan filas con `empresa_id` de B (como los criterios 11 a 16 de 001). La prueba comprueba que el rechazo lo produce la política RLS y no la falta de actor.

### Interfaz (PWA, no crítica)

92. **Arranque.** Al abrir la PWA, por cada token de equipo guardado (uno por empresa) consulta `GET /equipo`; si alguna respuesta trae personas, muestra la pantalla de PIN con todas ellas; si una responde `EQUIPO_NO_RECONOCIDO`, borra ese token. Sin personas recordadas, muestra el ingreso con usuario y contraseña.
93. **Ingreso con usuario y contraseña.** Muestra errores de credenciales, de bloqueo (con los minutos que faltan) y de fuera de horario; pide el cambio de contraseña si `debeCambiarContrasena`; luego llama sola a `POST /sesion/equipo` (con el token de equipo de esa empresa, si lo tiene) y guarda el token nuevo si llega, sin pedirle nada a la persona; y pide elegir sucursal si hay varias.
94. **Pantalla de PIN.** Si el equipo recuerda a más de una persona, primero muestra sus nombres como botones grandes; después, un teclado numérico táctil grande con los dígitos ocultos, envío al completar el largo de PIN de esa persona (4 o 6), mensaje de error y cuenta regresiva del bloqueo, y un enlace "Ingresar con usuario y contraseña" (para otra persona o si olvidó el PIN).
95. **Barra de la sesión.** Muestra usuario, rol y sucursal; "Cambiar usuario" cierra la sesión y vuelve a la pantalla de PIN; permite cambiar de sucursal, "Olvidar este equipo" (con confirmación) y salir.
96. **Inactividad.** Sin interacción durante los minutos de la sesión (`expiraPorInactividadEn`), la PWA cierra la sesión y vuelve a la pantalla de PIN (o al ingreso). Un 401 `SESION_EXPIRADA` o `NO_AUTENTICADO` hace lo mismo. Las consultas automáticas mandan `X-Actividad: segundo-plano`.
97. **Mis equipos.** La persona ve sus equipos recordados (nombre, último uso, cuál es este) y puede olvidar cualquiera con confirmación (criterio 31).
98. **Ventana de clave de supervisor.** Componente reutilizable que pide el PIN de 6 dígitos y el motivo, llama `POST /autorizaciones` y devuelve el `autorizacionId` a quien lo abrió; muestra `CLAVE_INVALIDA`, el bloqueo y la validación del motivo; no guarda el PIN.
99. **Aviso de suscripción.** Un Administrador ve un aviso persistente en gracia (días que quedan y fecha de suspensión) y otro cuando la sucursal está suspendida.
100. **Administración.** Pantallas de Usuarios (lista, alta con accesos, contraseña temporal y horario opcional, PIN mostrado una vez al crear, al regenerar o al cambiar de largo, edición, desactivar, regenerar PIN, restablecer contraseña), equipos recordados de cada usuario (lista, revocar uno o todos con confirmación) y Acceso de la sucursal (minutos de inactividad). El editor de horario permite varios tramos por día y tramos que cruzan la medianoche, y muestra los errores de `validarHorario`. Un rol sin permiso no ve esas opciones.
101. **Panel del superadministrador.** Ingreso propio; empresas con el estado de suscripción de cada sucursal; alta de empresa (emisores, sucursales, plan, vencimiento y primer Administrador, con su PIN mostrado una vez); detalle con agregar emisor y sucursal, registrar pago (vencimiento nuevo sugerido con `sumarMeses(vencimiento, 1)`), cambiar plan y ajustar vencimiento; planes; y "Entrar a dar soporte".
102. **Modo soporte.** Con una sesión de soporte, la app muestra en todo momento quién da soporte y un botón para terminarlo, que vuelve al panel.
103. **Móvil primero y compatibilidad.** Las pantallas se diseñan primero para celular: funcionan desde 360 px de ancho sin desplazamiento horizontal, con controles táctiles de al menos 44 × 44 px, y se adaptan a tablet y computadora. Con conexión lenta o cortada, cada pantalla muestra que está cargando o que no hay conexión, sin perder lo escrito. Funcionan en Chrome para Android y Safari para iPhone y iPad recientes (RNF-11, RNF-13), en español y soles (RNF-14). Las pantallas de operación responden en menos de 1 segundo (RNF-03).
104. **Escrituras.** Toda escritura de la PWA usa el cliente de `lib/api.ts`, con `Idempotency-Key` donde la ruta la acepta y reintentos ante cortes de red (RNF-10).

### Horario de acceso por trabajador (decisión del usuario, ruta crítica)

105. **Dentro del horario.** `dentroDeHorario(horario, instante)` de `packages/dominio` devuelve `true` si `horario` es `null`; si no, convierte `instante` a la hora de Lima (UTC−5, sin horario de verano) y devuelve `true` si cae en algún tramo `[desde, hasta)`; un tramo con `hasta` < `desde` cruza la medianoche y sigue en el día siguiente (el domingo sigue en el lunes). Ejemplos con el tramo `{ dia: 5 (viernes), desde: '18:00', hasta: '02:00' }`: `2026-10-30T18:00-05:00` → `true`; `2026-10-30T17:59-05:00` → `false`; `2026-10-31T01:59-05:00` → `true`; `2026-10-31T02:00-05:00` → `false`; `2026-10-31T06:59Z` → `true`; `2026-10-31T07:00Z` → `false`. Con `{ dia: 7, desde: '22:00', hasta: '06:00' }`: `2026-11-02T05:59-05:00` (lunes) → `true`. Prueba unitaria con cada ejemplo y con la zona horaria del proceso distinta de Lima.
106. **Asignar el horario.** `POST /usuarios` y `PATCH /usuarios/:id` aceptan `horario`: una lista de al menos un tramo (`tramoHorarioSchema` de 001, validada con `validarHorario`: sin solapes, `desde` distinto de `hasta`) o `null` para quitarlo. Una lista vacía o con tramos inválidos responde 400 `DATOS_INVALIDOS` con `campos`. Un horario no nulo en un usuario que es o queda Administrador responde 400 `DATOS_INVALIDOS` (campo `horario`); para hacer Administrador a alguien con horario se envía también `horario: null`. El cambio se audita (criterio 26) y no cierra las sesiones abiertas: rige desde el siguiente ingreso.
107. **Ingreso fuera de horario.** Dado un trabajador con horario, cuando sus credenciales son correctas (contraseña, criterio 12b, o PIN en un equipo que lo recuerda, criterio 33) y el reloj de la API está fuera de su horario, entonces responde 403 `FUERA_DE_HORARIO` sin crear sesión; no cuenta como fallo y reinicia la cuenta de fallos como un ingreso correcto; queda una fila de auditoría `ingreso_fuera_de_horario`. El horario se comprueba después de las credenciales y del bloqueo, así que nadie sin credenciales correctas sabe si alguien tiene horario.
108. **La sesión abierta sigue.** Dada una sesión abierta dentro del horario, cuando termina el horario, entonces la sesión sigue funcionando (incluidos el cambio de sucursal y las autorizaciones que pida) hasta que la persona salga, expire por inactividad o llegue a las 12 horas; ninguna petición de esa sesión responde `FUERA_DE_HORARIO`.
109. **Sin volver a entrar.** Dada esa sesión, cuando se cierra (salida, inactividad, cambio rápido de usuario) y la persona intenta entrar de nuevo fuera de su horario, con contraseña o con PIN, entonces responde 403 `FUERA_DE_HORARIO` (criterio 107).
110. **Autorizar fuera de horario.** Dado un Supervisor con horario, cuando su PIN se usa en `POST /autorizaciones` fuera de su horario, entonces se rechaza como el criterio 45 (403 `CLAVE_INVALIDA`, mismo cuerpo, cuenta fallo), con `FUERA_DE_HORARIO` como motivo del rechazo en el detalle de la auditoría.
111. **Sin horario.** Un trabajador sin horario, el Administrador, las sesiones de soporte y el principal de prueba entran y autorizan a cualquier hora.
112. **Hora de Lima.** El horario se evalúa con la hora de Lima del reloj de la API, aunque el servidor o la base estén en otra zona horaria.

### Trazabilidad: quién creó y quién cambió cada registro (decisión del usuario, ruta crítica)

113. **Columnas en toda tabla de clientes.** Toda tabla de `public` con `empresa_id`, y la tabla `empresa`, salvo la lista cerrada de excepciones (`auditoria`, `sesion`, `bloqueo_intentos` e `idempotencia`, motivo en "Reglas de negocio"), tiene `creado_por_usuario_id`, `creado_por_superadministrador_id`, `creado_por_sistema`, `creado_por_equipo_id` y las cuatro equivalentes `actualizado_por_*`; una restricción `CHECK` por grupo exige exactamente uno de usuario, superadministrador o sistema, y el equipo solo junto con un usuario; las llaves foráneas son compuestas con la empresa hacia `usuario` y `equipo`, y simple hacia `superadministrador`; y la tabla tiene el trigger `trazabilidad` (`BEFORE INSERT OR UPDATE`, por fila). Una prueba de catálogo recorre `pg_catalog` (no una lista fija) y falla si una tabla, actual o futura, no cumple, o si la lista de excepciones cambia.
114. **La base las llena.** Dado un actor fijado en la transacción, cuando se inserta una fila, entonces los dos grupos quedan con ese actor; cuando se actualiza, `actualizado_por_*` pasa al actor y `creado_por_*` no cambia. Los valores que la API o el SQL envíen en esas columnas (otro usuario, un usuario de B, `NULL`) se ignoran: manda el contexto. Ningún esquema de entrada de `packages/contratos` acepta esos campos.
115. **Sin actor no hay escritura.** Dada una transacción sin actor fijado, cuando inserta o actualiza una fila de una tabla trazada, entonces falla (SQLSTATE `42501`, "contexto de actor ausente") y nada se escribe; por la API, la respuesta es 500 sin detalles.
116. **Fijar el actor.** `public.fijar_contexto_actor(p_usuario uuid, p_equipo uuid, p_superadministrador uuid, p_sistema text)` (`SECURITY DEFINER`, `search_path` fijo, `EXECUTE` solo para `restaurante_api` y `restaurante_plataforma`) fija el actor de la transacción en curso: exactamente uno de usuario, superadministrador o sistema (si no, `22023`); equipo solo con usuario; sistema de 1 a 100 caracteres sin NUL. Una segunda llamada en la misma transacción falla (`42501`), aunque sea el mismo actor, y el actor muere con la transacción (como la empresa en el criterio 22e de 001). Con el contexto de A, un usuario o un equipo de B como actor hace fallar la escritura por la llave foránea compuesta.
117. **Actor según la vía.** Sesión `CONTRASENA` o `PIN`: el usuario y, si la sesión tiene equipo recordado, su equipo. Sesión de soporte y rutas de plataforma por HTTP: el superadministrador. Semilla y scripts: sistema `semilla` o `cli:<script>`. Migraciones que escriben datos: `migracion:<nombre>`. Principal de prueba: `prueba`. Ingresos: después de verificar las credenciales, el usuario si son correctas, y `autenticacion` si no. Prueba: una sucursal creada con `POST /sucursales` por un Administrador desde un equipo recordado E queda con `creado_por_usuario_id` = él y `creado_por_equipo_id` = E; editada por otro Administrador, cambia solo `actualizado_por_*`; editada en soporte, `actualizado_por_superadministrador_id`; creada por `POST /plataforma/empresas/:id/sucursales`, `creado_por_superadministrador_id`.
118. **Tablas de 001.** Una migración agrega las columnas y el trigger a `empresa`, `emisor` y `sucursal`; las filas existentes quedan con `creado_por_sistema` y `actualizado_por_sistema` = `migracion:trazabilidad`. Revertirla quita columnas, restricciones y trigger sin tocar los demás datos.
119. **La auditoría usa el mismo actor.** Al insertar en `auditoria`, la base pone `actor_*` y `equipo_id` a partir del contexto de actor (los valores enviados se ignoran), así que una fila de auditoría y el cambio que registra tienen siempre el mismo actor. `autorizado_por_id`, `sucursal_id`, `sesion_id` y `ocurrido_en` los pone la API a partir de la sesión y del reloj, nunca del cuerpo de la petición.
120. **Sin cruces entre peticiones.** Dado un pool de 2 conexiones, cuando llegan 100 escrituras concurrentes de usuarios distintos de A y de B, entonces cada fila escrita y cada fila de auditoría tienen el actor de su propia petición.

## Acciones auditadas en esta sección

Lista cerrada de las acciones sensibles que se auditan aquí. Cada fila lleva actor, empresa (salvo las de plataforma sin empresa), sucursal si aplica, equipo si aplica, sesión y fecha (criterio 57).

| Acción (`accion`) | Origen | Actor | Cuándo |
| --- | --- | --- | --- |
| `registrar_empresa`, `agregar_emisor`, `agregar_sucursal` | plataforma | superadministrador o sistema | Alta por HTTP, semilla o script |
| `crear_plan`, `modificar_plan` | plataforma (sin empresa) | superadministrador | Criterio 75 |
| `registrar_pago`, `modificar_suscripcion` | plataforma | superadministrador | Criterios 73 y 74 |
| `crear_superadministrador` | plataforma (sin empresa) | sistema | Criterio 61 |
| `ingreso_superadministrador`, `ingreso_superadministrador_fallido`, `salida_superadministrador`, `bloqueo_superadministrador`, `desactivar_superadministrador` | plataforma (sin empresa) | superadministrador o sistema | Criterio 61 (toda escritura de plataforma se audita, por eso también los fallos) |
| `intento_ingreso_superadministrador` | plataforma (sin empresa) | sistema `autenticacion` | Criterio 61: cada intento de ingreso del superadministrador que se evalúa (la reserva aceptada del intento, plan); una reserva rechazada por cupo lleno no se audita |
| `liberar_intento_superadministrador` | plataforma (sin empresa) | sistema `autenticacion` | Criterio 61: una reserva aceptada que termina sin resultado y deja de estar en curso sin contar como fallo ni como éxito (camino de error raro, plan) |
| `desbloquear_superadministrador` | plataforma (sin empresa) | sistema `cli:superadmin` | Criterio 61: desbloqueo por consola, sin empresa ni datos sensibles |
| `inicio_soporte` | plataforma (con la empresa) | superadministrador | Criterio 66 |
| `fin_soporte` | empresa | superadministrador (sesión de soporte) | Criterio 66 |
| `crear_emisor`, `crear_sucursal`, `configurar_sucursal`, `configurar_acceso_sucursal` | empresa | usuario o soporte | Criterios 9, 40 y 70 |
| `crear_usuario`, `modificar_usuario` (accesos y roles, horario, activo, administrador; con los equipos revocados en el detalle), `regenerar_pin`, `restablecer_contrasena` | empresa | usuario o soporte | Criterios 18 a 23, 32b y 106 |
| `cambiar_contrasena` | empresa | el propio usuario | Criterio 16 |
| `recordar_equipo`, `olvidar_equipo`, `revocar_equipos`, `equipo_reemplazado` | empresa | el propio usuario, o el Administrador o soporte (revocar) | Criterios 27 a 31 |
| `bloqueo_contrasena`, `bloqueo_pin`, `equipo_olvidado_por_bloqueo`, `bloqueo_clave` | empresa | sistema `autenticacion` (con el usuario y el equipo afectados en el detalle) | Criterios 12, 36 y 47 |
| `ingreso_fuera_de_horario` | empresa | el usuario que intentó entrar | Criterio 107 |
| `autorizacion_otorgada`, `autorizacion_rechazada` | empresa | solicitante (y autorizador) | Criterios 44, 45 y 110 |
| la acción protegida (por ejemplo `ANULAR_ITEM_ENVIADO`) | empresa | solicitante, con autorizador | Criterio 48 (historias futuras) |

No se auditan los ingresos y salidas normales del personal (decisión del usuario); sí los del superadministrador y los rechazos por horario.

## Casos límite

- Un usuario de A y otro de B con el mismo PIN: el PIN solo se evalúa para la persona elegida en un equipo que la recuerda, y en la ventana de clave solo entre usuarios de la empresa de la sesión (criterios 34 y 45).
- Un celular compartido por varias personas de la misma empresa: un solo token de equipo, hasta 5 personas recordadas; el bloqueo de una no afecta a las demás (criterio 36).
- Una persona que trabaja en dos empresas con el mismo celular: la PWA guarda un token por empresa y muestra a las personas de ambos en la pantalla de PIN; el límite de 5 personas se aplica por cada token.
- Un Administrador con varias sucursales queda sin sucursal activa hasta elegir (salvo con PIN, donde se retoma la última que usó en ese equipo); las rutas que no dependen de la sucursal (usuarios, emisores) funcionan igual.
- El mismo usuario con una sesión PIN en el celular compartido y otra de contraseña en su propio celular: son independientes; el cambio rápido en el compartido solo cierra la sesión PIN de ese equipo.
- Celular robado o perdido: el Administrador revoca los equipos del trabajador (o el propio trabajador olvida ese equipo desde otro); se cierran también las sesiones de contraseña abiertas desde ese equipo (criterio 30). Si además teme que sepan su contraseña, el Administrador la restablece.
- Un Supervisor que hace una acción protegida no necesita clave (criterio 46); si autoriza a un Cajero, el Cajero sigue siendo quien hizo la acción y queda como actor de los registros.
- Un PIN de 6 dígitos que coincide con un Cajero, usado en la ventana de clave: responde lo mismo que un PIN inexistente (criterio 45), sin revelar que el PIN existe.
- Un Mozo pasa a Cajero en otra sucursal: su PIN pasa de 4 a 6 dígitos en la misma operación y el Administrador ve el nuevo una sola vez (criterio 21b).
- Un nombre de usuario se puede reutilizar después de renombrar al usuario que lo tenía; un usuario desactivado conserva su nombre (no se libera).
- Una petición que llega justo en el minuto de inactividad: la sesión vale mientras ahora < última actividad + minutos; en el instante exacto ya expiró.
- Horario que termina a las 02:00: a las 01:59 se puede entrar y la sesión dura hasta su inactividad o salida; a las 02:00 en punto ya no se puede entrar.
- Trabajador con horario solo de viernes a domingo: el lunes no puede entrar ni autorizar, aunque su equipo lo recuerde.
- Vencimiento con 0 días de gracia: pasa de `ACTIVA` a `SUSPENDIDA` al día siguiente del vencimiento, sin aviso de gracia.
- Pago registrado con la sucursal ya suspendida y un turno abierto: el turno sigue; la siguiente apertura de caja ya funciona.
- Cambio del plan por defecto: no cambia las suscripciones existentes, solo las que se creen después.
- Hora de Lima y fin de mes: el periodo de la cuota, el estado de la suscripción y el horario usan la hora de Lima (Perú no tiene horario de verano), no la del servidor.
- Reloj del navegador desajustado: el cierre por inactividad de la PWA usa `expiraPorInactividadEn` del servidor como referencia; si el servidor dice que expiró, manda el servidor.
- iPhone o iPad que borran el almacenamiento de un sitio web no usado en días: se pierde el token del equipo y cada persona vuelve a entrar con contraseña (ver riesgos del plan).
- Escritura hecha por un proceso sin persona (semilla, migración, tarea futura del worker): el actor es de sistema; nunca queda una fila sin actor (criterio 115).

## Reglas de negocio aplicables

Fuente: `fuentes.md` y "Decisiones del usuario".

- Seis roles: Mozo, Cajero, Cocina/Barra, Supervisor, Administrador y Superadministrador (de nuestra empresa) (Actores; Roles y permisos).
- Un usuario puede tener acceso a una o varias sucursales con un rol en cada una (RF-08; Roles y permisos). El Administrador es de toda la empresa (decisión del usuario).
- **Acceso del personal (decisión del usuario, reemplaza "equipos vinculados" de RF-09, RF-10, RNF-08 y la regla de Seguridad):** cada trabajador usa su propio celular o cualquier equipo; no hay tablets del local. La primera vez que entra en un equipo lo hace con usuario y contraseña, y desde entonces ese equipo lo recuerda; luego entra con su PIN, pero solo en equipos donde ya entró con contraseña. Un equipo puede recordar a varias personas (máximo 5, decisión del especificador). El Administrador puede revocar los equipos recordados de un trabajador y el propio trabajador puede olvidar los suyos. Todos los usuarios tienen contraseña; el Administrador la crea temporal y se cambia en el primer ingreso.
- **Horario de acceso (decisión del usuario):** opcional, semanal, con tramos por día que pueden cruzar la medianoche; sin horario se entra a cualquier hora; el Administrador nunca tiene. Fuera del horario no se inicia sesión (ni con contraseña ni con PIN) ni se autoriza como supervisor; una sesión abierta sigue hasta su salida o su inactividad. Hora de Lima. **Por usuario, no por sucursal** (decisión del especificador): ver "Decisiones del usuario", punto 2.
- **Largo del PIN (decisión del usuario):** 4 dígitos para Mozo y Cocina/Barra; 6 para Cajero, Supervisor y Administrador; con roles distintos en varias sucursales, manda el mayor.
- Cambio rápido de usuario con PIN y cierre de sesión por inactividad (RF-11, RNF-08); en equipos compartidos la sesión se cierra sola tras un tiempo sin uso (Seguridad).
- "Clave" significa que la acción procede si un supervisor escribe su PIN en ese momento, y queda registrado quién autorizó (Roles y permisos). Se registran quién pidió, quién autorizó, el motivo y la hora (RF-12, HU-03, Seguridad).
- Matriz de permisos (documento de diseño, "Roles y permisos"); códigos de acción de `packages/dominio`:

| Acción (código) | Mozo | Cajero | Cocina/Barra | Supervisor | Administrador |
| --- | --- | --- | --- | --- | --- |
| `ATENDER_MESA` (abrir mesa, comandar, adiciones y pre-cuenta) | permitido | permitido | prohibido | permitido | permitido |
| `MOVER_UNIR_MESAS` | permitido | permitido | prohibido | permitido | permitido |
| `ANULAR_ITEM_ENVIADO` | clave | clave | prohibido | permitido | permitido |
| `APLICAR_DESCUENTO` | clave | clave | prohibido | permitido | permitido |
| `APLICAR_CORTESIA` | clave | clave | prohibido | permitido | permitido |
| `ANULAR_ORDEN` (RF-35; decisión del usuario) | clave | clave | prohibido | permitido | permitido |
| `GESTIONAR_PEDIDOS_WEB` (confirmar pedidos web y registrar pedidos por teléfono) | prohibido | permitido | prohibido | permitido | permitido |
| `COBRAR` (cobrar, dividir la cuenta y emitir comprobantes) | prohibido | permitido | prohibido | permitido | permitido |
| `EMITIR_NOTA_CREDITO` | prohibido | clave | prohibido | permitido | permitido |
| `OPERAR_CAJA` (abrir y cerrar caja, reportes X y Z, ingresos y egresos) | prohibido | permitido | prohibido | permitido | permitido |
| `USAR_KDS` (usar el KDS y marcar platos listos) | prohibido | prohibido | permitido | permitido | permitido |
| `GESTIONAR_DISPONIBILIDAD` (agotados y porciones del día) | prohibido | prohibido | permitido | permitido | permitido |
| `REGISTRAR_INGRESO_MERCADERIA` | prohibido | permitido | prohibido | permitido | permitido |
| `AJUSTAR_STOCK` (ajustes y mermas) | prohibido | prohibido | prohibido | permitido | permitido |
| `EDITAR_CARTA` (carta y precios) | prohibido | prohibido | prohibido | prohibido | permitido |
| `ADMINISTRAR` (usuarios, sucursales, equipos y configuración) | prohibido | prohibido | prohibido | prohibido | permitido |
| Reportes (`alcanceReportes`) | — | su turno (X) | — | su sucursal | todas las sucursales |

- Pueden autorizar con su PIN quienes tienen la acción como `permitido` en esa sucursal: Supervisor y Administrador (decisión del usuario), dentro de su horario.
- Toda acción con clave queda en la auditoría (Seguridad, RNF-09); se auditan las anulaciones, descuentos, cortesías, notas de crédito, ajustes de stock y cambios de configuración (RF-13). La auditoría no se puede modificar (RNF-09).
- **Trazabilidad (decisión del usuario):** el sistema siempre sabe qué persona hizo cada acción. Toda tabla con datos de clientes, actual y futura, guarda quién creó y quién cambió por última vez cada fila (usuario y equipo, o superadministrador, o actor de sistema), lo llena la base desde el contexto de la sesión y nunca el cuerpo de la petición. Excepciones (decisión del especificador): `auditoria` (ya guarda su actor y es inmutable), `sesion` (es la credencial misma: guarda su usuario o superadministrador y su equipo, y se actualiza en cada petición), `bloqueo_intentos` (se escribe en ingresos fallidos, sin persona autenticada) e `idempotencia` (caché técnica de respuestas).
- El superadministrador gestiona empresas, sucursales y suscripciones, y puede entrar a la cuenta de un cliente para darle soporte, siempre con registro en la auditoría (RF-07; Roles y permisos).
- Contraseñas y PIN guardados con hash (RNF-07). Sin servicios externos de pago (RNF-18): sin correos ni SMS para recuperar contraseñas.
- Suscripción mensual por sucursal con usuarios y dispositivos ilimitados (Modelo comercial). La sucursal nace con suscripción activa y fecha de vencimiento (HU-01). Estados: activa, en gracia o suspendida; pagos registrados a mano (RF-03; cobro manual en el MVP).
- Cada plan activa módulos; al inicio habrá un solo plan; preparado para planes premium (RF-04; Modelo comercial).
- Cada plan incluye una cuota de comprobantes al mes; al superarla la emisión nunca se bloquea y el excedente se registra (RF-05; Modelo comercial).
- Vencida la suscripción, primero hay unos días de gracia con avisos al administrador; luego la suspensión, que se aplica en la siguiente apertura de caja y nunca corta un turno abierto; suspendida, la sucursal puede consultar y exportar sus datos (RF-06, HU-04, Modelo comercial).
- Los datos de una empresa nunca se comparten con otra (RNF-06).

## Contrato

### Cabeceras

| Cabecera | Uso |
| --- | --- |
| `Authorization: Bearer <token>` | Sesión de empresa (`se.…`) o de superadministrador (`sa.…`) |
| `X-Equipo: <token>` | Token del equipo (`eq.…`); obligatorio en `POST /sesiones/pin`, `GET /equipo` y en toda petición de una sesión PIN; opcional en `POST /sesion/equipo` |
| `X-Actividad: segundo-plano` | La petición no renueva la inactividad |
| `X-Autorizacion: <autorizacionId>` | Autorización de supervisor para una ruta `@Permiso` |
| `Idempotency-Key: <uuid>` | Rutas del criterio 85 |

Formato de los tokens: tres o cuatro partes separadas por punto; los ids son UUID en minúsculas y el secreto, 32 bytes aleatorios en base64url (43 caracteres). `se.<empresaId>.<sesionId>.<secreto>`, `eq.<empresaId>.<equipoId>.<secreto>`, `sa.<sesionId>.<secreto>`.

### Endpoints

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `POST /sesiones/contrasena` | pública | `ingresoContrasenaEntrada` | 201 `ingresoRespuesta`; 400; 401 `CREDENCIALES_INVALIDAS`; 403 `FUERA_DE_HORARIO`; 429 `BLOQUEO_TEMPORAL` |
| `POST /sesiones/pin` | pública + `X-Equipo` | `ingresoPinEntrada` (`{ usuarioId, pin }`) | 201 `ingresoRespuesta`; 400; 401 `EQUIPO_NO_RECONOCIDO` / `CREDENCIALES_INVALIDAS`; 403 `FUERA_DE_HORARIO`; 429 |
| `GET /sesion` | sesión | — | 200 `sesionRespuesta` |
| `PUT /sesion/sucursal` | sesión de contraseña, PIN o soporte | `{ sucursalId }` | 200 `sesionRespuesta`; 404 |
| `PUT /sesion/contrasena` | sesión de contraseña | `{ actual, nueva }` | 204; 400; 401; 403; 429 |
| `DELETE /sesion` | sesión | — | 204 |
| `POST /sesion/equipo` | sesión de contraseña (no temporal); `X-Equipo` opcional | `recordarEquipoEntrada` (`{ nombre? }`) | 201 `{ equipo, tokenEquipo }`; 200 `{ equipo }`; 403; 409 |
| `GET /sesion/equipos` | sesión de contraseña o PIN | — | 200 `equipoRecordadoRespuesta[]` (con `actual`) |
| `DELETE /sesion/equipos/:equipoRecordadoId` | sesión de contraseña o PIN | — | 204; 404 |
| `GET /equipo` | pública + `X-Equipo` | — | 200 `equipoActualRespuesta`; 401 `EQUIPO_NO_RECONOCIDO` |
| `GET /usuarios`, `GET /usuarios/:id` | Administrador | — | 200 `usuarioRespuesta[]` / `usuarioRespuesta`; 404 |
| `POST /usuarios` | Administrador | `usuarioCrearEntrada` | 201 `usuarioRespuesta & { pin }`; 400; 409; 422 |
| `PATCH /usuarios/:id` | Administrador | `usuarioModificarEntrada` | 200 `usuarioRespuesta & { pin? }`; 400; 404; 409 `ULTIMO_ADMINISTRADOR` / `CONFLICTO`; 422 |
| `POST /usuarios/:id/pin` | Administrador | — | 200 `{ pin }`; 404 |
| `POST /usuarios/:id/contrasena` | Administrador | `{ contrasenaTemporal: string }` | 204; 400; 404 |
| `GET /usuarios/:id/equipos` | Administrador | — | 200 `equipoRecordadoRespuesta[]`; 404 |
| `DELETE /usuarios/:id/equipos/:equipoRecordadoId`, `DELETE /usuarios/:id/equipos` | Administrador | — | 204; 404 |
| `POST /autorizaciones` | sesión con sucursal activa | `autorizacionEntrada`; `Idempotency-Key` opcional | 201 `autorizacionRespuesta`; 400; 403 `CLAVE_INVALIDA` / `PROHIBIDO`; 409 `CLAVE_INNECESARIA` / `SUCURSAL_NO_ELEGIDA`; 429 |
| `GET /emisores` | sesión | — | 200 `emisorRespuesta[]` |
| `POST /emisores` | Administrador | `emisorEntrada`; `Idempotency-Key` opcional | 201 `emisorRespuesta`; 400; 403 |
| `POST /sucursales` | Administrador | `sucursalEntrada`; `Idempotency-Key` opcional | 201 `sucursalRespuesta`; 400; 403; 409 |
| `PATCH /sucursales/:id` | Administrador | como en 001 | como en 001; 403 |
| `GET`, `PATCH /sucursales/:id/acceso` | Administrador | `{ minutosInactividad }` | 200 `{ sucursalId, minutosInactividad }`; 400; 403; 404 |
| `POST /plataforma/sesiones` | pública | `{ usuario, contrasena }` | 201 `{ token, superadministrador }`; 401; 429 |
| `DELETE /plataforma/sesion` | superadministrador | — | 204 |
| `GET /plataforma/empresas`, `GET /plataforma/empresas/:id` | superadministrador | — | 200; 404 |
| `POST /plataforma/empresas` | superadministrador | `altaEmpresaEntrada` | 201 `altaEmpresaRespuesta`; 400; 409; 422 `PLAN_INVALIDO` |
| `POST /plataforma/empresas/:id/emisores` | superadministrador | `emisorEntrada & { motivo }` | 201; 400; 404 |
| `POST /plataforma/empresas/:id/sucursales` | superadministrador | `sucursalEntrada & { suscripcion?, motivo }` | 201; 400; 404; 422 |
| `POST /plataforma/empresas/:id/soporte` | superadministrador | `{ motivo, sucursalId? }` | 201 `ingresoRespuesta`; 400; 404 |
| `GET`, `POST /plataforma/planes`; `PATCH /plataforma/planes/:id` | superadministrador | `planEntrada` (+ `motivo` en escrituras) | 200/201 `planRespuesta`; 400; 404; 409 |
| `GET /plataforma/suscripciones` | superadministrador | `?estado=` | 200 `suscripcionResumen[]` |
| `PATCH /plataforma/suscripciones/:id` | superadministrador | `{ planId?, vencimiento?, motivo }` | 200; 400; 404; 422 |
| `POST /plataforma/suscripciones/:id/pagos` | superadministrador | `pagoEntrada`; `Idempotency-Key` | 201 `{ pago, suscripcion }`; 400; 404; 422 |

Todas las rutas de `/plataforma/*` corren sin contexto de empresa (`@SinEmpresa()`), por la vía de `OperacionPlataforma`. Las escrituras de plataforma exigen `motivo` (texto de 1 a 300, como `actor` y `motivo` de 001).

### Códigos de error nuevos (`CODIGOS_ERROR`)

`CREDENCIALES_INVALIDAS` (401), `SESION_EXPIRADA` (401), `EQUIPO_NO_RECONOCIDO` (401), `BLOQUEO_TEMPORAL` (429, con `reintentarEnSegundos` y cabecera `Retry-After`), `FUERA_DE_HORARIO` (403), `CAMBIO_CONTRASENA_REQUERIDO` (403), `CLAVE_INVALIDA` (403), `CLAVE_REQUERIDA` (403), `AUTORIZACION_INVALIDA` (403), `CLAVE_INNECESARIA` (409), `SUCURSAL_NO_ELEGIDA` (409), `SUCURSAL_INVALIDA` (422), `SUCURSAL_SUSPENDIDA` (403), `MODULO_NO_INCLUIDO` (403), `ULTIMO_ADMINISTRADOR` (409), `PLAN_INVALIDO` (422), `CLAVE_IDEMPOTENCIA_REUTILIZADA` (422). Se mantienen los de 001.

### Paquetes compartidos

- `packages/dominio`:
  - `ROLES` (`MOZO`, `CAJERO`, `COCINA_BARRA`, `SUPERVISOR`, `ADMINISTRADOR`), `ACCIONES` (códigos de la matriz), `requisitoPermiso(rol, accion): 'permitido' | 'clave' | 'prohibido'`, `puedeAutorizar(rol, accion): boolean`, `alcanceReportes(rol)`, `permisosDeRol(rol)`.
  - `largoPin({ esAdministrador, roles }): 4 | 6` (criterio 21).
  - `dentroDeHorario(tramos: TramoHorario[] | null, instante: Date): boolean` (criterio 105), sobre el mismo `TramoHorario` y la misma semántica de `validarHorario` de 001.
  - `estadoSuscripcion({ vencimiento, diasGracia }, instante)`, `sumarMeses(fecha, n)`, `fechaLima(instante)`, `periodoLima(instante)` (`AAAA-MM`).
  - `MODULOS` (catálogo: `SALON`, `COCINA`, `CAJA`, `FACTURACION`, `PEDIDOS_WEB`, `INVENTARIO`, `REPORTES`).
  - `MAXIMO_PERSONAS_POR_EQUIPO = 5`.
- `packages/contratos` (zod): `nombreUsuarioSchema`, `contrasenaSchema`, `pinSchema` (`^(\d{4}|\d{6})$`), `pinAutorizacionSchema` (`^\d{6}$`), `horarioUsuarioSchema` (`horarioSchema` de 001 con al menos un tramo, o `null`), `rolSchema`, `accionSchema`, `moduloSchema`, `fechaSchema` (`AAAA-MM-DD` válida), `montoSchema` (`^\d{1,8}(\.\d{1,2})?$`, mayor que 0), `motivoSchema` (1 a 300, sin NUL ni sustitutos sueltos); entradas y respuestas de la tabla de endpoints (`ingresoContrasenaEntrada`, `ingresoPinEntrada`, `ingresoRespuesta`, `sesionRespuesta`, `recordarEquipoEntrada`, `recordarEquipoRespuesta`, `equipoActualRespuesta`, `equipoRecordadoRespuesta`, `usuarioCrearEntrada`, `usuarioModificarEntrada`, `usuarioRespuesta`, `autorizacionEntrada`, `autorizacionRespuesta`, `planEntrada`, `planRespuesta`, `suscripcionRespuesta`, `suscripcionResumen`, `pagoEntrada`, `altaEmpresaEntrada`, `altaEmpresaRespuesta`, `emisorRespuesta`). `sucursalEntradaSchema` gana `suscripcion` opcional (`{ planId?, vencimiento? }`), sin romper a quien no lo envía. Las entradas son estrictas (un campo desconocido es 400): ninguna acepta `empresaId`, `creadoPor*` ni `actualizadoPor*`.

### Interfaces de la API (contratos públicos para las pruebas)

- `crearAplicacion({ controladoresExtra?, logger?, reloj? })`: `reloj` reemplaza al proveedor `RELOJ` (`interface Reloj { ahora(): Date }`, en `apps/api/src/nucleo/reloj/`).
- `ContextoEmpresa.ejecutar(empresaId, fn, opciones?)`: `opciones.actor` (`{ usuarioId, equipoId? } | { superadministradorId } | { sistema }`) fija el actor de la transacción junto con la empresa; sin `actor`, la transacción puede leer pero no escribir en tablas trazadas (criterio 115); `ContextoEmpresa.fijarActor(actor)` lo fija más tarde dentro de la misma transacción (ingresos), una sola vez.
- Decoradores (`apps/api/src/modulos/seguridad/`): `@Publica()`, `@Permiso(accion)`, `@SoloAdministrador()`, `@RequiereModulo(modulo)`, `@RequiereSucursal()`, `@Idempotente()`. Las rutas de plataforma usan `@Superadministrador()` (en `apps/api/src/modulos/plataforma/`).
- `SesionActual.principal(): Principal` (dentro de una petición): `{ tipo: 'CONTRASENA' | 'PIN' | 'SOPORTE' | 'PRUEBA', empresaId, sesionId, usuarioId, superadministradorId, sucursalId, rol, esAdministrador, equipoId, equipoRecordadoId }`.
- `AutorizacionService.consumir({ autorizacionId, accion, entidad?, entidadId?, detalle? })`: dentro del contexto de la acción; devuelve `{ solicitanteId, autorizadorId, motivo }` o lanza 403 `AUTORIZACION_INVALIDA`. `@Permiso` la llama solo.
- `AuditoriaService.registrar(entrada)` (contexto de empresa) e `insertarAuditoriaPlataforma(transaccion, entrada)` (para `OperacionPlataforma`); el actor no es parte de la entrada (criterio 119).
- `SuscripcionService.exigirAperturaDeCaja(sucursalId)`, `SuscripcionService.registrarComprobanteEmitido(sucursalId, instante)`, `SuscripcionService.estadoDeSucursal(sucursalId)`.
- `PlataformaEmpresasService.registrarEmpresa(datos, auditoria)`, `agregarEmisor`, `agregarSucursal`: como en 001, con `suscripcion` opcional por sucursal y `administrador` opcional en el alta; `auditoria.actor` acepta un texto (actor de sistema, como hoy) o `{ superadministradorId }`, y es también el actor de trazabilidad de la operación.
- `crearSuperadministrador({ usuario, nombre, contrasena })`, `desactivarSuperadministrador({ usuario })` y `desbloquearSuperadministrador({ usuario })` en `apps/api/scripts/lib/superadministrador.ts`.
- `sqlTablaDeEmpresaTrazable(tabla, opciones)` y `sqlTrazabilidad(tabla, { columnaEmpresa? })` en `apps/api/src/migraciones/sql-tabla-de-empresa.ts`, para las migraciones de esta sección y las futuras.

### Funciones de la base de datos (contratos para las pruebas a nivel SQL)

- `public.empresa_de_usuario(p_usuario text) RETURNS uuid` (criterio 89).
- `public.fijar_contexto_actor(p_usuario uuid, p_equipo uuid, p_superadministrador uuid, p_sistema text) RETURNS void` (criterio 116).
- `public.trazabilidad()`: función del trigger de trazabilidad (criterios 113 a 115).
- Las de 001 sin cambios (`fijar_contexto_empresa`, `empresa_actual`).

### Variables de entorno nuevas

| Variable | Uso |
| --- | --- |
| `PIN_PEPPER` | Secreto para la huella de los PIN (32 bytes o más, en base64). Obligatoria salvo con `NODE_ENV` `development` o `test`, donde hay un valor por defecto (como `DB_PASSWORD_*`, criterio 29b de 001). Cambiarla invalida todos los PIN |
| `ORIGENES_PERMITIDOS` | Orígenes de la PWA para CORS, separados por coma. Obligatoria en producción |
| `EMPRESA_POR_HEADER` | Ahora solo vale con `NODE_ENV=test` (criterio 7) |
| `VITE_API_URL` | (PWA) URL base de la API |

### Eventos en tiempo real

- Ninguno. El cierre de sesiones (revocar equipos, desactivar) se nota en la siguiente petición.

### Permisos

- Los de la tabla de endpoints y la matriz de "Reglas de negocio". Sesión de soporte = Administrador en todas las sucursales de la empresa, sin horario. Principal de prueba (criterio 7) = Administrador.
- Permisos de la base de datos (además de los de 001):

| Tabla | `restaurante_api` | `restaurante_plataforma` |
| --- | --- | --- |
| `superadministrador`, `sesion_superadministrador` | ninguno | SELECT, INSERT, UPDATE |
| `plan` | SELECT (todas las filas) | SELECT, INSERT, UPDATE |
| `suscripcion` | SELECT, INSERT (su empresa) | SELECT, INSERT, UPDATE |
| `pago_suscripcion` | ninguno | SELECT, INSERT |
| `consumo_comprobantes` | SELECT, INSERT, UPDATE | SELECT |
| `usuario` | SELECT, INSERT, UPDATE | SELECT, INSERT |
| `acceso_sucursal` | SELECT, INSERT, UPDATE, DELETE | SELECT |
| `equipo`, `equipo_recordado`, `sucursal_acceso`, `bloqueo_intentos` | SELECT, INSERT, UPDATE (y DELETE en `bloqueo_intentos`) | ninguno |
| `sesion` | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `autorizacion` | SELECT, INSERT, UPDATE | ninguno |
| `idempotencia` | SELECT, INSERT, DELETE | ninguno |
| `idempotencia_plataforma` | ninguno | SELECT, INSERT, DELETE |
| `auditoria` | SELECT, INSERT (su empresa) | SELECT, INSERT |
| esquemas `autenticacion` y `contexto` | ninguno, ni `USAGE` | ninguno, ni `USAGE` |

| Función | `restaurante_api` | `restaurante_plataforma` |
| --- | --- | --- |
| `empresa_de_usuario(text)` | `EXECUTE` | ninguno |
| `fijar_contexto_actor(uuid, uuid, uuid, text)` | `EXECUTE` | `EXECUTE` |
| `trazabilidad()` | ninguno (la ejecuta el trigger) | ninguno |

## Cambios al modelo de datos

Todas las tablas con `id uuid` (`gen_random_uuid()`), `creado_en` y, si se modifican, `actualizado_en`. Las de empresa siguen la convención de 001 (RLS forzada, `aislamiento_empresa`, llaves compuestas con `empresa_id`, índice por `empresa_id`, sin `TRUNCATE`) y, salvo las cuatro excepciones, la de trazabilidad (criterio 113).

- **Trazabilidad** (en cada tabla trazada): `creado_por_usuario_id uuid null`, `creado_por_equipo_id uuid null`, `creado_por_superadministrador_id uuid null`, `creado_por_sistema text null`, y las cuatro `actualizado_por_*`. `CHECK` de exactamente uno de usuario, superadministrador o sistema por grupo, y equipo solo con usuario. FK `(creado_por_usuario_id, empresa_id)` → `usuario (id, empresa_id)` (en `empresa`, con `id` como empresa), `(creado_por_equipo_id, empresa_id)` → `equipo (id, empresa_id)`, `creado_por_superadministrador_id` → `superadministrador (id)`, y lo mismo para `actualizado_por_*`. Trigger `trazabilidad` `BEFORE INSERT OR UPDATE FOR EACH ROW`.
- **`contexto.sesion_actor`** (esquema `contexto` de 001, sin acceso para los roles de la aplicación): `pid`, `xid xid8`, `usuario_id`, `equipo_id`, `superadministrador_id`, `sistema`. `UNLOGGED`, como `contexto.sesion_empresa`. Solo la escriben `fijar_contexto_actor` y la leen las funciones de trigger.
- **`empresa`, `emisor`, `sucursal`** (de 001): ganan las columnas y el trigger de trazabilidad (criterio 118).
- **`superadministrador`** (plataforma): `usuario` (único, minúsculas), `nombre`, `hash_contrasena`, `activo`, `fallos_seguidos`, `en_curso`, `en_curso_desde null`, `bloqueado_hasta`.
- **`sesion_superadministrador`** (plataforma): `superadministrador_id`, `huella_secreto` (`bytea` SHA-256), `expira_en`, `cerrada_en`.
- **`plan`** (global, sin `empresa_id`): `codigo` (único), `nombre`, `precio_mensual numeric(10,2) null`, `cuota_comprobantes_mes integer null` (≥ 0), `precio_excedente numeric(10,4) null`, `dias_gracia integer` (0 a 60), `modulos text[]`, `por_defecto boolean` (índice único parcial `WHERE por_defecto`), `activo`. Políticas: `acceso_plataforma` y `lectura_api` (`FOR SELECT TO restaurante_api USING (true)`). La migración inserta `BASE`.
- **`suscripcion`**: `empresa_id`, `sucursal_id` (única; FK compuesta a `sucursal`), `plan_id` (FK a `plan`), `vencimiento date`.
- **`pago_suscripcion`**: `empresa_id`, `suscripcion_id` (FK compuesta), `monto numeric(10,2)` (> 0), `fecha_pago date`, `medio` (`EFECTIVO`, `TRANSFERENCIA`, `YAPE`, `PLIN`, `TARJETA`, `OTRO`), `referencia null`, `vencimiento_anterior`, `vencimiento_nuevo`. Quién lo registró queda en `creado_por_superadministrador_id` (trazabilidad). Inmutable (triggers como la auditoría).
- **`consumo_comprobantes`**: `empresa_id`, `sucursal_id`, `periodo char(7)`, `emitidos integer`; clave `(sucursal_id, periodo)`.
- **`usuario`**: `empresa_id`, `nombre` (1 a 100), `nombre_usuario` (minúsculas, `CHECK` del formato), `hash_contrasena` (no nulo), `contrasena_temporal boolean`, `huella_pin bytea` (no nula; única con `empresa_id`), `largo_pin smallint` (`CHECK IN (4, 6)`), `horario jsonb null` (`CHECK` de que, si no es nulo, es un arreglo no vacío; el contenido lo valida la API con `horarioUsuarioSchema`), `es_administrador`, `activo`; `CHECK (NOT es_administrador OR horario IS NULL)`. Trigger `SECURITY DEFINER` que mantiene `autenticacion.nombre_usuario`.
- **`autenticacion.nombre_usuario`** (fuera de `public`): `nombre text PRIMARY KEY`, `empresa_id`, `usuario_id`. Solo la tocan el trigger y `empresa_de_usuario`.
- **`acceso_sucursal`**: `empresa_id`, `usuario_id`, `sucursal_id`, `rol` (`MOZO`, `CAJERO`, `COCINA_BARRA`, `SUPERVISOR`); clave `(usuario_id, sucursal_id)`; FK compuestas.
- **`sucursal_acceso`**: `empresa_id`, `sucursal_id` (clave), `minutos_inactividad` (1 a 120, por defecto 5). Sin fila, vale 5.
- **`equipo`**: `empresa_id`, `nombre` (1 a 60), `huella_secreto`, `ultimo_uso_en`. Sin sucursal.
- **`equipo_recordado`**: `empresa_id`, `equipo_id` (FK compuesta), `usuario_id` (FK compuesta), `recordado_en`, `ultimo_uso_en`, `ultima_sucursal_id null` (FK compuesta), `revocado_en null`, `motivo_revocacion null` (`REVOCADO`, `OLVIDADO`, `REEMPLAZADO`, `BLOQUEO`, `DESACTIVADO`, `CONTRASENA_RESTABLECIDA`; obligatorio si hay `revocado_en`). Quién lo revocó queda en `actualizado_por_*`. Índice único parcial `(equipo_id, usuario_id) WHERE revocado_en IS NULL`.
- **`sesion`**: `empresa_id`, `tipo` (`CONTRASENA`, `PIN`, `SOPORTE`), `usuario_id null`, `superadministrador_id null` (exactamente uno, según el tipo), `equipo_id null` y `equipo_recordado_id null` (ambos obligatorios en `PIN`; en `CONTRASENA`, desde `POST /sesion/equipo`; nulos en `SOPORTE`), `sucursal_id null`, `huella_secreto`, `ultima_actividad_en`, `expira_en` (máximo absoluto), `minutos_inactividad` (30 en `CONTRASENA` y `SOPORTE`; en `PIN` se lee de la sucursal activa), `cerrada_en null`, `motivo_cierre null`. Índice único parcial `(equipo_id) WHERE tipo = 'PIN' AND cerrada_en IS NULL`. Sin trazabilidad (excepción).
- **`autorizacion`**: `empresa_id`, `sesion_id`, `solicitante_id`, `autorizador_id`, `sucursal_id`, `equipo_id null`, `accion`, `motivo`, `expira_en`, `usada_en null`.
- **`bloqueo_intentos`**: `empresa_id`, `ambito` (`CONTRASENA_USUARIO`, `PIN_EQUIPO_RECORDADO`, `CLAVE_USUARIO`, `CLAVE_EQUIPO`), `objetivo_id`, `fallos_seguidos`, `en_curso` (evaluaciones de contraseña reservadas sin resolver; 0 en los demás ámbitos), `en_curso_desde null`, `ultimo_fallo_en`, `bloqueado_hasta null`; clave `(empresa_id, ambito, objetivo_id)`. Sin trazabilidad (excepción).
- **`idempotencia`** (empresa) e **`idempotencia_plataforma`**: `clave uuid`, `ruta`, `actor` (usuario, superadministrador o sesión), `huella_entrada`, `estado_http`, `respuesta jsonb`, `creado_en`; únicas `(empresa_id, clave)` y `(clave)`. Sin trazabilidad (excepción).
- **`auditoria`** (reemplaza a `auditoria_plataforma`): `empresa_id null`, `sucursal_id null` (FK compuesta), `ocurrido_en`, `origen` (`empresa`, `plataforma`), `accion`, `actor_usuario_id`, `actor_superadministrador_id`, `actor_sistema` (exactamente uno; los pone el trigger desde el contexto de actor, criterio 119), `equipo_id null` (también del contexto), `autorizado_por_id null`, `autorizacion_id null`, `sesion_id null`, `motivo null`, `entidad null`, `entidad_id null`, `detalle jsonb`. Triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE`. Políticas `aislamiento_empresa` (api) y `acceso_plataforma`. Índices por `(empresa_id, ocurrido_en)`. Sin columnas de trazabilidad (excepción: ya guarda su actor).
- **`auditoria_plataforma`**: se copia a `auditoria` y se elimina (criterio 56).

## Fuera de alcance

- Exportar los datos de una sucursal (CSV o Excel) y la pantalla de auditoría para el dueño: llegan con la épica de reportes (HU-36 y siguientes). En esta sección solo se garantiza que la suspensión no bloquea la lectura (criterio 82).
- Baja o cancelación de una empresa o sucursal, y la eliminación de datos tras el plazo del contrato.
- Cobro automático de suscripciones, facturar el excedente y los precios definitivos (pendientes comerciales).
- Recuperar la contraseña por correo o SMS (RNF-18); la restablece el Administrador o el superadministrador en soporte.
- Doble factor para el superadministrador (riesgo anotado en el plan).
- Abrir caja, turnos y la emisión de comprobantes: aquí solo quedan los contratos `exigirAperturaDeCaja` y `registrarComprobanteEmitido`.
- Las acciones protegidas reales (anular, descontar, cortesía, nota de crédito): llegan con sus historias y usan `@Permiso`.
- Tiempo real (avisar al equipo al instante cuando se revoca o se desactiva a alguien).
- El puente de impresión Android y su autenticación (historia de impresión).
- Límite de peticiones por IP (lo cubre Cloudflare); aquí solo los bloqueos por cuenta, por persona en el equipo, por equipo y por solicitante.
- Feriados y excepciones por fecha en el horario de acceso (como en el horario de la sucursal de 001).
- Trazar los borrados: una fila borrada no guarda quién la borró; los borrados sensibles se cubren con la auditoría (por ejemplo, el cambio de accesos queda en `modificar_usuario`).

## Impacto en la especificación 001

Cambios de comportamiento que afectan pruebas protegidas de 001. No se edita `specs/001-*`; las pruebas las actualiza test-writer en la fase B de esta sección (tarea P10 de `tasks.md`), sin quitar ni debilitar aserciones:

- **Auditoría** (criterios 32, 32b, 33, 34, 35, 36, 38, 40b, 40c y el inciso de plataforma de 38e): las filas pasan de `auditoria_plataforma` a `auditoria` con `origen = 'plataforma'`; el criterio 38 cambia los privilegios esperados de `restaurante_api` sobre la tabla de auditoría (SELECT e INSERT bajo RLS).
- **Criterio 30:** en producción, sin sesión, el código pasa de `EMPRESA_NO_RESUELTA` a `NO_AUTENTICADO`.
- **Criterio 31:** el resolutor por cabecera deja de valer con `NODE_ENV=development` (la API no arranca con esa combinación, criterio 7).
- **Criterios 18, 23, 26, 39 y 40:** siguen valiendo en `NODE_ENV=test` con la cabecera y sin `Authorization` (principal de prueba con actor `prueba`, criterio 7).
- **Trazabilidad:** toda prueba de 001 que escribe en `empresa`, `emisor` o `sucursal` por SQL como `restaurante_api` o `restaurante_plataforma` (por ejemplo las de RLS, criterios 11 a 16b) tiene que fijar antes un actor con `fijar_contexto_actor`; si no, la escritura fallaría por falta de actor y una prueba que espera un rechazo de RLS pasaría por la razón equivocada. Las pruebas actualizadas comprueban que el error es el de la política RLS. Las comparaciones de respuestas completas de sucursales y emisores no cambian: las columnas de trazabilidad no se agregan a `sucursalRespuesta` ni a `emisorRespuesta`.
- **Secuencia:** esta sección empieza su fase B cuando cierre la fase E de 001 (T45 a T47), porque ambas tocan las guardas, las pruebas protegidas y las migraciones.

## Notas para otras historias

- **Toda tabla nueva con datos de clientes** se crea con `sqlTablaDeEmpresaTrazable` en la misma migración (RLS y trazabilidad); la prueba de catálogo del criterio 113 falla si no. Toda escritura corre con un actor fijado; las tareas del worker (colas) fijan un actor de sistema (`worker:<tarea>`).
- **Reporte de control (RF-80, HU-36):** las anulaciones, descuentos, cortesías, notas de crédito, cambios de precio y cambios de permisos deben auditar quién pidió y, cuando hubo clave, quién autorizó, con el motivo, la sucursal, el equipo y la hora. Las acciones con clave lo obtienen de `@Permiso` (criterio 48); los cambios de precio y de permisos los hace el Administrador sin clave y se auditan con él como actor. La auditoría ya guarda solicitante, autorizador y motivo; el reporte filtra por fecha, sucursal y usuario.
- **Caja:** llamar `SuscripcionService.exigirAperturaDeCaja(sucursalId)` al abrir caja, y solo ahí (HU-04).
- **Facturación:** llamar `SuscripcionService.registrarComprobanteEmitido(sucursalId, instante)` en la misma transacción en la que se emite cada comprobante; el reporte de consumo de cuota (RF-82) lee `consumo_comprobantes` por el servicio.
- **Acciones protegidas** (anular ítem, descuento, cortesía, nota de crédito, anular orden): marcar la ruta con `@Permiso(ACCION)` y abrir la ventana de clave de la PWA cuando `permisos[ACCION] === 'clave'`.
- **Módulos:** las rutas de cada módulo se marcan con `@RequiereModulo`.
- **Salón (HU-10):** "quedo registrado como mozo responsable" puede leerse de `creado_por_usuario_id` de la orden, pero conviene una columna de negocio propia (`mozo_id`), porque el responsable no siempre es quien crea la fila.
- **Impresión:** el puente Android necesitará su propia credencial; no es una persona, así que no usa `equipo_recordado` y su actor de trazabilidad será de sistema (`puente:<id>`) o un tipo nuevo que se decida en esa historia.
- **Tiempo real:** al llegar Socket.IO, autenticar la conexión con el mismo token y cerrar las salas al cerrar la sesión.

## Cambios propuestos a los documentos compartidos

El orquestador los lleva a los documentos compartidos (paso 8 del flujo). Texto propuesto:

- **RNF-08 (Seguridad):** "Acceso del personal con usuario y contraseña la primera vez en cada equipo y, desde entonces, con PIN solo en los equipos donde ya entró con contraseña; el Administrador puede revocar esos equipos y cada persona puede olvidarlos; horario de acceso opcional por trabajador; cierre de sesión por inactividad."
- **RF-09:** "Ingresar con usuario y contraseña la primera vez en cada equipo, y con PIN en los equipos que ya recuerdan a la persona."
- **RF-10:** "Ver y revocar desde la administración los equipos recordados de cada trabajador, y permitir que cada persona olvide los suyos."
- **RF-08:** agregar "con PIN de 4 dígitos (Mozo, Cocina/Barra) o de 6 (Cajero, Supervisor, Administrador) y un horario de acceso opcional".
- **HU-02:** "Como mozo, quiero entrar con mi PIN en mi celular o en el equipo que uso, para empezar a atender rápido." Criterios: "El PIN solo funciona en equipos donde ya entré con usuario y contraseña." "En un equipo que no me recuerda se piden usuario y contraseña." "La sesión se cierra sola tras el tiempo de inactividad configurado." "Fuera de mi horario no puedo entrar."
- **Documento de diseño, "Reglas de negocio · Seguridad":** reemplazar la primera viñeta por el texto de RNF-08; agregar "Cada registro guarda quién lo creó y quién lo cambió por última vez, y desde qué equipo".
- **Documento de diseño, "Modelo de datos · Seguridad":** "Equipo vinculado" pasa a "Equipo y Equipo recordado"; agregar "Horario de acceso" en Usuario.
- **Nuevo RNF de trazabilidad (sugerido):** "Cada registro de datos de clientes guarda quién lo creó y quién lo modificó por última vez (usuario y equipo, superadministrador o proceso del sistema)."
- **`CLAUDE.md`, "Ruta crítica":** "Permisos: clave de supervisor, equipos vinculados y auditoría" pasaría a "equipos recordados, horario de acceso, auditoría y trazabilidad" (lo decide el usuario; los subagentes no editan `CLAUDE.md`).

## Decisiones del usuario

No quedan preguntas abiertas. Respuestas del usuario a la versión en borrador (2026-10-27):

1. **Acceso del personal (antes preguntas 1 y 24):** no hay tablets del local; cada trabajador usa su propio celular o cualquier equipo. La primera vez en un equipo entra con usuario y contraseña y desde entonces el equipo lo recuerda (token de equipo atado a la persona y a su empresa); después entra con su PIN, solo en equipos donde ya entró con contraseña. Un equipo puede recordar a más de una persona. El Administrador revoca los equipos recordados de un trabajador y el trabajador puede olvidar su equipo. La contraseña es obligatoria para todos; el Administrador la crea temporal y se cambia en el primer ingreso. Vincular deja de ser una acción del Administrador. RNF-08 se reescribe (texto en "Cambios propuestos a los documentos compartidos"). Sigue siendo ruta crítica.
2. **Horario de acceso por trabajador:** opcional; semanal con tramos por día que pueden cruzar la medianoche (reutiliza `validarHorario` y `tramoHorarioSchema` de 001); sin horario se entra a cualquier hora; el Administrador nunca tiene. Fuera del horario no se inicia sesión ni con contraseña ni con PIN, ni se autoriza como supervisor. Una sesión abierta cuando termina el horario sigue hasta que se cierra o queda inactiva; después no se puede volver a entrar fuera de horario. Hora de Lima. Ruta crítica. **Por usuario y no por sucursal** (el usuario delegó la decisión): el horario controla cuándo una persona puede entrar al sistema, no qué hace con su rol en cada sucursal, que ya lo deciden los accesos; el ingreso con contraseña ocurre antes de elegir sucursal, así que un horario por sucursal obligaría a decidir contra qué sucursal se mira y a volver a mirarlo al cambiar de sucursal y al autorizar; en un restaurante pequeño una persona rara vez trabaja en dos sucursales con turnos distintos, y si pasa, su horario puede tener los tramos de ambas. Si más adelante hace falta por sucursal, se mueve la columna a `acceso_sucursal` y se agrega la comprobación al cambiar de sucursal, sin tocar el resto.
3. **Largo del PIN por rol (antes pregunta 13):** 4 dígitos para Mozo y Cocina/Barra; 6 para Cajero, Supervisor y Administrador; con roles distintos en varias sucursales, el mayor. **Unicidad:** el PIN ya no hace falta para saber quién entra (la persona se elige en el equipo que la recuerda), pero sí para saber quién autoriza: HU-03 pide solo el PIN en la ventana del supervisor. Se mantiene el PIN único en la empresa y generado por el sistema (nadie descubre el PIN de otro al ver que "ya está en uso"); los únicos que autorizan (Supervisor y Administrador) tienen 6 dígitos, así que el supervisor se identifica solo por su PIN de 6 dígitos, entre un millón de combinaciones. La ventana no acepta PIN de 4 dígitos.
4. **Aprobados tal como estaban:** 7 días de gracia en el plan (0 a 60); plan `BASE` sin precio ni cuota definidos (sin cuota no hay excedente); la suspensión solo impide abrir caja; la sucursal creada por el Administrador nace con vencimiento el mismo día; el Administrador es de toda la empresa y la empresa conserva al menos uno activo; autorizan con su PIN el Supervisor y el Administrador con acceso a la sucursal, distintos de quien pide, por una sola acción y 2 minutos; los bloqueos (ajustados en el punto 5); el soporte del superadministrador (permisos de Administrador, motivo obligatorio, 2 horas como máximo, todo auditado y visible para la empresa, sin consentimiento por entrada); y las pantallas incluidas en esta sección.
5. **Aprobados sin objeciones:** nombre de usuario único en todo el sistema, de 3 a 50 caracteres `a-z 0-9 . _ -`, sin distinguir mayúsculas; contraseñas de 8 a 128 caracteres, temporal la que pone otro, al cambiarla se cierran las otras sesiones; tiempos de sesión (PIN: inactividad por sucursal, 5 minutos por defecto, 1 a 120; contraseña: 30 minutos; ambas 12 horas como máximo; superadministrador 8 horas; soporte 30 minutos de inactividad y 2 horas); pagos y vencimientos (vencimiento inicial indicado o un mes calendario, pago con vencimiento nuevo sugerido a un mes, pagos inmutables, medios efectivo, transferencia, Yape, Plin, tarjeta u otro; vencimiento en fecha de Lima, activa todo ese día); catálogo de módulos; cuota por todo comprobante electrónico emitido, por mes de Lima; la baja y la conservación de datos fuera de esta sección; anular una orden abierta igual que anular un ítem enviado; el alta crea al primer Administrador. **Bloqueos ajustados a celulares personales:** contraseña, por usuario (5 fallos, 15 minutos); PIN, por persona en cada equipo (criterio 36); clave de supervisor, por solicitante y por equipo (5 fallos, 5 minutos); superadministrador, 5 fallos, 15 minutos.
6. **Móvil primero:** la PWA se usa sobre todo en celulares; las pantallas se diseñan primero para pantallas chicas y conexión variable (criterio 103).
7. **Trazabilidad (requisito transversal, ruta crítica):** el sistema siempre sabe qué persona hizo cada acción. Toda tabla con datos de clientes, actual y futura, lleva quién la creó y quién la cambió (usuario y equipo), lo llena la base desde el contexto de la sesión y nunca el cuerpo; una prueba de catálogo lo verifica; se aplica también a `empresa`, `emisor` y `sucursal` de 001 con una migración nueva. La auditoría registra en cada fila actor, empresa, sucursal, equipo y fecha, con la lista de acciones auditadas de esta sección, y queda la nota para las historias futuras.

Precisiones del especificador derivadas de estas decisiones (para revisión del usuario; no cambian sus decisiones):

- **Máximo 5 personas por equipo:** un turno de un restaurante pequeño rara vez pasa de 5 personas compartiendo un celular; 5 nombres caben como botones grandes en la pantalla de un celular sin desplazar; y acota los intentos de PIN posibles en un equipo robado (5 personas × 15 intentos, criterio 36). Al llegar una sexta, el equipo olvida a la de uso más antiguo (criterio 29).
- **Olvido por bloqueo:** al 15.º fallo seguido de PIN, el equipo olvida a esa persona (criterio 36). Con un celular robado, la probabilidad de acertar un PIN de 4 dígitos queda en 0,15 % por persona, en lugar de crecer sin límite con el tiempo.
- **Revocaciones automáticas:** desactivar a un usuario o restablecer su contraseña revoca sus equipos recordados (criterio 32b).
- **Recordar el equipo** es un paso aparte (`POST /sesion/equipo`) que la PWA hace sola después del ingreso con contraseña, y solo con la contraseña ya no temporal (criterios 15 y 27).
- **Sucursal de una sesión PIN:** la última que la persona eligió en ese equipo; las sesiones PIN pueden cambiar de sucursal porque el equipo ya no pertenece a una sucursal (criterios 17 y 33).
- **Horario:** una lista vacía no vale (se usa `null` para quitarlo); cambiarlo no cierra sesiones abiertas; el rechazo por horario se audita (criterios 106 y 107).
- **Cambio de largo del PIN:** se regenera en los dos sentidos, para que el largo siempre sea el que dan los roles (criterio 21b).
- **Excepciones de la trazabilidad:** `auditoria`, `sesion`, `bloqueo_intentos` e `idempotencia` (motivos en "Reglas de negocio").
- **Mecanismo de la trazabilidad:** la base, con un contexto de actor hermano del de empresa y un trigger estándar; comparación con hacerlo en la API en `plan.md`.
