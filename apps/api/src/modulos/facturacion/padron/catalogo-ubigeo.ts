import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import type { LugarDeUbigeo } from './lineas-del-padron';

/**
 * El catálogo de ubigeo del INEI (departamento, provincia y distrito de cada código de seis dígitos), de
 * `apps/api/datos/ubigeo.csv` (UTF-8, `codigo,departamento,provincia,distrito`, sin comillas). Se carga en
 * `referencia.ubigeo` cuando la tabla está vacía o cambió el archivo (criterio 138).
 */
export const RUTA_DEL_CATALOGO_DE_UBIGEO = resolve(__dirname, '../../../../datos/ubigeo.csv');

export interface FilaDeUbigeo extends LugarDeUbigeo {
  codigo: string;
}

export interface CatalogoDeUbigeo {
  /** La versión del archivo: el comienzo de su SHA-256 (cambia cuando cambia su contenido). */
  version: string;
  filas: FilaDeUbigeo[];
}

/** Lee y valida el archivo del catálogo. */
export async function leerCatalogoDeUbigeo(
  ruta: string = RUTA_DEL_CATALOGO_DE_UBIGEO,
): Promise<CatalogoDeUbigeo> {
  const contenido = await readFile(ruta);
  const version = createHash('sha256').update(contenido).digest('hex').slice(0, 16);
  const lineas = contenido
    .toString('utf8')
    .split(/\r?\n/)
    .filter((l) => l !== '');
  if (lineas[0] !== 'codigo,departamento,provincia,distrito') {
    throw new Error('El catálogo de ubigeo no tiene la cabecera esperada');
  }
  const vistos = new Set<string>();
  const filas = lineas.slice(1).map((linea, i) => {
    const [codigo, departamento, provincia, distrito, ...sobra] = linea.split(',');
    if (
      codigo === undefined ||
      !/^\d{6}$/.test(codigo) ||
      !departamento ||
      !provincia ||
      !distrito ||
      sobra.length > 0 ||
      vistos.has(codigo)
    ) {
      throw new Error(`El catálogo de ubigeo tiene una fila inválida (línea ${i + 2})`);
    }
    vistos.add(codigo);
    return { codigo, departamento, provincia, distrito };
  });
  if (filas.length === 0) throw new Error('El catálogo de ubigeo está vacío');
  return { version, filas };
}

/**
 * Deja `referencia.ubigeo` con el catálogo del archivo si la tabla está vacía o es de otra versión (en una transacción,
 * con `TRUNCATE` y una sola inserción), y devuelve los lugares por código para componer las direcciones.
 */
export async function sincronizarUbigeo(
  cliente: Client,
  ruta?: string,
): Promise<Map<string, LugarDeUbigeo>> {
  const catalogo = await leerCatalogoDeUbigeo(ruta);
  const actual = await cliente.query<{ version: string; n: string }>(
    'SELECT min(version) AS version, count(DISTINCT version) AS n FROM referencia.ubigeo',
  );
  const vigente = actual.rows[0]?.n === '1' && actual.rows[0].version === catalogo.version;
  if (!vigente) {
    await cliente.query('BEGIN');
    try {
      await cliente.query('TRUNCATE referencia.ubigeo');
      await cliente.query(
        `INSERT INTO referencia.ubigeo (codigo, departamento, provincia, distrito, version)
         SELECT c, d, p, t, $5 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS u (c, d, p, t)`,
        [
          catalogo.filas.map((f) => f.codigo),
          catalogo.filas.map((f) => f.departamento),
          catalogo.filas.map((f) => f.provincia),
          catalogo.filas.map((f) => f.distrito),
          catalogo.version,
        ],
      );
      await cliente.query('COMMIT');
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  return new Map(
    catalogo.filas.map((f) => [
      f.codigo,
      { departamento: f.departamento, provincia: f.provincia, distrito: f.distrito },
    ]),
  );
}
