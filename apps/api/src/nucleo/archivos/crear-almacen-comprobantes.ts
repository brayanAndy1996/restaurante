import type { Entorno } from '../../config/entorno';
import type { AlmacenComprobantes } from './almacen-comprobantes';
import { AlmacenComprobantesEnDisco } from './almacen-comprobantes-en-disco';
import { AlmacenComprobantesEnMemoria } from './almacen-comprobantes-en-memoria';
import { AlmacenComprobantesR2 } from './almacen-comprobantes-r2';

/**
 * Elige el almacén privado de comprobantes según `ARCHIVOS_DRIVER` (historia 006, criterio 131), igual que el de las
 * fotos: `memoria` (pruebas), `disco` (desarrollo, `ARCHIVOS_COMPROBANTES_DIRECTORIO`, que la API nunca sirve) o `r2`
 * (producción, el bucket privado `R2_BUCKET_COMPROBANTES`). `cargarEntorno` ya validó que `r2` trae sus credenciales y
 * que el bucket de comprobantes no es el de las fotos.
 */
export function crearAlmacenDeComprobantesDeEntorno(entorno: Entorno): AlmacenComprobantes {
  switch (entorno.ARCHIVOS_DRIVER) {
    case 'disco':
      return new AlmacenComprobantesEnDisco(entorno.ARCHIVOS_COMPROBANTES_DIRECTORIO);
    case 'r2':
      return new AlmacenComprobantesR2({
        cuentaId: entorno.R2_ACCOUNT_ID ?? '',
        accessKeyId: entorno.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: entorno.R2_SECRET_ACCESS_KEY ?? '',
        bucket: entorno.R2_BUCKET_COMPROBANTES ?? '',
      });
    default:
      return new AlmacenComprobantesEnMemoria();
  }
}
