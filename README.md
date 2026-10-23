# Restaurante

Sistema independiente de operación de restaurantes, multitenant y con datos aislados por empresa/local. Repositorio: [brayanAndy1996/restaurante](https://github.com/brayanAndy1996/restaurante).

## Alcance y estado

Desarrollo iniciado el 2026-10-22. Acceso multitenant v0.2.0 implementado y verificado: PostgreSQL, sesiones, permisos, usuarios, roles y auditoría, con interfaz mínima conectada. No es la primera versión comercial y todavía no permite operar ventas reales. Comandas, caja, sincronización, impresión y KDS se incorporan en entregas posteriores.

Acuerdos: nube habitual, continuidad mediante servidor local sin internet, primera instalación con un local, mozos con celulares/tablets, impresoras térmicas de red, inventario limitado a disponibilidad/cantidades. KDS también forma parte del producto. Primera versión comercial excluye facturación electrónica. Ver [alcance](docs/alcance.md), [stack](docs/decisiones/001-stack.md), [continuidad](docs/decisiones/002-continuidad.md) y [spec 001](docs/specs/001-base-tecnica.md).

## Contexto e instrucciones

Leer `AGENTS.md`, [contexto general](docs/contexto/CONTEXTO_GENERAL.md), [metodología](docs/contexto/METODOLOGIA.md), [stack compartido](docs/contexto/STACK.md) y [arquitectura compartida](docs/contexto/ARQUITECTURA_COMPARTIDA.md). Las excepciones del restaurante están en sus decisiones propias. Copias de otros proyectos son referencias y no autorizan reutilizar su implementación. Sin CORE ni dependencias de carpetas hermanas.

## Entorno y ejecución

Node.js 24 y npm 11; entorno de verificación Node 24.1.0/npm 11.3.0. Dependencias exactas en package-lock.json y decisión 001. Desde esta carpeta:

```powershell
npm ci
npm run check
npm start
```

Abrir `http://127.0.0.1:3000`. El backend sirve la API y la exportación de Next desde el mismo origen. `npm start` requiere `npm run build` previo (incluido en `check`). `npm run dev` compila la interfaz y arranca el backend en modo watch; los cambios del frontend requieren recompilar/reiniciar ese comando.

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Comprueba tipos de frontend/backend y pruebas. |
| `npm run lint` | Revisa código con ESLint. |
| `npm test` | Ejecuta contratos y casos negativos con node:test. |
| `npm run test:db` | Integración con PostgreSQL real dedicado, sin reemplazarlo por mocks. |
| `npm run test:adversarial` | Revisión independiente automatizada sobre otra empresa/fixtures propios. |
| `npm run smoke` | Comprueba el export real servido por backend; requiere build previo. |
| `npm run build` | Exporta Next y compila backend. |
| `npm run check` | Tipos, lint, build, contratos y smoke del artefacto. |
| `npm run check:all` | Check más integración y adversariales PostgreSQL, en secuencia. Requiere entorno de pruebas. |
| `npm start` | Sirve el artefacto compilado. |

Configuración por variables de entorno. Opcionalmente copiar `.env.example` a `.env`; el arranque lo carga mediante Node y conserva la prioridad de variables ya definidas en el proceso. También se pueden definir directamente en PowerShell:

```powershell
$env:RESTAURANTE_MODE = 'local'
$env:PORT = '3001'
npm start
```

`RESTAURANTE_MODE` acepta `cloud` (defecto) o `local`; `PORT` admite enteros 1–65535 (defecto 3000). Un valor inválido impide arrancar. El servidor escucha únicamente en `127.0.0.1`; no está habilitado para celulares/LAN ni expuesto a internet. Modo técnico no equivale a conmutación, autoridad de escritura ni conexión a una BD.

Contratos: `GET /api/health` confirma el proceso HTTP; las capacidades de acceso/persistencia requieren conexión válida con cuenta restringida. `GET /api/ready` comprueba disponibilidad de PostgreSQL. `GET /api/context` exige sesión válida y devuelve empresa, usuario, locales y permisos derivados del backend. Sin BD, mantiene el diagnóstico y deniega acceso. No se aceptan cabeceras de tenant/rol como autenticación.

## PostgreSQL y demo reproducible

Para desarrollo en Windows: PostgreSQL 17 instalado (binarios por defecto en `C:\Program Files\PostgreSQL\17\bin`) y PowerShell 7. Desde esta carpeta:

```powershell
npm ci
npm run db:local
npm run db:migrate -- --demo
npm run db:seed:demo
npm run db:seed:demo
npm run check:all
npm start
```

`db:local` crea un cluster dedicado en `.local/postgres`, puerto 55432 y autenticación SCRAM, con bases `restaurante_demo` y `restaurante_test`. Genera secretos aleatorios en `.env` (runtime), `.env.admin` (CLI) y `.env.test` (pruebas); Git los ignora. No altera el servicio PostgreSQL instalado ni borra bases. Rechaza sobrescribir archivos de configuración distintos. Ruta alternativa de binarios: ejecutar `./scripts/local-postgres.ps1 -PostgresBin 'D:\PostgreSQL\bin'` directamente.

Las migraciones no crean cuentas automáticamente. El seed solo admite la BD loopback `restaurante_demo` con marcador demo, identificadores estables y carga transaccional. Repetirlo sin cambios no duplica registros. Si se modificaron usuarios, claves, roles o locales manualmente, aborta sin sobrescribirlos. No existe reset automático ni debe usarse esta BD para datos reales. Los tests usan exclusivamente `restaurante_test`, validan su destino y nunca dependen de la demo. Ejecutar las suites de BD secuencialmente como hace `check:all`.

| Empresa ficticia | Usuarios | Clave exclusiva de demo |
|---|---|---|
| `demo-a` | `admin`, `consulta`, `inactivo` | `RestauranteDemo2026!` |
| `demo-b` | `admin`, `consulta`, `inactivo` | `RestauranteDemo2026!` |

`admin` administra su empresa; `consulta` solo consulta auditoría; `inactivo` no puede entrar. Demo A tiene dos locales y demo B uno. La aplicación no siembra datos ni crea administradores durante su arranque. Sus claves ficticias no se emplean en instalaciones reales.

## Alta y seguridad de acceso

Para una BD normal vacía, provisionar roles de PostgreSQL y configurar `MIGRATION_DATABASE_URL` únicamente para CLI. `npm run db:migrate` aplica esquema normal sin demo. `npm run tenant:bootstrap` solicita empresa, primer local, usuario y contraseña oculta con confirmación en terminal interactiva. No acepta claves por argumentos ni restablece tenants existentes. En Windows, el helper de desarrollo provisiona los roles `restaurante_runtime` y `restaurante_auth_lookup`; fuera de ese entorno, reproducir sus privilegios y usar una cuenta de migración separada. Ver [decisión 003](docs/decisiones/003-persistencia-acceso.md) y [spec 002](docs/specs/002-acceso-multitenant.md).

El proceso HTTP solo recibe `DATABASE_URL` de runtime y `AUTH_HMAC_SECRET` aleatorio de al menos 32 bytes. Rechaza cuentas propietarias/privilegiadas y la presencia de la URI de migración. Login por empresa y usuario, Argon2id, cookie HttpOnly y token CSRF en memoria. Sesión de 12 horas máximo y 30 minutos de inactividad. Cambiar contraseña, estado o acceso invalida las sesiones afectadas. Administradores no pueden dejar al tenant sin administrador activo ni conceder permisos superiores a los propios. No existe recuperación pública ni acceso de soporte por suplantación.

Modo `local` conserva únicamente diagnóstico en esta entrega. TLS, exposición móvil/LAN, hosting, SQLite, identidad offline, instalación y continuidad siguen pendientes. Que el modo técnico indique Nube no significa que exista un despliegue público. El servidor continúa escuchando solo en loopback.

## Verificación y siguiente entrega

v0.2.0: `npm run check:all` pasó tipos, lint, build, 11 pruebas unitarias/HTTP, 1 smoke y dos suites con PostgreSQL real que verifican 12 escenarios de integración y 11 adversariales independientes. Sin pruebas omitidas. El smoke CLI confirmó alta con contraseña oculta; el navegador confirmó login/logout, permisos de consulta, usuario desactivado y ámbitos separados de ambas empresas. Evidencia y límites en spec 002.

Histórico v0.1.0: tipos, lint, build, 7/7 contratos y 1/1 smoke del export pasaron. QA de navegador comprobó consulta, reintento, caída del backend y recuperación. Revisión independiente corrigió y volvió a probar dos bypass de archivos estáticos en Windows (ADS/junctions). Evidencia en spec 001. Tooling: ESLint 10.10.0, @eslint/js 10.0.1 y typescript-eslint 8.69.0.

Siguiente recorrido previsto: carta y salón (productos, disponibilidad/cantidades, mesas y apertura de atención), mediante una nueva spec antes del código. La estrategia de conmutación offline sigue siendo borrador técnico en ADR 002, sin promesa de activación segura por un simple timeout.

## Sincronización documental

Desde la raíz del espacio `proyectos`, ejecutar `./herramientas/Sincronizar-Contexto.ps1` y luego `./herramientas/Sincronizar-Contexto.ps1 -Check`. Versionar `docs/contexto/`; no editar snapshots. Un clon independiente puede leerlos sin acceder a carpetas hermanas. Regenerarlos requiere la fuente documental completa.
