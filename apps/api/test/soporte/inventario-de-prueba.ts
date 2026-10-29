import type {
  AlAnularEntrada,
  AlEnviarEntrada,
  DisponiblesEntrada,
  InventarioPuerto,
} from '../../src/modulos/pedidos/inventario';

/** Una llamada al puerto, en el orden en que ocurrió. */
export type LlamadaDeInventario =
  | { metodo: 'alEnviar'; entrada: AlEnviarEntrada }
  | { metodo: 'alAnular'; entrada: AlAnularEntrada }
  | { metodo: 'disponibles'; entrada: DisponiblesEntrada };

/**
 * Puerto de inventario de las pruebas (historia 004, criterios 72 y 73): registra cada llamada, también las
 * que lanzan, y puede lanzar un error en `alEnviar` o en `alAnular` para comprobar que la transacción se
 * revierte. Se instala con `crearAplicacion({ inventario })`.
 *
 * Las entradas se guardan como copias profundas: lo registrado no cambia aunque quien llamó modifique el objeto.
 */
export class InventarioDePrueba implements InventarioPuerto {
  private registro: LlamadaDeInventario[] = [];
  private errorAlEnviar: Error | null = null;
  private errorAlAnular: Error | null = null;
  private stock = new Map<string, number>();

  /** Todas las llamadas hasta ahora, en orden. */
  llamadas(): LlamadaDeInventario[] {
    return structuredClone(this.registro);
  }

  /** Las entradas de las llamadas a `alEnviar`, en orden. */
  alEnviarLlamadas(): AlEnviarEntrada[] {
    return this.registro.flatMap((l) =>
      l.metodo === 'alEnviar' ? [structuredClone(l.entrada)] : [],
    );
  }

  /** Las entradas de las llamadas a `alAnular`, en orden. */
  alAnularLlamadas(): AlAnularEntrada[] {
    return this.registro.flatMap((l) =>
      l.metodo === 'alAnular' ? [structuredClone(l.entrada)] : [],
    );
  }

  /** Olvida las llamadas registradas (no cambia los errores ni el stock configurados). */
  limpiar(): void {
    this.registro = [];
  }

  /** Hace que `alEnviar` lance `error` (o deja de hacerlo con `null`). */
  lanzarAlEnviar(error: Error | null): void {
    this.errorAlEnviar = error;
  }

  /** Hace que `alAnular` lance `error` (o deja de hacerlo con `null`). */
  lanzarAlAnular(error: Error | null): void {
    this.errorAlAnular = error;
  }

  /** Fija lo que devuelve `disponibles` (producto a cantidad). */
  fijarDisponibles(disponibles: ReadonlyMap<string, number>): void {
    this.stock = new Map(disponibles);
  }

  async alEnviar(entrada: AlEnviarEntrada): Promise<void> {
    this.registro.push({ metodo: 'alEnviar', entrada: structuredClone(entrada) });
    if (this.errorAlEnviar !== null) throw this.errorAlEnviar;
  }

  async alAnular(entrada: AlAnularEntrada): Promise<void> {
    this.registro.push({ metodo: 'alAnular', entrada: structuredClone(entrada) });
    if (this.errorAlAnular !== null) throw this.errorAlAnular;
  }

  async disponibles(entrada: DisponiblesEntrada): Promise<ReadonlyMap<string, number>> {
    this.registro.push({ metodo: 'disponibles', entrada: structuredClone(entrada) });
    return new Map(
      entrada.productoIds.flatMap((id) => {
        const cantidad = this.stock.get(id);
        return cantidad === undefined ? [] : [[id, cantidad] as const];
      }),
    );
  }
}
