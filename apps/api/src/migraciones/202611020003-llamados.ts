// Historia 005 · carta web y pedido desde la mesa con QR, grupo C2 (criterios 26 a 38, 53 a 55 y 60 a 65): los
// llamados que el cliente manda desde la mesa (RF-85, RF-86, RF-88).
//
// - `llamado`: lo que manda el cliente (`PEDIDO` con líneas, `LLAMAR_MOZO` o `PEDIR_CUENTA`) y lo que hace el mozo con
//   él (atender, pasar a la cuenta, descartar; el vencimiento se calcula al leer y se guarda cuando alguien lo toca).
//   Clave primaria `(empresa_id, id)`: el `id` lo genera el navegador del cliente y es único por empresa, no en todo
//   el sistema (el mismo UUID usado en otra empresa crea su propia fila). Todas las referencias son llaves foráneas
//   compuestas con la empresa: sucursal, mesa (con su sucursal), orden, usuarios (destinatario, quien atendió y quien
//   cerró) y equipos. Las líneas van en `lineas` (jsonb, hasta 30, inmutables): se leen siempre juntas.
// - Los `CHECK` de coherencia fijan qué columnas lleva cada tipo y cada estado. No exigen un usuario para el equipo ni
//   para quien cerró: una sesión de soporte deja esas columnas nulas (criterio 60).
// - `huella_ip` es el HMAC-SHA256 de la IP del cliente (32 bytes); la IP nunca se guarda (criterio 33).
//   `huella_entrada` es la huella de la entrada normalizada y `respuesta_creacion` la respuesta 201 que se devuelve en
//   una réplica por `id` (criterio 29). `respuesta_paso` y `huella_paso` hacen lo mismo con el paso a la cuenta
//   (criterio 51).
// - Un índice único parcial asegura un solo llamado `PENDIENTE` por mesa (criterio 30); los demás sirven a los límites
//   por mesa y por conexión (criterios 32 y 33) y a la lista del mozo (criterio 39).
// - Tabla de empresa trazable con `llaveDeEquipo`; privilegios de `restaurante_api`: SELECT, INSERT y UPDATE (nunca
//   DELETE: un llamado no se borra).
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE llamado (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  mesa_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('PEDIDO', 'LLAMAR_MOZO', 'PEDIR_CUENTA')),
  estado text NOT NULL
    CHECK (estado IN ('PENDIENTE', 'ATENDIDO', 'PASADO_A_CUENTA', 'DESCARTADO', 'VENCIDO')),
  -- Las líneas preparadas tal como las vio el cliente (nombre, modificadores y precios). Vacía sin pedido.
  lineas jsonb NOT NULL DEFAULT '[]'::jsonb,
  nota text,
  total numeric(10, 2),
  -- HMAC-SHA256 de la IP del cliente; la IP nunca se guarda.
  huella_ip bytea,
  -- SHA-256 de la entrada normalizada y la respuesta 201 de la creación, para reconocer la réplica por id.
  huella_entrada bytea NOT NULL,
  respuesta_creacion jsonb NOT NULL,
  vence_en timestamptz NOT NULL,
  -- A quién se avisó: el mozo responsable de la orden abierta de la mesa al crear el llamado, o nadie (todos).
  destinatario_mozo_id uuid,
  -- La orden abierta de la mesa al crearlo o la que abrió o usó la atención.
  orden_id uuid,
  atendido_por_usuario_id uuid,
  atendido_por_equipo_id uuid,
  atendido_en timestamptz,
  cerrado_por_usuario_id uuid,
  cerrado_por_equipo_id uuid,
  cerrado_en timestamptz,
  motivo_descarte text,
  -- Posición y cantidad de lo que el mozo pasó a la cuenta, y la respuesta del paso para reconocer una réplica.
  lineas_pasadas jsonb,
  respuesta_paso jsonb,
  huella_paso bytea,
  vencido_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llamado_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT llamado_sucursal_fk FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  -- La mesa debe ser de la sucursal del llamado y de la empresa.
  CONSTRAINT llamado_mesa_fk
    FOREIGN KEY (mesa_id, sucursal_id, empresa_id) REFERENCES mesa (id, sucursal_id, empresa_id),
  CONSTRAINT llamado_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT llamado_destinatario_fk
    FOREIGN KEY (destinatario_mozo_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT llamado_atendido_por_fk
    FOREIGN KEY (atendido_por_usuario_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT llamado_cerrado_por_fk
    FOREIGN KEY (cerrado_por_usuario_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT llamado_atendido_equipo_fk
    FOREIGN KEY (atendido_por_equipo_id, empresa_id) REFERENCES equipo (id, empresa_id),
  CONSTRAINT llamado_cerrado_equipo_fk
    FOREIGN KEY (cerrado_por_equipo_id, empresa_id) REFERENCES equipo (id, empresa_id),
  CONSTRAINT llamado_texto_ck CHECK (
    (nota IS NULL OR char_length(nota) BETWEEN 1 AND 140)
    AND (motivo_descarte IS NULL OR char_length(motivo_descarte) BETWEEN 1 AND 140)
  ),
  -- Un pedido lleva de 1 a 30 líneas y su total; los otros dos tipos no llevan líneas, total ni nota.
  CONSTRAINT llamado_lineas_ck CHECK (
    jsonb_typeof(lineas) = 'array'
    AND CASE tipo
      WHEN 'PEDIDO' THEN jsonb_array_length(lineas) BETWEEN 1 AND 30
                         AND total IS NOT NULL AND total BETWEEN 0 AND 99999999.99
      ELSE jsonb_array_length(lineas) = 0 AND total IS NULL AND nota IS NULL
    END
  ),
  CONSTRAINT llamado_huellas_ck CHECK (
    octet_length(huella_entrada) = 32
    AND (huella_ip IS NULL OR octet_length(huella_ip) = 32)
    AND (huella_paso IS NULL OR octet_length(huella_paso) = 32)
    AND ((respuesta_paso IS NULL) = (huella_paso IS NULL))
  ),
  CONSTRAINT llamado_vencimiento_ck CHECK (vence_en > creado_en),
  -- Qué columnas lleva cada estado (el vencimiento y el paso solo existen en su estado).
  CONSTRAINT llamado_estado_ck CHECK (
    CASE estado
      WHEN 'PENDIENTE' THEN atendido_en IS NULL AND cerrado_en IS NULL AND vencido_en IS NULL
                            AND lineas_pasadas IS NULL AND respuesta_paso IS NULL
                            AND motivo_descarte IS NULL
      WHEN 'ATENDIDO' THEN atendido_en IS NOT NULL AND cerrado_en IS NULL AND vencido_en IS NULL
                           AND lineas_pasadas IS NULL AND respuesta_paso IS NULL
                           AND motivo_descarte IS NULL
      WHEN 'PASADO_A_CUENTA' THEN atendido_en IS NOT NULL AND cerrado_en IS NOT NULL
                                  AND vencido_en IS NULL AND orden_id IS NOT NULL
                                  AND lineas_pasadas IS NOT NULL AND respuesta_paso IS NOT NULL
                                  AND motivo_descarte IS NULL
      WHEN 'DESCARTADO' THEN cerrado_en IS NOT NULL AND vencido_en IS NULL
                             AND lineas_pasadas IS NULL AND respuesta_paso IS NULL
      WHEN 'VENCIDO' THEN vencido_en IS NOT NULL AND atendido_en IS NULL AND cerrado_en IS NULL
                          AND lineas_pasadas IS NULL AND respuesta_paso IS NULL
                          AND motivo_descarte IS NULL
    END
  )
);
CREATE INDEX llamado_empresa_id_idx ON llamado (empresa_id);
-- Un solo llamado pendiente por mesa (criterio 30): la red de seguridad de la regla que aplica la API.
CREATE UNIQUE INDEX llamado_pendiente_por_mesa ON llamado (empresa_id, mesa_id) WHERE estado = 'PENDIENTE';
-- Límite por mesa (criterio 32) y por conexión y sucursal (criterio 33).
CREATE INDEX llamado_mesa_creado_idx ON llamado (empresa_id, mesa_id, creado_en);
CREATE INDEX llamado_ip_creado_idx ON llamado (empresa_id, sucursal_id, huella_ip, creado_en)
  WHERE huella_ip IS NOT NULL;
-- La lista del mozo (criterio 39): pendientes, atendidos y recientes de la sucursal.
CREATE INDEX llamado_sucursal_estado_idx ON llamado (empresa_id, sucursal_id, estado, creado_en);
${sqlTablaDeEmpresaTrazable('llamado', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE llamado;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
