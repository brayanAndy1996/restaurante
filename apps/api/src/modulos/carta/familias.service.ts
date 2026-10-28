import { Inject, Injectable } from '@nestjs/common';
import type {
  FamiliaEntrada,
  FamiliaModificarEntrada,
  FamiliaRespuesta,
  OrdenEntrada,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { datosInvalidos, enUso, nombreRepetido, noEncontrado } from './errores-carta';
import { EventosCarta } from './eventos-carta';
import { aIso, diferencias, sinCambioDeOrden } from './util-carta';

interface FilaFamilia {
  id: string;
  nombre: string;
  orden: number;
  activa: boolean;
  productos: number;
  creado_en: Date;
  actualizado_en: Date;
}

/** `productos`: cuántos productos activos tiene la familia (criterio 4). */
const SELECT_FAMILIA = `SELECT f.id, f.nombre, f.orden, f.activa, f.creado_en, f.actualizado_en,
    (SELECT count(*)::int FROM producto p WHERE p.familia_id = f.id AND p.activo) AS productos
  FROM familia f`;

const aRespuesta = (f: FilaFamilia): FamiliaRespuesta => ({
  id: f.id,
  nombre: f.nombre,
  orden: f.orden,
  activa: f.activa,
  productos: f.productos,
  creadoEn: aIso(f.creado_en),
  actualizadoEn: aIso(f.actualizado_en),
});

const ordenInvalido = () =>
  datosInvalidos([{ campo: 'ids', mensaje: 'Debe contener exactamente una vez cada familia' }]);

/**
 * Familias de la carta (RF-14, criterios 3 a 5): el grupo al que pertenece cada producto (Entradas,
 * Fondos, Bebidas). Con orden manual, el mismo en todas las sucursales y en la carta web. Nada se borra:
 * se desactivan. El orden de los productos de una familia está en `ProductosService` (criterio 13).
 */
@Injectable()
export class FamiliasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
  ) {}

  /** Las familias en su orden, con sus productos activos. */
  async listar(): Promise<FamiliaRespuesta[]> {
    const filas = await this.conexion.query<FilaFamilia>(
      `${SELECT_FAMILIA} ORDER BY f.orden, f.id`,
      { type: QueryTypes.SELECT },
    );
    return filas.map(aRespuesta);
  }

  private async obtener(id: string): Promise<FamiliaRespuesta> {
    const filas = await this.conexion.query<FilaFamilia>(`${SELECT_FAMILIA} WHERE f.id = $1`, {
      bind: [id],
      type: QueryTypes.SELECT,
    });
    if (filas[0] === undefined) throw noEncontrado('La familia');
    return aRespuesta(filas[0]);
  }

  /** Criterio 3: nombre único sin distinguir mayúsculas (409); queda la última del orden. */
  async crear(entrada: FamiliaEntrada): Promise<FamiliaRespuesta> {
    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();
    // Las familias existentes quedan bloqueadas mientras se toma el orden: dos altas a la vez no repiten
    // la posición (sin familias, el empate es inofensivo: se desempata por id).
    await this.conexion.query('SELECT id FROM familia ORDER BY id FOR UPDATE', {
      type: QueryTypes.SELECT,
    });
    let id: string;
    let orden: number;
    try {
      const filas = await this.conexion.query<{ id: string; orden: number }>(
        `INSERT INTO familia (empresa_id, nombre, orden, activa, creado_en, actualizado_en)
         VALUES ($1, $2, (SELECT coalesce(max(orden), 0) + 1 FROM familia), true, $3, $3)
         RETURNING id, orden`,
        { bind: [empresaId, entrada.nombre, ahora], type: QueryTypes.SELECT },
      );
      id = filas[0]!.id;
      orden = filas[0]!.orden;
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) throw nombreRepetido('una familia');
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'crear_familia',
      entidad: 'familia',
      entidadId: id,
      detalle: { nombre: entrada.nombre, orden },
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }

  /**
   * Criterio 4: renombrar o desactivar. Desactivar una familia con productos activos responde 409
   * `EN_USO`. Sin cambios, responde 200 sin auditoría ni evento.
   */
  async modificar(id: string, cambios: FamiliaModificarEntrada): Promise<FamiliaRespuesta> {
    // Bloqueada `FOR UPDATE`: crear un producto en la familia la lee igual, así que no se cuela uno nuevo.
    const actuales = await this.conexion.query<{ nombre: string; activa: boolean }>(
      'SELECT nombre, activa FROM familia WHERE id = $1 FOR UPDATE',
      { bind: [id], type: QueryTypes.SELECT },
    );
    const actual = actuales[0];
    if (actual === undefined) throw noEncontrado('La familia');

    const despues = {
      nombre: cambios.nombre ?? actual.nombre,
      activa: cambios.activa ?? actual.activa,
    };
    const diff = diferencias(actual, despues, ['nombre', 'activa']);
    if (Object.keys(diff).length === 0) return this.obtener(id);

    if (actual.activa && !despues.activa) {
      const usan = await this.conexion.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM producto WHERE familia_id = $1 AND activo',
        { bind: [id], type: QueryTypes.SELECT },
      );
      const n = usan[0]!.n;
      if (n > 0) {
        throw enUso(
          n === 1
            ? 'Esta familia tiene 1 producto activo. Muévelo a otra familia o desactívalo antes de desactivarla'
            : `Esta familia tiene ${n} productos activos. Muévelos a otra familia o desactívalos antes de desactivarla`,
        );
      }
    }
    try {
      await this.conexion.query(
        'UPDATE familia SET nombre = $2, activa = $3, actualizado_en = $4 WHERE id = $1',
        { bind: [id, despues.nombre, despues.activa, this.reloj.ahora()] },
      );
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) throw nombreRepetido('una familia');
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'modificar_familia',
      entidad: 'familia',
      entidadId: id,
      detalle: diff,
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }

  /**
   * Criterio 5: `ids` debe contener exactamente una vez cada familia de la empresa (activas e inactivas);
   * con un id faltante, inexistente o de otra empresa responde 400 con el mismo cuerpo. Las filas se bloquean
   * `FOR UPDATE`: dos ordenamientos a la vez se serializan. Con el mismo orden que ya hay, no audita.
   */
  async ordenar(entrada: OrdenEntrada): Promise<FamiliaRespuesta[]> {
    await this.conexion.query('SELECT id FROM familia ORDER BY id FOR UPDATE', {
      type: QueryTypes.SELECT,
    });
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM familia ORDER BY orden, id',
      { type: QueryTypes.SELECT },
    );
    const actuales = filas.map((f) => f.id);
    const pedidos = entrada.ids.map((id) => id.toLowerCase());
    const conocidas = new Set(actuales);
    if (pedidos.length !== actuales.length || !pedidos.every((id) => conocidas.has(id))) {
      throw ordenInvalido();
    }
    if (!sinCambioDeOrden(actuales, pedidos)) {
      await this.conexion.query(
        `UPDATE familia SET orden = v.posicion, actualizado_en = $2
           FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, posicion)
          WHERE familia.id = v.id AND familia.orden <> v.posicion`,
        { bind: [pedidos, this.reloj.ahora()] },
      );
      await this.auditoria.registrar({
        accion: 'ordenar_familias',
        entidad: 'familia',
        detalle: { antes: actuales, despues: pedidos },
      });
      this.eventos.cartaActualizada(null);
    }
    return this.listar();
  }
}
