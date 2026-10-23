# 08 — Acceso, operación, respaldo y checks

Estado: el módulo propio de acceso, usuarios, roles/permisos y auditoría está implementado y verificado en el código local v0.2.0. La [spec 002](specs/002-acceso-nativo.md) quedó terminada el 2026-10-21. Pasaron lint, tipos, build, 48 pruebas, Playwright (2/2), empaquetado Electron Windows x64 y smoke Argon2id/SQLite contra el artefacto. La publicación del código fuente no constituye una release de distribución. Los backups, la restauración y las licencias operativas continúan como diseño pendiente. Cada producto implementa estos mecanismos de forma independiente, sin CORE compartido.

## Acceso implementado en 0.2.0

### Alta del primer propietario

La aplicación consulta si requiere bootstrap y permite crear al propietario activo una sola vez, cuando la BD migrada todavía no contiene usuarios —también cuenta usuarios inactivos—. El bootstrap es atómico, no tiene contraseña maestra y no abre acceso por LAN. Devuelve una clave de recuperación una vez y no crea automáticamente una sesión.

Las contraseñas aceptan de 15 a 128 puntos de código Unicode, sin recorte, normalización ni reglas de composición. Se almacenan con Argon2id, salt aleatoria y parámetros iniciales de 19 456 KiB, 2 iteraciones, paralelismo 1 y 32 bytes de salida. Esta configuración no certifica rendimiento en el hardware mínimo. Referencia: [OWASP, almacenamiento de contraseñas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

### Roles, permisos y último propietario

Los roles iniciales son fijos; no se edita el catálogo en esta entrega:

| Código | Nombre | Permisos de acceso en v0.2.0 |
|---|---|---|
| `owner` | Propietario | `plataforma.usuarios.ver`, `plataforma.usuarios.gestionar`, `plataforma.roles.asignar`, `plataforma.auditoria.ver` |
| `collections` | Cobranza | Ninguno de los cuatro permisos de acceso; sus permisos comerciales se definirán con esos módulos |
| `viewer` | Consulta | Ninguno de los cuatro permisos de acceso; sus permisos comerciales se definirán con esos módulos |

Cobranza y Consulta pueden iniciar/cerrar sesión y cambiar su propia contraseña; no pueden consultar usuarios/auditoría ni asignar roles en esta entrega. El backend deriva permisos de asociaciones persistidas en cada operación. Desactivar al último propietario activo o quitarle su rol se rechaza mediante una comprobación transaccional.

### Recuperación, contraseña y sesiones

La clave de recuperación contiene 32 bytes aleatorios, se muestra solo al generarse y se almacena como verificador. Solo recupera la cuenta de un propietario activo: requiere su login, la clave y una nueva contraseña; al usarse, consume la anterior, genera una nueva, revoca las sesiones y no inicia sesión automáticamente. Un propietario autenticado puede rotar su clave presentando su contraseña actual. El cambio ordinario de contraseña también es propio, exige la contraseña actual y revoca todas las sesiones del usuario. No existe una operación de reset de contraseña por otro administrador.

Las sesiones tienen una duración absoluta máxima de 8 horas y vencen tras 15 minutos de inactividad. El proceso principal de Electron mantiene la asociación entre ventana/frame y sesión; renderer no recibe ni elige el identificador/token, actor, rol o permisos. El polling no renueva la actividad. Cerrar la ventana o salir de la aplicación revoca la sesión.

Los errores de login/recuperación no revelan si existe una cuenta y los intentos sensibles se limitan con espera progresiva persistida. No se registran contraseñas ni claves de recuperación. La auditoría del alcance es append-only: triggers SQL rechazan modificar, borrar o reemplazar eventos; un fallo de auditoría revierte la escritura sensible asociada.

La migración 2 agrega los módulos de acceso, autorización y auditoría y conserva la metadata de la migración 1. El contrato actual de diagnóstico ya no contiene `core`; la evidencia histórica de la spec 001 se conserva en su documento y ADR sin tratarla como dependencia actual.

## Base demo opcional de acceso

La demo es independiente de la base normal y nunca se carga al iniciar la aplicación. El comando requiere una ruta absoluta fuera del repositorio con directorio final `panel-access-demo` y archivo `panel-access-demo.sqlite3`, por ejemplo:

```powershell
npm run db:seed:demo -- --database 'C:/ruta/panel-access-demo/panel-access-demo.sqlite3'
$env:PANEL_DB_PATH = 'C:/ruta/panel-access-demo/panel-access-demo.sqlite3'
npm run dev
```

El comando crea y marca un destino nuevo, o verifica que un destino existente pertenezca a la demo y conserve su huella original. Repetirlo no duplica ni sobrescribe el escenario; cambios manuales producen conflicto, y una BD real o sin marca se rechaza. No borra archivos ni reconstruye una demo alterada.

| Login | Rol/estado |
|---|---|
| `owner.demo` | Propietario activo |
| `cobranza.demo` | Cobranza activo |
| `consulta.demo` | Consulta activo |
| `inactivo.demo` | Consulta inactivo |

Contraseña exclusiva de estas cuentas ficticias: `Demo-panel-2026-seguro`. No usarla en una instalación real. Sin `PANEL_DB_PATH`, la aplicación normal utiliza `app.getPath('userData')/panel.sqlite3`; no requiere ni crea datos demo.

## Backups y restauración — diseño pendiente

El panel v0.2.0 no implementa backups ni restauración. Las reglas siguientes siguen siendo requisitos de diseño, no funciones disponibles.

Respaldar SQLite de manera consistente mediante API de backup o mecanismo equivalente soportado por el driver; no copiar solo el archivo principal mientras está en uso. Referencia: [SQLite Backup API](https://www.sqlite.org/backup.html).

Paquete de respaldo previsto: BD, adjuntos necesarios y manifiesto con producto, instalación, versión de app/esquema, fecha e integridad. En el panel, incluiría evidencias de pago si se implementan; no contendría por defecto la clave privada de emisión. Esa clave requiere copia cifrada y custodia separada, con procedimiento de recuperación y rotación.

Frecuencia inicial propuesta: una copia diaria al estar la app abierta, al próximo arranque si se omitió, manual bajo demanda y antes de migraciones/restauración. Mostrar última copia exitosa y fallos. Retención local propuesta de 7 diarias y 4 semanales, borrando solo copias verificadas por la política; una copia en el mismo disco no protege contra daño de ese disco. Configurar copia externa y proteger contenido sensible y credenciales de cifrado.

Restaurar exigiría propietario, reautenticación, modo de mantenimiento, copia del estado actual, validación de integridad/identidad/versiones y prueba en destino temporal. Reemplazar solo tras éxito y conservar respaldo previo. Una restauración antigua del panel puede retroceder cuotas/revisiones de licencias: conciliar cobros y emisiones antes de volver a emitirlas. No restaurar un respaldo de un negocio sobre otro.

Antes del piloto se debe ejecutar una restauración real y comprobar acceso, saldos, auditoría y archivos adjuntos. Medir cuánto dato podría perderse según la última copia y cuánto tarda la recuperación; los objetivos definitivos se fijarán con el MVP.

## Git y verificaciones

Repositorio destino: [panel_administrativo_empresa](https://github.com/brayanAndy1996/panel_administrativo_empresa). La rama local de trabajo actual es `main` y `origin` está configurado. La consulta del 2026-10-20 confirmó que no había commits locales ni push y que el remoto no tenía referencias ni commits; la publicación del código fuente no constituye una release de distribución. No incluir `.env` con secretos, SQLite reales, backups, evidencias de pago, claves privadas ni tokens en Git.

Los comandos, versiones de runtime y checks reales están en el [README del proyecto](../README.md). La verificación local de la spec 002 terminó: `npm run check` pasó lint, tipos, build y 48 pruebas de nueve archivos sin omitidas; `npx playwright test --config=playwright.config.ts` pasó 2/2; el empaquetado Windows x64 pasó y el smoke `node dist/smoke-packaged-auth.cjs` validó Argon2id, SQLite v2 y los recorridos offline de acceso. El ejecutable de prueba está sin firma (`NotSigned`); no se ha probado el instalador NSIS ni el hardware mínimo. No hay despliegue productivo.
