import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { principalActual } from '../../nucleo/principal';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import type { EntradaAuditoria, EntradaAuditoriaPlataforma } from './tipos';

/**
 * Inserta una fila de `auditoria`. El actor (`actor_usuario_id`, `actor_superadministrador_id` o
 * `actor_sistema`) y el equipo no se envían: los pone el trigger de la base a partir del contexto de
 * actor de la transacción (criterio 119), así que la fila y el cambio que registra tienen siempre el
 * mismo actor y nadie puede falsearlo desde la API.
 */
const SQL_INSERTAR = `INSERT INTO auditoria
    (empresa_id, sucursal_id, ocurrido_en, origen, accion, sesion_id, autorizado_por_id,
     autorizacion_id, motivo, entidad, entidad_id, detalle)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`;

function accionValida(accion: unknown): string {
  if (typeof accion !== 'string' || accion.trim() === '') {
    throw new TypeError('La acción de la auditoría es obligatoria');
  }
  return accion.trim();
}

function detalleJson(detalle: unknown): string {
  return JSON.stringify(detalle ?? {}) ?? '{}';
}

/**
 * Auditoría general (RF-13, RNF-09): una tabla inmutable con quién hizo qué, en el módulo dueño de
 * `auditoria`, sin dependencias de otros módulos.
 */
@Injectable()
export class AuditoriaService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /**
   * Registra una fila dentro del contexto de empresa de la petición, en la misma transacción que el
   * cambio que audita: o quedan los dos o no queda ninguno (criterio 58). La empresa sale del
   * contexto; la sesión y, si la entrada no trae sucursal, la sucursal activa, del principal de la
   * petición; la hora, del reloj de la API (criterio 60). Fuera de un contexto de empresa lanza
   * `ContextoEmpresaAusenteError`.
   */
  async registrar(entrada: EntradaAuditoria): Promise<void> {
    const empresaId = this.contexto.empresaActual();
    const principal = principalActual();
    await this.conexion.query(SQL_INSERTAR, {
      bind: [
        empresaId,
        entrada.sucursalId ?? principal?.sucursalId ?? null,
        this.reloj.ahora(),
        'empresa',
        accionValida(entrada.accion),
        principal?.sesionId ?? null,
        entrada.autorizadoPorId ?? null,
        entrada.autorizacionId ?? null,
        entrada.motivo ?? null,
        entrada.entidad ?? null,
        entrada.entidadId ?? null,
        detalleJson(entrada.detalle),
      ],
      type: QueryTypes.INSERT,
    });
  }
}

/**
 * Inserta una fila de origen plataforma con la transacción que recibe (la de `OperacionPlataforma`, que ya
 * fijó su actor). Es una función y no un proveedor para evitar dependencias circulares entre módulos.
 * La hora (`ocurridoEn`) la da quien llama, con el reloj de la API.
 */
export async function insertarAuditoriaPlataforma(
  transaccion: Transaction,
  entrada: EntradaAuditoriaPlataforma,
): Promise<void> {
  const sequelize = (transaccion as Transaction & { sequelize: Sequelize }).sequelize;
  await sequelize.query(SQL_INSERTAR, {
    transaction: transaccion,
    bind: [
      entrada.empresaId ?? null,
      entrada.sucursalId ?? null,
      entrada.ocurridoEn,
      'plataforma',
      accionValida(entrada.accion),
      entrada.sesionId ?? null,
      null,
      null,
      entrada.motivo ?? null,
      entrada.entidad ?? null,
      entrada.entidadId ?? null,
      detalleJson(entrada.detalle),
    ],
    type: QueryTypes.INSERT,
  });
}
