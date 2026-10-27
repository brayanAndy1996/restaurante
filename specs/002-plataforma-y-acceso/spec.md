# 002 · Plataforma y acceso

- **Historias y requerimientos:** HU-01 (lo que faltaba: la suscripción de la sucursal en el alta y el alta por HTTP), HU-02, HU-03, HU-04; RF-03 a RF-13; RF-01 y RF-02 por HTTP (regla de rol, endpoints de plataforma). RNF que aplican: RNF-03, RNF-06, RNF-07, RNF-08, RNF-09, RNF-10, RNF-11, RNF-13, RNF-14, RNF-18. Fuente de negocio: `fuentes.md` de esta carpeta.
- **Ruta crítica:** sí, en parte. Ver "Clasificación de ruta crítica" (el orquestador la confirma con el usuario).
- **Estado:** borrador

## Objetivo

Que cada persona entre al sistema de la forma que le corresponde y solo vea y haga lo que su rol le permite: el personal con PIN en las tablets vinculadas del local, con usuario y contraseña en cualquier otro equipo, y el supervisor autorizando acciones protegidas con su PIN desde el equipo del cajero, todo con auditoría inmutable. Además, que nuestro equipo (superadministrador) dé de alta empresas por HTTP con la suscripción de cada sucursal, registre pagos, controle vencimientos y entre a dar soporte con registro. La sesión autenticada pasa a ser la única fuente de la empresa de cada petición, reemplazando el punto de enganche que dejó la historia 001.

## Clasificación de ruta crítica

| Parte | Crítica | Motivo |
| --- | --- | --- |
| Sesión, resolutor de empresa por sesión, rutas protegidas por defecto, cabecera `x-empresa-id` solo en pruebas (criterios 1 a 9) | sí | Decide la empresa de cada petición: es el aislamiento entre empresas (RLS) llevado a la autenticación. |
| Ingreso con usuario y contraseña, bloqueo por intentos (10 a 17) | sí | Es la puerta de los permisos; una falla da acceso a una empresa ajena o a otro usuario. |
| Quién puede administrar usuarios y accesos (25) | sí | Permisos. El resto del mantenimiento de usuarios (18 a 24, 26) no: "mantenimiento simple de usuarios" está fuera de la lista de `CLAUDE.md`; sus pruebas las decide el desarrollador. |
| Equipos vinculados e ingreso con PIN (27 a 42) | sí | Permisos: equipos vinculados. |
| Clave de supervisor y matriz de permisos (43 a 53) | sí | Permisos: clave de supervisor. |
| Auditoría general y unión con `auditoria_plataforma` (54 a 60) | sí | Permisos: auditoría (RNF-09). |
| Superadministrador por HTTP y soporte (61 a 68) | sí | El soporte cruza empresas y debe quedar auditado; un error rompe el aislamiento. |
| Catálogo y RLS de las tablas nuevas (88 a 91) | sí | Aislamiento entre empresas. |
| Suscripción, planes, módulos, cuota y suspensión (69 a 84) | no | No están en la lista. La suspensión solo se consulta al abrir caja, y la historia de caja (crítica) la probará en su flujo. El aislamiento de sus tablas sí queda cubierto por los criterios 88 a 91. |
| Idempotencia genérica (85 a 87) | no | Infraestructura; se ataca cuando la use "Enviar comanda" (crítica). |
| Interfaz de la PWA y panel del superadministrador (92 a 104) | no | Interfaz; la seguridad la impone la API. |

## Decisión sobre la interfaz

Esta sección **incluye pantallas** en `apps/app` (PWA nueva, React + Vite), y el rol `frontend` usa la skill `impeccable` en modo "Operate". Motivos:

1. Los criterios de HU-02, HU-03 y HU-04 son de interfaz ("en un equipo no vinculado se piden usuario y contraseña", "aparece una ventana que pide el PIN", "el administrador ve avisos"): sin pantallas no se pueden aceptar.
2. La PWA, su cliente HTTP (con clave de idempotencia y reintentos), el guardado del token del equipo y el cierre por inactividad son la base de todas las secciones siguientes; armarlos con el acceso evita rehacerlos.
3. Sin un panel mínimo, el alta de clientes y el registro de pagos (HU-01, RF-03) exigirían llamar la API a mano.

El panel del superadministrador vive en la misma PWA bajo `/plataforma`, con su propio ingreso (supuesto, pregunta 21). Es mínimo: formularios y tablas, sin pulido extra. Si el usuario prefiere solo API en esta sección, las tareas `frontend` de cada grupo de `tasks.md` se mueven a una sección propia sin tocar el resto.

## Glosario

- **Sesión de empresa:** credencial temporal de una persona dentro de una empresa. Tipos: `CONTRASENA` (usuario y contraseña, cualquier equipo), `PIN` (equipo vinculado), `SOPORTE` (superadministrador dentro de una empresa). Token `se.<empresaId>.<sesionId>.<secreto>`.
- **Sesión de superadministrador:** credencial del personal de nuestra empresa para las rutas `/plataforma/*`. Token `sa.<sesionId>.<secreto>`. No da acceso a datos de ninguna empresa por sí sola.
- **Equipo vinculado:** tablet o celular del local registrado en una sucursal. Guarda un token de equipo `eq.<empresaId>.<equipoId>.<secreto>`, que manda en la cabecera `X-Equipo`.
- **Principal:** quién hace la petición, calculado en cada petición por la API: tipo de sesión, empresa, usuario o superadministrador, sucursal activa, rol en ella, equipo.
- **Sucursal activa:** la sucursal en la que trabaja la sesión. En una sesión PIN es la del equipo; en una de contraseña, la que eligió el usuario.
- **Acción protegida:** acción que para algunos roles exige clave de supervisor (matriz de "Roles y permisos" del documento de diseño).
- **Autorización:** permiso de un solo uso que crea un supervisor con su PIN para una acción protegida de otra persona, válido por poco tiempo.
- **Reloj de la API:** proveedor `RELOJ` del que la API toma la hora para toda regla de tiempo (inactividad, vencimientos, bloqueos, auditoría). Las pruebas lo reemplazan.

## Criterios de aceptación

Salvo que se diga otra cosa: hay dos empresas, **A** y **B**, dadas de alta con la vía de plataforma, cada una con al menos dos sucursales y usuarios de cada rol; "con sesión de X" significa con `Authorization: Bearer <token>` de una sesión válida de X; las horas se controlan con el reloj de la API; toda respuesta de error tiene la forma `{ codigo, mensaje, campos? }` de la historia 001 (criterio 40d) y nunca incluye detalles de PostgreSQL.

### Sesión, resolutor y rutas protegidas (ruta crítica)

1. **Rutas protegidas por defecto.** Dada la API sin el resolutor por cabecera (criterio 7) y cualquier ruta registrada en la aplicación que no esté marcada `@Publica()` ni sea de `/plataforma/*`, cuando llega sin `Authorization`, con un token mal formado, con un token de una sesión cerrada, con el token de un superadministrador (`sa.…`) o con un token de equipo (`eq.…`) como `Authorization`, entonces responde 401 `NO_AUTENTICADO` (o `SESION_EXPIRADA`, criterios 14 y 39), el controlador no se ejecuta y no se abre ningún contexto de empresa. La prueba recorre todas las rutas que Nest tiene registradas (no una lista fija). Las únicas rutas públicas permitidas son `GET /health`, `POST /sesiones/contrasena`, `POST /sesiones/pin`, `GET /equipo` y `POST /plataforma/sesiones`; una ruta pública que no esté en esa lista hace fallar la prueba.
2. **La empresa sale de la sesión.** Dado un usuario de A con sesión válida, cuando llama cualquier ruta de empresa, entonces corre con el contexto de A, y ninguna cabecera, parámetro ni cuerpo cambia la empresa: con `x-empresa-id` = B, `GET /sucursales` devuelve solo sucursales de A (en `NODE_ENV` `test`, `development` y `production`).
3. **Token adulterado.** Dado un token válido de una sesión de A, cuando se reemplaza la parte de empresa por el id de B, la parte de sesión por el id de una sesión de B (con el secreto de A), o el secreto por otro, entonces cada intento responde 401 `NO_AUTENTICADO` con el mismo cuerpo, sin datos de B; y la sesión de B sigue válida y su `ultimaActividadEn` no cambia.
4. **Secretos no guardados.** Dada una sesión, un equipo o una sesión de superadministrador recién creados, cuando se inspeccionan sus filas en la base, entonces ninguna columna contiene el token ni su secreto en claro: solo su huella SHA-256.
5. **Concurrencia.** Dado un pool de la API de 2 conexiones, cuando llegan 100 peticiones concurrentes alternando sesiones de A y de B, entonces cada respuesta contiene solo datos de su empresa (equivalente al criterio 26 de 001, ahora con sesiones).
6. **Rol y acceso en cada petición.** Dada una sesión abierta, cuando el Administrador cambia el rol del usuario en la sucursal activa, entonces la siguiente petición de esa sesión ya usa el rol nuevo; cuando lo desactiva o le quita el acceso a la sucursal activa de esa sesión, entonces la sesión queda cerrada y su siguiente petición responde 401 `NO_AUTENTICADO`.
7. **Cabecera de empresa solo en pruebas.** Dado `NODE_ENV=development` con `EMPRESA_POR_HEADER=habilitado`, cuando arranca la API, entonces no arranca y el registro explica que la opción solo vale con `NODE_ENV=test` (con `production` sigue igual que en 001). Dado `NODE_ENV=test` con la opción habilitada: una petición **sin** `Authorization` corre con la empresa de `x-empresa-id` como en la historia 001, con un principal de prueba con permisos de Administrador en todas las sucursales de esa empresa (y sin cabecera, o con una inválida, responde 401 `EMPRESA_NO_RESUELTA` como en 001); una petición **con** `Authorization` ignora la cabecera. Sin la opción, la cabecera se ignora siempre.
8. **Producción sin sesión.** Dado `NODE_ENV=production`, cuando llega `GET /sucursales` con `x-empresa-id` de una empresa real y sin `Authorization`, entonces responde 401 `NO_AUTENTICADO` (reemplaza el `EMPRESA_NO_RESUELTA` del criterio 30 de 001).
9. **Regla de rol en emisores y sucursales** (notas de 001). `GET /sucursales`, `GET /sucursales/:id` y `GET /emisores`: cualquier rol con sesión en la empresa. `POST /emisores`, `POST /sucursales`, `PATCH /sucursales/:id`, `GET` y `PATCH /sucursales/:id/acceso`: solo Administrador (y sesión de soporte). Dado cualquier otro rol (con sesión de contraseña o de PIN), cuando llama esas rutas de escritura, entonces responde 403 `PROHIBIDO` y nada cambia. Los criterios 18, 39 y 40 de 001 siguen valiendo con sesión de Administrador.

### Ingreso con usuario y contraseña (ruta crítica)

10. **Ingreso correcto.** Dado un usuario activo con contraseña, cuando llama `POST /sesiones/contrasena` con `{ usuario, contrasena }` correctos (el nombre de usuario sin distinguir mayúsculas), entonces responde 201 `{ token, sesion }` con una sesión `CONTRASENA`; la sucursal activa es la única a la que tiene acceso, o `null` si tiene varias (el Administrador tiene acceso a todas).
11. **Fallo sin pistas.** Dada una contraseña incorrecta, un usuario inexistente, un usuario inactivo o un usuario sin contraseña, cuando intenta ingresar, entonces responde 401 `CREDENCIALES_INVALIDAS` con el mismo cuerpo en todos los casos y no se crea sesión.
12. **Bloqueo por intentos.** Dados 5 fallos seguidos con el mismo nombre de usuario existente, cuando intenta de nuevo durante los 15 minutos siguientes al quinto fallo, entonces responde 429 `BLOQUEO_TEMPORAL` con `reintentarEnSegundos`, aunque la contraseña sea correcta, sin evaluarla; pasados los 15 minutos, la contraseña correcta funciona. Un ingreso correcto antes del quinto fallo reinicia la cuenta. Los fallos quedan registrados aunque la respuesta sea un error, y el bloqueo deja una fila de auditoría. El bloqueo de un usuario no afecta a otros usuarios de A ni de B.
13. **Contraseña.** Una contraseña tiene de 8 a 128 caracteres, sin NUL ni sustitutos UTF-16 sueltos (criterios 40b y 40c de 001). Se guarda con scrypt (formato del plan), nunca en claro, y ninguna respuesta, fila de auditoría ni registro la contiene.
14. **Inactividad y duración.** Dada una sesión `CONTRASENA`, cuando pasan 30 minutos sin peticiones, o 12 horas desde que se creó, entonces la siguiente petición responde 401 `SESION_EXPIRADA` y la sesión queda cerrada. Toda petición autenticada renueva la actividad, salvo las que llevan `X-Actividad: segundo-plano`, que se validan pero no renuevan.
15. **Cambio de contraseña obligatorio.** Dado un usuario con contraseña temporal (alta o restablecimiento), cuando ingresa, entonces la sesión trae `debeCambiarContrasena: true` y toda ruta, salvo `GET /sesion`, `PUT /sesion/contrasena` y `DELETE /sesion`, responde 403 `CAMBIO_CONTRASENA_REQUERIDO`; después de cambiarla, todo funciona según su rol.
16. **Cambiar la propia contraseña.** `PUT /sesion/contrasena` con `{ actual, nueva }`, solo en sesiones `CONTRASENA`: con `actual` incorrecta responde 401 `CREDENCIALES_INVALIDAS` y cuenta para el bloqueo del criterio 12; con `nueva` inválida o igual a la actual, 400 `DATOS_INVALIDOS`; si es correcta, 204, se cierran las demás sesiones del usuario y la actual sigue. En una sesión PIN o de soporte responde 403 `PROHIBIDO`.
17. **Sucursal activa y salida.** `PUT /sesion/sucursal` con `{ sucursalId }`: si el usuario tiene acceso, responde 200 con la sesión y el rol de esa sucursal; si no tiene acceso, la sucursal es de B o no existe, 404 `NO_ENCONTRADO` idéntico; en una sesión PIN, 403 `PROHIBIDO`. Una ruta que necesita sucursal activa, con la sesión sin sucursal elegida, responde 409 `SUCURSAL_NO_ELEGIDA`. `DELETE /sesion` responde 204 y el token deja de valer.

### Usuarios y accesos (RF-08)

18. **Alta de usuario.** Dado un Administrador, cuando llama `POST /usuarios` con `{ nombre, nombreUsuario, esAdministrador, accesos: [{ sucursalId, rol }], contrasenaTemporal? }`, entonces responde 201 con el usuario y un `pin` de 4 dígitos que solo se muestra en esa respuesta. Un Administrador lleva contraseña temporal obligatoria y ninguna fila en `accesos`; los demás llevan al menos un acceso y la contraseña es opcional (sin ella, solo entran con PIN).
19. **Nombre de usuario.** De 3 a 50 caracteres `a-z`, `0-9`, `.`, `_` o `-`, guardado en minúsculas, único en todo el sistema. Si ya existe (en A o en B), responde 409 `CONFLICTO` con el mismo mensaje en ambos casos, sin decir de qué empresa es.
20. **Accesos.** Un acceso con una sucursal de B o inexistente responde 422 `SUCURSAL_INVALIDA` idéntico; un rol fuera de `MOZO`, `CAJERO`, `COCINA_BARRA` o `SUPERVISOR`, o la misma sucursal dos veces, 400 `DATOS_INVALIDOS`.
21. **PIN.** El PIN lo genera la API al azar (generador criptográfico), es único entre los usuarios de la empresa y puede repetirse en otra empresa. `POST /usuarios/:id/pin` genera uno nuevo (se muestra una vez), el anterior deja de funcionar y se cierran las sesiones PIN del usuario.
22. **Edición.** `PATCH /usuarios/:id` con `{ nombre?, esAdministrador?, accesos?, activo? }` reemplaza lo enviado (los accesos, completos). Desactivar cierra todas las sesiones del usuario. Si el cambio dejaría a la empresa sin ningún Administrador activo, responde 409 `ULTIMO_ADMINISTRADOR` y nada cambia.
23. **Restablecer contraseña.** `POST /usuarios/:id/contrasena` con `{ contrasenaTemporal }` deja la contraseña como temporal (criterio 15) y cierra las sesiones del usuario; con `{ contrasenaTemporal: null }` le quita la contraseña (no permitido para un Administrador: 400).
24. **Consulta.** `GET /usuarios` y `GET /usuarios/:id` devuelven nombre, nombre de usuario, `esAdministrador`, accesos, `activo`, `tieneContrasena` y fechas; nunca hashes, huellas ni PIN. Un usuario de B responde 404 `NO_ENCONTRADO` igual que uno inexistente.
25. **Solo el Administrador** (ruta crítica). Dado cualquier rol distinto de Administrador (sesión de contraseña o de PIN), cuando llama cualquier ruta de `/usuarios`, entonces responde 403 `PROHIBIDO` y nada cambia ni se crea.
26. **Auditoría.** Crear, editar, regenerar PIN y restablecer o quitar contraseña dejan una fila de auditoría con el actor y el antes y después de los campos cambiados, sin secretos (criterio 59).

### Equipos vinculados (RF-10, ruta crítica)

27. **Vincular.** Dado un Administrador con sesión `CONTRASENA` (o de soporte) en el propio equipo, cuando llama `POST /equipos` con `{ sucursalId, nombre }`, entonces responde 201 `{ equipo, tokenEquipo }`; el token se muestra solo en esa respuesta. Con una sucursal de B o inexistente, 422 `SUCURSAL_INVALIDA`; con una sesión PIN o de otro rol, 403 `PROHIBIDO`.
28. **Consultar el equipo.** `GET /equipo` (pública) con `X-Equipo` válido responde 200 `{ equipo: { id, nombre }, sucursal: { id, nombre } }`. Sin la cabecera, mal formada, adulterada (empresa cambiada a B, id de un equipo de B, otro secreto) o de un equipo desvinculado, responde 401 `EQUIPO_NO_VINCULADO` con el mismo cuerpo.
29. **Listar.** `GET /equipos` (Administrador) devuelve los equipos de la empresa con sucursal, `vinculadoEn`, `vinculadoPor`, `ultimoUsoEn` y `desvinculadoEn`; otro rol, 403.
30. **Desvincular.** `DELETE /equipos/:id` (Administrador) responde 204; desde la siguiente petición el token del equipo no vale (criterio 28) y las sesiones PIN abiertas en él quedan cerradas (401 `NO_AUTENTICADO`). Repetirlo responde 204 sin otro efecto ni otra auditoría. Un equipo de B responde 404.
31. **Una sucursal por equipo.** Un equipo pertenece a una sola sucursal; para cambiarlo se desvincula y se vincula de nuevo.
32. **Auditoría.** Vincular y desvincular dejan su fila de auditoría (sin el token).

### Ingreso con PIN, cambio rápido e inactividad (HU-02, RF-09, RF-11, ruta crítica)

33. **Ingreso con PIN.** Dado un equipo vinculado a la sucursal S, cuando llama `POST /sesiones/pin` con `X-Equipo` válido y `{ pin }` de un usuario activo con acceso a S (o Administrador), entonces responde 201 `{ token, sesion }` con una sesión `PIN` en S, con el rol del usuario en S.
34. **Solo en equipos vinculados.** Sin `X-Equipo` válido, `POST /sesiones/pin` responde 401 `EQUIPO_NO_VINCULADO` sin evaluar el PIN ni contar intentos. `POST /sesiones/pin` no acepta usuario ni contraseña (400), y un PIN usado como contraseña en `POST /sesiones/contrasena` es solo una contraseña incorrecta.
35. **PIN rechazado.** Un PIN inexistente, de un usuario inactivo, de un usuario sin acceso a S o de un usuario de B (aunque los dígitos coincidan) responde 401 `CREDENCIALES_INVALIDAS` con el mismo cuerpo.
36. **Bloqueo del equipo.** Dados 5 fallos seguidos en el mismo equipo, cuando se intenta otro PIN en ese equipo durante los 5 minutos siguientes, entonces responde 429 `BLOQUEO_TEMPORAL` sin evaluarlo; los demás equipos y el ingreso con contraseña no se ven afectados. Un ingreso correcto reinicia la cuenta. Los fallos quedan registrados aunque la respuesta sea un error, y el bloqueo deja una fila de auditoría.
37. **Sesión atada al equipo.** Cada petición de una sesión PIN debe traer el `X-Equipo` del mismo equipo; sin él, con el de otro equipo (aunque sea válido) o con el de un equipo desvinculado, responde 401 `NO_AUTENTICADO`.
38. **Cambio rápido de usuario.** Dada una sesión PIN abierta en un equipo, cuando otra persona (o la misma) ingresa con PIN en ese equipo, entonces la sesión anterior queda cerrada y su token responde 401 `NO_AUTENTICADO`. Un equipo tiene como máximo una sesión PIN abierta. `DELETE /sesion` cierra la sesión y el equipo sigue vinculado.
39. **Inactividad.** Una sesión PIN vale mientras no pasen los minutos de inactividad de su sucursal (por defecto 5) desde su última actividad, ni 12 horas desde que se creó; después, la siguiente petición responde 401 `SESION_EXPIRADA` y la sesión queda cerrada. `X-Actividad: segundo-plano` valida sin renovar (criterio 14).
40. **Configurar la inactividad.** `GET /sucursales/:id/acceso` y `PATCH /sucursales/:id/acceso` con `{ minutosInactividad }` (entero de 1 a 120), solo Administrador. El valor nuevo se aplica desde la siguiente petición de las sesiones PIN abiertas en esa sucursal y el cambio se audita. Una sucursal de B responde 404.
41. **Límites de la sesión PIN.** Una sesión PIN no puede cambiar de sucursal (criterio 17), ni vincular equipos (criterio 27), ni cambiar contraseña (criterio 16): 403 `PROHIBIDO`.
42. **Sesión actual.** `GET /sesion` devuelve `{ tipo, usuario, superadministrador, rol, esAdministrador, sucursal, sucursales, equipo, permisos, modulos, avisoSuscripcion, debeCambiarContrasena, expiraPorInactividadEn }` según `sesionRespuestaSchema`. `permisos` es el requisito de cada acción para el rol en la sucursal activa (criterio 43); `sucursales`, las que puede elegir (solo en sesiones de contraseña y de soporte).

### Clave de supervisor (HU-03, RF-12, ruta crítica)

43. **Matriz de permisos.** `requisitoPermiso(rol, accion)` de `packages/dominio` devuelve `permitido`, `clave` o `prohibido` exactamente como la tabla "Roles y permisos" del documento de diseño, celda por celda (tabla en "Reglas de negocio"); `alcanceReportes(rol)` devuelve `TURNO` (Cajero), `SUCURSAL` (Supervisor), `EMPRESA` (Administrador) o `null`. Prueba unitaria por cada celda.
44. **Autorizar.** Dada una sesión de un Cajero en S, cuando llama `POST /autorizaciones` con `{ accion, motivo, pin }`, donde la acción exige clave para su rol y el PIN es de un usuario activo, distinto del solicitante, cuyo rol en S tiene esa acción como `permitido` (Supervisor o Administrador), entonces responde 201 `{ autorizacionId, accion, autorizadoPor: { id, nombre }, expiraEn }`, con `expiraEn` = ahora + 2 minutos, y queda una fila de auditoría `autorizacion_otorgada` con quién pidió, quién autorizó, el motivo, la acción, la sucursal, el equipo y la hora.
45. **PIN rechazado.** Un PIN inexistente, de un usuario sin rol autorizador en S (Mozo, Cajero, Cocina/Barra, o Supervisor de otra sucursal), inactivo, de B, o del propio solicitante, responde 403 `CLAVE_INVALIDA` con el mismo cuerpo, no crea autorización, cuenta un fallo y deja una fila de auditoría `autorizacion_rechazada` (solicitante, acción, motivo, sin el PIN), que queda guardada aunque la respuesta sea un error.
46. **Validaciones previas (no cuentan fallo).** Acción desconocida, motivo vacío o solo con espacios, de más de 300 caracteres, con NUL o con sustitutos sueltos: 400 `DATOS_INVALIDOS`. Acción `prohibido` para el rol del solicitante: 403 `PROHIBIDO`. Acción `permitido` para su rol: 409 `CLAVE_INNECESARIA`. Sesión sin sucursal activa: 409 `SUCURSAL_NO_ELEGIDA`.
47. **Bloqueo.** Dados 5 fallos seguidos del mismo solicitante (en cualquier equipo), o 5 fallos seguidos en el mismo equipo (de cualquier solicitante), cuando se intenta otra autorización durante los 5 minutos siguientes, entonces responde 429 `BLOQUEO_TEMPORAL` sin evaluar el PIN, y el bloqueo deja una fila de auditoría. Una autorización correcta reinicia ambas cuentas.
48. **Consumo en la acción.** Dada una ruta marcada `@Permiso(accion)`: si la acción es `prohibido` para el rol, 403 `PROHIBIDO`; si es `permitido`, se ejecuta sin autorización; si es `clave` y la petición no trae `X-Autorizacion`, 403 `CLAVE_REQUERIDA`; si trae una autorización válida, se ejecuta, la autorización queda usada en la misma transacción y queda una fila de auditoría de la acción con quién pidió, quién autorizó, el motivo, la hora y el `autorizacionId`. (Se prueba con un controlador sonda; las acciones reales llegan con sus historias.)
49. **Autorización inválida.** Una autorización ya usada, vencida (ahora ≥ `expiraEn`), de otra acción, creada por otra sesión (también del mismo usuario en otro equipo), de otra sucursal, de B o inexistente responde 403 `AUTORIZACION_INVALIDA` con el mismo cuerpo, y la acción no se ejecuta.
50. **Atomicidad y concurrencia.** Si la acción falla después de consumir la autorización, se revierten el consumo y la fila de auditoría de la acción, y la autorización sigue disponible hasta que venza. Dos peticiones concurrentes con la misma autorización: exactamente una se ejecuta y la otra responde 403 `AUTORIZACION_INVALIDA`.
51. **Cambio de usuario.** Al cerrarse una sesión (cambio rápido de usuario, salida, inactividad), sus autorizaciones sin usar ya no sirven (criterio 49).
52. **Soporte.** Una sesión de soporte tiene permisos de Administrador: las acciones protegidas son `permitido` y `POST /autorizaciones` responde 409 `CLAVE_INNECESARIA`.
53. **El PIN no se guarda.** Ni el PIN del supervisor ni su huella aparecen en respuestas, filas de auditoría, autorizaciones ni registros de la API.

### Auditoría (RF-13, RNF-09, ruta crítica)

54. **Inmutable.** Dada la tabla `auditoria`, cuando `restaurante_api`, `restaurante_plataforma` o `restaurante_migrador` intentan `UPDATE`, `DELETE` o `TRUNCATE`, entonces cada intento falla y las filas no cambian.
55. **Aislada.** Con el contexto de A, `restaurante_api` solo ve filas de A; las filas sin empresa (operaciones solo de plataforma, como crear un plan o el ingreso de un superadministrador) no las ve nunca; `restaurante_api` no puede insertar filas de B ni sin empresa. `restaurante_plataforma` ve todas.
56. **Unión con `auditoria_plataforma`.** Dada una base con filas en `auditoria_plataforma` (de la historia 001), cuando se aplica la migración, entonces cada fila queda en `auditoria` con `origen = 'plataforma'`, `accion` = su `operacion`, `actor_sistema` = su `actor`, y el mismo `motivo`, `empresa_id`, `detalle` y `ocurrido_en`; `auditoria_plataforma` deja de existir; y los criterios 32, 32b, 33, 34, 35, 36, 40b, 40c y el inciso de plataforma de 38e de la historia 001 se cumplen sobre `auditoria` (filas con `origen = 'plataforma'`). Revertir la migración devuelve las filas de origen plataforma a `auditoria_plataforma`.
57. **Actor.** Cada fila tiene exactamente uno de `actor_usuario_id`, `actor_superadministrador_id` o `actor_sistema` (restricción en la base). Las operaciones de plataforma por HTTP llevan el id del superadministrador; la semilla y los scripts, `actor_sistema` (`semilla`, `cli:<script>`); las acciones hechas en una sesión de soporte, el id del superadministrador y el `sesion_id` de soporte.
58. **Eventos auditados.** Los de la tabla "Eventos auditados en esta sección" dejan exactamente una fila cada uno, en la misma transacción que el cambio (no hay cambio sin fila ni fila sin cambio). Los rechazos y bloqueos (criterios 12, 36, 45 y 47) se guardan en su propia transacción, aunque la petición responda un error.
59. **Sin secretos.** Dados secretos conocidos usados en las pruebas (contraseñas, PIN, tokens de sesión y de equipo), cuando se buscan en el texto de todas las filas de `auditoria`, entonces no aparecen, ni sus huellas o hashes.
60. **Hora.** `ocurrido_en` es la hora del reloj de la API en el momento de la acción.

### Superadministrador, plataforma por HTTP y soporte (RF-01, RF-07, ruta crítica)

61. **Superadministradores.** Solo se crean y se desactivan con `pnpm plataforma:superadmin` (funciones `crearSuperadministrador` y `desactivarSuperadministrador`), con auditoría `actor_sistema = 'cli:superadmin'`; desactivar cierra sus sesiones y sus sesiones de soporte abiertas en cualquier empresa; su nombre de usuario es único entre los superadministradores, independiente de los usuarios de empresa. `POST /plataforma/sesiones` con `{ usuario, contrasena }` correctos responde 201 `{ token, superadministrador: { id, nombre } }`; con datos incorrectos, de uno inactivo o inexistente, 401 `CREDENCIALES_INVALIDAS` idéntico; 5 fallos seguidos lo bloquean 15 minutos (429 `BLOQUEO_TEMPORAL`). La sesión vale 8 horas desde que se crea; `DELETE /plataforma/sesion` la cierra. Ingresos (correctos y fallidos), salidas y bloqueos se auditan sin empresa; los fallos y el bloqueo quedan guardados aunque la respuesta sea un error.
62. **Rutas de plataforma.** Toda ruta `/plataforma/*` salvo `POST /plataforma/sesiones` exige una sesión de superadministrador válida: sin ella, con un token de empresa (incluido uno de soporte) o con uno de equipo, responde 401 `NO_AUTENTICADO` y no se ejecuta. Un token `sa.…` en una ruta de empresa también responde 401 (criterio 1). Al desactivar un superadministrador, sus sesiones y sus sesiones de soporte dejan de valer.
63. **Alta de empresa por HTTP.** `POST /plataforma/empresas` con los datos del alta de 001, más `suscripcion` opcional por sucursal (`{ planId?, vencimiento? }`), `administrador` (`{ nombre, nombreUsuario, contrasenaTemporal }`) y `motivo`, responde 201 `{ empresaId, emisores, sucursales (con su suscripción), administrador: { id, pin } }`. Todo o nada: con cualquier error no queda nada creado ni auditado. Errores: los del criterio 34 de 001; nombre de usuario no disponible, 409 `CONFLICTO`; plan inexistente o inactivo, 422 `PLAN_INVALIDO`; vencimiento anterior a hoy, 400. Auditoría `registrar_empresa` con el id del superadministrador.
64. **Emisores y sucursales.** `POST /plataforma/empresas/:id/emisores` y `POST /plataforma/empresas/:id/sucursales` (con `suscripcion` opcional) y `motivo`: como `agregarEmisor` y `agregarSucursal` de 001, ahora por HTTP y con suscripción; empresa inexistente, 404.
65. **Consulta.** `GET /plataforma/empresas` lista las empresas con sus sucursales y el estado de cada suscripción; `GET /plataforma/empresas/:id` devuelve emisores, sucursales, suscripciones y administradores (nombre, nombre de usuario, activo).
66. **Soporte.** `POST /plataforma/empresas/:id/soporte` con `{ motivo, sucursalId? }` responde 201 `{ token, sesion }` con una sesión `SOPORTE` de esa empresa: permisos de Administrador en todas sus sucursales, inactividad de 30 minutos y duración máxima de 2 horas. En la misma transacción queda la fila `inicio_soporte` (origen plataforma, con `empresa_id`, así el Administrador de la empresa la puede ver). Toda acción hecha con esa sesión se audita con el id del superadministrador y el `sesion_id` (criterio 57). `DELETE /sesion` la cierra y audita `fin_soporte`.
67. **Soporte aislado.** El token de soporte de A, adulterado con la empresa B, responde 401; una empresa inexistente responde 404; un motivo vacío, 400 sin crear nada.
68. **Sin mezcla de credenciales.** Una sesión de soporte no sirve en `/plataforma/*`, no puede crear sesiones PIN ni autorizaciones (criterio 52) y no cuenta como usuario de la empresa.

### Suscripción, planes, módulos y cuota (HU-01, RF-03 a RF-05)

69. **La sucursal nace con suscripción.** Dada un alta de empresa o de sucursal por la vía de plataforma (HTTP, semilla o servicio), cuando se crea cada sucursal, entonces queda con exactamente una suscripción, en el plan indicado o en el plan por defecto, con el vencimiento indicado o, si no se indica, `sumarMeses(hoy, 1)` (hoy en Lima), y su estado es `ACTIVA`.
70. **Sucursal creada por el Administrador.** `POST /sucursales` crea la sucursal (como `agregarSucursal` de 001) con suscripción en el plan por defecto y vencimiento = hoy (supuesto, pregunta 10); se audita. `POST /emisores` crea el emisor como `agregarEmisor`. Ambas solo para Administrador (criterio 9).
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
82. **No corta nada más.** Con la sucursal `SUSPENDIDA`, el ingreso con contraseña y con PIN, `GET /sesion`, las consultas, la configuración, los usuarios y los equipos siguen funcionando.
83. **Reactivación.** Un pago con `vencimientoNuevo` ≥ hoy deja la sucursal `ACTIVA` desde la siguiente petición, y `exigirAperturaDeCaja` deja de lanzar.
84. **Turno abierto.** La suspensión solo se comprueba al abrir caja: ninguna otra operación consulta el estado de la suscripción. Un turno abierto antes de la suspensión sigue hasta su cierre (lo verificará la historia de caja).

### Idempotencia (RNF-10)

85. **Repetición.** En las rutas que la aceptan (`POST /plataforma/suscripciones/:id/pagos`, `POST /autorizaciones`, `POST /emisores`, `POST /sucursales`, `POST /plataforma/empresas/:id/emisores`, `POST /plataforma/empresas/:id/sucursales`), una petición con `Idempotency-Key` (UUID) igual y el mismo cuerpo que una anterior con respuesta 2xx devuelve el mismo estado y cuerpo sin repetir el efecto (un solo pago, una sola autorización, una sola fila de auditoría). Las respuestas de error no se guardan.
86. **Reutilización.** La misma clave con otro cuerpo, otra ruta u otro usuario responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Las claves de A y de B no se mezclan: la misma clave usada en B ejecuta normalmente y nunca devuelve una respuesta de A.
87. **Rutas con secretos.** Las rutas cuya respuesta contiene un secreto (`POST /usuarios`, `POST /usuarios/:id/pin`, `POST /equipos`, `POST /plataforma/empresas`, ingresos) no guardan respuestas; las protege la unicidad natural (nombre de usuario, RUC) o crean una credencial nueva en cada llamada.

### Catálogo y aislamiento de las tablas nuevas (ruta crítica)

88. **Convención.** El criterio 38 de la historia 001 se cumple con todas las tablas nuevas de `public` (RLS forzada, política `aislamiento_empresa` en las que tienen `empresa_id`, llaves foráneas compuestas, sin `TRUNCATE`), con estos ajustes: `plan` (sin `empresa_id`) tiene una política de solo lectura para `restaurante_api`; `superadministrador`, `sesion_superadministrador` e `idempotencia_plataforma` no dan ningún privilegio a `restaurante_api`; `auditoria` reemplaza a `auditoria_plataforma` en la lista del criterio 38 con los privilegios de la tabla de "Permisos".
89. **Búsqueda del usuario al ingresar.** La relación nombre de usuario → empresa vive fuera de `public`, en el esquema `autenticacion` (dueño `restaurante_migrador`, sin `USAGE` para los roles de la aplicación ni `PUBLIC`). `public.empresa_de_usuario(text)` es `SECURITY DEFINER`, con `search_path` fijo y `EXECUTE` solo para `restaurante_api`; devuelve la empresa solo para un nombre exacto (sin distinguir mayúsculas) de un usuario existente y `NULL` en otro caso; `%`, `_` y textos parecidos no coinciden con nada.
90. **Unicidad global.** Con el contexto de A, insertar o renombrar un usuario con un nombre ya usado en B falla con unicidad (409 por la API) y no revela nada más de B. Renombrar o desactivar actualiza la relación del criterio 89 en la misma transacción.
91. **Prueba de aislamiento por tabla.** Para cada tabla nueva con `empresa_id` (`usuario`, `acceso_sucursal`, `equipo`, `sesion`, `autorizacion`, `bloqueo_intentos`, `sucursal_acceso`, `suscripcion`, `pago_suscripcion`, `consumo_comprobantes`, `idempotencia`, `auditoria`), con el contexto de A: no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, y no se insertan filas con `empresa_id` de B (como los criterios 11 a 16 de 001).

### Interfaz (PWA, no crítica)

92. **Arranque.** Al abrir la PWA, si hay token de equipo guardado, consulta `GET /equipo`: si es válido muestra la pantalla de PIN; si responde `EQUIPO_NO_VINCULADO`, borra el token y muestra el ingreso con usuario y contraseña. Sin token de equipo, muestra el ingreso con usuario y contraseña.
93. **Ingreso con usuario y contraseña.** Muestra errores de credenciales y de bloqueo (con los minutos que faltan), pide el cambio de contraseña si `debeCambiarContrasena`, y pide elegir sucursal si hay varias.
94. **Pantalla de PIN.** Teclado numérico táctil grande, el nombre de la sucursal y del equipo, dígitos ocultos, envío al completar los 4 dígitos, mensaje de error y cuenta regresiva del bloqueo, y un enlace "Ingresar con usuario y contraseña".
95. **Barra de la sesión.** Muestra usuario, rol y sucursal; "Cambiar usuario" cierra la sesión y vuelve a la pantalla de PIN; en sesiones de contraseña permite cambiar de sucursal y salir.
96. **Inactividad.** Sin interacción durante los minutos de la sesión (`expiraPorInactividadEn`), la PWA cierra la sesión y vuelve a la pantalla de PIN (o al ingreso). Un 401 `SESION_EXPIRADA` o `NO_AUTENTICADO` hace lo mismo. Las consultas automáticas mandan `X-Actividad: segundo-plano`.
97. **Vincular este equipo.** Un Administrador con sesión de contraseña elige sucursal y nombre; la PWA guarda el token de equipo y, al salir, muestra la pantalla de PIN.
98. **Ventana de clave de supervisor.** Componente reutilizable que pide PIN y motivo, llama `POST /autorizaciones` y devuelve el `autorizacionId` a quien lo abrió; muestra `CLAVE_INVALIDA`, el bloqueo y la validación del motivo; no guarda el PIN.
99. **Aviso de suscripción.** Un Administrador ve un aviso persistente en gracia (días que quedan y fecha de suspensión) y otro cuando la sucursal está suspendida.
100. **Administración.** Pantallas de Usuarios (lista, alta con accesos, PIN mostrado una vez, edición, desactivar, regenerar PIN, restablecer contraseña), Equipos (lista y desvincular con confirmación) y Acceso de la sucursal (minutos de inactividad). Un rol sin permiso no ve esas opciones.
101. **Panel del superadministrador.** Ingreso propio; empresas con el estado de suscripción de cada sucursal; alta de empresa (emisores, sucursales, plan, vencimiento y primer Administrador, con su PIN mostrado una vez); detalle con agregar emisor y sucursal, registrar pago (vencimiento nuevo sugerido con `sumarMeses(vencimiento, 1)`), cambiar plan y ajustar vencimiento; planes; y "Entrar a dar soporte".
102. **Modo soporte.** Con una sesión de soporte, la app muestra en todo momento quién da soporte y un botón para terminarlo, que vuelve al panel.
103. **Compatibilidad.** Las pantallas funcionan al tamaño de tablet y de celular, con controles táctiles, en Chrome para Android y Safari para iPhone y iPad recientes (RNF-11, RNF-13), en español y soles (RNF-14). Las pantallas de operación responden en menos de 1 segundo (RNF-03).
104. **Escrituras.** Toda escritura de la PWA usa el cliente de `lib/api.ts`, con `Idempotency-Key` donde la ruta la acepta y reintentos ante cortes de red (RNF-10).

## Eventos auditados en esta sección

| Acción (`accion`) | Origen | Actor | Cuándo |
| --- | --- | --- | --- |
| `registrar_empresa`, `agregar_emisor`, `agregar_sucursal` | plataforma | superadministrador o sistema | Alta por HTTP, semilla o script |
| `crear_plan`, `modificar_plan` | plataforma (sin empresa) | superadministrador | Criterio 75 |
| `registrar_pago`, `modificar_suscripcion` | plataforma | superadministrador | Criterios 73 y 74 |
| `crear_superadministrador` | plataforma (sin empresa) | sistema | Criterio 61 |
| `ingreso_superadministrador`, `ingreso_superadministrador_fallido`, `salida_superadministrador`, `bloqueo_superadministrador`, `desactivar_superadministrador` | plataforma (sin empresa) | superadministrador o sistema | Criterio 61 (toda escritura de plataforma se audita, por eso también los fallos) |
| `inicio_soporte` | plataforma (con la empresa) | superadministrador | Criterio 66 |
| `fin_soporte` | empresa | superadministrador (sesión de soporte) | Criterio 66 |
| `crear_emisor`, `crear_sucursal`, `configurar_sucursal`, `configurar_acceso_sucursal` | empresa | usuario o soporte | Criterios 9, 40 y 70 |
| `crear_usuario`, `modificar_usuario`, `regenerar_pin`, `restablecer_contrasena`, `quitar_contrasena` | empresa | usuario o soporte | Criterios 18 a 23 |
| `cambiar_contrasena` | empresa | el propio usuario | Criterio 16 |
| `vincular_equipo`, `desvincular_equipo` | empresa | usuario o soporte | Criterios 27 y 30 |
| `bloqueo_contrasena`, `bloqueo_pin_equipo`, `bloqueo_clave` | empresa | sistema (con el usuario o equipo afectado en el detalle) | Criterios 12, 36 y 47 |
| `autorizacion_otorgada`, `autorizacion_rechazada` | empresa | solicitante (y autorizador) | Criterios 44 y 45 |
| la acción protegida (por ejemplo `ANULAR_ITEM_ENVIADO`) | empresa | solicitante, con autorizador | Criterio 48 (historias futuras) |

No se auditan los ingresos y salidas normales del personal (supuesto, pregunta 18).

## Casos límite

- Un usuario de A y otro de B con el mismo PIN: cada uno entra solo en los equipos de su empresa (criterio 35).
- Un Administrador con varias sucursales que ingresa con contraseña queda sin sucursal activa hasta elegir; las rutas de empresa que no dependen de la sucursal (usuarios, equipos, emisores) funcionan igual.
- El mismo usuario con una sesión PIN en una tablet y otra de contraseña en su celular: son independientes; el cambio rápido en la tablet solo cierra la sesión de la tablet.
- Desvincular el equipo desde el que el Administrador está conectado con contraseña: su sesión de contraseña sigue (no es una sesión PIN).
- Un Supervisor que hace una acción protegida no necesita clave (criterio 46); si autoriza a un Cajero, el Cajero sigue siendo quien hizo la acción.
- Un PIN que coincide con un Mozo usado en la ventana de clave: responde lo mismo que un PIN inexistente (criterio 45), sin revelar que el PIN existe.
- Un nombre de usuario se puede reutilizar después de renombrar al usuario que lo tenía; un usuario desactivado conserva su nombre (no se libera).
- Una petición que llega justo en el minuto de inactividad: la sesión vale mientras ahora < última actividad + minutos; en el instante exacto ya expiró.
- Vencimiento con 0 días de gracia: pasa de `ACTIVA` a `SUSPENDIDA` al día siguiente del vencimiento, sin aviso de gracia.
- Pago registrado con la sucursal ya suspendida y un turno abierto: el turno sigue; la siguiente apertura de caja ya funciona.
- Cambio del plan por defecto: no cambia las suscripciones existentes, solo las que se creen después.
- Hora de Lima y fin de mes: el periodo de la cuota y el estado de la suscripción usan la fecha de Lima (Perú no tiene horario de verano), no la del servidor.
- Reloj del navegador desajustado: el cierre por inactividad de la PWA usa `expiraPorInactividadEn` del servidor como referencia; si el servidor dice que expiró, manda el servidor.
- iPhone o iPad que borran el almacenamiento de un sitio web no usado en días: se pierde el token del equipo y hay que vincularlo de nuevo (ver riesgos del plan).

## Reglas de negocio aplicables

Fuente: `fuentes.md`. Las marcadas **supuesto** están en "Preguntas abiertas".

- Seis roles: Mozo, Cajero, Cocina/Barra, Supervisor, Administrador y Superadministrador (de nuestra empresa) (Actores; Roles y permisos).
- Un usuario puede tener acceso a una o varias sucursales con un rol en cada una (RF-08; Roles y permisos). El Administrador es de toda la empresa (**supuesto**, pregunta 11).
- El personal entra con PIN solo desde equipos vinculados a la sucursal; en cualquier otro equipo, con usuario y contraseña (RF-09, HU-02, regla de Seguridad). Quién puede usar usuario y contraseña fuera de los equipos vinculados: **supuesto**, pregunta 1.
- Los equipos se vinculan y desvinculan desde la administración (RF-10); "Usuarios, sucursales, equipos y configuración" es del Administrador (Roles y permisos).
- Cambio rápido de usuario con PIN y cierre de sesión por inactividad (RF-11, RNF-08); en equipos compartidos la sesión se cierra sola tras un tiempo sin uso (Seguridad). Tiempos: **supuesto**, pregunta 15.
- "Clave" significa que la acción procede si un supervisor escribe su PIN en ese momento, y queda registrado quién autorizó (Roles y permisos). Se registran quién pidió, quién autorizó, el motivo y la hora (RF-12, HU-03, Seguridad).
- Matriz de permisos (documento de diseño, "Roles y permisos"); códigos de acción de `packages/dominio`:

| Acción (código) | Mozo | Cajero | Cocina/Barra | Supervisor | Administrador |
| --- | --- | --- | --- | --- | --- |
| `ATENDER_MESA` (abrir mesa, comandar, adiciones y pre-cuenta) | permitido | permitido | prohibido | permitido | permitido |
| `MOVER_UNIR_MESAS` | permitido | permitido | prohibido | permitido | permitido |
| `ANULAR_ITEM_ENVIADO` | clave | clave | prohibido | permitido | permitido |
| `APLICAR_DESCUENTO` | clave | clave | prohibido | permitido | permitido |
| `APLICAR_CORTESIA` | clave | clave | prohibido | permitido | permitido |
| `ANULAR_ORDEN` (RF-35; **supuesto**, pregunta 17) | clave | clave | prohibido | permitido | permitido |
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

- Pueden autorizar con su PIN quienes tienen la acción como `permitido` en esa sucursal: Supervisor y Administrador (derivado de la matriz; incluir al Administrador es **supuesto**, pregunta 16).
- Toda acción con clave queda en la auditoría (Seguridad, RNF-09); se auditan las anulaciones, descuentos, cortesías, notas de crédito, ajustes de stock y cambios de configuración (RF-13). La auditoría no se puede modificar (RNF-09).
- El superadministrador gestiona empresas, sucursales y suscripciones, y puede entrar a la cuenta de un cliente para darle soporte, siempre con registro en la auditoría (RF-07; Roles y permisos). Alcance del soporte: **supuesto**, pregunta 19.
- Contraseñas y PIN guardados con hash (RNF-07). Sin servicios externos de pago (RNF-18): sin correos ni SMS para recuperar contraseñas.
- Suscripción mensual por sucursal con usuarios y dispositivos ilimitados (Modelo comercial). La sucursal nace con suscripción activa y fecha de vencimiento (HU-01). Estados: activa, en gracia o suspendida; pagos registrados a mano (RF-03; cobro manual en el MVP).
- Cada plan activa módulos; al inicio habrá un solo plan; preparado para planes premium (RF-04; Modelo comercial). Catálogo de módulos: **supuesto**, pregunta 20.
- Cada plan incluye una cuota de comprobantes al mes; al superarla la emisión nunca se bloquea y el excedente se registra (RF-05; Modelo comercial). Valores: pendientes (pregunta 3).
- Vencida la suscripción, primero hay unos días de gracia con avisos al administrador; luego la suspensión, que se aplica en la siguiente apertura de caja y nunca corta un turno abierto; suspendida, la sucursal puede consultar y exportar sus datos (RF-06, HU-04, Modelo comercial). Días de gracia: **supuesto**, pregunta 2.
- Los datos de una empresa nunca se comparten con otra (RNF-06).

## Contrato

### Cabeceras

| Cabecera | Uso |
| --- | --- |
| `Authorization: Bearer <token>` | Sesión de empresa (`se.…`) o de superadministrador (`sa.…`) |
| `X-Equipo: <token>` | Token del equipo vinculado (`eq.…`); obligatorio en `POST /sesiones/pin`, `GET /equipo` y en toda petición de una sesión PIN |
| `X-Actividad: segundo-plano` | La petición no renueva la inactividad |
| `X-Autorizacion: <autorizacionId>` | Autorización de supervisor para una ruta `@Permiso` |
| `Idempotency-Key: <uuid>` | Rutas del criterio 85 |

Formato de los tokens: tres o cuatro partes separadas por punto; los ids son UUID en minúsculas y el secreto, 32 bytes aleatorios en base64url (43 caracteres). `se.<empresaId>.<sesionId>.<secreto>`, `eq.<empresaId>.<equipoId>.<secreto>`, `sa.<sesionId>.<secreto>`.

### Endpoints

| Método y ruta | Acceso | Entrada | Respuestas |
| --- | --- | --- | --- |
| `POST /sesiones/contrasena` | pública | `ingresoContrasenaEntrada` | 201 `ingresoRespuesta`; 400; 401 `CREDENCIALES_INVALIDAS`; 429 `BLOQUEO_TEMPORAL` |
| `POST /sesiones/pin` | pública + `X-Equipo` | `ingresoPinEntrada` | 201 `ingresoRespuesta`; 400; 401 `EQUIPO_NO_VINCULADO` / `CREDENCIALES_INVALIDAS`; 429 |
| `GET /sesion` | sesión | — | 200 `sesionRespuesta` |
| `PUT /sesion/sucursal` | sesión de contraseña o soporte | `{ sucursalId }` | 200 `sesionRespuesta`; 403; 404 |
| `PUT /sesion/contrasena` | sesión de contraseña | `{ actual, nueva }` | 204; 400; 401; 403; 429 |
| `DELETE /sesion` | sesión | — | 204 |
| `GET /equipo` | pública + `X-Equipo` | — | 200 `equipoActualRespuesta`; 401 `EQUIPO_NO_VINCULADO` |
| `GET /equipos` | Administrador | — | 200 `equipoRespuesta[]` |
| `POST /equipos` | Administrador, sesión de contraseña o soporte | `{ sucursalId, nombre }` | 201 `{ equipo, tokenEquipo }`; 403; 422 `SUCURSAL_INVALIDA` |
| `DELETE /equipos/:id` | Administrador | — | 204; 404 |
| `GET /usuarios`, `GET /usuarios/:id` | Administrador | — | 200 `usuarioRespuesta[]` / `usuarioRespuesta`; 404 |
| `POST /usuarios` | Administrador | `usuarioCrearEntrada` | 201 `usuarioRespuesta & { pin }`; 400; 409; 422 |
| `PATCH /usuarios/:id` | Administrador | `usuarioModificarEntrada` | 200; 400; 404; 409 `ULTIMO_ADMINISTRADOR` / `CONFLICTO`; 422 |
| `POST /usuarios/:id/pin` | Administrador | — | 200 `{ pin }`; 404 |
| `POST /usuarios/:id/contrasena` | Administrador | `{ contrasenaTemporal: string \| null }` | 204; 400; 404 |
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

`CREDENCIALES_INVALIDAS` (401), `SESION_EXPIRADA` (401), `EQUIPO_NO_VINCULADO` (401), `BLOQUEO_TEMPORAL` (429, con `reintentarEnSegundos` y cabecera `Retry-After`), `CAMBIO_CONTRASENA_REQUERIDO` (403), `CLAVE_INVALIDA` (403), `CLAVE_REQUERIDA` (403), `AUTORIZACION_INVALIDA` (403), `CLAVE_INNECESARIA` (409), `SUCURSAL_NO_ELEGIDA` (409), `SUCURSAL_INVALIDA` (422), `SUCURSAL_SUSPENDIDA` (403), `MODULO_NO_INCLUIDO` (403), `ULTIMO_ADMINISTRADOR` (409), `PLAN_INVALIDO` (422), `CLAVE_IDEMPOTENCIA_REUTILIZADA` (422). Se mantienen los de 001.

### Paquetes compartidos

- `packages/dominio`:
  - `ROLES` (`MOZO`, `CAJERO`, `COCINA_BARRA`, `SUPERVISOR`, `ADMINISTRADOR`), `ACCIONES` (códigos de la matriz), `requisitoPermiso(rol, accion): 'permitido' | 'clave' | 'prohibido'`, `puedeAutorizar(rol, accion): boolean`, `alcanceReportes(rol)`, `permisosDeRol(rol)`.
  - `estadoSuscripcion({ vencimiento, diasGracia }, instante)`, `sumarMeses(fecha, n)`, `fechaLima(instante)`, `periodoLima(instante)` (`AAAA-MM`).
  - `MODULOS` (catálogo, pregunta 20).
- `packages/contratos` (zod): `nombreUsuarioSchema`, `contrasenaSchema`, `pinSchema` (`^\d{4}$`), `rolSchema`, `accionSchema`, `moduloSchema`, `fechaSchema` (`AAAA-MM-DD` válida), `montoSchema` (`^\d{1,8}(\.\d{1,2})?$`, mayor que 0), `motivoSchema` (1 a 300, sin NUL ni sustitutos sueltos); entradas y respuestas de la tabla de endpoints (`ingresoContrasenaEntrada`, `ingresoPinEntrada`, `ingresoRespuesta`, `sesionRespuesta`, `usuarioCrearEntrada`, `usuarioModificarEntrada`, `usuarioRespuesta`, `equipoRespuesta`, `equipoActualRespuesta`, `autorizacionEntrada`, `autorizacionRespuesta`, `planEntrada`, `planRespuesta`, `suscripcionRespuesta`, `suscripcionResumen`, `pagoEntrada`, `altaEmpresaEntrada`, `altaEmpresaRespuesta`, `emisorRespuesta`). `sucursalEntradaSchema` gana `suscripcion` opcional (`{ planId?, vencimiento? }`), sin romper a quien no lo envía. Las entradas son estrictas (un campo desconocido es 400).

### Interfaces de la API (contratos públicos para las pruebas)

- `crearAplicacion({ controladoresExtra?, logger?, reloj? })`: `reloj` reemplaza al proveedor `RELOJ` (`interface Reloj { ahora(): Date }`, en `apps/api/src/nucleo/reloj/`).
- Decoradores (`apps/api/src/modulos/seguridad/`): `@Publica()`, `@Permiso(accion)`, `@SoloAdministrador()`, `@RequiereModulo(modulo)`, `@RequiereSucursal()`, `@Idempotente()`. Las rutas de plataforma usan `@Superadministrador()` (en `apps/api/src/modulos/plataforma/`).
- `SesionActual.principal(): Principal` (dentro de una petición): `{ tipo: 'CONTRASENA' | 'PIN' | 'SOPORTE' | 'PRUEBA', empresaId, sesionId, usuarioId, superadministradorId, sucursalId, rol, esAdministrador, equipoId }`.
- `AutorizacionService.consumir({ autorizacionId, accion, entidad?, entidadId?, detalle? })`: dentro del contexto de la acción; devuelve `{ solicitanteId, autorizadorId, motivo }` o lanza 403 `AUTORIZACION_INVALIDA`. `@Permiso` la llama solo.
- `AuditoriaService.registrar(entrada)` (contexto de empresa) e `insertarAuditoriaPlataforma(transaccion, entrada)` (para `OperacionPlataforma`).
- `SuscripcionService.exigirAperturaDeCaja(sucursalId)`, `SuscripcionService.registrarComprobanteEmitido(sucursalId, instante)`, `SuscripcionService.estadoDeSucursal(sucursalId)`.
- `PlataformaEmpresasService.registrarEmpresa(datos, auditoria)`, `agregarEmisor`, `agregarSucursal`: como en 001, con `suscripcion` opcional por sucursal y `administrador` opcional en el alta; `auditoria.actor` acepta un texto (actor de sistema, como hoy) o `{ superadministradorId }`.
- `crearSuperadministrador({ usuario, nombre, contrasena })` y `desactivarSuperadministrador({ usuario })` en `apps/api/scripts/lib/superadministrador.ts`.

### Funciones de la base de datos (contratos para las pruebas a nivel SQL)

- `public.empresa_de_usuario(p_usuario text) RETURNS uuid` (criterio 89).
- Las de 001 sin cambios (`fijar_contexto_empresa`, `empresa_actual`).

### Variables de entorno nuevas

| Variable | Uso |
| --- | --- |
| `PIN_PEPPER` | Secreto para la huella de los PIN (32 bytes o más, en base64). Obligatoria salvo con `NODE_ENV` `development` o `test`, donde hay un valor por defecto (como `DB_PASSWORD_*`, criterio 29b de 001). Cambiarla invalida todos los PIN |
| `ORIGENES_PERMITIDOS` | Orígenes de la PWA para CORS, separados por coma. Obligatoria en producción |
| `EMPRESA_POR_HEADER` | Ahora solo vale con `NODE_ENV=test` (criterio 7) |
| `VITE_API_URL` | (PWA) URL base de la API |

### Eventos en tiempo real

- Ninguno. El cierre de sesiones (desvincular, desactivar) se nota en la siguiente petición.

### Permisos

- Los de la tabla de endpoints y la matriz de "Reglas de negocio". Sesión de soporte = Administrador en todas las sucursales de la empresa. Principal de prueba (criterio 7) = Administrador.
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
| `equipo`, `sucursal_acceso`, `bloqueo_intentos` | SELECT, INSERT, UPDATE (y DELETE en `bloqueo_intentos`) | ninguno |
| `sesion` | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `autorizacion` | SELECT, INSERT, UPDATE | ninguno |
| `idempotencia` | SELECT, INSERT, DELETE | ninguno |
| `idempotencia_plataforma` | ninguno | SELECT, INSERT, DELETE |
| `auditoria` | SELECT, INSERT (su empresa) | SELECT, INSERT |
| esquema `autenticacion` | ninguno, ni `USAGE` | ninguno, ni `USAGE` |

| Función | `restaurante_api` | `restaurante_plataforma` |
| --- | --- | --- |
| `empresa_de_usuario(text)` | `EXECUTE` | ninguno |

## Cambios al modelo de datos

Todas las tablas con `id uuid` (`gen_random_uuid()`), `creado_en` y, si se modifican, `actualizado_en`. Las de empresa siguen la convención de 001 (RLS forzada, `aislamiento_empresa`, llaves compuestas con `empresa_id`, índice por `empresa_id`, sin `TRUNCATE`).

- **`superadministrador`** (plataforma): `usuario` (único, minúsculas), `nombre`, `hash_contrasena`, `activo`, `fallos_seguidos`, `bloqueado_hasta`.
- **`sesion_superadministrador`** (plataforma): `superadministrador_id`, `huella_secreto` (`bytea` SHA-256), `expira_en`, `cerrada_en`.
- **`plan`** (global, sin `empresa_id`): `codigo` (único), `nombre`, `precio_mensual numeric(10,2) null`, `cuota_comprobantes_mes integer null` (≥ 0), `precio_excedente numeric(10,4) null`, `dias_gracia integer` (0 a 60), `modulos text[]`, `por_defecto boolean` (índice único parcial `WHERE por_defecto`), `activo`. Políticas: `acceso_plataforma` y `lectura_api` (`FOR SELECT TO restaurante_api USING (true)`). La migración inserta `BASE`.
- **`suscripcion`**: `empresa_id`, `sucursal_id` (única; FK compuesta a `sucursal`), `plan_id` (FK a `plan`), `vencimiento date`.
- **`pago_suscripcion`**: `empresa_id`, `suscripcion_id` (FK compuesta), `monto numeric(10,2)` (> 0), `fecha_pago date`, `medio` (`EFECTIVO`, `TRANSFERENCIA`, `YAPE`, `PLIN`, `TARJETA`, `OTRO`; **supuesto**), `referencia null`, `vencimiento_anterior`, `vencimiento_nuevo`, `registrado_por` (FK `superadministrador`). Inmutable (triggers como la auditoría).
- **`consumo_comprobantes`**: `empresa_id`, `sucursal_id`, `periodo char(7)`, `emitidos integer`; clave `(sucursal_id, periodo)`.
- **`usuario`**: `empresa_id`, `nombre` (1 a 100), `nombre_usuario` (minúsculas, `CHECK` del formato), `hash_contrasena null`, `contrasena_temporal boolean`, `huella_pin bytea null` (única con `empresa_id`), `es_administrador`, `activo`. Trigger `SECURITY DEFINER` que mantiene `autenticacion.nombre_usuario`.
- **`autenticacion.nombre_usuario`** (fuera de `public`): `nombre text PRIMARY KEY`, `empresa_id`, `usuario_id`. Solo la tocan el trigger y `empresa_de_usuario`.
- **`acceso_sucursal`**: `empresa_id`, `usuario_id`, `sucursal_id`, `rol` (`MOZO`, `CAJERO`, `COCINA_BARRA`, `SUPERVISOR`); clave `(usuario_id, sucursal_id)`; FK compuestas.
- **`sucursal_acceso`**: `empresa_id`, `sucursal_id` (clave), `minutos_inactividad` (1 a 120, por defecto 5). Sin fila, vale 5.
- **`equipo`**: `empresa_id`, `sucursal_id`, `nombre` (1 a 60), `huella_secreto`, `vinculado_por` (usuario o superadministrador), `ultimo_uso_en`, `desvinculado_en null`, `desvinculado_por null`.
- **`sesion`**: `empresa_id`, `tipo` (`CONTRASENA`, `PIN`, `SOPORTE`), `usuario_id null`, `superadministrador_id null` (exactamente uno, según el tipo), `equipo_id null` (obligatorio en `PIN`), `sucursal_id null`, `huella_secreto`, `ultima_actividad_en`, `expira_en` (máximo absoluto), `minutos_inactividad` (30 en `CONTRASENA` y `SOPORTE`; en `PIN` se lee de la sucursal), `cerrada_en null`, `motivo_cierre null`. Índice único parcial `(equipo_id) WHERE tipo = 'PIN' AND cerrada_en IS NULL`.
- **`autorizacion`**: `empresa_id`, `sesion_id`, `solicitante_id`, `autorizador_id`, `sucursal_id`, `equipo_id null`, `accion`, `motivo`, `expira_en`, `usada_en null`.
- **`bloqueo_intentos`**: `empresa_id`, `ambito` (`CONTRASENA_USUARIO`, `PIN_EQUIPO`, `CLAVE_USUARIO`, `CLAVE_EQUIPO`), `objetivo_id`, `fallos_seguidos`, `ultimo_fallo_en`, `bloqueado_hasta null`; clave `(empresa_id, ambito, objetivo_id)`.
- **`idempotencia`** (empresa) e **`idempotencia_plataforma`**: `clave uuid`, `ruta`, `actor` (usuario, superadministrador o sesión), `huella_entrada`, `estado_http`, `respuesta jsonb`, `creado_en`; únicas `(empresa_id, clave)` y `(clave)`.
- **`auditoria`** (reemplaza a `auditoria_plataforma`): `empresa_id null`, `sucursal_id null` (FK compuesta), `ocurrido_en`, `origen` (`empresa`, `plataforma`), `accion`, `actor_usuario_id`, `actor_superadministrador_id`, `actor_sistema` (exactamente uno), `autorizado_por_id null`, `autorizacion_id null`, `sesion_id null`, `equipo_id null`, `motivo null`, `entidad null`, `entidad_id null`, `detalle jsonb`. Triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE`. Políticas `aislamiento_empresa` (api) y `acceso_plataforma`. Índices por `(empresa_id, ocurrido_en)`.
- **`auditoria_plataforma`**: se copia a `auditoria` y se elimina (criterio 56).

## Fuera de alcance

- Exportar los datos de una sucursal (CSV o Excel) y la pantalla de auditoría para el dueño: llegan con la épica de reportes (HU-36 y siguientes). En esta sección solo se garantiza que la suspensión no bloquea la lectura (criterio 82). Ver pregunta 8.
- Baja o cancelación de una empresa o sucursal, y la eliminación de datos tras el plazo del contrato (pregunta 4).
- Cobro automático de suscripciones, facturar el excedente y los precios definitivos (pendientes comerciales).
- Recuperar la contraseña por correo o SMS (RNF-18); la restablece el Administrador o el superadministrador en soporte.
- Doble factor para el superadministrador (riesgo anotado en el plan).
- Abrir caja, turnos y la emisión de comprobantes: aquí solo quedan los contratos `exigirAperturaDeCaja` y `registrarComprobanteEmitido`.
- Las acciones protegidas reales (anular, descontar, cortesía, nota de crédito): llegan con sus historias y usan `@Permiso`.
- Tiempo real (avisar a la tablet al instante cuando se desvincula o se desactiva un usuario).
- El puente de impresión Android y su autenticación (historia de impresión).
- Límite de peticiones por IP (lo cubre Cloudflare); aquí solo los bloqueos por cuenta, equipo y solicitante.

## Impacto en la especificación 001

Cambios de comportamiento que afectan pruebas protegidas de 001. No se edita `specs/001-*`; las pruebas las actualiza test-writer en la fase B de esta sección (tarea P10 de `tasks.md`), sin quitar ni debilitar aserciones:

- **Auditoría** (criterios 32, 32b, 33, 34, 35, 36, 38, 40b, 40c y el inciso de plataforma de 38e): las filas pasan de `auditoria_plataforma` a `auditoria` con `origen = 'plataforma'`; el criterio 38 cambia los privilegios esperados de `restaurante_api` sobre la tabla de auditoría (SELECT e INSERT bajo RLS).
- **Criterio 30:** en producción, sin sesión, el código pasa de `EMPRESA_NO_RESUELTA` a `NO_AUTENTICADO`.
- **Criterio 31:** el resolutor por cabecera deja de valer con `NODE_ENV=development` (la API no arranca con esa combinación, criterio 7).
- **Criterios 18, 23, 26, 39 y 40:** siguen valiendo en `NODE_ENV=test` con la cabecera y sin `Authorization` (principal de prueba, criterio 7).
- **Secuencia:** esta sección empieza su fase B cuando cierre la fase E de 001 (T45 a T47), porque ambas tocan las guardas, las pruebas protegidas y las migraciones.

## Notas para otras historias

- **Caja:** llamar `SuscripcionService.exigirAperturaDeCaja(sucursalId)` al abrir caja, y solo ahí (HU-04).
- **Facturación:** llamar `SuscripcionService.registrarComprobanteEmitido(sucursalId, instante)` en la misma transacción en la que se emite cada comprobante; el reporte de consumo de cuota (RF-82) lee `consumo_comprobantes` por el servicio.
- **Acciones protegidas** (anular ítem, descuento, cortesía, nota de crédito, anular orden): marcar la ruta con `@Permiso(ACCION)` y abrir la ventana de clave de la PWA cuando `permisos[ACCION] === 'clave'`.
- **Módulos:** las rutas de cada módulo se marcan con `@RequiereModulo`.
- **Reportes (HU-36):** la auditoría ya guarda solicitante, autorizador y motivo; filtrar por fecha, sucursal y usuario.
- **Impresión:** el puente Android necesitará su propia credencial de equipo; puede reutilizar el modelo `equipo` con otro tipo.
- **Tiempo real:** al llegar Socket.IO, autenticar la conexión con el mismo token y cerrar las salas al cerrar la sesión.

## Preguntas abiertas

Cada una trae una propuesta por defecto marcada como **supuesto**, que es lo que está especificado arriba; basta confirmar o corregir.

1. **RNF-08 frente a RF-09 y HU-02.** RNF-08 dice "acceso del personal solo desde equipos vinculados"; RF-09 y HU-02 permiten usuario y contraseña en cualquier otro equipo. **Supuesto:** vale RF-09: cualquier usuario con contraseña puede entrar desde cualquier equipo, y la contraseña es opcional para los roles distintos de Administrador (sin ella, la persona solo entra con PIN en los equipos vinculados). Se propone reescribir RNF-08 como "PIN solo en equipos vinculados; usuario y contraseña en los demás; cierre por inactividad".
2. **Días de gracia.** **Supuesto:** 7 días, guardados en el plan (0 a 60), editables por el superadministrador.
3. **Precio, cuota de comprobantes y costo del excedente por plan.** **Supuesto:** un solo plan `BASE` con esos tres valores sin definir (nulos) hasta que se fijen; con la cuota sin definir no hay excedente. El superadministrador los carga desde el panel cuando se definan.
4. **Conservación de datos tras la baja.** **Supuesto:** la baja y la eliminación quedan fuera de esta sección; los datos se conservan hasta que el contrato fije el plazo, y entonces se hará una historia propia.
5. **Vencimiento inicial en el alta.** **Supuesto:** lo indica el superadministrador; si no lo indica, es un mes calendario después del día del alta (con ajuste a fin de mes: 31 de enero → 28 o 29 de febrero). No puede ser anterior a hoy.
6. **Cómo un pago mueve el vencimiento.** **Supuesto:** el superadministrador indica el vencimiento nuevo; la pantalla sugiere el vencimiento actual más un mes (aunque ya esté vencido, para cobrar el periodo atrasado). Los pagos no se editan ni se borran; un error se corrige ajustando el vencimiento con motivo. Medios de pago: efectivo, transferencia, Yape, Plin, tarjeta u otro.
7. **Día del vencimiento.** **Supuesto:** fecha calendario de Lima; la suscripción está activa todo el día del vencimiento y la gracia cuenta días calendario desde el día siguiente.
8. **Qué impide la suspensión y la exportación.** **Supuesto:** solo impide abrir caja (literal de HU-04); el ingreso, la consulta y la configuración siguen. La exportación de datos llega con la épica de reportes; esta sección solo garantiza que la suspensión no bloquea la lectura.
9. **Quién ve los avisos.** **Supuesto:** solo el Administrador (y el soporte), durante la gracia y también estando suspendida; el cajero ve el error al intentar abrir caja.
10. **Suscripción de una sucursal creada por el Administrador.** **Supuesto:** nace en el plan por defecto con vencimiento el mismo día del alta, así que entra en gracia al día siguiente hasta que nuestro equipo registre el pago (aparece en la lista "en gracia" del panel). Alternativa: un mes como en el alta por plataforma.
11. **Administrador por sucursal o de empresa.** RF-08 da un rol por sucursal, pero el Administrador "ve todas las sucursales". **Supuesto:** el Administrador es de toda la empresa (incluidas las sucursales que se creen después); los otros cuatro roles son por sucursal. La empresa siempre conserva al menos un Administrador activo (criterio 22).
12. **Nombre de usuario.** **Supuesto:** único en todo el sistema (así el ingreso no pide la empresa), de 3 a 50 caracteres `a-z 0-9 . _ -`, sin distinguir mayúsculas. Consecuencia: al crear un usuario se puede saber que un nombre ya existe en otra empresa (como el RUC en 001).
13. **PIN.** HU-03 pide solo el PIN en la ventana del supervisor, así que el PIN tiene que identificar a la persona. **Supuesto:** 4 dígitos, generado por el sistema (no elegido, para que nadie descubra el PIN de otro al ver que "ya está en uso"), único dentro de la empresa, regenerable por el Administrador. En la tablet también basta el PIN, sin elegir el nombre. Alternativa más segura: 6 dígitos.
14. **Contraseñas.** **Supuesto:** 8 a 128 caracteres, sin otras reglas; la que pone el Administrador o el superadministrador es temporal y se cambia en el primer ingreso. Al cambiarla se cierran las otras sesiones del usuario.
15. **Tiempos de sesión.** **Supuesto:** PIN: inactividad configurable por sucursal, 5 minutos por defecto (1 a 120); contraseña: 30 minutos de inactividad; ambas, 12 horas como máximo. Superadministrador: 8 horas (la PWA lo cierra tras 30 minutos sin uso). Soporte: 30 minutos de inactividad y 2 horas como máximo.
16. **Quién autoriza con su PIN y cuánto dura la autorización.** **Supuesto:** Supervisor o Administrador con acceso a la sucursal activa, distinto de quien pide; vale para una sola acción, la de esa sesión, durante 2 minutos.
17. **Anular una orden abierta (RF-35).** No está en la tabla de roles. **Supuesto:** igual que anular un ítem enviado (Mozo y Cajero con clave; Supervisor y Administrador directo; Cocina/Barra no).
18. **Bloqueos e ingresos en la auditoría.** **Supuesto:** contraseña: 5 fallos seguidos bloquean al usuario 15 minutos; PIN: 5 fallos seguidos bloquean el equipo 5 minutos; clave de supervisor: 5 fallos seguidos bloquean al solicitante y al equipo 5 minutos; superadministrador: 5 fallos, 15 minutos. Se auditan los bloqueos y los rechazos de clave; los ingresos y salidas normales del personal no (sí los del superadministrador).
19. **Alcance del soporte.** **Supuesto:** el superadministrador entra con permisos de Administrador en todas las sucursales, con motivo obligatorio, por 2 horas como máximo; todo queda auditado a su nombre y visible para la empresa. No se pide consentimiento al cliente en cada entrada (lo cubre el contrato).
20. **Catálogo de módulos.** **Supuesto:** `SALON`, `COCINA`, `CAJA`, `FACTURACION`, `PEDIDOS_WEB`, `INVENTARIO` y `REPORTES`; el plan `BASE` los incluye todos; plataforma, usuarios y seguridad no son módulos (siempre están). El delivery completo sería un módulo premium futuro.
21. **Interfaz en esta sección.** **Supuesto:** se incluyen las pantallas de acceso, la administración de usuarios y equipos y un panel mínimo del superadministrador, todo en la PWA (`apps/app`), el panel bajo `/plataforma`.
22. **Primer Administrador en el alta.** **Supuesto:** el alta por HTTP crea también al primer Administrador de la empresa (nombre, nombre de usuario y contraseña temporal); su PIN se muestra una vez al superadministrador.
23. **Comprobantes que cuentan para la cuota.** **Supuesto:** todo comprobante electrónico emitido (boletas, facturas y notas de crédito), por fecha de emisión en hora de Lima y mes calendario.
24. **Vincular un equipo.** **Supuesto:** se vincula desde el propio equipo, con una sesión de contraseña de un Administrador, eligiendo sucursal y nombre (sin códigos de emparejamiento). Un equipo pertenece a una sola sucursal.
