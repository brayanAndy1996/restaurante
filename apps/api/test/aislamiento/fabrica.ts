// spec: 001-base-multitenancy (pruebas protegidas)
//
// Ayudantes compartidos por las pruebas de aislamiento. No dependen de la implementación de la API:
// crean empresas a nivel SQL con un cliente `restaurante_plataforma` (política `acceso_plataforma`) y
// ejecutan sentencias como `restaurante_api` fijando el contexto por su cuenta con
// `SELECT fijar_contexto_empresa($1)` (criterio 22e).
import { randomInt, randomUUID } from 'node:crypto';
import { validarRuc } from '@restaurante/dominio';
import type { RegistrarEmpresaEntrada } from '@restaurante/contratos';
import type { Client, DatabaseError } from 'pg';

const FACTORES_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** RUC válido (prefijo 20 por defecto, dígito verificador calculado) y aleatorio: único entre archivos paralelos. */
export function rucAleatorio(prefijo: '10' | '15' | '16' | '17' | '20' = '20'): string {
  const cuerpo = prefijo + String(randomInt(0, 100_000_000)).padStart(8, '0');
  let suma = 0;
  for (let i = 0; i < FACTORES_RUC.length; i++)
    suma += Number(cuerpo[i]) * (FACTORES_RUC[i] as number);
  const resto = 11 - (suma % 11);
  const ruc = cuerpo + String(resto >= 10 ? resto - 10 : resto);
  if (!validarRuc(ruc)) throw new Error(`El ayudante generó un RUC inválido: ${ruc}`);
  return ruc;
}

/** Texto único por llamada (nombres de empresa, sucursal, actor, motivo…). */
export function textoUnico(prefijo: string): string {
  return `${prefijo}-${randomUUID().slice(0, 12)}`;
}

/** Entrada válida de `registrarEmpresa`: `emisores` emisores y `sucursalesPorEmisor` sucursales de cada uno. */
export function datosDeEmpresa(
  opciones: { emisores?: number; sucursalesPorEmisor?: number } = {},
): RegistrarEmpresaEntrada & { nombre: string } {
  const cantidadEmisores = opciones.emisores ?? 1;
  const sucursalesPorEmisor = opciones.sucursalesPorEmisor ?? 2;
  const emisores = Array.from({ length: cantidadEmisores }, (_, i) => ({
    ruc: rucAleatorio(),
    razonSocial: `Razón social ${i + 1} ${textoUnico('rs')}`,
    regimen: 'GENERAL' as const,
  }));
  const sucursales = emisores.flatMap((emisor) =>
    Array.from({ length: sucursalesPorEmisor }, (_, j) => ({
      rucEmisor: emisor.ruc,
      nombre: textoUnico('Sucursal'),
      codigoEstablecimiento: String(j + 1).padStart(4, '0'),
      direccion: `Av. Prueba ${randomInt(1, 9999)}, Lima`,
    })),
  );
  return { nombre: textoUnico('Empresa'), emisores, sucursales };
}

export interface SucursalSql {
  id: string;
  nombre: string;
  codigoEstablecimiento: string;
  emisorId: string;
}

export interface EmpresaSql {
  id: string;
  nombre: string;
  emisores: { id: string; ruc: string }[];
  sucursales: SucursalSql[];
}

/**
 * Crea una empresa completa por SQL con un cliente `restaurante_plataforma` (autocommit).
 * Por defecto: un emisor y dos sucursales. Las sucursales se reparten entre los emisores.
 */
export async function crearEmpresaSql(
  plataforma: Client,
  opciones: { emisores?: number; sucursales?: number } = {},
): Promise<EmpresaSql> {
  const cantidadEmisores = opciones.emisores ?? 1;
  const cantidadSucursales = opciones.sucursales ?? 2;
  const nombre = textoUnico('Empresa');
  const empresa = await plataforma.query<{ id: string }>(
    'INSERT INTO empresa (nombre, creado_en, actualizado_en) VALUES ($1, now(), now()) RETURNING id',
    [nombre],
  );
  const empresaId = empresa.rows[0]!.id;

  const emisores: EmpresaSql['emisores'] = [];
  for (let i = 0; i < cantidadEmisores; i++) {
    const ruc = rucAleatorio();
    const fila = await plataforma.query<{ id: string }>(
      `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
       VALUES ($1, $2, $3, 'GENERAL', now(), now()) RETURNING id`,
      [empresaId, ruc, `Razón social ${i + 1}`],
    );
    emisores.push({ id: fila.rows[0]!.id, ruc });
  }

  const sucursales: SucursalSql[] = [];
  for (let i = 0; i < cantidadSucursales; i++) {
    const emisor = emisores[i % emisores.length]!;
    const codigo = String(Math.floor(i / emisores.length) + 1).padStart(4, '0');
    const nombreSucursal = textoUnico('Sucursal');
    const fila = await plataforma.query<{ id: string }>(
      `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING id`,
      [empresaId, emisor.id, nombreSucursal, codigo, `Calle ${i + 1} 123, Lima`],
    );
    sucursales.push({
      id: fila.rows[0]!.id,
      nombre: nombreSucursal,
      codigoEstablecimiento: codigo,
      emisorId: emisor.id,
    });
  }
  return { id: empresaId, nombre, emisores, sucursales };
}

/**
 * Corre `fn` dentro de una transacción de `cliente`. Si `empresaId` no es `null`, la primera
 * sentencia es `SELECT fijar_contexto_empresa($1)` (criterio 22e). Termina con ROLLBACK salvo que se
 * pida `confirmar`; si `fn` lanza, revierte y relanza.
 */
export async function enTransaccion<T>(
  cliente: Client,
  empresaId: string | null,
  fn: () => Promise<T>,
  opciones: { confirmar?: boolean } = {},
): Promise<T> {
  await cliente.query('BEGIN');
  try {
    if (empresaId !== null) {
      await cliente.query('SELECT fijar_contexto_empresa($1)', [empresaId]);
    }
    const resultado = await fn();
    await cliente.query(opciones.confirmar ? 'COMMIT' : 'ROLLBACK');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  }
}

/**
 * Como `enTransaccion`, pero la única "fijación" es `set_config('app.empresa_id', valor, true)`, sin
 * `fijar_contexto_empresa`. Desde el criterio 22e eso NO da contexto (la RLS no lee el parámetro): sirve
 * para los intentos que deben fallar (criterios 19, 21 y 22e inciso c).
 */
export async function enTransaccionConSetConfig<T>(
  cliente: Client,
  valor: string,
  fn: () => Promise<T>,
  opciones: { confirmar?: boolean } = {},
): Promise<T> {
  await cliente.query('BEGIN');
  try {
    await cliente.query("SELECT set_config('app.empresa_id', $1, true)", [valor]);
    const resultado = await fn();
    await cliente.query(opciones.confirmar ? 'COMMIT' : 'ROLLBACK');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  }
}

/** Espera que la promesa falle y devuelve el error de PostgreSQL; si tiene éxito, falla la prueba. */
export async function errorDe(promesa: Promise<unknown>): Promise<DatabaseError> {
  try {
    await promesa;
  } catch (error) {
    return error as DatabaseError;
  }
  throw new Error('Se esperaba que la sentencia fallara, pero tuvo éxito');
}

/** Foto de una fila como JSON (para comprobar que “quedó idéntica”). */
export async function fotoDeFila(
  cliente: Client,
  tabla: 'empresa' | 'emisor' | 'sucursal',
  id: string,
): Promise<unknown> {
  const { rows } = await cliente.query(`SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE id = $1`, [
    id,
  ]);
  return rows[0]?.fila ?? null;
}

/**
 * Sentencias del criterio 19: sobre `empresa`, `emisor` y `sucursal` (con filas existentes), `SELECT` y
 * `UPDATE`, `DELETE` sobre `emisor` y `sucursal`, e `INSERT` en `emisor` y `sucursal`. Sin contexto de
 * empresa, todas deben fallar con SQLSTATE `42501` y un mensaje `contexto de empresa ausente…`.
 */
export function sentenciasDelCriterio19(
  cliente: Client,
  empresaId: string,
): [string, () => Promise<unknown>][] {
  const insertarEmisor = () =>
    cliente.query(
      `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
       VALUES ($1, $2, 'Sin contexto SAC', 'GENERAL', now(), now())`,
      [empresaId, rucAleatorio()],
    );
  const insertarSucursal = () =>
    cliente.query(
      `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
       VALUES ($1, $2, $3, '0077', 'Calle 7', now(), now())`,
      [empresaId, randomUUID(), textoUnico('SinContexto')],
    );
  return [
    ['SELECT empresa', () => cliente.query('SELECT * FROM empresa')],
    ['SELECT emisor', () => cliente.query('SELECT * FROM emisor')],
    ['SELECT sucursal', () => cliente.query('SELECT * FROM sucursal')],
    ['UPDATE empresa', () => cliente.query('UPDATE empresa SET nombre = nombre')],
    ['UPDATE emisor', () => cliente.query('UPDATE emisor SET razon_social = razon_social')],
    ['UPDATE sucursal', () => cliente.query('UPDATE sucursal SET direccion = direccion')],
    ['DELETE emisor', () => cliente.query('DELETE FROM emisor')],
    ['DELETE sucursal', () => cliente.query('DELETE FROM sucursal')],
    ['INSERT emisor', insertarEmisor],
    ['INSERT sucursal', insertarSucursal],
  ];
}

/**
 * Ejecuta cada sentencia del criterio 19 y comprueba que falla con `42501` y `contexto de empresa
 * ausente`. Cada sentencia va dentro de un `SAVEPOINT` si `cliente` está en una transacción
 * (`enTransaccionAbierta`), para que una no aborte a las siguientes.
 */
export async function exigirContextoAusente(
  cliente: Client,
  empresaId: string,
  opciones: { enTransaccionAbierta?: boolean } = {},
): Promise<void> {
  for (const [nombre, ejecutar] of sentenciasDelCriterio19(cliente, empresaId)) {
    if (opciones.enTransaccionAbierta) await cliente.query('SAVEPOINT sin_contexto');
    const error = await errorDe(ejecutar());
    if (opciones.enTransaccionAbierta) await cliente.query('ROLLBACK TO SAVEPOINT sin_contexto');
    if (error.code !== '42501' || !/^contexto de empresa ausente/.test(error.message)) {
      throw new Error(
        `${nombre}: se esperaba 42501 "contexto de empresa ausente…" y fue ${error.code} "${error.message}"`,
      );
    }
  }
}
