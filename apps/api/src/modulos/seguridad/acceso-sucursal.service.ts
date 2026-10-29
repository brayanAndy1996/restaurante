import { Inject, Injectable } from '@nestjs/common';
import type { SucursalAccesoEntrada, SucursalAccesoRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma/sucursales-consulta.service';
import {
  MINUTOS_INACTIVIDAD_COCINA_POR_DEFECTO,
  MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO,
} from './constantes-acceso';

/** 404 idéntico para una sucursal de otra empresa y para una inexistente. */
const sucursalNoExiste = () => new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');

/** Minutos de inactividad de una sucursal: de las sesiones PIN y de las de Cocina/Barra (criterios 40 y 63c). */
interface MinutosAcceso {
  minutosInactividad: number;
  minutosInactividadCocina: number;
}

/**
 * Acceso de la sucursal (criterio 40 de 002 y criterio 63c de 004): los minutos de inactividad de las sesiones
 * PIN que tienen esa sucursal activa y los de las sesiones de Cocina/Barra (PIN y contraseña). Dueño de
 * `sucursal_acceso`; mientras una sucursal no tenga fila rigen 5 y 60 minutos. Corre en la transacción de la
 * petición (solo el Administrador llega aquí), con el actor de la sesión.
 */
@Injectable()
export class AccesoSucursalService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
  ) {}

  /** `GET /sucursales/:id/acceso`. */
  async obtener(sucursalId: string): Promise<SucursalAccesoRespuesta> {
    await this.exigirSucursal(sucursalId);
    return { sucursalId, ...(await this.minutosDe(sucursalId, false)) };
  }

  /**
   * `PATCH /sucursales/:id/acceso`: rige desde la siguiente petición de las sesiones abiertas. Cada campo que no
   * se envía queda como estaba. La mezcla se hace en la misma sentencia (`COALESCE` sobre la fila), así dos
   * `PATCH` a la vez con campos distintos no se pisan.
   */
  async configurar(
    sucursalId: string,
    entrada: SucursalAccesoEntrada,
  ): Promise<SucursalAccesoRespuesta> {
    await this.exigirSucursal(sucursalId);
    const antes = await this.minutosDe(sucursalId, true);
    const ahora = this.reloj.ahora();
    const filas = await this.conexion.query<{ minutos: number; cocina: number }>(
      `INSERT INTO sucursal_acceso AS a
              (empresa_id, sucursal_id, minutos_inactividad, minutos_inactividad_cocina, creado_en, actualizado_en)
       VALUES ($1, $2, COALESCE($3::integer, $5::integer), COALESCE($4::integer, $6::integer), $7, $7)
       ON CONFLICT (sucursal_id) DO UPDATE
          SET minutos_inactividad = COALESCE($3::integer, a.minutos_inactividad),
              minutos_inactividad_cocina = COALESCE($4::integer, a.minutos_inactividad_cocina),
              actualizado_en = $7
       RETURNING minutos_inactividad AS minutos, minutos_inactividad_cocina AS cocina`,
      {
        bind: [
          this.contexto.empresaActual(),
          sucursalId,
          entrada.minutosInactividad ?? null,
          entrada.minutosInactividadCocina ?? null,
          MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO,
          MINUTOS_INACTIVIDAD_COCINA_POR_DEFECTO,
          ahora,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const despues: MinutosAcceso = {
      minutosInactividad: filas[0]!.minutos,
      minutosInactividadCocina: filas[0]!.cocina,
    };
    // Solo los campos que llegaron en la petición, con su antes y su después.
    const campos = (['minutosInactividad', 'minutosInactividadCocina'] as const).filter(
      (campo) => entrada[campo] !== undefined,
    );
    await this.auditoria.registrar({
      accion: 'configurar_acceso_sucursal',
      sucursalId,
      entidad: 'sucursal',
      entidadId: sucursalId,
      detalle: {
        sucursalId,
        antes: Object.fromEntries(campos.map((campo) => [campo, antes[campo]])),
        despues: Object.fromEntries(campos.map((campo) => [campo, despues[campo]])),
      },
    });
    return { sucursalId, ...despues };
  }

  /** Lo configurado (o los valores por defecto sin fila). Con `bloquear`, la fila queda tomada hasta el final. */
  private async minutosDe(sucursalId: string, bloquear: boolean): Promise<MinutosAcceso> {
    const filas = await this.conexion.query<{ minutos: number; cocina: number }>(
      `SELECT minutos_inactividad AS minutos, minutos_inactividad_cocina AS cocina
         FROM sucursal_acceso WHERE sucursal_id = $1${bloquear ? ' FOR UPDATE' : ''}`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return {
      minutosInactividad: filas[0]?.minutos ?? MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO,
      minutosInactividadCocina: filas[0]?.cocina ?? MINUTOS_INACTIVIDAD_COCINA_POR_DEFECTO,
    };
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw sucursalNoExiste();
  }
}
