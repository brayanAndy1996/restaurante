import { Inject, Injectable } from '@nestjs/common';
import type { AlertasPlataformaRespuesta, PadronEstadoRespuesta } from '@restaurante/contratos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { AlertasDeFacturacion } from './alertas-de-facturacion';
import { EmpresasConsulta } from './empresas-consulta';

/** Cuántas empresas se cuentan a la vez en el tablero de alertas. */
const EMPRESAS_EN_PARALELO = 4;

/**
 * Lo que el superadministrador ve y pide de la facturación electrónica (historia 006, entrega 6b, criterios 133 y 138): los
 * conteos de alertas por empresa, el estado del padrón de RUC y la carga a pedido. Plataforma no lee `comprobante`: los
 * conteos y la carga los darán facturación y el worker por puertos que registran al arrancar (T32 y T36).
 *
 * Fase A (T29): solo las firmas; lanzan `Error('No implementado')`.
 */
@Injectable()
export class FacturacionPlataformaService {
  constructor(
    @Inject(EmpresasConsulta) private readonly empresas: EmpresasConsulta,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(AlertasDeFacturacion) private readonly alertasDeFacturacion: AlertasDeFacturacion,
  ) {}

  /**
   * `GET /plataforma/facturacion/alertas` (criterio 133, pregunta 37): por cada empresa, cuántos comprobantes alertan por
   * cada motivo. Cada empresa se cuenta en su propio contexto (con su RLS) por el puerto que registra facturación;
   * plataforma no lee `comprobante`. Solo lectura: no deja auditoría.
   */
  async alertas(): Promise<AlertasPlataformaRespuesta> {
    const empresas = await this.empresas.lista();
    const filas: AlertasPlataformaRespuesta = new Array(empresas.length);
    let siguiente = 0;
    const trabajar = async (): Promise<void> => {
      for (let i = siguiente++; i < empresas.length; i = siguiente++) {
        const empresa = empresas[i]!;
        const conteo = await this.contexto.ejecutar(empresa.id, () =>
          this.alertasDeFacturacion.contar(),
        );
        filas[i] = {
          empresaId: empresa.id,
          empresa: empresa.nombre,
          rechazados: conteo.rechazados,
          demorados: conteo.demorados,
          detenidos: conteo.detenidos,
          sinConfiguracion: conteo.sinConfiguracion,
        };
      }
    };
    await Promise.all(Array.from({ length: EMPRESAS_EN_PARALELO }, trabajar));
    return filas;
  }

  estadoDelPadron(): Promise<PadronEstadoRespuesta> {
    return Promise.reject(noImplementado());
  }

  /** Encola la carga del padrón (una a la vez); deja `cargar_padron` en `auditoria` (origen `plataforma`). */
  pedirCargaDelPadron(): Promise<void> {
    return Promise.reject(noImplementado());
  }
}
