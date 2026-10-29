import { Inject, Injectable } from '@nestjs/common';
import type {
  OrdenEntrada,
  ZonaEntrada,
  ZonaModificarEntrada,
  ZonaRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import { conflicto, datosInvalidos, enUso, noEncontrado, nombreRepetido } from './errores-salon';
import { leerZonas } from './lectura-mapa';
import { tomarTurnoDelMapa } from './mapa-bloqueo';

interface FilaZonaBloqueada {
  nombre: string;
  columnas: number;
  filas: number;
  activa: boolean;
}

const ordenInvalido = () =>
  datosInvalidos([{ campo: 'ids', mensaje: 'Debe contener exactamente una vez cada zona' }]);

/**
 * Zonas del salón (RF-22, criterios 1, 2, 5 y 6). Todas las operaciones tienen la sucursal en la ruta: una
 * sucursal de otra empresa y una inexistente dan el mismo 404, y una zona de otra sucursal se trata como
 * inexistente. Nada se borra: se desactiva. Cada escritura toma el turno del mapa de la sucursal y deja una fila
 * de auditoría con la sucursal y el antes y el después de lo que cambió (un `PATCH` que no cambia nada, ninguna).
 */
@Injectable()
export class ZonasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
  ) {}

  /** `GET`: las zonas de la sucursal en su orden con todas sus mesas (activas e inactivas). */
  async listar(sucursalId: string): Promise<ZonaRespuesta[]> {
    await this.exigirSucursal(sucursalId);
    return leerZonas(this.conexion, sucursalId);
  }

  /** Criterio 1: nombre único sin distinguir mayúsculas (409); queda la última del orden. */
  async crear(sucursalId: string, entrada: ZonaEntrada): Promise<ZonaRespuesta> {
    await this.exigirSucursal(sucursalId);
    await tomarTurnoDelMapa(this.conexion, sucursalId);
    const ahora = this.reloj.ahora();
    let id: string;
    let orden: number;
    try {
      const filas = await this.conexion.query<{ id: string; orden: number }>(
        `INSERT INTO zona (empresa_id, sucursal_id, nombre, orden, columnas, filas, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, (SELECT coalesce(max(orden), 0) + 1 FROM zona WHERE sucursal_id = $2),
                 $4, $5, true, $6, $6)
         RETURNING id, orden`,
        {
          bind: [
            this.contexto.empresaActual(),
            sucursalId,
            entrada.nombre,
            entrada.columnas,
            entrada.filas,
            ahora,
          ],
          type: QueryTypes.SELECT,
        },
      );
      id = filas[0]!.id;
      orden = filas[0]!.orden;
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) throw nombreRepetido('una zona');
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'crear_zona',
      sucursalId,
      entidad: 'zona',
      entidadId: id,
      detalle: {
        sucursalId,
        nombre: entrada.nombre,
        orden,
        columnas: entrada.columnas,
        filas: entrada.filas,
      },
    });
    return this.obtener(sucursalId, id);
  }

  /**
   * Criterio 2: renombrar, cambiar la cuadrícula o desactivar. Achicar la cuadrícula dejando afuera una mesa
   * activa responde 409 `CONFLICTO` con las mesas en el mensaje; desactivar una zona con mesas activas, 409
   * `EN_USO`. Sin cambios, 200 sin auditoría.
   */
  async modificar(
    sucursalId: string,
    id: string,
    cambios: ZonaModificarEntrada,
  ): Promise<ZonaRespuesta> {
    await this.exigirSucursal(sucursalId);
    await tomarTurnoDelMapa(this.conexion, sucursalId);
    const actuales = await this.conexion.query<FilaZonaBloqueada>(
      `SELECT nombre, columnas, filas, activa FROM zona
        WHERE id = $1 AND sucursal_id = $2 FOR UPDATE`,
      { bind: [id, sucursalId], type: QueryTypes.SELECT },
    );
    const actual = actuales[0];
    if (actual === undefined) throw noEncontrado('La zona');

    const despues: FilaZonaBloqueada = {
      nombre: cambios.nombre ?? actual.nombre,
      columnas: cambios.columnas ?? actual.columnas,
      filas: cambios.filas ?? actual.filas,
      activa: cambios.activa ?? actual.activa,
    };
    const diff: Record<string, { antes: unknown; despues: unknown }> = {};
    for (const campo of ['nombre', 'columnas', 'filas', 'activa'] as const) {
      if (actual[campo] !== despues[campo]) {
        diff[campo] = { antes: actual[campo], despues: despues[campo] };
      }
    }
    if (Object.keys(diff).length === 0) return this.obtener(sucursalId, id);

    const desactiva = actual.activa && !despues.activa;
    const achica = despues.columnas < actual.columnas || despues.filas < actual.filas;
    const mesasActivas =
      desactiva || achica
        ? await this.conexion.query<{ nombre: string; columna: number; fila: number }>(
            `SELECT nombre, columna, fila FROM mesa WHERE zona_id = $1 AND activa
              ORDER BY fila, columna, id`,
            { bind: [id], type: QueryTypes.SELECT },
          )
        : [];
    // Desactivar una zona con mesas activas (criterio 2).
    if (desactiva && mesasActivas.length > 0) {
      const n = mesasActivas.length;
      throw enUso(
        n === 1
          ? 'Esta zona tiene 1 mesa activa. Desactívala o muévela a otra zona antes de desactivar la zona'
          : `Esta zona tiene ${n} mesas activas. Desactívalas o muévelas a otra zona antes de desactivar la zona`,
      );
    }
    // Achicar la cuadrícula dejando una mesa activa afuera (criterio 2).
    const afuera = mesasActivas.filter(
      (m) => m.columna > despues.columnas || m.fila > despues.filas,
    );
    if (afuera.length > 0) {
      const campos = [];
      if (afuera.some((m) => m.columna > despues.columnas)) {
        campos.push({ campo: 'columnas', mensaje: 'Hay mesas fuera de las columnas nuevas' });
      }
      if (afuera.some((m) => m.fila > despues.filas)) {
        campos.push({ campo: 'filas', mensaje: 'Hay mesas fuera de las filas nuevas' });
      }
      throw conflicto(
        `No se puede achicar la cuadrícula: ${afuera.length === 1 ? 'la mesa' : 'las mesas'} ${afuera
          .map((m) => m.nombre)
          .join(
            ', ',
          )} ${afuera.length === 1 ? 'quedaría' : 'quedarían'} fuera. Muévelas o desactívalas antes`,
        campos,
      );
    }
    try {
      await this.conexion.query(
        `UPDATE zona SET nombre = $2, columnas = $3, filas = $4, activa = $5, actualizado_en = $6
          WHERE id = $1`,
        {
          bind: [
            id,
            despues.nombre,
            despues.columnas,
            despues.filas,
            despues.activa,
            this.reloj.ahora(),
          ],
        },
      );
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) throw nombreRepetido('una zona');
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'modificar_zona',
      sucursalId,
      entidad: 'zona',
      entidadId: id,
      detalle: { sucursalId, ...diff },
    });
    return this.obtener(sucursalId, id);
  }

  /**
   * Criterio 1: `ids` debe contener exactamente una vez cada zona de la sucursal (activas e inactivas); con un id
   * faltante, repetido, inexistente o de otra sucursal o empresa responde 400 con el mismo cuerpo. Con el mismo
   * orden que ya hay, no audita.
   */
  async ordenar(sucursalId: string, entrada: OrdenEntrada): Promise<ZonaRespuesta[]> {
    await this.exigirSucursal(sucursalId);
    await tomarTurnoDelMapa(this.conexion, sucursalId);
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM zona WHERE sucursal_id = $1 ORDER BY orden, id FOR UPDATE',
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const actuales = filas.map((f) => f.id);
    const pedidos = entrada.ids.map((id) => id.toLowerCase());
    const conocidas = new Set(actuales);
    if (
      pedidos.length !== actuales.length ||
      new Set(pedidos).size !== pedidos.length ||
      !pedidos.every((id) => conocidas.has(id))
    ) {
      throw ordenInvalido();
    }
    if (!actuales.every((id, i) => id === pedidos[i])) {
      await this.conexion.query(
        `UPDATE zona SET orden = v.posicion, actualizado_en = $2
           FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, posicion)
          WHERE zona.id = v.id AND zona.orden <> v.posicion`,
        { bind: [pedidos, this.reloj.ahora()] },
      );
      await this.auditoria.registrar({
        accion: 'ordenar_zonas',
        sucursalId,
        entidad: 'zona',
        detalle: { sucursalId, antes: actuales, despues: pedidos },
      });
    }
    return leerZonas(this.conexion, sucursalId);
  }

  private async obtener(sucursalId: string, id: string): Promise<ZonaRespuesta> {
    const zona = (await leerZonas(this.conexion, sucursalId, { zonaId: id }))[0];
    if (zona === undefined) throw noEncontrado('La zona');
    return zona;
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw noEncontrado('La sucursal');
  }
}
