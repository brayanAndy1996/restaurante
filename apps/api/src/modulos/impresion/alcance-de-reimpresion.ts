import { Injectable } from '@nestjs/common';
import type { TipoTrabajo } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/** Los trabajos de caja y facturación (historia 006): su reimpresión sigue el permiso y el alcance de su módulo. */
export type TipoDeTrabajoDeCaja = Extract<TipoTrabajo, 'COMPROBANTE' | 'REPORTE_X' | 'REPORTE_Z'>;

/** Lo que el comprobador necesita saber del trabajo que se quiere reimprimir. */
export interface TrabajoPorReimprimir {
  tipo: TipoDeTrabajoDeCaja;
  comprobanteId: string | null;
  turnoId: string | null;
}

/** Lanza el 403 (o el 404) que daría la ruta propia del documento si la persona de la sesión no puede verlo. */
export type ComprobadorDeReimpresion = (trabajo: TrabajoPorReimprimir) => Promise<void>;

export function esTrabajoDeCaja(tipo: TipoTrabajo): tipo is TipoDeTrabajoDeCaja {
  return tipo === 'COMPROBANTE' || tipo === 'REPORTE_X' || tipo === 'REPORTE_Z';
}

/**
 * Punto de enganche entre la reimpresión de 004 (`POST /impresion/trabajos/:id/reimpresion`) y los módulos de caja y
 * facturación (historia 006, criterio 90): reimprimir un `COMPROBANTE`, un `REPORTE_X` o un `REPORTE_Z` exige el mismo
 * permiso y el mismo alcance que `POST /comprobantes/:id/impresiones` y `GET /turnos/:id/reporte` (un Mozo recibe
 * 403; un Cajero solo los de sus turnos). Impresión no lee las tablas de caja ni de facturación ni los importa (ellos
 * ya importan impresión): cada uno registra al arrancar su comprobador, como `OrdenesVigentes`. **Falla cerrado**: si
 * nadie registró el comprobador de un tipo, se responde 403 `PROHIBIDO` en lugar de copiar el documento.
 */
@Injectable()
export class AlcanceDeReimpresion {
  private readonly comprobadores = new Map<TipoDeTrabajoDeCaja, ComprobadorDeReimpresion>();

  /** Registra el comprobador de uno o más tipos de trabajo; el último registro de un tipo manda. */
  registrar(tipos: readonly TipoDeTrabajoDeCaja[], comprobador: ComprobadorDeReimpresion): void {
    for (const tipo of tipos) this.comprobadores.set(tipo, comprobador);
  }

  async exigir(trabajo: TrabajoPorReimprimir): Promise<void> {
    const comprobador = this.comprobadores.get(trabajo.tipo);
    if (comprobador === undefined) {
      throw new ErrorAplicacion(
        403,
        'PROHIBIDO',
        'No se puede comprobar si tienes acceso a este documento',
      );
    }
    await comprobador(trabajo);
  }
}
