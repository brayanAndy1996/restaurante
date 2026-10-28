import { Aviso, Boton } from '@restaurante/ui';
import {
  avisosDeEnvio,
  textoDeEnvioCancelado,
  useAvisoDeEnvioCancelado,
} from '../lib/envios-cancelados';

/**
 * Aviso global de un cambio que esperaba la red y no se mandó porque la sesión cambió (se cerró, entró
 * otra persona, o cambió la sucursal). Está en la raíz de la app, así que se ve también en la pantalla de
 * PIN o de ingreso, donde la persona cae al cerrar la sesión. No se va solo: avisa de algo que se perdió.
 */
export function AvisoDeEnvioCancelado() {
  const aviso = useAvisoDeEnvioCancelado();
  if (!aviso) return null;
  return (
    <div className="aviso-global">
      <Aviso tipo="error" titulo={textoDeEnvioCancelado(aviso.motivo, aviso.cantidad)}>
        <span className="aviso-global__texto">
          Estaba esperando la conexión y no se mandó con otra sesión.{' '}
          {aviso.cantidad === 1
            ? 'Hay que volver a hacer ese cambio.'
            : 'Hay que volver a hacer esos cambios.'}
        </span>
        <Boton variante="texto" onClick={avisosDeEnvio.descartar}>
          Entendido
        </Boton>
      </Aviso>
    </div>
  );
}
