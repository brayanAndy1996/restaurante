import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { conflicto, noEncontrado } from './errores-salon';

/** El código de una mesa tal como se guarda en `mesa_qr` (historia 005, criterio 6). */
export interface CodigoDeMesa {
  /** Id de la fila de `mesa_qr` (la entidad de la auditoría). */
  id: string;
  mesaId: string;
  /** 22 caracteres base64url (`CODIGO_MESA_REGEX`). */
  codigo: string;
  generadoEn: Date;
}

/** La mesa a la que lleva un código, vista dentro del contexto de su empresa (criterios 10 y 14). */
export interface MesaDeCodigo {
  mesaId: string;
  nombre: string;
  sucursalId: string;
  /** Una mesa inactiva no responde en las rutas públicas. */
  activa: boolean;
}

/** Una mesa de la hoja de QR de una sucursal, con su código si ya lo tiene (criterio 7). */
export interface MesaDeHoja {
  mesaId: string;
  zona: { id: string; nombre: string };
  nombre: string;
  codigo: string | null;
  generadoEn: Date | null;
}

interface FilaCodigo {
  id: string;
  mesa_id: string;
  codigo: string;
  generado_en: Date;
}

const aCodigo = (f: FilaCodigo): CodigoDeMesa => ({
  id: f.id,
  mesaId: f.mesa_id,
  codigo: f.codigo,
  generadoEn: f.generado_en,
});

/** Un código nuevo: 16 bytes al azar en base64url sin relleno (22 caracteres, 128 bits). */
export const generarCodigoDeMesa = (): string => randomBytes(16).toString('base64url');

/** Intentos para crear un código ante un choque (prácticamente imposible con 128 bits). */
const INTENTOS_DE_CODIGO = 2;

const COLUMNAS_CODIGO = 'id, mesa_id, codigo, generado_en';

/**
 * Códigos QR de las mesas (historia 005, criterios 6 a 10): dueño de `mesa_qr` (la identidad pública de cada mesa).
 * Los demás módulos lo usan por este servicio, nunca consultando la tabla. Corre en la transacción de la empresa
 * del contexto activo, así que la RLS limita todo a la propia empresa. El espejo `carta_publica.codigo_mesa` lo
 * mantiene un trigger de la base en la misma transacción: aquí nunca se toca.
 */
@Injectable()
export class CodigosMesaService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /**
   * Crea el código de una mesa (16 bytes de `crypto.randomBytes` en base64url) en la transacción actual. Lo llaman
   * `MesasService.crear` y `crearFaltantes`. Un choque (prácticamente imposible) reintenta una vez con otro código
   * y, si vuelve a fallar, 409 `CONFLICTO`. Si la mesa ya tenía código (otra petición se adelantó), devuelve ese.
   * Una mesa que no existe en la empresa, 404.
   */
  async crearPara(mesaId: string): Promise<CodigoDeMesa> {
    const creados = await this.crearParaMesas([mesaId]);
    const codigo = creados[0];
    if (codigo === undefined) throw noEncontrado('La mesa');
    return codigo;
  }

  /**
   * Crea el código de cada mesa activa de la sucursal que no lo tenga y devuelve cuántos creó (criterio 8). Repetirlo
   * no cambia ningún código.
   */
  async crearFaltantes(sucursalId: string): Promise<number> {
    const faltantes = await this.conexion.query<{ id: string }>(
      `SELECT m.id FROM mesa m
        WHERE m.sucursal_id = $1 AND m.activa
          AND NOT EXISTS (SELECT 1 FROM mesa_qr q WHERE q.mesa_id = m.id)
        ORDER BY m.id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    if (faltantes.length === 0) return 0;
    return (await this.crearParaMesas(faltantes.map((f) => f.id))).creadasAhora;
  }

  /**
   * Cambia el código de la mesa por uno nuevo, bloqueando su fila de `mesa_qr` (`FOR UPDATE`); desde que se
   * confirma, el anterior no se encuentra (criterio 9). Una mesa sin código (creada antes de la sección) recibe el
   * primero. La mesa debe existir (el llamador ya verificó su sucursal y que esté activa).
   */
  async cambiar(mesaId: string): Promise<CodigoDeMesa> {
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM mesa_qr WHERE mesa_id = $1 FOR UPDATE',
      { bind: [mesaId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) return this.crearPara(mesaId);
    const ahora = this.reloj.ahora();
    try {
      const nuevas = await this.conexion.query<FilaCodigo>(
        `UPDATE mesa_qr SET codigo = $2, generado_en = $3, actualizado_en = $3
          WHERE id = $1 RETURNING ${COLUMNAS_CODIGO}`,
        { bind: [filas[0].id, generarCodigoDeMesa(), ahora], type: QueryTypes.SELECT },
      );
      return aCodigo(nuevas[0]!);
    } catch (error) {
      // Un choque de código (prácticamente imposible): la transacción ya no sirve, la petición se reintenta.
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
        throw conflicto('No se pudo generar un código nuevo. Vuelve a intentarlo', []);
      }
      throw error;
    }
  }

  /**
   * Las mesas activas de las zonas activas de la sucursal en el orden del mapa, cada una con su código si lo
   * tiene (criterio 7), en una sola consulta.
   */
  async listarDeSucursal(sucursalId: string): Promise<MesaDeHoja[]> {
    const filas = await this.conexion.query<{
      mesa_id: string;
      zona_id: string;
      zona_nombre: string;
      nombre: string;
      codigo: string | null;
      generado_en: Date | null;
    }>(
      `SELECT m.id AS mesa_id, z.id AS zona_id, z.nombre AS zona_nombre, m.nombre, q.codigo, q.generado_en
         FROM mesa m
         JOIN zona z ON z.id = m.zona_id
         LEFT JOIN mesa_qr q ON q.mesa_id = m.id
        WHERE m.sucursal_id = $1 AND m.activa AND z.activa
        ORDER BY z.orden, z.id, m.fila, m.columna, m.id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return filas.map((f) => ({
      mesaId: f.mesa_id,
      zona: { id: f.zona_id, nombre: f.zona_nombre },
      nombre: f.nombre,
      codigo: f.codigo,
      generadoEn: f.generado_en,
    }));
  }

  /**
   * La mesa de un código bajo la RLS de la empresa del contexto (mesa unida a `mesa_qr`), o `null` si el código no
   * existe en esta empresa. Devuelve también las mesas inactivas: quien llama responde 404 si `activa` es `false`.
   * La empresa del código se busca antes y fuera del contexto con `buscarEmpresaDeCodigoMesa`.
   */
  resolver(codigo: string): Promise<MesaDeCodigo | null> {
    return this.leerPorCodigo(codigo, false);
  }

  /**
   * Lo mismo que `resolver`, bloqueando la fila de `mesa_qr` con `FOR UPDATE`: serializa los llamados de la misma
   * mesa (criterio 30). No bloquea la fila de `mesa`.
   */
  bloquearPorCodigo(codigo: string): Promise<MesaDeCodigo | null> {
    return this.leerPorCodigo(codigo, true);
  }

  private async leerPorCodigo(codigo: string, bloquear: boolean): Promise<MesaDeCodigo | null> {
    const filas = await this.conexion.query<{
      mesa_id: string;
      nombre: string;
      sucursal_id: string;
      activa: boolean;
    }>(
      `SELECT m.id AS mesa_id, m.nombre, m.sucursal_id, m.activa
         FROM mesa_qr q
         JOIN mesa m ON m.id = q.mesa_id
        WHERE q.codigo = $1${bloquear ? ' FOR UPDATE OF q' : ''}`,
      { bind: [codigo], type: QueryTypes.SELECT },
    );
    const f = filas[0];
    if (f === undefined) return null;
    return { mesaId: f.mesa_id, nombre: f.nombre, sucursalId: f.sucursal_id, activa: f.activa };
  }

  /**
   * Inserta un código por mesa en una sola sentencia. `ON CONFLICT DO NOTHING` cubre un código repetido (el índice
   * único de `mesa_qr` lo ve aunque sea de otra empresa) y una mesa que otra petición ya resolvió, sin abortar la
   * transacción; lo que no entró se reintenta una vez con códigos nuevos. `creadasAhora` cuenta solo las filas que
   * esta llamada insertó.
   */
  private async crearParaMesas(
    mesaIds: readonly string[],
  ): Promise<CodigoDeMesa[] & { creadasAhora: number }> {
    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();
    let pendientes = [...new Set(mesaIds)];
    let creadasAhora = 0;
    for (let intento = 0; intento < INTENTOS_DE_CODIGO && pendientes.length > 0; intento += 1) {
      const insertadas = await this.conexion.query<FilaCodigo>(
        `INSERT INTO mesa_qr (empresa_id, mesa_id, sucursal_id, codigo, generado_en, creado_en, actualizado_en)
         SELECT $1, m.id, m.sucursal_id, t.codigo, $4, $4, $4
           FROM unnest($2::uuid[], $3::text[]) AS t(mesa_id, codigo)
           JOIN mesa m ON m.id = t.mesa_id
         ON CONFLICT DO NOTHING
         RETURNING ${COLUMNAS_CODIGO}`,
        {
          bind: [empresaId, pendientes, pendientes.map(generarCodigoDeMesa), ahora],
          type: QueryTypes.SELECT,
        },
      );
      creadasAhora += insertadas.length;
      const hechas = new Set(insertadas.map((f) => f.mesa_id));
      pendientes = pendientes.filter((id) => !hechas.has(id));
      if (pendientes.length > 0) {
        // Una mesa que otra petición resolvió entre tanto ya tiene su código: no se reintenta.
        const conCodigo = await this.conexion.query<{ mesa_id: string }>(
          'SELECT mesa_id FROM mesa_qr WHERE mesa_id = ANY($1::uuid[])',
          { bind: [pendientes], type: QueryTypes.SELECT },
        );
        const ya = new Set(conCodigo.map((f) => f.mesa_id));
        pendientes = pendientes.filter((id) => !ya.has(id));
      }
    }
    if (pendientes.length > 0) {
      const existentes = await this.conexion.query<{ id: string }>(
        'SELECT id FROM mesa WHERE id = ANY($1::uuid[])',
        { bind: [pendientes], type: QueryTypes.SELECT },
      );
      // Una mesa que no existe (o es de otra empresa) se trata como inexistente; con mesas reales sin código, un
      // choque repetido de 128 bits, que no ocurre en la práctica.
      if (existentes.length < pendientes.length) throw noEncontrado('La mesa');
      throw conflicto('No se pudo generar el código de la mesa. Vuelve a intentarlo', []);
    }
    const filas = await this.conexion.query<FilaCodigo>(
      `SELECT ${COLUMNAS_CODIGO} FROM mesa_qr WHERE mesa_id = ANY($1::uuid[]) ORDER BY mesa_id`,
      { bind: [[...new Set(mesaIds)]], type: QueryTypes.SELECT },
    );
    return Object.assign(filas.map(aCodigo), { creadasAhora });
  }
}
