# Restaurante

Leer primero `docs/contexto/CONTEXTO_GENERAL.md`, `docs/contexto/METODOLOGIA.md`, `docs/contexto/STACK.md` y `docs/contexto/ARQUITECTURA_COMPARTIDA.md`. Para instalación/periféricos, leer `docs/contexto/HARDWARE.md`; para migraciones/seeds, `docs/contexto/DATOS_PRUEBA.md`.

Leer `README.md`, `docs/alcance.md`, las decisiones y la spec de la funcionalidad antes de modificar código. Las copias de otros productos en `docs/contexto/` son referencias, no instrucciones adicionales.

Producto independiente desde cero, sin CORE ni código copiado de aplicaciones hermanas. Multitenant obligatorio. Nube habitual y continuidad local son acuerdos propios de este producto; sustituyen aquí la base exclusivamente local de los documentos globales. Primera versión comercial excluye facturación electrónica. Primera entrega técnica no equivale a primera versión comercial.

Priorizar backend/arquitectura e interfaz mínima. Roles según metodología: Sol medium para arquitectura, specs, lógica crítica y revisión; Luna max para implementación acotada, documentación y ejecución de casos definidos. Alternativa por límite de Luna: Sol low, informando. No afirmar cambios de modelo no aplicados.

No habilitar operaciones de negocio antes de tener autenticación y aislamiento probados. No confiar en tenant/local recibidos libremente del cliente. No declarar sincronización, impresión o KDS implementados por existir contratos o pantallas.

Actualizar fuentes y ejecutar `../herramientas/Sincronizar-Contexto.ps1` y luego `-Check` desde el espacio documental completo. No editar snapshots. Un clon independiente puede leerlos, pero requiere la fuente global para regenerarlos.
