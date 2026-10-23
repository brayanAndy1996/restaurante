# 001 — Stack de restaurante

Fecha: 2026-10-22. Estado: aceptado para base técnica; persistencia y empaquetado requieren pruebas en sus entregas.

## Requisitos

Producto multitenant, primera instalación con un local. Mozos usan celulares/tablets. Caja puede cambiar de dispositivo autorizado. Nube habitual con continuidad mediante servidor local cuando falta internet. Impresoras térmicas de red por estación; KDS también en alcance del producto. Inventario de disponibilidad/cantidades. Sin facturación electrónica en primera versión comercial. Caída simultánea de servidor local e internet fuera de continuidad garantizada.

## Decisión

- TypeScript. Node.js 24 como runtime de desarrollo/backend; entorno disponible 24.1.0 y npm 11.3.0. Fijar y actualizar a parche soportado antes del piloto.
- Next.js 16.4.2, React 19.3.1, React DOM 19.3.1 para interfaz mínima exportada estáticamente. Sin Server Actions ni backend paralelo en Next.
- Backend HTTP Node.js separado de presentación; en la base, APIs pequeñas con módulos nativos, sin framework adicional. Se evaluará framework si transporte/validación del acceso lo justifica.
- TypeScript 6.0.3 (línea compatible elegida de forma conservadora, no adoptar automáticamente la mayor más reciente), tsx 4.23.15 y tipos fijados en package-lock.
- PostgreSQL servidor y Sequelize 6 estable para nube. SQLite y Sequelize para servidor local. Sin dependencias de persistencia instaladas aún: la spec de primeras migraciones validará drivers, restricciones, transacciones y aislamiento real en cada motor. Versiones consultadas: Sequelize 6.37.8, pg 8.23.1, sqlite3 6.0.1; no se declaran verificadas sin implementación.
- Electron para administración/servicio de escritorio local en una entrega posterior. No se instala en celulares/tablets. Primera entrega ejecuta backend Node y frontend desde navegador; instalador, autoinicio, Electron y drivers nativos siguen pendientes.
- `node:test` para contratos del backend y pruebas unitarias. Pruebas de integración reales por motor cuando exista persistencia. UI con revisión visual y smoke HTTP del export real.

## Adecuación y límites

La exportación estática permite servir recursos desde nube o LAN sin CDN ni runtime Next en el restaurante; la lógica queda en un backend propio reutilizable dentro de este producto. El backend sirve frontend y API bajo un mismo origen. Primer bind en loopback; exposición LAN/HTTPS será explícita y se validará antes de usar celulares reales. Acceso público cloud y autenticación offline segura requieren despliegue/TLS y especificación propia.

SQLite evita instalar otro servicio de BD en el local; PostgreSQL mantiene la preferencia para nube multitenant. Compartir ORM no demuestra equivalencia: probar migraciones, transacciones, claves compuestas y aislamiento por separado. No montar archivos SQLite en red.

No duplicar reglas por motor ni acoplar dominio a HTTP/Electron. La replicación de cambios entre nube y local es trabajo explícito del producto; no está resuelta por Sequelize. Impresión requiere un agente local, no conexión directa desde nube a IP privada. Validar ESC/POS y modelo real. La PC de caja no debe ser dependencia implícita del agente de impresión.

## Evidencia y fuentes

Consultadas el 2026-10-22: [Next instalación](https://nextjs.org/docs/app/getting-started/installation), [exportación estática](https://nextjs.org/docs/app/guides/static-exports), [Sequelize versiones](https://sequelize.org/releases/), [Sequelize v6](https://sequelize.org/docs/v6/), [Electron releases](https://releases.electronjs.org/). npm confirma engines de Next `>=20.9.0`; versiones exactas seleccionadas se guardan en lockfile. El entorno disponible supera ese mínimo; esto no certifica el instalador Windows.

Prueba acotada de esta entrega: typecheck, tests API, build export estático, servir artefacto por Node y revisar UI. La spec registrará evidencia ejecutada. Versiones de Electron, drivers definitivos, TLS LAN, rendimiento/concurrencia, matriz Android/iOS y firma/instalación se cierran antes de sus implementaciones/piloto.
