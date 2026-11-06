import type { AlmacenComprobantes } from './almacen-comprobantes';

/**
 * El almacén de comprobantes de las pruebas: guarda en un `Map`. `claves()` y `obtener()` permiten comprobar lo
 * guardado (por ejemplo, que un segundo resultado no escribe nada y que las claves llevan la empresa).
 */
export class AlmacenComprobantesEnMemoria implements AlmacenComprobantes {
  private readonly archivos = new Map<string, { contenido: Buffer; tipo: string }>();
  private escrituras = 0;

  guardar(clave: string, contenido: Buffer, tipo: string): Promise<void> {
    this.archivos.set(clave, { contenido: Buffer.from(contenido), tipo });
    this.escrituras += 1;
    return Promise.resolve();
  }

  leer(clave: string): Promise<Buffer | null> {
    const archivo = this.archivos.get(clave);
    return Promise.resolve(archivo ? Buffer.from(archivo.contenido) : null);
  }

  /** Las claves guardadas, en el orden en que se guardaron por primera vez. */
  claves(): string[] {
    return [...this.archivos.keys()];
  }

  /** El archivo guardado bajo `clave` (una copia) o `undefined`. */
  obtener(clave: string): { contenido: Buffer; tipo: string } | undefined {
    const archivo = this.archivos.get(clave);
    return archivo ? { contenido: Buffer.from(archivo.contenido), tipo: archivo.tipo } : undefined;
  }

  /** Cuántas veces se llamó a `guardar` (aunque fuera sobre la misma clave): un segundo resultado no debe sumar. */
  totalDeEscrituras(): number {
    return this.escrituras;
  }
}
