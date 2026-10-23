# Stack por defecto y revisión por proyecto

Excepción documentada de producto (2026-10-21): [academia de natación](academia_natacion/README.md) usa nube y Android React Native, sin PC principal/Electron. Su primera entrega incluye offline y sincronización, con PostgreSQL servidor y SQLite móvil propuesto. Sus reglas de mensualidades y cobros son propias; no sustituyen las suscripciones del panel. Las referencias a escritorio local, nube futura o sincronización pospuesta en este documento no aplazan ese alcance autorizado.


Decisión del fundador: 2026-10-19, actualizada el 2026-10-21. Aplica al panel y todos los desarrollos independientes futuros. CORE está descartado; cada software implementa sus módulos desde cero. Este documento establece preferencias y criterios; no instala dependencias ni fija versiones globales.

## Base tecnológica

| Capa | Por defecto | Aplicación |
|---|---|---|
| Lenguaje | TypeScript | Frontend, backend y módulos propios de cada software |
| Frontend | Next.js / React | Interfaces de aplicaciones con UI |
| Backend | Node.js | Servicios y casos de uso; framework HTTP por evaluar si hace falta |
| ORM | Sequelize | Adaptadores de persistencia; versión e integración TypeScript por validar |
| BD de servidor | PostgreSQL | Servicios web/nube y proyectos que requieran una BD servidor |
| Escritorio | Electron | Decisión vigente para productos de escritorio |
| BD embebida offline | SQLite | Decisión vigente para las instalaciones locales actuales, incluido el panel |

Next.js, Node.js, Sequelize y PostgreSQL son el punto de partida preferido del equipo, **no una obligación cuando contradigan requisitos**. PostgreSQL puede ejecutarse en una máquina local, pero exigir un servicio de BD por instalación cambia operación/soporte respecto al SQLite embebido previsto. La preferencia no sustituye silenciosamente esa decisión local existente.

Node.js es el runtime elegido para backend, no una elección automática de NestJS, Express o Fastify. Evaluar el framework y transporte solo cuando los casos de uso lo requieran. No es obligatorio crear un servidor HTTP independiente para una aplicación que solo necesita IPC.

## Revisión al diseñar cada software

Antes de iniciar su implementación, registrar `docs/decisiones/001-stack.md` en el proyecto. Contenido mínimo:

1. Requisitos: escritorio/web, operación offline, terminales LAN, periféricos, volumen/concurrencia, seguridad, instalación y hardware objetivo.
2. Adecuación de la base por capa: ventajas concretas y limitaciones para esos requisitos, considerando experiencia del equipo y costo de mantenimiento.
3. Versiones soportadas y compatibilidad: runtime, framework, ORM, drivers, Electron, sistema operativo y dependencias nativas. Verificar documentación oficial vigente al tomar la decisión.
4. Alternativas solo para capas con una limitación relevante o incertidumbre. No hacer una investigación extensa ni cambiar tecnología por novedad.
5. Evidencia necesaria: una prueba técnica pequeña si hay duda de empaquetado, ejecución offline, rutas, drivers o rendimiento. Un servidor de desarrollo funcionando no demuestra compatibilidad del instalador.
6. Decisión: conservar la base o documentar excepción, motivo, impacto, verificación y consecuencias para módulos e integraciones de ese software.

“Mejor stack” significa el más adecuado a los requisitos y al equipo, no una superioridad universal. Mantener el stack preferido si cumple. Si una alternativa exige cambiar una decisión del fundador o un requisito del producto, presentar la justificación y resolverla antes de implementar esa parte. Las elecciones rutinarias dentro de la base autorizada no requieren una aprobación por cada dependencia.

Revisar de nuevo cuando cambien requisitos importantes o exista un problema medido, no en cada funcionalidad de rutina. La evaluación no justifica invertir en maquetación adicional.

## Next.js y escritorio local

Evaluar dos formas, sin dar ninguna por validada todavía:

- Frontend exportado como archivos estáticos que consume el backend Node/IPC. Verificar rutas, carga de recursos y acceso a preload en el artefacto empaquetado.
- Servidor Next.js local incluido/gestionado por el instalador, si se justifican funciones que necesitan servidor. Evaluar arranque, puertos, recursos y mantenimiento; no depender de un servidor remoto para operar offline.

La exportación estática no soporta funciones que requieren servidor en tiempo de ejecución, como Server Actions y rutas dinámicas sin resolver en build. No diseñar esos flujos suponiendo que funcionarán al copiar el frontend a Electron. Referencia: [Next.js, exportación estática](https://nextjs.org/docs/app/guides/static-exports).

Electron dispone de un proceso principal con Node.js; mantener la UI y el acceso privilegiado separados mediante la fachada autorizada. La distribución de trabajo entre procesos y la necesidad de un servicio LAN se validan por producto. Referencia: [Electron, modelo de procesos](https://www.electronjs.org/docs/latest/tutorial/process-model).

No agregar API Routes/Server Actions como un segundo backend de negocio por comodidad del frontend. Los casos de uso y reglas permanecen en el backend propio de cada software; los adaptadores Next/IPC/HTTP de esa aplicación no duplican su lógica.

## Módulos propios de cada software

Cada aplicación organiza sus módulos internos y contratos separando reglas, persistencia, transporte y UI. No crea ni consume un paquete CORE de la empresa. Esta decisión no prohíbe dependencias de terceros del stack ni reutilización interna dentro del mismo producto.

Revisar versiones, empaquetado y límites entre módulos dentro de cada proyecto. Cada motor se valida por separado al soportarlo; usar el mismo ORM en varios productos no garantiza SQL, transacciones o migraciones equivalentes.

## Situación actual

Stack preferido registrado. El panel tiene versiones y modo Next.js/Electron fijados en su ADR 001; usa TypeScript, Node.js, Sequelize y SQLite dentro de Electron. La base técnica y los módulos de acceso v0.2.0 quedaron verificados el 2026-10-21: `npm run check` pasó con 48/48 pruebas, Playwright pasó 2/2 y el smoke Argon2id/SQLite del paquete Electron Windows x64 pasó. El instalador NSIS firmado y la validación del hardware mínimo siguen pendientes. Las decisiones ejecutables de otros proyectos —versiones, integración, drivers, pruebas y empaquetado— siguen pendientes y deben evaluarse por separado.
