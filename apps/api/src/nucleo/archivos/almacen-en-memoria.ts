import type { AlmacenArchivos } from './almacen-archivos';

/** URL base de `AlmacenEnMemoria.urlPublica` (el dominio `.invalid` nunca resuelve). */
export const URL_BASE_ALMACEN_EN_MEMORIA = 'https://archivos.memoria.invalid/';

/**
 * Almacén de las pruebas: guarda en un `Map`. `claves()` permite comprobar lo guardado y lo borrado (por
 * ejemplo, que un rechazo no guarde nada y que nunca se borre un archivo de otra empresa).
 */
export class AlmacenEnMemoria implements AlmacenArchivos {
  private readonly archivos = new Map<string, { contenido: Buffer; tipo: string }>();

  guardar(clave: string, contenido: Buffer, tipo: string): Promise<void> {
    this.archivos.set(clave, { contenido: Buffer.from(contenido), tipo });
    return Promise.resolve();
  }

  borrar(clave: string): Promise<void> {
    this.archivos.delete(clave);
    return Promise.resolve();
  }

  urlPublica(clave: string): string {
    return `${URL_BASE_ALMACEN_EN_MEMORIA}${clave}`;
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
}
