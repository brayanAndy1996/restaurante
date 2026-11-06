import { Inject, Injectable } from '@nestjs/common';
import type { AlertasPlataformaRespuesta, PadronEstadoRespuesta } from '@restaurante/contratos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { COLA_PSE, type ColaPse } from '../../nucleo/colas';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { AlertasDeFacturacion } from './alertas-de-facturacion';
import { EmpresasConsulta } from './empresas-consulta';
import { OperacionPlataforma } from './operacion-plataforma';

/** Cuántas empresas se cuentan a la vez en el tablero de alertas. */
const EMPRESAS_EN_PARALELO = 4;

const MOTIVO_CARGA_DEL_PADRON = 'Carga del padrón de RUC a pedido del superadministrador';

interface FilaEstadoDelPadron {
  cargado_en: Date | null;
  filas: number | null;
  fecha_archivo: string | null;
  ultimo_intento_en: Date | null;
  ultimo_error: string | null;
}

/**
 * Lo que el superadministrador ve y pide de la facturación electrónica (historia 006, entrega 6b, criterios 133 y 138): los
 * conteos de alertas por empresa, el estado del padrón de RUC y la carga a pedido. Plataforma no lee `comprobante`: los
 * conteos y la carga los dan facturación y el worker por puertos que registran al arrancar.
 */
@Injectable()
export class FacturacionPlataformaService {
  constructor(
    @Inject(EmpresasConsulta) private readonly empresas: EmpresasConsulta,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(AlertasDeFacturacion) private readonly alertasDeFacturacion: AlertasDeFacturacion,
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(COLA_PSE) private readonly cola: ColaPse,
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

  /**
   * `GET /plataforma/padron` (criterio 138): cuándo se cargó el padrón, cuántas filas, la fecha del archivo, el último intento
   * y su error. `referencia` no tiene `USAGE` para `restaurante_plataforma`: el estado sale por `public.padron_estado()`
   * (`SECURITY DEFINER`, solo esas cinco columnas, sin ningún dato del padrón).
   */
  estadoDelPadron(): Promise<PadronEstadoRespuesta> {
    return this.operacion.consultar(async (transaccion) => {
      const filas = await (
        transaccion as Transaction & { sequelize: Sequelize }
      ).sequelize.query<FilaEstadoDelPadron>(
        'SELECT cargado_en, filas, fecha_archivo::text AS fecha_archivo, ultimo_intento_en, ultimo_error FROM public.padron_estado()',
        { transaction: transaccion, type: QueryTypes.SELECT },
      );
      const fila = filas[0];
      return {
        cargadoEn: fila?.cargado_en?.toISOString() ?? null,
        filas: fila?.filas ?? null,
        fechaArchivo: fila?.fecha_archivo ?? null,
        ultimoIntentoEn: fila?.ultimo_intento_en?.toISOString() ?? null,
        ultimoError: fila?.ultimo_error ?? null,
      };
    });
  }

  /**
   * `POST /plataforma/padron/carga` (criterio 138): deja `cargar_padron` en `auditoria` (origen `plataforma`, sin datos de
   * la carga) y, **después de confirmarla**, pide la carga a la cola, que deja a lo más una a la vez; la hace el worker.
   */
  async pedirCargaDelPadron(superadministradorId: string): Promise<void> {
    await this.operacion.ejecutar(
      {
        actor: { superadministradorId },
        motivo: MOTIVO_CARGA_DEL_PADRON,
        operacion: 'cargar_padron',
      },
      () => Promise.resolve(),
    );
    await this.cola.pedirCargaDePadron();
  }
}
