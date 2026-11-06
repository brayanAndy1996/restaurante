// Historia 006 · caja, cobro y comprobantes, entrega 6b, ataque adversarial ronda 1 (criterios 130, 132 y 133). Dueño:
// facturación (`envio_pse`).
//
// - `reintento_manual_en` (F1): la marca de «intento manual pendiente». El reintento manual de un envío (criterio 132) la
//   fija con el instante de la petición; mientras la tenga, el barrido no detiene el envío por plazo (criterio 130) para que
//   el worker haga ese intento; el worker la limpia al tomar el envío. Si el intento falla pasado el plazo, el envío vuelve a
//   `DETENIDO` y no se reintenta solo.
// - `alertas_previas` (F5): los motivos que ya se publicaron para el comprobante antes del actual (`alerta`). Con `alerta`
//   forman el conjunto de motivos ya alertados: una alerta se publica una sola vez por comprobante y motivo distinto, aunque
//   el motivo alterne (criterio 133). Las filas existentes quedan con el arreglo vacío (su único motivo es `alerta`).
//
// Ninguna migración escribe datos de clientes. Las migraciones están exentas de la regla de ESLint de los nombres de
// funciones del contexto.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE envio_pse
  ADD COLUMN reintento_manual_en timestamptz,
  ADD COLUMN alertas_previas text[] NOT NULL DEFAULT '{}'
    CONSTRAINT envio_pse_alertas_previas_ck
    CHECK (alertas_previas <@ ARRAY['RECHAZADO', 'DEMORADO', 'DETENIDO', 'SIN_CONFIGURACION']::text[]);
`;

const SQL_DOWN = `
ALTER TABLE envio_pse
  DROP COLUMN alertas_previas,
  DROP COLUMN reintento_manual_en;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
