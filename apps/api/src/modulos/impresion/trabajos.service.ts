import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAXIMO_TRABAJOS_POR_IMPRESORA,
  type ResultadoTrabajoEntrada,
  type TipoTrabajo,
  type TrabajoParaImprimir,
  type TrabajoResumen,
  type TrabajosConsulta,
} from '@restaurante/contratos';
import type { DocumentoTicket } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import type { PuenteAutenticado } from '../../nucleo/principal';
import { RELOJ, horaLocal, type Reloj } from '../../nucleo/reloj';
import { SucursalesConsultaService } from '../plataforma';
import { SesionActual } from '../seguridad';
import { ColaImpresionService } from './cola-impresion.service';
import { conMarcas, documentoDePrueba, recortarError, renderizarTicket } from './escpos';
import { noEncontrado, sinImpresora } from './errores-impresion';
import { OrdenesVigentes } from './ordenes-vigentes';
import type { FilaImpresora } from './lectura-impresoras';

/** Un trabajo con más de este tiempo entre su creación y su entrega sale con la marca de retraso (criterio 118). */
const MS_RETRASO = 2 * 60_000;

interface FilaEntrega {
  id: string;
  impresora_id: string;
  tipo: TipoTrabajo;
  creado_en: Date;
  documento: DocumentoTicket;
  ancho_mm: 58 | 80;
  juego_caracteres: FilaImpresora['juego_caracteres'];
}

interface FilaResumen {
  id: string;
  tipo: TipoTrabajo;
  impresora_id: string;
  impresora_nombre: string;
  mesa: string | null;
  orden_id: string | null;
  envio_numero: number | null;
  estado: 'PENDIENTE' | 'IMPRESO';
  dia_operativo: string;
  intentos: number;
  creado_en: Date;
  impreso_en: Date | null;
  reimpresion_de_id: string | null;
  ultimo_error: string | null;
  error_render: string | null;
}

const MAXIMO_LISTA = 200;

/**
 * Los trabajos de impresión (historia 004, 3b, criterios 113 a 118, 127 y 128; ruta crítica P5 y P6).
 *
 * - **Del puente:** `entregar` da hasta `MAXIMO_TRABAJOS_POR_IMPRESORA` (20) `PENDIENTE` de cada impresora de su
 *   sucursal, en orden de creación dentro de cada una, con los bytes armados en ese momento con la configuración
 *   vigente de la impresora; `resultado` los cierra o suma un intento. El reparto es por impresora para que los
 *   trabajos atascados de una (apagada, sin papel) no dejen sin entrega a las demás. No se entregan los de
 *   impresoras inactivas ni Bluetooth (en 3b no se imprime por ahí, decisión 12) ni los que no se pudieron armar
 *   (`error_render`: no ocupan lugar y la lista de la PWA los muestra con su error). Todo se limita a la sucursal del puente: un trabajo de otra sucursal o de otra empresa es 404, igual
 *   que uno inexistente.
 * - **Vencimiento (117):** un `PENDIENTE` cuyo día operativo ya pasó (hora de corte de la sucursal, reloj de la API)
 *   es `VENCIDO`: no se entrega y no se acepta su resultado (409). Se calcula al leer, sin tareas programadas.
 * - **De la PWA:** la página de prueba, la lista de la sucursal activa y la reimpresión.
 */
@Injectable()
export class TrabajosService {
  private readonly logger = new Logger(TrabajosService.name);

  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(ColaImpresionService) private readonly cola: ColaImpresionService,
    @Inject(OrdenesVigentes) private readonly ordenes: OrdenesVigentes,
  ) {}

  // ---- El puente ----------------------------------------------------------------------------------

  /** `GET /puente/trabajos` (criterio 113). */
  async entregar(puente: PuenteAutenticado): Promise<TrabajoParaImprimir[]> {
    const ahora = this.reloj.ahora();
    const hoy = await this.cola.diaOperativoDe(puente.sucursalId, ahora);
    const filas = await this.conexion.query<FilaEntrega>(
      `SELECT id, impresora_id, tipo, creado_en, documento, ancho_mm, juego_caracteres
         FROM (SELECT t.id, t.impresora_id, t.tipo, t.creado_en, t.documento, i.ancho_mm, i.juego_caracteres,
                      row_number() OVER (PARTITION BY t.impresora_id ORDER BY t.creado_en, t.id) AS posicion
                 FROM trabajo_impresion t
                 JOIN impresora i ON i.id = t.impresora_id AND i.empresa_id = t.empresa_id
                WHERE t.sucursal_id = $1 AND t.estado = 'PENDIENTE' AND t.dia_operativo >= $2::date
                  AND t.error_render IS NULL AND i.activa AND i.conexion_tipo = 'RED') x
        WHERE posicion <= $3
        ORDER BY creado_en, id`,
      {
        bind: [puente.sucursalId, hoy, MAXIMO_TRABAJOS_POR_IMPRESORA],
        type: QueryTypes.SELECT,
      },
    );
    const entregados: TrabajoParaImprimir[] = [];
    const sinTicket: Array<{ id: string; error: string }> = [];
    for (const fila of filas) {
      const creado = new Date(fila.creado_en);
      try {
        // El documento guardado queda intacto: la marca de retraso se agrega solo a lo que se manda (criterio 118).
        const documento =
          ahora.getTime() - creado.getTime() > MS_RETRASO
            ? conMarcas(fila.documento, { retraso: { horaEnvio: horaLocal(creado) } })
            : fila.documento;
        const bytes = renderizarTicket(documento, {
          anchoMm: fila.ancho_mm,
          juegoCaracteres: fila.juego_caracteres,
        });
        entregados.push({
          id: fila.id,
          impresoraId: fila.impresora_id,
          tipo: fila.tipo,
          creadoEn: creado.toISOString(),
          bytes: Buffer.from(bytes).toString('base64'),
        });
      } catch (error) {
        // Un documento que no se puede armar no debe frenar los demás trabajos de la cola ni quedarse en ella:
        // se marca con su error (se ve en "Trabajos de hoy") y no se vuelve a entregar.
        const motivo = recortarError(
          error instanceof Error ? error.message : `No se pudo armar el ticket: ${String(error)}`,
        );
        this.logger.error(
          `No se pudo armar el ticket del trabajo ${fila.id}`,
          error instanceof Error ? error.stack : String(error),
        );
        sinTicket.push({ id: fila.id, error: motivo });
      }
    }
    for (const { id, error } of sinTicket) {
      await this.conexion.query(
        `UPDATE trabajo_impresion SET error_render = $2, actualizado_en = $3
          WHERE id = $1 AND error_render IS NULL`,
        { bind: [id, error, ahora], type: QueryTypes.UPDATE },
      );
    }
    if (entregados.length > 0) {
      await this.conexion.query(
        `UPDATE trabajo_impresion SET entregado_en = $2, actualizado_en = $2
          WHERE id = ANY($1::uuid[]) AND entregado_en IS NULL`,
        { bind: [entregados.map((e) => e.id), ahora], type: QueryTypes.UPDATE },
      );
    }
    return entregados;
  }

  /** `POST /puente/trabajos/:id/resultado` (criterio 115). */
  async resultado(
    puente: PuenteAutenticado,
    id: string,
    entrada: ResultadoTrabajoEntrada,
  ): Promise<void> {
    const ahora = this.reloj.ahora();
    const filas = await this.conexion.query<{
      estado: 'PENDIENTE' | 'IMPRESO';
      dia_operativo: string;
    }>(
      `SELECT estado, dia_operativo::text AS dia_operativo FROM trabajo_impresion
        WHERE id = $1 AND sucursal_id = $2 FOR UPDATE`,
      { bind: [id, puente.sucursalId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) throw noEncontrado('El trabajo');
    if (entrada.resultado === 'IMPRESO') {
      if (fila.estado === 'IMPRESO') return;
    }
    const hoy = await this.cola.diaOperativoDe(puente.sucursalId, ahora);
    if (fila.estado === 'PENDIENTE' && fila.dia_operativo < hoy) {
      throw new ErrorAplicacion(
        409,
        'TRANSICION_INVALIDA',
        'El trabajo venció: ya pasó el día operativo en que se creó',
      );
    }
    if (entrada.resultado === 'IMPRESO') {
      await this.conexion.query(
        `UPDATE trabajo_impresion SET estado = 'IMPRESO', impreso_en = $2, actualizado_en = $2 WHERE id = $1`,
        { bind: [id, ahora], type: QueryTypes.UPDATE },
      );
      return;
    }
    // Un trabajo ya impreso no vuelve a pendiente por un reporte tardío de fallo.
    if (fila.estado === 'IMPRESO') return;
    await this.conexion.query(
      `UPDATE trabajo_impresion
          SET intentos = intentos + 1, ultimo_error = $2, actualizado_en = $3
        WHERE id = $1`,
      { bind: [id, entrada.error, ahora], type: QueryTypes.UPDATE },
    );
  }

  // ---- La PWA -------------------------------------------------------------------------------------

  /** `POST /sucursales/:sucursalId/impresoras/:id/prueba` (criterio 127): funciona con la impresora inactiva. */
  async paginaDePrueba(sucursalId: string, impresoraId: string): Promise<{ trabajoId: string }> {
    if (!(await this.sucursales.existen([sucursalId]))) throw noEncontrado('La sucursal');
    const filas = await this.conexion.query<FilaImpresora>(
      `SELECT id, nombre, ancho_mm, juego_caracteres FROM impresora WHERE id = $1 AND sucursal_id = $2`,
      { bind: [impresoraId, sucursalId], type: QueryTypes.SELECT },
    );
    const impresora = filas[0];
    if (impresora === undefined) throw noEncontrado('La impresora');
    const [trabajoId] = await this.cola.encolar([
      {
        sucursalId,
        impresoraId,
        estacionId: null,
        tipo: 'PRUEBA',
        comandaId: null,
        precuentaId: null,
        mesa: null,
        ordenId: null,
        envioNumero: null,
        documento: documentoDePrueba({
          nombre: impresora.nombre,
          anchoMm: impresora.ancho_mm,
          juegoCaracteres: impresora.juego_caracteres,
        }),
      },
    ]);
    return { trabajoId: trabajoId! };
  }

  /**
   * `GET /impresion/trabajos` (criterio 128): los de la sucursal activa, en su día operativo (o desde `desde`),
   * los más nuevos primero, hasta `MAXIMO_LISTA`. `estado` y `ordenId` se aplican en la consulta, antes del límite:
   * pedir los `IMPRESO` o los de una cuenta nunca queda corto porque haya 200 trabajos más nuevos de otro estado u
   * otra cuenta. `ordenId` es la cuenta que ve el mozo: la orden y las que se le unieron.
   */
  async listar(consulta: TrabajosConsulta): Promise<TrabajoResumen[]> {
    const sucursalId = this.sesion.sucursalActiva();
    const ahora = this.reloj.ahora();
    const hoy = await this.cola.diaOperativoDe(sucursalId, ahora);
    const desde = consulta.desde === undefined ? null : new Date(consulta.desde);
    const ordenes =
      consulta.ordenId === undefined ? null : await this.ordenes.delaCuenta(consulta.ordenId);
    const filas = await this.conexion.query<FilaResumen>(
      `SELECT t.id, t.tipo, t.impresora_id, i.nombre AS impresora_nombre, t.mesa, t.orden_id,
              t.envio_numero, t.estado,
              t.dia_operativo::text AS dia_operativo, t.intentos, t.creado_en, t.impreso_en,
              t.reimpresion_de_id, t.ultimo_error, t.error_render
         FROM trabajo_impresion t
         JOIN impresora i ON i.id = t.impresora_id AND i.empresa_id = t.empresa_id
        WHERE t.sucursal_id = $1
          AND (($2::timestamptz IS NULL AND t.dia_operativo = $3::date)
               OR ($2::timestamptz IS NOT NULL AND t.creado_en >= $2::timestamptz))
          AND ($4::text IS NULL
               OR ($4 = 'IMPRESO' AND t.estado = 'IMPRESO')
               OR ($4 = 'PENDIENTE' AND t.estado = 'PENDIENTE' AND t.dia_operativo >= $3::date)
               OR ($4 = 'VENCIDO' AND t.estado = 'PENDIENTE' AND t.dia_operativo < $3::date))
          AND ($5::uuid[] IS NULL OR t.orden_id = ANY($5::uuid[]))
        ORDER BY t.creado_en DESC, t.id DESC
        LIMIT ${MAXIMO_LISTA}`,
      { bind: [sucursalId, desde, hoy, consulta.estado ?? null, ordenes], type: QueryTypes.SELECT },
    );
    // La cuenta que ve el mozo: la orden principal si la de origen se unió a otra (criterio 128).
    const principales = await this.ordenes.resolver(
      filas.flatMap((f) => (f.orden_id === null ? [] : [f.orden_id])),
    );
    return filas.map((f): TrabajoResumen => {
      const vencido = f.estado === 'PENDIENTE' && f.dia_operativo < hoy;
      return {
        id: f.id,
        tipo: f.tipo,
        impresora: { id: f.impresora_id, nombre: f.impresora_nombre },
        mesa: f.mesa,
        estado: vencido ? 'VENCIDO' : f.estado,
        intentos: f.intentos,
        creadoEn: new Date(f.creado_en).toISOString(),
        impresoEn: f.impreso_en === null ? null : new Date(f.impreso_en).toISOString(),
        reimpresionDe: f.reimpresion_de_id,
        ordenId: f.orden_id === null ? null : (principales.get(f.orden_id) ?? f.orden_id),
        envioNumero: f.envio_numero,
        ultimoError: f.estado === 'IMPRESO' ? null : (f.error_render ?? f.ultimo_error),
        sinTicket: f.error_render !== null,
      };
    });
  }

  /** `POST /impresion/trabajos/:id/reimpresion` (criterio 128). */
  async reimprimir(id: string): Promise<{ trabajoId: string }> {
    const sucursalId = this.sesion.sucursalActiva();
    const ahora = this.reloj.ahora();
    const filas = await this.conexion.query<{
      impresora_id: string;
      estacion_id: string | null;
      tipo: TipoTrabajo;
      documento: DocumentoTicket;
      comanda_id: string | null;
      precuenta_id: string | null;
      mesa: string | null;
      orden_id: string | null;
      envio_numero: number | null;
      impresora_activa: boolean;
    }>(
      `SELECT t.impresora_id, t.estacion_id, t.tipo, t.documento, t.comanda_id, t.precuenta_id, t.mesa,
              t.orden_id, t.envio_numero, i.activa AS impresora_activa
         FROM trabajo_impresion t
         JOIN impresora i ON i.id = t.impresora_id AND i.empresa_id = t.empresa_id
        WHERE t.id = $1 AND t.sucursal_id = $2`,
      { bind: [id, sucursalId], type: QueryTypes.SELECT },
    );
    const original = filas[0];
    if (original === undefined) throw noEncontrado('El trabajo');

    let impresoraId: string | null = original.impresora_activa ? original.impresora_id : null;
    if (impresoraId === null) impresoraId = await this.impresoraActual(sucursalId, original);
    if (impresoraId === null) throw sinImpresora();

    const nuevoId = randomUUID();
    const documento = conMarcas(original.documento, { reimpresion: true });
    await this.cola.insertar(
      this.contexto.empresaActual(),
      [
        {
          id: nuevoId,
          sucursal_id: sucursalId,
          impresora_id: impresoraId,
          estacion_id: original.estacion_id,
          tipo: original.tipo,
          documento,
          comanda_id: original.comanda_id,
          precuenta_id: original.precuenta_id,
          mesa: original.mesa,
          orden_id: original.orden_id,
          envio_numero: original.envio_numero,
          dia_operativo: await this.cola.diaOperativoDe(sucursalId, ahora),
          reimpresion_de_id: id,
          error_render: this.cola.errorDelDocumento(documento, original.tipo),
        },
      ],
      ahora,
    );
    await this.cola.avisarTrabajos(sucursalId, [nuevoId]);
    return { trabajoId: nuevoId };
  }

  /** La impresora actual de la estación del trabajo (o la de caja, en una pre-cuenta), si la original está inactiva. */
  private async impresoraActual(
    sucursalId: string,
    original: { estacion_id: string | null; tipo: TipoTrabajo },
  ): Promise<string | null> {
    if (original.tipo === 'PRECUENTA')
      return (await this.cola.impresoraDeCaja(sucursalId))?.id ?? null;
    if (original.estacion_id === null) return null;
    const filas = await this.conexion.query<{ impresora_id: string }>(
      `SELECT d.impresora_id FROM estacion_destino d
         JOIN impresora i ON i.id = d.impresora_id AND i.empresa_id = d.empresa_id
        WHERE d.sucursal_id = $1 AND d.estacion_id = $2 AND d.destino = 'IMPRESORA' AND i.activa`,
      { bind: [sucursalId, original.estacion_id], type: QueryTypes.SELECT },
    );
    return filas[0]?.impresora_id ?? null;
  }
}
