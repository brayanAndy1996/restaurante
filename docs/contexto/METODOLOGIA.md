# Metodología de desarrollo compartida

Excepción documentada de producto (2026-10-21): [academia de natación](academia_natacion/README.md) usa nube y Android React Native, sin PC principal/Electron. Su primera entrega incluye offline y sincronización, con PostgreSQL servidor y SQLite móvil propuesto. Sus reglas de mensualidades y cobros son propias; no sustituyen las suscripciones del panel. Las referencias a escritorio local, nube futura o sincronización pospuesta en este documento no aplazan ese alcance autorizado.


Actualizado: 2026-10-21. Base de trabajo para el panel y los sistemas independientes por rubro. Complementa el [contexto general](CONTEXTO_GENERAL.md).

Esta metodología se aplica a **todos los desarrollos de esta carpeta**, incluidos proyectos futuros. La prioridad del trabajo con el fundador es backend y arquitectura; cada versión debe incluir un frontend funcional mínimo. La maquetación y el acabado visual corresponden principalmente al otro desarrollador.

Cada software se construye desde cero con módulos propios. No se desarrolla ni consume CORE; compartir esta metodología, criterios y documentación no implica compartir paquetes o implementaciones entre productos. La propuesta anterior de CORE queda descartada.

## Enfoque

**SDD por funcionalidad, TDD para reglas críticas y pruebas adversariales según riesgo.** Entregar funcionalidades pequeñas y completas, con documentación y verificación proporcionales al impacto.

- SDD (Specification-Driven Development): definir el comportamiento esperado antes de programar.
- TDD (Test-Driven Development): escribir una prueba que falle por la ausencia de ese comportamiento, implementar lo necesario para que pase y refactorizar manteniendo las pruebas.
- Pruebas adversariales: intentar romper reglas, saltarse controles y provocar estados inconsistentes, buscando también casos omitidos en la spec.

La spec define qué debe ocurrir; TDD guía la implementación de reglas; las pruebas adversariales buscan fallos y omisiones. Ninguna práctica garantiza por sí sola ausencia de errores.

## 1. Mapa inicial de cada aplicación

Mantener un mapa breve con módulos propios, funcionalidades, dependencias internas y alcance del MVP. No esperar paquetes de otro proyecto para comenzar. Priorizar recorridos completos: registrar un cliente y consultar su ficha, por ejemplo, antes de construir todas las tablas.

El trabajo actual sigue siendo local. La nube y la facturación no se adelantan por aparecer en el mapa.

Al diseñar cada proyecto y antes del primer código, revisar el [stack preferido](STACK.md): Next.js, Node.js, Sequelize y PostgreSQL como BD servidor, manteniendo Electron/SQLite para el alcance offline vigente. Registrar adecuación, versiones, riesgos y excepciones en `docs/decisiones/001-stack.md`. Evaluar requisitos reales y experiencia del equipo; hacer una prueba técnica acotada donde haya incertidumbre. No reabrir el stack en cada funcionalidad salvo cambio relevante.

## 2. Spec antes de cada funcionalidad

Crear `docs/specs/NNN-nombre.md` en el proyecto responsable justo antes de construir la funcionalidad. Apuntar a una página y ampliar solo cuando las reglas lo necesiten. No especificar todo el sistema en detalle por adelantado.

Contenido mínimo:

- Objetivo y actores.
- Alcance y exclusiones.
- Reglas de negocio, permisos y ámbito de los datos.
- Flujo principal, errores y operación local cuando corresponda.
- Datos y contratos afectados; migración o compatibilidad si cambian datos existentes u otras aplicaciones.
- Criterios de aceptación numerados, observables y verificables.
- Riesgo, escenarios de verificación y dudas pendientes.

Estados: `borrador`, `lista para implementar`, `en desarrollo`, `en verificación`, `terminada`.

Antes de implementar deben resolverse las dudas que afectan dinero, acceso, pérdida de datos o alcance de producto. Las decisiones rutinarias se documentan y ejecutan dentro del alcance autorizado; no se exige aprobación manual de cada paso. Si cambia una regla, actualizar la spec y los casos afectados.

## 3. Pruebas según consecuencia del fallo

| Riesgo | Ejemplos | Verificación requerida |
|---|---|---|
| Alto | Dinero, caja, pagos, autenticación, permisos, aislamiento, licencias, migraciones destructivas y restauración; sincronización y facturación cuando se implementen | TDD en reglas críticas, integración en los límites reales afectados y pruebas adversariales |
| Medio | Estados de negocio, cupos, horarios y validaciones con impacto operativo | Pruebas automatizadas de los criterios de aceptación y límites relevantes; TDD cuando ayude a precisar reglas |
| Bajo | Texto, presentación, filtros simples y CRUD sin reglas sensibles | Revisión y prueba de humo del recorrido afectado; sin tests que solo reproduzcan la implementación |

Un CRUD de pagos o permisos es de alto riesgo aunque sea pequeño. Clasificar las operaciones por sus consecuencias. No exigir TDD a cada componente visual ni una cobertura porcentual arbitraria.

## 4. Ciclo de implementación

1. Leer contexto, documentación propia y spec. Identificar módulos internos e integraciones externas afectados, sin dependencia CORE.
2. Para cada regla crítica, escribir primero una prueba y observar que falle por la razón correcta. Un error de configuración no cuenta como fallo del comportamiento.
3. Implementar lo mínimo, comprobar que pasa y refactorizar con las pruebas en verde. Repetir para las reglas restantes.
4. Integrar persistencia, backend o IPC confiable de Electron y UI según el recorrido. Validar entradas y permisos en el proceso confiable: ocultar botones no controla el acceso.
5. Verificar aceptación, escenarios negativos y casos adversariales según riesgo. Añadir una regresión útil al corregir un defecto cuando el riesgo lo justifique.
6. Revisar el cambio, actualizar documentación y cerrar la funcionalidad antes de pasar a la siguiente.

Frontend y backend pueden avanzar en paralelo sobre un contrato acordado en la spec. Los datos simulados ayudan a construir la UI; para terminar se comprueba la integración real.

### Interfaz mínima y entrega al desarrollador frontend

- Incluir las pantallas básicas necesarias para usar y demostrar la funcionalidad: formularios, listados, acciones y navegación sencilla, conectados al backend real.
- Dedicar el mínimo tiempo a presentación. Reutilizar componentes y estilos existentes; si no existen, usar una solución sencilla. Evitar diseño visual a medida, animaciones, exploración estética, componentes decorativos o un sistema de diseño propio salvo petición explícita.
- Conservar legibilidad, etiquetas, manejo de errores, estados de carga y confirmaciones cuando la operación lo requiera. Una UI básica sigue debiendo permitir operar sin ambigüedades.
- Separar presentación de reglas de negocio. El frontend consume contratos documentados; permisos, cálculos y validaciones críticas se comprueban en backend/proceso confiable.
- Entregar al desarrollador frontend contratos API/IPC, tipos de entrada/salida, errores, permisos, instrucciones para ejecutar y el recorrido mínimo disponible. Mantener ejemplos o fixtures solo cuando ayuden a integrar.
- El acabado visual no bloquea una versión técnica funcional. Los fallos del recorrido, la integración o la seguridad sí la bloquean. Una entrega comercial puede requerir una revisión visual adicional con el otro desarrollador.

## 5. Capa de verificación

- Unitarias: reglas puras, cálculos y decisiones de autorización.
- Integración con SQLite temporal: consultas, restricciones, transacciones y migraciones modificadas. No reemplazar toda la persistencia por mocks cuando se evalúa su comportamiento.
- Backend/IPC: comprobar que una operación sensible rechaza llamadas no autorizadas aunque se omita la UI.
- Recorridos completos: pocas pruebas sobre flujos esenciales y revisión visual de pantallas afectadas. Probar instalador y periféricos cuando cambien y antes del piloto.
- Servicios externos: dobles de prueba para simular fallos controlados, distinguiéndolos de una integración comprobada con el proveedor real.

Usar datos temporales, controlar reloj/azar cuando sea necesario y no depender de datos ni cuentas reales de clientes. Cuando llegue PostgreSQL, probar allí sus comportamientos específicos: SQLite no demuestra equivalencia entre motores.

Las herramientas de testing se elegirán al crear el proyecto de código, según su stack.

## 6. Pruebas adversariales

En riesgo alto, realizar una pasada explícita para buscar cómo incumplir la spec y qué reglas faltan. En riesgo medio, centrarse en límites e inconsistencias relevantes. Puede hacerlo la misma sesión en una pasada separada; solo se llama revisión independiente si interviene otra persona o agente.

Elegir escenarios aplicables:

| Área | Intentos de fallo |
|---|---|
| Acceso | Llamada directa al backend/IPC, identificadores manipulados, acceso a otro tenant/local, usuario desactivado y elevación de permisos |
| Dinero | Importes inválidos, precisión/redondeo, doble clic, reintentos y concurrencia |
| Persistencia | Fallo a mitad de operación, reinicio, escritura parcial y pérdida de datos tras migración/restauración |
| Operación local | Internet ausente, caída de LAN o PC principal cuando aplique y recuperación al reiniciar |
| Licencias | Firma inválida, archivo manipulado, vencimiento y cambios de reloj según la política especificada |
| Integraciones futuras | Respuesta tardía, duplicada, rechazada o caída del proveedor; conflictos de sincronización |

Registrar escenario, resultado esperado, observado, gravedad, evidencia y resolución. Automatizar casos repetibles que protejan reglas; documentar los que requieran hardware o intervención manual. Enumerar un caso no equivale a ejecutarlo.

Acceso indebido, corrupción/pérdida de datos, errores monetarios e incumplimientos de aceptación bloquean la entrega. Otros hallazgos pueden registrarse con impacto y seguimiento explícitos. Si falta una regla de producto, resolverla y actualizar la spec antes de cerrar la funcionalidad.

## 7. Definición de terminada

- La spec refleja lo implementado y sus criterios de aceptación están verificados.
- Pasan las pruebas pertinentes al riesgo y se revisó el cambio.
- Se ejecutaron los escenarios adversariales aplicables y se resolvieron los hallazgos que bloquean la entrega.
- El recorrido funciona integrado en local. Los cambios sensibles de persistencia incluyen verificación de transacciones/migraciones; los de instalación y periféricos, su prueba correspondiente.
- Existe un frontend mínimo para operar y demostrar el recorrido, con contratos e instrucciones suficientes para que el otro desarrollador continúe su maquetación. Esto no exige pulido visual en esta fase.
- Documentación, contratos y módulos propios afectados están actualizados; las integraciones panel/producto se verifican cuando cambien.
- Se informa qué se verificó, resultados y limitaciones. No se afirma haber probado lo que no se ejecutó.

No repetir toda la batería sin motivo. Ampliar pruebas ante cambios de alcance, regresiones o riesgos sin resolver. Antes del piloto, verificar recorridos esenciales en la versión empaquetada y los objetivos de [hardware](HARDWARE.md).

## 8. Coordinación y desarrollo independiente

El fundador coordina producto y se concentra en backend y arquitectura. La otra persona se encarga principalmente de maquetación, diseño y acabado del frontend. La sesión principal conserva el contexto y conduce cada funcionalidad, incluyendo la UI mínima necesaria para entregar una versión utilizable.

Los roles y modelos se definen en la siguiente sección. No es obligatorio abrir un agente por cada rol o tarea pequeña. Al delegar, entregar alcance acotado, contexto, archivos y criterios; revisar e integrar el resultado. No afirmar que hubo una revisión independiente si la misma sesión realizó ambas pasadas.

Versionar código, specs y decisiones juntos en cada software. Sus módulos, migraciones, pruebas y releases son propios. No extraer un CORE común ni copiar módulos de otro producto como punto de partida. Cuando cambie un formato de integración entre panel y productos, documentar compatibilidad y comprobar ambas implementaciones independientes.

## 9. Roles y modelos

Política elegida por el fundador para todos los desarrollos:

- **Trabajo que requiere más razonamiento:** GPT-6.1 sol, esfuerzo **medio** (`gpt-6.1-sol`, `medium`).
- **Trabajo acotado que requiere menos razonamiento:** GPT-6 luna, esfuerzo **máximo** (`gpt-6-luna`, `max`).

“Menos razonamiento” describe la dificultad de la tarea; la configuración de Luna sigue siendo `max`, por decisión del fundador. No bajar su esfuerzo a `low` ni cambiar modelos por iniciativa propia.

### Alternativa autorizada cuando Luna alcance su límite

Si GPT-6 luna no puede continuar por un límite de uso/cuota, utilizar **GPT-6.1 sol con esfuerzo bajo** (`gpt-6.1-sol`, `low`) para los roles que estaban asignados a Luna. Esta es una sustitución autorizada por el fundador; no hace falta solicitar autorización de nuevo.

Conservar el alcance, la spec, los cambios ya realizados y las verificaciones pendientes. Informar brevemente de la sustitución y evitar reintentos repetidos contra el mismo límite. No asumir que Sol tiene cuota disponible: si también está limitado, informar el impedimento sin afirmar que se cambió de modelo. La alternativa no rebaja los roles críticos de Sol: arquitectura, reglas sensibles y revisión adversarial permanecen en `medium`.

La sustitución se aplica mediante los controles disponibles al iniciar o continuar la sesión/agente. Si la sesión principal no permite cambiar su propio modelo, indicarlo y conservar un resumen de continuidad; editar este documento no efectúa el cambio. Al comenzar un nuevo encargo acotado se vuelve a intentar Luna; la alternativa aplica mientras siga limitado.

| Rol/tarea | Modelo y esfuerzo | Responsabilidad |
|---|---|---|
| Coordinador y arquitecto | GPT-6.1 sol · medio | Contexto global, módulos propios, dependencias internas, integraciones, decisiones y cierre de funcionalidades |
| Especificador SDD | GPT-6.1 sol · medio | Reglas, casos ambiguos, criterios de aceptación, riesgo y escenarios negativos |
| Implementador de lógica crítica | GPT-6.1 sol · medio | Backend sensible, TDD de dinero/acceso, transacciones, migraciones complejas, licencias y diagnóstico difícil |
| Revisor técnico y adversarial | GPT-6.1 sol · medio | Revisar reglas y contratos, diseñar ataques/casos límite, investigar hallazgos y evaluar correcciones |
| Implementador de tareas acotadas | GPT-6 luna · máximo | Estructura repetitiva, DTOs/tipos, operaciones simples y cambios mecánicos con contrato ya definido |
| Integrador de frontend mínimo | GPT-6 luna · máximo | Formularios/listados básicos, navegación y conexión a API/IPC siguiendo los contratos |
| Ejecutor de verificaciones definidas | GPT-6 luna · máximo | Ejecutar checks y casos acordados, preparar fixtures simples y recoger resultados reproducibles |
| Mantenedor de documentación | GPT-6 luna · máximo | Actualizar enlaces, instrucciones y documentación a partir de decisiones ya tomadas |

Diseñar pruebas adversariales, decidir una regla o interpretar un fallo complejo corresponde a Sol; ejecutar un escenario ya definido puede corresponder a Luna. Un CRUD de pagos/permisos no se delega como tarea simple por su apariencia.

Si una tarea asignada a Luna descubre ambigüedad, riesgo sensible, necesidad de cambiar arquitectura o un fallo que exige diagnóstico complejo, detener esa parte y trasladarla a Sol con la evidencia disponible. No inventar una solución de negocio para completar el encargo.

Mantener las tareas pequeñas, con entradas, salidas y archivos definidos. El coordinador integra y verifica el resultado. Usar trabajo paralelo solo cuando las tareas sean independientes y la coordinación aporte valor; no multiplicar agentes para cambios triviales.

Esta tabla es una política del proyecto, **no una configuración automática del modelo de la sesión**. Al iniciar una sesión o agente, seleccionar el modelo/esfuerzo correspondiente mediante los controles disponibles, incluida la alternativa autorizada por límite de Luna. Si no puede seleccionarse o no está disponible, informar la limitación; no afirmar que se utilizó otro modelo ni sustituirlo silenciosamente.

Referencia de configuración de agentes: [documentación oficial de OpenAI](https://learn.chatgpt.com/docs/agent-configuration/subagents?surface=app). La asignación concreta de roles anterior es una decisión del proyecto.

## 10. Datos de prueba y entorno del frontend

Todas las aplicaciones deben disponer de una forma reproducible y opcional de poblar su BD local con datos ficticios, siguiendo [DATOS_PRUEBA.md](DATOS_PRUEBA.md). Implementarla cuando existan las primeras migraciones y antes de entregar el primer recorrido al desarrollador frontend.

Versionar migraciones, scripts y escenarios junto al código. Entregar instrucciones para instalar dependencias, configurar el entorno, migrar la BD, cargar los datos y ejecutar la aplicación en otra máquina. Los comandos concretos deben estar en el README del proyecto y comprobarse desde una BD vacía.

Al terminar una funcionalidad que cambie el esquema o los recorridos de demostración, mantener sus seeds compatibles. La BD de las pruebas automatizadas debe permanecer aislada de la BD que el frontend usa para trabajar.

## Acuerdos pendientes recomendados

La separación de repositorios/BD y distribución está definida en [arquitectura compartida](ARQUITECTURA_COMPARTIDA.md). El [contrato del panel](empresa_software/docs/07-contrato-frontend.md) define convenciones previstas para DTOs, errores, permisos, dinero y fechas; las funciones comerciales siguen en diseño. [Acceso y operación](empresa_software/docs/08-acceso-operacion.md) describe el alcance de acceso/recuperación/auditoría implementado y verificado en v0.2.0; la [spec 002](empresa_software/docs/specs/002-acceso-nativo.md) quedó terminada el 2026-10-21. Pasaron `npm run check` (lint, tipos, build y 48/48 pruebas), Playwright (2/2), `electron-builder --win --dir --x64` y el smoke de Argon2id/SQLite contra el ejecutable empaquetado. Backups/restauración, licencias operativas, instalador NSIS firmado, hardware mínimo y módulos comerciales continúan pendientes.

Falta concretar progresivamente en las specs:

- URLs de repositorios de productos y fuente remota de documentación. No se requiere repositorio ni registro de paquetes CORE. La sincronización documental local existe mediante `herramientas/Sincronizar-Contexto.ps1`; ejecutar también `-Check` tras cambiar fuentes e incluir snapshots en cada repo.
- Adecuación del stack preferido por proyecto, modo Next.js/Electron, framework Node.js si hace falta, estructura ejecutable, gestor de paquetes, empaquetador y versiones fijadas.
- Políticas de licencia: duración, gracia, renovación/reasignación y restricciones offline.
- Tipos/validadores ejecutables y reglas detalladas de cada funcionalidad; migraciones, semillas, pruebas y checks reales al crear código.

No reabrir moneda, IGV incluido, ciclo mensual o pagos parciales como si estuvieran sin decidir: el fundador ya los confirmó. El desglose tributario sigue para la etapa de facturación.

## Plantilla de spec

```markdown
# NNN — Funcionalidad
Estado: borrador
Proyecto/módulo:
Riesgo: alto | medio | bajo

## Objetivo y actores
## Alcance y exclusiones
## Reglas, permisos y ámbito
## Flujo y errores
## Datos, contratos y compatibilidad
## Criterios de aceptación
- CA-01:
- CA-02:
## Verificación y escenarios adversariales
## Dudas y decisiones
## Resultado de verificación
```

## Ejemplo: registrar un pago de suscripción

Riesgo alto. Antes de programar, definir quién registra, qué cuota se afecta, monto/moneda, tratamiento de pagos parciales y excedentes, duplicados y posible cambio de licencia. Estas reglas no se inventan dentro del código.

TDD cubre las reglas acordadas. La integración verifica persistencia y atomicidad de cambios relacionados. La pasada adversarial intenta repetir la operación, cambiar cliente/cuota, omitir permisos y provocar un fallo entre escrituras. Los resultados esperados provienen de la spec; las reglas faltantes se resuelven antes de terminar.
