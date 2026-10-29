import { Inject, Injectable } from '@nestjs/common';
import type {
  AbrirOrdenEntrada,
  OrdenModificarEntrada,
  OrdenRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { MesasConsultaService } from '../salon';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import { bloquearOrden, exigirOrdenAbierta } from './bloqueos-orden';
import {
  idDeClienteReutilizado,
  mesaInactiva,
  mesaOcupada,
  mozoInvalido,
  ordenConConsumo,
  ordenNoAbierta,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { VistaOrdenService } from './vista-orden';

interface OrdenExistente {
  id: string;
  sucursalId: string;
}

/**
 * Órdenes de mesa: abrir una mesa (HU-10, criterios 9 a 12), cambiar los comensales (13) y consultar (55). Todo
 * corre en la transacción de la petición, con la empresa y el actor de la sesión. La sucursal es siempre la
 * activa de la sesión: ninguna entrada la acepta (criterio 85).
 */
@Injectable()
export class OrdenesService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
    @Inject(VistaOrdenService) private readonly vista: VistaOrdenService,
  ) {}

  /** La sucursal activa de la sesión; las rutas ya exigen una (`@RequiereModulo`). */
  private sucursalActiva(): string {
    const sucursalId = this.sesion.principal().sucursalId;
    if (sucursalId === null) {
      throw new ErrorAplicacion(409, 'SUCURSAL_NO_ELEGIDA', 'Elige una sucursal para continuar');
    }
    return sucursalId;
  }

  /**
   * Criterios 9 a 12. Orden de las comprobaciones: réplica del mismo `id` (devuelve la orden tal como está, sin
   * efectos), mesa de la sucursal activa (404; inactiva, 409), otra réplica del mismo `id` que ganó mientras se
   * esperaba la mesa, mesa ocupada (409 con la orden), mozo responsable (422) y por último los `INSERT`. El
   * bloqueo de la fila de la mesa serializa las aperturas de la misma mesa; el índice único de `orden_mesa` es la
   * red de seguridad. Los `INSERT` usan `ON CONFLICT DO NOTHING` para no abortar la transacción.
   */
  async abrir(entrada: AbrirOrdenEntrada): Promise<OrdenRespuesta> {
    const sucursalId = this.sucursalActiva();
    const id = entrada.id.toLowerCase();
    const mesaId = entrada.mesaId.toLowerCase();

    const yaExiste = await this.buscarPorId(id);
    if (yaExiste !== undefined) return this.replicaDeApertura(yaExiste, mesaId, sucursalId);

    const [mesa] = await this.mesas.bloquear([mesaId], sucursalId);
    // Si la misma apertura estaba en curso, ya terminó (el bloqueo de la mesa nos hizo esperar).
    const ganada = await this.buscarPorId(id);
    if (ganada !== undefined) return this.replicaDeApertura(ganada, mesaId, sucursalId);
    if (mesa === undefined || !mesa.activa) throw mesaInactiva();

    const ocupante = await this.ordenVigenteDeLaMesa(mesaId);
    if (ocupante !== undefined) throw mesaOcupada(ocupante);

    const mozoId = await this.mozoResponsable(entrada.mozoId, sucursalId);
    const ahora = this.reloj.ahora();
    const empresaId = this.contexto.empresaActual();

    const insertada = await this.conexion.query<{ id: string }>(
      `INSERT INTO orden (id, empresa_id, sucursal_id, tipo, canal, estado, mozo_id, comensales,
                          abierta_en, sin_consumo, version, creado_en, actualizado_en)
       VALUES ($1, $2, $3, 'MESA', 'SALON', 'ABIERTA', $4, $5, $6, false, 1, $6, $6)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      {
        bind: [id, empresaId, sucursalId, mozoId, entrada.comensales, ahora],
        type: QueryTypes.SELECT,
      },
    );
    if (insertada.length === 0) {
      // Otra petición con el mismo `id` confirmó entre la lectura y el INSERT: es una réplica.
      const otra = await this.buscarPorId(id);
      if (otra === undefined) throw idDeClienteReutilizado();
      return this.replicaDeApertura(otra, mesaId, sucursalId);
    }
    const relacion = await this.conexion.query<{ id: string }>(
      `INSERT INTO orden_mesa (empresa_id, orden_id, mesa_id, desde, hasta, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, NULL, $4, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      { bind: [empresaId, id, mesaId, ahora], type: QueryTypes.SELECT },
    );
    if (relacion.length === 0) {
      // No debería pasar (la mesa está bloqueada); si pasa, otra orden la ocupa y esta se revierte entera.
      const otra = await this.ordenVigenteDeLaMesa(mesaId);
      throw otra !== undefined ? mesaOcupada(otra) : idDeClienteReutilizado();
    }

    this.eventos.salonCambio(sucursalId, id, [mesaId]);
    this.eventos.ordenCambio(sucursalId, id);
    return this.vista.armar(id, sucursalId);
  }

  /** Criterio 13: cambia los comensales de una orden abierta; sin cambio, 200 sin evento. */
  async modificarComensales(
    ordenId: string,
    entrada: OrdenModificarEntrada,
  ): Promise<OrdenRespuesta> {
    const sucursalId = this.sucursalActiva();
    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);
    if (orden.estado !== 'ABIERTA' && orden.estado !== 'EN_PRECUENTA') {
      throw ordenNoAbierta(orden.estado === 'UNIDA' ? orden.unidaA : null);
    }
    if (orden.comensales !== entrada.comensales) {
      await this.conexion.query(
        `UPDATE orden SET comensales = $2, actualizado_en = $3 WHERE id = $1`,
        { bind: [orden.id, entrada.comensales, this.reloj.ahora()], type: QueryTypes.UPDATE },
      );
      this.eventos.ordenCambio(sucursalId, orden.id);
    }
    return this.vista.armar(orden.id, sucursalId);
  }

  /**
   * Criterio 44 (decisión 7): libera la mesa de una orden abierta que nunca tuvo un envío, sin clave. La orden
   * queda `ANULADA` con `sinConsumo`, su relación con la mesa se cierra y la mesa vuelve a estar libre. Si la
   * orden tuvo algún envío (aunque todo esté anulado, o los ítems vengan de otra orden unida), 409
   * `ORDEN_CON_CONSUMO`: se anula con clave. Deja la fila de auditoría `liberar_mesa`. La réplica de la misma
   * `Idempotency-Key` la devuelve el interceptor de idempotencia; con otra clave, una orden ya liberada responde
   * 409 `ORDEN_NO_ABIERTA`.
   */
  async liberar(ordenId: string): Promise<OrdenRespuesta> {
    const sucursalId = this.sucursalActiva();
    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);
    exigirOrdenAbierta(orden);

    const [consumo] = await this.conexion.query<{ hay: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM envio WHERE orden_id = $1)
           OR EXISTS (SELECT 1 FROM item WHERE orden_id = $1) AS hay`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    if (consumo?.hay === true) throw ordenConConsumo();

    const ahora = this.reloj.ahora();
    const mesaIds = await mesasVigentesDeOrden(this.conexion, orden.id);
    const [mozo] = await this.conexion.query<{ mozo_id: string | null }>(
      `UPDATE orden
          SET estado = 'ANULADA', anulada_en = $2, sin_consumo = true, version = version + 1,
              actualizado_en = $2
        WHERE id = $1
        RETURNING mozo_id`,
      { bind: [orden.id, ahora], type: QueryTypes.SELECT },
    );
    await this.conexion.query(
      `UPDATE orden_mesa SET hasta = $2, actualizado_en = $2 WHERE orden_id = $1 AND hasta IS NULL`,
      { bind: [orden.id, ahora], type: QueryTypes.UPDATE },
    );
    const nombresMesas = await this.mesas.nombres(mesaIds);
    await this.auditoria.registrar({
      accion: 'liberar_mesa',
      entidad: 'orden',
      entidadId: orden.id,
      detalle: {
        mesas: mesaIds.map((id) => ({ id, nombre: nombresMesas.get(id) ?? '' })),
        mozoId: mozo?.mozo_id ?? null,
      },
    });

    this.eventos.salonCambio(sucursalId, orden.id, mesaIds);
    return this.vista.armar(orden.id, sucursalId);
  }

  /** Criterio 55: `GET /ordenes/:id` de la sucursal activa (404 si es de otra sucursal o de otra empresa). */
  consultar(ordenId: string): Promise<OrdenRespuesta> {
    return this.vista.armar(ordenId, this.sucursalActiva());
  }

  /** La orden con ese id en la empresa (la RLS la limita), de cualquier sucursal. */
  private async buscarPorId(id: string): Promise<OrdenExistente | undefined> {
    const filas = await this.conexion.query<{ id: string; sucursal_id: string }>(
      'SELECT id, sucursal_id FROM orden WHERE id = $1',
      { bind: [id], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    return fila === undefined ? undefined : { id: fila.id, sucursalId: fila.sucursal_id };
  }

  /**
   * Criterio 12: el mismo `id` con la misma mesa devuelve la orden existente, tal como está ahora y sin efectos;
   * con otra mesa (o de otra sucursal), 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. "La misma mesa" es una de las que la
   * orden ha tenido (ocupó antes de moverse o unirse).
   */
  private async replicaDeApertura(
    existente: OrdenExistente,
    mesaId: string,
    sucursalId: string,
  ): Promise<OrdenRespuesta> {
    if (existente.sucursalId !== sucursalId) throw idDeClienteReutilizado();
    const relaciones = await this.conexion.query<{ mesa_id: string }>(
      'SELECT mesa_id FROM orden_mesa WHERE orden_id = $1 AND mesa_id = $2 LIMIT 1',
      { bind: [existente.id, mesaId], type: QueryTypes.SELECT },
    );
    if (relaciones.length === 0) throw idDeClienteReutilizado();
    return this.vista.armar(existente.id, sucursalId);
  }

  /** La orden que ocupa la mesa ahora, si hay. */
  private async ordenVigenteDeLaMesa(mesaId: string): Promise<string | undefined> {
    const filas = await this.conexion.query<{ orden_id: string }>(
      'SELECT orden_id FROM orden_mesa WHERE mesa_id = $1 AND hasta IS NULL',
      { bind: [mesaId], type: QueryTypes.SELECT },
    );
    return filas[0]?.orden_id;
  }

  /**
   * Criterio 10 (decisión 8; ruta crítica P3): sin `mozoId`, quien abre; con `mozoId`, alguien que atienda mesas
   * en esta sucursal. Una sesión de soporte (sin usuario) tiene que elegir. Uno de B y uno inexistente dan el
   * mismo 422.
   */
  private async mozoResponsable(mozoId: string | undefined, sucursalId: string): Promise<string> {
    if (mozoId === undefined) {
      const usuarioId = this.sesion.principal().usuarioId;
      if (usuarioId === null) {
        throw mozoInvalido('Elige quién atiende la mesa');
      }
      return usuarioId;
    }
    const elegido = mozoId.toLowerCase();
    const validos = await this.usuarios.puedenAtenderMesa(sucursalId, [elegido]);
    if (!validos.has(elegido)) throw mozoInvalido('No es una persona que atienda mesas');
    return elegido;
  }
}
