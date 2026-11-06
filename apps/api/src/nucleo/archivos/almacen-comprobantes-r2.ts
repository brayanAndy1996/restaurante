import { AwsClient } from 'aws4fetch';
import { exigirClaveValidaDeComprobante, type AlmacenComprobantes } from './almacen-comprobantes';
import { TIEMPO_LIMITE_R2_MS } from './almacen-r2';

export interface OpcionesAlmacenComprobantesR2 {
  cuentaId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** El bucket **privado** de los comprobantes (`R2_BUCKET_COMPROBANTES`), distinto del de las fotos. */
  bucket: string;
  /** `fetch` para las pruebas; por defecto el global. */
  fetch?: typeof fetch;
}

/**
 * Almacén privado de comprobantes en Cloudflare R2 (historia 006, criterio 131): el XML, el CDR y el PDF viven en un
 * bucket sin dominio público ni acceso anónimo; la API es la única que los lee, por su ruta autenticada o por un enlace
 * sellado (criterio 160). Valida las claves con el mismo patrón estricto que el almacén en disco antes de tocar el bucket:
 * un `..` se resolvería en R2 a la carpeta de otra empresa. `PUT` y `GET` firmados con SigV4 (`aws4fetch`), con el mismo tiempo máximo que el de las fotos.
 */
export class AlmacenComprobantesR2 implements AlmacenComprobantes {
  private readonly cliente: AwsClient;
  private readonly punto: string;
  private readonly llamar: typeof fetch;

  constructor(opciones: OpcionesAlmacenComprobantesR2) {
    this.llamar = opciones.fetch ?? fetch;
    this.cliente = new AwsClient({
      accessKeyId: opciones.accessKeyId,
      secretAccessKey: opciones.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    this.punto = `https://${opciones.cuentaId}.r2.cloudflarestorage.com/${opciones.bucket}`;
  }

  private urlDe(clave: string): string {
    return `${this.punto}/${clave.split('/').map(encodeURIComponent).join('/')}`;
  }

  async guardar(clave: string, contenido: Buffer, tipo: string): Promise<void> {
    exigirClaveValidaDeComprobante(clave);
    const peticion = await this.cliente.sign(this.urlDe(clave), {
      method: 'PUT',
      body: new Uint8Array(contenido),
      headers: { 'Content-Type': tipo, 'Cache-Control': 'private, no-store' },
    });
    const respuesta = await this.llamar(peticion, {
      signal: AbortSignal.timeout(TIEMPO_LIMITE_R2_MS),
    });
    if (!respuesta.ok) {
      throw new Error(`R2 rechazó guardar el archivo del comprobante (HTTP ${respuesta.status})`);
    }
  }

  async leer(clave: string): Promise<Buffer | null> {
    exigirClaveValidaDeComprobante(clave);
    const peticion = await this.cliente.sign(this.urlDe(clave), { method: 'GET' });
    const respuesta = await this.llamar(peticion, {
      signal: AbortSignal.timeout(TIEMPO_LIMITE_R2_MS),
    });
    if (respuesta.status === 404) return null;
    if (!respuesta.ok) {
      throw new Error(`R2 rechazó leer el archivo del comprobante (HTTP ${respuesta.status})`);
    }
    return Buffer.from(await respuesta.arrayBuffer());
  }
}
