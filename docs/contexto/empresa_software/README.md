# Empresa de software – Plan

Empresa que alquila sistemas a negocios (pollerías, academias, ferreterías, boticas, cocheras, hoteles…) por suscripción mensual, más una plataforma central que administra a todos los clientes.

Actualizado: 2026-10-21. Estos documentos se van actualizando a medida que se toman decisiones. **Leer primero este archivo.**

Esta carpeta corresponde al **panel administrativo interno de la empresa**. Los sistemas de los negocios se crearán como proyectos separados dentro de la carpeta padre `proyectos/`.

Repositorio: [brayanAndy1996/panel_administrativo_empresa](https://github.com/brayanAndy1996/panel_administrativo_empresa). La rama local actual es `main` y `origin` está configurado. La consulta del 2026-10-20 confirmó que no había commits locales ni push y que el remoto no tenía referencias ni commits; la publicación del código fuente no constituye una release de distribución. Decisión del 2026-10-20: el panel y cada producto se construyen desde cero con módulos propios, sin CORE compartido.

Antes de este índice, leer el [contexto general compartido](../CONTEXTO_GENERAL.md). Los [requisitos provisionales de hardware](../HARDWARE.md) también son comunes a las aplicaciones de escritorio. Aquí se conserva la documentación inicial del negocio y las especificaciones del panel.

La [política de datos de prueba](../DATOS_PRUEBA.md) define cómo preparar BDs aisladas. El panel cuenta con un seed opcional de acceso v0.2.0; solo se ejecuta por comando explícito y el arranque normal no carga datos ni crea un propietario por defecto. El bootstrap de una instalación normal se realiza manualmente. No existe todavía una demo comercial con empresas, suscripciones o cobros.

La [documentación histórica de CORE](../core/README.md) corresponde a una propuesta descartada; no es dependencia ni bloqueo del panel. Las copias en `docs/contexto/` son generadas y permiten consultar decisiones y referencias documentales sin tener carpetas hermanas. Su `MANIFIESTO.json` registra origen y revisión; no editar esas copias. Sincronizar desde el espacio global antes de versionarlas.

La base técnica local está verificada según la [spec 001](docs/specs/001-base-ejecutable.md): Next.js/React estático en Electron, backend Node.js, Sequelize/SQLite, migración y diagnóstico técnico por IPC. La evaluación de stack y versiones está registrada en el [ADR 001](docs/decisiones/001-stack.md). La versión 0.2.0 implementa acceso, usuarios, roles/permisos y auditoría propios; su [spec 002](docs/specs/002-acceso-nativo.md) quedó terminada el 2026-10-21 tras verificación integrada. Los módulos comerciales —empresas, catálogo, contratos, cuotas, pagos, instalaciones y licencias— aún no están implementados. PostgreSQL, nube y sincronización pertenecen al diseño futuro.

El contrato actual de diagnóstico ya no incluye el campo `core`. La mención conservada en la spec 001 y en evidencia histórica no representa una dependencia vigente ni contradice la decisión de no usar CORE.

La UI de acceso v0.2.0 implementa los flujos definidos, con estados, errores, acciones e integración real con el backend. La verificación integrada de la spec 002 terminó; el E2E de acceso pasó y se revisó la captura de Usuarios, legible y sin secretos ni desbordamientos. La presentación es sencilla; no se añade trabajo de acabado visual sin petición explícita. Esto no implica que estén implementados los flujos comerciales.

## Desarrollo local

Usar Node.js 24.1.0 y npm 11.3.0, según los requisitos de `package.json`. Versiones fijadas para esta base: Next.js 16.4.2, React 19.3.1, Electron 44.9.0, Sequelize 6.37.8, `sqlite3` 6.0.1 y TypeScript 5.9.3; la decisión está en el [ADR 001](docs/decisiones/001-stack.md). Desde la raíz del repositorio:

```powershell
npm ci
npm run desktop:install
npm run dev
```

`npm run desktop:install` descarga el binario oficial de Electron si aún no está instalado; requiere internet durante esa preparación inicial y se ejecuta una vez por entorno de desarrollo. Después, la aplicación puede operar sin internet. `npm run dev` construye el frontend estático y los procesos Electron, y abre la app. `npm run check` ejecuta lint, tipos, tests y build; `npm run test:e2e` ejecuta Playwright. `npm run build` construye los artefactos sin abrir la aplicación. `npm run package:win` genera un instalador NSIS Windows x64; instalación y actualización del instalador siguen sin verificarse.

El seed de acceso es explícito y solo acepta una base dedicada fuera del repositorio. Para crearla y usarla:

```powershell
npm run db:seed:demo -- --database 'C:/ruta/panel-access-demo/panel-access-demo.sqlite3'
$env:PANEL_DB_PATH = 'C:/ruta/panel-access-demo/panel-access-demo.sqlite3'
npm run dev
```

El comando requiere la ruta absoluta con ese directorio y archivo finales. Rechaza una BD normal o sin marcador; repetirlo verifica la huella sin duplicar ni sobrescribir datos. Si se alteró manualmente el escenario, informa conflicto y no lo restaura. Usuarios: `owner.demo`, `cobranza.demo`, `consulta.demo` e `inactivo.demo`; contraseña pública exclusiva de la demo: `Demo-panel-2026-seguro`. El arranque normal no ejecuta el seed. Sin `PANEL_DB_PATH`, usa `app.getPath('userData')/panel.sqlite3` y muestra bootstrap manual si no hay usuarios; no crea un propietario ni credenciales por defecto.

La navegación usa `Link` de Next.js con `prefetch={false}` para evitar solicitudes a recursos segmentados que no forman parte de la exportación estática.

La aplicación crea o migra su SQLite normal en `app.getPath('userData')/panel.sqlite3`. En Windows el directorio se resuelve bajo `%APPDATA%`; el nombre final de carpeta debe confirmarse con la ejecución empaquetada. La CLI de migración manual exige especificar una ruta absoluta fuera del repositorio y no tiene destino predeterminado:

```powershell
npm run db:migrate -- --database "C:\ruta\absoluta\panel.sqlite3"
```

Sustituir el ejemplo por el destino local deseado. La CLI no selecciona base por defecto. Los tests usan SQLite temporal aislada; el seed actual cubre solo acceso, no datos comerciales.

## Verificación de la base técnica 0.1.0

- `npm ci` terminó con código 0 e instaló 537 paquetes; `npm run desktop:install` terminó con código 0.
- `npm run check` terminó con código 0: lint, tipos, 18 pruebas unitarias/de integración y build de Next/Electron.
- Playwright terminó con código 0 (1/1), sin internet ni errores en consola. El recorrido incluye la app Electron real y un harness sin preload; este muestra “Abre esta pantalla desde la aplicación de escritorio.” y no informa que la base de datos esté lista.
- `electron-builder --win --dir --x64` terminó con código 0. El smoke de `release/win-unpacked/Panel Administrativo.exe` confirmó `isPackaged: true`, versión 0.1.0 y SQLite real con `schemaVersion: 1`; también comprobó recarga y navegación sin internet y que cerrar la ventana cierra la aplicación.

El ejecutable comprobado de la base 0.1.0 estaba sin firma (`NotSigned`). No se verificaron el instalador NSIS ni actualizaciones, el hardware mínimo o una ejecución en CI remoto. Esta evidencia verifica la base técnica y no certifica la distribución comercial ni las funciones de v0.2.0.

## Acceso nativo 0.2.0

Implementa bootstrap de propietario, login/logout, cambio y recuperación/rotación de clave, sesiones, CRUD básico de usuarios, tres roles fijos con cuatro permisos de acceso, migración 2, auditoría append-only y frontend integrado. La migración conserva los metadatos de v1. Los detalles de contrato y criterios están en la [spec 002](docs/specs/002-acceso-nativo.md), terminada el 2026-10-21 tras completar su verificación integrada.

Verificación final local del 2026-10-21: `npm ci --no-audit --no-fund` instaló 542 paquetes con código 0 y `npm run desktop:install` también terminó con código 0. `npm run check` terminó con código 0 desde instalación limpia: lint, tipos, build y 48/48 pruebas de nueve archivos, sin omitidas. `npx playwright test --config=playwright.config.ts` pasó 2/2: E2E de acceso (~1,3 min) y smoke (1,1 s). `electron-builder --win --dir --x64` terminó con código 0. `node dist/smoke-packaged-auth.cjs` terminó con código 0 sobre Electron empaquetado (`isPackaged: true`, v0.2.0, Electron 44.9.0, Node 24.22.0, N-API 10, Windows x64): verificó Argon2id hash/verify y rechazo de contraseña incorrecta; migración SQLite v1→v2 preservando sentinel; dos usuarios y denegación del rol Consulta; rechazo del replay de recuperación; recarga y navegación offline; cierre al cerrar la última ventana; y solicitud de login al reabrir con sesiones revocadas en SQLite. La captura de Usuarios fue legible, sin secretos ni desbordamientos. El ejecutable de prueba sigue sin firma (`NotSigned`); este smoke no verifica el instalador NSIS ni el hardware mínimo.

## Documentos

| Archivo | Contenido |
|---|---|
| [docs/01-negocio.md](docs/01-negocio.md) | Modelo de negocio, rubros, precios, equipo |
| [docs/02-arquitectura.md](docs/02-arquitectura.md) | Local-first, nube, multi-tenant, licencias, stack |
| [docs/arquitectura.md](docs/arquitectura.md) | Arquitectura ejecutable de la base técnica local y límites de la entrega |
| [docs/decisiones/001-stack.md](docs/decisiones/001-stack.md) | Evaluación y versiones fijadas para la base local |
| [docs/specs/001-base-ejecutable.md](docs/specs/001-base-ejecutable.md) | Alcance, criterios de aceptación y verificación de la base ejecutable |
| [docs/specs/002-acceso-nativo.md](docs/specs/002-acceso-nativo.md) | Acceso, autorización, usuarios, auditoría, demo y criterios de verificación v0.2.0 |
| [docs/03-nucleo.md](docs/03-nucleo.md) | Módulos propios del panel; CORE descartado |
| [docs/04-facturacion-sunat.md](docs/04-facturacion-sunat.md) | Proveedores, precios, plazos, riesgos, preguntas para cotizar |
| [docs/05-panel-administrador.md](docs/05-panel-administrador.md) | El sistema con el que se administra la empresa |
| [docs/06-metodologia.md](docs/06-metodologia.md) | Enlace a la metodología compartida de desarrollo |
| [docs/07-contrato-frontend.md](docs/07-contrato-frontend.md) | Contrato de diseño API/IPC, DTOs, errores, dinero/fechas y operaciones |
| [docs/08-acceso-operacion.md](docs/08-acceso-operacion.md) | Propietario inicial, recuperación offline, backups, restauración y checks |
| [Arquitectura común documentada](../ARQUITECTURA_COMPARTIDA.md) | Software independiente, BD por instalación, multi-tenant e integración comercial |

## Decisiones tomadas

| Fecha | Decisión |
|---|---|
| 2026-10-17 | Arquitectura **local-first**: los negocios deben poder trabajar sin internet. |
| 2026-10-17 | Primeros sistemas: **pollería** y **academia de natación**. |
| 2026-10-17 | Histórico: se planteó plataforma genérica. Desde el 2026-10-20 cada software se desarrolla desde cero por rubro, conservando contratación modular por empresa. |
| 2026-10-17 | Histórico, sustituido el 2026-10-20: se planteó núcleo compartido. La decisión vigente exige módulos propios desde cero. Ver [03](docs/03-nucleo.md). |
| 2026-10-17 | Facturación SUNAT **a través de un proveedor** (PSE/OSE) al inicio, como módulo aparte con interfaz propia. Emisión propia: más adelante. |
| 2026-10-17 | ORM: **Sequelize** (TypeScript). SQLite en local, Postgres en la nube. |
| 2026-10-17 | Los proyectos anteriores (academia de natación) eran pruebas: se rehacen desde cero con la metodología definida aquí. |
| 2026-10-17 | Equipo: 2 personas (fundador: backend y arquitectura; otra persona: diseño y frontend). Objetivo: MVP para empezar a vender. |
| 2026-10-19 | Escritorio: **Electron**. Requisitos de instalación provisionales en el documento compartido de hardware. |
| 2026-10-19 | Contexto transversal en `../CONTEXTO_GENERAL.md`; este proyecto es el panel interno y los productos por rubro tendrán carpetas propias. |
| 2026-10-19 | Metodología compartida en `../METODOLOGIA.md`: SDD por funcionalidad, TDD en reglas críticas y pruebas adversariales según riesgo. |
| 2026-10-19 | Priorizar backend/arquitectura y frontend funcional mínimo. Maquetación a cargo principalmente del otro desarrollador. Roles de IA comunes: GPT-6.1 sol / medio para tareas complejas y GPT-6 luna / máximo para tareas acotadas. |
| 2026-10-19 | Histórico: se planteó un núcleo separado, descartado el 2026-10-20. Se mantienen contratación de módulos por empresa y temas/logos dentro del producto. |
| 2026-10-20 | Sin CORE: cada software se construye desde cero con módulos, pruebas, migraciones y versiones propios. El acceso y auditoría del panel se implementan localmente, sin paquetes compartidos. |
| 2026-10-19 | Solo Perú: PEN, precios con IGV incluido, ciclo mensual desde alta sin prorrateo automático y pagos parciales permitidos. |

## Ajustes de alcance (2026-10-19)

- Precio de entrada: **desde S/ 150 mensuales**. Falta definir qué incluye cada plan y sus límites.
- **Por ahora, desarrollo, ejecución y pruebas de todo en local**, incluido el panel administrador. La nube descrita en la arquitectura queda como objetivo posterior.
- **Facturación electrónica para la última etapa**: se posponen su implementación, integración y elección de proveedor. Esto incluye la facturación propia de las suscripciones.
- El primer MVP no incluye emisión de comprobantes electrónicos.

## Pendientes actualizados

- [x] Documentar la metodología compartida. Ver [metodología](../METODOLOGIA.md).

- [ ] Al llegar a la última etapa, cotizar con proveedores de facturación. Preguntas en [04](docs/04-facturacion-sunat.md).
- [x] Evaluar el stack y fijar versiones e integración Next.js-Electron en [ADR 001](docs/decisiones/001-stack.md); el build y smoke del artefacto Electron x64 están verificados. Instalador NSIS, actualización, firma y hardware mínimo siguen pendientes.
- [ ] Definir planes y límites con precio de entrada desde S/ 150/mes.
- [ ] Al abordar facturación, confirmar con un contador las reglas de SUNAT vigentes.
- [ ] Conseguir un negocio piloto.
