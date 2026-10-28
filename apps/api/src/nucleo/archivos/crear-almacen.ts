import type { Entorno } from '../../config/entorno';
import type { AlmacenArchivos } from './almacen-archivos';
import { AlmacenEnDisco } from './almacen-en-disco';
import { AlmacenEnMemoria } from './almacen-en-memoria';
import { AlmacenR2 } from './almacen-r2';

/**
 * Elige el almacén según `ARCHIVOS_DRIVER` (historia 003, tarea T10): `memoria` (pruebas), `disco`
 * (desarrollo) o `r2` (producción). `cargarEntorno` ya validó que `disco` solo vale en desarrollo y que `r2`
 * trae sus credenciales y su URL pública; sin driver (producción mal configurada, que
 * `exigirEntornoDeProduccion` rechaza antes) se usa `memoria` solo para no fallar al construir.
 */
export function crearAlmacenDeEntorno(entorno: Entorno): AlmacenArchivos {
  switch (entorno.ARCHIVOS_DRIVER) {
    case 'disco':
      return new AlmacenEnDisco(entorno.ARCHIVOS_DIRECTORIO, entorno.ARCHIVOS_URL_PUBLICA ?? '');
    case 'r2':
      return new AlmacenR2({
        cuentaId: entorno.R2_ACCOUNT_ID ?? '',
        accessKeyId: entorno.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: entorno.R2_SECRET_ACCESS_KEY ?? '',
        bucket: entorno.R2_BUCKET ?? '',
        urlBase: entorno.ARCHIVOS_URL_PUBLICA ?? '',
      });
    default:
      return new AlmacenEnMemoria();
  }
}
