// El puerto del almacén privado de comprobantes vive en el núcleo (`nucleo/archivos`), junto a sus implementaciones; se
// reexporta aquí porque facturación es su dueño y la única que guarda y lee XML, CDR y PDF (criterios 131 y 165).
export {
  ALMACEN_COMPROBANTES,
  AlmacenComprobantesEnMemoria,
  claveDeArchivoDeComprobante,
  type AlmacenComprobantes,
} from '../../nucleo/archivos';
