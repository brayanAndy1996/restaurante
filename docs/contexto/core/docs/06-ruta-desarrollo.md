> **ARCHIVO HISTORICO — PROPUESTA DESCARTADA EL 2026-10-20.** El fundador decidio que cada software se construye desde cero con modulos propios. El texto anterior de esta propuesta, conservado debajo por trazabilidad, no es una instruccion vigente: no desarrollar, publicar ni consumir CORE ni esperar sus paquetes. Solo siguen vigentes la documentacion/metodologia global y las decisiones de cada producto. No hay implementacion CORE que deba migrarse.

# 06 — Ruta de desarrollo

## Primera entrega útil

1. Revisar el stack TypeScript/Node.js y adaptadores según la [política global](../../STACK.md), registrando `docs/decisiones/001-stack.md`. Definir repositorio remoto, versiones, gestor de paquetes, estructura y nombres de paquetes privados. Preparar tipos, build y tests, sin elegir una UI para CORE.
2. Escribir specs pequeñas de identidad/usuarios, roles/permisos y auditoría a partir del primer recorrido del panel. Precisar bootstrap, sesiones, recuperación y persistencia donde se requieran.
3. Implementar y probar las reglas críticas y su adaptador SQLite, integrando progresivamente el panel. No fabricar todo el dominio del panel dentro de CORE.
4. Publicar/integrar una versión inicial cuando el paquete y el consumidor estén verificados; documentar matriz de compatibilidad.
5. Cuando se aborde activación, definir formato de licencia y verificador, coordinados con el emisor administrativo.

Después: caja e impresión según necesidades del primer producto real. Nube/sincronización después del alcance local y facturación en la última etapa. Clientes operativos se extraen solo si la coincidencia de comportamiento lo justifica.

## Pendientes antes de programar

- URL del repositorio de CORE, registro privado, nombres y runtime/gestor de paquetes.
- Tipos ejecutables, persistencia concreta y contratos por funcionalidad.
- Política de licencia (vigencia, gracia, reloj, reinstalación y revisiones).
- Fuente remota definitiva de documentación global. Los snapshots locales ya pueden generarse, pero no se ha publicado un repositorio común.

## Criterio de entrega de una capacidad

Spec actualizada; pruebas proporcionales al riesgo; hallazgos adversariales que bloquean resueltos; API y migraciones documentadas; consumidor o arnés identificado; release y compatibilidad trazables. Para declarar integración de producto, probar ese producto real.

La creación actual cumple únicamente organización y documentación. No se deben crear comandos de ejemplo que aparenten instalar un paquete todavía inexistente.
