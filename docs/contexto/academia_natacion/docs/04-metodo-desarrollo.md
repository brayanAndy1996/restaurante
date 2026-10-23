# Método de desarrollo de la academia

Fecha: 2026-10-21. Instrucciones autónomas para trabajar desde este repositorio público, sin documentación de otros productos.

- Priorizar backend, arquitectura y reglas de negocio. Entregar frontend funcional mínimo; el otro desarrollador se ocupa del acabado visual.
- Mantener producto independiente desde cero; no crear/consumir CORE ni copiar módulos de otros productos.
- Usar los acuerdos, la operación/sincronización y el ADR propios. Stack: TypeScript, Next.js, React Native Android, Node.js/Sequelize, PostgreSQL y SQLite móvil propuesto. Completar versiones y evidencia antes de implementar la base ejecutable.
- Crear `docs/specs/NNN-nombre.md` antes de cada funcionalidad: objetivo/actores, alcance/exclusiones, reglas/permisos/ámbito, flujo/errores, datos/contratos/migraciones, aceptación numerada, riesgo, pruebas y decisiones pendientes.
- SDD por funcionalidad; TDD en dinero, acceso, sincronización y otras reglas críticas; integración en los límites reales y revisión adversarial según riesgo. Para cambios de bajo riesgo, revisión y humo proporcionales; no exigir pruebas que repitan la implementación.
- Validar reglas sensibles en backend, además de las comprobaciones locales necesarias para offline. Evitar sobrescrituras, duplicados y cruces de empresa/local. No registrar secretos en auditoría.
- Una funcionalidad termina cuando cumple aceptación, pasa comprobaciones pertinentes, tiene recorrido integrado mínimo y documentación/contratos actualizados. Informar resultados y límites; no declarar pruebas no ejecutadas.
- Migraciones versionadas, datos iniciales idempotentes y demo ficticia opcional/reproducible desde las primeras migraciones. Nunca cargar demo sobre instalaciones reales. Documentar comandos reales y probar desde BD vacía, con una segunda carga sin duplicados. Fixtures aislados; no usar la demo como BD de tests.
- Documentar instalación, variables de ejemplo sin secretos, migración, demo y ejecución para que el fundador pueda descargar y usar una carpeta independiente. Código, specs y decisiones se versionan juntos.
- Roles acordados: GPT-6.1 sol con esfuerzo medium para arquitectura, specs, lógica crítica y revisión adversarial; GPT-6 luna con esfuerzo max para implementación acotada, UI mínima, documentación y ejecución de casos definidos. Si Luna alcanza su límite, alternativa autorizada Sol low para sus tareas, informando. No afirmar cambios de modelo no realizados ni sustituir silenciosamente modelos.
- Publicar cambios del producto terminados y verificados en `brayanAndy1996/piscina`, sin secretos, BD locales, dependencias instaladas ni referencias internas de otros proyectos. Sin force push ni sobrescribir trabajo ajeno. El contexto interno generado no se publica.

## Comprobaciones de la base por definir

Tipos, lint, build, pruebas según riesgo y smoke integrado. PostgreSQL y SQLite requieren pruebas específicas; uno no demuestra equivalencia con el otro. Para offline, probar cola persistente, reintentos, límite de 24 horas, exclusividad de dispositivo y conflictos con nube. Probar cámara y persistencia en Android real antes de certificar compatibilidad.

La base v0.1.0 tiene comandos/checks documentados en README, spec 001 y ADR. No confundir sus pruebas técnicas con verificación del MVP de negocio.
