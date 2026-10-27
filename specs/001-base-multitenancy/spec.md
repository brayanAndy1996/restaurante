# 001 · Base del proyecto: monorepo, multitenancy y aislamiento entre empresas

- **Historias y requerimientos:** RF-01 y RF-02 (modelo de datos y servicios; sus pantallas y endpoints de plataforma llegan con la autenticación), RNF-06, RNF-17. Relacionadas: HU-01 (parcial: la suscripción de la sucursal es RF-03), RNF-09 (auditoría de las operaciones de plataforma).
- **Ruta crítica:** sí (confirmado por el usuario). Implementa el aislamiento entre empresas (RLS), que es el primer punto de la lista de ruta crítica de `CLAUDE.md`.
- **Estado:** aprobada

## Objetivo

Dejar la base técnica sobre la que se construye todo lo demás: el monorepo, la API en NestJS con PostgreSQL, las tablas de plataforma (empresa, emisor y sucursal) y, sobre todo, la garantía de que una empresa nunca ve, modifica ni crea datos de otra. La garantía la da la base de datos (RLS) y la refuerza la API: sin contexto de empresa, las consultas fallan. También deja preparado el punto donde la historia 002 (autenticación) fijará la empresa de cada petición, y una vía explícita y auditada para las operaciones de plataforma que no tienen empresa.

## Glosario

- **Contexto de empresa:** la empresa a la que pertenece la operación en curso. Vive en el `AsyncLocalStorage` de la petición y, dentro de la base, en el parámetro de transacción `app.empresa_id`.
- **Tabla de empresa:** tabla con datos de clientes. Lleva `empresa_id` (salvo `empresa`, cuyo `id` es la propia empresa), RLS activada y forzada, y la política estándar.
- **Operación de plataforma:** operación del superadministrador que no pertenece a una empresa (por ejemplo, dar de alta una empresa). Corre con un rol de base distinto y deja una fila en la auditoría de plataforma.
- **Roles de base de datos:** `restaurante_migrador` (dueño de las tablas, solo migraciones), `restaurante_api` (la API, sujeta a RLS) y `restaurante_plataforma` (operaciones de plataforma, sujeta a sus propias políticas). Ninguno es superusuario ni tiene `BYPASSRLS`.

## Criterios de aceptación

Salvo que se diga otra cosa, los escenarios de aislamiento parten de dos empresas, **A** y **B**, cada una con al menos un emisor y dos sucursales, creadas con la vía de plataforma. "Conectado como `restaurante_api`" significa una conexión directa a PostgreSQL con ese rol, sin pasar por la API.

### Monorepo, entorno local y CI

1. Dado un clon limpio con Node 22 y pnpm 10, cuando se ejecutan `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` y `pnpm test` (este último con `DATABASE_ADMIN_URL` apuntando a un PostgreSQL 16), entonces los cuatro terminan sin errores.
2. Dado un equipo con Docker y sin PostgreSQL propio, cuando se ejecuta `pnpm local:preparar`, entonces queda un PostgreSQL 16 en marcha con los tres roles, la base `restaurante` migrada y los datos de demostración (dos empresas); y `pnpm dev` levanta la API en el puerto 3000 con `GET /health` respondiendo 200.
3. Dado un PostgreSQL 16 sin Docker (entorno en la nube) y `DATABASE_ADMIN_URL` con un usuario administrador, cuando se ejecutan `pnpm db:preparar`, `pnpm db:migrar` y `pnpm db:semilla`, entonces el resultado es el mismo que en el criterio 2. Ejecutar de nuevo `db:preparar` y `db:migrar` no falla ni duplica nada.
4. Dado un push o un pull request en GitHub, cuando corre el workflow de CI, entonces instala dependencias, ejecuta lint, verificación de tipos y pruebas contra un servicio PostgreSQL 16, y el workflow falla si falla cualquiera de esos pasos.

### Salud

5. Dada la base disponible, cuando se llama `GET /health` sin cabeceras ni contexto de empresa, entonces responde 200 con `{ "estado": "ok", "baseDeDatos": "ok" }`.
6. Dada la base inaccesible (apagada o con credenciales inválidas), cuando se llama `GET /health`, entonces responde 503 con `{ "estado": "error", "baseDeDatos": "error" }` en menos de 3 segundos, sin incluir el mensaje del error ni datos de conexión.

### Roles de la base de datos

7. Dados los roles creados por `db:preparar`, cuando se consultan sus atributos, entonces `restaurante_api` y `restaurante_plataforma` no son superusuarios, no tienen `BYPASSRLS`, `CREATEROLE` ni `CREATEDB`, no son dueños de ninguna tabla ni función y no son miembros de `restaurante_migrador` ni entre sí; `restaurante_migrador` tampoco es superusuario ni tiene `BYPASSRLS`.
8. Dado `restaurante_api` conectado, cuando intenta `ALTER TABLE sucursal DISABLE ROW LEVEL SECURITY`, `ALTER TABLE sucursal NO FORCE ROW LEVEL SECURITY`, `DROP POLICY`, `CREATE POLICY`, `SET ROLE restaurante_migrador`, `TRUNCATE sucursal`, crear una tabla o una función en `public`, o crear una tabla temporal, entonces cada intento falla con un error de permisos.
9. Dado `restaurante_api` conectado con contexto de la empresa A, cuando ejecuta `SET row_security = off` y luego `SELECT * FROM sucursal`, entonces la consulta falla (no devuelve filas de ninguna empresa).
10. Dada una `DATABASE_URL` (o `DATABASE_PLATAFORMA_URL`) cuyo rol es superusuario, tiene `BYPASSRLS` o es dueño de alguna tabla de `public`, cuando arranca la API, entonces no arranca y el registro indica qué rol y qué atributo lo impiden.

### Aislamiento entre empresas

11. **Lectura por id.** Dado el contexto de A, cuando se lee la sucursal o el emisor de B por su id (SQL directo como `restaurante_api` y `SucursalService.obtener`), entonces no se obtiene ninguna fila; el servicio responde lo mismo que para un id inexistente.
12. **Listados.** Dado el contexto de A, cuando se listan `empresa`, `emisor` y `sucursal` sin filtros, entonces solo aparecen filas de A (en `empresa`, solo la fila de A).
13. **Actualización.** Dado el contexto de A, cuando se ejecuta un `UPDATE` sobre la sucursal de B por id, y otro `UPDATE` sin `WHERE`, entonces el primero afecta 0 filas, el segundo solo afecta filas de A, y las filas de B quedan idénticas.
14. **Cambio de dueño.** Dado el contexto de A, cuando se actualiza una sucursal o un emisor de A con `empresa_id` = B, entonces la sentencia falla y la fila no cambia.
15. **Borrado.** Dado el contexto de A, cuando se ejecuta un `DELETE` de la sucursal de B por id, y otro `DELETE` sin `WHERE` (dentro de una transacción que luego se revierte), entonces el primero afecta 0 filas y el segundo solo afecta filas de A.
16. **Inserción ajena.** Dado el contexto de A, cuando se inserta una sucursal o un emisor con `empresa_id` = B, entonces la sentencia falla y no se crea nada.

16b. **Inserción propia.** Dado `restaurante_api` conectado con el contexto de A, cuando inserta un emisor con `empresa_id` = A y luego una sucursal con `empresa_id` = A que referencia ese emisor, entonces ambas inserciones tienen éxito, las filas quedan con `empresa_id` = A y se ven en el contexto de A pero no en el de B. (La base permite a la API crear emisores y sucursales de su propia empresa; qué rol de aplicación puede hacerlo se aplica en la historia 002.)

17. **Referencia cruzada.** Dado el contexto de A, cuando se inserta o actualiza una sucursal de A con `emisor_id` de un emisor de B, entonces la sentencia falla por la llave foránea compuesta, igual que con un `emisor_id` inexistente.
18. **HTTP.** Dado el resolutor de desarrollo con la empresa A: `GET /sucursales` devuelve solo sucursales de A; `GET /sucursales/{id de B}` y `PATCH /sucursales/{id de B}` responden 404 con el mismo cuerpo que un id inexistente, y la sucursal de B no cambia; `PATCH /sucursales/{id de A}` con `emisorId` de B responde 422 `EMISOR_INVALIDO`, igual que con un emisor inexistente.

### Sin contexto de empresa

19. Dada una conexión nueva de `restaurante_api` que nunca fijó `app.empresa_id`, cuando ejecuta `SELECT` o `UPDATE` sobre `empresa`, `emisor` o `sucursal`, `DELETE` sobre `emisor` o `sucursal` (todas con filas existentes) o un `INSERT` en `emisor` o `sucursal`, entonces cada sentencia falla con SQLSTATE `42501` y un mensaje que empieza con `contexto de empresa ausente`; ninguna devuelve filas.
20. Dada una conexión de `restaurante_api` que ya tuvo contexto en una transacción anterior confirmada o revertida, cuando ejecuta las mismas sentencias fuera de una transacción con contexto, entonces fallan igual que en el criterio 19.
21. Dado `app.empresa_id` fijado con un texto que no es UUID (o vacío), cuando se consulta una tabla de empresa, entonces la consulta falla.
22. Dado código de la API que usa un modelo o servicio de empresa fuera de `ContextoEmpresa.ejecutar`, cuando se ejecuta, entonces lanza `ContextoEmpresaAusenteError` antes de enviar la consulta a la base. Esto incluye consultas crudas por la conexión de la API; la única excepción es la verificación de salud y de roles, marcada explícitamente.
23. Dada una ruta HTTP que no está marcada con `@SinEmpresa()`, cuando el resolutor de empresa no obtiene una empresa, entonces responde 401 con `{ "codigo": "EMPRESA_NO_RESUELTA" }` y el controlador no se ejecuta.

> Precisión: a nivel de base, la política falla en cuanto evalúa una fila; sobre una tabla vacía, o un filtro por índice que no encuentra filas, devuelve 0 filas sin error. En ningún caso devuelve datos. La garantía de que **toda** consulta sin contexto falla la da la API (criterio 22). Los `INSERT` sin contexto fallan siempre, también en la base.

### El contexto no se filtra entre operaciones

24. Dado un pool de la API con una sola conexión, cuando se confirma una transacción con contexto de A y después se consulta sin contexto, entonces la consulta falla (criterio 20); y si después se abre una transacción con contexto de B, solo ve filas de B.
25. Dado lo mismo que en el criterio 24 pero con una transacción de A que termina con una excepción y se revierte, entonces el resultado es el mismo.
26. Dado un pool de la API con 2 conexiones, cuando llegan 100 peticiones HTTP concurrentes alternando las empresas A y B, y cada controlador hace dos consultas separadas por una espera asíncrona, entonces cada respuesta contiene solo datos de su empresa y `ContextoEmpresa.empresaActual()` devuelve la empresa de su petición en todo momento.
27. Dado un contexto de A activo, cuando se llama `ContextoEmpresa.ejecutar` con la empresa B, entonces lanza `ContextoEmpresaConflictoError`; si se llama con la misma empresa A, corre dentro de la transacción existente.
28. Dado un contexto de empresa activo, cuando se llama `OperacionPlataforma.ejecutar`, entonces lanza `OperacionPlataformaAnidadaError`. Dada una operación de plataforma en curso, cuando su código usa un servicio o modelo de empresa de la API, entonces lanza `ContextoEmpresaAusenteError`; la conexión de plataforma nunca atiende consultas de la API ni al revés.

### Empresa de la petición: punto de enganche para la historia 002

29. Dado `NODE_ENV=production` y `EMPRESA_POR_HEADER=habilitado`, cuando arranca la API, entonces no arranca y el registro explica que esa opción está prohibida en producción.
30. Dado `NODE_ENV=production` sin `EMPRESA_POR_HEADER`, cuando llega `GET /sucursales` con la cabecera `x-empresa-id` de una empresa real, entonces responde 401 `EMPRESA_NO_RESUELTA` (la cabecera se ignora).
31. Dado `NODE_ENV` `development` o `test` con `EMPRESA_POR_HEADER=habilitado`, cuando llega una petición con `x-empresa-id` = UUID válido, entonces la petición corre con ese contexto; si la cabecera falta o no es un UUID, responde 401 `EMPRESA_NO_RESUELTA`.

### Operaciones de plataforma y auditoría

32. Dado que no hay contexto de empresa, cuando se llama `PlataformaEmpresasService.registrarEmpresa(datos, { actor, motivo })` con datos válidos, entonces se crean en una sola transacción la empresa, sus emisores y sus sucursales, y una fila en `auditoria_plataforma` con el actor, la operación `registrar_empresa`, el motivo, el `empresa_id` creado y el detalle de lo creado.
33. Dado `actor` o `motivo` vacíos o solo con espacios, cuando se llama cualquier operación de plataforma, entonces lanza un error de validación y no se crea nada, tampoco la fila de auditoría.
34. Dados datos inválidos (RUC con dígito verificador incorrecto, RUC repetido en la entrada, RUC ya registrado, sucursal que referencia un RUC que no está en la entrada, código de establecimiento que no tiene 4 dígitos, dos sucursales del mismo emisor con el mismo código, hora de corte o WhatsApp mal formados), cuando se llama `registrarEmpresa`, entonces lanza un error de validación que indica el campo, y no queda nada creado ni auditado.
35. Dada una empresa existente, cuando se llaman `PlataformaEmpresasService.agregarEmisor` o `agregarSucursal`, entonces se crea el registro en esa empresa y se audita con la operación `agregar_emisor` o `agregar_sucursal`.

35b. **Hora de corte por defecto.** Dada una sucursal sin `horaCorte` en la entrada de `registrarEmpresa` o de `agregarSucursal`, cuando se crea, entonces queda con hora de corte `05:00` (y `sucursalRespuesta.horaCorte` es `"05:00"`). Lo mismo ocurre si `restaurante_api`, con el contexto de A, inserta por SQL una sucursal de A sin la columna `hora_corte`. La hora de corte se puede cambiar después con `PATCH` (criterio 39).

36. Dados los roles, cuando `restaurante_plataforma` intenta `UPDATE`, `DELETE` o `TRUNCATE` sobre `auditoria_plataforma`, entonces falla; y cuando `restaurante_api` intenta leer o escribir `auditoria_plataforma`, también falla.
37. Dado el código de la API, cuando un archivo fuera de `apps/api/src/modulos/plataforma/` importa la conexión de plataforma, o un archivo distinto del servicio de contexto escribe el texto `app.empresa_id`, entonces `pnpm lint` falla.

### Catálogo: la regla vale para las tablas futuras

38. Dada la base migrada, cuando se inspecciona el catálogo, entonces:
    - toda tabla del esquema `public`, salvo `migraciones`, tiene RLS activada **y forzada**;
    - toda tabla con columna `empresa_id`, más `empresa`, tiene una política para `restaurante_api` que usa `empresa_actual()` tanto en `USING` como en `WITH CHECK`;
    - `restaurante_api` y `restaurante_plataforma` no tienen privilegios `TRUNCATE`, `REFERENCES` ni `TRIGGER` sobre ninguna tabla, ni `CREATE` sobre ningún esquema;
    - toda llave foránea entre dos tablas con `empresa_id` incluye `empresa_id` en sus columnas;
    - `restaurante_api` no tiene ningún privilegio sobre `migraciones` ni `auditoria_plataforma`.

    Esta prueba recorre el catálogo, así que una tabla nueva sin RLS hace fallar la suite.

### Sucursal: configuración (RF-02) y reglas puras

39. Dado el contexto de A, cuando se llama `PATCH /sucursales/{id}` con cambios válidos de emisor, código de establecimiento, nombre, dirección, horario, WhatsApp u hora de corte, entonces responde 200 con la sucursal actualizada y `actualizadoEn` cambia; los campos no enviados no cambian.
40. Dado el contexto de A, cuando el `PATCH` trae datos mal formados, entonces responde 400 `DATOS_INVALIDOS` con la lista de campos; si el código de establecimiento ya lo usa otra sucursal del mismo emisor, o el nombre ya lo usa otra sucursal de la empresa, responde 409 `CONFLICTO`.
41. `validarRuc` (en `packages/dominio`) acepta RUC de 11 dígitos con prefijo 10, 15, 16, 17 o 20 y dígito verificador correcto (por ejemplo `20100000009`, `20600000005`, `10456789019`) y rechaza el resto (por ejemplo `20100000000`, `2010000000`, `30100000001`, `2010000000a`).
42. `diaOperativo(instante, horaCorte)` (en `packages/dominio`) devuelve la fecha `AAAA-MM-DD` del día operativo en hora de Lima: con corte `05:00`, `2026-03-10T03:00-05:00` da `2026-03-09`, `2026-03-10T05:00-05:00` da `2026-03-10` y `2026-01-01T02:00-05:00` da `2025-12-31`; con corte `00:00`, siempre da la fecha calendario de Lima.

## Casos límite

- `app.empresa_id` con un UUID válido de una empresa que no existe: las consultas devuelven 0 filas y los `INSERT` fallan por llave foránea; no es un error de contexto.
- Una petición con contexto que lanza una excepción: la transacción se revierte, el contexto desaparece con ella y la conexión vuelve limpia al pool.
- Peticiones concurrentes con `Promise.all` dentro de un mismo controlador: todas usan la misma transacción y el mismo contexto.
- Operaciones fuera de HTTP (colas, WebSockets, tareas programadas de historias futuras): deben envolver su trabajo en `ContextoEmpresa.ejecutar`; sin eso fallan por el criterio 22.
- Mensajes de error: un 404 o 422 por un recurso de otra empresa no se distingue de uno inexistente (mismo código, mismo mensaje).
- Unicidad global del RUC: un intento de registrar un RUC que ya usa otra empresa revela que el RUC existe en el sistema. En esta historia solo la plataforma registra emisores, pero desde la historia 002 el Administrador de una empresa también podrá hacerlo, así que el aviso le llegará a un usuario de empresa. Como el padrón de RUC es público, se acepta (decisión del usuario).
- `DELETE` de una sucursal o emisor referenciado por otras filas: falla por llave foránea; esta historia no ofrece borrados por la API.
- Horario con tramos que cruzan la medianoche (por ejemplo, 18:00 a 02:00): se acepta; `hasta` menor que `desde` significa el día siguiente. Un tramo con `desde` igual a `hasta`, o dos tramos solapados el mismo día, se rechazan.
- Sucursal sin `horaCorte` en el alta: queda con `05:00` (criterio 35b). Una `horaCorte` enviada pero mal formada sigue siendo un error de validación (criterios 34 y 40).
- Sucursal sin WhatsApp: se acepta; el campo es opcional y en `PATCH` se puede quitar con `null`.
- Cambio de emisor de una sucursal: en esta historia se permite siempre (criterio 39), porque todavía no existen comprobantes.

## Reglas de negocio aplicables

- Una empresa tiene uno o varios emisores (RUC); cada sucursal pertenece a una empresa y a uno de sus emisores, y tiene su código de establecimiento SUNAT (RF-01, RF-02, HU-01).
- Los emisores y las sucursales los crean el superadministrador y también el Administrador, este último solo dentro de su propia empresa (decisión del usuario). La regla de rol se aplica en la historia 002; en esta historia la base ya permite a la API crear emisores y sucursales de su propia empresa (criterio 16b).
- El RUC tiene 11 dígitos, prefijo 10, 15, 16, 17 o 20 y dígito verificador correcto. Cada RUC pertenece a una sola empresa del sistema (decisión del usuario). No se valida todavía la relación entre el régimen Nuevo RUS y el RUC de persona natural.
- El emisor guarda su régimen tributario, que define qué comprobantes puede emitir (en el Nuevo RUS, solo boletas). En esta historia solo se guarda; la restricción se aplica en la historia de facturación (RF-65).
- No se puede cambiar el emisor (RUC) de una sucursal que ya emitió comprobantes (decisión del usuario). El bloqueo lo implementa la historia de facturación; en esta historia el cambio se permite porque aún no hay comprobantes.
- El nombre de la sucursal no se repite dentro de la empresa, sin distinguir mayúsculas.
- El horario de la sucursal es una lista de tramos por día de la semana (varios por día), que pueden cruzar la medianoche, y puede quedar vacío. Los feriados y las excepciones por fecha quedan para más adelante.
- El WhatsApp de la sucursal es un celular peruano (`+51 9XXXXXXXX`) y es opcional.
- Cada sucursal tiene una hora de corte del día operativo; las ventas de madrugada cuentan para el día anterior (documento de diseño). Por defecto es `05:00` y se puede modificar; a la hora de corte exacta empieza el nuevo día (decisión del usuario).
- Los datos de una empresa nunca se comparten con otra (RNF-06, regla de delivery sobre datos de clientes).
- Toda operación del superadministrador queda registrada en una auditoría que no se puede modificar (RNF-09, RF-07).
- Identificadores UUID en todas las tablas (documento de diseño).

## Contrato

### Paquetes compartidos

- `packages/dominio`: `validarRuc(ruc: string): boolean`, `diaOperativo(instante: Date, horaCorte: string): string`, `validarHorario(tramos: TramoHorario[]): ResultadoValidacion` y el tipo `RegimenTributario` = `'NUEVO_RUS' | 'RER' | 'MYPE_TRIBUTARIO' | 'GENERAL'`.
- `packages/contratos` (zod, con tipos inferidos):
  - `horaSchema`: texto `HH:MM`, de `00:00` a `23:59`.
  - `tramoHorarioSchema`: `{ dia: 1..7 (1 = lunes, ISO), desde: hora, hasta: hora }`.
  - `horarioSchema`: arreglo de tramos validado con `validarHorario`; puede estar vacío (sucursal sin horario cargado).
  - `whatsappSchema`: celular peruano en formato E.164, `^\+519\d{8}$`.
  - `rucSchema`, `codigoEstablecimientoSchema` (`^\d{4}$`), `regimenTributarioSchema`.
  - `emisorEntradaSchema`: `{ ruc, razonSocial (1..200), regimen }`.
  - `sucursalEntradaSchema`: `{ rucEmisor, nombre (1..100), codigoEstablecimiento, direccion (1..300), horario (opcional, por defecto []), whatsapp (opcional), horaCorte (opcional, por defecto '05:00') }`.
  - `registrarEmpresaEntradaSchema`: `{ nombre (1..150), emisores: emisorEntrada[] (mínimo 1), sucursales: sucursalEntrada[] (mínimo 1) }`, con RUC únicos y cada `rucEmisor` presente en `emisores`.
  - `sucursalConfigurarEntradaSchema`: parcial de `{ emisorId (uuid), nombre, codigoEstablecimiento, direccion, horario, whatsapp (o null para quitarlo), horaCorte }`, con al menos un campo.
  - `sucursalRespuestaSchema`: `{ id, empresaId, emisorId, nombre, codigoEstablecimiento, direccion, horario, whatsapp | null, horaCorte (HH:MM), creadoEn, actualizadoEn (ISO 8601) }`.
  - `saludRespuestaSchema` y `errorRespuestaSchema`: `{ codigo, mensaje, campos? }`.

### Endpoints

| Método y ruta | Contexto | Entrada | Respuestas |
| --- | --- | --- | --- |
| `GET /health` | `@SinEmpresa()` | — | 200 `saludRespuesta`; 503 si la base no responde |
| `GET /sucursales` | empresa | — | 200 `sucursalRespuesta[]`; 401 `EMPRESA_NO_RESUELTA` |
| `GET /sucursales/:id` | empresa | `id` UUID | 200 `sucursalRespuesta`; 400 `DATOS_INVALIDOS` si `id` no es UUID; 404 `NO_ENCONTRADO`; 401 |
| `PATCH /sucursales/:id` | empresa | `sucursalConfigurarEntrada` | 200 `sucursalRespuesta`; 400 `DATOS_INVALIDOS`; 404 `NO_ENCONTRADO`; 409 `CONFLICTO`; 422 `EMISOR_INVALIDO`; 401 |

- `PATCH` asigna valores absolutos, así que repetirlo da el mismo resultado; no necesita clave de idempotencia.
- En esta historia no hay endpoints HTTP de plataforma: crear empresas exige identificar al superadministrador, y eso llega con la historia 002. La vía de plataforma se usa desde la semilla y las pruebas.

### Interfaces de la API (contratos públicos para las pruebas)

- `ContextoEmpresa` (`apps/api/src/nucleo/contexto-empresa/`):
  - `ejecutar<T>(empresaId: string, fn: () => Promise<T>): Promise<T>`: valida el UUID, abre una transacción en la conexión de la API, ejecuta `set_config('app.empresa_id', empresaId, true)` como primera sentencia y corre `fn` con el contexto en el `AsyncLocalStorage`. Confirma si `fn` termina bien y revierte si lanza.
  - `empresaActual(): string`: lanza `ContextoEmpresaAusenteError` si no hay contexto.
  - Errores: `ContextoEmpresaAusenteError`, `ContextoEmpresaConflictoError`.
- `RESOLUTOR_EMPRESA` (token de Nest) con la interfaz `ResolutorEmpresa { resolver(peticion): Promise<string | null> }`. En esta historia hay dos implementaciones: `ResolutorEmpresaNulo` (siempre `null`; es la de producción) y `ResolutorEmpresaPorCabecera` (lee `x-empresa-id`; solo si `NODE_ENV` es `development` o `test` y `EMPRESA_POR_HEADER=habilitado`). La historia 002 agrega la suya, que tomará la empresa del usuario autenticado, y la registra en el mismo token.
- `ContextoEmpresaInterceptor` (global): si la ruta no tiene `@SinEmpresa()`, pide la empresa al resolutor, responde 401 si es `null`, y corre el controlador dentro de `ContextoEmpresa.ejecutar`. Los guards de Nest corren antes que los interceptores, así que el guard de autenticación de 002 podrá dejar la empresa en la petición para que su resolutor la lea.
- `OperacionPlataforma` (`apps/api/src/modulos/plataforma/`): `ejecutar<T>({ actor, motivo, operacion, empresaId? }, fn: (tx) => Promise<T>): Promise<T>`. Usa la conexión de `restaurante_plataforma`, abre una transacción, corre `fn` con la transacción explícita e inserta la fila de auditoría en esa misma transacción antes de confirmar: o quedan el cambio y su auditoría, o no queda nada. Error: `OperacionPlataformaAnidadaError`.
- `PlataformaEmpresasService`: `registrarEmpresa(datos, auditoria)`, `agregarEmisor(empresaId, datos, auditoria)`, `agregarSucursal(empresaId, datos, auditoria)`, `listarEmpresas()`. `auditoria` es `{ actor: string, motivo: string }`. `registrarEmpresa` devuelve `{ empresaId, emisores: { id, ruc }[], sucursales: { id, nombre }[] }`.
- `SucursalService` (contexto de empresa): `listar()`, `obtener(id)` (devuelve `null` si no existe o es de otra empresa) y `configurar(id, cambios)`.

### Variables de entorno

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión de la API (`restaurante_api`) |
| `DATABASE_PLATAFORMA_URL` | Conexión de plataforma (`restaurante_plataforma`) |
| `DATABASE_MIGRADOR_URL` | Migraciones (`restaurante_migrador`) |
| `DATABASE_ADMIN_URL` | Solo `db:preparar` y las pruebas: usuario administrador que crea roles y bases |
| `DB_PASSWORD_MIGRADOR`, `DB_PASSWORD_API`, `DB_PASSWORD_PLATAFORMA` | Contraseñas que `db:preparar` asigna a los roles |
| `DB_POOL_MAX` | Tamaño del pool de la API (por defecto 10) |
| `EMPRESA_POR_HEADER` | `habilitado` activa el resolutor por cabecera; prohibido en producción |
| `NODE_ENV`, `PORT` | Entorno y puerto (por defecto 3000) |

### Eventos en tiempo real

- Ninguno.

### Permisos

- En esta historia no hay usuarios ni roles de aplicación (llegan con 002). Los endpoints de sucursal solo son accesibles con el resolutor por cabecera en desarrollo y pruebas; en producción responden 401 hasta que 002 instale su resolutor.
- **Para la historia 002:** `PATCH /sucursales/:id` debe exigir el rol Administrador; `GET /sucursales` y `GET /sucursales/:id`, cualquier rol con acceso a la empresa. Crear emisores y sucursales lo podrán el Superadministrador y el Administrador, este último solo en su propia empresa.
- Permisos de la base de datos:

| Tabla | `restaurante_api` | `restaurante_plataforma` |
| --- | --- | --- |
| `empresa` | SELECT, UPDATE (su fila) | SELECT, INSERT, UPDATE |
| `emisor` | SELECT, INSERT, UPDATE, DELETE (su empresa) | SELECT, INSERT, UPDATE |
| `sucursal` | SELECT, INSERT, UPDATE, DELETE (su empresa) | SELECT, INSERT, UPDATE |
| `auditoria_plataforma` | ninguno | SELECT, INSERT |
| `migraciones` | ninguno | ninguno |

  La API tiene DML completo sobre las tablas de empresa (y así será en las tablas futuras); qué rol de aplicación puede crear o borrar qué cosa se controla en la API desde la historia 002.

## Cambios al modelo de datos

Todas las tablas usan UUID (`gen_random_uuid()` por defecto) y `creado_en`, `actualizado_en` (`timestamptz`, no nulos).

- **Función `empresa_actual()`** (`public`, `STABLE`, dueña `restaurante_migrador`): lee `current_setting('app.empresa_id', true)`; si es nulo o vacío lanza SQLSTATE `42501` con el mensaje `contexto de empresa ausente`; si no es UUID, lanza el error de conversión; si no, lo devuelve como `uuid`. `EXECUTE` para `restaurante_api`.
- **`empresa`**: `id`, `nombre` (texto, 1 a 150).
- **`emisor`**: `id`, `empresa_id` (FK `empresa`), `ruc` (`char(11)`, único en todo el sistema), `razon_social` (1 a 200), `regimen` (texto con `CHECK` en `NUEVO_RUS`, `RER`, `MYPE_TRIBUTARIO`, `GENERAL`). Único `(id, empresa_id)` para las llaves compuestas. Índice por `empresa_id`.
- **`sucursal`**: `id`, `empresa_id` (FK `empresa`), `emisor_id`, `nombre` (1 a 100), `codigo_establecimiento` (`char(4)`, `CHECK ~ '^\d{4}$'`), `direccion` (1 a 300), `horario` (`jsonb`, no nulo, por defecto `[]`), `whatsapp` (texto nulo, `CHECK ~ '^\+519\d{8}$'`), `hora_corte` (`time`, no nulo, `DEFAULT '05:00'`). FK compuesta `(emisor_id, empresa_id)` → `emisor (id, empresa_id)`. Únicos `(emisor_id, codigo_establecimiento)` y `(empresa_id, lower(nombre))`. Índice por `empresa_id`.
- **`auditoria_plataforma`**: `id`, `ocurrido_en` (`timestamptz`, por defecto `now()`), `actor` (texto libre no vacío; en 002 pasa a ser el id del superadministrador), `operacion` (texto no vacío), `motivo` (texto no vacío), `empresa_id` (uuid nulo, FK `empresa`), `detalle` (`jsonb`). Un trigger rechaza `UPDATE` y `DELETE`, y otro rechaza `TRUNCATE`.
- **RLS**: `ENABLE` y `FORCE ROW LEVEL SECURITY` en las cuatro tablas.
  - Política `aislamiento_empresa` `TO restaurante_api` en `emisor` y `sucursal`: `USING (empresa_id = (SELECT empresa_actual())) WITH CHECK (empresa_id = (SELECT empresa_actual()))`; en `empresa`, lo mismo con `id`.
  - Política `acceso_plataforma` `TO restaurante_plataforma` en `empresa`, `emisor`, `sucursal` y `auditoria_plataforma`: `USING (true) WITH CHECK (true)`.
  - `restaurante_migrador` no tiene política: como la RLS está forzada, no ve filas. Las migraciones hacen DDL; una migración de datos futura que necesite recorrer todas las empresas debe quitar y volver a poner `FORCE` dentro de su propia transacción (ver `plan.md`).
- **Base de datos**: dueña `restaurante_migrador`; se revocan `CONNECT`, `CREATE` y `TEMPORARY` a `PUBLIC`; `CONNECT` para `restaurante_api` y `restaurante_plataforma`; solo `USAGE` sobre `public`.
- **Convención para las tablas futuras**: `empresa_id uuid not null` con FK a `empresa`, índice por `empresa_id`, RLS activada y forzada, política `aislamiento_empresa`, llaves foráneas compuestas con `empresa_id`, privilegios explícitos en la misma migración y nunca `TRUNCATE`. El criterio 38 lo verifica.

## Fuera de alcance

- Autenticación, usuarios, roles, PIN y equipos vinculados (historia 002), incluido el resolutor de empresa definitivo y los endpoints de plataforma por HTTP.
- La PWA (`apps/app`), la carta web (`apps/web`), el puente Android y `packages/ui`.
- Suscripciones, planes y módulos por sucursal (RF-03 a RF-07). El alta de empresa (`registrarEmpresa`, `agregarSucursal`) **no** crea la suscripción: la sucursal nace sin suscripción, y la creación de la suscripción llega con RF-03, cuya historia extenderá `registrarEmpresa`.
- Feriados y excepciones del horario por fecha (para más adelante).
- Validar que un emisor del Nuevo RUS tenga RUC de persona natural.
- Bloquear el cambio de emisor de una sucursal que ya emitió comprobantes (historia de facturación).
- Endpoints HTTP para crear emisores y sucursales (llegan con 002, junto con la regla de rol).
- La tasa de IGV con vigencia del emisor y la restricción de comprobantes por régimen: van en la historia de cálculo de montos y facturación. Motivo: (1) nada en esta historia la usa; (2) decidir qué tasa aplica a una fecha es cálculo de montos, ruta crítica que merece sus propias pruebas primero; (3) la tasa aplicable está pendiente de validar con el contador (18 % o la tasa reducida para restaurantes MYPE); (4) agregarla después es una tabla nueva, sin reescribir datos.
- Datos del emisor que pedirá la facturación (domicilio fiscal, ubigeo, nombre comercial) y el slug de la carta web.
- Colas (pg-boss), WebSockets, Sentry, despliegue y staging.
- Claves de idempotencia (no hay escrituras no idempotentes en esta historia).

## Notas para otras historias

- **Historia 002 (autenticación):**
  - Aplicar la regla de rol para crear emisores y sucursales: Superadministrador y Administrador de su propia empresa (ver "Permisos").
  - Unir `auditoria_plataforma` a la auditoría general del módulo de seguridad.
  - El `actor` de la auditoría pasa de texto libre al id del superadministrador.
  - `ResolutorEmpresaPorCabecera` queda solo para las pruebas automáticas: permitirlo únicamente con `NODE_ENV=test` (deja de valer `development`).
- **Historia de facturación:** bloquear el cambio de emisor (RUC) de una sucursal que ya emitió comprobantes; aplicar la restricción de comprobantes por régimen (RF-65).
- **Historia de suscripciones (RF-03):** el alta de empresa y de sucursal debe crear la suscripción.

## Decisiones del usuario

No quedan preguntas abiertas. Respuestas del usuario a las preguntas de la versión en borrador:

1. **Quién crea emisores y sucursales:** el superadministrador y también el Administrador, dentro de su propia empresa. La regla de rol se aplica en 002; esta historia deja que `restaurante_api` inserte emisores y sucursales de su propia empresa bajo RLS (criterio 16b) y sigue impidiendo hacerlo en otra (criterio 16). No hay endpoints HTTP de creación en esta historia.
2. **Cambio de emisor con comprobantes emitidos:** no se permite. Lo bloquea la historia de facturación; en 001 el cambio sigue permitido porque aún no hay comprobantes.
3. **Horario:** tramos por día de la semana que pueden cruzar la medianoche, como se especificó. Feriados y excepciones por fecha quedan fuera de alcance.
4. **WhatsApp:** celular peruano `+51 9XXXXXXXX`, opcional.
5. **Hora de corte:** `05:00` por defecto y modificable; a la hora exacta empieza el nuevo día. `horaCorte` es opcional en el alta (criterio 35b) y la columna lleva `DEFAULT '05:00'`.
6. **RUC:** prefijos 10, 15, 16, 17 o 20; cada RUC pertenece a una sola empresa. La relación con el Nuevo RUS (persona natural) no se valida todavía.
7. **Nombre de la sucursal:** no se repite dentro de la empresa, sin distinguir mayúsculas.
8. **Auditoría de plataforma:** se unirá a la auditoría general en la historia 002; en 001 vive en `auditoria_plataforma`.
9. **Actor de la auditoría:** texto libre hasta que exista el superadministrador; en 002 pasa a ser su id.
10. **Resolutor por cabecera:** cuando exista el login (002), quedará solo para las pruebas automáticas (`NODE_ENV=test`).

Además: el alta de empresa todavía no crea la suscripción; llega con RF-03 (ver "Fuera de alcance").
