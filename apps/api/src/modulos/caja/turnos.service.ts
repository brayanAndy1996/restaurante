import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AbrirTurnoEntrada,
  CierreEntradaValidada,
  ImpresionDeCajaRespuesta,
  MovimientoEntrada,
  MovimientoRespuesta,
  ReporteCaja,
  TurnoRespuesta,
} from '@restaurante/contratos';
import {
  MEDIOS_PAGO,
  diaOperativo,
  diferenciasDelArqueo,
  type TipoMovimientoCaja,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { noImplementado } from '../../nucleo/errores';
import { jsonCanonico } from '../../nucleo/idempotencia';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { PedidosConsultaService } from '../pedidos';
import { SucursalesConsultaService, SuscripcionService } from '../plataforma';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import {
  cajaInactiva,
  cierreBloqueado,
  idDeClienteReutilizado,
  noEncontrado,
  turnoAjeno,
  turnoCerrado,
  turnoDeOtro,
  turnoSoloDePersonas,
  turnoYaAbierto,
} from './errores-caja';
import { EventosCaja } from './eventos-caja';
import {
  SQL_TURNO,
  buscarTurno,
  conDosDecimales,
  turnoARespuesta,
  type FilaTurno,
} from './lectura-turno';
import { ReportesCaja } from './reportes-caja';

const sha256 = (texto: string): Buffer => createHash('sha256').update(texto, 'utf8').digest();

/** Índices únicos parciales de `turno` (migración `202611040002-caja`): la red de la regla "uno por caja y por persona". */
const INDICE_POR_CAJA = 'turno_abierto_por_caja';
const INDICE_POR_RESPONSABLE = 'turno_abierto_por_responsable';

interface FilaMovimiento {
  id: string;
  turno_id: string;
  tipo: TipoMovimientoCaja;
  monto: string;
  motivo: string;
  creado_en: Date;
  creado_por_usuario_id: string | null;
}

/**
 * Turnos de caja (historia 006, criterios 24 a 35; ruta crítica P3): dueño de `turno`, `turno_conteo` y
 * `movimiento_caja`. Apertura con fondo (tras la comprobación de la suscripción de la sucursal, criterio 25), uno por
 * caja y uno por persona, ingresos y egresos, reporte X, cierre con Z (arqueo a ciegas, motivo de cada diferencia y
 * bloqueo del último turno con mesas abiertas).
 *
 * Todo corre en la transacción de la petición. Las réplicas por `id` de cliente se reconocen antes de mirar el estado
 * del turno y no dejan efectos. Las escrituras que comparten un `id` o una persona se turnan con cerrojos consultivos
 * de la transacción, así la réplica concurrente ve lo ya confirmado y no choca con la clave primaria.
 */
@Injectable()
export class TurnosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(PedidosConsultaService) private readonly pedidos: PedidosConsultaService,
    @Inject(ReportesCaja) private readonly reportes: ReportesCaja,
    @Inject(EventosCaja) private readonly eventos: EventosCaja,
  ) {}

  /**
   * Criterios 24 a 26. Orden: réplica por `id` (201 con el turno tal como está, sin efectos), suscripción (403
   * `SUCURSAL_SUSPENDIDA`), caja (404 o 409 `CONFLICTO` si está inactiva), sesión de soporte (422), 409
   * `TURNO_YA_ABIERTO` (en la caja o de la misma persona) y la inserción.
   */
  async abrir(entrada: AbrirTurnoEntrada): Promise<TurnoRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const id = entrada.id.toLowerCase();
    const cajaId = entrada.cajaId.toLowerCase();
    const fondo = conDosDecimales(entrada.fondo);
    const huella = sha256(jsonCanonico({ cajaId, fondo }));
    await this.turnarPor(`turno-id:${id}`);

    const existente = await buscarTurno(this.conexion, id);
    if (existente !== undefined) {
      const guardada = await this.huellaDelTurno(id);
      if (existente.sucursal_id !== sucursalId || !guardada.equals(huella)) {
        throw idDeClienteReutilizado();
      }
      return turnoARespuesta(this.usuarios, existente);
    }

    await this.suscripciones.exigirAperturaDeCaja(sucursalId);
    const cajas = await this.conexion.query<{ id: string; activa: boolean }>(
      `SELECT id, activa FROM caja WHERE id = $1 AND sucursal_id = $2 FOR NO KEY UPDATE`,
      { bind: [cajaId, sucursalId], type: QueryTypes.SELECT },
    );
    const caja = cajas[0];
    if (caja === undefined) throw noEncontrado('La caja');
    if (!caja.activa) throw cajaInactiva();
    const responsableId = this.sesion.principal().usuarioId;
    if (responsableId === null) throw turnoSoloDePersonas();

    await this.turnarPor(`turno-persona:${sucursalId}:${responsableId}`);
    const enLaCaja = await this.turnoAbiertoDe('caja_id', cajaId);
    if (enLaCaja !== undefined) {
      throw turnoYaAbierto(enLaCaja, 'La caja ya tiene un turno abierto');
    }
    const delaPersona = await this.turnoAbiertoDe('responsable_id', responsableId, sucursalId);
    if (delaPersona !== undefined) {
      throw turnoYaAbierto(delaPersona, 'Ya tienes un turno abierto en esta sucursal');
    }

    const ahora = this.reloj.ahora();
    const horaCorte = await this.sucursales.horaCorte(sucursalId);
    try {
      await this.conexion.query(
        `INSERT INTO turno (id, empresa_id, caja_id, sucursal_id, responsable_id, estado, abierto_en, dia_operativo,
                            fondo, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, 'ABIERTO', $6, $7::date, $8::numeric, $9, $6, $6)`,
        {
          bind: [
            id,
            this.contexto.empresaActual(),
            cajaId,
            sucursalId,
            responsableId,
            ahora,
            diaOperativo(ahora, horaCorte ?? '00:00'),
            fondo,
            huella,
          ],
          type: QueryTypes.INSERT,
        },
      );
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
        const indice = restriccionDe(error);
        if (indice === INDICE_POR_CAJA || indice === INDICE_POR_RESPONSABLE) {
          throw turnoYaAbierto(null, 'Ya hay un turno abierto en esta caja o a tu nombre');
        }
      }
      throw error;
    }
    this.eventos.turnoCambio(sucursalId, id, cajaId);
    return this.respuestaDe(id);
  }

  /** El turno `ABIERTO` de la persona en la sucursal activa; 404 si no tiene. */
  async mio(): Promise<TurnoRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const usuarioId = this.sesion.principal().usuarioId;
    if (usuarioId === null) throw noEncontrado('El turno');
    const filas = await this.conexion.query<FilaTurno>(
      `${SQL_TURNO} WHERE t.sucursal_id = $1 AND t.responsable_id = $2 AND t.estado = 'ABIERTO'`,
      { bind: [sucursalId, usuarioId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw noEncontrado('El turno');
    return turnoARespuesta(this.usuarios, filas[0]);
  }

  /** Criterio 27 con el alcance del criterio 100: un Cajero solo ve sus turnos (403). */
  async consultar(turnoId: string): Promise<TurnoRespuesta> {
    const fila = await this.turnoVisible(turnoId);
    return turnoARespuesta(this.usuarios, fila);
  }

  /**
   * Criterio 28. Orden: 404 del turno, réplica por `id` (201 con el guardado, aunque el turno ya esté cerrado), 409
   * `TURNO_AJENO`, 409 `TURNO_CERRADO`. El turno se toma con `FOR SHARE`: varios movimientos y cobros de un turno
   * corren a la vez y todos esperan al cierre, que lo toma con `FOR UPDATE`.
   */
  async registrarMovimiento(
    turnoId: string,
    entrada: MovimientoEntrada,
  ): Promise<MovimientoRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const id = entrada.id.toLowerCase();
    const monto = conDosDecimales(entrada.monto);
    const previo = await this.turnoDeLaSucursal(turnoId, sucursalId);
    await this.turnarPor(`movimiento-id:${id}`);

    const existentes = await this.conexion.query<FilaMovimiento>(
      `SELECT id, turno_id, tipo, monto::text AS monto, motivo, creado_en, creado_por_usuario_id
         FROM movimiento_caja WHERE id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    const existente = existentes[0];
    if (existente !== undefined) {
      if (
        existente.turno_id !== previo.id ||
        existente.tipo !== entrada.tipo ||
        existente.monto !== monto
      ) {
        throw idDeClienteReutilizado();
      }
      return this.movimientoARespuesta(existente);
    }

    const bloqueados = await this.conexion.query<FilaTurno>(
      `${SQL_TURNO} WHERE t.id = $1 FOR SHARE OF t`,
      {
        bind: [previo.id],
        type: QueryTypes.SELECT,
      },
    );
    const turno = bloqueados[0] ?? previo;
    this.exigirResponsableOSupervisor(turno);
    if (turno.estado !== 'ABIERTO') throw turnoCerrado();

    const filas = await this.conexion.query<FilaMovimiento>(
      `INSERT INTO movimiento_caja (id, empresa_id, turno_id, tipo, medio, monto, motivo, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, 'EFECTIVO', $5::numeric, $6, $7, $7)
       RETURNING id, turno_id, tipo, monto::text AS monto, motivo, creado_en, creado_por_usuario_id`,
      {
        bind: [
          id,
          this.contexto.empresaActual(),
          turno.id,
          entrada.tipo,
          monto,
          entrada.motivo,
          this.reloj.ahora(),
        ],
        type: QueryTypes.SELECT,
      },
    );
    this.eventos.turnoCambio(sucursalId, turno.id, turno.caja_id);
    return this.movimientoARespuesta(filas[0]!);
  }

  /** El reporte X de un turno abierto, o el Z de uno cerrado (criterio 29), con el alcance del criterio 100. */
  async reporte(turnoId: string): Promise<ReporteCaja> {
    const turno = await this.turnoVisible(turnoId);
    return this.reportes.armar(turno.id);
  }

  /** Encola un trabajo `REPORTE_X` en la impresora de la caja (tarea T21). */
  async imprimirReporteX(_turnoId: string): Promise<ImpresionDeCajaRespuesta> {
    throw noImplementado();
  }

  /**
   * Criterios 31 a 35. Orden: 404, 409 `TURNO_AJENO`, 409 `TURNO_CERRADO`, 422 de soporte; después los cerrojos (todos
   * los turnos abiertos de la sucursal con `FOR UPDATE`, en orden de id, así dos cierres simultáneos se turnan y el
   * segundo ve que ya no queda otro), 409 `CIERRE_BLOQUEADO` si es el último y hay órdenes abiertas, y 422
   * `DIFERENCIA_SIN_MOTIVO`. El esperado se calcula con el turno bloqueado y nunca se devuelve antes del cierre.
   */
  async cerrar(turnoId: string, entrada: CierreEntradaValidada): Promise<ReporteCaja> {
    const sucursalId = this.sesion.sucursalActiva();
    const previo = await this.turnoDeLaSucursal(turnoId, sucursalId);
    this.exigirResponsableOSupervisor(previo);
    if (previo.estado !== 'ABIERTO') throw turnoCerrado();
    const cerradorId = this.sesion.principal().usuarioId;
    if (cerradorId === null) throw turnoSoloDePersonas();

    const abiertos = await this.conexion.query<{ id: string; caja_id: string; estado: string }>(
      `SELECT id, caja_id, estado FROM turno WHERE sucursal_id = $1 AND estado = 'ABIERTO'
        ORDER BY id FOR UPDATE`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const propio = abiertos.find((t) => t.id === previo.id);
    if (propio === undefined) throw turnoCerrado();
    if (abiertos.length === 1 && (await this.pedidos.hayOrdenesAbiertas(sucursalId))) {
      throw cierreBloqueado((await this.pedidos.ordenesAbiertas(sucursalId)).length);
    }

    const x = await this.reportes.armar(previo.id);
    const contado = new Map(
      entrada.conteo.map((fila, indice) => [
        fila.medio,
        { ...fila, indice, contado: conDosDecimales(fila.contado) },
      ]),
    );
    const diferencias = diferenciasDelArqueo(
      x.esperado,
      MEDIOS_PAGO.map((medio) => ({ medio, monto: contado.get(medio)!.contado })),
    );
    const faltan = diferencias.filter(
      (d) => d.diferencia !== '0.00' && contado.get(d.medio)!.motivo === undefined,
    );
    if (faltan.length > 0) {
      throw new ErrorAplicacion(
        422,
        'DIFERENCIA_SIN_MOTIVO',
        'Escribe el motivo de cada diferencia que hay con lo contado',
        faltan.map((d) => ({
          campo: `conteo.${contado.get(d.medio)!.indice}.motivo`,
          mensaje: 'Indica por qué hay diferencia',
        })),
        undefined,
        {
          diferencias: diferencias.map((d) => ({
            medio: d.medio,
            contado: d.contado,
            diferencia: d.diferencia,
          })),
        },
      );
    }

    const ahora = this.reloj.ahora();
    const guardados = diferencias.map((d) => ({
      medio: d.medio,
      esperado: d.esperado,
      contado: d.contado,
      diferencia: d.diferencia,
      motivo: d.diferencia === '0.00' ? null : (contado.get(d.medio)!.motivo ?? null),
    }));
    for (const g of guardados) {
      await this.conexion.query(
        `INSERT INTO turno_conteo (empresa_id, turno_id, medio, esperado, contado, diferencia, motivo, creado_en,
                                   actualizado_en)
         VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7, $8, $8)`,
        {
          bind: [
            this.contexto.empresaActual(),
            previo.id,
            g.medio,
            g.esperado,
            g.contado,
            g.diferencia,
            g.motivo,
            ahora,
          ],
          type: QueryTypes.INSERT,
        },
      );
    }
    await this.conexion.query(
      `UPDATE turno SET estado = 'CERRADO', cerrado_en = $2, cerrado_por_id = $3, actualizado_en = $2 WHERE id = $1`,
      { bind: [previo.id, ahora, cerradorId], type: QueryTypes.UPDATE },
    );
    await this.auditoria.registrar({
      accion: 'cerrar_turno',
      sucursalId,
      entidad: 'turno',
      entidadId: previo.id,
      detalle: { turnoId: previo.id, cajaId: previo.caja_id, conteo: guardados },
    });
    this.eventos.turnoCambio(sucursalId, previo.id, previo.caja_id);
    return this.reportes.armar(previo.id);
  }

  // ---- Ayudas ---------------------------------------------------------------------------------

  /** El turno de la sucursal activa, o 404 (uno de otra sucursal, de otra empresa o inexistente es igual). */
  private async turnoDeLaSucursal(turnoId: string, sucursalId: string): Promise<FilaTurno> {
    const fila = await buscarTurno(this.conexion, turnoId.toLowerCase());
    if (fila === undefined || fila.sucursal_id !== sucursalId) throw noEncontrado('El turno');
    return fila;
  }

  /** Como `turnoDeLaSucursal`, y un Cajero solo ve los suyos (403, criterio 100). */
  private async turnoVisible(turnoId: string): Promise<FilaTurno> {
    const fila = await this.turnoDeLaSucursal(turnoId, this.sesion.sucursalActiva());
    if (!this.veTodos() && fila.responsable_id !== this.sesion.principal().usuarioId) {
      throw turnoDeOtro();
    }
    return fila;
  }

  /** El Supervisor y el Administrador (también en soporte) operan cualquier turno de la sucursal activa. */
  private veTodos(): boolean {
    const principal = this.sesion.principal();
    return (
      principal.esAdministrador ||
      principal.rol === 'SUPERVISOR' ||
      principal.rol === 'ADMINISTRADOR'
    );
  }

  /** 409 `TURNO_AJENO` salvo el responsable, un Supervisor o el Administrador (criterios 28 y 35). */
  private exigirResponsableOSupervisor(turno: FilaTurno): void {
    if (this.veTodos() || turno.responsable_id === this.sesion.principal().usuarioId) return;
    throw turnoAjeno();
  }

  private async turnoAbiertoDe(
    columna: 'caja_id' | 'responsable_id',
    valor: string,
    sucursalId?: string,
  ): Promise<string | undefined> {
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT id FROM turno WHERE ${columna} = $1 AND estado = 'ABIERTO'
          ${sucursalId === undefined ? '' : 'AND sucursal_id = $2'}`,
      {
        bind: sucursalId === undefined ? [valor] : [valor, sucursalId],
        type: QueryTypes.SELECT,
      },
    );
    return filas[0]?.id;
  }

  private async huellaDelTurno(id: string): Promise<Buffer> {
    const filas = await this.conexion.query<{ huella_entrada: Buffer }>(
      'SELECT huella_entrada FROM turno WHERE id = $1',
      { bind: [id], type: QueryTypes.SELECT },
    );
    return filas[0]!.huella_entrada;
  }

  private async respuestaDe(turnoId: string): Promise<TurnoRespuesta> {
    const fila = await buscarTurno(this.conexion, turnoId);
    if (fila === undefined) throw noEncontrado('El turno');
    return turnoARespuesta(this.usuarios, fila);
  }

  private async movimientoARespuesta(fila: FilaMovimiento): Promise<MovimientoRespuesta> {
    const nombres = await this.usuarios.nombres(
      fila.creado_por_usuario_id === null ? [] : [fila.creado_por_usuario_id],
    );
    return {
      id: fila.id,
      tipo: fila.tipo,
      monto: fila.monto,
      motivo: fila.motivo,
      creadoEn: fila.creado_en.toISOString(),
      creadoPor:
        fila.creado_por_usuario_id === null
          ? null
          : {
              id: fila.creado_por_usuario_id,
              nombre: nombres.get(fila.creado_por_usuario_id) ?? '',
            },
    };
  }

  /** Cerrojo de la transacción por una clave de texto: las peticiones con la misma clave se turnan. */
  private async turnarPor(clave: string): Promise<void> {
    await this.conexion.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', {
      bind: [clave],
      type: QueryTypes.SELECT,
    });
  }
}
