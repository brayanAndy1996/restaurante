import { Inject, Injectable } from '@nestjs/common';
import type { SucursalAccesoRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma/sucursales-consulta.service';
import { MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO } from './constantes-acceso';

/** 404 idéntico para una sucursal de otra empresa y para una inexistente. */
const sucursalNoExiste = () => new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');

/**
 * Acceso de la sucursal (criterio 40): los minutos de inactividad de las sesiones PIN que tienen esa
 * sucursal activa. Dueño de `sucursal_acceso`; mientras una sucursal no tenga fila rigen 5 minutos. Corre en
 * la transacción de la petición (solo el Administrador llega aquí), con el actor de la sesión.
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
    return { sucursalId, minutosInactividad: await this.minutosDe(sucursalId) };
  }

  /** `PATCH /sucursales/:id/acceso`: rige desde la siguiente petición de las sesiones PIN abiertas. */
  async configurar(
    sucursalId: string,
    minutosInactividad: number,
  ): Promise<SucursalAccesoRespuesta> {
    await this.exigirSucursal(sucursalId);
    const antes = await this.minutosDe(sucursalId);
    const ahora = this.reloj.ahora();
    await this.conexion.query(
      `INSERT INTO sucursal_acceso AS a (empresa_id, sucursal_id, minutos_inactividad, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (sucursal_id) DO UPDATE SET minutos_inactividad = $3, actualizado_en = $4`,
      { bind: [this.contexto.empresaActual(), sucursalId, minutosInactividad, ahora] },
    );
    await this.auditoria.registrar({
      accion: 'configurar_acceso_sucursal',
      sucursalId,
      entidad: 'sucursal',
      entidadId: sucursalId,
      detalle: {
        sucursalId,
        antes: { minutosInactividad: antes },
        despues: { minutosInactividad },
      },
    });
    return { sucursalId, minutosInactividad };
  }

  private async minutosDe(sucursalId: string): Promise<number> {
    const filas = await this.conexion.query<{ minutos_inactividad: number }>(
      'SELECT minutos_inactividad FROM sucursal_acceso WHERE sucursal_id = $1',
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return filas[0]?.minutos_inactividad ?? MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO;
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw sucursalNoExiste();
  }
}
