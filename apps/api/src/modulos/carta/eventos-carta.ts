import { Inject, Injectable } from '@nestjs/common';
import type { HastaAgotado, OrigenAgotado } from '@restaurante/dominio';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { estadoActual, type EstadoOperacion } from '../../nucleo/base-de-datos';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../nucleo/eventos';

/**
 * Arma y registra los eventos de la carta con `ContextoEmpresa.alConfirmar`: se publican solo después de
 * confirmar la transacción, nunca en una reversión ni en una escritura que no cambió nada (criterios 46 y
 * 54). El evento lleva la empresa del contexto: el publicador corre sin contexto.
 *
 * Una petición publica un solo `carta.actualizada` por sala aunque varias partes del servicio lo pidan (por
 * ejemplo, un `PATCH` de producto que cambia datos y grupos).
 */
@Injectable()
export class EventosCarta {
  /** Salas ya registradas por operación en curso (se descarta sola cuando termina la operación). */
  private readonly registrados = new WeakMap<EstadoOperacion, Set<string>>();

  constructor(
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
  ) {}

  /**
   * `carta.actualizada` (criterio 54): con `sucursalId` `null`, en la sala de la empresa (el cambio afecta a
   * todas las sucursales: productos, familias, estaciones, grupos); con una sucursal, en la sala de esa
   * sucursal (ajuste por sucursal, menú del día).
   */
  cartaActualizada(sucursalId: string | null): void {
    const empresaId = this.contexto.empresaActual();
    const estado = estadoActual();
    const clave = sucursalId ?? '*';
    if (estado !== undefined) {
      const vistos = this.registrados.get(estado) ?? new Set<string>();
      if (vistos.has(clave)) return;
      vistos.add(clave);
      this.registrados.set(estado, vistos);
    }
    this.contexto.alConfirmar(() =>
      this.publicador.publicar({
        empresaId,
        sala: sucursalId === null ? { tipo: 'empresa' } : { tipo: 'sucursal', sucursalId },
        nombre: 'carta.actualizada',
        datos: { sucursalId },
      }),
    );
  }

  /**
   * `carta.disponibilidad` (criterios 46 y 53): un producto se agotó, cambió su agotado o se reactivó. Va en la
   * sala de la sucursal. `hasta` y `origen` son `null` al reactivar. Un evento por cambio real: quien llama
   * no lo registra en un no-op.
   */
  disponibilidad(datos: {
    sucursalId: string;
    productoId: string;
    agotado: boolean;
    hasta: HastaAgotado | null;
    origen: OrigenAgotado | null;
  }): void {
    const empresaId = this.contexto.empresaActual();
    this.contexto.alConfirmar(() =>
      this.publicador.publicar({
        empresaId,
        sala: { tipo: 'sucursal', sucursalId: datos.sucursalId },
        nombre: 'carta.disponibilidad',
        datos,
      }),
    );
  }
}
