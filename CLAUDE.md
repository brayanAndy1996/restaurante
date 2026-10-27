# Software para restaurantes (SaaS multitenant)

Sistema en la nube para restaurantes pequeños del Perú, alquilado por sucursal. El diseño completo y los requerimientos viven en dos documentos compartidos:

- Documento de diseño: https://claude.ai/artifact/1YzRwiYqDapgyVCBsHK2Gd
- Requerimientos e historias de usuario (RF-XX, RNF-XX, HU-XX): https://claude.ai/artifact/SfRCerAMxTQsFNL23bTuQq

Ante cualquier duda de negocio, esos documentos mandan sobre la memoria o la intuición.

## Tu rol en la sesión principal: orquestador

La conversación principal es el **orquestador**. No implementa funcionalidades grandes por su cuenta: elige la historia de usuario, delega cada paso al subagente de su rol, integra los resultados y pide aprobación al usuario en los puntos marcados. Cada subagente trabaja con su propio contexto, así que el orquestador le pasa todo lo que necesita: la ruta de la especificación, los archivos relevantes y qué se espera de vuelta.

| Rol | Subagente | Modelo |
|---|---|---|
| Orquestador | sesión principal | Opus 5.5, alto |
| Especificador | `especificador` | Opus 5.5, alto |
| Adversarial | `adversarial` | Opus 5.5, alto |
| Backend | `backend` | Sonnet 5.5, alto |
| Frontend | `frontend` | Sonnet 5.5, alto |
| Test writer | `test-writer` | Sonnet 5.5, alto |
| Revisor | `revisor` | Sonnet 5.5, alto |
| Tester | `tester` | Haiku 5.5, max |
| Documentador | `documentador` | Haiku 5.5, max |

Los subagentes no lanzan otros subagentes: toda la coordinación pasa por el orquestador.

## Flujo de cada historia de usuario (SDD + TDD + pruebas adversariales)

1. **Especificación.** `especificador` escribe `specs/NNN-nombre/spec.md`, `plan.md` y `tasks.md` a partir de las plantillas de `specs/_plantillas/`, enlazando las RF y HU que cubre.
2. **Aprobación del usuario.** El orquestador muestra un resumen de la especificación y espera la aprobación del usuario antes de que se escriba código.
3. **Clasificación.** El orquestador marca en `spec.md` si la historia es de **ruta crítica** (lista abajo).
4. **Solo si es crítica, pruebas primero (TDD).** `test-writer` escribe las pruebas a partir de la especificación y de los contratos públicos, sin mirar la implementación de la historia. `tester` confirma que fallan por la razón esperada.
5. **Implementación.** `backend` y/o `frontend` implementan las tareas hasta que las pruebas pasen. Nunca modifican, borran ni debilitan las pruebas escritas por `test-writer`.
6. **Solo si es crítica, ataque.** `adversarial` recibe la especificación y el código, **no** el razonamiento ni las notas de quien implementó. Cada falla que reporte se convierte en una prueba nueva (la escribe `test-writer`) y se vuelve al paso 5.
7. **Revisión.** `revisor` compara el cambio con la especificación y estas convenciones; `tester` ejecuta toda la suite, el lint y la verificación de tipos.
8. **Cierre.** `documentador` hace el commit y actualiza la documentación del repositorio. El orquestador actualiza los documentos compartidos si cambió algún requerimiento.

Las historias **no críticas** se saltan los pasos 4 y 6 y llevan solo las pruebas que el desarrollador considere necesarias. TDD y pruebas adversariales no se aplican a todo, solo a la ruta crítica.

Para proteger las pruebas del paso 4, antes del paso 7 el orquestador revisa con `git diff` que ningún commit de implementación haya tocado esos archivos de prueba.

## Ruta crítica

- Aislamiento entre empresas (RLS): una empresa nunca ve datos de otra.
- Cálculo de montos: IGV, ICBPER, descuentos, redondeos y división de cuenta.
- Enviar comanda: ruteo por estación, descuento de stock (combos, modificadores y porciones) e idempotencia.
- Cobro y caja: varios medios de pago, vuelto, reportes X y Z, y el bloqueo del cierre con mesas o pedidos abiertos.
- Comprobantes: series y correlativos sin saltos ni duplicados (también con dos cajas a la vez), reintentos con el PSE y notas de crédito.
- Permisos: clave de supervisor, equipos vinculados y auditoría.
- Pedidos web: confirmación, vencimiento y protección contra pedidos falsos.

Fuera de la ruta crítica, por ejemplo: pantallas de reportes, mantenimiento simple de carta y usuarios, apariencia de la carta web y la web comercial.

## Arquitectura y convenciones

- **Monorepo** con pnpm y Turborepo: `apps/api` (NestJS + Sequelize + PostgreSQL, con el worker), `apps/app` (React + Vite, PWA), `apps/web` (Next.js: carta web y web comercial), `apps/puente-android` (Kotlin), y los paquetes `packages/dominio` (reglas puras compartidas), `packages/contratos` (esquemas zod), `packages/ui` y `packages/config`.
- **Monolito modular.** Cada módulo de `apps/api/src/modulos/` es dueño de sus tablas; los demás lo usan por su servicio, nunca consultando sus tablas.
- **Solo PostgreSQL:** datos, colas (pg-boss) y adaptador de Socket.IO. Nada de Redis salvo que se decida explícitamente.
- **Multitenancy con RLS:** cada tabla con datos de clientes lleva `empresa_id` y una política RLS. Cada petición corre en una transacción que fija la empresa con `SELECT fijar_contexto_empresa(…)`, una sola vez por transacción (la base rechaza un segundo intento); la RLS la lee con `empresa_actual()` y no depende de `app.empresa_id`. La API se conecta con un usuario sin permiso para saltarse RLS. PostgreSQL de producción es administrado, sin superusuario.
- **Reglas de negocio puras** (montos, división, estados, stock) en `packages/dominio`, usadas por la PWA y la API.
- **Montos** con `decimal.js` y columnas `NUMERIC`; nunca números de coma flotante.
- **Efectos secundarios** (imprimir, enviar al PSE, avisos en tiempo real) se registran dentro de la transacción y se ejecutan después de confirmarla.
- **Escrituras idempotentes:** las operaciones que cambian datos aceptan una clave de idempotencia.
- **Idioma del código:** nombres del dominio en español (`Orden`, `Comanda`, `Comprobante`), términos técnicos del framework en inglés (`controller`, `service`, `module`). Tablas en español con snake_case.
- **TypeScript en todo**, salvo el puente Android.
- **UI:** el rol `frontend` usa la skill `impeccable`. La app del restaurante es de tipo "Operate" (claridad y sobriedad); la web comercial es "Persuade".

## Pruebas

- Unitarias para `packages/dominio`.
- Integración de la API contra PostgreSQL real (no mocks de la base de datos).
- Una prueba obligatoria de aislamiento entre empresas.
- E2E con Playwright para los flujos críticos (abrir mesa, comandar, cobrar).

## Git

- Commits en español, descriptivos, con las líneas de atribución que indique la sesión.
- Nunca reescribir historia publicada (`--force`) ni saltarse hooks.
