> **ARCHIVO HISTORICO — PROPUESTA DESCARTADA EL 2026-10-20.** El fundador decidio que cada software se construye desde cero con modulos propios. El texto anterior de esta propuesta, conservado debajo por trazabilidad, no es una instruccion vigente: no desarrollar, publicar ni consumir CORE ni esperar sus paquetes. Solo siguen vigentes la documentacion/metodologia global y las decisiones de cada producto. No hay implementacion CORE que deba migrarse.

# 05 — Verificación y datos de prueba

Aplicar la [metodología común](../../METODOLOGIA.md) y la [política de datos](../../DATOS_PRUEBA.md). Son requisitos futuros, no tests ya implementados.

## Pruebas por capacidad

- Identidad: credenciales válidas/inválidas, usuario desactivado, revocación, recuperación y preservación del último administrador según la política del consumidor.
- Autorización: permiso desconocido, escalada, manipulación de contexto, cruce de tenant/local y actualización de permisos durante una sesión.
- Auditoría: evento completo sin secretos, correlación y atomicidad con escritura de negocio cuando corresponda.
- Licencias: firma/clave incorrectas, identidad distinta, expiración, revisión anterior, formato incompatible y combinación de módulos inválida según spec.
- Persistencia: migración inicial/actualización, restricciones e índices, rollback de una operación fallida y adaptación al motor realmente soportado.

TDD para reglas críticas; pruebas de integración con SQLite real temporal y pruebas adversariales sobre los límites sensibles. Inyectar reloj/IDs para reproducibilidad. No sustituir un comportamiento SQL por mocks y afirmar después que fue comprobado.

## Fixtures y demo

Fixtures pequeñas por escenario; no depender de una BD demo global. Incluir ámbitos distintos y actores con permisos diferentes. Las cuentas del panel (`platform`) son distintas de usuarios de negocio (`tenant`); probar ambos cuando estén soportados.

CORE aporta helpers/fixtures para sus tablas cuando existan; cada producto compone su seed de negocio. No generar alumnos, ventas o precios contractuales desde el núcleo. Semillas imprescindibles (por ejemplo permisos registrados) se distinguen de datos demo opcionales.

No hay cuentas demo universales de producción. Credenciales ficticias solo en entornos aislados y documentados. No copiar bases reales para probar aislamiento.

## Demostración y frontend

CORE no requiere aplicación gráfica propia ni instalador independiente. Su entrega se demuestra integrándolo en el panel/producto con UI mínima, o mediante un arnés pequeño mientras no exista consumidor ejecutable. El arnés no sustituye la prueba posterior del producto real.

Verificar la integración del verificador con el emisor del panel antes de declarar activación funcional. Verificar el paquete empaquetado dentro del instalador cuando cambien dependencias nativas o el proceso de distribución.

## Evidencia de entrega

Documentar checks/comandos ejecutados, resultados, consumidores y versiones comprobados, escenarios adversariales y limitaciones. No registrar solo “todo pasa” ni declarar compatibilidad PostgreSQL o con productos inexistentes sin prueba.
