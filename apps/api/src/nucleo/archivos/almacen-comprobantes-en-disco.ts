import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { esClaveValidaDeComprobante, type AlmacenComprobantes } from './almacen-comprobantes';

/**
 * Almacén privado de comprobantes en disco (historia 006, criterio 131; solo desarrollo): guarda el XML, el CDR y el PDF
 * bajo una carpeta (`ARCHIVOS_COMPROBANTES_DIRECTORIO`, por defecto `./archivos-privados`) que **la API nunca sirve** por
 * una URL (a diferencia de las fotos, criterio 165). Las claves las arma la API (`comprobantes/<empresaId>/<comprobanteId>/…`),
 * nunca el cliente, pero se comprueba igual que no salgan de la carpeta.
 */
export class AlmacenComprobantesEnDisco implements AlmacenComprobantes {
  private readonly raiz: string;

  constructor(directorio: string) {
    this.raiz = resolve(directorio);
  }

  private rutaDe(clave: string): string {
    const ruta = resolve(this.raiz, clave);
    const relativa = relative(this.raiz, ruta);
    if (
      !esClaveValidaDeComprobante(clave) ||
      relativa === '' ||
      relativa.startsWith('..') ||
      isAbsolute(relativa)
    ) {
      throw new RangeError('La clave del archivo no es válida para el almacén de comprobantes');
    }
    return ruta;
  }

  async guardar(clave: string, contenido: Buffer, tipo: string): Promise<void> {
    void tipo; // nadie lo sirve por HTTP desde el disco: el tipo lo decide quien lo entrega
    const ruta = this.rutaDe(clave);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, contenido);
  }

  async leer(clave: string): Promise<Buffer | null> {
    try {
      return await readFile(this.rutaDe(clave));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
