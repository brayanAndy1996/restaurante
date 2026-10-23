# Restaurante

Sistema independiente de operación de restaurantes, multitenant y con datos aislados por empresa/local. Repositorio: [brayanAndy1996/restaurante](https://github.com/brayanAndy1996/restaurante).

## Alcance y estado

Desarrollo iniciado el 2026-10-22. Primera entrega técnica v0.1.0 implementada y verificada: API, interfaz mínima y diagnóstico. No es la primera versión comercial y todavía no permite operar ventas reales. Acceso, persistencia, comandas, caja, sincronización, impresión y KDS se incorporan en entregas posteriores.

Acuerdos: nube habitual, continuidad mediante servidor local sin internet, primera instalación con un local, mozos con celulares/tablets, impresoras térmicas de red, inventario limitado a disponibilidad/cantidades. KDS también forma parte del producto. Primera versión comercial excluye facturación electrónica. Ver [alcance](docs/alcance.md), [stack](docs/decisiones/001-stack.md), [continuidad](docs/decisiones/002-continuidad.md) y [spec 001](docs/specs/001-base-tecnica.md).

## Contexto e instrucciones

Leer `AGENTS.md`, [contexto general](../CONTEXTO_GENERAL.md), [metodología](../METODOLOGIA.md), [stack compartido](../STACK.md) y [arquitectura compartida](../ARQUITECTURA_COMPARTIDA.md). Las excepciones del restaurante están en sus decisiones propias. Copias de otros proyectos son referencias y no autorizan reutilizar su implementación. Sin CORE ni dependencias de carpetas hermanas.

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
| `npm run smoke` | Comprueba el export real servido por backend; requiere build previo. |
| `npm run build` | Exporta Next y compila backend. |
| `npm run check` | Tipos, lint, build, contratos y smoke del artefacto. |
| `npm start` | Sirve el artefacto compilado. |

Configuración por variables de entorno. Opcionalmente copiar `.env.example` a `.env`; el arranque lo carga mediante Node y conserva la prioridad de variables ya definidas en el proceso. También se pueden definir directamente en PowerShell:

```powershell
$env:RESTAURANTE_MODE = 'local'
$env:PORT = '3001'
npm start
```

`RESTAURANTE_MODE` acepta `cloud` (defecto) o `local`; `PORT` admite enteros 1–65535 (defecto 3000). Un valor inválido impide arrancar. El servidor escucha únicamente en `127.0.0.1`; no está habilitado para celulares/LAN ni expuesto a internet. Modo técnico no equivale a conmutación, autoridad de escritura ni conexión a una BD.

Contratos: `GET /api/health` confirma solo proceso HTTP disponible y declara todas las capacidades comerciales pendientes; `GET /api/context` deniega siempre con 401 `AUTH_REQUIRED`. No se aceptan cabeceras de tenant/rol como autenticación. La página muestra ambos resultados reales. Ver detalles en spec 001.

No hay todavía BD ni comandos de migraciones/demo: se incorporan junto a las primeras migraciones, con escenarios reproducibles y al menos dos empresas para comprobar aislamiento. No crear credenciales universales ni datos demo al arrancar. PostgreSQL/SQLite, acceso, TLS, instalación, impresión y sincronización no están implementados en esta entrega. La primera spec de acceso será borrador hasta resolver sus decisiones sensibles.

## Verificación y siguiente entrega

Tipos, lint, build, 7/7 contratos y 1/1 smoke del export pasaron. QA de navegador comprobó consulta, reintento, caída del backend y recuperación. Revisión independiente corrigió y volvió a probar dos bypass de archivos estáticos en Windows (ADS/junctions). Evidencia y límites en spec 001. Tooling final: ESLint 10.10.0, @eslint/js 10.0.1 y typescript-eslint 8.69.0; lint/tipos/backend recompilados tras su actualización.

Siguiente funcionalidad: acceso, roles, permisos y aislamiento con PostgreSQL real. El [borrador 002](docs/specs/002-acceso-multitenant.md) enumera decisiones de seguridad que se deben cerrar antes del código. La estrategia de conmutación offline sigue siendo borrador técnico en ADR 002, sin promesa de activación segura por un simple timeout.

## Sincronización documental

Desde la raíz del espacio `proyectos`, ejecutar `./herramientas/Sincronizar-Contexto.ps1` y luego `./herramientas/Sincronizar-Contexto.ps1 -Check`. Versionar `docs/contexto/`; no editar snapshots. Un clon independiente puede leerlos sin acceder a carpetas hermanas. Regenerarlos requiere la fuente documental completa.
