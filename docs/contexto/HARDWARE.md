# Instalación y hardware

Excepción documentada de producto (2026-10-21): [academia de natación](academia_natacion/README.md) usa nube y Android React Native, sin PC principal/Electron. Su primera entrega incluye offline y sincronización, con PostgreSQL servidor y SQLite móvil propuesto. Sus reglas de mensualidades y cobros son propias; no sustituyen las suscripciones del panel. Las referencias a escritorio local, nube futura o sincronización pospuesta en este documento no aplazan ese alcance autorizado.


Actualizado: 2026-10-19. Tecnología de escritorio elegida: **Electron**.

## Estado de estos requisitos

Son **objetivos provisionales del producto**, no requisitos de RAM/CPU publicados por Electron ni una garantía de rendimiento. Todavía no existe un instalador probado. Se confirmarán con el MVP empaquetado, datos representativos y periféricos reales antes de ofrecer compatibilidad a clientes.

La documentación oficial de [Electron](https://github.com/electron/electron#platform-support) indica compatibilidad de sus versiones actuales con Windows 10 en adelante y binarios Windows x64 y ARM64. Eso no certifica nuestra aplicación ni sus dependencias nativas.

## PC que ejecuta la aplicación y mantiene SQLite

Se propone Windows x64 como primera plataforma a validar. macOS, Linux y ARM64 no se consideran certificados para nuestros productos hasta realizar pruebas específicas.

| Componente | Mínimo objetivo para uso básico | Recomendado como margen operativo |
|---|---|---|
| Sistema | Windows 11 x64 en una versión con soporte del fabricante | Igual, actualizado |
| Procesador | x64, 2 núcleos físicos, 2 GHz o superior y compatible con el sistema operativo | 4 núcleos o más |
| RAM total del equipo | 8 GB | 16 GB si atiende terminales o ejecuta otros programas |
| Disco | SSD con al menos 10 GB libres antes de instalar | SSD con 20 GB libres o más y respaldo externo |
| Pantalla | 1366 × 768 | 1920 × 1080 |
| Gráficos | Integrados, con controladores compatibles y actualizados | No se prevé exigir GPU dedicada |
| Red | No requiere internet permanente para operaciones locales | Ethernet para la PC principal; Wi-Fi estable para terminales |

Los valores de CPU no permiten comparar por sí solos todos los modelos: la aceptación final depende de las pruebas. El espacio indicado es un margen inicial para aplicación, datos y actualizaciones; la base, archivos, logs y copias crecerán según el uso y necesitarán una política de retención.

Windows 10 queda como compatibilidad por evaluar con la versión exacta de Electron, sus dependencias y la edición/soporte del sistema operativo. No se promete soporte para Windows 7/8/8.1 ni Windows de 32 bits.

## Red local y periféricos

- Una única PC principal mantiene SQLite. Las terminales acceden al servicio local; no abren directamente el archivo de base de datos.
- La PC principal debe permanecer encendida durante la operación. Si se apaga o falla la red local, las terminales no pueden continuar mediante ese servidor. La operación sin internet no elimina esa dependencia.
- La cantidad de terminales simultáneas admitidas se determinará con pruebas; no está certificada todavía.
- Impresora térmica ESC/POS: validar modelo, ancho de papel, conexión USB/LAN y controlador con el instalador real. No se promete compatibilidad universal.
- Cajón de dinero: validar su conexión y mecanismo de apertura con la impresora o controlador elegido.
- Lectores QR/código de barras: validar modelo y modo de entrada con cada aplicación. Cámara: solo si la funcionalidad de asistencia finalmente la necesita.
- Se recomienda respaldo fuera del disco principal y UPS para la PC principal en negocios expuestos a cortes eléctricos. No forman parte del mínimo técnico de instalación.

Las terminales web/tablets tendrán requisitos propios cuando exista y se valide ese modo de acceso; no requieren instalar Electron por el mero hecho de conectarse por LAN.

## Verificación antes de publicar los requisitos definitivos

Con el instalador de producción y un equipo que cumpla el mínimo, medir inicio en frío, memoria, respuesta de pantallas, búsquedas, escrituras, reportes y crecimiento de disco con un volumen de datos y concurrencia definidos para el plan. Los umbrales y el conjunto de datos se fijarán en la especificación de rendimiento del MVP.

Verificar instalación/actualización, inicio de sesión y operaciones locales sin internet, permisos, impresión y recuperación de copias. En los productos con terminales, añadir pruebas de concurrencia, pérdida de LAN y reinicio de la PC principal. Registrar versión de aplicación/Electron, SO, hardware y resultados. Ajustar esta tabla según los resultados antes del piloto comercial.

Cada aplicación documentará cualquier requisito adicional de su rubro y su matriz de equipos/periféricos efectivamente probados.
