> Actualizacion de diseno del 2026-10-20: CORE fue descartado. El DTO y resultados de verificacion que contienen `core: 'pending'` se conservan como evidencia de la base ya implementada, no como requisito vigente. Acceso, permisos y auditoria se desarrollaran desde cero dentro del panel. Esta actualizacion solo cambia documentos; no cambia la app ni afirma nuevas pruebas del ejecutable.

# 001 — Base ejecutable local del panel

Estado: terminada
Fecha: 2026-10-19
Proyecto/módulo: panel administrativo / infraestructura local
Riesgo: medio en persistencia técnica; alto en la frontera privilegiada IPC.

## Objetivo y actores

El desarrollador abre una aplicación Electron que muestra el estado real de su backend Node.js y SQLite. La otra persona del equipo recibe un frontend mínimo conectado, contratos y comandos reproducibles para continuar la implementación. Esta es una entrega técnica, previa al acceso propietario y al recorrido comercial.

## Alcance y exclusiones

Incluye TypeScript, Next.js/React exportado estáticamente, Electron/preload, backend Node.js, Sequelize/SQLite, una migración técnica, diagnóstico por IPC, estados de carga/error y reintento, instrucciones y pruebas proporcionales. Stack/versiones en [ADR 001](../decisiones/001-stack.md); composición en [arquitectura](../arquitectura.md).

No incluye autenticación, usuarios/roles, recuperación, clientes/locales, catálogo, contratos, cuotas, pagos, licencias, backups comerciales, nube, LAN ni código CORE. No crear tablas o operaciones de negocio sin acceso autenticado. El catálogo conceptual de [05](../05-panel-administrador.md) no se considera funcionalidad implementada.

## Reglas, permisos y ámbito

1. Única excepción sin sesión: lectura de estado técnico no sensible desde la ventana principal autorizada. No existe usuario implícito, administrador por defecto ni credencial demo.
2. La UI no accede directamente a Node, filesystem, SQLite o Sequelize. El preload publica solo métodos concretos; handlers validan entradas y emisor/frame/origen en proceso confiable.
3. Ningún DTO/error contiene ruta de BD, SQL, stack, secretos, datos personales o identificadores de cliente/instalación. No hay canal IPC genérico ni ejecución arbitraria.
4. Base normal, demo y tests son destinos separados fuera del repositorio. Los tests no abren la BD del desarrollador.
5. Las migraciones no borran datos y se pueden repetir sin duplicar el estado técnico. La demo es optativa y no se carga en el arranque normal.
6. Una SQLite inválida, un fallo de acceso o de migración impiden reportar estado saludable. No reconstruir ni sobrescribir silenciosamente un archivo existente.

## Flujo y errores

Al arrancar se resuelve el destino local, se abre SQLite y se aplican las migraciones pendientes antes de habilitar la consulta saludable. La ventana carga la exportación estática y consulta el estado por preload. Muestra carga, resultado técnico o mensaje de error con reintento; deshabilita reintento mientras espera. Si se abre el frontend en un navegador sin preload, explica que necesita Electron y no finge datos de backend.

Los errores controlados se adaptan a `Result<T>` según [07](../07-contrato-frontend.md). `VALIDATION_ERROR` para carga inesperada; `FORBIDDEN` para emisor/frame/origen no autorizado; `INTERNAL_ERROR` para fallo técnico no publicable. Un fallo anterior a registrar IPC debe producir error de arranque observable, sin reportar disponibilidad ni destruir datos. Los detalles de diagnóstico que necesite el desarrollador permanecen en el proceso confiable, sin secretos.

## Datos, contratos y compatibilidad

La fachada `window.panel.systemStatus()` no recibe argumentos y usa exclusivamente el canal `panel:system-status`. Conserva el envelope `Result<T>` con `requestId` generado por el backend según [07](../07-contrato-frontend.md). Su DTO de éxito es:

```ts
type SystemStatus = {
  appVersion: string;
  schemaVersion: number;
  database: 'ready';
  mode: 'local';
  core: 'pending';
};
```

El protocolo `app://panel/` sirve la exportación estática, con acceso restringido a su directorio. IPC valida esquema/host exactos además de webContents y frame principal; no considera confiable cualquier URL local. Las migraciones pendientes se ejecutan automáticamente y sin borrados al arrancar; la CLI `npm run db:migrate -- --database "<ruta absoluta fuera del proyecto>"` permite migrar un destino explícito. La CLI compilada se ejecuta como CommonJS y su entrada está cubierta por un proceso Node real en tests.

Migración inicial: metadata técnica y registro de migraciones, sin tablas comerciales/identidad. Identificadores y claves técnicas deben ser estables para verificar repetición. No se soporta todavía actualización desde una versión comercial anterior; esta es la primera versión de esquema. Cuando exista una siguiente migración deberá probarse la actualización desde esta base.

No se necesita seed para la metadata indispensable, creada por la migración. No hay demo comercial ni credenciales demo todavía: se añadirán escenarios reproducibles y opcionales al implementar los módulos correspondientes y su acceso autenticado. Los tests usan fixtures técnicos aislados. No se requiere reset destructivo en esta entrega.

## Criterios de aceptación

- CA-01: desde instalación por lockfile y BD vacía se ejecutan los comandos documentados de tipos, pruebas, build y arranque, con versiones de runtime fijadas.
- CA-02: migrar una SQLite temporal real crea el esquema técnico; migrar otra vez conserva registros y versión sin duplicados.
- CA-03: el arranque Electron carga HTML/JS/CSS exportados y el diagnóstico atraviesa renderer, preload, IPC, caso de uso y SQLite real. No depende del servidor Next de desarrollo ni de internet.
- CA-04: UI muestra carga, resultado y error/reintento; sin preload indica el entorno requerido. No usa mocks para simular el recorrido entregado.
- CA-05: API de preload no publica acceso genérico a IPC/Node/archivos. Se rechazan carga no esperada, otro emisor, subframe y origen ajeno mediante casos automatizados; comprobar configuración real de la ventana.
- CA-06: éxito y error técnico no exponen rutas, SQL, stack ni secretos; el estado informa el alcance técnico sin funciones de acceso/comerciales. La entrega original incluyó `core: 'pending'`, hoy un marcador legado que no impone dependencia.
- CA-07: la BD se guarda fuera del repo; fixtures no usan la BD normal. README explica que todavía no hay demo comercial y que la metadata inicial no requiere seed.
- CA-08: fallo de migración/BD no declara disponibilidad, no reinicia el esquema y no habilita operaciones comerciales. La app cierra recursos al salir.
- CA-09: README documenta setup, ubicación de datos, comandos reales, contratos IPC, demo disponible y límites de verificación. El árbol no incluye SQLite, secretos ni archivos de ejecución.

## Verificación y escenarios adversariales

| Escenario | Resultado esperado | Evidencia requerida |
|---|---|---|
| SQLite temporal vacía, migrar dos veces | Estado único y datos conservados | Test de integración con driver real |
| Archivo inválido/destino no accesible | Error seguro, sin sobrescritura ni estado saludable | Test negativo o ejecución registrada |
| Emisor desconocido, iframe y URL distinta | Denegación aunque conozcan el canal | Test del guard y revisión del registro IPC real |
| Petición con parámetros inesperados | Rechazo en backend | Test de contrato |
| Error de persistencia | DTO genérico sin stack/rutas/SQL | Test negativo |
| Dos arranques sobre la misma BD técnica | Metadata conservada, sin seed ni duplicados | Integración y humo Electron |
| Ruta de asset con traversal/host ajeno | Rechazo sin leer fuera de la exportación | Test del resolver del protocolo |
| Exportación abierta en Electron | Recursos locales y consulta real | Humo de escritorio con resultado observado |
| Navegador sin preload | Mensaje claro, sin diagnóstico falso | Humo de UI |

Escribir primero las pruebas que fallen por ausencia de controles críticos de la frontera IPC; distinguir ese fallo del de configuración. La revisión adversarial registra observado, gravedad y corrección, no solo una lista de casos. No marcar CA-03 cumplido por pasar mocks o por compilar Next.js.

## Dudas y decisiones

- Decisión del 2026-10-20: CORE está descartado. El siguiente recorrido de acceso implementará módulos propios dentro del panel desde cero, con su spec y pruebas; no esperará paquetes de otro proyecto ni usará autenticación improvisada.
- ABI del driver SQLite, resolución de recursos exportados y preload son riesgos a probar contra Electron real. El ADR fija decisiones y versiones; esta spec no presume compatibilidad por usar Sequelize.
- Instalar/actualizar un producto comercial, firma de ejecutables, mediciones del hardware mínimo, backups y restauración se verificarán antes del piloto. No forman parte de la certificación de esta base.
- Los módulos comerciales del panel mantienen moneda PEN, IGV incluido y fechas America/Lima al implementarse; esta entrega no realiza cálculos monetarios.

## Resultado de verificación

Fecha de cierre: 2026-10-19. Terminada para el alcance de base técnica definido en esta spec. La revisión independiente releyó fuentes de IPC, protocolo, preload, migraciones, paths y frontend; no escribió la implementación. Ejecutó inicialmente tests que reprodujeron fallos reales y posteriormente verificó una revisión corregida con 16/16 pruebas. El implementador ejecutó la suite ampliada y el primer E2E; el coordinador repitió los checks y el E2E tras reinstalar desde lockfile y probó el ejecutable empaquetado. Los resultados siguientes fueron registrados por sus ejecutores, sin atribuir a la revisión independiente ejecuciones que no realizó.

| Evidencia recibida o ejecutada | Resultado |
|---|---|
| `npm ci --no-audit --no-fund` | Exit 0; 537 paquetes instalados desde lockfile |
| `npm run desktop:install` | Exit 0; runtime Electron preparado tras reinstalación |
| `npm run check` | Exit 0; lint, tipos, 18 pruebas unitarias/integración/CLI y build correctos |
| `npx playwright test --config=playwright.config.ts` tras reinstalar | 1/1 correcto en 2,4 s; primer E2E del implementador también pasó en 3,8 s. Recarga estática offline con observadores instalados, navegación a diagnóstico y DTO real IPC/SQLite |
| Errores durante el recorrido E2E observado | Sin errores de página, warnings/errores de consola ni requests HTTP(S) observados; sin aviso de seguridad Electron capturado |
| Arnés Electron sin preload | Mensaje de entorno requerido; no presenta un diagnóstico saludable falso |
| Captura de inicio del E2E | Coordinador revisó legibilidad de la UI mínima |
| `npx electron-builder --win --dir --x64` | Exit 0; reconstrucción sqlite3 correcta; generado `release/win-unpacked/Panel Administrativo.exe` |
| Humo temporal `test-results/smoke-packaged.cjs` sobre el ejecutable | `isPackaged: true`, recarga offline, navegación a diagnóstico, estado real `{ appVersion: '0.1.0', schemaVersion: 1, database: 'ready', mode: 'local', core: 'pending' }`, `require` indefinido en renderer y evento de cierre de aplicación tras cerrar la ventana |
| `Get-AuthenticodeSignature` sobre el ejecutable | `NotSigned`; no se declara firma de código |
| `test-results/packaged-diagnostic.png` | Coordinador revisó la captura del diagnóstico empaquetado y su legibilidad |
| Prueba negativa temporal `test-results/verify-invalid-db.cjs` | Exit 0 del verificador: creó fuera del repo un archivo con bytes conocidos, ejecutó CLI compilada `--database`, comprobó exit 1 y bytes intactos; limpió el temporal |

Aceptación cerrada para CA-01 a CA-09 dentro de esta base: setup por lockfile, checks, migraciones/CLI, contrato y navegación funcionan; persistencia/fixtures se separan del repositorio y la documentación describe ausencia de demo comercial y comandos reales. CA-04 combina humo de resultado/error sin preload y revisión del código de carga/reintento; no se ejecutó una prueba automatizada de reintento exitoso. CA-08 combina rollback/rechazo de esquemas, archivo inválido preservado y humo de cierre del ejecutable empaquetado. No se atribuye a estas comprobaciones cobertura de funcionalidades comerciales excluidas.

### Hallazgos adversariales y correcciones

| Hallazgo | Consecuencia observada o reproducible | Resolución |
|---|---|---|
| Entrada CLI usaba `import.meta` con salida CommonJS | esbuild generaba un objeto vacío; la CLI no llegaba a migrar | Entrada CommonJS y test mediante subprocess real |
| Resolver trataba rutas de assets como absolutas | Test de bundle JS devolvió null; impedía la carga de recursos | Containment léxico y `realpath` corregidos; test pasó |
| SQLite ajena sin historial del panel | Podía recibir tablas técnicas no solicitadas | Rechazo antes de DDL y test de preservación de tabla/dato ajenos |
| Comparación de paths por prefijo e inversión posterior del helper | Test CLI reprodujo rechazo de destino temporal y creación dentro del repo | Comparación por segmento corregida; regresiones de CLI y nombre interno `..panel.sqlite3` pasan |
| Cierre de última ventana sin salida explícita | Podía mantener proceso/BD abiertos en Windows | `window-all-closed` solicita salida y `before-quit` cierra Sequelize |
| Query de navegación y MIME `.txt` de Next export | Recursos RSC podían rechazarse o tratarse como binarios | Query separada de pathname, MIME `text/plain`, HEAD y tests de protocolo |
| Precarga Next de segmentos no presentes en export | Solicitudes adicionales incompatibles con el artefacto | `prefetch={false}` y navegación comprobada por clic en E2E |

No quedan hallazgos conocidos sin corregir de esa revisión de código. Esto no sustituye las verificaciones pendientes ni prueba ausencia de fallos. Los controles negativos de emisor/frame se comprobaron con el guard y handler reales bajo dobles de evento; el E2E prueba el camino autorizado real, no una explotación real desde cada contexto hostil.

La secuencia incluyó tests escritos antes de la implementación y fallos reales documentados de CLI, paths y protocolo revisados/corregidos. No se afirma que cada regla haya recorrido un ciclo TDD completo con rojo observado por separado; los fallos de configuración no se cuentan como prueba de comportamiento ausente.

Límites: sin piloto comercial, sin autenticación/CORE ni datos comerciales; instalador NSIS, firma, actualización, restauración y hardware mínimo siguen sin certificarse. Persiste el seguimiento de dos avisos moderados de dependencias descrito en [ADR 001](../decisiones/001-stack.md); no se declara auditoría limpia.
