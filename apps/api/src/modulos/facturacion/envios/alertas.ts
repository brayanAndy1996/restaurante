import { Logger } from '@nestjs/common';
import type { AlertaComprobante } from '@restaurante/dominio';
import type { PublicadorEventos } from '../../../nucleo/eventos';

const registro = new Logger('AlertasDeEnvios');

/** Una alerta nueva de un comprobante (criterio 133): ya marcada en `envio_pse` (`alertado_en` y `alerta`). */
export interface AlertaPublicable {
  empresaId: string;
  comprobanteId: string;
  sucursalId: string;
  motivo: AlertaComprobante;
}

/**
 * Publica una alerta después de confirmar la transacción que la marcó (historia 006, criterio 133): el registro `warn`
 * `pse.alerta` para el monitoreo del equipo (solo ids y el motivo, nunca datos de clientes) y el evento
 * `facturacion.alerta` `{ sucursalId }` en la sala de la sucursal. `envio_pse.alertado_en` evita repetirla; el procesador
 * (rechazos y errores de configuración) y el barrido (demora y plazo) la usan igual.
 */
export async function publicarAlerta(
  publicador: PublicadorEventos,
  alerta: AlertaPublicable,
): Promise<void> {
  registro.warn(
    JSON.stringify({
      evento: 'pse.alerta',
      motivo: alerta.motivo,
      empresaId: alerta.empresaId,
      comprobanteId: alerta.comprobanteId,
    }),
  );
  await publicador.publicar({
    empresaId: alerta.empresaId,
    sala: { tipo: 'sucursal', sucursalId: alerta.sucursalId },
    nombre: 'facturacion.alerta',
    datos: { sucursalId: alerta.sucursalId },
  });
}
