# 001 · Tareas

Cada tarea indica su rol y los criterios de aceptación que cubre (numeración de `spec.md`).

Como el repositorio no tiene código, el flujo de ruta crítica se ordena en cuatro fases. La fase A deja lo mínimo para que las pruebas protegidas compilen y corran (monorepo, base de pruebas y firmas públicas que lanzan "no implementado"); no implementa nada de aislamiento. Después escribe el test-writer (fase B), luego se implementa (fase C) y al final viene el ataque (fase D).

## Fase A · Base para poder probar (backend)

- [ ] T1 · backend · Raíz del monorepo: `package.json` con `packageManager` pnpm 10 y `engines` Node 22, `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `turbo.json` (`build`, `lint`, `typecheck`, `test`, `dev`), `.nvmrc`, `.editorconfig`, entradas nuevas en `.gitignore`, y scripts raíz `lint`, `typecheck`, `build`, `test`, `format`, `format:check` y `dev`. (criterio 1)
- [ ] T2 · backend · `packages/config`: `tsconfig.base.json` estricto, configuración base de ESLint 9 (plana, typescript-eslint) y de Prettier, usadas por todos los paquetes. (criterio 1)
- [ ] T3 · backend · `packages/dominio`: `validarRuc`, `diaOperativo`, `validarHorario` y `RegimenTributario`, con `tsup` y pruebas unitarias en Vitest (ejemplos de los criterios 41 y 42, tramos que cruzan la medianoche, solapados y con `desde` igual a `hasta`). (criterios 41, 42)
- [ ] T4 · backend · `packages/contratos`: esquemas zod de `spec.md` (comunes, plataforma, sucursal, salud, errores) con sus tipos, `tsup` y pruebas unitarias de los esquemas, incluido `horaCorte` opcional con valor por defecto `'05:00'` en `sucursalEntradaSchema` (y sin valor por defecto en `sucursalConfigurarEntradaSchema`). (criterios 34, 35b, 40, en lo que toca a la validación de datos)
- [ ] T5 · backend · `apps/api`: esqueleto NestJS (`main.ts`, `app.module.ts`), `config/entorno.ts` con zod (incluida la prohibición de `EMPRESA_POR_HEADER` en producción) y filtro global de errores `{ codigo, mensaje, campos? }`. (criterio 29)
- [ ] T6 · backend · `scripts/preparar-bd.ts` (`pnpm db:preparar`), `docker-compose.yml` (PostgreSQL 16, puerto 5433), `.env.example` y `pnpm local:preparar` (sin semilla todavía). (criterios 2, 3, 7)
- [ ] T7 · backend · Migraciones con umzug (`pnpm db:migrar`, `pnpm db:revertir`, tabla `migraciones`) sin ninguna migración aún, y la infraestructura de pruebas de `apps/api`: Vitest con SWC, preparación global que crea `restaurante_test` con `DATABASE_ADMIN_URL` y corre las migraciones, y utilidades para abrir clientes `pg` con cada rol. (criterios 1, 3)
- [ ] T8 · backend · Firmas públicas que lanzan `Error('No implementado')`: `ContextoEmpresa`, `ContextoEmpresaAusenteError`, `ContextoEmpresaConflictoError`, `RESOLUTOR_EMPRESA`, `ResolutorEmpresa`, `ResolutorEmpresaNulo`, `ResolutorEmpresaPorCabecera`, `@SinEmpresa()`, `ContextoEmpresaInterceptor`, `OperacionPlataforma`, `OperacionPlataformaAnidadaError`, `PlataformaEmpresasService`, `SucursalService` y `SucursalesController` con sus rutas, en las rutas de archivo de `plan.md`. Sin lógica. (habilita la fase B)
- [ ] T9 · backend · `.github/workflows/ci.yml` según `plan.md`. (criterio 4)

## Fase B · Pruebas primero (ruta crítica)

Todos los archivos llevan al inicio `// spec: 001-base-multitenancy (pruebas protegidas)` y viven en `apps/api/test/aislamiento/`. Los nombres son sugeridos.

- [ ] P1 · test-writer · `roles.spec.ts`: atributos de los roles, intentos de saltarse la RLS como `restaurante_api` y negativa a arrancar con un rol privilegiado. (criterios 7, 8, 9, 10)
- [ ] P2 · test-writer · `rls-sql.spec.ts`: con clientes `pg` como `restaurante_api` y `set_config`, lectura por id, listados, actualización, cambio de dueño, borrado, inserción ajena, inserción propia de emisor y sucursal, y referencia cruzada; sin contexto, en conexión nueva y reutilizada, y con valor no UUID. (criterios 11 a 16, 16b, 17, 19, 20, 21)
- [ ] P3 · test-writer · `catalogo.spec.ts`: recorrido del catálogo (RLS forzada, políticas, privilegios, llaves compuestas) y permisos sobre `auditoria_plataforma`. (criterios 36, 38)
- [ ] P4 · test-writer · `contexto.spec.ts`: `ContextoEmpresa` sin contexto, pool de una conexión tras commit y tras rollback, anidamiento con la misma y con otra empresa, y mezcla con `OperacionPlataforma`. (criterios 22, 24, 25, 27, 28)
- [ ] P5 · test-writer · `http.spec.ts`: endpoints de sucursal con el resolutor por cabecera (aislamiento, 404 y 422 indistinguibles, `PATCH` válido e inválido), ruta sin empresa resuelta, 100 peticiones concurrentes con pool de 2 y un controlador sonda propio, y comportamiento en producción. (criterios 18, 23, 26, 29, 30, 31, 39, 40)
- [ ] P6 · test-writer · `plataforma.spec.ts`: `registrarEmpresa`, `agregarEmisor` y `agregarSucursal` con auditoría, actor o motivo vacíos, datos inválidos sin dejar rastro, y hora de corte `05:00` cuando la sucursal se da de alta sin `horaCorte` (por el servicio y por SQL como `restaurante_api` sin la columna). (criterios 32, 33, 34, 35, 35b)
- [ ] P7 · test-writer · `lint.spec.ts`: `ESLint.lintText` sobre fragmentos que importan la conexión de plataforma fuera de su módulo o escriben `app.empresa_id` fuera del servicio de contexto. (criterio 37)
- [ ] P8 · tester · Confirmar que P1 a P7 fallan por falta de funcionalidad (tablas, roles o lógica inexistentes, "No implementado") y no por errores de importación, sintaxis o configuración.

## Fase C · Implementación (backend)

- [ ] T10 · backend · Migración `202610270001-plataforma-base.ts` y función auxiliar `sqlTablaDeEmpresa`: `empresa_actual()`, las cuatro tablas (con `sucursal.hora_corte` `DEFAULT '05:00'`), RLS forzada, políticas, privilegios, llaves compuestas y triggers de la auditoría. (criterios 7, 8, 9, 11 a 16, 16b, 17, 19, 20, 21, 35b, 36, 38)
- [ ] T11 · backend · `nucleo/base-de-datos`: instancias de Sequelize de la API y de plataforma, `definirModelos`, adaptador CLS sobre `AsyncLocalStorage`, hooks `beforeQuery` en ambas instancias, verificación de roles al arrancar y mapeo de errores de PostgreSQL. (criterios 10, 22, 28)
- [ ] T12 · backend · `nucleo/contexto-empresa`: `ContextoEmpresa`, interceptor global, resolutores nulo y por cabecera elegidos por configuración, y `@SinEmpresa()`. (criterios 22 a 31)
- [ ] T13 · backend · `GET /health` con tiempo límite y sin detalles del error, más su prueba de integración (no protegida). (criterios 5, 6)
- [ ] T14 · backend · `OperacionPlataforma` y `PlataformaEmpresasService` (`registrarEmpresa`, `agregarEmisor`, `agregarSucursal`, `listarEmpresas`), con hora de corte `05:00` por defecto y sin crear suscripción. (criterios 28, 32 a 35, 35b)
- [ ] T15 · backend · `SucursalService` y `SucursalesController` (`GET /sucursales`, `GET /sucursales/:id`, `PATCH /sucursales/:id`). (criterios 11, 18, 39, 40)
- [ ] T16 · backend · Reglas de ESLint `no-restricted-imports` (conexión de plataforma) y `no-restricted-syntax` (`app.empresa_id`) en la configuración de `apps/api`. (criterio 37)
- [ ] T17 · backend · `pnpm db:semilla` con dos empresas de demostración (idempotente) y su inclusión en `pnpm local:preparar`. (criterios 2, 3)
- [ ] T18 · backend · `README.md`: requisitos, levantar en local con Docker (un comando), levantar con PostgreSQL nativo, correr pruebas, variables de entorno, la convención para tablas de empresa nuevas y la regla de usar `ContextoEmpresa.ejecutar` fuera de HTTP. (criterios 2, 3)
- [ ] T19 · tester · Suite completa, lint, verificación de tipos y `pnpm build` en todo el monorepo. (criterio 1)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas. Áreas sugeridas: fuga de contexto entre peticiones concurrentes y conexiones reutilizadas; consultas crudas o hooks que esquiven el bloqueo de `beforeQuery`; mezcla de las transacciones de API y plataforma; llaves foráneas, unicidad y mensajes de error como canal lateral; `SET`, `RESET` y `set_config` desde la conexión de la API; cabecera `x-empresa-id` en producción; arranque con roles privilegiados.
- [ ] El orquestador verifica con `git diff` que la fase C no tocó los archivos de la fase B.
