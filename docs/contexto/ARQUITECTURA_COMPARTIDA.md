# Separación de proyectos, empresas e instalaciones

Excepción documentada de producto (2026-10-21): [academia de natación](academia_natacion/README.md) usa nube y Android React Native, sin PC principal/Electron. Su primera entrega incluye offline y sincronización, con PostgreSQL servidor y SQLite móvil propuesto. Sus reglas de mensualidades y cobros son propias; no sustituyen las suscripciones del panel. Las referencias a escritorio local, nube futura o sincronización pospuesta en este documento no aplazan ese alcance autorizado.


Actualizado: 2026-10-21. Esta página describe criterios documentales comunes y objetivos futuros. Cada software se construye desde cero con módulos propios; CORE compartido queda descartado. La base técnica y la verificación integrada del acceso propio, usuarios, roles/permisos y auditoría del panel v0.2.0 quedaron completadas; la spec 002 está terminada. Pasaron lint, tipos, build, 48 pruebas, Playwright (2/2), empaquetado Electron Windows x64 y smoke Argon2id/SQLite contra el artefacto. No hay release ni despliegues productivos declarados. Los módulos comerciales, licencias operativas, instalador NSIS firmado y validación del hardware mínimo siguen pendientes.

La propuesta de acceso web futuro y administración de subdominios se mantiene en [DOMINIOS.md](DOMINIOS.md). No se requieren dominios públicos por empresa para el MVP local; el dominio no es el identificador ni el mecanismo de aislamiento de la BD.

El [stack preferido y su evaluación](STACK.md) establece Next.js, Node.js, Sequelize y PostgreSQL como base de servidor, con Electron/SQLite para las instalaciones locales actuales. Revisar el encaje por proyecto antes de código. Compartir este stack no crea una biblioteca interna compartida.

## Panel y productos independientes desde cero

- **Panel administrativo:** producto interno con repositorio, aplicación y BD propios. Administra empresas clientes, productos, contratos, precios, cobros, instalaciones y emisión de licencias.
- **Productos por rubro:** cada uno tiene repositorio, módulos, BD, migraciones y versiones propios. Implementa desde cero identidad, permisos, auditoría, licencias y reglas de negocio que necesite. Un repositorio por producto, no por empresa cliente.
- **CORE descartado:** la carpeta `core/` es solo [archivo histórico](core/README.md). No desarrollar, publicar ni consumir sus paquetes. Su ausencia no bloquea el panel ni los productos.

El panel implementa sus propios módulos de autenticación, permisos y auditoría, sin depender de tablas operativas de pollería/natación ni de CORE. Los negocios no reciben la aplicación administrativa ni secretos de emisión de licencias. La integración comercial futura utilizará formatos/API documentados e implementaciones independientes, no un paquete de código compartido.

El repositorio del panel es [panel_administrativo_empresa](https://github.com/brayanAndy1996/panel_administrativo_empresa). La carpeta local `empresa_software/` está en la rama `main`, con `origin` configurado. La consulta del 2026-10-20 confirmó que no había commits locales ni push y que el remoto no tenía referencias ni commits; la publicación del código fuente no constituye una release de distribución. Natación tiene como repositorio [piscina](https://github.com/brayanAndy1996/piscina); las URLs de otros productos futuros quedan por definir; no se creará un repositorio CORE ni se reutilizarán módulos anteriores como base.

## Identificadores y vinculación de la BD

| Identificador | Significado |
|---|---|
| `tenantId` | Empresa cliente; estable y distinto de su RUC |
| `productId` | Software contratado, por ejemplo pollería |
| `subscriptionId` | Contrato de esa empresa para ese producto |
| `siteId` | Local físico perteneciente a la empresa |
| `installationId` | Instalación del servidor local/PC principal para ese producto y local |

Una empresa puede contratar más de un producto y tener varios locales. Para el MVP: un contrato vigente por pareja empresa/producto; sus límites determinan cuántos locales e instalaciones principales admite. Las terminales LAN no se tratan como nuevas bases independientes.

El panel mantiene `empresa → suscripción → producto`, y `instalación → suscripción + local`. Valida que el local pertenezca a la misma empresa. No guarda rutas absolutas de discos ajenos como si fueran conexiones remotas y no administra directamente archivos SQLite de los clientes.

En cada PC principal se crea una **BD SQLite por instalación**. Sus metadatos guardan `tenantId`, `productId`, `siteId`, `installationId` y versión del esquema. La activación compara estos valores con una licencia firmada; un nombre de archivo o un RUC escrito a mano no autoriza acceso. Cambiar de empresa requiere un alta/migración explícita, no editar los metadatos de una BD existente.

Ejemplo: Pollería A y Pollería B instalan el mismo producto. A posee su SQLite y licencia con `tenantId=A`; B posee su SQLite y licencia con `tenantId=B`. Si A contrata natación, usa otra instalación/BD del producto natación con el mismo `tenantId=A`. Cada producto conserva sus propias cuentas; esto no establece SSO.

## Multi-tenant no exige una BD física por empresa en la nube

La plataforma atiende a muchas empresas, pero el aislamiento puede ser físico o lógico:

- **Ahora, local:** BD administrativa separada y una SQLite por instalación operativa. Los usuarios internos del panel pueden administrar muchas empresas según su permiso; no simulan ser usuarios de esos negocios.
- **Nube futura, diseño objetivo:** BD del panel separada de las operativas. Una BD lógica PostgreSQL por producto, con datos de varias empresas aislados por `tenant_id`, y `site_id` donde corresponda. No crear una BD por cliente por defecto. Compartir un servidor PostgreSQL no significa compartir tablas entre productos.
- Aislamiento físico por empresa queda como opción futura si un contrato lo requiere; no forma parte del MVP.

En la nube el backend deriva el tenant del contexto autenticado/instalación autorizada; no confía en un `tenantId` libre enviado por el frontend. Claves y relaciones impiden cruces de tenant, además de controles de autorización y políticas RLS. La cuenta de aplicación no debe eludir RLS por ser superusuario/propietaria. Esto se especificará y probará al implementar nube; SQLite no tiene las mismas políticas RLS de PostgreSQL. Referencia: [PostgreSQL, seguridad por fila](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Módulos y personalización

El panel gestiona catálogo, dependencias, contratación, precios y permisos comerciales de módulos. El producto registra qué versiones de módulos realmente implementa. Un módulo contratado solo puede ejecutarse si está instalado, es compatible, la licencia lo permite y el usuario tiene permiso.

La configuración de colores, logo y preferencias visuales pertenece al producto y a su BD, por empresa (con posibles ajustes por local si se especifican). No existe editor de temas ni repositorio de logos de clientes en el panel. No compilar ni mantener una rama distinta por cada cambio de color o conjunto de módulos.

La base técnica de identidad/seguridad no es desactivable. Los módulos comerciales pueden tener dependencias explícitas; configurables no significa poder eliminar arbitrariamente una dependencia necesaria. Descontratar un módulo conserva sus datos e historial y restringe nuevas operaciones; especificar consulta/exportación y transiciones por módulo.

## Instalación y activación local

El flujo de alta comercial, emisión/importación de licencias y activación descrito aquí es diseño futuro: el panel aún no implementa esas operaciones.

1. Publicar una versión del producto, empaquetada como instalador Electron. El instalador es común para empresas que usan ese producto y plataforma.
2. Dar de alta empresa, local, suscripción y módulos en el panel. Registrar la instalación y un identificador generado para ella.
3. En la PC del cliente, instalar la aplicación y generar una solicitud local de activación con identificador de instalación/producto/local. Los mecanismos exactos de solicitud se definirán en la spec de activación.
4. Registrar/validar la solicitud en el panel y exportar una licencia firmada con emisor, versión de formato, identificador de clave, licencia, empresa, contrato, producto, local, instalación, módulos, límites, revisión y fechas de validez.
5. Importar el archivo en el producto. Validar firma, identidad, compatibilidad, vigencia y revisión antes de crear/abrir la BD de esa instalación y dar de alta su administrador local.

Este flujo manual permite probar todo sin nube. La futura API automatizará intercambio, renovación y estado; no es necesaria para el prototipo local. La clave privada queda en el ámbito administrativo; los productos solo reciben claves públicas de verificación.

Una licencia no impide por sí sola clonar un disco ni detecta cualquier manipulación del reloj. Reasignación de PC, restauración, cambio de reloj, rotación de claves y prevención de uso de revisiones anteriores requieren casos explícitos de la spec y pruebas; no prometer protección absoluta.

Una suspensión en el panel **no llega instantáneamente a un equipo desconectado**. Se aplica al importar una nueva licencia/estado o al vencer la vigente. Antes de programar licencias, fijar duración, gracia y alcance de solo lectura. No borrar datos por mora; mantener una vía autenticada de respaldo/exportación y recuperación.

## GitHub y distribución

Los clientes instalan ejecutables; no clonan repositorios ni necesitan Node.js/Git o acceso a GitHub. Empaquetar los módulos propios y dependencias de terceros del producto, sin tokens de GitHub, secretos de proveedores ni claves privadas. Elegir y validar la herramienta de empaquetado por proyecto.

Al principio, instalación y actualización manual asistida desde un artefacto de versión identificado y verificado. Antes del piloto comercial, validar instalador, firma de código y canal de distribución. Las actualizaciones automáticas quedan después; no introducir tokens de acceso a repositorios privados dentro del instalador. Referencia: [distribución oficial de Electron](https://www.electronjs.org/docs/latest/tutorial/distribution-overview).

Cada release identifica producto, versión, plataforma/arquitectura, esquema compatible, módulos propios implementados y notas de migración. El panel registra versión reportada y fecha; sin sincronización es información manual, no monitoreo en vivo.

Cada aplicación implementa y versiona sus módulos de forma independiente. No crear dependencias de carpetas hermanas, paquetes CORE ni código base copiado entre productos. Los cambios/correcciones equivalentes deben evaluarse y verificarse por separado donde apliquen.

Los documentos comunes deben tener su propia fuente versionada independiente del panel. Hasta definir su repositorio remoto, la fuente está en la raíz de `proyectos/`. Cada proyecto recibe un snapshot generado en `docs/contexto/`, con referencias documentales de los otros proyectos y `MANIFIESTO.json` de origen/hashes. Su AGENTS/README enlaza esas copias, no depende de carpetas hermanas al clonar.

El mecanismo local ya existe: `herramientas/Sincronizar-Contexto.ps1` sincroniza y `-Check` comprueba diferencias sin escribir. Descubre carpetas de proyecto con README/AGENTS y excluye snapshots de las fuentes para no copiarlos recursivamente. Los documentos individuales siguen teniendo un dueño; las copias de referencia no se editan. Un proyecto nuevo debe incluir README y AGENTS, enlazar su contexto local, ejecutar sincronización y versionar el snapshot junto al código.
