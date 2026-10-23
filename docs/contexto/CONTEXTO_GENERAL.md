# Contexto general de las aplicaciones

Actualizado: 2026-10-23. Este documento es la fuente común de decisiones que afectan a varios proyectos de esta carpeta. Las especificaciones particulares viven dentro de cada aplicación.

## Decisión vigente: desarrollo independiente desde cero

El fundador descarta el CORE compartido el 2026-10-20. **Cada software, incluido el panel, implementa desde cero sus propios módulos**, con código, repositorio, BD, migraciones, pruebas y versiones independientes. No crear paquetes internos comunes, copiar módulos de otro producto como base ni exigir CORE para avanzar. Se mantienen el stack preferido, librerías de terceros y documentación/metodología comunes. La carpeta `core/` es únicamente archivo histórico; sus propuestas no son instrucciones vigentes.

## Empresa y productos

- La empresa alquila software por suscripción, con precio de entrada desde **S/ 150 mensuales**; prestaciones y límites pendientes.
- `empresa_software/` corresponde al **panel administrativo interno de la empresa** y contiene también documentación inicial del negocio.
- `core/` conserva una [propuesta histórica descartada](core/README.md); no es un proyecto activo ni tiene paquetes que deban desarrollarse.
- `academia_natacion/` tiene [documentación propia](academia_natacion/README.md), alcance acordado y acceso v0.2.0 con usuarios/permisos, auditoría y autorización firmada del único Android offline, además del diagnóstico API/web/Android. Operación y sincronización comercial v0.4.0 implementadas (alumnos/inscripciones/caja/cobros/carnet/asistencia/portal, cola SQLCipher e incidencias con bloqueo de cierre hasta conciliación del administrador). Respaldo cifrado/restauración de prueba implementados; hosting y automatización, autoservicio de adjuntos de solicitud y calificación Android física siguen pendientes. Pollería permanece como producto futuro independiente.
- Cada aplicación construye y mantiene sus capacidades propias, incluso si los nombres de sus módulos coinciden con los de otro software.
- El panel gestiona empresas/contratos; los productos implementan sus módulos independientemente. No consumen paquetes CORE. Diseño en [ARQUITECTURA_COMPARTIDA.md](ARQUITECTURA_COMPARTIDA.md).
- El panel se alojará en [panel_administrativo_empresa](https://github.com/brayanAndy1996/panel_administrativo_empresa). Natación usa el repositorio [piscina](https://github.com/brayanAndy1996/piscina). Los repositorios de los demás productos futuros siguen pendientes; no se creará un repositorio CORE.
- El repositorio local del panel está en la rama `main`, con `origin` configurado. La consulta del 2026-10-20 confirmó que no había commits locales ni push y que el remoto no tenía referencias ni commits; la publicación del código fuente no constituye una release de distribución. La base técnica y la verificación integrada del acceso, usuarios, roles/permisos y auditoría propios v0.2.0 están completadas; la spec 002 terminó el 2026-10-21. `npm run check` pasó lint, tipos, build y 48 pruebas en nueve archivos sin omitidas, incluida junction real; `npx playwright test --config=playwright.config.ts` pasó 2/2. El paquete Electron `--win --dir --x64` y el smoke Argon2id/SQLite contra el ejecutable empaquetado también pasaron. Siguen pendientes los módulos comerciales, el instalador NSIS firmado y la validación del hardware mínimo; no se requiere CORE.
- Cada empresa contrata productos y módulos compatibles, con precio según su composición. El panel registra esa relación; colores, temas y logos se configuran en el producto del negocio, no en el panel.
- Venta inicial solo en Perú: PEN, dos decimales, precios con IGV incluido y fechas de negocio `America/Lima`. Las suscripciones del panel usan mensualidad desde alta sin prorrateo automático y pagos parciales con saldo. No trasladar esas reglas comerciales a mensualidades de alumnos: natación define calendario, proporcional y pago completo en su documentación.
- El fundador prioriza backend y arquitectura. Las versiones incluyen una UI funcional mínima; el otro desarrollador se ocupa principalmente de maquetación y acabado visual. No invertir en diseño visual adicional salvo petición explícita.

## Excepción de producto: academia de natación

Acuerdos del 2026-10-21: [natación](academia_natacion/README.md) tendrá web Next.js y Android React Native independientes, backend Node.js/Sequelize y nube desde su primera entrega. Offline móvil y sincronización forman parte de ese alcance: un único celular designado concentra toda la operación sin conexión, hasta 24 horas desde su última sincronización exitosa; los otros celulares requieren internet para registrar cambios; no requiere Electron, PC principal ni servidor LAN. Las reglas particulares y entregas viven en su documentación. El panel conserva su alcance local y sus decisiones propias. Las referencias siguientes a escritorio, instalación SQLite por PC, nube futura y sincronización pospuesta describen la base local de los demás productos, no sustituyen esta excepción.

## Decisiones técnicas vigentes

Excepción propia de [restaurante](restaurante/README.md), acordada el 2026-10-22: producto multitenant con nube habitual y servidor local para continuidad sin internet; primera instalación con un local, mozos en celulares/tablets e impresoras de red. La primera versión comercial excluye facturación electrónica; inventario de disponibilidad/cantidades. KDS también en alcance. Caída simultánea de internet y servidor local fuera de continuidad garantizada. Arquitectura, límites y entregas se definen en la documentación del producto; las reglas siguientes de nube futura no aplazan este alcance. Desarrollo iniciado, sin operación comercial ni sincronización implementadas todavía.

Restaurante usa el [repositorio restaurante](https://github.com/brayanAndy1996/restaurante). Carta y salón v0.3.0 implementados por local sobre acceso multitenant PostgreSQL, con cantidades auditadas y apertura/cancelación de atenciones vacías; evidencia y límites en [spec 003](restaurante/docs/specs/003-carta-salon.md) y [spec 002](restaurante/docs/specs/002-acceso-multitenant.md). Opera únicamente como entorno de desarrollo local: no hay despliegue nube, ventas ni continuidad implementados.

- TypeScript y **Electron** para las aplicaciones de escritorio.
- SQLite local y Sequelize como ORM. PostgreSQL está previsto para la futura nube.
- Stack preferido para todos los proyectos: **Next.js (frontend), Node.js (backend), Sequelize y PostgreSQL (BD servidor)**, con TypeScript. Electron y SQLite siguen siendo las decisiones locales actuales. Antes de implementar cada software, revisar adecuación/compatibilidad y registrar decisión por proyecto según [STACK.md](STACK.md); no asumir que la preferencia es la mejor opción para cualquier requisito.
- Por ahora, desarrollo, ejecución y pruebas íntegramente en local, incluido el panel administrativo.
- Los negocios deben poder operar sin internet. En el diseño previsto, una PC principal mantiene la base local y las otras terminales acceden mediante un servicio en la red local. No se comparte el archivo SQLite por una carpeta de red.
- La SQLite operativa pertenece a una instalación identificada por empresa, producto y local; su licencia firmada debe coincidir con esos metadatos. El panel tiene su propia BD administrativa, no las bases de ventas/alumnos de sus clientes.
- El diseño objetivo de nube se precisa: BD del panel separada y BD PostgreSQL por producto con aislamiento lógico por tenant. No es requisito una BD física por cada empresa. Su implementación sigue pospuesta.
- El despliegue en la nube y la sincronización se abordarán después. Su protocolo aún no está definido.
- Para acceso web futuro se propone un dominio de plataforma y subdominios por empresa/producto; no dominios independientes por cliente por defecto. [Propuesta de dominios](DOMINIOS.md), pendiente de aprobación y elección de proveedores. No es requisito para operar Electron/local ni funcionalidad del MVP.
- **Facturación electrónica en la última etapa**, incluida la facturación de nuestras suscripciones, la elección de proveedor y la integración con SUNAT.
- Next.js y Node.js son las preferencias definidas; versiones, modo de integración de escritorio y framework de backend si corresponde se evalúan por proyecto. La metodología compartida está en [METODOLOGIA.md](METODOLOGIA.md): SDD por funcionalidad, TDD en reglas críticas y pruebas adversariales según riesgo.
- En todos los desarrollos, asignar tareas complejas a **GPT-6.1 sol / medio** y tareas acotadas a **GPT-6 luna / máximo**, según los roles de la metodología. Esta política no cambia automáticamente el modelo de una sesión.
- Si Luna alcanza su límite de uso, la alternativa autorizada para sus tareas es **GPT-6.1 sol / bajo** (`gpt-6.1-sol`, `low`). Los roles críticos mantienen Sol / medio. Informar del cambio y aplicarlo mediante los controles disponibles.
- Cada aplicación tendrá seeds demo opcionales y reproducibles. El panel ofrece un seed dedicado de acceso v0.2.0, que solo corre por comando explícito: el arranque normal no siembra la demo ni crea un propietario por defecto. El bootstrap del propietario de una instalación normal es manual. La demo comercial sigue pendiente. Política común en [DATOS_PRUEBA.md](DATOS_PRUEBA.md); cada producto documentará sus comandos reales.

## Usuarios, roles y permisos

Estas son las reglas base para diseñar todas las aplicaciones; sus esquemas y flujos detallados se especificarán antes de implementarlos.

### Identidades y ámbitos

- Los usuarios internos del panel pertenecen a la empresa de software. Los usuarios de cada negocio pertenecen a ese cliente o tenant.
- Cada aplicación implementa su propio módulo de usuarios desde cero. No comparte cuentas, contraseñas, código de autenticación ni bases de datos con otros productos. No se ha decidido un inicio de sesión único.
- Identificar explícitamente el tenant y, cuando corresponda, los locales a los que puede acceder un usuario. Un usuario de un negocio no obtiene acceso a otro negocio ni al panel interno.
- Ser administrador de un negocio no implica ser administrador de la plataforma.

### Modelo de autorización

- Usuario: identidad, credenciales protegidas mediante hash de contraseña, estado y pertenencia al ámbito correspondiente.
- Rol: conjunto de permisos asignable a usuarios dentro de su ámbito. Los nombres de rol por sí solos no conceden acceso.
- Permiso: acción concreta identificada por una clave estable. Ejemplos ilustrativos: `usuarios.crear`, `roles.asignar`, `polleria.comandas.crear`, `natacion.matriculas.crear`, `plataforma.pagos.registrar`.
- Cada aplicación define e implementa su catálogo de permisos, roles iniciales y mecanismo de evaluación, siguiendo estas reglas documentales de seguridad.
- Denegar por defecto: una acción requiere permiso explícito y pertenencia al tenant/local correspondiente. Las comprobaciones se realizan en el backend o proceso confiable, además de adaptar la interfaz.
- El inicio de sesión y la autorización del trabajo local no deben depender de una conexión permanente a internet.
- Auditar cambios de roles, permisos, estado de usuarios y operaciones sensibles. No registrar contraseñas ni secretos.
- La futura función de soporte para entrar como un cliente requiere un diseño explícito de autorización, alcance y auditoría antes de implementarse; no otorga acceso automático desde el panel.

El acceso nativo del panel —bootstrap del propietario, contraseñas, recuperación offline, sesiones, usuarios/roles, permisos y auditoría— está implementado y verificado en v0.2.0; la [spec 002](empresa_software/docs/specs/002-acceso-nativo.md) está terminada. Cada producto especificará e implementará su política desde cero; el panel aún no contiene los módulos comerciales.

## Referencias documentales de módulos y límites

Esta tabla describe responsabilidades que pueden repetirse; **no define una biblioteca común ni obliga a compartir código**. Cada aplicación implementa únicamente los módulos que necesita.

| Capacidad | Regla común | Particularidad de cada producto |
|---|---|---|
| Usuarios, roles y permisos | Identidad, estados y autorización | Roles iniciales, catálogo de permisos y ámbitos |
| Empresa y locales | Identificación y aislamiento de negocios | Datos y configuración del rubro |
| Auditoría | Actor, acción, ámbito y fecha | Eventos sensibles propios |
| Caja | Apertura, movimientos, cierre y arqueo | Operaciones que generan movimientos |
| Licencias | Emisión y verificación separadas | El panel emite; los sistemas contratados verifican |
| Impresión | Infraestructura y gestión de impresoras | Tickets, comandas y formatos propios |
| Sincronización | Propia de cada producto; primera entrega en natación, futura en productos locales | Entidades, conflictos y protocolo propios |
| Facturación | Capacidad futura, última etapa | Documentos que necesita emitir cada producto |

No todos los módulos se activan en todas las aplicaciones: la cobranza de suscripciones del panel no equivale a la caja de una pollería. Alumnos, matrículas, productos, mesas y comandas pertenecen a sus respectivos sistemas.

Las claves privadas para emitir licencias pertenecen al ámbito administrativo y no se distribuyen en los sistemas de los negocios. Duración, gracia y restricciones de licencia aún requieren especificación.

## Documentación común y código independiente

- Este archivo concentra el contexto común; [hardware](HARDWARE.md) describe los objetivos de instalación.
- Cada proyecto mantiene su README, alcance, funcionalidades y decisiones particulares, enlazando estos documentos en lugar de copiarlos.
- Al iniciar trabajo en una aplicación, leer primero este contexto y luego su documentación propia. El archivo raíz `AGENTS.md` indica este recorrido a los asistentes que trabajan en estas carpetas.
- Si una decisión cambia para todos los productos, actualizar aquí y revisar sus referencias. Si solo afecta a un rubro, documentarla en ese proyecto.
- Si aparece una contradicción, resolverla explícitamente y actualizar la documentación afectada; no convertir una excepción particular en regla global de forma implícita.
- No crear un núcleo/paquete interno compartido. Cada software mantiene y verifica sus módulos, dependencias, migraciones y releases por separado, construido desde cero. Puede consultar reglas documentadas, sin reutilizar implementaciones de otro producto como base.
- Para repositorios independientes, distribuir documentos comunes como copias generadas con origen/revisión en `docs/contexto/`. Existe `herramientas/Sincronizar-Contexto.ps1`, con modo `-Check`, para proyectos con README/AGENTS propios y referencias históricas marcadas. Esta raíz sigue siendo la fuente actual; el repositorio remoto de documentación queda pendiente. Las referencias no copian código ni cambian el dueño de sus reglas.
- Compartir documentación no conecta bases de datos ni implementa módulos. Los formatos de integración panel/productos (por ejemplo licencias) pueden acordarse y probarse sin compartir paquetes de implementación.

## Documentos existentes

- [Índice global de proyectos y sincronización](README.md).
- [Stack por defecto y evaluación por software](STACK.md).
- [Archivo histórico: CORE descartado](core/README.md).
- [Índice y decisiones del panel/negocio](empresa_software/README.md).
- [Módulos propios del panel, sin CORE](empresa_software/docs/03-nucleo.md).
- [Módulos del panel administrativo](empresa_software/docs/05-panel-administrador.md).
- [Metodología de desarrollo compartida](METODOLOGIA.md).
- [Datos de prueba y entrega del entorno local](DATOS_PRUEBA.md).
- [Software independiente, multi-tenant, activación e instalación](ARQUITECTURA_COMPARTIDA.md).
- [Contrato backend/frontend del panel](empresa_software/docs/07-contrato-frontend.md).
- [Acceso, recuperación, backups y checks](empresa_software/docs/08-acceso-operacion.md).
- [Propuesta de dominios y acceso web futuro](DOMINIOS.md).
