import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../../nucleo/errores/no-implementado';

/** Lo que hizo una vuelta del barrido (criterios 126, 130 y 133). */
export interface ResultadoDelBarrido {
  /** Envíos vencidos que se volvieron a encolar. */
  reencolados: number;
  /** Envíos que llegaron a su plazo y quedaron `DETENIDO`. */
  detenidos: number;
  /** Alertas nuevas publicadas. */
  alertas: number;
  /** PDF de comprobantes `ACEPTADO` que se volvieron a encolar. */
  pdfPendientes: number;
}

/**
 * El barrido de envíos (historia 006, entrega 6b, criterio 126): cada minuto el worker recorre las empresas (la lista
 * de ids la da `EmpresasConsulta.ids()`) y, con el contexto de cada una, vuelve a encolar los envíos vencidos, detiene los
 * que pasaron su plazo y levanta las alertas por tiempo. Las pruebas lo llaman a mano con `barrerAhora()`.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T31.
 */
@Injectable()
export class BarridoEnviosPse {
  /** Una vuelta completa sobre todas las empresas. */
  barrerAhora(): Promise<ResultadoDelBarrido> {
    return Promise.reject(noImplementado());
  }

  /** Arranca el temporizador de 60 segundos del worker (`unref`). */
  iniciar(): void {
    throw noImplementado();
  }

  /** Detiene el temporizador. */
  detener(): void {
    throw noImplementado();
  }
}
