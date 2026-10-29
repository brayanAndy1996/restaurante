# Módulo 5. PostgreSQL, migraciones y aislamiento entre empresas

## Qué es

**PostgreSQL** es una base de datos **relacional**: guarda la información en **tablas**, como hojas de
cálculo con columnas fijas, relacionadas entre sí. Se consulta con **SQL**, un lenguaje para pedir y
modificar datos.

```
Tabla empresa                         Tabla sucursal
┌──────────────┬──────────┐           ┌──────────────┬────────────┬──────────────┐
│ id           │ nombre   │           │ id           │ nombre     │ empresa_id   │
├──────────────┼──────────┤           ├──────────────┼────────────┼──────────────┤
│ a1b2…        │ El Fogón │◄──────────│ c3d4…        │ Miraflores │ a1b2…        │
│ e5f6…        │ La Marea │           │ g7h8…        │ Barranco   │ a1b2…        │
└──────────────┴──────────┘           └──────────────┴────────────┴──────────────┘
                                       empresa_id dice a qué empresa pertenece cada sucursal
```

## Para qué sirve

Es la memoria permanente del sistema: empresas, usuarios, carta, pedidos, pagos y comprobantes. Además
garantiza cosas que sería peligroso dejar solo al código:

- **Transacciones:** varias operaciones se guardan todas juntas o ninguna. Por ejemplo, un pago y su
  comprobante nunca quedan a medias.
- **Reglas de integridad:** por ejemplo, que no existan dos sucursales con el mismo nombre en una
  empresa.
- **Aislamiento entre empresas (RLS),** la pieza más importante de este proyecto (abajo).

## SQL básico

| Quieres…         | SQL                                                       |
| ---------------- | --------------------------------------------------------- |
| Leer filas       | `SELECT nombre FROM sucursal WHERE empresa_id = 'a1b2…';` |
| Agregar una fila | `INSERT INTO estacion (nombre, …) VALUES ('Cocina', …);`  |
| Cambiar una fila | `UPDATE producto SET precio = 25.00 WHERE id = '…';`      |
| Borrar una fila  | `DELETE FROM … WHERE id = '…';`                           |

En el código casi nunca escribirás SQL a mano para leer y guardar: de eso se encarga **Sequelize**
(módulo 6). El SQL aparece sobre todo en las migraciones.

## Las migraciones

### Qué son

Una **migración** es un archivo que cambia la estructura de la base: crea una tabla, agrega una
columna, crea un índice. Se aplican en orden y quedan registradas, así todas las bases (la tuya, la de
pruebas, la de producción) tienen exactamente la misma estructura.

### En este proyecto

Están en `apps/api/src/migraciones/`, nombradas con fecha y número para que el orden sea claro:

```
202610270001-plataforma-base.ts       ← empresas, emisores, sucursales
202610280001-acceso-base.ts           ← usuarios, sesiones, accesos
202610290001-carta-base.ts            ← estaciones, familias, productos
…
```

Las ejecuta la librería **umzug** con `pnpm db:migrar`. Cada migración tiene una función `up` (aplicar)
y una `down` (deshacer, con `pnpm db:revertir`). Una regla del proyecto: **nunca se edita una migración ya
aplicada**; si algo cambia, se crea una nueva.

## Los tres usuarios de la base

Por seguridad, la API no se conecta con un usuario todopoderoso. `pnpm db:preparar` crea tres
usuarios (en PostgreSQL se llaman **roles**), cada uno con solo los permisos que necesita:

| Rol                      | Lo usa                        | Puede                                                  |
| ------------------------ | ----------------------------- | ------------------------------------------------------ |
| `restaurante_migrador`   | Las migraciones               | Crear y cambiar tablas                                 |
| `restaurante_api`        | La API, en cada petición      | Leer y escribir datos, solo de la empresa de la sesión |
| `restaurante_plataforma` | Operaciones de nuestro equipo | Lo justo para crear empresas y gestionar suscripciones |

Cada uno tiene su URL de conexión en el archivo `.env` (`DATABASE_MIGRADOR_URL`, `DATABASE_URL`,
`DATABASE_PLATAFORMA_URL`).

## El aislamiento entre empresas (RLS)

Este sistema guarda los datos de muchos restaurantes en **una sola base de datos**. Que un
restaurante vea los datos de otro sería el peor error posible. Para evitarlo hay dos capas: la API
filtra por empresa y, además, la propia base de datos lo impide con **RLS** (Row Level Security,
"seguridad a nivel de fila").

Funciona así:

1. Cada tabla con datos de clientes tiene una columna `empresa_id`.
2. Al empezar cada petición, la API abre una transacción y le dice a la base de qué empresa es la
   sesión.
3. La tabla tiene una **política** que dice: "el rol `restaurante_api` solo ve y modifica las filas
   cuya `empresa_id` coincide con la empresa de la transacción". La base aplica esa regla a toda
   consulta, aunque el código se olvide de filtrar.
4. Si la API no fijó ninguna empresa, la consulta **falla**, en lugar de devolver datos de todos.

En el código, todo esto lo genera `apps/api/src/migraciones/sql-tabla-de-empresa.ts`, que cada
migración usa al crear una tabla. Lo central es esta política:

```sql
ALTER TABLE producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE producto FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON producto FOR ALL TO restaurante_api
  USING (empresa_id = (SELECT empresa_actual()))        -- qué filas puede ver
  WITH CHECK (empresa_id = (SELECT empresa_actual()));  -- qué filas puede escribir
```

`empresa_actual()` es una función de la base que devuelve la empresa fijada en la transacción, o da
error si no hay ninguna.

Por esto el aislamiento está en la "ruta crítica" del proyecto: tiene pruebas escritas antes del
código y fue atacado por el agente adversarial. Puedes verlas en `apps/api/test/aislamiento/`.

## Práctica (15 minutos)

Abre una consola de SQL dentro del contenedor de Docker, con el usuario administrador:

```bash
docker compose exec postgres psql -U postgres -d restaurante
```

Verás un indicador `restaurante=#`. Prueba:

```sql
\dt                         -- lista las tablas
SELECT nombre FROM empresa; -- las empresas de demostración
\q                          -- salir
```

Ahora, como el rol de la API y sin fijar empresa (la contraseña local es `api_local`):

```bash
docker compose exec postgres psql -U restaurante_api -d restaurante -h localhost
```

```sql
SELECT nombre FROM sucursal;  -- falla con "contexto de empresa ausente": eso es la RLS protegiéndote
\q
```

Si prefieres algo visual en lugar de la consola, puedes instalar [DBeaver](https://dbeaver.io/)
(gratuito) y conectarte a `localhost`, puerto `5433`, usuario `postgres`, contraseña `postgres`, base
`restaurante`. Úsalo solo para mirar: los cambios de estructura se hacen con migraciones.

## Para profundizar

- [Tutorial oficial de PostgreSQL](https://www.postgresql.org/docs/16/tutorial.html)
- [Row Level Security en PostgreSQL](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)
- La sección "Aislamiento entre empresas: reglas para quien programa" del `README.md`
