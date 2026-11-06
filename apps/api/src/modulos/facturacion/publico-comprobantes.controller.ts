import { Controller, Get, Inject, Param, StreamableFile } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { Publica } from '../seguridad';
import { EnlacesComprobante } from './enlaces';

/**
 * El PDF de un comprobante por su enlace público (historia 006, entrega 6b, criterio 160): sin sesión, la empresa sale del
 * sello cifrado. Un sello alterado, vencido, de un comprobante inexistente o sin PDF responde 404 con el mismo cuerpo. No
 * hay forma de listar: `GET /publico/comprobantes/` es 404.
 *
 * Fase A (T29): solo la ruta; lanza `Error('No implementado')` hasta T43. **Todavía no está registrado en
 * `FacturacionModule`**: agregar una ruta `@Publica()` (o cualquiera bajo `/publico/`) rompe pruebas protegidas de 3b y de 005
 * que fijan la lista cerrada de rutas públicas; hay que decidir con el orquestador cómo se ajustan antes de registrarlo.
 */
@Controller('publico/comprobantes')
export class PublicoComprobantesController {
  constructor(@Inject(EnlacesComprobante) private readonly enlaces: EnlacesComprobante) {}

  /** 200 `application/pdf` con `Cache-Control: private, max-age=300`; 404. */
  @Get(':sello')
  @Publica()
  pdf(@Param('sello') sello: string): Promise<StreamableFile> {
    void this.enlaces;
    void sello;
    return Promise.reject(noImplementado());
  }
}
