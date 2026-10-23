# 06 – Metodología de desarrollo

La metodología compartida se mantiene en la raíz de `proyectos/` y se distribuye aquí como [METODOLOGIA.md](../../METODOLOGIA.md). Este archivo conserva la referencia para quienes consultan la documentación del panel. El snapshot permite leerla en un checkout independiente; no editar la copia generada.

## Enfoque compartido

- SDD por funcionalidad, con criterios de aceptación antes de implementar.
- TDD en reglas críticas.
- Pruebas adversariales según riesgo y cierre explícito de hallazgos.
- Funcionalidades completas de punta a punta.

Las specs del panel se guardarán en `docs/specs/` dentro de este proyecto. Cada sistema por rubro tendrá sus propias specs y enlazará la misma metodología. La plantilla, clasificación de riesgo, ciclo de desarrollo y definición de terminada están en el documento compartido.
