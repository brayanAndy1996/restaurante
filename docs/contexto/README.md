# Proyectos de la empresa de software

Punto de entrada de la documentación. Actualizado: 2026-10-22. La base técnica y la verificación integrada del acceso v0.2.0 están completadas: lint, tipos, build, 48 pruebas (incluida junction), E2E 2/2 y smoke Argon2id/SQLite contra el paquete Electron x64 pasaron. La spec 002 está terminada. Siguen pendientes los módulos comerciales, el instalador NSIS firmado y la validación del hardware mínimo. **Cada software se desarrolla desde cero con módulos propios, sin CORE compartido.** Se comparten únicamente criterios, stack preferido y documentación/metodología; se permiten librerías de terceros.

## Lectura común

1. [Contexto general](CONTEXTO_GENERAL.md): negocio, decisiones y límites comunes.
2. [Metodología](METODOLOGIA.md): SDD, TDD, adversarial, roles/modelos y entrega al frontend.
3. [Arquitectura compartida](ARQUITECTURA_COMPARTIDA.md): separación de productos, tenancy, licencias y distribución.
4. [Datos de prueba](DATOS_PRUEBA.md): seeds y entorno reproducible.
5. [Hardware](HARDWARE.md): objetivos provisionales de instalación.
6. [Dominios](DOMINIOS.md): propuesta para la nube futura.
7. [Stack por defecto](STACK.md): Next.js, Node.js, Sequelize/PostgreSQL y revisión técnica obligatoria al diseñar cada proyecto, con Electron/SQLite para el alcance local.

## Proyectos

| Carpeta | Responsabilidad | Estado |
|---|---|---|
| [academia_natacion](academia_natacion/README.md) | Gestión de academia: web, Android y nube con operación offline | Operación online v0.3.0; offline comercial/respaldo/hardware pendientes |
| [core](core/README.md) | Archivo histórico de una propuesta descartada | Cancelado el 2026-10-20; no desarrollar ni consumir |
| [empresa_software](empresa_software/README.md) | Panel interno: empresas, catálogo, contratos, cobros e instalaciones/licencias | Base técnica y acceso nativo v0.2.0 verificados; módulos comerciales pendientes |
| [restaurante](restaurante/README.md) | Operación multitenant de salón, comandas y caja; nube con continuidad local | Base técnica v0.1.0 verificada; acceso y operación comercial pendientes |

Natación tiene documentación, acceso/permisos y autorización Android v0.2.0, además de diagnóstico API/web/Android en su [repositorio oficial](https://github.com/brayanAndy1996/piscina); los módulos operativos siguen pendientes. Pollería permanece como proyecto futuro.

## Documentación en repositorios independientes

Esta raíz es la fuente actual de los documentos comunes. Cada proyecto recibe una copia generada en `docs/contexto/`, con manifiesto y referencias documentales, para que se pueda leer el contexto al clonar solo ese repositorio.

Desde esta raíz, ejecutar con PowerShell:

```powershell
./herramientas/Sincronizar-Contexto.ps1
./herramientas/Sincronizar-Contexto.ps1 -Check
```

El primer comando sincroniza documentación; el segundo detecta archivos ausentes, modificados o sobrantes sin escribir. No crean tablas, datos de prueba, paquetes, commits ni repositorios. No editar las copias generadas: cambiar la fuente y sincronizar. El contexto de otro proyecto se copia solo como referencia; no se convierte en instrucciones particulares del consumidor.

El origen definitivo en GitHub de los documentos comunes sigue pendiente. Hasta entonces, mantener el script y estas fuentes en este espacio, e incluir cada snapshot en el futuro commit del proyecto consumidor. Un clon independiente puede leer el snapshot sin tener las carpetas hermanas; sincronizar desde la fuente requiere este espacio de documentación.
