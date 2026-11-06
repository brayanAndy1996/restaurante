import { Injectable } from '@nestjs/common';

/** Cuántos comprobantes de una empresa tienen cada motivo de alerta (criterio 133); cada uno cuenta una sola vez. */
export interface ConteoDeAlertas {
  rechazados: number;
  demorados: number;
  detenidos: number;
  sinConfiguracion: number;
}

/**
 * Cuenta las alertas de **toda** la empresa del contexto activo. Corre dentro de `ContextoEmpresa.ejecutar` de la empresa
 * que se está contando.
 */
export type ContarAlertasDeEmpresa = () => Promise<ConteoDeAlertas>;

/**
 * Punto de enganche entre `GET /plataforma/facturacion/alertas` y los comprobantes (historia 006, criterio 133): plataforma
 * es dueña de `empresa` pero no lee `comprobante`. La facturación registra al arrancar cómo contar las alertas de una
 * empresa (como `UltimaEmisionDeEmisor` para las tasas de IGV). **Falla cerrado**: sin registro, la ruta responde un error
 * en vez de un tablero vacío que parezca «sin alertas».
 */
@Injectable()
export class AlertasDeFacturacion {
  private contador: ContarAlertasDeEmpresa | null = null;

  registrar(contador: ContarAlertasDeEmpresa): void {
    this.contador = contador;
  }

  contar(): Promise<ConteoDeAlertas> {
    if (this.contador === null) {
      return Promise.reject(
        new Error('Nadie registró cómo contar las alertas de facturación (módulo de facturación)'),
      );
    }
    return this.contador();
  }
}
