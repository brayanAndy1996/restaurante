import { Inject, Injectable } from '@nestjs/common';
import type {
  ConexionImpresora,
  ImpresoraEntradaValidada,
  ImpresoraModificarEntradaValidada,
  ImpresoraRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { CartaConsultaService } from '../carta';
import { SucursalesConsultaService } from '../plataforma';
import { impresoraEnUso, noEncontrado, nombreRepetido } from './errores-impresion';
import {
  COLUMNAS_IMPRESORA,
  aConexion,
  leerImpresoras,
  type FilaImpresora,
} from './lectura-impresoras';

/** Nombre del índice único de `impresora` (migración `202610310001-impresion`). */
const INDICE_NOMBRE = 'impresora_nombre_unico';

/** Los campos de una impresora que se comparan y se auditan. */
interface DatosDeImpresora {
  nombre: string;
  conexion: ConexionImpresora;
  anchoMm: number;
  juegoCaracteres: string;
  gaveta: boolean;
  activa: boolean;
}

const datosDe = (fila: FilaImpresora): DatosDeImpresora => ({
  nombre: fila.nombre,
  conexion: aConexion(fila),
  anchoMm: fila.ancho_mm,
  juegoCaracteres: fila.juego_caracteres,
  gaveta: fila.gaveta,
  activa: fila.activa,
});

/** Las columnas de conexión de una impresora de red o Bluetooth; las del otro tipo quedan nulas. */
const columnasDeConexion = (conexion: ConexionImpresora) =>
  conexion.tipo === 'RED'
    ? { tipo: 'RED', host: conexion.host, puerto: conexion.puerto, mac: null }
    : { tipo: 'BLUETOOTH', host: null, puerto: null, mac: conexion.mac };

/**
 * Impresoras de la sucursal (RF-76, criterios 103 a 105). La sucursal va en la ruta: una sucursal de otra empresa
 * y una inexistente dan el mismo 404, y una impresora de otra sucursal se trata como inexistente. Nada se borra:
 * se desactiva. Bluetooth y la gaveta solo se guardan (decisión 12). Cada alta y cada cambio deja una fila de
 * auditoría con la sucursal; un `PATCH` que no cambia nada, ninguna.
 */
@Injectable()
export class ImpresorasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(CartaConsultaService) private readonly carta: CartaConsultaService,
  ) {}

  /** `GET`: las impresoras de la sucursal con su estado y los trabajos pendientes de cada una (criterio 105). */
  async listar(sucursalId: string): Promise<ImpresoraRespuesta[]> {
    await this.exigirSucursal(sucursalId);
    return leerImpresoras(this.conexion, sucursalId);
  }

  /** Criterio 103: el nombre es único en la sucursal sin distinguir mayúsculas (409). Nace activa. */
  async crear(sucursalId: string, entrada: ImpresoraEntradaValidada): Promise<ImpresoraRespuesta> {
    await this.exigirSucursal(sucursalId);
    const c = columnasDeConexion(entrada.conexion);
    const ahora = this.reloj.ahora();
    let id: string;
    try {
      const filas = await this.conexion.query<{ id: string }>(
        `INSERT INTO impresora (empresa_id, sucursal_id, nombre, conexion_tipo, host, puerto, mac, ancho_mm,
                                juego_caracteres, gaveta, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $11)
         RETURNING id`,
        {
          bind: [
            this.contexto.empresaActual(),
            sucursalId,
            entrada.nombre,
            c.tipo,
            c.host,
            c.puerto,
            c.mac,
            entrada.anchoMm,
            entrada.juegoCaracteres,
            entrada.gaveta,
            ahora,
          ],
          type: QueryTypes.SELECT,
        },
      );
      id = filas[0]!.id;
    } catch (error) {
      if (esNombreRepetido(error)) throw nombreRepetido();
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'crear_impresora',
      sucursalId,
      entidad: 'impresora',
      entidadId: id,
      detalle: {
        sucursalId,
        nombre: entrada.nombre,
        conexion: entrada.conexion,
        anchoMm: entrada.anchoMm,
        juegoCaracteres: entrada.juegoCaracteres,
        gaveta: entrada.gaveta,
      },
    });
    return this.obtener(sucursalId, id);
  }

  /**
   * Criterio 104: editar y desactivar (`conexion` se reemplaza entera). Desactivar una impresora que es destino de
   * alguna estación o la impresora de caja responde 409 `EN_USO` con el uso en el mensaje. La fila se bloquea
   * mientras se decide: quien la elige como destino al mismo tiempo la lee con `FOR SHARE` y se turna con este
   * cambio, así una impresora desactivada nunca queda como destino. Sin cambios, 200 sin auditoría.
   */
  async modificar(
    sucursalId: string,
    id: string,
    cambios: ImpresoraModificarEntradaValidada,
  ): Promise<ImpresoraRespuesta> {
    await this.exigirSucursal(sucursalId);
    const actuales = await this.conexion.query<FilaImpresora>(
      `SELECT ${COLUMNAS_IMPRESORA} FROM impresora WHERE id = $1 AND sucursal_id = $2 FOR UPDATE`,
      { bind: [id, sucursalId], type: QueryTypes.SELECT },
    );
    const actual = actuales[0];
    if (actual === undefined) throw noEncontrado('La impresora');

    const antes = datosDe(actual);
    const despues: DatosDeImpresora = {
      nombre: cambios.nombre ?? antes.nombre,
      conexion: cambios.conexion ?? antes.conexion,
      anchoMm: cambios.anchoMm ?? antes.anchoMm,
      juegoCaracteres: cambios.juegoCaracteres ?? antes.juegoCaracteres,
      gaveta: cambios.gaveta ?? antes.gaveta,
      activa: cambios.activa ?? antes.activa,
    };
    const diff: Record<string, { antes: unknown; despues: unknown }> = {};
    for (const campo of [
      'nombre',
      'conexion',
      'anchoMm',
      'juegoCaracteres',
      'gaveta',
      'activa',
    ] as const) {
      if (!iguales(antes[campo], despues[campo])) {
        diff[campo] = { antes: antes[campo], despues: despues[campo] };
      }
    }
    if (Object.keys(diff).length === 0) return this.obtener(sucursalId, id);

    if (antes.activa && !despues.activa) await this.exigirSinUso(sucursalId, id);

    const c = columnasDeConexion(despues.conexion);
    try {
      await this.conexion.query(
        `UPDATE impresora
            SET nombre = $2, conexion_tipo = $3, host = $4, puerto = $5, mac = $6, ancho_mm = $7,
                juego_caracteres = $8, gaveta = $9, activa = $10, actualizado_en = $11
          WHERE id = $1`,
        {
          bind: [
            id,
            despues.nombre,
            c.tipo,
            c.host,
            c.puerto,
            c.mac,
            despues.anchoMm,
            despues.juegoCaracteres,
            despues.gaveta,
            despues.activa,
            this.reloj.ahora(),
          ],
        },
      );
    } catch (error) {
      if (esNombreRepetido(error)) throw nombreRepetido();
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'modificar_impresora',
      sucursalId,
      entidad: 'impresora',
      entidadId: id,
      detalle: { sucursalId, ...diff },
    });
    return this.obtener(sucursalId, id);
  }

  /** 409 `EN_USO` si la impresora es destino de alguna estación o la impresora de caja de la sucursal. */
  private async exigirSinUso(sucursalId: string, id: string): Promise<void> {
    const destinos = await this.conexion.query<{ estacion_id: string }>(
      `SELECT estacion_id FROM estacion_destino
        WHERE sucursal_id = $1 AND impresora_id = $2
        ORDER BY estacion_id`,
      { bind: [sucursalId, id], type: QueryTypes.SELECT },
    );
    const caja = await this.conexion.query<{ id: string }>(
      'SELECT id FROM impresion_sucursal WHERE sucursal_id = $1 AND impresora_caja_id = $2',
      { bind: [sucursalId, id], type: QueryTypes.SELECT },
    );
    const usos: string[] = [];
    if (destinos.length > 0) {
      const nombres = await this.carta.nombres(destinos.map((d) => d.estacion_id));
      const lista = destinos.map((d) => nombres.get(d.estacion_id) ?? 'una estación').sort();
      usos.push(
        lista.length === 1
          ? `destino de la estación ${lista[0]}`
          : `destino de las estaciones ${lista.join(', ')}`,
      );
    }
    if (caja.length > 0) usos.push('impresora de caja');
    if (usos.length > 0) throw impresoraEnUso(usos);
  }

  private async obtener(sucursalId: string, id: string): Promise<ImpresoraRespuesta> {
    const impresora = (await leerImpresoras(this.conexion, sucursalId, { impresoraId: id }))[0];
    if (impresora === undefined) throw noEncontrado('La impresora');
    return impresora;
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw noEncontrado('La sucursal');
  }
}

/** Igualdad de dos valores de los campos auditados; la conexión se compara por sus columnas. */
function iguales(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return (
      JSON.stringify(columnasDeConexion(a as ConexionImpresora)) ===
      JSON.stringify(columnasDeConexion(b as ConexionImpresora))
    );
  }
  return a === b;
}

function esNombreRepetido(error: unknown): boolean {
  return (
    sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD && restriccionDe(error) === INDICE_NOMBRE
  );
}
