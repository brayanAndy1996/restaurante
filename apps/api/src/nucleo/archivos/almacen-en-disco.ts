import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { AlmacenArchivos } from './almacen-archivos';

/**
 * Almacén de desarrollo: guarda los archivos en una carpeta (`ARCHIVOS_DIRECTORIO`), que la API sirve en
 * `/archivos/*` solo con `NODE_ENV=development` (`aplicacion.ts`). La clave la arma la API (nunca el cliente),
 * pero se comprueba igual que no salga de la carpeta.
 */
export class AlmacenEnDisco implements AlmacenArchivos {
  private readonly raiz: string;

  constructor(
    directorio: string,
    private readonly urlBase: string,
  ) {
    this.raiz = resolve(directorio);
  }

  /** Carpeta absoluta del almacén (la que sirve el servidor estático de desarrollo). */
  directorio(): string {
    return this.raiz;
  }

  private rutaDe(clave: string): string {
    const ruta = resolve(this.raiz, clave);
    const relativa = relative(this.raiz, ruta);
    if (clave === '' || relativa === '' || relativa.startsWith('..') || isAbsolute(relativa)) {
      throw new RangeError('La clave del archivo sale de la carpeta del almacén');
    }
    return ruta;
  }

  async guardar(clave: string, contenido: Buffer, tipo: string): Promise<void> {
    void tipo; // el servidor estático deduce el tipo por la extensión de la clave
    const ruta = this.rutaDe(clave);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, contenido);
  }

  async borrar(clave: string): Promise<void> {
    await rm(this.rutaDe(clave), { force: true });
  }

  urlPublica(clave: string): string {
    return `${this.urlBase}/${clave}`;
  }
}
