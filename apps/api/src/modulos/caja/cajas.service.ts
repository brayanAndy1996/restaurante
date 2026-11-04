import { Inject, Injectable } from '@nestjs/common';
import type {
  CajaEntrada,
  CajaModificarEntrada,
  CajaRespuesta,
  SerieEntrada,
} from '@restaurante/contratos';
import { MAXIMO_CAJAS_SUCURSAL, type TipoComprobante } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SeriesService } from '../facturacion';
import { IMPRESION, type ImpresionPuerto } from '../pedidos/impresion';
import { EmisoresService, SucursalesConsultaService } from '../plataforma';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import {
  cajaConTurnoAbierto,
  impresoraDeCajaInvalida,
  limiteDeCajas,
  noEncontrado,
  nombreDeCajaRepetido,
} from './errores-caja';

/** Índice único de `caja` por sucursal y nombre sin distinguir mayúsculas (migración `202611040002-caja`). */
const INDICE_NOMBRE = 'caja_nombre_unico';

interface FilaCaja {
  id: string;
  sucursal_id: string;
  nombre: string;
  impresora_id: string | null;
  activa: boolean;
}

const COLUMNAS_CAJA = 'id, sucursal_id, nombre, impresora_id, activa';

/** Lo que se compara y se audita de una caja. */
interface DatosDeCaja {
  nombre: string;
  impresoraId: string | null;
  activa: boolean;
}

const datosDe = (fila: FilaCaja): DatosDeCaja => ({
  nombre: fila.nombre,
  impresoraId: fila.impresora_id,
  activa: fila.activa,
});

/**
 * Cajas de una sucursal (historia 006, criterios 1, 2 y 7): dueño de la tabla `caja`. Hasta 10 activas por sucursal,
 * nombre único sin distinguir mayúsculas, impresora activa de la misma sucursal o `null`; no se borran y desactivar una
 * con turno abierto responde 409 `EN_USO`. Deja `crear_caja` y `modificar_caja` en la auditoría (con el antes y el
 * después; repetir sin cambios responde 200 sin fila). Una sucursal de otra empresa, una caja de otra sucursal y una
 * inexistente dan el mismo 404.
 *
 * No lee tablas ajenas: la impresora la pide al puerto de impresión, el nombre del responsable de un turno a seguridad,
 * el emisor de la sucursal a plataforma y las series a facturación.
 */
@Injectable()
export class CajasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(SeriesService) private readonly series: SeriesService,
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
    @Inject(SesionActual) private readonly sesion: SesionActual,
  ) {}

  /** Todas las cajas de la sucursal (también las inactivas), por nombre. */
  async listar(sucursalId: string): Promise<CajaRespuesta[]> {
    await this.exigirSucursal(sucursalId);
    const filas = await this.conexion.query<FilaCaja>(
      `SELECT ${COLUMNAS_CAJA} FROM caja WHERE sucursal_id = $1 ORDER BY lower(nombre), id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return this.armar(sucursalId, filas);
  }

  /** Una caja de la sucursal; 404 si es de otra sucursal o empresa. */
  async obtener(sucursalId: string, cajaId: string): Promise<CajaRespuesta> {
    await this.exigirSucursal(sucursalId);
    const filas = await this.conexion.query<FilaCaja>(
      `SELECT ${COLUMNAS_CAJA} FROM caja WHERE id = $1 AND sucursal_id = $2`,
      { bind: [cajaId, sucursalId], type: QueryTypes.SELECT },
    );
    if (filas.length === 0) throw noEncontrado('La caja');
    return (await this.armar(sucursalId, filas))[0]!;
  }

  /**
   * Criterio 1: el nombre es único en la sucursal sin distinguir mayúsculas (409) y la sucursal tiene hasta
   * `MAXIMO_CAJAS_SUCURSAL` cajas activas (409 `CONFLICTO` en la siguiente). Nace activa. 422 `REFERENCIA_INVALIDA` si
   * la impresora no es una impresora activa de la sucursal.
   */
  async crear(sucursalId: string, entrada: CajaEntrada): Promise<CajaRespuesta> {
    await this.exigirSucursal(sucursalId);
    const impresoraId = entrada.impresoraId ?? null;
    await this.exigirImpresora(sucursalId, impresoraId);
    await this.exigirCupo(sucursalId);
    const ahora = this.reloj.ahora();
    let id: string;
    try {
      const filas = await this.conexion.query<{ id: string }>(
        `INSERT INTO caja (empresa_id, sucursal_id, nombre, impresora_id, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, true, $5, $5) RETURNING id`,
        {
          bind: [this.contexto.empresaActual(), sucursalId, entrada.nombre, impresoraId, ahora],
          type: QueryTypes.SELECT,
        },
      );
      id = filas[0]!.id;
    } catch (error) {
      if (esNombreRepetido(error)) throw nombreDeCajaRepetido();
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'crear_caja',
      sucursalId,
      entidad: 'caja',
      entidadId: id,
      detalle: { sucursalId, nombre: entrada.nombre, impresoraId },
    });
    return this.obtener(sucursalId, id);
  }

  /**
   * Criterios 1 y 2: renombrar, cambiar o quitar la impresora, activar y desactivar. Desactivar una caja con turno
   * abierto responde 409 `EN_USO`; reactivarla, 409 `CONFLICTO` si ya hay 10 activas. La fila se toma con `FOR NO KEY
   * UPDATE`: se turna con la apertura de turno de la misma caja y con otro cambio, sin estorbar a los cobros (que solo
   * necesitan `FOR KEY SHARE` por sus llaves foráneas). Sin cambios, 200 sin auditoría.
   */
  async modificar(
    sucursalId: string,
    cajaId: string,
    cambios: CajaModificarEntrada,
  ): Promise<CajaRespuesta> {
    await this.exigirSucursal(sucursalId);
    const actuales = await this.conexion.query<FilaCaja>(
      `SELECT ${COLUMNAS_CAJA} FROM caja WHERE id = $1 AND sucursal_id = $2 FOR NO KEY UPDATE`,
      { bind: [cajaId, sucursalId], type: QueryTypes.SELECT },
    );
    const actual = actuales[0];
    if (actual === undefined) throw noEncontrado('La caja');

    const antes = datosDe(actual);
    const despues: DatosDeCaja = {
      nombre: cambios.nombre ?? antes.nombre,
      impresoraId: cambios.impresoraId === undefined ? antes.impresoraId : cambios.impresoraId,
      activa: cambios.activa ?? antes.activa,
    };
    if (despues.impresoraId !== antes.impresoraId) {
      await this.exigirImpresora(sucursalId, despues.impresoraId);
    }
    const diff: Record<string, { antes: unknown; despues: unknown }> = {};
    for (const campo of ['nombre', 'impresoraId', 'activa'] as const) {
      if (antes[campo] !== despues[campo])
        diff[campo] = { antes: antes[campo], despues: despues[campo] };
    }
    if (Object.keys(diff).length === 0) return this.obtener(sucursalId, cajaId);

    if (antes.activa && !despues.activa) await this.exigirSinTurnoAbierto(cajaId);
    if (!antes.activa && despues.activa) await this.exigirCupo(sucursalId);

    try {
      await this.conexion.query(
        `UPDATE caja SET nombre = $2, impresora_id = $3, activa = $4, actualizado_en = $5 WHERE id = $1`,
        {
          bind: [cajaId, despues.nombre, despues.impresoraId, despues.activa, this.reloj.ahora()],
          type: QueryTypes.UPDATE,
        },
      );
    } catch (error) {
      if (esNombreRepetido(error)) throw nombreDeCajaRepetido();
      throw error;
    }
    await this.auditoria.registrar({
      accion: 'modificar_caja',
      sucursalId,
      entidad: 'caja',
      entidadId: cajaId,
      detalle: { sucursalId, ...diff },
    });
    return this.obtener(sucursalId, cajaId);
  }

  /**
   * `PUT …/series/:tipo` (criterios 3 a 5): comprueba la sucursal y la caja (404), toma la fila de la caja para turnar
   * las configuraciones de sus series y deja la serie con el emisor que tiene la sucursal ahora. Devuelve la caja.
   */
  async configurarSerie(
    sucursalId: string,
    cajaId: string,
    tipo: TipoComprobante,
    entrada: SerieEntrada,
  ): Promise<CajaRespuesta> {
    await this.exigirSucursal(sucursalId);
    const cajas = await this.conexion.query<{ id: string }>(
      `SELECT id FROM caja WHERE id = $1 AND sucursal_id = $2 FOR NO KEY UPDATE`,
      { bind: [cajaId, sucursalId], type: QueryTypes.SELECT },
    );
    if (cajas.length === 0) throw noEncontrado('La caja');
    const { emisor } = await this.emisores.datosParaComprobante(sucursalId);
    await this.series.configurar({ sucursalId, cajaId, emisorId: emisor.id, tipo, entrada });
    return this.obtener(sucursalId, cajaId);
  }

  /** `GET /cajas` (criterio 27): las cajas activas de la sucursal activa, con su turno abierto y sin montos. */
  async activasDeLaSucursal(): Promise<CajaRespuesta[]> {
    const sucursalId = this.sesion.sucursalActiva();
    const filas = await this.conexion.query<FilaCaja>(
      `SELECT ${COLUMNAS_CAJA} FROM caja WHERE sucursal_id = $1 AND activa ORDER BY lower(nombre), id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return this.armar(sucursalId, filas);
  }

  /**
   * Arma la `cajaRespuesta` de varias cajas de la sucursal con un número fijo de consultas: las series, las
   * impresoras, los turnos abiertos y los nombres de sus responsables.
   */
  private async armar(sucursalId: string, cajas: readonly FilaCaja[]): Promise<CajaRespuesta[]> {
    if (cajas.length === 0) return [];
    const ids = cajas.map((c) => c.id);
    const series = await this.series.seriesDeCajas(ids);
    const impresoras = await this.impresion.impresorasDeLaSucursal(
      sucursalId,
      cajas.flatMap((c) => (c.impresora_id === null ? [] : [c.impresora_id])),
    );
    const turnos = await this.conexion.query<{
      id: string;
      caja_id: string;
      responsable_id: string;
      abierto_en: Date;
    }>(
      `SELECT id, caja_id, responsable_id, abierto_en FROM turno
        WHERE caja_id = ANY($1::uuid[]) AND estado = 'ABIERTO'`,
      { bind: [ids], type: QueryTypes.SELECT },
    );
    const nombres = await this.usuarios.nombres(turnos.map((t) => t.responsable_id));
    const turnoDe = new Map(turnos.map((t) => [t.caja_id, t]));
    return cajas.map((c) => {
      const impresora = c.impresora_id === null ? undefined : impresoras.get(c.impresora_id);
      const turno = turnoDe.get(c.id);
      return {
        id: c.id,
        sucursalId: c.sucursal_id,
        nombre: c.nombre,
        activa: c.activa,
        impresora:
          impresora === undefined
            ? null
            : { id: impresora.id, nombre: impresora.nombre, gaveta: impresora.gaveta },
        series: series.get(c.id) ?? [],
        turnoAbierto:
          turno === undefined
            ? null
            : {
                id: turno.id,
                responsable: {
                  id: turno.responsable_id,
                  nombre: nombres.get(turno.responsable_id) ?? '',
                },
                abiertoEn: turno.abierto_en.toISOString(),
              },
      };
    });
  }

  /** 422 si la impresora no es una impresora activa de la sucursal (criterio 2); `null` es válido. */
  private async exigirImpresora(sucursalId: string, impresoraId: string | null): Promise<void> {
    if (impresoraId === null) return;
    const encontrada = (await this.impresion.impresorasDeLaSucursal(sucursalId, [impresoraId])).get(
      impresoraId,
    );
    if (encontrada === undefined || !encontrada.activa) throw impresoraDeCajaInvalida();
  }

  /**
   * 409 si la sucursal ya tiene `MAXIMO_CAJAS_SUCURSAL` cajas activas. Las altas y las reactivaciones de una sucursal
   * se turnan con un cerrojo de la transacción para que dos a la vez no pasen del tope.
   */
  private async exigirCupo(sucursalId: string): Promise<void> {
    await this.conexion.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', {
      bind: [`cajas:${sucursalId}`],
      type: QueryTypes.SELECT,
    });
    const filas = await this.conexion.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM caja WHERE sucursal_id = $1 AND activa',
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    if ((filas[0]?.n ?? 0) >= MAXIMO_CAJAS_SUCURSAL) throw limiteDeCajas(MAXIMO_CAJAS_SUCURSAL);
  }

  private async exigirSinTurnoAbierto(cajaId: string): Promise<void> {
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT id FROM turno WHERE caja_id = $1 AND estado = 'ABIERTO' LIMIT 1`,
      { bind: [cajaId], type: QueryTypes.SELECT },
    );
    if (filas.length > 0) throw cajaConTurnoAbierto();
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw noEncontrado('La sucursal');
  }
}

function esNombreRepetido(error: unknown): boolean {
  return (
    sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD && restriccionDe(error) === INDICE_NOMBRE
  );
}
