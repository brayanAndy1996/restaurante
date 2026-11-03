import { Inject, Injectable } from '@nestjs/common';
import type {
  AtencionEntrada,
  AtencionRespuesta,
  DescarteEntrada,
  LlamadoDetalle,
} from '@restaurante/contratos';
import { estadoVigenteLlamado, siguienteEstadoLlamado } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AperturaDeMesasService, PedidosConsultaService } from '../pedidos';
import { MesasConsultaService } from '../salon';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import {
  llamadoCerrado,
  llamadoNoEncontrado,
  llamadoTomado,
  llamadoVencido,
  mesaDelLlamadoInactiva,
  mesaLibre,
  soporteNoAbreMesas,
} from './errores-llamados';
import { EventosLlamados } from './eventos-llamados';
import { guardarVencido, leerLlamado, type FilaLlamado } from './filas-llamado';
import { PresentacionLlamados } from './presentacion-llamados';

/**
 * Atender y descartar un llamado (historia 005, criterios 41 a 45, 53 y 54; ruta crítica P2). Toda escritura empieza
 * bloqueando la fila del llamado (`FOR UPDATE`): dos acciones simultáneas se turnan y la segunda ve el estado
 * nuevo. Corre en la transacción de la petición con la sucursal activa de la sesión: un llamado de otra sucursal, de
 * otra empresa o inexistente es el mismo 404. El orden de los bloqueos es siempre el llamado y después la mesa (la
 * creación bloquea `mesa_qr`, no `mesa`, así que no hay ciclo). Nada de esto toca los envíos: atender puede abrir la
 * mesa (con `AperturaDeMesasService`) pero no manda nada a cocina.
 */
@Injectable()
export class AtencionLlamadosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PedidosConsultaService) private readonly pedidos: PedidosConsultaService,
    @Inject(AperturaDeMesasService) private readonly apertura: AperturaDeMesasService,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(PresentacionLlamados) private readonly presentacion: PresentacionLlamados,
    @Inject(EventosLlamados) private readonly eventos: EventosLlamados,
  ) {}

  /**
   * `POST /llamados/:id/atencion`. Orden: 404; el estado (vencido 409 `LLAMADO_VENCIDO` y se guarda `VENCIDO`;
   * pasado o descartado 409 `LLAMADO_CERRADO`; ya atendido, 200 si es la misma persona o 409 `LLAMADO_TOMADO` si es
   * otra); la mesa (inactiva, 409 `CONFLICTO`); la cuenta de la mesa (con orden abierta se usa, se ignoren `ordenId` y
   * `comensales`; libre y `PEDIR_CUENTA`, no se abre; libre y otro tipo, se abre con `ordenId` y `comensales`, o 409
   * `MESA_LIBRE` si faltan, o 422 `REFERENCIA_INVALIDA` si la sesión es de soporte). Si otra persona abre la mesa
   * mientras tanto (`MESA_OCUPADA`), se usa esa orden.
   */
  async atender(llamadoId: string, entrada: AtencionEntrada): Promise<AtencionRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const principal = this.sesion.principal();
    const ahora = this.reloj.ahora();
    const fila = await leerLlamado(this.conexion, llamadoId, sucursalId, true);
    if (fila === undefined) throw llamadoNoEncontrado();

    const estado = await this.estadoParaAtender(fila, ahora);
    if (estado === 'ATENDIDO') {
      // Réplica natural: la misma persona otra vez recibe el estado actual, sin efectos; otra, `LLAMADO_TOMADO`.
      if (fila.atendido_por_usuario_id !== principal.usuarioId) {
        throw llamadoTomado(await this.persona(fila.atendido_por_usuario_id));
      }
      return {
        llamado: await this.presentacion.detalle(fila, ahora),
        ordenId: fila.orden_id,
        mesaAbierta: false,
      };
    }

    const [mesa] = await this.mesas.bloquear([fila.mesa_id], sucursalId);
    if (mesa === undefined || !mesa.activa) throw mesaDelLlamadoInactiva();

    const vigentes = await this.pedidos.ordenesVigentesDeMesas([fila.mesa_id]);
    let ordenId: string | null = vigentes.get(fila.mesa_id)?.ordenId ?? null;
    let mesaAbierta = false;
    if (ordenId === null && fila.tipo !== 'PEDIR_CUENTA') {
      if (principal.usuarioId === null) throw soporteNoAbreMesas();
      if (entrada.ordenId === undefined || entrada.comensales === undefined) throw mesaLibre();
      try {
        const orden = await this.apertura.abrir({
          id: entrada.ordenId,
          mesaId: fila.mesa_id,
          comensales: entrada.comensales,
          mozoId: principal.usuarioId,
        });
        ordenId = orden.id;
        mesaAbierta = true;
      } catch (error) {
        // Otra persona abrió la mesa mientras se esperaba su bloqueo: se usa esa orden (criterio 42).
        const ocupante = ordenDeMesaOcupada(error);
        if (ocupante === undefined) throw error;
        ordenId = ocupante;
      }
    }

    await this.conexion.query(
      `UPDATE llamado
          SET estado = 'ATENDIDO', atendido_por_usuario_id = $2, atendido_por_equipo_id = $3, atendido_en = $4,
              orden_id = coalesce($5::uuid, orden_id), actualizado_en = $4
        WHERE id = $1`,
      {
        bind: [fila.id, principal.usuarioId, principal.equipoId, ahora, ordenId],
        type: QueryTypes.UPDATE,
      },
    );
    this.eventos.cambio(sucursalId, {
      llamadoId: fila.id,
      mesaId: fila.mesa_id,
      estado: 'ATENDIDO',
    });

    const actual = (await leerLlamado(this.conexion, fila.id, sucursalId, false))!;
    return {
      llamado: await this.presentacion.detalle(actual, ahora),
      ordenId,
      mesaAbierta,
    };
  }

  /**
   * `POST /llamados/:id/descarte`: un `PENDIENTE` vigente de cualquier tipo o un `PEDIDO` `ATENDIDO`. Repetirlo
   * responde 200 sin cambios (y sin cambiar quién lo cerró); sobre uno pasado, 409 `LLAMADO_CERRADO`; sobre uno
   * vencido, 409 `LLAMADO_VENCIDO` (que se guarda `VENCIDO`); sobre un `LLAMAR_MOZO` o `PEDIR_CUENTA` ya atendido (un
   * estado final), 409 `LLAMADO_CERRADO`. No toca la mesa: la mesa que abrió la atención sigue abierta.
   */
  async descartar(llamadoId: string, entrada: DescarteEntrada): Promise<LlamadoDetalle> {
    const sucursalId = this.sesion.sucursalActiva();
    const principal = this.sesion.principal();
    const ahora = this.reloj.ahora();
    const fila = await leerLlamado(this.conexion, llamadoId, sucursalId, true);
    if (fila === undefined) throw llamadoNoEncontrado();

    const estado = this.estadoVigente(fila, ahora);
    if (estado === 'DESCARTADO') return this.presentacion.detalle(fila, ahora);
    if (estado === 'VENCIDO') await this.rechazarVencido(fila, ahora);
    if (siguienteEstadoLlamado(fila.tipo, estado, 'DESCARTAR') === null) {
      throw llamadoCerrado(estado);
    }

    await this.conexion.query(
      `UPDATE llamado
          SET estado = 'DESCARTADO', cerrado_por_usuario_id = $2, cerrado_por_equipo_id = $3, cerrado_en = $4,
              motivo_descarte = $5, actualizado_en = $4
        WHERE id = $1`,
      {
        bind: [fila.id, principal.usuarioId, principal.equipoId, ahora, entrada.motivo ?? null],
        type: QueryTypes.UPDATE,
      },
    );
    this.eventos.cambio(sucursalId, {
      llamadoId: fila.id,
      mesaId: fila.mesa_id,
      estado: 'DESCARTADO',
    });
    const actual = (await leerLlamado(this.conexion, fila.id, sucursalId, false))!;
    return this.presentacion.detalle(actual, ahora);
  }

  /** El estado vigente con el reloj de la API: un `PENDIENTE` cuyo `venceEn` ya pasó es `VENCIDO`. */
  private estadoVigente(fila: FilaLlamado, ahora: Date) {
    return estadoVigenteLlamado({ estado: fila.estado, venceEn: new Date(fila.vence_en) }, ahora);
  }

  /**
   * El estado de un llamado que se quiere atender: lanza `LLAMADO_VENCIDO` (guardándolo `VENCIDO`) o `LLAMADO_CERRADO`
   * si ya no se puede; devuelve `PENDIENTE` o `ATENDIDO`.
   */
  private async estadoParaAtender(
    fila: FilaLlamado,
    ahora: Date,
  ): Promise<'PENDIENTE' | 'ATENDIDO'> {
    const estado = this.estadoVigente(fila, ahora);
    if (estado === 'VENCIDO') await this.rechazarVencido(fila, ahora);
    if (estado === 'PASADO_A_CUENTA' || estado === 'DESCARTADO') throw llamadoCerrado(estado);
    return estado as 'PENDIENTE' | 'ATENDIDO';
  }

  /** Guarda el vencido (si todavía figura `PENDIENTE`) y responde 409 `LLAMADO_VENCIDO` confirmando esa escritura. */
  private async rechazarVencido(fila: FilaLlamado, ahora: Date): Promise<never> {
    if (fila.estado === 'PENDIENTE') await guardarVencido(this.conexion, fila.id, ahora);
    throw llamadoVencido();
  }

  /** Nombre de quien atendió, o `null` si lo atendió una sesión de soporte (sin persona). */
  private async persona(usuarioId: string | null): Promise<{ id: string; nombre: string } | null> {
    if (usuarioId === null) return null;
    const nombres = await this.usuarios.nombres([usuarioId]);
    return { id: usuarioId, nombre: nombres.get(usuarioId) ?? '' };
  }
}

/** La orden que ocupa la mesa, si el error es el `MESA_OCUPADA` de la apertura de 004. */
function ordenDeMesaOcupada(error: unknown): string | undefined {
  return error instanceof ErrorAplicacion && error.codigo === 'MESA_OCUPADA'
    ? error.detalle?.ordenId
    : undefined;
}
