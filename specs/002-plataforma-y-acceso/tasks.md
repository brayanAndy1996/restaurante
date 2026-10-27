# 002 · Tareas

Cada tarea indica su rol y los criterios de `spec.md` que cubre. La fase C se agrupa por historia: cada grupo termina con la suite en verde y un commit propio (lo hace el documentador), en el orden C0, C1, C2, C3, C4, porque cada uno usa lo anterior.

La fase B empieza cuando cierre la fase E de la historia 001 (T45 a T47 de `specs/001-base-multitenancy/tasks.md`): ambas tocan las guardas, las migraciones y pruebas protegidas.

## Fase A · Armado mínimo y firmas públicas (backend)

Deja lo necesario para que las pruebas protegidas compilen y corran. No implementa reglas de acceso ni de aislamiento, y no registra todavía el guard global (las pruebas de 001 deben seguir en verde al terminar la fase).

- [ ] T1 · backend · `packages/contratos`: esquemas y tipos de la sección "Contrato" (`sesiones.ts`, `usuarios.ts`, `equipos.ts`, `autorizaciones.ts`, `suscripciones.ts`, comunes nuevos, `suscripcion` opcional en `sucursalEntradaSchema`, `emisorRespuestaSchema`) y los códigos nuevos en `CODIGOS_ERROR`, con pruebas unitarias de los esquemas (formato de nombre de usuario, contraseña, PIN, monto, fecha, motivo, entradas estrictas). (criterios 13, 19, 20, 46, 73, 75; validación de datos)
- [ ] T2 · backend · `packages/dominio`: firmas de `permisos.ts` (`ROLES`, `ACCIONES`, `requisitoPermiso`, `puedeAutorizar`, `alcanceReportes`, `permisosDeRol`) que lanzan `Error('No implementado')`, y `MODULOS`. `suscripcion.ts` (`estadoSuscripcion`, `sumarMeses`, `fechaLima`, `periodoLima`) se implementa aquí con sus pruebas unitarias (no es ruta crítica). (criterios 43 firma; 71, 72)
- [ ] T3 · backend · Reloj: `src/nucleo/reloj/` (`RELOJ`, `RelojSistema`, `RelojManual` con `fijar` y `avanzar`) y la opción `reloj` de `crearAplicacion`. Infraestructura de pruebas, implementada completa. (habilita la fase B)
- [ ] T4 · backend · Entorno: aceptar `PIN_PEPPER` y `ORIGENES_PERMITIDOS` (con valor por defecto en `development` y `test`), y agregarlas a `fijarEntornoDePrueba`, `.env.example` y al workflow de CI. Sin cambiar todavía la regla de `EMPRESA_POR_HEADER` (criterio 7, fase C).
- [ ] T5 · backend · Firmas que lanzan `Error('No implementado')`, en las rutas de archivo de `plan.md`: módulos `seguridad` y `auditoria`; decoradores `@Publica`, `@SoloAdministrador`, `@RequiereSucursal`, `@Permiso`, `@RequiereModulo`, `@Idempotente`, `@Superadministrador` (solo metadatos); `AutenticacionGuard`, `SuperadministradorGuard`, `ResolutorEmpresaSesion`, `SesionActual`, `AutorizacionService.consumir`, `AuditoriaService`, `SuscripcionService` (`exigirAperturaDeCaja`, `registrarComprobanteEmitido`, `estadoDeSucursal`), `crearSuperadministrador` y `desactivarSuperadministrador`; y todos los controladores con sus rutas de la tabla de endpoints. `GET /health` marcado `@Publica()`. Sin lógica.

## Fase B · Pruebas primero (ruta crítica)

Las escribe test-writer a partir de `spec.md` y de los contratos públicos, sin mirar la implementación. Todos los archivos llevan al inicio `// spec: 002-plataforma-y-acceso (pruebas protegidas)` y viven en `apps/api/test/acceso/` (salvo la de `packages/dominio`). Usan la app real con `RelojManual`, el superadministrador creado con `crearSuperadministrador`, empresas creadas por `POST /plataforma/empresas` o `PlataformaEmpresasService` y usuarios creados por `POST /usuarios`; sin `EMPRESA_POR_HEADER`, salvo en las pruebas del criterio 7. Los nombres son sugeridos.

- [ ] P1 · test-writer · `sesion-rutas.spec.ts`: recorrido de todas las rutas registradas sin token, con token mal formado, cerrado, `sa.` y `eq.`; lista cerrada de rutas públicas; empresa tomada de la sesión aunque venga `x-empresa-id`; tokens adulterados (empresa, sesión, secreto) sin tocar la sesión de B; huellas en la base; 100 peticiones concurrentes con sesiones de A y B y pool de 2; cambio de rol, desactivación y pérdida de acceso aplicados en la siguiente petición; cabecera solo en `test` (arranque rechazado con `development`, modo prueba sin `Authorization`, ignorada con `Authorization`); producción sin sesión; regla de rol en emisores y sucursales. (criterios 1 a 9)
- [ ] P2 · test-writer · `ingreso-contrasena.spec.ts`: ingreso correcto y sucursal activa; fallos indistinguibles; bloqueo de 15 minutos con el reloj, guardado aunque responda error, aislado por usuario y empresa, auditado; formato de la contraseña en la base; inactividad de 30 minutos y máximo de 12 horas con y sin `X-Actividad: segundo-plano`; contraseña temporal; cambiar la propia contraseña (cierra las otras sesiones); `PUT /sesion/sucursal` y `DELETE /sesion`. (criterios 10 a 17)
- [ ] P3 · test-writer · `usuarios-permisos.spec.ts`: solo el Administrador usa `/usuarios` (cada otro rol, con contraseña y con PIN, recibe 403 y nada cambia); nombre de usuario ocupado en A o en B con la misma respuesta; sucursal de B en accesos igual que inexistente; PIN único en la empresa, regenerar invalida el anterior y cierra sesiones PIN; usuario de B igual que inexistente; respuestas sin hashes, huellas ni PIN. (criterios 19, 20, 21, 24, 25)
- [ ] P4 · test-writer · `equipos.spec.ts`: vincular (solo Administrador con sesión de contraseña o soporte; sucursal de B), `GET /equipo` con tokens válidos, adulterados y desvinculados, listar, desvincular (cierra sesiones PIN del equipo, repetible, equipo de B da 404), auditoría sin token. (criterios 27 a 32)
- [ ] P5 · test-writer · `pin.spec.ts`: ingreso con PIN en la sucursal del equipo; sin `X-Equipo` no se evalúa ni cuenta; PIN inexistente, inactivo, sin acceso o de B indistinguibles; bloqueo del equipo de 5 minutos sin afectar otros equipos ni la contraseña; sesión atada al equipo; cambio rápido de usuario; inactividad configurable por sucursal y aplicada desde la siguiente petición; límites de la sesión PIN; `GET /sesion`. (criterios 33 a 42)
- [ ] P6 · test-writer · `packages/dominio/test/permisos.spec.ts` (cada celda de la matriz, `puedeAutorizar` y `alcanceReportes`) y `clave-supervisor.spec.ts`: autorización correcta y su auditoría; PIN rechazado en cada caso del criterio 45, con la auditoría y la cuenta guardadas aunque responda 403; validaciones previas que no cuentan fallo; bloqueo por solicitante y por equipo; controlador sonda con `@Permiso` (prohibido, permitido, clave sin y con autorización, consumo y auditoría de la acción); autorizaciones inválidas (usada, vencida con el reloj, otra acción, otra sesión, otra sucursal, de B, inexistente); reversión si la acción falla; dos peticiones concurrentes con la misma autorización; cambio de usuario; soporte; búsqueda de los PIN usados en respuestas, auditoría y autorizaciones. (criterios 43 a 53)
- [ ] P7 · test-writer · `auditoria.spec.ts`: inmutabilidad para los tres roles; aislamiento por empresa y filas sin empresa; migración de `auditoria_plataforma` (base con filas de 001 antes de migrar, comparación campo a campo, tabla eliminada, `db:revertir` y vuelta); restricción de un solo actor; actor por vía (HTTP de plataforma, semilla o script, soporte); una fila por evento de la tabla de eventos, en la misma transacción (cambio revertido sin fila); búsqueda de secretos conocidos en todas las filas; `ocurrido_en` del reloj. (criterios 54 a 60)
- [ ] P8 · test-writer · `plataforma-http.spec.ts` y `soporte.spec.ts`: crear y desactivar superadministradores; ingreso, fallos, bloqueo, duración de 8 horas y salida; rutas `/plataforma/*` sin token, con token de empresa, de soporte o de equipo; alta de empresa por HTTP (todo o nada, errores, primer Administrador con PIN, auditoría con el id del superadministrador); emisores y sucursales por plataforma; consultas; soporte (permisos de Administrador, auditoría de inicio, acciones y fin, duración e inactividad, token adulterado, empresa inexistente, motivo vacío, sin acceso a `/plataforma/*`); desactivar al superadministrador cierra sus sesiones de soporte. (criterios 61 a 68)
- [ ] P9 · test-writer · `catalogo-acceso.spec.ts` y `rls-acceso.spec.ts`: criterio 38 de 001 con las tablas nuevas y sus ajustes; esquema `autenticacion` sin `USAGE`; `empresa_de_usuario` (`SECURITY DEFINER`, `search_path`, `EXECUTE` solo para la API, coincidencia exacta, `%` y `_`); unicidad global del nombre por SQL como `restaurante_api`; lectura, actualización, borrado e inserción entre empresas en cada tabla nueva con `empresa_id`. (criterios 88 a 91)
- [ ] P10 · test-writer · Actualizar las pruebas protegidas de 001 según "Impacto en la especificación 001" de `spec.md`, sin quitar ni debilitar aserciones: `auditoria_plataforma` → `auditoria` con `origen = 'plataforma'` (al menos `plataforma.spec.ts`, `plataforma-atomicidad.spec.ts`, `catalogo.spec.ts`, `entradas.spec.ts`, `entradas-unicode.spec.ts`, `contexto-posterior.spec.ts`, `guarda-nombres-plataforma.spec.ts`, `comentarios-retorno.spec.ts` si la consultan); criterio 30 → `NO_AUTENTICADO`; criterio 31 con `development` → la API no arranca; actualizar los comentarios de cabecera y `apps/api/test/README.md`. (criterios 7, 8, 56 y los de 001 citados)
- [ ] P11 · tester · Confirmar que P1 a P10 fallan por la razón esperada (rutas que responden "No implementado", tablas inexistentes, guard no registrado, `auditoria` inexistente) y no por errores de importación, sintaxis o configuración; y que las pruebas de 001 no tocadas por P10 siguen en verde.

## Fase C · Implementación por historia

Las tareas de backend no modifican, borran ni debilitan las pruebas de la fase B. Las pruebas no protegidas que hagan falta (suscripción, cuota, idempotencia, interfaz) las escribe quien implementa.

### C0 · Transversal: sesión, usuarios, auditoría, superadministrador y soporte

Commit propio. RF-07, RF-08, RF-09 (contraseña), RF-13, RNF-07, RNF-09.

- [ ] T6 · backend · Migraciones `202610280001-acceso-base.ts` (esquema `autenticacion` con `nombre_usuario`, `superadministrador`, `sesion_superadministrador`, `usuario` con su trigger, `acceso_sucursal`, `sesion` sin la llave a `equipo`, `bloqueo_intentos`, `idempotencia`, `idempotencia_plataforma`, `empresa_de_usuario`) y `202610280002-auditoria-general.ts` (tabla `auditoria`, copia y eliminación de `auditoria_plataforma`, `down`), según `plan.md`; ampliar `sqlTablaDePlataforma` o escribir el SQL de las tablas solo de plataforma. (criterios 4, 54 a 57, 88 a 91)
- [ ] T7 · backend · Módulo `auditoria`: `AuditoriaService.registrar` e `insertarAuditoriaPlataforma`; `OperacionPlataforma` escribe en `auditoria` y acepta `actor` como texto o `{ superadministradorId }`; quitar el modelo `AuditoriaPlataforma`. (criterios 54 a 60)
- [ ] T8 · backend · Credenciales: scrypt de contraseñas, huella HMAC del PIN, generación del PIN único, secretos y huellas de tokens, comparación en tiempo constante; regla de lint para `empresa_de_usuario` y consulta fija `autenticacion` en `consultas-sin-empresa.ts`. (criterios 4, 11, 13, 21, 89)
- [ ] T9 · backend · `AutenticacionGuard` global, `PrincipalInterceptor`, `ResolutorEmpresaSesion` registrado en `RESOLUTOR_EMPRESA`, `SesionActual`, `@Publica`, `@SoloAdministrador`, `@RequiereSucursal`, contraseña temporal; modo de prueba con cabecera solo en `NODE_ENV=test` (`entorno.ts`, `cabeceraHabilitada`); CORS con `ORIGENES_PERMITIDOS`. (criterios 1 a 8, 15, 17)
- [ ] T10 · backend · Ingreso con contraseña, `GET /sesion`, `PUT /sesion/sucursal`, `PUT /sesion/contrasena`, `DELETE /sesion`, bloqueos con transacción propia e inactividad con el reloj. (criterios 10 a 17, 42 en lo que toca a sesiones de contraseña)
- [ ] T11 · backend · Usuarios: `GET`, `POST`, `PATCH /usuarios`, `POST /usuarios/:id/pin`, `POST /usuarios/:id/contrasena`, con auditoría y cierre de sesiones. (criterios 6, 18 a 26)
- [ ] T12 · backend · Regla de rol en sucursales y emisores: `PATCH /sucursales/:id` solo Administrador, `GET /emisores`. (criterio 9)
- [ ] T13 · backend · Superadministrador: `SuperadministradorGuard` y `@Superadministrador()`, `crearSuperadministrador` y `desactivarSuperadministrador`, script `pnpm plataforma:superadmin`, `POST /plataforma/sesiones`, `DELETE /plataforma/sesion`, `GET /plataforma/empresas` y `GET /plataforma/empresas/:id`. (criterios 61, 62, 65)
- [ ] T14 · backend · Soporte: `POST /plataforma/empresas/:id/soporte`, `insertarSesionSoporte`, `cerrarSesionesDeSuperadministrador`, auditoría de inicio, acciones y fin. (criterios 52, 57, 66 a 68)
- [ ] T15 · backend · Idempotencia: `@Idempotente()` e `IdempotenciaInterceptor` (empresa) y su ayudante de plataforma, con limpieza de claves de más de 24 horas. Prueba de integración no protegida. (criterios 85 a 87)
- [ ] T16 · backend · Semilla (superadministrador y usuarios de demostración por rol, imprimiendo sus PIN), README (variables nuevas, `EMPRESA_POR_HEADER` solo en pruebas, crear el superadministrador, `PIN_PEPPER`), `.env.example`.
- [ ] T17 · frontend · Si faltan, `PRODUCT.md` y `DESIGN.md` con la skill `impeccable` (modo "Operate"); el orquestador los muestra al usuario antes de seguir.
- [ ] T18 · frontend · `apps/app` (React + Vite + PWA, React Router, TanStack Query, Vitest), `packages/ui` con los componentes base, `src/lib/api.ts` (cabeceras, `Idempotency-Key`, reintentos, errores en español) y el almacenamiento de tokens; scripts `lint`, `typecheck`, `test` y `build` en Turborepo y en CI. (criterios 103, 104)
- [ ] T19 · frontend · Ingreso con usuario y contraseña, cambio de contraseña obligatorio, elegir sucursal, barra de la sesión con cambio de sucursal y salida. (criterios 92, 93, 95)
- [ ] T20 · frontend · Administración de usuarios (lista, alta con accesos, PIN mostrado una vez, edición, desactivar, regenerar PIN, restablecer contraseña). (criterio 100, parte de usuarios)
- [ ] T21 · frontend · Panel del superadministrador, primera parte: ingreso propio, lista de empresas, "Entrar a dar soporte" y modo soporte con su barra. (criterios 101 en parte, 102)
- [ ] T22 · tester · Suite completa, lint, tipos y build; P1, P2, P3, P7 y las partes de P8 y P9 que no dependen de C1 a C3 en verde.

### C1 · HU-01: alta con suscripción, planes, pagos, módulos y cuota

Commit propio. HU-01, RF-01 y RF-02 por HTTP, RF-03 (salvo la suspensión), RF-04, RF-05.

- [ ] T23 · backend · Migración `202610280003-suscripciones.ts`: `plan` (con `BASE`), `suscripcion`, `pago_suscripcion`, `consumo_comprobantes`, y suscripción `BASE` para las sucursales existentes. (criterios 69, 75, 88, 91)
- [ ] T24 · backend · `SuscripcionService` y `PlanesService`: suscripción en `registrarEmpresa` y `agregarSucursal` (plan y vencimiento por defecto), estado calculado con el reloj, `registrarComprobanteEmitido`, `modulosDeSucursal`. (criterios 69, 71, 78, 79)
- [ ] T25 · backend · Alta por HTTP: `POST /plataforma/empresas` (con el primer Administrador por `insertarAdministradorInicial`), `POST /plataforma/empresas/:id/emisores` y `/sucursales`; `POST /emisores` y `POST /sucursales` del Administrador (suscripción con vencimiento el día del alta), con idempotencia donde corresponde. (criterios 9, 63, 64, 70, 85)
- [ ] T26 · backend · Planes y suscripciones por HTTP: `GET`/`POST`/`PATCH /plataforma/planes`, `GET /plataforma/suscripciones`, `PATCH /plataforma/suscripciones/:id`, `POST /plataforma/suscripciones/:id/pagos` (idempotente). Pruebas de integración no protegidas. (criterios 73 a 76)
- [ ] T27 · backend · `@RequiereModulo` y `ModuloInterceptor`; `modulos` en `GET /sesion`. Prueba no protegida con controlador sonda. (criterio 77)
- [ ] T28 · frontend · Panel, segunda parte: alta de empresa, detalle (agregar emisor y sucursal, registrar pago con vencimiento sugerido, cambiar plan, ajustar vencimiento), planes y lista de suscripciones por estado. (criterio 101)
- [ ] T29 · tester · Suite completa, lint, tipos y build; P8 completa en verde.

### C2 · HU-02: equipos vinculados, ingreso con PIN e inactividad

Commit propio. HU-02, RF-09 (PIN), RF-10, RF-11, RNF-08.

- [ ] T30 · backend · Migración `202610280004-equipos.ts`: `equipo`, `sucursal_acceso`, llave de `sesion.equipo_id` y de `auditoria.equipo_id`. (criterios 88, 91)
- [ ] T31 · backend · Equipos: `POST /equipos`, `GET /equipo`, `GET /equipos`, `DELETE /equipos/:id`, con auditoría. (criterios 27 a 32)
- [ ] T32 · backend · Ingreso con PIN, sesión atada al equipo en el guard, cambio rápido, bloqueo del equipo, inactividad por sucursal y `GET`/`PATCH /sucursales/:id/acceso`. (criterios 33 a 42)
- [ ] T33 · frontend · Arranque según el token del equipo, vincular este equipo, pantalla de PIN, "Cambiar usuario", cierre por inactividad, administración de equipos y del acceso de la sucursal; prueba E2E con Playwright (vincular, ingresar con PIN, cambiar de usuario, expirar por inactividad). (criterios 92, 94, 95, 96, 97, 100)
- [ ] T34 · tester · Suite completa, lint, tipos, build y E2E; P4 y P5 en verde.

### C3 · HU-03: clave de supervisor

Commit propio. HU-03, RF-12, RNF-09.

- [ ] T35 · backend · Matriz de permisos en `packages/dominio` (`requisitoPermiso`, `puedeAutorizar`, `alcanceReportes`, `permisosDeRol`) y `permisos` en `GET /sesion`. (criterios 42, 43)
- [ ] T36 · backend · Migración `202610280005-autorizaciones.ts` (`autorizacion` y llave de `auditoria.autorizacion_id`); `POST /autorizaciones` con transacción propia, bloqueos e idempotencia; `AutorizacionService.consumir`, `@Permiso` y `PermisoInterceptor` con la auditoría de la acción. (criterios 44 a 53, 85)
- [ ] T37 · frontend · `VentanaClaveSupervisor` (PIN, motivo, errores, bloqueo), con pruebas de componente; los permisos de la sesión disponibles para las pantallas futuras. (criterio 98)
- [ ] T38 · tester · Suite completa, lint, tipos y build; P6 en verde.

### C4 · HU-04: suspensión por falta de pago

Commit propio. HU-04, RF-06.

- [ ] T39 · backend · `avisoSuscripcion` en `GET /sesion` para Administrador y soporte; `exigirAperturaDeCaja`; comprobar que nada más consulta el estado. Pruebas de integración no protegidas con un controlador sonda y el reloj (gracia, suspensión, reactivación con un pago, rutas que siguen funcionando suspendida). (criterios 80 a 84)
- [ ] T40 · frontend · Aviso de gracia y de suspensión para el Administrador. (criterio 99)
- [ ] T41 · tester · Suite completa, lint, tipos, build y E2E.

## Fase D · Ataque adversarial

- [ ] T42 · adversarial · Ataque con `spec.md`, `plan.md` y el código, sin las notas de quien implementó. Áreas sugeridas:
  - **Sesión y empresa:** tokens adulterados o mezclados (`se.` con id de otra empresa, `sa.` y `eq.` intercambiados), carreras entre el cierre de una sesión y una petición en curso, sesiones que sobreviven a desactivar, desvincular o quitar el acceso, rutas nuevas sin decorador, rutas `/plataforma/*` sin `@Superadministrador`, modo de prueba con cabecera activable fuera de `test`.
  - **Ingreso:** enumeración de usuarios por tiempos o mensajes, evasión de los bloqueos (mayúsculas en el nombre, otro equipo, peticiones concurrentes que pasan el quinto fallo), fallos que no quedan guardados porque la transacción se revierte.
  - **`empresa_de_usuario` y el trigger:** `search_path`, comodines, nombres con espacios o Unicode equivalente, colisiones al renombrar, enumeración de nombres o empresas, uso de la consulta fija fuera de contexto con otro texto.
  - **PIN y equipos:** fuerza bruta repartida en equipos o sesiones, PIN de otra empresa con los mismos dígitos, sesión PIN usada desde otro equipo, dos sesiones PIN abiertas a la vez en un equipo, token de equipo de una sucursal usado en otra.
  - **Clave de supervisor:** autoautorización, autorizar desde una sesión de soporte o de prueba, reutilizar o adelantar el consumo, consumir desde otra sesión o sucursal, concurrencia, PIN en registros o respuestas, auditoría que falte o que se pueda falsear desde la API.
  - **Auditoría:** modificarla o borrarla por cualquier rol, filas sin empresa visibles para la API, insertar filas de otra empresa, pérdida de filas al migrar o revertir.
  - **Soporte:** usar una sesión de soporte de A en B, prolongarla, crear credenciales permanentes desde el soporte, acciones sin el superadministrador en la auditoría.
  - **Idempotencia:** respuestas de A devueltas en B, claves reutilizadas por otro usuario, respuestas con secretos guardadas.

  Cada falla vuelve como prueba nueva (test-writer, con las reglas de la fase B) y a la fase C. (criterios 1 a 68, 85 a 91)
- [ ] T43 · revisor · Comparar el cambio con `spec.md`, `plan.md` y `CLAUDE.md`; confirmar que P10 no debilitó ninguna aserción de 001 y que ninguna tarea de la fase C tocó los archivos de la fase B.
- [ ] T44 · tester · Suite completa, lint, tipos, build y E2E; `pnpm db:migrar`, `pnpm db:revertir` de las migraciones nuevas y otra vez `pnpm db:migrar`, sin errores; `pnpm local:preparar` en un clon limpio con la semilla nueva.

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo (P1 a P11)
- [ ] Pruebas en verde tras la implementación (T22, T29, T34, T38, T41)
- [ ] Ataque adversarial sin fallas abiertas (T42)
- [ ] El orquestador verifica con `git diff` que la fase C no tocó los archivos de la fase B
