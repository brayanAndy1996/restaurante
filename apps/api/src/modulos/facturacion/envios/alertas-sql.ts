import { MINUTOS_ALERTA_PENDIENTE, type AlertaComprobante } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import type { ConteoDeAlertas } from '../../plataforma';

/**
 * El mismo cálculo de `alertaDe` (`packages/dominio`, criterio 133) escrito en SQL para contar y filtrar sin traer las filas:
 * el primero de estos motivos que le aplique a cada comprobante, en este orden, `RECHAZADO` (rechazado y sin reemisión),
 * `DETENIDO` (envío detenido), `SIN_CONFIGURACION` (último resultado `ERROR_CONFIGURACION`) y `DEMORADO` (más de 30 minutos
 * desde la emisión), los tres últimos solo mientras el comprobante sigue `POR_ENVIAR` o `ENVIADO`. Un aceptado, un anulado
 * y un rechazado con reemisión no tienen alerta. Quien lo usa une `comprobante c` con `envio_pse e` (`LEFT JOIN`) y pasa el
 * instante actual en el parámetro `ahora` (el reloj de la API, no el de la base).
 */
export const sqlAlerta = (ahora: string): string => `(CASE
    WHEN c.estado = 'RECHAZADO' THEN
      CASE WHEN EXISTS (SELECT 1 FROM comprobante x WHERE x.reemplaza_a_id = c.id) THEN NULL ELSE 'RECHAZADO' END
    WHEN c.estado IN ('POR_ENVIAR', 'ENVIADO') AND e.estado = 'DETENIDO' THEN 'DETENIDO'
    WHEN c.estado IN ('POR_ENVIAR', 'ENVIADO') AND e.ultimo_resultado = 'ERROR_CONFIGURACION' THEN 'SIN_CONFIGURACION'
    WHEN c.estado IN ('POR_ENVIAR', 'ENVIADO')
         AND c.emitido_en < ${ahora}::timestamptz - interval '${MINUTOS_ALERTA_PENDIENTE} minutes' THEN 'DEMORADO'
  END)`;

/** Qué comprobantes cuentan: los de estas sucursales (`null` = todas las de la empresa) y, si se da, de este responsable. */
export interface AmbitoDeAlertas {
  sucursales: readonly string[] | null;
  /** El Cajero solo cuenta los comprobantes de sus propios turnos (criterio 169). */
  responsableId: string | null;
}

/** Cuenta las alertas del ámbito, cada comprobante una sola vez en su primer motivo (criterio 133). Una consulta. */
export async function contarAlertas(
  conexion: Sequelize,
  ahora: Date,
  ambito: AmbitoDeAlertas,
): Promise<ConteoDeAlertas> {
  const filas = await conexion.query<{ alerta: AlertaComprobante; n: number }>(
    `SELECT alerta, count(*)::int AS n
       FROM (SELECT ${sqlAlerta('$1')} AS alerta
               FROM comprobante c
               LEFT JOIN envio_pse e ON e.comprobante_id = c.id
              WHERE c.estado IN ('RECHAZADO', 'POR_ENVIAR', 'ENVIADO')
                AND ($2::uuid[] IS NULL OR c.sucursal_id = ANY($2::uuid[]))
                AND ($3::uuid IS NULL OR c.turno_responsable_id = $3::uuid)) t
      WHERE alerta IS NOT NULL
      GROUP BY alerta`,
    {
      bind: [
        ahora,
        ambito.sucursales === null ? null : [...ambito.sucursales],
        ambito.responsableId,
      ],
      type: QueryTypes.SELECT,
    },
  );
  const de = (motivo: AlertaComprobante): number => filas.find((f) => f.alerta === motivo)?.n ?? 0;
  return {
    rechazados: de('RECHAZADO'),
    demorados: de('DEMORADO'),
    detenidos: de('DETENIDO'),
    sinConfiguracion: de('SIN_CONFIGURACION'),
  };
}
