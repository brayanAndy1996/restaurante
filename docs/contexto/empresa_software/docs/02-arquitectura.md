# 02 – Arquitectura

Decisiones transversales: [contexto general](../../CONTEXTO_GENERAL.md). Instalación: [hardware y validación](../../HARDWARE.md). Este proyecto corresponde al panel administrativo; los sistemas por rubro serán proyectos separados.

La separación física de proyectos/BD, activación y distribución se define en [arquitectura común documentada](../../ARQUITECTURA_COMPARTIDA.md). Decisión del 2026-10-20: cada aplicación implementa desde cero sus módulos. CORE queda descartado y su documentación solo se conserva como archivo histórico.

## Estado de implementación (actualizado 2026-10-21)

La base técnica local está verificada según la [spec 001](specs/001-base-ejecutable.md). Incluye Next.js/React exportado estáticamente, Electron, backend Node.js, Sequelize/SQLite, migración técnica y consulta del estado por IPC. La composición y las versiones están fijadas en el [ADR 001](decisiones/001-stack.md). El README registra los resultados de checks, Playwright y smoke empaquetado, junto con los límites de distribución.

El acceso, usuarios/roles, permisos y auditoría propios ya se implementaron en v0.2.0; la verificación integrada de la [spec 002](specs/002-acceso-nativo.md) terminó el 2026-10-21. Pasaron lint, tipos, build, 48 pruebas, Playwright (2/2), empaquetado Electron Windows x64 y smoke Argon2id/SQLite contra el artefacto. Empresas, catálogo, suscripciones, pagos, licencias y demás operaciones comerciales permanecen como diseño y trabajo posterior. La base técnica y la existencia de estos módulos de acceso no implican que esas funciones comerciales existan ni dependen de CORE.

## Alcance de operación actual

Por ahora, todo se desarrolla, ejecuta y prueba **en local**, incluido el panel administrador. No se requiere desplegar servicios en la nube en esta etapa. El esquema de nube de este documento es el objetivo posterior; la sincronización con la nube se implementará cuando se aborde esa etapa.

La facturación electrónica y su proveedor se dejan para la última etapa.

## Principio: local-first

Muchos negocios no tienen buen internet. El negocio trabaja contra una **base de datos local** y sincroniza con la nube cuando hay conexión.

```
┌─────────────────────────── NUBE ───────────────────────────┐
│  Panel administrador          │  API de sincronización      │
│  - clientes, planes, pagos    │  - recibe/envía datos       │
│  - licencias, métricas        │  - entrega licencias        │
│  Servicio de facturación      │  Backups por cliente        │
│  BD del panel separada; BD operativas por producto         │
│  Postgres por producto: tenant_id + seguridad por fila      │
└─────────────────────────────────────────────────────────────┘
                    ↕ (cuando hay internet)
┌──────────────────── EN CADA NEGOCIO ───────────────────────┐
│  App de escritorio = servidor local + BD local (SQLite)     │
│  Módulos propios del sistema (pollería, academia, …)        │
│  Terminales en red local: caja, cocina, tablets             │
└─────────────────────────────────────────────────────────────┘
```

- **PC principal del local**: app de escritorio con BD local; hace de servidor en la red local.
- **Otras terminales** (cocina, tablets de mozos): se conectan a la PC principal por la red local. No necesitan internet.
- **App de escritorio** (no solo web): necesaria para impresoras térmicas, cajón de dinero y comanderas.

## Licencia y morosidad sin internet

- Fase local: el panel emite y exporta una licencia firmada; el producto la importa. La nube futura automatizará ese intercambio.
- La licencia vincula empresa, producto, local, instalación, módulos, límites y vigencia. El local solo recibe la clave pública de verificación.
- Duración, gracia y modo de solo lectura se especificarán antes de implementar. Mantener respaldo/exportación autenticados y no borrar datos por mora.
- Una suspensión no se propaga inmediatamente a un equipo desconectado; se aplica al renovar/importar estado o vencer la licencia vigente. Una firma no resuelve por sí sola copia de disco o manipulación del reloj.

## Restricción de SUNAT sobre el modo offline

Facturación queda para la última etapa. Sus plazos y requisitos deben validarse entonces con fuentes oficiales y contador; las cifras de [04](04-facturacion-sunat.md) son referencias históricas no verificadas para implementar.

## Multi-tenant en la nube

- BD administrativa separada. Objetivo futuro: una BD lógica PostgreSQL por producto, compartida entre sus empresas con `tenant_id` en datos de tenant y `site_id` donde corresponda.
- Autorización, relaciones/consultas acotadas y políticas de seguridad por fila. La identidad del tenant se deriva del contexto autorizado, no de un campo confiado al frontend. Tablas de catálogo global se diseñan por separado.
- No es necesario crear una BD por empresa en nube; en local sí hay una SQLite operativa por instalación. Ninguna de estas políticas de nube está implementada todavía.

## Stack

| Capa | Decisión |
|---|---|
| Lenguaje | TypeScript 5.9.3 |
| ORM | **Sequelize 6.37.8**, con tipos TypeScript nativos; lectura de estado verificada con SQLite real en el smoke Electron x64. |
| BD local | SQLite mediante `sqlite3` 6.0.1 |
| BD nube | PostgreSQL queda en el diseño futuro; no se prepara ni conecta en esta etapa. |
| Escritorio | **Electron 44.9.0**; requisitos provisionales en el documento compartido de hardware. |
| Backend | **Node.js 24.1.0** para herramientas locales; backend sin framework HTTP, integrado al proceso principal. El runtime de Electron quedó ejercitado con SQLite en el smoke del artefacto x64. |
| Frontend | **Next.js 16.4.2 / React 19.3.1**, exportación estática para `app://panel/`. |
| Gestor de paquetes local | npm 11.3.0; versiones exactas y `package-lock.json` definidos para la instalación reproducible. |

La evaluación requerida por la [política común](../../STACK.md) está registrada en [ADR 001](decisiones/001-stack.md). El build y el smoke del artefacto x64 confirmaron carga estática, Electron empaquetado y acceso SQLite real. No se han verificado instalación/actualización NSIS, firma de código ni compatibilidad en el hardware mínimo.
