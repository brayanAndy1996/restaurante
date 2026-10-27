// Historia 002 · trazabilidad (criterios 113 a 120): quién creó y quién cambió por última vez cada fila
// de datos de clientes, lleno por la base a partir del contexto de actor de la transacción.
//
// - `contexto.sesion_actor` (esquema `contexto` de 001, sin acceso para los roles de la aplicación) guarda el
//   actor de la transacción, una fila por sesión de la base (`pid`) y válida solo para la transacción
//   cuya `xid8` guarda, como `contexto.sesion_empresa`.
// - `public.fijar_contexto_actor(usuario, equipo, superadministrador, sistema)` (`SECURITY DEFINER`, dueño el
//   migrador, `search_path` fijo) lo escribe: exactamente un actor, equipo solo con usuario, una sola vez
//   por transacción. Es una función aparte de `fijar_contexto_empresa` porque la plataforma escribe sin
//   empresa y porque cambiar la firma de 001 rompería sus pruebas y la guarda de texto exacto.
// - `public.trazabilidad()` es la función del trigger `trazabilidad` (`BEFORE INSERT OR UPDATE` por fila):
//   sin actor lanza `42501` "contexto de actor ausente"; en `INSERT` pone los dos grupos de columnas y en
//   `UPDATE` pone `actualizado_por_*` y conserva `creado_por_*`. Lo que envíe la API en esas columnas se
//   descarta.
// - Se agregan las columnas y el trigger a `empresa`, `emisor`, `sucursal` (filas existentes con
//   `migracion:trazabilidad`), `usuario` y `acceso_sucursal`. Las llaves hacia `equipo` las agrega la
//   migración de equipos (C2).
//
// ATENCIÓN con `down`: quita el trigger de las cinco tablas; las escrituras dejan de llevar actor.
// Revertirla exige revertir también el código que fija el actor (`ContextoEmpresa`, `OperacionPlataforma`).
import type { ContextoMigracion } from './tipos';
import { sqlQuitarTrazabilidad, sqlTrazabilidad } from './sql-tabla-de-empresa';

const SQL_FUNCIONES = `
-- Actor de la transacción: una fila por sesión de la base (pid), con la xid de la transacción que la fijó.
CREATE UNLOGGED TABLE contexto.sesion_actor (
  pid integer PRIMARY KEY,
  xid xid8 NOT NULL,
  usuario_id uuid,
  equipo_id uuid,
  superadministrador_id uuid,
  sistema text
) WITH (
  fillfactor = 50,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 50,
  autovacuum_vacuum_insert_threshold = 50,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 500,
  autovacuum_vacuum_cost_delay = 2
);
ALTER TABLE contexto.sesion_actor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE contexto.sesion_actor FROM PUBLIC;

-- Fija el actor de la transacción en curso, una sola vez (aunque sea el mismo actor).
CREATE FUNCTION public.fijar_contexto_actor(
  p_usuario uuid, p_equipo uuid, p_superadministrador uuid, p_sistema text
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
BEGIN
  IF pg_catalog.num_nonnulls(p_usuario, p_superadministrador, p_sistema) <> 1 THEN
    RAISE EXCEPTION 'el actor debe ser exactamente uno: usuario, superadministrador o sistema'
      USING ERRCODE = '22023';
  END IF;
  IF p_equipo IS NOT NULL AND p_usuario IS NULL THEN
    RAISE EXCEPTION 'el equipo solo puede acompañar a un usuario' USING ERRCODE = '22023';
  END IF;
  IF p_sistema IS NOT NULL AND pg_catalog.char_length(p_sistema) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'el actor de sistema debe tener de 1 a 100 caracteres' USING ERRCODE = '22023';
  END IF;
  INSERT INTO contexto.sesion_actor AS s (pid, xid, usuario_id, equipo_id, superadministrador_id, sistema)
  VALUES (pg_catalog.pg_backend_pid(), pg_catalog.pg_current_xact_id(), p_usuario, p_equipo,
          p_superadministrador, p_sistema)
  ON CONFLICT (pid) DO UPDATE
    SET xid = EXCLUDED.xid,
        usuario_id = EXCLUDED.usuario_id,
        equipo_id = EXCLUDED.equipo_id,
        superadministrador_id = EXCLUDED.superadministrador_id,
        sistema = EXCLUDED.sistema
    WHERE s.xid <> EXCLUDED.xid;
  IF NOT FOUND THEN
    -- Ya había una fila de esta misma transacción: el actor no se cambia.
    RAISE EXCEPTION 'contexto de actor ya fijado' USING ERRCODE = '42501';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.fijar_contexto_actor(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fijar_contexto_actor(uuid, uuid, uuid, text)
  TO restaurante_api, restaurante_plataforma;

-- Función del trigger de trazabilidad (la ejecuta el trigger; nadie más tiene EXECUTE).
CREATE FUNCTION public.trazabilidad() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
DECLARE
  actor contexto.sesion_actor%ROWTYPE;
BEGIN
  SELECT s.* INTO actor
    FROM contexto.sesion_actor s
   WHERE s.pid = pg_catalog.pg_backend_pid()
     AND s.xid = pg_catalog.pg_current_xact_id_if_assigned();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contexto de actor ausente' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.creado_por_usuario_id := actor.usuario_id;
    NEW.creado_por_equipo_id := actor.equipo_id;
    NEW.creado_por_superadministrador_id := actor.superadministrador_id;
    NEW.creado_por_sistema := actor.sistema;
  ELSE
    NEW.creado_por_usuario_id := OLD.creado_por_usuario_id;
    NEW.creado_por_equipo_id := OLD.creado_por_equipo_id;
    NEW.creado_por_superadministrador_id := OLD.creado_por_superadministrador_id;
    NEW.creado_por_sistema := OLD.creado_por_sistema;
  END IF;
  NEW.actualizado_por_usuario_id := actor.usuario_id;
  NEW.actualizado_por_equipo_id := actor.equipo_id;
  NEW.actualizado_por_superadministrador_id := actor.superadministrador_id;
  NEW.actualizado_por_sistema := actor.sistema;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.trazabilidad() FROM PUBLIC;
`;

const SQL_TABLAS = [
  // Tablas de 001 (con filas existentes). `empresa` se identifica por su propio `id`.
  sqlTrazabilidad('empresa', {
    columnaEmpresa: 'id',
    rellenarFilasExistentesCon: 'migracion:trazabilidad',
  }),
  sqlTrazabilidad('emisor', { rellenarFilasExistentesCon: 'migracion:trazabilidad' }),
  sqlTrazabilidad('sucursal', { rellenarFilasExistentesCon: 'migracion:trazabilidad' }),
  // Tablas de la migración anterior (vacías).
  sqlTrazabilidad('usuario'),
  sqlTrazabilidad('acceso_sucursal'),
].join('\n');

const SQL_DOWN = `
${['acceso_sucursal', 'usuario', 'sucursal', 'emisor', 'empresa'].map(sqlQuitarTrazabilidad).join('\n')}
DROP FUNCTION public.trazabilidad();
DROP FUNCTION public.fijar_contexto_actor(uuid, uuid, uuid, text);
DROP TABLE contexto.sesion_actor;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_FUNCIONES, { transaction });
  await sequelize.query(SQL_TABLAS, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
