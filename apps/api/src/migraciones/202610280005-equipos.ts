// Historia 002 · equipos recordados (grupo C2, criterios 27 a 42, 88, 91 y 113): el equipo (navegador) de una
// empresa, la relación equipo-persona que lo recuerda y la configuración de inactividad de cada sucursal.
//
// - `equipo`: pertenece a una empresa y a ninguna sucursal; guarda solo la huella SHA-256 del secreto de su
//   token (`eq.<empresa>.<equipo>.<secreto>`).
// - `equipo_recordado`: (equipo, persona). Una fila activa (`revocado_en` nulo) por equipo y persona
//   (índice único parcial); al revocarse queda el motivo (`REVOCADO`, `OLVIDADO`, `REEMPLAZADO`, `BLOQUEO`,
//   `DESACTIVADO` o `CONTRASENA_RESTABLECIDA`) y la historia se conserva. Guarda también la última sucursal
//   que la persona eligió en ese equipo (criterio 33).
// - `sucursal_acceso`: minutos de inactividad de las sesiones PIN de la sucursal (criterio 40; 5 por defecto
//   mientras no haya fila).
// - Las tres son tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`).
// - Llaves hacia `equipo` (compuestas con la empresa): `sesion.equipo_id`, `sesion.equipo_recordado_id`
//   (junto con el equipo y la persona, para que la sesión no pueda mezclar un equipo con el recordado de
//   otro), `auditoria.equipo_id` y `creado_por_equipo_id` / `actualizado_por_equipo_id` de todas las
//   tablas trazadas que existan (las que `sqlTrazabilidad` dejó sin llave hasta que existiera `equipo`).
//   Las tablas trazadas que se creen después piden la llave con `sqlTrazabilidad(…, { llaveDeEquipo: true })`.
//
// `down` quita las llaves, deja sin equipo las sesiones y las columnas `*_equipo_id` de las tablas trazadas
// (excepto `pago_suscripcion`, inmutable y siempre escrita por la plataforma, sin equipo) y borra las tres
// tablas con sus datos (el código de C2 ya no existiría).
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_TABLAS = `
CREATE TABLE equipo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  -- Solo la huella SHA-256 del secreto del token; nunca el token ni el secreto.
  huella_secreto bytea NOT NULL,
  ultimo_uso_en timestamptz NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipo_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX equipo_empresa_id_idx ON equipo (empresa_id);
${sqlTablaDeEmpresaTrazable('equipo', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
})}

CREATE TABLE equipo_recordado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  equipo_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  recordado_en timestamptz NOT NULL,
  ultimo_uso_en timestamptz NOT NULL,
  -- Orden de alta, para desempatar con certeza cuando dos filas comparten instante (el reloj de la API
  -- puede repetirse): la recordada primero es la de menor orden.
  orden bigint GENERATED ALWAYS AS IDENTITY,
  -- Última sucursal que la persona eligió en este equipo (criterio 33).
  ultima_sucursal_id uuid,
  revocado_en timestamptz,
  motivo_revocacion text CHECK (motivo_revocacion IN (
    'REVOCADO', 'OLVIDADO', 'REEMPLAZADO', 'BLOQUEO', 'DESACTIVADO', 'CONTRASENA_RESTABLECIDA')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipo_recordado_equipo_fk
    FOREIGN KEY (equipo_id, empresa_id) REFERENCES equipo (id, empresa_id),
  CONSTRAINT equipo_recordado_usuario_fk
    FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT equipo_recordado_sucursal_fk
    FOREIGN KEY (ultima_sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT equipo_recordado_revocacion_ck CHECK ((revocado_en IS NULL) = (motivo_revocacion IS NULL)),
  CONSTRAINT equipo_recordado_id_empresa_unico UNIQUE (id, empresa_id),
  -- Para que una sesión no pueda mezclar un equipo con el recordado de otro equipo o de otra persona.
  CONSTRAINT equipo_recordado_id_equipo_usuario_unico UNIQUE (id, equipo_id, usuario_id, empresa_id)
);
-- Un equipo recuerda a una persona una sola vez a la vez (la historia de revocadas se conserva).
CREATE UNIQUE INDEX equipo_recordado_activo_unico ON equipo_recordado (equipo_id, usuario_id)
  WHERE revocado_en IS NULL;
CREATE INDEX equipo_recordado_usuario_idx ON equipo_recordado (usuario_id) WHERE revocado_en IS NULL;
CREATE INDEX equipo_recordado_empresa_id_idx ON equipo_recordado (empresa_id);
${sqlTablaDeEmpresaTrazable('equipo_recordado', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
})}

CREATE TABLE sucursal_acceso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  minutos_inactividad integer NOT NULL CHECK (minutos_inactividad BETWEEN 1 AND 120),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sucursal_acceso_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT sucursal_acceso_sucursal_unica UNIQUE (sucursal_id)
);
CREATE INDEX sucursal_acceso_empresa_id_idx ON sucursal_acceso (empresa_id);
${sqlTablaDeEmpresaTrazable('sucursal_acceso', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
})}

-- Las sesiones apuntan al equipo y al equipo recordado (con la persona, para que no se mezclen).
ALTER TABLE sesion
  ADD CONSTRAINT sesion_equipo_fk
    FOREIGN KEY (equipo_id, empresa_id) REFERENCES equipo (id, empresa_id),
  ADD CONSTRAINT sesion_equipo_recordado_fk
    FOREIGN KEY (equipo_recordado_id, equipo_id, usuario_id, empresa_id)
    REFERENCES equipo_recordado (id, equipo_id, usuario_id, empresa_id);
CREATE INDEX sesion_equipo_recordado_idx ON sesion (equipo_recordado_id)
  WHERE cerrada_en IS NULL AND equipo_recordado_id IS NOT NULL;

-- La auditoría lleva el equipo del actor. NOT VALID: la auditoría es inmutable, así que sus filas viejas
-- no se pueden corregir; la llave se exige a toda fila nueva y así revertir y volver a migrar no choca con equipos que ya no existen.
ALTER TABLE auditoria
  ADD CONSTRAINT auditoria_equipo_fk
    FOREIGN KEY (equipo_id, empresa_id) REFERENCES equipo (id, empresa_id) NOT VALID;
`;

/** Tablas de `public` con las columnas de trazabilidad del equipo (y la columna que lleva su empresa). */
const SQL_TABLAS_TRAZADAS = `
SELECT c.relname::text AS tabla
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'creado_por_equipo_id'
   AND NOT a.attisdropped
 ORDER BY c.relname`;

const GRUPOS = ['creado_por', 'actualizado_por'] as const;

/** Tablas trazadas inmutables: no se pueden actualizar, y la plataforma las escribe siempre sin equipo. */
const TABLAS_SIN_LIMPIAR = ['pago_suscripcion'];

const columnaEmpresaDe = (tabla: string) => (tabla === 'empresa' ? 'id' : 'empresa_id');

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_TABLAS, { transaction });
  const [filas] = (await sequelize.query(SQL_TABLAS_TRAZADAS, { transaction })) as [
    { tabla: string }[],
    unknown,
  ];
  const llaves = filas.flatMap(({ tabla }) =>
    GRUPOS.map(
      (grupo) =>
        `ALTER TABLE ${tabla} ADD CONSTRAINT ${tabla}_${grupo}_equipo_fk
           FOREIGN KEY (${grupo}_equipo_id, ${columnaEmpresaDe(tabla)})
           REFERENCES equipo (id, empresa_id);`,
    ),
  );
  await sequelize.query(llaves.join('\n'), { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  const [filas] = (await sequelize.query(SQL_TABLAS_TRAZADAS, { transaction })) as [
    { tabla: string }[],
    unknown,
  ];
  const quitar = filas.flatMap(({ tabla }) =>
    GRUPOS.map((grupo) => `ALTER TABLE ${tabla} DROP CONSTRAINT ${tabla}_${grupo}_equipo_fk;`),
  );
  // Sin equipos no puede quedar ninguna referencia a ellos: el migrador (dueño) queda sujeto a la RLS
  // forzada, así que se quita FORCE solo mientras dura cada limpieza; el trigger de trazabilidad se apaga
  // solo para que el UPDATE no pida un actor.
  const limpiar = filas
    .filter(({ tabla }) => !TABLAS_SIN_LIMPIAR.includes(tabla))
    .filter(({ tabla }) => !['equipo', 'equipo_recordado', 'sucursal_acceso'].includes(tabla))
    .map(
      ({ tabla }) => `
ALTER TABLE ${tabla} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ${tabla} DISABLE TRIGGER trazabilidad;
UPDATE ${tabla} SET creado_por_equipo_id = NULL, actualizado_por_equipo_id = NULL
 WHERE creado_por_equipo_id IS NOT NULL OR actualizado_por_equipo_id IS NOT NULL;
ALTER TABLE ${tabla} ENABLE TRIGGER trazabilidad;
ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY;`,
    );
  await sequelize.query(
    `
${quitar.join('\n')}
${limpiar.join('\n')}
ALTER TABLE auditoria DROP CONSTRAINT auditoria_equipo_fk;
DROP INDEX sesion_equipo_recordado_idx;
ALTER TABLE sesion DROP CONSTRAINT sesion_equipo_recordado_fk, DROP CONSTRAINT sesion_equipo_fk;
ALTER TABLE sesion NO FORCE ROW LEVEL SECURITY;
DELETE FROM sesion WHERE tipo = 'PIN';
UPDATE sesion SET equipo_id = NULL, equipo_recordado_id = NULL
 WHERE equipo_id IS NOT NULL OR equipo_recordado_id IS NOT NULL;
ALTER TABLE sesion FORCE ROW LEVEL SECURITY;
DROP TABLE sucursal_acceso;
DROP TABLE equipo_recordado;
DROP TABLE equipo;
`,
    { transaction },
  );
}
