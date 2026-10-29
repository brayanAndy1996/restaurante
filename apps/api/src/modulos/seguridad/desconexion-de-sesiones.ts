import { Inject, Injectable } from '@nestjs/common';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ServidorTiempoReal } from '../../nucleo/tiempo-real';

/**
 * Cierra las conexiones de Socket.IO de las sesiones que se cierran o cambian de sucursal (historia 004,
 * criterio 66). Se llama dentro de la transacción que cierra la sesión: la desconexión se registra con
 * `ContextoEmpresa.alConfirmar` y corre solo después de confirmar (una reversión no desconecta a nadie). El
 * servidor la reparte por el adaptador a todas las instancias de la API.
 *
 * Lo que no pase por aquí (una sesión que vence por inactividad o duración, o que cierra el guard al detectarla)
 * lo atrapa la revisión periódica de cada instancia, a más tardar en 60 segundos.
 */
@Injectable()
export class DesconexionDeSesiones {
  constructor(
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(ServidorTiempoReal) private readonly servidor: ServidorTiempoReal,
  ) {}

  /** Desconecta las conexiones de esas sesiones después de confirmar la transacción actual. */
  alConfirmar(sesionIds: readonly string[]): void {
    if (sesionIds.length === 0 || !this.servidor.habilitado) return;
    const ids = [...sesionIds];
    this.contexto.alConfirmar(() => this.servidor.desconectarSesiones(ids));
  }
}
