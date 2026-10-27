// Historia 002 · suscripciones (grupo C1, criterios 69, 73 a 76, 88, 91 y 113): planes, la suscripción de
// cada sucursal, los pagos y el consumo mensual de comprobantes (RF-03 a RF-05).
//
// - `plan` es global (sin `empresa_id`): `restaurante_api` solo lo lee (política `lectura_api`) y
//   `restaurante_plataforma` lo lee y escribe (política `acceso_plataforma`). Un índice único parcial deja
//   un solo plan por defecto, y que sea siempre un plan activo. La migración crea `BASE` (por defecto,
//   todos los módulos, 7 días de gracia, precios y cuota sin definir). No lleva trazabilidad (no tiene
//   `empresa_id`; los cambios quedan en la auditoría).
// - `suscripcion`, `pago_suscripcion` y `consumo_comprobantes` son tablas de empresa y se crean con
//   `sqlTablaDeEmpresaTrazable` (RLS forzada, política `aislamiento_empresa`, trazabilidad). `pago_suscripcion`
//   es inmutable (un trigger por sentencia rechaza `UPDATE`, `DELETE` y `TRUNCATE`, también al dueño).
// - Datos: una suscripción `BASE` para cada sucursal existente, con vencimiento un mes después de hoy (fecha
//   de Lima) y el actor de sistema `migracion:suscripciones`. El migrador (dueño) queda sujeto a la RLS
//   forzada y sin política no vería ninguna fila, así que se quita `FORCE` de `plan`, `sucursal` y
//   `suscripcion` solo mientras dura el `INSERT`.
//
// `down` borra las cuatro tablas con sus datos (el código de C1 ya no existiría).
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable, sqlTablaDePlataforma } from './sql-tabla-de-empresa';

const MODULOS = ['SALON', 'COCINA', 'CAJA', 'FACTURACION', 'PEDIDOS_WEB', 'INVENTARIO', 'REPORTES'];
const LISTA_DE_MODULOS = MODULOS.map((m) => `'${m}'`).join(', ');

const SQL_PLAN = `
CREATE TABLE plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL CHECK (btrim(codigo) <> '' AND char_length(codigo) <= 30),
  nombre text NOT NULL CHECK (btrim(nombre) <> '' AND char_length(nombre) <= 100),
  precio_mensual numeric(10, 2) CHECK (precio_mensual IS NULL OR precio_mensual >= 0),
  cuota_comprobantes_mes integer CHECK (cuota_comprobantes_mes IS NULL OR cuota_comprobantes_mes >= 0),
  precio_excedente numeric(10, 4) CHECK (precio_excedente IS NULL OR precio_excedente >= 0),
  dias_gracia integer NOT NULL CHECK (dias_gracia BETWEEN 0 AND 60),
  modulos text[] NOT NULL CHECK (modulos <@ ARRAY[${LISTA_DE_MODULOS}]::text[]),
  por_defecto boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_codigo_unico UNIQUE (codigo),
  -- El plan por defecto siempre está activo.
  CONSTRAINT plan_por_defecto_activo CHECK (NOT por_defecto OR activo)
);
-- Un solo plan por defecto.
CREATE UNIQUE INDEX plan_por_defecto_unico ON plan ((true)) WHERE por_defecto;

-- Antes de activar la RLS: el migrador (dueño) no tendría política para insertar con ella forzada.
INSERT INTO plan (codigo, nombre, dias_gracia, modulos, por_defecto, activo)
  VALUES ('BASE', 'Plan base', 7, ARRAY[${LISTA_DE_MODULOS}]::text[], true, true);

ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan FORCE ROW LEVEL SECURITY;
CREATE POLICY lectura_api ON plan AS PERMISSIVE FOR SELECT TO restaurante_api USING (true);
GRANT SELECT ON plan TO restaurante_api;
${sqlTablaDePlataforma('plan', ['SELECT', 'INSERT', 'UPDATE'], { activarRls: false })}
`;

const SQL_SUSCRIPCION = `
CREATE TABLE suscripcion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES plan (id),
  -- Último día (de Lima) en que la suscripción está activa.
  vencimiento date NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suscripcion_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT suscripcion_sucursal_unica UNIQUE (sucursal_id),
  CONSTRAINT suscripcion_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);
CREATE INDEX suscripcion_empresa_id_idx ON suscripcion (empresa_id);
CREATE INDEX suscripcion_plan_id_idx ON suscripcion (plan_id);
${sqlTablaDeEmpresaTrazable('suscripcion', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: ['SELECT', 'INSERT', 'UPDATE'],
})}

CREATE TABLE pago_suscripcion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  suscripcion_id uuid NOT NULL,
  monto numeric(10, 2) NOT NULL CHECK (monto > 0),
  fecha_pago date NOT NULL,
  medio text NOT NULL CHECK (medio IN ('EFECTIVO', 'TRANSFERENCIA', 'YAPE', 'PLIN', 'TARJETA', 'OTRO')),
  referencia text CHECK (referencia IS NULL OR char_length(referencia) BETWEEN 1 AND 100),
  vencimiento_anterior date NOT NULL,
  vencimiento_nuevo date NOT NULL CHECK (vencimiento_nuevo > vencimiento_anterior),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pago_suscripcion_suscripcion_fk
    FOREIGN KEY (suscripcion_id, empresa_id) REFERENCES suscripcion (id, empresa_id)
);
CREATE INDEX pago_suscripcion_empresa_id_idx ON pago_suscripcion (empresa_id);
CREATE INDEX pago_suscripcion_suscripcion_idx ON pago_suscripcion (suscripcion_id);

-- Inmutable: ni UPDATE, ni DELETE, ni TRUNCATE (tampoco para el dueño). Por sentencia y no por fila, como
-- la auditoría: el migrador sujeto a la RLS forzada no ve filas y un trigger por fila nunca se dispararía.
CREATE FUNCTION pago_suscripcion_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION 'pago_suscripcion es de solo agregar: % no está permitido', TG_OP
    USING ERRCODE = '42501';
END
$fn$;
REVOKE ALL ON FUNCTION pago_suscripcion_inmutable() FROM PUBLIC;
CREATE TRIGGER pago_suscripcion_sin_modificar
  BEFORE UPDATE OR DELETE OR TRUNCATE ON pago_suscripcion
  FOR EACH STATEMENT EXECUTE FUNCTION pago_suscripcion_inmutable();
${sqlTablaDeEmpresaTrazable('pago_suscripcion', {
  privilegiosApi: [],
  privilegiosPlataforma: ['SELECT', 'INSERT'],
})}

CREATE TABLE consumo_comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  -- Mes de Lima (AAAA-MM).
  periodo char(7) NOT NULL CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  emitidos integer NOT NULL CHECK (emitidos >= 0),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumo_comprobantes_sucursal_periodo_unico UNIQUE (sucursal_id, periodo),
  CONSTRAINT consumo_comprobantes_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);
CREATE INDEX consumo_comprobantes_empresa_id_idx ON consumo_comprobantes (empresa_id);
${sqlTablaDeEmpresaTrazable('consumo_comprobantes', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: ['SELECT'],
})}
`;

// Una suscripción BASE para cada sucursal que ya existe. Hoy en Lima = UTC − 5 horas; `+ interval '1 month'`
// deja el último día del mes de llegada si el día no existe (como `sumarMeses`).
const SQL_DATOS = `
ALTER TABLE plan NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sucursal NO FORCE ROW LEVEL SECURITY;
ALTER TABLE suscripcion NO FORCE ROW LEVEL SECURITY;
SELECT public.fijar_contexto_actor(NULL, NULL, NULL, 'migracion:suscripciones');
INSERT INTO suscripcion (empresa_id, sucursal_id, plan_id, vencimiento)
  SELECT s.empresa_id,
         s.id,
         (SELECT p.id FROM plan p WHERE p.por_defecto),
         (((now() AT TIME ZONE 'UTC') - interval '5 hours')::date + interval '1 month')::date
    FROM sucursal s;
ALTER TABLE suscripcion FORCE ROW LEVEL SECURITY;
ALTER TABLE sucursal FORCE ROW LEVEL SECURITY;
ALTER TABLE plan FORCE ROW LEVEL SECURITY;
`;

const SQL_DOWN = `
DROP TABLE consumo_comprobantes;
DROP TABLE pago_suscripcion;
DROP FUNCTION pago_suscripcion_inmutable();
DROP TABLE suscripcion;
DROP TABLE plan;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_PLAN, { transaction });
  await sequelize.query(SQL_SUSCRIPCION, { transaction });
  await sequelize.query(SQL_DATOS, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
