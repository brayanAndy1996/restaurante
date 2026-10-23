# 003 — Persistencia de acceso en nube

Fecha: 2026-10-22. Estado: decisión técnica; verificación en spec 002.

## Decisión y fundamento

Se mantiene PostgreSQL y Sequelize 6.37.8 con pg 8.23.1. Sequelize administra conexiones y transacciones; las migraciones SQL explícitas definen restricciones, políticas RLS y funciones. No se usa `sync` para modificar esquemas. La prueba de integración se ejecuta con PostgreSQL 17.5 instalado en el equipo, en un cluster dedicado; este resultado no certifica hosting ni una versión productiva del servidor.

Cuenta web sin propiedad de tablas, superusuario, BYPASSRLS, creación de roles/bases ni pertenencia al rol auxiliar. El contexto de empresa es transaccional y lo establece el backend desde la sesión. Identidades y sesiones se resuelven previamente mediante funciones de privilegios delimitados: rol auxiliar NOLOGIN, permisos mínimos, search_path fijo, objetos calificados y ejecución revocada a PUBLIC. El proceso HTTP no recibe credencial de migración. Ver [RLS PostgreSQL](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) y [seguridad de funciones](https://www.postgresql.org/docs/17/sql-createfunction.html).

Argon2 0.45.1, Argon2id con memoria de 19456 KiB, tiempo 2 y paralelismo 1. La referencia de mínimos es [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); el contrato completo de contraseñas/sesiones y sus pruebas pertenece a spec 002. Medición en este equipo: cinco operaciones hash+verify con clave ficticia tardaron 50, 49, 50, 51 y 52 ms. No representa un umbral garantizado en hardware del cliente.

Sequelize introduce UUID 8 transitivo afectado por [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Se fija override exclusivamente de su dependencia a UUID 11.1.1, parche compatible con CommonJS. Comprobados defaults UUIDv1/v4 de Sequelize y construcción del ORM; sus transacciones se comprueban en la integración real de spec 002. No se aplica el downgrade de ORM propuesto por `npm audit fix --force`. Tras resolver el override, npm audit no reportó vulnerabilidades conocidas en esa consulta; no constituye garantía de seguridad.

## Entorno reproducible y límites

`scripts/local-postgres.ps1` prepara únicamente un cluster de desarrollo identificado dentro de `.local/`, loopback:55432, autenticación SCRAM y secretos aleatorios locales. No instala servicios ni toca otras instalaciones. Crea `restaurante_demo` y `restaurante_test`; no borra bases. Rechaza sobrescribir configuraciones distintas existentes. `.env` contiene solo runtime; `.env.admin` se usa en CLI; `.env.test` usa otra BD. Todos se excluyen de Git.

El helper requiere PostgreSQL ya instalado y PowerShell 7. Para Linux/hosting se provisionan PostgreSQL/roles/secretos según documentación y se usan las mismas migraciones, sin asumir disponible el helper Windows. Actualizar y calificar parche de servidor, TLS y operación de secretos antes de producción.

Acceso comercial solo cloud en esta etapa; modo local mantiene diagnóstico. No se han implementado autenticación offline ni replicación por instalar persistencia en nube. La continuidad sigue en [ADR002](002-continuidad.md).
