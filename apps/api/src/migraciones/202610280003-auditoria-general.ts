// Historia 002 · auditoría general (criterios 54 a 60, 119): la tabla `auditoria` reemplaza a
// `auditoria_plataforma` de 001 y la copia (cada fila queda con `origen = 'plataforma'`, `accion` = su
// `operacion` y `actor_sistema` = su `actor`) antes de eliminarla.
//
// - Inmutable: un trigger por sentencia rechaza `UPDATE`, `DELETE` y `TRUNCATE` también al dueño (el
//   migrador, aunque no vea filas por la RLS forzada); la API y la plataforma ni siquiera tienen el
//   privilegio.
// - El actor y el equipo los pone un trigger `BEFORE INSERT` desde el contexto de actor de la
//   transacción (criterio 119): lo que envíe quien inserta se descarta, así que una fila de auditoría y
//   el cambio que registra tienen siempre el mismo actor. Sin actor, `42501` "contexto de actor ausente".
// - `equipo_id` y `autorizacion_id` quedan sin llave: las tablas `equipo` y `autorizacion` llegan en las
//   migraciones de C2 y C3, que agregan las llaves. Sin trazabilidad propia (excepción del criterio 113).
// - `down`: recrea `auditoria_plataforma` como en 001, devuelve las filas de origen plataforma
//   (`actor` = `actor_sistema` o el id del superadministrador como texto) y borra `auditoria`; las filas
//   de origen empresa se pierden con la tabla (el código de la sección 002 ya no existiría).
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresa, sqlTablaDePlataforma } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES empresa (id),
  sucursal_id uuid,
  ocurrido_en timestamptz NOT NULL,
  origen text NOT NULL CHECK (origen IN ('empresa', 'plataforma')),
  accion text NOT NULL CHECK (btrim(accion) <> ''),
  actor_usuario_id uuid,
  actor_superadministrador_id uuid REFERENCES superadministrador (id),
  actor_sistema text,
  -- Sin llave todavía: la tabla equipo llega en la migración de equipos (C2).
  equipo_id uuid,
  autorizado_por_id uuid,
  -- Sin llave todavía: la tabla autorizacion llega en la migración de autorizaciones (C3).
  autorizacion_id uuid,
  -- La sesión puede ser de empresa o de soporte; sin llave para no acoplar la auditoría a las sesiones.
  sesion_id uuid,
  motivo text,
  entidad text,
  entidad_id uuid,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT auditoria_sucursal_fk FOREIGN KEY (sucursal_id, empresa_id)
    REFERENCES sucursal (id, empresa_id),
  CONSTRAINT auditoria_actor_usuario_fk FOREIGN KEY (actor_usuario_id, empresa_id)
    REFERENCES usuario (id, empresa_id),
  CONSTRAINT auditoria_autorizado_por_fk FOREIGN KEY (autorizado_por_id, empresa_id)
    REFERENCES usuario (id, empresa_id),
  -- Exactamente un actor.
  CONSTRAINT auditoria_actor_ck CHECK (
    num_nonnulls(actor_usuario_id, actor_superadministrador_id, actor_sistema) = 1
  ),
  -- El equipo solo acompaña a un usuario.
  CONSTRAINT auditoria_equipo_ck CHECK (equipo_id IS NULL OR actor_usuario_id IS NOT NULL)
);
CREATE INDEX auditoria_empresa_ocurrido_idx ON auditoria (empresa_id, ocurrido_en);
CREATE INDEX auditoria_ocurrido_idx ON auditoria (ocurrido_en);

-- Inmutable: ni UPDATE, ni DELETE, ni TRUNCATE (tampoco para el dueño). El trigger es por sentencia y
-- no por fila: el migrador (dueño) queda sujeto a la RLS forzada y sin política no ve ninguna fila, así
-- que un trigger por fila nunca se dispararía para él y la sentencia "tendría éxito" sin cambiar nada.
CREATE FUNCTION auditoria_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION 'auditoria es de solo agregar: % no está permitido', TG_OP
    USING ERRCODE = '42501';
END
$fn$;
REVOKE ALL ON FUNCTION auditoria_inmutable() FROM PUBLIC;
CREATE TRIGGER auditoria_sin_modificar
  BEFORE UPDATE OR DELETE OR TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();

-- El actor y el equipo de la fila salen del contexto de actor de la transacción, no del que inserta.
CREATE FUNCTION public.auditoria_actor() RETURNS trigger
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
  NEW.actor_usuario_id := actor.usuario_id;
  NEW.equipo_id := actor.equipo_id;
  NEW.actor_superadministrador_id := actor.superadministrador_id;
  NEW.actor_sistema := actor.sistema;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.auditoria_actor() FROM PUBLIC;
CREATE TRIGGER auditoria_actor BEFORE INSERT ON auditoria
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_actor();

-- RLS forzada, política de la API (solo su empresa) y acceso de plataforma.
${sqlTablaDeEmpresa('auditoria', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: ['SELECT', 'INSERT'],
})}

-- Copia de las filas de 001. El migrador (dueño) queda sujeto a la RLS forzada y no vería ninguna fila,
-- así que se quita FORCE solo durante la copia; el trigger del actor se desactiva porque la copia
-- conserva el actor original como actor_sistema.
ALTER TABLE auditoria_plataforma NO FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria NO FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria DISABLE TRIGGER auditoria_actor;
INSERT INTO auditoria (id, empresa_id, ocurrido_en, origen, accion, actor_sistema, motivo, detalle)
  SELECT id, empresa_id, ocurrido_en, 'plataforma', operacion, actor, motivo, detalle
    FROM auditoria_plataforma;
ALTER TABLE auditoria ENABLE TRIGGER auditoria_actor;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;

DROP TABLE auditoria_plataforma;
DROP FUNCTION auditoria_plataforma_inmutable();
`;

const SQL_DOWN = `
CREATE TABLE auditoria_plataforma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL CHECK (btrim(actor) <> ''),
  operacion text NOT NULL CHECK (btrim(operacion) <> ''),
  motivo text NOT NULL CHECK (btrim(motivo) <> ''),
  empresa_id uuid REFERENCES empresa (id),
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX auditoria_plataforma_empresa_id_idx ON auditoria_plataforma (empresa_id);

CREATE FUNCTION auditoria_plataforma_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION 'auditoria_plataforma es de solo agregar: % no está permitido', TG_OP
    USING ERRCODE = '42501';
END
$fn$;
REVOKE ALL ON FUNCTION auditoria_plataforma_inmutable() FROM PUBLIC;
CREATE TRIGGER auditoria_plataforma_sin_modificar
  BEFORE UPDATE OR DELETE ON auditoria_plataforma
  FOR EACH ROW EXECUTE FUNCTION auditoria_plataforma_inmutable();
CREATE TRIGGER auditoria_plataforma_sin_vaciar
  BEFORE TRUNCATE ON auditoria_plataforma
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_plataforma_inmutable();

${sqlTablaDePlataforma('auditoria_plataforma', ['SELECT', 'INSERT'])}

ALTER TABLE auditoria_plataforma NO FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria NO FORCE ROW LEVEL SECURITY;
INSERT INTO auditoria_plataforma (id, ocurrido_en, actor, operacion, motivo, empresa_id, detalle)
  SELECT id,
         ocurrido_en,
         COALESCE(actor_sistema, actor_superadministrador_id::text, '(desconocido)'),
         accion,
         COALESCE(NULLIF(btrim(motivo), ''), '(sin motivo)'),
         empresa_id,
         detalle
    FROM auditoria
   WHERE origen = 'plataforma';
ALTER TABLE auditoria_plataforma FORCE ROW LEVEL SECURITY;

DROP TABLE auditoria;
DROP FUNCTION auditoria_inmutable();
DROP FUNCTION public.auditoria_actor();
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
