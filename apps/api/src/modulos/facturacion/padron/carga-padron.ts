import { Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import * as unzipper from 'unzipper';
import { ENTORNO, type Entorno } from '../../../config/entorno';
import { RELOJ, type Reloj } from '../../../nucleo/reloj';
import { sincronizarUbigeo } from './catalogo-ubigeo';
import { leerLinea, lineasDe, type FilaDelPadron, type LugarDeUbigeo } from './lineas-del-padron';

/** Lo que dejó una carga del padrón (criterio 138). */
export interface ResultadoCargaPadron {
  /** Filas cargadas en la tabla inactiva. */
  filas: number;
  /** `true` si la carga cambió la tabla activa (terminó bien y tiene al menos el 90 % de las filas de la anterior). */
  activada: boolean;
}

/** Actor de la carga del padrón en los registros (`referencia` no es una tabla de clientes, criterio 163). */
export const ACTOR_WORKER_PADRON = 'worker:padron';

/** Cuánto puede tardar la descarga completa (el archivo real pesa cerca de 400 MB). */
const TIEMPO_MAXIMO_DE_DESCARGA_MS = 90 * 60_000;
/** Cuántas filas lleva cada `INSERT`. */
const FILAS_POR_LOTE = 5_000;
/** Una carga necesita al menos este porcentaje de las filas de la anterior para cambiar la tabla activa. */
const PORCENTAJE_MINIMO = 90;
/** Clave del cerrojo consultivo que impide dos cargas a la vez, aunque haya dos procesos. */
const CERROJO_DE_CARGA = 3_606_001;

/** Un motivo de rechazo que se puede mostrar al superadministrador (nunca lleva contenido del archivo). */
class CargaRechazada extends Error {}

interface Origen {
  flujo: Readable;
  /** La fecha del archivo (`Last-Modified` o la modificación del archivo local), si se conoce. */
  fecha: Date | null;
}

/**
 * La carga del padrón reducido de RUC de SUNAT (historia 006, entrega 6b, criterio 138): descarga y descomprime en
 * flujo (sin guardar el archivo entero en memoria ni en disco), decodifica ISO-8859-1, escribe por lotes en la tabla
 * inactiva (`referencia.padron_ruc_a` o `_b`) con el rol `restaurante_referencia` (`DATABASE_REFERENCIA_URL`) y solo
 * cambia la tabla activa, en una transacción, si terminó sin errores y trae al menos el 90 % de las filas de la carga
 * anterior. Las búsquedas nunca ven una carga a medias. Se registran tiempos y filas, nunca contenidos.
 *
 * Una carga que falla no lanza: deja el motivo en `padron_estado.ultimo_error`, registra `padron.carga_fallida` y
 * devuelve `{ filas: 0, activada: false }`. Dos cargas a la vez (aun en procesos distintos) no se pisan: la segunda no hace
 * nada.
 */
@Injectable()
export class CargaPadron {
  private readonly logger = new Logger(CargaPadron.name);

  constructor(
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  async cargar(): Promise<ResultadoCargaPadron> {
    const url = this.entorno.DATABASE_REFERENCIA_URL;
    if (url === undefined) {
      this.registrarFallo('sin_conexion');
      return { filas: 0, activada: false };
    }
    const cliente = new Client({
      connectionString: url,
      application_name: 'restaurante-padron',
      connectionTimeoutMillis: 10_000,
    });
    cliente.on('error', (error: Error) => {
      this.logger.warn(JSON.stringify({ evento: 'padron.conexion_perdida', error: error.name }));
    });
    const inicio = Date.now();
    try {
      await cliente.connect();
    } catch (error) {
      this.registrarFallo('sin_conexion', error);
      return { filas: 0, activada: false };
    }
    try {
      const cerrojo = await cliente.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS ok',
        [CERROJO_DE_CARGA],
      );
      if (cerrojo.rows[0]?.ok !== true) {
        this.logger.warn(JSON.stringify({ evento: 'padron.carga_en_curso' }));
        return { filas: 0, activada: false };
      }
      try {
        return await this.cargarConCerrojo(cliente, inicio);
      } finally {
        await cliente.query('SELECT pg_advisory_unlock($1)', [CERROJO_DE_CARGA]).catch(() => {
          // La conexión se cierra a continuación y con ella el cerrojo.
        });
      }
    } finally {
      await cliente.end().catch(() => undefined);
    }
  }

  private async cargarConCerrojo(cliente: Client, inicio: number): Promise<ResultadoCargaPadron> {
    const ahora = this.reloj.ahora();
    let origen: Origen | null = null;
    try {
      await cliente.query(
        `INSERT INTO referencia.padron_estado (ultimo_intento_en) VALUES ($1)
         ON CONFLICT ((true)) DO UPDATE SET ultimo_intento_en = EXCLUDED.ultimo_intento_en`,
        [ahora],
      );
      const estado = await cliente.query<{ tabla_activa: string | null; filas: number | null }>(
        'SELECT tabla_activa, filas FROM referencia.padron_estado',
      );
      const activa = estado.rows[0]?.tabla_activa ?? null;
      const anteriores = estado.rows[0]?.filas ?? null;
      const inactiva = activa === 'a' ? 'b' : 'a';

      const ubigeos = await sincronizarUbigeo(cliente);
      // Se abre el archivo antes de vaciar la tabla: una dirección caída no deja nada a medias.
      origen = await this.abrir(this.entorno.PADRON_RUC_URL);

      await cliente.query(`TRUNCATE referencia.padron_ruc_${inactiva}`);
      let filas = 0;
      for await (const lote of this.lotes(origen.flujo, ubigeos)) {
        const insertadas = await cliente.query(
          `INSERT INTO referencia.padron_ruc_${inactiva} (ruc, razon_social, estado, condicion, ubigeo, direccion)
           SELECT ruc, razon_social, estado, condicion, ubigeo, direccion
             FROM json_to_recordset($1::json)
               AS x (ruc text, razon_social text, estado text, condicion text, ubigeo text, direccion text)
           ON CONFLICT (ruc) DO NOTHING`,
          [JSON.stringify(lote)],
        );
        // Un RUC repetido en el archivo cuenta una sola vez.
        filas += insertadas.rowCount ?? 0;
      }

      if (filas === 0) throw new CargaRechazada('sin_filas');
      if (anteriores !== null && filas * 100 < anteriores * PORCENTAJE_MINIMO) {
        throw new CargaRechazada(`pocas_filas: ${filas} de ${anteriores}`);
      }

      await cliente.query('BEGIN');
      try {
        await cliente.query(
          `UPDATE referencia.padron_estado
              SET tabla_activa = $1, cargado_en = $2, filas = $3, fecha_archivo = $4, ultimo_error = NULL`,
          [inactiva, this.reloj.ahora(), filas, origen.fecha],
        );
        await cliente.query('COMMIT');
      } catch (error) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      this.logger.log(
        JSON.stringify({
          evento: 'padron.cargado',
          filas,
          tabla: inactiva,
          segundos: Math.round((Date.now() - inicio) / 100) / 10,
        }),
      );
      return { filas, activada: true };
    } catch (error) {
      origen?.flujo.destroy();
      const motivo = this.motivoDe(error);
      this.registrarFallo(motivo, error);
      await cliente
        .query('ROLLBACK')
        .catch(() => undefined)
        .then(() =>
          cliente.query('UPDATE referencia.padron_estado SET ultimo_error = $1', [motivo]),
        )
        .catch(() => undefined);
      return { filas: 0, activada: false };
    }
  }

  /** El motivo que se guarda y se muestra: nuestro propio texto o la clase del error, nunca el contenido del archivo. */
  private motivoDe(error: unknown): string {
    if (error instanceof CargaRechazada) return error.message;
    const codigo =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    const nombre = error instanceof Error ? error.name : 'Error';
    return `error: ${nombre}${codigo === '' ? '' : ` ${codigo}`}`;
  }

  private registrarFallo(motivo: string, error?: unknown): void {
    this.logger.warn(
      JSON.stringify({
        evento: 'padron.carga_fallida',
        motivo,
        ...(error instanceof Error ? { clase: error.name } : {}),
      }),
    );
  }

  /** Abre el archivo: `file://` (las pruebas) o `http(s)://` (SUNAT). */
  private async abrir(url: string): Promise<Origen> {
    if (url.startsWith('file:')) {
      const ruta = fileURLToPath(url);
      const info = await stat(ruta);
      return { flujo: createReadStream(ruta), fecha: info.mtime };
    }
    const respuesta = await fetch(url, {
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_DE_DESCARGA_MS),
    });
    if (!respuesta.ok || respuesta.body === null) {
      await respuesta.body?.cancel().catch(() => undefined);
      throw new CargaRechazada(`descarga: HTTP ${respuesta.status}`);
    }
    const modificado = respuesta.headers.get('last-modified');
    const fecha = modificado === null ? null : new Date(modificado);
    return {
      flujo: Readable.fromWeb(respuesta.body as import('node:stream/web').ReadableStream),
      fecha: fecha !== null && !Number.isNaN(fecha.getTime()) ? fecha : null,
    };
  }

  /** Descomprime el ZIP en flujo y entrega el primer archivo que trae. */
  private async *contenidoDelZip(origen: Readable): AsyncGenerator<Buffer> {
    const lector = unzipper.Parse({ forceStream: true });
    // El error del origen (red cortada, archivo que no existe) llega a quien recorre el lector.
    origen.on('error', (error) => lector.destroy(error));
    origen.pipe(lector);
    let tomado = false;
    for await (const entrada of lector as AsyncIterable<unzipper.Entry>) {
      if (!tomado && entrada.type === 'File') {
        tomado = true;
        for await (const trozo of entrada) yield trozo as Buffer;
      } else {
        entrada.autodrain();
      }
    }
    if (!tomado) throw new CargaRechazada('archivo: el ZIP no trae ningún archivo');
  }

  /**
   * Las filas válidas del archivo en lotes. Se insertan con `INSERT … json_to_recordset` y no con `COPY`: las tablas de
   * `referencia` tienen RLS y PostgreSQL no admite `COPY FROM` en una tabla con RLS para un rol que no es su dueño.
   */
  private async *lotes(
    origen: Readable,
    ubigeos: ReadonlyMap<string, LugarDeUbigeo>,
  ): AsyncGenerator<Record<string, string | null>[]> {
    let lote: Record<string, string | null>[] = [];
    for await (const linea of lineasDe(this.contenidoDelZip(origen))) {
      const fila: FilaDelPadron | null = leerLinea(linea, ubigeos);
      if (fila === null) continue;
      lote.push({
        ruc: fila.ruc,
        razon_social: fila.razonSocial,
        estado: fila.estado,
        condicion: fila.condicion,
        ubigeo: fila.ubigeo,
        direccion: fila.direccion,
      });
      if (lote.length >= FILAS_POR_LOTE) {
        yield lote;
        lote = [];
      }
    }
    if (lote.length > 0) yield lote;
  }
}
