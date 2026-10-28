import { Inject, Injectable } from '@nestjs/common';
import type {
  EstacionEntrada,
  EstacionModificarEntrada,
  EstacionRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { enUso, nombreRepetido, noEncontrado } from './errores-carta';
import { EventosCarta } from './eventos-carta';
import { aIso, diferencias } from './util-carta';

interface FilaEstacion {
  id: string;
  nombre: string;
  activa: boolean;
  productos_activos: number;
  creado_en: Date;
  actualizado_en: Date;
}

/** `productosActivos`: cuántos productos activos usan la estación (criterio 2). */
const SELECT_ESTACION = `SELECT e.id, e.nombre, e.activa, e.creado_en, e.actualizado_en,
    (SELECT count(*)::int FROM producto p WHERE p.estacion_id = e.id AND p.activo) AS productos_activos
  FROM estacion e`;

const aRespuesta = (f: FilaEstacion): EstacionRespuesta => ({
  id: f.id,
  nombre: f.nombre,
  activa: f.activa,
  productosActivos: f.productos_activos,
  creadoEn: aIso(f.creado_en),
  actualizadoEn: aIso(f.actualizado_en),
});

/**
 * Estaciones de producción de la empresa del contexto (RF-19, criterios 1, 2 y 2b): lugares que preparan un
 * producto. Se definen por empresa; la asociación a una impresora o a un KDS de cada sucursal es de la
 * sección 3. Nada se borra: se desactivan. Corre dentro de la transacción de la petición; la auditoría y el
 * evento salen en la misma transacción y después de confirmarla.
 */
@Injectable()
export class EstacionesService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
  ) {}

  /** Las estaciones de la empresa ordenadas por nombre, con sus productos activos. */
  async listar(): Promise<EstacionRespuesta[]> {
    const filas = await this.conexion.query<FilaEstacion>(
      `${SELECT_ESTACION} ORDER BY lower(e.nombre), e.id`,
      { type: QueryTypes.SELECT },
    );
    return filas.map(aRespuesta);
  }

  private async obtener(id: string): Promise<EstacionRespuesta> {
    const filas = await this.conexion.query<FilaEstacion>(`${SELECT_ESTACION} WHERE e.id = $1`, {
      bind: [id],
      type: QueryTypes.SELECT,
    });
    if (filas[0] === undefined) throw noEncontrado('La estación');
    return aRespuesta(filas[0]);
  }

  /** Criterio 1: nombre único en la empresa sin distinguir mayúsculas (409 `CONFLICTO`). */
  async crear(entrada: EstacionEntrada): Promise<EstacionRespuesta> {
    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();
    let id: string;
    try {
      const filas = await this.conexion.query<{ id: string }>(
        `INSERT INTO estacion (empresa_id, nombre, activa, creado_en, actualizado_en)
         VALUES ($1, $2, true, $3, $3) RETURNING id`,
        { bind: [empresaId, entrada.nombre, ahora], type: QueryTypes.SELECT },
      );
      id = filas[0]!.id;
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) throw nombreRepetido('una estación');
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'crear_estacion',
      entidad: 'estacion',
      entidadId: id,
      detalle: { nombre: entrada.nombre },
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }

  /**
   * Criterio 2: renombrar o desactivar. Desactivar una estación que usan productos activos responde 409
   * `EN_USO` con la cantidad. Sin cambios, responde 200 sin auditoría ni evento.
   */
  async modificar(id: string, cambios: EstacionModificarEntrada): Promise<EstacionRespuesta> {
    // La fila queda bloqueada: la creación de un producto lee su estación `FOR SHARE`, así que no se cuela
    // un producto nuevo entre el conteo y la desactivación.
    const actuales = await this.conexion.query<{ nombre: string; activa: boolean }>(
      'SELECT nombre, activa FROM estacion WHERE id = $1 FOR UPDATE',
      { bind: [id], type: QueryTypes.SELECT },
    );
    const actual = actuales[0];
    if (actual === undefined) throw noEncontrado('La estación');

    const despues = {
      nombre: cambios.nombre ?? actual.nombre,
      activa: cambios.activa ?? actual.activa,
    };
    const diff = diferencias(actual, despues, ['nombre', 'activa']);
    if (Object.keys(diff).length === 0) return this.obtener(id);

    if (actual.activa && !despues.activa) {
      const usan = await this.conexion.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM producto WHERE estacion_id = $1 AND activo',
        { bind: [id], type: QueryTypes.SELECT },
      );
      const n = usan[0]!.n;
      if (n > 0) {
        throw enUso(
          n === 1
            ? 'Esta estación la usa 1 producto activo. Cámbialo de estación antes de desactivarla'
            : `Esta estación la usan ${n} productos activos. Cámbialos de estación antes de desactivarla`,
        );
      }
    }
    try {
      await this.conexion.query(
        'UPDATE estacion SET nombre = $2, activa = $3, actualizado_en = $4 WHERE id = $1',
        { bind: [id, despues.nombre, despues.activa, this.reloj.ahora()] },
      );
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) throw nombreRepetido('una estación');
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'modificar_estacion',
      entidad: 'estacion',
      entidadId: id,
      detalle: diff,
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }
}
