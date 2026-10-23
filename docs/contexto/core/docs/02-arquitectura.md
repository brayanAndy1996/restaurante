> **ARCHIVO HISTORICO — PROPUESTA DESCARTADA EL 2026-10-20.** El fundador decidio que cada software se construye desde cero con modulos propios. El texto anterior de esta propuesta, conservado debajo por trazabilidad, no es una instruccion vigente: no desarrollar, publicar ni consumir CORE ni esperar sus paquetes. Solo siguen vigentes la documentacion/metodologia global y las decisiones de cada producto. No hay implementacion CORE que deba migrarse.

# 02 — Arquitectura de CORE

## Forma de consumo

Un repositorio de CORE con paquetes pequeños por capacidad. El consumidor incorpora versiones explícitas en su build; el código viaja dentro de su instalador. CORE no consulta un servicio central propio para cada operación y no administra conexiones a todas las empresas.

Organización conceptual, todavía sin crear código ni nombres npm definitivos:

```text
Contratos públicos y tipos de contexto
           ↑
Servicios de identidad / permisos / auditoría / licencias
           ↑
Composición del backend del panel o producto
           ↓
Adaptadores de persistencia y recursos locales
```

Los contratos/servicios no dependen de pollería, natación o del panel. Los adaptadores implementan interfaces del núcleo; el consumidor compone los servicios con sus recursos. No introducir dependencias circulares entre paquetes ni importar código desde carpetas hermanas del desarrollador como mecanismo de distribución.

## Límites de ejecución

- TypeScript como lenguaje común. Mantener reglas y contratos separados de Electron, UI y transporte.
- TypeScript/Node.js como base de ejecución. El [stack global](../../STACK.md) prefiere Next.js para consumidores con UI, pero CORE no depende de Next.js ni impone un servidor de frontend. Evaluar su stack/adaptadores en una decisión técnica propia antes del código.
- Integraciones SQLite/Sequelize en adaptadores, sin filtrar instancias ORM a contratos públicos. PostgreSQL se validará al abordar nube.
- Backend/proceso confiable compone casos de uso y evalúa permisos. Renderer recibe una fachada limitada, no la conexión SQL ni claves privadas.
- No elegir un framework de backend dentro del núcleo para obligar a todos los productos a usarlo. El adaptador IPC/HTTP de cada aplicación invoca los contratos definidos.
- El consumidor provee configuración, reloj comprobable, generador de IDs y recursos que el módulo requiera. No leer secretos/variables globales arbitrariamente desde reglas puras.

## Contexto por operación

Contexto interno verificado: tipo de ámbito (`platform` para personal del panel o `tenant` para negocio), actor autenticado, producto, empresa/local/instalación cuando corresponda, permisos actuales y correlación de la operación.

No admitir un objeto enviado por la UI como contexto autorizado. Derivarlo del mecanismo de sesión y de la instalación/host validados. El ámbito plataforma tiene permisos propios; no usar un `tenantId` nulo como comodín para saltarse controles. Una operación administrativa sobre una empresa exige permiso administrativo y objetivo explícitos, no suplantar una sesión del negocio.

## Composición y atomicidad

Cada instalación/aplicación posee su conexión y su BD. El núcleo recibe acceso mediante adaptadores acotados. Si una operación de negocio y su auditoría deben confirmarse juntas, el consumidor ofrece una unidad de trabajo compartida en esa misma BD. No abrir una transacción independiente dentro de auditoría que confirme antes/después sin coordinación.

No diseñar transacciones distribuidas entre SQLite de negocios y panel: son almacenes separados. Si posteriormente se envían eventos a nube, documentar entrega/reintentos y consistencia como parte de sincronización.

## Extensión

Cada aplicación registra su catálogo de permisos, roles iniciales, módulos disponibles, políticas y eventos propios. Reutiliza el mecanismo, conserva sus cuentas y sus datos. No se presupone login único entre productos.

Primero servicios y contratos mínimos justificados por la spec; después, adaptadores. No crear un framework de plugins dinámicos ni descarga de código remoto por el hecho de vender módulos configurables.
