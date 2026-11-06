import { Controller, Get, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PublicoComprobantesService } from './publico-comprobantes.service';
import { Publica } from '../seguridad';

/** `Cache-Control` del PDF por enlace (criterio 160): solo el navegador de quien lo abre, 5 minutos. */
export const CACHE_CONTROL_PDF_PUBLICO = 'private, max-age=300';

/**
 * El PDF de un comprobante por su enlace público (historia 006, entrega 6b, criterio 160): sin sesión, la empresa sale del
 * sello cifrado. Un sello alterado, vencido, de un comprobante inexistente o sin PDF responde 404 con el mismo cuerpo. No
 * hay forma de listar: `GET /publico/comprobantes/` es 404. Sigue las reglas de `/publico/` (criterio de 005).
 */
@Controller('publico/comprobantes')
export class PublicoComprobantesController {
  constructor(
    @Inject(PublicoComprobantesService) private readonly publico: PublicoComprobantesService,
  ) {}

  /** 200 `application/pdf` con `Cache-Control: private, max-age=300`; 404. */
  @Get(':sello')
  @Publica()
  async pdf(
    @Param('sello') sello: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const archivo = await this.publico.abrir(sello);
    respuesta.setHeader('Cache-Control', CACHE_CONTROL_PDF_PUBLICO);
    return new StreamableFile(archivo.contenido, {
      type: 'application/pdf',
      disposition: `inline; filename="${archivo.numero}.pdf"`,
      length: archivo.contenido.length,
    });
  }
}
