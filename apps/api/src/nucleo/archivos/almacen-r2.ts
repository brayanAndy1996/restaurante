import { AwsClient } from 'aws4fetch';
import type { AlmacenArchivos } from './almacen-archivos';

export interface OpcionesAlmacenR2 {
  cuentaId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** URL pública del bucket (un dominio propio detrás de Cloudflare), sin barra final. */
  urlBase: string;
  /** `fetch` para las pruebas; por defecto el global. */
  fetch?: typeof fetch;
}

/**
 * Tiempo máximo de cada llamada a R2. La subida ocurre dentro de la transacción de la petición y la conexión
 * de la API se cierra tras 30 s inactiva dentro de una transacción: es mejor fallar antes que perderla.
 */
export const TIEMPO_LIMITE_R2_MS = 20_000;

/** Cada foto tiene una clave nueva, así que la copia en caché nunca queda vieja (plan, "Fotos"). */
export const CACHE_CONTROL_FOTOS = 'public, max-age=31536000, immutable';

/**
 * Almacén de producción: Cloudflare R2 por su API compatible con S3, con firmas SigV4 (`aws4fetch`, JavaScript
 * puro). Solo hacen falta `PUT` y `DELETE`. El token de R2 debe tener permiso solo sobre este bucket.
 */
export class AlmacenR2 implements AlmacenArchivos {
  private readonly cliente: AwsClient;
  private readonly punto: string;
  private readonly urlBase: string;
  private readonly llamar: typeof fetch;

  constructor(opciones: OpcionesAlmacenR2) {
    this.llamar = opciones.fetch ?? fetch;
    this.cliente = new AwsClient({
      accessKeyId: opciones.accessKeyId,
      secretAccessKey: opciones.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    this.punto = `https://${opciones.cuentaId}.r2.cloudflarestorage.com/${opciones.bucket}`;
    this.urlBase = opciones.urlBase.replace(/\/+$/, '');
  }

  private urlDe(clave: string): string {
    return `${this.punto}/${clave.split('/').map(encodeURIComponent).join('/')}`;
  }

  async guardar(clave: string, contenido: Buffer, tipo: string): Promise<void> {
    const peticion = await this.cliente.sign(this.urlDe(clave), {
      method: 'PUT',
      body: new Uint8Array(contenido),
      headers: { 'Content-Type': tipo, 'Cache-Control': CACHE_CONTROL_FOTOS },
    });
    const respuesta = await this.llamar(peticion, {
      signal: AbortSignal.timeout(TIEMPO_LIMITE_R2_MS),
    });
    if (!respuesta.ok) {
      throw new Error(`R2 rechazó guardar el archivo (HTTP ${respuesta.status})`);
    }
  }

  async borrar(clave: string): Promise<void> {
    const peticion = await this.cliente.sign(this.urlDe(clave), { method: 'DELETE' });
    const respuesta = await this.llamar(peticion, {
      signal: AbortSignal.timeout(TIEMPO_LIMITE_R2_MS),
    });
    // R2 responde 204 aunque el archivo no exista; un 404 tampoco es un problema.
    if (!respuesta.ok && respuesta.status !== 404) {
      throw new Error(`R2 rechazó borrar el archivo (HTTP ${respuesta.status})`);
    }
  }

  urlPublica(clave: string): string {
    return `${this.urlBase}/${clave}`;
  }
}
