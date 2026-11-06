import { Inject, Injectable } from '@nestjs/common';
import type { ConfiguracionPseEntrada, ConfiguracionPseRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { ENTORNO, PSE_CONECTOR_SIMULADOR, type Entorno } from '../../config/entorno';
import { Cifrado, CifradoInvalidoError } from '../../nucleo/cifrado';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { datosAsociadosDeCredencial } from './emisores.service';
import { OperacionPlataforma } from './operacion-plataforma';
import { UltimaEmisionDeEmisor } from './ultima-emision';

/**
 * La configuración del PSE de cada emisor (historia 006, entrega 6b, criterios 122 y 123): el modo (`SIMULADO` o `REAL`) y
 * la credencial cifrada. Solo la escribe el superadministrador, por una operación de plataforma (`restaurante_plataforma`,
 * que tiene `INSERT` y `UPDATE` sobre `configuracion_pse`); `restaurante_api` solo la lee (`EmisoresService.configuracionPse`).
 * Ningún valor de la credencial sale nunca en una respuesta, un evento, la auditoría ni un registro.
 *
 * Reglas de modo (criterio 122): `REAL` exige un adaptador real (`PSE_CONECTOR` distinto de `simulador`, 409
 * `PSE_NO_CONFIGURADO`); de `SIMULADO` a `REAL` solo si el emisor no emitió ningún comprobante, y de `REAL` nunca se vuelve a
 * `SIMULADO` (409 `MODO_PSE_INVALIDO`). Repetir lo que ya está responde 200 sin cambios ni auditoría; cada cambio deja
 * `configurar_pse_emisor` en `auditoria` (origen `plataforma`) con el modo antes y después y los nombres de los campos.
 */

const MOTIVO_DE_AUDITORIA = 'Configuración del PSE del emisor';

interface FilaConfiguracion {
  id: string;
  modo: 'SIMULADO' | 'REAL';
  conector: string | null;
  credencial: Buffer | null;
  campos_credencial: string[];
  clave_id: number | null;
  actualizado_en: Date;
}

/** La configuración resultante sin cambios: se sale de la operación (se revierte, sin auditoría) con la respuesta. */
class SinCambios extends Error {
  constructor(readonly respuesta: ConfiguracionPseRespuesta) {
    super('Sin cambios');
  }
}

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

/** La credencial como texto canónico (nombres en orden): dos credenciales iguales dan el mismo texto. */
function textoCanonico(credencial: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(credencial).sort(([a], [b]) => (a < b ? -1 : 1))),
  );
}

function noEncontrado(): ErrorAplicacion {
  return new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El emisor no existe');
}

@Injectable()
export class ConfiguracionPseService {
  constructor(
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(Cifrado) private readonly cifrado: Cifrado,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(UltimaEmisionDeEmisor) private readonly ultimaEmision: UltimaEmisionDeEmisor,
  ) {}

  /** `GET`: 200 `configuracionPseRespuesta` (`modo` `null` sin configuración); 404 si la empresa o el emisor no existen. */
  obtener(empresaId: string, emisorId: string): Promise<ConfiguracionPseRespuesta> {
    return this.operacion.consultar(async (transaccion) => {
      await this.exigirEmisor(transaccion, empresaId, emisorId);
      return this.aRespuesta(emisorId, await this.leer(transaccion, emisorId, false));
    });
  }

  /**
   * `PUT`: 200 `configuracionPseRespuesta`; 404; 409 `PSE_NO_CONFIGURADO` (pidió `REAL` sin adaptador) o `MODO_PSE_INVALIDO`
   * (de `SIMULADO` a `REAL` con comprobantes emitidos, o de `REAL` a `SIMULADO`). Repetir lo mismo no cambia nada ni audita.
   */
  async configurar(
    empresaId: string,
    emisorId: string,
    entrada: ConfiguracionPseEntrada,
    superadministradorId: string,
  ): Promise<ConfiguracionPseRespuesta> {
    const conectorNuevo = entrada.modo === 'REAL' ? this.entorno.PSE_CONECTOR : undefined;
    if (
      entrada.modo === 'REAL' &&
      (conectorNuevo === undefined || conectorNuevo === PSE_CONECTOR_SIMULADOR)
    ) {
      throw new ErrorAplicacion(
        409,
        'PSE_NO_CONFIGURADO',
        'No hay un PSE real configurado: el emisor solo puede facturar en modo simulado',
      );
    }
    // El estado de emisión de comprobantes vive en facturación (plataforma no lee `comprobante`) y se consulta con el
    // contexto de la empresa, que no puede abrirse dentro de una operación de plataforma: va antes de ella. Solo hace falta
    // al pasar de SIMULADO a REAL, que en 6b no ocurre (no hay adaptador real, T34).
    let emitioComprobantes: boolean | undefined;
    if (entrada.modo === 'REAL') {
      const previa = await this.operacion.consultar(async (transaccion) => {
        await this.exigirEmisor(transaccion, empresaId, emisorId);
        return this.leer(transaccion, emisorId, false);
      });
      if (previa?.modo === 'SIMULADO') {
        emitioComprobantes = await this.contexto.ejecutar(
          empresaId,
          async () => (await this.ultimaEmision.fecha(emisorId)) !== null,
          { actor: { sistema: 'plataforma:pse' } },
        );
      }
    }
    try {
      return await this.operacion.ejecutar(
        {
          actor: { superadministradorId },
          motivo: MOTIVO_DE_AUDITORIA,
          operacion: 'configurar_pse_emisor',
          empresaId,
        },
        (transaccion) =>
          this.escribir(
            transaccion,
            empresaId,
            emisorId,
            entrada,
            conectorNuevo ?? null,
            emitioComprobantes,
          ),
      );
    } catch (error) {
      if (error instanceof SinCambios) return error.respuesta;
      throw error;
    }
  }

  private async escribir(
    transaccion: Transaction,
    empresaId: string,
    emisorId: string,
    entrada: ConfiguracionPseEntrada,
    conectorNuevo: string | null,
    emitioComprobantes: boolean | undefined,
  ): Promise<ConfiguracionPseRespuesta> {
    await this.exigirEmisor(transaccion, empresaId, emisorId);
    // La fila de la configuración se bloquea: dos PUT del mismo emisor se turnan.
    const actual = await this.leer(transaccion, emisorId, true);
    if (actual?.modo === 'REAL' && entrada.modo === 'SIMULADO') {
      throw new ErrorAplicacion(
        409,
        'MODO_PSE_INVALIDO',
        'Un emisor en modo real no vuelve al modo simulado: sus números ya son de SUNAT',
      );
    }
    if (actual?.modo === 'SIMULADO' && entrada.modo === 'REAL') {
      if (emitioComprobantes === undefined) {
        throw new ErrorAplicacion(409, 'CONFLICTO', 'La configuración cambió; inténtalo de nuevo');
      }
      if (emitioComprobantes) {
        throw new ErrorAplicacion(
          409,
          'MODO_PSE_INVALIDO',
          'Un emisor con comprobantes emitidos en modo simulado no pasa al modo real: sus números se mezclarían',
        );
      }
    }
    // Un emisor que ya es REAL conserva el conector con que se pasó a REAL.
    const conector = entrada.modo === 'REAL' ? (actual?.conector ?? conectorNuevo) : null;
    const credencial = entrada.credencial;
    if (actual !== null && actual.modo === entrada.modo && actual.conector === conector) {
      if (this.credencialIgual(actual, empresaId, emisorId, credencial)) {
        throw new SinCambios(this.aRespuesta(emisorId, actual));
      }
    }

    let sellada: Buffer | null = actual?.credencial ?? null;
    let claveId: number | null = actual?.clave_id ?? null;
    let campos: string[] = actual?.campos_credencial ?? [];
    if (credencial === null) {
      sellada = null;
      claveId = null;
      campos = [];
    } else if (credencial !== undefined) {
      sellada = this.cifrado.sellar(textoCanonico(credencial), {
        proposito: 'credencial-pse',
        datosAsociados: datosAsociadosDeCredencial(empresaId, emisorId),
      });
      claveId = this.cifrado.claveIdActual();
      campos = Object.keys(credencial).sort();
    }
    const ahora = this.reloj.ahora();
    const sequelize = sequelizeDe(transaccion);
    const guardadas = await sequelize.query<FilaConfiguracion>(
      actual === null
        ? `INSERT INTO configuracion_pse (empresa_id, emisor_id, modo, conector, credencial, campos_credencial, clave_id,
                                          creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $8)
           RETURNING id, modo, conector, credencial, campos_credencial, clave_id, actualizado_en`
        : `UPDATE configuracion_pse
              SET modo = $3, conector = $4, credencial = $5, campos_credencial = $6::text[], clave_id = $7,
                  actualizado_en = $8
            WHERE empresa_id = $1 AND emisor_id = $2
        RETURNING id, modo, conector, credencial, campos_credencial, clave_id, actualizado_en`,
      {
        bind: [empresaId, emisorId, entrada.modo, conector, sellada, campos, claveId, ahora],
        transaction: transaccion,
        type: QueryTypes.SELECT,
      },
    );
    const guardada = guardadas[0]!;
    // Solo modo, conector y nombres de campos: nunca valores.
    this.operacion.registrarDatosDeAuditoria(transaccion, {
      empresaId,
      entidad: 'configuracion_pse',
      entidadId: guardada.id,
      detalle: {
        emisorId,
        antes:
          actual === null
            ? null
            : {
                modo: actual.modo,
                conector: actual.conector,
                camposCredencial: actual.campos_credencial,
              },
        despues: {
          modo: guardada.modo,
          conector: guardada.conector,
          camposCredencial: guardada.campos_credencial,
        },
      },
    });
    return this.aRespuesta(emisorId, guardada);
  }

  /** Si la credencial pedida ya es la guardada (`undefined` la conserva; `null` la borra; un objeto se compara abierto). */
  private credencialIgual(
    actual: FilaConfiguracion,
    empresaId: string,
    emisorId: string,
    credencial: Readonly<Record<string, string>> | null | undefined,
  ): boolean {
    if (credencial === undefined) return true;
    if (credencial === null) return actual.credencial === null;
    if (actual.credencial === null) return false;
    try {
      const guardada = this.cifrado.abrir(actual.credencial, {
        proposito: 'credencial-pse',
        datosAsociados: datosAsociadosDeCredencial(empresaId, emisorId),
      });
      return guardada === textoCanonico(credencial);
    } catch (error) {
      if (error instanceof CifradoInvalidoError) return false;
      throw error;
    }
  }

  private async leer(
    transaccion: Transaction,
    emisorId: string,
    bloquear: boolean,
  ): Promise<FilaConfiguracion | null> {
    const filas = await sequelizeDe(transaccion).query<FilaConfiguracion>(
      `SELECT id, modo, conector, credencial, campos_credencial, clave_id, actualizado_en
         FROM configuracion_pse WHERE emisor_id = $1${bloquear ? ' FOR UPDATE' : ''}`,
      { bind: [emisorId], transaction: transaccion, type: QueryTypes.SELECT },
    );
    return filas[0] ?? null;
  }

  /** 404 si el emisor no existe o no es de esa empresa (indistinguibles). */
  private async exigirEmisor(
    transaccion: Transaction,
    empresaId: string,
    emisorId: string,
  ): Promise<void> {
    const filas = await sequelizeDe(transaccion).query<{ id: string }>(
      'SELECT id FROM emisor WHERE id = $1 AND empresa_id = $2',
      { bind: [emisorId, empresaId], transaction: transaccion, type: QueryTypes.SELECT },
    );
    if (filas.length === 0) throw noEncontrado();
  }

  private aRespuesta(emisorId: string, fila: FilaConfiguracion | null): ConfiguracionPseRespuesta {
    return {
      emisorId,
      modo: fila?.modo ?? null,
      conector: fila?.conector ?? null,
      credencialConfigurada: fila !== null && fila.credencial !== null,
      camposCredencial: fila?.campos_credencial ?? [],
      actualizadaEn: fila?.actualizado_en.toISOString() ?? null,
    };
  }
}
