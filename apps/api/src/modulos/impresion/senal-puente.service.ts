import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { ServidorTiempoReal } from '../../nucleo/tiempo-real';
import { EventosImpresion } from './eventos-impresion';
import { MS_PUENTE_CONECTADO } from './lectura-impresoras';

/** Cada cuánto cada instancia revisa a los puentes que conoce (criterio 120: la desconexión se avisa a los 60 s). */
export const INTERVALO_REVISION_PUENTES_MS = 20_000;

/** Un puente que esta instancia vigila: el que dio señal (o fue consultado) y todavía puede quedarse sin ella. */
export interface PuenteVigilado {
  empresaId: string;
  puenteId: string;
  sucursalId: string;
}

/**
 * ¿El puente "vuelve" con esta señal? Sí cuando nunca había dado señal, cuando llevaba más de 60 segundos sin ella
 * o cuando la revisión ya había avisado su desconexión (criterio 120). Función pura: el reloj se pasa como `ahora`.
 */
export function puenteVuelve(
  ultimaSenalEn: Date | string | null,
  desconexionAvisadaEn: Date | string | null,
  ahora: Date,
): boolean {
  if (ultimaSenalEn === null || desconexionAvisadaEn !== null) return true;
  return ahora.getTime() - new Date(ultimaSenalEn).getTime() > MS_PUENTE_CONECTADO;
}

/**
 * La señal del puente de impresión y el aviso de sus cambios de conexión (historia 004, 3b, criterios 111, 120 y
 * 121). `impresion.estado` se publica una sola vez por cambio:
 *
 * - **El puente vuelve** (latido o socket tras más de 60 segundos sin señal, o tras haberse avisado su
 *   desconexión): lo publica quien recibe la señal, dentro de su transacción y después de confirmarla.
 * - **El puente se queda sin señal 60 segundos:** lo publica la revisión periódica (`revisarAhora`, que las pruebas
 *   llaman con un reloj manual, como la de inactividad del tiempo real). Fija `desconexion_avisada_en` con un
 *   `UPDATE` condicionado, así que con varias instancias de la API solo una publica.
 *
 * La API se conecta con un rol sin acceso entre empresas, así que no puede listar todos los puentes: cada instancia
 * vigila los que vio dar señal (latido o socket) o consultar (`GET /impresion/estado`, que las PWA piden cada 30
 * segundos), y deja de vigilar al que ya avisó su desconexión o fue revocado.
 */
@Injectable()
export class SenalPuenteService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SenalPuenteService.name);
  private readonly vigilados = new Map<string, PuenteVigilado>();
  private temporizador: NodeJS.Timeout | null = null;
  private revision: Promise<void> | null = null;

  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    // El servidor de tiempo real depende del validador del puente (que usa este servicio) y los eventos dependen
    // del publicador de Socket.IO (que usa al servidor): `EventosImpresion` y el servidor se piden con `ModuleRef`
    // cuando hacen falta, no se inyectan, para no cerrar un ciclo de dependencias.
    @Inject(ModuleRef) private readonly modulos: ModuleRef,
  ) {}

  private get eventos(): EventosImpresion {
    return this.modulos.get(EventosImpresion, { strict: false });
  }

  onApplicationBootstrap(): void {
    // Sin tiempo real nadie recibe el aviso: no hay nada que revisar por reloj.
    const servidor = this.modulos.get(ServidorTiempoReal, { strict: false });
    if (servidor?.habilitado !== true) return;
    this.temporizador = setInterval(() => {
      void this.revisarAhora();
    }, INTERVALO_REVISION_PUENTES_MS);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    if (this.temporizador !== null) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  /** Esta instancia vigilará al puente: si deja de dar señal, la revisión avisará su desconexión. */
  vigilar(puente: PuenteVigilado): void {
    this.vigilados.set(puente.puenteId, {
      empresaId: puente.empresaId,
      puenteId: puente.puenteId,
      sucursalId: puente.sucursalId,
    });
  }

  /** Cuántos puentes vigila esta instancia (para las pruebas). */
  get cantidadVigilados(): number {
    return this.vigilados.size;
  }

  /**
   * La señal del puente por el socket (criterio 111): `ultima_senal_en` = ahora. Si el puente volvía, publica
   * `impresion.estado`. Un puente revocado no deja señal.
   */
  async marcarSenal(puente: PuenteVigilado): Promise<void> {
    const ahora = this.reloj.ahora();
    this.vigilar(puente);
    await this.contexto.ejecutar(
      puente.empresaId,
      async () => {
        const filas = await this.conexion.query<{
          ultima_senal_en: Date | null;
          desconexion_avisada_en: Date | null;
        }>(
          `SELECT ultima_senal_en, desconexion_avisada_en FROM puente
            WHERE id = $1 AND activo FOR UPDATE`,
          { bind: [puente.puenteId], type: QueryTypes.SELECT },
        );
        const antes = filas[0];
        if (antes === undefined) return;
        await this.conexion.query(
          `UPDATE puente SET ultima_senal_en = $2, desconexion_avisada_en = NULL, actualizado_en = $2
            WHERE id = $1`,
          { bind: [puente.puenteId, ahora], type: QueryTypes.UPDATE },
        );
        if (puenteVuelve(antes.ultima_senal_en, antes.desconexion_avisada_en, ahora)) {
          this.eventos.impresionEstado(puente.sucursalId);
        }
      },
      { actor: { sistema: `puente:${puente.puenteId}` } },
    );
  }

  /**
   * Revisa ahora a los puentes vigilados y avisa (una sola vez) los que llevan más de 60 segundos sin señal; la
   * revisión periódica llama a lo mismo y las pruebas la llaman directamente con un reloj manual. Si ya hay una
   * revisión en curso, espera a esa.
   */
  revisarAhora(): Promise<void> {
    if (this.revision !== null) return this.revision;
    const revision = this.revisar().finally(() => {
      this.revision = null;
    });
    this.revision = revision;
    return revision;
  }

  private async revisar(): Promise<void> {
    for (const puente of [...this.vigilados.values()]) {
      try {
        await this.revisarPuente(puente);
      } catch (error) {
        this.logger.error(
          'No se pudo revisar la señal de un puente',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private async revisarPuente(puente: PuenteVigilado): Promise<void> {
    const ahora = this.reloj.ahora();
    const limite = new Date(ahora.getTime() - MS_PUENTE_CONECTADO);
    const dejarDeVigilar = await this.contexto.ejecutar(
      puente.empresaId,
      async () => {
        // Sin señal desde hace más de 60 segundos y sin aviso previo: este UPDATE lo gana una sola instancia.
        const avisados = await this.conexion.query<{ sucursal_id: string }>(
          `UPDATE puente SET desconexion_avisada_en = $2, actualizado_en = $2
            WHERE id = $1 AND activo AND ultima_senal_en IS NOT NULL AND ultima_senal_en < $3
              AND desconexion_avisada_en IS NULL
            RETURNING sucursal_id`,
          { bind: [puente.puenteId, ahora, limite], type: QueryTypes.SELECT },
        );
        if (avisados[0] !== undefined) {
          this.eventos.impresionEstado(avisados[0].sucursal_id);
          return true;
        }
        const filas = await this.conexion.query<{ desconexion_avisada_en: Date | null }>(
          'SELECT desconexion_avisada_en FROM puente WHERE id = $1 AND activo',
          { bind: [puente.puenteId], type: QueryTypes.SELECT },
        );
        // Revocado, o ya avisado por otra instancia: no hay nada más que vigilar hasta su próxima señal.
        return filas[0] === undefined || filas[0].desconexion_avisada_en !== null;
      },
      { actor: { sistema: 'revision-puentes' } },
    );
    // Si una señal lo volvió a registrar mientras se revisaba (otro objeto), se sigue vigilando.
    if (dejarDeVigilar && this.vigilados.get(puente.puenteId) === puente) {
      this.vigilados.delete(puente.puenteId);
    }
  }
}
