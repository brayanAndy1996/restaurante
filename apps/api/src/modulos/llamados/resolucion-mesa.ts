import { Inject, Injectable } from '@nestjs/common';
import { CartaWebConsultaService, MODULO_DE_PEDIDOS_WEB, cartaNoDisponible } from '../carta-web';
import { SuscripcionService } from '../plataforma';
import { CodigosMesaService } from '../salon';

/** La mesa de un código ya verificada: activa, de una sucursal con la carta publicada y con `PEDIDOS_WEB`. */
export interface MesaResuelta {
  mesaId: string;
  mesaNombre: string;
  sucursalId: string;
  empresaSlug: string;
  sucursalSlug: string;
}

/**
 * Lo que toda ruta pública de la mesa comprueba dentro del contexto de la empresa (historia 005, criterios 10, 14 y
 * 15), siempre con el mismo 404 (`cartaNoDisponible`): el código existe en esta empresa (si la función de búsqueda
 * devolvió la empresa pero la fila ya no aparece, el código se reemplazó entre los dos pasos), la mesa está activa, la
 * carta de su sucursal está publicada y el plan de la sucursal incluye `PEDIDOS_WEB`. Una suscripción suspendida no
 * cambia nada. Todo bajo la RLS de la empresa del código.
 */
@Injectable()
export class ResolucionMesa {
  constructor(
    @Inject(CodigosMesaService) private readonly codigos: CodigosMesaService,
    @Inject(CartaWebConsultaService) private readonly cartaWeb: CartaWebConsultaService,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
  ) {}

  /** Resuelve el código sin bloquear nada. */
  async resolver(codigo: string): Promise<MesaResuelta> {
    return this.verificar(await this.codigos.resolver(codigo));
  }

  private async verificar(
    mesa: Awaited<ReturnType<CodigosMesaService['resolver']>>,
  ): Promise<MesaResuelta> {
    if (mesa === null || !mesa.activa) throw cartaNoDisponible();
    const publicada = await this.cartaWeb.sucursalPublicada(mesa.sucursalId);
    if (publicada === null) throw cartaNoDisponible();
    const empresa = await this.cartaWeb.deLaEmpresa();
    if (empresa === null) throw cartaNoDisponible();
    const modulos = await this.suscripciones.modulosDeSucursal(mesa.sucursalId);
    if (!modulos.includes(MODULO_DE_PEDIDOS_WEB)) throw cartaNoDisponible();
    return {
      mesaId: mesa.mesaId,
      mesaNombre: mesa.nombre,
      sucursalId: mesa.sucursalId,
      empresaSlug: empresa.slug,
      sucursalSlug: publicada.slug,
    };
  }
}
