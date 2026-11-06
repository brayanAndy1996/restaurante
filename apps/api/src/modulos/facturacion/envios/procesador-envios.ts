import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import type { AlertaComprobante, EstadoComprobante, EstadoEnvioPse } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { ENTORNO, type Entorno } from '../../../config/entorno';
import { ALMACEN_COMPROBANTES, type AlmacenComprobantes } from '../../../nucleo/archivos';
import { CONEXION_API } from '../../../nucleo/base-de-datos';
import { COLA_PSE, type ColaPse } from '../../../nucleo/colas';
import { arriendoDelEnvioMs } from '../../../nucleo/colas/tiempos-del-envio';
import { ContextoEmpresa } from '../../../nucleo/contexto-empresa';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../../nucleo/eventos';
import { RELOJ, type Reloj } from '../../../nucleo/reloj';
import { leerComprobante } from '../lectura-comprobante';
import { armarDocumentoPse } from '../pse/documento-pse';
import type {
  ConectorDeEmisor,
  DocumentoPse,
  IdDocumentoPse,
  ResultadoConsultaPse,
  ResultadoPse,
} from '../pse/conector-pse';
import { ArchivadorDePdf } from '../pdf/archivador-de-pdf';
import { RegistroDeConectores } from '../pse/registro-de-conectores';
import { publicarAlerta } from './alertas';
import {
  aplicarResultado,
  esAceptado,
  guardarArchivosDeComprobante,
  type ClavesDeArchivos,
  type LlamadaHecha,
} from './resultado-pse';

/**
 * Nombre del actor de las transacciones del worker de envíos (historia 006, criterios 125 y 163); lo registran las
 * columnas de trazabilidad de `envio_pse`, `intento_pse` y los cambios de estado de `comprobante` (criterio 171).
 */
export const ACTOR_WORKER_ENVIO_PSE = 'worker:envio-pse';

/** Lo que el paso 1 deja listo para el paso 2, fuera de toda transacción. */
interface EnvioTomado {
  envioId: string;
  sucursalId: string;
  intentoEnCurso: string;
  /** Intentos hechos contando este (1 = el primero: emitir; después: consultar antes de emitir). */
  intentos: number;
  plazoHasta: Date;
  estadoComprobante: EstadoComprobante;
  emitidoEn: Date;
  alertasPublicadas: AlertaComprobante[];
  documento: DocumentoPse;
  conector: ConectorDeEmisor;
}

interface FilaDeEnvio {
  envio_id: string;
  estado: EstadoEnvioPse;
  intentos: number;
  proximo_intento_en: Date | null;
  plazo_hasta: Date;
  en_curso_hasta: Date | null;
  intento_en_curso: string | null;
  alerta: AlertaComprobante | null;
  alertas_previas: AlertaComprobante[];
  emisor_id: string;
  sucursal_id: string;
  estado_comprobante: EstadoComprobante;
  emitido_en: Date;
}

/** Los motivos ya publicados de un comprobante: los previos más el último (criterio 133). */
function motivosPublicados(
  alerta: AlertaComprobante | null,
  previas: AlertaComprobante[],
): AlertaComprobante[] {
  return alerta === null || previas.includes(alerta) ? previas : [...previas, alerta];
}

/**
 * El procesador de un envío al PSE (historia 006, entrega 6b, criterios 125 a 131; ruta crítica P7), en tres pasos:
 *
 * 1. **Tomar** (transacción corta): `FOR UPDATE SKIP LOCKED` sobre `envio_pse`; si no hay fila, está `TERMINADO` o
 *    `DETENIDO`, aún no toca o tiene un arriendo vigente, termina sin hacer nada. Si no, fija el arriendo (`2 × PSE_TIMEOUT_MS + 2 × TIEMPO_LIMITE_R2_MS + 20 s`, mínimo 2 minutos) y un
 *    `intento_en_curso`, suma un intento y arma el documento y el conector del emisor.
 * 2. **Llamar** (sin transacción): el primer intento emite; los demás consultan primero y solo con `NO_EXISTE` emiten
 *    (criterio 128). Un `ACEPTADO` con XML o CDR los guarda en el almacén privado antes del paso 3.
 * 3. **Guardar** (transacción corta): vuelve a tomar la fila y aplica el resultado (`resultado-pse.ts`) si el
 *    `intento_en_curso` sigue siendo el suyo o está libre (el barrido detuvo el envío por plazo) y el resultado es final;
 *    si el arriendo venció y otro worker lo tomó, descarta su resultado (la llamada fue idempotente por identificador). Los eventos y el siguiente encolado salen con `alConfirmar`.
 *
 * Con un `ACEPTADO` confirmado, después del paso 3 arma el PDF y lo guarda (`ArchivadorDePdf`, criterio 159), fuera de toda
 * transacción.
 *
 * Ninguna llamada al PSE ocurre dentro de una transacción. Cada transacción fija la empresa del trabajo y actúa como
 * `worker:envio-pse`. Las esperas, el arriendo y los plazos usan el reloj de la API.
 */
@Injectable()
export class ProcesadorEnviosPse {
  private readonly logger = new Logger(ProcesadorEnviosPse.name);

  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(RegistroDeConectores) private readonly conectores: RegistroDeConectores,
    @Inject(ALMACEN_COMPROBANTES) private readonly almacen: AlmacenComprobantes,
    @Inject(COLA_PSE) private readonly cola: ColaPse,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
    @Inject(ArchivadorDePdf) private readonly pdf: ArchivadorDePdf,
  ) {}

  /**
   * Procesa el envío del comprobante con el contexto de `empresaId` (`ContextoEmpresa.ejecutar` en cada transacción, con
   * el actor `worker:envio-pse`). Un envío que no existe, de otra empresa, `TERMINADO`, `DETENIDO`, que no toca todavía o
   * con un arriendo vigente termina sin hacer nada. No lanza por un resultado del PSE.
   */
  async procesar(empresaId: string, comprobanteId: string): Promise<void> {
    if (!uuidSchema.safeParse(empresaId).success || !uuidSchema.safeParse(comprobanteId).success) {
      return;
    }
    const tomado = await this.contexto.ejecutar(empresaId, () => this.tomar(comprobanteId), {
      actor: { sistema: ACTOR_WORKER_ENVIO_PSE },
    });
    if (tomado === null) return;

    const { llamadas, resultado, archivos } = await this.llamar(empresaId, comprobanteId, tomado);

    const quedoAceptado = await this.contexto.ejecutar(
      empresaId,
      () => this.guardar(empresaId, comprobanteId, tomado, llamadas, resultado, archivos),
      { actor: { sistema: ACTOR_WORKER_ENVIO_PSE } },
    );
    // Con el `ACEPTADO` ya confirmado, el PDF se arma fuera de toda transacción (criterio 159). Si falla, el barrido lo
    // vuelve a intentar: el estado no se pierde.
    if (quedoAceptado) await this.pdf.generar(empresaId, comprobanteId);
  }

  // ----------------------------------------------------------------------------------------------
  // Paso 1 · tomar
  // ----------------------------------------------------------------------------------------------

  private async tomar(comprobanteId: string): Promise<EnvioTomado | null> {
    const filas = await this.conexion.query<FilaDeEnvio>(
      `SELECT e.id AS envio_id, e.estado, e.intentos, e.proximo_intento_en, e.plazo_hasta, e.en_curso_hasta,
              e.intento_en_curso, e.alerta, e.alertas_previas, c.emisor_id, c.sucursal_id, c.estado AS estado_comprobante, c.emitido_en
         FROM envio_pse e
         JOIN comprobante c ON c.id = e.comprobante_id AND c.empresa_id = e.empresa_id
        WHERE e.comprobante_id = $1
          FOR UPDATE OF e SKIP LOCKED`,
      { bind: [comprobanteId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) return null;
    const ahora = this.reloj.ahora();
    if (fila.estado === 'TERMINADO' || fila.estado === 'DETENIDO') return null;
    if (fila.proximo_intento_en === null || fila.proximo_intento_en.getTime() > ahora.getTime()) {
      return null;
    }
    if (fila.en_curso_hasta !== null && fila.en_curso_hasta.getTime() > ahora.getTime()) {
      return null;
    }
    if (fila.estado_comprobante !== 'POR_ENVIAR' && fila.estado_comprobante !== 'ENVIADO') {
      return null;
    }

    const comprobante = await leerComprobante(this.conexion, comprobanteId, null);
    if (comprobante === null) return null;
    const intentoEnCurso = randomUUID();
    await this.conexion.query(
      `UPDATE envio_pse
          SET en_curso_hasta = $2, intento_en_curso = $3, intentos = intentos + 1, reintento_manual_en = NULL,
              actualizado_en = $4
        WHERE id = $1`,
      {
        bind: [
          fila.envio_id,
          new Date(ahora.getTime() + arriendoDelEnvioMs(this.entorno.PSE_TIMEOUT_MS)),
          intentoEnCurso,
          ahora,
        ],
        type: QueryTypes.UPDATE,
      },
    );
    return {
      envioId: fila.envio_id,
      sucursalId: fila.sucursal_id,
      intentoEnCurso,
      intentos: fila.intentos + 1,
      plazoHasta: fila.plazo_hasta,
      estadoComprobante: fila.estado_comprobante,
      emitidoEn: fila.emitido_en,
      alertasPublicadas: motivosPublicados(fila.alerta, fila.alertas_previas),
      documento: armarDocumentoPse(comprobante),
      conector: await this.conectores.para(fila.emisor_id),
    };
  }

  // ----------------------------------------------------------------------------------------------
  // Paso 2 · llamar (sin transacción)
  // ----------------------------------------------------------------------------------------------

  private async llamar(
    empresaId: string,
    comprobanteId: string,
    tomado: EnvioTomado,
  ): Promise<{ llamadas: LlamadaHecha[]; resultado: ResultadoPse; archivos: ClavesDeArchivos }> {
    const llamadas: LlamadaHecha[] = [];
    const sinArchivos: ClavesDeArchivos = { xmlClave: null, cdrClave: null };
    const { conector, credencial } = tomado.conector;
    const primerIntento = tomado.intentos === 1;

    // Sin conector (el emisor no tiene configuración o su credencial no se pudo abrir): no se llama a nadie.
    if (conector === null) {
      const ahora = this.reloj.ahora();
      const resultado: ResultadoPse = {
        tipo: 'ERROR_CONFIGURACION',
        detalle: tomado.conector.detalle ?? 'La facturación electrónica no está activada',
      };
      llamadas.push({
        operacion: primerIntento ? 'EMITIR' : 'CONSULTAR',
        iniciadoEn: ahora,
        terminadoEn: ahora,
        resultado,
      });
      return { llamadas, resultado, archivos: sinArchivos };
    }

    const id: IdDocumentoPse = tomado.documento.id;
    let resultado: ResultadoPse | null = null;
    if (!primerIntento) {
      const consulta = await this.conTiempoMaximo(() => conector.consultar(id, credencial));
      llamadas.push({ operacion: 'CONSULTAR', ...consulta });
      if (consulta.resultado.tipo !== 'NO_EXISTE') resultado = consulta.resultado;
    }
    if (resultado === null) {
      const emision = await this.conTiempoMaximo(() =>
        conector.emitir(tomado.documento, credencial),
      );
      llamadas.push({ operacion: 'EMITIR', ...emision });
      resultado = emision.resultado as ResultadoPse;
    }

    if (!esAceptado(resultado)) return { llamadas, resultado, archivos: sinArchivos };
    try {
      const archivos = await guardarArchivosDeComprobante(
        this.almacen,
        empresaId,
        comprobanteId,
        resultado,
      );
      return { llamadas, resultado, archivos };
    } catch (error) {
      // El PSE aceptó pero no se pudieron guardar los archivos: el siguiente intento consulta y los vuelve a guardar.
      this.logger.warn(
        JSON.stringify({
          evento: 'pse.archivos_no_guardados',
          empresaId,
          comprobanteId,
          error: error instanceof Error ? error.name : 'error desconocido',
        }),
      );
      return {
        llamadas,
        resultado: {
          tipo: 'ERROR_TRANSPORTE',
          detalle: 'No se pudieron guardar los archivos del comprobante',
        },
        archivos: sinArchivos,
      };
    }
  }

  /**
   * Una llamada al conector con su tiempo máximo (`PSE_TIMEOUT_MS`). Nunca lanza: una excepción o el tiempo agotado son
   * `ERROR_TRANSPORTE` (criterio 120); el detalle no lleva datos del documento ni la credencial.
   */
  private async conTiempoMaximo(
    llamada: () => Promise<ResultadoConsultaPse>,
  ): Promise<{ iniciadoEn: Date; terminadoEn: Date; resultado: ResultadoConsultaPse }> {
    const iniciadoEn = this.reloj.ahora();
    let temporizador: NodeJS.Timeout | undefined;
    const agotado = new Promise<ResultadoConsultaPse>((resolver) => {
      temporizador = setTimeout(
        () =>
          resolver({
            tipo: 'ERROR_TRANSPORTE',
            detalle: `Tiempo agotado esperando al PSE (${this.entorno.PSE_TIMEOUT_MS} ms)`,
          }),
        this.entorno.PSE_TIMEOUT_MS,
      );
    });
    let resultado: ResultadoConsultaPse;
    try {
      const respuesta = llamada().catch((error: unknown): ResultadoConsultaPse => ({
        tipo: 'ERROR_TRANSPORTE',
        detalle: `Falló la llamada al PSE (${error instanceof Error ? error.name : 'error'})`,
      }));
      resultado = await Promise.race([respuesta, agotado]);
    } catch (error) {
      resultado = {
        tipo: 'ERROR_TRANSPORTE',
        detalle: `Falló la llamada al PSE (${error instanceof Error ? error.name : 'error'})`,
      };
    } finally {
      clearTimeout(temporizador);
    }
    return { iniciadoEn, terminadoEn: this.reloj.ahora(), resultado };
  }

  // ----------------------------------------------------------------------------------------------
  // Paso 3 · guardar
  // ----------------------------------------------------------------------------------------------

  private async guardar(
    empresaId: string,
    comprobanteId: string,
    tomado: EnvioTomado,
    llamadas: LlamadaHecha[],
    resultado: ResultadoPse,
    archivos: ClavesDeArchivos,
  ): Promise<boolean> {
    const filas = await this.conexion.query<{
      estado: EstadoEnvioPse;
      intento_en_curso: string | null;
      alerta: AlertaComprobante | null;
      alertas_previas: AlertaComprobante[];
      estado_comprobante: EstadoComprobante;
    }>(
      `SELECT e.estado, e.intento_en_curso, e.alerta, e.alertas_previas, c.estado AS estado_comprobante
         FROM envio_pse e
         JOIN comprobante c ON c.id = e.comprobante_id AND c.empresa_id = e.empresa_id
        WHERE e.id = $1
          FOR UPDATE OF e`,
      { bind: [tomado.envioId], type: QueryTypes.SELECT },
    );
    const actual = filas[0];
    // Otro worker tomó el envío (el arriendo venció y hay un `intento_en_curso` ajeno) o ya terminó: este resultado se
    // descarta sin escribir nada. Si el arriendo está libre porque el barrido detuvo el envío por plazo mientras esta llamada
    // seguía en curso (criterio 125, paso 3), un resultado final (`ACEPTADO` o `RECHAZADO`) sí se aplica: es lo que el PSE
    // ya hizo con el documento. Un resultado no final con el arriendo libre se descarta: el envío ya tiene su rumbo.
    if (
      actual === undefined ||
      actual.estado === 'TERMINADO' ||
      (actual.intento_en_curso !== null && actual.intento_en_curso !== tomado.intentoEnCurso) ||
      (actual.intento_en_curso === null &&
        resultado.tipo !== 'ACEPTADO' &&
        resultado.tipo !== 'RECHAZADO')
    ) {
      this.logger.warn(
        JSON.stringify({ evento: 'pse.resultado_descartado', empresaId, comprobanteId }),
      );
      return false;
    }

    const ahora = this.reloj.ahora();
    const salida = await aplicarResultado(this.conexion, {
      envio: {
        envioId: tomado.envioId,
        empresaId,
        comprobanteId,
        sucursalId: tomado.sucursalId,
        intentos: tomado.intentos,
        plazoHasta: tomado.plazoHasta,
        estadoComprobante: actual.estado_comprobante,
        emitidoEn: tomado.emitidoEn,
        alertasPublicadas: motivosPublicados(actual.alerta, actual.alertas_previas),
      },
      llamadas,
      resultado,
      archivos,
      ahora,
    });

    if (salida.cambioElEstado) {
      const estado = salida.estadoComprobante;
      this.contexto.alConfirmar(() =>
        this.publicador.publicar({
          empresaId,
          sala: { tipo: 'sucursal', sucursalId: tomado.sucursalId },
          nombre: 'comprobante.estado',
          datos: { comprobanteId, estado, sucursalId: tomado.sucursalId },
        }),
      );
    }
    // Una anulación (o la de un cambio de boleta por factura) aceptada deja el original `ANULADO`, en esta misma transacción
    // (criterio 152). Va después de actualizar la nota (envío → nota → original, el orden del plan).
    if (salida.cambioElEstado && salida.estadoComprobante === 'ACEPTADO') {
      const original = await this.anularOriginal(comprobanteId, ahora);
      if (original !== null) {
        this.contexto.alConfirmar(() =>
          this.publicador.publicar({
            empresaId,
            sala: { tipo: 'sucursal', sucursalId: original.sucursalId },
            nombre: 'comprobante.estado',
            datos: {
              comprobanteId: original.id,
              estado: 'ANULADO',
              sucursalId: original.sucursalId,
            },
          }),
        );
      }
    }
    if (salida.alertaNueva !== null) {
      const motivo = salida.alertaNueva;
      this.contexto.alConfirmar(() =>
        publicarAlerta(this.publicador, {
          empresaId,
          comprobanteId,
          sucursalId: tomado.sucursalId,
          motivo,
        }),
      );
    }
    if (salida.proximoIntentoEn !== null) {
      const startAfter = salida.proximoIntentoEn;
      this.contexto.alConfirmar(() => this.encolarSiguiente(empresaId, comprobanteId, startAfter));
    }
    return salida.cambioElEstado && salida.estadoComprobante === 'ACEPTADO';
  }

  /**
   * Si el comprobante aceptado es una nota de crédito `ANULACION` (también la de un cambio a factura), deja `ANULADO` a su
   * original, que estaba `ACEPTADO` (criterio 152). Una `DEVOLUCION` no cambia el estado del original. Devuelve el original
   * anulado, o `null` si no había nada que anular.
   */
  private async anularOriginal(
    notaId: string,
    ahora: Date,
  ): Promise<{ id: string; sucursalId: string } | null> {
    const filas = await this.conexion.query<{ id: string; sucursal_id: string }>(
      `UPDATE comprobante o
          SET estado = 'ANULADO', anulado_en = $2, actualizado_en = $2
         FROM comprobante n
        WHERE n.id = $1 AND n.tipo_nota = 'ANULACION' AND n.afecta_a_id = o.id AND o.estado = 'ACEPTADO'
        RETURNING o.id, o.sucursal_id`,
      { bind: [notaId, ahora], type: QueryTypes.SELECT },
    );
    const original = filas[0];
    return original === undefined ? null : { id: original.id, sucursalId: original.sucursal_id };
  }

  /** El siguiente intento en la cola; si falla, el barrido lo recoge (criterio 126). */
  private async encolarSiguiente(
    empresaId: string,
    comprobanteId: string,
    startAfter: Date,
  ): Promise<void> {
    try {
      await this.cola.encolar({ empresaId, comprobanteId }, { startAfter });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          evento: 'pse.encolado_fallido',
          empresaId,
          comprobanteId,
          error: error instanceof Error ? error.name : 'error desconocido',
        }),
      );
    }
  }
}
