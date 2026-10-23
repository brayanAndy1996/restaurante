# Datos de prueba y demostración

Excepción documentada de producto (2026-10-21): [academia de natación](academia_natacion/README.md) usa nube y Android React Native, sin PC principal/Electron. Su primera entrega incluye offline y sincronización, con PostgreSQL servidor y SQLite móvil propuesto. Sus reglas de mensualidades y cobros son propias; no sustituyen las suscripciones del panel. Las referencias a escritorio local, nube futura o sincronización pospuesta en este documento no aplazan ese alcance autorizado.


Actualizado: 2026-10-21.

Política compartida para todas las aplicaciones. El panel implementa un seed aislado de acceso v0.2.0, ejecutado solo mediante un comando explícito. El arranque normal no carga la demo ni crea un propietario por defecto; el bootstrap de una instalación normal es manual. La demo comercial del panel y los seeds de los demás productos siguen pendientes. Los comandos reales y credenciales ficticias del panel están en su [README](empresa_software/README.md); cada producto documentará allí sus propios scripts y escenarios.

## Propósito

Cada desarrollador puede crear su propia BD local y poblarla opcionalmente con datos ficticios sin copiar una BD del otro equipo. Los scripts y escenarios se versionan con la aplicación, compatibles con la versión de su esquema.

Cada software implementa desde cero sus seeds, fixtures y helpers de prueba, junto a sus módulos y esquema propios. No depende de CORE ni de semillas de otro producto. Solo se comparte esta política documental.

## Tres tipos de datos

| Tipo | Uso | Comportamiento |
|---|---|---|
| Iniciales del sistema | Catálogos técnicos, permisos y otros datos imprescindibles definidos por la spec | Inicialización explícita e idempotente; no incluye clientes demo ni contraseñas universales de producción |
| Demo | Trabajar con pantallas y demostrar recorridos | Carga opcional en BD de desarrollo/demo; repetible sin duplicados ni sobrescribir trabajo ajeno al escenario |
| Fixtures de tests | Preparar un escenario automatizado específico | BD temporal aislada, inicializada y limpiada por la prueba; no depende de la demo |

La creación del primer administrador de una instalación real se especifica por separado. No reutilizar credenciales de demostración para ese proceso.

## Escenarios mínimos

- Usuarios con roles diferentes, incluyendo uno sin autorización para acciones sensibles y otro desactivado.
- Datos suficientes para listados, formularios, detalles, filtros y paginación cuando existan. Mantener también la posibilidad de iniciar sin datos demo para verificar estados vacíos.
- En el panel: clientes ficticios, planes, suscripciones y pagos que cubran los estados ya definidos e implementados. Los tenants del panel no implican compartir las bases operativas de esos negocios.
- Demo comercial del panel: dos pollerías con distintas composiciones de módulos/precio y una academia, según el catálogo de ejemplo de `empresa_software/docs/05-panel-administrador.md`. Facturación figura solo como futura/no disponible, sin permitir su contratación en el MVP. Mostrar cuotas pendientes, parciales y pagadas; aplicar PEN, precios con IGV incluido y fechas `America/Lima`.
- En sistemas por rubro: escenarios propios (productos/mesas o alumnos/matrículas) a medida que existan sus módulos.
- Cuando el esquema soporte múltiples tenants/locales, incluir al menos dos ámbitos para verificar separación. No inventar soporte multi-tenant que todavía no exista.
- Datos válidos para la aplicación. Reservar entradas inválidas para tests negativos que comprueben su rechazo; no dejar una BD demo corrupta.

Usar nombres y contactos ficticios, sin datos personales reales, claves privadas ni credenciales de proveedores. Si se necesita un identificador con formato válido, usar un dato de prueba documentado como tal sin consultar servicios reales.

## Reproducibilidad y protección de datos

- Usar identificadores estables y generación determinista. Para escenarios de mora/vencimiento, aceptar una fecha base y documentarla; así se pueden reproducir independientemente del día de ejecución.
- Ejecutar migraciones antes de cargar seeds. No utilizar sincronización destructiva del ORM como sustituto de migraciones sobre datos persistentes.
- Repetir una carga no duplica registros. Detectar conflictos y no sobrescribir cambios manuales silenciosamente; si hace falta reconstruir la demo, ofrecer un reinicio explícito de su BD dedicada.
- Comprobar ambiente y ruta/configuración de destino. Cargas demo y reinicios deben rechazar instalaciones con datos reales; una variable de entorno aislada no basta para autorizar un borrado.
- Un reinicio debe mostrar el destino absoluto, comprobar que es la BD de desarrollo/demo designada y requerir una opción explícita de reinicio. Nunca ejecutarse al arrancar normalmente la aplicación ni al migrar.
- No copiar SQLite en uso ni compartir su archivo por red como método de trabajo entre desarrolladores. Compartir scripts; cada máquina genera su propia BD.
- Los escenarios demo no envían mensajes, no cobran, no emiten comprobantes ni contactan proveedores reales.

## Interfaz de comandos a implementar

Estos nombres son una propuesta de convención común, no una interfaz obligatoria para todos los proyectos. El panel ya implementa `db:migrate` y `db:seed:demo` para su esquema/acceso actual; los comandos y limitaciones concretos están en su [README](empresa_software/README.md). Cada producto puede ajustar su interfaz a su gestor de paquetes y documentará los comandos reales en su README:

| Script previsto | Función |
|---|---|
| `db:migrate` | Aplicar migraciones y datos iniciales indispensables |
| `db:seed:demo` | Cargar un escenario demo de forma opcional y repetible |
| `db:reset:demo` | Reconstruir exclusivamente la BD demo dedicada, con las comprobaciones indicadas |
| `dev` | Ejecutar aplicación/backend y frontend mínimo según la organización del proyecto |

## Entrega al desarrollador frontend

El README de cada aplicación incluirá versiones de runtime/gestor de paquetes, instalación con lockfile, configuración de ejemplo sin secretos, ubicación de SQLite y secuencia exacta de comandos. También explicará los escenarios, accesos demo, fecha base y cómo recuperar una demo limpia sin afectar otras bases.

Antes de la entrega, verificar desde una BD vacía: migrar, cargar demo, cargarla nuevamente sin duplicados y abrir el recorrido integrado. Si cambia el esquema o un escenario, mantener los seeds y estas instrucciones actualizados. La prueba del reinicio se realiza únicamente sobre una BD demo descartable.
