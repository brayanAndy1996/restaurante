import { Boton, Hoja } from '@restaurante/ui';
import {
  avisosDeEnvio,
  textoDeEnvioCancelado,
  useAvisoDeEnvioCancelado,
} from '../lib/envios-cancelados';

/**
 * Aviso de un cambio que esperaba la red y no se mandó porque la sesión cambió (se cerró, entró otra persona,
 * o cambió la sucursal). Está en la raíz de la app, así que se ve también en la pantalla de PIN o de ingreso,
 * donde la persona cae al cerrar la sesión. Es una hoja que pide un toque en "Entendido" en vez de un banner
 * que tape el formulario de ingreso: avisa de algo que se perdió y no debe pasar desapercibido.
 */
export function AvisoDeEnvioCancelado() {
  const aviso = useAvisoDeEnvioCancelado();
  return (
    <Hoja
      abierta={aviso !== null}
      onCerrar={avisosDeEnvio.descartar}
      titulo={aviso ? textoDeEnvioCancelado(aviso.motivo, aviso.cantidad) : ''}
    >
      <p className="aviso-global__texto">
        Estaba esperando la conexión y no se mandó con otra sesión.{' '}
        {aviso && aviso.cantidad > 1
          ? 'Hay que volver a hacer esos cambios.'
          : 'Hay que volver a hacer ese cambio.'}
      </p>
      <Boton variante="principal" bloque data-foco-inicial onClick={avisosDeEnvio.descartar}>
        Entendido
      </Boton>
    </Hoja>
  );
}
