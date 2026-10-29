import { Inject, Injectable } from '@nestjs/common';
import type {
  CampoError,
  MesaEntrada,
  MesaModificarEntrada,
  MesaRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import {
  conflicto,
  datosInvalidos,
  enUso,
  noEncontrado,
  referenciaInvalida,
} from './errores-salon';
import { COLUMNAS_MESA, aMesa } from './lectura-mapa';
import { tomarTurnoDelMapa } from './mapa-bloqueo';
import { UsoDeMesas } from './uso-de-mesas';

/** Nombres de los índices únicos parciales de `mesa` (migración `202610300001-salon`). */
const INDICE_NOMBRE = 'mesa_nombre_activa_unico';
const INDICE_CELDA = 'mesa_celda_activa_unica';

interface FilaMesaActual {
  zona_id: string;
  nombre: string;
  capacidad: number;
  forma: MesaRespuesta['forma'];
  columna: number;
  fila: number;
  activa: boolean;
}

interface DatosDeMesa {
  zonaId: string;
  nombre: string;
  capacidad: number;
  forma: MesaRespuesta['forma'];
  columna: number;
  fila: number;
  activa: boolean;
}

interface FilaZona {
  id: string;
  columnas: number;
  filas: number;
  activa: boolean;
}

const CAMPOS_AUDITADOS = [
  'nombre',
  'capacidad',
  'forma',
  'zonaId',
  'columna',
  'fila',
  'activa',
] as const;

/** 409 por el nombre y/o la celda ya ocupados por otra mesa activa. */
function conflictoDeMesa(nombre: boolean, celda: boolean): ErrorAplicacion {
  const campos: CampoError[] = [];
  if (nombre) campos.push({ campo: 'nombre', mensaje: 'Ya existe una mesa activa con ese nombre' });
  if (celda) {
    campos.push(
      { campo: 'columna', mensaje: 'La celda ya tiene una mesa activa' },
      { campo: 'fila', mensaje: 'La celda ya tiene una mesa activa' },
    );
  }
  const mensaje =
    nombre && celda
      ? 'Ya existe una mesa activa con ese nombre y la celda ya tiene una mesa activa'
      : nombre
        ? 'Ya existe una mesa activa con ese nombre'
        : 'Esa celda de la zona ya tiene una mesa activa';
  return conflicto(mensaje, campos);
}

/**
 * Mesas del salón (RF-22, criterios 3 a 6). La sucursal va en la ruta: una sucursal de otra empresa y una
 * inexistente dan el mismo 404, y una zona o mesa de otra sucursal se trata como inexistente. Nada se borra: las
 * órdenes referencian las mesas, así que se desactivan (409 `EN_USO` si tienen una orden abierta). Cada escritura
 * toma el turno del mapa de la sucursal y deja una fila de auditoría con el antes y el después de lo que cambió.
 */
@Injectable()
export class MesasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(UsoDeMesas) private readonly uso: UsoDeMesas,
  ) {}

  /** Criterio 3. 201 con la mesa; 400 si la celda cae fuera de la zona; 409 con nombre o celda repetidos. */
  async crear(sucursalId: string, zonaId: string, entrada: MesaEntrada): Promise<MesaRespuesta> {
    await this.exigirSucursal(sucursalId);
    await tomarTurnoDelMapa(this.conexion, sucursalId);
    const zona = await this.zonaDeLaSucursal(zonaId, sucursalId);
    if (zona === undefined) throw noEncontrado('La zona');
    const datos: DatosDeMesa = {
      zonaId,
      nombre: entrada.nombre,
      capacidad: entrada.capacidad,
      forma: entrada.forma,
      columna: entrada.columna,
      fila: entrada.fila,
      activa: true,
    };
    await this.validarResultado(sucursalId, null, datos, zona);

    let id: string;
    try {
      const filas = await this.conexion.query<{ id: string }>(
        `INSERT INTO mesa (empresa_id, sucursal_id, zona_id, nombre, capacidad, forma, columna, fila, activa,
                           creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $9)
         RETURNING id`,
        {
          bind: [
            this.contexto.empresaActual(),
            sucursalId,
            zonaId,
            datos.nombre,
            datos.capacidad,
            datos.forma,
            datos.columna,
            datos.fila,
            this.reloj.ahora(),
          ],
          type: QueryTypes.SELECT,
        },
      );
      id = filas[0]!.id;
    } catch (error) {
      throw this.traducirUnicidad(error);
    }
    await this.auditoria.registrar({
      accion: 'crear_mesa',
      sucursalId,
      entidad: 'mesa',
      entidadId: id,
      detalle: { sucursalId, ...datos },
    });
    return (await this.leer(id))!;
  }

  /**
   * Criterio 4: aplica las reglas del criterio 3 sobre el resultado. Se puede cambiar de celda o de zona una mesa
   * con orden abierta (es solo el dibujo); desactivarla con orden abierta responde 409 `EN_USO`. Una zona que no
   * es de la sucursal (o no existe) en `zonaId` responde 422 `REFERENCIA_INVALIDA`. Sin cambios, 200 sin
   * auditoría.
   */
  async modificar(
    sucursalId: string,
    id: string,
    cambios: MesaModificarEntrada,
  ): Promise<MesaRespuesta> {
    await this.exigirSucursal(sucursalId);
    await tomarTurnoDelMapa(this.conexion, sucursalId);
    const filas = await this.conexion.query<FilaMesaActual>(
      `SELECT zona_id, nombre, capacidad, forma, columna, fila, activa FROM mesa
        WHERE id = $1 AND sucursal_id = $2 FOR UPDATE`,
      { bind: [id, sucursalId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) throw noEncontrado('La mesa');
    const actual: DatosDeMesa = {
      zonaId: fila.zona_id,
      nombre: fila.nombre,
      capacidad: fila.capacidad,
      forma: fila.forma,
      columna: fila.columna,
      fila: fila.fila,
      activa: fila.activa,
    };

    const zonaId = cambios.zonaId ?? actual.zonaId;
    const zona = await this.zonaDeLaSucursal(zonaId, sucursalId);
    if (zona === undefined) {
      throw referenciaInvalida([{ campo: 'zonaId', mensaje: 'La zona no existe en la sucursal' }]);
    }
    const despues: DatosDeMesa = {
      zonaId,
      nombre: cambios.nombre ?? actual.nombre,
      capacidad: cambios.capacidad ?? actual.capacidad,
      forma: cambios.forma ?? actual.forma,
      columna: cambios.columna ?? actual.columna,
      fila: cambios.fila ?? actual.fila,
      activa: cambios.activa ?? actual.activa,
    };
    const diff: Record<string, { antes: unknown; despues: unknown }> = {};
    for (const campo of CAMPOS_AUDITADOS) {
      if (actual[campo] !== despues[campo]) {
        diff[campo] = { antes: actual[campo], despues: despues[campo] };
      }
    }
    if (Object.keys(diff).length === 0) return (await this.leer(id))!;

    const tocaLaCelda =
      cambios.columna !== undefined || cambios.fila !== undefined || cambios.zonaId !== undefined;
    if (despues.activa || tocaLaCelda) {
      await this.validarResultado(sucursalId, id, despues, zona, { soloCelda: !despues.activa });
    }
    if (actual.activa && !despues.activa) {
      if ((await this.uso.conOrdenAbierta([id])).has(id)) {
        throw enUso(
          'Esta mesa tiene una orden abierta. Libérala, anúlala o cóbrala antes de desactivar la mesa',
        );
      }
    }
    try {
      await this.conexion.query(
        `UPDATE mesa SET zona_id = $2, nombre = $3, capacidad = $4, forma = $5, columna = $6, fila = $7,
                         activa = $8, actualizado_en = $9
          WHERE id = $1`,
        {
          bind: [
            id,
            despues.zonaId,
            despues.nombre,
            despues.capacidad,
            despues.forma,
            despues.columna,
            despues.fila,
            despues.activa,
            this.reloj.ahora(),
          ],
        },
      );
    } catch (error) {
      throw this.traducirUnicidad(error);
    }
    await this.auditoria.registrar({
      accion: 'modificar_mesa',
      sucursalId,
      entidad: 'mesa',
      entidadId: id,
      detalle: { sucursalId, ...diff },
    });
    return (await this.leer(id))!;
  }

  /**
   * Reglas del criterio 3 sobre el resultado: la zona activa, la celda dentro de su cuadrícula (400) y, si la mesa
   * queda activa, nombre y celda sin otra mesa activa (409). `id` es la mesa que se modifica (no choca consigo
   * misma). Con `soloCelda`, solo la cuadrícula.
   */
  private async validarResultado(
    sucursalId: string,
    id: string | null,
    datos: DatosDeMesa,
    zona: FilaZona,
    opciones: { soloCelda?: boolean } = {},
  ): Promise<void> {
    const fuera: CampoError[] = [];
    if (datos.columna > zona.columnas) {
      fuera.push({ campo: 'columna', mensaje: `Debe estar entre 1 y ${zona.columnas}` });
    }
    if (datos.fila > zona.filas) {
      fuera.push({ campo: 'fila', mensaje: `Debe estar entre 1 y ${zona.filas}` });
    }
    if (fuera.length > 0) throw datosInvalidos(fuera);
    if (opciones.soloCelda) return;
    if (!zona.activa) {
      throw conflicto('La zona está desactivada; actívala antes de poner mesas en ella', [
        { campo: 'zonaId', mensaje: 'La zona está desactivada' },
      ]);
    }
    const choques = await this.conexion.query<{ nombre_repetido: boolean; celda_ocupada: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM mesa WHERE sucursal_id = $1 AND activa AND lower(nombre) = lower($3)
                       AND ($2::uuid IS NULL OR id <> $2)) AS nombre_repetido,
              EXISTS (SELECT 1 FROM mesa WHERE zona_id = $4 AND activa AND columna = $5 AND fila = $6
                       AND ($2::uuid IS NULL OR id <> $2)) AS celda_ocupada`,
      {
        bind: [sucursalId, id, datos.nombre, datos.zonaId, datos.columna, datos.fila],
        type: QueryTypes.SELECT,
      },
    );
    const { nombre_repetido: nombre, celda_ocupada: celda } = choques[0]!;
    if (nombre || celda) throw conflictoDeMesa(nombre, celda);
  }

  /** Traduce el rechazo de un índice único (por si una carrera se cuela) a su 409. */
  private traducirUnicidad(error: unknown): unknown {
    if (sqlstateDe(error) !== SQLSTATE.VIOLACION_UNICIDAD) return error;
    const restriccion = restriccionDe(error);
    if (restriccion === INDICE_NOMBRE) return conflictoDeMesa(true, false);
    if (restriccion === INDICE_CELDA) return conflictoDeMesa(false, true);
    return error;
  }

  /** La zona si es de la sucursal (la RLS ya la limita a la empresa); `undefined` si no. */
  private async zonaDeLaSucursal(
    zonaId: string,
    sucursalId: string,
  ): Promise<FilaZona | undefined> {
    const filas = await this.conexion.query<FilaZona>(
      'SELECT id, columnas, filas, activa FROM zona WHERE id = $1 AND sucursal_id = $2',
      { bind: [zonaId, sucursalId], type: QueryTypes.SELECT },
    );
    return filas[0];
  }

  private async leer(id: string): Promise<MesaRespuesta | undefined> {
    const filas = await this.conexion.query<Parameters<typeof aMesa>[0]>(
      `SELECT ${COLUMNAS_MESA} FROM mesa m WHERE m.id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    return filas[0] === undefined ? undefined : aMesa(filas[0]);
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw noEncontrado('La sucursal');
  }
}
