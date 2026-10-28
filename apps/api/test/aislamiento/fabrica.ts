// spec: 001-base-multitenancy (pruebas protegidas)
//
// Ayudantes compartidos por las pruebas de aislamiento. No dependen de la implementación de la API:
// crean empresas a nivel SQL con un cliente `restaurante_plataforma` (política `acceso_plataforma`) y
// ejecutan sentencias como `restaurante_api` fijando el contexto por su cuenta con
// `SELECT fijar_contexto_empresa($1)` (criterio 22e).
//
// Actualizado por la sección 002 (P10, criterios 113 a 116): toda escritura corre con un actor de
// sistema fijado con `SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba')`; sin actor, la base
// rechaza la escritura con 42501 "contexto de actor ausente", igual que un rechazo de RLS tiene 42501.
// Por eso las pruebas de rechazo por RLS fijan el actor y comprueban el mensaje de la política.
import { randomInt, randomUUID } from 'node:crypto';
import type { RegistrarEmpresaEntrada } from '@restaurante/contratos';
import type { Client, DatabaseError } from 'pg';
import { generarRucUnico, type PrefijoRuc } from './ruc-unico';

/**
 * RUC válido (prefijo 20 por defecto, dígito verificador calculado) y único entre archivos paralelos:
 * los cuerpos se reparten por bloques reservados por proceso (ver `ruc-unico.ts`), sin sorteo que choque.
 */
export function rucAleatorio(prefijo: PrefijoRuc = '20'): string {
  return generarRucUnico(prefijo);
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

/** Actor de sistema con el que las pruebas de 001 escriben por SQL (criterio 117: `prueba`). */
export const ACTOR_DE_PRUEBA = 'prueba';

/** Fija el actor de sistema de la transacción en curso (hay que estar dentro de un `BEGIN`). */
export async function fijarActorDePrueba(
  cliente: Client,
  sistema: string = ACTOR_DE_PRUEBA,
): Promise<void> {
  await cliente.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', [sistema]);
}

/**
 * Corre `fn` en una transacción propia con el actor de sistema ya fijado y la confirma (o la revierte
 * si `confirmar` es `false`). Para escrituras sueltas por SQL de una prueba: un `INSERT` o `UPDATE`
 * en autocommit fallaría por falta de actor (criterio 115).
 */
export async function conActor<T>(
  cliente: Client,
  fn: () => Promise<T>,
  opciones: { sistema?: string; confirmar?: boolean } = {},
): Promise<T> {
  await cliente.query('BEGIN');
  try {
    await fijarActorDePrueba(cliente, opciones.sistema);
    const resultado = await fn();
    await cliente.query(opciones.confirmar === false ? 'ROLLBACK' : 'COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  }
}

/** `BEGIN` seguido de la fijación del actor de sistema de las pruebas (una sola vez por transacción). */
export async function comenzar(cliente: Client, sistema: string = ACTOR_DE_PRUEBA): Promise<void> {
  await cliente.query('BEGIN');
  await fijarActorDePrueba(cliente, sistema);
}

/**
 * Corre `fn` (normalmente una sentencia que debe fallar por falta de contexto de empresa) en una
 * transacción que ya tiene actor, y siempre la revierte. Con actor fijado, el único motivo de rechazo
 * posible es el de la política RLS, no el de "contexto de actor ausente".
 */
export async function sinEmpresaConActor<T>(cliente: Client, fn: () => Promise<T>): Promise<T> {
  return conActor(cliente, fn, { confirmar: false });
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
 * Crea una empresa completa por SQL con un cliente `restaurante_plataforma`, en una transacción con el
 * actor de sistema `prueba` fijado (criterios 115 y 117). Por defecto: un emisor y dos sucursales. Las
 * sucursales se reparten entre los emisores.
 */
export async function crearEmpresaSql(
  plataforma: Client,
  opciones: { emisores?: number; sucursales?: number } = {},
): Promise<EmpresaSql> {
  return conActor(plataforma, () => crearEmpresaSqlConActor(plataforma, opciones));
}

async function crearEmpresaSqlConActor(
  plataforma: Client,
  opciones: { emisores?: number; sucursales?: number },
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
 * Corre `fn` dentro de una transacción de `cliente`. Fija el actor de sistema `prueba` (o el de
 * `opciones.actor`; `false` para no fijar ninguno) y, si `empresaId` no es `null`, el contexto con
 * `SELECT fijar_contexto_empresa($1)` (criterio 22e). Termina con ROLLBACK salvo que se pida
 * `confirmar`; si `fn` lanza, revierte y relanza.
 */
export async function enTransaccion<T>(
  cliente: Client,
  empresaId: string | null,
  fn: () => Promise<T>,
  opciones: { confirmar?: boolean; actor?: string | false } = {},
): Promise<T> {
  await cliente.query('BEGIN');
  try {
    if (opciones.actor !== false) await fijarActorDePrueba(cliente, opciones.actor);
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
    await fijarActorDePrueba(cliente);
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
    // Con el actor fijado: un INSERT sin actor fallaría antes de llegar a la política con otro mensaje.
    const error = await errorDe(
      opciones.enTransaccionAbierta ? ejecutar() : sinEmpresaConActor(cliente, ejecutar),
    );
    if (opciones.enTransaccionAbierta) await cliente.query('ROLLBACK TO SAVEPOINT sin_contexto');
    if (error.code !== '42501' || !/^contexto de empresa ausente/.test(error.message)) {
      throw new Error(
        `${nombre}: se esperaba 42501 "contexto de empresa ausente…" y fue ${error.code} "${error.message}"`,
      );
    }
  }
}
