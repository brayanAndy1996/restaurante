> **ARCHIVO HISTORICO — PROPUESTA DESCARTADA EL 2026-10-20.** El fundador decidio que cada software se construye desde cero con modulos propios. El texto anterior de esta propuesta, conservado debajo por trazabilidad, no es una instruccion vigente: no desarrollar, publicar ni consumir CORE ni esperar sus paquetes. Solo siguen vigentes la documentacion/metodologia global y las decisiones de cada producto. No hay implementacion CORE que deba migrarse.

# CORE — Núcleo compartido

Estado: **diseño y documentación; no existe código ni paquete publicado**. Carpeta local: `core/`. Repositorio GitHub, nombre de paquetes y registro privado pendientes de definir.

CORE proporciona capacidades reutilizables que el panel y los productos incorporan como dependencias versionadas. No es una aplicación comercial, una base central ni un servicio remoto obligatorio para operar offline.

## Leer primero

- [Contexto general](../CONTEXTO_GENERAL.md).
- [Metodología común](../METODOLOGIA.md).
- [Arquitectura transversal](../ARQUITECTURA_COMPARTIDA.md).
- [Datos de prueba](../DATOS_PRUEBA.md).
- [Stack y evaluación técnica](../STACK.md): TypeScript/Node.js para CORE y adaptadores Sequelize cuando se necesiten; sin frontend propio.

Estas copias se sincronizan desde la documentación global. No editarlas aquí.

## Documentación individual

| Documento | Contenido |
|---|---|
| [01 — Alcance y módulos](docs/01-alcance-modulos.md) | Qué pertenece a CORE, qué queda en cada producto y consumidores |
| [02 — Arquitectura](docs/02-arquitectura.md) | Paquetes, dependencias, contextos y composición |
| [03 — Contratos e integración](docs/03-contratos-integracion.md) | Identidad, autorización, auditoría, licencias y ejemplo de uso |
| [04 — Persistencia y versiones](docs/04-persistencia-versiones.md) | BD del consumidor, migraciones y actualización de paquetes |
| [05 — Verificación y datos](docs/05-verificacion-datos.md) | Pruebas, fixtures, integración y demo para consumidores |
| [06 — Ruta de desarrollo](docs/06-ruta-desarrollo.md) | Orden, decisiones pendientes y definición de entrega |
| [Specs](docs/specs/README.md) | Cómo especificar funcionalidades del núcleo |

## Primer alcance

Construir identidad, roles/permisos y auditoría a partir de necesidades reales del panel. Incorporar contratos comunes de licencia y su verificador cuando se construya activación. Caja, impresión y otros módulos se desarrollan al necesitarlos un consumidor real. La nube/sincronización se mantienen para después y la facturación para la última etapa.

No crear una interfaz propia del CORE: se demuestra mediante integración en un consumidor o un pequeño arnés de prueba. La UI funcional mínima pertenece al panel/producto. No crear un sistema de diseño compartido en esta fase.

## Estado ejecutable

No hay `package.json`, migraciones, comandos de build/test ni seeds ejecutables. No se inicializó Git ni se publicaron artefactos. Los ejemplos de paquetes/versiones de estos documentos son ilustrativos, no dependencias instalables.
