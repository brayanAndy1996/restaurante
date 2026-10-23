# 03 — Módulos propios del panel, sin CORE

Decisión vigente: 2026-10-20. Cada software se construye desde cero con módulos propios. CORE compartido queda descartado; su carpeta/documentación es solo archivo histórico y no es dependencia ni bloqueo del panel.

## Responsabilidades del panel

En la versión 0.2.0 el panel ya implementa sus módulos propios de acceso: bootstrap del propietario, autenticación, recuperación y rotación de clave, cambio de contraseña, sesiones, usuarios, roles fijos, permisos y auditoría. `owner` recibe los cuatro permisos de acceso administrativo; `collections` y `viewer` no reciben permisos para administrar usuarios, roles ni auditoría en esta entrega. La [spec 002 de acceso nativo](specs/002-acceso-nativo.md) quedó terminada el 2026-10-21: pasaron lint, tipos, build, 48 pruebas, Playwright (2/2), empaquetado Electron Windows x64 y smoke Argon2id/SQLite contra el artefacto.

Los módulos comerciales —empresas/locales, catálogo, planes, suscripciones, cuotas, pagos, instalaciones y emisión de licencias— permanecen pendientes. Se definirán y verificarán funcionalidad por funcionalidad con SDD, TDD y pruebas adversariales según riesgo; no se consideran parte de la implementación de acceso.

No esperar paquetes CORE, copiar módulos de otro producto ni trasladar aquí ventas, mesas, alumnos o temas/logos de los negocios. Se permite organizar/reutilizar código entre módulos internos del mismo panel y usar librerías de terceros del stack.

## Integracion con los productos

Cada producto implementa sus propios usuarios, permisos, auditoría, verificación de licencia y módulos de rubro. Panel y productos pueden acordar formatos/API versionados, por ejemplo la licencia firmada, y verificar compatibilidad entre implementaciones independientes. No se requiere una biblioteca común ni se comparten cuentas o BD.

El panel conservará la clave privada para emitir licencias; los productos solo verificarán con las claves públicas autorizadas. El alcance comercial de los módulos se gestionará en el panel; colores y logos se configuran en cada producto.

## Continuidad

La base técnica y los módulos de acceso v0.2.0 se conservan como implementación propia del panel. El contrato actual de diagnóstico ya no expone un campo `core`; la mención en la spec 001 y el ADR asociado es evidencia histórica de la base anterior y se mantiene sin cambios. La verificación de acceso quedó cerrada; el siguiente trabajo funcional puede avanzar a specs comerciales, sin dependencia de CORE.

Consultar el [contexto vigente](../../CONTEXTO_GENERAL.md), la [arquitectura documentada](../../ARQUITECTURA_COMPARTIDA.md) y la [metodología](../../METODOLOGIA.md). Nube/sincronización siguen pospuestas y facturación permanece para la última etapa.
